# Test.48 verification — 2026-10-05

CSA sour now uses selected CSA Z662:23 March 2024 clauses rather than legacy workbook formulas. Root IP/IF prohibitions are separate from top IF allowances; cumulative limits cannot override root prohibitions. Chapter 7 limits and corrected CSA IQI tables are shared with sweet service. Service scope and excluded cases remain explicit. B31.1 remains labeled 2012; see B311-SOURCE-SEARCH.md.

## Checks completed

- Focused calculator regression tests passed, including sour root/top IF distinction, cumulative caps, short welds, units, small pipe rules, missing inputs and IQI boundaries.
- Focused browser tests passed, including profile switching, correct IQI controls, rendered values and mobile widths 320/393/430 px.
- Full `npm test` passed; log: `build/test48-tests.log`.
- Android package built successfully, version 1.22.0-test.48, versionCode 91. Existing Java 8/deprecation warnings only.
- APK signature v2/v3 verified with existing certificate SHA-256 `af4e70b2acec7b614fceec08bb354d00f9eb067ee5780b2a713b2ea654f0310c`.
- 16 KB page alignment verified. Packaged calculator/UI/index assets match tested sources. No research PDF or signing secrets packaged.
- Mobile screenshot reviewed: `build/code-calculator-sour-mobile.png`.
- No physical-phone installation test performed.

## Artifact

`dist/RT-Helper-v1.22.0-test.48.apk`

194,713,466 bytes. SHA-256: `4d4eef16fd6d4ffd9a83953e4ace2559fc53139492910286b85004f8661f10e9`.

Uploaded to the user's Google Drive; upload completion and Download controls verified. Access remains Restricted (owner only): https://drive.google.com/file/d/1Jk5w2PaSlNnr0P93LGKFd1a3GMCV0gi3/view

Source provenance and calculator scope are documented in CSA-SOUR-SOURCE-REVIEW.md and CODE-CALCULATOR-REVIEW.md. The CSA reference is a third-party reproduction of the primary document, not a publisher-authenticated download.
