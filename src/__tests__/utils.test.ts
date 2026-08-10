import { DateTime } from 'luxon'
import { describe, expect, test } from 'vitest'
import { ecfToEci, eciToEcf, eciToGeodetic, geodeticToEcf } from 'satellite.js'

import { WGS84, deg2rad } from '../constants'
import { AngularUnits } from '../index'
import {
  convertTleToOmm,
  earthCentralAngle,
  footprintDiameter,
  greenwichMeanSiderealTime,
  inferPosition,
  inferVelocity,
  localEarthRadius,
  parseDateTime,
  predictedRevolutionCount,
} from '../utils'

// <--------------------------------------------------------------------------->
// TEST RESOURCES
// <--------------------------------------------------------------------------->

const namedTle = `0 LEMUR-2 JEROEN
1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990
2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130`

const unnamedTle = `1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990
2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130`

const invalidChecksumTle = `0 LEMUR-2 JEROEN
1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9991
2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130`

// A consistent set of coordinates across every frame for a single point, used to
// exercise inferPosition. Geodetic values feed satellite.js so all frames agree.
const inferGmst = 2.637779678153912
const inferGeodetic = { longitude: 1.0, latitude: 0.5, height: 550 }
const inferEcef = geodeticToEcf(inferGeodetic)
const inferEci = ecfToEci(inferEcef, inferGmst)

// A velocity vector expressed in ECI, used to exercise inferVelocity. Its ECEF
// counterpart is derived through satellite.js so both frames stay consistent.
const inferVelocityEci = { x: -5350.5797324924, y: -2896.5995459166475, z: 3303.394953045869 }
const inferVelocityEcef = eciToEcf(inferVelocityEci, inferGmst)

// <--------------------------------------------------------------------------->
// TESTS
// <--------------------------------------------------------------------------->

describe('utils.localEarthRadius', () => {
  test('returns the WGS84 semi-major axis at the equator', () => {
    expect(localEarthRadius(0)).toBeCloseTo(WGS84.a, 10)
  })

  test('returns the same value for matching north and south latitudes', () => {
    const north = localEarthRadius(45 * deg2rad)
    const south = localEarthRadius(-45 * deg2rad)

    expect(north).toBeCloseTo(south, 10)
  })
})

describe('utils.earthCentralAngle', () => {
  test('matches the horizon-angle formula when minimum elevation is zero', () => {
    const re = WGS84.a
    const altitude = 550
    const expected = Math.acos(re / (re + altitude))

    expect(earthCentralAngle(re, altitude)).toBeCloseTo(expected, 12)
  })

  test('decreases as the minimum elevation angle increases', () => {
    const re = WGS84.a
    const altitude = 550
    const horizonAngle = earthCentralAngle(re, altitude)
    const constrainedAngle = earthCentralAngle(re, altitude, 10 * deg2rad)

    expect(constrainedAngle).toBeLessThan(horizonAngle)
  })
})

describe('utils.footprintDiameter', () => {
  test('returns zero when altitude is zero', () => {
    const position = { geodetic: { latitude: 0, longitude: 0, height: 0 } }

    expect(footprintDiameter(position, 0)).toBeCloseTo(0, 12)
  })

  test('matches the local radius multiplied by the central angle', () => {
    const latitude = 30 * deg2rad
    const altitude = 550
    const epsilon = 5 * deg2rad
    const expected =
      localEarthRadius(latitude) *
      earthCentralAngle(localEarthRadius(latitude), altitude, epsilon) *
      2
    const position = { geodetic: { latitude, longitude: 0, height: altitude } }

    expect(footprintDiameter(position, epsilon)).toBeCloseTo(expected, 10)
  })
})

