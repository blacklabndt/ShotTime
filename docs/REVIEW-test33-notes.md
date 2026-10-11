# test.33 notes core review

Reviewed `assets/notes-parser.js`, `notes-model.js`, `notes-voice.js`, `notes-learning.js`, relevant tests, `AGENTS.md` and current `HANDOVER.md` sections. Product code unchanged. No signing material accessed.

## Findings

### P2 — Trailing schedule/type tokens are consumed as WIDs in field review

- **Location:** `assets/notes-parser.js:133` (unconditional two-letter trailing-WID extraction), before group classification at lines 137–140.
- **Trigger:** A stopped deferred/cloud session contains `CN-1 has 2 2 inch XS`; configure XF schedule as optional. This can occur on cloud interpretation failure, which deliberately queues the original recognized speech. `parse()` correctly returns two 2-inch XH welds with blank WID. `reviewDraft()` instead removes `XS` as a WID and returns two 2-inch welds with blank schedule and WID `XS`. `reviewIssues()` returns no issues, and Confirm and add persists those incorrect fields. `XH` behaves identically. More seriously, `CN-1 has a 1 inch SW` becomes an **XF** group with WID `SW`, not an MT socket-weld fitting, and saves as XF when XF schedule is optional.
- **Impact:** Explicit schedule information disappears, a false WID is recorded, and an MT item can enter the XF numbering stream.
- **Suggested fix:** Parse the complete original group before removing shorthand WIDs, or use the strict parser's constrained shorthand rules. Exclude recognized schedule/type tokens from ambiguous bare-WID extraction. Add tests through deferred reconciliation and field confirmation, including optional fields and `SW`.

### P2 — Counting-aloud commas become separate additions in field review

- **Location:** `assets/notes-parser.js:135` (splitting every comma into a group before strict parsing at line 140).
- **Trigger:** A stopped deferred session contains `CN-1 has 1, 2, 3 2 inch STD welds welded by DD`, with XF size and schedule optional. The strict parser correctly recognizes counting aloud and returns **3** welds. Field review creates three groups with quantities **1, 2, 3**. The first two groups have blank size/schedule and no unresolved wording. All three validate without issues or transcript-confirmation requirements.
- **Impact:** Confirm and add records **6 XF rows**, advances numbering by six, and leaves the first three rows without the spoken size/schedule. Required-field jobs also get spurious extra groups, although mandatory-field errors prevent immediate save.
- **Suggested fix:** Apply the existing counting-aloud interpretation before splitting review groups, or build field drafts directly from strict-parser commands when the complete instruction parses. Test that direct parsing and deferred field confirmation yield the same counts and details for counting-aloud transcripts.

### P2 — Later spool drafts inherit an obsolete WID instead of the preceding spoken assignment

- **Location:** `assets/notes-parser.js:127–133`, particularly line 133's use of immutable `context.welder` on every iteration.
- **Trigger:** Existing context is `{cn:'CN-9',welder:'ZZ'}` and XF WID is required. A deferred session says `CN-1 has 1 2 inch STD weld welded by DD CN-2 has 1 2 inch STD weld`. The strict parser correctly returns WIDs **DD/DD**. Field review returns **DD/ZZ**, with no issues. Confirm and add saves the second spool under ZZ. The same discrepancy occurs for legacy jobs (`fieldRequirements:null`), which retain WID inheritance.
- **Impact:** A valid multi-spool recording attributes later welds to an earlier, unrelated welder, despite a new explicit assignment earlier in the recording.
- **Suggested fix:** Maintain a running draft context across recognized spool parts, updating it when a valid explicit WID is encountered, while retaining configured optional-omission behavior. Prefer strict-parser output for fully understood instructions. Add a multi-spool deferred-review regression for required-WID and legacy jobs.

## Reachability and reproduction

These are not direct-helper-only discrepancies. `notes-voice.js:17–23` queues all stopped deferred sessions for review, including successfully parsed text and interpretation failures. `notes-ui.js:178` builds the field draft, and line 199 commits `reviewCommands()` with `applyGroup()`. No corrupted storage or mocked impossible state is required.

The following Node code reproduces all three persisted outcomes without cloud access (run from ShotTime). It also verifies replay does not duplicate the incorrectly created rows; replay protection itself works.

```js
const assert = require('node:assert/strict');
const M = require('./assets/notes-model');
const P = require('./assets/notes-parser');
const V = require('./assets/notes-voice');
function confirm(text, rules, context = {cn:'', welder:''}) {
  let list = M.createList({id:'review', date:'2026-10-04', lsd:'Test', start:1,
    fieldRequirements:rules});
  list.context = context;
  const session = {id:'s', listId:list.id, state:'stopped', deferred:true,
    interpretError:'timeout', events:[{text}]};
  list = V.reconcile(list, session).list;
  const pending = list.pending[0];
  const draft = P.reviewDraft(pending.text, list.context, rules);
  draft.groups.forEach(g => assert.deepEqual(P.reviewIssues(g, M.requirements(rules)), {}));
  list = M.applyGroup(list, P.reviewCommands(draft, rules), pending.id);
  list.pending = [];
  assert.equal(V.reconcile(list, session).changed, false);
  return list;
}
let rules = M.requirements(); rules.xf.schedule = false;
let list = confirm('CN-1 has 2 2 inch XS', rules);
assert.equal(list.rows[0].welder, 'XS');
assert.equal(list.rows[0].schedule, '');
list = confirm('CN-1 has a 1 inch SW', rules);
assert.equal(list.rows.length, 1); assert.equal(list.mtRows.length, 0);
rules.xf.size = false;
list = confirm('CN-1 has 1, 2, 3 2 inch STD welds welded by DD', rules);
assert.equal(list.rows.length, 6); assert.equal(list.nextSequence, 7);
rules = M.requirements(); rules.xf.welder = true;
list = confirm('CN-1 has 1 2 inch STD weld welded by DD CN-2 has 1 2 inch STD weld',
  rules, {cn:'CN-9', welder:'ZZ'});
assert.deepEqual(list.rows.map(r => r.welder), ['DD', 'ZZ']);
console.log('Reproduced all three field-review data mismatches.');
```

## Verification

Passed all 13 targeted existing Node suites: notes-model, notes-parser, notes-voice, notes-learning, notes-mt, review-fields, required-fields, xh-schedule, shorthand-wid, cn-suffix, cn-letters, voice-variations, modifiers. The existing tests do not cover these deferred-review parity cases. Additional Node probes compared strict-parser commands, extracted fields, validation results, saved rows, numbering and replay. No additional high-confidence correctness findings in model, voice reconciliation or learning were identified in this review. Native speech accuracy and device interaction were not assessed.
