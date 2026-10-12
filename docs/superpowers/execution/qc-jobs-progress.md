# Execution ledger — QC jobs and daily lists
Plan: docs/superpowers/plans/2026-10-06-qc-jobs-daily-lists.md
Spec approved; Native execution selected.
Ruling: Work in current approved claude-test15/ShotTime checkout on codex/note-taker; the feature plan explicitly requires this copy. Preserve unrelated files. Baseline files copied into build/jobs-baseline for independent review because this entire app copy is currently untracked in the parent repository.
Preflight: Jobs produces schema 5 and mutation adapters; storage and UI consume the same interfaces. Voice remains list-based inside the adapter, with linked Undo preserving high-water counters. No dependency cycles: Jobs -> Model; Storage -> Jobs/Model; UI -> all modules.
Ruling: Keep execution progress here instead of POSIX-only skill helper scripts. No automated repository cleanup or broad commits of the preexisting untracked app.
Task 1: in progress.
Task 1: model allocator, linked Undo and job setting tests passed, including unchanged start values during settings saves.
Task 2: schema-5 migration and asset injection tests passed; existing storage/MT migration tests passed after fixture updates.
Task 3: all UI model mutations use prepared job counters; voice test passes cross-day, replay, review and add/undo/add. Failed-save UI test passes staged background voice replay and retry.
Task 4: initial Jobs/daily UI, existing MT browser and adapted notes UI suites pass. Full regression in progress.
Ruling: Keep daily required-field overrides and inherit job defaults only at creation, as the approved plan specifies. Test setup now creates a job plus its daily list instead of a standalone list.
Final review: independent gpt-6-astra reviewer found one P2: unused MT starting-number edits discarded zero padding. No further actionable findings in allocator, migration, Undo, voice persistence and navigation.
Final: fixed MT start padding — new model regression failed MT-7 vs MT-007 before fix, passes after preserving raw start and updating width; settings display padded values. Applied the same explicit-input handling for unused XF starts.
Ruling: Migrated job IDs use deterministic list ordinals, not prefixed old IDs — valid 160-character old IDs otherwise exceeded the job-ID limit; original list IDs are unchanged. Max-ID migration test verified red/green.
Ruling: Failed-save edits now require Retry saving before further changes, including context edits; adjusted the old polished UI test to exercise explicit retry. This matches the approved staged-state recovery design.
Task 4: complete — jobs navigation, duplicate dates, independent starts, format settings, blank daily context and mobile label tests passed. Screenshots: build/qc-jobs.png and build/qc-daily-lists.png.
Task 5: complete — final npm test passed including all calculator and Note Taker suites; log: build/jobs-final-tests.log. Android Java sources compile against API 36 with jobs injection. No APK/version bump performed.
Final review: P2 padding regression fixed and covered by model plus browser tests. No deferred findings.
Ruling: Leave the implementation as local source changes in the approved existing app directory; the parent repo does not track this app copy, so do not create broad commits that would incorporate unrelated prior app work. No merge, push or worktree cleanup requested.
