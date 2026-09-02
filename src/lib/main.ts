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

import { AngularUnits, SatelliteSunEventType, TimestampFormat } from "./enums"
import { DateTime } from "luxon"
import { defaultSatelliteSunEventOptions, defaultSatelliteTransitOptions, deg2rad } from "./constants"
import {
  Position,
  SatelliteObservation,
  SatelliteObservationOptions,
  SatelliteSunEvent,
  SatelliteSunEventOptions,
  SatelliteTransit,
  SatelliteTransitOptions,
} from "./interfaces"
import {
  OrbitMeanElementsMessage,
  Timestamp,
  TwoLineElement,
} from "./types"

import {
  buildTransitEvent,
  computeSatelliteObservation,
  dynamicStepSeconds,
  elevationAt,
  elevationRelativeTo,
  formatTimestamp,
  parseSatelliteElements,
  parseTimestamp,
  brentExtremum,
  brentMethod,
  findHorizonCrossing,
  findDecayTime,
  eclipseBoundaryValueAt,
  eclipseRegimeAt,
  EclipseBoundary,
  inferPosition,
  convertGeodeticToDegrees,
} from "./utils"
import {
  Degrees,
  Radians,
  gstime,
  jday,
  sunPos,
} from "satellite.js"
import { astronomicalUnit } from "./constants"

/**
 * Calculates satellite observation parameters such as postion, velocity, and
 * observer look angles.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param epoch: accepts either a single timestamp or array of timestamps 
 *    expressed as either a Unix timestamp, an ISO8601 string, a standard 
 *    Javascript Date object, or luxon DateTime object
 * @param observerPosition: (optional) a position object specifying the location
 *    of a satellite observer
 * Returns either a single SatelliteObservation or array of 
 *    SatelliteObservations if an array of epochs is provided
 */
export function satelliteObservation(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  epoch: Timestamp | Timestamp[],
  observerPosition?: Position,
  satelliteObservationOptions: SatelliteObservationOptions = {}
): SatelliteObservation | SatelliteObservation[] {
  if (Array.isArray(epoch)) {
    const [omm, satrec] = parseSatelliteElements(satelliteElements)
    return epoch.map((e) =>
      computeSatelliteObservation(omm, satrec, parseTimestamp(e), observerPosition, satelliteObservationOptions)
    )
  } else {
    const datetime = parseTimestamp(epoch)
    const [omm, satrec] = parseSatelliteElements(satelliteElements)
    return computeSatelliteObservation(omm, satrec, datetime, observerPosition, satelliteObservationOptions)
  }
}

/**
 * Calculate the satellite transits for a given location over specified time range.
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param observerPosition: a position object specifying the location of the
 *    satellite observer
 * @param startTime: a timestamp representing the start time of the transits
 * @param stopTime: a timestamp representing the stop time of the transits
 * @param minElevationAngle: (optional) the minimum elevation threshold used to
 *    define the AOS/LOS of a pass (defaults to 0)
 * @param angularUnits: (optional) configure if angular units are defined in
 *    Degrees or Radians, default is Degrees
 * @param timestampFormat: (optional) sets the format of output timestamps,
 *    default is ISO8601
 * @param searchOptions: (optional) tunable precision (secant tolerance) and
 *    convergence (max iterations) controls plus an optional coarse-step override
 */
