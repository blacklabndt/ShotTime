# AGENTS.md — ShotTime

Instructions for coding agents (Codex and others) working in this repository. Read this first, then `HANDOVER.md` for the current state and open work. `START-HERE.md` and `REVIEW-BRIEF.md` describe the earlier 1.19.1 code review; that review is finished.

## What this is

Offline Android app (package `ca.kylekeith.shottime`) that calculates Ir-192 exposure ("shot") times for double-wall carbon-steel pipe film radiography. It is a single-Activity native wrapper around one WebView page.

- `assets/index.html` — the whole UI and app logic (inline CSS and JS). At runtime `MainActivity` substitutes `/*__TECHNIQUES__*/` with `techniques.json` and `/*__CALCULATOR__*/` with `calculator.js`.
- `assets/calculator.js` — pure calculation module (density targets, parsing, rounding labels, Ir-192 decay). Also loadable from Node.
- `assets/techniques.json` — 73 pipe geometry rows with baseline Ci·s per film. Must stay byte-identical to `scripts/original-techniques.json` (`scripts/generate-films.py` copies it).
- `src/ca/kylekeith/shottime/MainActivity.java` — WebView host, window insets, Back handling, native print flow.
- `AndroidManifest.xml`, `res/` — manifest, theme, icon.
- `tests/` — three active suites. `tests/legacy/` is archived and not runnable; ignore it.
- `release/ShotTime-v1.19.1.apk` — the last signed release (versionCode 40), kept for reference only.

## Hard rules

- **Do not change calculation assumptions or numbers** without the owner's explicit approval: reference targets and Ci·s in `calculator.js`, `techniques.json` exposures, SFD rule, rounding rules (time nearest second; Internal = unrounded ÷ 9 nearest second; Internal offset = unrounded × 1.15 ÷ 4 rounded up; internal columns only for 6" and larger), 73.83-day half-life, reference activity 26 Ci. All 1,095 film × geometry × density results must stay identical; `tests/test-current-calculator.cjs` enforces this.
- **Signing:** never generate, request, commit or redistribute a signing key or password. `build.sh` needs the owner's private `signing/` backup, which is intentionally absent. Keep the package name and signing identity unchanged. Use `build-review.sh` (unsigned) to check compilation.
- **No network, tracking or JS-to-native bridge.** The only page-to-native channel is navigation to `shottime://print`. The print WebView runs with JavaScript disabled. Keep the CSP in `index.html`.
- **Do not reintroduce** the removed "Starting estimates" banner, the Detailed view, or extra print columns (film, wall, SFD, notes, footer). The print sheet shows activity, target density and local date above a Pipe / Schedule / Time / Internal / Internal offset table.
- **Settings storage:** one localStorage record `shottime.settings` with `schemaVersion: 1`. Keys: `factor.<density>.<film>`, `weld.<density>.<film>.<size>.<schedule>`, `film.small|large`, `filter.pipe|schedule`, `density`, `source`, `printSize`, `draft`. If you change the storage shape after release, bump `SCHEMA_VERSION` and write an explicit, tested migration; do not silently drop saved factors.
- Do not claim that matching the reference targets validates physical radiographic exposures.
- Bump `android:versionCode` for every release that will be installed over a previous one.

## Setup and tests

Requires Node.js 18+ and a Chromium for Playwright.

```sh
npm install                      # installs playwright 1.62.1 (no lockfile is committed)
npx playwright install chromium  # needs network; or point CHROME_BINARY at an existing Chromium
npm test                         # runs all three suites
```

Individually:

- `node tests/test-current-calculator.cjs` — all 1,095 exposure combinations, 30 reference targets, parsing, rounding, date validation.
- `CHROME_BINARY=/path/to/chrome node tests/test-current-ui.mjs` — UI: six films × five densities, corrections, calibration helper, save failure, persistence, narrow layouts, screen/print equality, printed date, screen-reader labels.
- `CHROME_BINARY=/path/to/chrome node tests/test-settings-storage.mjs` — storage schema, per-density keys, range checks, resets, draft restoration, helper pre-fill, decay-mode behaviour, displayed factors.

The tests load `index.html` with the same substitutions `MainActivity` does, on a routed `https://shottime.local/` origin; no server is needed. When you fix a bug, add an assertion that fails on the old code.

## Android build

Requires JDK 17+ (21 works), Python 3, Bash, and an Android SDK with **platform android-36** and **build-tools 36.0.0**. No Gradle.

```sh
SDK_ROOT=/path/to/android-sdk bash build-review.sh   # unsigned: dist/ShotTime-review-unsigned.apk
```

Expected output includes `versionCode='41' versionName='1.20.0'` and `targetSdkVersion:'36'`. The `-source 8` obsolete-option warnings and four deprecation warnings (`setDecorFitsSystemWindows`, `setStatusBarColor`, `setNavigationBarColor`, `setSystemUiVisibility`, all on intentionally version-guarded paths) are known. `build/` and `dist/` are git-ignored.

Browser tests do not exercise `MainActivity.java`. Native behaviour (printing, Back, insets, rotation, TalkBack) needs a device or an emulator with hardware acceleration.

## Code style

- Match the existing dense style in `index.html`: compact single-line functions, `$()` for `getElementById`, `C` for `ShotCalculator`, `CHART` for the data. Keep comments sparse and explain *why*.
- Java targets `-source 8` with lambdas; guard APIs above 26 with `Build.VERSION.SDK_INT`, and put API 33+ types in a nested class (see `BackApi33`) so older Android never loads them.
- Keep changes minimal and focused; update `README.md`'s 1.20.0 section when behaviour changes.
