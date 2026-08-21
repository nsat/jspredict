
import { DateTime } from 'luxon'
import { describe, expect, test } from 'vitest'
import {
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  json2satrec,
  OMMJsonObjectV3,
  propagate,
  radiansToDegrees,
  radiansLat,
  radiansLong,
} from 'satellite.js'

import { SatelliteObservation, satelliteObservation, satelliteSunEvents, satelliteTransits } from '../main'
import { AngularUnits, SatelliteSunEventType, TimestampFormat } from '../enums'
import { convertTleToOmm, dopplerFactorEcf, footprintDiameter } from '../utils'

// <--------------------------------------------------------------------------->
// TEST RESOURCES
// <--------------------------------------------------------------------------->

const issTle = `0 ISS (ZARYA)
1 25544U 98067A   26219.02141064  .00004539  00000-0  89363-4 0  9992
2 25544  51.6324  48.5171 0007293  20.5996 339.5285 15.49370096579630`

const issOmm = {
  "CCSDS_OMM_VERS": "3.0",
  "COMMENT": "GENERATED VIA SPACE-TRACK.ORG API",
  "CREATION_DATE": "2026-08-07T12:46:56",
  "ORIGINATOR": "18 SPCS",
  "OBJECT_NAME": "ISS (ZARYA)",
  "OBJECT_ID": "1998-067A",
  "CENTER_NAME": "EARTH",
  "REF_FRAME": "TEME",
  "TIME_SYSTEM": "UTC",
  "MEAN_ELEMENT_THEORY": "SGP4",
  "EPOCH": "2026-08-07T00:30:49.879296",
  "MEAN_MOTION": "15.49370096",
  "ECCENTRICITY": "0.00072933",
  "INCLINATION": "51.6324",
  "RA_OF_ASC_NODE": "48.5171",
  "ARG_OF_PERICENTER": "20.5996",
  "MEAN_ANOMALY": "339.5285",
  "EPHEMERIS_TYPE": "0",
  "CLASSIFICATION_TYPE": "U",
  "NORAD_CAT_ID": "25544",
  "ELEMENT_SET_NO": "999",
  "REV_AT_EPOCH": "57963",
  "BSTAR": "0.00008936277000",
  "MEAN_MOTION_DOT": "0.00004539",
  "MEAN_MOTION_DDOT": "0.0000000000000",
  "SEMIMAJOR_AXIS": "6796.705",
  "PERIOD": "92.941",
  "APOAPSIS": "423.527",
  "PERIAPSIS": "413.613",
  "OBJECT_TYPE": "PAYLOAD",
  "RCS_SIZE": "LARGE",
  "COUNTRY_CODE": "CIS",
  "LAUNCH_DATE": "1998-11-20",
  "SITE": "TTMTR",
  "DECAY_DATE": null,
  "FILE": "5307055",
  "GP_ID": "338621911",
  "TLE_LINE0": "0 ISS (ZARYA)",
  "TLE_LINE1": "1 25544U 98067A   26219.02141064  .00004539  00000-0  89363-4 0  9992",
  "TLE_LINE2": "2 25544  51.6324  48.5171 0007293  20.5996 339.5285 15.49370096579630"
}

const observationEpoch = '2026-08-07T00:30:49.879296Z'
const laterObservationEpoch = '2026-08-08T00:30:49.879296Z'
const transitWindowStart = '2026-08-07T01:00:00Z'
const transitWindowStop = '2026-08-08T01:00:00Z'

const unitOptionCases = [undefined, AngularUnits.Degrees, AngularUnits.Radians].flatMap((angular) =>
  [undefined, TimestampFormat.ISO8601, TimestampFormat.Unix, TimestampFormat.Date, TimestampFormat.DateTime].map(
    (timestamp) => {
      return {
        name: `angular=${angular ?? 'default'}, timestamp=${timestamp ?? 'default'}`,
        angular: angular ?? AngularUnits.Degrees,
        timestamp: timestamp ?? TimestampFormat.ISO8601,
      }
    },
  ),
)

