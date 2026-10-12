# Test.39 verification

Version 1.22.0-test.39, code 82.

Passed: consistency, review-sheet (new regression initially failed on static positioning), review-fields-ui, floating-recorder, hold-to-speak, voice-ui. Checked 320/393/600px widths, long-list review, reduced 420px keyboard viewport, focused field visibility, return from calculator after keyboard resize, confirmation, mixed groups, persistence, replay, undo and recording locks. Inspected build/review-sheet-keyboard.png.

Android build succeeded. Existing signing identity retained; APK v2/v3 signature and 16KB alignment verified. Packaged HTML and notes UI match source.

APK SHA256: E04F6F2555DC6F16332F6B3CEF9471A35CBA1FF401C0E2FF5F192B5C80FB63D3

Actual Samsung keyboard/IME behavior still needs handset verification. Browser viewport tests do not simulate the OS keyboard itself. No native, parser, data schema or calculator changes.
