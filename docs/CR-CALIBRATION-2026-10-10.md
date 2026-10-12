# CR calibration using total steel and distance — 2026-10-10

**Later update:** the owner separately requested a fixed 70%-of-T200 CR formula. See [CR-FORMULA-70.md](CR-FORMULA-70.md) for the new independent cr70 option in both calculators. The chart-fitted research model discussed below remains outside the app. Statements below about app availability and original source hashes describe the earlier research stage; this new option leaves the underlying T200 and original CR chart values unchanged.

The research model now accepts **total steel penetrated and actual source-to-detector distance**, with activity converting exposure to time. Pipe size, schedule and wall count are not predictor inputs. This corrects the earlier size-dependent interpolation model. A single-wall and a double-wall shot with the same total steel and actual distance receive the same estimate.

**The fitted curve does not closely reproduce the chart, but this comparison does not establish whether its proposed exposures would produce acceptable CR images.** The corrected fit has a 52.99% median absolute difference from chart values when each pipe size is omitted in turn. The old model's small holdout differences described pipe-size interpolation and are superseded; neither set of percentages is an image-acceptance test.

The owner clarified that CR is forgiving of exposure-time variation. Treat successful chart shots as examples within an acceptable exposure range, not as exact measurements of one common target dose. The 10% and 20% comparison bands are descriptive bins only, with no established CR acceptance meaning. Across all 56 chart entries, 42 differ from the fitted curve by more than 20%; this is not a count of failed or incorrect exposures. Neither the chart nor the formula has been demonstrated physically wrong by these differences. A 70%-of-T200 target has not been established by this analysis either.

The corrected implementation is in [cr-calibrated-model.cjs](../scripts/cr-calibrated-model.cjs). It remains research only, outside the Android app. T200 and all existing film calculations, the 56 CR chart values and the app's current Custom Shot behavior are unchanged. CR has not been enabled in Custom Shot. Existing film Custom Shot already takes total steel and actual distance.

## Owner-confirmed evidence and unresolved mismatch

The owner reports successful CR shots from 2-inch XH through 10-inch STD and confirmed that the actual endpoint source-to-plate distances were 2.5 and 10.875 inches. Those distances have been retained. The chart exposure values below are the references being assessed; the report does not assume that every intermediate chart row or image-quality target has been separately verified.

| Reference | Total steel (in) | Actual SFD (in) | Chart exposure (Ci seconds) | Exposure / SFD squared |
|---|---:|---:|---:|---:|
| 2-inch XH | 0.436 | 2.500 | 273 | 43.680 |
| 10-inch STD | 0.730 | 10.875 | 1,340 | 11.330 |

The thicker reference has approximately one-quarter of the distance-normalized exposure of the thinner reference. A curve that increases exposure with steel thickness cannot reproduce both exactly at these distances. Fitting only these two references would require decreasing exposure as steel increases, which the research model rejects.

Accepted images are not necessarily measurements of the same target exposure or image quality. These two entries cannot establish one increasing thickness curve that closely reproduces both times as exact targets; they can nevertheless both be acceptable CR exposures. They do not identify the lower and upper bounds of the acceptable exposure range. Rejection of their two-point fit is a model constraint, not a rejection of the successful shots.

A separate equal-steel example is 8-inch XH versus 20-inch XH: both represent 1.000 inch of total steel. The chart gives 1,400 Ci seconds at 8.75 inches and 4,490 at 20.125 inches. Transferring the first by distance squared gives 7,406 at the second distance, 65% above its chart entry. The actual SFDs for these two examples were not separately confirmed.

