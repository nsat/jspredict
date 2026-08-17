import { DateTime } from "luxon";
import { Position, SatelliteObservation, TransitEvent, Velocity } from "./interfaces.ts";
import { WGS84, astronomicalUnit, day2ms, geostationaryMeanMotion, geostationaryTolerance, rad2deg } from "./constants.ts";
import type { Seconds, Timestamp } from "./types.ts";
import { TwoLineElement, OrbitMeanElementsMessage } from "./types.ts";
import { AngularUnits, TimestampFormat } from "./enums.ts";
import {
  ecfToLookAngles,
  gstime,
  jday,
  propagate,
  radiansToDegrees,
  SatRec,
  SatRecError,
  json2satrec,
  geodeticToEcf,
  ecfToEci,
  eciToEcf,
  eciToGeodetic,
  GeodeticLocation,
  radiansLat,
  radiansLong,
  degreesLat,
  degreesLong,
  MeanElements,
  shadowFraction,
  sunPos,
  Kilometer,
  KilometerPerSecond,
  EcfVec3,
  Radians,
} from "satellite.js";

// <--------------------------------------------------------------------------->
// UTILITY FUNCTIONS
// <--------------------------------------------------------------------------->

/**
 * Calculate the maginture of the vector
 * @param vector 
 * @returns number
 */
