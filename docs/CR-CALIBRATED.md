# Carestream CR (calibrated) — 1.97

Prepared 2026-10-11. This is the independent CR calculation the owner asked for, in place of chart fitting or a T200 percentage. It adds a new film choice, **Carestream CR (calibrated)** (`crcal`), to both belts and to Custom Shot. The original chart (`cr`) and the 70% formula (`cr70`) are unchanged, as are their saved factors and every film's output. A test compares all 2,825 table values and 600 Custom Shot values against a 1.96 snapshot.

The calculation contains **no chart numbers and no invented calibration**. Until the owner records reference shots, every calibrated-CR row shows **—** with the reason, and Custom Shot refuses to calculate.

## Model

```
Ci·s = K × SFD² × 2^(total steel mm ÷ H)              (SFD in inches)
time = Ci·s ÷ current activity × CR film factor × size/schedule factor
```

- **Total steel** is the full beam path: both walls for double wall, one for single wall. The same total steel at the same SFD gives the same time.
- **SFD** is the actual source-to-plate distance. Inverse square applies, and doubling activity halves the time.
- **H** is the steel exposure-doubling thickness. By default it is **13 mm**, QSA Global's published Ir-192 half-value layer for steel. That is a shielding figure, not verified for CR exposure. The owner can enter a measured value (5–30 mm). If the owner's shots at one PMT span at least 6 mm of steel, the app shows the H they imply. It is only shown, never applied automatically.
- **K** comes only from the owner's reference shots. Each shot gives `K = activity × time ÷ (SFD² × 2^(steel ÷ H))`. Several usable shots are combined by geometric mean, and the spread between them is kept.

### Scanner (PMT, pixel value)

For linear, unsaturated data at a fixed plate, laser, pitch and readout delay:

```
P − B(PMT) = k × G(PMT) × exposure
```

Here P is the linear pixel value, B the unexposed-plate value, and G the relative gain.

- **Same PMT as a reference shot:** that shot is used directly.
- **Another PMT:** the shot is converted by `G(shot PMT) ÷ G(target PMT)`. G comes **only** from the owner's gain measurements: identical fresh plates read at different PMT settings, giving G = pixel − unexposed value.
  - Between measured settings, G is interpolated log-linearly and B linearly.
  - Outside the measured range nothing is extrapolated, and the row shows — with the reason.
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
- **Results:** each pipe card has a PMT slider. The bounds are the owner's ranges (1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70); they bound the control only and are not part of the model.
  - The default PMT is that of the reference shot nearest in SFD whose PMT falls inside the range; otherwise the middle of the range.
  - "Use reference PMT" restores the default.
  - Rows the calibration cannot cover show —, "Needs calibration" and the reason, and have no timer links.
- **Print:** the pipe cell shows `PMT nn` under the size for calibrated-CR rows. It is not a new column.
- **Custom Shot:** a Scanner PMT field replaces target density. Saved setups keep the PMT. A setup can be saved before the calibration covers it.
- **Factors:** CR film-wide and size/schedule factors (`factor.crcal`, `weld.crcal.<size>.<schedule>`) still multiply the result. The factor helper refuses calibrated CR and points to reference shots instead.

## Storage and migration

- **Calibration** lives in its own record, `localStorage['shottime.crCalibration']` = `{schemaVersion:1, shots, gain, hvlMm, targetPixel}`. A record with any other version is ignored.
  - Entries that fail validation are dropped and counted, never repaired. The status line reports how many could not be read.
  - Limits: 50 shots and 30 gain rows.
- **Settings:** slider positions are stored as `pmt.<size>`, an additive key in the existing settings record (schema 2 unchanged). A missing or out-of-range value falls back to the default.
- **Old CR settings:** existing `factor.cr`, `factor.cr70`, `weld.cr.*` and `weld.cr70.*` are untouched and still apply to their own choices. There is no automatic migration into `crcal`, because their values were set against the chart or the 70% formula, not against reference shots.

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
- Old `cr` and `cr70` remain selectable. Removing them is the owner's decision once calibrated CR is trusted.
- There is no import or export of the calibration record. The notes backup does not include it.

## Tests

- `node tests/test-cr-calibrated.cjs` — every 1.96 output unchanged; calibration cleaning; refusal without data; inverse square and activity; total steel; published and measured H; gain conversion only inside the measured range; pixel target and offsets; geometric mean; cross-check; suggested H; independence from chart and film numbers.
- `CHROME_BINARY=… node tests/test-cr-calibrated-ui.mjs` — the full workflow in the app, including print, Custom Shot, persistence, helper refusal, narrow widths and unreadable stored entries.

Both are in `npm test`.
