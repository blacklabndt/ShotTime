# Fitting the EDGE-style filter to INDUSTREX screenshots

Carestream's EDGE algorithm is not published. `imaging::edge_enhance_v2` is an approximation whose defaults were
fitted (2026-11-11/12) to matched INDUSTREX 7.2.1 screenshots the owner supplied: the same image with Display Filter
EDGE on and off. It must not be described as INDUSTREX's EDGE. The screenshots and raw pixels are the owner's real
data and are never committed; `common.py` and `evaluate.py` are the method.

## Data

- **Pair A:** the two-piece plate (1353×4266, 0.1 mm pixels), whole plate at 0.357 screen pixels per raw pixel.
  EDGE settings stored in the file: Image Class HD 1, all sliders 1.0, Noise Reduction 0.
- **Pair B:** one split piece of the same plate (a WeldScope copy opened in INDUSTREX), at 0.2365 screen pixels per
  raw pixel. Its EDGE screenshot is dark (grey 17–57), so it is coarser evidence.
- **Pair C:** the other split piece (35–70), same scale as pair B. It arrived after the defaults were set, so it
  was used only as a held-out check.

## Method

1. Align each "off" screenshot to the raw pixels (`common.register`, ECC affine). The off screenshots are a plain
   linear window of the raw data: correlation 0.992 (A) and 0.996 (B).
2. Split the raw image into frequency bands at full resolution, bring them to screenshot scale, and regress the EDGE
   screenshot on them (both lightly smoothed, because screenshot noise does not line up pixel for pixel).
3. Score candidate filter settings by correlation with the EDGE screenshot (`evaluate.py`).

## Findings

- **Plain plate, pair A** (away from markers and edges): a linear band model explains EDGE well, correlation 0.97.
  Gain relative to the 1.2–3.6 mm band:

  | Band | < 0.4 mm | 0.4–1.2 mm | 1.2–3.6 mm | 3.6–10 mm | 10–30 mm | > 30 mm |
  |---|---|---|---|---|---|---|
  | Relative gain | 1.43 | 1.54 | 1.00 | 0.19 | 0.11 | 0.09 |

- **Strong features** (lead markers, numbers) are heavily limited: the response saturates instead of growing with
  the feature's contrast. A soft limit `d / (1 + |d| / T)` with T ≈ 35–40 raw units (about 0.14 × the automatic
  window width) fits; without a limit the best correlation over the whole plate is only 0.52.
- **Pair B differs:** the same band regression gives relative gains 1.61 / 1.00 / 0.48 / 0.47 / 0.36, i.e. about
  four times more large-scale shading relative to detail. INDUSTREX's result therefore depends on the image content
  (or on how it was opened); this filter does not model that.
- Sharpness below about 0.3 mm cannot be measured at these screenshot scales.

## Why the two pairs differ (owner, 2026-11-12)

The owner explained the difference: empty area around the film (no film, shown white) changes INDUSTREX's result a
great deal, which is why they crop plates first. Pair A contains empty area (the gap and the plate edges); pair B is
a cropped piece. So pair B is the truer picture of EDGE on film, and pair A shows the distortion.

`edge_enhance_v2` therefore leaves empty area out altogether (padding, and background found by `plate_levels`): it
does not enter the mean or the blurs, and film values are spread a short way into it so edges stay clean. The film
looks the same before and after cropping. This is a deliberate difference from INDUSTREX.

## Result

Correlation with the EDGE screenshots, with empty area left out of the model (all film pixels, markers included):

| Settings | Pair A (has empty area) | Pair B (cropped) |
|---|---|---|
| Old defaults (`edge_enhance`: 20 mm kernel, kG 0.5, kD 2.4, kS 1.8, limit 0.35) | 0.87 | 0.92 |
| First refit, a compromise over both pairs (11 mm, kG 0.36, kS 6.0, limit 0.14) | 0.93 | 0.90 |
| **Current defaults**, fitted to pair B (20 mm kernel, fine scale 1.5 mm, kG 1.2, kD 2.4, kS 6.0, limit 1.1) | 0.82 | **0.96** |

(Without leaving empty area out, the first two rows scored 0.75/0.78 and 0.84/0.86.)

**Held-out check (pair C, not used for fitting):** current defaults 0.96, old defaults 0.93, first refit 0.92. Pair
C's own best settings (kernel 20–24 mm, kG/kD 0.5, no limit) score 0.97, essentially the current defaults, so
nothing was changed.

The optimum on pair B is flat (0.955–0.963 over kernels of 16–24 mm and kG/kD 0.5–0.65), and its EDGE screenshot is
dark (grey 17–57), so these values are approximate. The lower score on pair A is expected: it measures agreement
with a result the owner regards as distorted by the empty area. Global Contrast near 0.3 with Detail limit lowered
reproduces the pair A look if ever wanted. The EDGE view starts with the automatic window of the film.

## To improve further

Full-resolution lossless exports with EDGE on and off, and pairs with one slider changed at a time, would allow
fitting the fine-detail gain, each slider's effect, and what makes INDUSTREX's strength vary between images.
