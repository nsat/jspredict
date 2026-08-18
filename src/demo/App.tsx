import { useEffect, useRef, useState } from "react"
import {
  ChevronRight,
  LocateFixed,
  RotateCcw,
  Satellite,
  Upload,
} from "lucide-react"

import { satelliteTransits, TimestampFormat } from "../lib/main"
import type { Position, SatelliteTransit, TransitEvent } from "../lib/main"
import {
  formatAngle,
  formatDuration,
  formatRange,
  formatTime,
  msToWallClock,
  parseElementSet,
  timezoneLabel,
  wallClockToMs,
  type TimeZoneMode,
} from "./transits"

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
  return (
    <div className="grid gap-3 rounded-md border bg-muted/40 p-4">
      {EVENT_LABELS.map(({ key, label }) => {
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
            </dl>
          </div>
        )
      })}
    </div>
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

export default function App() {
  const [elements, setElements] = useState("")
  const [lat, setLat] = useState("0.0")
  const [lon, setLon] = useState("0.0")
  const [height, setHeight] = useState("0.0")
  const [minEl, setMinEl] = useState("5")
  const [duration, setDuration] = useState("1")
  const [timezone, setTimezone] = useState<TimeZoneMode>("local")

  // Absolute start instant (UTC ms). Defaults to the element-set epoch until the
  // user edits it manually.
  const [startMs, setStartMs] = useState<number>(() => Date.now())
  const startEditedRef = useRef(false)

  // Keep the start time defaulted to the parsed element-set epoch, unless the
  // user has manually changed the picker.
  useEffect(() => {
    if (startEditedRef.current) return
    try {
      const { epoch } = parseElementSet(elements)
      if (epoch) {
        const ms = new Date(epoch).getTime()
        if (!Number.isNaN(ms)) setStartMs(ms)
      }
    } catch {
      // Ignore parse errors here; compute() surfaces them.
    }
  }, [elements])

  const [status, setStatus] = useState<Status>(null)
  const [fileStatus, setFileStatus] = useState<Status>(null)
  const [locateStatus, setLocateStatus] = useState<Status>(null)
  const [locating, setLocating] = useState(false)
  const [computing, setComputing] = useState(false)

  const [resultName, setResultName] = useState<string | null>(null)
  const [transits, setTransits] = useState<SatelliteTransit[] | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-card">
            <Satellite className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              JsPredict Transit Predictor
            </h1>
            <p className="text-muted-foreground text-sm">
              Upload or paste a TLE or OMM, set an observer location, and see
              all satellite transits over the selected time window.
            </p>
          </div>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Satellite element set</CardTitle>
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
              <CardTitle>2. Observer location</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle>3. Time window</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DateTimePicker
                  value={msToWallClock(startMs, timezone)}
                  timeLabel={timezoneLabel(timezone)}
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
                  Compute transits
                </Button>
                <StatusText status={status} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>{resultName ?? "Results"}</CardTitle>
                {transits && (
                  <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs">
                    {transits.length} transit{transits.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {transits && transits.length > 0 && (
                <CardDescription>
                  Times shown in{" "}
                  {timezone === "utc"
                    ? "UTC"
                    : `your local timezone (${timezoneLabel("local")})`}
                  . Select a row to view its transit events.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {!transits ? (
                <p className="text-muted-foreground text-sm">
                  Results will appear here.
                </p>
              ) : transits.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No transits found for the selected window.
                </p>
              ) : (
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
                      <TransitRow key={i} transit={t} index={i} tz={timezone} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
