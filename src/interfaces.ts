import { PositionAndVelocity } from "satellite.js"

export interface SatelliteObservation {
  /** Satellite position and velocity in Earth-Centered Interial (ECI) coordinates at the given GMST */
  eci: PositionAndVelocity,

  /** Greenwich Sidereal Time (GMST) */
  gmst: number,

  /** Satellite latitudinal position in degress */
  latitude: number,

  /** Satellite longitudinal position in degrees */
  longitude: number,

  /** Satellite altitude in kilometers (km) */
  altitude: number,

  /** Satellite footprint radius in kilometers (km) */
  footprint: number,

  /** Indicates if the satellite is in eclipse */
  sunlit: boolean,

  /** Eclipse factor (1.0 full sunlight, 0.0 total darkness)*/
  eclipseDepth: number
}

export interface ObserverSatelliteObservation extends SatelliteObservation {
  
}