export function vectorMagnitude(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

/**
 * Convert a Julian date to a luxon DateTime object
 * @param julianDate the julian date number
 * @returns DateTime
 */
export function dateTimeFromJulianDate(julianDate: number): DateTime {
  // 2440587.5 is the Julian Date for 1970-01-01T00:00:00Z (Unix Epoch)
  const msSinceEpoch = (julianDate - 2440587.5) * 86400000;
  return DateTime.fromMillis(msSinceEpoch, { zone: 'utc' });
}

/**
 * Calculate the doppler factor between the observer and the satellite
 */
 // Calculate doppler factor using ECEF coordinates
 export function dopplerFactorEcf(
   observerCoordsEcf: EcfVec3<Kilometer>,
   positionEcf: EcfVec3<Kilometer>,
   velocityEcf: EcfVec3<KilometerPerSecond>,
 ): number {
   const c = 299792.458; // Speed of light in km/s
   
   // 1. Calculate the line-of-sight range vector from observer to satellite
   const rangeX = positionEcf.x - observerCoordsEcf.x;
   const rangeY = positionEcf.y - observerCoordsEcf.y;
   const rangeZ = positionEcf.z - observerCoordsEcf.z;
   
   // 2. Calculate slant range distance
   const length = Math.sqrt(rangeX ** 2 + rangeY ** 2 + rangeZ ** 2);
 
   // Avoid division by zero if observer and satellite positions are identical
   if (length === 0) return 1;
 
   // 3. Range rate is the dot product of the range vector and relative ECEF velocity vector
   // (Since observer velocity is 0 in ECEF, rangeVel is exactly velocityEcf)
   const rangeRate =
     (rangeX * velocityEcf.x + rangeY * velocityEcf.y + rangeZ * velocityEcf.z) / length;
 
   // 4. Return Doppler multiplier factor
   return 1 - rangeRate / c;
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
export function localEarthRadius(latitude: Radians): Kilometer {
  const re = WGS84.a / Math.sqrt((1 - WGS84.e2 * Math.pow(Math.sin(latitude), 2)));
  return re;
}

/**
 * Calculate the Earth central angle for a given radius and altitude.
 * @param re earth radius
 * @param altitude satellite altitude (kilometers)
 * @param minElevationAngle minimum elevation angle (radians)
 */
export function earthCentralAngle(re: Kilometer, altitude: Kilometer, minElevationAngle: Radians = 0.0): Radians {
  const lambda = Math.acos((re / (re + altitude)) * Math.cos(minElevationAngle)) - minElevationAngle
  return lambda
}

/**
 * Calculate the satellite's footprint radius.
 * @param lattitude sub-satellite point (SSP) latitude in radians
 * @param altitude satellite altitude (kilometers)
 * @param minElevationAngle minimum elevation angle (radians)
 */
 export function footprintDiameter(satPosition: Position, minElevationAngle: Radians = 0.0): Kilometer {
   const re = localEarthRadius(satPosition.geo!.latitude);
   const lambda = earthCentralAngle(re, satPosition.geo!.height, minElevationAngle)
   const footprint = re * lambda * 2
   return footprint
 }

 /**
  * Convert the timestamp to a luxon.DateTime object.
  */
export function parseTimestamp(timestamp: Timestamp): DateTime {
  // 1. Check if object is already a luxon.DateTime.
  // Use DateTime.isDateTime instead of `instanceof` so a DateTime created by a
  // different copy of the luxon module (e.g. the caller's own install) is still
  // recognized, since `instanceof` fails across module boundaries.
  if (DateTime.isDateTime(timestamp)) {
    return timestamp
  }
  
  // 2. Check for native Date object
  if (timestamp instanceof Date) {
    return DateTime.fromJSDate(timestamp);
  }

  // 3. Check for number (timestamp)
  if (typeof timestamp === 'number') {
    return DateTime.fromMillis(timestamp, { zone: "UTC"});
  }

  // 4. Fallback to string (ISO or standard format)
  if (typeof timestamp === 'string') {
    const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)

    // Assume UTC only when the string does not already include timezone data.
    return hasExplicitTimezone
      ? DateTime.fromISO(timestamp, { setZone: true })
      : DateTime.fromISO(timestamp, { zone: "UTC"})
  }
  
  throw new Error('Unsupported datetime type');
}

/**
 * Calculates the Greenwich Mean Sidereal Time (GMST) from a luxon.DateTime object measured in radians
 */
export function greenwichMeanSiderealTime(datetime: DateTime): Radians {
  return gstime(datetime.toJSDate())
}

/**
 * Predict the completed orbit revolution count at a given observation time.
 */
export function predictedRevolutionCount(
  orbitMeanElementsMessage: OrbitMeanElementsMessage,
  observationTime: DateTime,
): number {
  const elementEpoch = parseTimestamp(orbitMeanElementsMessage.EPOCH)

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
  const geodeticMissing = (!position.geo);

  // Convert the geodetic coordinates to radians if necessary
  let geodetic: GeodeticLocation | undefined;
 
  if (!geodeticMissing && angularUnits === AngularUnits.Degrees) {
    geodetic = {
      latitude: radiansLat(position.geo!.latitude),
      longitude: radiansLong(position.geo!.longitude),
      height: position.geo!.height
    }
  } else if (!geodeticMissing && angularUnits == AngularUnits.Radians) {
    geodetic = position.geo
  }
  
  // Populate available coordinates 
  inferedPosition.eci = !eciMissing ? position.eci : undefined;
  inferedPosition.ecef = !ecefMissing ? position.ecef : undefined;
  inferedPosition.geo = !geodeticMissing ? geodetic : undefined;

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
      inferedPosition.geo = eciToGeodetic(inferedPosition.eci, gmst)
      break;
      
    // ECEF is missing, ECI and Geodetic are available
    case 'false:true:false':
      inferedPosition.ecef = eciToEcf(position.eci!, gmst);
      break;

    // ECEF and Geodetic are missing, ECI is available
    case 'false:true:true':
      inferedPosition.ecef = eciToEcf(position.eci!, gmst)
      inferedPosition.geo = eciToGeodetic(position.eci!, gmst)
      break;
    
    // Geodetic is missing, ECI and ECEF are available
    case 'false:false:true':
      inferedPosition.geo = eciToGeodetic(position.eci!, gmst)
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
    geo: {
      latitude: degreesLat(position.geo!.latitude),
      longitude: degreesLong(position.geo!.longitude),
      height: position.geo!.height
    }
  }
}

/**
 * Convert a luxon DateTime object to the format specified by the timestamp type
 */
export function formatTimestamp(datetime: DateTime, timestampFormat: TimestampFormat): Timestamp {
  switch (timestampFormat) {
    /** Return the luxon DateTime object unmodified */
    case TimestampFormat.DateTime:
      return datetime;

    /** Return standard Javascript Date object */
    case TimestampFormat.Date:
      return datetime.toJSDate()

    /** Return ISO8601 formatted timestamp string */
    case TimestampFormat.ISO8601:
      return datetime.toISO()!

    /** Return the number of milliseconds since Unix epoch */
    case TimestampFormat.Unix:
      return datetime.toMillis()
  }
}

