/** Set the angular units for the inputs and outputs */
export enum AngularUnits {
  Degrees = 'DEGREES',
  Radians = 'RADIANS'
}

/** Set the time units for the inputs and outputs */
export enum TimestampFormat {
  Unix = 'UNIX',
  ISO8601 = 'ISO8601',
  Date = 'DATE',
  DateTime = 'DATETIME'
}

/** Satellite sun event types */
export enum SatelliteSunEventType {
  Sunlit = 'SUNLIT',
  Transition = 'TRANSITION',
  Eclipse = 'ECLIPSE'
}
