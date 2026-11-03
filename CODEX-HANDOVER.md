# Codex handover — RT Handbook (ShotTime) 1.101

Prepared 2026-11-03. Start here, then read `AGENTS.md` (rules and dated history, newest first) and the doc for whatever area you touch. `HANDOVER.md`, `START-HERE.md` and `REVIEW-BRIEF.md` are mostly historical; where they conflict with this file or the top of `AGENTS.md`, the newer text wins.

## 1. Repository and git state

| Item | Value |
|---|---|
| GitHub | `blacklabndt/ShotTime` |
| Default branch | `ccr-e7d37b7d-65nw9y` (this is the GitHub default; there is no `main`) |
| Head of default branch | `e9d4f89` — "Release 1.101: replace legacy CR choice with CS Flex HR" (2026-10-14) |
| Other branches | `claude/awesome-fermi-x2kebx` (same commit + this handover), `claude/vigilant-pascal-72mdsi` (stale, at `8802136`, fully contained in default; safe to ignore) |
| Uncommitted work | None. `build/`, `dist/`, `signing/`, `node_modules/` are git-ignored. |

Fetched and compared on 2026-11-03: no branch contains commits that the default branch lacks. The only change on top of `e9d4f89` is this file plus a pointer to it at the top of `AGENTS.md`.

## 2. What the app is

Offline Android app, package `ca.kylekeith.shottime`, display name **RT Handbook**. A single Activity hosts one WebView (`assets/index.html`, inline CSS/JS) plus native Java for print, voice, CSV share, backup/restore, chart links and a floating shot timer. No Gradle.

Sections in the app:

1. **Shot Time Calc**: Ir-192 double-wall exposure times for film (D4/D5, MX125/T200, IX50/IX80) and **CS Flex HR** (calibrated Carestream CR, internal id `crcal`). Custom Shot covers arbitrary geometry, including **HPX-DR 3543 PE** (`dr3543pe`).
2. **Code Calculator**: B31.3, B31.1 (2012), CSA Z662 sweet/sour, BPVC Section I/VIII/IX references, unsharpness, offline vector charts.
3. **QC Notes / Note Taker**: jobs → daily lists, XF/MT numbering, offline Whisper voice (plus optional OpenAI cloud voice), CSV export, backup/restore.
4. **Native shot timer**: foreground service, exact alarms, floating overlay card.

Key files:

- `assets/calculator.js`: pure calculation module (film model, CR calibrated model, DR, rounding, decay). Loadable from Node.
- `assets/index.html`: all calculator UI. Placeholders `/*__TECHNIQUES__*/`, `/*__CALCULATOR__*/` etc. are substituted by `MainActivity` and mirrored by `tests/load-app.mjs`.
- `assets/techniques.json`: 114 pipe geometry rows plus film list.
- `assets/notes-*.js`: notes model, parser, jobs, storage, voice and UI.
- `assets/code-*.js`, `unsharpness*.js`: Code Calculator.
- `src/ca/kylekeith/shottime/*.java`: native host, voice, timer, CSV, chart links.
- `native/`: whisper.cpp JNI build inputs (`build-voice.sh` / `.ps1`).

## 3. Release state

| Version | versionCode | Status |
|---|---|---|
| **1.101** | 123 | Source at `e9d4f89`. An `RT-Handbook-v1.101.apk` is on the owner's Google Drive: file ID `1gBBOZFVtha3UWyIe7_iYZx3ElFDJNb-A`, created 2026-10-15, modified 2026-10-31, 197,811,806 bytes. **No build-verification record is committed for 1.99–1.101** (`dist/` is ignored and lives only on the owner's Windows machine). |
| 1.100 | 122 | Source only in git history; no Drive file found. |
| 1.99 | 121 | Source only in git history; no Drive file found. |
| 1.98 | 120 | Signed and uploaded; record copied into `AGENTS.md`. SHA-256 `85df101b…dd41c`, also 197,811,806 bytes. |

