//! Possible indications: a small finder network lists candidate spots, a second network scores each close crop,
//! and a weld band finder keeps only what lies in the weld. The result is a ranked list for the interpreter to
//! review. It is not a measurement and never an acceptance decision, and it never changes the file.
//!
//! Ported from tools/defect-finder (rank.py, band.py, swrd_train.py, stage2.py); read its README before changing
//! anything here. The network weights are not part of the repository: they are read from a model file at run time.

use crate::imaging as im;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

pub const NAMES: [&str; 7] = ["", "porosity", "slag", "undercut", "lack of penetration", "lack of fusion", "crack"];
/// The networks were trained at about this pixel size; other spacings are resampled to it first.
pub const MODEL_PX_MM: f64 = 0.1;
/// Score cut-offs for sensitivity levels 1 (fewest marks) to 5 (most). On the held-out reference films these left
/// about 1, 2, 5, 10 and 20 marks per film that were not on a marked indication.
pub const CUTS: [f32; 5] = [0.68, 0.52, 0.31, 0.18, 0.10];

// ---------------------------------------------------------------- model file
struct Conv { cin: usize, cout: usize, k: usize, stride: usize, dil: usize, w: Vec<f32>, b: Vec<f32> }
pub struct Models { finder: Vec<Conv>, head: Conv, namer: Vec<Conv>, fc_w: Vec<f32>, fc_b: Vec<f32>, classes: usize }

const MAGIC: &[u8; 8] = b"WSIND001";
const FINDER_LAYOUT: [(usize, usize); 8] = [(2, 1), (1, 1), (2, 1), (1, 1), (2, 1), (1, 1), (1, 2), (1, 2)];

/// Reads a model file written by tools/defect-finder/export_weights.py (batch norm already folded in).
pub fn load_models(bytes: &[u8]) -> Result<Models, String> {
    if bytes.len() < 12 || &bytes[..8] != MAGIC { return Err("This is not a WeldScope indication model file.".into()); }
    let u32_at = |p: usize| -> Result<usize, String> { bytes.get(p..p + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).ok_or_else(|| "The model file is cut short.".to_string()) };
    let n = u32_at(8)?;
    let mut p = 12;
    let mut tensors: Vec<(Vec<usize>, Vec<f32>)> = Vec::new();
    for _ in 0..n {
        let nd = u32_at(p)?; p += 4;
        if nd > 4 { return Err("The model file is damaged.".into()); }
        let mut dims = Vec::new();
        for _ in 0..nd { dims.push(u32_at(p)?); p += 4; }
        let len: usize = dims.iter().product();
        let raw = bytes.get(p..p + len * 4).ok_or("The model file is cut short.")?; p += len * 4;
        tensors.push((dims, raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()));
    }
    if tensors.len() != 36 { return Err("The model file has an unexpected layout.".into()); }
    let mut it = tensors.into_iter();
    let mut conv = |stride: usize, dil: usize, k: usize| -> Result<Conv, String> {
        let (d, w) = it.next().unwrap(); let (bd, b) = it.next().unwrap();
        if d.len() != 4 || d[2] != k || d[3] != k || bd != vec![d[0]] { return Err("The model file has an unexpected layout.".into()); }
        Ok(Conv { cin: d[1], cout: d[0], k, stride, dil, w, b })
    };
    let mut finder = Vec::new();
    for (s, d) in FINDER_LAYOUT { finder.push(conv(s, d, 3)?); }
    let head = conv(1, 1, 1)?;
    let mut namer = Vec::new();
    for _ in 0..8 { namer.push(conv(1, 1, 3)?); }
    let (fd, fc_w) = it.next().unwrap(); let (_, fc_b) = it.next().unwrap();
    let chain_ok = finder.windows(2).all(|p| p[0].cout == p[1].cin) && namer.windows(2).all(|p| p[0].cout == p[1].cin) && finder[0].cin == 1 && namer[0].cin == 1 && head.cin == finder[7].cout;
    if !chain_ok || fd.len() != 2 || fd[1] != namer[7].cout || fd[0] != head.cout || fc_b.len() != fd[0] || head.cout < 2 { return Err("The model file has an unexpected layout.".into()); }
    Ok(Models { classes: head.cout, finder, head, namer, fc_w, fc_b })
}

// ---------------------------------------------------------------- network arithmetic
#[inline]
fn axpy(o: &mut [f32], a: &[f32], w: f32) {
    #[cfg(target_arch = "x86_64")]
    { if std::is_x86_feature_detected!("avx2") && std::is_x86_feature_detected!("fma") { unsafe { return axpy_avx(o, a, w) } } }
    for (o, a) in o.iter_mut().zip(a) { *o += w * *a; }
}
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn axpy_avx(o: &mut [f32], a: &[f32], w: f32) { for (o, a) in o.iter_mut().zip(a) { *o = a.mul_add(w, *o); } }

