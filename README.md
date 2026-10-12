# RT Helper



Offline Android Ir-192 shot-time reference app. Android 8/API 26 minimum, target API 36 (Android 16). Package `ca.kylekeith.shottime`. Requires a compatible, updated Android System WebView.



## Carestream CR — 1.98

The Carestream CR chart now uses your Carestream sheet (+30% on 2"–6"), with three cells corrected: 24" XS, 14" Sch 40 and 6" XXH. Calibrated CR starts each card at the plate exposure your chart implies for its pipe size, from 5 R at 2" to 0.65 R at 24". Custom Shot can fill that value in for a chosen pipe size. It uses a 14.5 mm steel curve and a 0.5–6 R slider. Your reference shots still override these defaults. The CR field estimate was removed. See docs/CR-CALIBRATED.md.

## Carestream CR (calibrated) — 1.97

Film choice **Carestream CR (calibrated)** calculates from physics, with no chart values: Ci·s = plate exposure (R) × SFD² ÷ Ir-192 output × 2^(total steel mm ÷ H). Each pipe card has a plate exposure slider (0.5–3 R), starting at the published 1.0 R or at what your reference shots imply. Enter shots under Source & film → Carestream CR calibration. Each pipe card has a PMT slider (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70), and Custom Shot has a PMT field. The chart choice now uses the printed values (2"–6" without the ×1.3; 24" XH 6,390 and 14" Sch 40 2,060 corrected). CR Formula (70%) was removed in 1.97; Custom Shot setups saved with it stay listed and load their steel and SFD only. Details and what to measure: docs/CR-CALIBRATED.md.

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



Small films are tied to their large-film partner at the same geometry and every density using published Ir-192 relative exposures — D4 = D5 × 2.0 (Agfa D4 3.0 / D5 1.5), MX125 = T200 × 1.65 (Carestream 2.8 / 1.7), Fuji IX50 = IX80 × 1.83 (Fuji speed 55 / 30) — so a small film and its partner aim at the same density at every target and can share a hanger. Resulting 3-inch STD times at 26 Ci:



| Film | 2.0 | 2.5 | 3.0 | 3.5 | 4.0 |

|---|---:|---:|---:|---:|---:|

| D4 | 12.7 | 17.3 | 22.0 | 26.6 | 31.2 |

| MX125 | 13.3 | 17.1 | 20.9 | 24.3 | 27.6 |

| Fuji IX50 | 13.8 | 19.1 | 24.4 | 29.7 | 35.0 |



Times are seconds. Density 3.5 is the arithmetic midpoint of 3.0 and 4.0 in the source targets. Reference targets and published ratios are not measured film densities for this processing; verify them with test shots and correct with film-wide factors. `scripts/original-techniques.json` keeps the pre-1.21 per-film Ci·s baseline for comparison only.



Final seconds = model Ci·s × film-wide correction × size/schedule correction ÷ current source Ci. Both editable correction types are density-specific and default/reset to 1.00. Internal = unrounded final seconds / 9, nearest second. Internal offset = unrounded final seconds / 3.2, rounded to the nearest second. Internal columns apply only to 6-inch and larger pipes. Standard times retain nearest-second rounding including 0s.



114 geometry rows, 342 film/geometry combinations, five densities (1,710 exposure combinations). Small films cover 1–3 inches; large films 4–24 inches. Schedules: 10, STD, 40, 60, XH, 80, 100, 120, 140, 160 and XXH where they exist; walls follow ASME B36.10M (17 original rows with truncated walls, e.g. 0.437, were corrected to 0.438 etc.). 14" and 16" XXH (1.000") are the owner's entries; B36.10M defines no XXS above 12". 1"–4" Sch 10 and 1"–2" STD have under 10 mm of total steel, slightly below the Agfa chart's 10 mm start (less than half a half-value layer from the 3" STD reference). Rows over 90 mm of total steel (18" Sch160, 20" Sch160, 24" Sch120–160) are beyond the Agfa chart the steel curve comes from and are hidden from results, print and the correction forms (`MAX_STEEL_MM` in `calculator.js`); 109 rows are shown. Double-wall carbon steel. 1-inch pipe uses 12-inch SFD; other sizes use OD +0.125 inches. Processing reference: manual 4 minutes at 72°F, Carestream INDUSTREX Single Part developer, lead screens. The app does not model weld reinforcement, source transit, oblique paths or geometric unsharpness. Film-wide adjustments require verification across the sizes used.



### Carestream CR



Carestream CR (both belts) does not use the steel model. It uses the owner's Carestream CR chart (`EXPOSURE_CHART.xlsx`, sheet CARESTREAM CR, Ci·s column) exactly as given for 56 size/schedule rows, held in `CHART_EXPOSURES.cr` in `calculator.js`. Rows not in the chart show —. CR has no film density, so the time is the same at every target density, and CR film-wide and size/schedule factors are stored without a density (`factor.cr`, `weld.cr.<size>.<schedule>`). Internal = unrounded time ÷ 8, nearest second; Internal offset = unrounded time ÷ 3, rounded up (the chart's rules; still shown only for 6" and larger). The chart's 24" XS (85,610 Ci·s) and 6" XXH (below 6" Sch 160 although thicker) are used as written at the owner's request.



## Application behavior



Compact-only dark UI with Time, Internal and Internal offset columns. Multi-select pipe/schedule filters. Manual activity or daily Ir-192 decay from a reference using a 73.83-day half-life. Film-wide helper and manual size/schedule correction controls. The helper accepts the densitometer reading of the successful shot (2.00–4.00; blank means it hit the target) and converts it to the chosen target density through the film's curve (log-linear between the five target densities). Helper and size/schedule forms start on STD. Filters left on "All" are saved as all, so new sizes and schedules appear. Prints a narrow vertical list with only activity, density and local date above it.



Settings use one local JSON record with explicit storage-failure reporting. Draft inputs and panels are restored after reload. The record carries `schemaVersion: 2`. Version 1 records (1.20.0, previous exposure model) are migrated once: film-wide factors, size/schedule factors and the saved draft reset; films, source, filters, density and print size are kept. Records without a version (pre-release builds) are ignored. Film-wide factors are stored as `factor.<density>.<film>` and size/schedule factors as `weld.<density>.<film>.<size>.<schedule>`. Stored factors outside 0.10–10.00 load as 1.00. A future storage change should increase the schema version and add an explicit, tested migration.



