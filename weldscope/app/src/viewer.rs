//! The image viewer: window/level display, zoom/pan, display-only view rotation, crop box, split regions,
//! scratch lines, the corner text overlay (display only), and mouse tools.

use crate::app::{App, RegionItem, Tool, Win, ACCENT, BAD};
use eframe::egui::{self, Color32, Pos2, Rect as ERect, RichText, Sense, Stroke, Vec2};
use weldscope_core::dicom as d;
use weldscope_core::imaging::{self as im, Axis, Rect, Region};
use weldscope_core::overlay;

#[derive(Clone, Copy, PartialEq)]
pub enum DragKind { Pan, Window(Win), Crop, Region, Scratch }
#[derive(Clone, Copy)]
pub struct Drag { pub kind: DragKind, pub start_img: (f64, f64), pub cur_img: (f64, f64) }

fn tex_options() -> egui::TextureOptions {
    egui::TextureOptions { magnification: egui::TextureFilter::Nearest, minification: egui::TextureFilter::Linear, wrap_mode: egui::TextureWrapMode::ClampToEdge, mipmap_mode: Some(egui::TextureFilter::Linear) }
}

/// Rebuilds the display texture when the image, frame, window, inversion, enhancement or compare state changed.
fn ensure_texture(app: &mut App, ui: &egui::Ui) {
    let Some((img, f)) = app.frame_data() else { app.texture = None; return };
    let compare = app.compare && app.cur().map_or(false, |e| !e.work.ops.is_empty() && e.work.orig_img.is_some());
    let src = if compare { app.cur().unwrap().work.orig_img.clone().unwrap() } else { img.clone() };
    let win = if compare { app.win() } else { app.display_win() };
    let edge = app.edge.on && !compare;
    // Zoomed out, show a box-averaged smaller image (a power of two smaller), so fine detail does not alias.
    let mut level = 1usize;
    while (level * 2) as f32 * app.view.zoom <= 1.0 && level < 64 { level *= 2; }
    let key = format!("{:p}:{f}:{:?}:{}:{}:{}:{level}", std::sync::Arc::as_ptr(&src), win, app.invert_view, edge, app.edge_cache.as_ref().map(|c| c.0.as_str()).unwrap_or(""));
    if key == app.tex_key && app.texture.is_some() { return; }
    let ff = f.min(src.frames.len() - 1);
    let gray = if edge { match &app.edge_cache { Some((_, v)) if v.len() == src.rows * src.cols => im::render_f32(v, &src, win.c, win.w, app.invert_view), _ => im::render(&src.frames[ff], &src, win.c, win.w, app.invert_view) } }
        else { im::render(&src.frames[ff], &src, win.c, win.w, app.invert_view) };
    let max = ui.ctx().input(|i| i.max_texture_side).max(2048);
    let (g, w, h) = crate::export_img::fit_gray(&gray, src.cols, src.rows, max.min((src.cols.max(src.rows) + level - 1) / level));
    let ci = egui::ColorImage::from_gray([w, h], &g);
    match &mut app.texture { Some(t) => t.set(ci, tex_options()), None => app.texture = Some(ui.ctx().load_texture("image", ci, tex_options())) }
    app.tex_key = key;
}

pub struct Xf { pub min: Pos2, pub off: Vec2, pub zoom: f32, pub cols: f64, pub rows: f64, pub rot: u32 }
impl Xf {
    pub fn to_screen(&self, x: f64, y: f64) -> Pos2 { let (vx, vy) = im::to_view(x, y, self.cols, self.rows, self.rot); self.min + self.off + Vec2::new(vx as f32, vy as f32) * self.zoom }
    pub fn to_image(&self, p: Pos2) -> (f64, f64) { let v = (p - self.min - self.off) / self.zoom; im::from_view(v.x as f64, v.y as f64, self.cols, self.rows, self.rot) }
    pub fn rect(&self, r: Rect) -> ERect { let a = self.to_screen(r.x as f64, r.y as f64); let b = self.to_screen((r.x + r.w) as f64, (r.y + r.h) as f64); ERect::from_two_pos(a, b) }
}

