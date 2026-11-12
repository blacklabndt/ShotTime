//! Building saved copies. The open file uses the editor's state; another file in the folder uses what was kept
//! for it when the editor moved on, so it can be saved without opening. Ported from buildCopy in app.js.
//!
//! Rules (owner-confirmed with INDUSTREX 7.2.1): every copy gets a new SOP Instance UID. Pixel edits also mark the
//! image DERIVED\SECONDARY, add a new series, a Derivation Description and a Source Image Sequence, and drop what
//! INDUSTREX regenerates (CSH_NDT xx40/xx50/xx52/xx70) and the Icon Image Sequence. Metadata-only copies keep
//! everything and sync edited fields into INDUSTREX's XML mirror.

use crate::codec;
use crate::dicom::{self as d, DicomFile, Image, PIXEL};
use crate::imaging::{self as im, Region};
use crate::shots::{changed_tags, OrigEls};

pub struct CopyState<'a> {
    pub file: &'a DicomFile,
    pub orig: &'a DicomFile,
    pub img: Option<&'a Image>,
    pub ops: &'a [String],
    pub turns: i32,
    pub orig_els: &'a OrigEls,
    /// Window centre/width to store in the copy (0028,1050/1051), when the user asked for it.
    pub store_window: Option<(f64, f64)>,
    /// Write processed pixels as JPEG 2000 Lossless (otherwise uncompressed).
    pub j2k: bool,
}
#[derive(Clone, Debug)]
pub struct PartInfo { pub series: String, pub index: usize, pub text: String }
#[derive(Clone, Copy, Debug, Default)]
/// `turns`: quarter turns clockwise applied to each saved piece, so it is stored the way it is viewed (the
/// INDUSTREX viewing angle is not carried into processed copies, so without this a piece would open on its side).
pub struct SplitOptions { pub straighten: bool, pub fill_slivers: bool, pub turns: i32 }

pub struct BuiltCopy { pub file: DicomFile, pub removed: Vec<u32>, pub synced: Vec<u32>, pub edited: Vec<u32>, pub pixels_changed: bool, pub description: String }

/// Window values as INDUSTREX-friendly DS text (two decimals at most).
pub fn ds_number(v: f64) -> String {
    let r = (v * 100.0).round() / 100.0;
    let s = format!("{r}");
    if s.len() > 16 { format!("{v:.6e}") } else { s }
}

/// The source's J2K encoding (precision, progression, tiles), so INDUSTREX gets what it writes itself.
pub fn source_encoding(orig: &DicomFile) -> Option<codec::CodestreamInfo> {
    if !orig.encapsulated() { return None; }
    let frags = orig.ds.el.get(&PIXEL)?.fragments()?;
    codec::codestream_info(codec::frame_streams(frags, 1).ok()?.first()?)
}

pub fn encode_j2k(copy: &mut DicomFile, out: &Image, orig: &DicomFile) -> Result<(), String> {
    let src = source_encoding(orig).unwrap_or_default();
    let bits = if src.precision >= out.bits_stored as u32 && src.precision <= out.bits_allocated as u32 { src.precision } else { out.bits_stored as u32 };
    let tile = if src.has_siz && src.tile_width > 0 && src.tile_height > 0 && (src.tile_width < src.width || src.tile_height < src.height) { Some((src.tile_width, src.tile_height)) } else { None };
    let opts = codec::EncodeOptions { width: out.cols, height: out.rows, bits_per_sample: bits, signed: out.signed, progression: if src.progression.is_empty() { None } else { Some(src.progression.clone()) }, tile };
    let streams = out.frames.iter().map(|f| codec::encode_frame_lossless(f, &opts).map_err(|e| e.0)).collect::<Result<Vec<_>, _>>()?;
    d::set_encapsulated(copy, streams, codec::J2K_LOSSLESS);
    Ok(())
}

pub fn build_copy(st: &CopyState, region: Option<&Region>, part: Option<&PartInfo>, split: SplitOptions) -> Result<BuiltCopy, String> {
    let pixels_changed = !st.ops.is_empty() || region.is_some();
    let mut copy = st.file.clone();
    let mut part_text = part.map(|p| p.text.clone());
    if let (Some(img), true) = (st.img, pixels_changed) {
        let mut out = match region { Some(r) => im::crop(img, r.rect)?, None => img.clone() };
        if let Some(r) = region {
            if split.straighten {
                // straighten the piece and crop it to the film (pixels across a dividing line are not part of it)
                let s = im::straighten_piece(img, r, None, 5.0, 0.02, 0)?;
                out = s.img;
                if let Some(t) = part_text.as_mut() { *t += if s.rotated { format!("; straightened {:.2}° (bicubic resampling) and cropped to the film", s.angle) } else { "; cropped to the film".into() }.as_str(); }
            } else if !r.cuts.is_empty() && split.fill_slivers {
                if let Some(p) = img.padding {
                    for f in out.frames.iter_mut() { im::fill_outside_cuts(f, r, p); }
                    if let Some(t) = part_text.as_mut() { *t += "; pixels across the dividing line set to the Pixel Padding Value"; }
                }
            }
        }
        let piece_turns = if region.is_some() { split.turns.rem_euclid(4) } else { 0 };
        if piece_turns != 0 {
            out = im::rotate(&out, piece_turns);
            if let Some(t) = part_text.as_mut() { *t += format!("; turned {}° clockwise to the viewing angle", piece_turns * 90).as_str(); }
        }
        d::set_image(&mut copy, &out, (st.turns + piece_turns) % 2 != 0).map_err(|e| e.0)?;
        copy.transfer_syntax = d::TS_EXPLICIT_LE.into();
        if st.j2k && out.bits_allocated <= 16 { encode_j2k(&mut copy, &out, st.orig)?; }
    }
    if let Some((c, w)) = st.store_window {
        copy.ds.set_text(0x00281050, &ds_number(c), Some("DS")).map_err(|e| e.0)?;
        copy.ds.set_text(0x00281051, &ds_number(w), Some("DS")).map_err(|e| e.0)?;
    }
    // INDUSTREX mirrors the fields in its XML presentation state; keep that copy in step (processed copies drop the XML).
    let edited = changed_tags(st.orig_els);
    let mut synced = Vec::new();
    if !pixels_changed {
        let mut tags = edited.clone();
        if st.store_window.is_some() { tags.extend([0x00281050, 0x00281051]); }
        synced = d::sync_industrex_xml(&mut copy.ds, &tags);
    }
    let mut steps: Vec<String> = st.ops.to_vec();
    if let Some(t) = &part_text { steps.push(t.clone()); }
    let description = steps.join("; ");
    let removed = d::derive(&mut copy, st.orig, &d::DeriveOptions {
        pixels_changed, description: description.clone(),
        series_uid: match part { Some(p) => Some(p.series.clone()), None => if pixels_changed { Some(d::new_uid()) } else { None } },
        instance_number: part.map(|p| p.index),
    }).map_err(|e| e.0)?;
    Ok(BuiltCopy { file: copy, removed, synced, edited, pixels_changed, description })
}
