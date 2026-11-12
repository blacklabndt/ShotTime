//! Image operations on greyscale frames. Every operation returns new data and leaves its input alone.
//! Ported from diconde-editor/imaging.js; numbers follow the prototype exactly (including JavaScript's
//! rounding of halves towards +infinity) so both give the same pieces, tilts and repairs.

use crate::dicom::Image;

/// JavaScript Math.round: halves go towards +infinity.
#[inline]
pub fn js_round(v: f64) -> f64 { (v + 0.5).floor() }
#[inline]
fn clamp_round(v: f64, lo: i32, hi: i32) -> i32 { if v < lo as f64 { lo } else if v > hi as f64 { hi } else { js_round(v) as i32 } }

pub trait Px: Copy + PartialOrd + Send + Sync { fn f(self) -> f64; }
impl Px for i32 { #[inline] fn f(self) -> f64 { self as f64 } }
impl Px for f32 { #[inline] fn f(self) -> f64 { self as f64 } }

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Rect { pub x: i64, pub y: i64, pub w: i64, pub h: i64 }
impl Rect { pub fn new(x: i64, y: i64, w: i64, h: i64) -> Rect { Rect { x, y, w, h } } }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis { X, Y }
/// A dividing line inside a piece's rectangle: for axis X the line is x = a + k·y, for Y it is y = a + k·x. The
/// piece is on the `keep_less` side (t < 0) or the other (t ≥ 0). Pixels on the other side belong to a neighbour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cut { pub axis: Axis, pub a: f64, pub k: f64, pub keep_less: bool }
impl Cut {
    #[inline]
    pub fn keeps(&self, x: f64, y: f64) -> bool {
        let t = match self.axis { Axis::X => x - (self.a + self.k * y), Axis::Y => y - (self.a + self.k * x) };
        if self.keep_less { t < 0.0 } else { t >= 0.0 }
    }
}
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Region { pub rect: Rect, pub cuts: Vec<Cut> }
fn inside(cuts: &[Cut], x: f64, y: f64) -> bool { cuts.iter().all(|c| c.keeps(x, y)) }

// ---------------------------------------------------------------- geometry
pub fn rotate(img: &Image, quarter_turns_cw: i32) -> Image {
    let q = quarter_turns_cw.rem_euclid(4);
    let (w, h) = (img.cols, img.rows);
    if q == 0 { return img.clone(); }
    let (nw, nh) = if q == 2 { (w, h) } else { (h, w) };
    let frames = img.frames.iter().map(|a| {
        let mut o = vec![0i32; a.len()];
        for y in 0..h { for x in 0..w {
            let (nx, ny) = match q { 1 => (h - 1 - y, x), 2 => (w - 1 - x, h - 1 - y), _ => (y, w - 1 - x) };
            o[ny * nw + nx] = a[y * w + x];
        } }
        o
    }).collect();
    img.with_frames(nh, nw, frames)
}

pub fn flip(img: &Image, horizontal: bool) -> Image {
    let (w, h) = (img.cols, img.rows);
    let frames = img.frames.iter().map(|a| {
        let mut o = vec![0i32; a.len()];
        for y in 0..h { for x in 0..w { o[y * w + x] = if horizontal { a[y * w + (w - 1 - x)] } else { a[(h - 1 - y) * w + x] }; } }
        o
    }).collect();
    img.with_frames(h, w, frames)
}

pub fn crop_frame(a: &[i32], cols: usize, r: Rect) -> Vec<i32> {
    let (x, y, w, h) = (r.x as usize, r.y as usize, r.w as usize, r.h as usize);
    let mut o = Vec::with_capacity(w * h);
    for j in 0..h { o.extend_from_slice(&a[(y + j) * cols + x..(y + j) * cols + x + w]); }
    o
}
/// Clamps the rectangle to the image; errors when nothing is left.
pub fn crop(img: &Image, r: Rect) -> Result<Image, String> {
    let x = r.x.max(0); let y = r.y.max(0);
    let w = (img.cols as i64 - x).min(r.w); let h = (img.rows as i64 - y).min(r.h);
    if w < 1 || h < 1 { return Err("The crop area is outside the image.".into()); }
    let rr = Rect::new(x, y, w, h);
    Ok(img.with_frames(h as usize, w as usize, img.frames.iter().map(|a| crop_frame(a, img.cols, rr)).collect()))
}

pub fn invert(img: &Image) -> Image {
    let s = img.min as i64 + img.max as i64;
    img.with_frames(img.rows, img.cols, img.frames.iter().map(|a| a.iter().map(|&v| (s - v as i64) as i32).collect()).collect())
}

// ---------------------------------------------------------------- filters
#[inline]
fn med9<T: Copy + PartialOrd>(p: &mut [T; 9]) -> T {
    // sorting network (Paeth); returns the middle value
    macro_rules! s { ($i:expr, $j:expr) => { if p[$i] > p[$j] { p.swap($i, $j); } } }
    s!(1, 2); s!(4, 5); s!(7, 8); s!(0, 1); s!(3, 4); s!(6, 7); s!(1, 2); s!(4, 5); s!(7, 8);
    s!(0, 3); s!(5, 8); s!(4, 7); s!(3, 6); s!(1, 4); s!(2, 5); s!(4, 7); s!(4, 2); s!(6, 4); s!(4, 2);
    p[4]
}
/// 3×3 median with edge replication.
pub fn median3<T: Copy + PartialOrd + Default>(a: &[T], w: usize, h: usize) -> Vec<T> {
    let mut o = vec![T::default(); a.len()];
    for y in 0..h {
        let (y0, y2) = (y.saturating_sub(1), (y + 1).min(h - 1));
        for x in 0..w {
            let (x0, x2) = (x.saturating_sub(1), (x + 1).min(w - 1));
            let mut v = [a[y0 * w + x0], a[y0 * w + x], a[y0 * w + x2], a[y * w + x0], a[y * w + x], a[y * w + x2], a[y2 * w + x0], a[y2 * w + x], a[y2 * w + x2]];
            o[y * w + x] = med9(&mut v);
        }
    }
    o
}
pub fn median(img: &Image) -> Image { img.with_frames(img.rows, img.cols, img.frames.iter().map(|a| median3(a, img.cols, img.rows)).collect()) }

pub fn gaussian<T: Px>(a: &[T], w: usize, h: usize, sigma: f64) -> Vec<f32> {
    let r = ((sigma * 3.0).ceil() as i64).max(1);
    let mut k: Vec<f64> = (-r..=r).map(|i| (-((i * i) as f64) / (2.0 * sigma * sigma)).exp()).collect();
    let sum: f64 = k.iter().sum();
    for v in k.iter_mut() { *v /= sum; }
    let (wi, hi) = (w as i64, h as i64);
    let mut tmp = vec![0f32; w * h];
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        let row = y * w;
        for x in 0..wi {
            let mut acc = 0.0;
            for i in -r..=r { let xx = (x + i).clamp(0, wi - 1) as usize; acc += a[row + xx].f() * k[(i + r) as usize]; }
            tmp[row + x as usize] = acc as f32;
        }
    }
    for y in 0..hi { for x in 0..w {
        let mut acc = 0.0;
        for i in -r..=r { let yy = (y + i).clamp(0, hi - 1) as usize; acc += tmp[yy * w + x] as f64 * k[(i + r) as usize]; }
        out[y as usize * w + x] = acc as f32;
    } }
    out
}
pub fn smooth(img: &Image, sigma: f64) -> Result<Image, String> {
    if !(sigma > 0.0) { return Err("Smoothing radius must be above zero.".into()); }
    Ok(img.with_frames(img.rows, img.cols, img.frames.iter().map(|a| gaussian(a, img.cols, img.rows, sigma).iter().map(|&g| clamp_round(g as f64, img.min, img.max)).collect()).collect()))
}
pub fn sharpen(img: &Image, sigma: f64, amount: f64) -> Result<Image, String> {
    if !(sigma > 0.0) || !(amount > 0.0) { return Err("Sharpen radius and amount must be above zero.".into()); }
    Ok(img.with_frames(img.rows, img.cols, img.frames.iter().map(|a| {
        let g = gaussian(a, img.cols, img.rows, sigma);
        a.iter().zip(&g).map(|(&v, &gv)| clamp_round(v as f64 + amount * (v as f64 - gv as f64), img.min, img.max)).collect()
    }).collect()))
}
/// Replaces isolated pixels that differ from their 3×3 median by more than `threshold`. Returns the count.
pub fn fix_bad_pixels(img: &Image, threshold: f64) -> (Image, usize) {
    let mut count = 0;
    let frames = img.frames.iter().map(|a| {
        let m = median3(a, img.cols, img.rows);
        let mut o = a.clone();
        for i in 0..a.len() { if ((a[i] - m[i]) as f64).abs() > threshold { o[i] = m[i]; count += 1; } }
        o
    }).collect();
    (img.with_frames(img.rows, img.cols, frames), count)
}

// ---------------------------------------------------------------- statistics and windows
/// Histogram statistics of one frame (percentiles approximate to 1/4096 of the range). `ignore` is a value to
/// leave out, such as the Pixel Padding Value outside the plate.
pub struct Stats { pub min: f64, pub max: f64, pub count: usize, hist: Vec<u32>, span: f64 }
impl Stats {
    pub fn pct(&self, p: f64) -> f64 {
        let target = p / 100.0 * self.count as f64;
        let mut acc = 0f64;
        for (b, &n) in self.hist.iter().enumerate() { acc += n as f64; if acc >= target { return self.min + (b as f64 + 0.5) / 4096.0 * self.span; } }
        self.max
    }
}
pub fn stats<T: Px>(a: &[T], ignore: Option<i32>) -> Stats {
    let (mut lo, mut hi, mut count) = (f64::INFINITY, f64::NEG_INFINITY, 0usize);
    let skip = |v: f64| ignore.map_or(false, |g| v == g as f64);
    for &v in a { let v = v.f(); if skip(v) { continue; } count += 1; if v < lo { lo = v; } if v > hi { hi = v; } }
    if count == 0 { let z = ignore.map_or(0.0, |g| g as f64); lo = z; hi = z; }
    let bins = 4096usize;
    let span = if hi - lo != 0.0 { hi - lo } else { 1.0 };
    let mut hist = vec![0u32; bins];
    for &v in a { let v = v.f(); if skip(v) { continue; } let b = (((v - lo) / span) * bins as f64).floor().clamp(0.0, (bins - 1) as f64) as usize; hist[b] += 1; }
    Stats { min: lo, max: hi, count, hist, span }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window { pub center: f64, pub width: f64 }

/// Starting window for a radiograph: pile-ups at either extreme are left out, the main cluster around the
/// histogram peak is found, and the window spans the low–high percentiles of that cluster. NaN values (EDGE
/// padding) and `ignore` are left out.
pub fn auto_window<T: Px>(a: &[T], slope: f64, intercept: f64, low_pct: f64, high_pct: f64, ignore: Option<i32>) -> Window {
    let use_ = |v: f64| v == v && !ignore.map_or(false, |g| v == g as f64);
    let (mut mn, mut mx, mut n) = (f64::INFINITY, f64::NEG_INFINITY, 0usize);
    for &v in a { let v = v.f(); if !use_(v) { continue; } n += 1; if v < mn { mn = v; } if v > mx { mx = v; } }
    if n == 0 { return Window { center: ignore.map_or(0.0, |g| g as f64) * slope + intercept, width: 1.0 }; }
    let e = (mx - mn) * 0.005;
    let (mut low_pile, mut high_pile) = (0usize, 0usize);
    for &v in a { let v = v.f(); if !use_(v) { continue; } if v <= mn + e { low_pile += 1; } else if v >= mx - e { high_pile += 1; } }
    let (mut lo, mut hi) = (mn, mx);
    if e > 0.0 && low_pile as f64 > 0.05 * n as f64 { let mut m = f64::INFINITY; for &v in a { let v = v.f(); if use_(v) && v > mn + e && v < m { m = v; } } if m != f64::INFINITY { lo = m; } }
    if e > 0.0 && high_pile as f64 > 0.05 * n as f64 { let mut m = f64::NEG_INFINITY; for &v in a { let v = v.f(); if use_(v) && v < mx - e && v > m { m = v; } } if m != f64::NEG_INFINITY { hi = m; } }
    if hi < lo { lo = mn; hi = mx; }
    const B: usize = 512;
    let span = if hi - lo != 0.0 { hi - lo } else { 1.0 };
    let mut h = vec![0f64; B];
    for &v in a { let v = v.f(); if use_(v) && v >= lo && v <= hi { h[(((v - lo) / span * B as f64).floor() as usize).min(B - 1)] += 1.0; } }
    let mut pk = 0; for i in 1..B { if h[i] > h[pk] { pk = i; } }
    let thr = h[pk] * 0.005;
    let gap_max = js_round(B as f64 * 0.02) as i64;
    let (mut b0, mut b1) = (pk, pk);
    { let mut g = 0; let mut i = pk as i64 - 1; while i >= 0 { if h[i as usize] >= thr { b0 = i as usize; g = 0; } else { g += 1; if g > gap_max { break; } } i -= 1; } }
    { let mut g = 0; for i in pk + 1..B { if h[i] >= thr { b1 = i; g = 0; } else { g += 1; if g > gap_max { break; } } } }
    let tot: f64 = h[b0..=b1].iter().sum();
    let pct = |p: f64| { let t = p / 100.0 * tot; let mut acc = 0.0; for i in b0..=b1 { acc += h[i]; if acc >= t { return lo + (i as f64 + 0.5) / B as f64 * span; } } lo + (b1 + 1) as f64 / B as f64 * span };
    let (mut w0, mut w1) = (pct(low_pct) * slope + intercept, pct(high_pct) * slope + intercept);
    if w0 > w1 { std::mem::swap(&mut w0, &mut w1); }
    let width = (w1 - w0).max(1.0);
    Window { center: w0 + width / 2.0, width }
}
pub fn auto_window_default<T: Px>(a: &[T], slope: f64, intercept: f64, ignore: Option<i32>) -> Window { auto_window(a, slope, intercept, 0.5, 99.8, ignore) }

/// Equal parts along one direction (`along_rows`: stacked), each widened by `overlap` where it meets a neighbour.
pub fn split_regions(rows: usize, cols: usize, parts: usize, along_rows: bool, overlap: i64) -> Vec<Rect> {
    let parts = parts.clamp(1, 50);
    let len = if along_rows { rows } else { cols } as f64;
    (0..parts).map(|i| {
        let a = (js_round(i as f64 * len / parts as f64) as i64 - if i > 0 { overlap } else { 0 }).max(0);
        let b = (js_round((i + 1) as f64 * len / parts as f64) as i64 + if i < parts - 1 { overlap } else { 0 }).min(len as i64);
        if along_rows { Rect::new(0, a, cols as i64, b - a) } else { Rect::new(a, 0, b - a, rows as i64) }
    }).collect()
}

/// 8-bit display values of one frame. The window applies to rescaled values; MONOCHROME1 displays inverted.
pub fn render(a: &[i32], img: &Image, center: f64, width: f64, invert_view: bool) -> Vec<u8> {
    let lo = center - width / 2.0;
    let scale = 255.0 / width.max(1e-9);
    let inv = img.monochrome1() != invert_view;
    let g = |v: f64| { let t = (v * img.slope + img.intercept - lo) * scale; let g = if t < 0.0 { 0.0 } else if t > 255.0 { 255.0 } else { js_round(t) }; let g = g as u8; if inv { 255 - g } else { g } };
    if img.bits_allocated <= 16 {
        let off: i64 = if img.signed { 1 << (img.bits_allocated - 1) } else { 0 };
        let lut: Vec<u8> = (0..(1i64 << img.bits_allocated)).map(|i| g((i - off) as f64)).collect();
        a.iter().map(|&v| lut[((v as i64 + off).clamp(0, lut.len() as i64 - 1)) as usize]).collect()
    } else { a.iter().map(|&v| g(v as f64)).collect() }
}
/// Display values of an enhanced (floating point) frame; NaN (padding) shows as black after inversion rules.
pub fn render_f32(a: &[f32], img: &Image, center: f64, width: f64, invert_view: bool) -> Vec<u8> {
    let lo = center - width / 2.0;
    let scale = 255.0 / width.max(1e-9);
    let inv = img.monochrome1() != invert_view;
    a.iter().map(|&v| {
        let v = v as f64;
        let t = if v.is_nan() { 0.0 } else { (v * img.slope + img.intercept - lo) * scale };
        let g = if t < 0.0 { 0.0 } else if t > 255.0 { 255.0 } else { js_round(t) } as u8;
        if inv { 255 - g } else { g }
    }).collect()
}

// ---------------------------------------------------------------- EDGE-style enhancement
/// Box blur with edge clamping, O(n) per pass regardless of radius (running sums).
pub fn box_blur(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let (wi, hi, ri) = (w as i64, h as i64, r as i64);
    let k = (2 * r + 1) as f64;
    let mut tmp = vec![0f32; w * h];
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        let row = y * w;
        let mut acc = 0f64;
        for i in -ri..=ri { acc += src[row + i.clamp(0, wi - 1) as usize] as f64; }
        for x in 0..wi {
            tmp[row + x as usize] = (acc / k) as f32;
            acc += src[row + (x + ri + 1).min(wi - 1) as usize] as f64 - src[row + (x - ri).max(0) as usize] as f64;
        }
    }
    for x in 0..w {
        let mut acc = 0f64;
        for i in -ri..=ri { acc += tmp[i.clamp(0, hi - 1) as usize * w + x] as f64; }
        for y in 0..hi {
            out[y as usize * w + x] = (acc / k) as f32;
            acc += tmp[(y + ri + 1).min(hi - 1) as usize * w + x] as f64 - tmp[(y - ri).max(0) as usize * w + x] as f64;
        }
    }
    out
}
/// Replaces isolated specks on the bright side of the display (CR dust shows as white dots). `white_sign` is +1
/// when higher values display whiter (MONOCHROME2) and −1 for MONOCHROME1. Returns the number replaced.
pub fn despeckle(f: &mut [f32], w: usize, h: usize, white_sign: f64, threshold: f64) -> usize {
    let m = median3(f, w, h);
    let mut count = 0;
    for i in 0..f.len() { if white_sign * (f[i] as f64 - m[i] as f64) > threshold { f[i] = m[i]; count += 1; } }
    count
}

#[derive(Clone, Debug, PartialEq)]
pub struct EdgeParams {
    pub global_contrast: f64, pub detail_contrast: f64, pub sharpness: f64, pub noise_reduction: f64, pub kernel_px: f64,
    pub padding: Option<i32>, pub despeckle: bool, pub white_sign: f64, pub despeckle_threshold: f64, pub detail_limit: f64,
    pub kg: Option<f64>, pub kd: Option<f64>, pub ks: Option<f64>,
    /// Empty area (no film): (sign, threshold) from `plate_levels`; pixels with sign·value below the threshold are
    /// left out of the filter, like padding. Used by `edge_enhance_v2` only.
    pub background: Option<(f64, f64)>,
}
impl Default for EdgeParams {
    fn default() -> Self { EdgeParams { global_contrast: 1.0, detail_contrast: 1.0, sharpness: 1.0, noise_reduction: 0.0, kernel_px: 60.0, padding: None, despeckle: false, white_sign: 1.0, despeckle_threshold: 0.0, detail_limit: 0.0, kg: None, kd: None, ks: None, background: None } }
}
/// EDGE-style display enhancement, after the Kodak CR approach of splitting an image into a large-scale band
/// (thickness changes) and detail bands, then rebalancing them. Carestream's EDGE algorithm is not published;
/// this is an approximation with controls of the same names, not INDUSTREX's EDGE.
///   out = mean + kG·(L − mean) + kD·(M − L) + kS·(I − M)
/// At the 1.0 settings kG = 0.5, kD = 2.4 and kS = 1.8 (fitted to an INDUSTREX screenshot of the owner's
/// plate); kG = kD = kS = 1 returns the input unchanged. Padding pixels become NaN. Returns (frame, specks).
pub fn edge_enhance(a: &[i32], w: usize, h: usize, o: &EdgeParams) -> (Vec<f32>, usize) {
    let (gc, dc, sh, nr) = (o.global_contrast, o.detail_contrast, o.sharpness, o.noise_reduction.clamp(0.0, 1.0));
    let r = (js_round(o.kernel_px / 2.0) as i64).max(1) as usize;
    let n = w * h;
    let pad = o.padding;
    let mut src: Vec<f32> = Vec::with_capacity(n);
    let (mut sum, mut cnt) = (0f64, 0usize);
    for &v in &a[..n] { src.push(v as f32); if pad.map_or(true, |p| v != p) { sum += v as f64; cnt += 1; } }
    let mean = if cnt > 0 { sum / cnt as f64 } else { 0.0 };
    if let Some(p) = pad { for i in 0..n { if a[i] == p { src[i] = mean as f32; } } } // keep padding from dragging the blurs
    let mut specks = 0;
    if o.despeckle && o.despeckle_threshold > 0.0 { specks = despeckle(&mut src, w, h, if o.white_sign == 0.0 { 1.0 } else { o.white_sign }, o.despeckle_threshold); }
    let i_band: Vec<f32> = if nr > 0.0 { let g = gaussian(&src, w, h, 1.0); src.iter().zip(&g).map(|(&s, &gv)| (s as f64 + nr * (gv as f64 - s as f64)) as f32).collect() } else { src };
    let l = box_blur(&box_blur(&i_band, w, h, r), w, h, r); // two box passes ≈ a smooth kernel about kernelPx wide
    let m = gaussian(&i_band, w, h, 1.5);
    let kg = o.kg.unwrap_or(0.5 * gc);
    let kd = o.kd.unwrap_or(2.4 * dc);
    let ks = o.ks.unwrap_or(1.0 + 0.8 * sh);
    // Optional soft limit on the detail band: ordinary detail passes almost unchanged, but the huge swings next to
    // very bright or dark objects (wires, markers, plate edges) are capped, which keeps halos small.
    let t = if o.detail_limit > 0.0 { o.detail_limit } else { 0.0 };
    let out = (0..n).map(|i| {
        if pad.map_or(false, |p| a[i] == p) { return f32::NAN; }
        let mut d = m[i] as f64 - l[i] as f64;
        if t > 0.0 { d /= 1.0 + d.abs() / t; }
        (mean + kg * (l[i] as f64 - mean) + kd * d + ks * (i_band[i] as f64 - m[i] as f64)) as f32
    }).collect();
    (out, specks)
}

/// EDGE-style enhancement, second version (WeldScope only; the frozen prototype keeps `edge_enhance`).
/// Same idea and controls, refitted to matched INDUSTREX screenshot pairs (EDGE on/off) of the owner's plates; see
/// tools/edge-fit/README.md. It is still an approximation, not INDUSTREX's EDGE.
///   d   = kD·(M − L) + kS·(I − M)                    detail, then softly limited: d / (1 + |d| / (limit·kD))
///   out = mean + kG·(L − mean) + limited d
/// L = three box passes of radius kernel_px/2 (close to a Gaussian of that sigma), M = Gaussian of fine_px.
/// At the 1.0 settings kG = 1.2, kD = 2.4, kS = 6.0, fitted to a cropped piece of film: structure larger than about
/// 10 mm keeps half the detail gain and detail finer than about 1.5 mm is raised 2.5×.
/// Empty area (padding, and `background` where there is no film) is left out: it does not enter the mean or the
/// blurs, so it cannot change how the film looks, which it visibly does in INDUSTREX. Padding becomes NaN and
/// background pixels keep their own value. kG = kD = kS = 1 with no limit returns the input.
pub fn edge_enhance_v2(a: &[i32], w: usize, h: usize, o: &EdgeParams, fine_px: f64) -> (Vec<f32>, usize) {
    let (gc, dc, sh, nr) = (o.global_contrast, o.detail_contrast, o.sharpness, o.noise_reduction.clamp(0.0, 1.0));
    let r = (js_round(o.kernel_px / 2.0) as i64).max(1) as usize;
    let n = w * h;
    let pad = o.padding;
    let empty = |v: i32| pad == Some(v) || o.background.map_or(false, |(sign, thr)| sign * (v as f64) < thr);
    let mut src: Vec<f32> = Vec::with_capacity(n);
    let (mut sum, mut cnt) = (0f64, 0usize);
    for &v in &a[..n] { src.push(v as f32); if !empty(v) { sum += v as f64; cnt += 1; } }
    let mean = if cnt > 0 { sum / cnt as f64 } else { 0.0 };
    for i in 0..n { if empty(a[i]) { src[i] = mean as f32; } }
    // film right next to empty area: spread the film's own values a little way into it, so blurs near the edge
    // see film rather than the plate-wide mean
    if cnt > 0 && cnt < n { feather_into_empty(&mut src, a, w, h, &empty, (r / 2).clamp(2, 40)); }
    let mut specks = 0;
    if o.despeckle && o.despeckle_threshold > 0.0 { specks = despeckle(&mut src, w, h, if o.white_sign == 0.0 { 1.0 } else { o.white_sign }, o.despeckle_threshold); }
    let i_band: Vec<f32> = if nr > 0.0 { let g = gaussian(&src, w, h, 1.0); src.iter().zip(&g).map(|(&s, &gv)| (s as f64 + nr * (gv as f64 - s as f64)) as f32).collect() } else { src };
    let l = box_blur(&box_blur(&box_blur(&i_band, w, h, r), w, h, r), w, h, r);
    let m = gaussian(&i_band, w, h, fine_px.max(0.5));
    let kg = o.kg.unwrap_or(1.2 * gc);
    let kd = o.kd.unwrap_or(2.4 * dc);
    let ks = o.ks.unwrap_or(6.0 * sh);
    let t = if o.detail_limit > 0.0 { o.detail_limit * kd.abs().max(1e-6) } else { 0.0 };
    let out = (0..n).map(|i| {
        if pad == Some(a[i]) { return f32::NAN; }
        if empty(a[i]) { return a[i] as f32; }
        let mut d = kd * (m[i] as f64 - l[i] as f64) + ks * (i_band[i] as f64 - m[i] as f64);
        if t > 0.0 { d /= 1.0 + d.abs() / t; }
        (mean + kg * (l[i] as f64 - mean) + d) as f32
    }).collect();
    (out, specks)
}

/// Fills empty pixels within `reach` of film with the nearest film value along rows, then columns.
fn feather_into_empty(src: &mut [f32], a: &[i32], w: usize, h: usize, empty: &dyn Fn(i32) -> bool, reach: usize) {
    let mut filled: Vec<bool> = a[..w * h].iter().map(|&v| !empty(v)).collect();
    for pass in 0..2 {
        let (outer, inner) = if pass == 0 { (h, w) } else { (w, h) };
        let at = |o: usize, i: usize| if pass == 0 { o * w + i } else { i * w + o };
        let mut add: Vec<(usize, f32)> = Vec::new();
        for o in 0..outer {
            let mut last: Option<(usize, f32)> = None;
            for i in 0..inner { let k = at(o, i); if filled[k] { last = Some((i, src[k])); } else if let Some((j, v)) = last { if i - j <= reach { add.push((k, v)); } } }
            let mut last: Option<(usize, f32)> = None;
            for i in (0..inner).rev() { let k = at(o, i); if filled[k] { last = Some((i, src[k])); } else if let Some((j, v)) = last { if j - i <= reach { add.push((k, v)); } } }
        }
        for (k, v) in add { src[k] = v; filled[k] = true; }
    }
}

// ---------------------------------------------------------------- film pieces
fn border_mean(a: &[i32], w: usize, h: usize) -> f64 {
    let step = ((w.min(h) / 200) as usize).max(1);
    let (mut s, mut n) = (0f64, 0usize);
    let mut x = 0; while x < w { s += a[x] as f64 + a[(h - 1) * w + x] as f64; n += 2; x += step; }
    let mut y = 0; while y < h { s += a[y * w] as f64 + a[y * w + w - 1] as f64; n += 2; y += step; }
    s / n as f64
}

/// Typical film level in signal units: the median of pixels clearly above background (above 30% of the way from
/// the background level to the 99th percentile), so it stays right however much of the image is background.
fn film_level(a: &[i32], pad: Option<i32>, sign: f64, bg: f64, st: &Stats) -> (f64, f64) {
    let hi = sign * if sign > 0.0 { st.pct(99.0) } else { st.pct(1.0) };
    let cut = bg + 0.3 * (hi - bg);
    let step = (a.len() / 300000).max(1);
    let mut sample = Vec::new();
    let mut i = 0;
    while i < a.len() { let v = a[i]; if pad != Some(v) { let sv = sign * v as f64; if sv >= cut { sample.push(sv); } } i += step; }
    if sample.is_empty() { return (sign * st.pct(50.0), 0.0); }
    sample.sort_by(|p, q| p.partial_cmp(q).unwrap());
    let l = sample.len();
    (sample[l >> 1], sample[(l as f64 * 0.75) as usize] - sample[(l as f64 * 0.25) as usize])
}

/// Background/plate levels as find_pieces uses them (signal units: multiply raw values by `sign` first).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Levels { pub sign: f64, pub bg: f64, pub base: f64, pub thr: f64, pub iqr: f64, pub has_background: bool }

pub fn plate_levels(a: &[i32], w: usize, h: usize, pad: Option<i32>, sensitivity: f64) -> Levels {
    let st = stats(a, pad);
    let sign = if border_mean(a, w, h) > st.pct(90.0) { -1.0 } else { 1.0 };
    let mut bg = sign * if sign > 0.0 { st.pct(0.1) } else { st.pct(99.9) };
    if let Some(p) = pad { let mut i = 0; while i < a.len() { if a[i] == p { bg = bg.min(sign * p as f64); break; } i += 7; } }
    let (base, iqr) = film_level(a, pad, sign, bg, &st);
    let thr = bg + (0.25 + 0.4 * sensitivity) * (base - bg);
    // Real background (no film) sits far below the film's own variation; without it, the darkest film would be
    // taken for background, so callers must not trim or measure edges.
    let mut below = 0usize; let mut i = 0;
    while i < a.len() { if sign * (a[i] as f64) < thr { below += 1; } i += 13; }
    let has_background = base - bg > 6.0 * iqr && below as f64 > 0.0005 * (a.len() as f64 / 13.0);
    Levels { sign, bg, base, thr, iqr, has_background }
}

#[derive(Clone, Debug)]
pub struct PieceOptions { pub sensitivity: f64, pub min_size: Option<f64>, pub margin: i64, pub max_tilt_deg: f64, pub padding: Option<i32> }
impl Default for PieceOptions { fn default() -> Self { PieceOptions { sensitivity: 0.6, min_size: None, margin: 0, max_tilt_deg: 2.0, padding: None } } }

/// Finds separate pieces of film or plate in a scan. The image is cut recursively ("XY-cut") wherever a band
/// averages close to background along a straight line across the whole piece; lines may tilt up to
/// max_tilt_deg, so each cut records its line and each piece is trimmed to its own edges. A gap must dip well
/// beyond the plate's own variation (6× its interquartile range), so weld bands are never split.
pub fn find_pieces(a: &[i32], w: usize, h: usize, o: &PieceOptions) -> Vec<Region> {
    let pad = o.padding;
    let st = stats(a, pad);
    if st.count == 0 { return Vec::new(); }
    let sign = if border_mean(a, w, h) > st.pct(90.0) { -1.0 } else { 1.0 }; // background normally low; flip if the border sits near the top
    let mut bg = sign * if sign > 0.0 { st.pct(0.1) } else { st.pct(99.9) };
    // Padding means "no data": when the scan has padding pixels, their value is the background level.
    if let Some(p) = pad { let mut has = false; let mut i = 0; while i < a.len() && !has { if a[i] == p { has = true; } i += 7; } if has { bg = bg.min(sign * p as f64); } }
    let base = film_level(a, pad, sign, bg, &st).0;
    let sens = o.sensitivity.clamp(0.05, 0.95);
    let thr = bg + (0.25 + 0.4 * sens) * (base - bg);
    let rel = 0.6 - 0.4 * sens;
    let min_size = (js_round(o.min_size.unwrap_or(0.02 * w.min(h) as f64)) as i64).max(16);
    let max_k = (o.max_tilt_deg * std::f64::consts::PI / 180.0).tan();
    // Signal image (background low), computed once; padding counts as background.
    let s: Vec<f32> = a.iter().map(|&v| if pad == Some(v) { bg as f32 } else { (sign * v as f64) as f32 }).collect();
    // How much the plate itself varies (interquartile range of plate pixels).
    let sstep = (s.len() / 200000).max(1);
    let mut sample: Vec<f32> = s.iter().step_by(sstep).copied().filter(|&v| v as f64 >= thr).collect();
    sample.sort_by(|p, q| p.partial_cmp(q).unwrap());
    let iqr = if sample.is_empty() { 0.0 } else { sample[(sample.len() as f64 * 0.75) as usize] as f64 - sample[(sample.len() as f64 * 0.25) as usize] as f64 };
    let min_dip = 6.0 * iqr;
    let ctx = PieceCtx { s: &s, w, bg, thr, base, rel, min_size, min_dip };
    let mut pieces: Vec<(Rect, Vec<Cut>)> = Vec::new();
    ctx.cut(Rect::new(0, 0, w as i64, h as i64), Vec::new(), 0, max_k, &mut pieces);
    let m = o.margin;
    pieces.into_iter().map(|(r, cuts)| {
        let (x0, y0) = ((r.x - m).max(0), (r.y - m).max(0));
        let (x1, y1) = ((r.x + r.w + m).min(w as i64), (r.y + r.h + m).min(h as i64));
        let rect = Rect::new(x0, y0, x1 - x0, y1 - y0);
        let cuts = cuts.into_iter().filter(|c| {
            let (s0, s1, lo, hi) = match c.axis {
                Axis::X => (c.a + c.k * rect.y as f64, c.a + c.k * (rect.y + rect.h) as f64, rect.x as f64, (rect.x + rect.w) as f64),
                Axis::Y => (c.a + c.k * rect.x as f64, c.a + c.k * (rect.x + rect.w) as f64, rect.y as f64, (rect.y + rect.h) as f64),
            };
            s0.max(s1) > lo && s0.min(s1) < hi
        }).collect();
        Region { rect, cuts }
    }).filter(|r| r.rect.w >= min_size && r.rect.h >= min_size).collect()
}

struct PieceCtx<'a> { s: &'a [f32], w: usize, bg: f64, thr: f64, base: f64, rel: f64, min_size: i64, min_dip: f64 }
impl<'a> PieceCtx<'a> {
    /// Mean along lines through rectangle r whose position along `axis` drifts by `drift` pixels across it.
    fn profile(&self, r: Rect, cuts: &[Cut], axis: Axis, drift: i64) -> Vec<f64> {
        let (len, other) = match axis { Axis::X => (r.w, r.h), Axis::Y => (r.h, r.w) };
        let mut p = vec![0f64; len.max(0) as usize];
        let mut cnt = vec![0f64; len.max(0) as usize];
        let ostep = (other / 250).max(1);
        let k = if other > 1 { drift as f64 / (other - 1) as f64 } else { 0.0 };
        let has_cuts = !cuts.is_empty();
        let mut o = 0;
        while o < other {
            let shift = js_round(k * o as f64) as i64;
            let (u0, u1) = ((-shift).max(0), (len - shift).min(len));
            match axis {
                Axis::X => {
                    let y = r.y + o; let row = y as usize * self.w + r.x as usize;
                    for u in u0..u1 { let t = u + shift; if has_cuts && !inside(cuts, (r.x + t) as f64, y as f64) { continue; } p[u as usize] += self.s[row + t as usize] as f64; cnt[u as usize] += 1.0; }
                }
                Axis::Y => {
                    let x = r.x + o;
                    // pixels across a dividing line belong to the neighbour: leave them out rather than count them as background
                    for u in u0..u1 { let t = u + shift; let y = r.y + t; if has_cuts && !inside(cuts, x as f64, y as f64) { continue; } p[u as usize] += self.s[y as usize * self.w + x as usize] as f64; cnt[u as usize] += 1.0; }
                }
            }
            o += ostep;
        }
        for u in 0..p.len() { p[u] = if cnt[u] > 0.0 { p[u] / cnt[u] } else { self.bg }; }
        p
    }
    fn gaps(&self, p: &[f64]) -> Vec<bool> {
        let n = p.len();
        let l = self.min_size.max(24) as usize;
        // local plate level: a high percentile of the profile around each position
        let mut lvl = vec![0f64; n];
        let mut win: Vec<f64> = Vec::new();
        let mut i = 0;
        while i < n {
            win.clear();
            for j in i.saturating_sub(l)..(i + l).min(n) { win.push(p[j]); }
            win.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let v = win[(win.len() as f64 * 0.8) as usize];
            for q in i..(i + 4).min(n) { lvl[q] = v; }
            i += 4;
        }
        (0..n).map(|i| {
            let dip = lvl[i] - p[i];
            (p[i] < self.thr && self.base - p[i] > self.min_dip) || (dip > self.min_dip && dip > self.rel * (lvl[i] - self.bg))
        }).collect()
    }
    fn runs(&self, p: &[f64]) -> Vec<(i64, i64)> {
        let g = self.gaps(p);
        let mut out = Vec::new();
        let mut s0: i64 = -1;
        for i in 0..=p.len() {
            let sig = i < p.len() && !g[i];
            if sig && s0 < 0 { s0 = i as i64; }
            if !sig && s0 >= 0 { if i as i64 - s0 >= self.min_size { out.push((s0, i as i64)); } s0 = -1; }
        }
        out
    }
    /// Deepest interior valley for a drift; the drift that best follows a dividing line dips deepest.
    fn valley(&self, p: &[f64]) -> f64 {
        let (mut lo, mut hi) = (0i64, p.len() as i64 - 1);
        while lo < hi && p[lo as usize] < self.thr { lo += 1; }
        while hi > lo && p[hi as usize] < self.thr { hi -= 1; }
        lo += self.min_size; hi -= self.min_size;
        let mut m = f64::INFINITY;
        let mut i = lo; while i <= hi { m = m.min(p[i as usize]); i += 1; }
        m
    }
    fn best_drift(&self, r: Rect, cuts: &[Cut], axis: Axis, max_k: f64) -> i64 {
        let other = match axis { Axis::X => r.h, Axis::Y => r.w };
        let max_d = js_round(max_k * other as f64) as i64;
        let mut best = 0i64;
        let mut bv = self.valley(&self.profile(r, cuts, axis, 0));
        let try_d = |d: i64, best: &mut i64, bv: &mut f64| { let v = self.valley(&self.profile(r, cuts, axis, d)); if v < *bv - 1e-9 { *bv = v; *best = d; } };
        let mut d = -max_d; while d <= max_d { if d != 0 { try_d(d, &mut best, &mut bv); } d += 8; }
        let c = best;
        for d in c - 7..=c + 7 { if d != c && d.abs() <= max_d { try_d(d, &mut best, &mut bv); } }
        best
    }
    fn cut(&self, r: Rect, cuts: Vec<Cut>, depth: usize, max_k: f64, pieces: &mut Vec<(Rect, Vec<Cut>)>) {
        let mut cur = r;
        // Look along both axes first and cut along the cleanest gap (closest to background), so a gap that only
        // separates some pieces is not used to cut through another.
        if depth < 6 {
            struct Opt { axis: Axis, rs: Vec<(i64, i64)>, used: i64, other: i64, depth: f64 }
            let mut options: Vec<Opt> = Vec::new();
            for axis in [Axis::X, Axis::Y] {
                let other = match axis { Axis::X => cur.h, Axis::Y => cur.w };
                let drift = self.best_drift(cur, &cuts, axis, max_k);
                let mut p = self.profile(cur, &cuts, axis, drift);
                let mut rs = self.runs(&p);
                let mut used = drift;
                if rs.len() < 2 && drift != 0 { p = self.profile(cur, &cuts, axis, 0); rs = self.runs(&p); used = 0; }
                if rs.len() >= 2 {
                    let mut gap_min = f64::INFINITY;
                    for i in rs[0].1..rs[rs.len() - 1].0 { gap_min = gap_min.min(p[i as usize]); }
                    options.push(Opt { axis, rs, used, other, depth: (gap_min - self.bg) / (self.base - self.bg).max(1e-9) });
                }
            }
            if !options.is_empty() {
                options.sort_by(|a, b| a.depth.partial_cmp(&b.depth).unwrap_or(std::cmp::Ordering::Equal));
                let Opt { axis, rs, used, other, .. } = options.swap_remove(0);
                let len = match axis { Axis::X => cur.w, Axis::Y => cur.h };
                let k = if other > 1 { used as f64 / (other - 1) as f64 } else { 0.0 };
                for (i, &(s0, s1)) in rs.iter().enumerate() {
                    // offset u at o = 0, drifting by k per step along the other axis: x = cur.x + u + k·(y − cur.y)
                    let line = |u: f64, keep_less: bool| match axis {
                        Axis::X => Cut { axis, a: cur.x as f64 + u - k * cur.y as f64, k, keep_less },
                        Axis::Y => Cut { axis, a: cur.y as f64 + u - k * cur.x as f64, k, keep_less },
                    };
                    let mut nc = cuts.clone();
                    if i > 0 { nc.push(line((rs[i - 1].1 + s0) as f64 / 2.0, false)); }
                    if i < rs.len() - 1 { nc.push(line((s1 + rs[i + 1].0) as f64 / 2.0, true)); }
                    // Each part reaches to the middle of the gaps around it (or the region edge); trimming then
                    // finds its exact edges.
                    let from = if i > 0 { (rs[i - 1].1 + s0) as f64 / 2.0 } else { 0.0 };
                    let to = if i < rs.len() - 1 { (s1 + rs[i + 1].0) as f64 / 2.0 } else { len as f64 };
                    let (lo, hi) = (from + used.min(0) as f64, to + used.max(0) as f64);
                    let (a0, a1) = ((lo.floor() as i64).max(0), (hi.ceil() as i64).min(len));
                    let nr = match axis { Axis::X => Rect::new(cur.x + a0, cur.y, a1 - a0, cur.h), Axis::Y => Rect::new(cur.x, cur.y + a0, cur.w, a1 - a0) };
                    self.cut(nr, nc, depth + 1, max_k, pieces);
                }
                return;
            }
        }
        // No split: trim to the piece's own edges (twice, as trimming one axis can reveal background on the other).
        for _ in 0..2 {
            for axis in [Axis::X, Axis::Y] {
                let rs = self.runs(&self.profile(cur, &cuts, axis, 0));
                if rs.is_empty() { return; }
                let (s0, s1) = (rs[0].0, rs[rs.len() - 1].1);
                cur = match axis { Axis::X => Rect::new(cur.x + s0, cur.y, s1 - s0, cur.h), Axis::Y => Rect::new(cur.x, cur.y + s0, cur.w, s1 - s0) };
            }
        }
        pieces.push((cur, cuts));
    }
}

