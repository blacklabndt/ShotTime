# Test.30 verification

Version 1.22.0-test.30, code 73.

All 29 test suites passed. The full run reached the voice UI suite, where an obsolete queued-button expectation was updated for the new first-instruction-only form; that suite and every remaining suite then passed. No application source changed after the APK build.

New coverage: partial field extraction, missing and uncertain fields, optional requirements, multiple XF/MT groups, malformed CN handling, reload persistence, atomic confirmation and Undo, replay protection, and mobile width.

APK built successfully. Existing signing certificate verified with APK v2/v3; 16 KB alignment check passed. Packaged assets match current source. Native code and speech model match test.29. Real handset speech and touch behavior still require user testing.

APK SHA-256: c154643a9625894aec0fb66ca44379870c15e6c455ea93e7bced8c1e10291155
