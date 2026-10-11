# Test.11 verification

- Nine notes unit/browser suites passed after final changes.
- Exact CN-13 screenshot sentence tested through parser, model, and voice reconciliation: four XF rows, one MT row; sched/SCED/sch/schedule 160 stored as 160.
- Trailing welder and malformed CN regression coverage passed. Existing reviewer found no remaining blocker in CN/trailing-welder changes.
- APK versionCode 54, versionName 1.22.0-test.11. v2/v3 signature and 16 KB zip alignment verified; existing signing certificate retained.
- All packaged source assets match final files. Both native libraries and voice models byte-identical to test.10.
- Shorter pre-MT Whisper hint restored for a controlled trial; no phone audio or recognition accuracy verification available. No CN guessing added.
- SHA256: 8b7211785d04a8f1dc7c98310de4b6de5561b575e440e105beedab1cd70611be
