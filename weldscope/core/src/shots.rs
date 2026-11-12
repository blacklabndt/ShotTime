//! Shots: one file each, with the parsed original (never edited), a working copy for metadata and the record of
//! original values of the fields changed. Grouping by weld, batch metadata edits (validated before anything
//! changes), renumbering and metadata-only copies. Ported from diconde-editor/shots.js and the metadata parts of
//! app.js. Originals are never changed; saving writes new copies.

use crate::dicom::{self as d, DicomFile, Dataset, Element, PIXEL};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Fields that can identify the weld. Series Description holds the weld/shot ID in INDUSTREX exports.
pub const GROUP_FIELDS: [u32; 6] = [0x0008103E, 0x00100020, 0x00100010, 0x00081030, 0x00204000, 0x00101000];

/// Key of a changed field: "ggggeeee" at the top level, "ssssssss/i/ggggeeee" inside sequence items.
pub type OrigEls = BTreeMap<String, Option<Element>>;
pub type Path = Vec<(u32, usize)>;

pub fn key_of(path: &[(u32, usize)], tag: u32) -> String {
    let mut s = String::new();
    for (t, i) in path { s += &format!("{}/{}/", d::hex8(*t), i); }
    s + &d::hex8(tag)
}
pub fn ds_at<'a>(ds: &'a Dataset, path: &[(u32, usize)]) -> Option<&'a Dataset> {
    let mut cur = ds;
    for (t, i) in path { cur = cur.el.get(t)?.items()?.get(*i)?; }
    Some(cur)
}
pub fn ds_at_mut<'a>(ds: &'a mut Dataset, path: &[(u32, usize)]) -> Option<&'a mut Dataset> {
    let mut cur = ds;
    for (t, i) in path { cur = cur.el.get_mut(t)?.items_mut()?.get_mut(*i)?; }
    Some(cur)
}
fn parse_key(key: &str) -> (Path, u32) {
    let parts: Vec<&str> = key.split('/').collect();
    let mut path = Vec::new();
    let mut i = 0;
    while i + 2 < parts.len() { path.push((u32::from_str_radix(parts[i], 16).unwrap_or(0), parts[i + 1].parse().unwrap_or(0))); i += 2; }
    (path, u32::from_str_radix(parts[parts.len() - 1], 16).unwrap_or(0))
}
/// Top-level tags the user changed.
pub fn changed_tags(orig_els: &OrigEls) -> Vec<u32> { orig_els.keys().filter(|k| !k.contains('/')).filter_map(|k| u32::from_str_radix(k, 16).ok()).collect() }

fn same_as_orig(orig_els: &OrigEls, key: &str, cur: Option<&Element>) -> bool {
    match (orig_els.get(key).and_then(|o| o.as_ref()), cur) {
        (None, None) => true,
        (Some(o), Some(c)) => o.vr == c.vr && o.bytes().is_some() && o.bytes() == c.bytes(),
        _ => false,
    }
}
fn remember(orig_els: &mut OrigEls, key: &str, ds: &Dataset, tag: u32) { if !orig_els.contains_key(key) { orig_els.insert(key.into(), ds.el.get(&tag).cloned()); } }

