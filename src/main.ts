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

import { DateTime } from "luxon"

import {
  Position,
  SatelliteObservation,
  SatelliteTransit,
  UnitOptions,
} from "./interfaces"
import {
  Degrees,
  OrbitMeanElementsMessage,
  Radians,
  Timestamp,
  TwoLineElement,
} from "./types"

import {
  buildTransitEvent,
  computeSatelliteObservation,
  defaultUnitOptions,
  formatTimestamp,
  isVisible,
  parseSatelliteElements,
  parseTimestamp,
  refineHorizonCrossing,
  refineTransitExtremum,
  toDateTime,
  transitObservation,
} from "./utils"

const transitSearchStepMs = 60 * 1000
const transitSampleStepMs = 15 * 1000
const crossingRefineIterations = 24
const extremumRefineIterations = 24

/**
 * Calculates satellite observation parameters such as postion, velocity, and
 * observer look angles.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param epoch: the date and time of the satellite observation, expressed as
 *    either a Unix timestamp, an ISO8601 string, a standard Javascript Date
 *    object, or luxon DateTime object
 * @param observerPosition: (optional) a position object specifying the location
 *    of a satellite observer
 * @param unitOptions: (optional) configure input/output units
 * Returns SatelliteObservation object
 */
export function satelliteObservation(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  epoch: Timestamp,
  observerPosition?: Position,
  unitOptions?: UnitOptions,
): SatelliteObservation {
  const datetime = parseTimestamp(epoch)
  const [omm, satrec] = parseSatelliteElements(satelliteElements)

  return computeSatelliteObservation(omm, satrec, datetime, observerPosition, unitOptions)
}

/**
 * Calculates satellite observation parameters such as postion, velocity, and
 * observer look angles at the specified times.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param epochArray: an array of timestamps specifying the desired observation
 *    times, the array may contain Unix timestamps, ISO8601 strings, Javascript
 *    Date objects, or luxon DateTime objects
 * @param observerPosition: (optional) a position object specifying the location
 *    of a satellite observer
 * @param unitOptions: (optional) configure input/output units
 * Returns array of SatelliteObservation objects
 */
export function satelliteObservations(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  epochArray: Timestamp[],
  observerPosition?: Position,
  unitOptions?: UnitOptions,
): SatelliteObservation[] {
  const [omm, satrec] = parseSatelliteElements(satelliteElements)

  return epochArray.map((epoch) =>
    computeSatelliteObservation(omm, satrec, parseTimestamp(epoch), observerPosition, unitOptions),
  )
}

/**
 * Calculate the satellite transits for a given location over specified time range.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param observerPosition: a position object specifying the location of the
 *    satellite observer
 * @param startTime: a timestamp representing the start time of the transits
 * @param stopTime: a timestamp representing the stop time of the transits
 * @param minElevationAngle: (optional) the minimum elevation threshold used to
 *    define the start and stop of a pass
 * @param unitOptions: (optional) configure input/output units
 */
