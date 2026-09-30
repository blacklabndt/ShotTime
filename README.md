# ShotTime 1.21.0

Offline Android Ir-192 shot-time reference app. Android 8/API 26 minimum, target API 36 (Android 16). Package `ca.kylekeith.shottime`. Requires a compatible, updated Android System WebView.

## Current calculation

Since 1.21.0 every film uses one shared Ir-192 steel model in `assets/calculator.js`; `assets/techniques.json` holds geometry only.

```
Ci·s = reference Ci·s × (SFD ÷ reference SFD)² × 2^((steel − reference steel) ÷ 12.1 mm)
```

Steel is the total of both walls. 12.1 mm is the Ir-192 half-value thickness in steel measured from the GE/Agfa STRUCTURIX Ir-192 exposure diagram (Pb screens); all six films share it. Reference shots: 4-inch STD for large films, 3-inch STD for small films. Preserve full precision until display.

Large films use approximate calculator targets on 4-inch STD at 26 Ci:

| Film | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 |
|---|---:|---:|---:|---:|---:|
| D5 | 11 | 15 | 19 | 23 | 27 |
| T200 | 14 | 18 | 22 | 25.5 | 29 |
| Fuji IX80 | 13 | 18 | 23 | 28 | 33 |

Small films are tied to their large-film partner at the same geometry using published Ir-192 relative exposures at density 3.0 — D4 = D5 × 2.0 (Agfa D4 3.0 / D5 1.5), MX125 = T200 × 1.65 (Carestream 2.8 / 1.7), Fuji IX50 = IX80 × 1.83 (Fuji speed 55 / 30) — and keep their own density-curve shape (original targets D4 9/13/16/19.5/23, MX125 16/20/24/27.5/31, IX50 17/21/25/29.5/34, scaled to the density-3 value). Resulting 3-inch STD times at 26 Ci:

| Film | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 |
|---|---:|---:|---:|---:|---:|
| D4 | 12.4 | 17.8 | 22.0 | 26.8 | 31.6 |
| MX125 | 14.0 | 17.5 | 20.9 | 24.0 | 27.1 |
| Fuji IX50 | 16.6 | 20.5 | 24.4 | 28.8 | 33.1 |

Times are seconds. Density 3.5 is the arithmetic midpoint of 3.0 and 4.0 in the source targets. Reference targets and published ratios are not measured film densities for this processing; verify them with test shots and correct with film-wide factors. `scripts/original-techniques.json` keeps the pre-1.21 per-film Ci·s baseline for comparison only.

Final seconds = model Ci·s × film-wide correction × size/schedule correction ÷ current source Ci. Both editable correction types are density-specific and default/reset to 1.00. Internal = unrounded final seconds / 9, nearest second. Internal offset = unrounded final seconds × 1.15 / 4, rounded up. Internal columns apply only to 6-inch and larger pipes. Standard times retain nearest-second rounding including 0s.

73 geometry rows, 219 film/geometry combinations, five densities (1,095 exposure combinations). Small films cover 1–3 inches; large films 4–16 inches. Double-wall carbon steel. 1-inch pipe uses 12-inch SFD; other sizes use OD +0.125 inches. Processing reference: manual 4 minutes at 72°F, Carestream INDUSTREX Single Part developer, lead screens. The app does not model weld reinforcement, source transit, oblique paths or geometric unsharpness. Film-wide adjustments require verification across the sizes used.

## Application behavior

Compact-only dark UI with Time, Internal and Internal offset columns. Multi-select pipe/schedule filters. Manual activity or daily Ir-192 decay from a reference using a 73.83-day half-life. Film-wide helper and manual size/schedule correction controls. Prints a narrow vertical list with only activity, density and local date above it.

Settings use one local JSON record with explicit storage-failure reporting. Draft inputs and panels are restored after reload. The record carries `schemaVersion: 2`. Version 1 records (1.20.0, previous exposure model) are migrated once: film-wide factors and the saved draft reset, everything else (size/schedule factors, films, source, filters, density) is kept. Records without a version (pre-release builds) are ignored. Film-wide factors are stored as `factor.<density>.<film>` and size/schedule factors as `weld.<density>.<film>.<size>.<schedule>`. Stored factors outside 0.10–10.00 load as 1.00. A future storage change should increase the schema version and add an explicit, tested migration.

No network permission, tracking or JS-to-native interface. Printing uses a separate JS-disabled WebView snapshot and the Android print service. Preparation timeout, error callbacks and main-thread cleanup provide recovery. Real-device printing, installation, rotation and background/foreground checks remain necessary.

## Build

Set `SDK_ROOT` to an Android SDK with platform android-36 and build-tools 36.0.0. Run `SDK_ROOT=/path/to/sdk bash build.sh` with Java 17 available.

Restore the separate private signing backup into `signing/` before building. The build refuses to generate a replacement key. Signing credentials are excluded from the source archive. Never share the signing backup. Keep the package and key unchanged for installation as an update, and increase versionCode for each release.

## Active verification

