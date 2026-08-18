# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0]

### Added
- Support for Orbit Mean-Elements Message (OMM) orbital element sets in addition to TLE strings
- `satelliteObservation()` now accepts either a single epoch or an array of epochs, returning a single observation or an array of observations respectively (replacing the separate `observes()` method)
- Configurable angular units (`DEGREES` or `RADIANS`) via the `AngularUnits` enum, applied independently to azimuth, elevation, geodetic coordinates, beta angle, and orbit phase outputs
- Configurable timestamp output formats (`UNIX`, `ISO8601`, `DATE`, `DATETIME`) via the `TimestampFormat` enum
- Flexible timestamp inputs accepting Unix timestamps, ISO8601 strings, JavaScript `Date` objects, and Luxon `DateTime` objects
- Expanded observation output including ECI/ECEF/geodetic position and velocity vectors, GMST, footprint, orbit revolution count and phase (with legacy 0–256 `phase256`), orbital model, decayed/geostationary flags, sunlit state, sun position, beta angle, eclipse factor, doppler factor, slant range, visibility, and AOS state
- Rewritten `satelliteTransits()` transit prediction using a coarse mean-motion-derived search (Skyfield-style) with secant-method refinement of AOS, LOS, peak (culmination), and TCA (time of closest approach) events
- Rich transit events: each transit now reports `aos`, `los`, `tca`, and `peak` events with full azimuth, elevation, slant range, and doppler data, plus `start`/`stop`/`duration`
- Tunable transit search precision and convergence via `SatelliteTransitOptions` (elevation/rate tolerances, max iterations, and optional coarse-step override)
- Published TypeScript type definitions and exported public interfaces, types, and enums from the module root
- Benchmark script (`npm run benchmark`) and Vitest-based test suite (`npm test`)
- GitHub Actions publishing workflow for GitHub Packages

### Changed
- Migrated library source code from JavaScript to TypeScript
- Migrated from Webpack to Vite for testing and packaging
- Migrated library build to standard ES modules for frontend and backend use
- Replaced the `moment` dependency with `luxon`
- Upgraded `satellite.js` from 3.x to 7.x
- Renamed and restructured the public API:
  - `observe()` → `satelliteObservation()`
  - `transits()` → `satelliteTransits()`
- Renamed geodetic position properties to `geo` to align with the abbreviations used by other coordinate systems (`eci`, `ecef`)
- Transit start/stop times now conform to the true horizon (0°) while AOS/LOS conform to the configurable minimum elevation threshold

### Deprecated
- Removed support for Bower and Meteor package repositories, builds are now hosted on GitHub Packages
- Removed support for CommonJS and UMD style JavaScript modules
- Removed the `observes()` method (functionality merged into `satelliteObservation()`)
- Removed the `transitSegment()` method
- Removed the legacy `bower.json`, `package.js` (Meteor), and `export.js` files


## [1.2.0] - 2026-08-06
- Deprecated legacy version (no longer supported)
