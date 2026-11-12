# Defect finder (research, not in the app)

Experiments towards a tool that points at possible weld indications for the interpreter to judge. Nothing here is
built into WeldScope yet, and nothing here accepts or rejects a weld. Training data and model weights are **not**
in the repository.

## Data
- **SWRD** (Zhao et al., J. Nondestruct. Eval. 2025; preprint rs-5369992): scanned film radiographs of seam welds
  with every defect outlined. Used here: the 4,740 weld-cropped films (`crop_weld_data`), 4,312 fetched so far.
  The archive is 124 GB, so `rzip.py` reads single members over HTTP range requests (`SWRD_ZIP_URL`) and
  `swrd_fetch.py` keeps a compact copy of each film (8-bit, half resolution, about 3 GB in all).
  Labels: porosity, slag, crack, lack of fusion, lack of penetration, undercut; "false defect" outlines (film
  artefacts) are trained as not-a-defect. Tungsten inclusions are left out (they show the other way on film).
- Earlier attempts, kept for the record: RIAWELC patches (4 classes, cut from only 29 radiographs) and the owner's
  IIW reference cards (film-level labels read from the card notches). Both failed to transfer; see below.

## Method
- `swrd_train.py`: a small fully convolutional net labels each 8×8-pixel cell of a film (after local contrast
  normalisation) as none or one of six types. Test films are fixed by a hash of the film name (15%), so rounds
  are comparable. "Found" = any cell under an outline is called a defect; a false alarm is a connected group of
  defect cells touching no outline.
- `stage2.py`: a second net names the type from a close crop round an indication and rejects artefacts.

## Results on held-out SWRD films
| Round | Train films | Test films | Found (lower sensitivity) | False alarms per film |
|---|---|---|---|---|
| 1 | 695 | 123 (different split) | 77% | 5.4 |
| 2 | 2,000 | 345 | 77% | 2.4 |
| 3 | 3,668 | 644 | 82% | 2.5 |

Round 3 at the higher sensitivity: 91% found, 8.5 false alarms per film. Right type when found (round 3): crack
86%, undercut 76%, lack of penetration 74%, lack of fusion 69%, porosity 62%, slag 34%.
Stage 2 (given the exact outline): slag 42%, porosity 77%, crack 77%, artefacts rejected 84%.

## Finder and naming step together (644 held-out films)
`e2e.py` joins them: finder regions, each named or thrown out by the close-crop step. `stage2b.py` retrains the
naming step on the regions the finder actually produces on the training films (merged pores, loose boxes and
the finder's own false alarms as not-a-defect), which is what made the pair work.

| Setting | Found | False alarms per film |
|---|---|---|
| Finder alone, lower sensitivity | 82% | 2.5 |
| + naming step trained on outlines only | 85% | 2.1 |
| + naming step retrained on finder regions, lower sensitivity | 84% | 0.9 |
| + the same, higher sensitivity | 91% | 2.2 |

Named right when found (retrained step, lower / higher sensitivity): porosity 67 / 54%, crack 77 / 81%,
undercut 67 / 74%, lack of penetration 59 / 60%, lack of fusion 53 / 54%, slag 30 / 32%. Slag is still mostly
called porosity; the outline-only step named it better (47%) but named porosity far worse (34%).

## Position and shape (`stage2d.py`)
The study material places each indication across the weld (lack of penetration central, undercut at the edge)
and SWRD agrees (83% of lack-of-penetration outlines in the centre third; undercut 46% in the outer third).
Feeding the naming step the distance from the weld centre, length-to-width, direction and relative size made
almost no difference on held-out finder regions: overall 77% → 78%, lack of penetration 39% → 42%, crack
65% → 68%, slag 25% both ways.

## Owner feedback on CR plates (2026-11-12)
Every region the pipeline flagged in the weld band of the owner's five plates was a false call: "porosity" was
bead ripple, "lack of fusion" was the density change between passes; real lack of fusion or penetration would
be much darker. Cause on our side: `lnorm` and the crop standardisation stretched every patch to the same
spread, discarding how dark an indication really is. `NORM_K` keeps real contrast and `CR_NEG` adds the flagged
spots as not-a-defect examples (round 4).

## What did not work
- A patch classifier trained on RIAWELC scored 88% on its own held-out radiographs but flagged every no-defect
  reference card and most lead letters, numbers and film edges on the owner's CR plates.
- Training on the owner's ~120 reference cards alone (film-level labels) was at chance.

## Not done
- No scoring on the owner's CR plates (no located answers for them yet). Scale and noise differ from SWRD.
- "Found" is generous for long linear defects. Slag naming is poor. Full-resolution crops are untried.
