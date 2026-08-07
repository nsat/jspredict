import type { Radians, Kilometers, DateTimeTypes } from "./types.ts";
import { WGS84, day2ms } from "./constants.ts";
import { DateTime } from "luxon";
import { gstime, SatRec, json2satrec } from "satellite.js";
import { TwoLineElement, OrbitMeanElementsMessage } from "./types.ts";


// <--------------------------------------------------------------------------->
// UTILITY FUNCTIONS
// <--------------------------------------------------------------------------->

/**
 * Calculate the radius of Earth's curvature at a given latitude 
 * based on a WGS84 ellipsoid.
 * @param latitude sub-satellite point (SSP) latitude in radians.
 */
export function localEarthRadius(latitude: Radians): Kilometers {
  const re = WGS84.a / Math.sqrt((1 - WGS84.e2 * Math.pow(Math.sin(latitude), 2)));
  return re;
}

/**
 * Calculate the Earth central angle for a given radius and altitude.
 * @param re earth radius
 * @param altitude satellite altitude (kilometers)
 * @param minElevationAngle minimum elevation angle (radians)
 */
export function earthCentralAngle(re: Kilometers, altitude: Kilometers, minElevationAngle: Radians = 0.0): Radians {
  const lambda = Math.acos((re / (re + altitude)) * Math.cos(minElevationAngle)) - minElevationAngle
  return lambda
}

/**
 * Calculate the satellite's footprint radius.
 * @param lattitude sub-satellite point (SSP) latitude in radians
 * @param altitude satellite altitude (kilometers)
 * @param minElevationAngle minimum elevation angle (radians)
 */
 export function footprintRadius(latitude: Radians, altitude: Kilometers, minElevationAngle: Radians = 0.0): Kilometers {
   const re = localEarthRadius(latitude);
   const lambda = earthCentralAngle(re, altitude, minElevationAngle)
   const footprint = re * lambda
   return footprint
 }

 /**
  * Convert the datetime string, unix timestamp (ms), or Date object to a luxon.DateTime object.
  */
export function parseDateTime(dateTime: DateTimeTypes): DateTime {
  // 1. Check if object is already a luxon.DateTime
  if (dateTime instanceof DateTime) {
    return dateTime
  }
  
  // 2. Check for native Date object
  if (dateTime instanceof Date) {
    return DateTime.fromJSDate(dateTime);
  }

  // 3. Check for number (timestamp)
  if (typeof dateTime === 'number') {
    return DateTime.fromMillis(dateTime, { zone: "UTC"});
  }

  // 4. Fallback to string (ISO or standard format)
  if (typeof dateTime === 'string') {
    const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateTime)

    // Assume UTC only when the string does not already include timezone data.
    return hasExplicitTimezone
      ? DateTime.fromISO(dateTime, { setZone: true })
      : DateTime.fromISO(dateTime, { zone: "UTC"})
  }
  
  throw new Error('Unsupported datetime type');
}

/**
 * Calculates the Greenwich Mean Sidereal Time (GMST) from a luxon.DateTime object measured in radians
 */
export function greenwichMeanSiderealTime(dateTime: DateTime): Radians {
  return gstime(dateTime.toJSDate())
}

/**
 * Predict the completed orbit revolution count at a given observation time.
 */
export function predictedRevolutionCount(
  orbitMeanElementsMessage: OrbitMeanElementsMessage,
  observationTime: DateTime,
): number {
  const elementEpoch = parseDateTime(orbitMeanElementsMessage.EPOCH)

  return Math.floor(
    Number(orbitMeanElementsMessage.REV_AT_EPOCH ?? 0) +
      ((observationTime.toMillis() - elementEpoch.toMillis()) / day2ms) * Number(orbitMeanElementsMessage.MEAN_MOTION),
  )
}

/**
 * Converts a Two Line Element (TLE) string into a Orbit Mean Elemenets Message (OMM)
 * @param twoLineElement a two line element string
 * @returns OrbitMeanElementsMessage
 */
