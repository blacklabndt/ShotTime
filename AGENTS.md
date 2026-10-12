# AGENTS.md — ShotTime

## Field CR estimate — unreleased after 1.97

The owner now explicitly authorizes using the printed chart and inferred PMTs to fit a field model. Read docs/CR-FIELD-MODEL.md and docs/CR-FIELD-FIT.json. New crfield option in both belts and Custom Shot uses independent physical coefficients fitted to all 56 chart entries, constrained PMTs in steps of 10, with no T200 dependency. It is an estimated effective gain curve, not measured scanner calibration or a calibrated pixel target. Whole-size holdout median error 11.3%, worst 44.5%; do not describe it as universally accurate or better than a manufacturer curve. crcal and film calculations stay unchanged. Field PMT storage is separate. No APK release or upload.


## Carestream CR (calibrated) — 1.97, versionCode 119, 2026-10-11 (unreleased)

Read docs/CR-CALIBRATED.md. The owner asked for an independent CR calculation (see the package START-HERE.md and RESEARCH-AND-DECISIONS.md): no chart fitting and no T200 percentage. New film `crcal`, Carestream CR (calibrated), is in both belts and Custom Shot. Ci·s = R × (SFD m)² × 3600 ÷ 0.48 × 2^(total steel mm ÷ H), with plate exposure R from a per-card slider (0.5–3 R, `dose.<size>`). R defaults to what the owner's reference shots imply at that PMT, else the published 1.0 R starting point (Jelfs, NDE 2009, 0.8–1.2 R; not verified for Flex HR). H defaults to QSA's published 13 mm or the owner's measured value. A shot at another PMT is converted only through the owner's measured gain table (log-linear between measured PMTs, no extrapolation). An optional pixel target scales by (P − B). Up to 100 reference shots; excess is counted as unreadable. The chart `cr` uses the printed values for 2"–6" (×1.3 removed) and corrected 24" XH (6,390) and 14" Sch 40 (2,060). The chart's title is Fuji CR ST-VI; the owner uses Carestream Flex HR. The PMT slider per pipe size uses the owner's bounds (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70) only as control limits. Calibration is stored in `shottime.crCalibration` (schemaVersion 1); sliders are additive `pmt.<size>` keys. CR Formula (`cr70`) was removed at the owner's request. A belt saved on it falls back to the default film, its factors stay in storage unused, and its Custom Shot setups stay listed and load their geometry only. T200 and all films are unchanged; tests/fixtures/film-outputs-1.96.json pins them (2,280 table and 525 Custom Shot outputs) and pins exactly how the chart changed. tests/test-cr70*.cjs/mjs were deleted with the choice. New tests: tests/test-cr-calibrated.cjs and tests/test-cr-calibrated-ui.mjs, both in npm test. Do not import the standalone ShotTime 1.22.0 chart-fitted CR constants (523, 14.8 mm, 7.5 PMT/doubling, suggested PMTs). No signed build, device check or physical validation yet.

## 1.96 signed release — 2026-10-10

Version 118/1.96 packages CR Formula in both belts and Custom Shot. Existing signing identity, T200 and original CR chart retained. Build, signature, alignment, packaged asset equality and targeted release tests passed; full npm test passed before the version-only bump. See dist/BUILD-VERIFICATION-1.96.md and dist/RT-Handbook-v1.96.apk. Uploaded to My Drive through the restored browser connection on 2026-10-10; file ID 1SUwJGjcLIdWH6HeEHoCMkumdIqPS931u. Upload-complete UI and exact 197,799,518-byte size verified. Sharing stayed private. Handset installation remains unverified.

## Independent CR Formula — unreleased after 1.95, 2026-10-10 (removed in 1.97)

Owner requested an independent CR formula at 70% of the unchanged T200 baseline. Read docs/CR-FORMULA-70.md. New cr70 selection (Carestream CR Formula) uses fixed 480.48 Ci seconds at 0.474 inch total steel and 4.625 inch SFD, with independently stored 12.1 mm steel exposure-doubling thickness. The reference ratio is to T200 density 3.0 at default factors; CR has no density target. It is available in both belts and Custom Shot, with separate factor.cr70 / weld.cr70.* settings. Preserve existing cr chart values and settings. The older scripts/cr-calibrated-model.cjs remains separate research, not this formula. tests/test-cr70.cjs and tests/test-cr70-ui.mjs are included in npm test. No release build or upload for this change.

## Offline AI feasibility trial — 2026-10-09

