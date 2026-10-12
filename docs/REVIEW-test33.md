# RT Helper test.33 — Full code review

Reviewed 2026-10-04. Version 1.22.0-test.33, Android versionCode 76. Three parallel specialist reviewers plus primary-agent review of notes UI, CSV/storage and integration. Scope is the current claude-test15/ShotTime source used for test.33, not historical handover copies. No application code was changed and no new release was built for this review.

## Findings

Eight confirmed findings: six P2 (functional bugs to fix), two P3 (lower-priority display/documentation issues). No P0/P1 finding was established; this is not a guarantee of absence.

| ID | Priority | Finding | Location |
|---|---|---|---|
| N1 | P2 | Field review mistakes trailing XS/XH/SW for WID; SW can be saved as XF rather than MT when schedule is optional. | assets/notes-parser.js:133 |
| N2 | P2 | Counting aloud `1, 2, 3` becomes three groups totaling six welds, rather than three; optional size/schedule allows confirmation without warnings. | assets/notes-parser.js:135 |
| N3 | P2 | Multi-spool field review reuses the old context WID for later spools instead of carrying forward a newly spoken WID. | assets/notes-parser.js:127–133 |
| C1 | P2 | A calibration proposal remains saveable after its size/schedule factor changes; a displayed 30-second proposal can result in 60 seconds. | assets/index.html:210–212,220–221 |
| C2 | P2 | Legacy filter detection re-enables intentionally excluded Sch10/new pipe sizes after restart. | assets/index.html:117 |
| A1 | P2 | A failed initial recording-journal write leaves a phantom preparing session; retry stays blocked after storage recovers until the process restarts. | src/ca/kylekeith/shottime/VoiceJournal.java:36 |
| C3 | P3 | Calculator explanation lists old T200/MX125 baseline values, although calculation uses the approved increase. | assets/index.html:59 |
| C4 | P3 | Reloading a saved CR calibration-helper draft exposes irrelevant density controls. Calculation still ignores CR density. | assets/index.html:272 |

## Reproduction and recommended fixes

### N1 — Schedule/type interpreted as welder
A deferred review of `CN-1 has 2 2 inch XS` with optional XF schedule yields WID XS and blank schedule. `CN-1 has a 1 inch SW` becomes one XF instead of an MT fitting. These paths occur when deferred/cloud speech is queued for confirmation, including cloud interpretation failures. Prefer a successful strict parse before partial extraction; do not interpret known schedule/type tokens as shorthand WIDs.

### N2 — Counting aloud doubles the count
Deferred review of `CN-1 has 1, 2, 3 2 inch STD welds welded by DD` creates quantities 1, 2 and 3. The strict parser correctly yields quantity 3. Preserve counting-aloud semantics before splitting groups, and test equality of direct and reviewed additions. With required fields the extra groups instead produce unnecessary clarification.

### N3 — Wrong inherited WID
Begin with context WID ZZ. Review `CN-1 has 1 2 inch STD weld welded by DD CN-2 has 1 2 inch STD weld`, with WID required or legacy rules. Direct parsing produces DD/DD; field review saves DD/ZZ without a warning. Carry a running context across spool parts, retaining optional-field omission behavior.

### C1 — Stale calibration proposal
Review a 30-second D5 shot on 4-inch STD at 26 Ci, density 3, size/schedule factor 1. Change the same size/schedule factor to 2, then save the still-visible helper proposal. The resulting time is 60 seconds while the review promises 30. Invalidate or recompute pending proposals when dependent factors change, and revalidate dependencies at save time.

### C2 — Filter exclusion lost
Select all schedules, uncheck only 10, then reload. Schedule 10 is selected again because current settings matching the old full list are treated as legacy All. Restrict the conversion to an identifiable one-time migration.

### A1 — Failed recording start cannot recover
Inject failure into the first journal atomic write. The in-memory journal remains preparing even though the service has stopped. Restore writes; another start throws “A recording is already running.” Build/write new journal state before publishing it, or restore the previous state on failure. Test preservation of old events and successful retry.

### C3/C4 — Explanatory and restored-control issues
Update displayed T200 reference values to 16.8, 21.6, 26.4, 30.6 and 34.8 seconds and the MX125 example to 25 seconds. Refresh helper density-control visibility after restoring its film selection.

## Verification

- Full `npm test`: all 29 suites passed; log at `build/test33-full-review-tests.log`.
- Four pure Java suites passed: AudioSegmenterTest, VoiceBackendTest, NativeVoiceTest and WaitsTest.
- Focused Node reproductions validated all three notes findings through deferred reconciliation, field confirmation, saved rows and replay. Runnable reproduction included in the notes report.
- Browser probes reproduced stale calibration, lost filter exclusions and CR draft visibility.
- JVM fault injection with unchanged production VoiceJournal reproduced the recording recovery failure.
- Reviewed notes UI persistence, CSV order/spacers, recovery/export and voice interaction. No additional substantiated finding added from those paths.
- Inspected packaged test.33 assets and native/model presence. Android reviewer’s fresh source compile was blocked by sandbox SDK access; the successful signed test.33 build from the prior turn is separate evidence.

Passing existing tests does not cover the newly reproduced failures. Add regressions for these cases before fixes.

## Review boundaries

No physical exposure validation or cloud pricing/API compatibility audit. No handset/emulator execution, real microphone/Bluetooth test, actual speech-quality assessment, device printing test, or full audit of vendored whisper.cpp/ggml. No credentials were read or disclosed. Review is of first-party implementation and integration.

## Detailed reports

- [Notes parser/model/voice/learning](REVIEW-test33-notes.md)
- [Calculator/calibration/settings/print](REVIEW-test33-calculator.md)
- [Android/native/security/build](REVIEW-test33-android.md)

Recommended fix order: notes review data integrity and stale calibration first, recording recovery and saved filters next, then the two display/documentation issues. No fixes have been applied in this review.


## Resolution — test.34

All eight findings addressed in test.34; see TEST34-VERIFICATION.md for changes and validation. Original findings above are retained as the historical review. Existing rows and correction drafts are intentionally not rewritten.