No network permission, tracking or JS-to-native interface. Printing uses a separate JS-disabled WebView snapshot and the Android print service. Preparation timeout, error callbacks and main-thread cleanup provide recovery. Real-device printing, installation, rotation and background/foreground checks remain necessary.



## Build



Set `SDK_ROOT` to an Android SDK with platform android-36 and build-tools 36.0.0. Run `SDK_ROOT=/path/to/sdk bash build.sh` with Java 17 available. The signed output is `dist/RT-Handbook-v<manifest-version>.apk`; the script stops if that artifact already exists. Preserve or rename it before rebuilding.



Restore the separate private signing backup into `signing/` before building. The build refuses to generate a replacement key. Signing credentials are excluded from the source archive. Never share the signing backup. Keep the package and key unchanged for installation as an update, and increase versionCode for each release.



## Active verification



- `node tests/test-current-calculator.cjs`: SFD rule and ASME B36.10M walls for added rows; all 1,710 combinations follow the shared steel model; 30 reference targets; published small/large film ratios; Agfa D4/D5 shape within 4% of the historical Agfa-curve baseline; activity scaling, parsing, date validation and rounding.

- `CHROME_BINARY=/path/to/chromium node tests/test-current-ui.mjs`: six films across the five densities, corrections, calibration helper with size/schedule factors, save failures, persistence, reset behavior, narrow layouts and print agreement.

- `CHROME_BINARY=/path/to/chromium node tests/test-settings-storage.mjs`: version 1 migration, unversioned records ignored, per-density factor and size/schedule keys, schema version, range checks, resets across five densities and persistence after reload.



Requires the available Playwright package. `tests/legacy/` contains historical harnesses, not active release gates. Physical Android print-service checks are not simulated by browser tests.



## 1.21.1 (versionCode 43, not yet signed or device-tested)



- Carestream CR film on small and medium/large belts from the owner's CR Ci·s chart (see Carestream CR above).



## 1.21.0 (versionCode 42, never released)



- Exposure model redesign (shot times change):

  - Step 1: all films share one Ir-192 steel curve (inverse square for SFD, exposure doubles every 12.1 mm of total steel) anchored at each film's reference shot. Agfa D4/D5 change by about 2% or less; Carestream and Fuji become longer on heavy wall (up to about 30% for T200 and 2× for IX80 on 12"–16" Sch160).

  - Step 2: small films are tied to their large-film partner by published Ir-192 relative exposures at the same geometry and every density, so partners share a hanger at any target density. At 3-inch STD, 26 Ci, density 3.0: D4 16 → 22 s, MX125 24 → 21 s, Fuji IX50 25 → 24 s.

  - `techniques.json` is geometry only; the old per-film Ci·s baseline stays in `scripts/original-techniques.json` for comparison.

- Added NPS 18, 20 and 24 (Sch 10, STD, XH, 40, 60, 80, 100, 120, 140, 160) and Sch 10 on every existing size (ASME B36.10M walls; SFD OD + 0.125 in; large films on 18"–24"). 114 rows, 1,710 combinations. The schedule filter gains "10". Rows over 90 mm total steel are hidden.

- Fixes from the second independent review: saved filters no longer hide rows added later ("All" is saved as all; a pre-1.21 full list counts as all); the helper and size/schedule forms default to STD instead of Sch 10; 17 truncated original walls corrected to ASME B36.10M (≤0.3% exposure); unused `steelMm` and dead print code removed.

- Calibration helper takes a measured density (feature from the accuracy list): factor = successful time ÷ (model time at the measured density × size/schedule factor), so a shot that read 2.7 still calibrates the 3.0 target correctly. The review shows the resulting time for the target density.

- Settings schema 2: film-wide and size/schedule factors and the saved draft reset to 1.00 on upgrade from 1.20.0 (they were set against the old model); a one-time message says so.

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



## Unreleased navigation update



The top hamburger menu switches between Note Taker and Shot Time Calc. Calculator inputs remain intact when switching. Note Taker is currently a placeholder; voice recording and note entry are not implemented.



## Note Taker — local implementation (unreleased)



Open the hamburger menu and select Note Taker. Create an inspection with a date, LSD and starting XF number. Enter individual welds or a typed batch such as:



`CN-47 has 6 4 inch STD welds welded by DD, CN-32 has 2 2 inch XS welds welded by O`



Each weld becomes one row. Current CN/welder context carries forward. Edit individual rows, change a welder by CN/XF/range using explicit instructions, undo the last change, or delete with a choice to preserve or renumber XFs. Settings support identifier prefixes, separators and padding. Lists, unfinished instructions and review items are stored separately from calculator settings in `shottime.notes` schema 1.



Copy rows exports CN#s, XF#s, WID, Weld Size, Weld Schedule as tab-separated text without headers. If clipboard access is unavailable, an export dialog provides selectable text. Formula-like values and numeric identifiers with leading zeroes receive a protective apostrophe on export; confirm the intended cell display when pasting into your actual Excel template. Back up notes provides a copyable JSON recovery record, not cloud synchronization or automatic backup.



Voice recording is deliberately disabled in this stage. Continuous transcription, Bluetooth, locked-screen recording and computer sync are not implemented. Browser tests do not establish Android device behavior. Android compilation was verified on this PC after installing JDK 21 and API 36 build tools; no new APK has been signed or installed.



## Windows unsigned build



JDK 21 and Android SDK platform android-36 / build-tools 36.0.0 are installed. In PowerShell, from this directory:



```powershell

./build-review.ps1

```



The script uses ANDROID_HOME (or the standard per-user SDK directory) and JAVA_HOME (with the machine-level JDK setting as fallback). It creates `dist/ShotTime-review-unsigned.apk` and checks alignment and package metadata. This unsigned APK cannot be installed until signed appropriately. It does not read signing credentials. New terminals pick up the SDK tools added to the user PATH.

# 1.22.0-test.2 — offline Whisper voice test



Note Taker now has a large Start/Stop recording button and Phone/Bluetooth input selection. The bundled Whisper English model runs locally without an API account or transcription usage charges. Completed pipe entries become weld rows; the current pipe waits for the next CN or Stop so a trailing welder can attach. Ambiguous instructions are reviewed in order. Saved transcripts replay without duplicate rows, and undo preserves transcript history.



