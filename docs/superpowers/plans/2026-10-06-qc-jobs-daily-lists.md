# QC Jobs and Daily Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the QC Notes list landing page with Jobs → Daily lists, assigning unique continuous XF and MT numbers within each job.

**Architecture:** Keep stable daily-list IDs and the flat list collection; add parent jobs and schema 5. A pure library module supplies current job counters to every list mutation and commits the resulting list/counters together. Keep the existing parser, recording UI and native voice list binding.

**Tech Stack:** Existing plain JavaScript UMD modules, localStorage, Node assert tests, Playwright/Chrome and Android Java WebView asset injection; no dependencies added.

**Spec:** `docs/superpowers/specs/2026-10-06-qc-jobs-daily-lists-design.md` — approved by the user on 2026-10-06.

## Global Constraints

- XF and MT each have one continuous numbering sequence per job, shared by all its daily lists. Separate jobs have independent sequences.
- Creating an empty list consumes no numbers.
- CN/WID context starts blank on a new daily list to avoid carrying yesterday's values accidentally.
- Deleting or undoing an addition leaves a gap; consumed numbers are not recycled.
- Pending clarification consumes no numbers until confirmed. Replayed voice segments consume no additional numbers.
- Each existing list becomes a separate job; preserve all existing numbers, identifiers, context, pending items, voice replay markers, history and CSV settings.
- Daily CSV remains a per-list export with the existing columns and job-wide numbers. Combined job export is outside this first change.
- Do not overwrite unreadable storage; retain the existing localStorage key and native list IDs.
- Keep Android package/signing identity, CSP, voice permissions and both ARM64 speech libraries unchanged. Do not change calculator behavior.
- Implement in the current `claude-test15/ShotTime` working copy without reverting other work. The repository root includes old copies and unrelated files; never broadly stage it.

## Review Focus

1. A native voice callback arrives for an older list after another day consumed numbers: allocate from its parent job now, never its stale list counter (Tasks 1 and 3).
2. A single voice reconciliation adds, undoes and adds again: the final addition must not reuse the undone number (Tasks 1 and 3).
3. Storage fails after allocation and a voice event is replayed before retry: retain staged state and replay markers together; retry must not allocate again (Tasks 3 and 5).
4. Two old lists have the same LSD and overlapping numbers: migrate into separate jobs, preserving both sets of records and histories (Task 2).
5. Job formats change and an old daily-list Undo follows: it must not restore stale job settings or affect another day (Tasks 1 and 4).

## File map

- Create `assets/notes-jobs.js`: pure schema-5 library operations, job validation, allocator, navigation/deletion and legacy wrapping.
- Modify `assets/notes-model.js`: linked-list Undo preserves consumed counters; prohibit linked-list renumbering.
- Modify `assets/notes-storage.js`: schema-5 load/save validation and migration using notes-jobs; retain existing export functions.
- Modify `assets/notes-ui.js`: job/list screens and shared mutation/voice integration.
- Modify `assets/index.html`: jobs asset marker and small responsive layout additions if required.
- Modify `src/ca/kylekeith/shottime/MainActivity.java` and `tests/load-app.mjs`: inject the jobs asset after model and before storage.
- Modify `tests/notes-actions.mjs`: reusable job/daily-list creation helpers for browser suites.
- Create `tests/test-notes-jobs.cjs`, `tests/test-jobs-storage.cjs`, `tests/test-jobs-voice.cjs`, `tests/test-jobs-ui.mjs`, `tests/test-jobs-failure.mjs`.
- Update existing affected test fixtures and `package.json`, `AGENTS.md`, `HANDOVER.md`, `README.md`.

## Task 1: Shared job model and allocation

**Interfaces:** `ShotNotesJobs` / CommonJS module exports `empty()`, `validate(library)`, `createJob(library, options)`, `createDailyList(library, jobId, options)`, `workingList(library, listId)`, `mutate(library, listId, transform)`, `updateJob(library, jobId, patch, options)`, `removeList(library, listId)`, `removeJob(library, jobId)`, `select(library, jobId, listId=null)`, `fromLegacy(library)`. All returned libraries are new values; input objects are unchanged. `transform` consumes one prepared list and returns one list. It must not change its ID/jobId or another job.

Job shape: `{id,name,lsd,start,nextSequence,mtStart,nextMtSequence,cnFormat,xfFormat,mtFormat,fieldRequirements}`. Library shape: `{schemaVersion:5,jobs:[],lists:[],selectedJobId:null,selectedListId:null,deletedLists:[]}`. Daily list adds `jobId` and otherwise retains the model shape. Same-date cards use their stable position among that date's lists as a display suffix; no schema field is necessary.