/// Convolution with zero padding (padding = dilation for 3x3, none for 1x1), then ReLU if asked. Planes are CHW.
fn conv(c: &Conv, x: &[f32], h: usize, w: usize, relu: bool) -> (Vec<f32>, usize, usize) {
    let (s, d) = (c.stride as i64, c.dil as i64);
    let (oh, ow) = ((h - 1) / c.stride + 1, (w - 1) / c.stride + 1);
    let mut out = vec![0f32; c.cout * oh * ow];
    let half = (c.k / 2) as i64;
    for co in 0..c.cout {
        let plane = &mut out[co * oh * ow..(co + 1) * oh * ow];
        plane.fill(c.b[co]);
        for oy in 0..oh {
            let orow = &mut plane[oy * ow..(oy + 1) * ow];
            for ci in 0..c.cin {
                let xin = &x[ci * h * w..(ci + 1) * h * w];
                for ky in 0..c.k {
                    let iy = oy as i64 * s + (ky as i64 - half) * d;
                    if iy < 0 || iy >= h as i64 { continue; }
                    let irow = &xin[iy as usize * w..(iy as usize + 1) * w];
                    for kx in 0..c.k {
                        let wv = c.w[((co * c.cin + ci) * c.k + ky) * c.k + kx];
                        let dx = (kx as i64 - half) * d;
                        let lo = if dx < 0 { ((-dx + s - 1) / s) as usize } else { 0 };
                        let hi = (((w as i64 - 1 - dx) / s + 1).max(0) as usize).min(ow);
                        if lo >= hi { continue; }
                        if s == 1 { axpy(&mut orow[lo..hi], &irow[(lo as i64 + dx) as usize..(hi as i64 + dx) as usize], wv); }
                        else { for ox in lo..hi { orow[ox] += wv * irow[(ox as i64 * s + dx) as usize]; } }
                    }
                }
            }
        }
    }
    if relu { for v in out.iter_mut() { if *v < 0.0 { *v = 0.0; } } }
    (out, oh, ow)
}

fn threads() -> usize { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).min(16) }
/// Runs `work(i)` for i in 0..n on all cores and returns the results in order.
fn par_map<T: Send>(n: usize, work: impl Fn(usize) -> T + Sync) -> Vec<T> {
    let next = AtomicUsize::new(0);
    let out: Mutex<Vec<(usize, T)>> = Mutex::new(Vec::with_capacity(n));
    std::thread::scope(|sc| {
        for _ in 0..threads().min(n.max(1)) {
            sc.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= n { break; }
                let r = work(i);
                out.lock().unwrap().push((i, r));
            });
        }
    });
    let mut v = out.into_inner().unwrap();
    v.sort_by_key(|p| p.0);
    v.into_iter().map(|p| p.1).collect()
}

fn reflect(i: i64, n: i64) -> usize { if n == 1 { return 0; } let mut i = i; loop { if i < 0 { i = -i; } else if i >= n { i = 2 * (n - 1) - i; } else { return i as usize; } } }
/// Gaussian blur as the training code did it: kernel out to four sigma, mirrored edges.
fn blur(a: &[f32], w: usize, h: usize, sigma: f64) -> Vec<f32> {
    let r = ((((sigma * 8.0 + 1.0).round() as i64) | 1) / 2).max(1);
    let mut k: Vec<f32> = (-r..=r).map(|i| (-((i * i) as f64) / (2.0 * sigma * sigma)).exp() as f32).collect();
    let sum: f32 = k.iter().sum();
    for v in k.iter_mut() { *v /= sum; }
    let band = 64usize;
    let rows = |src: &[f32], horizontal: bool| -> Vec<f32> {
        let parts = par_map((h + band - 1) / band, |b| {
            let (y0, y1) = (b * band, ((b + 1) * band).min(h));
            let mut o = vec![0f32; (y1 - y0) * w];
            for y in y0..y1 {
                let orow = &mut o[(y - y0) * w..(y - y0 + 1) * w];
                if horizontal {
                    let row = &src[y * w..(y + 1) * w];
                    for (x, ov) in orow.iter_mut().enumerate() {
                        let mut acc = 0f32;
                        if x as i64 >= r && x as i64 + r < w as i64 { for (kv, v) in k.iter().zip(&row[x - r as usize..=x + r as usize]) { acc += kv * v; } }
                        else { for (j, kv) in k.iter().enumerate() { acc += kv * row[reflect(x as i64 + j as i64 - r, w as i64)]; } }
                        *ov = acc;
                    }
                } else {
                    for (j, kv) in k.iter().enumerate() { let yy = reflect(y as i64 + j as i64 - r, h as i64); axpy(orow, &src[yy * w..(yy + 1) * w], *kv); }
                }
            }
            o
        });
        parts.concat()
    };
    let t = rows(a, true);
    rows(&t, false)
}

/// The finder's view of a plate: grey levels below or above the surroundings, in fixed steps (real contrast kept).
fn local_norm(g: &[u8], w: usize, h: usize) -> Vec<f32> {
    let a: Vec<f32> = g.iter().map(|&v| v as f32).collect();
    let m = blur(&a, w, h, 20.0);
    a.iter().zip(&m).map(|(a, m)| ((a - m) / 8.0).clamp(-6.0, 6.0)).collect()
}

const TILE: usize = 512;
const MARGIN: usize = 64; // more than half the finder's field of view (107 px), so tiles join without a seam