describe('utils.parseDateTime', () => {
  test('parses datetime strings as UTC when no timezone is provided', () => {
    const parsedDate = parseDateTime('2026-07-15T14:30:42.137')

    expect(parsedDate.year).toBe(2026)
    expect(parsedDate.month).toBe(7)
    expect(parsedDate.day).toBe(15)
    expect(parsedDate.hour).toBe(14)
    expect(parsedDate.minute).toBe(30)
    expect(parsedDate.second).toBe(42)
    expect(parsedDate.millisecond).toBe(137)
    expect(parsedDate.zoneName).toBe('UTC')
  })

  test('preserves timezone data when the datetime string includes it', () => {
    const parsedDate = parseDateTime('2026-07-15T14:30:42.137-04:00')

    expect(parsedDate.year).toBe(2026)
    expect(parsedDate.month).toBe(7)
    expect(parsedDate.day).toBe(15)
    expect(parsedDate.hour).toBe(14)
    expect(parsedDate.minute).toBe(30)
    expect(parsedDate.second).toBe(42)
    expect(parsedDate.millisecond).toBe(137)
    expect(parsedDate.offset).toBe(-240)
    expect(parsedDate.toISO()).toBe('2026-07-15T14:30:42.137-04:00')
  })

  test('parses unix timestamps', () => {
    const timestamp = Date.UTC(2026, 6, 15, 14, 30, 42, 137)
    const parsedDate = parseDateTime(timestamp)

    expect(parsedDate.toMillis()).toBe(timestamp)
    expect(parsedDate.zoneName).toBe('UTC')
  })

  test('parses JS Date objects', () => {
    const date = new Date(2026, 6, 15, 14, 30, 42, 137)
    const parsedDate = parseDateTime(date)
    const expected = DateTime.fromJSDate(date)

    expect(parsedDate.toMillis()).toBe(date.getTime())
    expect(parsedDate.year).toBe(date.getFullYear())
    expect(parsedDate.month).toBe(date.getMonth() + 1) // luxon doesn't use 0 indexing
    expect(parsedDate.day).toBe(date.getDate())
    expect(parsedDate.hour).toBe(date.getHours())
    expect(parsedDate.minute).toBe(date.getMinutes())
    expect(parsedDate.second).toBe(date.getSeconds())
    expect(parsedDate.millisecond).toBe(date.getMilliseconds())
    expect(parsedDate.zoneName).toBe(expected.zoneName)
  })

  test('returns existing luxon DateTime instances unchanged', () => {
    const dateTime = DateTime.utc(2026, 7, 15, 14, 30, 42, 137)

    expect(parseDateTime(dateTime)).toBe(dateTime)
  })

  test('throws errors for unsupported types', () => {
    expect(() => parseDateTime({} as never)).toThrow('Unsupported datetime type')
  })
})

describe('utils.greenwichMeanSiderealTime', () => {
  test('returns the expected sidereal time in radians for a fixed UTC instant', () => {
    const dateTime = DateTime.fromISO('2026-07-15T14:30:42.137Z')

    expect(greenwichMeanSiderealTime(dateTime)).toBeCloseTo(2.637779678153912, 12)
  })
})

describe('utils.predictedRevolutionCount', () => {
  test('predicts completed revolutions from epoch, observation time, and mean motion', () => {
    const omm = convertTleToOmm(`0 ISS (ZARYA)
1 25544U 98067A   26219.02141064  .00004539  00000-0  89363-4 0  9992
2 25544  51.6324  48.5171 0007293  20.5996 339.5285 15.49370096579630`)

    expect(predictedRevolutionCount(omm, DateTime.fromISO('2026-08-08T00:30:49.879296Z'))).toBe(57979)
  })
})