⚠️ **Check before relying on the 1.101 upload:** the Drive 1.101 file has exactly the same byte size as the 1.98 APK. That could be coincidence (a small asset diff inside a ~198 MB APK dominated by the voice model), or 1.98 may have been uploaded under the 1.101 name. Verify by running `aapt dump badging` on the downloaded file (expect `versionCode='123' versionName='1.101'`) or by comparing SHA-256 against a fresh 1.101 build before telling the owner it is correct.

Manifest today: `versionCode="123" versionName="1.101" targetSdkVersion="36"`; `package.json` is `1.101.0`.

## 4. Recent changes (newest first)

- **1.101**: legacy chart CR (`cr`) removed from both belts and the helper/correction selectors. `crcal` is renamed **CS Flex HR** in the UI, Custom Shot and print. Saved `film.small|large = 'cr'` and helper/weld drafts migrate to `crcal`. Chart factors are not carried over, and a chart-based correction draft is discarded. `CHART_EXPOSURES.cr` stays in `calculator.js` for regression tests and provenance only.
- **1.100**: DR defaults to 6000 px. Custom Shot shows **total exposure** as the main result, with per-frame time and frame count underneath.
- **1.99**: HPX-DR 3543 PE in Custom Shot only. Seven published Carestream R-factor pixel targets (3000–21000; no interpolation), frame presets plus custom 1–999, fixed 13 mm HVL. See `docs/DR-HPX-3543.md`.
- **1.98**: CS Flex HR (then "Carestream CR (calibrated)") cards are PMT-only, in steps of 10. Built-in field shots from 2026-10-14 (72 Ci; 2" XH, 3" STD at PMT 20, 6" STD at PMT 40), unexposed value 200 (estimated), 2850 px target, and the built-in gain law (doubling every 12.4 PMT, offset 200). See `docs/CR-CALIBRATED.md`.

Removed features that must **not** come back unless the owner asks: CR Formula (`cr70`), CR field estimate (`crfield`), plate-exposure slider, short-shot warning, the "Starting estimates" banner, the Detailed view, extra print columns.

## 5. Hard rules (summary; full text in `AGENTS.md`)

- **Never change calculation numbers or assumptions without explicit owner approval.** That covers film references, ratios, the 12.1 mm steel curve, CR constants (`CR_DOSE`, `CR_DEFAULT_HVL_MM` 14.5, `CR_GAIN_LAW`, `CR_BUILT_IN_CALIBRATION`), DR R-factors, rounding and internal rules (film Internal ÷ 9, offset ÷ 3.2 nearest second; CR Internal ÷ 8, offset ÷ 3 rounded up; internals only ≥ 6"). The tests and `tests/fixtures/film-outputs-1.96.json` pin these.
- **Signing:** only the owner's replacement key: alias `shottime`, cert SHA-256 `af4e70b2acec7b614fceec08bb354d00f9eb067ee5780b2a713b2ea654f0310c`. Never generate, commit, print or redistribute keys or passwords. `signing/` is absent from git on purpose. Use `build-review.sh` for unsigned compile checks.
- **Network/bridge:** only the documented `shottime://` routes (print, share-csv, voice/*, timer/prepare, backup/save|restore) and the four exact `ChartLinks` HTTPS URLs. INTERNET is used only by `CloudClient` for fixed OpenAI endpoints with a user key. Keep the CSP. Keep the print WebView with JavaScript disabled. No `JavascriptInterface`.
- **Storage:** calculator settings `shottime.settings` schema 2. CR calibration `shottime.crCalibration` schema 1. Notes `shottime.notes` library schema 7. Custom shots `shottime.customShots.v1`. If you change any shape after release, bump the schema and add an explicit tested migration. Never silently drop saved data.
- Bump `versionCode` for every installable release. Do not include model identifiers in commits or docs.
- Never claim tests validate physical exposures, transcription accuracy or handset behaviour.
- When fixing a bug, add a test that fails on the old code. Match the dense existing style (`$()`, `C`, `CHART`, single-line functions).
- Record each change as a dated section at the top of `AGENTS.md` (and `README.md` for behaviour changes), as previous agents did.

## 6. Build and test

```bash
npm install
```

```bash
CHROME_BINARY=/path/to/chromium npm test
```

`npm test` runs the unsharpness pretest, ~15 calculator/UI suites and ~50 notes suites (`npm run test:notes` for notes only, `npm run test:timer` for the timer UI). Java unit tests are in `tests/*Test.java` (compile them with the matching `src/` classes).

Android (JDK 17+, SDK platform android-36, build-tools 36.0.0, NDK 28.2.13676358, CMake 3.22.1):

```bash
bash build-voice.sh
```

```bash
SDK_ROOT=/path/to/android-sdk bash build-review.sh
```

On Windows use `build-voice.ps1` / `build-review.ps1`. Signed builds use `build.sh` with the owner's private `signing/` folder. Past release records list the checks to repeat: v2/v3 signature, 16 KB alignment, manifest badging, and packaged-asset equality against `assets/` and the voice libraries.

**Verified on 2026-11-03 (Linux cloud container, Node 22, Playwright 1.62.1, Chromium at `/opt/pw-browsers/chromium`):** see section 9 for the `npm test` result. No Android build was attempted here (no SDK/NDK in this container).

## 7. Open work and known gaps

1. **Verify the 1.101 Drive APK** (see section 3) and, if missing, create `dist/BUILD-VERIFICATION-1.101.md` (and 1.99/1.100 if they were ever built).
2. **CS Flex HR calibration data** (owner): more reference shots, especially 10"+ (cards at PMT 40 run about 2× the chart there), a real measured gain table, exact unexposed-plate values (200 is an estimate), and hold-out shots for validation. A Carestream technique sheet was requested from the vendor. Measured data should replace chart-derived starts. See `docs/CR-CALIBRATED.md` "What the owner needs to collect".
3. **No import/export of `shottime.crCalibration`**; the notes backup does not include it. Losing app data loses the owner's reference shots.
4. **DR 3543 PE**: no physical panel validation; the 13 mm HVL is an approximation, and there are no detector integration limits.
5. **Handset verification outstanding** for timer behaviour since 1.88–1.95 (overlay, Reset/Resume, flash fix), voice routing, backup/restore and printing. Every release record says "handset installation unverified".
6. **Film model test shots** (owner): still unvalidated physically (`HANDOVER.md` "Open work" item 1).
7. **Offline AI interpreter**: trial only (`docs/OFFLINE-AI-TRIAL.md`); not integrated. Never auto-apply model output.
8. **Code Calculator source gaps**: B31.1 stays on 2012 pending a newer source. See `docs/CODE-CALCULATOR-REVIEW.md` and `docs/B311-SOURCE-SEARCH.md`.
9. Docs hygiene: `HANDOVER.md`'s title still says 1.21.1, and `AGENTS.md` "Setup and tests" still says "three suites" and cites `versionCode='43'`. These are historical, but they can mislead; tidy them only if asked.

## 8. Suggested first steps for Codex

1. `git fetch origin && git checkout ccr-e7d37b7d-65nw9y && git pull` (or work on the branch you are given).
2. Read `AGENTS.md` top sections through "Current state (1.82)", then `docs/CR-CALIBRATED.md` and `docs/DR-HPX-3543.md`.
3. Run `npm install` and `npm test`. Confirm green before changing anything.
4. Ask the owner which item in section 7 to take on. Do not change numbers, signing or release artefacts without explicit instruction.

## 9. Test result recorded for this handover

Full `npm test` was run on `e9d4f89` on 2026-11-03; the result is recorded in the next commit.
