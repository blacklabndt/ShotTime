//! Raster helpers: the image as displayed (for PNG/PDF exports, with the overlay text drawn into the export
//! only, never into the DICONDE file), downsampling for textures and thumbnails.

use crate::app::App;
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use eframe::egui;
use weldscope_core::codec;
use weldscope_core::dicom::{self as d, DicomFile};
use weldscope_core::imaging as im;
use weldscope_core::overlay;

/// Box-averages 8-bit data so neither side exceeds `max`.
pub fn fit_gray(g: &[u8], w: usize, h: usize, max: usize) -> (Vec<u8>, usize, usize) {
    if w <= max && h <= max { return (g.to_vec(), w, h); }
    let k = ((w.max(h) + max - 1) / max).max(1);
    let (nw, nh) = ((w + k - 1) / k, (h + k - 1) / k);
    let mut out = vec![0u8; nw * nh];
    for y in 0..nh { for x in 0..nw {
        let (mut s, mut n) = (0u32, 0u32);
        for yy in y * k..((y + 1) * k).min(h) { for xx in x * k..((x + 1) * k).min(w) { s += g[yy * w + xx] as u32; n += 1; } }
        out[y * nw + x] = (s / n.max(1)) as u8;
    } }
    (out, nw, nh)
}

pub fn resize_rgb(src: &[u8], w: usize, h: usize, nw: usize, nh: usize) -> Vec<u8> {
    if (w, h) == (nw, nh) { return src.to_vec(); }
    let mut out = vec![0u8; nw * nh * 3];
    let (sx, sy) = (w as f64 / nw as f64, h as f64 / nh as f64);
    for y in 0..nh { for x in 0..nw {
        let (x0, x1) = ((x as f64 * sx) as usize, (((x + 1) as f64 * sx).ceil() as usize).min(w).max((x as f64 * sx) as usize + 1));
        let (y0, y1) = ((y as f64 * sy) as usize, (((y + 1) as f64 * sy).ceil() as usize).min(h).max((y as f64 * sy) as usize + 1));
        let mut s = [0u32; 3]; let mut n = 0;
        for yy in y0..y1 { for xx in x0..x1 { let i = (yy * w + xx) * 3; s[0] += src[i] as u32; s[1] += src[i + 1] as u32; s[2] += src[i + 2] as u32; n += 1; } }
        for c in 0..3 { out[(y * nw + x) * 3 + c] = (s[c] / n.max(1)) as u8; }
    } }
    out
}

/// The image as displayed (window, inversion, EDGE-style view, view rotation), full resolution, RGB. With
/// `overlay` and the overlay switched on for exports, the corner text is drawn into this export image.
pub fn rendered(app: &mut App, with_overlay: bool) -> (Vec<u8>, usize, usize) {
    let (img, f) = app.frame_data().unwrap();
    let win = app.display_win();
    let gray = if app.edge.on { let e = app.edge_frame(); im::render_f32(&e, &img, win.c, win.w, app.invert_view) } else { im::render(&img.frames[f], &img, win.c, win.w, app.invert_view) };
    let (g, w, h) = im::rotate_view_u8(&gray, img.cols, img.rows, app.view_rot);
    let mut rgb: Vec<u8> = g.iter().flat_map(|&v| [v, v, v]).collect();
    let ov = &app.prefs.overlay;
    if with_overlay && ov.enabled && ov.in_exports {
        let e = app.cur().unwrap();
        let lines = overlay::lines(&e.shot.file.ds, &ov.layout(), &|k| crate::viewer::live_value(app, k), ov.labels);
        let scale = [0.8, 1.0, 1.25][ov.size.min(2) as usize];
        let px = ((w.min(h) as f32 / 45.0 * scale).round()).max(12.0);
        draw_overlay_rgb(&mut rgb, w, h, &lines, px);
    }
    (rgb, w, h)
}

fn font() -> FontRef<'static> { FontRef::try_from_slice(epaint_default_fonts::UBUNTU_LIGHT).expect("bundled font") }

