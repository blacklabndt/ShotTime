# Native and calculator audit — 2026-10-07

Read-only deep review of the Android host, voice backend, JNI wrapper, packaging scripts and calculator implementation. No product source was changed. Three actionable findings: two BLOCKERs and one WARNING.

## P1 / BLOCKER — IQI band changes for equivalent thickness inputs

**File:** `C:/Users/troll/OneDrive/Documents/ChatGPT/QC Note Taker app/claude-test15/ShotTime/assets/code-calculator.js:200` (lookup at lines 50–54).

`calculate()` normalizes wall and reinforcement individually to 12 significant digits, but adds them without normalizing the sum. Floating-point addition can place an exact inclusive table boundary just above that boundary. The lookup consequently returns the next, thicker-material wire band. The UI formats away the tiny excess, so the displayed selection thickness does not explain the incorrect wire.

**Executed reproduction:**

```js
const C = require('./assets/code-calculator.js');
const run = (thickness, reinforcement) => C.calculate({
  id: 'b313-normal', unit: 'mm', thickness, reinforcement
}).iqi;
run('12.4', '0.3');
// { source: 8, film: 7, basis: 12.700000000000001 }
run('12.2', '0.5');
// { source: 7, film: 6, basis: 12.7 }
C.asmeIqi(12.7);
// { source: 7, film: 6, basis: 12.7 }
```

Also reproduced for `25.1 + 0.3` and `50.6 + 0.2`. This is an inconsistency against the repository's own approved lookup, not a new interpretation of an external standard.

**Fix:** Normalize the completed selection-thickness arithmetic using the same precision policy before lookup; do not broadly loosen the boundary enough to accept genuinely greater thickness. Add tests for equivalent decimal decompositions at every inclusive boundary in both units, including a value genuinely above each boundary.

## P1 / BLOCKER — Recovery skips an AtomicFile backup when the base file is absent

**File:** `C:/Users/troll/OneDrive/Documents/ChatGPT/QC Note Taker app/claude-test15/ShotTime/src/ca/kylekeith/shottime/VoiceJournal.java:18`.

The early `getBaseFile().exists()` test returns an empty session without calling `AtomicFile.readFully()`. Android 8 is supported (`minSdkVersion=26`). Its AtomicFile implementation renames the existing base to `.bak` before opening the new base during a write; an interrupted process can therefore leave only a valid backup. `openRead()` is responsible for restoring this backup, but the application bypasses it. The UI sees no recoverable session. A subsequent successful session write can discard that previous transcript backup.

**Evidence:** The [AOSP Android 8 AtomicFile implementation](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-8.0.0_r1/core/java/android/util/AtomicFile.java) has the rename at lines 84–98, restoration at lines 185–190, and backup deletion on successful completion at lines 122–128.

**Executed reproduction:** `build/audit-native-BackupProbe.java` creates a valid `voice-session.json.bak` with no base, then calls the real `VoiceJournal.snapshot()` with the repository JVM stubs. Output:

```text
Existing backup bytes: 74
Recovery snapshot: {}
```

The stub cannot parse/recover existing JSON; this probe intentionally demonstrates the early return before either function is reached. Android's actual recovery behavior is established by the platform source. No handset crash-injection test was performed.

**Fix:** Attempt the atomic read before deciding the journal is absent. Treat absence separately from read failure and malformed JSON; never replace a recovery candidate without successfully preserving it. Add a restart/recovery test for `.bak`-only state using a platform-faithful AtomicFile double (the current write-only journal test does not cover loading).

## P2 / WARNING — Documented shell release build silently uses an obsolete artifact name

**File:** `C:/Users/troll/OneDrive/Documents/ChatGPT/QC Note Taker app/claude-test15/ShotTime/build.sh:12–15`.

The signed output is hardcoded to `dist/ShotTime-v1.22.0-test.43.apk`, while the current manifest is version 1.82/code 104. README line 101 still directs developers to this script. Running that documented release path builds current code under an old version's filename and can overwrite an existing artifact with that name, making selection/distribution of releases unreliable.

**Reproduction:** Static command trace: `build-review.sh` reads the current manifest; `build.sh` signs its output directly to the literal old filename on line 12 and verifies that same path. No signing command was run during this review. The current Windows release workflow uses an explicit correctly named signing output; that workflow is not implicated.

**Fix:** Derive the filename from the manifest version (or require an explicit release output argument), use that single variable consistently, and reject an unexpected existing release artifact unless replacement is intentional.

## Cross-review evidence supplied to orchestrator

- Native voice has no 20,000-character aggregate transcript limit: `VoiceJournal.append()` caps only event count at 2,000; `VoiceService` caps recording at 30 minutes. `CloudClient` bounds individual transcription text, and rejects oversized aggregate interpretation after recording; phone transcription has no equivalent text cap. This supports the notes reviewer's separate long-session storage-boundary investigation.
- `MainActivity.onPause()` requests `ShotNotesUI.flush()` without checking success, and `onDestroy()` destroys the WebView. Thus a UI navigation path that bypasses notes' dirty-save guard can lose unsaved in-memory edits upon Activity exit. The UI reviewer owns the finding and reproduction.

## Coverage and limitations

Read project AGENTS and latest HANDOVER, CODE-CALCULATOR-REPAIRS and CODE-CALCULATOR-REVIEW. Reviewed all 13 Java files under `src/ca/kylekeith/shottime`, `native/whisper-jni.cpp`, `native/CMakeLists.txt`, AndroidManifest, both theme XML files, `build-review.ps1`, `build-review.sh`, `build-voice.ps1`, `build-voice.sh`, `build.sh`, `assets/calculator.js`, `assets/code-calculator.js`, `assets/code-ui.js`, and the three scripts `build-pipe-chart.py`, `generate-films.py`, `extract-code-workbook.py`. Reviewed journal test/stub behavior and relevant calculator UI test coverage. Traced CSV grants/provider resolution, navigation allowlists, WebView network restrictions, encrypted native cloud settings, fixed cloud endpoints, voice capture/queue shutdown/journal flow, model selection, chart selection and calculator input/unit handling.

The orchestrator ran the complete product tests, all six standalone Java suites, and unsigned Android compilation/packaging. Those passing checks do not cover the two reproduced boundary/recovery defects above. No device/emulator, actual microphone/Bluetooth routing, Android print service, real cloud requests, signing or upload was performed for this review. Vendored whisper code and base64 chart image pixels were not audited. No independent certification of radiographic exposure physics or governing-code numerical requirements is implied; calculator logic was checked against repository-approved behavior and internal consistency.
