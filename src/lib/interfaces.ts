import { EcfVec3, EciVec3, GeodeticLocation, Radians, Degrees, Kilometer, KilometerPerSecond } from "satellite.js"
import { Timestamp, Seconds } from "./types.ts"
import { AngularUnits, SatelliteSunEventType, TimestampFormat } from "./enums.ts"

// <--------------------------------------------------------------------------->
// INPUT/OUTPUT
// <--------------------------------------------------------------------------->

/** Position parameters */
export interface Position {
  /** Position in Earth-Centered Inertial (ECI) coordinates measured in kilometers */
  eci?: EciVec3<Kilometer>

  /** Position in Earth-Centered Earth-Fixed (ECEF) coordinates measured in kilometers */
  ecef?: EcfVec3<Kilometer>

  /** Position in Geodetic coordinats measured in radians and kilometers */
  geo?: GeodeticLocation
}

/** Velocity parameters */
export interface Velocity {
  /** Velocity vector in Earth-Centered Inertial (ECI) coordinates measured in kilometers per second */
  eci?: EciVec3<KilometerPerSecond>

  /** Velocity vector in Earth-Centered Earth-Fixed (ECEF) coordinates measured in kilometers per second */
  ecef?: EcfVec3<KilometerPerSecond>
}

/** Orbit parameters */
export interface Orbit {
  /** The number of revolutions the satellite has completed in its orbit */
  revolutionCount: number

  /**
   * The current position of the satellite in its orbit, measured from perigee as the mean
   * anomaly (plus small long-period/secular corrections), normalized to a full revolution 
   * reported in degrees or radians depending on selected angular units.
   */
  phase?: Degrees | Radians

  /**
   * The current position of the satellite in its orbit expressed on a legacy 0..256 scale,
   * where 0 is the start of the orbit and 256 is a full revolution. This matches the
   * `orbital_phase` value reported by the original predict/pypredict libraries.
   */
  phase256?: number
  
  /** Satellite velocity relative to the center of the Earth in kilometers per hour */
  velocity?: KilometerPerSecond
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
  footprint?: Kilometer
  
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
  slantRange?: Kilometer

  /** Satellite frequency shift (i.e doppler factor) relative to observer. */
  dopplerFactor?: number
}

/**
 * Transit event parameters
 */
export interface TransitEvent {
  /** Date and time of the event as a ISO8601 timestamp */
  epoch: Timestamp

  /** Satellite position coordinates at the specified epoch */
  position: Position

  /** Satellite velocity vectors at the specified epoch */
  velocity: Velocity
  
  /** Satellite compass direction, measured in Degrees or Radians */
  azimuth: Degrees | Radians

  /** Satellite elevation, measured in Degrees or Radians */
  elevation: Degrees | Radians 

  /** Straight line range of the satellite from the observer */
  slantRange: Kilometer

  /** Satellite frequency shift (i.e doppler factor) relative to observer. */
  dopplerFactor: number

  /** Indicates if the satellite is in eclipse */
  sunlit: boolean
  
  /**
   * The fraction of the Sun’s disc obscured by the Earth as seen from a satellite.
   * 0 = fully lit, 1 = umbra, values between 0 and 1 indicate the fraction of the Sun covered by Earth.
   */
  eclipseFactor: number
}

/**
 * Satellite transit parameters
 */
export interface SatelliteTransit {
  /** Transit start timestamp */
  start: Timestamp

  /** Transit stop timestamp */
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

/**
 * Satellite sun events
 */
export interface SatelliteSunEvent {
  /** Specifies the type of sun event */
  eventType: SatelliteSunEventType

  /** Transit UTC start time as an ISO8601 timestamp */
  start: Timestamp

  /** Transit UTC stop time as an ISO8601 timestamp */
  stop: Timestamp

  /** Duration of transit from start to stop time, measured in seconds (s) */
  duration: Seconds
}

// <--------------------------------------------------------------------------->
// CONFIGURATION
// <--------------------------------------------------------------------------->

export interface SatelliteObservationOptions {
  /**
   * Configures the angular units for azimuth angles, options are Degrees or 
   * Radians.
   */
  azimuthAngularUnits?: AngularUnits

  /**
   * Configures the angular units for elevation angles, options are Degrees or 
   * Radians.
   */
  elevationAngularUnits?: AngularUnits

  /**
   * Configures the angular units geodetic coordinates are defined in, either
   * Degress or Radians.
   */
  geodeticAngularUnits?: AngularUnits

  /**
   * Confgures the output format of timestamp fields, options are Unix, ISO8601,
   * Date, or DateTime objects.
   */
  timestampFormat?: TimestampFormat

  /**
   * Sets the angular units for the beta angle output.
   */
  betaAngleAngularUnits?: AngularUnits

  /**
   * Sets the angular units for the orbit phase outuput.
   */
  orbitPhaseAngularUnits?: AngularUnits
}

export interface SatelliteTransitOptions {
  /**
   * Configures the angular units for azimuth angles, options are Degrees or 
   * Radians.
   */
  azimuthAngularUnits?: AngularUnits

  /**
   * Configures the angular units for elevation angles, options are Degrees or 
   * Radians.
   */
  elevationAngularUnits?: AngularUnits

  /**
   * Configures the angular units geodetic coordinates are defined in, either
   * Degress or Radians.
   */
  geodeticAngularUnits?: AngularUnits

  /**
   * Confgures the output format of timestamp fields, options are Unix, ISO8601,
   * Date, or DateTime objects.
   */
  timestampFormat?: TimestampFormat

  /**
   * Angular convergence tolerance in radians for the AOS, LOS, and horizon
   * crossing events. The refinement stops once the satellite's elevation is
   * within this many radians of the target crossing.
   */
  elevationToleranceRadians?: Radians

  /**
   * Rate convergence tolerance in radians per second for the peak (culmination)
   * event. The refinement stops once the elevation rate is within this many
   * radians per second of zero.
   */
  elevationRateTolerance?: number

  /**
   * Rate convergence tolerance in kilometers per second for the time of closest
   * approach (TCA). The refinement stops once the slant-range rate is within
   * this many kilometers per second of zero.
   */
  slantRangeRateTolerance?: number

  /**
   * Maximum number of secant iterations allowed per event before the search
   * gives up on converging and falls back to the best estimate found so far.
   */
  maxIterations?: number

  /**
   * Optional override for the coarse-search step size, expressed in seconds.
   * When omitted, the step size is derived dynamically from the satellite's
   * mean motion (mirroring Skyfield), which yields roughly 20 samples per
   * orbital revolution.
   */
  coarseStepSeconds?: Seconds
}

export interface SatelliteSunEventOptions {
  /**
   * Angular convergence tolerance in radians for the eclipse-boundary crossings
   * (sunlit <-> transition and transition <-> eclipse). The Brent refinement
   * stops once the angular-separation offset is within this many radians of the
   * boundary.
   */
  angularToleranceRadians?: Radians

  /**
   * Confgures the output format of timestamp fields, options are Unix, ISO8601,
   * Date, or DateTime objects.
   */
  timestampFormat?: TimestampFormat

  /**
   * Maximum number of Brent iterations allowed per event before the search
   * gives up on converging and falls back to the best estimate found so far.
   */
  maxIterations?: number

  /**
   * Optional override for the coarse-search step size, expressed in seconds.
   * When omitted, the step size is derived dynamically from the satellite's
   * mean motion (mirroring Skyfield), which yields roughly 20 samples per
   * orbital revolution.
   */
  coarseStepSeconds?: Seconds
}
