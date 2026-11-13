# WeldScope

WeldScope is a native Windows DICONDE image editor written in Rust (egui). It replaces the browser prototype in
`../diconde-editor/`, which stays in the repository, frozen, as the reference implementation. WeldScope shares no
code, storage or version with RT Handbook and is not packaged into the APK.

The opened files are never changed: every save writes a new file.

## Layout

- `core/` (`weldscope-core`) holds all file and image logic, with no interface code:
  - `dicom.rs`: reading, writing, value checks, derived copies, INDUSTREX private block and XML mirror.
  - `codec.rs`: JPEG 2000 through native OpenJPEG (`openjpeg-sys`, OpenJPEG 2.5).
  - `imaging.rs`: window/level, EDGE-style filter, film pieces, straightening, scratch repair.
  - `compat.rs`: INDUSTREX compatibility check.
  - `shots.rs`: metadata edit record, batch edits, weld grouping.
  - `copy.rs`: building saved copies.
  - `overlay.rs`, `export.rs`, `sample.rs`.
  - `markers.rs`: location numbers (coverage).
  - `indications.rs`: possible-indication marks (see below).
  - `review.rs`: the interpreter's calls on those marks and the review file.
- `app/` (`WeldScope.exe`) is the interface:
  - `app.rs`: state, background jobs, undo, saving.
  - `viewer.rs`, `panels.rs`, `organize.rs`.
  - `export_img.rs`: export rendering and thumbnails.
  - `assets/`: logo, icon and `app.ico`, made from the owner's artwork.
- `tools/`:
  - `build-windows.sh`: tests, cross-build and `dist/WeldScope-Windows.zip`.
  - `make-notices.py`: `THIRD-PARTY-NOTICES.txt`.
  - `make-parity-fixtures.cjs`: records the prototype's answers for the parity tests.
  - `digit-templates/make.py`: renders the digit templates used to read location numbers.
  - `defect-finder/`: the research behind the possible-indication marks, `export_weights.py` and `make_fixture.py`.

## Rules carried over from the prototype (owner-confirmed with INDUSTREX 7.2.1)

- **Every copy:** gets a new SOP Instance UID.
- **Pixel edits:**
  - mark the copy DERIVED\SECONDARY;
  - add a new series, a Derivation Description and a Source Image Sequence;
  - drop CSH_NDT xx40/xx50/xx52/xx70 and the Icon Image Sequence;
  - keep xx10/xx71/xx72;
  - recalculate 0028,0106/0107.
- **Metadata-only copies:** keep everything (compressed data byte for byte) and sync edited fields into the xx70 XML.
- **Processed JPEG 2000 copies:** follow the source codestream's precision, progression and tiling, and get a Basic
  Offset Table entry. Native OpenJPEG can tile, so INDUSTREX files are rewritten with their 512×512 tiles, which
  the WebAssembly prototype could not do.
- **INDUSTREX ANGLE:** applied counter-clockwise for the display-only view rotation.
- **EDGE-style filter:** an approximation. WeldScope uses `imaging::edge_enhance_v2`, whose defaults were refitted
  to matched INDUSTREX screenshot pairs (`tools/edge-fit/README.md`: correlation 0.96 on the cropped piece, up
  from 0.92). Empty area (no film) is left out of the filter, so it cannot change how the film looks; in INDUSTREX
  it does, which is why the owner crops first. The prototype's `edge_enhance` is kept unchanged for the parity
  tests. Never describe either as
  INDUSTREX's EDGE. It stays display-only until Apply to pixels.
- **Overlay text:** display and export only; never written into DICONDE pixels.
- **Scratch repair:** only thin lines reading as less radiation than the plate on both sides. Never cracks or voids,
  never IQI wires, and never without the user drawing or confirming the line.
- **Straighten & crop to film:** with one piece it works in place (one undoable step). With two or more pieces it
  saves each piece straightened and cropped as its own file, through the same path as Save split files with
  "Straighten each piece" on (new series, numbered in screen order); the open file is not changed. This was
  added after the prototype was frozen, so the prototype still straightens only the largest piece.
- **Preview before pieces are written:** Process this plate, Straighten & crop (two or more pieces) and
  Preview and save files all open the same dialog (`App::prepare_parts` → `pieces_dialog` → `save_parts_to`).
  Nothing is written until the user confirms; unticked pieces are skipped.