This is an ARM64 test APK for the owner's Galaxy S26 Ultra. Accuracy, real-time performance, Bluetooth and locked-screen capture still need phone testing. Raw audio is not saved; force-stop can lose audio not yet transcribed. See [Whisper test instructions](docs/WHISPER-TEST.md) for operation, limits, builds and model provenance. Windows builds require `build-voice.ps1` before `build-review.ps1`.



### 1.22.0-test.3



Accept natural batch assignments such as all welded by TS and all of them welded by TS. Both welded by is accepted for two welds; other quantities receive a specific welder-assignment clarification without adding rows.



### 1.22.0-test.4 CSV sharing



Share CSV replaces Copy rows and Export text. Creates a UTF-8 CSV with headers, date/LSD filename, and Android share sheet. CSV quoting preserves inch marks and commas; formula-like fields retain export protection.



### 1.22.0-test.5



Counting aloud with comma-separated consecutive numbers starting at 1 now supplies the batch quantity. In counted batches, a bare lowercase numeric plural such as 80s means 80; explicit schedule 80S and uppercase 80S remain distinct. Skipped/repeated counts require review.



### Cloud fallback — 1.22.0-test.6



App display name is now RT Helper (header, navigation, Android launcher, recording notification and print job). The navigation menu button sits at the top right of the shared header.



Added Voice processing settings: Phone only, Auto, Cloud only; encrypted API key and local monthly estimated-spend guard. Auto switches to Whisper on cloud failure. Cloud sessions offer interpretations after Stop for review. Explicitly approved examples are stored locally and suggested on exact transcript/context matches. See docs/CLOUD-VOICE-TEST.md.



### 1.22.0-test.7 review fixes



- Notes storage: undo keeps at most 30 steps and about 300,000 characters per list, without processed voice IDs (a 600-weld list dropped from about 3.4 million to under 0.7 million characters). Lists can be deleted (List settings row → Delete list). The save status warns from 70% of the WebView's ~5 million character storage, which the calculator shares. Older saved lists are trimmed when loaded.

- Typing in Batch instruction saves after a half-second pause instead of on every keystroke; pending text is saved when the app is paused, hidden or closed.

- Parser: lowercase 40s means schedule 40 everywhere (with or without counting aloud, with or without "schedule"); a capital S (40S) stays an explicit stainless schedule. A quantity followed by a bare fraction ("1 1/2 inch") goes to review instead of becoming one 1/2" weld.

- CSV: values with leading zeroes are written as ="007" so Excel shows 007 without a visible apostrophe; formula-like values keep the apostrophe guard. Pasted Excel rows are unchanged. Shared CSV files are removed from the cache after a day.

- Voice: the service calls startForeground before any check, so a refused start no longer crashes the app, and a refused start no longer overwrites the previous session's journal (the reason is shown instead). A damaged voice journal is set aside instead of disabling recording. Auto mode without a saved key creates live rows like Phone mode. A failed cloud interpretation leaves the session healthy and the review says the interpretation failed (not "interrupted"); interpretation now allows 90 seconds and 8,192 output tokens, transcription 30 seconds. Whisper text is returned as bytes and decoded in Java (invalid UTF-8 is replaced instead of risking a JNI abort).

- Calculator footer reads RT HELPER. Version 1.22.0-test.7, versionCode 50.

- Not verified on a phone; the native Whisper library must be rebuilt with build-voice for the JNI signature change.



### 1.22.0-test.8 voice recognition



- Whisper small.en (5-bit, about 190 MB) replaces base.en (148 MB); the old copy on the phone is deleted on first use.

- Silero VAD v6.2.0 finds speech and pauses instead of loudness; long speech is cut at the quietest point in the last 4 s instead of mid-word. Loudness remains the fallback.

- The shorter, faster encoder window is used only when two or more sections are waiting; Whisper retries when a result looks like a repetition loop.

- Welder IDs as single letters: Whisper is told IDs are letters and given the list's existing welder IDs. The parser accepts letter names ("dee dee"), the NATO alphabet ("delta delta"), "welded TS" without "by", and Whisper habits (CM for CN, "CN47", "welders, TS", "Weldero", punctuation commas). Hyphenated "extra-strong" means XS.

- Measured on synthetic speech on a PC (see docs/WHISPER-TEST.md): 5 of 8 instructions exactly right versus 2 of 8 before, no silently wrong rows. Not yet measured on a phone or with real speech.

- Version 1.22.0-test.8, versionCode 51. Rebuild the voice payload (`build-voice`) before `build-review`.





## 1.22.0-test.9 — ARM voice performance trial



Whisper and Silero now share a native-library loader. The voice build produces a portable ARM64 library and a second library compiled with `-march=armv8.2-a+fp16+dotprod`. The loader selects the optimized version only when every reported CPU Features line contains asimd, fphp, asimdhp and asimddp; missing/unreadable capability information or an unavailable optimized library retains the portable path. Model weights, full encoder-window default, thread count, prompts, pause boundaries and parser behavior are unchanged.



This trial targets the owner's Samsung S26 Ultra. CPU math optimizations may affect floating-point rounding, so recognition should still be checked. No handset performance measurement is available yet, and a speedup is not claimed. Compare the same phrase and the wait after Stop with test.8. The two existing test.8 review findings remain separate from this performance trial.



Manifest versionCode 52, versionName 1.22.0-test.9. Use the replacement key recorded in ../../RT-HELPER-SIGNING-LOCATION.md; never generate another key or delete the signing folder. It installs over the replacement-key test.8 build.



Native selector test: compile `src/ca/kylekeith/shottime/NativeVoice.java` with `tests/NativeVoiceTest.java`, then run `ca.kylekeith.shottime.NativeVoiceTest`. It covers modern, older, mixed and missing capabilities plus exact feature-token matching. Both build-review scripts require both libraries.



## 1.22.0-test.10 — MT notes and CSV table

MT fittings have their own per-list starting number and sequential IDs (including leading zeroes), attached to the current CN. Say "a 1 inch TOL", "one 2 inch weld olet", "two 2 inch 3M socket welds", or append fittings after a pipe's weld instruction. TOL/threadolet/thread olet/thready/threadys/threadies, WOL/weld olet/weldolet, and SW/socket weld are supported, including spoken spaced letters. One fitting gets one MT number. Missing schedules stay blank; permitted schedules are the normal pipe schedules plus 3M, 6M and 9M. Ambiguous plural quantities or incomplete instructions require review.