- [ ] Add the test file with this allocator acceptance case (import `M` and `J` from their asset modules):

```js
let lib=J.createJob(J.empty(),{id:'a',name:'Job A',lsd:'Site A',start:1,mtStart:1});
lib=J.createDailyList(lib,'a',{id:'mon',date:'2026-10-05'});
lib=J.createDailyList(lib,'a',{id:'tue',date:'2026-10-06'});
const add=(id,count,token)=>{lib=J.mutate(lib,id,l=>M.applyGroup(l,[{type:'addBatch',cn:'?',welder:'?',count,size:'4',schedule:'STD'}],token));};
add('mon',20,'m');add('tue',1,'t');add('mon',1,'late');
assert.equal(lib.lists.find(l=>l.id==='tue').rows[0].sequence,21);
assert.equal(lib.lists.find(l=>l.id==='mon').rows.at(-1).sequence,22);
assert.equal(lib.jobs[0].nextSequence,23);
lib=J.mutate(lib,'mon',M.undo);add('mon',1,'after-undo');
assert.equal(lib.lists.find(l=>l.id==='mon').rows.at(-1).sequence,23);
```

- [ ] Run `node tests/test-notes-jobs.cjs`; confirm missing module/API failure.
- [ ] Implement UMD module using `notes-model.js`; `workingList` clones the list and projects the job's current starts, next counters, formats and LSD. Preserve the list's own required fields/context. `mutate` validates before/after, rejects identity changes, runs the callback on the projection, takes maxima of previous/current counters, replaces the target list, synchronizes derived values on sibling live lists, and validates uniqueness across each job. Never derive next counters solely from remaining rows.

```js
const prepared=workingList(library,listId);
const changed=transform(prepared);
if(changed.id!==prepared.id||changed.jobId!==prepared.jobId)throw Error('List identity changed.');
const nextXF=Math.max(job.nextSequence,changed.nextSequence);
const nextMT=Math.max(job.nextMtSequence,changed.nextMtSequence);
```

- [ ] In `M.undo`, when `list.jobId` exists, preserve `jobId`, starts, job-owned formats/LSD and the maximum of current/restored counters. Job-wide setting changes must synchronize relevant derived metadata in history snapshots so restored row formats remain consistent. Keep legacy standalone model behavior for old tests. In `M.apply`, reject `deleteRows` with `renumber:true` for linked lists.
- [ ] Extend tests with independent job B, MT counters, empty lists, immutable inputs, duplicate rows within a job, invalid parent, invalid selected job/list, counter overflow, failed transform atomicity, and an add/undo/add callback using distinct tokens. Example rejection:

```js
const before=JSON.stringify(lib);
assert.throws(()=>J.mutate(lib,'mon',l=>M.apply(l,{id:'bad-delete',type:'deleteRows',rowIds:[l.rows[0].id],renumber:true})));
assert.equal(JSON.stringify(lib),before);
```

- [ ] Implement `updateJob` with explicit existing/new XF/CN format scope; MT format applies across the job because MT rows currently store no per-row format. Update live lists and matching historical metadata/rows atomically so Undo cannot reverse a job setting. Reject starting-number changes once the corresponding counter advanced; new-list required fields copy job defaults while existing per-list overrides remain. Reject unsupported patch keys. Removing lists never reduces counters; removing jobs adds all child IDs to existing bounded tombstones. UI recording guards are Task 4.
- [ ] Test job format changes followed by old-list Undo, '?' CN preservation, starts after deleting every row, removal with pending data, and selected-screen fallback.
- [ ] Run `node tests/test-notes-jobs.cjs` and existing model/MT/modifier tests. Review only these changes before a scoped checkpoint commit; do not include unrelated working files.

## Task 2: Storage migration and asset loading

**Interfaces:** consumes `J.fromLegacy(schema4Library)` and `J.validate(schema5Library)`; storage `load` retains `{library,warning,rawBackup}`, and `save` accepts schema 5. Existing schemas are load-only migration inputs, not silently rewritten by `save`.

- [ ] Create `test-jobs-storage.cjs` covering two schema-4 lists with the same LSD and overlapping sequences:

```js
const old={schemaVersion:4,lists:[M.createList({id:'x',date:'2026-10-05',lsd:'Same',start:1}),M.createList({id:'y',date:'2026-10-06',lsd:'Same',start:1})],selectedListId:'y'};
let raw=JSON.stringify(old);const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};
const loaded=S.load(storage);
assert.equal(loaded.library.schemaVersion,5);
assert.equal(loaded.library.jobs.length,2);
assert.notEqual(loaded.library.lists[0].jobId,loaded.library.lists[1].jobId);
assert.equal(loaded.library.selectedListId,'y');
assert.equal(loaded.library.selectedJobId,loaded.library.lists[1].jobId);
assert.equal(raw,JSON.stringify(old));
```

- [ ] Run the test and confirm schema-4 result fails.
- [ ] Implement deterministic migrated job IDs (`legacy-job:` plus list ID) and job names (`LSD — date`). Seed counters from live and historical next counters and row maxima plus one. Preserve list IDs and all user data; inject jobId into every snapshot. Keep versions 1→2→3→4 validation/migrations before wrapping; validate schema 5 separately.
- [ ] Add `/*__NOTES_JOBS__*/` after the model marker in HTML; inject `notes-jobs.js` in Android and `load-app.mjs` in the same order. Storage resolves `J` via require/browser global; jobs depends only on model to avoid cycles.
- [ ] Test schema 1/2/3 fixtures, corruption preservation, counter values represented only in history, empty library, tombstones, pending draft retention, save failure and round-trip. Schema-4 save fixtures in existing tests become `J.fromLegacy(...)`; tests explicitly exercising old migrations keep serialized legacy input.
- [ ] Run jobs storage and existing storage/export suites plus a `loadApp()` smoke check that no `/*__NOTES_` markers remain. Review and checkpoint only touched files.

## Task 3: Route manual, text, review and voice mutations through jobs

**Interfaces:** all UI list-changing paths call `J.mutate` using the currently staged library. `current()` returns a `J.workingList` only when a mutation is about to run; render may use synchronized live lists. Preserve feedback, drafts and pending-item identity.

- [ ] Create `test-jobs-voice.cjs` using the real voice reconciler inside the library mutation:

```js
lib=J.mutate(lib,'mon',l=>V.reconcile(l,{id:'session-a',listId:'mon',state:'stopped',events:[{text:'Unknown CN has one 2 inch STD weld unknown welder'}]}).list);
const saved=JSON.stringify(lib);
lib=J.mutate(lib,'mon',l=>V.reconcile(l,{id:'session-a',listId:'mon',state:'stopped',events:[{text:'Unknown CN has one 2 inch STD weld unknown welder'}]}).list);
assert.equal(lib.jobs[0].nextSequence,JSON.parse(saved).jobs[0].nextSequence);
assert.deepEqual(lib.lists.find(l=>l.id==='mon').rows,JSON.parse(saved).lists.find(l=>l.id==='mon').rows);
```

Use the two-day fixture from Task 1 within this file; initialize its own job/lists and consume Tuesday's numbers before the callback.

- [ ] Run the test plus a browser regression that sends a native voice callback to Monday while Tuesday is selected. Confirm stale-number or old UI assumptions fail before UI wiring.
- [ ] Introduce `mutateList(listId, transform)` in notes-ui, assigning the returned library once, then calling existing persist/render/feedback. Replace manual adds, edits/deletes, typed batches, clarification confirmation, metadata/context changes and both Undo buttons. UI handlers must not precompute a mutation from stale list counters.
- [ ] Change `receiveVoice` to reconcile a prepared list inside `J.mutate` for `voice.listId`, including transcripts before publication. When active recording restores its list, select its parent job too. Preserve per-segment replay IDs and deleted-list recovery handling. The model linked Undo rule protects multiple pieces within one reconciliation.
- [ ] Hide the renumber-delete option for linked lists and always pass `renumber:false`. Block new allocating actions after failed save until retry/recovery; already-started native callbacks use staged state and replay markers, never reloaded stale storage. Recovery exports include the entire staged library.
- [ ] Test typed mixed XF/MT, manual adds, required-field clarification, interrupted recordings, pending items that consume zero numbers, batch atomic failure, approved wording, and add/undo/add in one voice session. Run new voice tests and existing voice/parser/modifier tests. Checkpoint reviewed changes only.

## Task 4: Jobs and daily-list UI

**Interfaces:** use J.createJob/createDailyList/select/updateJob/removeList/removeJob. Keep native recording bound to daily-list IDs and existing CSV function signature.

- [ ] Add helpers to `tests/notes-actions.mjs`:

