# ShotTime offline voice — proposed stage 2 design

Date: 2026-09-30. Owner requested no transcription usage charges and previously selected direct implementation.

## Selected engine

The owner selected Whisper on 2026-09-30 after discussing Vosk accuracy and asked to try it first, continuing the earlier direct-implementation preference. Use whisper.cpp v1.9.4 and English base.en (about 148 MB) locally on the phone CPU. Bundle the model and ARM64 JNI runtime with their MIT notices; no account, Internet permission, backend or usage charge. Runtime/model hashes are pinned by build scripts. This is a first test, not a claim that base.en is the most accurate Whisper model or that it keeps up on the owner's phone.

Whisper works on buffered audio sections. Capture continuously on a separate thread; cut at pauses (about one second) and a 20-second limit. Show completed recognized text, not speculative partial words. A four-section inference queue bounds RAM; stop and warn if it fills. Test handset latency and accuracy before choosing a larger model. See `docs/WHISPER-TEST.md` for implementation details and limitations.

## Recording behavior

The existing large button starts a visible, user-initiated microphone foreground service after permission approval. The service owns the audio recorder, decoder and persistent transcript journal independently of the WebView. Android's notification shows recording with a Stop action. Stopping releases audio, route selection and wake resources. Never start automatically after reboot or process death.

Keep listening across pauses. Support the phone microphone and available Bluetooth communication devices; show the actual input and stop/alert on loss instead of silently pretending the session is still capturing. Use API guards for older phones. Physical Galaxy S26 Ultra tests must establish headset/locked-screen behavior.

Sources: https://developer.android.com/develop/background-work/services/fgs/service-types and https://developer.android.com/reference/android/media/AudioManager .

## Transcript and row safety

Show completed recognized text and the pending pipe separately. Persist completed utterances under a stable session ID with ordered sequence IDs. Native storage remains authoritative for transcript recovery while the screen is locked or the WebView is destroyed. Bind each session to one inspection list, and prevent switching its target while recording.

A speech pause does not necessarily finish a pipe entry. Buffer the current CN batch so a trailing 'welded by DD' can still attach correctly. A subsequent CN closes the preceding batch; Stop flushes the final batch. Show the pending batch while completed pipes become rows. Explicit corrections are separate buffered commands. Unknown words, ambiguous targets or quantities stay in review. Replayed native journal events must not create duplicate rows, including after restart.

Preserve raw recognized text alongside any normalized command. Normalize spoken labels such as C N, X F, standard and extra strong without inventing unknown welder IDs. Existing parser checks remain authoritative. No cloud audio upload. Do not save raw audio by default; retain transcript recovery data until explicitly cleared after rows are safely saved.

## Implementation tasks

1. Add pure session/utterance assembly tests for a trailing welder in a separate utterance, multiple CNs, replay, restart, pending ambiguity and Stop flushing. Implement the session assembler separately from the existing parser.
2. Add pinned offline runtime/model provisioning and licence notices; expand Windows/Linux packaging to compile JNI and include ARM64 native libraries. Verify required Android native-library alignment.
3. Add microphone permissions and a non-exported recording foreground service, durable transcript journal, model preparation and bounded resource lifecycle. Exercise journal/session logic with native unit checks where possible.
4. Add narrowly scoped local navigation commands and native-to-page status updates. Keep the print WebView without JavaScript and avoid exposing native functions to arbitrary remote content.
5. Replace the disabled microphone button with Start/Stop, current microphone, preparation/listening/stopped/error states and pending transcript. Add browser tests for simulated native events, blocked navigation while capturing, recovery and save failures.
6. Compile, run all existing and new tests, independently review data-loss/duplicate-row behavior, bump test version, and prepare a signed test APK using the existing signing identity.
7. Test on the owner's phone: first-start model preparation, three-pipe example, letters/numbers, long pauses, Bluetooth connect/disconnect, lock/unlock, app switching, denial and force-stop recovery. Measure accuracy instead of promising it from a clean browser test.

## Scope change from cloud design

This replaces the earlier proposed paid transcription backend with embedded recognition. Computer sync remains a separate feature. The new APK will be noticeably larger and continuous local decoding will consume phone battery. Performance and domain accuracy remain acceptance criteria, not assumptions.
