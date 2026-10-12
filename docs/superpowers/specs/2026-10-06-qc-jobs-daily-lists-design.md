# QC jobs and daily lists — proposed design

Date: 2026-10-06
Status: Approved and implemented on 2026-10-06; verified locally, not yet packaged.

## Intended outcome

The QC Notes home page lists jobs and provides Create job. Opening a job shows its daily inspection lists and Add daily list. XF and MT each have one continuous numbering sequence per job, shared by all its daily lists. Separate jobs have independent sequences.

## Screens and workflow

1. Jobs: show job name, LSD, daily-list count and next XF/MT numbers. Create job asks for job name, LSD, starting XF, starting MT, identifier formats and default required fields. Starts default to 1.
2. Job: show job name/LSD, next XF/MT, daily lists sorted newest date first, Add daily list, Job settings and Back to jobs.
3. Daily list: retain recording, spool cards, manual entry, clarification, editing, Undo and CSV export. Show job name, date and job's next XF/MT. Back returns to the job.

Add daily list asks for a date (today by default); job details and defaults are inherited. It does not ask to restart numbering. More than one list on the same date is allowed and must remain distinguishable in navigation. Creating an empty list consumes no numbers. CN/WID context starts blank on a new daily list to avoid carrying yesterday's values accidentally.

Daily CSV remains a per-list export with the existing columns and job-wide numbers. Combined job export is outside this first change.

## Numbering rules

- Example: Job A day 1 uses XF-1 through XF-20 and MT-1 through MT-5. Its next day starts XF-21 and MT-6. Job B can independently start XF-1 and MT-1.
- Assign numbers when entries are added, in entry order, rather than preallocating ranges when a list is created.
- Reopening an older list and adding a weld uses the job's next unused number. It never overlaps a newer day's entries or shifts any existing row.
- Deleting or undoing an addition leaves a gap; consumed numbers are not recycled. Metadata edits and undo must never roll back job counters or alter other lists.
- Pending clarification consumes no numbers until confirmed. Replayed voice segments consume no additional numbers.
- Starting numbers can be changed only before that job has consumed numbers of the corresponding type. Format settings belong to the job; changes affecting existing rows must explicitly identify their job-wide scope. Preserve ? CN placeholders.

## Existing saved lists

Proposed safe migration: each existing list becomes a separate job, named using its LSD and date, containing that original daily list. Preserve all existing numbers, identifiers, context, pending items, voice replay markers, history and CSV settings. Do not infer that matching LSDs identify the same job: existing lists may contain overlapping XF/MT runs.

Automatically merging or renumbering existing lists is outside this change. If the user wants existing lists grouped, agree a conflict policy before implementation.

## Technical structure

Introduce a tested job/library module and storage schema 5. Retain the existing flat list collection with stable list IDs and add jobId to each daily list; add a jobs collection and selectedJobId for navigation. This keeps native voice sessions bound to their existing list IDs.

Each job owns its next XF/MT counters, starts, name/LSD, formats and default required fields. List-local sequence fields required by the existing model become derived working values, not independent authorities. Add a shared mutation path for manual, typed, reviewed and voice additions: load current job counters, apply the whole operation, advance counters and save the library together. Route every numbering path through it, including voice reconciliation for a list that is not currently visible.

Validate uniqueness of XF and MT sequences across all lists within each job, valid parent references, counter bounds and selected job/list consistency. Preserve bounded undo and recovery behavior. Failed persistence must report unsaved state and prevent silent reuse or replay of allocations; retries save the same staged operation, and recovery exports include its job state.

Migrate schemas 1–4 through their existing migrations before adding jobs. Seed migrated counters from the original next values and maximum allocated values in current rows and undo history. Do not overwrite unreadable storage. Preserve deletion tombstones so old native voice sessions cannot resurrect deleted lists. Deleting a daily list leaves its job counters intact. Job deletion explicitly confirms removal of all its lists and is blocked during recording in that job.

## Verification

- Independent jobs and shared counters over several days, including empty/backdated lists and interleaved XF/MT.
- Every addition route: manual, typed, streaming/stopped voice, structured review and approved wording.
- Undo/deletion gaps; old-list edits never change other days; replay suppression after reload.
- Migration of schema 1–4, duplicate numbering in separate legacy lists, history, pending drafts and recovery data.
- Storage failures and retries, missing jobs, invalid counters and duplicate numbers.
- Daily export retains assigned numbers and ? placeholders.
- Mobile navigation, remembered selection, new job/list forms and recording navigation locks.
- Full Note Taker regression suite and Android build verification when packaging is requested.

## Alternatives considered

Copying yesterday's next numbers into a new list is simpler but allows collisions when revisiting older lists; rejected. One undivided job ledger filtered by date provides numbering centrally but would substantially rewrite existing list-specific voice/review/undo behavior. A parent job with a shared allocator preserves daily lists while enforcing numbering across them; recommended.