Google follow-up: Gemma-3n-E4B-it Q4_K_M (4.54 GB) matched 11/20 original and 5/12 frozen additional cases, below Qwen4B. Same prompt/config, no model-specific tuning. Desktop medians ~0.94–0.98s with first-request 16.58s; no handset inference measured. See results-gemma*.json and report. No production integration; never auto-apply outputs.

Microsoft follow-up: Phi-4-mini-instruct Q4_K_M matched 10/20 original and 7/12 frozen held-out cases, below Qwen4B's 13/20 and 10/12. Same prompt/config, no Phi tuning. Desktop median ~0.5s, not phone performance. Critical failures include using an example ID as a missing delete target. See results-phi*.json and the trial report. No production integration.

Stronger-model follow-up: Qwen3-4B-Instruct-2507 Q4_K_M (2.497 GB) matched 13/20 development and 10/12 fresh held-out cases with unchanged short prompt. See report for substantive failures including invented defaults and fraction confusion. Still no production integration; do not auto-apply proposals. Raw outputs results-4b.json/results-4b-heldout.json; fixtures scripts/offline-ai-heldout.json. Desktop median ~1 second is not phone latency.

Owner approved trying an optional offline interpreter. Read docs/OFFLINE-AI-TRIAL.md. Qwen3-1.7B Q4_K_M was evaluated locally through llama.cpp, not integrated into Android. Best development result 7/20 exact matches across three prompt variants; do not claim production readiness or phone speed. No APK/version bump for this isolated trial. Harness scripts/offline-ai-trial.cjs and raw outputs under build/offline-ai-trial. Never auto-apply model proposals or allocate XF/MT sequences in the model.

## Paused timer actions — 1.95

While paused, the footer splits equally into Reset and Resume. Reset dispatches a paused-only restart action: persist a fresh full-duration timer, then start it through the existing permission/alarm path only if replacement succeeded. Resume continues the remaining duration. Both return to one full-width Pause button when running. Finished Stop/Reset behavior is unchanged. Version 117/1.95 signed; native tests/build passed, handset interaction still needs confirmation.

## Timer Reset position flash — 1.94

ShotTimer.show now updates an existing card in place when the display host and context are unchanged. Previously every Reset removed/re-added the overlay at default coordinates before asynchronously restoring the dragged position. Retain recreation for Activity/overlay host changes and remove cards for hidden/closed/disallowed states. Native timer tests and signed build passed; handset confirmation of the flash fix remains outstanding.

## Compact timer — 1.93

Owner requested removal of the separate Reset and minimize buttons. The card now has one full-width primary action and the close/cancel × control, at 240dp width (previously 280dp). Primary action retains Start, Pause/Resume, Stop at completion, then Reset; Stop keeps the completed overlay visible. Measured digit fitting and drag positioning remain. Native timer tests, build and signature/alignment verification passed; handset layout confirmation outstanding.

## Stop alarm without closing — 1.91

The completion button and notification action say Stop. The internal ack action cancels the completion notification and clears the automatic dismissal deadline; it retains the service while the floating completed card is visible. Reset reuses the duration; minimize/close can release the service. ShotTimerDisplayTest covers visible, minimized and non-floating acknowledged states. Signed release 1.91/code 113 passed native tests and APK verification; handset confirmation remains outstanding.

## Timer default floating and measured digits — 1.90

Owner confirmed that the disappearing timer had not started, then requested automatic floating and removal of the Float button. ShotTimerDisplay now keeps a visible ready timer's service alive when overlay permission is granted. ShotTimer ignores the legacy opt-in flag, explains permission once, and starts the service on return from Settings; minimize/close still remove the window. Screenshot 7180 showed a clipped colon: ShotTimerCard now measures the actual monospace glyphs and font height, fits the entire countdown to available width, and uses matching animation travel. Never restore the narrow 12dp colon cell. Native timer state/display/layout tests and signed build passed. Handset appearance/background lifecycle still require device confirmation. Release 1.90/code 112 contains these changes.

## Unsharpness calculator — 1.89

Read docs/UNSHARPNESS.md before editing geometric unsharpness. Keep measurement units separate from published code-table basis. Preserve B31.1's 2.0 mm versus Section I's 1.8 mm override; CSA checks SFD >= 7d (10d preferred), not an invented Ug limit. Film-only VIII guidance must not be extended to CR. Module assets are injected by MainActivity and tests/load-app.mjs. npm test includes the unsharpness suites via pretest.

## Shot timer — 1.88

