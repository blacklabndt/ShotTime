# Field CR exposure estimate

> **Removed in 1.98** at the owner's request (2026-10-12). Kept as history. A review showed its PMT gain law is not identifiable from the chart: rescaling the inferred PMT steps refits with identical error and a different gain, so the PMT slider changed times by an unsupported rule. Carestream CR (calibrated) replaces it.

The owner authorized using the printed chart as field reference data and inferring PMT settings from its ranges on 2026-10-11. This supersedes the earlier prohibition on fitting that chart for this new, explicitly estimated option. The measured-calibration option and T200 remain unchanged.

## Formula

For Ir-192 through carbon steel, with total steel X in mm, actual source-to-plate distance D in inches, source activity A in Ci, and PMT setting p:

    time seconds = D² / A × exp(2.2984867845493637
                              + 0.04646684406800626 × X
                              − 0.032323589322692484 × (p − 40))

This is independent of T200. Runtime calculation uses these coefficients, not chart lookups or a size correction. Pipe size supplies only an estimated starting PMT; the operator can choose the actual setting. Custom Shot takes total steel, actual SFD and PMT directly. Equal total steel, SFD, PMT and activity give identical results regardless of wall count.

Effective steel doubling thickness is 14.9170 mm. Relative effective gain is exp(0.032323589322692484 × (p−40)): a 10-point increase implies about 1.382× gain and 0.724× exposure time. PMT is restricted to 20–70 in steps of 10. This is an inferred effective response, not a measured scanner transfer function.

| Pipe size | Estimated starting PMT |
|---|---:|
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
| 6 | 50 |
| 8 | 60 |
| 10–24 | 70 |

Unlisted intermediate sizes interpolate the starting setting, rounded to 10; 1 inch uses 20 and is flagged outside the reference chart. This rule does not alter the inverse-square distance law. Thickness outside 7.8232–80.9752 mm is flagged; the existing 90 mm maximum remains. Existing approximate CR internal/offset divisors remain, and do not constitute a separate geometry validation.

## Evidence and assumptions

All 56 current chart entries are used, including previously questioned rows. The chart is titled Fuji CR ST-VI; the owner reports successful field use with Carestream plates/scanners. The owner's reported successes span 2-inch XH through 10-inch STD, without individual measured pixel readings or exact PMTs. Therefore the 56 entries are reference chart data, not 56 independently recorded successful shots.

The model assumes a comparable image target, one PMT per pipe size across schedules, nondecreasing PMT with size, fixed other scanner settings, an exponential steel response and log-linear gain against the displayed PMT number. These are fitting assumptions, not verified HPX-PRO hardware properties. Plate response, scatter and processing differences may be absorbed into the effective coefficients.

The offline fitter exhaustively enumerates allowed monotone PMT assignments: 20–50 for 2–3 inches, 30–60 for 4–8 inches, 40–70 for 10+ inches. It solves the shared three-parameter log-exposure regression for each assignment, requiring positive gain and a steel doubling thickness between 5 and 30 mm. No chart rows are removed. Near-best alternative assignments are retained in the JSON report. The second candidate changes 6-inch PMT from 50 to 60 with a similar error; its actual setting is not identifiable from this fit alone.

## Validation

| Evaluation | Median absolute error | 90th percentile | Worst | Within 20% |
|---|---:|---:|---:|---:|
| All entries included in fit | 7.6% | 18.0% | 41.0% | 51/56 |
| Withhold one entry, refit PMTs and coefficients | 8.8% | 22.9% | 48.2% | 47/56 |
| Withhold an entire pipe size, refit, infer its PMT from neighboring sizes | 11.3% | 24.5% | 44.5% | 45/56 |

These quantify chart prediction, not image quality or independent field validation. They do not establish superiority over a manufacturer curve. Largest full-fit discrepancy is 6-inch XXH/XXS (+41.0%). The data do not support claiming universal accuracy or an absolute 2,500-pixel target. No numeric pixel selector is enabled for this model.

Run `node scripts/cr-field-fit.cjs` to regenerate `CR-FIELD-FIT.json`, including per-row predictions and withheld predictions. Run `node tests/test-cr-field-fit.cjs`, `node tests/test-cr-field.cjs`, and `node tests/test-cr-field-ui.mjs` for synthetic recovery, coefficient parity, physical invariants and UI behavior. Browser tests use CHROME_BINARY when a bundled Playwright browser is unavailable.

## App integration

Select **Carestream CR (field estimate)** in either belt or Custom Shot. Field PMT controls use their own `fieldPmt.<size>` settings, so measured calibration data and its sliders are not overwritten. Saved Custom Shot setups retain PMT. Print includes the PMT used and identifies the field estimate. Existing film and CR selections are preserved; no automatic migration changes a selected film.

No APK release, Drive upload, or new physical exposure validation is included in this change.

## Verification record — 2026-10-11

- Full `npm test` passed with installed Chrome (`CHROME_BINARY`), including calculator, custom-shot, print, storage, code-chart and notes suites.
- The final field-specific CJS and browser suites passed after the review fixes to median calculation and print wording.
- Direct evaluation against the starting Git revision produced bit-identical results for all 2,280 existing pipe/film/density combinations, including T200. Existing fixtures additionally cover 525 custom results.
- The old serialized film fixture had a one-ULP mismatch on this runtime (203.46893363071024 versus 203.4689336307102, with both old and new code producing the latter). Its assertions now allow a 1e-12 relative tolerance; no film formula was changed.
- Independent read-only review found no critical issues. Both findings (print labeling and even-count median calculation) were addressed.
