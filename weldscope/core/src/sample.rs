//! Synthetic DICONDE DR file for trying the editor and for tests. Not a real inspection image.

use crate::dicom::{self as d, DicomFile, Dataset, Element, Value, Vr, PIXEL};

pub struct SampleOptions { pub rows: usize, pub cols: usize, pub bits_stored: u32, pub sop_uid: Option<String> }
impl Default for SampleOptions { fn default() -> Self { SampleOptions { rows: 240, cols: 640, bits_stored: 16, sop_uid: None } } }

pub fn make_sample(o: &SampleOptions) -> DicomFile {
    let (rows, cols, bits) = (o.rows, o.cols, o.bits_stored);
    let max = ((1u64 << bits) - 1) as f64;
    let mut img = vec![0u16; rows * cols];
    let mut seed: u32 = 12345;
    let mut rnd = || { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); seed as f64 / 4294967296.0 };
    for y in 0..rows { for x in 0..cols {
        let wall = (y as f64 - rows as f64 / 2.0).abs() / (rows as f64 / 2.0); // thicker steel near the centre line
        let mut v = max * (0.25 + 0.5 * wall * wall) * (0.9 + 0.1 * x as f64 / cols as f64);
        if (y as f64 - rows as f64 / 2.0).abs() < rows as f64 * 0.08 { v *= 0.82; } // weld cap
        if x % 80 == 40 && (y as f64) > rows as f64 * 0.1 && (y as f64) < rows as f64 * 0.3 { v *= 0.7; } // IQI wires
        v += (rnd() - 0.5) * max * 0.02;
        img[y * cols + x] = v.round().clamp(0.0, max) as u16;
    } }
    for (x, y) in [(17usize, 23usize), (300, 120), (611, 200)] { if x < cols && y < rows { img[y * cols + x] = max as u16; } } // hot pixels
    let mut ds = Dataset::default();
    let mut set = |t: u32, v: &str, vr: Option<&str>| ds.set_text_cs(t, v, vr, d::Charset::Latin1).expect("sample value");
    set(0x00080005, "ISO_IR 100", None); set(0x00080008, "ORIGINAL\\PRIMARY", None); set(0x00080016, "1.2.840.10008.5.1.4.1.1.1.1", None);
    set(0x00080018, &o.sop_uid.clone().unwrap_or_else(d::new_uid), None); set(0x00080020, "20261014", None); set(0x00080030, "101500", None); set(0x00080060, "DX", None);
    set(0x00080070, "Sample Systems", None); set(0x00080080, "Sample Inspection Co", None); set(0x00081070, "Tech^Sample", None);
    set(0x00100010, "Pipe Spool 12", None); set(0x00100020, "WELD-0042", None); set(0x00102160, "Carbon steel", None);
    set(0x00140030, "8.74", None); set(0x00140054, "168.3", None); set(0x00181164, "0.1\\0.1", None); set(0x00181110, "700", None);
    set(0x0020000D, &d::new_uid(), None); set(0x0020000E, &d::new_uid(), None); set(0x00200013, "1", None); set(0x00204000, "Synthetic sample", None);
    set(0x00280002, "1", Some("US")); set(0x00280004, "MONOCHROME2", None); set(0x00280010, &rows.to_string(), Some("US")); set(0x00280011, &cols.to_string(), Some("US"));
    set(0x00280100, "16", Some("US")); set(0x00280101, &bits.to_string(), Some("US")); set(0x00280102, &(bits - 1).to_string(), Some("US")); set(0x00280103, "0", Some("US"));
    set(0x00281050, &((max * 0.49).round() as i64).to_string(), None); set(0x00281051, &((max * 0.7).round() as i64).to_string(), None);
    ds.el.insert(PIXEL, Element { tag: PIXEL, vr: Vr::new("OW"), value: Value::Bytes(img.iter().flat_map(|v| v.to_le_bytes()).collect()) });
    DicomFile { meta: Dataset::default(), ds, transfer_syntax: d::TS_EXPLICIT_LE.into() }
}
