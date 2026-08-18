import {
  satelliteObservation,
  satelliteTransits,
  OrbitMeanElementsMessage,
  TwoLineElement,
  SatelliteTransit,
} from '../src/lib/main'
import { DateTime, Duration } from 'luxon'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, extname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Observer location
 */
const observer = {
  geo: {
    latitude: 40.014984,
    longitude: -105.270546,
    height: 1.655,
  },
}

/**
 * A single satellite loaded from a resource file. TLE resources are stored as
 * raw two-line element strings while OMM resources are stored as JSON.
 */
type BenchmarkTarget = {
  /** Display name derived from the resource file name */
  label: string
  /** Resource type: 'omm' (JSON) or 'tle' (string) */
  kind: 'omm' | 'tle'
  /** Parsed satellite elements accepted by the jspredict API */
  elements: OrbitMeanElementsMessage | TwoLineElement
  /** Object name for reporting */
  name: string
  /** NORAD catalog id for reporting */
  noradId: string
  /** Element set epoch (ISO string) used to anchor the benchmark windows */
  epoch: string
}

/**
 * Load every OMM (*.json) resource from resources/omm.
 */
function loadOmmTargets(): BenchmarkTarget[] {
  const dir = join(__dirname, 'resources', 'omm')
  return readResourceFiles(dir, '.json').map((file) => {
    const omm = JSON.parse(readFileSync(file, 'utf-8')) as OrbitMeanElementsMessage
    return {
      label: basename(file),
      kind: 'omm',
      elements: omm,
      name: omm.OBJECT_NAME ?? basename(file, '.json'),
      noradId: String(omm.NORAD_CAT_ID ?? 'unknown'),
      epoch: omm.EPOCH,
    }
  })
}

/**
 * Load every TLE resource from resources/tle. TLE files may contain either a
 * bare 2-line element set or a 3-line set including the satellite name.
 */
function loadTleTargets(): BenchmarkTarget[] {
  const dir = join(__dirname, 'resources', 'tle')
  return readResourceFiles(dir, '.tle', '.txt').map((file) => {
    const tle = readFileSync(file, 'utf-8').trim()
    const lines = tle.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const [nameLine, line1] = lines.length === 3 ? lines : ['', lines[0]]

    // Parse the epoch out of TLE line 1 (columns 19-32: two-digit year + day of year)
    const epochField = line1.substring(18, 32).trim()
    const twoDigitYear = Number(epochField.substring(0, 2))
    const dayOfYear = Number(epochField.substring(2))
    const fullYear = twoDigitYear < 57 ? 2000 + twoDigitYear : 1900 + twoDigitYear
    const epoch = DateTime.fromObject({ year: fullYear }, { zone: 'utc' })
      .plus(Duration.fromObject({ days: dayOfYear - 1 }))
      .toISO() as string

    // NORAD id lives in columns 3-7 of line 1
    const noradId = line1.substring(2, 7).trim()
    const name = nameLine.replace(/^0\s+/, '').trim() || basename(file, extname(file))

    return {
      label: basename(file),
      kind: 'tle',
      elements: tle,
      name,
      noradId,
      epoch,
    }
  })
}

/**
 * Return the absolute paths of every file in `dir` matching one of the given
 * extensions. Missing directories are treated as empty so the script keeps
 * running even if one resource folder has not been populated yet.
 */
function readResourceFiles(dir: string, ...extensions: string[]): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => extensions.includes(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name))
}

/**
 * Benchmark how long it takes to generate a satellite observation at every step
 * over a 30 day window (1 observation per 10 minutes).
 */