describe('utils.convertTleToOmm', () => {
  test('converts a 3-line TLE and uses line 0 as the object name', () => {
    const omm = convertTleToOmm(namedTle)

    expect(omm.OBJECT_NAME).toBe('LEMUR-2 JEROEN')
    expect(omm.OBJECT_ID).toBe('2015-052E')
    expect(omm.NORAD_CAT_ID).toBe('40934')
    expect(omm.CLASSIFICATION_TYPE).toBe('U')
    expect(omm.EPOCH).toBe('2015-11-02T02:24:41.574Z')
    expect(omm.MEAN_MOTION).toBeCloseTo(14.7605623, 10)
    expect(omm.ECCENTRICITY).toBeCloseTo(0.0010344, 10)
    expect(omm.INCLINATION).toBeCloseTo(6.0033, 10)
    expect(omm.RA_OF_ASC_NODE).toBeCloseTo(141.219, 10)
    expect(omm.ARG_OF_PERICENTER).toBeCloseTo(133.6141, 10)
    expect(omm.MEAN_ANOMALY).toBeCloseTo(226.4604, 10)
    expect(omm.BSTAR).toBeCloseTo(0.00015647, 12)
    expect(omm.MEAN_MOTION_DOT).toBeCloseTo(0.0000174, 12)
    expect(omm.MEAN_MOTION_DDOT).toBe(0)
    expect(omm.ELEMENT_SET_NO).toBe(999)
    expect(omm.REV_AT_EPOCH).toBe(513)
  })

  test('converts a 2-line TLE and uses object ID as object name', () => {
    const omm = convertTleToOmm(unnamedTle)

    expect(omm.OBJECT_NAME).toBe('2015-052E')
    expect(omm.OBJECT_ID).toBe('2015-052E')
    expect(omm.NORAD_CAT_ID).toBe('40934')
  })

  test('throws when a TLE checksum is invalid', () => {
    expect(() => convertTleToOmm(invalidChecksumTle)).toThrow('Invalid TLE checksum')
  })
})

describe('utils.inferPosition', () => {
  const expectVec3CloseTo = (
    actual: { x: number; y: number; z: number } | undefined,
    expected: { x: number; y: number; z: number },
  ) => {
    expect(actual).toBeDefined()
    expect(actual!.x).toBeCloseTo(expected.x, 9)
    expect(actual!.y).toBeCloseTo(expected.y, 9)
    expect(actual!.z).toBeCloseTo(expected.z, 9)
  }

  const expectGeodeticCloseTo = (position: {
    geodetic?: { latitude: number; longitude: number; height: number }
  }) => {
    const geodetic = eciToGeodetic(inferEci, inferGmst)

    expect(position.geodetic).toBeDefined()
    expect(position.geodetic!.latitude).toBeCloseTo(geodetic.latitude, 9)
    expect(position.geodetic!.longitude).toBeCloseTo(geodetic.longitude, 9)
    expect(position.geodetic!.height).toBeCloseTo(geodetic.height, 6)
  }

  test('infers ECI from ECEF and geodetic coordinates', () => {
    const result = inferPosition(
      {
        ecef: inferEcef,
        geodetic: inferGeodetic,
      },
      inferGmst,
      AngularUnits.Radians,
    )

    expectVec3CloseTo(result.eci, ecfToEci(inferEcef, inferGmst))
    expectVec3CloseTo(result.ecef, inferEcef)
    expect(result.geodetic).toBe(inferGeodetic)
  })

  test('infers ECEF and ECI from geodetic coordinates only', () => {
    const result = inferPosition({ geodetic: inferGeodetic }, inferGmst, AngularUnits.Radians)

    expectVec3CloseTo(result.ecef, inferEcef)
    expectVec3CloseTo(result.eci, inferEci)
    expect(result.geodetic).toBe(inferGeodetic)
  })

  test('infers ECI and geodetic from ECEF coordinates only', () => {
    const result = inferPosition({ ecef: inferEcef }, inferGmst, AngularUnits.Radians)

    expectVec3CloseTo(result.eci, ecfToEci(inferEcef, inferGmst))
    expectVec3CloseTo(result.ecef, inferEcef)
    expectGeodeticCloseTo(result)
  })

  test('infers ECEF from ECI and geodetic coordinates', () => {
    const result = inferPosition(
      {
        eci: inferEci,
        geodetic: inferGeodetic,
      },
      inferGmst,
      AngularUnits.Radians,
    )

    expectVec3CloseTo(result.ecef, eciToEcf(inferEci, inferGmst))
    expectVec3CloseTo(result.eci, inferEci)
    expect(result.geodetic).toBe(inferGeodetic)
  })

  test('infers ECEF and geodetic from ECI coordinates only', () => {
    const result = inferPosition({ eci: inferEci }, inferGmst, AngularUnits.Radians)

    expectVec3CloseTo(result.ecef, eciToEcf(inferEci, inferGmst))
    expectVec3CloseTo(result.eci, inferEci)
    expectGeodeticCloseTo(result)
  })

  test('infers geodetic from ECI and ECEF coordinates', () => {
    const result = inferPosition({ eci: inferEci, ecef: inferEcef }, inferGmst, AngularUnits.Radians)

    expectVec3CloseTo(result.eci, inferEci)
    expectVec3CloseTo(result.ecef, inferEcef)
    expectGeodeticCloseTo(result)
  })

  test('returns fully populated coordinates unchanged when all frames are provided', () => {
    const result = inferPosition(
      {
        eci: inferEci,
        ecef: inferEcef,
        geodetic: inferGeodetic,
      },
      inferGmst,
      AngularUnits.Radians,
    )

    expect(result.eci).toBe(inferEci)
    expect(result.ecef).toBe(inferEcef)
    expect(result.geodetic).toBe(inferGeodetic)
  })

  test('round-trips consistently regardless of which frame is provided', () => {
    const fromEci = inferPosition({ eci: inferEci }, inferGmst, AngularUnits.Radians)
    const fromEcef = inferPosition({ ecef: inferEcef }, inferGmst, AngularUnits.Radians)

    expectVec3CloseTo(fromEci.ecef, fromEcef.ecef!)
    expectVec3CloseTo(fromEcef.eci, fromEci.eci!)
    expect(fromEci.geodetic!.latitude).toBeCloseTo(fromEcef.geodetic!.latitude, 9)
    expect(fromEci.geodetic!.longitude).toBeCloseTo(fromEcef.geodetic!.longitude, 9)
    expect(fromEci.geodetic!.height).toBeCloseTo(fromEcef.geodetic!.height, 6)
  })

  test('throws when no coordinate frame is provided', () => {
    expect(() => inferPosition({}, inferGmst, AngularUnits.Radians)).toThrow(
      'At least one set of ECI, ECEF, or Geodetic coordinates must be defined to infer position.',
    )
  })
})