New lists choose a Starting MT number; existing lists can set it in List settings before the first MT is assigned. MT notes appear grouped by CN, with manual add/edit/delete and undo. Deleting preserves later MT numbers. XF numbering is independent.

Share CSV puts the XF table in columns A–E, a blank separator in F, and the MT table in G–K: CN#, MT#, Size, Schedule, Description. Table lengths are independent; blank cells pad the shorter table. Lists with only MT fittings can also export. Lists without MT items retain their existing five-column export. JSON recovery includes MT notes.

Notes storage is schema 2 with explicit in-memory migration from schema 1, including undo snapshots. Existing XF records, drafts and processed voice IDs remain intact. Calculator storage is unchanged. Old app versions cannot read the new notes schema; keep using this or later updates after migration.

Native Whisper vocabulary and optional cloud instructions include MT terms. Phone recognition, cloud interpretation and noisy-site accuracy still require device testing. Test.9 CPU optimization and both library variants remain in this build. VersionCode 53 / 1.22.0-test.10; signed with the existing replacement key.


## 1.22.0-test.11 — recognition hint rollback and mixed-pipe parsing

Owner reported spoken CN-69 consistently transcribed as CN-XS C9 and confirmed that the wrong CN appears in raw Recognized speech. Restored exactly the shorter Whisper HINT from test.8/test.9 as a controlled phone trial. The expanded MT vocabulary is a hypothesis, not a proven cause; no original audio is available for a paired recognition test. MT parser aliases and cloud prompts remain supported. CPU optimization, model, segmentation and decode parameters stay unchanged. No automatic substitution from the malformed CN to 69 is introduced.

Parser now accepts a final welder assignment after the MT suffix and unpunctuated adjacent weld groups separated by the word weld/welds. Conflicting welder assignments still require review. A malformed explicit CN gets a clear correction message. Regression coverage includes the screenshot wording, correction to CN-69, and replay without duplicates. Test.11 needs the owner's same-phrase phone comparison to determine whether recognition improves.

VersionCode 54 / 1.22.0-test.11. Notes remain schema 2; signing identity unchanged. Existing test.10 data is retained on upgrade.

Test.11 screenshot regression: accepts sched/SCED before a schedule value and a speech comma between quantity and inch-labelled size. The CN-13 example produces three 3-inch XS welds, one 2-inch schedule 160 weld, all DD, plus one 1-inch 3M TOL. Footer now displays test.11.

## 1.22.0-test.12 — recording restart

Initialize Silero LSTM state once after every successful detector load, before streaming with whisper_vad_detect_speech_no_reset. The pinned whisper.cpp allocator does not initialize these state tensors; reopening can reuse nonzero memory. Preserve state between reads. Rebuild both native variants. Phone reproduction/confirmation still required; no claim of device-verified resolution.

## 1.22.0-test.13 — MT WID and combined CSV field

MT rows now store an editable WID, inherited from the current/spoken welder when added. CSV right-hand table is CN#, MT#, WID, Size, Schedule/Description (e.g. 3M TOL; just TOL when schedule is blank). Schedule and fitting type remain separate for editing. Notes schema 3 migrates schema 1/2 lists and undo snapshots; preexisting MT WIDs stay blank rather than guessing. XF table and numbering unchanged.

## 1.22.0-test.14 — singular weld quantities

Accept a/an as quantity one in XF weld groups, including a 4 inch STD weld and an 8 inch XS weld. Welder IDs remain unchanged. Numeric fractional-size ambiguity still requires review; a 1/2 inch explicitly denotes one half-inch weld. Includes no experimental Stop/queue/timing changes.

## 1.22.0-test.15 — review fixes

- Stop: the final audio section is transcribed after the queue drains, so a full queue at Stop can no longer reject it; waiting for queued sections ignores thread interrupts, so Whisper is never closed while still decoding.
- Voice: counting aloud in number words ("one, two, three, four 2 inch STD welds") works by voice as well as typed; commas before number words are kept for the parser.
- Build: `build.sh` uses Unix line endings again; a test fails if any shell script has Windows line endings.
- Privacy text now says the app has Internet permission only for optional Auto/Cloud voice processing (OpenAI, own API key); Phone only sends nothing.
- Signing: the RT Helper key (`af4e70b2…`) is the app's identity from now on (the original ShotTime key was lost).
- Version 1.22.0-test.15, versionCode 58. Not tested on a phone.

## 1.22.0-test.16 — Note Taker layout

Recording-first status panel, per-list addition confirmations, expandable CN cards grouping XF and MT with WIDs, inline corrections retained on parse failure, optional remembered wording beside Apply correction, and manual instructions behind a disclosure. Top navigation is All lists/Settings. Settings contains microphone, voice processing, list numbering, context, remembered wording, backup and separate delete action. Save recovery controls appear on failure. Native voice, data schema, parser, numbering, CSV and calculator behavior unchanged. Browser tests cover updated navigation, inline correction, grouping and mobile width. Search/filter and export-preview suggestions are not implemented in this release.

## 1.22.0-test.17 — job-specific required fields

New list and List settings contain Required information for this job, separate XF/MT checkboxes for CN, WID, size and schedule, plus MT description. Numbers and quantity cannot be disabled. Optional omissions are blank in customized jobs; spoken fields still captured. Generic examples: add three welds; add two MT fittings. Required CN/WID may use existing context. Existing lists migrate to schema4 with fieldRequirements:null to retain legacy defaults/inheritance; opening and saving job requirements enables explicit configuration. New UI lists store explicit defaults. Migration includes undo snapshots. Old rows remain valid when requirements change; requirements apply to new entries and fields explicitly edited. CSV columns unchanged; missing size exports empty without inch punctuation. Native speech code unchanged.

## 1.22.0-test.18 — microphone waveform

Live microphone amplitude history appears behind the Stop recording label. RMS levels from the existing 16 kHz recorder are held only in memory; a separate foreground 100 ms Activity poll updates the bars without journal writes or transcript reconciliation. Native stale levels expire after 400 ms, UI stale feed after 450 ms; stop and restart clear history. Reduced-motion disables bar transitions. Speech models, decoding, numbering and notes schema unchanged.

