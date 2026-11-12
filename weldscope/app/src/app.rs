//! Application state, background jobs, opening, undo, saving and the window layout.

use eframe::egui::{self, Color32, RichText};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use weldscope_core::compat::{self, Check, CheckOptions, Level};
use weldscope_core::copy::{self, CopyState, PartInfo, SplitOptions};
use weldscope_core::review::{self as rv, Review, ReviewFile, Verdict};
use weldscope_core::dicom::{self as d, DicomFile, Image};
use weldscope_core::imaging::{self as im, Rect, Region, Scratch, Window};
use weldscope_core::overlay::Layout;
use weldscope_core::shots::{self, MetaSnap, Shot};
use weldscope_core::codec;

pub type ImgRef = Arc<Image>;

/// Fields grouped and named as INDUSTREX presents them (Carestream DICONDE Conformance Statement, rev. 10.0).
pub const COMMON: &[(&str, &[u32])] = &[
    ("Component", &[0x00100010, 0x00100020, 0x00101000, 0x00101001, 0x00102160, 0x00140042, 0x00140030, 0x00140032, 0x00140054, 0x00100030, 0x00080090, 0x00104000]),
    ("Inspection", &[0x00080020, 0x00080030, 0x00080050, 0x00200010, 0x00081030, 0x00180015, 0x0008103E, 0x00204000, 0x00324000]),
    ("Company & people", &[0x00080080, 0x00081048, 0x00081050, 0x00081070, 0x00081060]),
    ("Equipment & technique", &[0x00080060, 0x00080070, 0x00081090, 0x00181000, 0x00181004, 0x00181260, 0x00180060, 0x00181150, 0x00181110, 0x00181164, 0x00280030, 0x001440A0, 0x001440A1, 0x001440A2]),
    ("Display", &[0x00281050, 0x00281051]),
];
pub const READ_ONLY: &[u32] = &[0x00080016, 0x00080018, 0x00280002, 0x00280004, 0x00280006, 0x00280008, 0x00280010, 0x00280011, 0x00280100, 0x00280101, 0x00280102, 0x00280103, d::PIXEL];
pub const VRS: &[&str] = &["LO", "SH", "LT", "ST", "PN", "CS", "DA", "TM", "DT", "DS", "IS", "UI", "AE", "US", "SS", "UL", "SL", "FL", "FD", "UT", "UC"];
pub fn batch_tags() -> Vec<u32> { COMMON.iter().filter(|(n, _)| *n != "Display").flat_map(|(_, t)| t.iter().copied()).collect() }
const MAX_IMAGE_UNDO: usize = 20;

pub const ACCENT: Color32 = Color32::from_rgb(0xF5, 0x8A, 0x1F);
pub const OK: Color32 = Color32::from_rgb(0x5C, 0xC4, 0x6A);
pub const BAD: Color32 = Color32::from_rgb(0xE8, 0x5A, 0x4F);
pub const WARN: Color32 = Color32::from_rgb(0xE6, 0xB4, 0x22);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Win { pub c: f64, pub w: f64 }
#[derive(Clone, Debug)]
pub struct RegionItem { pub region: Region, pub label: String, pub tilt: Option<f64> }
#[derive(Clone)]
pub struct ImageState { pub img: Option<ImgRef>, pub ops: Vec<String>, pub turns: i32, pub crop: Option<Rect>, pub regions: Vec<RegionItem> }
pub enum Step { Meta { snap: MetaSnap, text: String }, Image { state: ImageState, text: String } }
impl Step { pub fn text(&self) -> &str { match self { Step::Meta { text, .. } | Step::Image { text, .. } => text } } }

/// Unsaved work of one file. Kept when the editor moves to another file (pixels are dropped when there are no
/// image steps, and decoded again on return).
pub struct Work {
    pub img: Option<ImgRef>, pub orig_img: Option<ImgRef>, pub img_error: String, pub decoded: bool, pub loaded: bool,
    pub ops: Vec<String>, pub turns: i32, pub undo: Vec<Step>, pub redo: Vec<Step>, pub crop: Option<Rect>, pub regions: Vec<RegionItem>, pub win: Win, pub frame: usize,
}
impl Default for Work {
    fn default() -> Self { Work { img: None, orig_img: None, img_error: String::new(), decoded: false, loaded: false, ops: vec![], turns: 0, undo: vec![], redo: vec![], crop: None, regions: vec![], win: Win { c: 0.0, w: 1.0 }, frame: 0 } }
}

/// How a file relates to others in the list: which file it was made from (saved pieces and processed copies carry
/// a Source Image Sequence; a metadata-only copy has the same series and identical pixel data as its original).
#[derive(Clone, Debug, Default)]
pub struct Link { pub uid: String, pub sources: Vec<String>, pub series: String, pub pix: u64, pub created: String, pub piece: Option<(usize, usize)>, pub in_edited: bool }
impl Link {
    pub fn of(shot: &Shot) -> Link {
        let ds = &shot.orig.ds;
        let sources = ds.get(0x00082112).and_then(|e| e.items()).map(|it| it.iter().map(|i| i.string(0x00081155)).filter(|u| !u.is_empty()).collect()).unwrap_or_default();
        let mut h: u64 = 0xcbf29ce484222325;
        let mut eat = |b: &[u8]| { for &x in b.iter().take(4096).chain(b.iter().rev().take(4096)) { h ^= x as u64; h = h.wrapping_mul(0x100000001b3); } h ^= b.len() as u64; h = h.wrapping_mul(0x100000001b3); };
        match ds.get(d::PIXEL).map(|p| &p.value) { Some(d::Value::Bytes(b)) => eat(b), Some(d::Value::Fragments(f)) => for x in f.iter().skip(1) { eat(x) }, _ => {} }
        let desc = ds.string(0x00082111);
        let piece = desc.rfind("Split part ").and_then(|i| { let mut it = desc[i + 11..].split_whitespace(); let k = it.next()?.parse().ok()?; if it.next()? != "of" { return None; } let n = it.next()?.trim_end_matches(|c: char| !c.is_ascii_digit()).parse().ok()?; Some((k, n)) });
        let in_edited = Path::new(&shot.path).parent().and_then(|p| p.file_name()).map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("Edited"));
        Link { uid: ds.string(0x00080018), sources, series: ds.string(0x0020000E), pix: h, created: ds.string(0x00080012) + &ds.string(0x00080013), piece, in_edited }
    }
    /// What to call a file shown inside its original.
    pub fn label(&self) -> String {
        match self.piece { Some((k, n)) => format!("Piece {k} of {n}"), None => if self.sources.is_empty() { "Edited copy".into() } else { "Edited copy (image changed)".into() } }
    }
}
pub struct FileEntry { pub shot: Shot, pub work: Work, pub dirty: bool, pub saved_key: String, pub compat: Option<CompatResult>, pub link: Link, pub thumb: Option<egui::TextureHandle>, pub thumb_queued: bool, pub view_rot: u32, pub auto_cov: Option<(String, bool)> }
impl FileEntry {
    /// Coverage to show: the one stored in the file, else the one read from the film when it was opened.
    /// The second value is 0 for stored, 1 for read with every number in step, 2 for read but unsure.
    pub fn coverage_shown(&self) -> (String, u8) {
        let c = self.shot.coverage();
        if !c.is_empty() { return (c, 0); }
        match &self.auto_cov { Some((t, sure)) if !t.is_empty() => (t.clone(), if *sure { 1 } else { 2 }), _ => (String::new(), 0) }
    }
    pub fn state_key(&self) -> String { format!("{}:{}:{}", self.work.ops.len(), self.work.ops.join("|"), self.shot.orig_els.keys().cloned().collect::<Vec<_>>().join(",")) }
    pub fn has_changes(&self) -> bool { !self.work.ops.is_empty() || !self.shot.orig_els.is_empty() }
    pub fn refresh_dirty(&mut self) { self.dirty = self.has_changes() && self.state_key() != self.saved_key; }
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Mode { Edit, Organize }
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Tab { Metadata, Image, Crop, Overlay, Changes }
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tool { Pan, Window, Crop, Region, Scratch, Mark }

#[derive(Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct EdgeSettings { pub on: bool, pub gc: f64, pub dc: f64, pub sh: f64, pub nr: f64, pub mm: f64, pub br: f64, pub ds: bool }
impl Default for EdgeSettings { fn default() -> Self { EdgeSettings { on: false, gc: 1.0, dc: 1.0, sh: 1.0, nr: 0.0, mm: 20.0, br: 0.0, ds: false } } }

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct OverlaySettings { pub enabled: bool, pub labels: bool, pub size: u8, pub in_exports: bool, pub layout: Vec<Vec<String>> }
impl Default for OverlaySettings { fn default() -> Self { OverlaySettings { enabled: false, labels: true, size: 1, in_exports: true, layout: Layout::default().corners.to_vec() } } }
impl OverlaySettings { pub fn layout(&self) -> Layout { weldscope_core::overlay::clean_layout(&self.layout) } }

/// Remembered between sessions (per user on this computer).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub show_files: bool, pub show_tools: bool, pub tab: Tab, pub overlay: OverlaySettings,
    pub templates: BTreeMap<String, Vec<(String, Option<String>)>>, pub group_tag: u32, pub last_folder: String,
    /// Folder for new files; empty = an "Edited" folder next to the originals.
    pub output_dir: String,
    /// Values typed before, per field, offered as a pick-list.
    pub history: BTreeMap<String, Vec<String>>,
    /// Sensitivity of the possible-indication marks, 1 (fewest) to 5 (most).
    pub ind_level: u8,
}
impl Default for Prefs {
    fn default() -> Self { Prefs { show_files: true, show_tools: true, tab: Tab::Metadata, overlay: OverlaySettings::default(), templates: BTreeMap::new(), group_tag: 0x0008103E, last_folder: String::new(), output_dir: String::new(), history: BTreeMap::new(), ind_level: 3 } }
}

/// Settings of the tool panels (this session).
pub struct ToolSettings {
    pub smooth: f64, pub sharpen_r: f64, pub sharpen_a: f64, pub badpix: f64, pub scratch_w: i32,
    pub parts: usize, pub stacked: bool, pub overlap: i64, pub sens: f64, pub margin: i64, pub straighten: bool, pub fill: bool, pub label_target: u8,
    pub save_j2k: bool, pub store_window: bool, pub crop_in: [String; 4],
}
impl Default for ToolSettings {
    fn default() -> Self { ToolSettings { smooth: 1.0, sharpen_r: 2.0, sharpen_a: 1.0, badpix: 20.0, scratch_w: 7, parts: 2, stacked: false, overlap: 0, sens: 0.6, margin: 0, straighten: true, fill: false, label_target: 0, save_j2k: true, store_window: false, crop_in: Default::default() } }
}

pub struct View { pub zoom: f32, pub off: egui::Vec2, pub fit_pending: bool, pub canvas: egui::Rect }
impl Default for View { fn default() -> Self { View { zoom: 0.0, off: egui::Vec2::ZERO, fit_pending: true, canvas: egui::Rect::NOTHING } } }

pub struct CompatResult { pub name: String, pub checks: Vec<Check> }
/// One film piece in the preview shown before files are written.
pub struct PiecePreview { pub item: RegionItem, pub include: bool, pub before: egui::TextureHandle, pub after: egui::TextureHandle, pub info: String, pub warn: bool }
pub struct PiecesDialog { pub title: &'static str, pub items: Vec<PiecePreview>, pub split: SplitOptions, pub add_to_list: bool, pub dir: Option<PathBuf> }

/// Reads the location numbers of an image: the coverage text and whether every number read was in step.
pub fn read_cov(file: &DicomFile, img: &Image) -> (String, bool) {
    let px = file.ds.number(0x00181164).or_else(|| file.ds.number(0x00280030)).filter(|v| *v > 0.0).unwrap_or(0.1);
    let belts = weldscope_core::markers::find_belts(&img.frames[0], img.cols, img.rows, img.padding, px);
    (weldscope_core::markers::coverage_text(&belts), !belts.is_empty() && belts.iter().all(|b| b.confidence > 0.95 && b.reads >= 4))
}

/// Coverage read from the film, waiting for the user to confirm or correct it.
pub struct CoverageRow { pub id: u64, pub name: String, pub now: String, pub text: String, pub note: String, pub sure: bool, pub include: bool }
pub struct CoverageDialog { pub rows: Vec<CoverageRow>, pub error: String }

/// Everything one piece needs to be written as its own file.
pub struct PieceJob<'a> { pub file: &'a DicomFile, pub orig: &'a DicomFile, pub img: Option<&'a Image>, pub ops: &'a [String], pub turns: i32, pub orig_els: &'a shots::OrigEls, pub j2k: bool, pub target: u8,
    pub series: &'a str, pub base: &'a str, pub dir: &'a Path, pub originals: &'a BTreeSet<PathBuf>, pub split: SplitOptions }
/// Whole-job run: the confirmation first, then the summary.
pub struct JobRow { pub name: String, pub files: usize, pub note: String, pub bad: bool }
pub struct JobDialog { pub ids: Vec<u64>, pub skipped: usize, pub dir: Option<PathBuf>, pub rows: Vec<JobRow>, pub done: bool }

pub type Apply = Box<dyn FnOnce(&mut App, &egui::Context) + Send>;
pub struct Job { pub label: String, pub rx: Receiver<Apply>, pub started: Instant }

pub enum Dialog { Close }

pub struct MetaUi { pub all: bool, pub filter: String, pub edits: BTreeMap<String, String>, pub errors: BTreeMap<String, String>, pub add_tag: String, pub add_vr: String, pub add_value: String, pub add_error: String, pub tpl_name: String, pub tpl_sel: String }
impl Default for MetaUi { fn default() -> Self { MetaUi { all: false, filter: String::new(), edits: BTreeMap::new(), errors: BTreeMap::new(), add_tag: String::new(), add_vr: "LO".into(), add_value: String::new(), add_error: String::new(), tpl_name: String::new(), tpl_sel: String::new() } } }

pub struct OrgState { pub sel: BTreeSet<u64>, pub pending: BTreeMap<u32, String>, pub removals: BTreeSet<u32>, pub undo: Vec<(Vec<shots::ShotSnap>, String)>, pub redo: Vec<(Vec<shots::ShotSnap>, String)>, pub anchor: Option<u64>, pub errors: Vec<String>, pub result: String, pub renumber_start: usize, pub coverage: Option<String> }
impl Default for OrgState { fn default() -> Self { OrgState { sel: BTreeSet::new(), pending: BTreeMap::new(), removals: BTreeSet::new(), undo: vec![], redo: vec![], anchor: None, errors: vec![], result: String::new(), renumber_start: 1, coverage: None } } }

pub struct App {
    pub entries: Vec<FileEntry>,
    pub folder: String,
    pub cur: Option<u64>,
    next_id: u64,
    pub mode: Mode,
    pub prefs: Prefs,
    pub tool: Tool,
    pub ts: ToolSettings,
    pub view: View,
    pub view_rot: u32,
    pub view_rot_industrex: bool,
    pub invert_view: bool,
    pub edge: EdgeSettings,
    pub edge_cache: Option<(String, Arc<Vec<f32>>)>,
    pub raw_win: Option<Win>,
    pub raw_auto_width: Option<f64>,
    pub scratches: Vec<Scratch>,
    /// Possible indications on the image shown (display only), whether they are drawn, and the one picked in the list.
    pub ind: Option<weldscope_core::indications::Found>,
    pub ind_show: bool,
    pub ind_sel: Option<usize>,
    pub ind_models: Option<Arc<weldscope_core::indications::Models>>,
    /// The interpreter's review of the marks on the image shown; `ind_sel` indexes its marks. Kept in a review
    /// file beside the new files, never in the DICONDE file.
    pub review: Option<Review>,
    pub review_checked: bool,
    pub review_store: Option<(PathBuf, ReviewFile)>,
    pub last_kind: String,
    pub compare: bool,
    pub pieces: Option<PiecesDialog>,
    pub last_saved: Option<PathBuf>,
    pub flash: Option<(Vec<im::Segment>, Instant)>,
    pub show_keys: bool,
    pub coverage: Option<CoverageDialog>,
    pub job_dlg: Option<JobDialog>,
    pub progress: Arc<std::sync::Mutex<String>>,
    pub rename_weld: Option<(String, String)>,
    pub texture: Option<egui::TextureHandle>,
    pub tex_key: String,
    pub logo: Option<egui::TextureHandle>,
    pub toast: Option<(String, bool, Instant)>,
    pub job: Option<Job>,
    pub queue: Vec<(String, Box<dyn FnOnce() -> Apply + Send>)>,
    pub thumb_tx: Sender<(u64, egui::ColorImage, u32)>,
    pub thumb_rx: Receiver<(u64, egui::ColorImage, u32)>,
    pub thumbs_running: usize,
    pub cov_tx: Sender<(u64, String, bool)>,
    pub cov_rx: Receiver<(u64, String, bool)>,
    pub meta: MetaUi,
    pub org: OrgState,
    pub dialog: Option<Dialog>,
    pub allow_close: bool,
    pub drag: Option<viewerDrag>,
    pub probe: String,
    pub edge_pending: bool,
}
#[allow(non_camel_case_types)]
pub type viewerDrag = crate::viewer::Drag;