pub fn fit(app: &mut App) {
    let Some(img) = app.img() else { return };
    let c = app.view.canvas;
    if c.width() < 10.0 { return; }
    let (vw, vh) = im::view_dims(img.cols as f64, img.rows as f64, app.view_rot);
    let z = ((c.width() as f64 / vw).min(c.height() as f64 / vh) * 0.98) as f32;
    app.view.zoom = z;
    app.view.off = Vec2::new((c.width() - vw as f32 * z) / 2.0, (c.height() - vh as f32 * z) / 2.0);
    app.view.fit_pending = false;
}
pub fn actual_size(app: &mut App) { let c = app.view.canvas.center(); let f = 1.0 / app.view.zoom.max(1e-6); zoom_at(app, f, c); }
fn zoom_at(app: &mut App, factor: f32, at: Pos2) {
    let z = (app.view.zoom * factor).clamp(0.01, 40.0);
    let f = z / app.view.zoom;
    let rel = at - app.view.canvas.min;
    app.view.off = rel - (rel - app.view.off) * f;
    app.view.zoom = z;
}

fn clamp_rect(a: (f64, f64), b: (f64, f64), cols: usize, rows: usize) -> Rect {
    let (x0, x1) = (a.0.min(b.0).floor().max(0.0), a.0.max(b.0).ceil().min(cols as f64));
    let (y0, y1) = (a.1.min(b.1).floor().max(0.0), a.1.max(b.1).ceil().min(rows as f64));
    Rect::new(x0 as i64, y0 as i64, (x1 - x0).max(0.0) as i64, (y1 - y0).max(0.0) as i64)
}

pub fn live_value(app: &App, key: &str) -> String {
    let Some(e) = app.cur() else { return String::new() };
    let img = e.work.img.as_ref();
    match key {
        "live:wl" => { let w = e.work.win; format!("W {:.0} / L {:.0}{}", w.w, w.c, if app.edge.on { " (EDGE-style)" } else { "" }) }
        "live:zoom" => format!("{:.0}%", app.view.zoom * 100.0),
        "live:size" => img.map(|i| format!("{} × {}", i.cols, i.rows)).unwrap_or_default(),
        "live:view" => if app.view_rot == 0 { String::new() } else { format!("{}°", app.view_rot) },
        "live:file" => e.shot.name.clone(),
        "live:frame" => img.filter(|i| i.frames.len() > 1).map(|i| format!("Frame {} of {}", e.work.frame + 1, i.frames.len())).unwrap_or_default(),
        _ => String::new(),
    }
}
pub fn overlay_px(size: u8) -> f32 { [12.0, 14.0, 17.0][size.min(2) as usize] }

fn toolbar(app: &mut App, ui: &mut egui::Ui) {
    ui.horizontal_wrapped(|ui| {
        let has = app.img().is_some();
        ui.add_enabled_ui(has && !app.busy(), |ui| {
            for (t, label, tip) in [(Tool::Pan, "Pan", "Drag to move the image; the wheel zooms. Right-drag changes brightness and contrast with any tool; middle-drag moves."), (Tool::Window, "W/L", "Drag sideways for contrast, up/down for brightness; hold Shift for finer steps. Right-drag does the same with any tool."),
                (Tool::Crop, "Crop", "Drag a crop box"), (Tool::Region, "Region", "Drag a region to save as a split file"), (Tool::Scratch, "Scratch", "Drag along a thin scratch to repair it")] {
                if ui.selectable_label(app.tool == t, label).on_hover_text(tip).clicked() { app.tool = t; }
            }
            ui.separator();
            if ui.button("Fit").on_hover_text("Fit the image (double-click)").clicked() { fit(app); }
            if ui.button("1:1").on_hover_text("Actual pixels").clicked() { let c = app.view.canvas.center(); zoom_at(app, 1.0 / app.view.zoom, c); }
            let rl = if app.view_rot == 0 { "Turn view".to_string() } else { format!("Turn view ({}°)", app.view_rot) };
            if ui.button(rl).on_hover_text(if app.view_rot_industrex { "Turn the view 90° (display only). The starting angle comes from the file's INDUSTREX view." } else { "Turn the view 90° (display only; the file is not changed)" }).clicked() {
                app.view_rot = (app.view_rot + 90) % 360; app.view.fit_pending = true;
            }
            if ui.selectable_label(app.invert_view, "Invert view").on_hover_text("Display only").clicked() { app.invert_view = !app.invert_view; app.invalidate(); }
            if ui.selectable_label(app.prefs.overlay.enabled, "Info overlay").on_hover_text("Show selected metadata on the image (display and exports only; never written into the file)").clicked() { app.prefs.overlay.enabled = !app.prefs.overlay.enabled; }
            let edited = app.cur().map_or(false, |e| !e.work.ops.is_empty());
            let cmp = ui.add_enabled(edited, egui::Button::new("Hold to compare")).on_hover_text("Hold to see the original pixels");
            let down = cmp.is_pointer_button_down_on();
            if down != app.compare { app.compare = down; app.invalidate(); }
            if let Some(img) = app.img() {
                if img.frames.len() > 1 {
                    let n = img.frames.len();
                    let mut f = app.cur().unwrap().work.frame;
                    egui::ComboBox::from_id_salt("frame").selected_text(format!("Frame {} of {n}", f + 1)).show_ui(ui, |ui| { for i in 0..n { ui.selectable_value(&mut f, i, format!("{} of {n}", i + 1)); } });
                    if f != app.cur().unwrap().work.frame { app.cur_mut().unwrap().work.frame = f; app.edge_cache = None; app.raw_auto_width = None; app.invalidate(); if app.edge.on { app.update_edge(false); } }
                }
            }
            if app.ind.is_some() { if ui.selectable_label(app.ind_show, "Indication marks").on_hover_text("Show or hide the possible-indication marks (M). Display only; for the interpreter to check, not an acceptance decision.").clicked() { app.ind_show = !app.ind_show; } }
            if app.edge.on { ui.label(RichText::new("EDGE-style view").color(ACCENT)).on_hover_text("Display only until Apply to pixels. An approximation, not INDUSTREX's EDGE."); }
        });
    });
}

