//! Reads the lead location numbers on a radiograph (the number belt: 0, 7, 14 …) to suggest a shot's coverage.
//!
//! This is a suggestion for the user to confirm, never a measurement: digits are matched against templates
//! rendered from a font (tools/digit-templates), and a row only counts as a number belt when its numbers sit at
//! an even pitch and rise by a constant step. Misread digits are then corrected from the rest of the row.
use crate::imaging as im;

const TW: usize = 20;
const TH: usize = 28;
static DIGITS: &[u8] = include_bytes!("marker_digits.bin");

/// One number read from the image, in the reading orientation.
#[derive(Clone, Debug)]
pub struct Read { pub x: f64, pub y: f64, pub h: f64, pub value: u32, pub score: f64 }

/// A row of location numbers. `first`/`last` are the numbers at its ends after the row check; `confidence` is the
/// share of the reads that agree with the fitted progression.
#[derive(Clone, Debug, PartialEq)]
pub struct Belt { pub first: u32, pub last: u32, pub step: u32, pub confidence: f64, pub reads: usize, pub wraps: bool, pub y: f64 }

/// "0-35", or "0-35, 35-70" when the image holds more than one row of numbers.
pub fn coverage_text(belts: &[Belt]) -> String { belts.iter().map(|b| format!("{}-{}", b.first, b.last)).collect::<Vec<_>>().join(", ") }

/// One font-rendered digit template (20×28, one byte per pixel); `font` 0 or 1.
pub fn digit_bitmap(font: usize, digit: usize) -> &'static [u8] { let o = (font * 10 + digit) * TW * TH; &DIGITS[o..o + TW * TH] }

fn templates() -> Vec<Vec<Vec<f32>>> {
    DIGITS.chunks(10 * TW * TH).map(|font| font.chunks(TW * TH).map(|t| normalise(t.iter().map(|&v| v as f32).collect())).collect()).collect()
}
fn normalise(mut v: Vec<f32>) -> Vec<f32> {
    let n = v.len() as f32;
    let mean = v.iter().sum::<f32>() / n;
    let sd = (v.iter().map(|x| (x - mean) * (x - mean)).sum::<f32>() / n).sqrt() + 1e-6;
    for x in v.iter_mut() { *x = (*x - mean) / sd; }
    v
}
/// Area-average resample of a w×h patch to TW×TH.
fn resample(p: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0f32; TW * TH];
    let (sx, sy) = (w as f64 / TW as f64, h as f64 / TH as f64);
    for ty in 0..TH {
        let (y0, y1) = (ty as f64 * sy, (ty + 1) as f64 * sy);
        for tx in 0..TW {
            let (x0, x1) = (tx as f64 * sx, (tx + 1) as f64 * sx);
            let (mut acc, mut wt) = (0f64, 0f64);
            let mut y = y0.floor() as usize;
            while (y as f64) < y1 && y < h {
                let wy = (y1.min(y as f64 + 1.0) - y0.max(y as f64)).max(0.0);
                let mut x = x0.floor() as usize;
                while (x as f64) < x1 && x < w {
                    let wx = (x1.min(x as f64 + 1.0) - x0.max(x as f64)).max(0.0);
                    acc += p[y * w + x] as f64 * wx * wy; wt += wx * wy; x += 1;
                }
                y += 1;
            }
            out[ty * TW + tx] = if wt > 0.0 { (acc / wt) as f32 } else { 0.0 };
        }
    }
    out
}
/// Best digit for a tight patch: (digit, correlation).
fn read_digit(t: &[Vec<Vec<f32>>], p: &[f32], w: usize, h: usize) -> (u32, f64) {
    let (p, w) = if (w as f64) < 0.45 * h as f64 {   // a narrow "1": centre it in a typical digit box
        let pad = ((0.6 * h as f64 - w as f64) / 2.0) as usize; let nw = w + 2 * pad;
        let mut q = vec![0f32; nw * h];
        for y in 0..h { q[y * nw + pad..y * nw + pad + w].copy_from_slice(&p[y * w..y * w + w]); }
        (q, nw)
    } else { (p.to_vec(), w) };
    let c = normalise(resample(&p, w, h));
    let mut best = (0u32, f64::MIN);
    for font in t { for (dg, tp) in font.iter().enumerate() {
        let s = c.iter().zip(tp).map(|(a, b)| (a * b) as f64).sum::<f64>() / (TW * TH) as f64;
        if s > best.1 { best = (dg as u32, s); }
    } }
    best
}