/// "Something here" map on an 8-pixel grid: 1 − P(nothing). Returns (map, grid width, grid height).
pub fn finder_map(m: &Models, g: &[u8], w: usize, h: usize, progress: &(dyn Fn(f32) + Sync)) -> (Vec<f32>, usize, usize) {
    let norm = local_norm(g, w, h);
    let (pw, ph) = ((w + 7) / 8 * 8, (h + 7) / 8 * 8);
    let mut x = vec![0f32; pw * ph];
    for y in 0..ph { let sy = reflect(y as i64, h as i64); for xx in 0..pw { x[y * pw + xx] = norm[sy * w + reflect(xx as i64, w as i64)]; } }
    let (gw, gh) = (pw / 8, ph / 8);
    let mut tiles = Vec::new();
    for ty in (0..ph).step_by(TILE) { for tx in (0..pw).step_by(TILE) { tiles.push((tx, ty)); } }
    let done = AtomicUsize::new(0);
    let parts = par_map(tiles.len(), |i| {
        let (tx, ty) = tiles[i];
        let (x0, y0) = (tx.saturating_sub(MARGIN), ty.saturating_sub(MARGIN));
        let (x1, y1) = ((tx + TILE + MARGIN).min(pw), (ty + TILE + MARGIN).min(ph));
        let (cw, ch) = (x1 - x0, y1 - y0);
        let mut cur = vec![0f32; cw * ch];
        for y in 0..ch { cur[y * cw..(y + 1) * cw].copy_from_slice(&x[(y0 + y) * pw + x0..(y0 + y) * pw + x1]); }
        let (mut hh, mut ww) = (ch, cw);
        for c in &m.finder { let (o, oh, ow) = conv(c, &cur, hh, ww, true); cur = o; hh = oh; ww = ow; }
        let (logit, _, _) = conv(&m.head, &cur, hh, ww, false);
        let (cx0, cy0) = ((tx - x0) / 8, (ty - y0) / 8);
        let (cw8, ch8) = (((tx + TILE).min(pw) - tx) / 8, ((ty + TILE).min(ph) - ty) / 8);
        let mut o = vec![0f32; cw8 * ch8];
        for y in 0..ch8 { for xx in 0..cw8 {
            let at = (cy0 + y) * ww + cx0 + xx;
            let mx = (0..m.classes).map(|c| logit[c * hh * ww + at]).fold(f32::MIN, f32::max);
            let sum: f32 = (0..m.classes).map(|c| (logit[c * hh * ww + at] - mx).exp()).sum();
            o[y * cw8 + xx] = 1.0 - (logit[at] - mx).exp() / sum;
        } }
        progress(done.fetch_add(1, Ordering::Relaxed) as f32 / tiles.len() as f32);
        (o, cw8, ch8)
    });
    let mut d = vec![0f32; gw * gh];
    for ((tx, ty), (o, cw8, ch8)) in tiles.iter().zip(parts) { for y in 0..ch8 { d[(ty / 8 + y) * gw + tx / 8..(ty / 8 + y) * gw + tx / 8 + cw8].copy_from_slice(&o[y * cw8..(y + 1) * cw8]); } }
    (d, gw, gh)
}

/// One box per local peak of the finder map above `floor`: (x0, y0, x1, y1, peak) in pixels.
pub fn peaks(d: &[f32], gw: usize, gh: usize, floor: f32) -> Vec<(f64, f64, f64, f64, f32)> {
    let mut out = Vec::new();
    for y in 0..gh { for x in 0..gw {
        let v = d[y * gw + x];
        if v <= floor { continue; }
        let mut top = true;
        'n: for yy in y.saturating_sub(2)..(y + 3).min(gh) { for xx in x.saturating_sub(2)..(x + 3).min(gw) { if d[yy * gw + xx] > v { top = false; break 'n; } } }
        if !top { continue; }
        // the connected patch above half the peak, within 8 cells
        let (y0, y1, x0, x1) = (y.saturating_sub(8), (y + 9).min(gh), x.saturating_sub(8), (x + 9).min(gw));
        let (ww, hh) = (x1 - x0, y1 - y0);
        let mut seen = vec![false; ww * hh];
        let mut stack = vec![(x - x0, y - y0)];
        seen[(y - y0) * ww + (x - x0)] = true;
        let (mut bx0, mut by0, mut bx1, mut by1) = (x - x0, y - y0, x - x0, y - y0);
        while let Some((cx, cy)) = stack.pop() {
            bx0 = bx0.min(cx); bx1 = bx1.max(cx); by0 = by0.min(cy); by1 = by1.max(cy);
            for ny in cy.saturating_sub(1)..(cy + 2).min(hh) { for nx in cx.saturating_sub(1)..(cx + 2).min(ww) {
                if !seen[ny * ww + nx] && d[(y0 + ny) * gw + x0 + nx] > 0.5 * v { seen[ny * ww + nx] = true; stack.push((nx, ny)); }
            } }
        }
        out.push((((x0 + bx0) * 8) as f64, ((y0 + by0) * 8) as f64, ((x0 + bx1 + 1) * 8) as f64, ((y0 + by1 + 1) * 8) as f64, v));
    } }
    out
}