/// Shortens long text in the middle (file names keep their start and end).
pub fn elide(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max || max < 8 { return s.to_string(); }
    let head = (max - 1) * 2 / 3;
    let tail = max - 1 - head;
    s.chars().take(head).collect::<String>() + "…" + &s.chars().skip(n - tail).collect::<String>()
}
pub fn base_name(name: &str) -> String {
    let l = name.to_lowercase();
    for ext in [".dcm", ".dicom", ".dic"] { if l.ends_with(ext) { return name[..name.len() - ext.len()].to_string(); } }
    name.to_string()
}
fn fmt_mb(n: usize) -> String { format!("{:.1} MB", n as f64 / 1048576.0) }

impl App {
    pub fn new(cc: &eframe::CreationContext, args: Vec<PathBuf>) -> App {
        let prefs: Prefs = cc.storage.and_then(|s| s.get_string("weldscope.prefs")).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        // Always dark (radiographs are read on a dark surround), whatever the Windows theme.
        cc.egui_ctx.set_theme(egui::ThemePreference::Dark);
        let mut style = (*cc.egui_ctx.style()).clone();
        style.visuals = egui::Visuals::dark();
        style.visuals.selection.bg_fill = Color32::from_rgb(0xB8, 0x5E, 0x0A);
        style.visuals.hyperlink_color = ACCENT;
        style.spacing.item_spacing = egui::vec2(6.0, 5.0);
        style.spacing.slider_width = 170.0;
        cc.egui_ctx.set_style_of(egui::Theme::Dark, style);
        // Hack (bundled) has arrows and symbols the proportional font lacks; use it as a fallback.
        let mut fonts = egui::FontDefinitions::default();
        fonts.families.entry(egui::FontFamily::Proportional).or_default().push("Hack".into());
        cc.egui_ctx.set_fonts(fonts);
        let logo = Some(cc.egui_ctx.load_texture("logo", crate::png_image(include_bytes!("../assets/logo.png")), egui::TextureOptions::LINEAR));
        let (thumb_tx, thumb_rx) = channel();
        let (cov_tx, cov_rx) = channel();
        let mut app = App {
            entries: vec![], folder: String::new(), cur: None, next_id: 1, mode: Mode::Edit, prefs, tool: Tool::Pan, ts: ToolSettings::default(), view: View::default(),
            view_rot: 0, view_rot_industrex: false, invert_view: false, edge: EdgeSettings::default(), edge_cache: None, raw_win: None, raw_auto_width: None, scratches: vec![], ind: None, ind_show: true, ind_sel: None, ind_models: None, review: None, review_checked: false, review_store: None, last_kind: "porosity".into(),
            compare: false, pieces: None, last_saved: None, flash: None, show_keys: false, coverage: None, job_dlg: None, progress: Default::default(), rename_weld: None, texture: None, tex_key: String::new(), logo, toast: None, job: None, queue: vec![], thumb_tx, thumb_rx, thumbs_running: 0, cov_tx, cov_rx,
            meta: MetaUi::default(), org: OrgState::default(), dialog: None, allow_close: false, drag: None, probe: String::new(), edge_pending: false,
        };
        if !args.is_empty() {
            let mut files = Vec::new();
            for a in args { if a.is_dir() { files.extend(Self::dicom_files_in(&a)); files.extend(Self::dicom_files_in(&a.join("Edited"))); app.folder = a.to_string_lossy().into(); } else { files.push(a); } }
            app.add_paths(files, true, false);
        }
        app
    }

    /// For every file made from another file in the list: its id → the id of the original it belongs under.
    pub fn parents(&self) -> std::collections::HashMap<u64, u64> {
        use std::collections::HashMap;
        let by_uid: HashMap<&str, u64> = self.entries.iter().filter(|e| !e.link.uid.is_empty()).map(|e| (e.link.uid.as_str(), e.shot.id)).collect();
        // metadata-only copies: same series and identical pixel data; the original is the oldest one outside "Edited"
        let mut same: HashMap<(&str, u64), Vec<&FileEntry>> = HashMap::new();
        for e in &self.entries { if !e.link.series.is_empty() && e.link.sources.is_empty() { same.entry((e.link.series.as_str(), e.link.pix)).or_default().push(e); } }
        let mut direct: HashMap<u64, u64> = HashMap::new();
        for e in &self.entries {
            if let Some(p) = e.link.sources.iter().rev().find_map(|u| by_uid.get(u.as_str()).copied()).filter(|p| *p != e.shot.id) { direct.insert(e.shot.id, p); continue; }
            if let Some(v) = same.get(&(e.link.series.as_str(), e.link.pix)).filter(|v| v.len() > 1 && e.link.sources.is_empty()) {
                let root = v.iter().min_by(|a, b| (a.link.in_edited, &a.link.created, a.shot.id).cmp(&(b.link.in_edited, &b.link.created, b.shot.id))).unwrap();
                if root.shot.id != e.shot.id { direct.insert(e.shot.id, root.shot.id); }
            }
        }
        direct.keys().map(|&c| { let mut r = direct[&c]; for _ in 0..8 { match direct.get(&r) { Some(&n) if n != c => r = n, _ => break } } (c, r) }).collect()
    }

    // ------------------------------------------------------------ small helpers
    pub fn toast(&mut self, msg: impl Into<String>) { self.toast = Some((msg.into(), false, Instant::now())); }
    pub fn error(&mut self, msg: impl Into<String>) { self.toast = Some((msg.into(), true, Instant::now())); }
    pub fn idx(&self, id: u64) -> Option<usize> { self.entries.iter().position(|e| e.shot.id == id) }
    pub fn cur_idx(&self) -> Option<usize> { self.cur.and_then(|id| self.idx(id)) }
    pub fn cur(&self) -> Option<&FileEntry> { self.cur_idx().map(|i| &self.entries[i]) }
    pub fn cur_mut(&mut self) -> Option<&mut FileEntry> { let i = self.cur_idx()?; Some(&mut self.entries[i]) }
    pub fn img(&self) -> Option<ImgRef> { self.cur().and_then(|e| e.work.img.clone()) }
    pub fn busy(&self) -> bool { self.job.is_some() }
    pub fn invalidate(&mut self) { self.tex_key.clear(); }
    pub fn frame_data(&self) -> Option<(ImgRef, usize)> { let e = self.cur()?; let img = e.work.img.clone()?; let f = e.work.frame.min(img.frames.len() - 1); Some((img, f)) }