export function satelliteTransits(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  startTime: Timestamp,
  stopTime: Timestamp,
  observerPosition: Position,
  minElevationAngle: Degrees | Radians = 0,
  satelliteTransitOptions?: SatelliteTransitOptions
): SatelliteTransit[] {
  // Configure input/output options 
  const options = {...defaultSatelliteTransitOptions, ...satelliteTransitOptions}

  const startDateTime = parseTimestamp(startTime)
  const stopDateTime = parseTimestamp(stopTime)

  // Check for invalid inputs
  if (stopDateTime <= startDateTime) {
    throw new Error('Stop date is less than or equal to start date')
  }

  // Parse the satellite elements
  const [omm, satrec] = parseSatelliteElements(satelliteElements)
  const ommEpochDateTime = parseTimestamp(omm.EPOCH)

  // Warn about propagating transits before OMM epoch
  if (startDateTime < ommEpochDateTime) {
    console.warn('Propagating satellite transit times prior to TLE/OMM epoch is not recommended')
  }

  // Propagate the satellite at the start time to see if it is decayed or geostationary
  const initialObservation = computeSatelliteObservation(omm, satrec, startDateTime, observerPosition, satelliteTransitOptions)

  // Check if the satellite has decayed
  if (initialObservation.decayed) {
    console.warn(`Satellite ${initialObservation.id} orbit has decayed as of: ${initialObservation.epoch}`)
    return []
  }

  // Check if the satellite is geostationary
  if (initialObservation.geostationary) {
    if (initialObservation.elevation! < minElevationAngle) {
      console.warn(`Satellite ${initialObservation.id} is geostationary and is out of view of the observer at: ${initialObservation.observerPosition?.geo}`)
      return []
    }
  }

  // <----------------------------------------------------------------------->
  // SEARCH CONFIGURATION
  // <----------------------------------------------------------------------->
  
  // Convert the caller-supplied minimum elevation to radians. All internal math
  // is performed in radians; angular unit conversion happens only at output.
  const minElevationRadians: Radians =
    options.elevationAngularUnits === AngularUnits.Degrees ? (minElevationAngle as number) * deg2rad : (minElevationAngle as number)

  // The observer's geodetic position expressed in radians. `inferPosition`
  // (called inside computeSatelliteObservation) tolerates degree inputs, but the
  // low-level elevation helpers require radians, so normalize once here.
  const observerGeodeticRadians =
    options.geodeticAngularUnits === AngularUnits.Degrees
      ? {
          latitude: observerPosition.geo!.latitude * deg2rad,
          longitude: observerPosition.geo!.longitude * deg2rad,
          height: observerPosition.geo!.height,
        }
      : observerPosition.geo!

  // Determine the coarse step size (seconds). Unless the caller overrides it,
  // the step is derived dynamically from the satellite's mean motion, mirroring
  // Skyfield's heuristic of ~20 samples per orbital revolution
  // (step = 0.05 orbits worth of time). This keeps the step comfortably shorter
  // than a single pass so every culmination is bracketed, while scaling sensibly
  // across orbit regimes. The step is capped at a quarter day so very slow
  // (near-geostationary) satellites, which rise and set because the Earth turns
  // beneath them rather than from their own motion, are still sampled densely
  // enough to catch each pass.
  const stepSeconds = options.coarseStepSeconds ?? dynamicStepSeconds(Number(omm.MEAN_MOTION))
  const stepMs = stepSeconds * 1000

  // Scalar functions of time used by both the coarse search and the secant
  // refinement. Time is carried as milliseconds since the Unix epoch throughout
  // the search so no intermediate luxon DateTime objects are created; elevation
  // is measured in radians relative to the local horizon.
  const elevation = (ms: number): Radians => elevationAt(satrec, observerGeodeticRadians, ms)

  // Numerically estimate the elevation *rate* (d(elevation)/dt) via a small
  // central finite difference. The rate is expressed in radians per second (the
  // finite difference is taken over a millisecond interval, then scaled to
  // per-second units). The sign of this rate distinguishes a rising satellite
  // (positive) from a setting one (negative); a culmination occurs where it
  // changes from positive to negative.
  const rateDeltaMs = 500
  const msPerSecond = 1000
  const elevationRate = (ms: number): number => {
    const before = elevation(ms - rateDeltaMs)
    const after = elevation(ms + rateDeltaMs)
    return ((after - before) / (2 * rateDeltaMs)) * msPerSecond
  }

  const startMs = startDateTime.toMillis()
  const stopMs = stopDateTime.toMillis()

  // <----------------------------------------------------------------------->
  // PHASE 1: COARSE SEARCH
  //
  // Walk the search window at the coarse step, sampling the elevation angle.
  // Candidate passes are detected as *culminations* — local maxima in elevation
  // — rather than by requiring a coarse sample to land above the minimum
  // elevation threshold. This is what lets short "grazing" passes be found even
  // when the coarse step is too large for any single sample to fall inside the
  // brief window the satellite spends above the threshold: as long as the step
  // brackets the culmination, the pass is caught. A culmination lies between two
  // adjacent samples where the elevation rate flips from rising (>= 0) to
  // setting (< 0).
  // <----------------------------------------------------------------------->

  type Sample = { ms: number; elevation: Radians }
  const samples: Sample[] = []
  for (let ms = startMs; ms <= stopMs; ms += stepMs) {
    samples.push({ ms, elevation: elevation(ms) })
  }
  // Always include the exact window end so we do not miss an event lingering in
  // the final partial step.
  if (samples[samples.length - 1].ms < stopMs) {
    samples.push({ ms: stopMs, elevation: elevation(stopMs) })
  }

  const transits: SatelliteTransit[] = []

  // Iterate over adjacent sample pairs looking for a culmination: an interval
  // where the elevation rate changes from rising (>= 0) to setting (< 0).
  for (let i = 0; i < samples.length - 1; i++) {
    const cursorMs = samples[i].ms
    const nextMs = samples[i + 1].ms

    // A culmination is bracketed when the elevation rate flips positive to
    // negative between the two coarse samples.
    const culminates = elevationRate(cursorMs) >= 0 && elevationRate(nextMs) < 0

    if (!culminates) {
      continue
    }

    // <------------------------------------------------------------------->
    // PHASE 2: SECANT REFINEMENT
    // <------------------------------------------------------------------->

    // <------------------------------------------------------------------->
    // PEAK (culmination): refine the elevation maximum as the zero of the
    // elevation *rate* within the bracketing coarse interval. The peak is
    // resolved first because it provides a guaranteed above-threshold time (for
    // real passes) that brackets both the AOS (rising) and LOS (setting)
    // crossings on their respective sides, preventing either secant search from
    // wandering to the opposite crossing.
    // <------------------------------------------------------------------->

    const peakBracketAMs = cursorMs
    const peakBracketBMs = nextMs

    const peakMs = brentExtremum(
      (ms) => elevationRate(ms),
      peakBracketAMs,
      peakBracketBMs,
      options.elevationRateTolerance!,
      options.maxIterations!,
    )

    // Filter out culminations whose peak never reaches the minimum elevation.
    // This mirrors Skyfield, which discards maxima below the requested altitude.
    // A strict inequality also drops grazing passes whose peak only touches the
    // threshold, so a reported transit always genuinely exceeds minElevation.
    const peakObservation = computeSatelliteObservation(
      omm, satrec, DateTime.fromMillis(peakMs, { zone: "utc" }), observerPosition, options,
    )
    const peakElevationRadians = elevation(peakMs)
    if (peakElevationRadians <= minElevationRadians) {
      // Advance past this culmination's coarse interval and keep scanning.
      continue
    }

    // <------------------------------------------------------------------->
    // AOS: the exact time the elevation rises through the minimum threshold.
    // March backward from the peak one coarse step at a time until a sample
    // falls below the threshold, bracketing the rising crossing between that
    // sample and the peak (which is above the threshold). Then refine.
    // <------------------------------------------------------------------->

    let aosBracketMs = peakMs
    for (let ms = cursorMs; ms >= startMs - stepMs; ms -= stepMs) {
      const clampedMs = Math.max(ms, startMs)
      if (elevation(clampedMs) < minElevationRadians) {
        aosBracketMs = clampedMs
        break
      }
      aosBracketMs = clampedMs
      if (clampedMs === startMs) break
    }

    const aosMs = brentMethod(
      (ms) => elevationRelativeTo(satrec, observerGeodeticRadians, ms, minElevationRadians),
      aosBracketMs,
      peakMs,
      options.elevationToleranceRadians!,
      options.maxIterations!,
    )

    // <------------------------------------------------------------------->
    // LOS: the exact time the elevation sets through the minimum threshold.
    // March forward from the peak one coarse step at a time until a sample falls
    // below the threshold, bracketing the setting crossing between the peak and
    // that sample. Then refine.
    // <------------------------------------------------------------------->

    let losBracketMs = peakMs
    for (let ms = nextMs; ms <= stopMs + stepMs; ms += stepMs) {
      const clampedMs = Math.min(ms, stopMs)
      if (elevation(clampedMs) < minElevationRadians) {
        losBracketMs = clampedMs
        break
      }
      losBracketMs = clampedMs
      if (clampedMs === stopMs) break
    }

    const losMs = brentMethod(
      (ms) => elevationRelativeTo(satrec, observerGeodeticRadians, ms, minElevationRadians),
      peakMs,
      losBracketMs,
      options.elevationToleranceRadians!,
      options.maxIterations!,
    )

    // <------------------------------------------------------------------->
    // START / STOP (0-degree horizon crossings). Per the transit definition,
    // the reported start and stop conform to the true horizon (0 rad), while
    // AOS/LOS conform to the minimum elevation threshold. When
    // minElevationAngle == 0 these are the *same* events, so we reuse the
    // already-refined AOS/LOS times directly (guaranteeing start === aos and
    // stop === los). When minElevationAngle > 0 the horizon crossings fall
    // slightly *outside* the AOS/LOS pair, and we locate them separately.
    //
    // The horizon search marches outward from AOS (backward in time) and LOS
    // (forward in time) one coarse step at a time until the elevation drops
    // below the horizon. The bracket for the secant refinement pairs that first
    // below-horizon point with the pass's peak (which is always above the
    // horizon), so the refined root is guaranteed to be the single horizon
    // crossing belonging to this pass rather than one from an adjacent pass. The
    // march is bounded by the search window.
    // <------------------------------------------------------------------->

    let startMsEvent: number
    let stopMsEvent: number

    if (minElevationRadians === 0) {
      // The minimum-elevation crossings are exactly the horizon crossings.
      startMsEvent = aosMs
      stopMsEvent = losMs
    } else {
      const rawStartMs = findHorizonCrossing(
        satrec, observerGeodeticRadians, aosMs, peakMs, -stepMs, startMs, stopMs, options.elevationToleranceRadians!, options.maxIterations!,
      )
      const rawStopMs = findHorizonCrossing(
        satrec, observerGeodeticRadians, losMs, peakMs, stepMs, startMs, stopMs, options.elevationToleranceRadians!, options.maxIterations!,
      )

      // The horizon crossings must bound the AOS/LOS pair; clamp so the
      // invariant start <= aos <= los <= stop always holds exactly.
      startMsEvent = Math.min(rawStartMs, aosMs)
      stopMsEvent = Math.max(rawStopMs, losMs)
    }

    // <------------------------------------------------------------------->
    // TCA (time of closest approach): the minimum slant range during the pass.
    // Because slant range is minimized near the elevation peak, we reuse the
    // peak brackets and refine on the range *rate* (a zero of d(range)/dt marks
    // the closest approach), estimated by finite difference. Convergence is
    // judged on the range rate approaching zero within the rate tolerance.
    // <------------------------------------------------------------------->

    const slantRange = (ms: number): number =>
      computeSatelliteObservation(
        omm, satrec, DateTime.fromMillis(ms, { zone: "utc" }), observerPosition, options,
      ).slantRange!
    const rangeRate = (ms: number): number => {
      const before = slantRange(ms - rateDeltaMs)
      const after = slantRange(ms + rateDeltaMs)
      return ((after - before) / (2 * rateDeltaMs)) * msPerSecond
    }
    const tcaMs = brentExtremum(
      (ms) => rangeRate(ms),
      peakBracketAMs,
      peakBracketBMs,
      options.slantRangeRateTolerance!,
      options.maxIterations!,
    )

    // <------------------------------------------------------------------->
    // Build the transit record. The refined event times are converted from
    // milliseconds to luxon DateTime objects here — the only place in the
    // search where DateTime objects are materialized — so azimuth/elevation/
    // slant range are self-consistent with the refined timestamps and the
    // requested output units.
    // <------------------------------------------------------------------->

    transits.push({
      start: formatTimestamp(DateTime.fromMillis(startMsEvent, { zone: "utc" }), options.timestampFormat!),
      stop: formatTimestamp(DateTime.fromMillis(stopMsEvent, { zone: "utc" }), options.timestampFormat!),
      duration: (stopMsEvent - startMsEvent) / 1000,
      aos: buildTransitEvent(
        computeSatelliteObservation(omm, satrec, DateTime.fromMillis(aosMs, { zone: "utc" }), observerPosition, options),
      ),
      los: buildTransitEvent(
        computeSatelliteObservation(omm, satrec, DateTime.fromMillis(losMs, { zone: "utc" }), observerPosition, options),
      ),
      tca: buildTransitEvent(
        computeSatelliteObservation(omm, satrec, DateTime.fromMillis(tcaMs, { zone: "utc" }), observerPosition, options),
      ),
      peak: buildTransitEvent(peakObservation),
    })

    // Advance past the coarse samples spanned by this pass (up to LOS) so the
    // outer scan does not re-inspect intervals already accounted for. Each pass
    // has a single culmination, so this simply skips ahead to where the
    // satellite has set below the threshold.
    while (i < samples.length - 1 && samples[i + 1].ms < losMs) {
      i++
    }
  }

  return transits
}