const CROP: usize = 64;
/// The close crop the second network sees: the box with some surroundings, 64 x 64, relative to its median.
pub fn close_crop(g: &[u8], w: usize, h: usize, b: (f64, f64, f64, f64)) -> Vec<f32> {
    let (cx, cy) = ((b.0 + b.2) / 2.0, (b.1 + b.3) / 2.0);
    let side = (1.7 * (b.2 - b.0).max(b.3 - b.1)).max(40.0);
    let mut p = vec![0f32; CROP * CROP];
    let q = |v: f64| (v * 32.0 + 0.5).floor() / 32.0; // the training code sampled on a 1/32 pixel grid
    for y in 0..CROP { for x in 0..CROP {
        let (sx, sy) = (q(x as f64 * side / CROP as f64 + cx - side / 2.0), q(y as f64 * side / CROP as f64 + cy - side / 2.0));
        let (fx, fy) = (sx.floor(), sy.floor());
        let (ax, ay) = ((sx - fx) as f32, (sy - fy) as f32);
        let at = |xx: i64, yy: i64| g[reflect(yy, h as i64) * w + reflect(xx, w as i64)] as f32;
        let (ix, iy) = (fx as i64, fy as i64);
        let v = (at(ix, iy) * (1.0 - ax) + at(ix + 1, iy) * ax) * (1.0 - ay) + (at(ix, iy + 1) * (1.0 - ax) + at(ix + 1, iy + 1) * ax) * ay;
        p[y * CROP + x] = (v + 0.5).floor().clamp(0.0, 255.0);
    } }
    let mut s = p.clone();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = (s[CROP * CROP / 2 - 1] + s[CROP * CROP / 2]) / 2.0;
    p.iter().map(|v| ((v - med) / 8.0).clamp(-6.0, 6.0)).collect()
}

/// Second network on one close crop: class probabilities (index 0 = not an indication).
pub fn name_crop(m: &Models, crop: &[f32]) -> Vec<f32> {
    let (mut cur, mut hh, mut ww) = (crop.to_vec(), CROP, CROP);
    for (i, c) in m.namer.iter().enumerate() {
        let (o, oh, ow) = conv(c, &cur, hh, ww, true); cur = o; hh = oh; ww = ow;
        if i % 2 == 1 {
            let (ph, pw) = (hh / 2, ww / 2);
            let mut o = vec![0f32; c.cout * ph * pw];
            for ch in 0..c.cout { for y in 0..ph { for x in 0..pw {
                let at = |yy: usize, xx: usize| cur[ch * hh * ww + yy * ww + xx];
                o[ch * ph * pw + y * pw + x] = at(2 * y, 2 * x).max(at(2 * y, 2 * x + 1)).max(at(2 * y + 1, 2 * x)).max(at(2 * y + 1, 2 * x + 1));
            } } }
            cur = o; hh = ph; ww = pw;
        }
    }
    let ch = m.namer[7].cout;
    let feat: Vec<f32> = (0..ch).map(|c| cur[c * hh * ww..(c + 1) * hh * ww].iter().sum::<f32>() / (hh * ww) as f32).collect();
    let logit: Vec<f32> = (0..m.classes).map(|k| m.fc_b[k] + feat.iter().zip(&m.fc_w[k * ch..(k + 1) * ch]).map(|(a, b)| a * b).sum::<f32>()).collect();
    let mx = logit.iter().cloned().fold(f32::MIN, f32::max);
    let sum: f32 = logit.iter().map(|v| (v - mx).exp()).sum();
    logit.iter().map(|v| (v - mx).exp() / sum).collect()
}

// ---------------------------------------------------------------- weld band
fn pct_sorted(s: &[f32], p: f64) -> f32 {
    if s.is_empty() { return 0.0; }
    let pos = p / 100.0 * (s.len() - 1) as f64;
    let (i, f) = (pos.floor() as usize, (pos - pos.floor()) as f32);
    if i + 1 < s.len() { s[i] * (1.0 - f) + s[i + 1] * f } else { s[i] }
}
fn pct(v: impl Iterator<Item = f32>, p: f64) -> f32 { let mut s: Vec<f32> = v.collect(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); pct_sorted(&s, p) }

fn runs(sep: &[bool]) -> Vec<(usize, usize)> {
    let n = sep.len();
    let (mut out, mut y) = (Vec::new(), 0);
    while y < n {
        if sep[y] { y += 1; continue; }
        let mut y1 = y;
        while y1 < n && !sep[y1] { y1 += 1; }
        if (y1 - y) as f64 > 0.12 * n as f64 || y1 - y > 120 { out.push((y, y1)); }
        y = y1;
    }
    out
}