/// Best reading of a group of marker blobs: tries one to three digits, cutting at the weakest columns.
/// `g` is the group's patch (less radiation positive, clipped at 0). Returns (value, lowest digit score).
fn read_number(t: &[Vec<Vec<f32>>], g: &[f32], w: usize, h: usize, thr: f32) -> Option<(u32, f64)> {
    let hf = h as f64;
    let sums: Vec<f32> = (0..w).map(|x| (0..h).map(|y| g[y * w + x]).sum()).collect();
    let col = im::gaussian(&sums, w, 1, 2.0);
    let cmax = col.iter().cloned().fold(0f32, f32::max).max(1e-6) as f64;
    let mins: Vec<usize> = (2..w.saturating_sub(2)).filter(|&i| col[i] <= col[i - 1] && col[i] <= col[i + 1]).collect();
    let mut best: Option<(f64, u32, f64)> = None;
    for nd in 1..=3usize {
        if (w as f64) < nd as f64 * 0.22 * hf || w as f64 > nd as f64 * 1.05 * hf + 0.2 * hf { continue; }
        let mut cands: Vec<Vec<usize>> = Vec::new();
        match nd {
            1 => cands.push(vec![]),
            2 => for &a in &mins { cands.push(vec![a]); },
            _ => for (i, &a) in mins.iter().enumerate() { for &b in &mins[i + 1..] { cands.push(vec![a, b]); } },
        }
        for cuts in cands {
            let mut e = vec![0usize]; e.extend(&cuts); e.push(w);
            if (0..nd).any(|i| ((e[i + 1] - e[i]) as f64) < 0.2 * hf) { continue; }
            let mut digs: Vec<(u32, f64)> = Vec::new();
            for i in 0..nd {
                let (a, b) = (e[i], e[i + 1]);
                let xs: Vec<usize> = (a..b).filter(|&x| (0..h).any(|y| g[y * w + x] > thr)).collect();
                let ys: Vec<usize> = (0..h).filter(|&y| (a..b).any(|x| g[y * w + x] > thr)).collect();
                if xs.len() < 3 || (ys.len() as f64) < 0.6 * hf { digs.clear(); break; }
                let (x0, x1, y0, y1) = (xs[0], xs[xs.len() - 1] + 1, ys[0], ys[ys.len() - 1] + 1);
                let (pw, ph) = (x1 - x0, y1 - y0);
                let mut p = Vec::with_capacity(pw * ph);
                for y in y0..y1 { p.extend_from_slice(&g[y * w + x0..y * w + x1]); }
                digs.push(read_digit(t, &p, pw, ph));
            }
            if digs.is_empty() { continue; }
            let cut_cost = if nd > 1 { cuts.iter().map(|&c| col[c] as f64).sum::<f64>() / (cmax * (nd - 1) as f64) } else { 0.0 };
            let score = digs.iter().map(|d| d.1).sum::<f64>() / nd as f64 - 0.25 * cut_cost;
            if best.map_or(true, |b| score > b.0) {
                best = Some((score, digs.iter().fold(0, |v, d| v * 10 + d.0), digs.iter().map(|d| d.1).fold(f64::MAX, f64::min)));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}

/// The "less radiation" detail map of an image and the blobs in it that could be lead characters.
struct Blobs { d: Vec<f32>, w: usize, h: usize, thr: f32, boxes: Vec<(usize, usize, usize, usize, usize)> }

fn blobs(a: &[i32], w: usize, h: usize, pad: Option<i32>, k: f64) -> Blobs {
    let lv = im::plate_levels(a, w, h, pad, 0.6);
    let film_thr = lv.bg + 0.6 * (lv.base - lv.bg);
    let is_film = |v: i32| pad != Some(v) && (!lv.has_background || lv.sign * v as f64 > film_thr);
    let vf: Vec<f32> = a.iter().map(|&v| if is_film(v) { (lv.sign * v as f64) as f32 } else { lv.base as f32 }).collect();
    let blur = |src: &[f32], sigma: f64| { let r = (((4.0 * sigma * sigma + 1.0).sqrt() - 1.0) / 2.0).round().max(1.0) as usize; let mut o = im::box_blur(src, w, h, r); for _ in 0..2 { o = im::box_blur(&o, w, h, r); } o };
    let fine = blur(&vf, 2.5 * k);
    let mut d = blur(&vf, 45.0 * k);
    for (o, f) in d.iter_mut().zip(&fine) { *o -= *f; }          // positive where the film saw less radiation than its surroundings
    drop(fine);
    // keep clear of the film's edge, where the step to background would read as a marker
    let mask: Vec<f32> = a.iter().map(|&v| if is_film(v) { 1.0 } else { 0.0 }).collect();
    let inner = im::box_blur(&mask, w, h, (4.0 * k).round().max(1.0) as usize);
    let mut sample: Vec<f32> = (0..w * h).step_by(7).filter(|&i| inner[i] > 0.999).map(|i| d[i]).collect();
    let mut thr = 18.0f32;
    if sample.len() > 100 {
        let mid = sample.len() / 2;
        let med = *sample.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap()).1;
        for v in sample.iter_mut() { *v = (*v - med).abs(); }
        let mad = *sample.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap()).1;
        thr = thr.max(3.5 * 1.4826 * mad);
    }
    // 8-connected components of the thresholded map
    let mut seen = vec![false; w * h];
    let mut boxes = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let on = |i: usize| d[i] > thr && inner[i] > 0.999;
    for start in 0..w * h {
        if seen[start] || !on(start) { continue; }
        let (mut x0, mut x1, mut y0, mut y1, mut area) = (w, 0usize, h, 0usize, 0usize);
        seen[start] = true; stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            x0 = x0.min(x); x1 = x1.max(x); y0 = y0.min(y); y1 = y1.max(y); area += 1;
            for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) { for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                let j = ny * w + nx;
                if !seen[j] && on(j) { seen[j] = true; stack.push(j); }
            } }
        }
        let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
        let (lo, hi) = (8.0 * k, 200.0 * k);
        if area as f64 > 150.0 * k * k && (bw as f64) >= lo && (bw as f64) <= hi && (bh as f64) >= lo && (bh as f64) <= hi { boxes.push((x0, y0, bw, bh, area)); }
    }
    Blobs { d, w, h, thr, boxes }
}