fn empty_state(app: &mut App, ui: &mut egui::Ui) {
    ui.vertical_centered(|ui| {
        ui.add_space((ui.available_height() * 0.22).max(20.0));
        if let Some(l) = &app.logo { ui.add(egui::Image::new(l).fit_to_exact_size(egui::vec2(520.0, 520.0 * 243.0 / 875.0))); }
        ui.add_space(18.0);
        ui.label(RichText::new("Open a folder of DICONDE files to start. Originals are never changed: every save writes a new copy.").size(15.0));
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            ui.add_space((ui.available_width() - 260.0).max(0.0) / 2.0);
            if ui.add(egui::Button::new(RichText::new("Open folder").size(16.0)).fill(ACCENT.linear_multiply(0.6))).clicked() { app.open_folder_dialog(); }
            if ui.add(egui::Button::new(RichText::new("Add files").size(16.0))).clicked() { app.open_files_dialog(); }
        });
        ui.add_space(8.0);
        ui.label(RichText::new("You can also drop files or a folder on this window.").weak());
    });
}

pub fn show(app: &mut App, ui: &mut egui::Ui) {
    if app.cur.is_none() { empty_state(app, ui); return; }
    egui::Frame::none().inner_margin(egui::Margin::symmetric(8.0, 4.0)).fill(Color32::from_gray(24)).show(ui, |ui| toolbar(app, ui));
    let (loaded, err) = app.cur().map(|e| (e.work.loaded, e.work.img_error.clone())).unwrap();
    let (rect, resp) = ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());
    let painter = ui.painter_at(rect);
    let size_changed = app.view.canvas.size() != rect.size();
    app.view.canvas = rect;
    if !loaded { painter.text(rect.center(), egui::Align2::CENTER_CENTER, "Opening…", egui::FontId::proportional(16.0), Color32::GRAY); return; }
    let Some(img) = app.img() else {
        painter.text(rect.center(), egui::Align2::CENTER_CENTER, if err.is_empty() { "No image".into() } else { err }, egui::FontId::proportional(15.0), Color32::LIGHT_GRAY);
        return;
    };
    if app.view.fit_pending || (size_changed && app.view.zoom == 0.0) || app.view.zoom == 0.0 { fit(app); }
    ensure_texture(app, ui);
    if app.flash.as_ref().map_or(false, |(_, t)| t.elapsed().as_secs_f32() >= 2.5) { app.flash = None; }
    let xf = Xf { min: rect.min, off: app.view.off, zoom: app.view.zoom, cols: img.cols as f64, rows: img.rows as f64, rot: app.view_rot };
    // the image as a textured quad (view rotation through the texture coordinates)
    if let Some(tex) = &app.texture {
        let (vw, vh) = im::view_dims(xf.cols, xf.rows, xf.rot);
        let mut mesh = egui::Mesh::with_texture(tex.id());
        for (vx, vy) in [(0.0, 0.0), (vw, 0.0), (vw, vh), (0.0, vh)] {
            let (ix, iy) = im::from_view(vx, vy, xf.cols, xf.rows, xf.rot);
            let pos = rect.min + app.view.off + Vec2::new(vx as f32, vy as f32) * app.view.zoom;
            mesh.vertices.push(egui::epaint::Vertex { pos, uv: Pos2::new((ix / xf.cols) as f32, (iy / xf.rows) as f32), color: Color32::WHITE });
        }
        mesh.add_triangle(0, 1, 2); mesh.add_triangle(0, 2, 3);
        painter.add(egui::Shape::mesh(mesh));
    }
    // crop box, regions, found scratches
    let e = app.cur().unwrap();
    if let Some(c) = e.work.crop {
        let r = xf.rect(c);
        painter.rect_filled(rect, 0.0, Color32::TRANSPARENT);
        for side in [ERect::from_min_max(rect.min, Pos2::new(rect.max.x, r.min.y)), ERect::from_min_max(Pos2::new(rect.min.x, r.max.y), rect.max), ERect::from_min_max(Pos2::new(rect.min.x, r.min.y), Pos2::new(r.min.x, r.max.y)), ERect::from_min_max(Pos2::new(r.max.x, r.min.y), Pos2::new(rect.max.x, r.max.y))] {
            painter.rect_filled(side.intersect(rect), 0.0, Color32::from_black_alpha(110));
        }
        painter.rect_stroke(r, 0.0, Stroke::new(2.0_f32, ACCENT));
    }
    for (i, ri) in e.work.regions.iter().enumerate() { draw_region(&painter, &xf, ri, i); }
    for (i, s) in app.scratches.iter().enumerate() {
        let (a, b) = (xf.to_screen(s.x0, s.y0), xf.to_screen(s.x1, s.y1));
        painter.line_segment([a, b], Stroke::new(2.0_f32, Color32::from_rgb(0, 220, 255)));
        painter.text(a + Vec2::new(4.0, 2.0), egui::Align2::LEFT_TOP, format!("S{}", i + 1), egui::FontId::proportional(13.0), Color32::from_rgb(0, 220, 255));
    }
    // possible indications (display only): the weld band and a numbered box per candidate, strongest = 1
    if app.ind_show { if let Some(f) = &app.ind {
        for (line, sure) in f.bands.outlines() {
            let pts: Vec<Pos2> = line.iter().map(|(x, y)| xf.to_screen(*x, *y)).collect();
            painter.add(egui::Shape::line(pts, Stroke::new(1.0_f32, if sure { Color32::from_rgba_unmultiplied(90, 230, 120, 150) } else { Color32::from_rgba_unmultiplied(255, 180, 60, 150) })));
        }
        let cuts = weldscope_core::indications::CUTS;
        for (rank, (n, it)) in app.indications_shown().iter().enumerate() {
            let col = if it.score > cuts[1] { Color32::from_rgb(255, 70, 70) } else if it.score > cuts[2] { Color32::from_rgb(255, 160, 40) } else { Color32::from_rgb(240, 230, 70) };
            let r = ERect::from_two_pos(xf.to_screen(it.x0, it.y0), xf.to_screen(it.x1, it.y1)).expand(4.0);
            let picked = app.ind_sel == Some(*n);
            if picked { painter.rect_stroke(r.expand(3.0), 2.0, Stroke::new(2.0_f32, Color32::WHITE)); }
            painter.rect_stroke(r, 2.0, Stroke::new(if picked { 2.5_f32 } else { 1.5_f32 }, col));
            let label = (rank + 1).to_string();
            for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] { painter.text(r.left_top() + Vec2::new(dx, dy - 2.0), egui::Align2::LEFT_BOTTOM, &label, egui::FontId::proportional(13.0), Color32::BLACK); }
            painter.text(r.left_top() + Vec2::new(0.0, -2.0), egui::Align2::LEFT_BOTTOM, &label, egui::FontId::proportional(13.0), col);
        }
    } }
    // a repaired scratch flashes green for a moment, so it is clear where pixels changed
    if let Some((segs, t)) = &app.flash {
        let age = t.elapsed().as_secs_f32();
        if age < 2.5 {
            let a = ((1.0 - age / 2.5) * 255.0) as u8;
            for sgm in segs { painter.line_segment([xf.to_screen(sgm.x0, sgm.y0), xf.to_screen(sgm.x1, sgm.y1)], Stroke::new(4.0_f32, Color32::from_rgba_unmultiplied(80, 255, 120, a))); }
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(40));
        }
    }
    if let Some(dr) = app.drag {
        match dr.kind {
            DragKind::Crop | DragKind::Region => { let r = xf.rect(clamp_rect(dr.start_img, dr.cur_img, img.cols, img.rows)); painter.rect_stroke(r, 0.0, Stroke::new(1.5_f32, if dr.kind == DragKind::Crop { ACCENT } else { Color32::from_rgb(120, 200, 255) })); }
            DragKind::Scratch => { painter.line_segment([xf.to_screen(dr.start_img.0, dr.start_img.1), xf.to_screen(dr.cur_img.0, dr.cur_img.1)], Stroke::new(2.0_f32, BAD)); }
            _ => {}
        }
    }
    // corner text overlay (display only)
    if app.prefs.overlay.enabled {
        let layout = app.prefs.overlay.layout();
        let lines = overlay::lines(&e.shot.file.ds, &layout, &|k| live_value(app, k), app.prefs.overlay.labels);
        draw_overlay(&painter, rect, &lines, overlay_px(app.prefs.overlay.size));
    }
    interact(app, ui, &resp, &xf, &img);
}

