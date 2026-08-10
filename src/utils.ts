import { DateTime } from "luxon";
import { Position, Velocity } from "./interfaces.ts";
import { WGS84, day2ms, geostationaryMeanMotion, geostationaryTolerance } from "./constants.ts";
import type { Radians, Kilometers, DateTimeTypes } from "./types.ts";
import { TwoLineElement, OrbitMeanElementsMessage } from "./types.ts";
import {
  gstime,
  SatRec,
  json2satrec,
  geodeticToEcf,
  ecfToEci,
  eciToEcf,
  eciToGeodetic,
  GeodeticLocation,
  radiansLat,
  radiansLong,
  degreesLat,
  EcfPositionCalculator,
  degreesLong,
  MeanElements
} from "satellite.js";
import { AngularUnits } from "./index.ts";

// <--------------------------------------------------------------------------->
// UTILITY FUNCTIONS
// <--------------------------------------------------------------------------->

/**
 * Calculate the maginture of the vector
 * @param vector 
 * @returns 
 */
export function vectorMagnitude(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

/**
 * Determine whether a satellite is in a geostationary orbit from its
 * propagated mean elements.
 *
 * A geostationary orbit is a near-circular, near-equatorial orbit whose
 * period matches Earth's sidereal rotation (one revolution per sidereal day).
 * The satellite is classified as geostationary when all of the following hold
 * within the configured tolerances:
 * - Mean motion is close to the sidereal rate (~one revolution per sidereal day).
 * - Eccentricity is near zero (near-circular orbit).
 * - Inclination is near zero (near-equatorial orbit).
 *
 * @param meanElements the averaged orbital elements from satellite propagation
 * @returns true if the satellite is geostationary, otherwise false
 */
export function isGeostationary(meanElements: MeanElements): boolean {
  const meanMotionDeviation = Math.abs(meanElements.nm - geostationaryMeanMotion) / geostationaryMeanMotion

  return (
    meanMotionDeviation <= geostationaryTolerance.meanMotion &&
    meanElements.em <= geostationaryTolerance.eccentricity &&
    Math.abs(meanElements.im) <= geostationaryTolerance.inclination
  )
}

/**
 * Calculate the beta angle: the angle between the satellite's orbital plane and
 * the vector pointing directly to the Sun.
 *
 * The orbit normal is derived from the orbit's inclination and right ascension
 * of the ascending node (RAAN). The beta angle is the complement of the angle
 * between the Sun vector and the orbit normal, computed as
 * `asin(dot(sunUnit, orbitNormal))`. Both input vectors and the orbital
 * elements are expressed in the Earth-Centered Inertial (ECI) frame.
 *
 * @param meanElements the averaged orbital elements from satellite propagation
 * @param sunEci the Sun's position in ECI coordinates (kilometers)
 * @returns the beta angle in radians, ranging from -PI/2 to PI/2
 */
export function betaAngle(
  meanElements: MeanElements,
  sunEci: { x: number; y: number; z: number },
): Radians {
  const inclination = meanElements.im
  const raan = meanElements.Om

  // Unit normal vector of the orbital plane in the ECI frame.
  const orbitNormal = {
    x: Math.sin(raan) * Math.sin(inclination),
    y: -Math.cos(raan) * Math.sin(inclination),
    z: Math.cos(inclination),
  }

  // Unit vector pointing from Earth's center to the Sun.
  const sunMagnitude = vectorMagnitude(sunEci)
  const sunUnit = {
    x: sunEci.x / sunMagnitude,
    y: sunEci.y / sunMagnitude,
    z: sunEci.z / sunMagnitude,
  }

  const dot = sunUnit.x * orbitNormal.x + sunUnit.y * orbitNormal.y + sunUnit.z * orbitNormal.z

  // Clamp to guard against floating-point values slightly outside [-1, 1].
  return Math.asin(Math.min(1, Math.max(-1, dot)))
}

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
 export function footprintDiameter(satPosition: Position, minElevationAngle: Radians = 0.0): Kilometers {
   const re = localEarthRadius(satPosition.geodetic!.latitude);
   const lambda = earthCentralAngle(re, satPosition.geodetic!.height, minElevationAngle)
   const footprint = re * lambda * 2
   return footprint
 }

 /**
  * Convert the datetime string, unix timestamp (ms), or Date object to a luxon.DateTime object.
  */
export function parseDateTime(dateTime: DateTimeTypes): DateTime {
  // 1. Check if object is already a luxon.DateTime.
  // Use DateTime.isDateTime instead of `instanceof` so a DateTime created by a
  // different copy of the luxon module (e.g. the caller's own install) is still
  // recognized, since `instanceof` fails across module boundaries.
  if (DateTime.isDateTime(dateTime)) {
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

  return Math.ceil(
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

/**
 * Generate a position in multiple coordinate frames from an initial set of coordinates. 
 * A caller must provide at least one set of the following:
 * - The Earth-Centered Inertial (ECI) coordinates of the position in kilometers.
 * - The Earch-Centered Earth-Fixed (ECEF) coordinates of the position in kilometers.
 * - The Geodetic coordinates (longitude, latitude in radians and height in kilometers) of the position.
 * The function will generate coordinates in the coordinate frames that are not provided.
 */
export function inferPosition(position: Position, gmst: Radians, angularUnits: AngularUnits): Position {
  let inferedPosition: Position = {}
  
  // Missing ECI coordinates
  const eciMissing = (!position.eci);
  
  // Missing ECEF coordinates
  const ecefMissing = (!position.ecef);
  
  // Missing Geodetic coordinates
  const geodeticMissing = (!position.geodetic);

  // Convert the geodetic coordinates to radians if necessary
  let geodetic: GeodeticLocation | undefined;
 
  if (!geodeticMissing && angularUnits === AngularUnits.Degrees) {
    geodetic = {
      latitude: radiansLat(position.geodetic!.latitude),
      longitude: radiansLong(position.geodetic!.longitude),
      height: position.geodetic!.height
    }
  } else if (!geodeticMissing && angularUnits == AngularUnits.Radians) {
    geodetic = position.geodetic
  }
  
  // Populate available coordinates 
  inferedPosition.eci = !eciMissing ? position.eci : undefined;
  inferedPosition.ecef = !ecefMissing ? position.ecef : undefined;
  inferedPosition.geodetic = !geodeticMissing ? geodetic : undefined;

  // Calculate the missing coordinate frames
  const decisionFlag = `${eciMissing}:${ecefMissing}:${geodeticMissing}`

  switch (decisionFlag) {
    
    // ECI is missing, ECEF and Geodetic are available
    case 'true:false:false':
      inferedPosition.eci = ecfToEci(position.ecef!, gmst);
      break;

    // ECI and ECEF are missing, Geodetic is available
    case 'true:true:false':
      inferedPosition.ecef = geodeticToEcf(geodetic!);
      inferedPosition.eci = ecfToEci(inferedPosition.ecef, gmst)
      break;
      
    // ECI and Geodetic are missing, ECEF is available
    case 'true:false:true':
      inferedPosition.eci = ecfToEci(position.ecef!, gmst)
      inferedPosition.geodetic = eciToGeodetic(inferedPosition.eci, gmst)
      break;
      
    // ECEF is missing, ECI and Geodetic are available
    case 'false:true:false':
      inferedPosition.ecef = eciToEcf(position.eci!, gmst);
      break;

    // ECEF and Geodetic are missing, ECI is available
    case 'false:true:true':
      inferedPosition.ecef = eciToEcf(position.eci!, gmst)
      inferedPosition.geodetic = eciToGeodetic(position.eci!, gmst)
      break;
    
    // Geodetic is missing, ECI and ECEF are available
    case 'false:false:true':
      inferedPosition.geodetic = eciToGeodetic(position.eci!, gmst)
      break;

    // All 3 coordinate frames are missing
    case 'true:true:true':
      throw new Error('At least one set of ECI, ECEF, or Geodetic coordinates must be defined to infer position.');
  }

  return inferedPosition;
}

/**
 * Generate a velocity in multiple coordinate frames from an initial set of vectors.
 * A caller must provide at least one set of the following:
 * - The Earth-Centered Inertial (ECI) velocity vector in kilometers per second.
 * - The Earth-Centered Earth-Fixed (ECEF) velocity vector in kilometers per second.
 * The function will generate the velocity vector in the coordinate frame that is not provided.
 */
export function inferVelocity(velocity: Velocity, gmst: Radians): Velocity {
  let inferedVelocity: Velocity = {}

  // Missing ECI velocity vector
  const eciMissing = (!velocity.eci);

  // Missing ECEF velocity vector
  const ecefMissing = (!velocity.ecef);

  // Populate available velocity vectors
  inferedVelocity.eci = !eciMissing ? velocity.eci : undefined;
  inferedVelocity.ecef = !ecefMissing ? velocity.ecef : undefined;

  // Calculate the missing coordinate frame
  const decisionFlag = `${eciMissing}:${ecefMissing}`

  switch (decisionFlag) {

    // ECI is missing, ECEF is available
    case 'true:false':
      inferedVelocity.eci = ecfToEci(velocity.ecef!, gmst);
      break;

    // ECEF is missing, ECI is available
    case 'false:true':
      inferedVelocity.ecef = eciToEcf(velocity.eci!, gmst);
      break;

    // Both coordinate frames are missing
    case 'true:true':
      throw new Error('At least one set of ECI or ECEF velocity vectors must be defined to infer velocity.');
  }

  return inferedVelocity;
}

/**
 * Convert the geodetic coordinates of the position from radians to degrees.
 * @param position the position with geodetic coordinates defined in radians
 */
export function convertGeodeticToDegrees(position: Position): Position {
  return {
    eci: position.eci,
    ecef: position.ecef,
    geodetic: {
      latitude: degreesLat(position.geodetic!.latitude),
      longitude: degreesLong(position.geodetic!.longitude),
      height: position.geodetic!.height
    }
  }
}