/// Sets pixels of a cropped piece that lie across its dividing lines (in a neighbouring piece) to `fill`.
pub fn fill_outside_cuts(frame: &mut [i32], region: &Region, fill: i32) -> usize {
    if region.cuts.is_empty() { return 0; }
    let r = region.rect;
    let mut count = 0;
    for y in 0..r.h { for x in 0..r.w {
        if !inside(&region.cuts, (r.x + x) as f64, (r.y + y) as f64) { frame[(y * r.w + x) as usize] = fill; count += 1; }
    } }
    count
}

// ---------------------------------------------------------------- straightening
#[derive(Clone, Debug, PartialEq)]
pub struct Edge { pub side: &'static str, pub slope: f64, pub points: usize, pub span: f64, pub angle: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct Tilt { pub angle: f64, pub edges: Vec<Edge> }

fn median_of(v: &[f64]) -> f64 { let mut c = v.to_vec(); c.sort_by(|a, b| a.partial_cmp(b).unwrap()); c[c.len() >> 1] }

/// Tilt of a piece of film from its edges (where film meets background or a filled neighbour), in degrees
/// clockwise needed to straighten it. Edges lying on the frame border carry no information and are skipped.
pub fn piece_tilt(a: &[i32], w: usize, h: usize, lv: &Levels) -> Tilt {
    let sig = |i: usize| lv.sign * a[i] as f64;
    let thr = lv.thr;
    // Robust line fit: Theil–Sen on pairs half the list apart, median intercept, then least squares on the points
    // within 3× the median residual (corners and specks drop out).
    let fit = |pts: &[(f64, f64)]| -> Option<(f64, usize, f64)> {
        let n = pts.len(); let half = n >> 1;
        if n < 8 { return None; }
        let sl: Vec<f64> = (0..half).filter_map(|i| { let dt = pts[i + half].0 - pts[i].0; if dt != 0.0 { Some((pts[i + half].1 - pts[i].1) / dt) } else { None } }).collect();
        if sl.is_empty() { return None; }
        let mut k = median_of(&sl);
        let b = median_of(&pts.iter().map(|&(t, u)| u - k * t).collect::<Vec<_>>());
        let res: Vec<f64> = pts.iter().map(|&(t, u)| (u - (b + k * t)).abs()).collect();
        let cut = (3.0 * median_of(&res)).max(1.5);
        let use_: Vec<(f64, f64)> = pts.iter().zip(&res).filter(|(_, &r)| r <= cut).map(|(p, _)| *p).collect();
        if use_.len() < 8 { return None; }
        let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
        for &(t, u) in &use_ { sx += t; sy += u; sxx += t * t; sxy += t * u; }
        let nn = use_.len() as f64;
        let d = nn * sxx - sx * sx;
        if d.abs() > 1e-9 { k = (nn * sxy - sx * sy) / d; }
        Some((k, use_.len(), use_[use_.len() - 1].0 - use_[0].0))
    };
    // first crossing from background to film along a line, with sub-pixel interpolation; None at the border
    let edge_along = |len: usize, get: &dyn Fn(usize) -> f64| -> Option<f64> {
        if len == 0 { return None; }
        let sm = |i: usize| (get(i.saturating_sub(1)) + get(i) + get((i + 1).min(len - 1))) / 3.0;
        if sm(0) >= thr { return None; } // film reaches the border: no edge here
        let mut i = 1;
        while (i as i64) < len as i64 - 3 {
            if sm(i) >= thr && sm(i + 2) >= thr { let (p, q) = (sm(i - 1), sm(i)); return Some(i as f64 - 1.0 + (thr - p) / (q - p).max(1e-9)); }
            i += 1;
        }
        None
    };
    let step = (w.max(h) / 600).max(1);
    let mut edges = Vec::new();
    for side in ["left", "right", "top", "bottom"] {
        let (along, across) = if side == "left" || side == "right" { (h, w) } else { (w, h) };
        let mut pts = Vec::new();
        let mut o = 0;
        while o < along {
            let get = |i: usize| match side { "left" => sig(o * w + i), "right" => sig(o * w + (w - 1 - i)), "top" => sig(i * w + o), _ => sig((h - 1 - i) * w + o) };
            if let Some(e) = edge_along(across, &get) { if e < across as f64 * 0.45 { pts.push((o as f64, e)); } }
            o += step;
        }
        if (pts.len() as f64) < (8f64).max(along as f64 / step as f64 * 0.3) { continue; } // edge must run along most of the piece
        let Some((k, n, span)) = fit(&pts) else { continue };
        // left: x = a + k·y needs φ = atan(k); right edge measured from the right flips k; top: y = b + m·x needs
        // φ = atan(−m); bottom measured from the bottom flips m again.
        let slope = match side { "left" => k, "right" => -k, "top" => -k, _ => k };
        edges.push(Edge { side, slope, points: n, span, angle: slope.atan() * 180.0 / std::f64::consts::PI });
    }
    if edges.is_empty() { return Tilt { angle: 0.0, edges }; }
    // weight by how much of the piece each edge covers; drop edges that disagree with the strongest by > 0.75°
    edges.sort_by(|p, q| (q.points as f64 * q.span).partial_cmp(&(p.points as f64 * p.span)).unwrap_or(std::cmp::Ordering::Equal));
    let first = edges[0].angle;
    let (mut wsum, mut asum) = (0.0, 0.0);
    for e in edges.iter().filter(|e| (e.angle - first).abs() <= 0.75) { let wgt = e.points as f64 * e.span; wsum += wgt; asum += wgt * e.angle; }
    Tilt { angle: asum / wsum, edges }
}

/// Rotates a frame clockwise (on screen, y down) by `deg` degrees with bicubic (Catmull-Rom) interpolation onto a
/// canvas large enough to hold it; uncovered pixels get `fill`. Values are clamped to [lo, hi].
/// Clockwise by φ maps x' = x·cosφ − y·sinφ, y' = x·sinφ + y·cosφ, so an edge x = a + k·y needs φ = atan(k).
pub fn rotate_by(a: &[i32], w: usize, h: usize, deg: f64, fill: i32, lo: i32, hi: i32) -> (Vec<i32>, usize, usize) {
    let t = deg * std::f64::consts::PI / 180.0;
    let (c, s) = (t.cos(), t.sin());
    let ww = ((w as f64 * c).abs() + (h as f64 * s).abs() - 1e-6).ceil() as usize;
    let hh = ((w as f64 * s).abs() + (h as f64 * c).abs() - 1e-6).ceil() as usize;
    let (cx, cy, ccx, ccy) = ((w as f64 - 1.0) / 2.0, (h as f64 - 1.0) / 2.0, (ww as f64 - 1.0) / 2.0, (hh as f64 - 1.0) / 2.0);
    let cub = |p0: f64, p1: f64, p2: f64, p3: f64, x: f64| p1 + 0.5 * x * (p2 - p0 + x * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + x * (3.0 * (p1 - p2) + p3 - p0)));
    let px = |x: i64, y: i64| a[y.clamp(0, h as i64 - 1) as usize * w + x.clamp(0, w as i64 - 1) as usize] as f64;
    let mut out = vec![0i32; ww * hh];
    for yy in 0..hh { for xx in 0..ww {
        // inverse mapping: rotate the output position back by −φ
        let (dx, dy) = (xx as f64 - ccx, yy as f64 - ccy);
        let (x, y) = (c * dx + s * dy + cx, -s * dx + c * dy + cy);
        if x < -0.5 || y < -0.5 || x > w as f64 - 0.5 || y > h as f64 - 0.5 { out[yy * ww + xx] = fill; continue; }
        let (xi, yi) = (x.floor() as i64, y.floor() as i64);
        let (fx, fy) = (x - xi as f64, y - yi as f64);
        let col: Vec<f64> = (-1..=2).map(|j| cub(px(xi - 1, yi + j), px(xi, yi + j), px(xi + 1, yi + j), px(xi + 2, yi + j), fx)).collect();
        let v = cub(col[0], col[1], col[2], col[3], fy);
        out[yy * ww + xx] = if v < lo as f64 { lo } else if v > hi as f64 { hi } else { js_round(v) as i32 };
    } }
    (out, ww, hh)
}

