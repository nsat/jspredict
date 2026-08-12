import { EcfVec3, EciVec3, GeodeticLocation } from "satellite.js"
import { Radians, Degrees, Kilometers, KilometersPerSecond, Timestamp, Seconds } from "./types.ts"
import { AngularUnits, TimestampType } from "./enums.ts"

export interface UnitOptions {
  /** Set the unit type for angular measurements */
  angular?: AngularUnits

  /** Set the output type for timestamps */
  timestamp?: TimestampType
}

/** Position parameters */
export interface Position {
  /** Position in Earth-Centered Inertial (ECI) coordinates measured in kilometers */
  eci?: EciVec3<Kilometers>

  /** Position in Earth-Centered Earth-Fixed (ECEF) coordinates measured in kilometers */
  ecef?: EcfVec3<Kilometers>

  /** Position in Geodetic coordinats measured in radians and kilometers */
  geo?: GeodeticLocation
}

/** Velocity parameters */
export interface Velocity {
  /** Velocity vector in Earth-Centered Inertial (ECI) coordinates measured in kilometers per second */
  eci?: EciVec3<KilometersPerSecond>

  /** Velocity vector in Earth-Centered Earth-Fixed (ECEF) coordinates measured in kilometers per second */
  ecef?: EcfVec3<KilometersPerSecond>
}

/** Orbit parameters */
export interface Orbit {
  /** The number of revolutions the satellite has completed in its orbit */
  revolutionCount: number

  /**
   * The current position of the satellite in its orbit, measured from perigee as the mean
   * anomaly (plus small long-period/secular corrections), normalized to a full revolution.
   * Reported in radians or degrees depending on the requested angular units. This matches
   * the phase definition used by the original predict/pypredict libraries.
   */
  phase?: Radians | Degrees

  /**
   * The current position of the satellite in its orbit expressed on a legacy 0..256 scale,
   * where 0 is the start of the orbit and 256 is a full revolution. This matches the
   * `orbital_phase` value reported by the original predict/pypredict libraries.
   */
  phase256?: number
  
  /** Satellite velocity relative to the center of the Earth in kilometers per second */
  velocity?: KilometersPerSecond
}

/**
 * Satellite observation parameters
 */
export interface SatelliteObservation {
  /** Satellite international designator */
  id: string

  /** Satellite name */
  name: string

  /** NORAD Satellite Catalog Number */
  noradCatalogId: string | number

  /** Prediction UTC timestamp (ISO8601 format) */
  epoch?: Timestamp
  
  /** Prediction Greenwich Sidereal Time (GMST) */
  gmst?: Radians
  
  /** Satellite position coordinates at the specified epoch */
  position?: Position

  /** Satellite velocity vectors at the specified epoch */
  velocity?: Velocity
  
  /** The diameter of the satellite's ground coverage area (the visible circle on Earth's surface) in kilometers */
  footprint?: Kilometers
  
  /** Orbit revolution count */
  orbit?: Orbit;

  /** Specifies the orbital model used to predict the satellite's position and velocity */
  orbitalModel?: string

  /** Indicates if the satellite's orbit has decayed and re-entered Earth's atmosphere at the given time */
  decayed: boolean 

  /** Indicates if the satellite is geostationary relative to Earth's surface */
  geostationary?: boolean

  /** Indicates if the satellite is in eclipse */
  sunlit?: boolean
  
  /** Position of the sun */
  sunPosition?: Position
  
  /** 
   * The angle between the satellite's orbital plane and the vector pointing directly to the Sun, measured in degrees. 
   * Used to determine thermal exposure and eclipse duration.
   */
  betaAngle?: Degrees | Radians
  
  /**
   * The fraction of the Sun’s disc obscured by the Earth as seen from a satellite.
   * 0 = fully lit, 1 = umbra, values between 0 and 1 indicate the fraction of the Sun covered by Earth.
   */
  eclipseFactor?: number

  /** Satellite observer's position */
  observerPosition?: Position

  /** The compass heading to the satellite from the observer's ground location in degrees */
  azimuth?: Degrees | Radians

  /** The angle of the satellite above (or below) the observer's horizon in degrees. */
  elevation?: Degrees | Radians

  /** The direct line-of-sight distance from the observer to the satellite, measured in kilometers. */
  slantRange?: Kilometers

  /** Satellite frequency shift (i.e doppler factor) relative to observer. */
  dopplerFactor?: number

  /** Indicates if the satellite is optically visible at the observer's location */
  visibility?: string 

  /** Indicates if the satellite is above the observer's horizon */
  hasAos?: boolean
}

/**
 * Transit event parameters
 */
export interface TransitEvent {
  /** Date and time of the event as a ISO8601 timestamp */
  epoch: Timestamp

  /** Satellite compass direction, measured in Degrees or Radians */
  azimuth: Degrees | Radians

  /** Satellite elevation, measured in Degrees or Radians */
  elevation: Degrees | Radians 

  /** Straight line range of the satellite from the observer */
  slantRange: Kilometers
}

/**
 * Satellite transit parameters
 */
export interface SatelliteTransit {
  /** Transit UTC start time as an ISO8601 timestamp */
  start: Timestamp

  /** Transit UTC stop time as an ISO8601 timestamp */
  stop: Timestamp

  /** Duration of transit from start to stop time, measured in seconds (s) */
  duration: Seconds

  /** Acquisition of Signal (AOS) event parameters */
  aos: TransitEvent
  
  /** Loss of Signal (LOS) event parameters */
  los: TransitEvent

  /** Time of Closest Approach (TCA) event parameters */
  tca: TransitEvent

  /** Peak elevation event parameters */
  peak: TransitEvent
}