export function convertTleToOmm(tle: TwoLineElement): OrbitMeanElementsMessage {
  const lines = tle
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  if (lines.length !== 2 && lines.length !== 3) {
    throw new Error('TLE must contain either 2 or 3 non-empty lines')
  }

  const [nameLine, line1, line2] = lines.length === 3 ? lines : ['', lines[0], lines[1]]

  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw new Error('Invalid TLE format')
  }

  const hasValidChecksum = (line: string): boolean => {
    if (line.length < 69) {
      return false
    }

    const checksum = Number(line.substring(68, 69))

    if (Number.isNaN(checksum)) {
      return false
    }

    let sum = 0

    for (const char of line.substring(0, 68)) {
      if (char >= '0' && char <= '9') {
        sum += Number(char)
      } else if (char === '-') {
        sum += 1
      }
    }

    return sum % 10 === checksum
  }

  if (!hasValidChecksum(line1) || !hasValidChecksum(line2)) {
    throw new Error('Invalid TLE checksum')
  }

  const parseTleExponent = (value: string): number => {
    const sign = value.substring(0, 1).trim() || ''
    const mantissa = value.substring(1, 6).trim() || '0'
    const exponent = value.substring(6, 8).trim() || '0'

    return Number(`${sign}0.${mantissa}e${exponent}`)
  }

  const epochYear = Number(line1.substring(18, 20))
  const epochDay = Number(line1.substring(20, 32))
  const fullYear = epochYear < 57 ? epochYear + 2000 : epochYear + 1900
  const compactObjectId = line1.substring(9, 17).trim()
  const objectIdMatch = compactObjectId.match(/^(\d{2})(\d{3})([A-Z0-9]+)?$/)
  const objectId = objectIdMatch
    ? `${Number(objectIdMatch[1]) < 57 ? 2000 + Number(objectIdMatch[1]) : 1900 + Number(objectIdMatch[1])}-${objectIdMatch[2]}${objectIdMatch[3] ?? ''}`
    : compactObjectId
  const objectName = nameLine.replace(/^0\s+/, '') || objectId

  return {
    CCSDS_OMM_VERS: '3.0',
    CENTER_NAME: 'EARTH',
    REF_FRAME: 'TEME',
    TIME_SYSTEM: 'UTC',
    MEAN_ELEMENT_THEORY: 'SGP4',
    OBJECT_NAME: objectName,
    OBJECT_ID: objectId,
    CLASSIFICATION_TYPE: line1.substring(7, 8).trim() as 'U' | 'C',
    NORAD_CAT_ID: line1.substring(2, 7),
    EPOCH: DateTime.utc(fullYear, 1, 1)
      .plus({ milliseconds: (epochDay - 1) * day2ms })
      .toISO({ includeOffset: true, suppressMilliseconds: false }) ?? '',
    MEAN_MOTION: Number(line2.substring(52, 63)),
    ECCENTRICITY: Number(`0.${line2.substring(26, 33).replace(/\s/g, '0')}`),
    INCLINATION: Number(line2.substring(8, 16)),
    RA_OF_ASC_NODE: Number(line2.substring(17, 25)),
    ARG_OF_PERICENTER: Number(line2.substring(34, 42)),
    MEAN_ANOMALY: Number(line2.substring(43, 51)),
    EPHEMERIS_TYPE: 0,
    ELEMENT_SET_NO: Number(line1.substring(64, 68)),
    REV_AT_EPOCH: Number(line2.substring(63, 68)),
    BSTAR: parseTleExponent(line1.substring(53, 61)),
    MEAN_MOTION_DOT: Number(line1.substring(33, 43)),
    MEAN_MOTION_DDOT: parseTleExponent(line1.substring(44, 52)),
  }
}

/**
 * Parses either a TLE string or OMM object and returns a satellite.js satrec object
 * @param satelliteElements a Two Line Element (TLE) string or Orbit Mean Elements Message (OMM) object
 * @returns SatRec
 */
export function parseSatelliteElements(satelliteElements: TwoLineElement | OrbitMeanElementsMessage): [OrbitMeanElementsMessage, SatRec] {
  let omm: OrbitMeanElementsMessage;
  
  if (typeof satelliteElements === 'string') {
    omm = convertTleToOmm(satelliteElements);
  } else {
    omm = satelliteElements;
  }

  return [omm, json2satrec(omm)]
}
