# ShotTime handover — 1.21.1 (versionCode 43)

> **Newest first:** 1.98 / versionCode 120 (2026-10-12, unreleased) restores the Carestream CR chart with fixes, starts calibrated CR from the chart's per-size exposures and removes the CR field estimate. Before that, 1.97 / versionCode 119 (2026-10-11, unreleased) adds Carestream CR (calibrated). See AGENTS.md (top entry) and docs/CR-CALIBRATED.md. Older sections below are historical.



Status on 2026-09-30: source is at 1.21.1. 1.21.0 changed the exposure model and 1.21.1 adds Carestream CR (shot times change; see below). All three test suites pass and `build-review.sh` compiles and packages against Android 16 (API 36). **Not yet signed, released or tested on a device.** The last signed release is 1.19.1 (versionCode 40) in `release/`.



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

| R3 | Independent review: keeping each small film's own density curve tied partners only at density 3.0 (Fuji up to ~0.4 density apart at 2.0); kept size/schedule factors were set against the old model | Small films follow partner × ratio at every density; size/schedule factors also reset on upgrade | 1.21.0 |

| A1 | Owner request: more sizes | NPS 18, 20, 24 and Sch 10 on every size (ASME B36.10M walls, SFD OD + 0.125 in); 114 rows | 1.21.0 |

