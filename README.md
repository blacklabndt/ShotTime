# ShotTime 1.19.1

Offline Android Ir-192 shot-time reference app. Android 8/API 26 minimum, target API 35. Package `ca.kylekeith.shottime`. Requires a compatible, updated Android System WebView.

## Current calculation

The original geometry-dependent film Ci·s values are stored in `assets/techniques.json`. `assets/calculator.js` owns one authoritative table of density targets and reference values. Each baseline is scaled by the ratio of its film/density reference exposure to the original reference Ci·s. Preserve full precision until display.

Reference activity: 26 Ci. Small films use 3-inch STD; large films use 4-inch STD.

| Film | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 |
|---|---:|---:|---:|---:|---:|
| D4 | 9 | 13 | 16 | 19.5 | 23 |
| MX125 | 16 | 20 | 24 | 27.5 | 31 |
| Fuji IX50 | 17 | 21 | 25 | 29.5 | 34 |
| D5 | 11 | 15 | 19 | 23 | 27 |
| T200 | 14 | 18 | 22 | 25.5 | 29 |
| Fuji IX80 | 13 | 18 | 23 | 28 | 33 |

Times above are seconds, supplied as approximate expected results from another calculator. Density 3.5 is the arithmetic midpoint of 3.0 and 4.0. These are not physical film-density measurements.

Final seconds = density-adjusted baseline Ci·s × film-wide correction × size/schedule correction ÷ current source Ci. Both editable correction types are density-specific and default/reset to 1.00. Internal = unrounded final seconds / 9, nearest second. Internal offset = unrounded final seconds × 1.15 / 4, rounded up. Internal columns apply only to 6-inch and larger pipes. Standard times retain nearest-second rounding including 0s.

73 geometry rows, 219 film/geometry combinations, five densities (1,095 exposure combinations). Small films cover 1–3 inches; large films 4–16 inches. Double-wall carbon steel. 1-inch pipe uses 12-inch SFD; other sizes use OD +0.125 inches. Processing reference: manual 4 minutes at 72°F, Carestream INDUSTREX Single Part developer, lead screens. The app does not model weld reinforcement, source transit, oblique paths or geometric unsharpness. Film-wide adjustments require verification across the sizes used.

## Application behavior

Compact-only dark UI with Time, Internal and Internal offset columns. Multi-select pipe/schedule filters. Manual activity or daily Ir-192 decay from a reference using a 73.83-day half-life. Film-wide helper and manual size/schedule correction controls. Prints a narrow vertical list with only activity, density and local date above it.

Settings use one local JSON record with explicit storage-failure reporting. Draft inputs and panels are restored after reload. The record carries `schemaVersion: 1`; records without it (pre-release builds) are ignored, so those installs start fresh. Film-wide factors are stored as `factor.<density>.<film>` and size/schedule factors as `weld.<density>.<film>.<size>.<schedule>`. Stored factors outside 0.10–10.00 load as 1.00. There is no migration from pre-release storage; a future storage change should increase the schema version and add an explicit migration.

No network permission, tracking or JS-to-native interface. Printing uses a separate JS-disabled WebView snapshot and the Android print service. Preparation timeout, error callbacks and main-thread cleanup provide recovery. Real-device printing, installation, rotation and background/foreground checks remain necessary.

## Build

Set `SDK_ROOT` to an Android SDK with platform android-35 and build-tools 35.0.0. Run `SDK_ROOT=/path/to/sdk bash build.sh` with Java 17 available.

Restore the separate private signing backup into `signing/` before building. The build refuses to generate a replacement key. Signing credentials are excluded from the source archive. Never share the signing backup. Keep the package and key unchanged for installation as an update, and increase versionCode for each release.

## Active verification

- `node tests/test-current-calculator.cjs`: all 1,095 exposure combinations, all 30 reference targets, activity scaling, parsing, date validation and rounding.
- `CHROME_BINARY=/path/to/chromium node tests/test-current-ui.mjs`: six films across the five densities, corrections, calibration helper with size/schedule factors, save failures, persistence, reset behavior, narrow layouts and print agreement.
- `CHROME_BINARY=/path/to/chromium node tests/test-settings-storage.mjs`: unversioned records ignored, per-density factor and size/schedule keys, schema version, range checks, resets across five densities and persistence after reload.

Requires the available Playwright package. `tests/legacy/` contains historical harnesses, not active release gates. Physical Android print-service checks are not simulated by browser tests.

## This release

Consolidated density targets into one table and removed unreachable model branches. Replaced stale workbook/fallback correction wording. Refreshed documentation and test summaries. All 1,095 outputs and six migration multipliers match v1.19.0 exactly; no shot-time or saved-key changes were introduced.

## Changes since 1.19.1 (unreleased)

- Calibration helper divides out the selected pipe's size/schedule factor, so that pipe keeps the successful time.
- Film factor form keeps unchanged values, names the out-of-range film and focuses its box.
- Clean-slate settings storage before first release: removed the density-3 migration, legacy namespaces and standalone-key fallbacks; added `schemaVersion: 1`. Pre-release saved settings are discarded. Built-in shot times are unchanged.
- Draft restoration checks each restored dropdown value against the current options, saves schedules by name instead of chart row position, and the helper and size/schedule forms show a message instead of failing silently or saving to another pipe when a selection is blank.
- The calibration helper's pre-filled activity is rounded to 3 decimals and labelled with the date it applies to (kept after restart); the review marks it as pre-filled. Change it if the shot was on another day.
- In decay mode a restored draft no longer overwrites the calculated Current activity box with an older figure, so switching to manual mode starts from today's activity.