    /// Runs `work` on a background thread; its result is applied on the UI thread. One job at a time; others queue.
    pub fn run(&mut self, label: impl Into<String>, work: impl FnOnce() -> Apply + Send + 'static) {
        let label = label.into();
        if self.job.is_some() { self.queue.push((label, Box::new(work))); return; }
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
            let apply: Apply = match r { Ok(a) => a, Err(p) => {
                let m = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "unknown error".into());
                Box::new(move |app: &mut App, _: &egui::Context| app.error(format!("Something went wrong: {m}")))
            } };
            let _ = tx.send(apply);
        });
        self.job = Some(Job { label, rx, started: Instant::now() });
    }

    fn poll(&mut self, ctx: &egui::Context) {
        if let Some(job) = &self.job {
            match job.rx.try_recv() {
                Ok(apply) => { self.job = None; apply(self, ctx); }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => { self.job = None; }
                Err(_) => ctx.request_repaint_after(Duration::from_millis(30)),
            }
        }
        if self.job.is_none() && !self.queue.is_empty() { let (l, w) = self.queue.remove(0); self.run(l, w); }
        while let Ok((id, text, sure)) = self.cov_rx.try_recv() { if let Some(i) = self.idx(id) { self.entries[i].auto_cov = Some((text, sure)); } }
        while let Ok((id, img, rot)) = self.thumb_rx.try_recv() {
            self.thumbs_running = self.thumbs_running.saturating_sub(1);
            if let Some(i) = self.idx(id) {
                self.entries[i].thumb = Some(ctx.load_texture(format!("thumb{id}"), img, egui::TextureOptions::LINEAR));
                self.entries[i].view_rot = rot;
            }
        }
        self.pump_thumbs();
    }

    // ------------------------------------------------------------ opening
    pub fn dicom_files_in(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()).filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('.') { return false; }
            match p.extension().map(|e| e.to_string_lossy().to_lowercase()) {
                Some(e) => e == "dcm" || e == "dicom" || e == "dic",
                None => std::fs::File::open(p).ok().and_then(|mut f| { use std::io::Read; let mut b = [0u8; 132]; f.read_exact(&mut b).ok().map(|_| &b[128..132] == b"DICM") }).unwrap_or(false),
            }
        }).collect()).unwrap_or_default();
        v.sort();
        v
    }
    pub fn open_folder_dialog(&mut self) {
        let mut dlg = rfd::FileDialog::new().set_title("Choose the folder to work in");
        if !self.prefs.last_folder.is_empty() { dlg = dlg.set_directory(&self.prefs.last_folder); }
        if let Some(dir) = dlg.pick_folder() {
            if self.entries.iter().any(|e| e.dirty) && !rfd::MessageDialog::new().set_title("WeldScope").set_description("Some files have unsaved changes. Open another folder and discard them?").set_buttons(rfd::MessageButtons::YesNo).show().eq(&rfd::MessageDialogResult::Yes) { return; }
            let mut files = Self::dicom_files_in(&dir);
            files.extend(Self::dicom_files_in(&dir.join("Edited"))); // files made here earlier, shown inside their originals
            if files.is_empty() { self.error(format!("No DICOM files (.dcm) in {}.", dir.display())); return; }
            self.folder = dir.to_string_lossy().into();
            self.prefs.last_folder = self.folder.clone();
            self.add_paths(files, true, true);
        }
    }
    pub fn open_files_dialog(&mut self) {
        let mut dlg = rfd::FileDialog::new().set_title("Add DICONDE files").add_filter("DICOM / DICONDE", &["dcm", "dicom", "dic"]).add_filter("All files", &["*"]);
        if !self.prefs.last_folder.is_empty() { dlg = dlg.set_directory(&self.prefs.last_folder); }
        if let Some(files) = dlg.pick_files() { let single = files.len() == 1; self.add_paths(files, true, false); let _ = single; }
    }
    /// Reads and parses files in the background, then adds them to the list. `replace`: a new working folder.
    pub fn add_paths(&mut self, paths: Vec<PathBuf>, open_first: bool, replace: bool) { self.add_paths_opt(paths, open_first, replace, false) }
    pub fn add_paths_opt(&mut self, paths: Vec<PathBuf>, open_first: bool, replace: bool, quiet: bool) {
        let n = paths.len();
        self.run(format!("Reading {n} file{}…", if n == 1 { "" } else { "s" }), move || {
            let mut ok = Vec::new();
            let mut bad = Vec::new();
            for p in paths {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                match std::fs::read(&p).map_err(|e| e.to_string()).and_then(|b| shots::load(&b, &name, &p.to_string_lossy(), 0).map_err(|e| e.0)) {
                    Ok(s) => ok.push(s),
                    Err(e) => bad.push(format!("{name}: {e}")),
                }
            }
            Box::new(move |app: &mut App, _ctx: &egui::Context| {
                if replace { app.leave_current(); app.entries.clear(); app.cur = None; app.org = OrgState::default(); }
                let mut first = None;
                let mut added = 0;
                for mut s in ok {
                    if app.entries.iter().any(|e| (!s.path.is_empty() && e.shot.path == s.path) || (e.shot.name == s.name && d::get_string(&e.shot.orig.ds, 0x00080018) == d::get_string(&s.orig.ds, 0x00080018))) { continue; }
                    s.id = app.next_id; app.next_id += 1;
                    if first.is_none() { first = Some(s.id); }
                    let link = Link::of(&s);
                    app.entries.push(FileEntry { link, shot: s, work: Work::default(), dirty: false, saved_key: String::new(), compat: None, thumb: None, thumb_queued: false, view_rot: 0, auto_cov: None });
                    added += 1;
                }
                if !bad.is_empty() {
                    let msg = if bad.len() == 1 && added == 0 { format!("Could not open {}", bad[0]) } else { format!("{} file(s) could not be read: {}", bad.len(), bad.iter().take(3).cloned().collect::<Vec<_>>().join("; ")) };
                    app.error(msg);
                } else if added > 1 && !quiet { app.toast(format!("Added {added} files.")); }
                if open_first { if let Some(id) = first { app.open_entry(id); } }
            })
        });
    }

    /// The file being left keeps its unsaved work; its pixels are dropped when it has no image steps.
    pub fn leave_current(&mut self) {
        if let Some(e) = self.cur_mut() {
            if e.work.ops.is_empty() && !e.work.undo.iter().chain(&e.work.redo).any(|s| matches!(s, Step::Image { .. })) { e.work.img = None; e.work.orig_img = None; e.work.loaded = false; }
        }
        self.edge.on = false; self.edge_cache = None; self.raw_win = None; self.raw_auto_width = None; self.scratches.clear(); self.ind = None; self.ind_sel = None; self.review = None; self.review_checked = false; self.compare = false; self.drag = None;
        self.meta.edits.clear(); self.meta.errors.clear();
    }

    pub fn open_entry(&mut self, id: u64) {
        if self.cur == Some(id) && self.cur().map_or(false, |e| e.work.loaded) { self.mode = Mode::Edit; return; }
        self.leave_current();
        self.cur = Some(id);
        self.mode = Mode::Edit;
        let Some(i) = self.idx(id) else { return };
        let e = &self.entries[i];
        let loaded = e.work.loaded;
        // INDUSTREX stores its viewing angle as ANGLE "0,0,a", counter-clockwise; the viewer's rotation is clockwise.
        let angle = d::industrex_xml_entry(&e.shot.orig.ds, "ANGLE");
        let deg = angle.as_ref().and_then(|a| a.last()).and_then(|v| v.trim().parse::<f64>().ok()).map(|v| v.round() as i64).unwrap_or(0);
        let cw = (((360 - deg) % 360) + 360) % 360;
        self.view_rot = if [0, 90, 180, 270].contains(&cw) { cw as u32 } else { 0 };
        self.view_rot_industrex = angle.is_some();
        self.view.fit_pending = true;
        let file = e.shot.file.clone();
        let ts = e.shot.orig.transfer_syntax.clone();
        let name = e.shot.name.clone();
        self.invalidate();
        if loaded { self.after_open(false); return; }
        self.run(if d::get_image(&file).map_err(|x| x.compressed).err() == Some(true) { "Decompressing JPEG 2000…" } else { "Opening…" }, move || {
            let (img, decoded) = match d::get_image(&file) {
                Ok(i) => (Ok(i), false),
                Err(e) if e.compressed && codec::can_decode(&ts) => {
                    let g = d::image_geometry(&file);
                    if g.samples_per_pixel != 1 { (Err("Only greyscale images can be processed. Metadata can still be edited.".to_string()), false) } else {
                        match file.ds.get(d::PIXEL).and_then(|p| p.fragments()).ok_or("no data".to_string()).and_then(|f| codec::decode_frames(f, &g).map_err(|e| e.0)).and_then(|fb| d::image_from_frames(&file, &fb).map_err(|e| e.message)) {
                            Ok(i) => (Ok(i), true),
                            Err(m) => (Err(format!("The JPEG 2000 image could not be decoded ({m}). Metadata can still be edited.")), false),
                        }
                    }
                }
                Err(e) => (Err(e.message), false),
            };
            Box::new(move |app: &mut App, _: &egui::Context| {
                let Some(i) = app.idx(id) else { return };
                let w = &mut app.entries[i].work;
                match img { Ok(im) => { let r = Arc::new(im); w.orig_img = Some(r.clone()); if w.img.is_none() { w.img = Some(r); } w.img_error.clear(); } Err(m) => { w.img_error = m; w.img = None; w.orig_img = None; } }
                w.decoded = decoded; w.loaded = true;
                let fresh = w.ops.is_empty();
                app.after_open(fresh);
                app.toast(format!("Opened {name}"));
            })
        });
    }
    fn after_open(&mut self, reset_window: bool) {
        let Some(i) = self.cur_idx() else { return };
        self.ts.save_j2k = self.entries[i].work.decoded;
        if reset_window || self.entries[i].work.win.w <= 1.0 { self.reset_window("file"); }
        self.view.fit_pending = true;
        self.invalidate();
        self.sync_crop_inputs();
    }

    // ------------------------------------------------------------ window / level
    pub fn reset_window(&mut self, kind: &str) {
        let Some((img, f)) = self.frame_data() else { return };
        let (sl, ic) = (img.slope, img.intercept);
        let win = if kind == "file" && img.window_width.map_or(false, |w| w > 0.0) { Win { c: img.window_center.unwrap_or(0.0), w: img.window_width.unwrap() } }
        else if self.edge.on { let e = self.edge_frame(); let p = self.edge_params().unwrap(); let w = App::edge_window(&e, &img, &p); Win { c: w.center, w: w.width } }
        else if kind == "full" { let st = im::stats(&img.frames[f], img.padding); let (lo, hi) = (st.min * sl + ic, st.max * sl + ic); Win { c: (lo + hi) / 2.0, w: (hi - lo).abs().max(1.0) } }
        else { let w: Window = im::auto_window(&img.frames[f], sl, ic, 0.5, 99.8, img.padding); Win { c: w.center, w: w.width } };
        if let Some(e) = self.cur_mut() { e.work.win = win; }
        self.invalidate();
    }
    /// The window used for display: with the EDGE-style view, Brightness shifts the level.
    pub fn display_win(&self) -> Win {
        let w = self.win();
        if !self.edge.on { return w; }
        let sign = if self.img().map_or(false, |i| i.monochrome1()) { -1.0 } else { 1.0 };
        Win { c: w.c - self.edge.br * w.w * 0.5 * sign, w: w.w }
    }
    pub fn win(&self) -> Win { self.cur().map(|e| e.work.win).unwrap_or(Win { c: 0.0, w: 1.0 }) }
    pub fn set_win(&mut self, w: Win) { if let Some(e) = self.cur_mut() { e.work.win = Win { c: w.c, w: w.w.max(1.0) }; } self.invalidate(); }

    // ------------------------------------------------------------ EDGE-style display enhancement
    pub fn pixel_spacing_mm(&self) -> f64 { self.cur().and_then(|e| e.shot.file.ds.number(0x00181164).or_else(|| e.shot.file.ds.number(0x00280030))).filter(|v| *v > 0.0).unwrap_or(0.1) }
    pub fn edge_params(&mut self) -> Option<im::EdgeParams> {
        let (img, f) = self.frame_data()?;
        if self.raw_auto_width.is_none() { self.raw_auto_width = Some(im::auto_window(&img.frames[f], 1.0, 0.0, 0.5, 99.8, img.padding).width); }
        let raw = self.raw_auto_width.unwrap();
        let e = self.edge;
        // empty area (no film) is left out of the filter, so it cannot change how the film looks
        let lv = im::plate_levels(&img.frames[f], img.cols, img.rows, img.padding, 0.6);
        let background = if lv.has_background { Some((lv.sign, lv.thr)) } else { None };
        // Thresholds scale with the image's useful exposure range (the width of its automatic window).
        Some(im::EdgeParams { global_contrast: e.gc, detail_contrast: e.dc, sharpness: e.sh, noise_reduction: e.nr, kernel_px: e.mm / self.pixel_spacing_mm(), padding: img.padding,
            despeckle: e.ds, white_sign: if img.monochrome1() { -1.0 } else { 1.0 }, despeckle_threshold: if e.ds { 0.3 * raw } else { 0.0 }, detail_limit: 1.1 * raw, kg: None, kd: None, ks: None, background })
    }
    /// Starting window for the enhanced image: the automatic window of the film itself (empty area left out).
    pub fn edge_window(v: &[f32], img: &Image, p: &im::EdgeParams) -> Window {
        match p.background {
            Some((sign, thr)) => { let film: Vec<f32> = v.iter().copied().filter(|x| !x.is_nan() && sign * (*x as f64) >= thr).collect(); im::auto_window(&film, img.slope, img.intercept, 0.5, 99.8, None) }
            None => im::auto_window(v, img.slope, img.intercept, 0.5, 99.8, None),
        }
    }
    /// Fine-detail scale of the EDGE-style filter: 1.5 mm, in pixels.
    pub fn edge_fine_px(&self) -> f64 { 1.5 / self.pixel_spacing_mm() }
    fn edge_key(&self, p: &im::EdgeParams, img: &ImgRef, f: usize) -> String { format!("{:p}:{f}:{p:?}", Arc::as_ptr(img)) }
    /// The enhanced current frame (computed on this thread if not cached; the UI computes it in a job first).
    pub fn edge_frame(&mut self) -> Arc<Vec<f32>> {
        let (img, f) = self.frame_data().unwrap();
        let p = self.edge_params().unwrap();
        let key = self.edge_key(&p, &img, f);
        if let Some((k, v)) = &self.edge_cache { if *k == key { return v.clone(); } }
        let v = Arc::new(im::edge_enhance_v2(&img.frames[f], img.cols, img.rows, &p, self.edge_fine_px()).0);
        self.edge_cache = Some((key, v.clone()));
        v
    }
    /// Recomputes the enhanced frame in the background (about half a second for a full plate).
    pub fn update_edge(&mut self, rewindow: bool) {
        if !self.edge.on { self.invalidate(); return; }
        let Some((img, f)) = self.frame_data() else { return };
        let Some(p) = self.edge_params() else { return };
        let key = self.edge_key(&p, &img, f);
        if self.edge_cache.as_ref().map_or(false, |(k, _)| *k == key) { if rewindow { self.reset_window("auto"); } self.invalidate(); return; }
        if self.busy() { self.edge_pending = true; return; }
        let fine = self.edge_fine_px();
        self.run("Enhancing…", move || {
            let v = Arc::new(im::edge_enhance_v2(&img.frames[f], img.cols, img.rows, &p, fine).0);
            let w = App::edge_window(&v, &img, &p);
            Box::new(move |app: &mut App, _: &egui::Context| {
                app.edge_cache = Some((key, v));
                if rewindow { app.set_win(Win { c: w.center, w: w.width }); }
                app.invalidate();
            })
        });
    }
    pub fn set_edge_on(&mut self, on: bool) {
        if self.img().is_none() || self.edge.on == on { return; }
        if on { self.raw_win = Some(self.win()); } else if let Some(w) = self.raw_win { self.set_win(w); }
        self.edge.on = on;
        if on { self.ts.store_window = false; }
        self.update_edge(on);
    }
    pub fn bake_edge(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        if !self.edge.on { return; }
        let p = self.edge_params().unwrap();
        let cur = self.edge_frame();
        let e = self.edge;
        let win = self.win();
        let fine = self.edge_fine_px();
        self.run("Applying the enhancement…", move || {
            let frames: Vec<Vec<i32>> = img.frames.iter().enumerate().map(|(fi, a)| {
                let fv = if fi == f { cur.clone() } else { Arc::new(im::edge_enhance_v2(a, img.cols, img.rows, &p, fine).0) };
                a.iter().zip(fv.iter()).map(|(&o, &v)| if v.is_nan() { o } else { (im::js_round(v as f64) as i64).clamp(img.min as i64, img.max as i64) as i32 }).collect()
            }).collect();
            let next = img.with_frames(img.rows, img.cols, frames);
            Box::new(move |app: &mut App, _: &egui::Context| {
                let text = format!("EDGE-style enhancement applied (global contrast {}, detail contrast {}, sharpness {}, noise reduction {}, kernel {} mm{})", e.gc, e.dc, e.sh, e.nr, e.mm, if e.ds { ", despeckle" } else { "" });
                let sign = if next.monochrome1() { -1.0 } else { 1.0 };
                app.edge.on = false;
                app.push_image(next, text, 0);
                app.set_win(Win { c: win.c - e.br * win.w * 0.5 * sign, w: win.w });
                app.toast("Enhancement written into the image. Save a copy to keep it; the copy is marked DERIVED.");
            })
        });
    }
    pub fn edge_from_file(&mut self) {
        let Some(d) = self.cur().and_then(|e| d::industrex_display_settings(&e.shot.orig.ds)) else { return };
        let num = |k: &str, def: f64| d.num(k).unwrap_or(def);
        self.edge.gc = num("Global Contrast", 1.0); self.edge.dc = num("Detail Contrast", 1.0); self.edge.sh = num("Sharpness", 1.0);
        self.edge.nr = num("Noise Reduction", 0.0).min(1.0); self.edge.br = num("Brightness", 0.0).clamp(-1.0, 1.0); self.edge.ds = num("Despeckle", 0.0) != 0.0;
        if !self.edge.on { self.set_edge_on(true); } else { self.update_edge(true); }
    }

    // ------------------------------------------------------------ undo / redo (metadata and image steps in one history)
    pub fn image_state(&self) -> ImageState {
        let w = &self.cur().unwrap().work;
        ImageState { img: w.img.clone(), ops: w.ops.clone(), turns: w.turns, crop: w.crop, regions: w.regions.clone() }
    }
    fn trim_undo(&mut self) {
        let Some(e) = self.cur_mut() else { return };
        let mut images = e.work.undo.iter().filter(|s| matches!(s, Step::Image { .. })).count();
        let mut dropped = false;
        while images > MAX_IMAGE_UNDO { if matches!(e.work.undo.remove(0), Step::Image { .. }) { images -= 1; } dropped = true; }
        if dropped { self.toast(format!("Only the last {MAX_IMAGE_UNDO} image steps can be undone.")); }
    }
    pub fn push_image(&mut self, next: Image, text: String, turns: i32) {
        let st = self.image_state();
        let geom = { let cur = self.img(); cur.map_or(true, |c| c.rows != next.rows || c.cols != next.cols) };
        let e = self.cur_mut().unwrap();
        e.work.undo.push(Step::Image { state: st, text: text.clone() });
        e.work.redo.clear();
        e.work.ops.push(text);
        e.work.turns += turns;
        e.work.img = Some(Arc::new(next));
        if e.work.frame >= e.work.img.as_ref().unwrap().frames.len() { e.work.frame = 0; }
        e.refresh_dirty();
        self.scratches.clear(); self.ind = None; self.ind_sel = None; self.review = None; self.review_checked = false; self.raw_auto_width = None; self.edge_cache = None;
        self.trim_undo();
        if geom { self.view.fit_pending = true; }
        self.invalidate();
        self.sync_crop_inputs();
        if self.edge.on { self.update_edge(false); }
    }
    fn restore_image(&mut self, st: ImageState) {
        let geom = { let cur = self.img(); match (&cur, &st.img) { (Some(a), Some(b)) => a.rows != b.rows || a.cols != b.cols, _ => true } };
        let e = self.cur_mut().unwrap();
        e.work.img = st.img; e.work.ops = st.ops; e.work.turns = st.turns; e.work.crop = st.crop; e.work.regions = st.regions;
        self.scratches.clear(); self.ind = None; self.ind_sel = None; self.review = None; self.review_checked = false; self.raw_auto_width = None; self.edge_cache = None;
        if geom { self.view.fit_pending = true; }
        self.invalidate(); self.sync_crop_inputs();
        if self.edge.on { self.update_edge(false); }
    }
    pub fn push_meta(&mut self, snap: MetaSnap, text: String) {
        let e = self.cur_mut().unwrap();
        e.work.undo.push(Step::Meta { snap, text });
        e.work.redo.clear();
        e.refresh_dirty();
        self.after_meta_change();
    }
    pub fn meta_snapshot(&self) -> Option<MetaSnap> { self.cur().map(|e| shots::meta_snapshot(&e.shot.file, &e.shot.orig_els)) }
    /// Display attributes follow metadata edits (window, rescale).
    pub fn after_meta_change(&mut self) {
        let Some(e) = self.cur_mut() else { return };
        if let Some(img) = e.work.img.as_mut() {
            let ds = &e.shot.file.ds;
            let (sl, ic, wc, ww) = (ds.number(0x00281053).unwrap_or(1.0), ds.number(0x00281052).unwrap_or(0.0), ds.number(0x00281050), ds.number(0x00281051));
            if img.slope != sl || img.intercept != ic || img.window_center != wc || img.window_width != ww {
                let m = Arc::make_mut(img); m.slope = sl; m.intercept = ic; m.window_center = wc; m.window_width = ww;
            }
        }
        self.invalidate();
    }
    pub fn undo(&mut self) {
        if self.mode == Mode::Organize { return self.shots_undo(); }
        let Some(i) = self.cur_idx() else { return };
        let Some(step) = self.entries[i].work.undo.pop() else { return };
        let text = step.text().to_string();
        match step {
            Step::Meta { snap, text } => {
                let e = &mut self.entries[i];
                let now = shots::meta_snapshot(&e.shot.file, &e.shot.orig_els);
                e.work.redo.push(Step::Meta { snap: now, text });
                shots::meta_restore(&mut e.shot.file, &mut e.shot.orig_els, snap);
                self.after_meta_change(); self.meta.edits.clear();
            }
            Step::Image { state, text } => { let now = self.image_state(); self.entries[i].work.redo.push(Step::Image { state: now, text }); self.restore_image(state); }
        }
        self.entries[i].refresh_dirty();
        self.toast(format!("Undone: {text}"));
    }
    pub fn redo(&mut self) {
        if self.mode == Mode::Organize { return self.shots_redo(); }
        let Some(i) = self.cur_idx() else { return };
        let Some(step) = self.entries[i].work.redo.pop() else { return };
        let text = step.text().to_string();
        match step {
            Step::Meta { snap, text } => {
                let e = &mut self.entries[i];
                let now = shots::meta_snapshot(&e.shot.file, &e.shot.orig_els);
                e.work.undo.push(Step::Meta { snap: now, text });
                shots::meta_restore(&mut e.shot.file, &mut e.shot.orig_els, snap);
                self.after_meta_change(); self.meta.edits.clear();
            }
            Step::Image { state, text } => { let now = self.image_state(); self.entries[i].work.undo.push(Step::Image { state: now, text }); self.restore_image(state); }
        }
        self.entries[i].refresh_dirty();
        self.toast(format!("Redone: {text}"));
    }
    pub fn undo_text(&self) -> Option<String> {
        if self.mode == Mode::Organize { return self.org.undo.last().map(|u| u.1.clone()); }
        self.cur().and_then(|e| e.work.undo.last()).map(|s| s.text().to_string())
    }
    pub fn redo_text(&self) -> Option<String> {
        if self.mode == Mode::Organize { return self.org.redo.last().map(|u| u.1.clone()); }
        self.cur().and_then(|e| e.work.redo.last()).map(|s| s.text().to_string())
    }
    /// Back to the image as opened; metadata edits are kept, and this can itself be undone.
    pub fn revert_image(&mut self) {
        let Some(i) = self.cur_idx() else { return };
        if self.entries[i].work.ops.is_empty() { return; }
        let st = self.image_state();
        let orig = self.entries[i].work.orig_img.clone();
        self.entries[i].work.undo.push(Step::Image { state: st, text: "Reverted all image changes".into() });
        self.entries[i].work.redo.clear();
        self.restore_image(ImageState { img: orig, ops: vec![], turns: 0, crop: None, regions: vec![] });
        self.entries[i].refresh_dirty();
        self.toast("All image changes reverted. Undo brings them back.");
    }

    // ------------------------------------------------------------ metadata editing (one undo step each)
    pub fn set_field(&mut self, path: &[(u32, usize)], tag: u32, text: &str, vr: Option<&str>) -> Result<(), String> {
        let snap = self.meta_snapshot().ok_or("No file is open.")?;
        let e = self.cur_mut().unwrap();
        let r = shots::set_field(&mut e.shot.file, &mut e.shot.orig_els, path, tag, text, vr)?;
        e.refresh_dirty();
        if path.is_empty() { self.remember_value(tag, text); }
        if let Some(t) = r { self.push_meta(snap, t); }
        Ok(())
    }
    /// Keeps values typed before (newest first, 12 per field) for the pick-lists.
    pub fn remember_value(&mut self, tag: u32, text: &str) {
        let t = text.trim();
        if t.is_empty() || t.len() > 64 || t.contains('\n') || READ_ONLY.contains(&tag) { return; }
        let v = self.prefs.history.entry(d::hex8(tag)).or_default();
        v.retain(|x| x != t); v.insert(0, t.to_string()); v.truncate(12);
    }
    /// Pick-list for a field: values typed before, then values other files in the folder already have.
    pub fn suggestions(&self, tag: u32, current: &str) -> Vec<String> {
        let mut out: Vec<String> = self.prefs.history.get(&d::hex8(tag)).cloned().unwrap_or_default();
        for e in &self.entries { let v = e.shot.text(tag); if !v.trim().is_empty() && v.len() <= 64 && !out.contains(&v) { out.push(v); } if out.len() >= 16 { break; } }
        out.retain(|v| v != current);
        out
    }
    pub fn delete_field(&mut self, path: &[(u32, usize)], tag: u32) {
        let Some(snap) = self.meta_snapshot() else { return };
        let e = self.cur_mut().unwrap();
        let t = shots::delete_field(&mut e.shot.file, &mut e.shot.orig_els, path, tag);
        self.push_meta(snap, t);
    }
    pub fn revert_field(&mut self, path: &[(u32, usize)], tag: u32) {
        let Some(snap) = self.meta_snapshot() else { return };
        let e = self.cur_mut().unwrap();
        let t = shots::revert_field(&mut e.shot.file, &mut e.shot.orig_els, path, tag);
        self.push_meta(snap, t);
    }

    // ------------------------------------------------------------ pixel operations
    pub fn run_op(&mut self, op: &'static str) {
        let Some((img, f)) = self.frame_data() else { return };
        let (sm, sr, sa, bp) = (self.ts.smooth, self.ts.sharpen_r, self.ts.sharpen_a, self.ts.badpix);
        self.run("Working…", move || {
            let r: Result<(Image, String, i32, bool), String> = (|| Ok(match op {
                "rot-cw" => (im::rotate(&img, 1), "Rotated 90° clockwise".into(), 1, true),
                "rot-ccw" => (im::rotate(&img, -1), "Rotated 90° anticlockwise".into(), 1, true),
                "rot-180" => (im::rotate(&img, 2), "Rotated 180°".into(), 0, true),
                "flip-h" => (im::flip(&img, true), "Flipped left–right".into(), 0, true),
                "flip-v" => (im::flip(&img, false), "Flipped top–bottom".into(), 0, true),
                "invert" => (im::invert(&img), "Inverted pixel values".into(), 0, false),
                "median" => (im::median(&img), "Noise reduced (3×3 median)".into(), 0, false),
                "smooth" => (im::smooth(&img, sm)?, format!("Smoothed (Gaussian radius {sm})"), 0, false),
                "sharpen" => (im::sharpen(&img, sr, sa)?, format!("Sharpened (unsharp mask radius {sr}, amount {sa})"), 0, false),
                "badpix" => {
                    let st = im::stats(&img.frames[f], img.padding);
                    let thr = ((st.max - st.min) * bp / 100.0).max(1.0);
                    let (out, n) = im::fix_bad_pixels(&img, thr);
                    if n == 0 { return Err("No bad pixels found at this limit.".into()); }
                    (out, format!("Fixed {n} bad pixel{} (limit {bp}% of range)", if n == 1 { "" } else { "s" }), 0, false)
                }
                _ => return Err("Unknown operation".into()),
            }))();
            Box::new(move |app: &mut App, _: &egui::Context| match r {
                Ok((next, text, turns, geom)) => { if geom { if let Some(e) = app.cur_mut() { e.work.crop = None; e.work.regions.clear(); } } app.push_image(next, text.clone(), turns); app.toast(text); }
                Err(m) => app.toast(m),
            })
        });
    }
    pub fn apply_crop(&mut self) {
        let Some(c) = self.cur().and_then(|e| e.work.crop) else { return };
        let Some(img) = self.img() else { return };
        match im::crop(&img, c) {
            Ok(next) => { if let Some(e) = self.cur_mut() { e.work.regions.clear(); e.work.crop = None; } self.push_image(next, format!("Cropped to {}×{} at ({}, {})", c.w, c.h, c.x, c.y), 0); }
            Err(m) => self.error(m),
        }
    }
    pub fn sync_crop_inputs(&mut self) {
        let c = self.cur().and_then(|e| e.work.crop);
        self.ts.crop_in = match c { Some(c) => [c.x.to_string(), c.y.to_string(), c.w.to_string(), c.h.to_string()], None => Default::default() };
    }

    pub fn scratch_opts(&self) -> Option<im::ScratchOptions> {
        let (img, f) = self.frame_data()?;
        let a = &img.frames[f];
        let noise = im::noise_level(a, img.cols, img.rows, img.padding);
        let max_w = self.ts.scratch_w.clamp(1, 15) as f64;
        let st = im::stats(a, img.padding);
        let sign = im::less_radiation_sign(a, img.cols, img.rows, img.padding);
        let range = (st.pct(50.0) - if sign > 0.0 { st.pct(0.1) } else { st.pct(99.9) }).abs();
        // a repaired line must dip by at least 1% of the plate-to-background range, so plate texture is never smoothed
        Some(im::ScratchOptions { sign, noise, min_contrast: 0.01 * range, max_width: max_w, band: (max_w + 6.0).max(8.0), min: img.min, max: img.max, padding: img.padding })
    }
    /// Repairs each segment on every frame as one undoable step (only after the user drew or confirmed them).
    pub fn repair_scratches(&mut self, segs: Vec<im::Segment>, drawn: bool) {
        let Some((img, f)) = self.frame_data() else { return };
        let Some(opts) = self.scratch_opts() else { return };
        if segs.is_empty() { return; }
        self.run("Repairing…", move || {
            let mut count = 0;
            let frames: Vec<Vec<i32>> = img.frames.iter().enumerate().map(|(fi, fr)| {
                let mut cur = fr.clone();
                for s in &segs { let (o, n) = im::repair_scratch(&cur, img.cols, img.rows, *s, &opts); cur = o; if fi == f { count += n; } }
                cur
            }).collect();
            Box::new(move |app: &mut App, _: &egui::Context| {
                if count == 0 {
                    app.toast(if drawn { "No scratch found along that line. Only thin lines reading as less radiation than the plate on both sides are repaired; anything near a crack or void is left alone." } else { "Nothing was repaired." });
                    return;
                }
                let r = |v: f64| v.round() as i64;
                let text = if drawn { format!("Scratch repaired along ({}, {})–({}, {}): {count} pixels", r(segs[0].x0), r(segs[0].y0), r(segs[0].x1), r(segs[0].y1)) }
                    else { format!("Repaired {} long scratch{}: {count} pixels", segs.len(), if segs.len() == 1 { "" } else { "es" }) };
                app.scratches.clear();
                app.push_image(img.with_frames(img.rows, img.cols, frames), text.clone(), 0);
                app.flash = Some((segs.clone(), Instant::now()));
                app.toast(format!("{text}. Hold to compare shows the difference; Undo is available."));
            })
        });
    }
    /// Where the indication model file is looked for: beside the program (or WELDSCOPE_INDICATION_MODELS).
    pub fn indication_model_path() -> PathBuf {
        if let Ok(p) = std::env::var("WELDSCOPE_INDICATION_MODELS") { return PathBuf::from(p); }
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("indication-models.bin"))).unwrap_or_else(|| PathBuf::from("indication-models.bin"))
    }
    /// Lists possible indications in the weld band of the image shown. Display only: nothing is written to the image.
    pub fn find_indications(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let models = match &self.ind_models {
            Some(m) => m.clone(),
            None => {
                let path = Self::indication_model_path();
                let loaded = std::fs::read(&path).map_err(|_| format!("The indication model file was not found. It should be here: {}", path.display())).and_then(|b| weldscope_core::indications::load_models(&b));
                match loaded { Ok(m) => { let m = Arc::new(m); self.ind_models = Some(m.clone()); m } Err(e) => { self.error(e); return; } }
            }
        };
        let px = self.cur().and_then(|e| e.shot.file.ds.number(0x00181164).or_else(|| e.shot.file.ds.number(0x00280030))).filter(|v| *v > 0.0).unwrap_or(0.1);
        let progress = self.progress.clone();
        self.run("Looking for possible indications…", move || {
            let found = weldscope_core::indications::find(&models, &img.frames[f], img.cols, img.rows, img.padding, px, &|p| { *progress.lock().unwrap() = format!("{:.0}%", p * 100.0); });
            progress.lock().unwrap().clear();
            Box::new(move |app: &mut App, _: &egui::Context| {
                if !app.img().map_or(false, |cur| Arc::ptr_eq(&cur, &img)) { return; } // the image changed meanwhile
                app.ensure_review();
                if app.review.is_none() { app.review = Some(app.new_review()); }
                let cut = app.cut();
                let r = app.review.as_mut().unwrap();
                r.merge_found(&found.items);
                let (n, all) = (r.shown(cut).len(), found.items.len());
                let sure = found.bands.films.iter().filter(|b| b.sure).count();
                let band = if found.bands.films.is_empty() || sure == found.bands.films.len() { "" } else { " The weld band was not clear on every film, so the whole film was searched there." };
                app.ind = Some(found); app.ind_sel = None; app.ind_show = true;
                app.toast(if all == 0 { "No possible indications listed. That is not a finding: read the weld as usual.".to_string() } else { format!("{n} mark{} for you to check.{band}", if n == 1 { "" } else { "s" }) });
            })
        });
    }
    pub fn cut(&self) -> f32 { weldscope_core::indications::CUTS[(self.prefs.ind_level.clamp(1, 5) - 1) as usize] }
    /// Marks belong to the pixels of a saved file, so they can be judged only while the image has no unsaved changes.
    pub fn can_mark(&self) -> bool { self.cur().map_or(false, |e| e.work.ops.is_empty() && e.work.img.is_some() && !e.shot.path.is_empty() && !e.shot.text(0x00080018).is_empty()) }
    fn new_review(&self) -> Review {
        let (mut r, px) = (Review::default(), self.cur().and_then(|e| e.shot.file.ds.number(0x00181164).or_else(|| e.shot.file.ds.number(0x00280030))).filter(|v| *v > 0.0).unwrap_or(0.1));
        if let Some(e) = self.cur() { r.file = e.shot.name.clone(); r.sop = e.shot.text(0x00080018); r.weld = e.shot.text(self.prefs.group_tag); r.px_mm = px; if let Some(i) = &e.work.img { r.cols = i.cols; r.rows = i.rows; } }
        r
    }
    pub fn review_path(&self) -> Option<PathBuf> { let near = self.cur().map(|e| e.shot.path.clone()).filter(|p| !p.is_empty())?; self.output_dir(&near).map(|d| d.join(rv::FILE_NAME)) }
    fn review_file(&mut self) -> Result<&mut ReviewFile, String> {
        let path = self.review_path().ok_or("Marks can be kept only for a file opened from a folder.")?;
        if self.review_store.as_ref().map_or(true, |(p, _)| *p != path) { let f = rv::load(&path)?; self.review_store = Some((path, f)); }
        Ok(&mut self.review_store.as_mut().unwrap().1)
    }
    /// Brings back the saved review of the file shown, once per file.
    pub fn ensure_review(&mut self) {
        if self.review_checked || self.cur().map_or(true, |e| !e.work.loaded) { return; }
        self.review_checked = true; self.review = None;
        if !self.can_mark() { return; }
        let sop = self.cur().map(|e| e.shot.text(0x00080018)).unwrap_or_default();
        if let Ok(f) = self.review_file() { if let Some(r) = f.reviews.get(&sop) { self.review = Some(r.clone()); } }
    }
    pub fn marks_shown(&self) -> Vec<usize> { self.review.as_ref().map(|r| r.shown(self.cut())).unwrap_or_default() }
    /// Writes the review of the file shown into the review file (or takes it out again when nothing is judged).
    fn save_review(&mut self) {
        let Some(r) = self.review.clone() else { return };
        let (cut, level, stamp) = (self.cut(), self.prefs.ind_level, chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
        let first = self.review_path().map_or(false, |p| !p.exists());
        match self.review_file() {
            Err(e) => { self.error(e); return; }
            Ok(f) => {
                if r.worth_saving() { let mut out = r.for_file(cut); out.sensitivity = level; out.updated = stamp; f.reviews.insert(r.sop.clone(), out); }
                else if f.reviews.remove(&r.sop).is_none() { return; }
            }
        }
        let (path, file) = self.review_store.clone().unwrap();
        match rv::save(&path, &file) { Err(e) => self.error(e), Ok(()) => if first { self.toast(format!("Your calls are kept in {} (never in the DICONDE file).", path.display())); } }
    }
    fn mark_guard(&mut self) -> bool {
        if self.can_mark() { return true; }
        self.error("Marks are kept for saved files only. Save the image changes first, then open the new file and mark it.");
        false
    }
    /// The interpreter's call on one mark; then moves on to the next mark not yet looked at.
    pub fn judge(&mut self, n: usize, v: Verdict) {
        if !self.mark_guard() { return; }
        let last = self.last_kind.clone();
        let Some(m) = self.review.as_mut().and_then(|r| r.marks.get_mut(n)) else { return };
        if m.manual && v != Verdict::Indication { return; }
        m.verdict = v;
        if v == Verdict::Indication { if m.kind.is_empty() { m.kind = if rv::TYPES.contains(&m.guess.as_str()) { m.guess.clone() } else { last }; } } else { m.kind.clear(); }
        self.save_review();
        if v == Verdict::Unreviewed { return; }
        let shown = self.marks_shown();
        let at = shown.iter().position(|&i| i == n).unwrap_or(0);
        let next = shown.iter().cycle().skip(at + 1).take(shown.len()).find(|&&i| self.review.as_ref().map_or(false, |r| r.marks[i].verdict == Verdict::Unreviewed)).copied();
        if let Some(i) = next { self.show_indication(i); }
    }
    pub fn set_kind(&mut self, n: usize, kind: &str) {
        if !self.mark_guard() { return; }
        if let Some(m) = self.review.as_mut().and_then(|r| r.marks.get_mut(n)) { m.kind = kind.to_string(); m.verdict = Verdict::Indication; self.last_kind = kind.to_string(); self.save_review(); }
    }
    /// An indication the finder missed, drawn by the interpreter.
    pub fn add_manual(&mut self, r: im::Rect) {
        if !self.mark_guard() { return; }
        self.ensure_review();
        if self.review.is_none() { self.review = Some(self.new_review()); }
        let kind = self.last_kind.clone();
        let rev = self.review.as_mut().unwrap();
        rev.marks.push(rv::Mark { x0: r.x as f64, y0: r.y as f64, x1: (r.x + r.w) as f64, y1: (r.y + r.h) as f64, manual: true, verdict: Verdict::Indication, kind, ..Default::default() });
        self.ind_sel = Some(rev.marks.len() - 1); self.ind_show = true;
        self.save_review();
    }
    pub fn remove_manual(&mut self, n: usize) {
        if !self.mark_guard() { return; }
        if let Some(r) = self.review.as_mut() { if r.marks.get(n).map_or(false, |m| m.manual) { r.marks.remove(n); self.ind_sel = None; self.save_review(); } }
    }
    /// Every mark shown and not yet judged becomes "not an indication".
    pub fn rest_not(&mut self) {
        if !self.mark_guard() { return; }
        let shown = self.marks_shown();
        if let Some(r) = self.review.as_mut() { for i in shown { if r.marks[i].verdict == Verdict::Unreviewed { r.marks[i].verdict = Verdict::NotIndication; } } }
        self.save_review();
    }
    /// Takes the unjudged marks off the screen; calls already made stay.
    pub fn clear_marks(&mut self) {
        self.ind = None; self.ind_sel = None;
        if let Some(r) = self.review.as_mut() { r.marks.retain(|m| m.judged()); if r.marks.is_empty() { self.review = None; } }
    }
    /// Brings one mark to the middle of the viewer.
    pub fn show_indication(&mut self, n: usize) {
        let Some(it) = self.review.as_ref().and_then(|r| r.marks.get(n)).cloned() else { return };
        let Some(img) = self.img() else { return };
        self.ind_sel = Some(n); self.ind_show = true;
        if self.view.zoom < 0.75 { self.view.zoom = 1.0; }
        let (vx, vy) = im::to_view((it.x0 + it.x1) / 2.0, (it.y0 + it.y1) / 2.0, img.cols as f64, img.rows as f64, self.view_rot);
        let c = self.view.canvas.size();
        self.view.off = egui::Vec2::new(c.x / 2.0 - vx as f32 * self.view.zoom, c.y / 2.0 - vy as f32 * self.view.zoom);
        self.invalidate();
    }
    pub fn find_scratches(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let sign = self.scratch_opts().map(|o| o.sign);
        self.run("Looking for scratches…", move || {
            let found = im::find_scratches(&img.frames[f], img.cols, img.rows, img.padding, sign, None, 0.6, 2.0);
            Box::new(move |app: &mut App, _: &egui::Context| {
                let n = found.len();
                app.scratches = found;
                app.toast(if n > 0 { format!("Found {n} long scratch{} (shown in cyan). Check them, then Repair found scratches.", if n == 1 { "" } else { "es" }) } else { "No long scratches found. Draw over short ones with the Scratch tool.".into() });
            })
        });
    }

    pub fn make_equal_parts(&mut self) {
        let Some(img) = self.img() else { return };
        let n = self.ts.parts;
        if !(2..=50).contains(&n) { self.error("Choose 2 to 50 parts."); return; }
        // "Side by side" and "Stacked" follow the screen, so swap when the view is turned 90°.
        let mut stacked = self.ts.stacked;
        if self.view_rot % 180 != 0 { stacked = !stacked; }
        let (rot, cols, rows) = (self.view_rot, img.cols as f64, img.rows as f64);
        let mut rs = im::split_regions(img.rows, img.cols, n, stacked, self.ts.overlap.max(0));
        let screen_stacked = self.ts.stacked;
        rs.sort_by(|a, b| { let qa = im::rect_to_view(*a, cols, rows, rot); let qb = im::rect_to_view(*b, cols, rows, rot); let (ka, kb) = if screen_stacked { (qa.1, qb.1) } else { (qa.0, qb.0) }; ka.partial_cmp(&kb).unwrap() });
        if let Some(e) = self.cur_mut() { e.work.regions = rs.into_iter().enumerate().map(|(i, r)| RegionItem { region: Region { rect: r, cuts: vec![] }, label: (i + 1).to_string(), tilt: None }).collect(); }
    }
    /// Film pieces numbered as they appear on screen (left to right, then top to bottom), each with its measured tilt.
    pub fn pieces_in_screen_order(img: &Image, f: usize, sens: f64, margin: i64, rot: u32) -> Vec<RegionItem> {
        let mut found = im::find_pieces(&img.frames[f], img.cols, img.rows, &im::PieceOptions { sensitivity: sens, margin, padding: img.padding, ..Default::default() });
        let key = |r: &Region| { let q = im::rect_to_view(r.rect, img.cols as f64, img.rows as f64, rot); ((q.1 / 50.0).round() as i64, q.0) };
        found.sort_by(|a, b| { let (ka, kb) = (key(a), key(b)); ka.0.cmp(&kb.0).then(ka.1.partial_cmp(&kb.1).unwrap()) });
        let lv = im::plate_levels(&img.frames[f], img.cols, img.rows, img.padding, 0.6);
        let fill = img.padding.unwrap_or(im::js_round(lv.sign * lv.bg) as i32);
        found.iter().enumerate().map(|(i, r)| {
            let mut fr = im::crop_frame(&img.frames[f], img.cols, r.rect);
            im::fill_outside_cuts(&mut fr, r, fill);
            RegionItem { region: r.clone(), label: (i + 1).to_string(), tilt: Some(im::piece_tilt(&fr, r.rect.w as usize, r.rect.h as usize, &lv).angle) }
        }).collect()
    }
    pub fn auto_split(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let (sens, margin, rot) = (self.ts.sens, self.ts.margin, self.view_rot);
        self.run("Finding film pieces…", move || {
            let items = App::pieces_in_screen_order(&img, f, sens, margin, rot);
            Box::new(move |app: &mut App, _: &egui::Context| {
                if items.is_empty() { app.error("No film pieces found. Try High sensitivity, or draw regions by hand."); return; }
                let tilted = items.iter().filter(|r| !r.region.cuts.is_empty()).count();
                let n = items.len();
                if let Some(e) = app.cur_mut() { if n == 1 { e.work.crop = Some(items[0].region.rect); } e.work.regions = items; }
                app.sync_crop_inputs();
                app.toast(if n == 1 { "Found one piece. It is also set as the crop box: use Apply crop, or save it as a split file.".into() }
                    else { format!("Found {n} pieces{}. Check them, then Save split files.", if tilted > 0 { ", separated by a tilted line" } else { "" }) });
            })
        });
    }
    /// Straighten & crop to film. One piece: straightened and cropped in place, as one undoable step. Several
    /// pieces: each is straightened, cropped to its film and saved as its own file (a new series, numbered in
    /// screen order), exactly as Save split files does with "Straighten each piece" on. The open file is unchanged.
    pub fn auto_straighten(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let rot = self.view_rot;
        self.run("Straightening…", move || {
            let items = App::pieces_in_screen_order(&img, f, 0.6, 0, rot);
            let one = if items.len() == 1 { Some(im::straighten_piece(&img, &items[0].region, None, 5.0, 0.02, 0)) } else { None };
            let unchanged = one.as_ref().and_then(|r| r.as_ref().ok()).map_or(false, |s| s.img.cols == img.cols && s.img.rows == img.rows && !s.rotated);
            Box::new(move |app: &mut App, _: &egui::Context| {
                if items.is_empty() { app.error("No film found to straighten."); return; }
                if items.len() > 1 {
                    let n = items.len();
                    if let Some(e) = app.cur_mut() { e.work.crop = None; e.work.regions = items; }
                    app.sync_crop_inputs();
                    let _ = n;
                    app.prepare_parts(SplitOptions { straighten: true, fill_slivers: false, turns: 0 }, "Straighten & crop to film");
                    return;
                }
                match one.unwrap() {
                    Err(m) => app.error(m),
                    Ok(_) if unchanged => app.toast("The film is already straight and fills the image."),
                    Ok(s) => {
                        let text = format!("{} to the film: {}×{}", if s.rotated { format!("Straightened {:.2}° (bicubic resampling) and cropped", s.angle) } else { "Cropped".into() }, s.img.cols, s.img.rows);
                        if let Some(e) = app.cur_mut() { e.work.crop = None; e.work.regions.clear(); }
                        let (steep, measured) = (s.too_steep, s.measured);
                        app.push_image(s.img, text.clone(), 0);
                        app.toast(format!("{text}{}.", if steep { format!(" (tilt {measured:.1}° is over 5°, so it was not rotated)") } else { String::new() }));
                    }
                }
            })
        });
    }

    // ------------------------------------------------------------ saving
    fn originals(&self) -> BTreeSet<PathBuf> { self.entries.iter().filter(|e| !e.shot.path.is_empty()).filter_map(|e| std::fs::canonicalize(&e.shot.path).ok().or(Some(PathBuf::from(&e.shot.path)))).collect() }
    fn is_original(&self, p: &Path) -> bool { let c = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()); self.originals().contains(&c) }
    fn dir_of(&self, path: &str) -> Option<PathBuf> { Path::new(path).parent().map(|p| p.to_path_buf()).filter(|p| p.is_dir()).or_else(|| if self.folder.is_empty() { None } else { Some(PathBuf::from(&self.folder)) }) }
    /// A name in `dir` that does not exist yet: name, name_2, name_3 …
    pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        if !p.exists() { return p; }
        let (stem, ext) = match name.rfind('.') { Some(i) => (&name[..i], &name[i..]), None => (name, "") };
        (2..).map(|i| dir.join(format!("{stem}_{i}{ext}"))).find(|p| !p.exists()).unwrap()
    }
    /// Automated UI checks only: WELDSCOPE_TEST_DIR answers save/folder dialogs with that folder.
    pub fn test_dir() -> Option<PathBuf> { std::env::var_os("WELDSCOPE_TEST_DIR").map(PathBuf::from) }
    pub fn pick_folder(&self, title: &str, near: &str) -> Option<PathBuf> {
        if let Some(d) = Self::test_dir() { return Some(d); }
        let mut dlg = rfd::FileDialog::new().set_title(title);
        if let Some(dir) = self.dir_of(near) { dlg = dlg.set_directory(dir); }
        dlg.pick_folder()
    }
    fn save_dialog(&self, name: &str, filter: (&str, &[&str]), near: &str) -> Option<PathBuf> {
        if let Some(d) = Self::test_dir() { return Some(Self::unique_path(&d, name)); }
        let mut dlg = rfd::FileDialog::new().set_file_name(name).add_filter(filter.0, filter.1);
        if let Some(dir) = self.output_dir(near).filter(|d| d.is_dir()).or_else(|| self.dir_of(near)) { dlg = dlg.set_directory(dir); }
        dlg.save_file()
    }
    /// Where new files go without asking: the folder the user chose, or an "Edited" folder next to the originals.
    pub fn output_dir(&self, near: &str) -> Option<PathBuf> {
        if let Some(d) = Self::test_dir() { return Some(d); }
        if !self.prefs.output_dir.is_empty() { return Some(PathBuf::from(&self.prefs.output_dir)); }
        self.dir_of(near).map(|d| d.join("Edited"))
    }
    pub fn near(&self) -> String { self.cur().map(|e| e.shot.path.clone()).filter(|p| !p.is_empty()).or_else(|| self.entries.first().map(|e| e.shot.path.clone())).unwrap_or_default() }
    pub fn change_output_dir(&mut self) {
        let near = self.near();
        if let Some(d) = self.pick_folder("Choose the folder for new files", &near) {
            if self.entries.iter().any(|e| Path::new(&e.shot.path).parent() == Some(d.as_path())) { self.toast("New files will go into the same folder as the originals. Originals are still never overwritten."); }
            self.prefs.output_dir = d.to_string_lossy().into();
        }
    }
    /// Opens the folder in Explorer (with the file selected when it is a file).
    pub fn show_in_folder(path: &Path) {
        #[cfg(target_os = "windows")]
        { let mut c = std::process::Command::new("explorer"); if path.is_file() { c.arg(format!("/select,{}", path.display())); } else { c.arg(path); } let _ = c.spawn(); }
        #[cfg(not(target_os = "windows"))]
        { let dir = if path.is_file() { path.parent().unwrap_or(path) } else { path }; let _ = std::process::Command::new("xdg-open").arg(dir).spawn(); }
    }

    pub fn copy_state<'a>(&'a self, e: &'a FileEntry, store_window: bool, j2k: bool) -> CopyState<'a> {
        let w = &e.work;
        CopyState { file: &e.shot.file, orig: &e.shot.orig, img: w.img.as_deref(), ops: &w.ops, turns: w.turns, orig_els: &e.shot.orig_els,
            store_window: if store_window && w.img.is_some() { Some((w.win.c, w.win.w)) } else { None }, j2k }
    }
    pub fn want_j2k(&self) -> bool { self.ts.save_j2k && self.img().map_or(false, |i| i.bits_allocated <= 16) }

    /// Save as new file. Without `ask` it goes straight into the output folder under a name that is not taken.
    pub fn save_copy(&mut self, ask: bool) {
        let Some(i) = self.cur_idx() else { return };
        self.store_auto_coverage(i);
        let e = &self.entries[i];
        let name = format!("{}_edited.dcm", base_name(&e.shot.name));
        let near = e.shot.path.clone();
        let path = match self.output_dir(&near) {
            Some(dir) if !ask => Self::unique_path(&dir, &name),
            _ => match self.save_dialog(&name, ("DICONDE", &["dcm"]), &near) { Some(p) => p, None => { self.toast("Not saved."); return } },
        };
        if self.is_original(&path) { self.error("That is an original file. WeldScope never overwrites originals; choose another name."); return; }
        let store = self.ts.store_window && !self.edge.on;
        let j2k = self.want_j2k();
        let built = { let e = &self.entries[i]; copy::build_copy(&self.copy_state(e, store, j2k), None, None, SplitOptions::default()) };
        let id = e.shot.id;
        let orig = e.shot.orig.clone();
        let key = self.entries[i].state_key();
        let pixels = !self.entries[i].work.ops.is_empty();
        match built {
            Err(m) => self.error(format!("Not saved: {m}")),
            Ok(b) => self.run(if pixels && j2k { "Compressing JPEG 2000 and saving…" } else { "Saving…" }, move || {
                let res = d::write(&b.file).map_err(|e| e.0).and_then(|bytes| {
                    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| format!("{}: {e}", p.display()))?; }
                    std::fs::write(&path, &bytes).map(|_| bytes).map_err(|e| e.to_string())
                });
                let checks = res.as_ref().ok().map(|bytes| compat::check(bytes, Some(&orig), &CheckOptions { removed: b.removed.clone(), edited: b.edited.clone(), pixels_changed: b.pixels_changed, xml_tag: d::industrex_info(&orig.ds).and_then(|x| x.xml_tag) }));
                Box::new(move |app: &mut App, _: &egui::Context| match res {
                    Err(m) => app.error(format!("Not saved: {m}")),
                    Ok(bytes) => {
                        let mut extra = String::new();
                        if !b.removed.is_empty() { extra += &format!(" Left out {} element(s) that described the original pixels.", b.removed.len()); }
                        if !b.synced.is_empty() { extra += &format!(" Updated {} field(s) in INDUSTREX's XML copy.", b.synced.len()); }
                        if let Some(i) = app.idx(id) { let e = &mut app.entries[i]; e.saved_key = key; e.shot.saved_as = path.to_string_lossy().into(); e.refresh_dirty(); }
                        app.toast(format!("Saved as a new file: {} ({}). The original file is unchanged.{extra}", path.display(), fmt_mb(bytes.len())));
                        app.last_saved = Some(path.clone());
                        app.show_compat(id, path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), checks.unwrap_or_default());
                    }
                })
            }),
        }
    }
    pub fn show_compat(&mut self, id: u64, name: String, checks: Vec<Check>) {
        let s = compat::summary(&checks);
        if s.fail > 0 { self.error(format!("INDUSTREX compatibility check found {} problem(s) in the saved file. See the Changes tab.", s.fail)); }
        if let Some(i) = self.idx(id) { self.entries[i].compat = Some(CompatResult { name, checks }); }
    }

    // ---- pieces: preview, then one file each
    pub fn save_split(&mut self) { let o = SplitOptions { straighten: self.ts.straighten, fill_slivers: self.ts.fill, turns: 0 }; self.prepare_parts(o, "Save split files"); }
    /// One button for the usual job: find the film pieces, straighten and crop each, preview, save one file each.
    pub fn process_plate(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let rot = self.view_rot;
        self.run("Finding film pieces…", move || {
            let items = App::pieces_in_screen_order(&img, f, 0.6, 0, rot);
            Box::new(move |app: &mut App, _: &egui::Context| {
                if items.is_empty() { app.error("No film found on this plate. Try Find film pieces with High sensitivity, or draw regions by hand."); return; }
                if let Some(e) = app.cur_mut() { e.work.crop = None; e.work.regions = items; }
                app.sync_crop_inputs();
                app.prepare_parts(SplitOptions { straighten: true, fill_slivers: false, turns: 0 }, "Process this plate");
            })
        });
    }
    /// Works out every piece as it would be saved and opens the preview. Nothing is written until the user confirms.
    pub fn prepare_parts(&mut self, split: SplitOptions, title: &'static str) {
        let Some(i) = self.cur_idx() else { return };
        let Some((img, f)) = self.frame_data() else { return };
        let regions = self.entries[i].work.regions.clone();
        if regions.is_empty() { return; }
        let (win, inv, rot) = (self.win(), self.invert_view, self.view_rot);
        let dir = self.output_dir(&self.entries[i].shot.path);
        self.run("Preparing the preview…", move || {
            let thumb = |frame: &[i32], w: usize, h: usize| {
                let g = im::render(frame, &img, win.c, win.w, inv);
                let (g, w, h) = crate::export_img::fit_gray(&g, w, h, 420);
                let (g, w, h) = im::rotate_view_u8(&g, w, h, rot);
                egui::ColorImage::from_gray([w, h], &g)
            };
            let mut out = Vec::new();
            for r in regions {
                let Ok(before) = im::crop(&img, r.region.rect) else { continue };
                let b = thumb(&before.frames[f.min(before.frames.len() - 1)], before.cols, before.rows);
                let (after, info, warn) = if split.straighten {
                    match im::straighten_piece(&img, &r.region, None, 5.0, 0.02, 0) {
                        Ok(s) => {
                            let info = if s.rotated { format!("{}×{} · straightened {:.2}°", s.img.cols, s.img.rows, s.angle) }
                                else if s.too_steep { format!("{}×{} · tilt {:.1}° is over 5°: not rotated", s.img.cols, s.img.rows, s.measured) }
                                else if s.no_background { format!("{}×{} · kept as drawn (no background to measure)", s.img.cols, s.img.rows) }
                                else { format!("{}×{} · already straight, cropped to the film", s.img.cols, s.img.rows) };
                            (s.img, info, s.too_steep)
                        }
                        Err(m) => (before.clone(), m, true),
                    }
                } else {
                    let mut a = before.clone();
                    let filled = split.fill_slivers && !r.region.cuts.is_empty() && img.padding.is_some();
                    if filled { for fr in a.frames.iter_mut() { im::fill_outside_cuts(fr, &r.region, img.padding.unwrap()); } }
                    let info = format!("{}×{}{}", a.cols, a.rows, if filled { " · neighbour's sliver filled" } else { "" });
                    (a, info, false)
                };
                let a = thumb(&after.frames[f.min(after.frames.len() - 1)], after.cols, after.rows);
                out.push((r, b, a, info, warn));
            }
            Box::new(move |app: &mut App, ctx: &egui::Context| {
                let items = out.into_iter().enumerate().map(|(k, (item, b, a, info, warn))| PiecePreview {
                    item, include: true, info, warn,
                    before: ctx.load_texture(format!("pb{k}"), b, egui::TextureOptions::LINEAR), after: ctx.load_texture(format!("pa{k}"), a, egui::TextureOptions::LINEAR),
                }).collect();
                app.pieces = Some(PiecesDialog { title, items, split, add_to_list: true, dir });
            })
        });
    }
    /// Saves the given pieces of the open file, one new file each, into `dir`.
    pub fn save_parts_to(&mut self, dir: PathBuf, split: SplitOptions, regions: Vec<RegionItem>, add_to_list: bool) {
        let Some(i) = self.cur_idx() else { return };
        if regions.is_empty() || self.entries[i].work.img.is_none() { return; }
        let split = SplitOptions { turns: (self.view_rot / 90) as i32, ..split };   // saved the way it is viewed
        let j2k = self.want_j2k();
        let target = self.ts.label_target;
        let series = d::new_uid();
        let e = &self.entries[i];
        let base = base_name(&e.shot.name);
        let n = regions.len();
        let orig = e.shot.orig.clone();
        let file = e.shot.file.clone();
        let img = e.work.img.clone();
        let ops = e.work.ops.clone();
        let turns = e.work.turns;
        let orig_els = e.shot.orig_els.clone();
        let originals = self.originals();
        self.run(if j2k { "Compressing JPEG 2000 and saving the pieces…" } else { "Saving the pieces…" }, move || {
            let mut written = Vec::new();
            let mut problems = 0;
            let mut err = std::fs::create_dir_all(&dir).err().map(|e| format!("{}: {e}", dir.display()));
            for (k, r) in regions.iter().enumerate() {
                if err.is_some() { break; }
                match App::write_piece(&PieceJob { file: &file, orig: &orig, img: img.as_deref(), ops: &ops, turns, orig_els: &orig_els, j2k, target, series: &series, base: &base, dir: &dir, originals: &originals, split }, r, k, n) {
                    Ok((p, bad)) => { written.push(p); if bad { problems += 1; } }
                    Err(m) => err = Some(m),
                }
            }
            Box::new(move |app: &mut App, _: &egui::Context| {
                if !written.is_empty() { app.last_saved = Some(written[0].clone()); }
                let n = written.len();
                if add_to_list && n > 0 { app.add_paths_opt(written, false, false, true); }
                if let Some(m) = err { app.error(format!("Stopped after {n} file(s): {m}")); return; }
                if let Some(e) = app.cur_mut() { e.work.regions.clear(); e.work.crop = None; }
                app.sync_crop_inputs();
                if problems > 0 { app.error(format!("Saved {n} files in {}, but the INDUSTREX check found problems in {problems}.", dir.display())); }
                else { app.toast(format!("Saved {n} new file{} in {} — passed the INDUSTREX check. The original file is unchanged.", if n == 1 { "" } else { "s" }, dir.display())); }
            })
        });
    }

    /// Builds, checks and writes one piece of a plate as its own new file. Returns the path and whether the
    /// INDUSTREX check found a problem. Never overwrites: the name is made unique and originals are refused.
    fn write_piece(j: &PieceJob, r: &RegionItem, k: usize, n: usize) -> Result<(PathBuf, bool), String> {
        let label = { let l = r.label.trim(); if l.is_empty() { (k + 1).to_string() } else { l.to_string() } };
        let part = PartInfo { series: j.series.to_string(), index: k + 1, text: format!("Split part {} of {n} ({}×{} at {},{})", k + 1, r.region.rect.w, r.region.rect.h, r.region.rect.x, r.region.rect.y) };
        let st = CopyState { file: j.file, orig: j.orig, img: j.img, ops: j.ops, turns: j.turns, orig_els: j.orig_els, store_window: None, j2k: j.j2k };
        let mut b = copy::build_copy(&st, Some(&r.region), Some(&part), j.split)?;
        let comments_before = b.file.ds.string(shots::COMMENTS);
        if n > 1 {   // the plate's coverage covers every piece; each piece gets its own
            let c = b.file.ds.string(shots::COMMENTS); let next = shots::with_coverage(&c, "");
            if next != c { if next.is_empty() { b.file.ds.remove(shots::COMMENTS); } else { b.file.ds.set_text(shots::COMMENTS, &next, Some("LT")).map_err(|e| e.0)?; } }
        }
        if j.target == 1 { b.file.ds.set_text(0x00204000, &label, Some("LT")).map_err(|e| e.0)?; }
        // each new file carries its own coverage when its numbers read cleanly
        if shots::coverage_in(&b.file.ds.string(shots::COMMENTS)).is_empty() {
            if let Some((text, true)) = crate::export_img::first_frame(&b.file).map(|i| read_cov(&b.file, &i)) {
                let next = shots::with_coverage(&b.file.ds.string(shots::COMMENTS), &text);
                b.file.ds.set_text(shots::COMMENTS, &next, Some("LT")).map_err(|e| e.0)?;
            }
        }
        if j.target == 2 {
            let id = b.file.ds.string(0x00100020);
            let next = if id.is_empty() { label.clone() } else { format!("{id}-{label}") };
            if let Some(m) = d::validate("LO", &next) { return Err(format!("Part {}: Component ID “{next}” — {m}", k + 1)); }
            b.file.ds.set_text(0x00100020, &next, None).map_err(|e| e.0)?;
        }
        let bytes = d::write(&b.file).map_err(|e| e.0)?;
        let safe: String = label.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect();
        let path = App::unique_path(j.dir, &format!("{}_{safe}.dcm", j.base));
        if j.originals.contains(&path) { return Err("would overwrite an original".into()); }
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        // the label or coverage written into Image Comments is a deliberate edit, so the check must expect it
        let mut edited = b.edited.clone();
        if b.file.ds.string(shots::COMMENTS) != comments_before && !edited.contains(&shots::COMMENTS) { edited.push(shots::COMMENTS); }
        let checks = compat::check(&bytes, Some(j.orig), &CheckOptions { removed: b.removed.clone(), edited, pixels_changed: true, ..Default::default() });
        if std::env::var_os("WELDSCOPE_TEST_DIR").is_some() { for c in checks.iter().filter(|c| c.level == compat::Level::Fail) { eprintln!("check failed: {} — {}", c.title, c.detail); } }
        Ok((path, compat::summary(&checks).fail > 0))
    }

    // ---- whole job: every plate in the list, found, straightened, cropped and saved
    /// Plates the job run would process: originals with a file on disk, no unsaved image steps, and no pieces
    /// made from them yet. Files that were themselves made by WeldScope are left out.
    pub fn job_candidates(&self) -> (Vec<u64>, usize) {
        let parents = self.parents();
        let has_children: BTreeSet<u64> = parents.values().copied().collect();
        let mut skipped = 0;
        let ids = self.entries.iter().filter(|e| !e.shot.path.is_empty() && !e.link.in_edited && !parents.contains_key(&e.shot.id) && e.link.sources.is_empty())
            .filter(|e| { let ok = !has_children.contains(&e.shot.id) && e.work.ops.is_empty(); if !ok { skipped += 1; } ok }).map(|e| e.shot.id).collect();
        (ids, skipped)
    }
    pub fn job_open(&mut self) {
        let (ids, skipped) = self.job_candidates();
        let near = self.near();
        self.job_dlg = Some(JobDialog { ids, skipped, dir: self.output_dir(&near), rows: Vec::new(), done: false });
    }
    /// Runs the whole job in the background: one new file per film piece, nothing overwritten, originals untouched.
    fn job_run(&mut self, ids: Vec<u64>, dir: PathBuf) {
        struct In { name: String, base: String, file: DicomFile, orig: Arc<DicomFile>, orig_els: shots::OrigEls, rot: u32 }
        let items: Vec<In> = self.entries.iter().filter(|e| ids.contains(&e.shot.id)).map(|e| In { name: e.shot.name.clone(), base: base_name(&e.shot.name), file: e.shot.file.clone(), orig: e.shot.orig.clone(), orig_els: e.shot.orig_els.clone(), rot: e.view_rot }).collect();
        let (save_j2k, target, originals, progress) = (self.ts.save_j2k, self.ts.label_target, self.originals(), self.progress.clone());
        let total = items.len();
        self.run(format!("Processing {total} plate{}…", if total == 1 { "" } else { "s" }), move || {
            let mut rows: Vec<JobRow> = Vec::new();
            let mut written: Vec<PathBuf> = Vec::new();
            let mut stop = std::fs::create_dir_all(&dir).err().map(|e| format!("{}: {e}", dir.display()));
            for (n, it) in items.iter().enumerate() {
                if let Some(m) = &stop { rows.push(JobRow { name: it.name.clone(), files: 0, note: format!("not processed ({m})"), bad: true }); continue; }
                *progress.lock().unwrap() = format!("{} of {total}: {}", n + 1, elide(&it.name, 40));
                let Some(img) = crate::export_img::first_frame(&it.file) else { rows.push(JobRow { name: it.name.clone(), files: 0, note: "the image could not be read — skipped".into(), bad: true }); continue };
                let pieces = App::pieces_in_screen_order(&img, 0, 0.6, 0, it.rot);
                let lv = im::plate_levels(&img.frames[0], img.cols, img.rows, img.padding, 0.6);
                if pieces.is_empty() { rows.push(JobRow { name: it.name.clone(), files: 0, note: "no film found — skipped; open it and use Find film pieces".into(), bad: true }); continue; }
                if pieces.len() == 1 && !lv.has_background { rows.push(JobRow { name: it.name.clone(), files: 0, note: "one film with no empty area round it — nothing to crop".into(), bad: false }); continue; }
                let steep = pieces.iter().filter(|p| p.tilt.map_or(false, |t| t.abs() > 5.0)).count();
                let series = d::new_uid();
                let j2k = save_j2k && img.bits_allocated <= 16;
                let job = PieceJob { file: &it.file, orig: &it.orig, img: Some(&img), ops: &[], turns: 0, orig_els: &it.orig_els, j2k, target, series: &series, base: &it.base, dir: &dir, originals: &originals, split: SplitOptions { straighten: true, fill_slivers: false, turns: (it.rot / 90) as i32 } };
                let (mut files, mut problems, mut failed) = (0, 0, None);
                for (k, r) in pieces.iter().enumerate() {
                    match App::write_piece(&job, r, k, pieces.len()) { Ok((p, bad)) => { written.push(p); files += 1; if bad { problems += 1; } } Err(m) => { failed = Some(m); break; } }
                }
                let mut note = format!("{} piece{} found", pieces.len(), if pieces.len() == 1 { "" } else { "s" });
                if steep > 0 { note += &format!(" · {steep} tilted over 5°: cropped, not rotated"); }
                if problems > 0 { note += &format!(" · INDUSTREX check found problems in {problems}"); }
                if let Some(m) = &failed { note += &format!(" · stopped: {m}"); if files == 0 && m.contains("os error") { stop = Some(m.clone()); } }
                rows.push(JobRow { name: it.name.clone(), files, note, bad: failed.is_some() || problems > 0 || steep > 0 });
            }
            progress.lock().unwrap().clear();
            Box::new(move |app: &mut App, _: &egui::Context| {
                let n = written.len();
                if n > 0 { app.last_saved = Some(written[0].clone()); app.add_paths_opt(written, false, false, true); }
                app.job_dlg = Some(JobDialog { ids: Vec::new(), skipped: 0, dir: Some(dir), rows, done: true });
            })
        });
    }
    fn job_dialog(&mut self, ctx: &egui::Context) {
        let Some(mut dlg) = self.job_dlg.take() else { return };
        if self.busy() { self.job_dlg = Some(dlg); return; }
        let (mut go, mut close, mut change) = (false, false, false);
        egui::Window::new(if dlg.done { "Job processed" } else { "Process the whole job" }).collapsible(false).resizable(false).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).show(ctx, |ui| {
            ui.set_min_width(620.0);
            if dlg.done {
                let files: usize = dlg.rows.iter().map(|r| r.files).sum();
                let made = dlg.rows.iter().filter(|r| r.files > 0).count();
                ui.label(format!("{files} new file{} saved from {made} plate{}. The original files are unchanged.", if files == 1 { "" } else { "s" }, if made == 1 { "" } else { "s" }));
                if let Some(d) = &dlg.dir { ui.label(RichText::new(format!("Saved in {}", d.display())).weak().small()); }
                ui.add_space(4.0);
                egui::ScrollArea::vertical().max_height((ctx.screen_rect().height() - 320.0).max(140.0)).show(ui, |ui| {
                    egui::Grid::new("jobrows").num_columns(3).spacing([14.0, 5.0]).striped(true).show(ui, |ui| {
                        for r in &dlg.rows {
                            ui.label(elide(&r.name, 34)).on_hover_text(&r.name);
                            ui.label(if r.files == 0 { RichText::new("—").weak() } else { RichText::new(format!("{} file{}", r.files, if r.files == 1 { "" } else { "s" })).color(OK) });
                            ui.label(RichText::new(&r.note).small().color(if r.bad { ACCENT } else { ui.visuals().weak_text_color() }));
                            ui.end_row();
                        }
                    });
                });
                ui.add_space(6.0);
                ui.label(RichText::new("The new files are listed inside their originals. Look through them before relying on them: lines in amber need a check.").weak().small());
                if ui.button("Close").clicked() { close = true; }
            } else {
                let n = dlg.ids.len();
                if n == 0 { ui.label(if dlg.skipped > 0 { "Every plate in the list already has pieces made from it (or has unsaved image changes), so there is nothing left to process." } else { "There are no plates in the list. Open the job folder first." }); }
                else {
                    ui.label(format!("{n} plate{} will be processed. For each one WeldScope finds every piece of film, straightens it, crops it to the film and saves it as its own new file, with its coverage where the numbers read cleanly.", if n == 1 { "" } else { "s" }));
                    if dlg.skipped > 0 { ui.label(RichText::new(format!("{} plate{} left out: pieces were already made from them, or they have unsaved image changes.", dlg.skipped, if dlg.skipped == 1 { " is" } else { "s are" })).weak()); }
                    ui.label("The original files are not changed and nothing is overwritten. There is no preview for each plate; a summary is shown at the end.");
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        ui.label(match &dlg.dir { Some(d) => format!("Save to: {}", elide(&d.to_string_lossy(), 70)), None => "Choose a folder for the new files".to_string() });
                        if ui.button("Change…").clicked() { change = true; }
                    });
                }
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if n > 0 && ui.add_enabled(dlg.dir.is_some(), egui::Button::new(RichText::new(format!("Process {n} plate{}", if n == 1 { "" } else { "s" })).color(ACCENT))).clicked() { go = true; }
                    if ui.button(if n > 0 { "Cancel" } else { "Close" }).clicked() { close = true; }
                });
            }
        });
        if change { let near = self.near(); if let Some(d) = self.pick_folder("Choose the folder for new files", &near) { self.prefs.output_dir = d.to_string_lossy().into(); dlg.dir = Some(d); } }
        if go { if let Some(dir) = dlg.dir.clone() { self.job_run(dlg.ids.clone(), dir); return; } }
        if !close { self.job_dlg = Some(dlg); }
    }

    /// Saves a new file for every edited file: files with image steps are saved with them (as Save as new file
    /// would), the rest as metadata-only copies. Never overwrites originals or existing files.
    pub fn save_all_edited(&mut self) {
        let edited: Vec<usize> = (0..self.entries.len()).filter(|&i| self.entries[i].dirty).collect();
        if edited.is_empty() { self.toast("No files with unsaved changes."); return; }
        let near = self.entries[edited[0]].shot.path.clone();
        let Some(dir) = self.output_dir(&near).or_else(|| self.pick_folder("Choose a folder for the new files", &near)) else { self.toast("Not saved."); return };
        let names = shots::copy_names(&edited.iter().map(|&i| self.entries[i].shot.name.as_str()).collect::<Vec<_>>());
        struct Item { id: u64, name: String, key: String, orig: Arc<DicomFile>, built: Result<copy::BuiltCopy, String> }
        let mut items = Vec::new();
        for &i in &edited { self.store_auto_coverage(i); }
        for (k, &i) in edited.iter().enumerate() {
            let e = &self.entries[i];
            let j2k = e.work.decoded && e.work.img.as_ref().map_or(false, |m| m.bits_allocated <= 16);
            let built = copy::build_copy(&self.copy_state(e, false, j2k), None, None, SplitOptions::default());
            items.push(Item { id: e.shot.id, name: names[k].clone(), key: e.state_key(), orig: e.shot.orig.clone(), built });
        }
        let originals = self.originals();
        self.run(format!("Saving {} new files…", items.len()), move || {
            let mut done: Vec<(u64, String, PathBuf, Vec<Check>)> = Vec::new();
            let mut failed = Vec::new();
            let mut problems = 0;
            if let Err(e) = std::fs::create_dir_all(&dir) { failed.push(format!("{}: {e}", dir.display())); }
            else { for it in items {
                let r = it.built.and_then(|b| {
                    let bytes = d::write(&b.file).map_err(|e| e.0)?;
                    let path = App::unique_path(&dir, &it.name);
                    if originals.contains(&path) { return Err("would overwrite an original".into()); }
                    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                    let checks = compat::check(&bytes, Some(&it.orig), &CheckOptions { removed: b.removed.clone(), edited: b.edited.clone(), pixels_changed: b.pixels_changed, xml_tag: d::industrex_info(&it.orig.ds).and_then(|x| x.xml_tag) });
                    if compat::summary(&checks).fail > 0 { problems += 1; }
                    Ok((path, checks))
                });
                match r { Ok((p, c)) => done.push((it.id, it.key, p, c)), Err(m) => failed.push(format!("{}: {m}", it.name)) }
            } }
            Box::new(move |app: &mut App, _: &egui::Context| {
                let n = done.len();
                if let Some(d0) = done.first() { app.last_saved = Some(d0.2.clone()); }
                for (id, key, p, checks) in done {
                    if let Some(i) = app.idx(id) {
                        let e = &mut app.entries[i];
                        e.saved_key = key; e.shot.saved_as = p.to_string_lossy().into(); e.refresh_dirty();
                        e.compat = Some(CompatResult { name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), checks });
                    }
                }
                let msg = format!("Saved {n} new file{} to {}{}{}", if n == 1 { "" } else { "s" }, dir.display(),
                    if problems == 0 { " — INDUSTREX check: all passed".to_string() } else { format!(" — INDUSTREX check: problems in {problems}") },
                    if failed.is_empty() { String::new() } else { format!(". Not saved: {}", failed.join("; ")) });
                app.org.result = msg.clone();
                if failed.is_empty() && problems == 0 { app.toast(msg); } else { app.error(msg); }
            })
        });
    }

    pub fn export(&mut self, kind: &str) {
        let Some(i) = self.cur_idx() else { return };
        let Some(img) = self.entries[i].work.img.clone() else { return };
        let e = &self.entries[i];
        let base = base_name(&e.shot.name);
        let near = e.shot.path.clone();
        match kind {
            "tiff" => {
                let Some(path) = self.save_dialog(&format!("{base}.tif"), ("TIFF", &["tif", "tiff"]), &near) else { return };
                let f = e.work.frame;
                self.run("Exporting…", move || { let r = std::fs::write(&path, weldscope_core::export::tiff(&img, f)); Box::new(move |app: &mut App, _: &egui::Context| match r { Ok(_) => app.toast(format!("Saved {}", path.display())), Err(e) => app.error(format!("Not saved: {e}")) }) });
            }
            "png" | "pdf" => {
                let (rgb, w, h) = crate::export_img::rendered(self, true);
                let e = &self.entries[i];
                if kind == "png" {
                    let Some(path) = self.save_dialog(&format!("{base}.png"), ("PNG image", &["png"]), &near) else { return };
                    self.run("Exporting…", move || {
                        let rgba: Vec<u8> = rgb.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect();
                        let r = weldscope_core::export::png_rgba(&rgba, w, h).and_then(|b| std::fs::write(&path, b).map_err(|e| e.to_string()));
                        Box::new(move |app: &mut App, _: &egui::Context| match r { Ok(_) => app.toast(format!("Saved {}", path.display())), Err(e) => app.error(format!("Not saved: {e}")) })
                    });
                } else {
                    let Some(path) = self.save_dialog(&format!("{base}_report.pdf"), ("PDF", &["pdf"]), &near) else { return };
                    let ds = &e.shot.file.ds;
                    let utf8 = d::charset_is_utf8(ds);
                    let mut fields: Vec<(String, String)> = Vec::new();
                    for (_, tags) in COMMON { for &t in tags.iter() { if let Some(el) = ds.get(t).filter(|el| el.bytes().is_some()) { fields.push((d::tag_info(t).name, d::value_to_text(el, utf8))); } } }
                    fields.push(("Image size".into(), format!("{} × {} pixels", img.cols, img.rows)));
                    if !e.work.ops.is_empty() { fields.push(("Image processing".into(), e.work.ops.join("; "))); }
                    let changes = shots::meta_change_list(&e.shot.file, &e.shot.orig_els);
                    if !changes.is_empty() { fields.push(("Metadata edited".into(), changes.join("; "))); }
                    let win = self.win();
                    let name = e.shot.name.clone();
                    let inv = self.invert_view;
                    self.run("Building the report…", move || {
                        let s = (2400.0 / w.max(h) as f64).min(1.0);
                        let (dw, dh) = (((w as f64 * s).round() as usize).max(1), ((h as f64 * s).round() as usize).max(1));
                        let small = crate::export_img::resize_rgb(&rgb, w, h, dw, dh);
                        let r = weldscope_core::export::jpeg_rgb(&small, dw, dh, 92).and_then(|jpg| {
                            let sub = format!("{name} · generated {} · WeldScope (not an inspection record)", chrono::Local::now().format("%Y-%m-%d %H:%M"));
                            let pdf = weldscope_core::export::pdf_report(&weldscope_core::export::Report { title: "Radiograph report", subtitle: &sub, fields, jpeg: Some((&jpg, dw, dh)),
                                caption: &format!("Window width {:.1}, level {:.1}{}", win.w, win.c, if inv { ", inverted view" } else { "" }) });
                            std::fs::write(&path, pdf).map_err(|e| e.to_string())
                        });
                        Box::new(move |app: &mut App, _: &egui::Context| match r { Ok(_) => app.toast(format!("Saved {}", path.display())), Err(e) => app.error(format!("Not saved: {e}")) })
                    });
                }
            }
            _ => {}
        }
    }

    // ------------------------------------------------------------ thumbnails
    fn pump_thumbs(&mut self) {
        while self.thumbs_running < 2 {
            let Some(i) = self.entries.iter().position(|e| e.thumb.is_none() && !e.thumb_queued) else { break };
            self.entries[i].thumb_queued = true;
            self.thumbs_running += 1;
            let (id, file, tx, ctx) = (self.entries[i].shot.id, self.entries[i].shot.orig.clone(), self.thumb_tx.clone(), self.cov_tx.clone());
            let want_cov = self.entries[i].shot.coverage().is_empty();
            std::thread::spawn(move || {
                // the coverage is read from the same decoded image, straight after the preview
                let full = crate::export_img::first_frame(&file);
                let cov = if want_cov { full.as_ref().map(|i| read_cov(&file, i)) } else { None };
                let (img, rot) = crate::export_img::thumbnail_of(&file, full);
                let _ = tx.send((id, img, rot));
                if let Some((text, sure)) = cov { let _ = ctx.send((id, text, sure)); }
            });
        }
    }

    pub fn any_dirty(&self) -> bool { self.entries.iter().any(|e| e.dirty) }
}

