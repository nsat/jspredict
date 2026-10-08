import { useRef, useState } from "react"
import {
  ChevronRight,
  Code,
  LocateFixed,
  RotateCcw,
  Upload,
} from "lucide-react"

import {
  satelliteObservation,
  satelliteTransits,
  satelliteSunEvents,
  SatelliteSunEventType,
  TimestampFormat,
} from "../lib/main"
import type {
  Position,
  SatelliteObservation,
  SatelliteSunEvent,
  SatelliteTransit,
  TransitEvent,
} from "../lib/main"
import {
  formatAngle,
  formatDuration,
  formatEclipseFactor,
  formatRange,
  formatSunEventType,
  formatSunlit,
  formatTime,
  msToWallClock,
  parseElementSet,
  timezoneLabel,
  wallClockToMs,
  type TimeZoneMode,
} from "./transits"
import {
  axisGroupsForKeys,
  buildPlotSeries,
  buildPlotTimestamps,
  plotDurationSeconds,
  AXIS_GROUP_LABELS,
  PLOT_DURATION_OPTIONS,
  PLOT_PARAMETERS,
  type AxisGroup,
  type AxisRangeMap,
  type PlotParameterKey,
  type PlotSeries,
} from "./lib/plot"

import { PlotChart } from "@/components/plot-chart"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type Status = { message: string; kind: "info" | "error" | "success" } | null

const DURATION_DAYS: Record<string, number> = { "1": 1, "7": 7, "30": 30 }

const ISS_PLACEHOLDER = `0 ISS (ZARYA)
1 25544U 98067A   26219.02141064  .00004539  00000-0  89363-4 0  9992
2 25544  51.6324  48.5171 0007293  20.5996 339.5285 15.49370096579630`

function StatusText({ status }: { status: Status }) {
  if (!status) return null
  const color =
    status.kind === "error"
      ? "text-destructive"
      : status.kind === "success"
        ? "text-emerald-500"
        : "text-muted-foreground"
  return <p className={`text-sm ${color}`}>{status.message}</p>
}

const EVENT_LABELS: { key: keyof SatelliteTransit; label: string }[] = [
  { key: "aos", label: "Acquisition of Signal (AOS)" },
  { key: "tca", label: "Time of Closest Approach (TCA)" },
  { key: "peak", label: "Peak Elevation" },
  { key: "los", label: "Loss of Signal (LOS)" },
]

