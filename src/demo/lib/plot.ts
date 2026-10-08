import type { SatelliteObservation } from "../../lib/main"

// <-------------------------------------------------------------------------->
// Parameter catalog
//
// Each entry describes one quantity the Plot tab can chart: how to pull its
// value out of a SatelliteObservation, what unit/axis group it belongs to,
// and what color to render it in. "elevationRate" has no direct observation
// field — it's derived from consecutive elevation samples — so its `value`
// extractor is unused and buildPlotSeries special-cases it instead.
// <-------------------------------------------------------------------------->

export type PlotParameterKey =
  | "elevation"
  | "azimuth"
  | "elevationRate"
  | "slantRange"
  | "altitude"
  | "footprint"
  | "velocity"
  | "dopplerFactor"
  | "eclipseFactor"
  | "betaAngle"

/** Groups parameters that share comparable units onto the same y-axis. */
export type AxisGroup = "angle" | "rate" | "distance" | "velocity" | "ratio"

export interface PlotParameterDef {
  key: PlotParameterKey
  label: string
  unit: string
  axisGroup: AxisGroup
  /** Hex color used for the line, point, and legend swatch. */
  color: string
  /** Extracts the raw numeric value from an observation (or undefined). */
  value: (obs: SatelliteObservation) => number | undefined
}

export const PLOT_PARAMETERS: PlotParameterDef[] = [
  {
    key: "elevation",
    label: "Elevation",
    unit: "\u00B0",
    axisGroup: "angle",
    color: "#2563eb",
    value: (o) => o.elevation as number | undefined,
  },
  {
    key: "azimuth",
    label: "Azimuth",
    unit: "\u00B0",
    axisGroup: "angle",
    color: "#16a34a",
    value: (o) => o.azimuth as number | undefined,
  },
  {
    key: "elevationRate",
    label: "Elevation Rate",
    unit: "\u00B0/s",
    axisGroup: "rate",
    color: "#ea580c",
    value: () => undefined, // derived in buildPlotSeries
  },
  {
    key: "slantRange",
    label: "Slant Range",
    unit: "km",
    axisGroup: "distance",
    color: "#0891b2",
    value: (o) => o.slantRange,
  },
  {
    key: "altitude",
    label: "Altitude",
    unit: "km",
    axisGroup: "distance",
    color: "#be0000",
    value: (o) => o.position?.geo?.height,
  },
  {
    key: "footprint",
    label: "Footprint",
    unit: "km",
    axisGroup: "distance",
    color: "#64748b",
    value: (o) => o.footprint,
  },
  {
    key: "velocity",
    label: "Velocity",
    unit: "km/s",
    axisGroup: "velocity",
    color: "#059669",
    value: (o) => o.orbit?.velocity,
  },
  {
    key: "dopplerFactor",
    label: "Doppler Factor",
    unit: "",
    axisGroup: "ratio",
    color: "#d97706",
    value: (o) => o.dopplerFactor,
  },
  {
    key: "eclipseFactor",
    label: "Eclipse Factor",
    unit: "",
    axisGroup: "ratio",
    color: "#7c3aed",
    value: (o) => o.eclipseFactor,
  },
  {
    key: "betaAngle",
    label: "Beta Angle",
    unit: "\u00B0",
    axisGroup: "angle",
    color: "#db2777",
    value: (o) => o.betaAngle as number | undefined,
  },
]

export function plotParameter(key: PlotParameterKey): PlotParameterDef {
  const def = PLOT_PARAMETERS.find((d) => d.key === key)
  if (!def) throw new Error(`Unknown plot parameter: ${key}`)
  return def
}

/** The distinct axis groups spanned by a set of selected parameters, in a
 *  stable (first-seen) order so axis placement doesn't jump around as
 *  parameters are toggled on and off. */
export function axisGroupsForKeys(keys: PlotParameterKey[]): AxisGroup[] {
  return Array.from(new Set(keys.map((k) => plotParameter(k).axisGroup)))
}

export const AXIS_GROUP_LABELS: Record<AxisGroup, string> = {
  angle: "Degrees (\u00B0)",
  rate: "Degrees/sec (\u00B0/s)",
  distance: "Kilometers (km)",
  velocity: "Kilometers/sec (km/s)",
  ratio: "Ratio (0\u20131)",
}