ShotTimerState/Store, ShotTimer, ShotTimerService, ShotTimerAlarmReceiver and ShotTimerCard implement one native countdown. The owner authorized the bounded `shottime://timer/prepare` route from a main-WebView user gesture; preserve native parameter validation and do not add a general JS bridge. Timer snapshots use the exact displayed rounded value, independent of later calculator changes. Preserve elapsedRealtime deadlines, exact alarm tokens, foreground notification controls and optional overlay permission. Read docs/SHOT-TIMER-1.88.md. New tests: tests/ShotTimerStateTest.java and npm run test:timer. Version 1.88/code 110 supersedes historical build versions below. CR estimates remain analysis only.



Instructions for coding agents (Codex and others) working in this repository. Read this first, then `HANDOVER.md` for the current state and open work. `START-HERE.md` and `REVIEW-BRIEF.md` describe the earlier 1.19.1 code review; that review is finished.



## External chart references

Owner authorized chart links. MainActivity may open only the four exact HTTPS destinations in ChartLinks.java, on a main-frame user gesture, in an external browser. Keep WebView network blocking and CSP. This supersedes older navigation restrictions for these links only. See docs/CODE-CALCULATOR-REPAIRS.md.

## Unreleased calculator repairs

Read docs/CODE-CALCULATOR-REPAIRS.md before changing the code calculator. B31.1 now has dedicated 2012 calculations with separate sourced IQI and A-250 references; prior workbook-gap descriptions below are historical. PW-35 and A-250 reference cards are implemented. Packaged in test.51 (versionCode 94).

## Unreleased after 1.77: client labels and Back

Notes schema 6 adds job.startDate. Migrate schema 5 through notes-jobs.fromLegacy; retain client name in the existing name property. Job buttons show client, LSD and start date. closeTopSheet delegates to ShotNotesUI.back after dismissing overlays, then returns other sections (including the jobs root) to Shot Time Calc; it consumes navigation failures to avoid exiting with unsaved work or active recording.

## 1.77 QC jobs and daily lists

Notes schema 5 adds parent jobs and selectedJobId. notes-jobs.js owns job-wide XF/MT counters; all linked-list mutations must prepare and commit through it. Linked Undo and deletions never lower consumed counters. Preserve stable native voice list IDs, pending drafts, replay markers and job/list selection. Legacy schema 1-4 lists migrate into separate jobs. Job format changes update compatible undo snapshots; required-field defaults affect future daily lists only. Read docs/superpowers/specs/2026-10-06-qc-jobs-daily-lists-design.md.

## Unreleased duplicate CN confirmation

notes-jobs.duplicateCNs compares new/changed CN entries across a job. notes-ui gates replaceList with a confirmation dialog; voice reconcile accepts a checkAddition callback that holds duplicate entries pending before allocating numbers. Preserve duplicateCN pending flags, edited review fields, replay IDs and cancellation without counter consumption. No schema bump: duplicateCN is optional pending-item metadata.

## Unreleased after 1.81: entry screen cleanup

The main list editor no longer renders Type an instruction, Undo last change, or Daily lists. Keep voice-review correction fields and inline Undo. CSV spacing is per-list under Settings > CSV export. Test helpers enter instructions via a pending voice-review correction; Back uses closeTopSheet. Preserve saved drafts and native voice behavior.

## Current state (1.82) — read first



Later sections of this file record how the app grew; where they conflict, this section and the dated sections below win.