/// What a metadata edit did, for undo text. None when nothing changed.
pub fn set_field(file: &mut DicomFile, orig_els: &mut OrigEls, path: &[(u32, usize)], tag: u32, text: &str, vr: Option<&str>) -> Result<Option<String>, String> {
    let mode = d::charset_mode(&file.ds);
    let utf8 = d::charset_is_utf8(&file.ds);
    let name = d::describe_tag(&file.ds, tag).name;
    let key = key_of(path, tag);
    let ds = ds_at_mut(&mut file.ds, path).ok_or("That sequence item no longer exists.")?;
    let before = ds.el.get(&tag).cloned();
    let old_text = before.as_ref().map(|b| d::value_to_text(b, utf8)).unwrap_or_default();
    remember(orig_els, &key, ds, tag);
    if text.is_empty() && before.is_none() { if same_as_orig(orig_els, &key, ds.el.get(&tag)) { orig_els.remove(&key); } return Ok(None); }
    if let Err(e) = ds.set_text_cs(tag, text, vr, mode) { if same_as_orig(orig_els, &key, ds.el.get(&tag)) { orig_els.remove(&key); } return Err(e.0); }
    if same_as_orig(orig_els, &key, ds.el.get(&tag)) { orig_els.remove(&key); }
    let new_text = ds.el.get(&tag).map(|e| d::value_to_text(e, utf8)).unwrap_or_default();
    Ok(if before.is_none() { Some(format!("Added {name}")) } else if new_text != old_text { Some(format!("{name}: “{old_text}” → “{new_text}”")) } else { None })
}
pub fn delete_field(file: &mut DicomFile, orig_els: &mut OrigEls, path: &[(u32, usize)], tag: u32) -> String {
    let name = d::describe_tag(&file.ds, tag).name;
    let key = key_of(path, tag);
    if let Some(ds) = ds_at_mut(&mut file.ds, path) {
        remember(orig_els, &key, ds, tag);
        ds.remove(tag);
        if same_as_orig(orig_els, &key, ds.el.get(&tag)) { orig_els.remove(&key); }
    }
    format!("Removed {name}")
}
pub fn revert_field(file: &mut DicomFile, orig_els: &mut OrigEls, path: &[(u32, usize)], tag: u32) -> String {
    let name = d::describe_tag(&file.ds, tag).name;
    let key = key_of(path, tag);
    let o = orig_els.remove(&key).flatten();
    if let Some(ds) = ds_at_mut(&mut file.ds, path) { match o { Some(e) => { ds.el.insert(tag, e); } None => { ds.el.remove(&tag); } } }
    format!("Reverted {name}")
}
/// Human-readable list of metadata changes.
pub fn meta_change_list(file: &DicomFile, orig_els: &OrigEls) -> Vec<String> {
    let utf8 = d::charset_is_utf8(&file.ds);
    orig_els.iter().map(|(key, orig)| {
        let (path, tag) = parse_key(key);
        let cur = ds_at(&file.ds, &path).and_then(|ds| ds.el.get(&tag));
        let name = d::describe_tag(&file.ds, tag).name + if path.is_empty() { "" } else { " (in sequence)" };
        let a = orig.as_ref().map(|o| d::value_to_text(o, utf8)).unwrap_or_default();
        let b = cur.map(|c| d::value_to_text(c, utf8)).unwrap_or_default();
        match (orig, cur) { (None, _) => format!("{name}: added “{b}”"), (_, None) => format!("{name}: removed (was “{a}”)"), _ => format!("{name}: “{a}” → “{b}”") }
    }).collect()
}

/// Metadata state for undo: every element except the pixels, plus the record of original values.
#[derive(Clone, Debug)]
pub struct MetaSnap { pub el: BTreeMap<u32, Element>, pub orig_els: OrigEls }
pub fn meta_snapshot(file: &DicomFile, orig_els: &OrigEls) -> MetaSnap {
    MetaSnap { el: file.ds.el.iter().filter(|(t, _)| **t != PIXEL).map(|(t, e)| (*t, e.clone())).collect(), orig_els: orig_els.clone() }
}
pub fn meta_restore(file: &mut DicomFile, orig_els: &mut OrigEls, snap: MetaSnap) {
    let px = file.ds.el.remove(&PIXEL);
    file.ds.el = snap.el;
    if let Some(p) = px { file.ds.el.insert(PIXEL, p); }
    *orig_els = snap.orig_els;
}

// ---------------------------------------------------------------- shots
#[derive(Clone, Debug)]
pub struct Shot { pub id: u64, pub name: String, pub path: String, pub orig: Arc<DicomFile>, pub file: DicomFile, pub orig_els: OrigEls, pub saved_as: String }

pub fn load(bytes: &[u8], name: &str, path: &str, id: u64) -> Result<Shot, d::DicomError> {
    let orig = d::parse(bytes)?;
    Ok(Shot { id, name: name.into(), path: path.into(), file: orig.clone(), orig: Arc::new(orig), orig_els: OrigEls::new(), saved_as: String::new() })
}
impl Shot {
    pub fn text(&self, tag: u32) -> String { d::get_string(&self.file.ds, tag) }
    pub fn is_edited(&self) -> bool { !self.orig_els.is_empty() }
}