## 1.22.0-test.19 — hold to speak

Quick Hold to speak / Continuous control above the microphone button, with a device-local preference (shottime.recordingMode). Continuous remains the default and uses Start/Stop. Hold mode starts on primary pointer or Space/Enter press and stops on release, pointer cancellation, page hide or focus loss. Pointer capture belongs to the stable document element so transcript rerenders cannot lose the release. Native hold sessions cancel pending permission starts and queued service starts on Stop or Activity pause. A recovered active session still offers Stop. Switch locked during recording/processing. Waveform works in both modes. Wait for Listening before speaking; first-time permission prompts may require holding again after granting permission. Notes schema and speech models unchanged.

## 1.22.0-test.20 — spool terminology

Note Taker headings, counts, empty states, context dialog, input placeholder, review error and recording guidance now call CN groups spools. Display wording only; internal identifiers and saved data unchanged.

## 1.22.0-test.21 — XH report schedules

XF and MT schedules canonicalize XS, extra heavy, extra-heavy and extra strong to XH for new/manual/corrected entries. Existing lists and undo snapshots normalize their schedule values after successful validation on load; exports also canonicalize schedules. Schema stays 4 (same structure). Welder/CN identifiers are not remapped. Parser handles explicit quantity followed by welds both/all and shared size/schedule, and rejects both with a quantity other than 2. Exact reported CN-42 sentence is tested through parser and voice reconciliation. Cloud interpretation instructions use XH; speech recognition model/hints unchanged.

## 1.22.0-test.22 — trailing WID shorthand

Accept a one/two-letter uppercase WID (including spaced initials) directly after weld/welds, without welded by, when no explicit welder marker is present. Common word tokens remain review-only unless explicitly marked as a WID. The complete preceding weld expression must still validate. Exact screenshot CN-1, 2, 2 inch XS welds DD produces two 2-inch XH XF rows with DD, including with optional WID settings. Identifiers/numbering/storage unchanged.

## 1.22.0-test.23 — schedule 80 and trailing CN

Owner confirmed transcript "2 2 inch AD welds on CN-3 DD" means two 2-inch schedule-80 welds on CN-3, WID DD. Normalize AD only in the schedule slot between inch/quote (optional schedule prefix) and weld(s). Preserve WID AD. Reorder a single trailing "on CN-number" reference to the front before existing validation; conflicting/malformed identifiers still require review. No model, native, or data-schema changes. Exact screenshot is covered through stopped voice reconciliation.

## 1.22.0-test.24 — natural instruction variations

Expanded bounded voice/typed grammar: CN number/C N, two off/a pair, CN at front/middle/end, quantity before weld details with at/comma, by/all/both welder forms, omitted weld noun with explicit size/schedule, contextual heavy=XH and eight zero/one sixty/one hundred sixty schedules, natural fractional sizes, and three/six/nine thousand MT classes. Same spool explicitly keeps the current CN even for optional-CN jobs. Add one more like the last weld copies CN/size/schedule/WID with new XF; same-spool repeat rejects a last weld on another CN. Change last weld’s schedule and remove last MT fitting use existing update/delete commands and undo; no renumbering on MT delete. Parser gets current MT rows from typed, voice and approved-wording paths. Voice assembly separates repeat/remove/same-spool commands and replay stays idempotent. Missing context, ambiguous fractions and contradictory CNs still require review. Native speech models, recording engine and storage schema unchanged.

## 1.22.0-test.25 — voice modifiers and confirmations

Seven approved modifiers: change last weld size; change last N weld schedules; set all welders on an explicit CN (both XF and MT); move last weld to another numeric CN; replace last MT size/schedule/description; add N more like the last weld; Undo that. Last-N/repeat counts validate before mutation. Missing targets and malformed changes require review. MT descriptor changes preserve WID, CN and numbering; an omitted replacement schedule keeps the old schedule. Bulk welder updates form one undo group. Current context is not reassigned by a move/edit. Added/updated/removed feedback names affected XF/MT IDs and changed values, plus inline Undo; it is hidden on persistence failure and disabled while recording. Voice assembly separates move/repeat/undo-that commands and prevents replay. Notes schema/native speech unchanged.


## 1.22.0-test.26 — trailing CN speech punctuation

Accept a comma between CN and a numeric spool ID, plus a trailing CN without on or a preceding comma. The reported "2 2 inch XS welds CN, 1 DD" produces two 2-inch XH welds on CN-1 with WID DD. Regression checks cover typed parsing, stopped voice, replay, malformed IDs and conflicting CN references. Native speech, storage and numbering unchanged.


## 1.22.0-test.27 — owner-approved MX125/T200 baseline

On 2026-10-02 the owner explicitly requested multiplying the current MX125 and T200 baselines by 1.2 and making that the default. T200 reference exposure times increase by 20% at all five densities; MX125 inherits that increase exactly once through the existing partner ratio. Calibration factors stay separately editable, default to 1.00 and retain saved values. Resetting factors returns to the increased baseline. No other film, CR chart, geometry, decay or notes behavior changes. This supersedes the earlier T200 reference targets in this document.


## 1.22.0-test.28 — CN letter suffixes

Support numeric CN identities with attached letter suffixes such as CN-332A and CN-332B. Keep them separate for XF/MT, voice assembly, modifiers and CSV. Explicit spaced suffixes before has/end/WID and NATO suffixes (332 alpha/bravo) normalize to uppercase. Preserve quantity-a syntax. CN padding applies to the numeric portion; reformatting preserves suffixes. Existing numeric cnNumber metadata stays numeric; suffixed IDs use the existing full cn string and null cnNumber, so schema 4 remains compatible. Tests cover parsing, voice, replay, edits/undo, formats, storage and CSV. Malformed/conflicting CNs still require review.


## 1.22.0-test.29 — CSV column order and plain sizes

Settings > Export columns offers separate XF/MT Up/Down controls, header previews, Save, Cancel and Reset. Order is remembered for all lists on this phone in shottime.csvColumns.v1; malformed preferences fall back to defaults. All columns remain included, XF and MT stay side by side with a blank separator, and row order/numbering do not change. CSV sizes have no inch mark (2, 1 1/2, or blank); TSV behavior unchanged. Save errors keep the dialog open without applying unsaved choices. Notes schema/native code unchanged.


