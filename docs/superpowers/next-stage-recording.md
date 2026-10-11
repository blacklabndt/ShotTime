# Next stage: Android recording and transcription

Research date: 2026-09-30. This is preparation for the next implementation plan, not a completed feature.

## Native capture

Use a microphone foreground service started from a visible tap, with Stop in its ongoing notification. Declare the service type and required permissions; request runtime microphone permission before starting. Android restricts starting microphone foreground services from the background. Test locking the phone only after visible user initiation. Sources: [service declarations](https://developer.android.com/develop/background-work/services/fgs/declare), [background start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

Keep capture and session state outside the WebView lifecycle. Add recording/capture tests for Activity recreation, app backgrounding, denial, route loss, interruptions and stop/restart. Java build scripts must compile any added classes, not just MainActivity.java.

For API 31+, investigate AudioManager.getAvailableCommunicationDevices and setCommunicationDevice. The platform selects the matching input; observe the actual route, handle rejection and clear selection on stop. Legacy API paths need separate guards. Source: [AudioManager](https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)).

## Transcription and ordering

OpenAI's current realtime transcription documentation describes a transcription-only streaming session, incremental and completed events, and context keywords. Completion events from separate turns can arrive out of order. Preserve input ordering with item IDs before allocating XF numbers. Candidate model/service selection still requires actual sample evaluation and account configuration. Source: [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

Do not equate a transcription item boundary with a complete pipe batch. A trailing welder can arrive in the next item; buffer/resolve the sentence before creating permanent rows. Use model.applyGroup with stable provider-session/item IDs for completed, ordered operations. Interim text remains display-only. An ambiguous batch blocks later number allocation while retaining later text.

Keep provider credentials in an authenticated backend, never in this APK. A server-issued temporary credential is an available connection pattern; verify native transport/library requirements before choosing WebRTC or WebSocket. Source: [Realtime WebRTC connection and temporary credentials](https://developers.openai.com/api/docs/guides/voice-webrtc).

## Required before integrated voice delivery

- Choose hosting, identity and transcription account using owner-accessible services; no subscriptions or deployment have been created.
- Obtain SDK/JDK toolchain and compile unsigned builds.
- Record a consented test corpus on the actual Galaxy S26 Ultra: bunker noise, DD/RG/O/X/TS/W-24, fractional sizes, multiple CNs, trailing welders, corrections and pauses.
- Measure exact row/identifier accuracy, missed/duplicated batches and finalization latency.
- Verify headset disconnect and locked-screen capture on the phone; browser tests cannot establish either.
- Design bounded audio retention/retry and disclose what is sent to the provider.