Carestream describes the [HPX-1 Plus system](https://www.carestream.com/en/us/nondestructive-testing-ndt-solutions/carestream-industrex-hpx-1-plus-digital-system) as having a wide dynamic range. Its [industrial imaging-plate guidance](https://www.carestream.com/en/us/-/media/publicsitev2/resources/ndt/white-papers/carestreamndt_whitepaper_imagingplates_7600700_072023_ltr_en_lores.pdf?display=inline&sc_lang=en-us) describes dose response, adjustable image presentation, plate/reader settings, noise and contrast sensitivity. These support assessing CR by achieved image quality rather than an exact film-density target. They do not establish an acceptable percentage error, an exposure range for this setup, or a universal CR/T200 ratio.

## Corrected formula

Let x be **total steel in inches**, d the actual source-to-detector distance in inches and A the activity in Ci. The unchanged default T200 density-3 baseline is:

~~~text
B(x,d) = 686.4 × (d / 4.625)^2 × 2^[(25.4 × x − 12.0396) / 12.1]
~~~

The reference is 0.474 inch total steel at 4.625 inch SFD, giving 686.4 Ci seconds. The existing 20% T200 baseline adjustment is already included. The research normalization does not inherit editable T200 settings.

The CR correction is fitted by ordinary least squares on the log ratio:

~~~text
ln(E_CR,j / B(x_j,d_j)) = a + b × (x_j − 0.474)

E_CR(x,d) = B(x,d) × exp[a + b × (x − 0.474)]
t_CR(x,d,A) = E_CR(x,d) / A
~~~

Using the 53 retained chart references gives:

~~~text
a = -0.7296374624502384
b = -0.7379213216080468 per inch
~~~

These are exploratory coefficients, not recommended operating values. Fitting b allows the CR curve's thickness dependence to differ from T200 while leaving T200 itself untouched. The resulting empirical exposure-doubling thickness is 24.55 mm; it must not be interpreted as a measured physical steel half-value thickness. A second comparison retaining T200's exact thickness curve and fitting only one multiplier performs worse.

Double distance gives four times the exposure; double activity gives half the time. Wall count does not add a factor. For a chart's double-wall pipe row, the importer sets x = 2 × wall. For a custom single-wall shot, x is the entered steel path directly. There is no pipe-size correction or special one-inch-pipe transfer in the generic predictor.

If references have only one distinct thickness, the model can calibrate only a multiplier and explicitly reports that the thickness curve is inherited from T200. It rejects a fit with non-increasing exposure versus total steel.

## Chart comparison

The same three entries flagged in the earlier trend comparison remain excluded from the principal fit: 6-inch Sch 160 (2,070 Ci seconds), 6-inch XXH (1,790), and 24-inch XH (85,610). These exclusions reproduce that analysis and do not establish invalid CR exposures. Their original values remain in the app and JSON comparison. Including all 56 entries gives median absolute chart difference 45.74%, worst 156.12%.

The 53 retained references cover 36 distinct total-steel values, from 0.308 to 3.188 inches. Every retained chart row receives equal weight; duplicated thicknesses remain observations. Thickness holdout removes every reference at the target thickness, across all pipe sizes. Size holdout removes every reference at the target pipe size. Both refit the model on the remaining references; neither includes the target in training.

| Comparison | Rows | Median absolute error | 90th percentile | Worst error | Within 10% |
|---|---:|---:|---:|---:|---:|
| Fit to retained chart | 53 | 48.05% | 103.11% | 143.21% | 9/53 |
| Omit each total-steel thickness | 53 | 49.62% | 127.08% | 180.95% | 7/53 |
| Omit each whole pipe size | 53 | 52.99% | 116.56% | 160.65% | 6/53 |
| Keep T200 thickness curve; omit each size | 53 | 73.10% | 122.14% | 158.38% | 1/53 |

These errors measure numerical differences from the source chart. The fit minimizes those differences by treating each chart time as an exact target; it does not fit a measured acceptable-exposure interval. Thus it measures chart reproduction, not CR image acceptability. This comparison alone neither validates nor rejects the proposed times for actual use, and supplies no basis for replacing confirmed chart times.

For example, at 26 Ci the 2-inch XH chart value is 10.5 seconds, whereas the corrected fit gives 3.62 seconds. The 10-inch STD chart value is 51.54 seconds, whereas the fit gives 84.55 seconds. Thus the existing CR times would **not** stay relatively similar under this fit. These examples demonstrate model disagreement, not proposed shot instructions.

The evaluator includes all 114 chart geometries. It generates research estimates for 53 missing rows within the existing 90 mm steel limit; five other missing rows exceed that limit and return no estimate. Producing a number is not evidence of reliability. The existing diagnostic named inconsistent-reference-data means a model-to-reference difference above the descriptive 20% threshold; its name must not be interpreted as proof of bad source data or unacceptable images. Steel outside the fitted 0.308–3.188 inch range also carries a thickness-extrapolation flag.

## Implementation and reproduction

~~~text
node tests/test-cr-calibrated-model.cjs
node scripts/evaluate-cr-calibration.cjs --write
node tests/test-current-calculator.cjs
node tests/test-custom-shot.cjs
~~~

The evaluator writes [CR-CALIBRATION-2026-10-10.json](CR-CALIBRATION-2026-10-10.json), including the full fit, omitted-reference predictions with training identifiers, equal-steel comparisons, confirmed endpoint distances, all 114 estimates and production hashes. It asserts that the dated production inputs remain unchanged.

The predictor requires an explicit fitted profile; it does not silently default to the chart fit. This synthetic example illustrates single-wall use without recommending the chart coefficients:

~~~javascript
const M = require('./scripts/cr-calibrated-model.cjs');
const syntheticProfile = M.fit([
  {id:'example-a', totalSteel:0.5, sfd:10, ciSeconds:100},
  {id:'example-b', totalSteel:1.5, sfd:10, ciSeconds:200}
]);
const result = M.shot({totalSteel:1.0, sfd:20}, 26, syntheticProfile);
// result.seconds ≈ 21.76, using synthetic data only.
// Always inspect status, flags and null estimates.
~~~

A useful operational profile should target acceptable CR image quality, retaining the total-steel calculation and distance-squared/activity scaling. Reference records should capture the steel path, actual SFD, source activity and time, applicable detector/readout conditions and image-quality result. Successful shots provide acceptable points; additional image-quality information is needed to establish exposure margins. No numerical acceptance interval can be inferred from the chart alone. Changing between one wall and two is not itself a reason to require a different formula. T200 remains unchanged.

## Verification

The corrected model, evaluator assertions, current calculator suite and Custom Shot suite passed. Checks cover independent synthetic dose curves, total steel without a wall-count dependency, distance squared, inverse activity, decreasing-curve rejection, duplicate/invalid references, steel limits, chart disagreement and unchanged film/chart data. These are software and chart-consistency checks; no new physical exposures were made.

Production hashes are unchanged:

- assets/calculator.js: 73118331313c188e3dfe8abdc955c4b86a7a0d4ae5b470ac1a3692d08cdbbfaa
- assets/techniques.json: 8e3d4615a77793b626cd25b31cd0ebd3a65370c864f980eba296bd7b14f71bc3
- assets/index.html: 7b8b29ecc76d68b26c90ad1b84ef1ccf533cb145ff4416c40fc5d2e68881c57f
