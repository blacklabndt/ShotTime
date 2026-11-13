//! The interpreter's review of possible-indication marks: for each mark "indication" (with a type) or "not an
//! indication", plus indications added by hand that the finder missed. Kept in a separate review file beside the
//! new files, keyed by SOP Instance UID. Never written into a DICONDE file. It records what a person judged, so it
//! can later measure the finder on real plates and teach it; it is not an acceptance record.

use crate::indications::{Indication, NAMES};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const FILE_NAME: &str = "WeldScope-indication-review.json";
/// Types offered when confirming an indication. Free text is also accepted in the file.
pub const TYPES: [&str; 12] = ["porosity", "slag", "tungsten", "undercut", "lack of penetration", "lack of fusion", "crack", "burn-through", "concavity", "excess penetration", "hi-lo", "other"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Verdict { #[default] Unreviewed, Indication, NotIndication }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Mark {
    pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64,
    /// The finder's score (0 for a mark added by hand) and its guess at the type.
    pub score: f32, pub guess: String,
    /// Added by the interpreter, not by the finder.
    pub manual: bool,
    pub verdict: Verdict,
    /// The type the interpreter chose (only for indications).
    pub kind: String,
}
impl Mark {
    pub fn judged(&self) -> bool { self.manual || self.verdict != Verdict::Unreviewed }
    fn overlap(&self, o: &Mark) -> f64 {
        let (w, h) = ((self.x1.min(o.x1) - self.x0.max(o.x0)).max(0.0), (self.y1.min(o.y1) - self.y0.max(o.y0)).max(0.0));
        let (a, b) = ((self.x1 - self.x0) * (self.y1 - self.y0), (o.x1 - o.x0) * (o.y1 - o.y0));
        if a + b - w * h <= 0.0 { 0.0 } else { w * h / (a + b - w * h) }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Review {
    pub file: String, pub sop: String, pub weld: String,
    pub cols: usize, pub rows: usize, pub px_mm: f64,
    /// Sensitivity (1 to 5) the marks were looked at with, and whether the finder has run on this image.
    pub sensitivity: u8, pub searched: bool,
    /// Weld band drawn by the interpreter (boxes x0, y0, x1, y1), if any.
    pub band: Vec<[f64; 4]>,
    pub marks: Vec<Mark>,
    pub updated: String,
}
impl Review {
    /// Takes a fresh finder result: marks already judged (and marks added by hand) stay as they are; unjudged
    /// finder marks are replaced by the new candidates, leaving out any that repeat a judged mark.
    pub fn merge_found(&mut self, items: &[Indication]) {
        self.marks.retain(|m| m.judged());
        let judged = self.marks.len(); // only calls already made hide a candidate; candidates never hide each other
        for it in items {
            let m = Mark { x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, score: it.score, guess: NAMES.get(it.class).copied().unwrap_or("").to_string(), ..Default::default() };
            if self.marks[..judged].iter().any(|j| !j.manual && j.overlap(&m) > 0.5) { continue; }
            self.marks.push(m);
        }
        self.searched = true;
    }
    /// Marks to show at a score cut-off, strongest first, marks added by hand last: every judged mark, and
    /// unjudged ones above the cut-off.
    pub fn shown(&self, cut: f32) -> Vec<usize> {
        let mut v: Vec<usize> = (0..self.marks.len()).filter(|&i| self.marks[i].judged() || self.marks[i].score > cut).collect();
        v.sort_by(|&a, &b| self.marks[a].manual.cmp(&self.marks[b].manual).then(self.marks[b].score.partial_cmp(&self.marks[a].score).unwrap_or(std::cmp::Ordering::Equal)));
        v
    }
    /// (indications, not indications, still to look at) among the marks shown at a cut-off.
    pub fn counts(&self, cut: f32) -> (usize, usize, usize) {
        let s = self.shown(cut);
        let n = |v: Verdict| s.iter().filter(|&&i| self.marks[i].verdict == v).count();
        (n(Verdict::Indication), n(Verdict::NotIndication), n(Verdict::Unreviewed))
    }
    pub fn worth_saving(&self) -> bool { self.marks.iter().any(|m| m.judged()) }
    /// What goes into the review file: the marks shown at the cut-off (an unjudged mark below it was never seen).
    pub fn for_file(&self, cut: f32) -> Review { let keep = self.shown(cut); Review { marks: keep.iter().map(|&i| self.marks[i].clone()).collect(), ..self.clone() } }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewFile { pub version: u32, pub about: String, #[serde(default)] pub reviews: BTreeMap<String, Review> }
impl Default for ReviewFile {
    fn default() -> Self { ReviewFile { version: 1, about: "WeldScope possible-indication review. Each mark is a spot the finder pointed at or the interpreter added, with the interpreter's call: indication (and type) or not an indication. Coordinates are pixels of the DICONDE file with that SOP Instance UID. Not an acceptance record.".into(), reviews: BTreeMap::new() } }
}

/// Reads a review file. A missing file is an empty one; a file that cannot be understood is an error, so it is
/// never silently replaced.
pub fn load(path: &Path) -> Result<ReviewFile, String> {
    if !path.exists() { return Ok(ReviewFile::default()); }
    let b = std::fs::read(path).map_err(|e| format!("The review file could not be read ({e}): {}", path.display()))?;
    let f: ReviewFile = serde_json::from_slice(&b).map_err(|_| format!("The review file is damaged and was left alone: {}", path.display()))?;
    if f.version != 1 { return Err(format!("The review file was written by a newer WeldScope and was left alone: {}", path.display())); }
    Ok(f)
}
/// Writes the review file: to a temporary file first, then moved into place, so a failure leaves the old one.
pub fn save(path: &Path, f: &ReviewFile) -> Result<(), String> {
    if let Some(d) = path.parent() { std::fs::create_dir_all(d).map_err(|e| format!("The folder for the review file could not be made ({e})."))?; }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(f).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| { let _ = std::fs::remove_file(&tmp); format!("The review could not be saved ({e}): {}", path.display()) })
}