function expectTimestampValue(actual: unknown, epoch: string, format: TimestampFormat): void {
  const expected = DateTime.fromISO(epoch, { setZone: true })

  switch (format) {
    case TimestampFormat.ISO8601:
      expect(actual).toBe(expected.toISO())
      break

    case TimestampFormat.Unix:
      expect(actual).toBe(expected.toMillis())
      break

    case TimestampFormat.Date:
      expect(actual).toBeInstanceOf(Date)
      expect((actual as Date).toISOString()).toBe(expected.toJSDate().toISOString())
      break

    case TimestampFormat.DateTime:
      expect(DateTime.isDateTime(actual)).toBe(true)
      expect((actual as DateTime).toISO()).toBe(expected.toISO())
      break
  }
}

function expectTimestampFormat(actual: unknown, format: TimestampFormat): void {
  switch (format) {
    case TimestampFormat.ISO8601:
      expect(typeof actual).toBe('string')
      break

    case TimestampFormat.Unix:
      expect(typeof actual).toBe('number')
      break

    case TimestampFormat.Date:
      expect(actual).toBeInstanceOf(Date)
      break

    case TimestampFormat.DateTime:
      expect(DateTime.isDateTime(actual)).toBe(true)
      break
  }
}

function timestampToMillis(timestamp: unknown): number {
  if (DateTime.isDateTime(timestamp)) {
    return timestamp.toMillis()
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime()
  }

  if (typeof timestamp === 'string') {
    return DateTime.fromISO(timestamp, { setZone: true }).toMillis()
  }

  if (typeof timestamp === 'number') {
    return timestamp
  }

  throw new Error('Unsupported timestamp type')
}

function expectedAngle(angleRadians: number, angular: AngularUnits): number {
  return angular === AngularUnits.Degrees ? radiansToDegrees(angleRadians) : angleRadians
}

function observationOptionsFor(angular: AngularUnits, timestamp: TimestampFormat) {
  return {
    azimuthAngularUnits: angular,
    elevationAngularUnits: angular,
    geodeticAngularUnits: angular,
    betaAngleAngularUnits: angular,
    orbitPhaseAngularUnits: angular,
    timestampFormat: timestamp,
  }
}

function observerPositionFor(angular: AngularUnits) {
  return {
    geo: angular === AngularUnits.Degrees
      ? {
          latitude: 15,
          longitude: 130,
          height: 0.1,
        }
      : {
          latitude: radiansLat(15),
          longitude: radiansLong(130),
          height: 0.1,
        },
  }
}

const transitUnitOptionCases = [
  {
    name: 'default',
    angular: AngularUnits.Degrees,
    timestamp: TimestampFormat.ISO8601,
  },
  {
    name: 'unix timestamps',
    angular: AngularUnits.Degrees,
    timestamp: TimestampFormat.Unix,
  },
  {
    name: 'date timestamps',
    angular: AngularUnits.Degrees,
    timestamp: TimestampFormat.Date,
  },
  {
    name: 'radians datetime',
    angular: AngularUnits.Radians,
    timestamp: TimestampFormat.DateTime,
  },
]

// <--------------------------------------------------------------------------->
// TESTS
// <--------------------------------------------------------------------------->

