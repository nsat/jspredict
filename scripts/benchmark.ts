import { satelliteObservation, satelliteTransits, OrbitMeanElementsMessage } from '../src/main';
import { DateTime, Duration } from 'luxon';

/**
 * ISS Orbit Mean Elements Message
 */
const omm = {
  "CCSDS_OMM_VERS": "3.0",
  "COMMENT": "GENERATED VIA SPACE-TRACK.ORG API",
  "CREATION_DATE": "2026-08-13T07:47:17",
  "ORIGINATOR": "18 SPCS",
  "OBJECT_NAME": "ISS (ZARYA)",
  "OBJECT_ID": "1998-067A",
  "CENTER_NAME": "EARTH",
  "REF_FRAME": "TEME",
  "TIME_SYSTEM": "UTC",
  "MEAN_ELEMENT_THEORY": "SGP4",
  "EPOCH": "2026-08-13T03:34:14.082240",
  "MEAN_MOTION": "15.49426097",
  "ECCENTRICITY": "0.00075330",
  "INCLINATION": "51.6324",
  "RA_OF_ASC_NODE": "18.1827",
  "ARG_OF_PERICENTER": "41.6914",
  "MEAN_ANOMALY": "318.4648",
  "EPHEMERIS_TYPE": "0",
  "CLASSIFICATION_TYPE": "U",
  "NORAD_CAT_ID": "25544",
  "ELEMENT_SET_NO": "999",
  "REV_AT_EPOCH": "58058",
  "BSTAR": "0.00007560600000",
  "MEAN_MOTION_DOT": "0.00003778",
  "MEAN_MOTION_DDOT": "0.0000000000000",
  "SEMIMAJOR_AXIS": "6796.541",
  "PERIOD": "92.938",
  "APOAPSIS": "423.526",
  "PERIAPSIS": "413.286",
  "OBJECT_TYPE": "PAYLOAD",
  "RCS_SIZE": "LARGE",
  "COUNTRY_CODE": "CIS",
  "LAUNCH_DATE": "1998-11-20",
  "SITE": "TTMTR",
  "DECAY_DATE": null,
  "FILE": "5321051",
  "GP_ID": "340390367",
  "TLE_LINE0": "0 ISS (ZARYA)",
  "TLE_LINE1": "1 25544U 98067A   26225.14877410  .00003778  00000-0  75606-4 0  9992",
  "TLE_LINE2": "2 25544  51.6324  18.1827 0007533  41.6914 318.4648 15.49426097580580"
}

/**
 * Observer location
 */
const observer = {
  geo: {
    latitude: 40.014984,
    longitude: -105.270546,
    height: 1.655
  }
}

/**
 * Benchmark how long it takes to generate 1440 observations (i.e 1 observation per minute over 24 hours)
 */
const startTime = DateTime.fromISO(omm.EPOCH, { zone: 'utc' })
const endTime = startTime.plus(Duration.fromObject({days: 30}))

const stepMs = Duration.fromObject({ minute: 10 }).toMillis()
const observationCount = Math.round((endTime.toMillis() - startTime.toMillis()) / stepMs)

console.log('=== Satellite Observation Benchmark ===')
console.log('Inputs:')
console.log(`    satellite:   ${omm.OBJECT_NAME} (NORAD ${omm.NORAD_CAT_ID})`)
console.log(`    observer:    lat=${observer.geo.latitude}°, lon=${observer.geo.longitude}°, height=${observer.geo.height} km`)
console.log(`    startTime:   ${startTime.toISO()}`)
console.log(`    endTime:     ${endTime.toISO()}`)
console.log(`    step:        ${stepMs / 1000 / 60} min`)
console.log(`    samples:     ${observationCount}`)
console.log('')

const benchmarkStart = performance.now()
for (let epoch = startTime.toMillis(); epoch < endTime.toMillis(); epoch += stepMs) {
  satelliteObservation(omm as OrbitMeanElementsMessage, epoch, observer)
}
const benchmarkDuration = performance.now() - benchmarkStart

