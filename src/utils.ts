import type { radians, km } from "./common.ts";
import { WGS84 } from "./common.ts";

// <--------------------------------------------------------------------------->
// UTILITY FUNCTIONS
// <--------------------------------------------------------------------------->

/**
 * Calculate the radius of Earth's curvature at a given latitude 
 * based on a WGS84 ellipsoid.
 * @param latitude sub-satellite point (SSP) latitude in radians.
 */
export function localEarthRadius(latitude: radians): km {
  const re = WGS84.a / Math.sqrt((1 - WGS84.e2 * Math.pow(Math.sin(latitude), 2)));
  return re;
}

/**
 * Calculate the Earth central angle for a given radius and altitude.
 * @param re earth radius
 * @param altitude satellite altitude (kilometers)
 * @param epsilon minimum elevation angle (radians)
 */
export function earthCentralAngle(re: km, altitude: km, epsilon: radians = 0.0): radians {
  const lambda = Math.acos((re / (re + altitude)) * Math.cos(epsilon)) - epsilon
  return lambda
}

/**
 * Calculate the satellite's footprint radius.
 * @param lattitude sub-satellite point (SSP) latitude in radians
 * @param altitude satellite altitude (kilometers)
 * @param epsilon minimum elevation angle (radians)
 */
 export function footprintRadius(latitude: radians, altitude: km, epsilon: radians = 0.0): km {
   const re = localEarthRadius(latitude);
   const lambda = earthCentralAngle(re, altitude, epsilon)
   const footprint = re * lambda
   return footprint
 }