impl eframe::App for App {
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if let Ok(s) = serde_json::to_string(&self.prefs) { storage.set_string("weldscope.prefs", s); }
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll(ctx);
        if self.edge_pending && !self.busy() { self.edge_pending = false; self.update_edge(false); }
        // files dropped on the window
        let dropped: Vec<PathBuf> = ctx.input(|i| i.raw.dropped_files.iter().filter_map(|f| f.path.clone()).collect());
        if !dropped.is_empty() && !self.busy() {
            let mut files = Vec::new();
            for p in dropped { if p.is_dir() { files.extend(Self::dicom_files_in(&p)); } else { files.push(p); } }
            self.add_paths(files, true, false);
        }
        // close with unsaved work
        if ctx.input(|i| i.viewport().close_requested()) && !self.allow_close && self.any_dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.dialog = Some(Dialog::Close);
        }
        let title = match self.cur() { Some(e) => format!("{}{} — WeldScope", if self.any_dirty() { "• " } else { "" }, e.shot.name), None => "WeldScope".into() };
        ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));
        if !self.busy() && ctx.memory(|m| m.focused().is_none()) {
            let (z, y, s) = ctx.input_mut(|i| (i.consume_key(egui::Modifiers::COMMAND, egui::Key::Z), i.consume_key(egui::Modifiers::COMMAND, egui::Key::Y), i.consume_key(egui::Modifiers::COMMAND, egui::Key::S)));
            if z { self.undo(); }
            if y { self.redo(); }
            if s && self.cur.is_some() && self.mode == Mode::Edit { self.save_copy(false); }
        }

        self.top_bar(ctx);
        self.status_bar(ctx);
        let busy = self.busy() || self.pieces.is_some();
        // single keys (only when not typing)
        if !busy && self.mode == Mode::Edit && !ctx.wants_keyboard_input() && self.dialog.is_none() {
            let key = |k: egui::Key| ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, k));
            if key(egui::Key::PageDown) { self.step_file(1); }
            if key(egui::Key::PageUp) { self.step_file(-1); }
            if self.img().is_some() {
                if key(egui::Key::F) { crate::viewer::fit(self); }
                if key(egui::Key::Num1) { crate::viewer::actual_size(self); }
                if key(egui::Key::R) { self.view_rot = (self.view_rot + 90) % 360; self.view.fit_pending = true; }
                if key(egui::Key::I) { self.invert_view = !self.invert_view; self.invalidate(); }
                if key(egui::Key::O) { self.prefs.overlay.enabled = !self.prefs.overlay.enabled; }
                if key(egui::Key::M) && self.review.is_some() { self.ind_show = !self.ind_show; }
                if let Some(n) = self.ind_sel { if key(egui::Key::Y) { self.judge(n, Verdict::Indication); } else if key(egui::Key::N) { self.judge(n, Verdict::NotIndication); } }
            }
        }
        match self.mode {
            Mode::Edit => {
                if self.prefs.show_files {
                    egui::SidePanel::left("files").resizable(true).default_width(250.0).width_range(170.0..=480.0).show(ctx, |ui| { ui.add_enabled_ui(!busy, |ui| crate::organize::file_pane(self, ui)); });
                }
                if self.prefs.show_tools {
                    egui::SidePanel::right("tools").resizable(true).default_width(380.0).width_range(300.0..=640.0).show(ctx, |ui| { ui.add_enabled_ui(!busy, |ui| crate::panels::tools(self, ui)); });
                }
                egui::CentralPanel::default().frame(egui::Frame::none().fill(Color32::from_gray(14))).show(ctx, |ui| crate::viewer::show(self, ui));
            }
            Mode::Organize => {
                egui::SidePanel::right("batch").resizable(true).default_width(400.0).width_range(320.0..=640.0).show(ctx, |ui| { ui.add_enabled_ui(!busy, |ui| crate::organize::batch_panel(self, ui)); });
                egui::CentralPanel::default().show(ctx, |ui| { ui.add_enabled_ui(!busy, |ui| crate::organize::organize(self, ui)); });
            }
        }
        self.dialogs(ctx);
        if let Some(job) = &self.job {
            if job.started.elapsed() > Duration::from_millis(150) {
                egui::Area::new(egui::Id::new("busy")).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).order(egui::Order::Foreground).show(ctx, |ui| {
                    egui::Frame::popup(ui.style()).inner_margin(16.0).show(ui, |ui| { ui.horizontal(|ui| { ui.spinner(); ui.label(RichText::new(&job.label).size(15.0)); }); let p = self.progress.lock().unwrap().clone(); if !p.is_empty() { ui.label(RichText::new(p).weak()); } });
                });
            }
            ctx.request_repaint_after(Duration::from_millis(50));
        }
        if let Some((_, _, t)) = &self.toast { let d = if self.toast.as_ref().unwrap().1 { 9 } else { 6 }; if t.elapsed() > Duration::from_secs(d) { self.toast = None; } else { ctx.request_repaint_after(Duration::from_millis(500)); } }
    }
}