fn text_width(f: &FontRef, px: f32, t: &str) -> f32 {
    let sf = f.as_scaled(PxScale::from(px));
    let mut x = 0.0; let mut prev = None;
    for c in t.chars() { let g = f.glyph_id(c); if let Some(p) = prev { x += sf.kern(p, g); } x += sf.h_advance(g); prev = Some(g); }
    x
}
fn draw_text(rgb: &mut [u8], w: usize, h: usize, x0: f32, y0: f32, t: &str, px: f32, col: [u8; 3], alpha: f32) {
    let f = font();
    let sf = f.as_scaled(PxScale::from(px));
    let mut x = x0; let mut prev = None;
    for c in t.chars() {
        let id = f.glyph_id(c);
        if let Some(p) = prev { x += sf.kern(p, id); }
        let g = id.with_scale_and_position(PxScale::from(px), ab_glyph::point(x, y0 + sf.ascent()));
        if let Some(o) = f.outline_glyph(g) {
            let b = o.px_bounds();
            o.draw(|gx, gy, cov| {
                let (px_, py_) = (b.min.x as i64 + gx as i64, b.min.y as i64 + gy as i64);
                if px_ < 0 || py_ < 0 || px_ >= w as i64 || py_ >= h as i64 { return; }
                let i = (py_ as usize * w + px_ as usize) * 3;
                let a = (cov * alpha).clamp(0.0, 1.0);
                for k in 0..3 { rgb[i + k] = (rgb[i + k] as f32 * (1.0 - a) + col[k] as f32 * a).round() as u8; }
            });
        }
        x += sf.h_advance(id);
        prev = Some(id);
    }
}
pub fn draw_overlay_rgb(rgb: &mut [u8], w: usize, h: usize, lines: &[Vec<String>; 4], px: f32) {
    let f = font();
    let (pad, lh) = (px * 0.6, px * 1.3);
    let o = (px / 9.0).max(1.0);
    for (c, ls) in lines.iter().enumerate() {
        let (right, bottom) = (c % 2 == 1, c >= 2);
        for (i, t) in ls.iter().enumerate() {
            let tw = text_width(&f, px, t);
            let x = if right { w as f32 - pad - tw } else { pad };
            let y = if bottom { h as f32 - pad - (ls.len() - i) as f32 * lh } else { pad + i as f32 * lh };
            for (dx, dy) in [(-o, -o), (o, -o), (-o, o), (o, o), (0.0, o), (o, 0.0), (-o, 0.0), (0.0, -o)] { draw_text(rgb, w, h, x + dx, y + dy, t, px, [0, 0, 0], 0.85); }
            draw_text(rgb, w, h, x, y, t, px, [0xFF, 0xF6, 0xB0], 1.0);
        }
    }
}

/// A small preview of a file (decoded from a reduced copy of the image), turned to its INDUSTREX viewing angle.
/// INDUSTREX's stored icon is not used: on the owner's files its pixel data does not match its own description.
pub fn thumbnail(file: &DicomFile) -> (egui::ColorImage, u32) {
    let angle = d::industrex_xml_entry(&file.ds, "ANGLE").and_then(|a| a.last().and_then(|v| v.trim().parse::<f64>().ok())).map(|v| v.round() as i64).unwrap_or(0);
    let cw = (((360 - angle) % 360) + 360) % 360;
    let rot = if [0, 90, 180, 270].contains(&cw) { cw as u32 } else { 0 };
    let img = match d::get_image(file) {
        Ok(i) => Some(i),
        Err(e) if e.compressed && codec::can_decode(&file.transfer_syntax) => {
            let g = d::image_geometry(file);
            file.ds.get(d::PIXEL).and_then(|p| p.fragments()).and_then(|fr| codec::decode_frames(fr, &d::Geometry { frames: 1.min(g.frames), ..g }).ok()).and_then(|fb| {
                let mut one = file.clone();
                one.ds.remove(0x00280008);
                d::image_from_frames(&one, &fb[..1]).ok()
            })
        }
        Err(_) => None,
    };
    let Some(img) = img else { return (egui::ColorImage::new([2, 2], egui::Color32::from_gray(40)), 0) };
    let max = 220usize;
    let k = ((img.cols.max(img.rows) + max - 1) / max).max(1);
    let (nw, nh) = ((img.cols + k - 1) / k, (img.rows + k - 1) / k);
    let a = &img.frames[0];
    let mut small = vec![0i32; nw * nh];
    for y in 0..nh { for x in 0..nw {
        let (mut s, mut n) = (0i64, 0i64);
        for yy in (y * k..((y + 1) * k).min(img.rows)).step_by(1.max(k / 3)) { for xx in (x * k..((x + 1) * k).min(img.cols)).step_by(1.max(k / 3)) { s += a[yy * img.cols + xx] as i64; n += 1; } }
        small[y * nw + x] = (s / n.max(1)) as i32;
    } }
    let si = img.with_frames(nh, nw, vec![small]);
    let wnd = im::auto_window(&si.frames[0], si.slope, si.intercept, 0.5, 99.8, si.padding);
    let g = im::render(&si.frames[0], &si, wnd.center, wnd.width, false);
    let (g, w, h) = im::rotate_view_u8(&g, nw, nh, rot);
    (egui::ColorImage::from_gray([w, h], &g), rot)
}
