# RT Helper test.33 calculator review

Reviewed 2026-10-04. Read AGENTS.md and HANDOVER.md, including current dated sections. Scope: calculator model, geometry generator/data, calculator UI, calibration, settings persistence, and generated print documents. Approved MX125/T200 1.2 baseline and owner's CR chart were treated as requirements; this is implementation review, not physical exposure validation. No product files changed.

## Findings

### CAL-1 — P2: Invalidate the helper proposal when its size/schedule factor changes

Location: `assets/index.html:210–211` (proposal creation/save), `assets/index.html:220–221` (size/schedule save/reset).

The helper divides out the current size/schedule factor when building `helperPending`, but stores only film/density/factor. Saving or resetting that size/schedule factor leaves the proposal and its Save button active. Saving the old proposal then applies a film factor derived from an obsolete multiplier, contrary to the displayed promised shot time.

Reproduced against the injected app in Chrome: enter 26 Ci; review a successful 30-second D5 shot on 4-inch 40 / STD at density 3 with the default row factor 1. The proposal is 1.5789473684210527 and says “Time for density 3.0 on this pipe at 26 Ci: 30s”. Without editing the helper fields, save the same pipe/film/density's size/schedule factor as 2. The proposal remains visible and still says row factor 1. Save this factor: corrected exposure divided by 26 is **60 seconds**, not 30. Both disclosure panels can remain open, so this sequence is available through normal controls.

Invalidate/recompute the proposal after a dependent row-factor change, or snapshot its technique and multiplier and revalidate before saving. Existing helper tests do not change a row factor between Review and Save.

### CAL-2 — P2: Legacy full-filter detection overrides current saved exclusions

Location: `assets/index.html:117`.

`setupChoices` treats every saved array containing all pre-1.21 choices as “All” on every startup, including arrays intentionally saved by the current schema-2 UI. This loses valid exclusions and changes the displayed/printed rows after restart.

Reproduction: select all schedules, deselect only 10, then restart/reload. Before reload the saved/current choices are STD, 40, 60, XH, 80, 100, 120, 140, 160, XXH. After reload, **10 is selected again**. The same logic affects pipe selections retaining all original sizes but excluding newer sizes. The existing suite tests legacy compatibility, but not current user exclusions that happen to equal the old full list.

Apply this interpretation only during an identifiable migration, rather than reinterpreting current saved selections on every load.

### CAL-3 — P3: In-app reference explanation still advertises pre-test.27 baselines

Location: `assets/index.html:59`.

“Chart setup & calculation details” still gives T200 reference times as 14, 18, 22, 25.5, 29 seconds, and the density-3 MX125 3-inch STD example as 21 seconds. Current approved defaults are T200 16.8, 21.6, 26.4, 30.6, 34.8 seconds and the displayed MX125 example 25 seconds. `assets/calculator.js:54` correctly applies the authorized 1.2 change; current calculator/browser tests pin the new results. Update the explanatory copy to match, so users checking/calibrating against the app's stated references do not see contradictory numbers.

### CAL-4 — P3: Restoring a CR helper draft leaves film-density fields visible

Location: `assets/index.html:272` (helper field restoration; missing refresh after restored film selection).

Draft restoration calls `helperGeometry()` before restoring `helper-film`; geometry refreshes density visibility for the initial film. Restoring the saved film subsequently assigns the select value without calling `showHelperDensity()`. Reproduced: select CR in the calibration helper on 4-inch pipe; measured-density input is hidden. Capture/reload the normal draft: the film still reads `cr`, but `helper-measured.hidden` is now false (density label/input and target-density controls appear). Thus CR exposes irrelevant film-density prompts after restart. The save calculation still ignores the measured density for CR, so this is a UI inconsistency rather than changed exposure math. Refresh helper field visibility after restoring the film.

## Verification

- `node tests/test-current-calculator.cjs`: PASS (1,710 film/density combinations, 30 reference targets, shared model/ratios, geometry, rounding/date validation, 56 CR chart rows).
- `CHROME_BINARY=C:/Program Files/Google/Chrome/Application/chrome.exe node tests/test-current-ui.mjs`: PASS.
- Same Chrome override with `node tests/test-settings-storage.mjs`: PASS.
- Additional read-only browser probes through `tests/load-app.mjs` reproduced CAL-1, CAL-2 and CAL-4 with normal DOM events and reload; CAL-3 is directly contradicted by the passing reference tests/model.
- Initial browser launch without CHROME_BINARY failed because Playwright's bundled browser was absent; rerunning with installed Chrome succeeded.

No discrepancy found in the authorized baseline math, CR chart handling, current screen/print value equality, or generator/data structure in this review. Native Android print lifecycle was outside this subreview; browser results do not validate it.
