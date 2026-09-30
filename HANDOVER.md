# ShotTime handover — 1.21.0 (versionCode 42)

Status on 2026-09-30: source is at 1.21.0, which changes the exposure model (shot times change; see below). All three test suites pass and `build-review.sh` compiles and packages against Android 16 (API 36). **Not yet signed, released or tested on a device.** The last signed release is 1.19.1 (versionCode 40) in `release/`.

The app has not been released to anyone except the owner, which is why the settings storage was reset rather than migrated (see decisions below).

## What changed from 1.19.1

A review of 1.19.1 found no high-severity issues. Every finding the owner approved has been fixed; each commit's message explains its fix.

| # | Finding | Resolution | Commit |
|---|---|---|---|
| 1 | Calibration helper ignored the pipe's size/schedule factor, which then applied twice (e.g. a verified 30 s shot made that pipe show 38 s) | Helper divides out the selected pipe's size/schedule factor; review shows it | `03d667b` |
| 2 | Migrated film factors below 0.10 blocked saving all film factors | Form keeps unchanged values, names and focuses the out-of-range film | `ee8c757` |
| 3 | Migration copied density 2/2.5/3.5 factors to keys nothing read | App unreleased, so storage reset: one versioned record, one key pattern, no migration | `4af41e1` |
| 4 | Restored drafts could blank dropdowns; blank film failed silently, blank schedule meant row 0 (1" pipe) | Restored values validated; schedules stored by name; forms show "Choose a pipe size, schedule, film and density" | `270b8cc` |
| 5 | Helper pre-filled today's activity for a shot that may be older (~0.93%/day error) | Pre-fill rounded to 3 decimals and labelled with its date, including after restart | `6e9ff51` |
| 6 | In decay mode a restored draft showed an old activity figure, which manual mode could then apply | Decay-mode activity box is never restored from a draft | `38a1b13` |
| 7 | Helper and size/schedule form could show ×NaN or an out-of-range stored factor | `storedFilmFactor()` shows the factor actually in use | `1ecfad6` |
| 8 | Printed date relied on WebView locale formatting | Printed date uses the app's own `today()` (YYYY-MM-DD) | `4918b01` |
| P1–P4 | Print flow: cleanup could cut off a print; printing could get stuck; silent no-op; misleading error after a crash | `configChanges` for rotation; adapter detached before snapshot destroyed; `PrintJob` status check on resume/next tap; "Nothing to print" message; "Printing was interrupted" handling | `ca82d70` |
| N1 | Unused `density`, `film`, `curieSeconds` fields in chart data | Removed from both copies; exposures unchanged | `fe2dcde` |
| N4b | TalkBack read result values without column names | Hidden column labels per value; "not applicable" below 6"; visual header row hidden from screen readers | `fe2dcde` |
| N4c | Decay mode rebuilt results every minute | Rebuilds only when the decayed activity changes (daily) | `fe2dcde` |
| N3 | Back button would stop working when targeting API 36 | Target API 36; `OnBackInvokedCallback` on Android 13+, `onBackPressed` on 8–12 | `56bf37b` |
| — | Version | 1.20.0, versionCode 41 (never released) | `4ba9864` |
| R1 | Films disagreed on how exposure grows with steel (effective half-value thickness 12.0 mm Agfa vs 14.6 mm Fuji); up to 2× apart on heavy wall | Step 1: one shared Ir-192 steel curve (12.1 mm, from the Agfa/GE Structurix chart) for all films, anchored at each film's reference shot | 1.21.0 |
| R2 | Small-film targets were entered independently of large films; D4/D5 implied 1.46× vs Agfa's published 2.0× | Step 2: small film = large partner × published ratio at the same geometry (D4 = D5 × 2.0, MX125 = T200 × 1.65, IX50 = IX80 × 1.83). D4 3" STD: 16 → 22 s at 26 Ci | 1.21.0 |
| — | Version and settings | 1.21.0, versionCode 42; settings schema 2 resets film-wide factors on upgrade | 1.21.0 |

`README.md` has the user-facing change lists under "1.21.0" and "1.20.0".

## Owner decisions to respect

- **Exposure model (1.21.0):** the owner approved the shared steel curve and the published small/large ratios, to be verified by test shots. Measured results may replace the published ratios or large-film reference times.
- **Calibration helper** divides out the selected pipe's size/schedule factor (option chosen over "show the doubled result").
- **Storage clean slate:** pre-release saved settings are discarded (`schemaVersion: 1`). From now on, storage changes need a real migration.
- **Helper activity pre-fill** stays, labelled with its date (chosen over removing it or asking for a shot date).
- **Left as-is on purpose:**
  - XXH/XXS rows are listed after schedule 160 for 8"–16" even though their wall is thinner (conventional order; values are correct).
  - Small 9–10px text (eyebrow, offline badge, "Correction ×" note) was not enlarged; the owner skipped that change.
  - Standard times can display `0s`; the owner chose to keep that.

## Open work

1. **Test shots for the 1.21.0 model** (owner): at density 3.0, 72 °F / 4 min, one hanger —
   - D4 on 3" STD and D5 on 4" STD at the app's times: checks the D4/D5 ratio (2.0) and D5's reference time.
   - One heavy-wall D5 shot (e.g. 10" or 12" Sch160): checks the 12.1 mm steel curve at the thick end.
   - If Carestream or Fuji are used, the same pair for MX125/T200 or IX50/IX80.
   - Correct with film-wide factors (the helper calculates them), or, if a published ratio or reference time is consistently off, update `FILM_REFERENCES` in `calculator.js` with owner approval.
2. **Sign and release** (owner only, needs the private `signing/` backup): `SDK_ROOT=/path/to/sdk bash build.sh` produces `dist/ShotTime-v1.21.0.apk`. `release/` still holds the signed 1.19.1 APK; replace it when a signed 1.21.0 exists and regenerate `SHA256SUMS` (it covers every tracked file except itself).
3. **Device testing** — none of the native changes has run on a phone. Checklist:
   - Install over 1.19.1: installs as an update; saved settings reset to defaults (expected). Over a 1.20.0 test install: a one-time message says film factors reset to 1.00.
   - Print normally, then print again straight away.
   - Open print preview, rotate several times, then print.
   - Open print preview, press Home, return, then print or cancel.
   - Cancel from print preview, then tap Print again.
   - Rotate on the main screen with a sheet open: sheet stays open and in place.
   - Back with a sheet open closes the sheet (Android 13+ and, if available, 8–12). Back with Preview open closes it. Back with nothing open leaves the app.
   - TalkBack: swipe through a result row; column names are read, "not applicable" below 6".
   - Font scaling and keyboard focus in the setup sheet.
   - Edge-to-edge insets and on-screen keyboard on Android 15/16.
   - Not practical to trigger: renderer crash during printing; print service that never finishes. Reviewed by reading only.
4. **Optional hardening not yet requested:** no automated coverage for native code; historic `tests/legacy/` could be deleted; the whole app is one dense HTML file, which makes review harder.

## Environment notes from the previous session

- Playwright 1.62.1 worked with Chromium build 1194 via `CHROME_BINARY`.
- Android SDK installed from `dl.google.com` command-line tools: `platforms;android-36`, `build-tools;36.0.0` (platform 35 also verified earlier).
- No KVM was available, so no emulator runs were possible.
