# Note Taker Local Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the Note Taker placeholder with persistent, editable inspection lists, typed batch commands and Excel-compatible export.

**Architecture:** Separate pure weld operations, command parsing, persistence/export and DOM presentation into focused assets. Inject these assets through the same trusted local substitution pattern already used for the calculator. Keep the data model ready for finalized speech commands without claiming that typed input implements voice.

**Tech Stack:** Existing Java Android WebView host, plain JavaScript, localStorage, Node assert and Playwright/Chrome. No additional runtime dependencies.

**Spec:** ../specs/2026-09-30-note-taker-design.md (approved 2026-09-30).

## Scope and follow-on plans

This plan delivers stage 1 of the approved design. Stage 2 covers Android recording, Bluetooth, foreground-service lifecycle and online transcription; stage 3 covers authenticated sync and computer access. Those require provider/hosting evaluation against current documentation. They remain required features of the full project. A local export or typed command is not a substitute for them.

## Global Constraints

- Exact export order: CN#s, XF#s, WID, Weld Size, Weld Schedule.
- One row per weld. CN can repeat; XF increments in dictated order.
- WID is text: O, X, RG, DD, W-24, W-69.
- No mandatory confirmation between clear batches. Ambiguities are queued for review; no guessed identifiers or quantities.
- Target phone: Samsung Galaxy S26 Ultra.
- Keep calculator exposure assumptions, local settings and printing unchanged.
- No signing operations; do not include the private signing archive in commits or builds.
- Preserve minimum API 26, target API 36, package ca.kylekeith.shottime.
- Use separately versioned notes storage. No calculator schema reset.

## Review Focus

1. O versus zero and leading zeroes must remain distinct text (tasks 1, 2).
2. Replayed final segments must not duplicate welds, including after a restart (tasks 1, 3).
3. Failed storage writes and malformed records must not silently erase previous data (task 3).
4. Formatting/deletion changes must not create conflicting XF identifiers or unexpectedly renumber prior rows (tasks 1, 4).
5. Clipboard denial and formula-like identifiers must not make export silently fail or execute spreadsheet formulas (tasks 3, 4).

## File map

All paths below are relative to shottime-handover/ShotTime.

- assets/notes-model.js: pure list creation and transactional commands; Node/CommonJS and browser global ShotNotesModel.
- assets/notes-parser.js: final text to validated commands/review items; global ShotNotesParser.
- assets/notes-storage.js: versioned load/save and text export; global ShotNotesStorage.
- assets/notes-ui.js: DOM rendering and event handling; global ShotNotesUI.
- assets/index.html: Note Taker screen, scoped styles and injection markers.
- src/ca/kylekeith/shottime/MainActivity.java: four additional trusted asset substitutions only in this stage.
- tests/test-notes-model.cjs, tests/test-notes-parser.cjs, tests/test-notes-storage.cjs: pure behavior checks.
- tests/test-notes-ui.mjs: navigation, editing, recovery and export behavior.
- tests/load-app.mjs: shared full asset substitution helper for browser tests.
- package.json: include new suites in npm test.
- README.md, HANDOVER.md: delivered functionality and explicit remaining voice/sync work.

## Task 1: List model, numbering and reversible operations

**Interfaces:** createList({id,date,lsd,start,cnFormat,xfFormat}) returns a list. apply(list,command) returns a new list or throws without mutating its input. formatId(number,{prefix,separator,width}) returns text. undo(list) restores the last operation. List fields: id, date, lsd, revision, nextSequence, cnFormat, xfFormat, context:{cn,welder}, rows, processedSegments, history. Row fields: id, cn, sequence, xfFormat, welder, size, schedule. Commands have a stable id and type: addBatch, updateRows, deleteRows or changeFormat; row targeting uses immutable row IDs.

- [ ] Write model tests, starting with this numerical/text distinction:

```js
const assert=require('node:assert/strict');
const M=require('../assets/notes-model.js');
const list=M.createList({id:'a',date:'2026-09-30',lsd:'test',start:101,
  cnFormat:{prefix:'CN',separator:'-',width:0},xfFormat:{prefix:'XF',separator:'-',width:0}});
const next=M.apply(list,{id:'s1',type:'addBatch',cn:'CN-47',welder:'O',count:6,size:'4',schedule:'STD'});
assert.equal(next.rows.length,6);
assert.equal(next.nextSequence,107);
assert.equal(next.rows[0].welder,'O');
assert.equal(M.formatId(next.rows[0].sequence,next.rows[0].xfFormat),'XF-101');
assert.equal(list.rows.length,0);
assert.equal(M.apply(next,{id:'s1',type:'addBatch',cn:'CN-47',welder:'O',count:6,size:'4',schedule:'STD'}).rows.length,6);
assert.equal(M.undo(next).rows.length,0);
```

