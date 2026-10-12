# CR exposure comparison and provisional estimates

## Final geometry clarification: 1-inch only at 12-inch SFD

The owner clarified that for 1-inch spools only, film is against the spool but the source-to-film distance is 12 inches. Other sizes retain the previously confirmed source-contact double-wall arrangement. The app's 1-inch geometry therefore requires no correction.

All 58 missing entries now have provisional estimates in CR-CONTACT-CANDIDATES-2026-10-08.csv. Five remain outside the app's existing total-steel limit. The filename reflects the main technique; its five 1-inch rows explicitly identify the 12-inch SFD exception. None are enabled in the runtime calculator.

For 1-inch, estimate the CR exposure at the target wall using the nearest 2-inch chart references, then multiply by (12 / 2.5)^2 = 23.04. This assumes the app's 2.5-inch reference SFD and comparable detector response/scatter after distance and wall adjustment. It is a transfer estimate, not a measured 1-inch technique. Schedule 10 and STD additionally extrapolate below the reference wall range. No change is made to film baselines or original CR references.

The resulting Ci-second estimates are: schedule 10 = 4,838; STD/40 = 5,125; XH/80 = 5,726; schedule 160 = 6,641; XXH = 7,999. Divide by source activity for nominal seconds. The previously reported chart holdout errors do not validate this 1-inch transfer because there are no 1-inch CR reference shots. Earlier pending-distance statements below are historical and superseded by this clarification.

## Update: contact double-wall technique confirmed

The owner confirmed the source is against the spool and shoots through both walls. The new CR-CONTACT-CANDIDATES-2026-10-08.csv extends the earlier 20-row analysis to 53 provisional candidate exposures. Five 1-inch rows remain blank because the app's 12-inch SFD conflicts with the confirmed contact geometry; no distance was silently substituted. Of the 53 candidates, five exceed the app's existing 90 mm total-steel limit and are explicitly marked. There are 48 candidates within that limit. None have been enabled in the app.

The reproducible read-only analysis is scripts/analyze-cr-estimates.cjs. It uses log-linear wall interpolation between adjacent same-size CR references, and nearest-pair log-linear continuation beyond their wall range. For missing sizes 5 and 18, it interpolates the logarithm of distance-normalized exposures from the adjacent available sizes at the target wall thickness. Distances use the existing app convention (OD plus approximately 0.125 inch) for NPS 2 and above; the exact source/plate offset has not been measured. No film-density or film-factor multiplier is used. Both walls are implicit in the common double-wall reference technique.

Distance-squared normalization is consistent with the inverse-square relationship described by CNSC REGDOC-2.5.5: https://www.nuclearsafety.gc.ca/eng/acts-and-regulations/regulatory-documents/published/html/regdoc2-5-5/index.cfm . This supports the distance correction only, not the empirical CR curve or image-quality adequacy. In log-distance interpolation the normalization is algebraically equivalent to log exposure interpolation versus log distance; it does not independently validate the source data.

The original three anomalous anchors remain excluded. The flat 14-inch STD/S40 pair is retained as supplied and causes its schedule-10 continuation to remain flat at 1,770 Ci seconds; this specific candidate is particularly sensitive to source-chart correction. No candidate is a measured or approved reference exposure.

Withholding each distinct same-size/wall point gives 53 predictions: median absolute relative error 1.88%, maximum 28.13%. Withholding a whole interior pipe size gives 46 predictions: median 3.84%, maximum 17.73%. Duplicate same-wall anchors are removed from the held-out training set. These are checks against chart values, not validation against physical test shots. Extreme-wall extrapolations have no equivalent validation coverage. Historical conclusions below are superseded by this update where applicable; workbook anomalies remain unresolved.

## Original workbook reconciliation

The subsequently supplied `1-EXPOSURE-CHART.xlsx` (attachment directory `a2fcd7e7-09d8-48a2-a1d7-7a07a60d1eb2`) was inspected read-only using its worksheet XML, including formulas and cached values. All 56 CR exposures in CARESTREAM CR!G8:G63 match the app exactly after matching size/schedule labels. It adds no missing CR reference rows.

The anomalies are present in the workbook itself: CARESTREAM CR!A63/G63 identifies 24-inch XS at 85,610 Ci seconds; A24/G24 and A25/G25 give 6-inch S160 at 2,070 and XXH at 1,790. Their intended values cannot be determined from this file alone.

