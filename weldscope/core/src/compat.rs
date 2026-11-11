//! INDUSTREX compatibility check for a saved copy, compared with the file it came from. Rules come from
//! Carestream's INDUSTREX DICOM/DICONDE Conformance Statement (rev. 10.0, 2017) and from what real INDUSTREX
//! 7.2.1 exports contain. Passing these checks is strong evidence, not proof: only opening the copy in INDUSTREX
//! itself confirms it. Ported from diconde-editor/compat.js.

use crate::codec;
use crate::dicom::{self as d, DicomFile, Value, PIXEL};
use std::collections::HashSet;

/// Transfer syntaxes INDUSTREX reads (Conformance Statement 3.1.2).
pub const READABLE_TS: [&str; 8] = ["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2", "1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51",
    "1.2.840.10008.1.2.4.70", "1.2.840.10008.1.2.4.90", "1.2.840.10008.1.2.4.91"];
/// SOP classes INDUSTREX processes (3.1.1).
pub fn sop_name(uid: &str) -> Option<&'static str> {
    match uid {
        "1.2.840.10008.5.1.4.1.1.1" => Some("CR Image Storage"),
        "1.2.840.10008.5.1.4.1.1.1.1" => Some("DX Image Storage (for presentation)"),
        "1.2.840.10008.5.1.4.1.1.1.1.1" => Some("DX Image Storage (for processing)"),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level { Fail, Warn, Info, Pass }
#[derive(Clone, Debug, PartialEq)]
pub struct Check { pub level: Level, pub title: String, pub detail: String }

#[derive(Clone, Debug, Default)]
pub struct CheckOptions { pub removed: Vec<u32>, pub edited: Vec<u32>, pub pixels_changed: bool, pub xml_tag: Option<u32> }

// Hex of a value without its padding byte, for comparing elements.
fn hexv(v: &[u8]) -> String {
    let mut h: String = v.iter().map(|b| format!("{b:02x}")).collect();
    if h.ends_with("00") || h.ends_with("20") { h.truncate(h.len() - 2); }
    h
}
const PIXEL_TAGS: [u32; 6] = [0x00280010, 0x00280011, 0x00280008, 0x00280106, 0x00280107, PIXEL];

pub fn check(bytes: &[u8], src: Option<&DicomFile>, o: &CheckOptions) -> Vec<Check> {
    let mut out = Vec::new();
    let mut add = |level: Level, title: &str, detail: String| out.push(Check { level, title: title.to_string(), detail });
    let pf = |ok: bool| if ok { Level::Pass } else { Level::Fail };
    let f = match d::parse(bytes) { Ok(f) => f, Err(e) => { add(Level::Fail, "File can be read as DICOM", e.0); return out; } };
    let ds = &f.ds;
    let s = |t| d::get_string(ds, t);
    let n = |t| d::get_number(ds, t);

    // File structure
    add(pf(bytes.len() > 132 && &bytes[128..132] == b"DICM"), "DICOM Part 10 file with preamble and \"DICM\"", String::new());
    let gl = d::get_number(&f.meta, 0x00020000).unwrap_or(0.0) as usize;
    let end = 132 + 12 + gl;
    add(pf(gl > 0 && end + 2 <= bytes.len() && u16::from_le_bytes([bytes[end], bytes[end + 1]]) != 0x0002), "File meta group length is correct", format!("{gl} bytes"));
    add(pf(READABLE_TS.contains(&f.transfer_syntax.as_str())), "Transfer syntax is one INDUSTREX reads", d::ts_name(&f.transfer_syntax).to_string());
    let sop = s(0x00080016);
    add(pf(sop_name(&sop).is_some()), "SOP class is one INDUSTREX processes", sop_name(&sop).map(String::from).unwrap_or(if sop.is_empty() { "missing".into() } else { sop.clone() }));
    add(pf(d::get_string(&f.meta, 0x00020002) == sop), "File meta SOP class matches the data set", String::new());
    let uid = s(0x00080018);
    add(pf(!uid.is_empty() && d::validate("UI", &uid).is_none() && d::get_string(&f.meta, 0x00020003) == uid), "SOP Instance UID is valid and matches the file meta", uid.clone());
    if let Some(src) = src {
        add(pf(uid != d::get_string(&src.ds, 0x00080018)), "Copy has its own SOP Instance UID (INDUSTREX does the same on save)", String::new());
        if src.ds.has(0x00200013) { add(if s(0x00200013).is_empty() { Level::Warn } else { Level::Pass }, "Instance Number present", String::new()); }
    }

    // Image pixel module
    let (rows, cols, ba, bs, hb, pr) = (n(0x00280010).unwrap_or(0.0), n(0x00280011).unwrap_or(0.0), n(0x00280100).unwrap_or(0.0), n(0x00280101).unwrap_or(0.0), n(0x00280102).unwrap_or(-1.0), n(0x00280103).unwrap_or(-1.0));
    let spp = n(0x00280002).filter(|v| *v != 0.0).unwrap_or(1.0);
    let photo = s(0x00280004);
    let frames = (n(0x00280008).unwrap_or(1.0) as usize).max(1);
    add(pf(rows > 0.0 && cols > 0.0 && (ba == 8.0 || ba == 16.0) && bs > 0.0 && bs <= ba && hb == bs - 1.0 && (pr == 0.0 || pr == 1.0) && spp == 1.0 && (photo == "MONOCHROME1" || photo == "MONOCHROME2")),
        "Image pixel attributes are consistent", format!("{cols}×{rows}, {bs}/{ba} bits, high bit {hb}, {photo}"));
    if let Some(src) = src {
        let same = [0x00280100u32, 0x00280101, 0x00280102, 0x00280103, 0x00280004, 0x00280002].iter().all(|&t| d::get_string(&src.ds, t) == s(t));
        add(pf(same), "Bit depth, sign and photometric interpretation unchanged from the original", String::new());
    }

    // Pixel data
    let mut pixels: Option<d::Image> = None;
    match ds.el.get(&PIXEL).map(|p| &p.value) {
        None | Some(Value::Items(_)) => add(Level::Fail, "Pixel data present", String::new()),
        Some(Value::Fragments(frags)) => {
            add(pf(frags.len() >= 2), "Compressed pixel data has an offset table item and at least one fragment", String::new());
            add(pf(frags[0].len() == 4 * frames || frags[0].is_empty()), "Basic Offset Table is valid", format!("{} bytes", frags[0].len()));
            if codec::can_decode(&f.transfer_syntax) {
                let streams = codec::frame_streams(frags, frames).unwrap_or_default();
                let info = streams.first().and_then(|s| codec::codestream_info(s)).unwrap_or_default();
                add(pf(info.width as f64 == cols && info.height as f64 == rows && info.components == 1), "JPEG 2000 header matches Rows/Columns, one component", format!("{}×{}", info.width, info.height));
                if f.transfer_syntax == codec::J2K_LOSSLESS { add(pf(info.reversible), "Lossless syntax uses the reversible 5/3 wavelet", String::new()); }
                add(pf(info.precision as f64 >= bs && info.precision as f64 <= ba), "JPEG 2000 precision fits Bits Stored and Bits Allocated", format!("precision {}, stored {}", info.precision, bs));
                if let Some(src) = src.filter(|s| s.encapsulated() && codec::can_decode(&s.transfer_syntax)) {
                    let si = src.ds.el.get(&PIXEL).and_then(|p| p.fragments()).and_then(|fr| codec::frame_streams(fr, 1).ok()).and_then(|v| v.first().and_then(|s| codec::codestream_info(s))).unwrap_or_default();
                    let mut diffs = Vec::new();
                    if si.precision != info.precision { diffs.push(format!("precision {} (original {})", info.precision, si.precision)); }
                    if si.progression != info.progression { diffs.push(format!("progression {} (original {})", info.progression, si.progression)); }
                    if si.reversible != info.reversible { diffs.push("wavelet differs".into()); }
                    let tiling = si.tile_width != info.tile_width || si.tile_height != info.tile_height;
                    add(if diffs.is_empty() { Level::Pass } else { Level::Warn }, "JPEG 2000 encoded like the original",
                        if diffs.is_empty() { format!("{}, {}-bit, reversible, {}×{} tiles", info.progression, info.precision, info.tile_width, info.tile_height) } else { diffs.join(", ") });
                    if tiling { add(Level::Info, "JPEG 2000 tiling differs from the original", format!("copy {}×{}, original {}×{}; both are baseline JPEG 2000", info.tile_width, info.tile_height, si.tile_width, si.tile_height)); }
                }
                match codec::decode_frames(frags, &d::image_geometry(&f)) {
                    Ok(fb) => match d::image_from_frames(&f, &fb) {
                        Ok(img) => { add(Level::Pass, "JPEG 2000 data decodes to the stated image size", format!("{frames} frame(s)")); pixels = Some(img); }
                        Err(e) => add(Level::Fail, "JPEG 2000 data decodes to the stated image size", e.message),
                    },
                    Err(e) => add(Level::Fail, "JPEG 2000 data decodes", e.0),
                }
            }
        }
        Some(Value::Bytes(b)) => {
            let need = (rows * cols * (ba / 8.0)) as usize * frames;
            add(pf(b.len() >= need && b.len() <= need + 1), "Uncompressed pixel data length matches the image size", format!("{} bytes, expected {need}", b.len()));
            if let Ok(img) = d::get_image(&f) { pixels = Some(img); }
        }
    }
    if let Some(p) = &pixels {
        let (mut lo, mut hi) = (i32::MAX, i32::MIN);
        for fr in &p.frames { for &v in fr { lo = lo.min(v); hi = hi.max(v); } }
        add(pf(lo >= p.min && hi <= p.max), "Pixel values fit in Bits Stored", format!("{lo}–{hi}"));
        if ds.has(0x00280106) && ds.has(0x00280107) {
            add(pf(n(0x00280106) == Some(lo as f64) && n(0x00280107) == Some(hi as f64)), "Smallest/Largest Image Pixel Value match the pixels", format!("{}–{}", s(0x00280106), s(0x00280107)));
        }
    }

    // Metadata compared with the original
    if let Some(src) = src {
        let removed: HashSet<u32> = o.removed.iter().copied().collect();
        let edited: HashSet<u32> = o.edited.iter().copied().collect();
        let mut derived: HashSet<u32> = [0x00080018u32, 0x00080012, 0x00080013, 0x00080008, 0x00082111, 0x00082112, 0x0020000E, 0x00200013, 0x00281050, 0x00281051].into_iter().collect();
        derived.extend(PIXEL_TAGS);
        let (mut missing, mut vr_changed, mut changed) = (Vec::new(), Vec::new(), Vec::new());
        for (t, e) in &src.ds.el {
            let Some(oe) = ds.el.get(t) else { if !removed.contains(t) && !edited.contains(t) { missing.push(d::tag_hex(*t)); } continue; };
            // Pixel data is OB when compressed and OW when uncompressed 16-bit, so its VR follows the transfer syntax.
            if oe.vr != e.vr && e.vr.as_str() != "UN" && *t != PIXEL { vr_changed.push(format!("{} {}→{}", d::tag_hex(*t), e.vr, oe.vr)); }
            if !edited.contains(t) && !derived.contains(t) && oe.items().is_none() && e.items().is_none() {
                let a = e.bytes().map(hexv);
                let z = oe.bytes().map(hexv);
                if a != z && Some(*t) != o.xml_tag { changed.push(d::tag_hex(*t)); }
            }
        }
        let kept = src.ds.el.len() - removed.len().min(src.ds.el.len());
        add(pf(missing.is_empty()), "Every original element is kept (except ones deliberately left out)",
            if !missing.is_empty() { format!("missing: {}", missing.iter().take(8).cloned().collect::<Vec<_>>().join(", ")) } else { format!("{kept} of {} kept{}", src.ds.el.len(), if removed.is_empty() { String::new() } else { format!(", {} left out on purpose", removed.len()) }) });
        add(pf(vr_changed.is_empty()), "Value representations unchanged", vr_changed.iter().take(6).cloned().collect::<Vec<_>>().join(", "));
        add(pf(changed.is_empty()), "Only edited and derived fields changed", changed.iter().take(8).cloned().collect::<Vec<_>>().join(", "));
        if let Some(pc) = d::industrex_info(&src.ds) {
            let oc = d::industrex_info(ds);
            add(pf(oc.as_ref().map_or(false, |oc| oc.block == pc.block && oc.creator == pc.creator && oc.version == pc.version)), "INDUSTREX private block kept at the same place",
                oc.map_or("missing".into(), |oc| format!("{} {}", oc.creator, oc.version)));
        }
        if o.pixels_changed { add(pf(s(0x00080008).starts_with("DERIVED\\SECONDARY")), "Processed image marked DERIVED\\SECONDARY (as INDUSTREX does)", String::new()); }
        else { add(pf(s(0x00080008) == d::get_string(&src.ds, 0x00080008)), "Image Type unchanged for a metadata-only copy", String::new()); }
    }

    // Values and text
    let utf8 = d::charset_is_utf8(ds);
    let mut bad = Vec::new();
    for (t, e) in &ds.el {
        if e.bytes().is_none() || (t >> 16) & 1 == 1 || !d::editable(e.vr.as_str()) { continue; }
        if let Some(m) = d::validate(e.vr.as_str(), &d::value_to_text(e, utf8)) { bad.push(format!("{}: {m}", d::tag_hex(*t))); }
    }
    add(if bad.is_empty() { Level::Pass } else { Level::Warn }, "Text and number values are valid for their VR", bad.iter().take(5).cloned().collect::<Vec<_>>().join("; "));
    if d::industrex_xml_values(ds, 0x00080060).is_some() {
        let (_, text) = d::industrex_xml(ds).unwrap();
        let open = text.matches("<diconde ").count() + text.matches("<non_diconde ").count();
        let close = text.matches("</diconde>").count() + text.matches("</non_diconde>").count() + regex::Regex::new(r"<(non_)?diconde [^>]*/>").unwrap().find_iter(&text).count();
        add(pf(text.starts_with("<?xml") && text.ends_with("</presentation_state>") && open == close), "INDUSTREX XML presentation state is intact", String::new());
        let stale: Vec<String> = o.edited.iter().filter(|&&t| {
            match d::industrex_xml_values(ds, t) { None => false, Some(v) => {
                let want = ds.el.get(&t).filter(|e| e.bytes().is_some()).map(|e| d::value_to_text(e, utf8)).unwrap_or_default();
                v.join("\\") != want
            } }
        }).map(|t| d::tag_hex(*t)).collect();
        add(pf(stale.is_empty()), "INDUSTREX's XML copy agrees with edited fields", stale.join(", "));
    } else if src.map_or(false, |s| d::industrex_xml_values(&s.ds, 0x00080060).is_some()) {
        add(Level::Info, "INDUSTREX XML presentation state left out (pixels changed); INDUSTREX will use its default view", String::new());
    }
    out
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Summary { pub fail: usize, pub warn: usize, pub pass: usize }
pub fn summary(r: &[Check]) -> Summary {
    Summary { fail: r.iter().filter(|c| c.level == Level::Fail).count(), warn: r.iter().filter(|c| c.level == Level::Warn).count(), pass: r.iter().filter(|c| c.level == Level::Pass).count() }
}