export function computeSatelliteObservation(
  omm: OrbitMeanElementsMessage,
  satrec: SatRec,
  datetime: DateTime,
  observerPosition?: Position,
  angularUnits: AngularUnits = AngularUnits.Degrees,
  timestampFormat: TimestampFormat = TimestampFormat.ISO8601
): SatelliteObservation {
  // Returns the satellite position and velocity in ECI coordinations
  const satPropagation = propagate(satrec, datetime.toJSDate())

  // Check for errors
  if (satPropagation === null) {
    switch (satrec.error) {
      case SatRecError.MeanEccentricityOutOfRange:
        throw new Error('Orbit eccentricity is out of range for SGP4 propagation model')

      case SatRecError.MeanMotionBelowZero:
        throw new Error('Orbit mean motion is below zero')

      case SatRecError.PerturbedEccentricityOutOfRange:
        throw new Error('Predicted orbit eccentricity is out of range for SGP4 propagation model')

      case SatRecError.SemiLatusRectumBelowZero:
        throw new Error('Predicted orbit has mathematically collapsed')

      case SatRecError.Decayed:
        return {
          id: omm.OBJECT_ID,
          name: omm.OBJECT_NAME,
          noradCatalogId: omm.NORAD_CAT_ID as string,
          orbitalModel: omm.MEAN_ELEMENT_THEORY,
          epoch: formatTimestamp(datetime, timestampFormat),
          decayed: true,
        }
    }

    throw new Error('Satellite propagation failed')
  }

  const gmst = greenwichMeanSiderealTime(datetime)

  // Calculate the satellite's position and velocity in other coordinate frames
  const satPosition = inferPosition({ eci: satPropagation.position }, gmst, angularUnits)
  const satVelocity = inferVelocity({ eci: satPropagation.velocity }, gmst)

  // Calculate the sun's position in kilometers
  const sunEciAU = sunPos(jday(datetime.toJSDate())).rsun
  const sunEci = {
    x: sunEciAU.x * astronomicalUnit,
    y: sunEciAU.y * astronomicalUnit,
    z: sunEciAU.z * astronomicalUnit,
  }
  const sunPosition = inferPosition({ eci: sunEci }, gmst, angularUnits)

  // Calculate the eclipse factor
  const eclipseFactor = shadowFraction(sunEciAU, satPosition.eci!)

  // Calculate the beta angle (radians) between the orbital plane and the Sun
  const betaAngleRadians = betaAngle(satPropagation.meanElements, sunEci)

  // Calculate the satellite's footprint diameter, assume a minimum elevation angle of 0 degrees
  const footprint = footprintDiameter(satPosition, 0)

  // Calculate the orbital phase from the mean anomaly, normalized to [0, 2*PI). This matches
  // the phase definition used by the original predict/pypredict libraries, where phase is
  // computed as (xlt - xnode - omgadf) which reduces to the mean anomaly plus small
  // long-period/secular corrections, measured from perigee.
  const twoPi = 2 * Math.PI
  const phaseRadians = ((satPropagation.meanElements.mm % twoPi) + twoPi) % twoPi

  const observation: SatelliteObservation = {
    id: omm.OBJECT_ID,
    name: omm.OBJECT_NAME,
    noradCatalogId: omm.NORAD_CAT_ID as string,
    orbitalModel: omm.MEAN_ELEMENT_THEORY,
    epoch: formatTimestamp(datetime, timestampFormat),
    gmst,
    position: angularUnits === AngularUnits.Degrees ? convertGeodeticToDegrees(satPosition) : satPosition,
    velocity: satVelocity,
    footprint,
    orbit: {
      revolutionCount: predictedRevolutionCount(omm, datetime),
      phase: angularUnits === AngularUnits.Degrees ? phaseRadians * rad2deg : phaseRadians,
      phase256: phaseRadians * (256 / twoPi),
      velocity: vectorMagnitude(satVelocity.eci!),
    },
    decayed: false,
    geostationary: isGeostationary(satPropagation.meanElements),
    sunlit: eclipseFactor < 1,
    sunPosition: angularUnits === AngularUnits.Degrees ? convertGeodeticToDegrees(sunPosition) : sunPosition,
    betaAngle: angularUnits === AngularUnits.Degrees ? betaAngleRadians * rad2deg : betaAngleRadians,
    eclipseFactor,
  }

  if (!observerPosition) {
    return observation
  }

  // If we have an observer, calculate the look angles of the satellite
  const observerInferedPosition = inferPosition(observerPosition, gmst, angularUnits)
  const observerLookAngles = ecfToLookAngles(observerInferedPosition.geo!, satPosition.ecef!)

  return {
    ...observation,
    observerPosition: angularUnits === AngularUnits.Degrees
      ? convertGeodeticToDegrees(observerInferedPosition)
      : observerInferedPosition,
    azimuth: angularUnits === AngularUnits.Degrees
      ? radiansToDegrees(observerLookAngles.azimuth)
      : observerLookAngles.azimuth,
    elevation: angularUnits === AngularUnits.Degrees
      ? radiansToDegrees(observerLookAngles.elevation)
      : observerLookAngles.elevation,
    slantRange: observerLookAngles.rangeSat,
    dopplerFactor: dopplerFactorEcf(observerInferedPosition.ecef!, satPosition.ecef!, satVelocity.ecef!),
  }
}