impl App {
    fn top_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("top").frame(egui::Frame::side_top_panel(&ctx.style()).inner_margin(egui::Margin::symmetric(8.0, 6.0))).show(ctx, |ui| {
            ui.add_enabled_ui(!self.busy() && self.pieces.is_none(), |ui| {
                ui.horizontal(|ui| {
                    if let Some(l) = &self.logo { ui.add(egui::Image::new(l).fit_to_exact_size(egui::vec2(28.0 * 875.0 / 243.0, 28.0))); }
                    ui.separator();
                    if ui.button("Open folder").on_hover_text("Choose the folder to work in").clicked() { self.open_folder_dialog(); }
                    if ui.button("Add files").on_hover_text("Add DICONDE files to the list (Ctrl+O)").clicked() || ctx.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::O)) { self.open_files_dialog(); }
                    ui.separator();
                    ui.selectable_value(&mut self.mode, Mode::Edit, RichText::new("Edit").strong());
                    ui.selectable_value(&mut self.mode, Mode::Organize, RichText::new("Organize shots").strong());
                    ui.separator();
                    let (u, r) = (self.undo_text(), self.redo_text());
                    if ui.add_enabled(u.is_some(), egui::Button::new("Undo")).on_hover_text(u.as_ref().map(|t| format!("Undo: {t} (Ctrl+Z)")).unwrap_or("Nothing to undo".into())).clicked() { self.undo(); }
                    if ui.add_enabled(r.is_some(), egui::Button::new("Redo")).on_hover_text(r.as_ref().map(|t| format!("Redo: {t} (Ctrl+Y)")).unwrap_or("Nothing to redo".into())).clicked() { self.redo(); }
                    ui.separator();
                    let has = self.cur.is_some() && self.mode == Mode::Edit;
                    let dirty = self.cur().map_or(false, |e| e.dirty);
                    let save = egui::Button::new(RichText::new("Save as new file").strong().color(if dirty { Color32::BLACK } else { ui.visuals().text_color() })).fill(if dirty { ACCENT } else { ui.visuals().widgets.inactive.weak_bg_fill });
                    let where_ = self.output_dir(&self.near()).map(|d| d.display().to_string()).unwrap_or_else(|| "a folder you choose".into());
                    if ui.add_enabled(has, save).on_hover_text(format!("Writes a new file into {where_}. Your original file is never changed. (Ctrl+S)")).clicked() { self.save_copy(false); }
                    // result of the INDUSTREX check of this file's last saved copy
                    if has {
                        if let Some(sm) = self.cur().and_then(|e| e.compat.as_ref()).map(|c| compat::summary(&c.checks)) {
                            let (t, c) = if sm.fail > 0 { (format!("✖ INDUSTREX check: {} problem{}", sm.fail, if sm.fail == 1 { "" } else { "s" }), BAD) } else if sm.warn > 0 { ("✔ INDUSTREX check passed (warnings)".to_string(), WARN) } else { ("✔ INDUSTREX check passed".to_string(), OK) };
                            if ui.add(egui::Label::new(RichText::new(t).color(c)).sense(egui::Sense::click())).on_hover_text("The last saved file was read back and checked. Click for the details.").clicked() { self.prefs.tab = Tab::Changes; self.prefs.show_tools = true; }
                        }
                    }
                    ui.add_enabled_ui(has, |ui| {
                        ui.menu_button("Export", |ui| {
                            if ui.button("Save as… (choose name and folder)").clicked() { ui.close_menu(); self.save_copy(true); }
                            ui.separator();
                            if self.img().is_none() { ui.disable(); }
                            if ui.button("PNG image (as displayed)").clicked() { ui.close_menu(); self.export("png"); }
                            if ui.button("TIFF (raw pixel values)").clicked() { ui.close_menu(); self.export("tiff"); }
                            if ui.button("PDF report").clicked() { ui.close_menu(); self.export("pdf"); }
                        });
                    });
                    if self.any_dirty() {
                        let n = self.entries.iter().filter(|e| e.dirty).count();
                        ui.label(RichText::new(format!("● {n} unsaved")).color(ACCENT)).on_hover_text("Files with changes not saved as a new file yet");
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("?").on_hover_text("Keyboard and mouse shortcuts").clicked() { self.show_keys = !self.show_keys; }
                        if self.mode == Mode::Edit {
                            ui.toggle_value(&mut self.prefs.show_tools, "Tools pane").on_hover_text("Show or hide the tool panel");
                            ui.toggle_value(&mut self.prefs.show_files, "Files pane").on_hover_text("Show or hide the file pane");
                        }
                    });
                });
            });
        });
    }

    fn status_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if let Some(e) = self.cur() {
                    let ds = &e.shot.file.ds;
                    ui.label(RichText::new(format!("{}×{} · {}", ds.string(0x00280011), ds.string(0x00280010), d::ts_name(&e.shot.orig.transfer_syntax))).weak());
                    if !self.probe.is_empty() { ui.label(RichText::new(&self.probe).monospace()); }
                }
                if !self.entries.is_empty() {
                    ui.separator();
                    if let Some(p) = self.last_saved.clone() { if ui.small_button("Show last saved").on_hover_text(p.display().to_string()).clicked() { Self::show_in_folder(&p); } }
                    if ui.small_button("Change").on_hover_text("Choose another folder for new files").clicked() { self.change_output_dir(); }
                    if !self.prefs.output_dir.is_empty() && ui.small_button("Reset").on_hover_text("Back to an \"Edited\" folder next to the originals").clicked() { self.prefs.output_dir.clear(); }
                    match self.output_dir(&self.near()) {
                        Some(d) => { let full = d.display().to_string(); ui.label(RichText::new(format!("New files go to: {}", elide(&full, 46))).weak()).on_hover_text(full); }
                        None => { ui.label(RichText::new("New files: you are asked where").weak()); }
                    }
                    ui.separator();
                }
                ui.with_layout(egui::Layout::left_to_right(egui::Align::Center), |ui| {
                    if let Some((m, err, _)) = &self.toast {
                        ui.add(egui::Label::new(RichText::new(m).color(if *err { BAD } else { ui.visuals().strong_text_color() })).truncate()).on_hover_text(m.as_str());
                    }
                });
            });
        });
    }

    fn dialogs(&mut self, ctx: &egui::Context) {
        let mut close = false;
        match &self.dialog {
            Some(Dialog::Close) => {
                let n = self.entries.iter().filter(|e| e.dirty).count();
                egui::Window::new("Unsaved changes").collapsible(false).resizable(false).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).show(ctx, |ui| {
                    ui.label(format!("{n} file(s) have changes that are not saved as a copy. Close WeldScope and discard them?"));
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        if ui.button("Keep working").clicked() { close = true; }
                        if ui.button(RichText::new("Discard and close").color(BAD)).clicked() { self.allow_close = true; close = true; ctx.send_viewport_cmd(egui::ViewportCommand::Close); }
                    });
                });
            }
            None => {}
        }
        if close { self.dialog = None; }
        self.pieces_dialog(ctx);
        self.coverage_dialog(ctx);
        self.job_dialog(ctx);
        if self.show_keys {
            let mut open = true;
            egui::Window::new("Shortcuts").open(&mut open).collapsible(false).resizable(false).anchor(egui::Align2::RIGHT_TOP, [-12.0, 48.0]).show(ctx, |ui| {
                egui::Grid::new("keys").num_columns(2).spacing([18.0, 4.0]).show(ui, |ui| {
                    for (k, t) in [("Mouse wheel", "Zoom"), ("Right-drag", "Brightness and contrast (window/level), with any tool; hold Shift for finer steps"), ("Middle-drag", "Move the image, with any tool"), ("Double-click", "Fit the image"),
                        ("Page Down / Page Up", "Next / previous file"), ("F", "Fit the image"), ("1", "Actual pixels (1:1)"), ("R", "Turn the view 90°"), ("I", "Invert the view"), ("O", "Information overlay on/off"), ("M", "Possible-indication marks on/off"), ("Y / N", "The picked mark is an indication / not an indication"),
                        ("Ctrl+S", "Save as new file"), ("Ctrl+Z / Ctrl+Y", "Undo / redo"), ("Ctrl+O", "Add files")] {
                        ui.label(RichText::new(k).strong()); ui.label(t); ui.end_row();
                    }
                });
                ui.label(RichText::new("Letter keys work when you are not typing in a field.").weak().small());
            });
            self.show_keys = open;
        }
    }

    // ---- coverage (location-marker range of a shot)
    /// Before a file is saved: a coverage read from the film with every number in step is written into it when
    /// the user has not entered one. After image changes it is read again from the image as it is now.
    fn store_auto_coverage(&mut self, i: usize) {
        let e = &self.entries[i];
        if !e.shot.coverage().is_empty() { return; }
        let auto = if e.work.ops.is_empty() { e.auto_cov.clone() } else { e.work.img.as_ref().map(|img| read_cov(&e.shot.file, img)) };
        if let Some((text, true)) = auto { let e = &mut self.entries[i]; if shots::set_coverage(&mut e.shot, &text).is_ok() { e.auto_cov = Some((text, true)); } }
    }

    /// Sets or clears the coverage of shots (kept as a line of Image Comments). One undo step; nothing changes
    /// when any value is refused.
    pub fn set_coverage(&mut self, changes: &[(u64, String)]) -> Result<(), String> {
        for (_, c) in changes { if let Some(m) = shots::coverage_problem(c) { return Err(m); } }
        let changes: Vec<(u64, String)> = changes.iter().filter(|(id, c)| self.entries.iter().any(|e| e.shot.id == *id && e.shot.coverage() != c.trim())).cloned().collect();
        if changes.is_empty() { return Ok(()); }
        if self.mode == Mode::Edit && changes.len() == 1 && self.cur == Some(changes[0].0) {
            // the open file: an ordinary metadata step in its own undo list
            let now = self.cur().unwrap().shot.text(shots::COMMENTS);
            let next = shots::with_coverage(&now, &changes[0].1);
            if next.is_empty() { self.delete_field(&[], shots::COMMENTS); } else { self.set_field(&[], shots::COMMENTS, &next, Some("LT"))?; }
            self.meta.edits.remove("coverage");
            return Ok(());
        }
        let ids: Vec<u64> = changes.iter().map(|c| c.0).collect();
        let text = if changes.len() == 1 { format!("Coverage {}", if changes[0].1.trim().is_empty() { "cleared".to_string() } else { changes[0].1.trim().to_string() }) } else { format!("Coverage set on {} shots", changes.len()) };
        if self.shots_change(&ids, &text, |list| {
            let errs: Vec<String> = list.iter_mut().filter_map(|s| { let c = changes.iter().find(|c| c.0 == s.id)?; shots::set_coverage(s, &c.1).err().map(|m| format!("{}: {m}", s.name)) }).collect();
            if errs.is_empty() { Ok(()) } else { Err(errs) }
        }) { Ok(()) } else { Err(self.org.errors.first().cloned().unwrap_or_default()) }
    }
    /// Reads the location numbers on the film of the given shots and offers the ranges for confirmation.
    pub fn read_coverage(&mut self, ids: &[u64]) {
        struct In { id: u64, name: String, now: String, file: DicomFile, img: Option<ImgRef> }
        let group_tag = self.prefs.group_tag;
        let items: Vec<In> = self.entries.iter().filter(|e| ids.contains(&e.shot.id)).map(|e| {
            let (weld, shot) = (e.shot.text(group_tag).trim().to_string(), e.shot.text(0x00200013));
            let name = if weld.is_empty() && shot.is_empty() { elide(&e.shot.name, 34) } else { format!("{}{}", if weld.is_empty() { "(no weld)".to_string() } else { elide(&weld, 22) }, if shot.is_empty() { String::new() } else { format!(" · Shot {shot}") }) };
            In { id: e.shot.id, name, now: e.shot.coverage(), file: e.shot.file.clone(), img: e.work.img.clone() }
        }).collect();
        if items.is_empty() { return; }
        self.run(if items.len() == 1 { "Reading the location numbers…".to_string() } else { format!("Reading the location numbers on {} shots…", items.len()) }, move || {
            let rows: Vec<CoverageRow> = items.into_iter().map(|it| {
                let img = it.img.or_else(|| crate::export_img::first_frame(&it.file).map(Arc::new));
                let (text, sure) = img.map(|i| read_cov(&it.file, &i)).unwrap_or_default();
                let note = if text.is_empty() { "No row of numbers could be read — type it in".to_string() }
                    else if sure { "Every number read was in step".to_string() }
                    else { "Some numbers were unclear or missing — please check".to_string() };
                CoverageRow { id: it.id, name: it.name, include: sure && text != it.now, now: it.now, text, note, sure }
            }).collect();
            Box::new(move |app: &mut App, _: &egui::Context| { app.coverage = Some(CoverageDialog { rows, error: String::new() }); })
        });
    }
    fn coverage_dialog(&mut self, ctx: &egui::Context) {
        let Some(mut dlg) = self.coverage.take() else { return };
        let (mut apply, mut cancel) = (false, false);
        egui::Window::new("Coverage read from the film").collapsible(false).resizable(false).default_width(700.0).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).show(ctx, |ui| {
            ui.set_min_width(680.0);
            ui.label("WeldScope read the lead location numbers on the film. Check each range against the image and correct it if needed; nothing is stored until you confirm. Ranges it is unsure of are left unticked.");
            ui.add_space(4.0);
            egui::ScrollArea::vertical().max_height((ctx.screen_rect().height() - 320.0).max(140.0)).show(ui, |ui| {
                egui::Grid::new("coverage").num_columns(5).spacing([14.0, 6.0]).striped(true).show(ui, |ui| {
                    for h in ["Use", "Shot", "Now", "Read from film", ""] { ui.label(RichText::new(h).weak().small()); }
                    ui.end_row();
                    for r in dlg.rows.iter_mut() {
                        ui.checkbox(&mut r.include, "");
                        ui.label(&r.name);
                        ui.label(if r.now.is_empty() { RichText::new("—").weak() } else { RichText::new(&r.now) });
                        if ui.add(egui::TextEdit::singleline(&mut r.text).desired_width(180.0).min_size(egui::vec2(180.0, 0.0)).hint_text("e.g. 0-35")).changed() { r.include = !r.text.trim().is_empty(); }
                        ui.label(RichText::new(&r.note).small().color(if r.sure { OK } else { ACCENT }));
                        ui.end_row();
                    }
                });
            });
            if !dlg.error.is_empty() { ui.label(RichText::new(&dlg.error).color(BAD)); }
            ui.add_space(6.0);
            let n = dlg.rows.iter().filter(|r| r.include && !r.text.trim().is_empty()).count();
            ui.horizontal(|ui| {
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new(if n == 1 { "Use this coverage".to_string() } else { format!("Use {n} coverages") }).color(ACCENT))).clicked() { apply = true; }
                if ui.button("Cancel").clicked() { cancel = true; }
            });
            ui.label(RichText::new("A suggestion only: numbers at the very edge of the film, faint numbers and other lead letters can be missed or misread.").weak().small());
        });
        if apply {
            let changes: Vec<(u64, String)> = dlg.rows.iter().filter(|r| r.include && !r.text.trim().is_empty()).map(|r| (r.id, r.text.trim().to_string())).collect();
            match self.set_coverage(&changes) { Ok(()) => return, Err(m) => dlg.error = format!("Not changed: {m}") }
        }
        if !cancel { self.coverage = Some(dlg); }
    }

    /// Preview of the pieces before any file is written: untick a piece to skip it, fix labels, check the folder.
    fn pieces_dialog(&mut self, ctx: &egui::Context) {
        let Some(mut dlg) = self.pieces.take() else { return };
        if self.busy() { self.pieces = Some(dlg); return; }
        let (mut save, mut cancel, mut change) = (false, false, false);
        let n = dlg.items.iter().filter(|p| p.include).count();
        egui::Window::new(dlg.title).collapsible(false).resizable(true).default_width(860.0).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).show(ctx, |ui| {
            ui.label(format!("{} piece{} of film found. Each ticked piece is saved as its own new file; the original file is not changed.", dlg.items.len(), if dlg.items.len() == 1 { "" } else { "s" }));
            ui.add_space(4.0);
            egui::ScrollArea::vertical().max_height((ctx.screen_rect().height() - 300.0).max(160.0)).show(ui, |ui| {
                let fit = |t: &egui::TextureHandle| { let s = t.size_vec2(); let k = (340.0 / s.x).min(150.0 / s.y).min(1.5); s * k };
                for (k, p) in dlg.items.iter_mut().enumerate() {
                    egui::Frame::group(ui.style()).show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.checkbox(&mut p.include, "");
                            ui.vertical(|ui| {
                                ui.horizontal(|ui| { ui.label(RichText::new(format!("Piece {}", k + 1)).strong()); ui.label("label"); ui.add(egui::TextEdit::singleline(&mut p.item.label).desired_width(90.0)); });
                                ui.label(RichText::new(&p.info).color(if p.warn { WARN } else { ui.visuals().text_color() }));
                                ui.add_enabled_ui(p.include, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.vertical(|ui| { ui.label(RichText::new("Now").weak().small()); ui.add(egui::Image::new(&p.before).fit_to_exact_size(fit(&p.before))); });
                                        ui.label(RichText::new("→").size(20.0));
                                        ui.vertical(|ui| { ui.label(RichText::new("Saved file").weak().small()); ui.add(egui::Image::new(&p.after).fit_to_exact_size(fit(&p.after))); });
                                    });
                                });
                            });
                        });
                    });
                }
            });
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                match &dlg.dir { Some(d) => { let full = d.display().to_string(); ui.label(format!("Save to: {}", elide(&full, 80))).on_hover_text(full); } None => { ui.label("Save to: choose a folder"); } }
                if ui.button("Change…").clicked() { change = true; }
            });
            ui.checkbox(&mut dlg.add_to_list, "Add the saved files to the file list, ready for editing their details");
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("Save {n} file{}", if n == 1 { "" } else { "s" })).strong().color(Color32::BLACK)).fill(ACCENT)).clicked() { save = true; }
                if ui.button("Cancel").clicked() { cancel = true; }
            });
        });
        if change { let near = self.near(); if let Some(d) = self.pick_folder("Choose the folder for the new files", &near) { if Self::test_dir().is_none() { self.prefs.output_dir = d.to_string_lossy().into(); } dlg.dir = Some(d); } }
        if save && dlg.dir.is_none() { let near = self.near(); dlg.dir = self.pick_folder("Choose the folder for the new files", &near); save = dlg.dir.is_some(); }
        if save {
            let items: Vec<RegionItem> = dlg.items.iter().filter(|p| p.include).map(|p| p.item.clone()).collect();
            self.save_parts_to(dlg.dir.clone().unwrap(), dlg.split, items, dlg.add_to_list);
        } else if cancel { self.toast("Nothing was saved. The pieces are still marked on the image."); }
        else { self.pieces = Some(dlg); }
    }

    /// Next (+1) or previous (−1) file in the list order.
    pub fn step_file(&mut self, delta: i64) {
        let order: Vec<u64> = crate::organize::grouped(self).into_iter().flat_map(|(_, v)| v).collect();
        if order.is_empty() { return; }
        let pos = self.cur.and_then(|c| order.iter().position(|x| *x == c)).map(|p| p as i64 + delta).unwrap_or(0);
        if pos < 0 || pos >= order.len() as i64 { self.toast(if delta > 0 { "That is the last file." } else { "That is the first file." }); return; }
        self.open_entry(order[pos as usize]);
    }

    // ------------------------------------------------------------ organize: undo
    pub fn shots_change(&mut self, ids: &[u64], text: &str, f: impl FnOnce(&mut Vec<&mut Shot>) -> Result<(), Vec<String>>) -> bool {
        let snap = shots::snapshot(&self.entries.iter().filter(|e| ids.contains(&e.shot.id)).map(|e| &e.shot).collect::<Vec<_>>());
        let mut sel: Vec<&mut Shot> = self.entries.iter_mut().filter(|e| ids.contains(&e.shot.id)).map(|e| &mut e.shot).collect();
        match f(&mut sel) {
            Ok(()) => {
                self.org.undo.push((snap, text.to_string())); self.org.redo.clear(); self.org.errors.clear();
                for e in self.entries.iter_mut() { if ids.contains(&e.shot.id) { e.refresh_dirty(); } }
                if self.cur.map_or(false, |c| ids.contains(&c)) { self.after_meta_change(); self.meta.edits.clear(); }
                self.toast(text.to_string());
                true
            }
            Err(errs) => { self.org.errors = errs; false }
        }
    }
    fn shots_undo(&mut self) {
        let Some((snap, text)) = self.org.undo.pop() else { return };
        let ids: Vec<u64> = snap.iter().map(|s| s.id).collect();
        let now = shots::snapshot(&self.entries.iter().filter(|e| ids.contains(&e.shot.id)).map(|e| &e.shot).collect::<Vec<_>>());
        { let mut sel: Vec<&mut Shot> = self.entries.iter_mut().map(|e| &mut e.shot).collect(); shots::restore(&mut sel, snap); }
        self.org.redo.push((now, text.clone()));
        for e in self.entries.iter_mut() { e.refresh_dirty(); }
        self.after_meta_change(); self.meta.edits.clear();
        self.toast(format!("Undone: {text}"));
    }
    fn shots_redo(&mut self) {
        let Some((snap, text)) = self.org.redo.pop() else { return };
        let ids: Vec<u64> = snap.iter().map(|s| s.id).collect();
        let now = shots::snapshot(&self.entries.iter().filter(|e| ids.contains(&e.shot.id)).map(|e| &e.shot).collect::<Vec<_>>());
        { let mut sel: Vec<&mut Shot> = self.entries.iter_mut().map(|e| &mut e.shot).collect(); shots::restore(&mut sel, snap); }
        self.org.undo.push((now, text.clone()));
        for e in self.entries.iter_mut() { e.refresh_dirty(); }
        self.after_meta_change(); self.meta.edits.clear();
        self.toast(format!("Redone: {text}"));
    }

    /// Applies a saved template to the open file as one undo step.
    pub fn apply_template(&mut self, name: &str) {
        let Some(tpl) = self.prefs.templates.get(name).cloned() else { return };
        let Some(snap) = self.meta_snapshot() else { return };
        let e = self.cur_mut().unwrap();
        let mut errs = Vec::new();
        for (k, v) in &tpl {
            let Ok(tag) = u32::from_str_radix(k, 16) else { continue };
            match v { Some(v) => if let Err(m) = shots::set_field(&mut e.shot.file, &mut e.shot.orig_els, &[], tag, v, None) { errs.push(format!("{}: {m}", d::tag_info(tag).name)); }, None => { shots::delete_field(&mut e.shot.file, &mut e.shot.orig_els, &[], tag); } }
        }
        e.refresh_dirty();
        self.push_meta(snap, format!("Applied template “{name}”"));
        if errs.is_empty() { self.toast(format!("Applied template “{name}”.")); } else { self.error(format!("Template applied with problems: {}", errs.join("; "))); }
    }
    pub fn compat_level_color(l: Level) -> Color32 { match l { Level::Fail => BAD, Level::Warn => WARN, Level::Info => Color32::from_rgb(0x6F, 0xA8, 0xDC), Level::Pass => OK } }
}