fn draw_region(p: &egui::Painter, xf: &Xf, ri: &RegionItem, i: usize) {
    let col = Color32::from_rgb(120, 200, 255);
    let r = xf.rect(ri.region.rect);
    p.rect_stroke(r, 0.0, Stroke::new(1.5_f32, col));
    let label = if ri.label.is_empty() { (i + 1).to_string() } else { ri.label.clone() };
    let g = p.layout_no_wrap(label, egui::FontId::proportional(14.0), Color32::BLACK);
    let br = ERect::from_min_size(r.min + Vec2::new(3.0, 3.0), g.size() + Vec2::new(8.0, 2.0));
    p.rect_filled(br, 3.0, col);
    p.galley(br.min + Vec2::new(4.0, 1.0), g, Color32::BLACK);
    let rr = ri.region.rect;
    for c in &ri.region.cuts {
        let (a, b) = match c.axis {
            Axis::X => ((c.a + c.k * rr.y as f64, rr.y as f64), (c.a + c.k * (rr.y + rr.h) as f64, (rr.y + rr.h) as f64)),
            Axis::Y => ((rr.x as f64, c.a + c.k * rr.x as f64), ((rr.x + rr.w) as f64, c.a + c.k * (rr.x + rr.w) as f64)),
        };
        p.line_segment([xf.to_screen(a.0, a.1), xf.to_screen(b.0, b.1)], Stroke::new(1.0_f32, Color32::from_rgb(255, 200, 80)));
    }
}

