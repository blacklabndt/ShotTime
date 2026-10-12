# Code Calculator implementation review (test.48)

**Superseded in part by unreleased repairs:** see CODE-CALCULATOR-REPAIRS.md and APPENDIX4-STATUS.md. B31.1 no longer executes workbook formulas; Section I reinforcement and A-250 references are now implemented. The historical gaps below describe test.48.

Requested menu position: fourth, after Pipe Schedule Chart and before QC Notes.
Workbook: NDE Acceptance Code Calculator Ver. 1.2, updated 2014-10-10.
Nine calculation sheets: B31.3 Normal/Severe (2012), CSA Z662 Sweet/Sour (2011), B31.1 (2012), VIII UW-51/UW-52, IX and I (2013).
Extracted 161 formulas into an AST with a restricted parser. Only the explicitly legacy B31.1 profile uses workbook calculations. Current profiles use dedicated functions in assets/code-calculator.js. Missing cells, invalid outputs and dependency cycles resolve to unavailable, never zero. The app supplies reference limits, not automatic weld acceptance.

## Owner edition decision, 2026-10-05

Retain B31.1 from the supplied workbook (2012 edition) for this implementation, as explicitly requested by the owner. Label the selector and results "ASME B31.1 - 2012 (workbook)". Do not block the calculator on obtaining B31.1-2026, and do not relabel these rules as 2026. This exception applies only to B31.1; continue checking newer editions for the other codes. Retaining the old edition does not authorize reproducing known spreadsheet errors: unresolved reinforcement, IQI and conflicting MT/PT spacing results must remain unavailable rather than defaulting to zero or guessed limits.

## Latest editions checked on publisher pages, 2026-10-05
- ASME B31.3-2024: https://www.asme.org/codes-standards/find-codes-standards/b31-3-process-piping
- ASME B31.1-2026: https://www.asme.org/codes-standards/find-codes-standards/b31-1-power-piping
- CSA Z662:23: https://www.csagroup.org/store/product/CSA%20Z662:23/
- ASME BPVC 2025, Sections I, V, VIII Division 1 and IX: https://www.asme.org/codes-standards/bpvc-standards/bpvc-2025
Publisher listings verify edition identity, not acceptance limits. Selected clauses were subsequently read in reproductions of the primary documents listed below. Complete documents, all referenced figures, and later errata were not verified. Do not describe this release as complete current-code compliance.

## Workbook discrepancies requiring resolution
- B31.1, VIII UW-51/UW-52 and I IQI formulas refer to empty AK27 rather than a populated reinforcement result.
- IX IQI formulas refer to empty AK22; IX reinforcement AK19 tests empty I7 rather than thickness I4.
- ASME EN source-side IQI AS6 jumps to wire 13 in the 60.3-to-under-76.2 band.
- CSA EN IQI AS5/AS6 return wire 19 in the 18-to-under-25.4 band before the small-NPS adjustment.
- IX slag description specifies 6 mm/19 mm breakpoint but AD12 calculates 3 mm/10 mm breakpoint.
- IX internal porosity wording caps at 3 mm but AD17/AR17 formulas cap at 4 mm.
- B31.1 reinforcement is not calculated; excessive penetration AD15 points to empty AK21. Temperature-dependent reinforcement table exists separately.
- B31.1 MT/PT aligned rounded indication text says 1.5 mm spacing but numeric cells say 1.6 mm.
- Some out-of-range IF branches return FALSE; these must be unavailable results rather than zero dimensions or a fabricated IQI set.
- Several rows are explicitly workbook-author recommendations, not code requirements; preserve that distinction.
- CSA short-weld cumulative rules exist in notes but are not applied by the workbook formulas. A complete current implementation needs weld length and the current clauses.

## Implemented app flow
Fourth menu item: Code Calculator. Select code/service/edition, thickness in mm or inches, evaluation length where needed, CSA NPS, and VIII reinforcement category. Optional ASME IQI input is representative total ID + OD reinforcement; optional CSA IQI input is weld thickness and radiation type. Cards separate length/width/depth, cumulative spans, conditions, and clause references. Editing an input hides stale results. Results use metric code values; inch displays are conversions, not US customary code tables. No saved-state/schema changes.

## Coverage and remaining limitations