/**
 * Calculates the Sun's position at one or more timestamps.
 * @param epoch: accepts either a single timestamp or array of timestamps 
 *    expressed as either a Unix timestamp, an ISO8601 string, a standard 
 *    Javascript Date object, or luxon DateTime object
 * @param geodeticAngularUnits: (optional) configure if angular units for geodetic 
 *    coordinates are defined in Degrees or Radians, default is Degrees
 * Returns either a single Position or array of Positions if an array of epochs 
 *    is provided
 */
export function sunPosition(
  epoch: Timestamp | Timestamp[],
  geodeticAngularUnits: AngularUnits = AngularUnits.Degrees
): Position | Position[] {
  if (Array.isArray(epoch)) {
    return epoch.map((e) => {
      const datetime = parseTimestamp(e)
      const gmst = gstime(jday(datetime.toJSDate()))
      
      // Calculate the sun's position in kilometers
      const sunEciAU = sunPos(jday(datetime.toJSDate())).rsun
      const sunEci = {
        x: sunEciAU.x * astronomicalUnit,
        y: sunEciAU.y * astronomicalUnit,
        z: sunEciAU.z * astronomicalUnit,
      }
      
      const position = inferPosition({ eci: sunEci }, gmst, geodeticAngularUnits)
      return geodeticAngularUnits === AngularUnits.Degrees ? convertGeodeticToDegrees(position) : position
    })
  } else {
    const datetime = parseTimestamp(epoch)
    const gmst = gstime(jday(datetime.toJSDate()))
    
    // Calculate the sun's position in kilometers
    const sunEciAU = sunPos(jday(datetime.toJSDate())).rsun
    const sunEci = {
      x: sunEciAU.x * astronomicalUnit,
      y: sunEciAU.y * astronomicalUnit,
      z: sunEciAU.z * astronomicalUnit,
    }
    
    const position = inferPosition({ eci: sunEci }, gmst, geodeticAngularUnits)
    return geodeticAngularUnits === AngularUnits.Degrees ? convertGeodeticToDegrees(position) : position
  }
}