```js
export async function createJob(page,name='Job A',lsd='Site A'){
 await page.getByRole('button',{name:'Create job',exact:true}).click();
 await page.getByLabel('Job name',{exact:true}).fill(name);
 await page.getByLabel('LSD',{exact:true}).fill(lsd);
 await page.getByRole('button',{name:'Save job',exact:true}).click();
}
export async function addDailyList(page,date='2026-10-06'){
 await page.getByRole('button',{name:'Add daily list',exact:true}).click();
 await page.getByLabel('Date',{exact:true}).fill(date);
 await page.getByRole('button',{name:'Create daily list',exact:true}).click();
}
```

- [ ] Add `test-jobs-ui.mjs` using current loadApp/Chrome route setup, those helpers, and a failing assertion that the fresh QC page offers Create job and no active recorder.
- [ ] Render three states: no selectedJobId → Jobs; selectedJobId without selectedListId → job overview; both → current daily editor. Use existing buttons/dialog styles, `textContent` for job names and stable data attributes `data-job-id` / `data-daily-list-id`. Validate names with the model's single-line 160-character rule. Job form includes starts/formats/required defaults; daily form includes only date. Label duplicate-date lists `date · List 1`, `date · List 2` using stable library order.
- [ ] Add job settings with name/LSD, future-list defaults, eligible starts and format scope. Keep date/required-field overrides and CSV spacing in daily settings; remove per-day numbering resets. Show next numbers from parent job on both job and daily pages.
- [ ] Implement job/list deletion dialogs with counts and active-recording locks, and job/list navigation guarded while voiceBusy. Returning from daily list returns to parent job. Reload restores validated selection; migrating a selected old list opens that same daily list in its new job.
- [ ] Test two jobs, three dates, duplicate-date labels, reload selection, manual/text/MT continuity, older-list edits, '?' display/export, long/XSS-like job names, 360px layout, recording locks and deletion. Update existing browser test setup to use helpers without weakening its existing feature assertions.
- [ ] Run jobs UI, required fields, review, MT, export and floating recorder browser suites. Review and checkpoint the UI and adjusted fixtures only.

## Task 5: Persistence failures and full integration

**Interfaces:** no new public APIs; verify staged library semantics, recovery and all numbering routes.

- [ ] Add `test-jobs-failure.mjs` with the existing localStorage fault-injection approach. Force notes writes to throw after a daily addition; assert the visible unsaved warning, unchanged stored library and no further manual allocations. Deliver the same voice segment twice, restore storage, retry, reload and assert one row and one counter increment.

```js
const lib=JSON.parse(await page.evaluate(()=>localStorage.getItem('shottime.notes')));
assert.equal(lib.schemaVersion,5);
const rows=lib.lists.filter(l=>l.jobId===lib.jobs[0].id).flatMap(l=>l.rows);
assert.equal(new Set(rows.map(r=>r.sequence)).size,rows.length);
assert.ok(rows.every(r=>r.sequence<lib.jobs[0].nextSequence));
```

- [ ] Cover a deleted-list native callback after reload, corrupted job references, backup containing staged counters, and job format mutation failure leaving every list unchanged. Confirm recovery never silently replaces corrupt storage.
- [ ] Add new suites to test:notes. Run the following using the installed Chrome; stop and repair any regression, rerunning affected suites before the final full pass:

```powershell
$env:CHROME_BINARY='C:/Program Files/Google/Chrome/Application/chrome.exe'
npm test
```

- [ ] Review the complete feature diff against the approved spec: especially all M.apply/M.applyGroup/M.undo call sites and receiveVoice. Preserve standalone model test semantics but require every production linked-list path to use the allocator. Record results in HANDOVER, describe Jobs/Daily lists and numbering gaps in README, and update current behavior notes in AGENTS. No APK/version bump unless packaging is requested; if requested, follow the verified 1.76 build/sign/asset-equality process with the next version code.
- [ ] Create a scoped final checkpoint after tests, excluding signing material, APKs, build trees and unrelated files. Summarize behavior, migration and checks to the user.

## Self-review

All approved sections map to tasks: screen flow (4), numbering/Undo (1,3), migration (2), failure/recovery (3,5), export preservation (2,4), native loading (2), documentation/tests (5). Each of the five Review Focus conditions has an assigned acceptance check. No new cloud service, automatic grouping of old lists, whole-job export or calculator changes are included.

## Execution choice

Recommend Native execution in this chat: the five tasks depend closely on the same list/job interfaces and must be integrated sequentially. The alternative is subagent-driven execution with a separate implementation/review cycle for each task. User approved Native execution. Implementation and final verification are complete; see docs/superpowers/execution/qc-jobs-progress.md for evidence and rulings.