## 1.22.0-test.30 — structured clarification

Pending additions now open field-based review: separate XF/MT groups with CN, quantity, size, schedule, WID and MT type. Recognized values are prefilled; required missing/invalid fields get amber highlighting and text explanations. Optional omissions stay optional. Unaccounted words require per-group transcript confirmation; malformed explicit CN does not inherit prior CN. Group add/remove/type selection and persisted field drafts support mixed instructions. Confirm and add validates all groups then applies one atomic undo group using the original segment ID; replay remains suppressed. Show transcript preserves original speech. Edit wording instead retains the original text/approved-example flow, and is the fallback for modification commands. New optional pending-item fields do not change schema 4; existing saved lists remain compatible. No speech-model confidence is claimed.


## 1.22.0-test.31 � CSV spacers

Export columns now supports Add blank column independently for XF and MT tables. Repeated spacer entries can be moved and removed; headers and cells export empty. Existing data columns remain required and unique. Preferences keep the v1 key and accept up to 20 spacers per table; previous column orders remain compatible. Reset removes spacers; Cancel leaves saved settings unchanged. Tests cover empty cells, leading/trailing/repeated spacers, alignment, persistence, removal and reset/cancel.


## 1.22.0-test.32 — Current source Edit button

Removed the standalone Source & film launcher card. Edit is now at the bottom-right of Current source and opens the existing settings sheet. Settings, calculation and saved values are unchanged. Calculator UI and settings-storage suites pass, plus a mobile smoke check of opening, calculating and closing. APK built and signed with existing key; alignment verified.


## 1.22.0-test.33 — Compact current source card

Film summary and Edit share the bottom grid row, removing the mostly empty extra button row. Zeroed paragraph margins and a shrinkable text column keep longer summaries wrapping cleanly. Verified no overlap/overflow at 320, 393 and 600px; calculator UI and consistency checks passed.


## 1.22.0-test.34 — Review fixes

Addresses all eight findings in docs/REVIEW-test33.md. Structured review uses strict per-spool parsing before partial extraction, reserves schedule/fitting tokens from bare-WID extraction, shares counting-aloud normalization, and carries the latest explicit context. Deferred confirmation regressions cover optional/required/legacy fields, numbering, undo and replay. Existing saved field drafts and rows remain unchanged to preserve user edits; prior incorrect records require manual correction.

Calibration proposals invalidate on dependent row-factor save/reset. Only schema1 migration expands historical full filter arrays; explicit schema2 exclusions persist. Baseline explanatory copy matches the approved T200/MX125 values. Restored CR helper drafts refresh density visibility. VoiceJournal persists a new-session candidate before publishing it, preserving previous state on failed start; fault-injection tests cover first/partial failures and retry.


## 1.22.0-test.35 — Opening digit roll

Visible red source activity and shot/internal/offset digits roll once for 400ms on document opening. Pipe/schedule numbers and units remain stationary. Final text stays unchanged; generated decoration uses empty accessible alternative text and is removed after 450ms. Reduced motion, hidden calculator/document and open restored settings skip entrance. No replay on calculations/scroll/print.


## 1.22.0-test.36 — Radiography header

Opening calculator header now reads IR-192 · RADIOGRAPHY to include film and CR. Copy-only change; calculation and recording behavior unchanged.


## 1.22.0-test.37 — Bottom-centre floating recorder

The single recording button is now a centred floating pill with mic icon and live waveform. Mode selection, status and transcript remain at the top. Existing hold/release, continuous Stop, processing and clarification locks are preserved. Safe-area-aware bottom spacing lets the last list item scroll above it; hidden on the calculator and without a selected list.


## 1.22.0-test.38 — Recording mode in settings

Moved mode controls to Note Taker settings > Recording. Hold to speak is default when no explicit continuous preference exists. Explicit mode choices persist on this phone. Main recorder retains floating control, status and transcript. Settings cannot change mode during recording.


## 1.22.0-test.39 — Clarification sheet

The first pending instruction opens in a scrollable slide-up panel above the centred recorder. It follows the visible viewport when the keyboard opens and keeps the focused field visible. Existing highlighted fields, draft persistence, wording fallback, confirmation and dismiss remain intact. Reduced motion skips the entrance animation. Android already applies IME insets; no native change was needed.


## 1.22.0-test.40 — Per-list CSV spool spacing

CSV spacing: Off/On beside the LSD controls blank rows between spool groups. Off preserves the original export exactly. On inserts a blank row at each CN transition independently within the separate XF and MT tables. Neither table is aligned to the other by CN or regrouped; existing row order and all identifiers are preserved. The optional boolean csvSpoolSpacing defaults to false for legacy lists, survives saves/backups and stays unchanged on Undo. Schema 4 remains compatible; invalid non-boolean preferences are rejected. Custom columns and column spacers work in both modes.


## 1.22.0-test.41 - Hide recorder during clarification editing

Focusing a clarification text field hides the floating recorder and gives the sheet its space above the keyboard. The recorder stays hidden for that pending instruction through keyboard dismissal and rerenders, then returns after confirm or dismiss. Other lists/reviews start with the recorder visible. Active recording Stop is never hidden by this interaction.


## 1.22.0-test.42 - QC Notes navigation

Renamed the notes screen, header label and navigation entry to QC Notes. Hamburger order is Shot Time Calc, then QC Notes. Existing internal IDs and stored data are unchanged.


## 1.22.0-test.43 - Custom Shot screen

Hamburger order: Shot Time Calc, Custom Shot, QC Notes. Custom Shot takes total steel inches, SFD inches, film, density and current source or separate activity. customExposure wraps the unchanged film model with total steel / 2 as wall; no pipe size/schedule factors or internal geometry conversions apply. Existing film-wide factors apply at selected density. Rejects nonpositive/nonfinite geometry and steel over the existing 90 mm limit; CR is excluded because arbitrary CR geometry has no reference. Twenty geometry-only named presets use separate versioned shottime.customShots.v1 storage. Loading presets uses current source; editing, returning to screen, foregrounding or source decay invalidates displayed result. Tests do not establish physical exposure accuracy.

## 1.22.0-test.44 - Metric custom shots and pipe reference

Custom Shot accepts inches or mm, converts entered geometry when switched, and keeps presets in canonical inches. Equivalent geometry uses identical exposure math. Menu order: Shot Time Calc, Custom Shot, Pipe Schedule Chart, QC Notes.