/// Light text with a dark outline so it reads on both bright and dark parts of a radiograph.
pub fn draw_overlay(p: &egui::Painter, rect: ERect, lines: &[Vec<String>; 4], px: f32) {
    let font = egui::FontId::proportional(px);
    let (pad, lh) = (px * 0.6, px * 1.3);
    for (c, ls) in lines.iter().enumerate() {
        let (right, bottom) = (c % 2 == 1, c >= 2);
        for (i, t) in ls.iter().enumerate() {
            let max_chars = ((rect.width() * 0.5 - pad) / (px * 0.52)).max(8.0) as usize;
            let t = &if t.chars().count() > max_chars { t.chars().take(max_chars.saturating_sub(1)).collect::<String>() + "…" } else { t.clone() };
            let x = if right { rect.max.x - pad } else { rect.min.x + pad };
            let y = if bottom { rect.max.y - pad - (ls.len() - i) as f32 * lh } else { rect.min.y + pad + i as f32 * lh };
            let align = if right { egui::Align2::RIGHT_TOP } else { egui::Align2::LEFT_TOP };
            for (dx, dy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (0.0, 1.5), (1.5, 0.0), (-1.5, 0.0), (0.0, -1.5)] { p.text(Pos2::new(x + dx, y + dy), align, t, font.clone(), Color32::from_black_alpha(220)); }
            p.text(Pos2::new(x, y), align, t, font.clone(), Color32::from_rgb(0xFF, 0xF6, 0xB0));
        }
    }
}