function benchmarkObservations(target: BenchmarkTarget): void {
  const startTime = DateTime.fromISO(target.epoch, { zone: 'utc' })
  const endTime = startTime.plus(Duration.fromObject({ days: 30 }))

  const stepMs = Duration.fromObject({ minute: 10 }).toMillis()
  const observationCount = Math.round((endTime.toMillis() - startTime.toMillis()) / stepMs)

  console.log('=== Satellite Observation Benchmark ===')
  console.log('Inputs:')
  console.log(`    satellite:   ${target.name} (NORAD ${target.noradId})`)
  console.log(`    source:      ${target.kind.toUpperCase()} (${target.label})`)
  console.log(`    observer:    lat=${observer.geo.latitude}°, lon=${observer.geo.longitude}°, height=${observer.geo.height} km`)
  console.log(`    startTime:   ${startTime.toISO()}`)
  console.log(`    endTime:     ${endTime.toISO()}`)
  console.log(`    step:        ${stepMs / 1000 / 60} min`)
  console.log(`    samples:     ${observationCount}`)
  console.log('')

  const benchmarkStart = performance.now()
  for (let epoch = startTime.toMillis(); epoch < endTime.toMillis(); epoch += stepMs) {
    satelliteObservation(target.elements as OrbitMeanElementsMessage, epoch, observer)
  }
  const benchmarkDuration = performance.now() - benchmarkStart

  console.log(`Generated ${observationCount} satellite observations in ${benchmarkDuration.toFixed(2)} ms`)
  console.log(`Average: ${(benchmarkDuration / observationCount).toFixed(4)} ms/observation`)
  console.log(`Throughput: ${Math.round(observationCount / (benchmarkDuration / 1000)).toLocaleString()} observations/sec`)
}

/**
 * Benchmark how long it takes to generate 30 days worth of satellite transits
 * for the observer location.
 */
function benchmarkTransits(target: BenchmarkTarget): void {
  const transitStart = DateTime.fromISO(target.epoch, { zone: 'utc' })
  const transitEnd = transitStart.plus(Duration.fromObject({ days: 30 }))
  const minElevationAngle = 2

  console.log('\n=== Satellite Transit Benchmark ===')
  console.log('Inputs:')
  console.log(`    satellite:      ${target.name} (NORAD ${target.noradId})`)
  console.log(`    source:         ${target.kind.toUpperCase()} (${target.label})`)
  console.log(`    observer:       lat=${observer.geo.latitude}°, lon=${observer.geo.longitude}°, height=${observer.geo.height} km`)
  console.log(`    startTime:      ${transitStart.toISO()}`)
  console.log(`    stopTime:       ${transitEnd.toISO()}`)
  console.log(`    window:         ${transitEnd.diff(transitStart, 'days').days} days`)
  console.log(`    minElevation:   ${minElevationAngle}°`)
  console.log('')

  const transitBenchmarkStart = performance.now()
  const transits = satelliteTransits(
    target.elements as OrbitMeanElementsMessage,
    transitStart,
    transitEnd,
    observer,
    minElevationAngle,
  )
  const transitBenchmarkDuration = performance.now() - transitBenchmarkStart

  console.log(`\nGenerated ${transits.length} satellite transits over 30 days in ${transitBenchmarkDuration.toFixed(2)} ms`)
  if (transits.length > 0) {
    console.log(`Average: ${(transitBenchmarkDuration / transits.length).toFixed(4)} ms/transit`)
    console.log(`Throughput: ${Math.round(transits.length / (transitBenchmarkDuration / 1000)).toLocaleString()} transits/sec`)
  }

  reportTransitMetrics(transits)
}

/**
 * Pretty-print a single transit and all of its event metadata.
 */
function describeTransit(label: string, transit: SatelliteTransit): void {
  const event = (name: string, e: SatelliteTransit['aos']) =>
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

/**
 * Aggregate and print transit metrics across all transits.
 */
function reportTransitMetrics(transits: SatelliteTransit[]): void {
  if (transits.length === 0) {
    return
  }

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

// <--------------------------------------------------------------------------->
// Entry point: discover every resource file and run both benchmarks against it.
// <--------------------------------------------------------------------------->

const targets = [...loadOmmTargets(), ...loadTleTargets()]

if (targets.length === 0) {
  console.error('No benchmark resources found in resources/omm or resources/tle')
  process.exit(1)
}

console.log(`Running benchmarks against ${targets.length} resource file(s)\n`)

for (const target of targets) {
  console.log('\n' + '#'.repeat(72))
  console.log(`# ${target.name} (NORAD ${target.noradId}) — ${target.kind.toUpperCase()}: ${target.label}`)
  console.log('#'.repeat(72) + '\n')

  benchmarkObservations(target)
  benchmarkTransits(target)
}