export function satelliteTransits(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  observerPosition: Position,
  startTime: Timestamp,
  stopTime: Timestamp,
  minElevationAngle: Degrees | Radians = 0,
  unitOptions?: UnitOptions,
): SatelliteTransit[] {
  const unitOpts: UnitOptions = { ...defaultUnitOptions, ...(unitOptions ?? {}) }
  const startDateTime = parseTimestamp(startTime)
  const stopDateTime = parseTimestamp(stopTime)

  if (stopDateTime.toMillis() <= startDateTime.toMillis()) {
    return []
  }
  
  const [omm, satrec] = parseSatelliteElements(satelliteElements)
  const observeAt = (datetime: DateTime): SatelliteObservation =>
    transitObservation(omm, satrec, datetime, observerPosition, unitOpts.angular!)

  const buildTransit = (
    aosTime: DateTime,
    aosObservation: SatelliteObservation,
  ): { transit: SatelliteTransit; nextTime: DateTime } => {
    const samples = [{ time: aosTime, observation: aosObservation }]
    let lastTime = aosTime
    let lastObservation = aosObservation
    let endTime = aosTime
    let endObservation = aosObservation

    while (lastTime.toMillis() < stopDateTime.toMillis()) {
      const nextTime = toDateTime(Math.min(lastTime.toMillis() + transitSampleStepMs, stopDateTime.toMillis()))

      if (nextTime.toMillis() === lastTime.toMillis()) {
        break
      }

      const nextObservation = observeAt(nextTime)

      if (nextObservation.decayed) {
        endTime = lastTime
        endObservation = lastObservation
        break
      }

      if (!isVisible(nextObservation, minElevationAngle)) {
        const los = refineHorizonCrossing(
          lastTime,
          lastObservation,
          nextTime,
          nextObservation,
          minElevationAngle,
          observeAt,
          crossingRefineIterations,
        )
        endTime = los.time
        endObservation = los.observation
        break
      }

      samples.push({ time: nextTime, observation: nextObservation })
      lastTime = nextTime
      lastObservation = nextObservation
      endTime = nextTime
      endObservation = nextObservation
    }

    if (samples[samples.length - 1].time.toMillis() !== endTime.toMillis()) {
      samples.push({ time: endTime, observation: endObservation })
    }

    const peakIndex = samples.reduce((bestIndex, sample, index, allSamples) =>
      (sample.observation.elevation ?? -Infinity) > (allSamples[bestIndex].observation.elevation ?? -Infinity)
        ? index
        : bestIndex,
      0,
    )
    const tcaIndex = samples.reduce((bestIndex, sample, index, allSamples) =>
      (sample.observation.slantRange ?? Infinity) < (allSamples[bestIndex].observation.slantRange ?? Infinity)
        ? index
        : bestIndex,
      0,
    )

    const peak = peakIndex > 0 && peakIndex < samples.length - 1
      ? refineTransitExtremum(
          samples[peakIndex - 1].time,
          samples[peakIndex + 1].time,
          observeAt,
          (observation) => observation.elevation ?? -Infinity,
          true,
          extremumRefineIterations,
        )
      : samples[peakIndex]

    const tca = tcaIndex > 0 && tcaIndex < samples.length - 1
      ? refineTransitExtremum(
          samples[tcaIndex - 1].time,
          samples[tcaIndex + 1].time,
          observeAt,
          (observation) => observation.slantRange ?? Infinity,
          false,
          extremumRefineIterations,
        )
      : samples[tcaIndex]

    return {
      transit: {
        start: formatTimestamp(aosTime, unitOpts.timestamp!),
        stop: formatTimestamp(endTime, unitOpts.timestamp!),
        duration: (endTime.toMillis() - aosTime.toMillis()) / 1000,
        aos: buildTransitEvent(aosTime, aosObservation, unitOpts.timestamp!),
        los: buildTransitEvent(endTime, endObservation, unitOpts.timestamp!),
        peak: buildTransitEvent(peak.time, peak.observation, unitOpts.timestamp!),
        tca: buildTransitEvent(tca.time, tca.observation, unitOpts.timestamp!),
      },
      nextTime: toDateTime(Math.min(endTime.toMillis() + transitSearchStepMs, stopDateTime.toMillis())),
    }
  }

  const transits: SatelliteTransit[] = []
  let currentTime = startDateTime
  let currentObservation = observeAt(currentTime)

  if (currentObservation.decayed) {
    return []
  }

  while (currentTime.toMillis() < stopDateTime.toMillis()) {
    if (isVisible(currentObservation, minElevationAngle)) {
      const { transit, nextTime } = buildTransit(currentTime, currentObservation)
      transits.push(transit)

      if (nextTime.toMillis() <= currentTime.toMillis() || nextTime.toMillis() >= stopDateTime.toMillis()) {
        break
      }

      currentTime = nextTime
      currentObservation = observeAt(currentTime)
      continue
    }

    const nextTime = toDateTime(Math.min(currentTime.toMillis() + transitSearchStepMs, stopDateTime.toMillis()))

    if (nextTime.toMillis() === currentTime.toMillis()) {
      break
    }

    const nextObservation = observeAt(nextTime)

    if (nextObservation.decayed) {
      break
    }

    if (isVisible(nextObservation, minElevationAngle)) {
      const aos = refineHorizonCrossing(
        currentTime,
        currentObservation,
        nextTime,
        nextObservation,
        minElevationAngle,
        observeAt,
        crossingRefineIterations,
      )
      const { transit, nextTime: followingTime } = buildTransit(aos.time, aos.observation)
      transits.push(transit)

      if (followingTime.toMillis() <= currentTime.toMillis() || followingTime.toMillis() >= stopDateTime.toMillis()) {
        break
      }

      currentTime = followingTime
      currentObservation = observeAt(currentTime)
      continue
    }

    currentTime = nextTime
    currentObservation = nextObservation
  }

  return transits
}

// <--------------------------------------------------------------------------->

// Re-export the public interfaces so consumers can import them from the module root
export type {
  Orbit,
  Position,
  SatelliteObservation,
  SatelliteTransit,
  TransitEvent,
  UnitOptions,
  Velocity,
} from "./interfaces"

// Re-export the public types so consumers can import them from the module root
export type {
  AstronomialUnits,
  Degrees,
  Kilometers,
  KilometersPerSecond,
  OrbitMeanElementsMessage,
  Radians,
  Timestamp,
  TwoLineElement,
} from "./types"

export {
  AngularUnits,
  TimestampType,
} from './enums'
