import type {
  OrbitMeanElementsMessage,
  TwoLineElement,
} from "../lib/main"
import { SatelliteSunEventType } from "../lib/main"

export type ParsedElements = {
  elements: TwoLineElement | OrbitMeanElementsMessage
  name: string
  /** Element-set epoch as an ISO8601 UTC string, if it could be determined. */
  epoch?: string
}

/**
 * Derive the epoch (ISO8601 UTC) from a TLE line 1. The epoch is encoded in
 * columns 19-32 as a 2-digit year plus fractional day-of-year.
 */
function tleEpochIso(line1: string): string | undefined {
  const epochYear = Number(line1.substring(18, 20))
  const epochDay = Number(line1.substring(20, 32))
  if (Number.isNaN(epochYear) || Number.isNaN(epochDay)) return undefined
  const fullYear = epochYear < 57 ? epochYear + 2000 : epochYear + 1900
  // Jan 1 00:00 UTC of the epoch year, plus (dayOfYear - 1) days.
  const base = Date.UTC(fullYear, 0, 1)
  const ms = base + (epochDay - 1) * 86400000
  return new Date(ms).toISOString()
}

/**
 * Detect whether the pasted/uploaded text is an OMM (JSON) or a TLE (line based)
 * and return the parsed element set plus a display name.
 */
export function parseElementSet(raw: string): ParsedElements {
  const text = raw.trim()
  if (!text) {
    throw new Error("No element set provided.")
  }

  // Try OMM (JSON) first.
  if (text.startsWith("{") || text.startsWith("[")) {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      throw new Error(
        `Input looks like JSON but could not be parsed: ${(err as Error).message}`,
      )
    }
    // Space-Track's OMM endpoint returns an array of OMM objects.
    const omm = (Array.isArray(json) ? json[0] : json) as OrbitMeanElementsMessage
    if (!omm || !omm.EPOCH || omm.MEAN_MOTION == null) {
      throw new Error(
        "JSON does not look like a valid OMM (missing EPOCH / MEAN_MOTION).",
      )
    }
    const epochDate = new Date(String(omm.EPOCH))
    return {
      elements: omm,
      name: (omm.OBJECT_NAME as string) || String(omm.NORAD_CAT_ID) || "Unknown",
      epoch: Number.isNaN(epochDate.getTime())
        ? undefined
        : epochDate.toISOString(),
    }
  }

  // Otherwise treat as a TLE. Accept an optional leading name (line 0).
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const line1Index = lines.findIndex((l) => l.startsWith("1 "))
  const line2Index = lines.findIndex((l) => l.startsWith("2 "))

  if (line1Index === -1 || line2Index === -1) {
    throw new Error(
      "Could not find TLE lines. Provide a TLE (lines starting with '1 ' and '2 ') or an OMM JSON object.",
    )
  }

  const nameLine =
    line1Index > 0 ? lines[line1Index - 1].replace(/^0\s+/, "") : "Unknown"

  const tle = `${nameLine}\n${lines[line1Index]}\n${lines[line2Index]}`

  return { elements: tle, name: nameLine, epoch: tleEpochIso(lines[line1Index]) }
}

// <-------------------------------------------------------------------------->
// Formatting helpers
// <-------------------------------------------------------------------------->

export function formatUtc(iso: string): string {
  // Timestamps come back as ISO8601 UTC strings; render readably.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

/** Which timezone to render timestamps in for the results table. */
export type TimeZoneMode = "local" | "utc"

/**
 * Render an ISO8601 UTC timestamp in either the browser's local timezone or
 * UTC, including the timezone identifier (e.g. "PDT" or "UTC").
 */
export function formatTime(iso: string, mode: TimeZoneMode): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
    ...(mode === "utc" ? { timeZone: "UTC" } : {}),
  }).format(d)
}

/**
 * A short label for a timezone mode (e.g. "PDT" for local or "UTC").
 */
export function timezoneLabel(mode: TimeZoneMode): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
    ...(mode === "utc" ? { timeZone: "UTC" } : {}),
  }).formatToParts(new Date())
  const tz = parts.find((p) => p.type === "timeZoneName")?.value
  return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

export function formatAngle(deg: number): string {
  return `${deg.toFixed(1)}\u00B0`
}

export function formatRange(km: number): string {
  return `${km.toFixed(0)} km`
}

export function formatSunlit(sunlit: boolean): string {
  return sunlit ? "Sunlit" : "Eclipse"
}

export function formatEclipseFactor(factor: number): string {
  return `${(factor * 100).toFixed(0)}%`
}

/** A human-readable label for a sun event regime. */
export function formatSunEventType(eventType: SatelliteSunEventType): string {
  switch (eventType) {
    case SatelliteSunEventType.Sunlit:
      return "Sunlit"
    case SatelliteSunEventType.Transition:
      return "Transition"
    case SatelliteSunEventType.Eclipse:
      return "Eclipse"
    default:
      return String(eventType)
  }
}

// <-------------------------------------------------------------------------->
// Wall-clock <-> instant conversion for the date/time picker
//
// The DateTimePicker operates on a plain Date whose *browser-local* fields
// (getFullYear/getHours/...) represent the intended wall-clock in the selected
// timezone. These helpers translate between that wall-clock Date and an
// absolute instant (ms since the Unix epoch, UTC).
// <-------------------------------------------------------------------------->

/**
 * Build a wall-clock Date for an instant `ms` as it appears in `mode`. The
 * returned Date's browser-local fields equal the wall-clock in that timezone,
 * so date-fns `format` renders the intended values.
 */
export function msToWallClock(ms: number, mode: TimeZoneMode): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(mode === "utc" ? { timeZone: "UTC" } : {}),
  }).formatToParts(new Date(ms))
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const hour = g("hour") === 24 ? 0 : g("hour")
  return new Date(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second"))
}

/**
 * Interpret a wall-clock Date's browser-local fields as a wall-clock in `mode`
 * and return the corresponding absolute instant (UTC ms).
 */
export function wallClockToMs(date: Date, mode: TimeZoneMode): number {
  const asUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  )
  if (mode === "utc") return asUtc
  // For local mode, find the zone offset by formatting the tentative instant
  // back to local wall time and correcting.
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(asUtc))
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const hour = g("hour") === 24 ? 0 : g("hour")
  const shownAsUtc = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    hour,
    g("minute"),
    g("second"),
  )
  const offset = shownAsUtc - asUtc
  return asUtc - offset
}
