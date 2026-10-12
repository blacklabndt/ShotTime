# Whisper test.2 verification — 2026-09-30

Delivered signed `dist/ShotTime-v1.22.0-test.2.apk`, versionCode 45, package `ca.kylekeith.shottime`, ARM64, min SDK 26, target 36.

- Final `npm test`: all nine suites passed (three calculator/settings, six notes/voice).
- Java `AudioSegmenterTest`: passed silence suppression, pause cuts, Stop flushing, sustained speech and partial-read boundary preservation.
- Android Java and native C++ compilation: successful. Known Java 8 obsolete/deprecated API warnings remain; no compilation errors.
- whisper.cpp v1.9.4 source and base.en weights SHA-256 matched pinned hashes. Bundled MIT notices.
- Native ELF `LOAD` segments align to `0x4000` (16 KB). Dependencies are Android system libraries only; C++ runtime is statically linked.
- Final APK zipalign `-c -P 16 4`: successful. `apksigner verify`: v2 and v3 successful, one signer. Signing certificate matches previously delivered test.1. Temporary extracted signing files removed; backup untouched.
- APK length: 139,650,350 bytes. SHA-256: `1cac834c99af63e96183f8e5b701de21b1845cfa8ce2fa6ef80d0f72527cadf8`.
- Phone-width visual check: `build/whisper-phone.png`; no horizontal overflow in UI tests. Native recording callbacks simulated for browser tests; this does not measure real speech recognition.

Independent review found reviewed-undo replay, out-of-order review resolution, and undo deleting archived speech. Fixed all three with regression coverage; reviewer confirmed no remaining important findings. Also fixed failed Bluetooth selection cleanup and singular hyphenated sizes. Partial PCM reads dropping samples at a chunk boundary and interrupted sessions auto-applying text were reproduced with failing tests and corrected.

No Android device was attached (`adb devices` empty). Actual model inference on handset audio, accuracy in the bunker, Bluetooth microphone routing, permission transitions and screen-lock behavior remain unverified. Linux build scripts updated but not run on this Windows host. See `docs/WHISPER-TEST.md` for test instructions and recovery limits.

## 1.22.0-test.3 parser follow-up

Reproduced rejection of natural batch qualifiers. Added regression tests for all/all of them, both with two welds, both conflicting with six welds, multi-size batches, and unresolved partial welder assignments. All nine npm test suites passed. Android build succeeded (versionCode 46); APK signature verified and certificate matched test.2. SHA256: 72d8a28d6b1172a6e736edf58da4e05e9f1ecd7b71c4e4edf5e421728c718a0a. No native transcription changes; the screenshot confirms recognized text, and the user confirmed all six welds belong to TS.