/**
 * Build and return a satellite transit event 
 * @param epoch 
 * @param elevation 
 * @param azimuch 
 */
export function buildTransitEvent(
  observation: SatelliteObservation
): TransitEvent {
  return {
    epoch: observation.epoch!,
    elevation: observation.elevation!,
    azimuth: observation.azimuth!,
    slantRange: observation.slantRange!,
    dopplerFactor: observation.dopplerFactor!
  }
}

// <--------------------------------------------------------------------------->
// TRANSIT SEARCH HELPERS
//
// The transit search follows the same two-phase strategy used by Python's
// Skyfield library:
//   1. A *coarse* search samples the satellite's look angles at a fixed step
//      over each orbit to bracket candidate events (rise/set zero-crossings of
//      elevation, and elevation maxima found via the sign of the elevation
//      rate).
//   2. A *fine* refinement uses the secant method to converge on the exact
//      event time within a configurable tolerance and iteration budget.
// <--------------------------------------------------------------------------->

/**
 * Derive the coarse-search step size (in seconds) from the satellite's mean
 * motion, mirroring Skyfield's `find_events` heuristic.
 *
 * Skyfield samples roughly 20 times per orbital revolution
 * (`step_days = 0.05 / orbits_per_day`), which keeps the step well under a
 * single pass so every culmination is bracketed by adjacent samples, while
 * scaling naturally across orbit regimes (faster LEO -> finer step, slower
 * orbits -> coarser step). The step is capped at a quarter day so very slow
 * (near-geostationary) satellites — which rise and set because the Earth
 * rotates beneath them rather than from their own motion — are still sampled
 * often enough to catch each pass.
 *
 * @param meanMotionRevsPerDay the satellite's mean motion in revolutions per day
 * @returns the coarse-search step size in seconds
 */
export function dynamicStepSeconds(meanMotionRevsPerDay: number): Seconds {
  const secondsPerDay = 86400

  // Guard against zero/negative/NaN mean motion so the step never blows up.
  const orbitsPerDay = meanMotionRevsPerDay > 0 ? meanMotionRevsPerDay : 1.0

  // ~20 samples per revolution (0.05 of an orbit per sample).
  let stepDays = 0.05 / orbitsPerDay

  // Never step more coarsely than a quarter day, even for slow movers.
  if (stepDays > 0.25) {
    stepDays = 0.25
  }

  return stepDays * secondsPerDay
}

/**
 * Compute the satellite's elevation angle (radians) above the observer's local
 * horizon at a given instant.
 *
 * This is the fundamental scalar function that the coarse search and the secant
 * refinement both evaluate. It propagates the satellite with SGP4, converts the
 * ECI position to the Earth-fixed frame using the sidereal time at that
 * instant, and returns the topocentric elevation angle relative to the
 * observer's geodetic position (which is expressed in radians).
 *
 * The instant is passed as milliseconds since the Unix epoch so the transit
 * search can perform all of its arithmetic in a single linear numeric unit
 * without constructing intermediate luxon `DateTime` objects.
 *
 * @param satrec the initialized SGP4 record for the satellite
 * @param observerGeodeticRadians the observer's geodetic location in radians
 * @param epochMs the instant at which to evaluate the elevation, in epoch ms
 * @returns the elevation angle in radians (negative when below the horizon)
 */
