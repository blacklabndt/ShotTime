# Code calculator gaps repaired — 2026-10-05

Source-only changes after test.50. No APK packaged.

## Source coverage

- Section I PW-35.1: 2025 primary-document reproduction, printed p111: https://studylib.net/doc/27910395/asme-i-2025 . Column layout independently inspected on the readable 2019 PDF p114. Circumferential pipe/tubing and other-weld columns must not be swapped. Width-dependent limit applies to pipe/tubing above 50 mm, not other welds.
- Section I A-250.2–3: complete 2019 primary PDF, printed pp270–277: https://www.ipgmservicios.com/wp-content/uploads/2024/03/ASME-SEC-I-2019.pdf . Numerical reference now available with accurate edition provenance in expandable result basis. The available 2025 reproduction ends before A-250; do not claim this appendix was verified against 2025. No charts copied or automatic acceptance decisions.
- B31.1: 2012 retained by owner request. Primary reproduction: https://studylib.net/doc/27726978/asme-b31.1-2012-power-piping . Checked 127.4.2(C), Table 127.4.2 and notes, 136.4.3(B), 136.4.4(B), 136.4.5(A). Corroborating PDF extraction: https://nfpa.isolist.cfd/asme/ASME%20B31.1%202012.pdf . Direct PDF fetch failed; the web tool exposed its text.
- B31.1 IQI: separate V-2010 with 2011a addenda reference, Article 2 pp12–13: https://studylib.es/doc/8940880/asme-secc-v----edition-.2010 . Verified wire selection bounds and both source/film columns match the existing numeric lookup; source label remains specific to this older reference. No automatic governing-edition inference.

## Implementation

B31.1 now uses dedicated code instead of workbook AST calculations. Workbook remains archived source data and the AST evaluator remains testable. Removed fabricated root-cap implication for single-welded joints, corrected concavity guidance and metric MT/PT relevance/spacing, restored temperature-dependent reinforcement and undercut, and added separately sourced A-250 and IQI references. B31.1 temperature selectors use metric table bands. Weld construction controls inside-face applicability. Width is required only in the table branches depending on it.

Section I calculates reinforcement for either PW-35 column and undercut. A-250 references share tested numeric formulas with Appendix 4 but use their own clause/figure references and provenance. Thickness excludes reinforcement; unsupported combined fillet/butt geometries retain separate-evaluation scope. Chart comparison remains manual.

Inputs invalidate stale results. Width converts with units; hidden inputs cannot select another profile’s branch. Faces with different widths are evaluated separately.

## Validation

Calculator tests cover table bands, width dependence, missing inputs, source labels, isolated-indication exception, strict alignment limits, unit equivalence and other-profile isolation. Browser tests cover conditional controls, conversions, missing input feedback, switching profiles, recalculation and 320/393/430 px overflow.

Full npm test passed. After the exact-50-mm unit-switch regression was added and conversion precision corrected, both calculator unit and browser suites passed again. No APK built.


## Unreleased — external chart links

Relevant Code Calculator cards now have collapsed Chart links with source/figure and page references for Appendix 4, A-250, CSA Figure 7.22 and Section IX. Links open externally on Android, only after a main-frame user gesture and exact URL allowlist match in ChartLinks.java. WebView request blocking and CSP remain unchanged. This owner-authorized exception supersedes older network/navigation restrictions for these four destinations only. No charts bundled; sources require internet and PDF viewers may ignore page anchors.

Calculator and browser regressions and ChartLinksTest pass; all Android Java sources compile against API 36. No signed APK packaged.


## Unreleased - Supplied offline Appendix 4 charts

User supplied four screenshots (7110/7112/7114/7116) of Sulzer TP-0008 Rev.10, figures 4-3 through 4-8. JPEG bytes are unchanged in code-chart-images.json, embedded as data URLs through the Android HTML loader and tests/load-app.mjs. SVG viewports display the selected figure; no inferred or generated pore patterns. Offline zoom/pan is not physical-scale calibration.

