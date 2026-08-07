import { EcfVec3, EciVec3 } from "satellite.js"
import { Radians, Degrees, Kilometers, KilometersPerHour, KilometersPerSecond } from "./types.ts"

/** Position parameters */
export interface Position {
  /** Position in Earth-Centered Inertial (ECI) coordinates measured in kilometers */
  eci?: EciVec3<Kilometers>

  /** Position in Earth-Centered Earth-Fixed (ECEF) coordinates measured in kilometers */
  ecef?: EcfVec3<Kilometers>

  /** Latitudinal position in degress */
  latitude?: Degrees

  /** Longitudinal position in degrees */
  longitude?: Degrees

  /** Position altitude in kilometers (km) */
  altitude?: Kilometers
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

  /** The current position of the satellite in its orbit relative to its perigee/ascending node, measured in degrees */
  phase?: Degrees
  
  /** Satellite velocity relative to the center of the Earth in kilometers per hour (kph) */
  velocity?: KilometersPerHour
}

/**
 * Satellite ground track parameters
 */
export interface SatelliteGroundTrack {
  /** Satellite international designator */
  id: string

  /** Satellite name */
  name: string

  /** NORAD Satellite Catalog Number */
  noradCatalogId: string | number

  /** Prediction UTC timestamp (ISO8601 format) */
  epoch: string | null
  
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
  betaAngle?: Degrees
  
  /**
   * The fraction of the Sun’s disc obscured by the Earth as seen from a satellite.
   * 0 = fully lit, 1 = umbra, values between 0 and 1 indicate the fraction of the Sun covered by Earth.
   */
  eclipseFactor?: number
}

/**
 * Satellite ground observation parameters
 * */
export interface SatelliteGroundTrackObservation extends SatelliteGroundTrack {
  /** Satellite observer's position */
  observerPosition: Position

  /** The compass heading to the satellite from the observer's ground location in degrees */
  azimuth: Degrees;

  /** The angle of the satellite above (or below) the observer's horizon in degrees. */
  elevation: Degrees;

  /** The direct line-of-sight distance from the observer to the satellite, measured in kilometers. */
  slantRange: Kilometers;

  /** Satellite frequency shift (i.e doppler factor) relative to observer. */
  dopplerFactor: number;

  /** Indicates if the satellite is optically visible at the observer's location */
  visibility: string 

  /** Indicates if the satellite is above the observer's horizon */
  hasAos: boolean
}