The CR worksheet retains film columns whose labels no longer consistently match their values. For example, CR!A51 is 16-inch XS while I51 is 21,000; the dedicated IRIDIUM AND FILM worksheet assigns 21,000 to 16-inch 80 (A51/I51), and assigns 8,100 to 16-inch SCH40/XS (A49/I49). Film comparisons must join the dedicated film sheet by size/schedule, never copy adjacent CR-sheet film values or match by row number.

Matched dedicated film-sheet references also do not support a constant multiplier: CR/MX125 ratios range approximately 0.163–1.391, and CR/T200 approximately 0.121–2.123. These workbook ratios differ from the app-model ratios below; neither establishes a universal conversion. Original film-sheet values are not silently substituted for the app's calibrated film model.

CR external time is exposure divided by activity (T8 currently 20 Ci), with internal and offset formulas dividing external time by 8 and 3. The file supplies no SFD, wall-path, plate/scanner settings or geometry definition. Therefore the 20 provisional interpolations remain unchanged, and the other 38 gaps remain unsupported. Confirmation of source-to-plate geometry and the anomalous entries is still needed before extending the CR model beyond its reference points.

Analyzed assets/calculator.js and assets/techniques.json on 2026-10-08. No runtime data or reference exposures were changed. These are numerical estimates for review, not validated CR techniques.

## Comparison

There are 114 geometry rows: 56 have CR references and 58 do not. MX125 and T200 share the same attenuation curve; MX125 is T200 multiplied by 2.8/1.7 at equal geometry and target density. Comparing both therefore does not supply two independent predictors. The existing 20% owner baseline adjustment is included in this analysis.

At target film density 3.0, CR/MX125 ratios range from about 0.90 for 2-inch STD to 0.38 for 3-inch XXH. CR/T200 is about 0.93 for 4-inch STD, 0.51 for 6-inch STD and 0.16 for 24-inch STD. A single film-to-CR multiplier is not supported. Film density is used only for comparison; CR remains density-independent.

## Provisional interpolation

The adjacent CSV contains 20 missing entries that can be bounded by existing CR references at the same NPS. Interpolate logarithmic exposure against wall thickness:

E = E_low * (E_high / E_low)^((wall-wall_low)/(wall_high-wall_low))

This is also interpolation against log film exposure within a fixed NPS, because film exposure is exponential in wall thickness at fixed SFD. Equal wall thickness reuses the existing exposure. Calculations use unrounded reference values; CSV values are rounded to the nearest Ci second. Divide exposure by actual source activity in Ci to obtain nominal seconds before any saved CR correction factors.

Leave-one-out checks on 31 interior reference points (excluding same-wall duplicates and the anomalous references below) give median absolute relative error 1.69% and maximum 17.80%. These figures measure agreement with the entered chart, not physical exposure accuracy, scanner response or probability bounds on missing rows. The largest error is 14-inch schedule 40. Its entered exposure equals STD despite a different wall thickness; this also deserves source review.

## Reference anomalies excluded from interpolation

- 24-inch XH: 85,610 Ci seconds at 0.500-inch wall, versus 9,930 at schedule 40 (0.688-inch wall) and 36,050 at schedule 80 (1.219-inch wall).
- 6-inch schedule 160: 2,070 Ci seconds at 0.719-inch wall, versus XXH at 1,790 and 0.864-inch wall. Both are excluded until checked.

No reference was silently corrected or replaced. A typo or different exposure geometry could explain these differences; current files do not establish which.

## Remaining gaps

38 missing entries have no same-NPS enclosing reference pair. These include all 1-inch, 5-inch and 18-inch entries, schedule 10 entries, and the highest-wall missing rows. In particular 1-inch uses a 12-inch SFD, a different regime from the other small pipes. Extrapolating a universal film/CR relationship into these gaps is not justified by the comparison. Five of these rows also exceed the app's existing 90 mm total-steel display limit; that limit remains unchanged.

Before enabling estimates as routine app output, check the anomalous source entries and confirm the CR reference geometry/technique. Preserve all original chart values and visibly identify any enabled estimates on screen and in print. This analysis does not change film factors, user calibrations, source decay, internal/offset rules or the production calculator.
