# Code Calculator test.47 verification

Verified 2026-10-05. App version 1.22.0-test.47, Android versionCode 90.

- Full `npm test` regression suite passed (including QC Notes, voice/modifier flows, calculator boundary and UI tests). Log: `build/test47-tests.log`.
- Android `build-review.ps1` succeeded. Log: `build/test47-build.log`.
- APK signature verified with the existing RT Helper key, v2 and v3 signatures. Log: `build/test47-signature.log`.
- APK passed 16 KB zip alignment verification.
- Packaged index.html, code-calculator.js, code-ui.js and code-data.json match the tested source bytes.
- Mobile layout tested at 320, 393 and 430 CSS pixels; screenshot `build/code-calculator-mobile.png` visually inspected.
- No physical phone installation or inspection acceptance validation performed.

Artifact: `dist/RT-Helper-v1.22.0-test.47.apk` (194,713,466 bytes).

SHA-256: `db78528f2652b08c3b02465bfdb0b7cd7fceff9c507db965890b029bc2eb8f00`

Google Drive upload completed and filename verified; access remains Restricted to the owner's account: https://drive.google.com/file/d/1RUQbRcmfrl0O2yVdcapsp7PffG7bqaBK/view

## Scope and limits

Code Calculator is the fourth menu entry. It supplies selected reference limits, not automatic weld acceptance. Inputs accept mm or inches; results use metric code limits with converted inch values, not US customary table limits.

B31.1 retains the 2012 workbook basis as requested. CSA sour retains the 2011 workbook basis. Updated selected clauses use B31.3 2024, CSA sweet 2023, and ASME VIII-1/I/IX 2025. CSA 2024 errata have not been checked. ASME V 2025 film IQI is a separately labeled reference; the governing procedure's edition must be confirmed. Unverified distribution charts, some surface-method requirements, and identified workbook defects are explicitly withheld or marked for manual reference. See CODE-CALCULATOR-REVIEW.md for the source and coverage audit.