| R4 | Second review: saved filters hid new rows; helper/size-schedule defaulted to Sch 10 (a 3" STD calibration logged as Sch 10 would be 1.32× too high); 17 truncated walls; dead code | "All" saved as null and old full lists treated as all; forms default to STD; walls corrected to B36.10M; cleanup | 1.21.0 |

| F2 | Accuracy feature: measured density in the calibration helper | Film curve (log-linear between target densities) converts a densitometer reading to the target density | 1.21.0 |

| A2 | Owner request: hide extrapolated rows | Rows over 90 mm total steel (18" and 20" Sch160, 24" Sch120–160) hidden in results, print and forms; 109 shown | 1.21.0 |

| A3 | Owner request: Carestream CR | `cr` film on both belts from the owner's CR chart (`EXPOSURE_CHART.xlsx`), values used as given (not the steel model); owner chose: chart rows only (others —), same at every density, Internal ÷ 8 / offset ÷ 3, 24" XS and 6" XXH as written | 1.21.1 |

| — | Version and settings | 1.21.0, versionCode 42; settings schema 2 resets film-wide and size/schedule factors on upgrade | 1.21.0 |

| — | Version | 1.21.1, versionCode 43 (Carestream CR); no settings change | 1.21.1 |



`README.md` has the user-facing change lists under "1.21.1", "1.21.0" and "1.20.0".



## Owner decisions to respect



- **Exposure model (1.21.0):** the owner approved the shared steel curve and the published small/large ratios, to be verified by test shots. Measured results may replace the published ratios or large-film reference times.

- **Calibration helper** divides out the selected pipe's size/schedule factor (option chosen over "show the doubled result").

- **Storage clean slate:** pre-release saved settings are discarded (`schemaVersion: 1`). From now on, storage changes need a real migration.

- **Carestream CR** uses the owner's chart as given. The chart does not follow the shared steel curve (relative to 4" STD, small pipes up to 2.9× and large pipes down to about a fifth of the model), so CR must not be tied to it without the owner's approval. 24" XS 85,610 Ci·s looks like a thicker schedule's value; the owner chose to keep it.

- **Helper activity pre-fill** stays, labelled with its date (chosen over removing it or asking for a shot date).

- **Left as-is on purpose:**

  - XXH/XXS rows are listed after schedule 160 for 8"–16" even though their wall is thinner (conventional order; values are correct).

  - Small 9–10px text (eyebrow, offline badge, "Correction ×" note) was not enlarged; the owner skipped that change.

  - Standard times can display `0s`; the owner chose to keep that.



## Open work



1. **Test shots for the 1.21.0 model** (owner): at density 3.0, 72 °F / 4 min, one hanger —

   - D4 on 3" STD and D5 on 4" STD at the app's times: checks the D4/D5 ratio (2.0) and D5's reference time. Repeat at density 2.0 if other densities are used (published ratios are usually defined near density 2).

   - D4 on 2" STD with D4 on 3" STD: short 2" shots (~9 s at 26 Ci) are sensitive to source transit and SFD placement; correct with a size/schedule factor if 2" reads darker.

   - For mixed brands: D5, T200 and IX80 on 4" STD together; brands are not tied to each other, so differences set per-brand film factors.

   - D5 on 4" STD, 8" XS and 12" Sch160: checks the 12.1 mm steel curve. 12.1 mm is the lowest published value; if density rises with wall, the effective half-value thickness is higher (review estimate: 12.7–13.6 mm would put 12"–16" Sch160 about 0.2–0.9 density lighter than 4" STD).

   - If Carestream or Fuji are used, the same pair for MX125/T200 or IX50/IX80.

   - Correct with film-wide factors (the helper calculates them), or, if a published ratio or reference time is consistently off, update `FILM_REFERENCES` in `calculator.js` with owner approval.

2. **Sign and release** (owner only, needs the private `signing/` backup): `SDK_ROOT=/path/to/sdk bash build.sh` produces `dist/ShotTime-v1.21.1.apk`. `release/` still holds the signed 1.19.1 APK; replace it when a signed 1.21.1 exists and regenerate `SHA256SUMS` (it covers every tracked file except itself).

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



## Local Note Taker implementation handoff — 2026-09-30



The approved local-lists plan adds four trusted injected assets: notes-model.js, notes-parser.js, notes-storage.js, notes-ui.js. No exposure/calibration modules or network permissions changed. Browser harnesses use tests/load-app.mjs to mirror native asset injection. npm test now includes the original three suites plus four note suites.



Delivered: local library, date/LSD, numbering/format controls, typed multi-pipe batch parsing, manual edits, correction targets, grouped undo, deletion choices, persisted review/draft state, save-failure warning, TSV copy fallback and JSON recovery export.



Remaining: online speech service/backend configuration, native recording lifecycle, Bluetooth and lock-screen device tests, authenticated computer sync. See docs/superpowers/next-stage-recording.md for researched constraints. Stage 1 does not claim voice functionality or a new installable APK.





### Build tool installation follow-up — 2026-09-30



Installed Temurin JDK 21.0.12.1, Android command-line tools, Android platform 36, Build Tools 36.0.0 and platform-tools. Reused the existing SDK directory, preserving older packages. Added build-review.ps1 for native PowerShell builds. The unsigned APK compiled, zipaligned and passed aapt package inspection (package ca.kylekeith.shottime, min 26, target 36). This supersedes the earlier missing-toolchain limitation. Device behavior remains untested; signing backup remains untouched.

# Current follow-up: 1.22.0-test.2, versionCode 45



The owner requested offline voice without usage charges and chose Whisper. Added CPU Whisper base.en, ARM64 native compilation, a microphone foreground service, Phone/Bluetooth selector, permissions, durable recognized-text recovery, pending-pipe assembly, ordered review and replay protection. All downloads remain in ignored build output. Build via `build-voice.ps1`, then `build-review.ps1`; use the existing signing identity for a test APK. See `docs/WHISPER-TEST.md` and the 2026-09-30 Whisper plan for details. Older cloud/Vosk proposals below are superseded. Computer sync is still not implemented.



## 1.22.0-test.6 cloud fallback and approved wording



CloudSettings (native key/guard), CloudClient (fixed OpenAI HTTPS calls), VoiceBackend (sticky Auto fallback), notes-learning.js (approved exact/context examples) added. Phone remains default and uses existing base.en. Cloud/Auto recordings defer row creation until Stop and review. Raw transcript preserved; long review sections use cloud:part:N IDs to avoid applyGroup command-ID collisions. Ten app suites and native routing tests passed; independent review findings fixed and verified. No API credential or live request used in development. See docs/CLOUD-VOICE-TEST.md for setup/limitations.



## 1.22.0-test.7 review fixes



Fixes from the Claude code review of 1.22.0-test.6 (owner approved all; 40s means schedule 40). See README "1.22.0-test.7 review fixes". `whisper-jni.cpp` now returns a byte array, so rebuild the native library (`build-voice.sh`/`.ps1`) before `build-review`. Device checks still needed: start recording with a pending earlier session (should show a message, not crash), a deliberately corrupted `no_backup/voice-session.json`, Auto with no key (live rows), cloud-only long session, CSV with welder ID 007 opened in Excel, and storage warning with many lists.



## 1.22.0-test.8 voice recognition



Owner approved items 2 (bigger model) and 3 (speech detector) from the recognition suggestions, plus single-letter welder IDs. See README "1.22.0-test.8" and docs/WHISPER-TEST.md (method, results, checksums). New `SpeechDetector.java`; `AudioSegmenter` takes speech probabilities; JNI adds VAD functions and a prompt/fast parameter to decode. Phone checks needed: speed of small.en on the target phone (watch for the short-window switch and "could not keep up"), first-run copy time (190 MB), pause detection with site noise, Bluetooth, and letter IDs spoken by real welders. Not done (owner's choice for later): recording a real test set, grammar-constrained decoding, welder roster.



Linux build verified for test.8: NDK 28.2.13676358 and CMake 3.22.1 cross-compiled `libshottime_whisper.so` (all six JNI functions exported, 16 KB segment alignment) and `build-review.sh` produced `dist/ShotTime-review-unsigned.apk` (189 MB; versionCode 51, 1.22.0-test.8, RT Helper, arm64-v8a, zipalign -P 16 OK, no base.en). `build-review.sh` and `build.sh` had Windows line endings and failed under bash (`pipefail\r`); they now use LF and `.gitattributes` keeps `*.sh` LF. In that environment GitHub's archive download was blocked, so the whisper.cpp source came from the `v1.9.4` git tag (commit 927cfce) rather than the checksummed zip; a normal `build-voice.sh` run uses the zip.





## 1.22.0-test.9 — ARM voice performance trial



Whisper and Silero now share a native-library loader. The voice build produces a portable ARM64 library and a second library compiled with `-march=armv8.2-a+fp16+dotprod`. The loader selects the optimized version only when every reported CPU Features line contains asimd, fphp, asimdhp and asimddp; missing/unreadable capability information or an unavailable optimized library retains the portable path. Model weights, full encoder-window default, thread count, prompts, pause boundaries and parser behavior are unchanged.



This trial targets the owner's Samsung S26 Ultra. CPU math optimizations may affect floating-point rounding, so recognition should still be checked. No handset performance measurement is available yet, and a speedup is not claimed. Compare the same phrase and the wait after Stop with test.8. The two existing test.8 review findings remain separate from this performance trial.



Manifest versionCode 52, versionName 1.22.0-test.9. Use the replacement key recorded in ../../RT-HELPER-SIGNING-LOCATION.md; never generate another key or delete the signing folder. It installs over the replacement-key test.8 build.



Native selector test: compile `src/ca/kylekeith/shottime/NativeVoice.java` with `tests/NativeVoiceTest.java`, then run `ca.kylekeith.shottime.NativeVoiceTest`. It covers modern, older, mixed and missing capabilities plus exact feature-token matching. Both build-review scripts require both libraries.



## 1.22.0-test.10 MT follow-up

User approved per-list MT sequence, one fitting per number, CN-linked notes; subsequently requested CSV side-by-side with XF using CN#, MT#, Size, Schedule, Description and added SW/socket weld plus 3M/6M/9M schedules. Implemented model/parser/UI/CSV and schema 1 to 2 migration (including undo snapshots). See README test.10 section. New tests: test-notes-mt.cjs, test-mt-ui.mjs. Keep current signing key and both CPU libraries. No native C++ change or model re-download needed.


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

## 1.22.0-test.15 — Claude review of test.14

Owner decisions (2026-10-01): the original ShotTime key (724ecdf9…) is lost; the RT Helper key (af4e70b2…) is used from now on. MT fittings take the same welder as the XF welds on the same CN, so "Conflicting Welder IDs" for different welders in one MT sentence stays.

Fixed: Stop tail rejection with a full decoder queue (VoiceService finally block now drains the queue, then transcribes the tail directly); interrupt during awaitTermination could close Whisper while decoding (new `Waits.untilTerminated`, tested by `tests/WaitsTest.java`); counting aloud in number words via voice (notes-voice comma rule; test in test-notes-voice.cjs); build.sh CRLF (and `tests/test-consistency.cjs` guards all *.sh); privacy text vs INTERNET permission (also checked by test-consistency).

Device checks for test.15: Stop while transcription is behind (speak continuously, then Stop) — the last words should appear without a "could not keep up" message.

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


## 1.22.0-test.49 - Default weld circumference

Code Calculator defaults total weld length to pi times actual outside diameter from the existing pipe chart. Pipe size is available for total-length profiles. Manual lengths (including intentionally blank values) survive size changes. Use circumference restores automatic sizing. Unit conversion preserves both modes. UW-52 radiograph evaluation length is separate and never defaults to pipe circumference. Browser regressions cover default, overrides, reset, units and spot-profile switching.


## 1.22.0-test.50 - Code calculator pipe selectors

All code profiles offer size and schedule selectors using existing pipe chart data. Valid combinations fill nominal wall thickness; circumference defaults from test.49 remain. Explicit thickness edits survive selection changes until Use schedule thickness. Missing schedule combinations clear automatic thickness, never retain stale values. Tests cover selection, units, overrides/reset and unavailable schedules. IQI crown/reinforcement is still an independent input.


## Unreleased - Appendix 4 reference limits

Owner authorized the located appendix reference. B31.3 and UW-51 rounded cards now calculate sizes and show alignment/clustering guidance. Card titles omit the edition; expandable source details retain provenance. B31.3 E size multipliers are applied; distribution adjustment remains manual with explicit D base references. Unit and mobile UI suites passed. See docs/APPENDIX4-STATUS.md. No APK packaged for this change.


## Unreleased - Section I and B31.1 gaps

Implemented PW-35 reinforcement and undercut, sourced A-250 reference cards, and dedicated B31.1 calculations replacing broken workbook results. Added joint type, temperature range, weld construction and conditional width fields. B31.1 remains 2012; A-250 basis is explicitly 2019 in source details; older IQI reference is V-2010/2011a. See docs/CODE-CALCULATOR-REPAIRS.md for source coverage and limitations. No APK packaged.


## Unreleased — external chart links

Relevant Code Calculator cards now have collapsed Chart links with source/figure and page references for Appendix 4, A-250, CSA Figure 7.22 and Section IX. Links open externally on Android, only after a main-frame user gesture and exact URL allowlist match in ChartLinks.java. WebView request blocking and CSP remain unchanged. This owner-authorized exception supersedes older network/navigation restrictions for these four destinations only. No charts bundled; sources require internet and PDF viewers may ignore page anchors.

Calculator and browser regressions and ChartLinksTest pass; all Android Java sources compile against API 36. No signed APK packaged.


## 1.22.0-test.51 - Calculator repairs and chart links

Packaged the preceding unreleased changes as versionCode 94 with the existing signing identity. Signature, alignment and packaged assets/payload verified. See dist/BUILD-VERIFICATION-test.51.md. No phone installation performed.


## 1.73 - RT Handbook

Renamed user-facing app labels to RT Handbook. Android versionName 1.73, versionCode 95; npm metadata 1.73.0. Existing package, data keys and signing identity retained. Current UI suite passed; APK signature, alignment, and packaged assets/voice payload verified. See dist/BUILD-VERIFICATION-1.73.md.


## Unreleased - Offline explanation diagrams

Original accessible SVG measurement guides in code-ui.js for Appendix 4/A-250 size, alignment and clusters. Uses existing selected-thickness results; group length bands 19/57 mm and three-times-longer-adjacent-group spacing checked against A-250.3.4-2 (2019), PDF page 335. Strict sums illustrated separately from overall acceptance. Criterion E guides explicitly show D base references. No invented porosity distributions. Alignment links omitted because the full measurement rule is shown offline; necessary distribution/cluster chart references remain. Source changes only, not packaged in 1.73.


## Unreleased - Supplied offline Appendix 4 charts

User supplied four screenshots (7110/7112/7114/7116) of Sulzer TP-0008 Rev.10, figures 4-3 through 4-8. JPEG bytes are unchanged in code-chart-images.json, embedded as data URLs through the Android HTML loader and tests/load-app.mjs. SVG viewports display the selected figure; no inferred or generated pore patterns. Offline zoom/pan is not physical-scale calibration.

Only VIII-full and B31.3 use these images; A-250, CSA and IX remain separate. Inclusive metric thickness bands 3/6/10/19/50/100 mm tested; no chart below 3 mm. Figures 4-4 and 4-6 have a page-counter overlay hiding part of the cluster pattern, so an incomplete-image notice and original link remain. Complete supplied figures replace their external links. Criterion E retains explicit D-base guidance.

Unit tests, mobile UI boundary/zoom/overflow tests and Android compilation pass. Original JPEG byte equality verified. Preview: build/offline-appendix-chart.png. Not packaged in 1.73.


## Unreleased - Supplied Section IX chart

Added user-provided 7118.jpg unchanged as the offline QW-191.1.2.2(b)(4) reference (IX-2025 p23). Viewer selects the 3–6, >6–13, >13–25 or >25 mm strip including its caption; below 3 mm remains the numeric count rule. Removed external link from IX rounded card when local chart is present. Original image bytes retained, no generated pore patterns and no physical-scale claim. Calculator boundaries, inch conversion, mobile zoom/overflow and source isolation tests passed. Preview build/offline-ix-chart.png. Not yet packaged.


## Unreleased - Supplied Section I A-250 charts

Five original screenshots 7122/7120/7124/7126/7128 are embedded unchanged. A-250.3.4-1 and -2 use SVG display rotation to read upright, with original notes retained. Section I/B31.1 cards select A-250.3.6-1 through -5 for metric thickness 3–100 mm inclusive; above 100 mm remains explicitly without a supplied chart and retains source link. No substitution of VIII or IX charts. External distribution links removed where supplied A-250 chart is available. Unit boundaries and UI selection, rotation, source labels, zoom/overflow and unsupported range tests pass. Source-only, not packaged.


## Unreleased - A-250 above 100 mm supplied

Added original user-supplied 7130.jpg as A-250.3.6-6, selected only above 100 mm. At 100 mm figure -5 remains selected. This supersedes the preceding missing-chart note: all six A-250 distribution thickness bands now have supplied offline images. Removed above-100 missing notice/external link. Tests cover boundary, inch conversion and UI selection; calculator and browser suites pass. Preview build/offline-boiler-over100.png. Not packaged.


## Unreleased - Supplied CSA Figure 7.22

Added unchanged 7137.jpg screenshot as offline CSA spherical-porosity reference. Both sweet/sour profiles select 3% below 14 mm, 4% from 14 through 18 mm inclusive, and 5% above 18 mm, matching Table 7.9. Figure windows preserve supplied dot patterns and captions; the 3% view excludes the phone page counter above its title. External CSA chart link omitted when local chart is shown. Calculator boundary tests and browser profile/units/zoom/mobile tests passed. Preview build/offline-csa-chart.png. No APK packaged.


## Unreleased - Clear Figure 4-4 replacement

User supplied 7139.jpg has unobstructed figure 4-4 patterns and notes; replaced the earlier screenshot viewport for >6–10 mm. Original JPEG bytes retained. Removed incomplete-image notice and external link for this band. New 7141.jpg still obscures figure 4-6 cluster with the 26/38 counter; kept that band flagged with its existing source link. Unit/browser tests pass. Preview build/offline-appendix-44-clear.png. Not packaged.


## Unreleased - Clear Figure 4-6 replacement

Replaced the >19–50 mm Appendix 4 chart with unchanged supplied 7143.jpg, viewport preserving the complete figure and notes. No cluster obstruction remains; removed that warning and external link. All supplied distribution chart groups (Appendix 4, A-250, IX, CSA) now have offline images for their applicable ranges. Unit/browser tests passed; preview build/offline-appendix-46-clear.png. These additions remain unbuilt after 1.73.


## 1.74 - Offline charts and explanation diagrams

Packaged all preceding offline diagram/chart additions, including clear Appendix 4 replacements. Version code 96, existing signing identity retained. Calculator unit/mobile UI tests passed; signing, alignment and full packaged asset/payload equality verified. See dist/BUILD-VERIFICATION-1.74.md. No phone installation performed.

## Unreleased - Additional MT descriptions

Added D-Leg, Dummy Leg, Lifting Lug, Manway, Plate, Fillet Weld and Slip-On Flange to manual MT entry/editing, structured clarification and spoken/typed parsing. Descriptions retain distinct labels; singular/plural forms and spaced D leg/man way/slip on flange are accepted. Existing schema and numbering are unchanged. Source changes only; no APK packaged.


## 1.75 - Additional MT descriptions

Packaged all seven new MT descriptions as version code 97 with the existing signing identity. Android build, signing, alignment and packaged app/voice payload checks passed. See dist/BUILD-VERIFICATION-1.75.md. No phone installation performed.


## Unreleased - Unknown CN and welder placeholders

Explicit unknown CN / unknown CN# / CN unknown and unknown welder / welder unknown / welded by unknown save ? for XF and MT entries, overriding previous context even with optional fields. Structured review preserves placeholders; CN format changes leave ? unchanged. Malformed CNs still require review. Source-only after 1.75.


## 1.76 - Unknown CN and welder placeholders

Packaged explicit unknown CN/welder placeholders as version code 98 with the existing signing identity. Android build, signing, alignment and packaged app/voice payload checks passed. See dist/BUILD-VERIFICATION-1.76.md. No phone installation performed.


## Unreleased - QC jobs and daily lists

Jobs > Daily lists replaces the flat list landing page. Job-owned XF/MT counters apply to typed, manual, reviewed and voice additions across all days, including older lists. Numbers are not recycled after undo/delete. Schema 5 migrates each existing list to a separate job with stable list identity and preserved notes/history/pending state. Settings and daily CSV continue to work; failed saves retain staged allocations and require retry before new edits. Native HTML loading includes notes-jobs.js. No APK packaged. See execution ledger for verification results.

Verification: full npm test passes after independent review and the MT start-padding regression fix. Android Java compilation against API 36 passes. Mobile previews: build/qc-jobs.png and build/qc-daily-lists.png. Feature remains source-only after 1.76.


## 1.77 - QC jobs and daily lists

Packaged Jobs/Daily lists and continuous job numbering as version code 99 with the existing signing identity. Build, signing, alignment and packaged app/voice payload verification passed. See dist/BUILD-VERIFICATION-1.77.md. No phone installation performed.


## Unreleased after 1.77 - Back navigation and client job labels

Fixed the Android Back callback path: overlays close first, then daily list > job > all jobs. Recording and dirty-save failures consume Back and display the existing navigation error instead of allowing Activity exit. Job name is now labeled Client name; editable Start date defaults to the local date. Job buttons show client name - LSD - start date. Schema 6 migrates schema 5 start dates from the earliest child list (today for empty jobs), preserving names, selection, notes and counters; older list migrations use the original list date.

Verification: new browser regression failed against the old Back path and passes after the fix; migration/date validation checks and full npm test passed (build/jobs-back-tests.log). Mobile preview: build/qc-client-jobs.png. Browser tests invoke the exact closeTopSheet callback used by MainActivity; hardware Back has not been tested on a handset. Source-only changes: the uploaded 1.77 APK has not been replaced.


## Unreleased after 1.77 - Back to Shot Time Calc

Back from the jobs root, Pipe Schedule Chart, Custom Shot and Code Calculator now selects Shot Time Calc before allowing Android's default Back behavior. Overlay dismissal and the daily list > job > jobs hierarchy retain priority. Regression failed on the prior jobs-root behavior and passes after the change; screen-back, jobs-back, custom-shot, pipe-chart and code-calculator UI suites all passed. Source-only; no APK built or handset test performed.



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

Verification: all notes suites passed, with the draft-save regression rerun after adapting its setup to the retained correction workflow. CSV spacing persists per list and produces the same export gaps. Removed controls are asserted absent; recording, review, duplicate confirmation, Back and deletion checks pass.


## 1.82 - Inspection entry screen cleanup

Packaged the cleaner entry screen and CSV spacing under Settings as version code 104 with the existing signing identity. Verification: dist/BUILD-VERIFICATION-1.82.md. No handset installation performed.

## Unreleased after 1.82 - CN search and bulk actions

Search CN# is available inside jobs and daily lists. It searches every daily list in the current job by full or partial CN, ignoring case and supporting CN prefixes, numeric padding, suffixes and unknown placeholders. Results show list date (and same-date ordinal) plus XF/MT counts and open the matching list. Checkboxes select a CN's complete XF and MT group on one daily list; selection survives search filtering. Select all shown and Clear selection support bulk work.

Move selected picks an existing destination job and daily list; source lists are excluded. Delete selected and Move selected share one XF and MT numbering option: Keep existing numbers or Renumber continuously. Keep preserves numeric sequences and gaps and rejects destination collisions or numbers below its configured start. Renumber compacts the whole source job, independently from its XF/MT starting numbers; cross-job moves append at the destination's next counters. Other destination entries are unchanged. Cross-job transfers adopt destination CN formatting for numeric/suffixed identities. Weld and MT data, source voice replay markers, drafts and context are retained.

Preview shows counts, destination, before/after ranges and next counters for both numbering sequences, plus existing destination duplicate CN warnings. Confirmation is required; cancel changes nothing. Bulk changes clear list-local undo history in affected jobs (disclosed in the preview) to prevent restoring moved rows/old numbering. Pending instructions or drafts in affected jobs must be resolved first. Active recording blocks bulk work. A single complete library save precedes committing live state; storage failure leaves both source and destination unchanged and permits retry. Preview confirmation rejects stale state. No notes schema change; single-row edits and ordinary job allocation retain their previous behavior.

Verification: test-cn-bulk.cjs and test-cn-bulk-ui.mjs cover search, cross-list selection, XF/MT moves/deletions, both numbering modes, collisions, duplicates, cancellation, save failure/retry, replay, history boundaries, suffixes/placeholders, formatting, reload and mobile width. Source-only; no new APK built yet.

Final verification: all existing notes regression suites passed (build/cn-bulk-regression.log: FAILED []), both new bulk suites passed, and consistency checks passed. The browser suite additionally verifies that a late voice update invalidates an open confirmation rather than overwriting newer notes. Mobile search and confirmation previews: build/cn-search.png and build/cn-move-preview.png. No handset test or APK build performed for this change.

### CN selection gesture follow-up

Daily-list CN checkboxes and bulk controls are hidden until a 500 ms press-and-hold on a card selects that CN and enters selection mode. Normal taps keep expanding/collapsing cards; finger movement over 10 px, scroll, pointer cancellation, navigation, rerender, blur and hiding the app cancel pending holds. Holding row action controls is excluded. The release click after a long press is suppressed. Cancel selection and Android Back exit selection mode before leaving the list; clearing all ticks keeps selection mode open. Shift+Space on a focused CN header provides keyboard access. Search results retain their existing checkboxes. Recording blocks gesture activation. No model, storage or numbering change.

Browser verification covers normal taps, long press, multiple selection, movement/scroll cancellation, keyboard access, Back, recording locks and bulk operations. Screenshot: build/cn-hold-selection.png. Source-only after 1.82; no APK built or handset test performed.

## Unreleased after 1.82 - Full audit repairs (2026-10-07)

Applied all nine recommendations in docs/AUDIT-FULL-2026-10-07.md. IQI lookup normalizes completed selection-thickness arithmetic before inclusive boundary lookup. VoiceJournal attempts atomic reading before treating storage as missing, allowing backup-only recovery; unreadable/malformed/recovery-write failures leave the original recovery candidate intact and recording blocked. Browser screen transitions and native Back both consult the global notes save/recording guard.

Oversized ordinary offline pieces become bounded pending chunks with stable replay IDs. A completed voice session is acknowledged only after its exact transcript archive was saved; matching list existence is insufficient. Recovery failures show retry/export controls, retain the raw native callback for export, and cannot be cleared by unrelated navigation or saves. Retry attempts reconciliation again.

Search selections are cleared when closing the search session and before starting a new daily-list selection. Bulk previews list selected CNs and their source dates. Existing standalone drafts have review/discard controls, preserving their text until an explicit action. Duplicate checks no longer infer Undo from history length; callers mark actual Undo explicitly.

Notes schema 7 retains the source format on suffix/non-numeric CN rows and history snapshots. Numeric CNs already have stable numeric identity and do not need repeated format metadata. Versions 1-6 migrate on load without rewriting raw storage until a save, changing visible labels, consuming numbers or removing drafts. New future-only format changes retain suffix identity across duplicate checks, reformatting and transfers. Arbitrary historical labels whose original prefix was already lost cannot be safely reconstructed; migration preserves those labels rather than guessing a new identity.

The alternate shell release script derives its output name from the manifest and refuses to overwrite an existing APK. No release version bump, signing or upload was performed for these fixes. Verification details: docs/AUDIT-FIXES-2026-10-07.md.

Final audit-fix verification: complete npm test passed all 56 JS/browser suites; all six Java suites passed; final unsigned Android compilation/packaging passed. The original large-library fixture passed unchanged after limiting source-format metadata to rows that require it. Logs: build/audit-fixes-full-tests.log and build/audit-fixes-android.log. No signed release or upload performed.


## Unreleased after 1.82 - Notes backup files and restore

Settings offers Save backup file and Restore backup through Android's document picker. Save writes a timestamped UTF-8 JSON file to the chosen location. Restore validates through existing schema migrations, previews job/list/XF/MT counts, and requires Replace all jobs and lists confirmation. Cancellation, invalid files, stale previews and failed writes leave the library untouched. Native reads are limited to 20 MB; file I/O runs off the UI thread. Only exact user-gesture shottime://backup/save and shottime://backup/restore routes were added, without storage permissions or a JavascriptInterface.

The version-1 rt-handbook-notes envelope includes the complete notes library: jobs, lists, numbering, formats, pending review, drafts and saved transcript/history data. Earlier plain notes JSON is also accepted and migrated. Calculator settings, cloud credentials, learned wording and microphone preferences are excluded. Copy recovery data remains available; damaged raw data and voice-recovery wrappers are not valid restore files.

Restore saves the candidate before publishing it. Existing deletedLists tombstones reserve voice-session:<id> to acknowledge the completed native session during restore, preventing its separate journal from replaying into older restored data. Markers remain bounded and survive reload. Active/unrecovered voice sessions block restore.

New tests: test-notes-backup.cjs and test-backup-ui.mjs cover round trips, migration, malformed/future/oversized input, cancel, quota retry, stale previews, recording and replay suppression across reload. No new signed release, upload or handset test.

Verification: full npm test passed (58 JS/browser suites); targeted backup, jobs and storage suites passed again after final restore-tombstone retention and damaged-storage recovery checks. Android compile/unsigned packaging passed (build/backup-android-final.log). Full regression log: build/backup-tests.log. Android document-picker interaction still requires a handset test.


## 1.83 release - 2026-10-07

Built and signed RT-Handbook-v1.83.apk (version code 105) with the existing release key. Includes CN search/bulk actions, audit repairs and backup/restore. Signature, 16 KB alignment, manifest and packaged source assets verified. Uploaded to Google Drive My Drive; upload completion confirmed. Verification: dist/BUILD-VERIFICATION-1.83.md. No download link fetched or handset installation performed.


## Offline chart theme - unreleased after 1.83

Offline Appendix 4, Section IX, A-250 and CSA chart viewers now default to the app charcoal/warm-grey theme, with copper controls, an Original appearance switch, live zoom percentage and Reset zoom. An SVG luminance colour mapping changes display colour only; source JPEG bytes, viewports, rotations, dimensions, captions and calculator selection rules remain unchanged. No pattern redraw or physical calibration is implied.

Calculator unit tests, browser tests (including appearance switching, source retention, zoom/reset and mobile overflow) and release consistency pass. Visually inspected Appendix 4, boiler and CSA previews. Source-only; no new APK or upload.

Chart theme follow-up: removed the appearance switch at the owner's request. Offline charts always use the app theme; zoom and reset remain. Source images and technical content are unchanged.


## 1.84 release - 2026-10-07

Built, signed and uploaded RT-Handbook-v1.84.apk (version code 106) to Google Drive My Drive. Includes permanent app-themed offline charts with zoom/reset and no original-view switch. Signature, alignment, manifest and asset equality verified. See dist/BUILD-VERIFICATION-1.84.md. No download link fetched or handset installation performed.


## Higher-resolution offline charts - unreleased after 1.84

Replaced the rendered display of 17 Appendix 4, A-250 and CSA figures with PNG crops rendered directly from the existing original PDF vector artwork. Most are 2504 pixels wide; rotated schematics are 3120 pixels wide and CSA figures 2056 pixels wide. No generated/upscaled screenshot patterns. The permanent theme and 100-300% zoom/reset remain. Section IX retains its original screenshot because a usable high-resolution 2025 source could not be obtained.

assets/code-chart-images.json contains hq:<figure> entries with dimensions/viewBox/optional rotation and accurate source descriptions. Legacy supplied JPEG entries remain as fallbacks. The code calculator selection/limits and edition logic are unchanged. scripts/render-code-charts.py reproduces crops with pdftoppm; docs/code-chart-render-manifest.json records PDF pages, crop rectangles and source/output hashes. The local VIII PDF has nonstandard EOF line formatting but Poppler renders it correctly; no document content was repaired or redrawn.

Verified calculator unit/UI suites, mobile overflow, image dimensions/rotation/source hashes and visual previews including 300% zoom. Section IX remains source-limited; obtain the original PDF page 23 to upgrade it. No release version bump or upload.


## 1.85 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.85.apk (version code 107) to Google Drive My Drive. Includes 17 higher-resolution PDF-sourced charts. Section IX retains its supplied screenshot. Signature, alignment, manifest and packaged asset equality verified; see dist/BUILD-VERIFICATION-1.85.md. No download link fetched or handset installation performed.


## Section IX vector artwork - unreleased after 1.85

Located a complete 2025 Section IX PDF and extracted printed page 23 (PDF page 73): 254 original drawing paths, zero raster images. All four thickness-band windows now render actual inline SVG paths and outlined source captions in the app theme, bypassing SVG-image raster caching. Scoped SVG definition IDs avoid collisions. No guessed, traced or substituted indications; calculation rules and thickness boundaries remain unchanged. The separate red download-host advertising overlay was excluded from the extracted artwork; source paths/transforms are unchanged.

Reproduction: scripts/extract-ix-vector.py (PyMuPDF); source/output hashes and viewports: docs/code-chart-ix-vector.json. Assets: code-chart-ix.svg plus embedded hq figure entry. Calculator/UI tests verify inline path rendering, zero image nodes, all four viewport bands and zoom; chart asset checks verify SVG hash and no raster/script/foreignObject content. Previous statements that IX still needs a source are superseded. No release bump or upload.


## All offline charts use vectors - unreleased after 1.85

Converted the remaining 17 Appendix 4, A-250 and CSA figures to inline SVG, alongside Section IX. All current offline chart selections now display original vector paths and outlined captions with app colours; no active chart uses a raster image. Original PDF path data and transforms are asserted unchanged during extraction. Existing crop windows, rotated boiler schematics, thickness bands, zoom/reset and calculator rules remain.

Reproduce with scripts/extract-code-vectors.py using the recorded local source PDFs and PyMuPDF; then scripts/extract-ix-vector.py for Section IX. docs/code-chart-vector-manifest.json records sources, geometry-preservation assertions and output hashes; standalone SVGs are in assets/code-chart-vectors. The older PNG renderer remains a historical fallback and should not overwrite the current vector assets for releases. Legacy screenshot entries remain inactive fallbacks.

Chart asset checks and calculator unit/browser tests pass, including mobile widths, rotation, inline path rendering, zoom/reset and source preservation. No release bump, signing or upload.


Release 1.86 (versionCode 108), 2026-10-08: Built, signed with the existing certificate, and uploaded dist/RT-Handbook-v1.86.apk to Google Drive My Drive. Drive displayed 1 upload complete for the exact APK filename. All offline chart families now use original vector artwork. Signature, alignment, release consistency, chart assets, and packaged-source equality checks passed. APK SHA256: fb65ebd5f7ed258bb684e905da046539b0057fd2fdcf0c1a0ec2951ea4726e3c. Verification: dist/BUILD-VERIFICATION-1.86.md. No download link fetched.


## Film internal offset - unreleased after 1.86

Owner requested film Internal offset = unrounded shot time / 3.2, rounded to the nearest second (half seconds round up), replacing the old x1.15 /4 formula. Carestream CR remains /3, rounded up. Normal Internal remains /9 for films and /8 for CR; the 6-inch minimum and screen/print shared calculation remain. Updated calculation details and current documentation. Calculator regression tests cover all six films, exact and fractional boundaries, zero, and unchanged CR. Calculator, current UI (including screen/print equality), and consistency tests passed. No APK built or uploaded for this change.


## 1.87 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.87.apk (versionCode 109) to Google Drive My Drive. Film internal offsets now use unrounded shot time / 3.2, rounded to the nearest second; CR remains /3 rounded up. Existing release signature, alignment, manifest and asset equality verified. SHA256: 9a42e534d6ea43f51394f054b8e872809e82e5b9e076dd1b3ed6e84433d09f54. See dist/BUILD-VERIFICATION-1.87.md. Drive confirmed completion. No download link fetched or handset installation performed.