/**
 * Calculate the satellite's sunlight regime intervals over a time range.
 *
 * The satellite's illumination is classified by its eclipse factor (the
 * fraction of the Sun's disc obscured by the Earth) into three contiguous
 * regimes:
 *
 *   - SUNLIT     — fully illuminated (eclipseFactor == 0)
 *   - TRANSITION — partial shadow / penumbra (0 < eclipseFactor < 1)
 *   - ECLIPSE    — full shadow / umbra (eclipseFactor == 1)
 *
 * The returned events tile the entire [startTime, stopTime] window with no
 * gaps, each event's `stop` coinciding exactly with the next event's `start`
 * (overlapping timestamps). The first event begins at `startTime` and the last
 * ends at `stopTime`, unless the orbit decays within the window, in which case
 * the final event ends at the decay time and the scan stops.
 *
 * Regime boundaries are located by rooting the angular-separation offset that
 * `shadowFraction` uses internally — `d - (rE + rS)` for the sunlit/transition
 * boundary and `d - (rE - rS)` for the transition/eclipse boundary — with
 * Brent's method. Those offsets cross zero cleanly at the boundary, whereas the
 * eclipse factor itself is flat (exactly 0 or 1) outside the penumbra and so
 * cannot be bracketed directly.
 *
 * @param satelliteElements a TLE or OMM of the satellite's orbital elements
 * @param startTime a timestamp representing the start of the window
 * @param stopTime a timestamp representing the end of the window
 * @param satelliteSunEventOptions (optional) tunable convergence tolerance, max
 *    iterations, and coarse-step override
 */