/// Numbers readable when the image is turned `turns` quarter turns counter-clockwise.
fn reads_at(b: &Blobs, t: &[Vec<Vec<f32>>], turns: u32, k: f64) -> Vec<Read> {
    let (w, h) = (b.w, b.h);
    // box and pixel mapping between the source and the turned image
    let turn_box = |&(x, y, bw, bh, _): &(usize, usize, usize, usize, usize)| match turns { 1 => (y, w - x - bw, bh, bw), 2 => (w - x - bw, h - y - bh, bw, bh), 3 => (h - y - bh, x, bh, bw), _ => (x, y, bw, bh) };
    let src = |xr: usize, yr: usize| match turns { 1 => (w - 1 - yr, xr), 2 => (w - 1 - xr, h - 1 - yr), 3 => (yr, h - 1 - xr), _ => (xr, yr) };
    let mut comps: Vec<(usize, usize, usize, usize)> = b.boxes.iter().map(turn_box).filter(|c| c.3 as f64 >= 40.0 * k && c.3 as f64 <= 140.0 * k).collect();
    comps.sort();
    let mut groups: Vec<(usize, usize, usize, usize)> = Vec::new();
    for &(x, y, cw, ch) in &comps {
        let mut joined = false;
        for g in groups.iter_mut() {
            let (gx, gy, gw, gh) = *g;
            let (cy, gcy) = (y as f64 + ch as f64 / 2.0, gy as f64 + gh as f64 / 2.0);
            let ratio = ch as f64 / gh as f64;
            if (cy - gcy).abs() < 0.35 * ch.max(gh) as f64 && ratio > 0.6 && ratio < 1.6 && x >= gx && (x as f64 - (gx + gw) as f64) < 0.45 * gh as f64 {
                let (nx, ny) = (gx.min(x), gy.min(y));
                *g = (nx, ny, (gx + gw).max(x + cw) - nx, (gy + gh).max(y + ch) - ny); joined = true; break;
            }
        }
        if !joined { groups.push((x, y, cw, ch)); }
    }
    let mut out = Vec::new();
    for (gx, gy, gw, gh) in groups {
        if gw as f64 > 3.4 * gh as f64 { continue; }
        let mut g = Vec::with_capacity(gw * gh);
        for yr in gy..gy + gh { for xr in gx..gx + gw { let (sx, sy) = src(xr, yr); g.push(b.d[sy * w + sx].max(0.0)); } }
        if let Some((value, score)) = read_number(t, &g, gw, gh, b.thr) {
            out.push(Read { x: gx as f64 + gw as f64 / 2.0, y: gy as f64 + gh as f64 / 2.0, h: gh as f64, value, score });
        }
    }
    out
}

