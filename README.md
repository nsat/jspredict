# JsPredict

JavaScript/TypeScript open-source satellite tracking library. JsPredict uses the SGP4/SDP4
propagation models (via [satellite.js](https://github.com/shashwatak/satellite-js))
to compute satellite positions, observer look angles, and ground-station passes
from a TLE or OMM element set.

## Installation

```sh
npm install @nsat/jspredict
```

JsPredict is published as an ES module and ships with TypeScript type
definitions.

```ts
import { satelliteObservation, satelliteTransits } from "@nsat/jspredict"
```

## Concepts

JsPredict exposes two primary functions:

| Function | Purpose |
| --- | --- |
| `satelliteObservation` | Compute the state of a satellite (position, velocity, orbit, sun geometry, and optional observer look angles) at one or more instants in time. |
| `satelliteTransits` | Find every pass a satellite makes over a fixed ground location within a time window, including AOS, LOS, peak, and time of closest approach. |

### Satellite element sets

Both functions accept the satellite's orbital elements as either:

- A **Two-Line Element (TLE)** string. A leading name line (line 0) is
  optional but recommended so the returned observation carries a `name`.
- An **Orbit Mean-Elements Message (OMM)** JSON object (CCSDS OMM v3, the shape
  returned by Space-Track's API).

```ts
// TLE (with optional name line)
const issTle = `0 ISS (ZARYA)
1 25544U 98067A   26219.02141064  .00004539  00000-0  89363-4 0  9992
2 25544  51.6324  48.5171 0007293  20.5996 339.5285 15.49370096579630`

// OMM JSON
const issOmm = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  NORAD_CAT_ID: "25544",
  EPOCH: "2026-08-07T00:30:49.879296",
  MEAN_MOTION: "15.49370096",
  // ...remaining OMM fields
}
```

### Timestamps

Function parameters that are typed as `Timestamp` allow the caller to supply
datetime values in any of the following forms:

| Input form | Type | Example | How it's interpreted |
| --- | --- | --- | --- |
| Unix milliseconds | `number` | `1786062649879` | Milliseconds since the Unix epoch, treated as **UTC**. |
| ISO 8601 string | `string` | `"2026-08-07T00:30:49.879Z"` | Parsed as ISO 8601. See the timezone note below. |
| JavaScript `Date` | `Date` | `new Date("2026-08-07T00:30:49.879Z")` | Converted directly from the `Date` instant. |
| Luxon `DateTime` | `DateTime` | `DateTime.utc(2026, 8, 7)` | Used as-is, preserving its timezone. |

> Timezone handling for strings: if the ISO string carries an explicit offset or
> `Z` (e.g. `2026-08-07T00:30:49.879Z` or `...+02:00`), that zone is respected.
> A string **without** any timezone (e.g. `2026-08-07T00:30:49.879`) is assumed
> to be **UTC**. Numeric (Unix ms) inputs are always UTC.

```ts
import { DateTime } from "luxon"

// All four of these refer to the same instant and are accepted interchangeably:
satelliteObservation(issTle, 1786062649879)                          // number (ms, UTC)
satelliteObservation(issTle, "2026-08-07T00:30:49.879Z")             // ISO 8601 string
satelliteObservation(issTle, new Date("2026-08-07T00:30:49.879Z"))   // Date
satelliteObservation(issTle, DateTime.fromISO("2026-08-07T00:30:49.879Z")) // DateTime

// Mixed forms in an epoch array are fine too:
satelliteObservation(issTle, [
  "2026-08-07T00:30:49.879Z",
  new Date("2026-08-08T00:30:49.879Z"),
  1786235449879,
])

// startTime / stopTime for transits accept the same flexible input:
satelliteTransits(
  issOmm,
  "2026-08-07T01:00:00Z",                 // ISO string
  new Date("2026-08-08T01:00:00Z"),       // Date
  observerPosition,
)
```

To control the **output** timestamp format (i.e. `epoch`, `start`, `stop`, 
etc...) — see the `timestampFormat` option in
[Configuration options](#configuration-options). Defaults to an ISO8601 UTC
string if not specified by the caller.

### The `Position` object

A `Position` object describes the location of an observer or satellite relative
to the Earth. A position can be expressed in any of **three coordinate frames**:

```ts
interface Position {
  eci?:  { x: number; y: number; z: number }  // Earth-Centered Inertial (km)
  ecef?: { x: number; y: number; z: number }  // Earth-Centered Earth-Fixed (km)
  geo?:  { latitude: number; longitude: number; height: number } // Geodetic
}
```

| Field | Frame | Components | Units |
| --- | --- | --- | --- |
| `eci` | Earth-Centered Inertial (TEME) | `x`, `y`, `z` | kilometers |
| `ecef` | Earth-Centered Earth-Fixed | `x`, `y`, `z` | kilometers |
| `geo` | Geodetic (relative to the WGS84 ellipsoid) | `latitude`, `longitude`, `height` | `latitude`/`longitude` in degrees by default (or radians — see `geodeticAngularUnits`); `height` in kilometers above the ellipsoid |

When specifying the position of an observer, you must define all the parameters 
for **at least one** of the coordinate coordinate frames:

#### Geodetic (most common)

```ts
const observerPosition = {
  geo: {
    latitude: 15,    // degrees by default (see geodeticAngularUnits)
    longitude: 130,  // degrees by default
    height: 0.1,     // kilometers above the ellipsoid
  },
}
```

By default `latitude`/`longitude` are interpreted as **degrees**. Set
`geodeticAngularUnits: AngularUnits.Radians` in the function options. 
The `height` parameter is always specified in kilometers.

#### ECEF or ECI

Instead of geodetic coordinates you may define a position directly in
Earth-Centered Earth-Fixed or Earth-Centered Inertial coordinates. Both take an
`{ x, y, z }` vector in **kilometers**:

```ts
// Define the observer in ECEF coordinates
const observerPositionEcef = {
  ecef: { x: -3961.04, y: 4720.58, z: 1640.13 },
}

// Or in ECI coordinates
const observerPositionEci = {
  eci: { x: -350.53, y: 6152.31, z: 1640.13 },
}

satelliteObservation(issOmm, "2026-08-07T00:30:49.879Z", observerPositionEcef)
```

Notes on the ECI/ECEF frames:

- ECI and geodetic are time-dependent relative to each other (ECEF rotates with
  the Earth), so the conversion between them uses the Greenwich Mean Sidereal
  Time at the observation `epoch`. Supply an ECI vector consistent with the
  epoch you are querying.
- `geodeticAngularUnits` only affects the `geo` frame. When you supply `ecef`
  or `eci`, the derived `geo` output will honor the `geodeticAngularUnits`
  option specified by the caller.

## `satelliteObservation`

```ts
satelliteObservation(
  satelliteElements,      // TLE string | OMM object
  epoch,                  // Timestamp | Timestamp[]
  observerPosition?,      // Position (optional)
  satelliteObservationOptions?, // options object (optional)
): SatelliteObservation | SatelliteObservation[]
```

Computes the satellite state at the given `epoch`. If `epoch` is an array, an
array of observations is returned (one per timestamp, in order). If an observer
position is supplied, look angles (i.e. `azimuth`, `elevation`, etc..) are 
included in the result.

### Basic usage

```ts
import { satelliteObservation } from "@nsat/jspredict"

const observation = satelliteObservation(
  issTle,
  "2026-08-07T00:30:49.879Z",
)

console.log(observation.position?.geo)   // Satellite position in lat/lon/height
console.log(observation.velocity?.eci)   // Satellite velocity vector in ECI
console.log(observation.orbit?.revolutionCount) // Satellite orbit count at epoch
```

```console
{ latitude: -0.000020156475434, longitude: 85.25616601107723, height: 414.6648113012516 }
{ x: -3.5688788491717403, y: 3.144142751825821, z: 6.012239210336608 }
57963
```

Example `SatelliteTransit` result:

```javascript
{
  "id": "1998-067A",
  "name": "ISS (ZARYA)",
  "noradCatalogId": "25544",
  "orbitalModel": "SGP4",
  "epoch": "2026-08-07T00:30:49.879Z",
  "gmst": 5.641967364224406,
  "position": {
    "eci":  { "x": 4499.52949934419, "y": 5088.849647232988, "z": -0.0000023746 },
    "ecef": { "x": 561.7712271405776, "y": 6769.5324458908435, "z": -0.0000023746 },
    "geo":  { "latitude": -0.0000201564, "longitude": 85.25616601107723, "height": 414.6648113012516 }
  },
  "velocity": {
    "eci":  { "x": -3.5688788491717403, "y": 3.144142751825821, "z": 6.012239210336608 },
    "ecef": { "x": -4.740722498497987, "y": 0.3848117411920531, "z": 6.012239210336608 }
  },
  "footprint": 4480.19986762669,
  "orbit": {
    "revolutionCount": 57963,
    "phase": 5.9258902293575675,
    "phase256": 241.4424888888889,
    "velocity": 7.666130067135126
  },
  "decayed": false,
  "geostationary": false,
  "sunlit": true,
  "sunPosition": {
    "eci":  { "x": -106442754.674, "y": 99203886.990, "z": 43003034.578 },
    "ecef": { "x": -144640775.612, "y": 15827736.632, "z": 43003034.578 },
    "geo":  { "latitude": 16.464784495, "longitude": 173.755090434, "height": 151719469.100 }
  },
  "betaAngle": -0.6134751473121656,
  "eclipseFactor": 0
}
```

### With an observer

```ts
const observation = satelliteObservation(
  issOmm,
  "2026-08-07T00:30:49.879Z",
  { geo: { latitude: 15, longitude: 130, height: 0.1 } },
)

console.log(observation.azimuth)     // Compass heading to the satellite
console.log(observation.elevation)   // Angle above the horizon
console.log(observation.slantRange)  // Line-of-sight distance (km)
console.log(observation.dopplerFactor) // Signal frequency shift
```

With an observer, the observation additionally carries `observerPosition`,
`azimuth`, `elevation`, `slantRange`, and `dopplerFactor`:

```console
255.48422012446775
-19.163421277725885
5229.152666560456
1.000019464535455
```

```javascript
  ...
  "observerPosition": {
    "eci":  { "x": -350.5295256508939, "y": 6152.308010923147, "z": 1640.1260220778647 },
    "ecef": { "x": -3961.040882853815, "y": 4720.584702553575, "z": 1640.1260220778647 },
    "geo":  { "latitude": 14.999999999999998, "longitude": 130, "height": 0.1 }
  },
  "azimuth": 255.48422012446775,
  "elevation": -19.163421277725885,
  "slantRange": 5229.152666560456,
  "dopplerFactor": 1.000019464535455
```

### Multiple epochs

```ts
const epochs = [
  "2026-08-07T00:30:49.879Z",
  "2026-08-08T00:30:49.879Z",
]

const observations = satelliteObservation(issOmm, epochs)
// observations is a SatelliteObservation[] with one entry per epoch
```

### Result Schema

The `SatelliteObservation` object contains the following fields:

| Field | Description |
| --- | --- |
| `id` | International designator (e.g. `1998-067A`). |
| `name` | Satellite name from the element set. |
| `noradCatalogId` | NORAD catalog number. |
| `epoch` | Observation time, formatted per `timestampFormat`. |
| `gmst` | Greenwich Mean Sidereal Time (radians). |
| `position` | `{ eci, ecef, geo }` position vectors. |
| `velocity` | `{ eci, ecef }` velocity vectors. |
| `footprint` | Ground-coverage diameter (km). |
| `orbit` | `{ revolutionCount, phase, phase256, velocity }`. |
| `orbitalModel` | Propagation theory used (e.g. `SGP4`). |
| `decayed` | `true` if the orbit has decayed at this time. |
| `geostationary` | `true` if the satellite is geostationary. |
| `sunlit` | `true` if the satellite is not fully eclipsed. |
| `sunPosition` | Position of the Sun. |
| `betaAngle` | Angle between the orbital plane and the Sun. |
| `eclipseFactor` | Fraction of the Sun's disc obscured by Earth (0 = fully lit, 1 = umbra). |
| `observerPosition` | Observer's position (only if observerPosition is defined). |
| `azimuth` | Heading to the satellite (only if observerPosition is defined). |
| `elevation` | Elevation above the horizon (only if observerPosition is defined). |
| `slantRange` | Observer-to-satellite distance in km (only if observerPosition is defined). |
| `dopplerFactor` | Frequency shift relative to the observer (only if observerPosition is defined). |

> Note: if the propagated orbit has decayed, a minimal observation is returned
> with `decayed: true`.

Decayed satellite example:
```javascript
{
  "id": "1998-067A",
  "name": "ISS (ZARYA)",
  "noradCatalogId": "25544",
  "orbitalModel": "SGP4",
  "epoch": "2026-08-07T00:30:49.879Z",
  "decayed": true,
}
```

## `satelliteTransits`

```ts
satelliteTransits(
  satelliteElements,   // TLE string | OMM object
  startTime,           // Timestamp
  stopTime,            // Timestamp
  observerPosition,    // Position (required)
  minElevationAngle?,  // number, default 0
  satelliteTransitOptions?, // options object (optional)
): SatelliteTransit[]
```

Finds all passes of the satellite over `observerPosition` between `startTime`
and `stopTime`. Each pass reports its horizon-to-horizon start/stop times, 
transit duration (`stopTime` - `startTime`), acquisition-of-signal (AOS),
loss-of-signal (LOS), peak-elevation, and time-of-closest-approach (TCA) events.

### Basic usage

```ts
import { satelliteTransits } from "@nsat/jspredict"

const transits = satelliteTransits(
  issOmm,
  "2026-08-07T01:00:00Z",
  "2026-08-08T01:00:00Z",
  { geo: { latitude: 15, longitude: 130, height: 0.1 } },
)

for (const pass of transits) {
  console.log("start:", pass.start, "stop:", pass.stop)
  console.log("duration (s):", pass.duration)
  console.log("peak elevation:", pass.peak.elevation)
}
```

```console
start: 2026-08-07T07:16:32.212Z stop: 2026-08-07T07:24:51.248Z
duration (s): 499.0366948242187
peak elevation: 8.548911076956662
...
```

Example `SatelliteTransit` result:

```javascript
{
  "start": "2026-08-07T07:16:32.212Z",
  "stop": "2026-08-07T07:24:51.248Z",
  "duration": 499.0366948242187,
  "aos": {
    "epoch": "2026-08-07T07:16:32.212Z",
    "elevation": -0.00000980804514841618,
    "azimuth": 355.96610919847745,
    "slantRange": 2354.291268694053,
    "dopplerFactor": 1.0000170656489715
  },
  "los": {
    "epoch": "2026-08-07T07:24:51.248Z",
    "elevation": 0.000004391528749672061,
    "azimuth": 96.61179546159609,
    "slantRange": 2359.481290918783,
    "dopplerFactor": 0.9999814449675171
  },
  "tca": {
    "epoch": "2026-08-07T07:20:41.498Z",
    "elevation": 8.548888406311306,
    "azimuth": 46.293782335832596,
    "slantRange": 1592.8295788230319,
    "dopplerFactor": 0.9999989284805654
  },
  "peak": {
    "epoch": "2026-08-07T07:20:41.760Z",
    "elevation": 8.548911076956662,
    "azimuth": 46.36393269609339,
    "slantRange": 1592.830631176362,
    "dopplerFactor": 0.9999989004667391
  }
}
```

### Minimum elevation threshold

The `minElevationAngle` argument sets the minimum elevation for AOS/LOS,
default is `0` degrees/radians (i.e. true horizon). Transits whose peak 
elevation never exceed the minimum elevation threshold are discarded.

```ts
// Only report passes that climb above 20 degrees
const transits = satelliteTransits(
  issOmm,
  "2026-08-07T01:00:00Z",
  "2026-08-08T01:00:00Z",
  observerPosition,
  20,
)
console.log(transits.length)
```

```console
$ node transits-minel.js
2   # vs. 5 passes with the default 0 threshold over the same window
```

The units of `minElevationAngle` can be changed using the `elevationAngularUnits`
option.

- `start`/`stop` always mark the true-horizon (0°) crossings.
- `aos`/`los` mark the crossings of `minElevationAngle`.
- When `minElevationAngle` is `0`, `start === aos` and `stop === los`.

### Result Schema

The `SatelliteTransit` object contains the following fields:

| Field | Description |
| --- | --- |
| `start` | Horizon-crossing start time (formatted per `timestampFormat`). |
| `stop` | Horizon-crossing stop time. |
| `duration` | Seconds from `start` to `stop`. |
| `aos` | Acquisition-of-signal event. |
| `los` | Loss-of-signal event. |
| `tca` | Time of closest approach (minimum slant range). |
| `peak` | Peak-elevation (culmination) event. |

Where `aos`, `los`, `tca`, and `peak` are `TransitEvent` objects defined as:

| Field | Description |
| --- | --- |
| `epoch` | The date and time of the event. |
| `azimuth` | The compass heading of the satellite from the observer. |
| `elevation` | The elevation angle of the satellite from the observer. |
| `slantRange` | The straight-line distance of the satellite from the observer. |
| `dopplerFactor` | The frequency shift of the satellite signal relative to the observer. |

### Errors and warnings

- Throws `Stop date is less than or equal to start date` if
  `stopTime <= startTime`.
- Emits a `console.warn` when the search window begins before the element set's
  epoch (propagating before the satellite element's epoch is not recommended).
- Returns `[]` and warns if the satellite has decayed, or if it is
  geostationary but sits below `minElevationAngle` for the observer.

## Configuration options

Both functions accept a "options" object for configuring inputs and outputs:
- `satelliteObservation` uses `SatelliteObservationOptions`
- `satelliteTransits` uses `SatelliteTransitOptions`

### Unit and format options (both functions)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `azimuthAngularUnits` | `AngularUnits` | `Degrees` | Units for output azimuth. |
| `elevationAngularUnits` | `AngularUnits` | `Degrees` | Units for output elevation and for the `minElevationAngle` input. |
| `geodeticAngularUnits` | `AngularUnits` | `Degrees` | Units for geodetic coordinates, both input (observer position) and output. |
| `betaAngleAngularUnits` | `AngularUnits` | `Degrees` | Units for the beta-angle output. |
| `orbitPhaseAngularUnits` | `AngularUnits` | `Degrees` | Units for the orbit `phase` output. |
| `timestampFormat` | `TimestampFormat` | `ISO8601` | Format of all output timestamps. |

`AngularUnits` and `TimestampFormat` are exported Typescript enums:

```ts
import { AngularUnits, TimestampFormat } from "@nsat/jspredict"

enum AngularUnits {
  Degrees = "DEGREES",
  Radians = "RADIANS",
}

enum TimestampFormat {
  Unix = "UNIX",       // milliseconds since the Unix epoch (number)
  ISO8601 = "ISO8601", // ISO 8601 string
  Date = "DATE",       // JavaScript Date
  DateTime = "DATETIME", // Luxon DateTime
}
```

### Transit search options (`satelliteTransits` only)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `elevationToleranceRadians` | `number` | `1e-6` | Angular convergence tolerance (radians) for AOS, LOS, and horizon crossings. |
| `elevationRateTolerance` | `number` | `1e-6` | Rate tolerance (rad/s) for locating the peak (culmination). |
| `slantRangeRateTolerance` | `number` | `1e-4` | Rate tolerance (km/s) for locating the time of closest approach. |
| `maxIterations` | `number` | `100` | Maximum secant iterations per event before falling back to the best estimate. |
| `coarseStepSeconds` | `number` | `undefined` | Override for the coarse-search step size. When omitted, the step is derived from the satellite's mean motion (~20 samples per revolution). |

### Example: radians and Unix timestamps

```ts
import { satelliteObservation, AngularUnits, TimestampFormat } from "@nsat/jspredict"

const observation = satelliteObservation(
  issOmm,
  "2026-08-07T00:30:49.879Z",
  {
    geo: {
      latitude: 0.2618,  // radians (~15°)
      longitude: 2.2689, // radians (~130°)
      height: 0.1,
    },
  },
  {
    azimuthAngularUnits: AngularUnits.Radians,
    elevationAngularUnits: AngularUnits.Radians,
    geodeticAngularUnits: AngularUnits.Radians,
    timestampFormat: TimestampFormat.Unix,
  },
)

console.log(observation.elevation) // radians
console.log(observation.epoch)     // number (ms since epoch)
```

```console
-0.3344491773360862
1786062649879
```

### Example: tuning the transit search

```ts
const transits = satelliteTransits(
  issOmm,
  "2026-08-07T01:00:00Z",
  "2026-08-08T01:00:00Z",
  observerPosition,
  10, // minimum elevation in degrees
  {
    timestampFormat: TimestampFormat.DateTime,
    coarseStepSeconds: 30,       // finer coarse sampling
    elevationToleranceRadians: 1e-7,
    maxIterations: 200,
  },
)
```

## Default behavior summary

- Angular outputs (azimuth, elevation, geodetic coordinates, beta angle, orbit
  phase) are in **degrees**.
- Geodetic **inputs** (observer position) are interpreted as **degrees**.
- Timestamps are formatted as **ISO 8601** strings.
- All times are treated as **UTC**.
- `satelliteObservation` omits observer look angles unless an observer position
  is supplied.
- `satelliteTransits` uses a `minElevationAngle` of **0°** (true horizon) and
  derives its coarse search step dynamically from the satellite's mean motion.

## Migrating from the legacy 1.2 release

Version 2.0 is a ground-up rewrite in TypeScript (shipped as an ES module) and is **not
backwards compatible**. If you are upgrading, review the changes below.

### Function names and signatures

| 1.2 (`main`) | 2.0 |
| --- | --- |
| `observe(tle, qth?, time?)` | `satelliteObservation(elements, epoch, observerPosition?, options?)` |
| `observes(tle, qth?, start?, end, interval?)` | `satelliteObservation(elements, epoch[], observerPosition?, options?)` — pass an array of timestamps |
| `transits(tle, qth, start?, end, minElevation?, maxTransits?)` | `satelliteTransits(elements, startTime, stopTime, observerPosition, minElevationAngle?, options?)` |

### Key differences

- **Element sets.** 1.2 accepted only a newline-delimited TLE string. 2.0 accepts either a TLE or OMM JSON object.
- **Observer position.** 1.2 used a `qth` array `[latitude, longitude, altitude]`.
  2.0 uses a `Position` object: `{ geo: { latitude, longitude, height } }`.
- **Batch observations.** The separate `observes()` (fixed `interval` between
  `start`/`end`) is gone; pass an explicit array of timestamps to
  `satelliteObservation` and receive one observation per timestamp.
- **Configurable units and timestamp formats.** 1.2 always used degrees and Unix
  millisecond timestamps. 2.0 lets you choose degrees or radians per output and
  select `Unix`, `ISO8601`, `Date`, or `DateTime` timestamps via the options
  object. Defaults are degrees and ISO 8601.
- **Structured output.** Flat 1.2 fields were reorganized:
  - `eci.position` / `eci.velocity` → `position.eci` / `velocity.eci`
    (plus `ecef` and `geo` frames).
  - `latitude` / `longitude` / `altitude` → `position.geo.{latitude,longitude,height}`.
  - `rangeSat` → `slantRange`; `doppler` → `dopplerFactor`.
  - New fields include `orbit`, `sunPosition`, `betaAngle`, `eclipseFactor`,
    `geostationary`, and `orbitalModel`.
- **Richer transits.** 1.2 reported `start`, `end`, `maxElevation`,
  `apexAzimuth`, `maxAzimuth`, `minAzimuth`, and `duration`. 2.0 reports
  `start`, `stop`, `duration`, and four full events — `aos`, `los`, `tca`
  (time of closest approach), and `peak` — each with `epoch`, `azimuth`,
  `elevation`, `slantRange`, and `dopplerFactor`.
- **No `maxTransits` cap.** 2.0 returns every pass in the requested window;
  slice the result array yourself if you need a limit.
- **Invalid ranges throw.** `satelliteTransits` throws when
  `stopTime <= startTime` rather than returning silently.
- **Dependencies.** The `moment.js` dependency was replaced with `luxon`, and
  `satellite.js` was upgraded to v7.x.

### Before / after

```js
// 1.2
const qth = [15, 130, 0.1]
jspredict.transits(tle, qth, 1446516345242, 1446545135046, 2, 4)
```

```ts
// 2.0
satelliteTransits(
  tle,
  1446516345242,
  1446545135046,
  { geo: { latitude: 15, longitude: 130, height: 0.1 } },
  2,
)
```

## License

MIT. See the license header in the source for details.