fn interact(app: &mut App, ui: &egui::Ui, resp: &egui::Response, xf: &Xf, img: &d::Image) {
    if app.busy() { return; }
    let (cols, rows) = (img.cols, img.rows);
    // zoom with the wheel (or pinch / Ctrl+wheel)
    if resp.hovered() {
        let (scroll, zd) = ui.input(|i| (i.smooth_scroll_delta.y, i.zoom_delta()));
        if let Some(p) = resp.hover_pos() {
            if scroll != 0.0 { zoom_at(app, (scroll * 0.0018).exp(), p); }
            if zd != 1.0 { zoom_at(app, zd, p); }
            let (x, y) = xf.to_image(p);
            app.probe = if x >= 0.0 && y >= 0.0 && (x as usize) < cols && (y as usize) < rows {
                let f = app.cur().unwrap().work.frame.min(img.frames.len() - 1);
                let v = img.frames[f][y as usize * cols + x as usize];
                let resc = v as f64 * img.slope + img.intercept;
                if img.slope != 1.0 || img.intercept != 0.0 { format!("x {} y {} · {v} ({resc:.1})", x as usize, y as usize) } else { format!("x {} y {} · {v}", x as usize, y as usize) }
            } else { String::new() };
        }
    }
    if resp.double_clicked() { fit(app); return; }
    let pointer = ui.input(|i| i.pointer.clone());
    if resp.drag_started() {
        let p = resp.interact_pointer_pos().unwrap_or_default();
        let im_p = xf.to_image(p);
        // Right-drag is always window/level (as in INDUSTREX and most viewers); middle-drag always pans.
        let kind = if pointer.button_down(egui::PointerButton::Secondary) { DragKind::Window(app.win()) } else if pointer.button_down(egui::PointerButton::Middle) { DragKind::Pan } else { match app.tool { Tool::Pan => DragKind::Pan, Tool::Window => DragKind::Window(app.win()), Tool::Crop => DragKind::Crop, Tool::Region => DragKind::Region, Tool::Scratch => DragKind::Scratch } };
        app.drag = Some(Drag { kind, start_img: im_p, cur_img: im_p });
    }
    if let Some(mut dr) = app.drag {
        if resp.dragged() {
            let delta = resp.drag_delta();
            match dr.kind {
                DragKind::Pan => app.view.off += delta,
                DragKind::Window(_) => {
                    let w = app.win();
                    // Steps follow the current window, so a narrow window gets fine steps: dragging 500 px up or down
                    // moves the level by one window width. Hold Shift for steps five times finer.
                    let fine = if ui.input(|i| i.modifiers.shift) { 0.2 } else { 1.0 };
                    let sign = if img.monochrome1() != app.invert_view { 1.0 } else { -1.0 };
                    app.set_win(Win { c: w.c + sign * delta.y as f64 * w.w / 500.0 * fine, w: (w.w * (delta.x as f64 * 0.003 * fine).exp()).max(1.0) });
                }
                _ => { if let Some(p) = resp.interact_pointer_pos() { dr.cur_img = xf.to_image(p); app.drag = Some(dr); } }
            }
        }
        if resp.drag_stopped() {
            app.drag = None;
            match dr.kind {
                DragKind::Crop => {
                    let r = clamp_rect(dr.start_img, dr.cur_img, cols, rows);
                    if let Some(e) = app.cur_mut() { e.work.crop = if r.w >= 1 && r.h >= 1 { Some(r) } else { None }; }
                    app.sync_crop_inputs();
                }
                DragKind::Region => {
                    let r = clamp_rect(dr.start_img, dr.cur_img, cols, rows);
                    if r.w >= 4 && r.h >= 4 { if let Some(e) = app.cur_mut() { let n = e.work.regions.len() + 1; e.work.regions.push(RegionItem { region: Region { rect: r, cuts: vec![] }, label: n.to_string(), tilt: None }); } }
                }
                DragKind::Scratch => {
                    let (a, b) = (dr.start_img, dr.cur_img);
                    if ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt() >= 5.0 { app.repair_scratches(vec![im::Segment { x0: a.0, y0: a.1, x1: b.0, y1: b.1 }], true); }
                }
                _ => {}
            }
        }
    }
}
