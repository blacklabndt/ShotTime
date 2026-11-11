# DICONDE Editor

An offline, browser-based editor for DICONDE (DICOM for NDE) radiograph files. It is a separate tool from the RT Handbook Android app and shares no code or storage with it.

**Windows program**: unzip `DICONDE-Editor-Windows.zip` and run `DiCondeEditor.exe`.
- Needs Windows 10 or 11, which include .NET Framework 4.8 and the Edge WebView2 runtime; nothing else to install. About 665 KB zipped.
- Open and Save use the normal Windows dialogs. Saves go to the original's folder by default, and the original itself cannot be chosen as the save target.
- `.dcm` files can be opened by double-click or "Open with", and the program asks before closing with unsaved changes.
- The program is not code-signed, so SmartScreen may warn on first run.
- Build it with `bash tools/build-windows.sh` (any OS with the .NET 8 SDK). Source is in `windows/`: `Program.cs` hosts the unchanged editor files from `app\` in WebView2 and answers its open/save messages.
- Built on Linux; the owner runs it on Windows. `tests/test-windows-host.cjs` checks the editor's side of the open/save/dirty/title messages against a stand-in host.

**Browser**: open `index.html` in Chrome, Edge or Firefox, or build a single shareable file with `node tools/build-single.cjs` (writes `dist/diconde-editor.html`, about 670 KB including the JPEG 2000 codec). Nothing is uploaded: files are read and written locally in the browser.

## What it does

- **Metadata**: a Common view of the usual NDE fields (component, inspection, equipment and technique, display), and an All tags view that includes nested sequences. DICONDE names are shown with the underlying DICOM name, for example *Component ID Number* (DICOM: Patient ID). Values are checked against their VR (dates as YYYYMMDD, length limits, numbers, UIDs) before they are accepted. You can add, remove and revert tags. Templates save the fields you changed so you can apply them to other files; they are stored only in this browser.
- **Viewing**:
  - JPEG 2000 images (as INDUSTREX saves them) are decoded when they open.
  - The starting window is set from the main exposure, leaving out unexposed plate areas, padding and markers.
  - INDUSTREX files open at INDUSTREX's stored viewing angle. **⟳ View** (or V) turns the view without changing pixels; PNG and PDF exports follow the view.
- **Information overlay** (**Info overlay** button, or I):
  - Selected fields are shown in the corners of the viewer, like INDUSTREX's on-screen annotations. Pin fields with 📌 on the Metadata tab, or arrange them per corner on the Overlay tab (move, reorder, remove, add any field).
  - Live items: window/level, zoom, image size, view rotation, file name and frame.
  - Values are written for people: dates as 2026-11-01, times as 10:14:51, names without `^`. Empty fields are left out.
  - Options: show or hide field names, choose the text size, include the overlay in PNG/PDF exports (zoom is left out of exports).
  - The overlay is never written into the DICONDE file. The layout is remembered in this browser (`localStorage`).
- **EDGE-style enhancement** (Image tab):
  - An approximation of INDUSTREX's EDGE display filter. Carestream has not published its algorithm, so the look differs from INDUSTREX.
  - It follows the Kodak CR approach the stored settings point to (`ImagingSystem: Kodak_CR`). The image is split into a large-scale band (thickness changes) and detail bands. Global contrast scales the large-scale band, detail contrast the medium band, and sharpness the finest band. A soft limit keeps halos small next to wires and markers.
  - Other controls: noise reduction, kernel size in mm (converted with Imager Pixel Spacing), brightness and despeckle (removes white dust specks on whichever side displays white).
  - Setting 1.0 is this editor's default strength. It was tuned against an INDUSTREX EDGE HD 1 screenshot of the owner's plate: a 20 mm kernel and stronger detail contrast raised the match from 0.55 to 0.69 overall and from 0.33 to 0.46 for detail. Close, but not identical; sharpness could not be judged at screenshot zoom.
  - **Use these** loads the EDGE settings INDUSTREX stored in the file (CSH_NDT xx72).
  - Display only: shown on screen and in PNG/PDF exports. **Apply to pixels** writes it into the image as an undoable step, recorded in Derivation Description, and the copy is marked DERIVED.
  - Takes about 1 second on a full 1353×4266 plate.
- **Image clean-up**: window and level (display only; you can store it as the copy's default), invert view, rotate, flip, 3×3 median noise reduction, bad-pixel repair, Gaussian smoothing, unsharp-mask sharpening, invert pixel values, and up to 12 undo steps.
- **Crop and split**: drag or type a crop box. Split into equal parts side by side or stacked, with optional overlap, or draw regions by hand. Each part's label can go into Image Comments or be appended to Component ID. Split parts download together as a ZIP.
- **Export**: PNG (as displayed), TIFF (raw pixel values, 8/16/32-bit) and a two-page PDF report (key fields and the displayed image).

## How saved files are marked

The original file is never changed. **Save copy** always writes a new file:

- It gets a new SOP Instance UID; the file meta header is rebuilt to match.
- If the pixels changed (any image step, crop or split part):
  - Image Type becomes `DERIVED\SECONDARY`.
  - A new Series Instance UID is assigned. Split parts share one series and are numbered 1…N.
  - Each step is written to Derivation Description (0008,2111).
  - Source Image Sequence (0008,2112) references the original instance.
- Metadata-only copies keep the image type and series.
- Rotating by 90° swaps the Pixel Spacing and Imager Pixel Spacing values. Smallest and Largest Image Pixel Value are removed because they would be stale.

Check your procedure or code before using an enhanced image for acceptance. This tool makes no claim that a processed image is suitable for interpretation.

## INDUSTREX compatibility

Based on the owner's real INDUSTREX 7.2.1 exports (HPX-PRO scanner, Flex HR CR plates; checked November 2026) and Carestream's *INDUSTREX DICOM/DICONDE Conformance Statement* (rev. 10.0, 2017, INDUSTREX 5.0). Real files are not stored in this repository; run `DICONDE_REAL_DIR=/folder node tests/test-real-files.cjs` to check your own.

**What the real files look like**

- CR Image Storage, MONOCHROME1, 12 bits stored in 16, **JPEG 2000 Lossless** (1.2.840.10008.1.2.4.90), ISO_IR 100.
- **Three private creators in group 0033**: `CSH_NDT`, `E2737` and `Diconde Private Tags 0033 Group`. The `CSH_NDT` elements are:

  | Element | Contents |
  | --- | --- |
  | xx10 | INDUSTREX version (`7.2.1`) |
  | xx40 | Internal data (compressed binary) |
  | xx50 | JPEG preview |
  | xx52 | Internal data |
  | xx70 | XML presentation state (see below) |
  | xx71 | Presentation flag |
  | xx72 | Display processing settings (`EDGE`, image class, brightness, contrast, sharpness, …) |

- **The xx70 XML** holds INDUSTREX's display settings and a mirror of about 200 DICONDE fields:
  - **Display settings**: a 90° viewing angle, the default window, zoom and viewport.
  - **Also included**: the original filename, scanner details and PMT gain.
- **When INDUSTREX crops an image itself**:
  - It assigns a new SOP Instance UID, but keeps the series and instance number.
  - It sets `DERIVED\SECONDARY`.
  - It rewrites xx40/xx50/xx52/xx70 and keeps xx71/xx72.

**What the editor does**

- **DICONDE names**: fields use INDUSTREX's names. Examples:
  - Component Owner Name (0008,0090)
  - Inspecting Company Name (0008,1048)
  - Certifying Inspector Name (0008,1060)
  - Inspector Name (0008,1050)
  - Part Examined (0018,0015)
  - Examination Notes (0032,4000)
  - Component Manufacturing Date (0010,0030)
  - Company Name (0008,0080)
- **Private elements** are shown by name, including the E2737 and Diconde blocks.
- **Summary card**: shows the SOP class, INDUSTREX version and scanner model.
- **Metadata-only copies**:
  - Every element is kept. The JPEG 2000 image data is kept byte for byte, with the same transfer syntax.
  - Edited fields are also written into the matching entries of INDUSTREX's XML copy. The rest of the XML is unchanged, and fields without an XML entry are not added.
  - Tested on the five supplied files: all 163 elements were preserved, the output read cleanly in pydicom, and the XML stayed valid.
- **Processed copies** (rotate, crop, filters, split):
  - They leave out xx40, xx50, xx52, xx70 and the Icon Image Sequence, which INDUSTREX regenerates and which describe the old pixels.
  - They keep the version, xx71 and the display processing settings (xx72), as INDUSTREX does.
  - Because the XML is dropped, INDUSTREX should open these copies with its default view, so you may need to rotate the view there.
- **Compatible output format**: copies are written as Explicit VR Little Endian, which INDUSTREX's conformance statement lists as readable.

**JPEG 2000**

- The bundled OpenJPEG 2.5.4 WebAssembly codec decodes the images when they open. It was added with the owner's approval; see `vendor/openjpeg/`.
- Checked on all five supplied files:
  - The decoded pixel range matches each file's Smallest/Largest Image Pixel Value.
  - Re-encoding is lossless.
  - Decoding takes under a second per image.
- Processed copies are saved as **JPEG 2000 Lossless** by default, about the same size as INDUSTREX's own files. They can be saved uncompressed instead from the Image tab.
  - The codestream precision equals Bits Stored (12 for these files).
  - The number of wavelet levels drops automatically for small crops and split parts.
- INDUSTREX stores its viewing angle in the XML (`ANGLE 0,0,90`). Applying it counter-clockwise matches an INDUSTREX screenshot of the same plate (0 → 35 on top, 35 → 70 below), so the viewer opens INDUSTREX files that way.

**Compatibility check**

- Every saved copy is re-read and checked; the result appears on the Changes tab. `compat.js` checks:
  - file structure and meta header;
  - a transfer syntax and SOP class INDUSTREX accepts;
  - consistent image attributes and pixel data length;
  - JPEG 2000 header, wavelet, precision and full decode;
  - pixel values inside Bits Stored and correct Smallest/Largest values;
  - every original element kept and value representations unchanged;
  - only edited and derived fields changed;
  - the INDUSTREX private block kept at the same place;
  - DERIVED marking;
  - valid values;
  - the INDUSTREX XML intact and in step with edits.
- `node tools/check-industrex.cjs edited.dcm original.dcm` runs the same check from the command line.
- Copies follow the source file's own JPEG 2000 settings (INDUSTREX 7.2.1: 16-bit precision, RLCP progression) and write a Basic Offset Table entry per frame, as INDUSTREX does. Smallest/Largest Image Pixel Value are recalculated rather than removed.
- One remaining difference: INDUSTREX writes 512×512 tiles, while the bundled encoder writes one tile per image. That is baseline JPEG 2000, which compliant decoders must read.
- Verified November 2026 on the owner's five INDUSTREX 7.2.1 files, with 25 edited copies (metadata-only, rotated, cropped, EDGE applied, uncompressed):
  - all passed the check with 0 failures;
  - DCMTK's strict parser and GDCM accepted every copy;
  - GDCM decoded pixel-for-pixel the same image as the editor.

  - **Confirmed in INDUSTREX (owner, 2026-11-11):** a test pack of five edited copies of one plate opened properly in INDUSTREX 7.2.1. The pack held a metadata-only copy, rotated, cropped and EDGE-applied JPEG 2000 copies, and an uncompressed processed copy. Whether INDUSTREX shows edited values from the tags or from its XML was not reported separately; both are kept in step.

**Open items**

- **Not yet reported from INDUSTREX**:
  - Whether INDUSTREX reads fields from its XML copy or from the DICOM tags. Both are updated.
  - Whether a processed copy without its XML opens with INDUSTREX's default view.

## File support

- **Reads**:
  - Explicit and implicit VR little endian, explicit VR big endian and deflated transfer syntaxes.
  - Files with or without the 128-byte preamble.
  - Defined and undefined-length sequences.
- **Writes**: explicit VR little endian, or JPEG 2000 Lossless for processed images (the default when the source was JPEG 2000).
- **Image tools**: uncompressed greyscale (MONOCHROME1/2) images, 8, 16 or 32 bits allocated, signed or unsigned, single or multi-frame.
- **JPEG 2000** (lossless, lossy, HTJ2K): decoded for viewing and image tools. Metadata-only copies keep the original codestream byte for byte.
- **Other compressed files** (JPEG, JPEG-LS, RLE):
  - Open for metadata editing. Their compressed image data is copied unchanged and the transfer syntax is kept.
  - Image tools are disabled because no decoder is bundled for them.
- **Not supported**: colour images and private tags (odd groups). Private tags in a file are kept unchanged.

## Files

| File | Purpose |
| --- | --- |
| `dicom.js` | Parser, writer, value validation, data dictionary, derived-copy marking |
| `imaging.js` | Rotate, flip, crop, median, smoothing, sharpening, bad pixels, windowing |
| `export.js` | ZIP, TIFF and PDF builders |
| `compat.js` | INDUSTREX compatibility check of a saved copy against the original |
| `windows/` | Windows program: `DicondeEditor.csproj`, `Program.cs` (WebView2 host), icon, README |
| `tools/build-windows.sh` | Builds `dist/DICONDE-Editor-Windows.zip` |
| `tools/check-industrex.cjs` | Command-line compatibility check |
| `overlay.js` | Overlay layout, value formatting and corner text drawing |
| `codec.js` | JPEG 2000 decode/encode and frame splitting, using `vendor/openjpeg/` |
| `vendor/openjpeg/` | OpenJPEG WebAssembly build (`@cornerstonejs/codec-openjpeg` 1.3.6, unmodified), checksums and licences |
| `tools/vendor-openjpeg.cjs` | Regenerates `vendor/openjpeg/` from the npm package |
| `sample.js` | Synthetic sample radiograph (not real inspection data) |
| `app.js`, `index.html` | User interface |
| `tools/build-single.cjs` | Builds the single-file HTML |
| `tools/make-sample.cjs` | Writes the sample to a .dcm file |

## Tests

```sh
node diconde-editor/tests/test-core.cjs   # parser/writer, validation, derivation, image ops, exporters
node diconde-editor/tests/test-ui.cjs     # browser workflow (needs Playwright + Chromium; CHROME_BINARY optional)
node diconde-editor/tests/test-windows-host.cjs  # editor side of the Windows program's messages
npm run test:diconde                      # all of the above
```

The sample file written by this tool was also read back successfully with pydicom during development. Files from real scanners (for example Carestream INDUSTREX DR/CR exports) have not been tested yet. `tests/industrex-fixture.cjs` builds a synthetic file with the same layout as real INDUSTREX 7.2.1 exports for the tests; `tests/test-real-files.cjs` checks your own files when `DICONDE_REAL_DIR` is set.
