# RT Handbook - full code audit, 2026-10-07

> Follow-up: all nine recommendations have now been applied to the unreleased source. See [repair details and final verification](AUDIT-FIXES-2026-10-07.md). The findings below retain the original audit evidence.

## Outcome and scope

**Nine confirmed findings: four P1 and five P2.** Address the P1 issues before distributing another release. Fix hidden selection and duplicate-confirmation defects before relying on the new bulk workflows.

Three specialist subagents reviewed the current app source, with the primary agent coordinating cross-module evidence, full verification and this report. Scope: active `claude-test15/ShotTime`, manifest 1.82/code 104 plus unreleased CN search, bulk move/delete, numbering options and press-and-hold selection. Historical copies were excluded. No product source was changed, no signed release was created, and nothing was uploaded.

| ID | Priority | Finding | Source |
|---|---|---|---|
| A1 | P1 | Equivalent thickness inputs select different IQI bands at exact boundaries | `assets/code-calculator.js:200` |
| A2 | P1 | Recording recovery ignores valid backup-only journals | `src/ca/kylekeith/shottime/VoiceJournal.java:18` |
| A3 | P1 | App-menu navigation bypasses the unsaved-notes exit guard | `assets/index.html:119`, `assets/index.html:301`, `assets/notes-ui.js:382` |
| A4 | P1 | Long offline transcript fails recovery, then navigation permits its journal replacement | `assets/notes-voice.js:26`, `assets/notes-ui.js:55`, `assets/notes-ui.js:138` |
| A5 | P2 | Hidden search selections can be included in later daily-list bulk deletion | `assets/notes-ui.js:164`, `assets/notes-ui.js:261`, `assets/notes-ui.js:287` |
| A6 | P2 | Invisible old drafts block bulk actions without a resolution control | `assets/notes-ui.js:363`, `assets/notes-jobs.js:89` |
| A7 | P2 | History trimming silently bypasses duplicate-CN confirmation | `assets/notes-jobs.js:36` |
| A8 | P2 | Future-only format changes lose historical suffix CN identity | `assets/notes-jobs.js:29`, `assets/notes-jobs.js:97`, `assets/notes-model.js:27` |
| A9 | P2 | Documented shell release build uses an obsolete version filename | `build.sh:12` |

## Evidence and recommended fixes

### A1 - IQI boundary arithmetic

B31.3 normal, 12.4 mm wall plus 0.3 mm reinforcement, produces `12.700000000000001` and source wire 8 / film wire 7. Equivalent inputs 12.2 + 0.5 and the direct lookup at 12.7 produce source 7 / film 6. The UI displays 12.7, concealing the difference. Also reproduced at 25.1 + 0.3 and 50.6 + 0.2.

Normalize the completed thickness arithmetic using a defined precision policy before the inclusive lookup. Test equivalent decompositions and genuinely above-boundary values at every band in both units. This is an inconsistency against the repository's approved table, not a new interpretation of an external standard.

### A2 - Backup-only journal recovery

Supported Android 8/API 26 can leave only AtomicFile's valid `.bak` after an interrupted write. The application checks the base file and returns an empty session before calling the recovery-capable reader. A subsequent successful session can discard the backup. A focused JVM probe with a valid 74-byte backup returned `{}`; the platform behavior was checked against AOSP Android 8.

Attempt the atomic read before deciding the journal is absent. Preserve recovery candidates on failure. Add backup-only restart coverage using a platform-faithful AtomicFile double. The current JVM stubs do not implement complete read recovery; no handset crash-injection test was performed.

### A3 - Failed-save exit bypass

Force Notes storage writes to fail and add a weld. The staged row remains visible and direct Notes Back correctly blocks exit. Switch to Shot Time Calc through the menu: `closeTopSheet()` then permits exit despite a failed flush. Native `onPause()` ignores the flush result and `onDestroy()` destroys the WebView.

Apply a global save/recording guard to screen transitions and native exit, independent of the visible screen. Bring recovery into view on failure. The browser confirms the UI exit decision; native source tracing confirms the destruction path.

### A4 - Unrecovered transcript can be replaced

A stopped ordinary offline session with 500 short unrecognized events creates a 31,499-character pending item. The model limit is 20,000, so the job transaction fails before saving review or transcript archive. Native allows 2,000 events without an aggregate text limit.

The browser showed `Voice transcript needs recovery: Invalid pending instruction`, with no saved pending item/archive and a hidden recovery panel. Back to daily lists and reopening calls `persist()`, which marks the session saved merely because its list exists. Recording becomes enabled and emits `shottime://voice/start?list=one&previous=oversize&input=phone`. Native `VoiceJournal.start` accepts that previous-session acknowledgement and replaces the journal, permitting loss of the sole surviving transcript.