- Test.48 replaces CSA sour workbook calculations with verified Z662:23 March 2024 reference rules. Root IP/IF restrictions must never inherit sweet limits; distinguish top IF. CSA IQI applies to both profiles. B31.1 remains explicitly 2012 pending newer source verification.
- Test.47 adds the fourth-menu Code Calculator. Read docs/CODE-CALCULATOR-REVIEW.md before changing criteria. Preserve explicit edition/scope labels, metric basis and unavailable results; never convert missing cells to zero or silently mix legacy/current rules.
- Test.25 supports seven approved modifiers and inline Undo confirmations. All-welders CN changes include XF+MT atomically. Moves/edits preserve numbering; never silently change current context.
- Test.24 adds bounded natural voice variations and last-weld/last-MT operations. Pass current mtRows as parser fifth argument; preserve explicit same-spool CN with optional fields and replay protection.
- Test.21 canonical Note Taker schedule is XH: accept XS/extra heavy/extra strong, normalize legacy rows/history on load and exports. Do not rename WIDs or calculator schedule keys.
- Test.19 adds a remembered hold/continuous mode switch. Preserve document-level release handling across UI rerenders and native cancellation of pending starts on hold release/Activity pause.
- Test.17 uses notes schema 4: per-list XF/MT required fields; migrate lists and undo snapshots with fieldRequirements:null for legacy behavior. New UI lists store explicit defaults. Optional omissions stay blank in configured jobs; XF/MT numbering and quantity remain mandatory. Full npm test runs 16 suites.
- Test.13 stores WID on each MT row; notes schema 3 migrates older MT rows and undo snapshots with blank WIDs. CSV MT columns: CN#, MT#, WID, Size, Schedule/Description. Preserve separate schedule/type fields internally.
- Test.11 restores the shorter pre-MT Whisper hint for a recognition trial and handles welder-after-MT/missing weld-group punctuation. Do not claim that this fixes CN recognition until the owner tests it. Never guess malformed CN IDs.
- Test.10 adds CN-linked MT notes, separate numbering, and a right-hand CSV table. Notes schema is 2; migrate schema 1 with MT defaults in every undo snapshot. Never change XF numbering when adding MT fittings. Missing MT schedule means blank.
- Test.9 adds portable and FP16/dot-product ARM64 speech libraries, selected by NativeVoice CPU capability checks. Keep both libraries packaged. See the latest HANDOVER section.

- Use the owner-authorized replacement signing key in signing/; backup locations are recorded in ../../RT-HELPER-SIGNING-LOCATION.md. Preserve it after builds. Never regenerate it for routine releases.

- Signing identity (replacement key created 2026-09-30, used for test.14 onward; owner-confirmed 2026-10-01 that the original ShotTime key was lost): alias `shottime`, CN=RT Helper Personal App, certificate SHA-256 `af4e70b2acec7b614fceec08bb354d00f9eb067ee5780b2a713b2ea654f0310c`. Every release must be signed with this key; builds signed with the old `724ecdf9…` key cannot be updated by it, or vice versa.
- Display name RT Handbook; package and storage keys unchanged. Two sections: Shot Time Calc and Note Taker.

- Network and page-to-native rules: the page may navigate only to `shottime://print`, `shottime://share-csv`, `shottime://voice/start|stop|settings`. INTERNET is used only by `CloudClient` for fixed HTTPS OpenAI endpoints, only in Auto/Cloud voice modes with a user-entered key (Phone only is the default). The print WebView keeps JavaScript disabled; keep the CSP.

- Tests: ten JS/browser suites via `npm test`, plus `tests/VoiceBackendTest.java` and `tests/AudioSegmenterTest.java`.

- Build: run `build-voice.sh` (or `.ps1`) first; `build-review.sh` then expects `versionCode='104' versionName='1.82'` and `targetSdkVersion:'36'`.

- Voice: whisper.cpp v1.9.4 small.en q5_1 plus Silero VAD v6.2.0 (checksums in docs/WHISPER-TEST.md). Keep the VAD fallback to loudness, the full encoder window by default, and the parser rule that only whole-ID letter names/NATO words are converted.

- Notes storage shares the WebView's ~5 million character localStorage with the calculator: keep undo history bounded (`trimHistory`) and do not store unbounded data per list.



## What this is



Offline Android app (package `ca.kylekeith.shottime`) that calculates Ir-192 exposure ("shot") times for double-wall carbon-steel pipe film radiography. It is a single-Activity native wrapper around one WebView page.



- `assets/index.html` — the whole UI and app logic (inline CSS and JS). At runtime `MainActivity` substitutes `/*__TECHNIQUES__*/` with `techniques.json` and `/*__CALCULATOR__*/` with `calculator.js`.

- `assets/calculator.js` — pure calculation module: the shared Ir-192 exposure model (reference shots, steel half-value thickness, small/large film ratios), parsing, rounding labels, decay. Also loadable from Node.

