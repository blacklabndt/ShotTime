# Notes data audit — 2026-10-07

Read-only deep review of the current source, including unreleased CN bulk operations. No production files changed.

Run all three confirmed reproductions from the project directory with `node build/audit-data-repros.cjs`. The script asserts the current defective behavior and exits successfully only when each described defect is reproduced; it is not a product regression suite. It passed during this audit.

## Findings

### DATA-01 — P2 / BLOCKER: history trimming bypasses duplicate-CN confirmation

**Source:** `assets/notes-jobs.js:36`; related `assets/notes-model.js:26`.

`duplicateCNs` treats any reduction in history length as Undo and immediately returns no matches. Normal additions can reduce history length because `trimHistory` drops snapshots to stay near 300,000 characters. Such additions silently bypass the requested duplicate confirmation, including automatic voice additions using this callback.

**Reproduced:** create a daily list, add 1,000 XF rows on CN-1, add 1,000 on CN-2, then prepare one more row on CN-1. The third operation reduces history from two snapshots to one. `duplicateCNs(library, before, after)` returns `[]` despite the 1,000 existing CN-1 rows. No undo was performed. The input library remains valid.

**Fix:** identify Undo explicitly at the caller/transaction boundary instead of inferring it from history size. Apply duplicate checks to additions and changed CNs regardless of snapshot trimming. Add the above regression for manual and voice paths, and an MT equivalent.

### DATA-02 — P2 / BLOCKER: retained suffix CNs lose their identity after future-only format changes

**Source:** `assets/notes-jobs.js:29-33`, `assets/notes-jobs.js:97`; related `assets/notes-model.js:27-28`.

Suffixed CNs have `cnNumber: null`. Their identity is therefore recovered from the visible label using only the current job prefix. A future-only format change retains old labels but replaces that prefix, losing the ability to recognize historical custom-prefix suffix CNs. Numeric-only CNs retain independent numeric metadata; suffix CNs do not.

**Reproduced:** create a job with CN format `S:` and width 4; add CN 12A, producing `S:0012A`; change only future rows to `B-` width 0. Adding CN 12A now produces `B-12A`, and the existing `S:0012A` triggers no duplicate warning. Moving `S:0012A` to a default-format job with renumbering retains `S:0012A` instead of adopting `CN-12A`. Applying another format to all existing rows throws `CN S:0012A cannot be reformatted automatically. Edit it individually.` This is reproducible with valid saved state and the supported settings path.

**Fix:** retain stable numeric-plus-suffix identity (or the original per-row format), independent of current display formatting. Use it consistently for duplicate matching, reformatting, search identity and bulk moves. Introduce a compatible migration if storage metadata is added; preserve arbitrary manually entered CNs. Test sequential future-only changes for both XF and MT suffix rows.

### DATA-03 — P2 / BLOCKER: long offline transcripts cannot enter recoverable pending review

**Source:** `assets/notes-voice.js:26-39`; related `assets/notes-model.js:20`, `assets/notes-ui.js:41-54`, `src/ca/kylekeith/shottime/VoiceJournal.java:50-53`.

Deferred sessions split long text into bounded pending items, but ordinary offline sessions do not. A normalized piece above 20,000 characters fails parser validation and is pushed unchanged into `pending`; model validation then rejects that item. The enclosing job transaction aborts before saving pending review or the transcript archive. The UI reports voice recovery failure instead of presenting a correctable pending instruction.

**Reproduced:** provide a stopped, non-deferred session with 500 short events containing `this unrecognized statement describes a spool and needs review`. This is below the native 2,000-event limit. `reconcile` produces a 31,499-character pending item; wrapping the same call in `J.mutate` throws `Invalid pending instruction.` There is no aggregate native character limit. The native journal still retains the raw session immediately after this failure; this reproduction alone does not demonstrate destroyed audio/text.

**Fix:** bound ordinary offline pending pieces using stable chunk IDs, retain complete original text and replay protection, and make long sessions reviewable without dropping adjoining words. Verify that failure recovery cannot acknowledge a transcript which has not been durably archived. Add offline long-session tests, including interrupted sessions and reload.

## Scope and evidence

Read all implementation content in `assets/notes-jobs.js`, `notes-model.js`, `notes-storage.js`, `notes-parser.js`, `notes-voice.js`, and `notes-learning.js`. Cross-checked relevant UI transaction/recovery call sites and the native journal limit. Read project AGENTS.md and the latest HANDOVER entries. Project `.agents/skills` and `.Codex/skills` directories are absent.

Inspected focused model, parser, storage, migration, voice, suffix, duplicate and bulk tests. Executed all 22 matching pure-JavaScript notes suites: CN bulk/letters/suffix, duplicate CN, export columns, jobs storage/voice, modifiers, notes jobs/learning/model/MT/parser/storage/voice, required fields, review fields, shorthand WID, spool spacing, unknown identities, voice variations and XH schedule. All passed. The confirmed edge cases above were reproduced separately with direct Node calls and are not covered by those passing suites.

Browser/gesture review belongs to the parallel UI reviewer; native runtime/security and calculator checks belong to the other reviewer. This report does not claim handset transcription or Android runtime verification. No external standards, physical calculations, APK build, upload or product changes were performed.


## Orchestrator cross-validation update

DATA-03 is elevated to **P1** by the completed UI reproduction. Back and reopening after failed oversized-session recovery re-enables recording and sends the unrecovered session as `previous`, even though no pending item or transcript archive was saved. This permits native journal replacement. See AUDIT-UI-2026-10-07.md cross-review validation and consolidated finding A4. The initial data-only reproduction above remains valid; this adds the confirmed acknowledgement/loss chain.
