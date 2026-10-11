# Independent CR formula — 2026-10-10

> **Removed in 1.97** (owner request, 2026-10-11). Replaced by Carestream CR (calibrated); see CR-CALIBRATED.md. Kept as history.

The owner requested an independent CR formula producing approximately 70% of the equivalent T200 shot. The implementation uses the current T200 **density-3.0 default baseline** as the reference for setting CR's constants, then calculates CR independently. T200's formula, baseline and saved settings are unchanged.

Select **Carestream CR Formula** in either belt of Shot Time Calc or in Custom Shot. The existing **Carestream CR** selection continues to use the original chart. Existing selections and chart corrections are preserved.

## Equation

For Ir-192 and the existing steel model:

~~~text
t_CR = (480.48 / A) × (D / 4.625)^2 × 2^[25.4 × (X − 0.474) / 12.1]
~~~

- t_CR: exposure time in seconds, before display rounding.
- A: source activity in Ci.
- D: actual source-to-film/plate distance in inches.
- X: total steel penetrated in inches.
- 480.48 Ci seconds: CR's fixed reference, selected as 70% of 686.4 Ci seconds.
- Reference geometry: 0.474 inch total steel, 4.625 inch SFD.
- Steel exposure-doubling thickness: 12.1 mm, independently stored in the CR reference.

Two 0.5-inch walls and one 1-inch wall both use X = 1. They give identical results at the same actual distance and activity. Doubling distance multiplies time by four; doubling activity halves time. Display rounding happens after the calculation.

At the reference geometry and 26 Ci, T200 gives 26.4 seconds and CR Formula gives 18.48 seconds (displayed as 26s and 18s). Thus the unrounded ratio is exactly 70%; rounded display values can differ slightly from that percentage.

## Independence and settings

CR's reference is frozen separately in assets/calculator.js as CR_REFERENCE. It does not call the T200 calculation or read T200's saved factors. Future T200 edits will not silently alter CR.

CR has no density target. Changing the selected film density does not change CR Formula, and Custom Shot hides its density field for CR. The 70% comparison is specifically against the unadjusted T200 density-3 baseline, not every film density or an individually adjusted T200 result.

The new selection uses its own factor.cr70 and weld.cr70.* settings. Existing factor.cr, weld.cr.* and T200 factors are not applied to it. CR's independent factor defaults to 1.00; changing it intentionally changes the 70% relationship. Custom Shot applies the formula's film-wide factor only, with no pipe size/schedule correction.

The existing 90 mm total-steel limit remains. Normal pipe rows pass twice their listed wall thickness into the formula. Custom Shot passes the entered full steel path directly. The main calculator retains the existing CR internal/offset conventions; Custom Shot calculates directly for the entered geometry.

Saved Custom Shot setups support CR Formula, both inch/mm display modes and the current source. Settings schema remains 2; preset schema remains 1 because the structures are unchanged and the new formula has a separate identifier.

This 70% baseline is the owner's chosen starting setting, not a manufacturer-specified universal CR/film ratio or a fit to the original CR chart. The earlier chart-fit research model is separate and is not used by this formula.

## Verification

Passed: the full npm test suite with installed Chrome, including both new CR suites and all existing calculator, storage, print, code, unsharpness and notes checks. The earlier CR research-model test and regenerated comparison report also passed with unchanged calibration inputs. No handset exposure validation or APK build was performed.

The new unit suite tests the 70% relationship across all 109 supported pipe geometries, the independent 480.48 reference, distance squared, activity, total steel, input limits and isolation from changes to T200 references.

The new browser suite covers both belts, Custom Shot, hidden density controls, inch/mm equivalence, saved CR setups, independent persisted factors, printing and narrow layouts. Existing calculator tests pin all 1,710 film/density combinations and all 56 original CR chart entries.

~~~text
node tests/test-cr70.cjs
node tests/test-cr70-ui.mjs
npm test
~~~

For browser tests, set CHROME_BINARY to an installed Chrome executable when the Playwright browser bundle is absent. Packaged and signed as RT Handbook 1.96 (version code 118). See [release verification](../dist/BUILD-VERIFICATION-1.96.md). Uploaded to My Drive through the browser on 2026-10-10; upload completion and exact file size verified. See release verification for the Drive link and screenshot.

