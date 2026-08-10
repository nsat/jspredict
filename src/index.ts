// jspredict v2.0.0
// https://github.com/nsat/jspredict

// Copyright (c) 2026, Spire Global Inc
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Spire Global Inc nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// Spire Global Inc BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
// USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
// OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
// SUCH DAMAGE.

import { SatelliteObservation, Position } from "./interfaces";
import { astronomicalUnit, deg2rad, rad2deg } from "./constants";
import { TwoLineElement, DateTimeTypes, OrbitMeanElementsMessage, Degrees, Radians } from "./types";
import {
  footprintDiameter,
  greenwichMeanSiderealTime,
  parseDateTime,
  parseSatelliteElements,
  predictedRevolutionCount,
  inferPosition,
  inferVelocity,
  vectorMagnitude,
  convertGeodeticToDegrees,
  isGeostationary,
  betaAngle
} from "./utils";
import {
  dopplerFactor,
  ecfToLookAngles,
  jday,
  Kilometer,
  propagate,
  radiansToDegrees,
  SatRecError,
  shadowFraction,
  sunPos,
} from "satellite.js";

/** Set the angular units for the inputs and outputs */
export enum AngularUnits {
  Degrees = 'DEGREES',
  Radians = 'RADIANS'
}

/**
 * Calculates satellite observation parameters such as postion, velocity, and 
 * observer look angles.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param dateTime: an ISO datetime string, unix timestamp, or javascript Date object specifying the observation time
 * @param observerPosition: an optional position object specifying the location of a satellite observer
 * @param minimumElevationAngle: minimum horizon elevation angle used for calculating footprint and acquisition of signal (AOS)
 */
export function observe(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  dateTime: DateTimeTypes,
  observerPosition?: Position,
  minimumElevationAngle: Degrees | Radians = 0,
  angularUnits: AngularUnits = AngularUnits.Degrees
): SatelliteObservation {
  const dt = parseDateTime(dateTime)
  const gmst = greenwichMeanSiderealTime(dt)
  const [omm, satrec] = parseSatelliteElements(satelliteElements)

  // Returns the satellite position and velocity in ECI coordinations
  const satPropagation = propagate(satrec, dt.toJSDate())

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
        throw new Error('Predicted orbit has collapsed mathematically')

      case SatRecError.Decayed:
        return {
          id: omm.OBJECT_ID,
          name: omm.OBJECT_NAME,
          noradCatalogId: omm.NORAD_CAT_ID as string,
          orbitalModel: omm.MEAN_ELEMENT_THEORY,
          epoch: dt.setZone('UTC').toISO(),
          decayed: true,
        }
    }

    throw new Error('Satellite propagation failed')
  }

  // Calculate the satellite's position and velocity in other coordinate frames
  const satPosition = inferPosition({ eci: satPropagation.position }, gmst, angularUnits)
  const satVelocity = inferVelocity({ eci: satPropagation.velocity }, gmst)

  // Calculate the sun's position in kilometers
  const sunEciAU = sunPos(jday(dt.toJSDate())).rsun
  const sunEci = {
    x: sunEciAU.x * astronomicalUnit,
    y: sunEciAU.y * astronomicalUnit,
    z: sunEciAU.z * astronomicalUnit
  }
  const sunPosition = inferPosition({ eci: sunEci }, gmst, angularUnits)

  // Calculate the eclipse factor
  const eclipseFactor = shadowFraction(sunEciAU, satPosition.eci!)

  // Calculate the beta angle (radians) between the orbital plane and the Sun
  const betaAngleRadians = betaAngle(satPropagation.meanElements, sunEci)

  // Calculate the satellite's footprint
  const footprint = (angularUnits === AngularUnits.Degrees)
    ? footprintDiameter(satPosition, minimumElevationAngle * deg2rad)
    : footprintDiameter(satPosition, minimumElevationAngle)
  
  // Calculate the ground track parameters
  const observation: SatelliteObservation = {
    id: omm.OBJECT_ID,
    name: omm.OBJECT_NAME,
    noradCatalogId: omm.NORAD_CAT_ID as string,
    orbitalModel: omm.MEAN_ELEMENT_THEORY,
    epoch: dt.toUTC().toISO(),
    gmst: gmst,
    position: (angularUnits === AngularUnits.Degrees) ? convertGeodeticToDegrees(satPosition) : satPosition,
    velocity: satVelocity,
    footprint: footprint,
    orbit: {
      revolutionCount: predictedRevolutionCount(omm, dt),
      phase: (angularUnits === AngularUnits.Degrees) ? satPropagation.meanElements.mm * rad2deg : satPropagation.meanElements.mm,
      velocity: vectorMagnitude(satVelocity.eci!),
    },
    decayed: false,
    geostationary: isGeostationary(satPropagation.meanElements),
    sunlit: eclipseFactor < 1,
    sunPosition: (angularUnits === AngularUnits.Degrees) ? convertGeodeticToDegrees(sunPosition) : sunPosition,
    betaAngle: (angularUnits === AngularUnits.Degrees) ? betaAngleRadians * rad2deg : betaAngleRadians,
    eclipseFactor: eclipseFactor,
  }

  if (!observerPosition) {
    return observation
  }

  // If we have an observer, calculate the look angles of the satellite
  const observerInferedPosition = inferPosition(observerPosition, gmst, angularUnits)
  const observerLookAngles = ecfToLookAngles(observerInferedPosition.geodetic!, satPosition.ecef!)

  return {
    ...observation,
    observerPosition: (angularUnits === AngularUnits.Degrees) ? convertGeodeticToDegrees(observerInferedPosition) : observerInferedPosition,
    azimuth: (angularUnits === AngularUnits.Degrees) ? radiansToDegrees(observerLookAngles.azimuth) : observerLookAngles.azimuth,
    elevation: (angularUnits === AngularUnits.Degrees) ? radiansToDegrees(observerLookAngles.elevation) : observerLookAngles.elevation,
    slantRange: observerLookAngles.rangeSat,
    dopplerFactor: dopplerFactor(observerInferedPosition.ecef!, satPosition.ecef!, satVelocity.ecef!),
  }
}
