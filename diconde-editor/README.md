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

The sample file written by this tool was also read back successfully with pydicom during development. Files from real scanners (for example Carestream INDUSTREX DR/CR exports) have not been tested yet.
