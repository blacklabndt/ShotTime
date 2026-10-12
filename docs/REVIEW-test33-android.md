# RT Helper 1.22.0-test.33 Android review

Date: 2026-10-04. Scope: first-party `src/`, `native/`, manifest, voice/review build scripts, native privacy and export boundaries. Read AGENTS.md and latest HANDOVER.md entries. Application code was not changed; no signing credentials or API keys were read. Vendor source was excluded from wholesale review.

## Findings

### AND-1 — P2: Roll back the journal when starting a recording cannot be saved

**Location:** `src/ca/kylekeith/shottime/VoiceJournal.java:36` (related: lines 15, 34; `VoiceService.java:46-47`).

`start()` replaces the process-wide `data` object with a new session in `preparing` state and then calls `save()`. If that write fails, for example because the device runs out of storage, the service catches the exception and stops before setting `active=true`, but does not restore the old journal object. Subsequent snapshots report the nonexistent session as preparing. Freeing storage and retrying in the same process still fails at the busy-state guard with “A recording is already running.” Stop cannot clear this state because no service is active. Closing/reopening the Activity does not reset the static journal; a process restart is required.

**Impact:** A recoverable storage failure disables voice for the rest of the process lifetime and replaces the recoverable session shown in memory with a phantom recording. The on-disk previous journal can remain intact, so this is not a claim of permanent deletion.

**Validation:** Compiled the unchanged real `VoiceJournal.java` with minimal JVM Android/JSON test doubles under ignored `build/review-test33-journal/`. Injected an `AtomicFile.startWrite()` exception on the first start; verified the subsequent snapshot still contains `state=preparing`; restored writes and verified another start throws exactly “A recording is already running.” Output:

```text
Injected initial save failure
Snapshot still reports preparing after failed start
CONFIRMED: storage restored, retry rejected: A recording is already running.
```

**Suggested fix:** Publish a newly constructed journal only after its atomic write succeeds, or restore the previous object in the failure path. Add a save-failure/retry regression that checks the old session ID/events remain available and a later start succeeds without killing the process. Apply the same transaction discipline when changing other recoverable journal state.

## Checks completed

- PASS: `AudioSegmenterTest`, `VoiceBackendTest`, `NativeVoiceTest`, `WaitsTest`, freshly compiled/run on Java 21 in `build/review-test33-android/`.
- Checked service capture/decode ordering, bounded queue rejection, Stop tail draining, interruption-safe decoder shutdown, native handle lifecycle and VAD initialization. No additional sufficiently concrete finding established.
- Checked main-frame command gating, blocked navigation/resource loading, no JavaScript interface, disabled file/content access, CSP, print JavaScript disabled, and CSV provider filename/path/read-only restrictions. No exploitable boundary violation established.
- Checked CloudClient fixed HTTPS destinations, disabled redirects, response limits, Phone-only routing, native Keystore encryption, local budget reservation and absence of raw provider errors/credentials in returned errors. This is source review, not verification of current cloud model pricing or API compatibility.
- Checked min/target SDK 26/36, version 76 / test.33, nonexported microphone service/provider, disabled backup and cleartext traffic, dual ARM64 packaging and source/model checksum checks in voice build scripts.
- Inspected `dist/RT-Helper-v1.22.0-test.33.apk` ZIP entries: both portable and fast ARM64 speech libraries and the expected small.en/Silero models are present; old base.en is absent. Packaged `assets/index.html` exactly matches the reviewed workspace file.

## Limits

- Full Android source compilation was attempted using installed Android 36 `android.jar`, but Java reported access denied reading the SDK file in this sandbox. Therefore this review does not claim a fresh successful APK/native build.
- No device/emulator execution: real microphone/Bluetooth routing, Android lifecycle callback timing, foreground-service restrictions, printing and actual transcription remain device checks.
- JNI review excludes a full audit of whisper.cpp/ggml vendor code. No signing operation was performed.