/// The largest rectangle that is film throughout. Fill pixels are never kept; dark film near an edge is allowed up
/// to `tolerance` of a row or column. Edges are trimmed worst first, by their share of non-film.
pub fn inner_film_rect(a: &[i32], w: usize, h: usize, lv: &Levels, fill: i32, tolerance: f64) -> Rect {
    let (mut x0, mut y0, mut x1, mut y1) = (0usize, 0usize, w, h);
    let line = |n0: usize, n1: usize, at: &dyn Fn(usize) -> usize| {
        let (mut bg, mut f) = (0usize, 0usize);
        for i in n0..n1 { let v = a[at(i)]; if v == fill { f += 1; } else if lv.sign * (v as f64) < lv.thr { bg += 1; } }
        let n = (n1 - n0) as f64;
        ((bg + f) as f64 / n, f, bg as f64 / n)
    };
    while x1 - x0 > 2 && y1 - y0 > 2 {
        let l = [line(y0, y1, &|y| y * w + x0), line(y0, y1, &|y| y * w + x1 - 1), line(x0, x1, &|x| y0 * w + x), line(x0, x1, &|x| (y1 - 1) * w + x)];
        if l.iter().all(|e| e.1 == 0 && e.2 <= tolerance) { break; }
        let mut i = 0; for k in 1..4 { if l[k].0 > l[i].0 { i = k; } }
        if l[i].0 == 0.0 { i = l.iter().position(|e| e.1 > 0).unwrap_or(0); } // only isolated fill left: take that edge
        match i { 0 => x0 += 1, 1 => x1 -= 1, 2 => y0 += 1, _ => y1 -= 1 }
    }
    Rect::new(x0 as i64, y0 as i64, (x1 - x0) as i64, (y1 - y0) as i64)
}

