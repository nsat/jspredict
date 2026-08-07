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

import { SatelliteGroundTrack, SatelliteGroundTrackObservation, Position } from "./interfaces";
import { astronomicalUnit, deg2rad } from "./constants";
import { TwoLineElement, DateTimeTypes, OrbitMeanElementsMessage, Degrees } from "./types";
import { footprintRadius, greenwichMeanSiderealTime, parseDateTime, parseSatelliteElements, predictedRevolutionCount } from "./utils";
import {
  degreesLat,
  degreesLong,
  dopplerFactor,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  geodeticToEcf,
  jday,
  propagate,
  radiansToDegrees,
  radiansLat,
  radiansLong,
  SatRecError,
  shadowFraction,
  sunPos,
} from "satellite.js";

/**
 * Calculates the position, velocity, and ground track location of a satellite 
 * at a given time.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param dateTime: an ISO datetime string, unix timestamp, or javascript Date object specifying the observation time
 * @param observerPosition: an optional position object specifying the location of a satellite observer
 */
export function observe(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  dateTime: DateTimeTypes,
  observerPosition?: Position,
  minElevationAngle?: Degrees = 0
): SatelliteGroundTrack | SatelliteGroundTrackObservation {
  const vectorMagnitude = (vector: { x: number; y: number; z: number }): number => {
    return Math.hypot(vector.x, vector.y, vector.z)
  }

  const dt = parseDateTime(dateTime)
  const gmst = greenwichMeanSiderealTime(dt)
  const [omm, satrec] = parseSatelliteElements(satelliteElements)

  // Returns the satellite position and velocity in ECI coordinations
  const satEci = propagate(satrec, dt.toJSDate())

  // Check for errors
  if (satEci === null) {
    switch (satrec.error) {

      case SatRecError.MeanEccentricityOutOfRange:
        throw new Error('Orbit eccentricity is out of range for SGP4 propagation model')

      case SatRecError.MeanMotionBelowZero:
        throw new Error('Orbit mean motion is below zero')
      
      case SatRecError.PerturbedEccentricityOutOfRange:
        throw new Error('Predicted orbit eccentricity is out of range for SGP4 propagation model')
    
      case SatRecError.SemiLatusRectumBelowZero:
        throw new Error('Predicted orbit has collapsed due to severe drag perturbations or numerical instability')

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

  const positionEcf = eciToEcf(satEci.position, gmst)
  const velocityEcf = eciToEcf(satEci.velocity, gmst)
  const geodeticPosition = eciToGeodetic(satEci.position, gmst)
  const sunEci = sunPos(jday(dt.toJSDate())).rsun
  const sunEcf = eciToEcf(sunEci, gmst)
  const sunGeodeticPosition = eciToGeodetic(sunEci, gmst)
  const eclipseFactor = shadowFraction(sunEci, satEci.position)
  const revolutionCount = predictedRevolutionCount(omm, dt)
  const minElevationAngleRadians = minElevationAngle * deg2rad
  
  // Calculate the ground track parameters
  const groundTrack: SatelliteGroundTrack = {
    id: omm.OBJECT_ID,
    name: omm.OBJECT_NAME,
    noradCatalogId: omm.NORAD_CAT_ID as string,
    orbitalModel: omm.MEAN_ELEMENT_THEORY,
    epoch: dt.setZone('UTC').toISO(),
    gmst: gmst,
    position: {
      eci: satEci.position,
      ecef: positionEcf,
      latitude: degreesLat(geodeticPosition.latitude),
      longitude: degreesLong(geodeticPosition.longitude),
      altitude: geodeticPosition.height,
    },
    velocity: {
      eci: satEci.velocity,
      ecef: velocityEcf,
    },
    footprint: footprintRadius(geodeticPosition.latitude, geodeticPosition.height, minElevationAngleRadians) * 2,
    orbit: {
      revolutionCount,
      phase: ((radiansToDegrees(satEci.meanElements.mm) % 360) + 360) % 360,
      velocity: vectorMagnitude(satEci.velocity) * 3600,
    },
    decayed: false,
    geostationary: false, //ToDo: Determine if the satellite is geostationary
    sunlit: eclipseFactor < 1,
    sunPosition: {
      eci: sunEci,
      ecef: sunEcf,
      latitude: degreesLat(sunGeodeticPosition.latitude),
      longitude: degreesLong(sunGeodeticPosition.longitude),
      altitude: sunGeodeticPosition.height,
    },
    eclipseFactor: eclipseFactor,
  }

  if (!observerPosition) {
    return groundTrack
  }

  // If we have an observer, calculate the look angles of the satellite
  
  if (observerPosition.latitude === undefined || observerPosition.longitude === undefined) {
    throw new Error('Observer position must include latitude and longitude in degrees')
  }

  const normalizedObserverPosition = {
    latitude: observerPosition.latitude,
    longitude: observerPosition.longitude,
    altitude: observerPosition.altitude ?? 0,
  }

  const observerGeodetic = {
    latitude: radiansLat(normalizedObserverPosition.latitude),
    longitude: radiansLong(normalizedObserverPosition.longitude),
    height: normalizedObserverPosition.altitude,
  }
  const observerEcf = geodeticToEcf(observerGeodetic)
  const lookAngles = ecfToLookAngles(observerGeodetic, positionEcf)
  const sunLookAngles = ecfToLookAngles(observerGeodetic, eciToEcf({
    x: sunEci.x * astronomicalUnit,
    y: sunEci.y * astronomicalUnit,
    z: sunEci.z * astronomicalUnit,
  }, gmst))
  const elevation = radiansToDegrees(lookAngles.elevation)
  const hasAos = elevation > 0

  let visibility = 'visible'

  if (!hasAos) {
    visibility = 'below-horizon'
  } else if (!isSunlit) {
    visibility = 'eclipsed'
  } else if (radiansToDegrees(sunLookAngles.elevation) > -6) {
    visibility = 'daylight'
  }

  return {
    ...groundTrack,
    observerPosition: {
      ...normalizedObserverPosition,
      ecef: observerEcf,
    },
    azimuth: radiansToDegrees(lookAngles.azimuth),
    elevation,
    slantRange: lookAngles.rangeSat,
    dopplerFactor: dopplerFactor(observerEcf, positionEcf, velocityEcf),
    visibility,
    hasAos,
  }
}
