
import { describe, expect, test } from 'vitest'
import {
  degreesLat,
  degreesLong,
  dopplerFactor,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  json2satrec,
  propagate,
  radiansLat,
  radiansLong,
} from 'satellite.js'

import { observe } from '../index'
import { convertTleToOmm, footprintRadius } from '../utils'

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

// <--------------------------------------------------------------------------->
// TESTS
// <--------------------------------------------------------------------------->

describe('observe', () => {
  test('returns a ground track with position units converted from satellite.js', () => {
    const observed = observe(issTle, observationEpoch)
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
    expect(observed.epoch).toBe('2026-08-07T00:30:49.879Z')
    expect(observed.decayed).toBe(false)
    expect(observed.position?.eci?.x).toBeCloseTo(propagated.position.x, 10)
    expect(observed.position?.ecef?.x).toBeCloseTo(ecef.x, 10)
    expect(observed.position?.latitude).toBeCloseTo(degreesLat(geodetic.latitude), 10)
    expect(observed.position?.longitude).toBeCloseTo(degreesLong(geodetic.longitude), 10)
    expect(observed.position?.altitude).toBeCloseTo(geodetic.height, 10)
    expect(observed.footprint).toBeCloseTo(footprintRadius(geodetic.latitude, geodetic.height) * 2, 10)
    expect(observed.velocity?.eci?.x).toBeCloseTo(propagated.velocity.x, 10)
    expect(observed.velocity?.ecef?.x).toBeCloseTo(eciToEcf(propagated.velocity, gmst).x, 10)
    expect(observed.orbit?.velocity).toBeCloseTo(
      Math.hypot(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z) * 3600,
      10,
    )
  })

  test('returns observer look angles in degrees and slant range in kilometers', () => {
    const observer = { latitude: 15, longitude: 130, altitude: 0.1 }
    const observed = observe(issOmm, observationEpoch, observer)
    const date = new Date(observationEpoch)
    const satrec = json2satrec(issOmm)
    const propagated = propagate(satrec, date)

    if (!propagated || !('observerPosition' in observed)) {
      throw new Error('Expected observed track with observer data')
    }

    const gmst = gstime(date)
    const observerGeodetic = {
      latitude: radiansLat(observer.latitude),
      longitude: radiansLong(observer.longitude),
      height: observer.altitude,
    }
    const positionEcf = eciToEcf(propagated.position, gmst)
    const velocityEcf = eciToEcf(propagated.velocity, gmst)
    const observerEcf = geodeticToEcf(observerGeodetic)
    const lookAngles = ecfToLookAngles(observerGeodetic, positionEcf)

    expect(observed.observerPosition.ecef?.x).toBeCloseTo(observerEcf.x, 10)
    expect(observed.azimuth).toBeCloseTo((lookAngles.azimuth * 180) / Math.PI, 10)
    expect(observed.elevation).toBeCloseTo((lookAngles.elevation * 180) / Math.PI, 10)
    expect(observed.slantRange).toBeCloseTo(lookAngles.rangeSat, 10)
    expect(observed.dopplerFactor).toBeCloseTo(dopplerFactor(observerEcf, positionEcf, velocityEcf), 12)
    expect(observed.hasAos).toBe(false)
    expect(observed.visibility).toBe('below-horizon')
  })

  test('predicts revolution count from the observation time', () => {
    const observed = observe(issOmm, laterObservationEpoch)

    expect(observed.orbit?.revolutionCount).toBe(57978)
  })
})
