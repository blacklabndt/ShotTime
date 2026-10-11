# Carestream CR: a scan-profile exposure model

Prepared 2026-10-11 from the CR handover. This is a research proposal. The app is unchanged: the 56-row chart stays exactly as it is, and T200 and the other films are untouched. Matching the chart does not validate physical exposures.

## Why the earlier formulas fail

Every earlier attempt fitted **one** curve to the whole chart. That assumes the scanner gain is the same for every row, and the owner has said PMT is turned up for larger pipes. The chart therefore mixes two effects: the physics of the shot and the scanner setting. One curve cannot fit both.

- One fixed-gain curve misses the chart by a median of 48% (leave-one-out). It also needs a 25 mm "doubling thickness", which is not physically plausible for Ir-192 in steel.
- The shipped 70%-of-T200 formula (`cr70`, RT Handbook 1.96) is the same kind of curve with the constant chosen rather than fitted. Compared with the chart it gives about 0.5× the time at 2" XH and 0.75× at 4" STD, but 2.9× at 10" STD, 4.3× at 20"/24" STD and 5.6–6.5× on heavy walls (12" Sch 160, 20" Sch 120). 10" STD is one of the two confirmed good shots, so at large sizes `cr70` departs furthest from known good exposures.

## What the chart shows when the two effects are separated

Within one pipe size the scanner setting is presumably the same, so only wall thickness changes between schedules. Fit one steel curve shared by all sizes, plus one constant per size:

| Model (53 rows) | Steel doubling H | Leave-one-out median | 90th pct | ≤ 20% |
|---|---:|---:|---:|---:|
| One constant for every size (fixed gain) | 25.0 mm | 47.6% | 109% | 12/53 |
| One constant per size | **14.8 mm** | **6.2%** | 15.1% | 49/53 |
| Per size, H fixed at 13.0 mm | 13.0 mm | 12.7% | 22.4% | 46/53 |
| Per size, H fixed at 12.1 mm (film model) | 12.1 mm | 18.9% | 33.7% | 30/53 |

Two findings:

1. **The steel term is ordinary physics.** Allowing each size its own constant, the chart's wall-to-wall changes give a doubling thickness of 14.8 mm. That is close to the published ~13 mm Ir-192 steel HVL, and broad-beam build-up should make it read a little higher. NPS 10–24 alone give 14.3 mm with a 1.7% median error. Small pipes (2–8") are flatter (about 20 mm). That could be scatter at contact distance, or settings that also changed by schedule there.
2. **The size constant is the scanner gain.** It steps down from NPS 2 to NPS 10 and then barely moves:

| NPS | 2 | 3 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 20 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| K (Ci·s at 4" STD geometry) | 926 | 677 | 523 | 318 | 194 | 157 | 146 | 146 | 139 | 131 | 124 |
| Gain relative to 4" | 0.57 | 0.77 | 1.00 | 1.64 | 2.70 | 3.34 | 3.59 | 3.58 | 3.77 | 4.00 | 4.21 |

This is what a PMT turned up in steps through 6–10" and then left at one setting would produce, assuming the same image brightness is the aim. The chart cannot show *which* PMT numbers were used. It also cannot separate a gain change from a change of target brightness.

## Proposed formula

```text
Ci·s = K(profile) × (D / 4.625)² × 2^((X − 12.04) / H)
t    = Ci·s / A
```

- **X**: total steel in the beam, mm. Double wall = 2 × wall; single wall = 1 × wall. Same X and same D give the same time.
- **D**: actual source-to-plate distance, inches. True inverse square.
- **A**: current activity, Ci.
- **H** = 14.8 mm, one constant for CR. PMT does not affect it.
- **K(profile)**: Ci·s at the reference geometry for one scanner setup (PMT, laser, pitch, target pixel value). It holds everything the scanner does.

A profile is defined by **what the tech will set on the scanner**, not by the pipe size. If 12" pipe is shot and scanned with the 4" PMT setting, the 4" profile applies.

### Getting K for a profile (no manufacturer data needed)

1. **From good shots (recommended).** For each PMT setting actually used, record 2–3 shots that gave acceptable images: steel path, actual SFD, activity, time and PMT. Pick different wall thicknesses if possible. `calibrate()` takes the geometric mean, and `spread` reports how well the shots agree. A single shot works, but in the chart a single STD row predicts the rest of its size with a 10% median error and up to 59% worst case.
2. **From a measured gain ratio.** To move an existing profile to a new PMT without new pipe shots, expose fresh plates identically, scan them at the old and new PMT, and compare offset-subtracted linear ROI pixels. Then `rescale(profile, {gainRatio})`. Do not reuse one plate: rescanning depletes it.
3. **From the chart (interim default).** Use the per-size K values above, labelled "chart practice for NPS n". This reproduces the chart rows and extends them to custom geometry. It is honest only if the tech scans with the same setting that size was always scanned with.

Gain alone never guarantees equal image quality. Higher PMT keeps the brightness but not the signal-to-noise ratio. IQI sensitivity still has to be checked on the plate.

## Chart entries worth checking

These rows sit well off their own size's trend. They were set aside from the fit and are not changed:

| Row | Chart Ci·s | Model | Note |
|---|---:|---:|---|
| 24" XH | 85,610 | ~6,300 | Between 24" STD 4,520 and Sch 40 9,930; probably a typo (5,610 or 8,561?) |
| 6" XXH | 1,790 | ~3,000 | Lower than 6" Sch 160 (2,070) despite thicker wall. The 160 row fits; earlier work excluded the wrong one |
| 14" Sch 40 | 1,770 | ~2,200 | Same value as 14" STD despite thicker wall |

## How to put it in the app

Change the CR option from "one formula" to "**CR + scan profile**":

1. Add a small `CR_PROFILES` store, each with `{name, pmt, K, anchors[], spread, source: 'shots'|'gain'|'chart'}` and a shared `H`. Keep `HVL_MM` in its own frozen CR constant, never borrowed from the film model.
2. Main table: keep the chart values for chart rows, as the hard rules require. Fill the empty rows from the selected profile, marked visibly as model values. Hide rows over 90 mm as now.
3. Custom Shot: CR uses the formula with the entered total steel and actual SFD and asks which profile (PMT) is used. No density field.
4. Add an "add good shot" form to a profile (steel, SFD, activity, time, PMT). It recalculates K and shows the spread. A large spread is a warning that the shots were not taken at one consistent setting.
5. Store profiles in settings with a schema bump and a tested migration. Old `factor.cr` and `weld.cr.*` keys keep applying to chart rows.
6. Keep `cr70` only as a labelled legacy option, or remove it once a shot-based profile exists for each PMT in use.

## What the owner needs to supply

- The PMT (and laser, pitch) used for each pipe size, and whether it ever changes by schedule.
- For each PMT setting in use, 2–3 good shots with steel path, SFD, activity and time.
- Whether 24" XH, 6" XXH and 14" Sch 40 in the chart are correct.

## Reproduce

```sh
node scripts/cr-profile-model.cjs        # chart decomposition report
node tests/test-cr-profile-model.cjs     # model and chart-fit checks
```

`scripts/cr-profile-model.cjs` exports `calibrate`, `rescale`, `curieSeconds`, `shotSeconds`, `fitChart` and `leaveOneOut`. It has no dependencies and can be copied into the RT Handbook project unchanged.