- **Output folder:** new files go to `<originals>/Edited` without a dialog, or to the folder in
  `prefs.output_dir` (status bar: Change / Reset). Names never collide (`unique_path`).
- **Check badge:** each file keeps the INDUSTREX check of its last saved copy (`FileEntry.compat`), shown next to
  Save as new file, in the file list and on the Organize cards.
- **Mouse:** right-drag is always window/level, middle-drag always pans.
- **Pick-lists:** `prefs.history` keeps the last 12 values typed per field; `App::suggestions` adds values other
  files in the folder have.
- **Organize:** dragging shots onto a weld and Rename weld both go through `shots::apply_batch` (validated, one
  undo step).
- **Files shown inside their original:** `App::parents` links a file to the file it was made from, through the
  Source Image Sequence that saved pieces and processed copies carry, or (metadata-only copies) the same series
  with identical pixel data. The file list and Organize nest them under the original when both are in the same
  weld group. Open folder also loads the `Edited` subfolder so the grouping survives reopening.
- **Coverage:** the location-marker range a shot shows (e.g. `0-35`) is kept as a `Coverage: …` line of Image
  Comments (0020,4000) (`shots::coverage_in` / `with_coverage` / `set_coverage`); DICONDE has no element for it.
  `markers::find_belts` reads the lead location numbers: blobs that saw less radiation than their surroundings,
  digits matched against font-rendered templates (`core/src/marker_digits.bin`, made by
  `tools/digit-templates/make.py` from DejaVu Sans, never from radiographs), tried in all four quarter turns. A
  row only counts when its numbers sit at an even pitch and rise by a constant step; misreads are then corrected
  from the row, and the belt may pass zero (… 126, 0, 7). The app reads every file as it opens (same background
  thread as the preview) and shows the result on the cards and the file list. A read with every number in step
  is written into the file when it is saved (pieces get their own); an unsure read is shown in amber with a
  question mark and is stored only when the user confirms or corrects it. On the owner's five plates the range
  was right on all five, with three flagged unsure; a piece whose numbers are cut by the film edge reads nothing.
  It is a reading aid, not a measurement. Not in the frozen prototype. Within a weld, shots are listed by where
  their coverage starts (`shots::coverage_start`); shots without a coverage follow in their usual order.
- **Process whole job:** `App::job_run` does for every plate in the list what Process this plate does for one:
  `pieces_in_screen_order`, then each piece straightened, cropped and written by `App::write_piece` (shared with
  the single-plate path) into the output folder, with a confirmation first and a per-plate summary after. No
  per-plate preview. Left out (`job_candidates`): files WeldScope made, plates that already have pieces made
  from them, plates with unsaved image steps; a single film with no empty area round it is skipped. Never
  overwrites; originals untouched. Not in the frozen prototype.
- **Pieces are stored the way they are viewed:** processed copies drop INDUSTREX's XML (and with it the viewing
  angle), so a piece cut from a plate viewed at 270° would open on its side. `SplitOptions::turns` turns each
  saved piece by the plate's view rotation (pixel spacing swapped, the turn recorded in Derivation Description).
  Applies to every piece save (Process this plate, split, whole job). Not in the frozen prototype.
- **Batch edits:** every shot is validated before any change.
- **Saving:** never overwrites originals or existing files (`_2`, `_3` … names).

## Possible indications (WeldScope only, not in the prototype)

The owner asked for an overlay that shows possible indications in the weld band and leaves the call to the
technician. `core/src/indications.rs` is a Rust port of the research code in `tools/defect-finder` (read its
README first): a finder network lists candidate spots, a second network scores a close crop of each, the weld
band finder keeps what lies in the band, and the list is ranked by finder peak x "is an indication" score.

- Image tab > Possible indications > Find possible indications. Marks are numbered boxes, strongest = 1, with the
  weld band drawn as thin lines (green = sure, amber = unsure, where the whole film is searched). A sensitivity
  slider (1 to 5, remembered) sets how far down the ranked list is shown; M or the toolbar button hides the marks.
  Picking a list entry brings that spot to the middle.
- Display only. Marks are never written to the DICONDE file, never burned into pixels and not drawn on exported
  pictures. They are cleared when the image changes.