/// One film on a plate with its weld band. Coordinates are in the turned image (films running left to right).
#[derive(Clone, Debug)]
pub struct FilmBand { pub y0: f64, pub y1: f64, pub x0: f64, pub x1: f64, pub xs: Vec<f64>, pub top: Vec<f64>, pub bot: Vec<f64>, pub sure: bool, pub score: f64 }
#[derive(Clone, Debug, Default)]
pub struct Bands { pub films: Vec<FilmBand>, pub turned: bool, pub w: f64, pub h: f64,
    /// Weld band drawn by the user as boxes (x0, y0, x1, y1) in image coordinates. When present it replaces the found band.
    pub manual: Vec<(f64, f64, f64, f64)> }

fn interp(x: f64, xs: &[f64], ys: &[f64]) -> f64 {
    if x <= xs[0] { return ys[0]; }
    for i in 1..xs.len() { if x <= xs[i] { let t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]).max(1e-9); return ys[i - 1] + t * (ys[i] - ys[i - 1]); } }
    ys[ys.len() - 1]
}
/// Below this ridge score a film has no band worth using and is searched whole.
pub const NO_RIDGE: f64 = 0.02;
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Where { Band, UnsureFilm, Outside }
impl Bands {
    fn turn(&self, x: f64, y: f64) -> (f64, f64) { if self.turned { (y, self.w - 1.0 - x) } else { (x, y) } }
    fn back(&self, x: f64, y: f64) -> (f64, f64) { if self.turned { (self.w - 1.0 - y, x) } else { (x, y) } }
    /// Where an image point lies: inside a sure weld band, on a film whose band is unsure, or outside.
    pub fn locate(&self, x: f64, y: f64) -> Where {
        if !self.manual.is_empty() { return if self.manual.iter().any(|b| b.0 <= x && x <= b.2 && b.1 <= y && y <= b.3) { Where::Band } else { Where::Outside }; }
        let (tx, ty) = self.turn(x, y);
        for f in &self.films {
            if !(f.y0 <= ty && ty < f.y1 && f.x0 <= tx && tx < f.x1) { continue; }
            // An unsure band is still used (the owner: marks outside the weld are useless); only with no ridge at all
            // is the whole film searched. The user can see the band and redraw it.
            if !f.sure && f.score <= NO_RIDGE { return Where::UnsureFilm; }
            let (t, b) = (interp(tx - f.x0, &f.xs, &f.top) + f.y0, interp(tx - f.x0, &f.xs, &f.bot) + f.y0);
            return if t <= ty && ty <= b { Where::Band } else { Where::Outside };
        }
        Where::Outside
    }
    /// The two edges of each band as lines in image coordinates, with whether the band is sure.
    pub fn outlines(&self) -> Vec<(Vec<(f64, f64)>, bool)> {
        let mut out = Vec::new();
        if !self.manual.is_empty() { return self.manual.iter().map(|b| (vec![(b.0, b.1), (b.2, b.1), (b.2, b.3), (b.0, b.3), (b.0, b.1)], true)).collect(); }
        for f in &self.films { for edge in [&f.top, &f.bot] {
            let mut line: Vec<(f64, f64)> = vec![self.back(f.x0, f.y0 + edge[0])];
            line.extend(f.xs.iter().zip(edge.iter()).map(|(x, y)| self.back(f.x0 + x, f.y0 + y)));
            line.push(self.back(f.x1 - 1.0, f.y0 + edge[edge.len() - 1]));
            out.push((line, f.sure));
        } }
        out
    }
    fn scaled(mut self, k: f64) -> Bands {
        self.w *= k; self.h *= k;
        for b in self.manual.iter_mut() { *b = (b.0 * k, b.1 * k, b.2 * k, b.3 * k); }
        for f in self.films.iter_mut() { f.y0 *= k; f.y1 *= k; f.x0 *= k; f.x1 *= k; for v in f.xs.iter_mut().chain(f.top.iter_mut()).chain(f.bot.iter_mut()) { *v *= k; } }
        self
    }
}

/// Best lighter band in a cross profile: (score, centre, half width).
fn profile_score(p: &[f32], hmin: usize, hmax: usize, rough: Option<&[f32]>) -> (f32, usize, usize) {
    let n = p.len();
    let cum = |v: &[f32]| { let mut c = vec![0f64; v.len() + 1]; for (i, x) in v.iter().enumerate() { c[i + 1] = c[i] + *x as f64; } c };
    let c = cum(p);
    let rc = rough.map(cum);
    let mut best = (-9f32, 0usize, 0usize);
    let mut hs: Vec<usize> = (0..10).map(|i| (hmin as f64 + (hmax as f64 - hmin as f64) * i as f64 / 9.0) as usize).collect();
    hs.dedup();
    for h in hs {
        if h == 0 { continue; }
        let f = (h / 2).max(3);
        let mut y = h + f;
        while y + h + f < n {
            let inside = (c[y + h] - c[y - h]) / (2 * h) as f64;
            let (a, b) = ((c[y - h] - c[y - h - f]) / f as f64, (c[y + h + f] - c[y + h]) / f as f64);
            let s = (inside - a).min(inside - b) as f32;
            let belt = rc.as_ref().map_or(false, |rc| (rc[y + h] - rc[y - h]) / (2 * h) as f64 > 0.35);
            if !belt && s > best.0 { best = (s, y, h); }
            y += 2;
        }
    }
    best
}