#[derive(Clone, Debug)]
pub struct Straightened { pub img: Image, pub angle: f64, pub measured: f64, pub edges: Vec<Edge>, pub rotated: bool, pub crop: Rect, pub too_steep: bool, pub no_background: bool }

/// Straightens one piece of film and crops it to the film. Pixels across a cut belong to a neighbour and are
/// treated as background. Rotation is applied only between 0.05° and max_deg.
pub fn straighten_piece(img: &Image, region: &Region, levels: Option<Levels>, max_deg: f64, tolerance: f64, margin: i64) -> Result<Straightened, String> {
    let lv = levels.unwrap_or_else(|| plate_levels(&img.frames[0], img.cols, img.rows, img.padding, 0.6));
    let fill = img.padding.unwrap_or(js_round(lv.sign * lv.bg) as i32);
    let piece = crop(img, region.rect)?;
    let frames: Vec<Vec<i32>> = piece.frames.iter().map(|f| { let mut c = f.clone(); if !region.cuts.is_empty() { let r = Region { rect: Rect::new(region.rect.x.max(0), region.rect.y.max(0), piece.cols as i64, piece.rows as i64), cuts: region.cuts.clone() }; fill_outside_cuts(&mut c, &r, fill); } c }).collect();
    // No real background (e.g. a hand-drawn part inside the film): nothing to measure or trim; keep it as drawn.
    if !lv.has_background && region.cuts.is_empty() {
        let (c, r) = (piece.cols as i64, piece.rows as i64);
        return Ok(Straightened { img: piece.with_frames(piece.rows, piece.cols, frames), angle: 0.0, measured: 0.0, edges: Vec::new(), rotated: false, crop: Rect::new(0, 0, c, r), too_steep: false, no_background: true });
    }
    let tilt = piece_tilt(&frames[0], piece.cols, piece.rows, &lv);
    let do_rotate = tilt.angle.abs() >= 0.05 && tilt.angle.abs() <= max_deg;
    let (mut ww, mut hh, mut out) = (piece.cols, piece.rows, frames);
    if do_rotate {
        out = out.iter().map(|f| { let (fr, w2, h2) = rotate_by(f, piece.cols, piece.rows, tilt.angle, fill, img.min, img.max); ww = w2; hh = h2; fr }).collect();
    }
    let inner = inner_film_rect(&out[0], ww, hh, &lv, fill, tolerance);
    let m = margin;
    let x = (inner.x - m).max(0); let y = (inner.y - m).max(0);
    let r = Rect::new(x, y, (inner.x + inner.w + m).min(ww as i64) - x, (inner.y + inner.h + m).min(hh as i64) - y);
    let res = crop(&img.with_frames(hh, ww, out), r)?;
    Ok(Straightened { img: res, angle: if do_rotate { tilt.angle } else { 0.0 }, measured: tilt.angle, edges: tilt.edges, rotated: do_rotate, crop: r, too_steep: tilt.angle.abs() > max_deg, no_background: false })
}

