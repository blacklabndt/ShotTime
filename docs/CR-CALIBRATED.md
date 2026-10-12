# Carestream CR (calibrated) — 1.97

Prepared 2026-10-11. This is the independent CR calculation the owner asked for, in place of chart fitting or a T200 percentage. It adds a new film choice, **Carestream CR (calibrated)** (`crcal`), to both belts and to Custom Shot. The original chart (`cr`) and every film's output are unchanged. A test compares all 2,280 table values and 525 Custom Shot values against a 1.96 snapshot.

**CR Formula (70%), `cr70`, was removed in 1.97 at the owner's request.**
- A belt saved on it falls back to that belt's default film.
- Its saved `factor.cr70` and `weld.cr70.*` values stay in storage untouched but are no longer used.
- Custom Shot setups saved with it stay listed as "(CR Formula removed)". They load their steel and SFD only and ask for a film.

The calculation contains **no chart numbers**. Its one target, the plate exposure, starts at a published value (1.0 R) that the owner adjusts with a slider (0.5–3 R) or replaces with reference shots.

**Chart (`cr`), 1.97, at the owner's request.** The printed chart is titled "FUJI CR ST-VI CURIE-SECOND CHART", although the plates used are Carestream Flex HR.
- 2"–6" now use the printed values. The workbook's ×1.3 is removed; 6" XXH was already printed.
- Two transcription errors are corrected from the printed chart:
  - 24" XH: 85,610 → 6,390. 85,610 is the printed Sch 100 value.
  - 14" Sch 40: 1,770 → 2,060.
- The chart's PMT column gives scanning ranges per size band (2"–3" 20–50, 4"–8" 30–60, 10"+ 40–70), not a PMT per value. The chart is used as a reference only, never as input to calibrated CR.

## Model

```
Ci·s = R × (SFD in m)² × 3600 ÷ Γ × 2^(total steel mm ÷ H)
time = Ci·s ÷ current activity × CR film factor × size/schedule factor
```

- **R** is the plate exposure target in roentgen, set per pipe size with a slider from 0.5 to 3 R in 0.05 R steps.
  - The default is the value the owner's reference shots imply at that card's PMT (kept within the slider range), or else the starting point.
  - **Starting point: 1.0 R.** Jelfs (QSA Global), "Optimized Digital Radiography Using Co-60, Ir-192 and Se-75 Sources", NDE 2009, found "a dose of 800mR to 1.2R on the imaging plates delivered acceptable image quality". That study used high- and mid-performance plates from several manufacturers on a SENTINEL Vision HR scanner, with optimised but unstated PMT. It is **not verified for Flex HR / HPX-1**, and the app labels it so.
  - The required plate exposure depends on PMT: higher gain needs less exposure, with more noise. That is why the slider is per card, beside the PMT slider.
- **Γ** = 0.48 R·m² per Ci·h, QSA Global's published Ir-192 output.
- **Total steel** is the full beam path: both walls for double wall, one for single wall. The same total steel at the same SFD gives the same time.
- **SFD** is the actual source-to-plate distance. Inverse square applies, and doubling activity halves the time.
- **H** is the steel exposure-doubling thickness. By default it is **13 mm**, QSA Global's published Ir-192 half-value layer for steel. That is a narrow-beam shielding figure; with scatter build-up, a real broad-beam dose could differ by up to about 2× on thick steel. The owner can enter a measured value (5–30 mm). If the owner's shots at one PMT span at least 6 mm of steel, the app shows the H they imply; it is only shown, never applied automatically.

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
  - Outside the measured range nothing is extrapolated, and the card falls back to the 1.0 R starting point with the reason.
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
- **Results:** each pipe card has a PMT slider and a plate exposure slider (0.5–3 R, saved per size as `dose.<size>`; "Use suggested" clears it). The bounds are the owner's ranges (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70); they bound the control only and are not part of the model.
  - The default PMT is that of the reference shot nearest in SFD whose PMT falls inside the range; otherwise the middle of the range.
  - "Use reference PMT" restores the default.
  - Every row has a time and timer links. The note under the plate exposure slider says where its value comes from: your setting, reference shots (and whether gain-converted), or the starting point with the reason.
- **Print:** the pipe cell shows `PMT nn` and the plate exposure (`1.00 R`) under the size for calibrated-CR rows. It is not a new column.
- **Custom Shot:** Scanner PMT and Plate exposure (R, 0.5–3) replace target density. A blank plate exposure uses the reference shots at that PMT, else 1.0 R; the summary says which. Saved setups keep both.
- **Factors:** CR film-wide and size/schedule factors (`factor.crcal`, `weld.crcal.<size>.<schedule>`) still multiply the result. The factor helper refuses calibrated CR and points to reference shots instead.

## Storage and migration

- **Calibration** lives in its own record, `localStorage['shottime.crCalibration']` = `{schemaVersion:1, shots, gain, hvlMm, targetPixel}`. A record with any other version is ignored.
  - Entries that fail validation are dropped and counted, never repaired. The status line reports how many could not be read.
  - Limits: 50 shots and 30 gain rows.
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

- `node tests/test-cr-calibrated.cjs` — every 1.96 output unchanged; calibration cleaning; refusal without data; inverse square and activity; total steel; published and measured H; gain conversion only inside the measured range; pixel target and offsets; geometric mean; cross-check; suggested H; independence from chart and film numbers.
- `CHROME_BINARY=… node tests/test-cr-calibrated-ui.mjs` — the full workflow in the app, including print, Custom Shot, persistence, helper refusal, narrow widths and unreadable stored entries.

Both are in `npm test`.