console.log(`Generated ${observationCount} satellite observations in ${benchmarkDuration.toFixed(2)} ms`)
console.log(`Average: ${(benchmarkDuration / observationCount).toFixed(4)} ms/observation`)
console.log(`Throughput: ${Math.round(observationCount / (benchmarkDuration / 1000)).toLocaleString()} observations/sec`)

/**
 * Benchmark how long it takes to generate 30 days worth of satellite transits
 * for the observer location.
 */
const transitStart = DateTime.fromISO(omm.EPOCH, { zone: 'utc' })
const transitEnd = transitStart.plus(Duration.fromObject({ days: 30 }))
const minElevationAngle = 2

console.log('\n=== Satellite Transit Benchmark ===')
console.log('Inputs:')
console.log(`    satellite:      ${omm.OBJECT_NAME} (NORAD ${omm.NORAD_CAT_ID})`)
console.log(`    observer:       lat=${observer.geo.latitude}°, lon=${observer.geo.longitude}°, height=${observer.geo.height} km`)
console.log(`    startTime:      ${transitStart.toISO()}`)
console.log(`    stopTime:       ${transitEnd.toISO()}`)
console.log(`    window:         ${transitEnd.diff(transitStart, 'days').days} days`)
console.log(`    minElevation:   ${minElevationAngle}°`)
console.log('')

const transitBenchmarkStart = performance.now()
const transits = satelliteTransits(
  omm as OrbitMeanElementsMessage,
  transitStart,
  transitEnd,
  observer,
  minElevationAngle,
)
const transitBenchmarkDuration = performance.now() - transitBenchmarkStart

console.log(`\nGenerated ${transits.length} satellite transits over 30 days in ${transitBenchmarkDuration.toFixed(2)} ms`)
console.log(`Average: ${(transitBenchmarkDuration / transits.length).toFixed(4)} ms/transit`)
console.log(`Throughput: ${Math.round(transits.length / (transitBenchmarkDuration / 1000)).toLocaleString()} transits/sec`)

/**
 * Pretty-print a single transit and all of its event metadata.
 */
function describeTransit(label: string, transit: (typeof transits)[number]): void {
  const event = (name: string, e: (typeof transit)['aos']) =>
    `    ${name.padEnd(5)} epoch=${e.epoch}  azimuth=${(e.azimuth as number).toFixed(3)}°  elevation=${(e.elevation as number).toFixed(3)}°  slantRange=${e.slantRange.toFixed(3)} km  dopplerFactor=${e.dopplerFactor.toFixed(6)}`

  console.log(`\n${label}:`)
  console.log(`    start=${transit.start}`)
  console.log(`    stop=${transit.stop}`)
  console.log(`    duration=${transit.duration.toFixed(2)} s (${(transit.duration / 60).toFixed(2)} min)`)
  console.log(event('aos', transit.aos))
  console.log(event('tca', transit.tca))
  console.log(event('peak', transit.peak))
  console.log(event('los', transit.los))
}

if (transits.length > 0) {
  // Aggregate metrics across all transits.
  const durations = transits.map((t) => t.duration)
  const peakElevations = transits.map((t) => t.peak.elevation as number)

  const longestTransit = transits.reduce((longest, t) => (t.duration > longest.duration ? t : longest))
  const shortestTransit = transits.reduce((shortest, t) => (t.duration < shortest.duration ? t : shortest))

  const totalDuration = durations.reduce((sum, d) => sum + d, 0)
  const averageDuration = totalDuration / transits.length
  const averagePeakElevation = peakElevations.reduce((sum, e) => sum + e, 0) / transits.length

  console.log(`\n--- Transit Metrics (${transits.length} transits over 30 days) ---`)
  console.log(`Total time in view: ${(totalDuration / 60).toFixed(2)} min`)
  console.log(`Average duration:   ${averageDuration.toFixed(2)} s (${(averageDuration / 60).toFixed(2)} min)`)
  console.log(`Average peak elev:  ${averagePeakElevation.toFixed(2)}°`)

  describeTransit('Longest transit', longestTransit)
  describeTransit('Shortest transit', shortestTransit)
}



