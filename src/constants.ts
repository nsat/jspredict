import { Kilometers, AstronomialUnits } from "./types";

/** Astronomical Unit - km (IAU 76) */
export const astronomicalUnit: AstronomialUnits = 1.49597870691E8;

/** Solar Radius - km (IAU 76) */
export const solarRadius: Kilometers = 6.96000E5;

/** Convert degrees to radians */
export const deg2rad: number = Math.PI / 180.0;

/** Convert radians to degress */
export const rad2deg: number = 180.0 / Math.PI

/** Number of milliseconds in a day */
export const day2ms: number = 1000 * 60 * 60 * 24; 

/**
 * Geostationary mean motion in radians per minute.
 * A geostationary satellite completes one revolution per sidereal day
 * (86164.0905 seconds), matching Earth's rotation.
 */
export const geostationaryMeanMotion: number = (2 * Math.PI) / (86164.0905 / 60);

/** Tolerances used to classify a satellite as geostationary. */
export const geostationaryTolerance = {
  /** Maximum fractional deviation of mean motion from the sidereal rate. */
  meanMotion: 0.01,

  /** Maximum orbital eccentricity (near-circular orbit). */
  eccentricity: 0.01,

  /** Maximum orbital inclination in radians (~1 degree). */
  inclination: 1.0 * (Math.PI / 180.0),
} as const;

/** World Geodetic System 1984 (WGS84) Parameters */
export const WGS84 = {
  /** Semi-Major Axis Raidus (km) */
  a: 6378.137,

  /** Semi-Minor Axis Radius (km) */
  b: 6356.7523142,

  /** Flattening factor */
  f: 0.0033528107,
  
  /** First eccentricity squared */
  e2: 0.00669437999014
} as const;