describe('utils.inferVelocity', () => {
  const expectVec3CloseTo = (
    actual: { x: number; y: number; z: number } | undefined,
    expected: { x: number; y: number; z: number },
  ) => {
    expect(actual).toBeDefined()
    expect(actual!.x).toBeCloseTo(expected.x, 9)
    expect(actual!.y).toBeCloseTo(expected.y, 9)
    expect(actual!.z).toBeCloseTo(expected.z, 9)
  }

  test('infers ECI from ECEF velocity only', () => {
    const result = inferVelocity({ ecef: inferVelocityEcef }, inferGmst)

    expectVec3CloseTo(result.eci, ecfToEci(inferVelocityEcef, inferGmst))
    expectVec3CloseTo(result.ecef, inferVelocityEcef)
  })

  test('infers ECEF from ECI velocity only', () => {
    const result = inferVelocity({ eci: inferVelocityEci }, inferGmst)

    expectVec3CloseTo(result.ecef, eciToEcf(inferVelocityEci, inferGmst))
    expectVec3CloseTo(result.eci, inferVelocityEci)
  })

  test('returns both velocity frames unchanged when provided', () => {
    const result = inferVelocity(
      { eci: inferVelocityEci, ecef: inferVelocityEcef },
      inferGmst,
    )

    expect(result.eci).toBe(inferVelocityEci)
    expect(result.ecef).toBe(inferVelocityEcef)
  })

  test('round-trips consistently regardless of which frame is provided', () => {
    const fromEci = inferVelocity({ eci: inferVelocityEci }, inferGmst)
    const fromEcef = inferVelocity({ ecef: inferVelocityEcef }, inferGmst)

    expectVec3CloseTo(fromEci.ecef, fromEcef.ecef!)
    expectVec3CloseTo(fromEcef.eci, fromEci.eci!)
  })

  test('throws when no velocity frame is provided', () => {
    expect(() => inferVelocity({}, inferGmst)).toThrow(
      'At least one set of ECI or ECEF velocity vectors must be defined to infer velocity.',
    )
  })
})
