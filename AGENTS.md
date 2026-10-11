# AGENTS.md — ShotTime

Instructions for coding agents (Codex and others) working in this repository. Read this first, then `HANDOVER.md` for the current state and open work. `START-HERE.md` and `REVIEW-BRIEF.md` describe the earlier 1.19.1 code review; that review is finished.

## What this is

Offline Android app (package `ca.kylekeith.shottime`) that calculates Ir-192 exposure ("shot") times for double-wall carbon-steel pipe film radiography. It is a single-Activity native wrapper around one WebView page.

- `assets/index.html` — the whole UI and app logic (inline CSS and JS). At runtime `MainActivity` substitutes `/*__TECHNIQUES__*/` with `techniques.json` and `/*__CALCULATOR__*/` with `calculator.js`.
- `assets/calculator.js` — pure calculation module: the shared Ir-192 exposure model (reference shots, steel half-value thickness, small/large film ratios), parsing, rounding labels, decay. Also loadable from Node.
- `assets/techniques.json` — 114 pipe geometry rows (size, schedule, wall, SFD, group; NPS 1–24, ASME B36.10M walls; 14"/16" XXH 1.000" is the owner's non-standard entry) plus film names and groups. Geometry only since 1.21.0; regenerate with `scripts/generate-films.py`, which holds the added sizes and Sch 10 walls.
- `scripts/original-techniques.json` — the pre-1.21 per-film Ci·s baseline, kept only for comparison tests.
- `src/ca/kylekeith/shottime/MainActivity.java` — WebView host, window insets, Back handling, native print flow.
- `AndroidManifest.xml`, `res/` — manifest, theme, icon.
- `scripts/cr-chart.json`, `scripts/cr-profile-model.cjs` — the former CR chart and the analysis that fitted the CR formula to it (`docs/CR-PROFILE-MODEL.md`).
- `tests/` — three active suites plus `test-cr-profile-model.cjs` (Node only). `tests/legacy/` is archived and not runnable; ignore it.
- `release/ShotTime-v1.19.1.apk` — the last signed release (versionCode 40), kept for reference only.

## Hard rules

- **Do not change calculation assumptions or numbers** without the owner's explicit approval. The model (1.21.0): Ci·s = reference Ci·s × (SFD ÷ reference SFD)² × 2^((total steel − reference steel) ÷ 12.1 mm). Large films (D5, T200, IX80) use calculator targets on 4" STD at 26 Ci; small films (D4, MX125, IX50) = partner × published ratio (2.0, 1.65, 1.83) at the same geometry and every density, so partners share a hanger at any target. Carestream CR (`cr`, both belts) is the exception (1.22.0): Ci·s = 523 × 2^((41 − PMT) ÷ 7.5) × (SFD ÷ 4.625)² × 2^((total steel − 12.04 mm) ÷ 14.8 mm). It is the same at every density, with a per-size PMT slider (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70), the suggested PMTs in `CR_SUGGESTED_PMT`, and Internal ÷ 8 and Internal offset ÷ 3 rounded up. The 7.5-unit PMT doubling is fitted, not measured. The owner's former chart lives only in `scripts/cr-chart.json` for comparison. Rows over 90 mm total steel (`MAX_STEEL_MM`) are hidden because they lie beyond the Agfa chart. `exposureAtDensity` interpolates the film curve log-linearly between the five target densities (used by the helper's measured density). Also fixed: SFD rule, rounding rules (time nearest second; Internal = unrounded ÷ 9 nearest second; Internal offset = unrounded × 1.15 ÷ 4 rounded up; internal columns only for 6" and larger), 73.83-day half-life. `tests/test-current-calculator.cjs` pins all of this. The owner plans test shots; measured ratios or reference times may later replace the published ones.
- **Signing:** never generate, request, commit or redistribute a signing key or password. `build.sh` needs the owner's private `signing/` backup, which is intentionally absent. Keep the package name and signing identity unchanged. Use `build-review.sh` (unsigned) to check compilation.
- **No network, tracking or JS-to-native bridge.** The only page-to-native channel is navigation to `shottime://print`. The print WebView runs with JavaScript disabled. Keep the CSP in `index.html`.
- **Do not reintroduce** the removed "Starting estimates" banner, the Detailed view, or extra print columns (film, wall, SFD, notes, footer). The print sheet shows activity, target density and local date above a Pipe / Schedule / Time / Internal / Internal offset table; for Carestream CR rows the Pipe cell also shows the PMT under the size (not a separate column).
- **Settings storage:** filters saved as `null` mean all options; one localStorage record `shottime.settings` with `schemaVersion: 2` (version 1 migrates by resetting film-wide and size/schedule factors and the draft). Keys: `factor.<density>.<film>`, `weld.<density>.<film>.<size>.<schedule>` (density-free `factor.cr` and `weld.cr.<size>.<schedule>` for CR), `film.small|large`, `filter.pipe|schedule`, `density`, `source`, `printSize`, `draft`, `pmt.<size>` (CR slider, whole number in that size's range, else the suggested PMT). If you change the storage shape after release, bump `SCHEMA_VERSION` and write an explicit, tested migration; do not silently drop saved factors.
- Do not claim that matching the reference targets validates physical radiographic exposures.
- Bump `android:versionCode` for every release that will be installed over a previous one.

## Setup and tests

Requires Node.js 18+, Python 3 (generator check) and a Chromium for Playwright.

```sh
npm install                      # installs playwright 1.62.1 (no lockfile is committed)
npx playwright install chromium  # needs network; or point CHROME_BINARY at an existing Chromium
npm test                         # generator check, calculator, CR model, UI and storage suites
```

Individually:

- `node tests/test-current-calculator.cjs` — geometry (SFD rule, B36.10M walls), shared steel model across all 1,710 combinations, 30 reference targets, published film ratios, the CR formula, PMT ranges and agreement with the former CR chart, CR internal rules, Agfa shape check, parsing, rounding, date validation.
- `CHROME_BINARY=/path/to/chrome node tests/test-current-ui.mjs` — UI: six films × five densities, Carestream CR and its PMT sliders, corrections, calibration helper, save failure, persistence, narrow layouts, screen/print equality, printed date, screen-reader labels.
- `python3 scripts/generate-films.py --check` — committed `techniques.json` equals the generator's output.
- `node tests/test-cr-profile-model.cjs` — the CR chart analysis; the app's 14.8 mm CR steel curve equals the fitted value.
- `CHROME_BINARY=/path/to/chrome node tests/test-settings-storage.mjs` — storage schema (version 1 filter migration), CR PMT fallback, print at non-suggested PMT, helper PMT and draft restore, slider labels/focus, per-density keys, range checks, resets, draft restoration, helper pre-fill, decay-mode behaviour, displayed factors.

The tests load `index.html` with the same substitutions `MainActivity` does, on a routed `https://shottime.local/` origin; no server is needed. When you fix a bug, add an assertion that fails on the old code.

## Android build

Requires JDK 17+ (21 works), Python 3, Bash, and an Android SDK with **platform android-36** and **build-tools 36.0.0**. No Gradle.

```sh
SDK_ROOT=/path/to/android-sdk bash build-review.sh   # unsigned: dist/ShotTime-review-unsigned.apk
```

Expected output includes `versionCode='44' versionName='1.22.0'` and `targetSdkVersion:'36'`. The `-source 8` obsolete-option warnings and four deprecation warnings (`setDecorFitsSystemWindows`, `setStatusBarColor`, `setNavigationBarColor`, `setSystemUiVisibility`, all on intentionally version-guarded paths) are known. `build/` and `dist/` are git-ignored.

Browser tests do not exercise `MainActivity.java`. Native behaviour (printing, Back, insets, rotation, TalkBack) needs a device or an emulator with hardware acceleration.

## Code style

- Match the existing dense style in `index.html`: compact single-line functions, `$()` for `getElementById`, `C` for `ShotCalculator`, `CHART` for the data. Keep comments sparse and explain *why*.
- Java targets `-source 8` with lambdas; guard APIs above 26 with `Build.VERSION.SDK_INT`, and put API 33+ types in a nested class (see `BackApi33`) so older Android never loads them.
- Keep changes minimal and focused; update the current version's section in `README.md` when behaviour changes.