export function satelliteSunEvents(
  satelliteElements: TwoLineElement | OrbitMeanElementsMessage,
  startTime: Timestamp,
  stopTime: Timestamp,
  satelliteSunEventOptions?: SatelliteSunEventOptions
): SatelliteSunEvent[] {
  // Configure options
  const options = { ...defaultSatelliteSunEventOptions, ...satelliteSunEventOptions }

  const startDateTime = parseTimestamp(startTime)
  const stopDateTime = parseTimestamp(stopTime)

  // Check for invalid inputs
  if (stopDateTime <= startDateTime) {
    throw new Error('Stop date is less than or equal to start date')
  }

  // Parse the satellite elements
  const [omm, satrec] = parseSatelliteElements(satelliteElements)
  const ommEpochDateTime = parseTimestamp(omm.EPOCH)

  // Warn about propagating before OMM epoch
  if (startDateTime < ommEpochDateTime) {
    console.warn('Propagating satellite sun event times prior to TLE/OMM epoch is not recommended')
  }

  const startMs = startDateTime.toMillis()
  const stopMs = stopDateTime.toMillis()

  // Coarse step (seconds -> ms). Unless overridden, derive from mean motion so
  // there are ~20 samples per revolution — far finer than the shortest eclipse
  // regime, so no boundary crossing is skipped.
  const stepSeconds = options.coarseStepSeconds ?? dynamicStepSeconds(Number(omm.MEAN_MOTION))
  const stepMs = stepSeconds * 1000

  const angularTolerance = options.angularToleranceRadians!
  const maxIterations = options.maxIterations!

  // Refine a single boundary crossing between two bracketing times using Brent's
  // method on the appropriate angular-separation offset.
  const refineBoundary = (aMs: number, bMs: number, boundary: EclipseBoundary): number =>
    brentMethod(
      (ms) => eclipseBoundaryValueAt(satrec, ms, boundary),
      aMs,
      bMs,
      angularTolerance,
      maxIterations,
    )

  // Ordering of the three regimes along the "more shadowed" axis. Moving between
  // non-adjacent regimes (Sunlit <-> Eclipse) necessarily passes through
  // Transition, so we always insert the intermediate boundary/regime.
  const regimeRank = (regime: SatelliteSunEventType): number => {
    switch (regime) {
      case SatelliteSunEventType.Sunlit:
        return 0
      case SatelliteSunEventType.Transition:
        return 1
      case SatelliteSunEventType.Eclipse:
        return 2
    }
  }

  // Accumulate boundary times together with the regime that begins at each one.
  // The first entry is always the window start with the regime observed there.
  const initialRegime = eclipseRegimeAt(satrec, startMs)

  // If the satellite is already decayed at the window start there are no events.
  if (initialRegime === null) {
    console.warn(`Satellite ${omm.OBJECT_ID} orbit has decayed as of: ${startDateTime.toISO()}`)
    return []
  }

  type Segment = { startMs: number; regime: SatelliteSunEventType }
  const segments: Segment[] = [{ startMs, regime: initialRegime }]

  // Locate the boundary crossing(s) between two adjacent coarse samples of
  // differing regime and append the resulting segment(s). Because Sunlit and
  // Eclipse are separated by Transition, a direct Sunlit<->Eclipse change over a
  // single coarse interval implies both the Outer and Inner boundaries lie
  // within it; we resolve both and emit the intervening Transition segment.
  const appendBoundaries = (
    fromRegime: SatelliteSunEventType,
    toRegime: SatelliteSunEventType,
    aMs: number,
    bMs: number,
  ): void => {
    const fromRank = regimeRank(fromRegime)
    const toRank = regimeRank(toRegime)

    // Build the ordered list of boundaries crossed as we move from fromRegime
    // to toRegime, each paired with the regime entered after crossing it.
    const crossings: { boundary: EclipseBoundary; entering: SatelliteSunEventType }[] = []

    if (toRank > fromRank) {
      // Becoming more shadowed: Sunlit -> [Outer] -> Transition -> [Inner] -> Eclipse.
      if (fromRank < 1 && toRank >= 1) {
        crossings.push({ boundary: EclipseBoundary.Outer, entering: SatelliteSunEventType.Transition })
      }
      if (fromRank < 2 && toRank >= 2) {
        crossings.push({ boundary: EclipseBoundary.Inner, entering: SatelliteSunEventType.Eclipse })
      }
    } else {
      // Becoming more sunlit: Eclipse -> [Inner] -> Transition -> [Outer] -> Sunlit.
      if (fromRank > 1 && toRank <= 1) {
        crossings.push({ boundary: EclipseBoundary.Inner, entering: SatelliteSunEventType.Transition })
      }
      if (fromRank > 0 && toRank <= 0) {
        crossings.push({ boundary: EclipseBoundary.Outer, entering: SatelliteSunEventType.Sunlit })
      }
    }

    // The final crossing's entered regime must equal toRegime; overwrite it so
    // the segment regime is exactly the coarsely-observed regime.
    if (crossings.length > 0) {
      crossings[crossings.length - 1].entering = toRegime
    }

    for (const crossing of crossings) {
      const crossingMs = refineBoundary(aMs, bMs, crossing.boundary)
      const clampedMs = Math.min(Math.max(crossingMs, aMs), bMs)
      segments.push({ startMs: clampedMs, regime: crossing.entering })
    }
  }

  // <----------------------------------------------------------------------->
  // COARSE SCAN
  //
  // Walk the window one coarse step at a time, classifying each sample's
  // regime. On any regime change between adjacent samples, refine the boundary
  // crossing(s) with Brent's method. If a sample cannot be propagated the orbit
  // has decayed: the scan stops and the trailing segment is truncated there.
  // <----------------------------------------------------------------------->

  let prevMs = startMs
  let prevRegime = initialRegime
  let decayMs: number | null = null

  let cursorMs = startMs + stepMs
  while (cursorMs < stopMs + stepMs) {
    const sampleMs = Math.min(cursorMs, stopMs)
    const regime = eclipseRegimeAt(satrec, sampleMs)

    if (regime === null) {
      // Orbit decayed somewhere in (prevMs, sampleMs]. Bisect to locate the
      // decay time so the final segment ends precisely there.
      decayMs = findDecayTime(satrec, prevMs, sampleMs, maxIterations)
      break
    }

    if (regime !== prevRegime) {
      appendBoundaries(prevRegime, regime, prevMs, sampleMs)
      prevRegime = regime
    }

    if (sampleMs === stopMs) {
      break
    }

    prevMs = sampleMs
    cursorMs += stepMs
  }

  // <----------------------------------------------------------------------->
  // ASSEMBLE EVENTS
  //
  // Convert the ordered segments into contiguous events with overlapping
  // timestamps (each event's stop is the next event's start). The window is
  // fully tiled: the last event ends at stopMs, or at the decay time if the
  // orbit decayed within the window.
  // <----------------------------------------------------------------------->

  const finalMs = decayMs ?? stopMs

  const events: SatelliteSunEvent[] = []
  for (let i = 0; i < segments.length; i++) {
    const segmentStartMs = segments[i].startMs
    const segmentStopMs = i + 1 < segments.length ? segments[i + 1].startMs : finalMs

    // Skip zero (or inverted) length segments that can arise if a refined
    // boundary coincides with the window edge or a neighbouring boundary.
    if (segmentStopMs <= segmentStartMs) {
      continue
    }

    events.push({
      eventType: segments[i].regime,
      start: formatTimestamp(DateTime.fromMillis(segmentStartMs, { zone: "utc" }), options.timestampFormat!),
      stop: formatTimestamp(DateTime.fromMillis(segmentStopMs, { zone: "utc" }), options.timestampFormat!),
      duration: (segmentStopMs - segmentStartMs) / 1000,
    })
  }

  return events
}

// <--------------------------------------------------------------------------->

// Re-export the public interfaces so consumers can import them from the module root
export type {
  Orbit,
  Position,
  SatelliteObservation,
  SatelliteSunEvent,
  SatelliteTransit,
  TransitEvent,
  Velocity,
  SatelliteObservationOptions,
  SatelliteSunEventOptions,
  SatelliteTransitOptions
} from "./interfaces"

export type {
  AstronomialUnits,
  Milliseconds,
  OrbitMeanElementsMessage,
  Seconds,
  Timestamp,
  TwoLineElement,
} from "./types"

export {
  AngularUnits,
  SatelliteSunEventType,
  TimestampFormat,
} from "./enums"

export type {
  Degrees,
  Radians,
  Kilometer,
  KilometerPerSecond
} from "satellite.js"
