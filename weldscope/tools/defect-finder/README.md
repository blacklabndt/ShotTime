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

## Round 4: real contrast, and the owner's plates as not-a-defect examples
`NORM_K=8 CR_NEG=1`. Finder alone on the 644 held-out SWRD films: 80% found at 2.8 false alarms per film (round
3: 82% at 2.5); 90% at 10.1 (91% at 8.5). Lack of penetration named right 83% (74%). With the naming step
retrained the same way (`NORM_K=8 FINDER=swrd_r4_keep.pt OUT=stage2b_k.pt stage2b.py`): 82% found at 0.9 false
alarms per film, 90% at 2.3 — level with round 3 plus its naming step.
On the owner's CR pieces, weld band only, finder at the higher sensitivity: the held-back piece went from 33
flagged regions (round 3) to 7, and to 0 at the lower sensitivity; the five pieces used in training went from
3–47 to 0–4. One held-back plate is thin evidence.
Note: the CR count printed at the end of `swrd_train.py`'s own log for round 4 was taken with the net in
training mode and is wrong; the figures above are from a separate run in evaluation mode.

## Technician's job folder (private, not in the repository)
`odrive.py` / `tech_fetch.py` / `tech_dcm.py` / `tech_reports.py` list and fetch a shared OneDrive folder of real
jobs: about 1,000 job folders, 2,672 DICONDE files, 22,913 exported JPGs (screen exports, too small to use) and
939 report workbooks. Reports have one row per weld (RT #, findings columns, accept/reject, remarks such as
"LOF 12-18"); DICONDE headers carry the weld number in Series Description. In the first 394 workbooks nearly
every weld is accepted, so the folder is mainly a source of clean welds in the target format.

## What did not work
- A patch classifier trained on RIAWELC scored 88% on its own held-out radiographs but flagged every no-defect
  reference card and most lead letters, numbers and film edges on the owner's CR plates.
- Training on the owner's ~120 reference cards alone (film-level labels) was at chance.

## Not done
- No scoring on the owner's CR plates (no located answers for them yet). Scale and noise differ from SWRD.
- "Found" is generous for long linear defects. Slag naming is poor. Full-resolution crops are untried.

## Weld band finder (band.py, 2026-11-12)

The owner said technicians only look inside the weld band, so anything marked outside it is useless. `band.py`
replaces the crude "brightest row ± 15 %" band:

- `films` splits a plate into films along the unexposed gap (saturated rows, or a thin light line), and uses the gap
  direction to decide which way the films run.
- `band` follows the lighter (less radiation) ridge of the weld along each film in eight chunks, ignoring rows taken
  up by lead numbers, measuring contrast on the middle of the film (the ends are often burn-off past the pipe).
- It reports `sure` only when the ridge is strong, present in most chunks, straight and of even width. Otherwise the
  caller should show the whole film: no guessing.

Checked by eye only; there is no marked ground truth for the band.

- Technician plates (compact copies): sure on 367 of 629 films in a 400-plate sample. Girth-weld strips are found
  well; small-bore shots and fittings are mostly reported unsure. Bands judged right on the three sample sheets
  viewed wherever it said sure.
- Owner's seven cropped pieces: six sure and on the weld, one unsure.
- `band_test.py`, round 4 pair on the 256 accepted plates, flags per plate at higher sensitivity: whole plate 10.4,
  old band 4.7. On the 144 plates where every film was sure: old band 4.5, new band 1.4 (no flags on 63 % of
  plates); at lower sensitivity 0.6 -> 0.2 (none on 88 %). Most flags were outside the weld (number belt, film
  edges). This says nothing yet about real indications kept; that needs the technicians' marked plates.

Not in WeldScope. Input must be in film sense (weld lighter than the plate beside it).

## Sensitivity retune: ranked candidates (rank.py, froc.py, rank_real.py, 2026-11-12)

The owner asked to be shown the indications and make the call themselves. So no retraining and no single cut-off:
`rank.candidates` lists every local peak of the round 4 finder map above 0.1 (about 72 per SWRD film), the naming
step scores each, and candidates are ordered by finder peak x naming-step "is a defect" probability (better than
either alone). The cut-off is then a reader's sensitivity setting.

Held-out SWRD films (644), found % of marked indications against candidates not on a marked indication per film:

| per film | 0.5 | 1 | 2 | 3 | 5 | 10 | 20 |
|---|---|---|---|---|---|---|---|
| found | 76 | 84 | 89 | 91 | 93 | 95 | 97 |
| cut-off | 0.79 | 0.68 | 0.52 | 0.43 | 0.31 | 0.18 | 0.10 |

At 10 per film: porosity 95, slag 96, undercut 98, lack of penetration 100, lack of fusion 99, crack 96.

Real plates, candidates inside the weld band (band.py), same cut-offs 0.52 / 0.31 / 0.18 / 0.10:

- 144 accepted technician plates with every band sure: mean 0.9 / 3.0 / 6.2 / 12.8 per plate; none on 74 / 55 /
  21 / 8 % of plates. Whole plate: 7.7 / 24 / 45 / 76, so the band removes most of it.
- Owner's seven pieces: 0-3 / 0-9 / 3-22 / 7-51 per piece.

Accepted does not mean free of indications (the owner: technicians can under-call), so these counts are a reading
load, not a false-alarm rate. Recall on real CR indications is still unmeasured.

## Bigger naming model test (name_data.py, name_big.py, 2026-11-12)

The owner asked whether a bigger AI model would name the types better. Test: a ResNet-18 pretrained on ImageNet,
fine-tuned on 27,341 crops (round 4 finder regions plus outlines on training films; porosity and "not a defect"
capped at 9,000), scored on the 8,781 finder regions of the 644 held-out films next to the current small naming
step on exactly the same regions. Two inputs: the close crop only, and the close crop plus two wider views (3x and
6x) that take in the weld cross-section. 2,500 steps each, about 17 minutes on four cores.

Named right, % of real regions of each type (held-out counts: porosity 1,450, slag 219, undercut 41, lack of
penetration 164, lack of fusion 116, crack 326):

| model | porosity | slag | undercut | LoP | LoF | crack | mean of types | defect-or-not AUC |
|---|---|---|---|---|---|---|---|---|
| current small step | 77 | 28 | 73 | 55 | 49 | 69 | 59 | 0.935 |
| ResNet-18, close crop | 73 | 35 | 41 | 61 | 54 | 77 | 57 | 0.938 |
| ResNet-18, close + wider views | 72 | 30 | 41 | 64 | 54 | 73 | 56 | 0.936 |

No real gain. Slag moves by a few points, which is inside the noise for 219 regions (about +-3 points), and it
swung between 10 % and 38 % from checkpoint to checkpoint. The wider views did not help. A model 20 times larger
that starts from general image knowledge ends in the same place, so model size is not what limits naming here.
What is left: the half-resolution 8-bit copies (the full-resolution comparison is still blocked by the download
limit on the archive), how consistently slag and porosity were labelled in the reference set, and marks from the
owner's own technicians. WeldScope keeps the small naming step.