| Profile | Implemented basis | Remaining manual checks |
| --- | --- | --- |
| B31.3 normal / Category M, severe cyclic | 2024 Table 341.3.2-1; girth butt welds with filler, excluding aluminum | Appendix 4 rounded indication sizes/distributions; service/design applicability; visual checks |
| CSA sweet | 2023, March 2024 revision: selected 7.11 clauses, Tables 7.8-11 | Sour/alternative/partial-penetration scope and unequal-thickness IQI excluded; distributions, company requirements and approved procedure |
| CSA sour | 2023, March 2024 revision: shared 7.11 limits, 16.6.8.1 and 16.9.3 root restrictions | Confirm 16.1-16.2 applicability; 16.9 examination/design requirements are conditional on 16.9.1. Hardness, repair qualification, alternative criteria and unequal-thickness IQI are not calculated |
| B31.1 | Supplied 2012 workbook, explicitly retained at owner's request | Reinforcement and related penetration result, unsupported undercut numeric value, conflicting MT/PT spacing, and IQI withheld |
| VIII-1 UW-51 / UW-52 | 2025 elongated/aligned limits and UW-35-1 reinforcement categories | Appendix 4 rounded criteria/charts for full RT; sampling/retests; MT/PT appendices not implemented |
| IX qualification | 2025 QW-191.1.2.2 elongated, aligned and rounded numeric limits | Rounded-distribution chart; qualification scope/technique requirements |
| Section I | 2025 PW-51.3 elongated/aligned limits | A-250 rounded criteria, PW-35 reinforcement, MT/PT and surface checks |
| ASME film IQI | Independent, explicitly labeled V-2025 T-276.2 and Table T-276 | Correct referencing edition, material/placement, representative reinforcement, image-quality verification; no unverified ISO conversion |
| CSA IQI | Z662:23 Table 7.10 X-ray / 7.11 gamma; ISO wire size and diameter | ASTM equivalent and placement; optional small-pipe relaxation deliberately not assumed |

Key checked corrections: B31.3 normal fusion/IP combined cumulative cap and linear 8% cap; B31.3 reinforcement at 6/13/25 mm; IX maximum rounded size min(0.2t, 3 mm); CSA burn-through min(t, 6 mm), small-pipe slag limits, short-weld and combined-defect caps; V IQI inclusive upper boundaries and corrected thickness bands. UW-52 accepts individual indications strictly below 6 mm and rejects those above 19 mm; its raw 2t/3 value is accompanied by these conditions rather than a misleading clamped maximum. Its radiograph length input enforces 150 mm minimum.

No code acceptance, radiographic technique or real-world inspection outcome is validated by software tests. CSA labels now identify the March 2024 revision; other profiles retain their stated coverage and errata limitations. This is a test release of a reference calculator with the limitations shown in the UI.

## Verification and regeneration

- `node tests/test-code-calculator.cjs`: independently specified boundary cases, short-weld caps, metric/inch equivalence, IQI thresholds, unavailable legacy results and cyclic references.
- `node tests/test-code-calculator-ui.mjs`: fourth menu position, validation, edition labels, stale-result hiding, category selection, CSA/ASME IQI, 320/393/430px layout and navigation.
- Regenerate the imported workbook data with `python scripts/extract-code-workbook.py path/to/workbook.xlsx` using openpyxl. The script reads formulas as data and rejects unsupported tokens; it does not execute formulas or macros.
- Full-suite/build results are recorded in docs/CODE-CALCULATOR-TEST.md after execution.

## Broader source search (user requested)
Readable third-party reproductions found; edition markings and some acceptance clauses observed, but completeness, tables/figures and transcription accuracy are not yet verified. Do not equate discovery with validated implementation.
- B31.3-2024: https://studylib.net/doc/27696061/asme-b31.3-2024
- CSA Z662:23: https://studylib.net/doc/28518264/csa-z662-23
- BPVC VIII-1 2025: https://studylib.net/doc/27897363/asme-sec-viii-div1-2025 (may be partial; check appendices)
- BPVC IX 2025: https://studylib.net/doc/28042843/asme-sec-ix-2025
- BPVC I 2025: https://studylib.net/doc/27910395/asme-i-2025
- BPVC IX 2025: https://studylib.net/doc/28042843/asme-sec-ix-2025
- BPVC V 2025: https://studylib.net/doc/28523225/asme-sec-v-2025
- B31.3 table cross-check in a separate primary-document reproduction: https://previewnorm.com/asme/ASME%20B31.3%202024.pdf (printed pp88-90).
- B31.1-2026 reseller listing: https://www.dinmedia.de/de/norm/asme-b31-1/406568646 . No accessible 2026 clause text found yet. 2024 text exists but is not interchangeable with 2026.
- CER free-access announcement is historical; verify present eligibility/availability before claiming free access in October 2026.


## Test.48 CSA source follow-up

The complete March 2024 reproduction resolves the missing sour chapter. See CSA-SOUR-SOURCE-REVIEW.md for source identity and page verification. Checked 7.11 acceptance text and Tables 7.10/7.11 against the existing shared calculation; removed the obsolete CSA errata warning for this checked revision. This does not mean every code requirement is implemented.
