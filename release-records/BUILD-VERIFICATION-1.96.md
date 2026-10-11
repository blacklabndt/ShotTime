# RT Handbook 1.96 verification — 2026-10-10

- Package: ca.kylekeith.shottime; versionName 1.96; versionCode 118; min SDK 26; target SDK 36.
- Includes the independent CR Formula option in both belts and Custom Shot: 70% of the unchanged T200 density-3 baseline at default factors. Original CR chart remains available.
- Full npm test passed before the release version bump. After the version bump, release consistency, current calculator, CR Formula unit and CR Formula browser suites passed again.
- Android compilation and packaging passed. Build log: ../build/release-1.96-build.log.
- APK v2/v3 signatures verified with the existing certificate SHA-256 af4e70b2acec7b614fceec08bb354d00f9eb067ee5780b2a713b2ea654f0310c.
- 16 KB zip alignment passed.
- All 37 packaged app assets match their current source SHA-256 hashes, including calculator.js, techniques.json and index.html.
- Verified packaged classes.dex, both Whisper native libraries, small.en q5_1 and Silero voice models. No signing credentials packaged.
- APK: RT-Handbook-v1.96.apk; 197,799,518 bytes.
- APK SHA-256: 5c39ba47b92bbc455e24e2aaf18f0bba3311fa48bbaa5cf8bb502c09978394f3.
- No handset installation or new radiographic exposure validation performed.

## Google Drive upload

Uploaded successfully through the browser on 2026-10-10. Drive showed "1 upload complete" and the APK in My Drive. Connector metadata readback verified the filename and exact size of 197,799,518 bytes. The connector did not return checksum fields, so cloud byte-for-byte equality was not independently verified. The local SHA-256 was rechecked and matches the build record above.

- Drive file: https://drive.google.com/file/d/1SUwJGjcLIdWH6HeEHoCMkumdIqPS931u/view?usp=drivesdk
- Upload screenshot: drive-upload-1.96.jpg
- File is private to the owner; no sharing permissions were changed.
- Browser automation and normal sandboxed shell commands worked in this retry. The earlier connector transfer attempt failed because of its 100 MiB limit; the browser upload handled the full APK.