fn film_band(g: &[u8], w: usize, y0: usize, y1: usize) -> FilmBand {
    let (hh, ww) = (y1 - y0, w);
    let f: Vec<f32> = g[y0 * w..y1 * w].iter().map(|&v| v as f32).collect();
    let gb = blur(&f, ww, hh, (hh as f64 * 0.01).max(1.0));
    let m = (hh as f64 * 0.04) as usize;
    let (hmin, hmax) = (((hh as f64 * 0.03) as usize).max(4), (hh as f64 * 0.22) as usize);
    let (ca, cb) = ((ww as f64 * 0.2) as usize, ((ww as f64 * 0.8) as usize).max((ww as f64 * 0.2) as usize + 1)); // film ends are often burn-off past the pipe
    let none = FilmBand { y0: y0 as f64, y1: y1 as f64, x0: 0.0, x1: w as f64, xs: vec![0.0, w as f64], top: vec![0.0; 2], bot: vec![hh as f64; 2], sure: false, score: 0.0 };
    if hh < 40 || ww < 40 || hh <= 2 * m + 2 * hmin + 8 { return none; }
    let row_pct = |y: usize, a: usize, b: usize| pct(gb[y * ww + a..y * ww + b].iter().cloned(), 30.0); // 30th percentile ignores lead numbers
    let whole: Vec<f32> = (m..hh - m).map(|y| row_pct(y, ca, cb)).collect();
    // lead numbers: strong, sharp and lighter than their surroundings
    let wide = blur(&gb, ww, hh, hh as f64 * 0.05);
    let step = (gb.len() / 400_000).max(1);
    let mut samp: Vec<f32> = gb.iter().step_by(step).cloned().collect();
    samp.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let lim = 0.15 * (pct_sorted(&samp, 99.0) - pct_sorted(&samp, 1.0));
    let belt: Vec<f32> = (0..hh).map(|y| (0..ww).filter(|x| gb[y * ww + x] - wide[y * ww + x] > lim).count() as f32 / ww as f32).collect();
    let rough: Vec<f32> = blur(&belt, 1, hh, hh as f64 * 0.015)[m..hh - m].iter().map(|v| if *v > 0.08 { 1.0 } else { 0.0 }).collect();
    let (s0, yc, h0) = profile_score(&whole, hmin, hmax, Some(&rough));
    if h0 == 0 { return none; }
    let yc = yc + m;
    let mut mid: Vec<f32> = (m..hh - m).flat_map(|y| gb[y * ww + ca..y * ww + cb].iter().step_by(step).cloned().collect::<Vec<_>>()).collect();
    mid.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let rng = pct_sorted(&mid, 95.0) - pct_sorted(&mid, 5.0) + 1e-3;
    const CHUNKS: usize = 8;
    let (mut xs, mut top, mut bot, mut sc) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let (lo, hi) = (yc.saturating_sub(3 * h0).max(m), (yc + 3 * h0).min(hh - m)); // stay near the whole-film ridge
    for i in 0..CHUNKS {
        let (a, b) = (ww * i / CHUNKS, ww * (i + 1) / CHUNKS);
        let p: Vec<f32> = (lo..hi).map(|y| row_pct(y, a, b)).collect();
        let (s, y, h) = profile_score(&p, ((h0 as f64 * 0.7) as usize).max(4), ((h0 as f64 * 1.4) as usize).max(5), None);
        xs.push(((a + b) / 2) as f64); top.push(lo as f64 + y as f64 - h as f64); bot.push(lo as f64 + y as f64 + h as f64); sc.push(s / rng);
    }
    let cen: Vec<f64> = top.iter().zip(&bot).map(|(t, b)| (t + b) / 2.0).collect();
    let med = pct(cen.iter().map(|v| *v as f32), 50.0) as f64;
    let ok: Vec<bool> = cen.iter().zip(&sc).map(|(c, s)| (c - med).abs() < 1.5 * h0 as f64 && *s > 0.01).collect();
    let n_ok = ok.iter().filter(|v| **v).count();
    if n_ok >= 3 { // replace stray chunks from their neighbours
        let gx: Vec<f64> = xs.iter().zip(&ok).filter(|p| *p.1).map(|p| *p.0).collect();
        for arr in [&mut top, &mut bot] {
            let gy: Vec<f64> = arr.iter().zip(&ok).filter(|p| *p.1).map(|p| *p.0).collect();
            for i in 0..CHUNKS { if !ok[i] { arr[i] = interp(xs[i], &gx, &gy); } }
        }
    }
    // a weld band runs straight and even
    let c2: Vec<f64> = top.iter().zip(&bot).map(|(t, b)| (t + b) / 2.0).collect();
    let n = CHUNKS as f64;
    let (mx, my) = (xs.iter().sum::<f64>() / n, c2.iter().sum::<f64>() / n);
    let slope = xs.iter().zip(&c2).map(|(x, y)| (x - mx) * (y - my)).sum::<f64>() / xs.iter().map(|x| (x - mx).powi(2)).sum::<f64>().max(1e-9);
    let dev = xs.iter().zip(&c2).map(|(x, y)| (y - (my + slope * (x - mx))).abs()).fold(0.0, f64::max);
    let widths: Vec<f64> = top.iter().zip(&bot).map(|(t, b)| b - t).collect();
    let spread = widths.iter().cloned().fold(f64::MIN, f64::max) - widths.iter().cloned().fold(f64::MAX, f64::min);
    let straight = dev < 0.6 * h0 as f64 && spread < 1.2 * h0 as f64;
    let sure = (s0 / rng) > 0.04 && n_ok as f64 / n >= 0.75 && straight;
    let pad = 0.5 * h0 as f64; // margin: heat-affected zone and band slack
    FilmBand { y0: y0 as f64, y1: y1 as f64, x0: 0.0, x1: w as f64, xs, top: top.iter().map(|t| (t - pad).clamp(0.0, hh as f64)).collect(), bot: bot.iter().map(|b| (b + pad).clamp(0.0, hh as f64)).collect(), sure, score: (s0 / rng) as f64 }
}