The offline carbon-steel chart provides 33 published NPS sizes from 1/8 through 48 inches, showing OD, wall thickness and calculated ID in both units. Metric values are converted from inches. XH displays XS; STD/XH stay separate from numeric schedules. Stainless S schedules and unpublished combinations are not inferred. Sources: https://www.weldbend.com/catalog.pdf pp138-143; Alaskan Copper catalogue p43 (Ferguson asset 4758807). The user screenshot guided layout/coverage. Chart data is independent of calculator pipe data and its owner-specific XXH entries.

## 1.22.0-test.45 - Agfa D7 custom shots

Custom Shot adds Agfa D7, including saved setups. Baseline is existing D5 exposure divided by 1.5, based on GE/Agfa STRUCTURIX published Ir-192 factors D7=1.0, D5=1.5: https://www.rcon-ndt.com/wp-content/uploads/Structurix-Film.pdf . Result displays the derivation and test-shot verification note. Existing standard calculator film choices and all other baselines unchanged.

## 1.22.0-test.46 - Custom Shot field spacing

Added consistent space above labels and below them, with a tighter visible focus outline. Prevents selected controls from overlapping adjacent labels in Custom Shot and saved setups. No calculation changes.


## 1.22.0-test.47 - Code Calculator reference

Code Calculator is fourth in the menu, before QC Notes. Dedicated pure calculator/UI modules provide metric-based reference limits with inch input conversion, clause/edition labels, missing-input handling and optional IQI reference. B31.1 stays on the supplied 2012 workbook as requested; CSA sour stays explicitly 2011 pending verification of current supplemental clauses. Selected B31.3-2024, CSA sweet-2023 and BPVC-2025 clauses are implemented; this is not complete current-code validation. Rounded-distribution charts, Section I reinforcement, legacy IQI and inconsistent workbook outputs remain clearly unavailable/manual. No automatic accept/reject decisions. See docs/CODE-CALCULATOR-REVIEW.md for precise source coverage and remaining gaps. Settings and QC Notes storage are unchanged.


## 1.22.0-test.48 - CSA sour reference update

CSA sour now uses selected Z662:23 clauses from the March 2024 revision. Root IP/IF are prohibited; top-of-joint IF retains its separate Clause 7.11 allowance. Other indications use the checked Chapter 7 rules, including short-weld cumulative limits. Applicability and supplemental examination/repair requirements are displayed. CSA wire IQI now works for sour as well as sweet; corrected Table 7.10 and gamma Table 7.11 were visually checked. Unequal-thickness IQI remains outside scope. No automatic acceptance or service classification. B31.1 still uses labeled 2012 workbook data: 2024 text was located, but 2026 acceptance clauses remain unavailable. See docs/CSA-SOUR-SOURCE-REVIEW.md.


## QC jobs and daily lists (1.77)

QC Notes opens to Jobs. Create a job with a name, LSD and starting XF/MT numbers, then add dated daily lists inside it. Each job owns separate continuous XF and MT sequences. Empty lists do not reserve numbers; entries added to an older day use the next unused job numbers. New daily lists begin with blank CN/welder context.

Deleting or undoing additions leaves numbering gaps, so numbers already used in reports are never reassigned. Job settings control names, LSD, formats and required-field defaults for new lists. Each daily list retains its own required-field settings and CSV export. Existing lists migrate individually into separate jobs without merging or renumbering.

After a save failure, use Retry saving or export recovery data before making further changes. The staged job counters and voice replay markers are saved together.


## Client labels and Android Back (unreleased after 1.77)

QC job forms use Client name and an editable Start date (today for new jobs). Job buttons show Client name - LSD - Start date. Existing schema 5 jobs retain their names and receive their earliest daily-list date, or today when empty; schema 1-4 lists retain their original date when migrated. Notes schema is now 6. Android Back closes dialogs first, then returns from a daily list to its job and from the job to all jobs. Navigation remains blocked during recording or an unsaved draft.

Back from the QC jobs list, Pipe Schedule Chart, Custom Shot and Code Calculator returns to Shot Time Calc. Open dialogs and the QC daily-list/job hierarchy still take precedence. Only Back at the calculator root falls through to Android.


## 1.78 - Client job labels and Back navigation

Packaged client name/LSD/start date job buttons and all Back navigation updates as version code 100, using the existing signing identity. Verification details: dist/BUILD-VERIFICATION-1.78.md. No handset installation performed.


## Unreleased after 1.78 - Duplicate CN confirmation

CN entries already present in the same job require Add anyway confirmation before saving. Checks cover XF and MT across daily lists, typed/manual/review additions and changed CNs. Numeric leading zeros are equivalent; letter suffixes remain distinct; blank and unknown (?) CNs are ignored. Rows added together for one new CN do not warn against one another. Cancel consumes no XF/MT numbers. Voice duplicates remain pending until confirmed and retain corrections, replay protection and save retry behavior. Recording is not interrupted by a modal; confirmation appears when recording stops. Existing entries are retained.

Verification: duplicate model/UI tests and all notes suites pass. Additional checks cover same-session voice duplicates, cross-day matching, manual MT, cancellation, reload, replay, corrected pending fields and failed-save retry. Screenshot: build/duplicate-cn-confirmation.png. Source-only; the uploaded 1.78 APK is unchanged.


## 1.79 - Duplicate CN confirmation

Packaged duplicate CN confirmation as version code 101 with the existing signing identity. Verification: dist/BUILD-VERIFICATION-1.79.md. No handset installation performed.


## Unreleased after 1.79 - Jobs page and lists by date

Jobs home now uses a compact heading/count with Settings at the top right, paired Create job / Lists by date actions and readable client/LSD/start-date cards. Lists by date opens a picker for an exact assigned daily-list date across all jobs (not a creation timestamp). Results include client, LSD, date, same-day list ordinal and XF/MT row counts. Selecting a result opens the existing list; Back closes the picker. No storage/schema or numbering changes.

Verification: exact-day cross-job filtering, same-day duplicates, empty results, Settings placement/opening, result navigation and mobile width tests pass. Existing job navigation/settings/failure suites pass. Previews: build/jobs-clean.png and build/lists-by-date.png. Source-only; no new APK built.


## 1.80 - Jobs page and lists by date