Only VIII-full and B31.3 use these images; A-250, CSA and IX remain separate. Inclusive metric thickness bands 3/6/10/19/50/100 mm tested; no chart below 3 mm. Figures 4-4 and 4-6 have a page-counter overlay hiding part of the cluster pattern, so an incomplete-image notice and original link remain. Complete supplied figures replace their external links. Criterion E retains explicit D-base guidance.

Unit tests, mobile UI boundary/zoom/overflow tests and Android compilation pass. Original JPEG byte equality verified. Preview: build/offline-appendix-chart.png. Not packaged in 1.73.


## Unreleased - Supplied Section IX chart

Added user-provided 7118.jpg unchanged as the offline QW-191.1.2.2(b)(4) reference (IX-2025 p23). Viewer selects the 3–6, >6–13, >13–25 or >25 mm strip including its caption; below 3 mm remains the numeric count rule. Removed external link from IX rounded card when local chart is present. Original image bytes retained, no generated pore patterns and no physical-scale claim. Calculator boundaries, inch conversion, mobile zoom/overflow and source isolation tests passed. Preview build/offline-ix-chart.png. Not yet packaged.


## Unreleased - Supplied Section I A-250 charts

Five original screenshots 7122/7120/7124/7126/7128 are embedded unchanged. A-250.3.4-1 and -2 use SVG display rotation to read upright, with original notes retained. Section I/B31.1 cards select A-250.3.6-1 through -5 for metric thickness 3–100 mm inclusive; above 100 mm remains explicitly without a supplied chart and retains source link. No substitution of VIII or IX charts. External distribution links removed where supplied A-250 chart is available. Unit boundaries and UI selection, rotation, source labels, zoom/overflow and unsupported range tests pass. Source-only, not packaged.


## Unreleased - A-250 above 100 mm supplied

Added original user-supplied 7130.jpg as A-250.3.6-6, selected only above 100 mm. At 100 mm figure -5 remains selected. This supersedes the preceding missing-chart note: all six A-250 distribution thickness bands now have supplied offline images. Removed above-100 missing notice/external link. Tests cover boundary, inch conversion and UI selection; calculator and browser suites pass. Preview build/offline-boiler-over100.png. Not packaged.


## Unreleased - Supplied CSA Figure 7.22

Added unchanged 7137.jpg screenshot as offline CSA spherical-porosity reference. Both sweet/sour profiles select 3% below 14 mm, 4% from 14 through 18 mm inclusive, and 5% above 18 mm, matching Table 7.9. Figure windows preserve supplied dot patterns and captions; the 3% view excludes the phone page counter above its title. External CSA chart link omitted when local chart is shown. Calculator boundary tests and browser profile/units/zoom/mobile tests passed. Preview build/offline-csa-chart.png. No APK packaged.


## Unreleased - Clear Figure 4-4 replacement

User supplied 7139.jpg has unobstructed figure 4-4 patterns and notes; replaced the earlier screenshot viewport for >6–10 mm. Original JPEG bytes retained. Removed incomplete-image notice and external link for this band. New 7141.jpg still obscures figure 4-6 cluster with the 26/38 counter; kept that band flagged with its existing source link. Unit/browser tests pass. Preview build/offline-appendix-44-clear.png. Not packaged.


## Unreleased - Clear Figure 4-6 replacement

Replaced the >19–50 mm Appendix 4 chart with unchanged supplied 7143.jpg, viewport preserving the complete figure and notes. No cluster obstruction remains; removed that warning and external link. All supplied distribution chart groups (Appendix 4, A-250, IX, CSA) now have offline images for their applicable ranges. Unit/browser tests passed; preview build/offline-appendix-46-clear.png. These additions remain unbuilt after 1.73.


## Offline chart theme - unreleased after 1.83

