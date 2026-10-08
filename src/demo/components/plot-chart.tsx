import { useMemo } from "react"
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type ScriptableScaleContext,
} from "chart.js"
import { Line } from "react-chartjs-2"

import {
  AXIS_GROUP_LABELS,
  axisGroupsForKeys,
  plotParameter,
  type AxisRangeMap,
  type PlotParameterKey,
  type PlotSeries,
} from "@/lib/plot"
import type { TimeZoneMode } from "@/transits"

ChartJS.register(LinearScale, LineElement, PointElement, Tooltip, Legend)

/** Dash pattern (px on, px off) applied to every gridline. */
const GRID_DASH = [6, 4]

/**
 * Read a CSS custom property's resolved value off the document root. Chart.js
 * draws to a <canvas>, so grid lines, tick labels, etc. can't pick up theme
 * colors via CSS the way the rest of the UI does — they have to be resolved
 * to concrete color strings and passed into the chart config instead.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

/** Short clock-time label used for both axis ticks and tooltip titles. */
function formatTick(ms: number, tz: TimeZoneMode): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(tz === "utc" ? { timeZone: "UTC" } : {}),
  }).format(new Date(ms))
}

/**
 * Renders the selected parameters as a multi-axis line chart. Parameters are
 * grouped onto a shared y-axis per unit (degrees, km, km/s, ratio, ...) so
 * e.g. elevation and azimuth share one axis while slant range gets its own,
 * rather than every series fighting for the same scale.
 */
export function PlotChart({
  timestamps,
  series,
  selectedKeys,
  tz,
  axisRanges,
}: {
  timestamps: number[]
  series: PlotSeries
  selectedKeys: PlotParameterKey[]
  tz: TimeZoneMode
  /** Manual min/max overrides per axis group; omitted bounds stay auto. */
  axisRanges?: AxisRangeMap
}) {
  const data = useMemo(
    () => ({
      datasets: selectedKeys.map((key) => {
        const def = plotParameter(key)
        const values = series[key] ?? []
        return {
          label: def.unit ? `${def.label} (${def.unit})` : def.label,
          data: timestamps.map((t, i) => ({ x: t, y: values[i] ?? null })),
          borderColor: def.color,
          backgroundColor: def.color,
          yAxisID: `y-${def.axisGroup}`,
          spanGaps: false,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.15,
        }
      }),
    }),
    [timestamps, series, selectedKeys],
  )

  const options = useMemo<ChartOptions<"line">>(() => {
    const axisGroups = axisGroupsForKeys(selectedKeys)

    const gridColor = cssVar("--chart-grid", "rgba(148, 163, 184, 0.3)")
    const textColor = cssVar("--chart-text", "#9ca0a8")

    // Chart.js draws an extra solid line along each scale's outer edge that
    // ignores any dash setting, so it's switched off entirely (`display:
    // false`) — otherwise it shows up as a stray solid line at the bottom of
    // the plot. `border.dash` still applies to the gridlines that cross the
    // chart area, which is how the gridlines get dashed.
    const border = { display: false, dash: GRID_DASH }

    const scales: ChartOptions<"line">["scales"] = {
      x: {
        type: "linear",
        border,
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback: (value) => formatTick(Number(value), tz),
          maxRotation: 0,
          autoSkipPadding: 16,
        },
      },
    }

    axisGroups.forEach((group, i) => {
      const range = axisRanges?.[group]
      scales[`y-${group}`] = {
        type: "linear",
        position: i % 2 === 0 ? "left" : "right",
        title: { display: true, text: AXIS_GROUP_LABELS[group], color: textColor },
        border: {
          ...border,
          // Draw the y = 0 gridline solid (empty dash pattern) so it reads as
          // the horizontal reference axis, while every other gridline stays
          // dashed. The color is uniform across the whole grid.
          dash: (ctx: ScriptableScaleContext) =>
            ctx.tick?.value === 0 ? [] : GRID_DASH,
        },
        grid: {
          color: gridColor,
          // Only the first axis group paints gridlines across the plot, so
          // stacked axes don't overlay competing grids (and competing zero
          // lines) on top of each other.
          drawOnChartArea: i === 0,
        },
        ticks: { color: textColor },
        min: range?.min,
        max: range?.max,
      }
    })

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales,
      plugins: {
        legend: { position: "bottom", labels: { color: textColor } },
        tooltip: {
          callbacks: {
            title: (items) => formatTick(Number(items[0].parsed.x), tz),
          },
        },
      },
    }
  }, [selectedKeys, tz, axisRanges])

  return (
    <div className="h-96">
      <Line data={data} options={options} />
    </div>
  )
}