- `node tests/test-current-calculator.cjs`: all 1,095 combinations follow the shared steel model; 30 reference targets; published small/large film ratios; Agfa D4/D5 shape within 4% of the historical Agfa-curve baseline; activity scaling, parsing, date validation and rounding.
- `CHROME_BINARY=/path/to/chromium node tests/test-current-ui.mjs`: six films across the five densities, corrections, calibration helper with size/schedule factors, save failures, persistence, reset behavior, narrow layouts and print agreement.
- `CHROME_BINARY=/path/to/chromium node tests/test-settings-storage.mjs`: version 1 migration, unversioned records ignored, per-density factor and size/schedule keys, schema version, range checks, resets across five densities and persistence after reload.

Requires the available Playwright package. `tests/legacy/` contains historical harnesses, not active release gates. Physical Android print-service checks are not simulated by browser tests.

## 1.21.0 (versionCode 42, not yet built, signed or device-tested)

- Exposure model redesign (shot times change):
  - Step 1: all films share one Ir-192 steel curve (inverse square for SFD, exposure doubles every 12.1 mm of total steel) anchored at each film's reference shot. Agfa D4/D5 change by about 2% or less; Carestream and Fuji become longer on heavy wall (up to about 30% for T200 and 2× for IX80 on 12"–16" Sch160).
  - Step 2: small films are tied to their large-film partner by published Ir-192 relative exposures. At 3-inch STD, 26 Ci, density 3.0: D4 16 → 22 s, MX125 24 → 21 s, Fuji IX50 25 → 24 s.
  - `techniques.json` is geometry only; the old per-film Ci·s baseline stays in `scripts/original-techniques.json` for comparison.
- Settings schema 2: film-wide factors and the saved draft reset to 1.00 on upgrade from 1.20.0 (they were set against the old model); a one-time message says so. Size/schedule factors are kept but should be reviewed.
- Not yet verified with test shots; see `HANDOVER.md`.

## 1.20.0 (versionCode 41, never released)

- Calibration helper divides out the selected pipe's size/schedule factor, so that pipe keeps the successful time.
- Film factor form keeps unchanged values, names the out-of-range film and focuses its box.
- Clean-slate settings storage before first release: removed the density-3 migration, legacy namespaces and standalone-key fallbacks; added `schemaVersion: 1`. Pre-release saved settings are discarded. Built-in shot times are unchanged.
- Draft restoration checks each restored dropdown value against the current options, saves schedules by name instead of chart row position, and the helper and size/schedule forms show a message instead of failing silently or saving to another pipe when a selection is blank.
- The calibration helper's pre-filled activity is rounded to 3 decimals and labelled with the date it applies to (kept after restart); the review marks it as pre-filled. Change it if the shot was on another day.
- In decay mode a restored draft no longer overwrites the calculated Current activity box with an older figure, so switching to manual mode starts from today's activity.
- The helper's Current factor and the size/schedule form's Film-wide factor show the factor actually in use (invalid stored values count as 1.00) instead of the raw stored value.
- The printed date uses the app's own year-month-day date (the same one used for decay) instead of WebView locale formatting.
- Print flow (`MainActivity.java`, manifest):
  - Rotation and other size changes no longer recreate the Activity (`configChanges`), so an open print screen is not torn down. On `onDestroy`, the print adapter is detached (`super.onDestroy()`) before the print WebView is destroyed; `onFinish` errors are caught.
  - If the main screen's renderer crashes while the print screen is open, the reload waits until printing finishes.
  - A print session no longer stays stuck if the print service never reports it finished: on returning to the app, or on the next Print tap, a completed, cancelled or failed job is cleaned up.
  - Tapping Print with nothing to print shows "Nothing to print. Check the source activity and filters."
  - A failure after the print screen has opened shows "Printing was interrupted. Close the print screen and try again." and keeps the session until Android reports it finished, instead of blaming the print service and allowing a second print.
  - Compiled and packaged with `build-review.sh` (platform 35, build-tools 35.0.0); not yet tested on a device.
- Chart data: removed the unused file-level `density` and per-row `film`/`curieSeconds` fields from `assets/techniques.json` and `scripts/original-techniques.json`. Exposure values are unchanged.
- Screen readers: each result value is announced with its column name (Schedule, Time, Internal, Internal offset; "not applicable" below 6"), and the visual column header row is hidden from them.
- Decay mode rebuilds the results only when the decayed activity changes (once a day), not on every one-minute check.
- Target API raised to 36 (Android 16); build scripts use platform android-36 and build-tools 36.0.0. Back handling uses `OnBackInvokedCallback` on Android 13+ (`enableOnBackInvokedCallback="true"`) and `onBackPressed` on Android 8–12, so Back still closes an open sheet or preview before leaving the app. Compiled and packaged with `build-review.sh`; not yet tested on a device.

## 1.19.1

Consolidated density targets into one table and removed unreachable model branches. Replaced stale workbook/fallback correction wording. Refreshed documentation and test summaries. All 1,095 outputs and six migration multipliers match v1.19.0 exactly; no shot-time or saved-key changes were introduced.