Offline Appendix 4, Section IX, A-250 and CSA chart viewers now default to the app charcoal/warm-grey theme, with copper controls, an Original appearance switch, live zoom percentage and Reset zoom. An SVG luminance colour mapping changes display colour only; source JPEG bytes, viewports, rotations, dimensions, captions and calculator selection rules remain unchanged. No pattern redraw or physical calibration is implied.

Calculator unit tests, browser tests (including appearance switching, source retention, zoom/reset and mobile overflow) and release consistency pass. Visually inspected Appendix 4, boiler and CSA previews. Source-only; no new APK or upload.

Chart theme follow-up: removed the appearance switch at the owner's request. Offline charts always use the app theme; zoom and reset remain. Source images and technical content are unchanged.


## Higher-resolution offline charts - unreleased after 1.84

Replaced the rendered display of 17 Appendix 4, A-250 and CSA figures with PNG crops rendered directly from the existing original PDF vector artwork. Most are 2504 pixels wide; rotated schematics are 3120 pixels wide and CSA figures 2056 pixels wide. No generated/upscaled screenshot patterns. The permanent theme and 100-300% zoom/reset remain. Section IX retains its original screenshot because a usable high-resolution 2025 source could not be obtained.

assets/code-chart-images.json contains hq:<figure> entries with dimensions/viewBox/optional rotation and accurate source descriptions. Legacy supplied JPEG entries remain as fallbacks. The code calculator selection/limits and edition logic are unchanged. scripts/render-code-charts.py reproduces crops with pdftoppm; docs/code-chart-render-manifest.json records PDF pages, crop rectangles and source/output hashes. The local VIII PDF has nonstandard EOF line formatting but Poppler renders it correctly; no document content was repaired or redrawn.

Verified calculator unit/UI suites, mobile overflow, image dimensions/rotation/source hashes and visual previews including 300% zoom. Section IX remains source-limited; obtain the original PDF page 23 to upgrade it. No release version bump or upload.


## Section IX vector artwork - unreleased after 1.85

Located a complete 2025 Section IX PDF and extracted printed page 23 (PDF page 73): 254 original drawing paths, zero raster images. All four thickness-band windows now render actual inline SVG paths and outlined source captions in the app theme, bypassing SVG-image raster caching. Scoped SVG definition IDs avoid collisions. No guessed, traced or substituted indications; calculation rules and thickness boundaries remain unchanged. The separate red download-host advertising overlay was excluded from the extracted artwork; source paths/transforms are unchanged.

Reproduction: scripts/extract-ix-vector.py (PyMuPDF); source/output hashes and viewports: docs/code-chart-ix-vector.json. Assets: code-chart-ix.svg plus embedded hq figure entry. Calculator/UI tests verify inline path rendering, zero image nodes, all four viewport bands and zoom; chart asset checks verify SVG hash and no raster/script/foreignObject content. Previous statements that IX still needs a source are superseded. No release bump or upload.


## All offline charts use vectors - unreleased after 1.85

Converted the remaining 17 Appendix 4, A-250 and CSA figures to inline SVG, alongside Section IX. All current offline chart selections now display original vector paths and outlined captions with app colours; no active chart uses a raster image. Original PDF path data and transforms are asserted unchanged during extraction. Existing crop windows, rotated boiler schematics, thickness bands, zoom/reset and calculator rules remain.

Reproduce with scripts/extract-code-vectors.py using the recorded local source PDFs and PyMuPDF; then scripts/extract-ix-vector.py for Section IX. docs/code-chart-vector-manifest.json records sources, geometry-preservation assertions and output hashes; standalone SVGs are in assets/code-chart-vectors. The older PNG renderer remains a historical fallback and should not overwrite the current vector assets for releases. Legacy screenshot entries remain inactive fallbacks.

Chart asset checks and calculator unit/browser tests pass, including mobile widths, rotation, inline path rendering, zoom/reset and source preservation. No release bump, signing or upload.