Packaged cleaner Jobs page and exact-day lookup as version code 102 with the existing signing identity. Verification: dist/BUILD-VERIFICATION-1.80.md. No handset installation performed.


## Unreleased after 1.80 - Daily-list page cleanup

The daily-list page now matches the Jobs page: client/LSD heading, top-right Job settings, a prominent Add daily list action, a daily-list count, and date cards with weld/MT counts. Same-date lists retain their ordinal and newest dates remain first. Removed All jobs; Android Back still returns to the jobs page. Delete job remains available below the list cards with its existing confirmation.

Verification: jobs/settings, Back, list navigation, CSV spacing and save-failure/deletion tests pass. Mobile preview: build/qc-daily-lists.png. Source-only; no APK built.


### Daily-list cleanup follow-up

Delete job now appears at the bottom of Job settings, below Save/Cancel, instead of on the daily-list page. The existing confirmation still lists affected daily lists and row counts. Job settings and deletion/save-failure tests pass. Source-only after 1.80.


## 1.81 - Daily-list cleanup

Packaged clean daily-list cards and Delete job inside Job settings as version code 103 with the existing signing identity. Verification: dist/BUILD-VERIFICATION-1.81.md. No handset installation performed.


## Unreleased after 1.81 - Inspection entry screen cleanup

Daily-list entry now uses the same client/LSD/date header and top-right Settings as the Jobs pages. Removed the standalone Type an instruction area, Undo last change button and Daily lists button; Android Back retains navigation. Add manually and Share CSV are paired actions. Per-list CSV spacing moved to Settings > CSV export and retains saved values and CSV behavior. Voice-review correction fields and inline operation Undo remain available. Existing stored drafts are preserved.

Browser test instruction helpers now exercise the retained voice-review correction flow; navigation checks use the native Back callback and undo checks use voice commands. Mobile preview: build/polished-notes-mobile.png. Source-only after 1.81.


## 1.82 - Inspection entry screen cleanup

Packaged the cleaner entry screen and CSV spacing under Settings as version code 104 with the existing signing identity. Verification: dist/BUILD-VERIFICATION-1.82.md. No handset installation performed.

### Unreleased after 1.82 — CN search and bulk actions

Search CN# across a job's daily lists, then tick CNs to delete or move all their XF and MT entries. The same checkboxes are available on daily-list spool cards. Choose a destination job/list and either keep existing XF/MT numbers or renumber continuously. Review affected ranges and any duplicate CN warning before confirming. Renumbering closes gaps across the source job and gives cross-job transfers the destination's next numbers. Bulk changes clear old undo history in affected jobs; the confirmation explains this. Save failures leave both lists unchanged.

Press and hold a CN card to enter multi-selection and reveal tick boxes. Cancel selection or Back hides them again. Normal taps expand cards as before.


### Unreleased audit repairs

All nine full-audit recommendations are applied: IQI boundary arithmetic, journal and transcript recovery, unsaved-note exit guards, CN selection scope, retained draft controls, duplicate detection, suffix identity and release naming. Notes migrate to schema 7 with existing labels and numbering preserved. See docs/AUDIT-FIXES-2026-10-07.md for regression results and compatibility details.


### Notes backup and restore (unreleased)

In QC Notes Settings, choose **Save backup file**, choose a folder, and save the dated JSON file. To recover it, choose **Restore backup**, select the file, review the counts and confirm **Replace all jobs and lists**. Restore replaces all current notes, so save a backup of them first if needed. Files include all jobs/lists, XF/MT numbers, pending work, drafts and saved transcripts. Calculator settings and voice-service credentials are excluded. Backup files are plain JSON.


## 1.83 release - 2026-10-07

Built and signed RT-Handbook-v1.83.apk (version code 105) with the existing release key. Includes CN search/bulk actions, audit repairs and backup/restore. Signature, 16 KB alignment, manifest and packaged source assets verified. Uploaded to Google Drive My Drive; upload completion confirmed. Verification: dist/BUILD-VERIFICATION-1.83.md. No download link fetched or handset installation performed.


## 1.84 release - 2026-10-07

Built, signed and uploaded RT-Handbook-v1.84.apk (version code 106) to Google Drive My Drive. Includes permanent app-themed offline charts with zoom/reset and no original-view switch. Signature, alignment, manifest and asset equality verified. See dist/BUILD-VERIFICATION-1.84.md. No download link fetched or handset installation performed.


## 1.85 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.85.apk (version code 107) to Google Drive My Drive. Includes 17 higher-resolution PDF-sourced charts. Section IX retains its supplied screenshot. Signature, alignment, manifest and packaged asset equality verified; see dist/BUILD-VERIFICATION-1.85.md. No download link fetched or handset installation performed.


Release 1.86 (versionCode 108), 2026-10-08: Built, signed with the existing certificate, and uploaded dist/RT-Handbook-v1.86.apk to Google Drive My Drive. Drive displayed 1 upload complete for the exact APK filename. All offline chart families now use original vector artwork. Signature, alignment, release consistency, chart assets, and packaged-source equality checks passed. APK SHA256: fb65ebd5f7ed258bb684e905da046539b0057fd2fdcf0c1a0ec2951ea4726e3c. Verification: dist/BUILD-VERIFICATION-1.86.md. No download link fetched.


## Film internal offset - unreleased after 1.86

Owner requested film Internal offset = unrounded shot time / 3.2, rounded to the nearest second (half seconds round up), replacing the old x1.15 /4 formula. Carestream CR remains /3, rounded up. Normal Internal remains /9 for films and /8 for CR; the 6-inch minimum and screen/print shared calculation remain. Updated calculation details and current documentation. Calculator regression tests cover all six films, exact and fractional boundaries, zero, and unchanged CR. Calculator, current UI (including screen/print equality), and consistency tests passed. No APK built or uploaded for this change.


## 1.87 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.87.apk (versionCode 109) to Google Drive My Drive. Film internal offsets now use unrounded shot time / 3.2, rounded to the nearest second; CR remains /3 rounded up. Existing release signature, alignment, manifest and asset equality verified. SHA256: 9a42e534d6ea43f51394f054b8e872809e82e5b9e076dd1b3ed6e84433d09f54. See dist/BUILD-VERIFICATION-1.87.md. Drive confirmed completion. No download link fetched or handset installation performed.
