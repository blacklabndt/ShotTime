# Full audit repairs - 2026-10-07

Applies the nine findings in AUDIT-FULL-2026-10-07.md to source after release 1.82. No signed release or upload is part of this change.

| Finding | Applied fix | Regression evidence |
|---|---|---|
| A1: IQI boundary | Normalize the completed wall-plus-reinforcement sum to the existing 12-significant-digit conversion precision before band selection. Tables and physical assumptions are unchanged. | Every IQI bound, equivalent decimal sums, both input units, and genuinely greater values in test-audit-data-fixes.cjs. |
| A2: backup journal | Call AtomicFile.readFully before deciding storage is absent. Publish recovered state only after any required recovery write succeeds. Read/parse/write failures preserve recovery data and block replacement. | VoiceJournalTest now covers backup-only restart, read failure/retry, interrupted-session save failure/retry and malformed data preservation. JVM doubles now support JSON loading and legacy backup restoration. |
| A3: exit bypass | Global canLeave guards screen transitions and root Back; native Back independently requires permission from the notes guard before Activity exit. | Failed-write addition, hamburger navigation, direct Back, retry, successful navigation and exit in test-audit-ui-fixes.mjs. Existing Back suites retained. |
| A4: transcript recovery | Split oversized offline pieces into bounded review items with stable IDs/base replay markers. A completed session must match a saved transcript archive; list existence alone cannot acknowledge it. Failed reconciliation remains latched across navigation/saves, offers recovery export, and Retry reruns reconciliation. | 500-event session, exact archived text, bounded pending review, replay, injected failure, Back/reopen, recording lock and successful retry. |
| A5: hidden selection | Closing search clears its selection scope. A new long-press selection starts clean. Bulk confirmation enumerates selected CNs and source list dates. | Search another list, close, select visible card, confirm deletion; unrelated list retains its rows. |
| A6: hidden draft | Nonempty standalone drafts appear as saved work with Review and confirmed Discard actions. Empty instruction fields stay removed. | Upgrade-style draft/no-pending fixture, review/submit, discard cancellation and confirmed discard. |
| A7: duplicate bypass | Remove the history-length heuristic. Only known Undo callers pass an explicit undo option; ordinary additions always run duplicate matching. | History-budget trimming for both XF and MT plus existing manual/voice duplicate and Undo suites. |
| A8: suffix identity | Schema 7 retains the original CN format for rows without independent numeric identity and their undo snapshots. Matching, later reformatting and transfers use that source format. Numeric CNs continue using existing numeric metadata without repeated format storage. | Schema 6 migration without rewriting raw data, custom suffix duplicate matching after future-only changes, later reformat and cross-job XF/MT transfer. Legacy schema and large-library storage tests retained. |
| A9: release naming | Shell release output is derived from manifest version; existing output is refused before building/signing. README documents the output. | Bash syntax check and actual early refusal for existing dist/RT-Handbook-v1.82.apk; no signing operation executed. Git Bash test used the installed Python interpreter via a python3 shim. |

## Data compatibility

Notes schema 1-6 migrates through the existing storage loader to schema 7 without changing visible CN labels or consuming XF/MT numbers. Numeric rows do not gain redundant source-format objects; the existing large-library warning fixture remains within quota. Suffix/source-format metadata is validated and retained through Undo snapshots. If an older release had already discarded an arbitrary historical prefix, it cannot be reconstructed unambiguously: that label is preserved rather than guessed, and may require manual correction. Future-only format changes made with the repaired code retain the needed information.

## Verification

- Complete `npm test`: all **56 JavaScript/browser suites passed**, including both new audit regression suites. Log: `build/audit-fixes-full-tests.log`.
- All **six Java suites passed**, including expanded journal recovery and failure-injection coverage.
- Final unsigned Android compilation and packaging passed. Log: `build/audit-fixes-android.log`.
- Bash syntax passed; manifest-based release filename and existing-artifact refusal were exercised without signing or overwriting the release.
- The first full run exposed redundant per-row format storage exceeding quota in the existing large-library fixture. Metadata was restricted to rows without independent numeric identity, the original fixture then passed unchanged, and the complete suite was rerun successfully.

## Limits

No handset/emulator, physical transcription/Bluetooth, print service, real cloud request or actual Android process-kill test was performed. The journal tests use a JVM double with the required backup/read behavior. Calibration assumptions, external standards and table values were not changed or independently certified. The Android check builds an unsigned review APK; an installable release still needs a version bump and signing.