Split offline pending text into bounded pieces with stable replay IDs. Track durable session/segment acknowledgement rather than list existence. Show recovery and prevent journal replacement until the transcript is safely preserved. Add the complete failure-navigation-restart regression. This refines specialist DATA-03 from its initial P2 to P1; UI cross-validation supplies the additional evidence. No physical recording was overwritten during testing.

### A5 - Hidden selections enter a destructive action

From daily list one, search and check CN-2 on list two, then Close. Press and hold CN-1 on list one. There is one visible checked card but two selections. Confirming bulk deletion removes both lists' rows; the preview lists counts/ranges without revealing the hidden CN/date.

Scope selections to the search session, or clear them on exit and when starting daily-list selection. If retaining cross-list selections, show every selected CN/date with deselection controls and include those identities in the confirmation.

### A6 - Inaccessible standalone drafts

A saved nonblank `list.draft` with no pending item has no textarea or other resolution control. Bulk operations reject any affected job containing such a draft, even on another list.

Expose retained drafts for review/discard and direct the user to the blocking list. Preserve their text; do not silently erase it. Add an upgrade-style fixture from the old instruction UI.

### A7 - History trimming mistaken for Undo

Add 1,000 rows for CN-1, 1,000 for CN-2, then another CN-1. History shrinks from two snapshots to one to stay within its size budget. `duplicateCNs` treats that as Undo and returns no matches, bypassing confirmation on an ordinary addition.

Identify Undo explicitly at the transaction boundary. Check additions and CN changes regardless of history trimming; test manual, voice, XF and MT paths.

### A8 - Suffix identity tied to current formatting

Create `S:0012A`, then change only future rows to `B-`. Adding `B-12A` gets no duplicate warning for the existing CN. Moving the old row fails to adopt destination CN format; subsequently reformatting all rows throws. Suffix rows lack independent numeric-plus-suffix identity metadata.

Persist a stable identity or original row format, migrate compatibly, and use it for duplicate matching, search, formatting and moves. Preserve arbitrary manually entered identifiers.

### A9 - Alternate shell build mislabels releases

`build.sh` signs current code to literal `ShotTime-v1.22.0-test.43.apk` despite manifest 1.82/code 104. README still documents the path. It can overwrite an old artifact and mislead release selection. The Windows workflow used in this chat signs to an explicitly correct versioned filename and is not implicated.

Derive one output filename from the manifest or an explicit release argument and protect against unintended replacement.

## Verification

- Complete `npm test`: **54 JavaScript/browser suites passed**. Log: `build/full-audit-tests.log`.
- Six standalone JVM suites passed: AudioSegmenter, VoiceBackend, NativeVoice, ChartLinks, Waits and VoiceJournal. Journal tests use repository Android/JSON stubs.
- Fresh unsigned Android compilation/packaging passed after resolving a sandbox tool-launch restriction. Log: `build/full-audit-android.log`. This is a build check, not a signed release.
- Data reproductions: `node build/audit-data-repros.cjs`. These assertions establish current defects, not correct behavior.
- Isolated browser probes confirmed hidden selection, draft blocking, failed-save navigation and oversized-session acknowledgement.
- Backup probe: `build/audit-native-BackupProbe.java`; calculator reproduction is included in the native/calculator report.
- Hash snapshot of 122 source/data/test files: `build/audit-source-sha256.json`. All recorded hashes remained unchanged during review.

Passing existing tests does not cover the reproduced failures. Add focused regressions before implementing fixes.

## Specialist reports and coverage

- [Notes data, parser, storage and voice](AUDIT-DATA-2026-10-07.md): all six notes data modules; model/parser/storage/migration/replay/CSV tests.
- [Frontend and cross-screen state](AUDIT-UI-2026-10-07.md): notes UI, index frontend, selection/gestures, settings, navigation, persistence and browser probes.
- [Android, native voice, packaging and calculators](AUDIT-NATIVE-CALCULATORS-2026-10-07.md): all 13 Java classes, JNI/CMake, manifest/themes/build scripts, calculator/code UI modules and data-generation scripts.

## Limits

Source and automated tests cannot establish absence of all defects. No Android handset/emulator, TalkBack, real microphone/Bluetooth, print service, actual cloud request, signing or upload was exercised. Existing voice native binaries were packaged; vendored whisper internals and chart image pixels were not independently audited. Regulatory tables and physical radiographic exposure behavior were not independently certified. Each specialist report records exact evidence and limitations.
