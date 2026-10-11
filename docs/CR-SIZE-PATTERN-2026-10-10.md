# CR chart size adjustment — 2026-10-10

The chart contains a substantial size-dependent pattern after normalizing by the app's T200 density-3 baseline. It is not a constant CR/T200 multiplier. This analysis fits the original chart only; no calculator, T200 baseline, CR Formula setting, original chart entry, or APK was changed.

## Direct evidence at equal steel

All these entries have 1.000 inch total steel. Ratios use the unrounded, default T200 density-3 model at the same geometry.

| NPS / schedule | Chart SFD, inches | CR / T200 |
|---|---:|---:|
| 8 XH | 8.750 | 26.51% |
| 10 XH | 10.875 | 19.49% |
| 12 XH | 12.875 | 17.93% |
| 14 XH | 14.125 | 17.80% |
| 16 XH | 16.125 | 16.34% |
| 20 XH | 20.125 | 16.07% |

The 0.750-inch total-steel STD group independently shows a gentler fall at larger sizes: 19.50%, 18.50%, 17.89%, 16.17%, 16.20% for NPS 12, 14, 16, 20, 24. These are evidence for leveling in this chart, not a measured detector-response law.

## Candidate chart-reproduction equation

Define X as total steel in inches, D as actual source-to-plate distance in inches, S as the chart's reference contact SFD for the pipe size, and A as source activity in Ci. S must remain tied to the pipe size when actual D changes. The app's chart SFD is approximately pipe outside diameter plus 0.125 inch for these NPS 2–24 rows; use the actual stored values, not nominal diameter.

Let B(X,D,A) be the unchanged default T200 density-3 time:

```text
B = (686.4/A) × (D/4.625)^2 × exp[1.455036230266331 × (X − 0.474)]

C = 0.6917308324804667 × exp[−0.2642770979653632 × (X − 0.474)]
    × (S/4.625)^(−1.2533858562019549)
    × max(1,S/12)^(1.0688895912924705)

t_chart_fit = B × C
```

The size factor has exponent −1.2534 below S = 12 inches and −0.1845 above it, continuously joined. Twelve inches here is a fitted breakpoint in reference SFD, not a measured change in radiation physics or exactly NPS 12. A thickness correction is also required; this is not solely a size multiplier with T200's thickness curve fixed.

The equation is an empirical description of chart values. The separate actual-distance term retains D squared. Varying S when moving the source would incorrectly blend the chart size adjustment into the distance law. At identical X and D, different S gives different answers: consequently this is not the size-independent steel-and-distance formula previously requested for arbitrary Custom Shot geometry. It does not explain the cause of the chart's adjustment or demonstrate its physical necessity.

## Fit and withheld-size checks

We used 53 entries across 11 pipe sizes, retaining the same three pre-existing exclusions as earlier research: 6-inch Sch 160, 6-inch XXH, and 24-inch XH. These are sensitivity exclusions, not proof of incorrect exposures; their original values remain unchanged. All 56 entries were separately analyzed below.

Fits minimize equally weighted squared log exposure ratios. Compared model families include fixed-T200 thickness with constant/power/curved size terms, free thickness, a curved thickness term, a size-thickness interaction, reciprocal size, and continuous broken size slopes. The final broken-slope family selects its breakpoint from 6, 8, 10, 12, 14, 16 inches using training log-residual sum of squares.

For the withheld-size check, all entries of each size are removed together, then both breakpoint selection and coefficients are refitted using only remaining sizes. Same-thickness duplicates are withheld together in the separate thickness checks recorded in JSON. Model-family exploration used this same dataset, so these are exploratory internal checks, not an untouched external validation set.

| Check | Entries | Median absolute difference | 90th percentile | Worst | Within 20% |
|---|---:|---:|---:|---:|---:|
| Fit, 53 retained rows | 53 | 5.63% | 18.68% | 25.46% | 49/53 |
| Withhold each whole size; reselect breakpoint | 53 | 7.91% | 26.62% | 45.83% | 42/53 |
| Same check, interior sizes only | 46 | 7.20% | 20.54% | 27.77% | 39/46 |
| Fit including all original rows | 56 | 12.06% | 39.38% | 88.02% | 42/56 |
| Withhold each size, including all original rows | 56 | 14.77% | 38.08% | 92.18% | 33/56 |

The biggest retained-row holdout error is 2-inch XXH, predicted 45.83% above its chart value when NPS 2 is absent. Omitting NPS 2 changes the selected breakpoint to 10 inches; the other retained-data size folds select 12. Including all original entries selects a 14-inch breakpoint and materially changes the curve, showing sensitivity to the unusual entries.

These percentages measure chart reproduction, not acceptable image quality. No new test exposures or plate/scanner measurements were performed. Bounds in the retained data are NPS 2–24 and 0.308–3.188 inches total steel; combinations at the edges or outside these ranges are not validated by this analysis. There is no CR chart anchor for NPS 1 and no validation for applying this size factor to its 12-inch-distance setup.

## Reproduce

```text
node scripts/analyze-cr-size-pattern.cjs --write
```

The script checks its regression against synthetic known coefficients and saves all model coefficients, per-row differences, holdout summaries, and equal-steel groups to CR-SIZE-PATTERN-2026-10-10.json. No runtime files are written. This chart-fit candidate does not replace the released 70%-of-T200 formula.
