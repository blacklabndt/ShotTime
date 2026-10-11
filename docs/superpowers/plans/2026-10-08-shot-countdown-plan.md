# Shot countdown implementation

Owner approved the interaction design, compact preview, rolling digits and default alarm sound, then explicitly requested implementation and an APK build.

1. Add an immutable, elapsed-time countdown model and transition tests.
2. Persist native timer snapshots. Validate the timer's bounded main-frame URI entry point; retain the existing WebView restrictions.
3. Add a dedicated foreground service, exact completion alarm, notification actions and optional overlay permission flow.
4. Implement the compact native draggable card with rolling digits, reduced-motion handling, controls and position retention.
5. Link available shot-list values using their exact displayed rounding. Keep exposure calculations and print output unchanged.
6. Test the state model, film/CR links, missing values, mobile overflow and regressions; compile Android.
7. Bump the release version, build and sign with the existing certificate. Verify manifest, signature, alignment and bundled assets. Report handset-only checks explicitly. No upload was requested in this turn.

The native coordinator serializes actions on the main thread. The service, Activity and alarm receiver share it; views do not own timing. No delegated execution is needed.