- [ ] Run `node tests/test-notes-model.cjs`; establish expected missing-module failure before implementation.
- [ ] Implement pure copy-on-write transactions. Require positive safe integer start/count, cap each command at 1000 rows, reject overflow. Preserve text IDs, allow only nonnegative integer padding width up to 12. Rows receive stable IDs; formatting never changes internal IDs. Keep completed segment IDs in durable state. Undo must preserve replay protection for already-consumed segments.
- [ ] Add tests for keep-number deletion, renumber from the first affected sequence, undo, future-only versus all-row formatting, conflicting formatted XFs, blank welder, W-24, and identifiers 047 versus 47. Assert throwing commands leave the input byte-for-byte unchanged.
- [ ] Run the model suite; commit only model and tests.

## Task 2: Batch parser and scoped corrections

**Interfaces:** parse(text,{cn,welder},rows) returns {commands,review,context}; review contains original text, reason and affected span. It does not modify rows. parse takes finalized text only; the caller supplies stable IDs to commands. Parse all clauses before committing any part of a submission with uncertain boundaries/counts.

- [ ] Write `test-notes-parser.cjs` with the owner example:

```js
const assert=require('node:assert/strict');
const P=require('../assets/notes-parser.js');
const result=P.parse('CN-47 has 6 4 inch STD welds welded by DD, CN-32 has 2 2 inch XS welds welded by O, CN-22 has 3 3 inch STD welds welded by TS',{},[]);
assert.equal(result.review.length,0);
assert.deepEqual(result.commands.map(c=>[c.cn,c.count,c.size,c.schedule,c.welder]),[
 ['CN-47',6,'4','STD','DD'],['CN-32',2,'2','XS','O'],['CN-22',3,'3','STD','TS']]);
```

- [ ] Run `node tests/test-notes-parser.cjs` and confirm failure.
- [ ] Implement normalization for spelled integer quantities, inch symbols/words, fractions, standard/STD, extra strong/XS and schedule/sch numeric values. Recognize CN batch boundaries and bind trailing welder phrases before generating commands. Do not globally replace letters O with digits. Unknown text stays a review item.
- [ ] Implement explicit correction forms: `Change XF-103 welder to W-24`, `Set XF-104 through XF-106 welder DD`, `Undo the last batch`, and `Change the last weld to schedule 80`. Resolve XF text to immutable row IDs, reject missing/ambiguous targets. Plain `make that eight` requires clarification in this first parser rather than guessing scope.
- [ ] Add assertions for inherited context, two sizes within one CN, trailing welder, letter O, W dash twenty-four, repeated CN, 1 1/2 inch sizes, incomplete trailing CN and unsafe quantities. Feed parsed commands into task 1 and assert exactly 11 rows and nextSequence 112 for the owner example.
- [ ] Run both pure suites; commit parser and tests.

## Task 3: Durable local library and Excel-safe export

**Interfaces:** load(storage) returns {library,warning,rawBackup}; save(storage,library) throws on failure; toTSV(rows) returns five tab-separated cells per row without headers. storage uses getItem/setItem. Library shape {schemaVersion:1,lists:[],selectedListId:null}; key shottime.notes. Invalid/future-schema input is retained for recovery, not overwritten on load.

- [ ] Write storage tests using an in-memory map and an injected quota failure:

```js
const assert=require('node:assert/strict');
const S=require('../assets/notes-storage.js');
const map=new Map();
const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
const library={schemaVersion:1,lists:[],selectedListId:null};
S.save(storage,library);
assert.deepEqual(S.load(storage).library,library);
assert.throws(()=>S.save({setItem(){throw Error('quota');}},library),/quota/);
map.set('shottime.notes','broken');
assert.ok(S.load(storage).warning);
assert.equal(map.get('shottime.notes'),'broken');
```

- [ ] Run `node tests/test-notes-storage.cjs`; confirm failure.
- [ ] Implement structural validation of lists, rows, counters and schema. Save successful operations before showing Saved. On failure retain the edited in-memory list and clearly mark it unsaved; provide retry/export. Never allow startup auto-save to destroy a corrupt record.
- [ ] Implement TSV using CN, formatted XF, WID, size plus inch mark, schedule. Reject tabs/newlines in identifier inputs; neutralize formula-leading =, +, -, @ at export without changing stored identifiers. Document the text-protection behavior and verify pasting into Excel manually during acceptance.
- [ ] Add save/reload/replay test from task 1; assert it creates no duplicate rows. Add corruption, unknown schema, quota, tab/newline and formula-like ID tests; run all three suites and commit.