- `assets/techniques.json` — 114 pipe geometry rows (size, schedule, wall, SFD, group; NPS 1–24, ASME B36.10M walls; 14"/16" XXH 1.000" is the owner's non-standard entry) plus film names and groups. Geometry only since 1.21.0; regenerate with `scripts/generate-films.py`, which holds the added sizes and Sch 10 walls.

- `scripts/original-techniques.json` — the pre-1.21 per-film Ci·s baseline, kept only for comparison tests.

- `src/ca/kylekeith/shottime/MainActivity.java` — WebView host, window insets, Back handling, native print flow.

- `AndroidManifest.xml`, `res/` — manifest, theme, icon.

- `tests/` — three active suites. `tests/legacy/` is archived and not runnable; ignore it.

- `release/ShotTime-v1.19.1.apk` — the last signed release (versionCode 40), kept for reference only.



## Hard rules



- **Do not change calculation assumptions or numbers** without the owner's explicit approval. The model (1.21.0): Ci·s = reference Ci·s × (SFD ÷ reference SFD)² × 2^((total steel − reference steel) ÷ 12.1 mm). Large films (D5, T200, IX80) use calculator targets on 4" STD at 26 Ci; small films (D4, MX125, IX50) = partner × published ratio (2.0, 1.65, 1.83) at the same geometry and every density, so partners share a hanger at any target. Carestream CR (`cr`, both belts) is the exception: it uses the owner's chart values in `CHART_EXPOSURES.cr` exactly (56 rows, `null` elsewhere, shown as —), the same at every density, with Internal ÷ 8 and Internal offset ÷ 3 rounded up. Rows over 90 mm total steel (`MAX_STEEL_MM`) are hidden because they lie beyond the Agfa chart. `exposureAtDensity` interpolates the film curve log-linearly between the five target densities (used by the helper's measured density). Also fixed: SFD rule, rounding rules (time nearest second; Internal = unrounded ÷ 9 nearest second; Internal offset = unrounded ÷ 3.2 rounded to the nearest second; internal columns only for 6" and larger), 73.83-day half-life. `tests/test-current-calculator.cjs` pins all of this. The owner plans test shots; measured ratios or reference times may later replace the published ones.

- **Signing:** never generate, request, commit or redistribute a signing key or password. `build.sh` needs the owner's private `signing/` backup, which is intentionally absent. Keep the package name and signing identity unchanged. Use `build-review.sh` (unsigned) to check compilation.

- **No network, tracking or JS-to-native bridge.** The only page-to-native channel is navigation to `shottime://print`. The print WebView runs with JavaScript disabled. Keep the CSP in `index.html`.

- **Do not reintroduce** the removed "Starting estimates" banner, the Detailed view, or extra print columns (film, wall, SFD, notes, footer). The print sheet shows activity, target density and local date above a Pipe / Schedule / Time / Internal / Internal offset table.

- **Settings storage:** filters saved as `null` mean all options; one localStorage record `shottime.settings` with `schemaVersion: 2` (version 1 migrates by resetting film-wide and size/schedule factors and the draft). Keys: `factor.<density>.<film>`, `weld.<density>.<film>.<size>.<schedule>` (density-free `factor.cr` and `weld.cr.<size>.<schedule>` for CR), `film.small|large`, `filter.pipe|schedule`, `density`, `source`, `printSize`, `draft`. If you change the storage shape after release, bump `SCHEMA_VERSION` and write an explicit, tested migration; do not silently drop saved factors.

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



- `node tests/test-current-calculator.cjs` — geometry (SFD rule, B36.10M walls), shared steel model across all 1,710 combinations, 30 reference targets, published film ratios, the 56-row CR chart and internal rules, Agfa shape check, parsing, rounding, date validation.

- `CHROME_BINARY=/path/to/chrome node tests/test-current-ui.mjs` — UI: six films × five densities, Carestream CR, corrections, calibration helper, save failure, persistence, narrow layouts, screen/print equality, printed date, screen-reader labels.

- `CHROME_BINARY=/path/to/chrome node tests/test-settings-storage.mjs` — storage schema, per-density keys, range checks, resets, draft restoration, helper pre-fill, decay-mode behaviour, displayed factors.



The tests load `index.html` with the same substitutions `MainActivity` does, on a routed `https://shottime.local/` origin; no server is needed. When you fix a bug, add an assertion that fails on the old code.



## Android build



Requires JDK 17+ (21 works), Python 3, Bash, and an Android SDK with **platform android-36** and **build-tools 36.0.0**. No Gradle.



```sh

SDK_ROOT=/path/to/android-sdk bash build-review.sh   # unsigned: dist/ShotTime-review-unsigned.apk

```



Expected output includes `versionCode='43' versionName='1.21.1'` and `targetSdkVersion:'36'`. The `-source 8` obsolete-option warnings and four deprecation warnings (`setDecorFitsSystemWindows`, `setStatusBarColor`, `setNavigationBarColor`, `setSystemUiVisibility`, all on intentionally version-guarded paths) are known. `build/` and `dist/` are git-ignored.



Browser tests do not exercise `MainActivity.java`. Native behaviour (printing, Back, insets, rotation, TalkBack) needs a device or an emulator with hardware acceleration.



## Code style



- Match the existing dense style in `index.html`: compact single-line functions, `$()` for `getElementById`, `C` for `ShotCalculator`, `CHART` for the data. Keep comments sparse and explain *why*.

- Java targets `-source 8` with lambdas; guard APIs above 26 with `Build.VERSION.SDK_INT`, and put API 33+ types in a nested class (see `BackApi33`) so older Android never loads them.

- Keep changes minimal and focused; update the current version's section in `README.md` when behaviour changes.



## Note Taker local stage (unreleased)



The four `assets/notes-*.js` modules implement the separate notes model, typed parser, storage/export and interface. `MainActivity` injects them with trusted asset placeholders; `tests/load-app.mjs` mirrors these substitutions. Notes use `shottime.notes` schema 1; calculator storage stays schema 2. Run all seven suites with `npm test`, or `npm run test:notes` for the four notes suites. Voice and cloud sync are not implemented. See `docs/superpowers/note-taker-verification.md` for review results and unverified device behavior.

# Offline voice follow-up — 1.22.0-test.2



The owner explicitly requested voice recording and selected offline Whisper with direct implementation. This authorizes the narrow trusted-page navigation commands `shottime://voice/start` and `/stop` and native JSON status callbacks, superseding the earlier no-bridge restriction for voice only. No Internet permission, cloud account or network request is added. Native `VoiceService` records with a foreground notification; `WhisperEngine` calls the bundled ARM64 JNI runtime. `notes-voice.js` assembles complete pipe commands and keeps transcript replay idempotent. Signing test APKs with the owner's supplied backup was explicitly authorized; never expose or commit its credentials.



Run all nine JS/browser suites with `npm test`. Compile/run `tests/AudioSegmenterTest.java` with `AudioSegmenter.java` for PCM boundary checks. Build Whisper first (`build-voice.ps1` on Windows; NDK 28.2.13676358 and SDK CMake 3.22.1), then `build-review.ps1`. Model/native source hashes and device acceptance checklist are in `docs/WHISPER-TEST.md`. Do not claim browser tests validate actual transcription, handset Bluetooth routing, or screen-lock operation.



### 1.22.0-test.4 CSV sharing



The owner requested CSV file sharing, authorizing the trusted shottime://share-csv navigation and a non-exported, read-only CsvProvider with temporary per-file URI grants. No storage or Internet permission added.



### Cloud fallback — 1.22.0-test.6



The user explicitly authorized cloud voice with automatic phone fallback and approved-correction memory. This supersedes the old no-network restriction only for fixed HTTPS OpenAI endpoints in CloudClient. Credentials stay in Android Keystore-encrypted native settings, never WebView/localStorage. Phone-only remains the default. Approved examples have their own versioned localStorage key; notes/calculator schemas are unchanged. No paid request without an in-app key configured by the user. No claims of automatic model-weight training.



## 1.22.0-test.27 — owner-approved MX125/T200 baseline

On 2026-10-02 the owner explicitly requested multiplying the current MX125 and T200 baselines by 1.2 and making that the default. T200 reference exposure times increase by 20% at all five densities; MX125 inherits that increase exactly once through the existing partner ratio. Calibration factors stay separately editable, default to 1.00 and retain saved values. Resetting factors returns to the increased baseline. No other film, CR chart, geometry, decay or notes behavior changes. This supersedes the earlier T200 reference targets in this document.


## 1.22.0-test.28 — CN letter suffixes

Support numeric CN identities with attached letter suffixes such as CN-332A and CN-332B. Keep them separate for XF/MT, voice assembly, modifiers and CSV. Explicit spaced suffixes before has/end/WID and NATO suffixes (332 alpha/bravo) normalize to uppercase. Preserve quantity-a syntax. CN padding applies to the numeric portion; reformatting preserves suffixes. Existing numeric cnNumber metadata stays numeric; suffixed IDs use the existing full cn string and null cnNumber, so schema 4 remains compatible. Tests cover parsing, voice, replay, edits/undo, formats, storage and CSV. Malformed/conflicting CNs still require review.


## 1.22.0-test.29 — CSV column order and plain sizes

Settings > Export columns offers separate XF/MT Up/Down controls, header previews, Save, Cancel and Reset. Order is remembered for all lists on this phone in shottime.csvColumns.v1; malformed preferences fall back to defaults. All columns remain included, XF and MT stay side by side with a blank separator, and row order/numbering do not change. CSV sizes have no inch mark (2, 1 1/2, or blank); TSV behavior unchanged. Save errors keep the dialog open without applying unsaved choices. Notes schema/native code unchanged.


## 1.22.0-test.38 — structured clarification

Pending additions now open field-based review: separate XF/MT groups with CN, quantity, size, schedule, WID and MT type. Recognized values are prefilled; required missing/invalid fields get amber highlighting and text explanations. Optional omissions stay optional. Unaccounted words require per-group transcript confirmation; malformed explicit CN does not inherit prior CN. Group add/remove/type selection and persisted field drafts support mixed instructions. Confirm and add validates all groups then applies one atomic undo group using the original segment ID; replay remains suppressed. Show transcript preserves original speech. Edit wording instead retains the original text/approved-example flow, and is the fallback for modification commands. New optional pending-item fields do not change schema 4; existing saved lists remain compatible. No speech-model confidence is claimed.


## 1.22.0-test.38 — Review fixes

Addresses all eight findings in docs/REVIEW-test33.md. Structured review uses strict per-spool parsing before partial extraction, reserves schedule/fitting tokens from bare-WID extraction, shares counting-aloud normalization, and carries the latest explicit context. Deferred confirmation regressions cover optional/required/legacy fields, numbering, undo and replay. Existing saved field drafts and rows remain unchanged to preserve user edits; prior incorrect records require manual correction.

Calibration proposals invalidate on dependent row-factor save/reset. Only schema1 migration expands historical full filter arrays; explicit schema2 exclusions persist. Baseline explanatory copy matches the approved T200/MX125 values. Restored CR helper drafts refresh density visibility. VoiceJournal persists a new-session candidate before publishing it, preserving previous state on failed start; fault-injection tests cover first/partial failures and retry.

## Unreleased after 1.82: CN search and bulk changes

notes-jobs.searchCNs supplies job-wide CN/list groups. notes-jobs.bulkCNs creates one candidate library for selected groups; notes-ui previews then saves the entire candidate before replacing live state. Both XF and MT share Keep existing numbers / Renumber continuously. Explicit bulk renumber is the owner-authorized exception to monotonic job counters: compact source job from configured starts; cross-job moved rows use destination next counters. Keep mode rejects collisions/below-start numbers. Clear affected jobs' undo snapshots to prevent resurrection, preserve processedSegments and voice IDs, and block pending/draft/recording changes. Do not route bulk transactions through per-list replaceList or mutate. Stale previews and failed saves must leave the live library unchanged. Schema remains 6.

Daily-list multi-selection now starts with press-and-hold on a CN card. Checkboxes/bulk controls appear only in selection mode; Cancel selection or Back exits it. Search-result checkboxes remain directly available. Keep gesture cancellation on scroll, movement, pointercancel, blur and rerender; do not interfere with hold-to-speak or normal card taps.

## Audit repairs after 1.82 - schema 7

Notes library schema is now 7. Migrate schema 6 through notes-jobs.fromLegacy; source CN format is retained only where independent numeric identity is unavailable, including undo snapshots, so future-only changes preserve suffix identities without expanding normal numeric rows. Do not infer Undo from shrinking history: duplicateCNs takes an explicit undo option from known Undo call sites. Offline long pieces use bounded pending chunks and replay markers.

Voice acknowledgement must prove durable transcript storage, not merely that a list exists. Keep recovery failures latched across unrelated saves/navigation; retry reconciliation and expose recovery exports. selectScreen and native Back enforce canLeave independently of current screen. Search close clears its selection scope; bulk previews enumerate CN/date identities. Retained drafts must remain reviewable/discardable. VoiceJournal must call AtomicFile.readFully before an absence decision and preserve recovery files on read/parse/write failures.


## Unreleased after 1.82 - Notes backup files and restore

Settings offers Save backup file and Restore backup through Android's document picker. Save writes a timestamped UTF-8 JSON file to the chosen location. Restore validates through existing schema migrations, previews job/list/XF/MT counts, and requires Replace all jobs and lists confirmation. Cancellation, invalid files, stale previews and failed writes leave the library untouched. Native reads are limited to 20 MB; file I/O runs off the UI thread. Only exact user-gesture shottime://backup/save and shottime://backup/restore routes were added, without storage permissions or a JavascriptInterface.

The version-1 rt-handbook-notes envelope includes the complete notes library: jobs, lists, numbering, formats, pending review, drafts and saved transcript/history data. Earlier plain notes JSON is also accepted and migrated. Calculator settings, cloud credentials, learned wording and microphone preferences are excluded. Copy recovery data remains available; damaged raw data and voice-recovery wrappers are not valid restore files.

Restore saves the candidate before publishing it. Existing deletedLists tombstones reserve voice-session:<id> to acknowledge the completed native session during restore, preventing its separate journal from replaying into older restored data. Markers remain bounded and survive reload. Active/unrecovered voice sessions block restore.

New tests: test-notes-backup.cjs and test-backup-ui.mjs cover round trips, migration, malformed/future/oversized input, cancel, quota retry, stale previews, recording and replay suppression across reload. No new signed release, upload or handset test.


## 1.83 release - 2026-10-07

Built and signed RT-Handbook-v1.83.apk (version code 105) with the existing release key. Includes CN search/bulk actions, audit repairs and backup/restore. Signature, 16 KB alignment, manifest and packaged source assets verified. Uploaded to Google Drive My Drive; upload completion confirmed. Verification: dist/BUILD-VERIFICATION-1.83.md. No download link fetched or handset installation performed.


## 1.84 release - 2026-10-07

Built, signed and uploaded RT-Handbook-v1.84.apk (version code 106) to Google Drive My Drive. Includes permanent app-themed offline charts with zoom/reset and no original-view switch. Signature, alignment, manifest and asset equality verified. See dist/BUILD-VERIFICATION-1.84.md. No download link fetched or handset installation performed.


## 1.85 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.85.apk (version code 107) to Google Drive My Drive. Includes 17 higher-resolution PDF-sourced charts. Section IX retains its supplied screenshot. Signature, alignment, manifest and packaged asset equality verified; see dist/BUILD-VERIFICATION-1.85.md. No download link fetched or handset installation performed.


## All offline charts use vectors - unreleased after 1.85

Converted the remaining 17 Appendix 4, A-250 and CSA figures to inline SVG, alongside Section IX. All current offline chart selections now display original vector paths and outlined captions with app colours; no active chart uses a raster image. Original PDF path data and transforms are asserted unchanged during extraction. Existing crop windows, rotated boiler schematics, thickness bands, zoom/reset and calculator rules remain.

Reproduce with scripts/extract-code-vectors.py using the recorded local source PDFs and PyMuPDF; then scripts/extract-ix-vector.py for Section IX. docs/code-chart-vector-manifest.json records sources, geometry-preservation assertions and output hashes; standalone SVGs are in assets/code-chart-vectors. The older PNG renderer remains a historical fallback and should not overwrite the current vector assets for releases. Legacy screenshot entries remain inactive fallbacks.

Chart asset checks and calculator unit/browser tests pass, including mobile widths, rotation, inline path rendering, zoom/reset and source preservation. No release bump, signing or upload.


Release 1.86 (versionCode 108), 2026-10-08: Built, signed with the existing certificate, and uploaded dist/RT-Handbook-v1.86.apk to Google Drive My Drive. Drive displayed 1 upload complete for the exact APK filename. All offline chart families now use original vector artwork. Signature, alignment, release consistency, chart assets, and packaged-source equality checks passed. APK SHA256: fb65ebd5f7ed258bb684e905da046539b0057fd2fdcf0c1a0ec2951ea4726e3c. Verification: dist/BUILD-VERIFICATION-1.86.md. No download link fetched.


## Film internal offset - unreleased after 1.86

Owner requested film Internal offset = unrounded shot time / 3.2, rounded to the nearest second (half seconds round up), replacing the old x1.15 /4 formula. Carestream CR remains /3, rounded up. Normal Internal remains /9 for films and /8 for CR; the 6-inch minimum and screen/print shared calculation remain. Updated calculation details and current documentation. Calculator regression tests cover all six films, exact and fractional boundaries, zero, and unchanged CR. Calculator, current UI (including screen/print equality), and consistency tests passed. No APK built or uploaded for this change.


## 1.87 release - 2026-10-08

Built, signed and uploaded RT-Handbook-v1.87.apk (versionCode 109) to Google Drive My Drive. Film internal offsets now use unrounded shot time / 3.2, rounded to the nearest second; CR remains /3 rounded up. Existing release signature, alignment, manifest and asset equality verified. SHA256: 9a42e534d6ea43f51394f054b8e872809e82e5b9e076dd1b3ed6e84433d09f54. See dist/BUILD-VERIFICATION-1.87.md. Drive confirmed completion. No download link fetched or handset installation performed.

