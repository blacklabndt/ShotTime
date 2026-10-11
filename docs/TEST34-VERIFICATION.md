# Test.34 verification

Version 1.22.0-test.34, code 77. All eight findings from REVIEW-test33.md addressed.

- All 29 npm suites pass, including added deferred-review and calculator/settings regressions. Log: build/test34-tests.log.
- All five Java suites pass: AudioSegmenter, VoiceBackend, NativeVoice, Waits and new VoiceJournal failure/retry harness. Journal test demonstrated failure against the original implementation and success after the fix.
- Android SDK build succeeded. Existing signing identity verified (v2/v3); 16 KB alignment check passed.
- Packaged source assets match workspace. Android bytecode changes are packaged. Native speech libraries and models remain byte-identical to test.33.
- Previously saved rows and field drafts are preserved. This update does not retroactively repair records or rewrite user corrections.
- Handset installation, real microphone and lifecycle behavior still require device testing.

APK SHA-256: 0a492e6534da81b2fa472987a2548018e6798ffa1c52e0ae6aec6dc2c4b7a077