/// Splits a plate into its films and finds the weld band on each. `g` is in film sense: the weld lighter than
/// the plate beside it. A band is reported sure only when it is clear, straight and even.
pub fn find_bands(g: &[u8], w: usize, h: usize) -> Bands {
    // work on a smaller copy: the band is a large feature
    let k = ((w.max(h) + 2199) / 2200).max(1);
    let (sw, sh) = (w / k, h / k);
    if sw < 40 || sh < 40 { return Bands { films: vec![], turned: false, w: w as f64, h: h as f64, manual: vec![] }; }
    let mut s = vec![0u8; sw * sh];
    for y in 0..sh { for x in 0..sw { let mut acc = 0u32; for yy in 0..k { for xx in 0..k { acc += g[(y * k + yy) * w + x * k + xx] as u32; } } s[y * sw + x] = (acc / (k * k) as u32) as u8; } }
    let mut hist = [0usize; 256];
    for v in &s { hist[*v as usize] += 1; }
    let hp = |p: f64| { let target = (p / 100.0 * (s.len() - 1) as f64) as usize; let mut acc = 0; for (i, c) in hist.iter().enumerate() { acc += c; if acc > target { return i as f32; } } 255.0 };
    let gap_at = hp(99.5).max(253.0) - 3.0;
    let rng = hp(99.0) - hp(1.0) + 1.0;
    let is_gap = |v: u8| v as f32 >= gap_at || v == 0; // unexposed gap between films, or padding
    let seps = |along_rows: bool| -> Vec<bool> {
        let (n, len) = if along_rows { (sh, sw) } else { (sw, sh) };
        let line = |i: usize| -> Vec<u8> { if along_rows { s[i * sw..(i + 1) * sw].to_vec() } else { (0..sh).map(|y| s[y * sw + i]).collect() } };
        let mut r = vec![0f32; n];
        let mut frac = vec![0f32; n];
        for i in 0..n { let mut l = line(i); frac[i] = l.iter().filter(|v| is_gap(**v)).count() as f32 / len as f32; l.sort_unstable(); r[i] = ((l[(len - 1) / 2] as f32 + l[len / 2] as f32) / 2.0).floor(); }
        let kk = (((n as f64 * 0.06) as usize).max(5) | 1).min(255);
        (0..n).map(|i| {
            let mut win: Vec<f32> = (0..kk).map(|j| r[(i as i64 + j as i64 - (kk / 2) as i64).clamp(0, n as i64 - 1) as usize]).collect();
            win.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let thin = r[i] - win[kk / 2] > 0.3 * rng && i >= (n as f64 * 0.1) as usize && i < (n as f64 * 0.9) as usize; // a thin light line between films
            frac[i] > 0.5 || thin
        }).collect()
    };
    let (rows, cols) = (runs(&seps(true)), runs(&seps(false)));
    let turned = if cols.len() != rows.len() { cols.len() > rows.len() } else { sh > sw }; // the gap between films decides
    let (t, tw, th, spans) = if turned {
        // quarter turn anticlockwise: new[y][x] = old[x][sw - 1 - y]
        let (tw, th) = (sh, sw);
        let mut t = vec![0u8; tw * th];
        for y in 0..th { for x in 0..tw { t[y * tw + x] = s[x * sw + (sw - 1 - y)]; } }
        let mut sp: Vec<(usize, usize)> = cols.iter().map(|(a, b)| (th - b, th - a)).collect();
        sp.reverse();
        (t, tw, th, sp)
    } else { (s, sw, sh, rows) };
    let spans = if spans.is_empty() { vec![(0, th)] } else { spans };
    let films = spans.iter().map(|(a, b)| film_band(&t, tw, *a, *b)).collect();
    Bands { films, turned, w: sw as f64, h: sh as f64, manual: vec![] }.scaled(k as f64)
}

// ---------------------------------------------------------------- the whole thing
#[derive(Clone, Debug)]
pub struct Indication { pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub score: f32, pub finder: f32, pub class: usize }
#[derive(Clone, Debug, Default)]
pub struct Found { pub items: Vec<Indication>, pub bands: Bands, pub limited: bool }