// ---------------------------------------------------------------- scratches
/// Which way "less radiation" goes: towards the no-signal (background) level. On raw CR/DR data that is low values
/// (+1); if the image border sits near the top of the range it is high (−1). Plate scratches and dust read as less
/// radiation; cracks, lack of fusion, porosity and undercut read as more radiation.
pub fn less_radiation_sign(a: &[i32], w: usize, h: usize, pad: Option<i32>) -> f64 {
    let st = stats(a, pad);
    if border_mean(a, w, h) > st.pct(90.0) { -1.0 } else { 1.0 }
}

/// Pixel noise: robust spread of each pixel's difference from the mean of its left/right neighbours.
pub fn noise_level(a: &[i32], w: usize, h: usize, pad: Option<i32>) -> f64 {
    let step = ((w * h) / 200000).max(1);
    let mut d = Vec::new();
    let mut i = w + 1;
    while i + w + 1 < w * h {
        let x = i % w;
        if x >= 1 && x <= w - 2 && !(pad.map_or(false, |p| a[i] == p || a[i - 1] == p || a[i + 1] == p)) {
            d.push((a[i] as f64 - (a[i - 1] as f64 + a[i + 1] as f64) / 2.0).abs());
        }
        i += step;
    }
    if d.is_empty() { return 1.0; }
    d.sort_by(|p, q| p.partial_cmp(q).unwrap());
    (1.4826 * d[d.len() >> 1] / 1.5f64.sqrt()).max(1.0)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment { pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64 }
#[derive(Clone, Copy, Debug)]
pub struct ScratchOptions { pub band: f64, pub max_width: f64, pub sign: f64, pub min: i32, pub max: i32, pub padding: Option<i32>, pub noise: f64, pub min_contrast: f64 }

/// Repairs a thin scratch along a drawn segment. At each step along it, a run at most max_width wide that reads as
/// less radiation than the plate on BOTH sides by more than 4× the noise is replaced by a straight interpolation.
/// Features reading as more radiation (cracks, voids) and plain edges are never changed. Returns (frame, count).
pub fn repair_scratch(a: &[i32], w: usize, h: usize, seg: Segment, o: &ScratchOptions) -> (Vec<i32>, usize) {
    let mut out = a.to_vec();
    let b = (js_round(o.band) as i64).max(4);
    let max_w = (js_round(o.max_width) as i64).max(1);
    let sign = if o.sign == 0.0 { 1.0 } else { o.sign };
    let (dx, dy) = (seg.x1 - seg.x0, seg.y1 - seg.y0);
    let vertical = dy.abs() >= dx.abs();
    let len = (js_round(dx.abs().max(dy.abs())) as i64).max(1);
    let half = (max_w as f64 / 2.0).ceil() as i64 + 1;
    let n = (2 * b + 1) as usize;
    let mut vals = vec![0f64; n];
    let mut idx = vec![0usize; n];
    let mut count = 0;
    let bi = |d: i64| (d + b) as usize;
    for i in 0..=len {
        let cx = js_round(seg.x0 + dx * i as f64 / len as f64) as i64;
        let cy = js_round(seg.y0 + dy * i as f64 / len as f64) as i64;
        let mut ok = true;
        for d in -b..=b {
            let (x, y) = if vertical { (cx + d, cy) } else { (cx, cy + d) };
            if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 { ok = false; break; }
            let k = y as usize * w + x as usize;
            idx[bi(d)] = k; vals[bi(d)] = sign * a[k] as f64;
            if o.padding == Some(a[k]) { ok = false; break; }
        }
        if !ok { continue; }
        let (mut left, mut right) = (Vec::new(), Vec::new());
        for d in half..=b { left.push(vals[bi(-d)]); right.push(vals[bi(d)]); }
        let (ml, mr) = (median_of(&left), median_of(&right));
        let rf = ml.min(mr);
        let noise = if o.noise > 0.0 { o.noise } else {
            let both: Vec<f64> = left.iter().chain(&right).copied().collect();
            let md = median_of(&both);
            let v = 1.4826 * median_of(&both.iter().map(|v| (v - md).abs()).collect::<Vec<_>>());
            if v == 0.0 { 1.0 } else { v }
        };
        let thr = o.min_contrast.max(4.0 * noise);
        // Never repair next to a feature reading as more radiation (a crack, void or undercut).
        if (-b..=b).any(|d| vals[bi(d)] - ml.max(mr) > thr) { continue; }
        // deepest point near the centre, then the run around it
        let (mut c, mut best) = (0i64, f64::NEG_INFINITY);
        for d in -half + 1..half { let depth = rf - vals[bi(d)]; if depth > best { best = depth; c = d; } }
        if best <= thr { continue; }
        let (mut l, mut r) = (c, c);
        while l - 1 > -half && rf - vals[bi(l - 1)] > thr * 0.5 { l -= 1; }
        while r + 1 < half && rf - vals[bi(r + 1)] > thr * 0.5 { r += 1; }
        if r - l + 1 > max_w { continue; }
        let vl = sign * (vals[bi(l - 1)] + vals[bi(l - 2)]) / 2.0;
        let vr = sign * (vals[bi(r + 1)] + vals[bi(r + 2)]) / 2.0;
        for d in l..=r {
            let t = (d - l + 1) as f64 / (r - l + 2) as f64;
            let v = vl + (vr - vl) * t;
            out[idx[bi(d)]] = (js_round(v) as i64).clamp(o.min as i64, o.max as i64) as i32;
            count += 1;
        }
    }
    (out, count)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Scratch { pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub coverage: f64 }

/// Finds long, straight, thin scratches up to max_tilt_deg from vertical or horizontal: lines reading as less
/// radiation than the plate on both sides through most of their length, at least min_length long. Gaps between
/// pieces are left alone; IQI wires and markers are far shorter than min_length. Nothing is changed here.
pub fn find_scratches(a: &[i32], w: usize, h: usize, pad: Option<i32>, sign: Option<f64>, min_length: Option<f64>, min_coverage: f64, max_tilt_deg: f64) -> Vec<Scratch> {
    let sign = sign.unwrap_or_else(|| less_radiation_sign(a, w, h, pad));
    let st = stats(a, pad);
    let bg_level = if sign > 0.0 { st.pct(0.1) } else { st.pct(99.9) };
    let base = st.pct(50.0);
    let min_len = min_length.unwrap_or(js_round(0.5 * w.max(h) as f64));
    let max_k = (max_tilt_deg * std::f64::consts::PI / 180.0).tan();
    let mut found = Vec::new();
    for vertical in [true, false] {
        let (ww, hh) = if vertical { (w, h) } else { (h, w) }; // scan lines run along hh
        let get = |x: usize, y: usize| if vertical { a[y * w + x] } else { a[x * w + y] };
        if ww < 18 { continue; }
        let mut s = vec![0f32; ww * hh];
        let mut cs = vec![0f64; ww + 1];
        let plate_min = sign * bg_level + 0.5 * (sign * base - sign * bg_level);
        for y in 0..hh {
            cs[0] = 0.0;
            for x in 0..ww { cs[x + 1] = cs[x] + sign * get(x, y) as f64; }
            for x in 8..ww - 8 {
                let v = sign * get(x, y) as f64;
                let l = (cs[x - 2] - cs[x - 8]) / 6.0;
                let r = (cs[x + 9] - cs[x + 3]) / 6.0;
                // only on plate: both sides well above background (excludes plate edges and unexposed areas)
                s[y * ww + x] = if pad == Some(get(x, y)) || l.min(r) < plate_min { 0.0 } else { (l.min(r) - v) as f32 };
            }
        }
        let mut sample: Vec<f32> = s.iter().step_by(97).map(|v| v.abs()).collect();
        sample.sort_by(|p, q| p.partial_cmp(q).unwrap());
        // at least 4× the noise and 1.5% of the plate-to-background range (smooth CR data has very little noise)
        let noise = (1.4826 * sample[sample.len() >> 1] as f64).max(1.0);
        let thr = (4.0 * noise).max(0.015 * (base - bg_level).abs()) as f32;
        const BL: usize = 32;
        let nb = hh / BL;
        if nb < 2 { continue; }
        // per block, per column: fraction of rows where the pixel (or a neighbour) is line-like
        let mut cov = vec![0f32; nb * ww];
        for bk in 0..nb { for y in bk * BL..(bk + 1) * BL { for x in 9..ww - 9 {
            let i = y * ww + x;
            if s[i] > thr || s[i - 1] > thr || s[i + 1] > thr { cov[bk * ww + x] += 1.0 / BL as f32; }
        } } }
        struct Cand { x0: i64, d: i64, first: usize, last: usize, cov: f64, score: usize }
        let max_d = js_round(max_k * hh as f64) as i64;
        let mut cand = Vec::new();
        let mut d = -max_d;
        while d <= max_d {
            for x0 in 9..ww as i64 - 9 {
                let (mut hit, mut first, mut last) = (0usize, -1i64, -1i64);
                for bk in 0..nb {
                    let x = js_round(x0 as f64 + d as f64 * ((bk as f64 + 0.5) * BL as f64) / hh as f64) as i64;
                    if x < 9 || x >= ww as i64 - 9 { continue; }
                    if cov[bk * ww + x as usize] >= 0.5 { hit += 1; if first < 0 { first = bk as i64; } last = bk as i64; }
                }
                if first < 0 { continue; }
                let span = (last - first + 1) as usize;
                let c = hit as f64 / span as f64;
                if (span * BL) as f64 >= min_len && c >= min_coverage { cand.push(Cand { x0, d, first: first as usize, last: last as usize, cov: c, score: hit }); }
            }
            d += 2;
        }
        // keep the strongest of nearby candidates (same scratch seen at neighbouring columns or tilts)
        cand.sort_by(|p, q| q.score.cmp(&p.score).then(q.cov.partial_cmp(&p.cov).unwrap_or(std::cmp::Ordering::Equal)));
        let mut kept: Vec<&Cand> = Vec::new();
        for c in &cand {
            let xm = c.x0 as f64 + c.d as f64 / 2.0;
            if kept.iter().any(|k| (k.x0 as f64 + k.d as f64 / 2.0 - xm).abs() < 8.0) { continue; }
            // skip gaps between pieces: along most of its length the line drops below 60% of the way from background
            // to the plate level (the thin gap between two strips does; a phosphor scratch does not)
            let (mut gap_like, mut n) = (0usize, 0usize);
            let mut y = c.first * BL;
            while y < (c.last + 1) * BL {
                let x = js_round(c.x0 as f64 + c.d as f64 * y as f64 / hh as f64) as i64;
                if x >= 4 && x < ww as i64 - 4 {
                    let mut m = f64::INFINITY;
                    for q in -4..=4 { m = m.min(sign * get((x + q) as usize, y) as f64); }
                    if m - sign * bg_level < 0.6 * (sign * base - sign * bg_level) { gap_like += 1; }
                    n += 1;
                }
                y += 7;
            }
            if n == 0 || gap_like as f64 / n as f64 > 0.5 { continue; }
            kept.push(c);
        }
        for c in kept {
            let (y0, y1) = ((c.first * BL) as f64, ((c.last + 1) * BL - 1) as f64);
            let (xa, xb) = (c.x0 as f64 + c.d as f64 * y0 / hh as f64, c.x0 as f64 + c.d as f64 * y1 / hh as f64);
            let coverage = js_round(c.cov * 100.0) / 100.0;
            found.push(if vertical { Scratch { x0: xa, y0, x1: xb, y1, coverage } } else { Scratch { x0: y0, y0: xa, x1: y1, y1: xb, coverage } });
        }
    }
    found
}

// ---------------------------------------------------------------- display-only view rotation
/// View rotation (0/90/180/270° clockwise): size of the rotated frame.
pub fn view_dims(cols: f64, rows: f64, rot: u32) -> (f64, f64) { if rot % 180 != 0 { (rows, cols) } else { (cols, rows) } }
pub fn to_view(x: f64, y: f64, cols: f64, rows: f64, rot: u32) -> (f64, f64) {
    match rot { 90 => (rows - y, x), 180 => (cols - x, rows - y), 270 => (y, cols - x), _ => (x, y) }
}
pub fn from_view(x: f64, y: f64, cols: f64, rows: f64, rot: u32) -> (f64, f64) {
    match rot { 90 => (y, rows - x), 180 => (cols - x, rows - y), 270 => (cols - y, x), _ => (x, y) }
}
/// Axis-aligned rectangle of an image-space box in the rotated frame: (x, y, w, h).
pub fn rect_to_view(r: Rect, cols: f64, rows: f64, rot: u32) -> (f64, f64, f64, f64) {
    let a = to_view(r.x as f64, r.y as f64, cols, rows, rot);
    let b = to_view((r.x + r.w) as f64, (r.y + r.h) as f64, cols, rows, rot);
    (a.0.min(b.0), a.1.min(b.1), (b.0 - a.0).abs(), (b.1 - a.1).abs())
}
/// Rotates 8-bit display data clockwise by a view rotation.
pub fn rotate_view_u8(g: &[u8], w: usize, h: usize, rot: u32) -> (Vec<u8>, usize, usize) {
    if rot % 360 == 0 { return (g.to_vec(), w, h); }
    let (nw, nh) = if rot % 180 != 0 { (h, w) } else { (w, h) };
    let mut o = vec![0u8; g.len()];
    for y in 0..h { for x in 0..w {
        let (nx, ny) = match rot { 90 => (h - 1 - y, x), 180 => (w - 1 - x, h - 1 - y), _ => (y, w - 1 - x) };
        o[ny * nw + nx] = g[y * w + x];
    } }
    (o, nw, nh)
}
