# Codex handover: ShotTime 1.22.0

Prepared 2026-10-11. Branch `claude/vigilant-pascal-72mdsi`.

Read in this order:
1. `AGENTS.md`: hard rules, setup and tests.
2. This file: what changed in this session and what is next.
3. `HANDOVER.md`: full history, owner decisions, device checklist.
4. `docs/CR-PROFILE-MODEL.md`: only if you touch Carestream CR.

## State

- Source is 1.22.0, versionCode 44. The test command `npm test` passes all five checks: generator, calculator, CR model, UI and storage.
- `build-review.sh` compiles and packages an unsigned APK against API 36. Its badging shows `versionCode='44' versionName='1.22.0'`, target SDK 36, and no permissions.
- **Not yet signed, released or run on a phone.** Signing needs the owner's private `signing/` backup, which is intentionally absent. Never create or request a key.
- This repo is the standalone ShotTime app. The owner also has a larger app, RT Handbook (1.96, versionCode 118), in a separate local workspace that is not in this repo. That app has Custom Shot and an older `cr70` CR option. None of the work below has been ported there. Do not assume the two codebases match.

## What changed in this session

### 1. Carestream CR: the chart is replaced by a formula with a PMT slider (owner request)

```
Ci·s = 523 × 2^((41 − PMT) ÷ 7.5) × (SFD ÷ 4.625)² × 2^((total steel − 12.04 mm) ÷ 14.8 mm)
time = Ci·s ÷ activity
```

- **Code:** `assets/calculator.js` holds `crExposure`, `CR_*` constants, `crPmtRange`, `crSuggestedPmt` and `validPmt`. The CR branch of `densityExposure` takes an optional `pmt`: undefined means the suggested PMT; anything else must be a whole number in that size's range or it throws.
- **Steel curve:** 14.8 mm comes from the owner's old CR chart, fitted within each pipe size. PMT was set per size, so it cannot bias this fit.
- **PMT term: assumed, not measured.** The rule that 7.5 PMT units doubles the signal (`CR_PMT_DOUBLING`) was fitted so the chart's per-size gain steps line up with the owner's slider ranges. It has not been measured on the HPX-1. Keep it labelled as an assumption until the owner measures it.
- **Slider ranges (owner):** 1"–3" 20–50, 4"–8" 30–60, 10" and up 40–70.
- **Suggested PMT:** the PMT at which the formula best matches the old chart for that size. Median difference 6%; 51 of the 53 consistent rows are within 20%.

  | Size | 1" | 2" | 3" | 4" | 5" | 6" | 8" | 10" | 12"–16" | 18"–20" | 24" |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Suggested PMT | 35 | 35 | 38 | 41 | 44 | 46 | 52 | 54 | 55 | 56 | 57 |

- **Known differences from the chart** at the suggested PMT:
  - 3", 4" and 8" STD are 15–18% shorter.
  - 3" XXH is 33% longer and 4" XXH is 26% longer. The owner plans per-row size/schedule corrections for these, from test shots.
  - Three chart rows disagree with their own pipe size, and the formula does not follow them: 6" XXH, 14" Sch 40 and 24" XH (85,610 Ci·s, almost certainly a typo).
- **UI** (`assets/index.html`):
  - `pmtControl()` puts one slider on each pipe card when CR is the belt's film. Dragging rebuilds only that card's rows.
  - "Use suggested" resets the slider and keeps keyboard focus.
  - The printed list shows `PMT nn` under the pipe size on CR rows. This is not a separate column.
  - The calibration helper asks for the PMT the shot was read at. Its value follows the slider until the user types a different one.
- **Storage:** new key `pmt.<size>`. It is additive, so the schema stays at 2. A missing, non-integer or out-of-range value falls back to the suggested PMT.
- **Old chart:** kept only in `scripts/cr-chart.json` for comparison tests.
- **Analysis:** `scripts/cr-profile-model.cjs` and `docs/CR-PROFILE-MODEL.md`.

### 2. Four-way audit, all medium and low findings fixed

Areas audited: calculations, app state, Android host, and display/print/tests. The full list is in `README.md` under 1.22.0 → Audit fixes. Highlights:

- **Filters:** the rule that a pre-1.21 full filter list means "all" now runs only when migrating a version-1 record. A current filter that leaves out only 18", 20", 24" or Sch 10 is kept.
- **Restored drafts:** the helper's CR and density fields are set up for the restored film.
- **CR factor:** the per-density reset no longer touches the density-free `factor.cr`.
- **Android:**
  - `MetricsOptOut` meta-data (owner request).
  - The insets listener returns `WindowInsets.CONSUMED`.
  - `configChanges` adds `uiMode|density|fontScale|locale|layoutDirection`, so an open print preview survives those changes.
- **Build:** both scripts delete `build/classes` and `build/dex` first, and run `d8 --release`.
- **Tests:** every app fix has a test that fails when the fix is undone; this was checked one fix at a time.

## Owner decisions to respect (in addition to HANDOVER.md)

- **No chart:** CR uses the formula only. Do not bring the chart back into the app.
- **6" and 8" slider:** use the 4" range, 30–60.
- **Corrections:** row differences such as 3" and 4" XXH are handled with CR size/schedule factors (`weld.cr.<size>.<schedule>`), not by changing the formula.
- **Sub-second times:** they still display as `0s`. This was an earlier owner choice.
- **Open, ask the owner:**
  - Should saved settings be blocked from copying to a new phone? Today they transfer, because `allowBackup="false"` does not cover device-to-device transfer. Blocking would need `dataExtractionRules`.
  - Is the 4" Sch 60 row (0.281" wall) correct? It came from the owner's data, and B36.10M may not list it.

## Next work

1. **Owner measurements; nothing to code until results arrive:**
   - **PMT gain:** two identical fresh plates read at PMT 41 and 56. If the ratio R is not about 4, set `CR_PMT_DOUBLING = 15 / log2(R)`. Update the tests and README, and re-derive `CR_SUGGESTED_PMT`: `41 + doubling × log2(K₄ / K_size)` using the per-size K values from `node scripts/cr-profile-model.cjs`.
   - **First CR test shots at the suggested PMT:** 3", 4" and 8" STD, plus 3" and 4" XXH.
2. **Device testing:** use the checklist in `HANDOVER.md`, plus the items below, which are new in 1.22.0:
   - With print preview open, toggle dark mode and change font and display size. The preview should stay open and printable.
   - On Android 15/16: no doubled gap at the top or bottom, and the keyboard does not cover the inputs.
   - Drag the CR slider on a phone: times update live, and the value survives an app restart.
   - Confirm the printed PMT line on paper.
3. **Release:** owner only. `SDK_ROOT=… bash build.sh` produces `dist/ShotTime-v1.22.0.apk`. Afterwards, replace `release/` and regenerate `SHA256SUMS`.
4. **Port to RT Handbook, only if the owner asks.** Copy `crExposure` and its constants with the PMT slider behaviour, and keep the old chart and `cr70` decisions there for the owner. That app's Custom Shot takes total steel and actual SFD, which fits this formula directly.
5. **Not done:**
   - Text at 200% zoom wraps the time column headings (rated a nit).
   - `mapfile` in the build scripts needs Bash 4.

## Verify

```sh
npm install
npx playwright install chromium   # or set CHROME_BINARY to an existing Chromium
npm test                          # needs python3 for the generator check
SDK_ROOT=/path/to/android-sdk bash build-review.sh
```

This session got the SDK by downloading `platform-36_r02.zip` and `build-tools_r36_linux.zip` from `https://dl.google.com/android/repository/`. It unzipped them as `platforms/android-36` and `build-tools/36.0.0`.

## Rules worth repeating

- **Calculation numbers:** do not change them without the owner's explicit approval. Fitting to the chart or matching references is not physical validation, so never claim it is.
- **No network:** no tracking and no JS-to-native bridge. The only page-to-native channel is `shottime://print`. Keep the CSP.
- **Versions:** bump `android:versionCode` for any build installed over a previous one. When behaviour changes, update `README.md`, `HANDOVER.md` and `SHA256SUMS`.
- **Commits:** keep the repo's commit style. Never commit `signing/`, `dist/` or `node_modules/`.