export function elevationAt(
  satrec: SatRec,
  observerGeodeticRadians: GeodeticLocation,
  epochMs: number,
): Radians {
  const date = new Date(epochMs)
  const propagation = propagate(satrec, date)

  // If SGP4 cannot produce a position (e.g. the orbit has decayed) treat the
  // satellite as being infinitely far below the horizon so it never registers
  // as a pass.
  if (propagation === null) {
    return Number.NEGATIVE_INFINITY
  }

  const gmst = gstime(date)
  const positionEcf = eciToEcf(propagation.position, gmst)
  const lookAngles = ecfToLookAngles(observerGeodeticRadians, positionEcf)

  return lookAngles.elevation
}

/**
 * Compute the elevation angle *relative to a reference elevation*, i.e.
 * `elevation(t) - referenceElevation`. This shifted function crosses zero
 * exactly when the satellite passes through the reference elevation, which lets
 * the same secant root-finder locate both horizon (0 rad) crossings and
 * minimum-elevation (AOS/LOS) crossings.
 *
 * @param satrec the initialized SGP4 record for the satellite
 * @param observerGeodeticRadians the observer's geodetic location in radians
 * @param epochMs the instant at which to evaluate the elevation, in epoch ms
 * @param referenceElevation the elevation offset to subtract, in radians
 * @returns elevation(epochMs) - referenceElevation, in radians
 */
export function elevationRelativeTo(
  satrec: SatRec,
  observerGeodeticRadians: GeodeticLocation,
  epochMs: number,
  referenceElevation: Radians,
): Radians {
  return elevationAt(satrec, observerGeodeticRadians, epochMs) - referenceElevation
}

/**
 * Refine the time at which a scalar function of time crosses zero, using a
 * bracketed secant method (secant steps with a bisection fallback).
 *
 * The plain secant method draws a line through the two most recent samples and
 * takes its x-intercept as the next estimate:
 *
 *   t_{n+1} = t_n - f(t_n) * (t_n - t_{n-1}) / (f(t_n) - f(t_{n-1}))
 *
 * That extrapolating step can, however, jump far outside the starting interval
 * when the function is not locally linear — landing on a completely different
 * root (e.g. the rise/set of a neighbouring pass). To stay robust, this routine
 * maintains a bracket `[lo, hi]` whose endpoints straddle the crossing
 * (`f(lo)` and `f(hi)` have opposite signs) and only accepts a secant iterate
 * that falls strictly inside the bracket; otherwise it falls back to the
 * bracket midpoint (bisection). The bracket is then tightened using the sign of
 * the new sample, so the search can never escape the interval `[aMs, bMs]`.
 *
 * `f` is the target quantity offset from its crossing value — for example
 * `elevation(t) - referenceElevation` for a rise/set/horizon event — so the
 * root is exactly the crossing time. All times are milliseconds since the Unix
 * epoch, so the arithmetic stays in a single linear unit and no intermediate
 * `DateTime` objects are constructed.
 *
 * The endpoints `aMs` and `bMs` MUST straddle the crossing (their `f` values
 * must have opposite signs); this is guaranteed at every call site because each
 * bracket pairs a coarse sample below the threshold with the pass peak above it.
 *
 * Convergence is judged on the *value* of `f`: iteration stops once
 * `|f(t)| <= valueTolerance`, meaning the quantity is within `valueTolerance`
 * of its crossing value (e.g. within 1e-3 radians of the elevation crossing).
 * If `maxIterations` is exhausted the best estimate found so far is returned.
 *
 * @param f the scalar function whose zero we are seeking, evaluated at epoch ms
 * @param aMs one bracketing time, in epoch milliseconds
 * @param bMs the other bracketing time, in epoch milliseconds
 * @param valueTolerance convergence tolerance on `|f(t)|`, in the units of `f`
 * @param maxIterations maximum number of secant iterations before giving up
 * @returns the refined crossing time, in epoch milliseconds
 */