/// Groups reads into rows and keeps the rows that behave like a number belt: even pitch, constant step.
/// The belt may pass zero part-way along (numbers running round a pipe: … 119, 126, 0, 7).
pub fn fit_rows(reads: &[Read]) -> Vec<Belt> {
    let mut sorted: Vec<&Read> = reads.iter().filter(|r| r.score > 0.3).collect();
    sorted.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap());
    let mut rows: Vec<Vec<&Read>> = Vec::new();
    for r in sorted {
        match rows.iter_mut().find(|row| (row[row.len() - 1].y - r.y).abs() < r.h) { Some(row) => row.push(r), None => rows.push(vec![r]) }
    }
    let mut out = Vec::new();
    for mut row in rows {
        row.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        if row.len() < 3 { continue; }
        let dx: Vec<f64> = row.windows(2).map(|p| p[1].x - p[0].x).collect();
        let pitch = { let mut s = dx.clone(); s.sort_by(|a, b| a.partial_cmp(b).unwrap()); s[s.len() / 2] };
        if pitch < 4.0 * row[0].h { continue; }
        if dx.iter().any(|v| (v / pitch - (v / pitch).round()).abs() > 0.25) { continue; }
        let mut k = vec![0i64];
        for v in &dx { k.push(k[k.len() - 1] + ((v / pitch).round() as i64).max(1)); }
        let n: Vec<i64> = row.iter().map(|r| r.value as i64).collect();
        // step: the value difference per position that most pairs agree on
        let mut steps: std::collections::BTreeMap<i64, f64> = Default::default();
        for i in 0..row.len() { for j in i + 1..row.len() {
            let (dv, dk) = (n[j] - n[i], k[j] - k[i]);
            if dv > 0 && dv % dk == 0 && dv / dk <= 50 { *steps.entry(dv / dk).or_default() += row[i].score * row[j].score; }
        } }
        let Some((&b, _)) = steps.iter().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()) else { continue };
        let kmax = k[k.len() - 1];
        // every start value a read supports, with and without a pass through zero at position kw
        let starts: Vec<i64> = (0..row.len()).map(|i| n[i] - b * k[i]).filter(|&a| a >= 0).collect();
        let mut wraps: Vec<Option<i64>> = vec![None];
        for i in 1..row.len() { if n[i] % b == 0 { let kw = k[i] - n[i] / b; if kw >= 1 && kw <= kmax { wraps.push(Some(kw)); } } }
        let mut best: Option<(f64, Vec<i64>, bool)> = None;
        for &a in &starts { for &kw in &wraps {
            let pred: Vec<i64> = k.iter().map(|&ki| match kw { Some(kw) if ki >= kw => b * (ki - kw), _ => a + b * ki }).collect();
            if let Some(kw) = kw { if a + b * (kw - 1) <= 0 { continue; } }
            let hit: f64 = (0..row.len()).filter(|&i| n[i] == pred[i]).map(|i| row[i].score).sum();
            let score = hit - if kw.is_some() { 0.3 } else { 0.0 };
            if best.as_ref().map_or(true, |x| score > x.0) { best = Some((score, pred, kw.is_some())); }
        } }
        let Some((_, pred, wrapped)) = best else { continue };
        let total: f64 = row.iter().map(|r| r.score).sum();
        let hit: f64 = (0..row.len()).filter(|&i| n[i] == pred[i]).map(|i| row[i].score).sum();
        let hits = (0..row.len()).filter(|&i| n[i] == pred[i]).count();
        if hits < 3 || hit / total < 0.5 { continue; }
        out.push(Belt { first: pred[0] as u32, last: pred[pred.len() - 1] as u32, step: b as u32, confidence: hit / total, reads: row.len(), wraps: wrapped, y: row[0].y });
    }
    out.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap());
    out
}

/// Finds the rows of location numbers in an image. The numbers may be upright in any of the four quarter turns;
/// the turn with the best-supported rows wins. `px_mm` is the pixel spacing. Empty when nothing reads as a belt.
pub fn find_belts(a: &[i32], w: usize, h: usize, pad: Option<i32>, px_mm: f64) -> Vec<Belt> {
    if w < 64 || h < 64 { return Vec::new(); }
    let k = if px_mm > 0.0 { (0.1 / px_mm).clamp(0.25, 4.0) } else { 1.0 };
    let b = blobs(a, w, h, pad, k);
    let t = templates();
    let mut best: (f64, Vec<Belt>) = (0.0, Vec::new());
    for turns in 0..4 {
        let rows = fit_rows(&reads_at(&b, &t, turns, k));
        let score: f64 = rows.iter().map(|r| r.confidence * r.reads as f64).sum();
        if score > best.0 { best = (score, rows); }
    }
    best.1
}
