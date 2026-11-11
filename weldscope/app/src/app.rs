//! Application state, background jobs, opening, undo, saving and the window layout.

use eframe::egui::{self, Color32, RichText};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use weldscope_core::compat::{self, Check, CheckOptions, Level};
use weldscope_core::copy::{self, CopyState, PartInfo, SplitOptions};
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

pub struct FileEntry { pub shot: Shot, pub work: Work, pub dirty: bool, pub saved_key: String, pub thumb: Option<egui::TextureHandle>, pub thumb_queued: bool, pub view_rot: u32 }
impl FileEntry {
    pub fn state_key(&self) -> String { format!("{}:{}:{}", self.work.ops.len(), self.work.ops.join("|"), self.shot.orig_els.keys().cloned().collect::<Vec<_>>().join(",")) }
    pub fn has_changes(&self) -> bool { !self.work.ops.is_empty() || !self.shot.orig_els.is_empty() }
    pub fn refresh_dirty(&mut self) { self.dirty = self.has_changes() && self.state_key() != self.saved_key; }
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Mode { Edit, Organize }
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Tab { Metadata, Image, Crop, Overlay, Changes }
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tool { Pan, Window, Crop, Region, Scratch }

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
}
impl Default for Prefs {
    fn default() -> Self { Prefs { show_files: true, show_tools: true, tab: Tab::Metadata, overlay: OverlaySettings::default(), templates: BTreeMap::new(), group_tag: 0x0008103E, last_folder: String::new() } }
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

pub type Apply = Box<dyn FnOnce(&mut App, &egui::Context) + Send>;
pub struct Job { pub label: String, pub rx: Receiver<Apply>, pub started: Instant }

pub enum Dialog { Close }

pub struct MetaUi { pub all: bool, pub filter: String, pub edits: BTreeMap<String, String>, pub errors: BTreeMap<String, String>, pub add_tag: String, pub add_vr: String, pub add_value: String, pub add_error: String, pub tpl_name: String, pub tpl_sel: String }
impl Default for MetaUi { fn default() -> Self { MetaUi { all: false, filter: String::new(), edits: BTreeMap::new(), errors: BTreeMap::new(), add_tag: String::new(), add_vr: "LO".into(), add_value: String::new(), add_error: String::new(), tpl_name: String::new(), tpl_sel: String::new() } } }

pub struct OrgState { pub sel: BTreeSet<u64>, pub pending: BTreeMap<u32, String>, pub removals: BTreeSet<u32>, pub undo: Vec<(Vec<shots::ShotSnap>, String)>, pub redo: Vec<(Vec<shots::ShotSnap>, String)>, pub anchor: Option<u64>, pub errors: Vec<String>, pub result: String, pub renumber_start: usize }
impl Default for OrgState { fn default() -> Self { OrgState { sel: BTreeSet::new(), pending: BTreeMap::new(), removals: BTreeSet::new(), undo: vec![], redo: vec![], anchor: None, errors: vec![], result: String::new(), renumber_start: 1 } } }

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
    pub compare: bool,
    pub compat: Option<CompatResult>,
    pub texture: Option<egui::TextureHandle>,
    pub tex_key: String,
    pub logo: Option<egui::TextureHandle>,
    pub toast: Option<(String, bool, Instant)>,
    pub job: Option<Job>,
    pub queue: Vec<(String, Box<dyn FnOnce() -> Apply + Send>)>,
    pub thumb_tx: Sender<(u64, egui::ColorImage, u32)>,
    pub thumb_rx: Receiver<(u64, egui::ColorImage, u32)>,
    pub thumbs_running: usize,
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
        let mut app = App {
            entries: vec![], folder: String::new(), cur: None, next_id: 1, mode: Mode::Edit, prefs, tool: Tool::Pan, ts: ToolSettings::default(), view: View::default(),
            view_rot: 0, view_rot_industrex: false, invert_view: false, edge: EdgeSettings::default(), edge_cache: None, raw_win: None, raw_auto_width: None, scratches: vec![],
            compare: false, compat: None, texture: None, tex_key: String::new(), logo, toast: None, job: None, queue: vec![], thumb_tx, thumb_rx, thumbs_running: 0,
            meta: MetaUi::default(), org: OrgState::default(), dialog: None, allow_close: false, drag: None, probe: String::new(), edge_pending: false,
        };
        if !args.is_empty() {
            let mut files = Vec::new();
            for a in args { if a.is_dir() { files.extend(Self::dicom_files_in(&a)); app.folder = a.to_string_lossy().into(); } else { files.push(a); } }
            app.add_paths(files, true, false);
        }
        app
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
            let files = Self::dicom_files_in(&dir);
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
    pub fn add_paths(&mut self, paths: Vec<PathBuf>, open_first: bool, replace: bool) {
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
                if replace { app.leave_current(); app.entries.clear(); app.cur = None; app.org = OrgState::default(); app.compat = None; }
                let mut first = None;
                let mut added = 0;
                for mut s in ok {
                    if app.entries.iter().any(|e| (!s.path.is_empty() && e.shot.path == s.path) || (e.shot.name == s.name && d::get_string(&e.shot.orig.ds, 0x00080018) == d::get_string(&s.orig.ds, 0x00080018))) { continue; }
                    s.id = app.next_id; app.next_id += 1;
                    if first.is_none() { first = Some(s.id); }
                    app.entries.push(FileEntry { shot: s, work: Work::default(), dirty: false, saved_key: String::new(), thumb: None, thumb_queued: false, view_rot: 0 });
                    added += 1;
                }
                if !bad.is_empty() {
                    let msg = if bad.len() == 1 && added == 0 { format!("Could not open {}", bad[0]) } else { format!("{} file(s) could not be read: {}", bad.len(), bad.iter().take(3).cloned().collect::<Vec<_>>().join("; ")) };
                    app.error(msg);
                } else if added > 1 { app.toast(format!("Added {added} files.")); }
                if open_first { if let Some(id) = first { app.open_entry(id); } }
            })
        });
    }

    /// The file being left keeps its unsaved work; its pixels are dropped when it has no image steps.
    pub fn leave_current(&mut self) {
        if let Some(e) = self.cur_mut() {
            if e.work.ops.is_empty() && !e.work.undo.iter().chain(&e.work.redo).any(|s| matches!(s, Step::Image { .. })) { e.work.img = None; e.work.orig_img = None; e.work.loaded = false; }
        }
        self.edge.on = false; self.edge_cache = None; self.raw_win = None; self.raw_auto_width = None; self.scratches.clear(); self.compare = false; self.drag = None;
        self.meta.edits.clear(); self.meta.errors.clear();
    }

    pub fn open_entry(&mut self, id: u64) {
        if self.cur == Some(id) && self.cur().map_or(false, |e| e.work.loaded) { self.mode = Mode::Edit; return; }
        self.leave_current();
        self.cur = Some(id);
        self.mode = Mode::Edit;
        self.compat = None;
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
        else if self.edge.on { let e = self.edge_frame(); let w = im::auto_window(&e[..], sl, ic, 0.5, 99.8, None); Win { c: w.center, w: w.width } }
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
        // Thresholds scale with the image's useful exposure range (the width of its automatic window).
        Some(im::EdgeParams { global_contrast: e.gc, detail_contrast: e.dc, sharpness: e.sh, noise_reduction: e.nr, kernel_px: e.mm / self.pixel_spacing_mm(), padding: img.padding,
            despeckle: e.ds, white_sign: if img.monochrome1() { -1.0 } else { 1.0 }, despeckle_threshold: if e.ds { 0.3 * raw } else { 0.0 }, detail_limit: 0.35 * raw, kg: None, kd: None, ks: None })
    }
    fn edge_key(&self, p: &im::EdgeParams, img: &ImgRef, f: usize) -> String { format!("{:p}:{f}:{p:?}", Arc::as_ptr(img)) }
    /// The enhanced current frame (computed on this thread if not cached; the UI computes it in a job first).
    pub fn edge_frame(&mut self) -> Arc<Vec<f32>> {
        let (img, f) = self.frame_data().unwrap();
        let p = self.edge_params().unwrap();
        let key = self.edge_key(&p, &img, f);
        if let Some((k, v)) = &self.edge_cache { if *k == key { return v.clone(); } }
        let v = Arc::new(im::edge_enhance(&img.frames[f], img.cols, img.rows, &p).0);
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
        self.run("Enhancing…", move || {
            let v = Arc::new(im::edge_enhance(&img.frames[f], img.cols, img.rows, &p).0);
            let w = im::auto_window(&v[..], img.slope, img.intercept, 0.5, 99.8, None);
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
        self.run("Applying the enhancement…", move || {
            let frames: Vec<Vec<i32>> = img.frames.iter().enumerate().map(|(fi, a)| {
                let fv = if fi == f { cur.clone() } else { Arc::new(im::edge_enhance(a, img.cols, img.rows, &p).0) };
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
        self.scratches.clear(); self.raw_auto_width = None; self.edge_cache = None;
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
        self.scratches.clear(); self.raw_auto_width = None; self.edge_cache = None;
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
        if let Some(t) = r { self.push_meta(snap, t); }
        Ok(())
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
                app.toast(format!("{text}. Undo is available."));
            })
        });
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
    pub fn auto_split(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        let (sens, margin, rot) = (self.ts.sens, self.ts.margin, self.view_rot);
        self.run("Finding film pieces…", move || {
            let mut found = im::find_pieces(&img.frames[f], img.cols, img.rows, &im::PieceOptions { sensitivity: sens, margin, padding: img.padding, ..Default::default() });
            // Number pieces as they appear on screen: left to right, then top to bottom.
            let key = |r: &Region| { let q = im::rect_to_view(r.rect, img.cols as f64, img.rows as f64, rot); ((q.1 / 50.0).round() as i64, q.0) };
            found.sort_by(|a, b| { let (ka, kb) = (key(a), key(b)); ka.0.cmp(&kb.0).then(ka.1.partial_cmp(&kb.1).unwrap()) });
            let lv = im::plate_levels(&img.frames[f], img.cols, img.rows, img.padding, 0.6);
            let fill = img.padding.unwrap_or(im::js_round(lv.sign * lv.bg) as i32);
            let items: Vec<RegionItem> = found.iter().enumerate().map(|(i, r)| {
                let mut fr = im::crop_frame(&img.frames[f], img.cols, r.rect);
                im::fill_outside_cuts(&mut fr, r, fill);
                RegionItem { region: r.clone(), label: (i + 1).to_string(), tilt: Some(im::piece_tilt(&fr, r.rect.w as usize, r.rect.h as usize, &lv).angle) }
            }).collect();
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
    /// One piece of film (the largest found): straighten and crop to the film, as one undoable step.
    pub fn auto_straighten(&mut self) {
        let Some((img, f)) = self.frame_data() else { return };
        self.run("Straightening…", move || {
            let pieces = im::find_pieces(&img.frames[f], img.cols, img.rows, &im::PieceOptions { padding: img.padding, ..Default::default() });
            let r = pieces.iter().max_by_key(|p| p.rect.w * p.rect.h).map(|p| im::straighten_piece(&img, p, None, 5.0, 0.02, 0));
            let n = pieces.len();
            let same = |s: &im::Straightened| s.img.cols == img.cols && s.img.rows == img.rows && !s.rotated;
            let r = r.map(|x| x.map(|s| { let unchanged = same(&s); (s, unchanged) }));
            Box::new(move |app: &mut App, _: &egui::Context| match r {
                None => app.error("No film found to straighten."),
                Some(Err(m)) => app.error(m),
                Some(Ok((_, true))) => app.toast("The film is already straight and fills the image."),
                Some(Ok((s, false))) => {
                    let text = format!("{} to the film: {}×{}", if s.rotated { format!("Straightened {:.2}° (bicubic resampling) and cropped", s.angle) } else { "Cropped".into() }, s.img.cols, s.img.rows);
                    if let Some(e) = app.cur_mut() { e.work.crop = None; e.work.regions.clear(); }
                    let steep = s.too_steep;
                    let measured = s.measured;
                    app.push_image(s.img, text.clone(), 0);
                    app.toast(format!("{text}{}{}", if steep { format!(" (tilt {measured:.1}° is over 5°, so it was not rotated)") } else { String::new() },
                        if n > 1 { format!(". {n} pieces were found; for all of them use Find film pieces and Save split files.") } else { ".".into() }));
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
        if let Some(dir) = self.dir_of(near) { dlg = dlg.set_directory(dir); }
        dlg.save_file()
    }

    pub fn copy_state<'a>(&'a self, e: &'a FileEntry, store_window: bool, j2k: bool) -> CopyState<'a> {
        let w = &e.work;
        CopyState { file: &e.shot.file, orig: &e.shot.orig, img: w.img.as_deref(), ops: &w.ops, turns: w.turns, orig_els: &e.shot.orig_els,
            store_window: if store_window && w.img.is_some() { Some((w.win.c, w.win.w)) } else { None }, j2k }
    }
    pub fn want_j2k(&self) -> bool { self.ts.save_j2k && self.img().map_or(false, |i| i.bits_allocated <= 16) }

    pub fn save_copy(&mut self) {
        let Some(i) = self.cur_idx() else { return };
        let e = &self.entries[i];
        let name = format!("{}_edited.dcm", base_name(&e.shot.name));
        let Some(path) = self.save_dialog(&name, ("DICONDE", &["dcm"]), &e.shot.path.clone()) else { self.toast("Not saved."); return };
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
                let res = d::write(&b.file).map_err(|e| e.0).and_then(|bytes| std::fs::write(&path, &bytes).map(|_| bytes).map_err(|e| e.to_string()));
                let checks = res.as_ref().ok().map(|bytes| compat::check(bytes, Some(&orig), &CheckOptions { removed: b.removed.clone(), edited: b.edited.clone(), pixels_changed: b.pixels_changed, xml_tag: d::industrex_info(&orig.ds).and_then(|x| x.xml_tag) }));
                Box::new(move |app: &mut App, _: &egui::Context| match res {
                    Err(m) => app.error(format!("Not saved: {m}")),
                    Ok(bytes) => {
                        let mut extra = String::new();
                        if !b.removed.is_empty() { extra += &format!(" Left out {} element(s) that described the original pixels.", b.removed.len()); }
                        if !b.synced.is_empty() { extra += &format!(" Updated {} field(s) in INDUSTREX's XML copy.", b.synced.len()); }
                        if let Some(i) = app.idx(id) { let e = &mut app.entries[i]; e.saved_key = key; e.shot.saved_as = path.to_string_lossy().into(); e.refresh_dirty(); }
                        app.toast(format!("Saved {} ({}). The original file is unchanged.{extra}", path.display(), fmt_mb(bytes.len())));
                        app.show_compat(path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), checks.unwrap_or_default());
                    }
                })
            }),
        }
    }
    pub fn show_compat(&mut self, name: String, checks: Vec<Check>) {
        let s = compat::summary(&checks);
        if s.fail > 0 { self.error(format!("INDUSTREX compatibility check found {} problem(s) in the saved copy. See the Changes tab.", s.fail)); }
        self.compat = Some(CompatResult { name, checks });
    }

    pub fn save_split(&mut self) {
        let Some(i) = self.cur_idx() else { return };
        if self.entries[i].work.regions.is_empty() || self.entries[i].work.img.is_none() { return; }
        let Some(dir) = self.pick_folder("Choose a folder for the split files", &self.entries[i].shot.path.clone()) else { self.toast("Not saved."); return };
        let j2k = self.want_j2k();
        let split = SplitOptions { straighten: self.ts.straighten, fill_slivers: self.ts.fill };
        let target = self.ts.label_target;
        let series = d::new_uid();
        let e = &self.entries[i];
        let base = base_name(&e.shot.name);
        let n = e.work.regions.len();
        let orig = e.shot.orig.clone();
        let file = e.shot.file.clone();
        let img = e.work.img.clone();
        let ops = e.work.ops.clone();
        let turns = e.work.turns;
        let orig_els = e.shot.orig_els.clone();
        let regions = e.work.regions.clone();
        let originals = self.originals();
        self.run(if j2k { "Compressing JPEG 2000 and saving parts…" } else { "Saving parts…" }, move || {
            let mut written = Vec::new();
            let mut problems = 0;
            let mut err = None;
            for (k, r) in regions.iter().enumerate() {
                let label = { let l = r.label.trim(); if l.is_empty() { (k + 1).to_string() } else { l.to_string() } };
                let part = PartInfo { series: series.clone(), index: k + 1, text: format!("Split part {} of {n} ({}×{} at {},{})", k + 1, r.region.rect.w, r.region.rect.h, r.region.rect.x, r.region.rect.y) };
                let st = CopyState { file: &file, orig: &orig, img: img.as_deref(), ops: &ops, turns, orig_els: &orig_els, store_window: None, j2k };
                let res = copy::build_copy(&st, Some(&r.region), Some(&part), split).and_then(|mut b| {
                    if target == 1 { b.file.ds.set_text(0x00204000, &label, Some("LT")).map_err(|e| e.0)?; }
                    if target == 2 {
                        let id = b.file.ds.string(0x00100020);
                        let next = if id.is_empty() { label.clone() } else { format!("{id}-{label}") };
                        if let Some(m) = d::validate("LO", &next) { return Err(format!("Part {}: Component ID “{next}” — {m}", k + 1)); }
                        b.file.ds.set_text(0x00100020, &next, None).map_err(|e| e.0)?;
                    }
                    let bytes = d::write(&b.file).map_err(|e| e.0)?;
                    let safe: String = label.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect();
                    let path = App::unique_path(&dir, &format!("{base}_{safe}.dcm"));
                    if originals.contains(&path) { return Err("would overwrite an original".into()); }
                    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                    let checks = compat::check(&bytes, Some(&orig), &CheckOptions { removed: b.removed.clone(), edited: b.edited.clone(), pixels_changed: true, ..Default::default() });
                    if compat::summary(&checks).fail > 0 { problems += 1; }
                    Ok(path)
                });
                match res { Ok(p) => written.push(p), Err(m) => { err = Some(m); break; } }
            }
            Box::new(move |app: &mut App, _: &egui::Context| {
                if let Some(m) = err { app.error(format!("Stopped after {} part(s): {m}", written.len())); return; }
                if problems > 0 { app.error(format!("Saved {} files in {}, but the INDUSTREX check found problems in {problems}.", written.len(), dir.display())); }
                else { app.toast(format!("Saved {} files in {} (all passed the INDUSTREX check). The original file is unchanged.", written.len(), dir.display())); }
            })
        });
    }

    /// Saves a new copy of every edited file: files with image steps are saved with them (as Save copy would),
    /// the rest as metadata-only copies. Never overwrites originals or existing files.
    pub fn save_all_edited(&mut self) {
        let edited: Vec<usize> = (0..self.entries.len()).filter(|&i| self.entries[i].dirty).collect();
        if edited.is_empty() { self.toast("No files with unsaved changes."); return; }
        let near = self.entries[edited[0]].shot.path.clone();
        let Some(dir) = self.pick_folder("Choose a folder for the edited copies", &near) else { self.toast("Not saved."); return };
        let names = shots::copy_names(&edited.iter().map(|&i| self.entries[i].shot.name.as_str()).collect::<Vec<_>>());
        struct Item { id: u64, name: String, key: String, orig: Arc<DicomFile>, built: Result<copy::BuiltCopy, String> }
        let mut items = Vec::new();
        for (k, &i) in edited.iter().enumerate() {
            let e = &self.entries[i];
            let j2k = e.work.decoded && e.work.img.as_ref().map_or(false, |m| m.bits_allocated <= 16);
            let built = copy::build_copy(&self.copy_state(e, false, j2k), None, None, SplitOptions::default());
            items.push(Item { id: e.shot.id, name: names[k].clone(), key: e.state_key(), orig: e.shot.orig.clone(), built });
        }
        let originals = self.originals();
        self.run(format!("Saving {} copies…", items.len()), move || {
            let mut done: Vec<(u64, String, PathBuf)> = Vec::new();
            let mut failed = Vec::new();
            let mut problems = 0;
            for it in items {
                let r = it.built.and_then(|b| {
                    let bytes = d::write(&b.file).map_err(|e| e.0)?;
                    let path = App::unique_path(&dir, &it.name);
                    if originals.contains(&path) { return Err("would overwrite an original".into()); }
                    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                    let checks = compat::check(&bytes, Some(&it.orig), &CheckOptions { removed: b.removed.clone(), edited: b.edited.clone(), pixels_changed: b.pixels_changed, xml_tag: d::industrex_info(&it.orig.ds).and_then(|x| x.xml_tag) });
                    if compat::summary(&checks).fail > 0 { problems += 1; }
                    Ok(path)
                });
                match r { Ok(p) => done.push((it.id, it.key, p)), Err(m) => failed.push(format!("{}: {m}", it.name)) }
            }
            Box::new(move |app: &mut App, _: &egui::Context| {
                for (id, key, p) in &done { if let Some(i) = app.idx(*id) { let e = &mut app.entries[i]; e.saved_key = key.clone(); e.shot.saved_as = p.to_string_lossy().into(); e.refresh_dirty(); } }
                let msg = format!("Saved {} cop{} to {}{}{}", done.len(), if done.len() == 1 { "y" } else { "ies" }, dir.display(),
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
            let (id, file, tx) = (self.entries[i].shot.id, self.entries[i].shot.orig.clone(), self.thumb_tx.clone());
            std::thread::spawn(move || { let (img, rot) = crate::export_img::thumbnail(&file); let _ = tx.send((id, img, rot)); });
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
            if s && self.cur.is_some() && self.mode == Mode::Edit { self.save_copy(); }
        }

        self.top_bar(ctx);
        self.status_bar(ctx);
        let busy = self.busy();
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
                    egui::Frame::popup(ui.style()).inner_margin(16.0).show(ui, |ui| { ui.horizontal(|ui| { ui.spinner(); ui.label(RichText::new(&job.label).size(15.0)); }); });
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
            ui.add_enabled_ui(!self.busy(), |ui| {
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
                    let save = egui::Button::new(RichText::new("Save copy").strong().color(if dirty { Color32::BLACK } else { ui.visuals().text_color() })).fill(if dirty { ACCENT } else { ui.visuals().widgets.inactive.weak_bg_fill });
                    if ui.add_enabled(has, save).on_hover_text("Write a new file; the original is never changed (Ctrl+S)").clicked() { self.save_copy(); }
                    ui.add_enabled_ui(has && self.img().is_some(), |ui| {
                        ui.menu_button("Export", |ui| {
                            if ui.button("PNG image (as displayed)").clicked() { ui.close_menu(); self.export("png"); }
                            if ui.button("TIFF (raw pixel values)").clicked() { ui.close_menu(); self.export("tiff"); }
                            if ui.button("PDF report").clicked() { ui.close_menu(); self.export("pdf"); }
                        });
                    });
                    if self.any_dirty() {
                        let n = self.entries.iter().filter(|e| e.dirty).count();
                        ui.label(RichText::new(format!("● {n} unsaved")).color(ACCENT)).on_hover_text("Files with changes not saved as a copy yet");
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
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