export function secantMethod(
  f: (epochMs: number) => number,
  aMs: number,
  bMs: number,
  valueTolerance: number,
  maxIterations: number,
): number {
  // Bracket endpoints and their function values. `lo`/`hi` are ordered in time
  // but, more importantly, f(lo) and f(hi) must have opposite signs.
  let lo = aMs
  let hi = bMs
  let fLo = f(lo)
  let fHi = f(hi)

  // Either endpoint may already be within tolerance of the crossing.
  if (Math.abs(fLo) <= valueTolerance) {
    return lo
  }
  if (Math.abs(fHi) <= valueTolerance) {
    return hi
  }

  // Track the two most recent samples for the secant step.
  let t0 = lo
  let t1 = hi
  let f0 = fLo
  let f1 = fHi

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const denominator = f1 - f0

    // Secant update, unless the line is flat (denominator 0), in which case the
    // step is undefined and we fall straight through to the bisection fallback.
    let t2 = denominator === 0 ? NaN : t1 - f1 * (t1 - t0) / denominator

    // Reject secant iterates that leave the bracket (or are non-finite) and
    // fall back to bisection, which is guaranteed to stay inside and converge.
    const lower = Math.min(lo, hi)
    const upper = Math.max(lo, hi)
    if (!Number.isFinite(t2) || t2 <= lower || t2 >= upper) {
      t2 = (lo + hi) / 2
    }

    const f2 = f(t2)

    // Converged once the target quantity is within tolerance of its crossing.
    if (Math.abs(f2) <= valueTolerance) {
      return t2
    }

    // Tighten the bracket: replace the endpoint on the same side of the root as
    // the new sample, preserving the opposite-sign invariant.
    if ((f2 < 0) === (fLo < 0)) {
      lo = t2
      fLo = f2
    } else {
      hi = t2
      fHi = f2
    }

    // Advance the secant window to the two newest in-bracket samples.
    t0 = t1
    f0 = f1
    t1 = t2
    f1 = f2
  }

  // Did not converge within the iteration budget; return the latest estimate.
  return t1
}

/**
 * Refine the time at which a scalar function of time reaches a local extremum
 * (maximum or minimum) using a bracketed secant method on the function's *rate*.
 *
 * An extremum occurs where the derivative `f'(t) = 0`, so the secant method is
 * applied to a finite-difference estimate of the rate to drive it toward zero.
 * As with {@link secantMethod}, a plain secant step can extrapolate outside the
 * starting interval and converge on a different extremum; to prevent that, this
 * routine keeps a bracket `[lo, hi]` whose rate values straddle zero and rejects
 * any secant iterate that leaves the bracket, falling back to bisection. The
 * bracket is tightened by the sign of each new rate sample so the search stays
 * within `[aMs, bMs]`.
 *
 * The endpoints `aMs` and `bMs` MUST straddle the extremum (their rate values
 * must have opposite signs); every call site guarantees this by locating the
 * coarse interval where the rate flips sign before refining.
 *
 * Convergence is judged on the rate itself: iteration stops once
 * `|rate(t)| <= rateTolerance`, meaning the derivative is within `rateTolerance`
 * of zero (e.g. the elevation rate is within a small rad/s of the peak, or the
 * range rate is within a small km/s of the closest approach). If
 * `maxIterations` is exhausted the best estimate found so far is returned.
 *
 * Times are milliseconds since the Unix epoch, while the `rate` callback is
 * expected to return the derivative in per-second units.
 *
 * @param rate a finite-difference estimate of d(value)/dt, evaluated at epoch ms
 * @param aMs one bracketing time, in epoch milliseconds
 * @param bMs the other bracketing time, in epoch milliseconds
 * @param rateTolerance convergence tolerance on `|rate(t)|`, in the units of `rate`
 * @param maxIterations maximum number of secant iterations before giving up
 * @returns the refined extremum time, in epoch milliseconds
 */