function EventDetails({
  transit,
  tz,
}: {
  transit: SatelliteTransit
  tz: TimeZoneMode
}) {
  const [raw, setRaw] = useState(false)
  return (
    <div className="grid gap-2">
      <RawToggle raw={raw} onToggle={() => setRaw((v) => !v)} />
      <div className="grid gap-3 rounded-md border bg-muted/40 p-4">
        {raw ? (
          <RawPre data={transit} />
        ) : (
          EVENT_LABELS.map(({ key, label }) => {
            const event = transit[key] as TransitEvent
            return (
              <div
                key={key}
                className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[16rem_1fr] sm:items-baseline sm:gap-4"
              >
                <span className="font-medium">{label}</span>
                <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[minmax(14rem,auto)_repeat(3,auto)]">
                  <div className="flex flex-col">
                    <dt>Time</dt>
                    <dd className="text-foreground whitespace-nowrap">
                      {formatTime(event.epoch as string, tz)}
                    </dd>
                  </div>
                  <div className="flex flex-col">
                    <dt>Azimuth</dt>
                    <dd className="text-foreground">
                      {formatAngle(event.azimuth as number)}
                    </dd>
                  </div>
                  <div className="flex flex-col">
                    <dt>Elevation</dt>
                    <dd className="text-foreground">
                      {formatAngle(event.elevation as number)}
                    </dd>
                  </div>
                  <div className="flex flex-col">
                    <dt>Range</dt>
                    <dd className="text-foreground">
                      {formatRange(event.slantRange)}
                    </dd>
                  </div>
                  <div className="flex flex-col">
                    <dt>Illumination</dt>
                    <dd className="text-foreground">
                      {formatSunlit(event.sunlit)}
                    </dd>
                  </div>
                  <div className="flex flex-col">
                    <dt>Eclipse</dt>
                    <dd className="text-foreground">
                      {formatEclipseFactor(event.eclipseFactor)}
                    </dd>
                  </div>
                </dl>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** Small toggle button that switches a result view between pretty and raw. */
function RawToggle({
  raw,
  onToggle,
}: {
  raw: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={onToggle}>
        <Code />
        {raw ? "Formatted" : "Raw"}
      </Button>
    </div>
  )
}

/** Pretty-printed JSON block. */
function RawPre({ data }: { data: unknown }) {
  return (
    <pre className="bg-background overflow-x-auto rounded-md border p-3 font-mono text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function TransitRow({
  transit,
  index,
  tz,
}: {
  transit: SatelliteTransit
  index: number
  tz: TimeZoneMode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <TableCell className="w-8">
          <ChevronRight
            className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </TableCell>
        <TableCell>{index + 1}</TableCell>
        <TableCell>{formatTime(transit.start as string, tz)}</TableCell>
        <TableCell>{formatTime(transit.stop as string, tz)}</TableCell>
        <TableCell>{formatDuration(transit.duration)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="p-3">
            <EventDetails transit={transit} tz={tz} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

/** A colored pill indicating the sun event regime. */
function SunEventBadge({ eventType }: { eventType: SatelliteSunEventType }) {
  const tone =
    eventType === SatelliteSunEventType.Sunlit
      ? "border-amber-500/40 text-amber-500"
      : eventType === SatelliteSunEventType.Eclipse
        ? "border-slate-500/40 text-slate-400"
        : "border-sky-500/40 text-sky-400"
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {formatSunEventType(eventType)}
    </span>
  )
}

function SunEventRow({
  event,
  index,
  tz,
}: {
  event: SatelliteSunEvent
  index: number
  tz: TimeZoneMode
}) {
  return (
    <TableRow>
      <TableCell>{index + 1}</TableCell>
      <TableCell>
        <SunEventBadge eventType={event.eventType} />
      </TableCell>
      <TableCell>{formatTime(event.start as string, tz)}</TableCell>
      <TableCell>{formatTime(event.stop as string, tz)}</TableCell>
      <TableCell>{formatDuration(event.duration)}</TableCell>
    </TableRow>
  )
}

// <-------------------------------------------------------------------------->
// Observation view
// <-------------------------------------------------------------------------->

function num(value: number | undefined, digits = 3, unit = ""): string {
  if (value == null || Number.isNaN(value)) return "\u2014"
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`
}

/** A labeled value shown in the observation summary grid. */
function Stat({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

function Vec3({
  vec,
  unit,
}: {
  vec?: { x: number; y: number; z: number }
  unit: string
}) {
  if (!vec) return <span className="text-muted-foreground">{"\u2014"}</span>
  return (
    <span className="font-mono text-xs">
      x {num(vec.x, 2)} · y {num(vec.y, 2)} · z {num(vec.z, 2)}{" "}
      <span className="text-muted-foreground">{unit}</span>
    </span>
  )
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "positive" | "negative"
}) {
  const cls =
    tone === "positive"
      ? "border-emerald-500/40 text-emerald-500"
      : tone === "negative"
        ? "border-destructive/40 text-destructive"
        : "text-muted-foreground"
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function ObservationView({
  observation,
  tz,
}: {
  observation: SatelliteObservation
  tz: TimeZoneMode
}) {
  const o = observation
  const geo = o.position?.geo
  const sunGeo = o.sunPosition?.geo
  const [raw, setRaw] = useState(false)

  return (
    <div className="grid gap-4">
      <RawToggle raw={raw} onToggle={() => setRaw((v) => !v)} />
      {raw ? (
        <RawPre data={o} />
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{o.name}</span>
        <Badge>NORAD {o.noradCatalogId}</Badge>
        <Badge>{o.id}</Badge>
        {o.orbitalModel && <Badge>{o.orbitalModel}</Badge>}
        {o.decayed ? (
          <Badge tone="negative">Decayed</Badge>
        ) : (
          <>
            <Badge tone={o.sunlit ? "positive" : "muted"}>
              {o.sunlit ? "Sunlit" : "Eclipsed"}
            </Badge>
            {o.geostationary && <Badge>Geostationary</Badge>}
          </>
        )}
      </div>

      {o.decayed ? (
        <p className="text-muted-foreground text-sm">
          This satellite's orbit has decayed as of{" "}
          {formatTime(o.epoch as string, tz)}.
        </p>
      ) : (
        <>
          <Section title="Epoch & Position">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Epoch" value={formatTime(o.epoch as string, tz)} />
              <Stat label="Latitude" value={num(geo?.latitude, 4, "\u00B0")} />
              <Stat label="Longitude" value={num(geo?.longitude, 4, "\u00B0")} />
              <Stat label="Altitude" value={num(geo?.height, 2, "km")} />
              <Stat label="Footprint" value={num(o.footprint, 1, "km")} />
              <Stat
                label="GMST"
                value={num(o.gmst as number, 4, "rad")}
              />
            </dl>
          </Section>

          {o.observerPosition && (
            <Section title="Observer Look Angles">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="Azimuth"
                  value={num(o.azimuth as number, 2, "\u00B0")}
                />
                <Stat
                  label="Elevation"
                  value={num(o.elevation as number, 2, "\u00B0")}
                />
                <Stat label="Slant range" value={num(o.slantRange, 1, "km")} />
                <Stat
                  label="Doppler factor"
                  value={num(o.dopplerFactor, 6)}
                />
              </dl>
            </Section>
          )}

          <Section title="Orbit">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Revolution #" value={o.orbit?.revolutionCount ?? "\u2014"} />
              <Stat
                label="Phase"
                value={num(o.orbit?.phase as number, 2, "\u00B0")}
              />
              <Stat label="Phase (0-256)" value={num(o.orbit?.phase256, 2)} />
              <Stat
                label="Velocity"
                value={num(o.orbit?.velocity, 3, "km/s")}
              />
            </dl>
          </Section>

          <Section title="State Vectors">
            <dl className="grid gap-3">
              <Stat label="Position (ECI)" value={<Vec3 vec={o.position?.eci} unit="km" />} />
              <Stat label="Position (ECEF)" value={<Vec3 vec={o.position?.ecef} unit="km" />} />
              <Stat label="Velocity (ECI)" value={<Vec3 vec={o.velocity?.eci} unit="km/s" />} />
              <Stat label="Velocity (ECEF)" value={<Vec3 vec={o.velocity?.ecef} unit="km/s" />} />
            </dl>
          </Section>

          <Section title="Sun Geometry">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Beta angle"
                value={num(o.betaAngle as number, 2, "\u00B0")}
              />
              <Stat label="Eclipse factor" value={num(o.eclipseFactor, 3)} />
              <Stat label="Sun latitude" value={num(sunGeo?.latitude, 2, "\u00B0")} />
              <Stat label="Sun longitude" value={num(sunGeo?.longitude, 2, "\u00B0")} />
            </dl>
          </Section>
        </>
      )}
        </>
      )}
    </div>
  )
}

export default function App() {
  const [elements, setElements] = useState("")
  const [lat, setLat] = useState("0.0")
  const [lon, setLon] = useState("0.0")
  const [height, setHeight] = useState("0.0")
  const [minEl, setMinEl] = useState("5")
  const [duration, setDuration] = useState("1")
  const [timezone, setTimezone] = useState<TimeZoneMode>("local")

  // Absolute start instant (UTC ms). Defaults to the current time.
  const [startMs, setStartMs] = useState<number>(() => Date.now())
  const startEditedRef = useRef(false)

  const [status, setStatus] = useState<Status>(null)
  const [fileStatus, setFileStatus] = useState<Status>(null)
  const [locateStatus, setLocateStatus] = useState<Status>(null)
  const [locating, setLocating] = useState(false)
  const [computing, setComputing] = useState(false)

  // Which mode's controls/results are active.
  const [mode, setMode] = useState<
    "transits" | "observation" | "sunEvents" | "plot"
  >("observation")

  const [resultName, setResultName] = useState<string | null>(null)
  const [transits, setTransits] = useState<SatelliteTransit[] | null>(null)
  const [observation, setObservation] = useState<SatelliteObservation | null>(
    null,
  )
  const [obsStatus, setObsStatus] = useState<Status>(null)
  const [observing, setObserving] = useState(false)

  const [sunEvents, setSunEvents] = useState<SatelliteSunEvent[] | null>(null)
  const [sunStatus, setSunStatus] = useState<Status>(null)
  const [computingSun, setComputingSun] = useState(false)

  const [plotDuration, setPlotDuration] = useState("1h")
  const [selectedParams, setSelectedParams] = useState<PlotParameterKey[]>([
    "elevation",
  ])
  const [plotResult, setPlotResult] = useState<{
    timestamps: number[]
    series: PlotSeries
    keys: PlotParameterKey[]
  } | null>(null)
  const [plotStatus, setPlotStatus] = useState<Status>(null)
  const [plotting, setPlotting] = useState(false)

  const [axisScaleMode, setAxisScaleMode] = useState<"auto" | "manual">(
    "auto",
  )
  const [axisRangeInputs, setAxisRangeInputs] = useState<
    Partial<Record<AxisGroup, { min: string; max: string }>>
  >({})

  const fileRef = useRef<HTMLInputElement>(null)

  function toggleParam(key: PlotParameterKey) {
    setSelectedParams((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  function setAxisRangeInput(
    group: AxisGroup,
    bound: "min" | "max",
    value: string,
  ) {
    setAxisRangeInputs((prev) => ({
      ...prev,
      [group]: { ...(prev[group] ?? { min: "", max: "" }), [bound]: value },
    }))
  }

  // The axis groups spanned by the currently selected parameters, used to
  // show one manual min/max control per group (only groups actually plotted
  // get a control). Resolved on every render, since it's just a few array
  // operations over a short list.
  const activeAxisGroups = axisGroupsForKeys(selectedParams)

  // Parse the manual range inputs into numeric overrides for the chart. An
  // empty field leaves that bound auto; switching back to "Auto" mode drops
  // the overrides entirely without needing to clear the inputs.
  const axisRanges: AxisRangeMap | undefined =
    axisScaleMode === "manual"
      ? activeAxisGroups.reduce<AxisRangeMap>((acc, group) => {
          const input = axisRangeInputs[group]
          const min = input?.min.trim() ? Number(input.min) : undefined
          const max = input?.max.trim() ? Number(input.max) : undefined
          acc[group] = {
            min: min != null && !Number.isNaN(min) ? min : undefined,
            max: max != null && !Number.isNaN(max) ? max : undefined,
          }
          return acc
        }, {})
      : undefined

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setElements(String(reader.result ?? ""))
      setFileStatus({ message: `Loaded ${file.name}`, kind: "info" })
    }
    reader.onerror = () =>
      setFileStatus({ message: `Failed to read ${file.name}`, kind: "error" })
    reader.readAsText(file)
  }

  function resetForm() {
    setElements("")
    setLat("0.0")
    setLon("0.0")
    setHeight("0.0")
    setMinEl("5")
    setDuration("1")
    setTimezone("local")
    startEditedRef.current = false
    setStartMs(Date.now())
    setStatus(null)
    setFileStatus(null)
    setLocateStatus(null)
    setResultName(null)
    setTransits(null)
    setObservation(null)
    setObsStatus(null)
    setSunEvents(null)
    setSunStatus(null)
    setPlotDuration("1h")
    setSelectedParams(["elevation"])
    setPlotResult(null)
    setPlotStatus(null)
    setAxisScaleMode("auto")
    setAxisRangeInputs({})
    if (fileRef.current) fileRef.current.value = ""
  }

  function getLocation() {
    if (!("geolocation" in navigator)) {
      setLocateStatus({
        message: "Geolocation is not supported by this browser.",
        kind: "error",
      })
      return
    }
    setLocating(true)
    setLocateStatus({ message: "Requesting location\u2026", kind: "info" })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords
        setLat(latitude.toFixed(6))
        setLon(longitude.toFixed(6))
        // Geolocation altitude is in meters (and may be null); library wants km.
        if (altitude != null && !Number.isNaN(altitude)) {
          setHeight((altitude / 1000).toFixed(3))
        }
        setLocateStatus({
          message: "Location set from your browser.",
          kind: "success",
        })
        setLocating(false)
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "Permission denied. Allow location access and try again.",
          2: "Position unavailable.",
          3: "Location request timed out.",
        }
        setLocateStatus({
          message: messages[err.code] ?? err.message,
          kind: "error",
        })
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  function compute() {
    setTransits(null)
    setResultName(null)
    try {
      const { elements: parsed, name } = parseElementSet(elements)

      const latitude = Number(lat)
      const longitude = Number(lon)
      const heightKm = Number(height)
      const minElevation = Number(minEl) || 0

      if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error("Latitude must be between -90 and 90 degrees.")
      }
      if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error("Longitude must be between -180 and 180 degrees.")
      }
      if (Number.isNaN(heightKm)) {
        throw new Error("Height must be a number (kilometers).")
      }

      const observerPosition: Position = {
        geo: { latitude, longitude, height: heightKm },
      }

      const days = DURATION_DAYS[duration] ?? 1
      const start = new Date(startMs)
      const stop = new Date(startMs + days * 24 * 60 * 60 * 1000)

      setComputing(true)
      setStatus({
        message: `Computing transits for ${days} day${days === 1 ? "" : "s"}\u2026`,
        kind: "info",
      })

      // Defer so the status paints before the (potentially heavy) computation.
      setTimeout(() => {
        try {
          const t0 = performance.now()
          const result = satelliteTransits(
            parsed,
            start,
            stop,
            observerPosition,
            minElevation,
            { timestampFormat: TimestampFormat.ISO8601 },
          )
          const elapsed = Math.round(performance.now() - t0)
          setResultName(name)
          setTransits(result)
          setStatus({
            message: `Found ${result.length} transit${result.length === 1 ? "" : "s"} in ${elapsed} ms.`,
            kind: "success",
          })
        } catch (err) {
          setStatus({ message: (err as Error).message, kind: "error" })
        } finally {
          setComputing(false)
        }
      }, 0)
    } catch (err) {
      setStatus({ message: (err as Error).message, kind: "error" })
    }
  }

  function computeObservation() {
    setObservation(null)
    setResultName(null)
    try {
      const { elements: parsed, name } = parseElementSet(elements)

      const latitude = Number(lat)
      const longitude = Number(lon)
      const heightKm = Number(height)

      if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error("Latitude must be between -90 and 90 degrees.")
      }
      if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error("Longitude must be between -180 and 180 degrees.")
      }
      if (Number.isNaN(heightKm)) {
        throw new Error("Height must be a number (kilometers).")
      }

      const observerPosition: Position = {
        geo: { latitude, longitude, height: heightKm },
      }

      setObserving(true)
      setObsStatus({
        message: "Computing observation\u2026",
        kind: "info",
      })

      setTimeout(() => {
        try {
          const t0 = performance.now()
          const result = satelliteObservation(
            parsed,
            new Date(startMs),
            observerPosition,
            { timestampFormat: TimestampFormat.ISO8601 },
          ) as SatelliteObservation
          const elapsed = Math.round(performance.now() - t0)
          setResultName(name)
          setObservation(result)
          setObsStatus({
            message: `Computed observation in ${elapsed} ms.`,
            kind: "success",
          })
        } catch (err) {
          setObsStatus({ message: (err as Error).message, kind: "error" })
        } finally {
          setObserving(false)
        }
      }, 0)
    } catch (err) {
      setObsStatus({ message: (err as Error).message, kind: "error" })
    }
  }

  function computeSunEvents() {
    setSunEvents(null)
    setResultName(null)
    try {
      const { elements: parsed, name } = parseElementSet(elements)

      const days = DURATION_DAYS[duration] ?? 1
      const start = new Date(startMs)
      const stop = new Date(startMs + days * 24 * 60 * 60 * 1000)

      setComputingSun(true)
      setSunStatus({
        message: `Computing sun events for ${days} day${days === 1 ? "" : "s"}\u2026`,
        kind: "info",
      })

      // Defer so the status paints before the (potentially heavy) computation.
      setTimeout(() => {
        try {
          const t0 = performance.now()
          const result = satelliteSunEvents(parsed, start, stop, {
            timestampFormat: TimestampFormat.ISO8601,
          })
          const elapsed = Math.round(performance.now() - t0)
          setResultName(name)
          setSunEvents(result)
          setSunStatus({
            message: `Found ${result.length} sun event${result.length === 1 ? "" : "s"} in ${elapsed} ms.`,
            kind: "success",
          })
        } catch (err) {
          setSunStatus({ message: (err as Error).message, kind: "error" })
        } finally {
          setComputingSun(false)
        }
      }, 0)
    } catch (err) {
      setSunStatus({ message: (err as Error).message, kind: "error" })
    }
  }

  function computePlot() {
    setPlotResult(null)
    setResultName(null)
    try {
      const { elements: parsed, name } = parseElementSet(elements)

      const latitude = Number(lat)
      const longitude = Number(lon)
      const heightKm = Number(height)

      if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
        throw new Error("Latitude must be between -90 and 90 degrees.")
      }
      if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
        throw new Error("Longitude must be between -180 and 180 degrees.")
      }
      if (Number.isNaN(heightKm)) {
        throw new Error("Height must be a number (kilometers).")
      }
      if (selectedParams.length === 0) {
        throw new Error("Select at least one parameter to plot.")
      }

      const observerPosition: Position = {
        geo: { latitude, longitude, height: heightKm },
      }

      const seconds = plotDurationSeconds(plotDuration)
      const timestamps = buildPlotTimestamps(startMs, seconds)

      setPlotting(true)
      setPlotStatus({
        message: `Computing ${timestamps.length} samples\u2026`,
        kind: "info",
      })

      // Defer so the status paints before the (potentially heavy) computation.
      setTimeout(() => {
        try {
          const t0 = performance.now()
          const observations = satelliteObservation(
            parsed,
            timestamps.map((ms) => new Date(ms)),
            observerPosition,
            { timestampFormat: TimestampFormat.ISO8601 },
          ) as SatelliteObservation[]
          const series = buildPlotSeries(
            observations,
            timestamps,
            selectedParams,
          )
          const elapsed = Math.round(performance.now() - t0)
          setResultName(name)
          setPlotResult({ timestamps, series, keys: selectedParams })
          setPlotStatus({
            message: `Computed ${timestamps.length} samples in ${elapsed} ms.`,
            kind: "success",
          })
        } catch (err) {
          setPlotStatus({ message: (err as Error).message, kind: "error" })
        } finally {
          setPlotting(false)
        }
      }, 0)
    } catch (err) {
      setPlotStatus({ message: (err as Error).message, kind: "error" })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              @nsat/jspredict
            </h1>
            <p className="text-muted-foreground text-sm">
              Upload or paste a TLE or OMM, set an observer location, then
              compute satellite transits, a point-in-time observation, or sun
              events.
            </p>
          </div>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Satellite Element Set</CardTitle>
              <CardDescription>
                A TLE may include an optional leading name line. An OMM may be a
                single object or an array (as returned by Space-Track).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="elements">TLE (2 or 3 lines) or OMM (JSON)</Label>
                <Textarea
                  id="elements"
                  spellCheck={false}
                  className="min-h-32 font-mono text-xs"
                  placeholder={ISS_PLACEHOLDER}
                  value={elements}
                  onChange={(e) => setElements(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.tle,.json,.omm"
                  className="hidden"
                  onChange={onFile}
                />
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload /> Upload a file
                </Button>
                <Button variant="outline" onClick={resetForm}>
                  <RotateCcw /> Reset
                </Button>
                <StatusText status={fileStatus} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observer Location</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="grid gap-2">
                  <Label htmlFor="lat">Latitude (&deg;)</Label>
                  <Input
                    id="lat"
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lon">Longitude (&deg;)</Label>
                  <Input
                    id="lon"
                    type="number"
                    step="any"
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="height">Height (km)</Label>
                  <Input
                    id="height"
                    type="number"
                    step="any"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="minEl">Minimum Elevation (&deg;)</Label>
                  <Input
                    id="minEl"
                    type="number"
                    step="any"
                    value={minEl}
                    onChange={(e) => setMinEl(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={getLocation} disabled={locating}>
                  <LocateFixed /> Get Current Location
                </Button>
                <StatusText status={locateStatus} />
              </div>
            </CardContent>
          </Card>

          <Tabs
            value={mode}
            onValueChange={(v) =>
              setMode(v as "transits" | "observation" | "sunEvents" | "plot")
            }
          >
            <TabsList>
              <TabsTrigger value="observation">Observation</TabsTrigger>
              <TabsTrigger value="transits">Transits</TabsTrigger>
              <TabsTrigger value="sunEvents">Sun Events</TabsTrigger>
              <TabsTrigger value="plot">Plot</TabsTrigger>
            </TabsList>

            {/* ---------------------------- Transits ---------------------------- */}
            <TabsContent value="transits" className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Compute Satellite Transits</CardTitle>
                  <CardDescription>
                    Find every pass over the observer location within the
                    selected time window.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DateTimePicker
                      value={msToWallClock(startMs, timezone)}
                      dateLabel="Start Date"
                      timeLabel={`Start Time (${timezoneLabel(timezone)})`}
                      onChange={(wall) => {
                        startEditedRef.current = true
                        setStartMs(wallClockToMs(wall, timezone))
                      }}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="duration">Duration</Label>
                      <Select value={duration} onValueChange={setDuration}>
                        <SelectTrigger id="duration" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 day</SelectItem>
                          <SelectItem value="7">7 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Select
                        value={timezone}
                        onValueChange={(v) => setTimezone(v as TimeZoneMode)}
                      >
                        <SelectTrigger id="timezone" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local">
                            Local time ({timezoneLabel("local")})
                          </SelectItem>
                          <SelectItem value="utc">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={compute} disabled={computing}>
                      Compute Transits
                    </Button>
                    <StatusText status={status} />
                  </div>

                  <hr className="border-border" />

                  <div className="grid gap-3">
                    {transits && (
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold">
                          {resultName}
                        </h3>
                        <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs">
                          {transits.length} transit
                          {transits.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    )}
                    {transits && transits.length > 0 && (
                      <p className="text-muted-foreground text-sm">
                        Times shown in{" "}
                        {timezone === "utc"
                          ? "UTC"
                          : `your local timezone (${timezoneLabel("local")})`}
                        . Select a row to view its transit events.
                      </p>
                    )}
                    {transits && transits.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No transits found for the selected window.
                      </p>
                    ) : transits && transits.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>#</TableHead>
                            <TableHead>Start</TableHead>
                            <TableHead>Stop</TableHead>
                            <TableHead>Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {transits.map((t, i) => (
                            <TransitRow
                              key={i}
                              transit={t}
                              index={i}
                              tz={timezone}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* --------------------------- Observation --------------------------- */}
            <TabsContent value="observation" className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Compute Satellite Observation</CardTitle>
                  <CardDescription>
                    Compute the satellite's state at a single point in time.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DateTimePicker
                      value={msToWallClock(startMs, timezone)}
                      dateLabel="Date"
                      timeLabel={`Time (${timezoneLabel(timezone)})`}
                      onChange={(wall) => {
                        startEditedRef.current = true
                        setStartMs(wallClockToMs(wall, timezone))
                      }}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="timezone-obs">Timezone</Label>
                      <Select
                        value={timezone}
                        onValueChange={(v) => setTimezone(v as TimeZoneMode)}
                      >
                        <SelectTrigger id="timezone-obs" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local">
                            Local time ({timezoneLabel("local")})
                          </SelectItem>
                          <SelectItem value="utc">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={computeObservation} disabled={observing}>
                      Compute Observation
                    </Button>
                    <StatusText status={obsStatus} />
                  </div>

                  <hr className="border-border" />

                  <div className="grid gap-3">
                    {observation && (
                      <>
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-semibold">
                            {observation.name}
                          </h3>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Epoch shown in{" "}
                          {timezone === "utc"
                            ? "UTC"
                            : `your local timezone (${timezoneLabel("local")})`}
                          .
                        </p>
                        <ObservationView observation={observation} tz={timezone} />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---------------------------- Sun Events ---------------------------- */}
            <TabsContent value="sunEvents" className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Compute Satellite Sun Events</CardTitle>
                  <CardDescription>
                    Split the selected time window into contiguous sunlit,
                    transition (penumbra), and eclipse (umbra) intervals. The
                    observer location is not used for this calculation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DateTimePicker
                      value={msToWallClock(startMs, timezone)}
                      dateLabel="Start Date"
                      timeLabel={`Start Time (${timezoneLabel(timezone)})`}
                      onChange={(wall) => {
                        startEditedRef.current = true
                        setStartMs(wallClockToMs(wall, timezone))
                      }}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="duration-sun">Duration</Label>
                      <Select value={duration} onValueChange={setDuration}>
                        <SelectTrigger id="duration-sun" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 day</SelectItem>
                          <SelectItem value="7">7 days</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="timezone-sun">Timezone</Label>
                      <Select
                        value={timezone}
                        onValueChange={(v) => setTimezone(v as TimeZoneMode)}
                      >
                        <SelectTrigger id="timezone-sun" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local">
                            Local time ({timezoneLabel("local")})
                          </SelectItem>
                          <SelectItem value="utc">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={computeSunEvents} disabled={computingSun}>
                      Compute Sun Events
                    </Button>
                    <StatusText status={sunStatus} />
                  </div>

                  <hr className="border-border" />

                  <div className="grid gap-3">
                    {sunEvents && (
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold">{resultName}</h3>
                        <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs">
                          {sunEvents.length} event
                          {sunEvents.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    )}
                    {sunEvents && sunEvents.length > 0 && (
                      <p className="text-muted-foreground text-sm">
                        Times shown in{" "}
                        {timezone === "utc"
                          ? "UTC"
                          : `your local timezone (${timezoneLabel("local")})`}
                        . Each event's stop is the next event's start.
                      </p>
                    )}
                    {sunEvents && sunEvents.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No sun events found for the selected window.
                      </p>
                    ) : sunEvents && sunEvents.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Start</TableHead>
                            <TableHead>Stop</TableHead>
                            <TableHead>Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sunEvents.map((e, i) => (
                            <SunEventRow
                              key={i}
                              event={e}
                              index={i}
                              tz={timezone}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ------------------------------ Plot ------------------------------ */}
            <TabsContent value="plot" className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Plot Parameters Over Time</CardTitle>
                  <CardDescription>
                    Sample the satellite's observer look angles and orbit
                    parameters across a time window and chart them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DateTimePicker
                      value={msToWallClock(startMs, timezone)}
                      dateLabel="Start Date"
                      timeLabel={`Start Time (${timezoneLabel(timezone)})`}
                      onChange={(wall) => {
                        startEditedRef.current = true
                        setStartMs(wallClockToMs(wall, timezone))
                      }}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="duration-plot">Duration</Label>
                      <Select value={plotDuration} onValueChange={setPlotDuration}>
                        <SelectTrigger id="duration-plot" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLOT_DURATION_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="timezone-plot">Timezone</Label>
                      <Select
                        value={timezone}
                        onValueChange={(v) => setTimezone(v as TimeZoneMode)}
                      >
                        <SelectTrigger id="timezone-plot" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local">
                            Local time ({timezoneLabel("local")})
                          </SelectItem>
                          <SelectItem value="utc">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>Parameters</Label>
                    <div className="flex flex-wrap gap-2">
                      {PLOT_PARAMETERS.map((def) => {
                        const active = selectedParams.includes(def.key)
                        return (
                          <button
                            key={def.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleParam(def.key)}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: def.color }}
                            />
                            {def.label}
                            {def.unit ? ` (${def.unit})` : ""}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center gap-3">
                      <Label>Y-Axis Scale</Label>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={axisScaleMode === "auto" ? "default" : "outline"}
                          onClick={() => setAxisScaleMode("auto")}
                        >
                          Auto
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={axisScaleMode === "manual" ? "default" : "outline"}
                          onClick={() => setAxisScaleMode("manual")}
                        >
                          Manual
                        </Button>
                      </div>
                    </div>
                    {axisScaleMode === "manual" && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {activeAxisGroups.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            Select a parameter to set its axis range.
                          </p>
                        ) : (
                          activeAxisGroups.map((group) => {
                            const input = axisRangeInputs[group] ?? {
                              min: "",
                              max: "",
                            }
                            return (
                              <div
                                key={group}
                                className="grid gap-2 rounded-md border p-3"
                              >
                                <span className="text-xs font-medium">
                                  {AXIS_GROUP_LABELS[group]}
                                </span>
                                <div className="flex items-center gap-2">
                                  <div className="grid gap-1">
                                    <Label
                                      htmlFor={`axis-min-${group}`}
                                      className="text-muted-foreground text-xs"
                                    >
                                      Min
                                    </Label>
                                    <Input
                                      id={`axis-min-${group}`}
                                      type="number"
                                      step="any"
                                      placeholder="Auto"
                                      value={input.min}
                                      onChange={(e) =>
                                        setAxisRangeInput(
                                          group,
                                          "min",
                                          e.target.value,
                                        )
                                      }
                                      className="w-24"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label
                                      htmlFor={`axis-max-${group}`}
                                      className="text-muted-foreground text-xs"
                                    >
                                      Max
                                    </Label>
                                    <Input
                                      id={`axis-max-${group}`}
                                      type="number"
                                      step="any"
                                      placeholder="Auto"
                                      value={input.max}
                                      onChange={(e) =>
                                        setAxisRangeInput(
                                          group,
                                          "max",
                                          e.target.value,
                                        )
                                      }
                                      className="w-24"
                                    />
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button onClick={computePlot} disabled={plotting}>
                      Plot
                    </Button>
                    <StatusText status={plotStatus} />
                  </div>

                  <hr className="border-border" />

                  {plotResult && (
                    <div className="grid gap-3">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold">
                          {resultName}
                        </h3>
                        <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs">
                          {plotResult.timestamps.length} samples
                        </span>
                      </div>
                      <PlotChart
                        timestamps={plotResult.timestamps}
                        series={plotResult.series}
                        selectedKeys={plotResult.keys}
                        tz={timezone}
                        axisRanges={axisRanges}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