describe('satelliteObservation', () => {
  test.each(unitOptionCases)('returns a ground track for $name', ({ angular, timestamp }) => {
    const observed = satelliteObservation(
      issTle,
      observationEpoch,
      undefined,
      observationOptionsFor(angular, timestamp),
    ) as SatelliteObservation
    const date = new Date(observationEpoch)
    const satrec = json2satrec(convertTleToOmm(issTle))
    const propagated = propagate(satrec, date)

    if (!propagated) {
      throw new Error('Expected propagation result')
    }

    const gmst = gstime(date)
    const geodetic = eciToGeodetic(propagated.position, gmst)
    const ecef = eciToEcf(propagated.position, gmst)

    expect(observed.id).toBe('1998-067A')
    expect(observed.name).toBe('ISS (ZARYA)')
    expect(observed.noradCatalogId).toBe('25544')
    expectTimestampValue(observed.epoch, observationEpoch, timestamp)
    expect(observed.decayed).toBe(false)
    expect(observed.position?.eci?.x).toBeCloseTo(propagated.position.x, 10)
    expect(observed.position?.ecef?.x).toBeCloseTo(ecef.x, 10)
    expect(observed.position?.geo?.latitude).toBeCloseTo(expectedAngle(geodetic.latitude, angular), 10)
    expect(observed.position?.geo?.longitude).toBeCloseTo(expectedAngle(geodetic.longitude, angular), 10)
    expect(observed.position?.geo?.height).toBeCloseTo(geodetic.height, 10)
    expect(observed.footprint).toBeCloseTo(footprintDiameter({ geo: geodetic }, 0), 10)
    expect(observed.velocity?.eci?.x).toBeCloseTo(propagated.velocity.x, 10)
    expect(observed.velocity?.ecef?.x).toBeCloseTo(eciToEcf(propagated.velocity, gmst).x, 10)
    expect(observed.orbit?.phase).toBeCloseTo(
      expectedAngle(((propagated.meanElements.mm % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), angular),
      10,
    )
    expect(observed.orbit?.velocity).toBeCloseTo(
      Math.hypot(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z),
      10,
    )
  })

  test.each(unitOptionCases)('returns observer look angles for $name', ({ angular, timestamp }) => {
    const observerPosition = observerPositionFor(angular)
    const observerGeodetic = {
      latitude: radiansLat(15),
      longitude: radiansLong(130),
      height: 0.1,
    }
    const observed = satelliteObservation(
      issOmm as OMMJsonObjectV3,
      observationEpoch,
      observerPosition,
      observationOptionsFor(angular, timestamp),
    )
    const date = new Date(observationEpoch)
    const satrec = json2satrec(issOmm as OMMJsonObjectV3)
    const propagated = propagate(satrec, date)

    if (!propagated || !('observerPosition' in observed)) {
      throw new Error('Expected observed track with observer data')
    }

    const gmst = gstime(date)
    const positionEcf = eciToEcf(propagated.position, gmst)
    const velocityEcf = eciToEcf(propagated.velocity, gmst)
    const observerEcf = geodeticToEcf(observerGeodetic)
    const lookAngles = ecfToLookAngles(observerGeodetic, positionEcf)

    expectTimestampValue(observed.epoch, observationEpoch, timestamp)
    expect(observed.observerPosition!.ecef!.x).toBeCloseTo(observerEcf.x, 10)
    expect(observed.observerPosition!.geo!.latitude).toBeCloseTo(expectedAngle(observerGeodetic.latitude, angular), 10)
    expect(observed.observerPosition!.geo!.longitude).toBeCloseTo(expectedAngle(observerGeodetic.longitude, angular), 10)
    expect(observed.azimuth).toBeCloseTo(expectedAngle(lookAngles.azimuth, angular), 10)
    expect(observed.elevation).toBeCloseTo(expectedAngle(lookAngles.elevation, angular), 10)
    expect(observed.slantRange).toBeCloseTo(lookAngles.rangeSat, 10)
    expect(observed.dopplerFactor).toBeCloseTo(dopplerFactorEcf(observerEcf, positionEcf, velocityEcf), 12)
  })

  test('predicts revolution count from the observation time', () => {
    const observed = satelliteObservation(issOmm as OMMJsonObjectV3, laterObservationEpoch) as SatelliteObservation

    expect(observed.orbit?.revolutionCount).toBe(57979)
  })
})

describe('satelliteObservation with array input', () => {
  test.each(unitOptionCases)('returns one observation per datetime for $name', ({ angular, timestamp }) => {
    const dateTimes = [observationEpoch, laterObservationEpoch]
    const observerPosition = observerPositionFor(angular)

    const observed = satelliteObservation(
      issOmm as OMMJsonObjectV3,
      dateTimes,
      observerPosition,
      observationOptionsFor(angular, timestamp),
    )

    expect(Array.isArray(observed)).toBe(true)
    expect(observed).toHaveLength(dateTimes.length)

    dateTimes.forEach((dateTime, index) => {
      const expected = satelliteObservation(
        issOmm as OMMJsonObjectV3,
        dateTime,
        observerPosition,
        observationOptionsFor(angular, timestamp),
      )

      const { epoch: actualEpoch, ...actualRest } = (observed as any)[index]
      const { epoch: expectedEpoch, ...expectedRest } = expected as any

      expect(actualRest).toStrictEqual(expectedRest)
      expectTimestampValue(actualEpoch, dateTime, timestamp)
      expectTimestampValue(expectedEpoch, dateTime, timestamp)
    })
  })

  test('returns an empty array when no datetimes are provided', () => {
    const result = satelliteObservation(issOmm as OMMJsonObjectV3, [])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toStrictEqual([])
  })
})

describe('satelliteTransits', () => {
  test.each(transitUnitOptionCases)('returns ordered transit events for $name', ({ angular, timestamp }) => {
    const observerPosition = observerPositionFor(angular)
    const transits = satelliteTransits(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
      observerPosition,
      0,
      observationOptionsFor(angular, timestamp),
    )

    expect(transits.length).toBeGreaterThan(0)

    transits.forEach((transit) => {
      expectTimestampFormat(transit.start, timestamp)
      expectTimestampFormat(transit.stop, timestamp)
      expectTimestampFormat(transit.aos.epoch, timestamp)
      expectTimestampFormat(transit.los.epoch, timestamp)
      expectTimestampFormat(transit.peak.epoch, timestamp)
      expectTimestampFormat(transit.tca.epoch, timestamp)

      const startMillis = timestampToMillis(transit.start)
      const stopMillis = timestampToMillis(transit.stop)
      const aosMillis = timestampToMillis(transit.aos.epoch)
      const losMillis = timestampToMillis(transit.los.epoch)
      const peakMillis = timestampToMillis(transit.peak.epoch)
      const tcaMillis = timestampToMillis(transit.tca.epoch)

      expect(startMillis).toBeCloseTo(aosMillis, 0)
      expect(stopMillis).toBeCloseTo(losMillis, 0)
      expect(startMillis).toBeLessThan(stopMillis)
      expect(peakMillis).toBeGreaterThanOrEqual(startMillis)
      expect(peakMillis).toBeLessThanOrEqual(stopMillis)
      expect(tcaMillis).toBeGreaterThanOrEqual(startMillis)
      expect(tcaMillis).toBeLessThanOrEqual(stopMillis)
      expect(Math.abs(transit.duration - ((stopMillis - startMillis) / 1000))).toBeLessThan(0.002)

      const aosObservation = satelliteObservation(issOmm as OMMJsonObjectV3, transit.aos.epoch, observerPosition, observationOptionsFor(angular, timestamp)) as any
      const losObservation = satelliteObservation(issOmm as OMMJsonObjectV3, transit.los.epoch, observerPosition, observationOptionsFor(angular, timestamp)) as any
      const peakObservation = satelliteObservation(issOmm as OMMJsonObjectV3, transit.peak.epoch, observerPosition, observationOptionsFor(angular, timestamp)) as any
      const tcaObservation = satelliteObservation(issOmm as OMMJsonObjectV3, transit.tca.epoch, observerPosition, observationOptionsFor(angular, timestamp)) as any

      expect(aosObservation.azimuth).toBeCloseTo(transit.aos.azimuth, 10)
      expect(aosObservation.elevation).toBeCloseTo(transit.aos.elevation, 10)
      expect(aosObservation.slantRange).toBeCloseTo(transit.aos.slantRange, 10)
      expect(losObservation.azimuth).toBeCloseTo(transit.los.azimuth, 10)
      expect(losObservation.elevation).toBeCloseTo(transit.los.elevation, 10)
      expect(losObservation.slantRange).toBeCloseTo(transit.los.slantRange, 10)
      expect(peakObservation.azimuth).toBeCloseTo(transit.peak.azimuth, 10)
      expect(peakObservation.elevation).toBeCloseTo(transit.peak.elevation, 10)
      expect(peakObservation.slantRange).toBeCloseTo(transit.peak.slantRange, 10)
      expect(tcaObservation.azimuth).toBeCloseTo(transit.tca.azimuth, 10)
      expect(tcaObservation.elevation).toBeCloseTo(transit.tca.elevation, 10)
      expect(tcaObservation.slantRange).toBeCloseTo(transit.tca.slantRange, 10)

      expect(transit.peak.elevation).toBeGreaterThanOrEqual(transit.aos.elevation - 1e-6)
      expect(transit.peak.elevation).toBeGreaterThanOrEqual(transit.los.elevation - 1e-6)
      expect(transit.tca.slantRange).toBeLessThanOrEqual(transit.aos.slantRange + 1e-6)
      expect(transit.tca.slantRange).toBeLessThanOrEqual(transit.los.slantRange + 1e-6)

      // Each transit event exposes the satellite position/velocity vectors and
      // illumination state at the event epoch.
      ;([transit.aos, transit.los, transit.peak, transit.tca] as const).forEach((event) => {
        expect(event.position).toBeDefined()
        expect(event.position.eci).toBeDefined()
        expect(event.position.ecef).toBeDefined()
        expect(event.velocity).toBeDefined()
        expect(event.velocity.eci).toBeDefined()
        expect(typeof event.sunlit).toBe('boolean')
        expect(event.eclipseFactor).toBeGreaterThanOrEqual(0)
        expect(event.eclipseFactor).toBeLessThanOrEqual(1)
        expect(event.sunlit).toBe(event.eclipseFactor < 1)
      })

      expect(transit.aos.position.eci!.x).toBeCloseTo(aosObservation.position.eci.x, 6)
      expect(transit.aos.velocity.eci!.x).toBeCloseTo(aosObservation.velocity.eci.x, 6)
      expect(transit.aos.sunlit).toBe(aosObservation.sunlit)
      expect(transit.aos.eclipseFactor).toBeCloseTo(aosObservation.eclipseFactor, 6)
    })
  })

  test('supports a minimum elevation threshold', () => {
    const observerPosition = observerPositionFor(AngularUnits.Degrees)
    const allTransits = satelliteTransits(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
      observerPosition,
    )
    const filteredTransits = satelliteTransits(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
      observerPosition,
      20,
    )

    expect(filteredTransits.length).toBeLessThanOrEqual(allTransits.length)

    filteredTransits.forEach((transit) => {
      expect(transit.peak.elevation).toBeGreaterThanOrEqual(20)
      // The default elevation tolerance (1e-3 rad ≈ 0.0573°) matches SGP4's
      // inherent angular accuracy, so AOS/LOS converge to within that band of
      // the requested 20° threshold.
      const toleranceDegrees = 1e-3 * (180 / Math.PI)
      expect(Math.abs((transit.aos.elevation as number) - 20)).toBeLessThanOrEqual(toleranceDegrees)
      expect(Math.abs((transit.los.elevation as number) - 20)).toBeLessThanOrEqual(toleranceDegrees)
    })
  })

  test('throws when the time range is invalid', () => {
    const observerPosition = observerPositionFor(AngularUnits.Degrees)

    expect(() =>
      satelliteTransits(
        issOmm as OMMJsonObjectV3,
        transitWindowStop,
        transitWindowStart,
        observerPosition,
      ),
    ).toThrow('Stop date is less than or equal to start date')
  })
})

describe('satelliteSunEvents', () => {
  const validRegimes = [
    SatelliteSunEventType.Sunlit,
    SatelliteSunEventType.Transition,
    SatelliteSunEventType.Eclipse,
  ]

  test('tiles the entire window contiguously with overlapping timestamps', () => {
    const events = satelliteSunEvents(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
    )

    expect(events.length).toBeGreaterThan(0)

    const windowStartMs = DateTime.fromISO(transitWindowStart, { zone: 'utc' }).toMillis()
    const windowStopMs = DateTime.fromISO(transitWindowStop, { zone: 'utc' }).toMillis()

    // First event begins at the window start; last event ends at the window stop.
    expect(timestampToMillis(events[0].start)).toBeCloseTo(windowStartMs, -1)
    expect(timestampToMillis(events[events.length - 1].stop)).toBeCloseTo(windowStopMs, -1)

    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const startMs = timestampToMillis(event.start)
      const stopMs = timestampToMillis(event.stop)

      // Each event is a valid, non-empty interval with a matching duration.
      expect(validRegimes).toContain(event.eventType)
      expect(stopMs).toBeGreaterThan(startMs)
      expect(Math.abs(event.duration - (stopMs - startMs) / 1000)).toBeLessThan(0.002)

      // Overlapping timestamps: this event's stop is the next event's start.
      if (i + 1 < events.length) {
        const nextStartMs = timestampToMillis(events[i + 1].start)
        expect(nextStartMs).toBeCloseTo(stopMs, 6)
      }
    }
  })

  test('adjacent events never share the same regime and are correctly classified', () => {
    const events = satelliteSunEvents(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
    )

    for (let i = 0; i < events.length; i++) {
      // Consecutive segments of the same regime should have been merged.
      if (i + 1 < events.length) {
        expect(events[i].eventType).not.toBe(events[i + 1].eventType)
      }

      // The regime reported must match a fresh observation at the interval
      // midpoint (well away from the boundaries).
      const startMs = timestampToMillis(events[i].start)
      const stopMs = timestampToMillis(events[i].stop)
      const midMs = (startMs + stopMs) / 2

      const observation = satelliteObservation(
        issOmm as OMMJsonObjectV3,
        DateTime.fromMillis(midMs, { zone: 'utc' }).toISO()!,
      ) as SatelliteObservation

      const factor = observation.eclipseFactor as number
      const expectedRegime = factor <= 0
        ? SatelliteSunEventType.Sunlit
        : factor >= 1
          ? SatelliteSunEventType.Eclipse
          : SatelliteSunEventType.Transition

      expect(events[i].eventType).toBe(expectedRegime)
    }
  })

  test('a sunlit <-> eclipse change always has a transition event between them', () => {
    const events = satelliteSunEvents(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
    )

    for (let i = 0; i + 1 < events.length; i++) {
      const a = events[i].eventType
      const b = events[i + 1].eventType
      const isSunlitEclipsePair =
        (a === SatelliteSunEventType.Sunlit && b === SatelliteSunEventType.Eclipse) ||
        (a === SatelliteSunEventType.Eclipse && b === SatelliteSunEventType.Sunlit)
      // Sunlit and Eclipse are never directly adjacent — Transition separates them.
      expect(isSunlitEclipsePair).toBe(false)
    }
  })

  test('respects a coarse step override', () => {
    const events = satelliteSunEvents(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
      { coarseStepSeconds: 30 },
    )
    expect(events.length).toBeGreaterThan(0)
  })

  test.each([
    TimestampFormat.ISO8601,
    TimestampFormat.Unix,
    TimestampFormat.Date,
    TimestampFormat.DateTime,
  ])('formats event timestamps as %s', (timestamp) => {
    const events = satelliteSunEvents(
      issOmm as OMMJsonObjectV3,
      transitWindowStart,
      transitWindowStop,
      { timestampFormat: timestamp },
    )

    expect(events.length).toBeGreaterThan(0)

    events.forEach((event) => {
      expectTimestampFormat(event.start, timestamp)
      expectTimestampFormat(event.stop, timestamp)
    })
  })

  test('throws when the time range is invalid', () => {
    expect(() =>
      satelliteSunEvents(
        issOmm as OMMJsonObjectV3,
        transitWindowStop,
        transitWindowStart,
      ),
    ).toThrow('Stop date is less than or equal to start date')
  })
})