/// Shot order inside a weld: Instance Number, then acquisition date/time, then file name.
pub fn shot_order(a: &Shot, b: &Shot) -> std::cmp::Ordering {
    let n = |e: &Shot| d::get_number(&e.file.ds, 0x00200013).unwrap_or(f64::INFINITY);
    let t = |e: &Shot| e.text(0x00080022) + &e.text(0x00080032);
    n(a).partial_cmp(&n(b)).unwrap_or(std::cmp::Ordering::Equal).then_with(|| t(a).cmp(&t(b))).then_with(|| a.name.cmp(&b.name))
}
/// Natural order for weld names ("W2" before "W10").
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new(); while let Some(c) = ai.peek().copied().filter(|c| c.is_ascii_digit()) { na.push(c); ai.next(); }
                let mut nb = String::new(); while let Some(c) = bi.peek().copied().filter(|c| c.is_ascii_digit()) { nb.push(c); bi.next(); }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then(ta.cmp(tb));
                if o != std::cmp::Ordering::Equal { return o; }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase()).then(x.cmp(&y));
                if o != std::cmp::Ordering::Equal { return o; }
                ai.next(); bi.next();
            }
        }
    }
}
/// Groups shot indices by the value of `tag` (trimmed). Shots without a value are grouped under "" and listed last.
pub fn groups(shots: &[&Shot], tag: u32) -> Vec<(String, Vec<usize>)> {
    let mut m: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, e) in shots.iter().enumerate() { m.entry(e.text(tag).trim().to_string()).or_default().push(i); }
    let mut v: Vec<(String, Vec<usize>)> = m.into_iter().collect();
    v.sort_by(|(a, _), (b, _)| (a.is_empty()).cmp(&b.is_empty()).then_with(|| natural_cmp(a, b)));
    for (_, list) in v.iter_mut() { list.sort_by(|&x, &y| shot_order(shots[x], shots[y])); }
    v
}

#[derive(Clone, Debug, PartialEq)]
pub enum Common { Same(String), Mixed(usize) }
/// For the selected shots: each tag's shared value, or how many different values there are.
pub fn common_values(shots: &[&Shot], tags: &[u32]) -> BTreeMap<u32, Common> {
    tags.iter().map(|&t| {
        let vals: std::collections::BTreeSet<String> = shots.iter().map(|e| e.text(t)).collect();
        (t, if vals.len() == 1 { Common::Same(vals.into_iter().next().unwrap()) } else { Common::Mixed(vals.len()) })
    }).collect()
}

/// Sets (Some) or removes (None) one top-level field on one shot, keeping the record of original values.
pub fn set_on(e: &mut Shot, tag: u32, value: Option<&str>, vr: Option<&str>) -> Result<(), String> {
    let key = d::hex8(tag);
    remember(&mut e.orig_els, &key, &e.file.ds, tag);
    let r = match value { None => { e.file.ds.remove(tag); Ok(()) } Some(v) => e.file.ds.set_text(tag, v, vr).map_err(|x| x.0) };
    if same_as_orig(&e.orig_els, &key, e.file.ds.el.get(&tag)) { e.orig_els.remove(&key); }
    r
}

#[derive(Clone, Debug, PartialEq)]
pub struct BatchError { pub name: String, pub field: String, pub message: String }
/// Checks every change against every shot before changing anything; then applies all of them.
pub fn apply_batch(shots: &mut [&mut Shot], changes: &[(u32, Option<String>)]) -> Result<usize, Vec<BatchError>> {
    let mut errors = Vec::new();
    for e in shots.iter() {
        for (tag, v) in changes {
            let Some(v) = v else { continue };
            let vr = e.file.ds.el.get(tag).map(|x| x.vr.as_str().to_string()).or_else(|| d::tag_info(*tag).vr.map(String::from));
            let Some(vr) = vr else { errors.push(BatchError { name: e.name.clone(), field: d::tag_hex(*tag), message: "unknown value representation".into() }); continue };
            let field = d::describe_tag(&e.file.ds, *tag).name;
            let text = if vr == "CS" { v.to_uppercase() } else { v.clone() };
            if let Some(m) = d::validate(&vr, &text) { errors.push(BatchError { name: e.name.clone(), field, message: m }); continue; }
            if let Err(x) = d::text_to_bytes(&vr, &text, d::charset_mode(&e.file.ds)) { errors.push(BatchError { name: e.name.clone(), field, message: x.0 }); }
        }
    }
    if !errors.is_empty() { return Err(errors); }
    for e in shots.iter_mut() {
        for (tag, v) in changes {
            if v.is_none() && !e.file.ds.has(*tag) { continue; }
            let vr = e.file.ds.el.get(tag).map(|x| x.vr.as_str().to_string()).or_else(|| d::tag_info(*tag).vr.map(String::from));
            set_on(e, *tag, v.as_deref(), vr.as_deref()).map_err(|m| vec![BatchError { name: e.name.clone(), field: d::tag_hex(*tag), message: m }])?;
        }
    }
    Ok(shots.len())
}

/// Numbers shots start…n (Instance Number) in the given order.
pub fn renumber(shots: &mut [&mut Shot], start: usize) -> Result<(), String> {
    for (i, e) in shots.iter_mut().enumerate() { set_on(e, 0x00200013, Some(&(start + i).to_string()), Some("IS"))?; }
    Ok(())
}

