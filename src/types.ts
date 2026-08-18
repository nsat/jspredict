import { DateTime } from "luxon";
import { OMMJsonObjectV3 } from "satellite.js";

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

/** Milliseconds */
export type Milliseconds = number