## Task 4: Working Note Taker interface and trusted asset loading

**Interfaces:** ShotNotesUI.init() binds existing Note Taker container once. UI consumes task 1/2/3 APIs. No global calculator state access. Typed transcript submission uses parser and applies complete commands transactionally with stable submission IDs.

- [ ] Create tests/load-app.mjs with one helper that reads index.html and substitutes techniques.json, calculator.js and all four notes assets via replacement callbacks. Update the existing two browser harnesses and add test-notes-ui.mjs to use it. This ensures missing note assets fail all actual runtime harnesses rather than being ignored.
- [ ] Add UI acceptance tests:

```js
await page.getByRole('button',{name:'Open navigation menu'}).click();
await page.getByRole('button',{name:'Note Taker',exact:true}).click();
await page.getByRole('button',{name:'New list',exact:true}).click();
await page.getByLabel('LSD',exact:true).fill('bunker-test');
await page.getByLabel('Starting XF number').fill('101');
await page.getByRole('button',{name:'Create list',exact:true}).click();
await page.getByLabel('Batch instruction').fill('CN-47 has 6 4 inch STD welds welded by DD');
await page.getByRole('button',{name:'Add instruction',exact:true}).click();
assert.equal(await page.locator('[data-weld-row]').count(),6);
await page.reload();
await page.getByRole('button',{name:'Open navigation menu'}).click();
await page.getByRole('button',{name:'Note Taker',exact:true}).click();
assert.equal(await page.locator('[data-weld-row]').count(),6);
```

- [ ] Implement library/create/inspection views, current context and next XF, manual Add weld, row edit, typed batch instruction, unresolved instruction panel and Undo. Render user text with textContent. Provide a disabled microphone button labelled Voice recording coming next; never simulate listening.
- [ ] Add CN/XF prefix, separator and width controls. Preserve numeric input text long enough to infer leading-zero width from a starting XF such as 001. Existing-row format changes require existing-and-new or new-only choice. Deletion dialog offers Keep XF numbers, Renumber and Cancel.
- [ ] Provide Copy rows and an export text dialog. Attempt clipboard write only following user action and fall back to selectable plain text with clear instructions when unavailable. No false success toast on failure. File sharing/sync is reserved for the next stages.
- [ ] Insert trusted script markers and call init only after scripts load. Add matching Java readAsset replacements. Keep the WebView CSP, native navigation restrictions, print lifecycle and calculator modules untouched.
- [ ] Add tests at 360px and desktop widths for navigation preservation, editing WID, both delete outcomes, cancelled delete, future/all formatting, restart, unsaved warning, clipboard rejection, malicious HTML rendered as text, menu/back handling and keyboard focus. Use mocked clipboard results for both success and failure.
- [ ] Run all note tests and existing suites. Update package.json so npm test includes every suite. Commit the interface, harness and native substitution changes together.

## Task 5: Delivery verification and follow-on preparation

- [ ] Run npm test with `CHROME_BINARY=C:/Program Files/Google/Chrome/Application/chrome.exe` supplied through the PowerShell environment. Record actual results.
- [ ] Review calculator.js and techniques.json against the supplied handover to ensure no changes; check Git diff for secrets/generated artifacts. Existing extracted source is untracked in the parent repository: stage only explicit source/test/doc files, never the whole handover directory, node_modules, bundle, archive or temporary script.
- [ ] If JDK/SDK/Bash are available, run SDK_ROOT=/path/to/sdk bash build-review.sh. If unavailable, report compilation unverified without implying an installable APK exists. Do not sign this stage.
- [ ] Update README.md and HANDOVER.md with actual local functionality, tests and limitations: voice, Bluetooth, background recording and computer sync still pending. No version-code bump unless producing an installable release.
- [ ] Review completed work for data loss, duplicate numbering and export fidelity. Fix reproduced defects and rerun affected tests.
- [ ] Prepare the next recording plan using current official Android/speech-provider documentation and the delivered command interfaces. Preserve the full-project goals; do not mark the Note Taker project complete after local lists alone.

## Self-review

The plan covers the local list/model/parser/edit/export portion of the approved spec. All five review risks have assigned tests. Online transcription, audio lifecycle, authentication, synchronization and physical-device acceptance belong to the explicitly retained next two stages. No product implementation has been started by writing this plan.

## Execution status — 2026-09-30

Tasks 1–4 implemented and verified. Task 5: all seven suites pass after review fixes; calculator assets match the handover ZIP; documentation and next-stage research saved. Android compilation is unavailable without JDK/SDK, and actual Excel paste/device acceptance remain unverified. Independent review Important findings were fixed with regression tests; remaining minor test/readability items are recorded in ../note-taker-verification.md.
