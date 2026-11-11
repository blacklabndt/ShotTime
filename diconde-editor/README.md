# DICONDE Editor

An offline, browser-based editor for DICONDE (DICOM for NDE) radiograph files. It is a separate tool from the RT Handbook Android app and shares no code or storage with it.

Open `index.html` in Chrome, Edge or Firefox, or build a single shareable file with `node tools/build-single.cjs` (writes `dist/diconde-editor.html`). Nothing is uploaded: files are read and written locally in the browser.

## What it does

- **Metadata**: a Common view of the usual NDE fields (component, inspection, equipment and technique, display), and an All tags view that includes nested sequences. DICONDE names are shown with the underlying DICOM name, for example *Component ID Number* (DICOM: Patient ID). Values are checked against their VR (dates as YYYYMMDD, length limits, numbers, UIDs) before they are accepted. You can add, remove and revert tags. Templates save the fields you changed so you can apply them to other files; they are stored only in this browser.
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

**Open items**

- **No JPEG 2000 decoder yet**: the image tools (clean-up, crop, split, PNG/TIFF/PDF export) cannot run on these files. The planned route is to bundle the OpenJPEG WebAssembly codec. That needs the owner's go-ahead because it adds third-party code. With it, processed copies could also be saved as JPEG 2000 Lossless instead of uncompressed (about 11.5 MB instead of about 2.5 MB per image).
- **Not yet confirmed in INDUSTREX**:
  - Whether INDUSTREX reads fields from its XML copy or from the DICOM tags.
  - How INDUSTREX displays a processed copy without its XML.
- **Viewer orientation**: the editor's viewer does not yet apply INDUSTREX's stored 90° viewing angle.

## File support

- **Reads**:
  - Explicit and implicit VR little endian, explicit VR big endian and deflated transfer syntaxes.
  - Files with or without the 128-byte preamble.
  - Defined and undefined-length sequences.
- **Writes**: explicit VR little endian.
- **Image tools**: uncompressed greyscale (MONOCHROME1/2) images, 8, 16 or 32 bits allocated, signed or unsigned, single or multi-frame.
- **Compressed files** (JPEG, JPEG-LS, JPEG 2000, RLE, HTJ2K):
  - Open for metadata editing. Their compressed image data is copied unchanged and the transfer syntax is kept.
  - Image tools are disabled because there is no decoder.
- **Not supported**: colour images and private tags (odd groups). Private tags in a file are kept unchanged.

## Files

| File | Purpose |
| --- | --- |
| `dicom.js` | Parser, writer, value validation, data dictionary, derived-copy marking |
| `imaging.js` | Rotate, flip, crop, median, smoothing, sharpening, bad pixels, windowing |
| `export.js` | ZIP, TIFF and PDF builders |
| `sample.js` | Synthetic sample radiograph (not real inspection data) |
| `app.js`, `index.html` | User interface |
| `tools/build-single.cjs` | Builds the single-file HTML |
| `tools/make-sample.cjs` | Writes the sample to a .dcm file |

## Tests

```sh
node diconde-editor/tests/test-core.cjs   # parser/writer, validation, derivation, image ops, exporters
node diconde-editor/tests/test-ui.cjs     # browser workflow (needs Playwright + Chromium; CHROME_BINARY optional)
npm run test:diconde                      # both
```

The sample file written by this tool was also read back successfully with pydicom during development. Files from real scanners (for example Carestream INDUSTREX DR/CR exports) have not been tested yet. `tests/industrex-fixture.cjs` builds a synthetic file with the same layout as real INDUSTREX 7.2.1 exports for the tests; `tests/test-real-files.cjs` checks your own files when `DICONDE_REAL_DIR` is set.
