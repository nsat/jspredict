import { DateTime } from "luxon";
import { OMMJsonObjectV3 } from "satellite.js";

/** Kilometers */
export type Kilometers = number;

/** Kilometers per second */
export type KilometersPerSecond = number;

/** Radians */
export type Radians = number; 

/** Degrees */
export type Degrees = number;

/** Astonomical Unit (AU) */
export type AstronomialUnits = number;

/** Two Line Element */
export type TwoLineElement = string;

/** Orbit Mean-Elements Message */
export type OrbitMeanElementsMessage = OMMJsonObjectV3;

/** Alias for various timestamp types */
export type Timestamp = DateTime | Date | string | number

/** Seconds */
export type Seconds = number