/// Metadata state of shots, for undo (pixels are never part of it and are not copied).
#[derive(Clone, Debug)]
pub struct ShotSnap { pub id: u64, pub snap: MetaSnap }
pub fn snapshot(shots: &[&Shot]) -> Vec<ShotSnap> { shots.iter().map(|e| ShotSnap { id: e.id, snap: meta_snapshot(&e.file, &e.orig_els) }).collect() }
pub fn restore(shots: &mut [&mut Shot], snaps: Vec<ShotSnap>) {
    for s in snaps { if let Some(e) = shots.iter_mut().find(|e| e.id == s.id) { let Shot { file, orig_els, .. } = &mut **e; meta_restore(file, orig_els, s.snap); } }
}

/// A metadata-only copy of an edited shot: INDUSTREX's XML copy updated, new SOP Instance UID, original kept.
pub struct MetaCopy { pub copy: DicomFile, pub bytes: Vec<u8>, pub edited: Vec<u32>, pub synced: Vec<u32> }
pub fn build_meta_copy(e: &Shot) -> Result<MetaCopy, d::DicomError> {
    let mut copy = e.file.clone();
    let tags = changed_tags(&e.orig_els);
    let synced = d::sync_industrex_xml(&mut copy.ds, &tags);
    d::derive(&mut copy, &e.orig, &d::DeriveOptions::default())?;
    let bytes = d::write(&copy)?;
    Ok(MetaCopy { copy, bytes, edited: tags, synced })
}
/// File names for saved copies: name_edited.dcm, made unique within the batch.
pub fn copy_names(names: &[&str]) -> Vec<String> {
    let mut used = std::collections::HashSet::new();
    names.iter().map(|n| {
        let lower = n.to_lowercase();
        let stem = ["dcm", "dicom", "dic"].iter().find_map(|ext| if lower.ends_with(&format!(".{ext}")) { Some(&n[..n.len() - ext.len() - 1]) } else { None }).unwrap_or(n);
        let base = format!("{stem}_edited");
        let mut name = format!("{base}.dcm");
        let mut i = 2;
        while used.contains(&name.to_lowercase()) { name = format!("{base}_{i}.dcm"); i += 1; }
        used.insert(name.to_lowercase());
        name
    }).collect()
}

// ---------------------------------------------------------------- coverage
/// Coverage (the location-marker range a shot shows, e.g. "0-35") is kept as its own line in Image Comments
/// (0020,4000): "Coverage: 0-35". DICONDE has no dedicated element for it, and INDUSTREX shows Image Comments.
pub const COMMENTS: u32 = 0x00204000;
const COVERAGE_LABEL: &str = "coverage:";
fn is_coverage_line(l: &str) -> bool { l.trim_start().get(..COVERAGE_LABEL.len()).map_or(false, |p| p.eq_ignore_ascii_case(COVERAGE_LABEL)) }

/// The coverage recorded in an Image Comments text ("" when none).
pub fn coverage_in(comments: &str) -> String {
    comments.lines().find(|l| is_coverage_line(l)).map(|l| l.trim_start()[COVERAGE_LABEL.len()..].trim().to_string()).unwrap_or_default()
}
/// Image Comments with the coverage line set, replaced or (for an empty coverage) removed; other text is kept.
pub fn with_coverage(comments: &str, coverage: &str) -> String {
    let cov = coverage.trim();
    let mut lines: Vec<String> = comments.lines().filter(|l| !is_coverage_line(l)).map(|l| l.to_string()).collect();
    while lines.last().map_or(false, |l| l.trim().is_empty()) { lines.pop(); }
    if !cov.is_empty() { lines.push(format!("Coverage: {cov}")); }
    lines.join("\r\n")
}
/// A message when the text cannot be stored as a coverage.
pub fn coverage_problem(coverage: &str) -> Option<String> {
    if coverage.contains('\n') || coverage.contains('\r') { return Some("Coverage must be a single line".into()); }
    if coverage.trim().chars().count() > 64 { return Some("Coverage is limited to 64 characters".into()); }
    None
}
impl Shot { pub fn coverage(&self) -> String { coverage_in(&self.text(COMMENTS)) } }
/// Sets (or, when empty, clears) a shot's coverage through the normal field path, so it is tracked like any edit.
pub fn set_coverage(e: &mut Shot, coverage: &str) -> Result<(), String> {
    if let Some(m) = coverage_problem(coverage) { return Err(m); }
    let now = e.text(COMMENTS);
    let next = with_coverage(&now, coverage);
    if next == now { return Ok(()); }
    if next.is_empty() { delete_field(&mut e.file, &mut e.orig_els, &[], COMMENTS); return Ok(()); }
    set_field(&mut e.file, &mut e.orig_els, &[], COMMENTS, &next, Some("LT")).map(|_| ())
}