/// Stored pixels to the 8-bit film-sense image the networks were trained on (less radiation lighter).
pub fn film_sense(a: &[i32], w: usize, h: usize, pad: Option<i32>) -> Vec<u8> {
    let st = im::stats(a, pad);
    let (lo, hi) = (st.pct(0.5), st.pct(99.5));
    let less_is_low = im::less_radiation_sign(a, w, h, pad) > 0.0;
    a.iter().map(|&v| { let t = ((v as f64 - lo) / (hi - lo + 1e-6)).clamp(0.0, 1.0) * 255.0; (if less_is_low { 255.0 - t } else { t }) as u8 }).collect()
}

fn resize(g: &[u8], w: usize, h: usize, nw: usize, nh: usize) -> Vec<u8> {
    let mut o = vec![0u8; nw * nh];
    let (fx, fy) = (w as f64 / nw as f64, h as f64 / nh as f64);
    for y in 0..nh { for x in 0..nw {
        // average the source area under each new pixel (bilinear when enlarging)
        let (sx0, sy0) = (x as f64 * fx, y as f64 * fy);
        if fx > 1.0 {
            let (x1, y1) = ((((x + 1) as f64 * fx).ceil() as usize).min(w), (((y + 1) as f64 * fy).ceil() as usize).min(h));
            let (mut acc, mut n) = (0u32, 0u32);
            for yy in sy0 as usize..y1 { for xx in sx0 as usize..x1 { acc += g[yy * w + xx] as u32; n += 1; } }
            o[y * nw + x] = (acc / n.max(1)) as u8;
        } else {
            let (px, py) = ((sx0 + 0.5 * fx - 0.5).max(0.0), (sy0 + 0.5 * fy - 0.5).max(0.0));
            let (ix, iy) = ((px as usize).min(w - 1), (py as usize).min(h - 1));
            let (ax, ay) = (px - ix as f64, py - iy as f64);
            let at = |xx: usize, yy: usize| g[yy.min(h - 1) * w + xx.min(w - 1)] as f64;
            o[y * nw + x] = ((at(ix, iy) * (1.0 - ax) + at(ix + 1, iy) * ax) * (1.0 - ay) + (at(ix, iy + 1) * (1.0 - ax) + at(ix + 1, iy + 1) * ax) * ay + 0.5) as u8;
        }
    } }
    o
}

/// Most candidates the second network will look at on one image (the strongest finder peaks are kept).
pub const MAX_CANDIDATES: usize = 600;

/// Ranked possible indications inside the weld band of one frame. An unsure band is still used; a film with no
/// band at all is searched whole. `manual` is a weld band drawn by the user (boxes in image coordinates); when given, only spots inside
/// it are listed. `progress` gets 0..1.
pub fn find(m: &Models, a: &[i32], w: usize, h: usize, pad: Option<i32>, px_mm: f64, manual: &[(f64, f64, f64, f64)], progress: &(dyn Fn(f32) + Sync)) -> Found {
    let g0 = film_sense(a, w, h, pad);
    let k = if px_mm > 0.0 { px_mm / MODEL_PX_MM } else { 1.0 };
    let k = if (0.8..=1.25).contains(&k) { 1.0 } else { k.clamp(0.2, 5.0) };
    let (gw_, gh_) = (((w as f64 * k).round() as usize).max(1), ((h as f64 * k).round() as usize).max(1));
    let g = if k == 1.0 { g0 } else { resize(&g0, w, h, gw_, gh_) };
    let (w2, h2) = (gw_, gh_);
    if w2 < 64 || h2 < 64 { return Found::default(); }
    let mut bands = find_bands(&g, w2, h2);
    bands.manual = manual.iter().map(|b| (b.0 * k, b.1 * k, b.2 * k, b.3 * k)).collect();
    let (d, gw, gh) = finder_map(m, &g, w2, h2, &|p| progress(p * 0.85));
    let mut c: Vec<_> = peaks(&d, gw, gh, 0.1).into_iter().filter(|b| bands.locate((b.0 + b.2) / 2.0, (b.1 + b.3) / 2.0) != Where::Outside).collect();
    c.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap());
    let limited = c.len() > MAX_CANDIDATES;
    c.truncate(MAX_CANDIDATES);
    let done = AtomicUsize::new(0);
    let probs = par_map(c.len(), |i| {
        let p = name_crop(m, &close_crop(&g, w2, h2, (c[i].0, c[i].1, c[i].2, c[i].3)));
        progress(0.85 + 0.15 * done.fetch_add(1, Ordering::Relaxed) as f32 / c.len() as f32);
        p
    });
    let mut items: Vec<Indication> = c.iter().zip(&probs).map(|(b, p)| {
        let class = (1..p.len()).max_by(|i, j| p[*i].partial_cmp(&p[*j]).unwrap()).unwrap_or(1);
        Indication { x0: b.0 / k, y0: b.1 / k, x1: (b.2 / k).min(w as f64), y1: (b.3 / k).min(h as f64), score: b.4 * (1.0 - p[0]), finder: b.4, class }
    }).collect();
    items.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    Found { items, bands: bands.scaled(1.0 / k), limited }
}
