# Carestream CR (calibrated) — 1.97, updated 1.98

Prepared 2026-10-11. This is the independent CR calculation the owner asked for, in place of chart fitting or a T200 percentage. It adds a new film choice, **Carestream CR (calibrated)** (`crcal`), to both belts and to Custom Shot. The original chart (`cr`) and every film's output are unchanged. A test compares all 2,280 table values and 525 Custom Shot values against a 1.96 snapshot.

**1.98 changes (owner, 2026-10-12)**
- The CR field estimate (`crfield`, added by Codex) is removed. Its PMT gain law is not identifiable from the chart: rescaling the inferred PMT steps refits with identical error and a different gain. A belt saved on it falls back to the default film. Its `fieldPmt.<size>` settings stay in storage, unused. Custom Shot setups saved with it stay listed as "(field estimate removed)" and load their steel and SFD only. See docs/CR-FIELD-MODEL.md (history).
- **CR Formula (70%), `cr70`, was removed in 1.97.** It is handled the same way.
- **Chart (`cr`)** is the owner's Carestream chart: EXPOSURE CHART.xlsx, sheet CARESTREAM CR, column G.
  - That sheet matches the printed Fuji CR ST-VI chart, with +30% on 2"–6": 37 rows are identical and 17 are ×1.3.
  - Three cells are corrected:
    - 24" XS 85,610 → 6,390 (85,610 is the Fuji chart's Sch 100 value, copied into the wrong column);
    - 14" S40 1,770 → 2,060 (1,770 is the Fuji STD value);
    - 6" XXH 1,790 → 2,327 (the sheet's +30% was missed on this one cell).
  - The printed chart's PMT column gives scanning ranges per size band (2"–3" 20–50, 4"–8" 30–60, 10"+ 40–70), not a PMT per value.

The calculation uses physics. Its defaults come from the owner's Carestream chart, treated as known good shots: the starting plate exposure per pipe size and the steel curve. The owner adjusts the exposure with a slider or replaces it with their own reference shots.

## Model

```
Ci·s = R × (SFD in m)² × 3600 ÷ Γ × 2^(total steel mm ÷ H)
time = Ci·s ÷ current activity × CR film factor × size/schedule factor
```

