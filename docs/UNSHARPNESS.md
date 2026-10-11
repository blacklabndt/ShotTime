# Geometric unsharpness calculator

Owner approved the screen design on 2026-10-08. Separate menu entry follows Code Calculator. Calculation and reference text work offline. No external navigation, network calls, permissions, or storage schema changes.

## Calculation and interface

`assets/unsharpness.js` is a pure, CommonJS/browser module. All returned lengths are mm. Ug = F*d/D, source-to-image = D+d. D is measured to the source-side surface of the evaluated weld; d is measured from that surface to the image plane. Do not substitute total pipe diameter or air gap automatically. F is the maximum projected active source/effective focal-spot dimension. Dimensions must be positive and finite.

`assets/unsharpness-ui.js` owns the form, original schematic and result display. Input units convert physical dimensions on switching. Code-table basis is deliberately independent: metric by default, with a published-inch option. This avoids silently mixing independently rounded code bands/thresholds or changing the check when only input display units change. Minimum distances in the selected display unit are rounded upward to 0.001. Results clear on any input/reference change. No overall radiograph or weld pass/fail is asserted.

## Verified reference basis

Research copies are reproductions of primary code text on third-party mirrors, not publisher-authenticated downloads. The app shows editions and clauses, and does not claim that the chosen technique edition is automatically the contractually governing edition.

- ASME V (2025), Article 2 T-274.1: formula and source-side surface definitions. T-274.2: recommended Ug maxima, IQI basis thickness. Metric bands: <50 / 50–75 / >75–100 / >100 mm, maxima .51 / .76 / 1.02 / 1.78 mm. Separate published inch bands: <2 / 2–3 / >3–4 / >4 in, maxima .020 / .030 / .040 / .070 in. CR: Mandatory Appendix VIII, VIII-210 retains unmodified Article 2 rules and uses the phosphor imaging plate as the image plane. Detector/scanner unsharpness is not calculated.
  https://studylib.net/doc/28452860/asme-sec-v-2025-250704-103146
- B31.3-2024, 344.5.1: weld RT follows Section V Article 2. Show recommendation, not blanket rejection. This reference is common to normal and severe-cyclic service technique; their acceptance rules remain in the existing Code Calculator.
  https://studylib.net/doc/27696061/asme-b31.3-2024
- B31.1-2012, 136.4.5: T-274 guide; explicit rejection above .07 in / 2.0 mm. Retain the owner's accepted 2012 edition. Do not substitute 1.78 mm for the published metric threshold.
  https://nfpa.isolist.cfd/asme/ASME%20B31.1%202012.pdf
- Section I (2025), PW-51.1: guide except rejection above .07 in / 1.8 mm. Distinct from B31.1's metric threshold.
  https://nfpa.nfpadata.engineer/asme/ASME%20BPVC.I%20%28ASME%20BPVC%20Section%20I%29%202025.pdf
- VIII-1 (2025), UW-51(a)(3): film-only guidance exception; do not extend it to CR. Other image quality requirements still apply.
  https://studylib.net/doc/27845866/asme-bpvc.viii.1-2025
- IX (2025), QW-191.1.1(a),(b): Article 2 with exceptions and IQI-based final image acceptance. Show Ug guidance, not an independent qualification decision.
  https://studylib.net/doc/28551319/asme-bpvc-ix-2025
- CSA Z662:23, March 2024 research copy, 7.14.2.1–2: imaging media close to weld; source-to-image >=7d, preferably >=10d, where d extends to the farthest weld surface. Derived minimum D=6d, preferred D=9d. No numerical Ug ceiling assigned. Sweet/sour share this geometry check; Clause 16 acceptance is separate. Verified against local PDF page 265, printed 259, including the preference note. See docs/CSA-SOUR-SOURCE-REVIEW.md for hash and source URL.

## Verification

Version 1.92 clarifies the result: actual Ug, recommended maximum or code limit, margin below/amount above maximum, and source-to-weld/source-to-film or plate distances. CSA shows actual, minimum 7× and preferred 10× source-to-image distances with separate preferred status. Exceeding a recommendation is never labeled an overall radiograph failure. Distance adjustment assumes unchanged source size and weld-to-image distance. Detailed references, formulas and thickness bands are collapsed initially. Calculation rules and code editions are unchanged.

`npm run test:unsharpness` covers independently calculated geometry, both unit systems and code-table bases, exact thickness boundaries, metric overrides, film/CR semantics, CSA 7× and 10× geometry, validation, stale result removal, references, three mobile widths and Back navigation. It runs automatically before `npm test`.

Native wrapper and test helper inline both new assets. App network restrictions and source/timer/QC data remain unchanged. Browser tests cannot establish Android handset rendering or field technique suitability.
