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
- `app/` (`WeldScope.exe`) is the interface:
  - `app.rs`: state, background jobs, undo, saving.
  - `viewer.rs`, `panels.rs`, `organize.rs`.
  - `export_img.rs`: export rendering and thumbnails.
  - `assets/`: logo, icon and `app.ico`, made from the owner's artwork.
- `tools/`:
  - `build-windows.sh`: tests, cross-build and `dist/WeldScope-Windows.zip`.
  - `make-notices.py`: `THIRD-PARTY-NOTICES.txt`.
  - `make-parity-fixtures.cjs`: records the prototype's answers for the parity tests.

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
- **Batch edits:** every shot is validated before any change.
- **Saving:** never overwrites originals or existing files (`_2`, `_3` … names).

## Tests

```sh
cargo test --release -p weldscope-core                      # 22 tests
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