- Marking tool (owner request, 2026-11-12): the interpreter calls each mark Indication (with a type) or Not an
  indication (buttons, or Y / N on the picked mark, which then moves to the next one), can add an indication the
  finder missed (Add one it missed: drag a box), and can set the rest to not indications after looking at them.
  `core/src/review.rs` holds the logic. Calls are saved at once to `WeldScope-indication-review.json` in the
  folder for new files, keyed by SOP Instance UID, and come back when the file is opened again. A damaged or
  newer review file is refused, never replaced. Calls can be made only on an image without unsaved pixel
  changes, because the coordinates belong to a saved file; a copy saved later has a new UID and starts empty.
  The review file records what a person judged, to measure the finder on real plates and to train it. It is not
  an acceptance record, and it may hold client weld names: treat it like the job data.
- Weld band (owner feedback 2026-11-13: marks were still landing outside the weld). An unsure band is now used
  as found, shown in amber, instead of searching the whole film; only a film with no ridge at all
  (`indications::NO_RIDGE`) is searched whole. On the owner's one unsure piece this took the marks at
  sensitivity 3 from 8 (all on lead letters and the IQI) to 0. Set weld band lets the user drag one or more boxes
  over the weld; they replace the found band, the finder runs again, and the boxes are kept in the review.
  Found band goes back. A wrong unsure band can hide spots, so the lines are always drawn while marks are shown.
- Measure tool (toolbar, or L): drag a line to read its length. Millimetres come from the file's pixel spacing,
  so it is a length on the plate, not corrected for magnification or for a shot taken at an angle; without a
  pixel spacing it shows pixels. Lines are display only, never written to the file or exports, and are cleared
  when the file changes. This is the user's own ruler; the finder still never sizes anything.
- Letter shortcuts now work whenever no text field is being typed in (before, a clicked button kept them off).
- Never describe it as measuring, sizing, accepting or rejecting. The type shown is a guess (slag is often named
  porosity). It misses indications and marks things that are not indications; on reference films sensitivity 3
  found 93 % of marked indications with about 5 other marks per film. Recall on the owner's kind of CR plate has
  not been measured.
- It works on stored pixels, not the EDGE-style view, and is meant for cropped pieces. On whole plates with empty
  area the weld band is often unsure.
- The trained weights are not in the repository. WeldScope reads `indication-models.bin` from the folder of the
  program (or the path in `WELDSCOPE_INDICATION_MODELS`); without it the button is disabled and says where the
  file belongs. Make the file with `tools/defect-finder/export_weights.py`; `tools/build-windows.sh` packs it
  when `models/indication-models.bin` exists (git-ignored). The weights were trained on the SWRD reference set,
  which the owner obtained for research and education; check its licence before any wider distribution.
- `core/tests/review.rs` covers the review rules and the review file.
- `core/tests/indications.rs` checks the port against the research code with tiny random networks on a synthetic
  image (`make_fixture.py`), and the band finder on synthetic plates. With the real weights the port gave the same
  142 candidates as the research code on one owner piece (scores within 0.03).
- Pixel spacings outside 0.08 to 0.125 mm are resampled to 0.1 mm first. About 7 s for a cropped piece and 15 s
  for a whole plate on four cores.

## Tests

```sh
cargo test --release -p weldscope-core                      # 42 tests
DICONDE_REAL_DIR=/path/to/dcm cargo test --release real_files -- --nocapture
```

- `core/tests/parity.rs` compares the core with the prototype: pieces, levels, windows, straightened pixels,
  scratch repairs, EDGE output, file reading, J2K decode and XML sync. All match exactly, apart from float rounding
  in the EDGE output.
- `core/tests/core.rs` ports the prototype's core tests and adds tiled-encode and copy-building tests.
- Never commit the owner's real files.

The interface was checked by driving the Linux build on a virtual display and the Windows build under Wine, using
`WELDSCOPE_TEST_DIR` (answers save and folder dialogs with a fixed folder; for automated checks only). Copies written
both ways passed the prototype's own INDUSTREX checker. Real Windows behaviour, including the file dialogs and
SmartScreen, still needs the owner's confirmation.

## Building for Windows

```sh
rustup target add x86_64-pc-windows-gnu      # plus mingw-w64 (gcc, windres) and python3
tools/build-windows.sh                       # → dist/WeldScope-Windows.zip
```

- The .exe needs only system DLLs and is unsigned.
- It renders with OpenGL and falls back to Direct3D/Vulkan (wgpu) if OpenGL fails.
- It is always dark-themed.
- Settings (panes, overlay layout, templates) are kept per Windows user by eframe.