export function secantExtremum(
  rate: (epochMs: number) => number,
  aMs: number,
  bMs: number,
  rateTolerance: number,
  maxIterations: number,
): number {
  // Bracket endpoints whose rate values straddle zero (opposite signs).
  let lo = aMs
  let hi = bMs
  let rLo = rate(lo)
  let rHi = rate(hi)

  // Either endpoint may already be within tolerance of the extremum.
  if (Math.abs(rLo) <= rateTolerance) {
    return lo
  }
  if (Math.abs(rHi) <= rateTolerance) {
    return hi
  }

  // Track the two most recent samples for the secant step.
  let t0 = lo
  let t1 = hi
  let r0 = rLo
  let r1 = rHi

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const denominator = r1 - r0

    // Secant update on the rate, unless the line is flat (undefined step).
    let t2 = denominator === 0 ? NaN : t1 - r1 * (t1 - t0) / denominator

    // Reject iterates that leave the bracket (or are non-finite); bisect instead.
    const lower = Math.min(lo, hi)
    const upper = Math.max(lo, hi)
    if (!Number.isFinite(t2) || t2 <= lower || t2 >= upper) {
      t2 = (lo + hi) / 2
    }

    const r2 = rate(t2)

    // Converged once the rate of change is within tolerance of zero.
    if (Math.abs(r2) <= rateTolerance) {
      return t2
    }

    // Tighten the bracket, preserving the opposite-sign invariant on the rate.
    if ((r2 < 0) === (rLo < 0)) {
      lo = t2
      rLo = r2
    } else {
      hi = t2
      rHi = r2
    }

    // Advance the secant window.
    t0 = t1
    r0 = r1
    t1 = t2
    r1 = r2
  }

  // Did not converge within the iteration budget; return the latest estimate.
  return t1
}

/**
 * Locate the horizon (0-radian elevation) crossing for a single pass by
 * marching outward from a known event time (AOS or LOS) until the elevation
 * drops below the horizon, then refining the crossing with the secant method.
 *
 * At AOS/LOS the elevation equals the (non-negative) minimum elevation, so
 * marching *away* from the pass the elevation decreases monotonically toward and
 * then below 0 rad. Once a below-horizon sample is found it is paired with the
 * pass's peak time (which is guaranteed above the horizon) to form a bracket
 * that straddles exactly one crossing — the one belonging to this pass — before
 * the secant method refines it. When the minimum elevation is 0 the crossing
 * coincides with the anchor to within tolerance.
 *
 * The march is bounded by the search window; if the horizon is never crossed
 * inside the window the anchor time is returned as a safe fallback.
 *
 * @param satrec initialized SGP4 record
 * @param observerGeodeticRadians observer geodetic position in radians
 * @param anchorMs the AOS or LOS time to march away from, in epoch milliseconds
 * @param peakMs the pass's culmination time (always above the horizon), in epoch ms
 * @param stepMs signed march increment in milliseconds (negative marches backward)
 * @param startMs lower bound of the search window in epoch milliseconds
 * @param stopMs upper bound of the search window in epoch milliseconds
 * @param elevationToleranceRadians secant convergence tolerance in radians
 * @param maxIterations secant iteration limit
 * @returns the refined horizon-crossing time, in epoch milliseconds
 */
export function findHorizonCrossing(
  satrec: SatRec,
  observerGeodeticRadians: GeodeticLocation,
  anchorMs: number,
  peakMs: number,
  stepMs: number,
  startMs: number,
  stopMs: number,
  elevationToleranceRadians: number,
  maxIterations: number,
): number {
  let outerMs = anchorMs

  // March outward until the elevation is below the horizon.
  while (true) {
    const elevationOuter = elevationAt(satrec, observerGeodeticRadians, outerMs)
    if (elevationOuter < 0) {
      // Bracket the crossing between the peak (above horizon) and this
      // below-horizon point, then refine.
      return secantMethod(
        (ms) => elevationRelativeTo(satrec, observerGeodeticRadians, ms, 0),
        peakMs,
        outerMs,
        elevationToleranceRadians,
        maxIterations,
      )
    }

    const nextMs = outerMs + stepMs

    // Stop marching at the window edge; return the anchor as a safe fallback.
    if (nextMs < startMs || nextMs > stopMs) {
      return anchorMs
    }

    outerMs = nextMs
  }
}