/** A manual y-axis bound override; either end left `undefined` stays auto. */
export interface AxisRange {
  min?: number
  max?: number
}

export type AxisRangeMap = Partial<Record<AxisGroup, AxisRange>>

// <-------------------------------------------------------------------------->
// Time range sampling
//
// The Plot tab samples a fixed number of points across the selected duration
// rather than letting the caller pick a raw step size, which keeps both the
// chart and the (potentially expensive) batch computation responsive
// regardless of how long a window is selected.
// <-------------------------------------------------------------------------->

export const PLOT_DURATION_OPTIONS: {
  value: string
  label: string
  seconds: number
}[] = [
  { value: "15m", label: "15 minutes", seconds: 15 * 60 },
  { value: "30m", label: "30 minutes", seconds: 30 * 60 },
  { value: "1h", label: "1 hour", seconds: 3600 },
  { value: "3h", label: "3 hours", seconds: 3 * 3600 },
  { value: "6h", label: "6 hours", seconds: 6 * 3600 },
  { value: "12h", label: "12 hours", seconds: 12 * 3600 },
  { value: "24h", label: "24 hours", seconds: 24 * 3600 },
]

const TARGET_SAMPLE_COUNT = 300
const MIN_STEP_SECONDS = 1

export function plotDurationSeconds(value: string): number {
  return (
    PLOT_DURATION_OPTIONS.find((o) => o.value === value)?.seconds ?? 3600
  )
}

/** Build the list of sample instants (UTC ms) spanning a duration. */
export function buildPlotTimestamps(
  startMs: number,
  durationSeconds: number,
): number[] {
  const stepMs =
    Math.max(MIN_STEP_SECONDS, durationSeconds / TARGET_SAMPLE_COUNT) * 1000
  const stopMs = startMs + durationSeconds * 1000
  const timestamps: number[] = []
  for (let ms = startMs; ms < stopMs; ms += stepMs) {
    timestamps.push(Math.round(ms))
  }
  timestamps.push(stopMs)
  return timestamps
}

// <-------------------------------------------------------------------------->
// Series extraction
// <-------------------------------------------------------------------------->

export type PlotSeries = Partial<Record<PlotParameterKey, (number | null)[]>>

/**
 * Extract one array of samples per selected parameter from a batch of
 * observations. Decayed samples and missing fields (e.g. observer look
 * angles when no observer was supplied) become `null`, which renders as a
 * gap in the chart rather than a misleading zero.
 */
export function buildPlotSeries(
  observations: SatelliteObservation[],
  timestamps: number[],
  selectedKeys: PlotParameterKey[],
): PlotSeries {
  const series: PlotSeries = {}

  const elevationValues = observations.map((o) =>
    !o.decayed && typeof o.elevation === "number"
      ? (o.elevation as number)
      : null,
  )

  for (const key of selectedKeys) {
    if (key === "elevationRate") {
      series[key] = centralDifference(elevationValues, timestamps)
      continue
    }
    const def = plotParameter(key)
    series[key] = observations.map((o) => {
      if (o.decayed) return null
      const v = def.value(o)
      return typeof v === "number" && !Number.isNaN(v) ? v : null
    })
  }

  return series
}

/**
 * Numerically differentiate `values` with respect to `timestamps` (ms),
 * returning a rate in units/second. Uses a central difference where both
 * neighbors are available, falling back to a one-sided difference at the
 * edges of the series or around a gap.
 */
function centralDifference(
  values: (number | null)[],
  timestamps: number[],
): (number | null)[] {
  const rates: (number | null)[] = new Array(values.length).fill(null)

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) continue

    const prev = i - 1 >= 0 ? values[i - 1] : null
    const next = i + 1 < values.length ? values[i + 1] : null

    if (prev != null && next != null) {
      const dtSeconds = (timestamps[i + 1] - timestamps[i - 1]) / 1000
      rates[i] = (next - prev) / dtSeconds
    } else if (next != null) {
      const dtSeconds = (timestamps[i + 1] - timestamps[i]) / 1000
      rates[i] = (next - v) / dtSeconds
    } else if (prev != null) {
      const dtSeconds = (timestamps[i] - timestamps[i - 1]) / 1000
      rates[i] = (v - prev) / dtSeconds
    }
  }

  return rates
}