- **R** is the plate exposure target in roentgen, set per pipe size with a slider from 0.5 to 12 R in 0.05 R steps (raised from 6 R on 2026-10-14: the owner's PMT 20 field shots deliver 7–8 R).
  - The default is the value the owner's reference shots imply at that card's PMT (kept within the slider range). Without reference shots, the size's start applies.
  - **Per-size starts** are the geometric mean plate exposure of that size's Carestream chart rows, at H = 14.5 mm, rounded to 0.05 R (`CR_DOSE.starts`). The chart has no 1", 5" or 18" rows: 1" uses the 2" value (no extrapolation), and 5" and 18" use the geometric mean of their neighbours.

    | Size | 1" | 2" | 3" | 4" | 5" | 6" | 8" | 10" | 12" | 14" | 16" | 18" | 20" | 24" |
    |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
    | Start (R) | 5.00 | 5.00 | 3.65 | 2.80 | 2.15 | 1.60 | 1.05 | 0.85 | 0.75 | 0.75 | 0.75 | 0.70 | 0.70 | 0.65 |

  - These replaced the 1.98 draft's three bands (4.3 / 1.65 / 0.75 R) at the owner's request. An independent review found that one 4"–8" value made 4" shots about half the chart time and 8" shots 30–45% long. Against the chart, the worst 10% of rows drop from about 48% to about 20% error. The chart's own scatter within a size is about 5%.

  - The 10"+ starts agree with published CR work: Jelfs (QSA Global), "Optimized Digital Radiography Using Co-60, Ir-192 and Se-75 Sources", NDE 2009, found "a dose of 800mR to 1.2R on the imaging plates delivered acceptable image quality" (https://www.ndt.net/article/nde-india2009/pdf/18-C-1.pdf).
  - Small pipes get more exposure in the chart. That is partly a higher-sensitivity PMT band, and partly because short chart times behave like practical minimums: inside 2"–4", the implied exposure falls as the wall gets thicker.
  - There is no short-shot warning; the owner asked for none.
- **Γ** = 0.48 R·m² per Ci·h, QSA Global's published Ir-192 output.
- **Total steel** is the full beam path: both walls for double wall, one for single wall. The same total steel at the same SFD gives the same time.
- **SFD** is the actual source-to-plate distance. Inverse square applies, and doubling activity halves the time.
- **H** is the steel exposure-doubling thickness. By default it is **14.5 mm**, from the Carestream chart: one constant per pipe size gives 14.9 mm, and the 10"+ rows alone give 14.3 mm.
  - QSA's published narrow-beam steel HVL is about 13 mm, and broad-beam film exposure charts give 12–13.6 mm. CR is more sensitive to scatter, so a slightly higher value is plausible.
  - A single exponential fits over the app's range.
  - The owner can enter a measured value (5–30 mm). If the owner's shots at one PMT span at least 6 mm of steel, the app shows the H they imply; it is only shown, never applied automatically.
- **Example times at 26 Ci at the per-size starts:**

  | Row | Calibrated CR | Carestream chart |
  |---|---|---|
  | 2" XH | 10 s | 11 s |
  | 4" STD | 20 s | 25 s |
  | 8" STD | 33 s | 38 s |
  | 10" STD | 45 s | 52 s |
  | 12" Sch 160 | 9 m 20 s | 9 m 47 s |
  | 24" STD | 2 m 55 s | 2 m 54 s |

### Owner's field shots, 2026-10-14 (HPX-PRO, Flex HR, scanned 20–30 min after exposure)

| Shot | Ci | Time | PMT | Weld-area pixel value | Total steel | SFD | Plate exposure delivered (H 14.5) | Pixels per R |
|---|---|---|---|---|---|---|---|---|
| 2" XH | 72 | 6 s | 20 | 3150–3360 (mid 3255) | 11.1 mm | 2.5" | 8.4 R | 387 |
| 3" STD | 72 | 11 s | 20 | 3220–3310 (mid 3265) | 11.0 mm | 3.625" | 7.4 R | 443 |
| 6" STD | 72 | 15 s | 40 | 3050–3230 (mid 3140) | 14.2 mm | 6.75" | 2.5 R | 1265 |

- The two PMT 20 shots agree within 14%: about 415 pixels per R at PMT 20. The 6" shot gives about 3× that at PMT 40: one point, not a gain measurement.
- The Carestream chart gives 4, 7 and 12 s for these at 72 Ci; the owner's shots are 1.3–1.6× longer and landed just above the 3200 target ceiling. The chart-derived starts are therefore low by roughly 1.5× for this owner's practice.
- The owner's pixel target is 2500–3200 (aim 2850). The owner says unexposed-plate values are in the low hundreds (not yet read exactly); at that level the 2850 times are about 5, 10 and 14 s at 72 Ci.
- These are entered on the phone through the calibration panel (shots with pixel values, target pixel 2850); they are not shipped in the app.

### Reference shots

Each reference shot shows the plate exposure it delivered by the same physics: `R = activity × time × Γ ÷ 3600 × 2^(−steel ÷ H) ÷ SFD²`. At a card's PMT, usable shots are combined by geometric mean into the suggested R, and the spread between them is kept. Shots at another PMT are converted as below. When the shots cannot cover a PMT, the card falls back to 1.0 R and says why. When they imply more than 3 R or less than 0.5 R, the slider stops at the limit and says what they imply.

### Scanner (PMT, pixel value)

For linear, unsaturated data at a fixed plate, laser, pitch and readout delay:

```
P − B(PMT) = k × G(PMT) × exposure
```

Here P is the linear pixel value, B the unexposed-plate value, and G the relative gain.

- **Same PMT as a reference shot:** that shot is used directly.
- **Another PMT:** the shot is converted by `G(shot PMT) ÷ G(target PMT)`. G comes **only** from the owner's gain measurements: identical fresh plates read at different PMT settings, giving G = pixel − unexposed value.
  - Between measured settings, G is interpolated log-linearly and B linearly.
  - Outside the measured range nothing is extrapolated, and the card falls back to its size's start with the reason.
  - The displayed PMT number is never assumed to be a multiplier or a voltage.
- **Optional target pixel value:** time scales by `(P_target − B) ÷ (P_shot − B)`. This needs each reference shot's pixel value and the unexposed values. Without a target, the app aims at the brightness of the reference shots.

**Brightness is not image quality.** Higher gain keeps the brightness but not the photon statistics. The IQI must still be checked.

### Consistency check

With two or more shots, the panel predicts each reference shot from the others at that shot's own geometry and PMT. It reports the median and worst difference. Large differences mean the shots disagree, or H or the gain table does not fit. This is the only in-app validation possible; it is not proof against independent shots.

## In the app

- **Source & film → Carestream CR calibration** has three parts:
  - **Reference shots:** steel (in), SFD (in), Ci, time (s) and PMT, plus optional pixel value, unexposed value and note.
  - **Scanner gain measurements:** PMT, exposed pixel value, unexposed value.
  - **Steel curve and pixel target.**

  The panel's status line names the basis: number of shots, gain PMTs, H and its source, and the target.
- **Results:** each pipe card has a PMT slider and a plate exposure slider (0.5–12 R, saved per size as `dose.<size>`; "Use suggested" clears it). The bounds are the owner's ranges (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70); they bound the control only and are not part of the model.
  - The default PMT is that of the reference shot nearest in SFD whose PMT falls inside the range; otherwise the middle of the range.
  - "Use reference PMT" restores the default.
  - Every row has a time and timer links. The note under the plate exposure slider says where its value comes from: your setting, reference shots (and whether gain-converted), or the size's chart start with the reason.
- **Print:** the pipe cell shows `PMT nn` and the plate exposure (`1.00 R`) under the size for calibrated-CR rows. It is not a new column.
- **Custom Shot:** Scanner PMT and Plate exposure (R, 0.5–12) replace target density. A blank plate exposure uses the reference shots at that PMT; without them, Custom Shot asks for a value. **Fill from chart for pipe size** puts that size's start into the plate exposure field. The summary says which basis was used. Saved setups keep both.
- **Factors:** CR film-wide and size/schedule factors (`factor.crcal`, `weld.crcal.<size>.<schedule>`) still multiply the result. The factor helper refuses calibrated CR and points to reference shots instead.

## Storage and migration

- **Calibration** lives in its own record, `localStorage['shottime.crCalibration']` = `{schemaVersion:1, shots, gain, hvlMm, targetPixel}`. A record with any other version is ignored.
  - Entries that fail validation are dropped and counted, never repaired. The status line reports how many could not be read.
  - Limits: 100 shots and 30 gain rows; entries beyond them are counted as unreadable.
- **Settings:** slider positions are stored as `pmt.<size>`, an additive key in the existing settings record (schema 2 unchanged). A missing or out-of-range value falls back to the default.
- **Old CR settings:** existing `factor.cr` and `weld.cr.*` are untouched and still apply to the chart choice. `factor.cr70` and `weld.cr70.*` are left in storage but unused. There is no automatic migration into `crcal`, because their values were set against the chart or the 70% formula, not against reference shots.

## What the owner needs to collect

1. **Reference shots at each PMT used.** Record CR shots with good images: total steel, actual SFD, activity at the time, exposure time and PMT. Pixel value and unexposed value are useful too. Cover thin and heavy walls to test H.
2. **A gain table**, if more than one PMT is used from the same reference.
   - Expose several identical fresh plates the same way, read after the same delay, one per PMT setting.
   - Record the linear pixel value in one area, plus an unexposed plate at each PMT.
   - Repeat at a second exposure level to check linearity and clipping.
   - Never rescan a single plate, because reading erases it.
3. **Hold-out shots.** Do not enter every shot: keep some back to compare against the app's prediction. That is the real validation.
4. **Scanner details:** scanner model and software, laser, pitch and readout delay. The model assumes these stay fixed. If they change, start a separate calibration.

## Not done

- No device install, signed build or physical exposure validation.
- The original chart (`cr`) remains selectable. Removing it is the owner's decision once calibrated CR is trusted.
- There is no import or export of the calibration record. The notes backup does not include it.

## Tests

- `node tests/test-cr-calibrated.cjs` — every 1.96 output unchanged except the three corrected chart cells; per-size starts match the chart; calibration cleaning; refusal without data; inverse square and activity; total steel; published and measured H; gain conversion only inside the measured range; pixel target and offsets; geometric mean; cross-check; suggested H; independence from chart and film numbers.
- `CHROME_BINARY=… node tests/test-cr-calibrated-ui.mjs` — the full workflow in the app, including print, Custom Shot, persistence, helper refusal, narrow widths and unreadable stored entries.

Both are in `npm test`.
