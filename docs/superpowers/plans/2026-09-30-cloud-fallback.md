# Cloud fallback and approved examples

Goal: Add Phone only / Auto / Cloud only, native encrypted credentials, bounded cloud calls, and user-approved reusable interpretation examples.
Architecture: Single serial decoder routes each PCM segment to one backend; Auto switches permanently to phone for the session after a cloud failure. Existing journal IDs remain the only commit IDs. Cloud-mode transcripts are held until Stop, then interpreted as one reviewed proposal. Phone sessions retain live assembly. Approved examples offer exact transcript/context matches for review, never silently change identifiers or model weights.

- [x] Test routing with simulated quota, timeout, missing key, and phone-only behavior before wiring network calls.
- [x] Add native settings, Android Keystore key protection and local monthly estimated-spend guard. Default remains Phone only. Settings cannot change while recording.
- [x] Implement fixed HTTPS OpenAI transcription and interpretation endpoints, bounded timeouts/output, no retries or logged credentials. Reserve estimated cost before attempts, including failed requests. Treat local estimate as a guard rather than provider billing guarantee.
- [x] Add deferred cloud-session review, raw transcript preservation and replay tests. Interrupted sessions never auto-apply proposals.
- [x] Save explicitly approved source/canonical/context examples in a separate versioned store; exact matches produce review suggestions. Allow forgetting examples. Never train on unapproved output.
- [x] Full regression tests, build/sign APK; document that live API and device failover require user's in-app key and phone test.

Constraints: calculator untouched, previous saved notes preserved, no embedded API key, no cloud use before explicit settings selection. User authorizes cloud support and native settings navigation, superseding historical no-network rule for this feature.

Verification: ten JS/browser suites passed; native VoiceBackendTest passed; build versionCode 49 compiled. Independent review found and resolved deferred fallback bypass, parseable/deferred learned-example lookup, missing approval-time rows, and long transcript persistence. Targeted voice/UI tests passed after final changes. Live API calls and real-device behavior remain unverified pending user key/device testing.
