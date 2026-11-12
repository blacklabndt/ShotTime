//! Tool panel tabs: Metadata, Image, Crop & split, Overlay, Changes.

use crate::app::{App, Tab, Win, ACCENT, BAD, COMMON, OK, READ_ONLY, VRS};
use eframe::egui::{self, Color32, RichText};
use weldscope_core::compat::{self, Level};
use weldscope_core::dicom::{self as d, Dataset, Value};
use weldscope_core::imaging::{self as im, Rect};
use weldscope_core::overlay::{self, LIVE};
use weldscope_core::review::Verdict;
use weldscope_core::shots;

pub fn tools(app: &mut App, ui: &mut egui::Ui) {
    ui.horizontal_wrapped(|ui| {
        for (t, l) in [(Tab::Metadata, "Metadata"), (Tab::Image, "Image"), (Tab::Crop, "Crop & split"), (Tab::Overlay, "Overlay"), (Tab::Changes, "Changes")] {
            ui.selectable_value(&mut app.prefs.tab, t, RichText::new(l).strong());
        }
    });
    ui.separator();
    if app.cur.is_none() { ui.label(RichText::new("Open a file to see its metadata and tools.").weak()); return; }
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| match app.prefs.tab {
        Tab::Metadata => metadata(app, ui),
        Tab::Image => image_tab(app, ui),
        Tab::Crop => crop_tab(app, ui),
        Tab::Overlay => overlay_tab(app, ui),
        Tab::Changes => changes_tab(app, ui),
    });
}

fn section(ui: &mut egui::Ui, title: &str) { ui.add_space(6.0); ui.label(RichText::new(title).strong().color(ACCENT)); }
fn note(ui: &mut egui::Ui, t: &str) { ui.label(RichText::new(t).weak().small()); }

// ---------------------------------------------------------------- metadata
fn summary(app: &App, ui: &mut egui::Ui) {
    let e = app.cur().unwrap();
    let ds = &e.shot.file.ds;
    egui::Frame::group(ui.style()).show(ui, |ui| {
        ui.set_width(ui.available_width());
        let room = (ui.available_width() / 7.0) as usize;
        ui.label(RichText::new(crate::app::elide(&e.shot.name, room)).strong()).on_hover_text(&e.shot.name);
        if !e.shot.path.is_empty() { ui.label(RichText::new(crate::app::elide(&e.shot.path, (room as f32 * 1.4) as usize)).weak().small()).on_hover_text(&e.shot.path); }
        let sop = ds.string(0x00080016);
        ui.label(format!("{} · {}", compat::sop_name(&sop).unwrap_or(if sop.is_empty() { "No SOP class" } else { &sop }), d::ts_name(&e.shot.orig.transfer_syntax)));
        if let Some(ix) = d::industrex_info(&e.shot.orig.ds) { ui.label(format!("INDUSTREX {} ({})", if ix.version.is_empty() { "?" } else { &ix.version }, ix.creator)); }
        let n = e.shot.orig_els.len();
        if n > 0 { ui.label(RichText::new(format!("{n} field(s) edited")).color(ACCENT)); }
        if !e.shot.saved_as.is_empty() { ui.label(RichText::new(format!("Last saved as {}", crate::app::elide(&e.shot.saved_as, 70))).color(OK).small()).on_hover_text(&e.shot.saved_as); }
    });
}

/// One editable field: commits on Enter or when the box loses focus; errors are shown under it and nothing changes.
fn field(app: &mut App, ui: &mut egui::Ui, path: &[(u32, usize)], tag: u32, name: &str) {
    let e = app.cur().unwrap();
    let ds = shots::ds_at(&e.shot.file.ds, path).cloned().unwrap_or_default();
    let utf8 = d::charset_is_utf8(&e.shot.file.ds);
    let key = shots::key_of(path, tag);
    let el = ds.get(tag);
    let cur = el.map(|x| d::value_to_text(x, utf8)).unwrap_or_default();
    let vr = el.map(|x| x.vr.as_str().to_string()).or_else(|| d::tag_info(tag).vr.map(String::from)).unwrap_or_default();
    let changed = e.shot.orig_els.contains_key(&key);
    let editable = d::editable(&vr) && !READ_ONLY.contains(&tag) && el.map_or(true, |x| x.bytes().is_some()) && !((tag >> 16) & 1 == 1 && (tag & 0xFF00) == 0);
    let info = d::describe_tag(&e.shot.file.ds, tag);
    let hover = format!("{} {} · {}{}", d::tag_hex(tag), vr, info.dicom_name, if info.nde_name.is_empty() { String::new() } else { format!(" (DICONDE: {})", info.nde_name) });
    let lab = ui.label(if changed { RichText::new(name).color(ACCENT) } else { RichText::new(name) }).on_hover_text(hover);
    let _ = lab;
    ui.horizontal(|ui| {
        if editable {
            let mut buf = app.meta.edits.get(&key).cloned().unwrap_or_else(|| cur.clone());
            let multi = ["LT", "ST", "UT"].contains(&vr.as_str());
            let w = (ui.available_width() - 84.0).max(80.0);
            let resp = if multi { ui.add(egui::TextEdit::multiline(&mut buf).desired_width(w).desired_rows(1)) } else { ui.add(egui::TextEdit::singleline(&mut buf).desired_width(w)) };
            if resp.changed() { app.meta.edits.insert(key.clone(), buf.clone()); app.meta.errors.remove(&key); }
            if resp.lost_focus() {
                if let Some(text) = app.meta.edits.get(&key).cloned() {
                    if text != cur {
                        let t = if vr == "CS" { text.to_uppercase() } else { text.clone() };
                        match app.set_field(path, tag, &t, None) { Ok(()) => { app.meta.edits.remove(&key); } Err(m) => { app.meta.errors.insert(key.clone(), m); } }
                    } else { app.meta.edits.remove(&key); }
                }
            }
        } else {
            let shown = match el.map(|x| &x.value) { Some(Value::Bytes(_)) | None => cur.clone(), Some(_) => cur.clone() };
            ui.label(RichText::new(if shown.is_empty() { "—".into() } else { shown }).weak());
        }
        if editable && path.is_empty() && !["DA", "TM", "DT", "UI"].contains(&vr.as_str()) {
            let sug = app.suggestions(tag, &cur);
            if !sug.is_empty() {
                let mut pick = None;
                ui.menu_button("▾", |ui| {
                    ui.label(RichText::new("Used before").weak().small());
                    for v in &sug { if ui.button(crate::app::elide(v, 48)).clicked() { pick = Some(v.clone()); ui.close_menu(); } }
                }).response.on_hover_text("Pick a value used before");
                if let Some(v) = pick { match app.set_field(path, tag, &v, None) { Ok(()) => { app.meta.edits.remove(&key); app.meta.errors.remove(&key); } Err(m) => { app.meta.errors.insert(key.clone(), m); } } }
            }
        }
        if changed && ui.small_button("↺").on_hover_text("Back to the original value").clicked() { app.revert_field(path, tag); app.meta.edits.remove(&key); }
        if path.is_empty() && (tag >> 16) & 1 == 0 {
            let hex = overlay::hex_of(tag);
            let mut layout = app.prefs.overlay.layout();
            let pinned = overlay::corner_of(&layout, &hex).is_some();
            if ui.small_button(if pinned { "📌" } else { "📍" }).on_hover_text(if pinned { "Shown on the image overlay: click to remove" } else { "Show on the image overlay" }).clicked() {
                if pinned { for c in layout.corners.iter_mut() { c.retain(|k| *k != hex); } } else { layout.corners[0].push(hex); app.prefs.overlay.enabled = true; }
                app.prefs.overlay.layout = layout.corners.to_vec();
            }
        }
    });
    if let Some(m) = app.meta.errors.get(&key) { ui.label(RichText::new(m).color(BAD).small()); }
}

/// Coverage of the open shot: typed, or read from the lead numbers on the film and then confirmed.
fn coverage_row(app: &mut App, ui: &mut egui::Ui) {
    let Some(e) = app.cur() else { return };
    let (id, cur) = (e.shot.id, e.shot.coverage());
    let (shown, kind) = e.coverage_shown();
    ui.horizontal(|ui| {
        ui.label(RichText::new("Coverage").strong()).on_hover_text("The location-marker range this shot shows, e.g. 0-35. Stored as a line of Image Comments.");
        let mut buf = app.meta.edits.get("coverage").cloned().unwrap_or_else(|| shown.clone());
        let r = ui.add(egui::TextEdit::singleline(&mut buf).hint_text("e.g. 0-35").desired_width((ui.available_width() - 130.0).max(70.0)));
        if r.changed() { app.meta.edits.insert("coverage".into(), buf.clone()); app.meta.errors.remove("coverage"); }
        if r.lost_focus() {
            if let Some(text) = app.meta.edits.remove("coverage") { if text.trim() != cur && !(cur.is_empty() && text.trim() == shown) { if let Err(m) = app.set_coverage(&[(id, text.clone())]) { app.meta.edits.insert("coverage".into(), text); app.meta.errors.insert("coverage".into(), m); } } }
        }
        if ui.button("Read again").on_hover_text("Reads the lead location numbers on the image as it is now and shows the range for you to confirm or correct").clicked() { app.read_coverage(&[id]); }
    });
    match kind {
        1 => note(ui, "Read from the numbers on the film. It is written into the file when you save it; type over it to correct it."),
        2 => { ui.label(RichText::new("Read from the film, but some numbers were unclear or missing. Check it; it is only stored once you confirm it here (press Enter in the box, or correct it).").small().color(ACCENT)); if ui.small_button("It is correct").clicked() { let _ = app.set_coverage(&[(id, shown.clone())]); } }
        _ => {}
    }
    if let Some(m) = app.meta.errors.get("coverage") { ui.label(RichText::new(m).color(BAD).small()); }
}

fn metadata(app: &mut App, ui: &mut egui::Ui) {
    summary(app, ui);
    coverage_row(app, ui);
    ui.horizontal(|ui| {
        ui.selectable_value(&mut app.meta.all, false, "Common fields");
        ui.selectable_value(&mut app.meta.all, true, "All tags");
        ui.add(egui::TextEdit::singleline(&mut app.meta.filter).hint_text("Search").desired_width(ui.available_width()));
    });
    let q = app.meta.filter.to_lowercase();
    if !app.meta.all {
        for (group, tags) in COMMON {
            let shown: Vec<u32> = tags.iter().copied().filter(|t| q.is_empty() || matches(app, *t, &q)).collect();
            if shown.is_empty() { continue; }
            egui::CollapsingHeader::new(RichText::new(*group).strong()).default_open(true).show(ui, |ui| {
                for t in shown { let name = d::tag_info(t).name; field(app, ui, &[], t, &name); }
            });
        }
        note(ui, "Names follow INDUSTREX (DICONDE); hover a name for the DICOM name and tag. Values are checked before anything changes.");
    } else {
        let tags: Vec<u32> = app.cur().unwrap().shot.file.ds.el.keys().copied().filter(|t| *t != d::PIXEL).collect();
        for t in tags { if q.is_empty() || matches(app, t, &q) { element_row(app, ui, &[], t, 0); } }
        add_tag_form(app, ui);
    }
    templates(app, ui);
}
fn matches(app: &App, tag: u32, q: &str) -> bool {
    let e = app.cur().unwrap();
    let i = d::describe_tag(&e.shot.file.ds, tag);
    let v = e.shot.file.ds.get(tag).map(|x| d::value_to_text(x, d::charset_is_utf8(&e.shot.file.ds))).unwrap_or_default();
    format!("{} {} {} {} {}", i.name, i.dicom_name, i.keyword, d::tag_hex(tag), v).to_lowercase().contains(q)
}
fn element_row(app: &mut App, ui: &mut egui::Ui, path: &[(u32, usize)], tag: u32, depth: usize) {
    let e = app.cur().unwrap();
    let Some(ds) = shots::ds_at(&e.shot.file.ds, path).cloned() else { return };
    let Some(el) = ds.get(tag).cloned() else { return };
    let name = d::describe_tag(&e.shot.file.ds, tag).name;
    match &el.value {
        Value::Items(items) => {
            egui::CollapsingHeader::new(format!("{name} {} · {} item(s)", d::tag_hex(tag), items.len())).id_salt(shots::key_of(path, tag)).show(ui, |ui| {
                for (k, it) in items.iter().enumerate() {
                    ui.label(RichText::new(format!("Item {}", k + 1)).weak());
                    let mut p = path.to_vec(); p.push((tag, k));
                    let tags: Vec<u32> = it.el.keys().copied().collect();
                    for t in tags { element_row(app, ui, &p, t, depth + 1); }
                }
            });
        }
        _ => {
            let removable = !READ_ONLY.contains(&tag);
            ui.push_id(shots::key_of(path, tag), |ui| {
                field(app, ui, path, tag, &format!("{name}  {}", d::tag_hex(tag)));
                if removable && ui.small_button("Remove field").clicked() { app.delete_field(path, tag); }
            });
        }
    }
}
fn add_tag_form(app: &mut App, ui: &mut egui::Ui) {
    section(ui, "Add a field");
    ui.horizontal(|ui| {
        let r = ui.add(egui::TextEdit::singleline(&mut app.meta.add_tag).hint_text("(0018,1004) or PlateID").desired_width(150.0));
        if r.changed() { if let Some(vr) = d::parse_tag(&app.meta.add_tag).and_then(|t| d::tag_info(t).vr) { if VRS.contains(&vr) { app.meta.add_vr = vr.into(); } } }
        egui::ComboBox::from_id_salt("addvr").selected_text(app.meta.add_vr.clone()).width(60.0).show_ui(ui, |ui| { for v in VRS { ui.selectable_value(&mut app.meta.add_vr, v.to_string(), *v); } });
    });
    ui.horizontal(|ui| {
        ui.add(egui::TextEdit::singleline(&mut app.meta.add_value).hint_text("Value").desired_width(ui.available_width() - 50.0));
        if ui.button("Add").clicked() {
            match d::parse_tag(&app.meta.add_tag) {
                None => app.meta.add_error = "Enter a tag like (0018,1004) or a keyword like PlateID.".into(),
                Some(t) if READ_ONLY.contains(&t) || (t >> 16) == 0x0002 => app.meta.add_error = "That field is managed by WeldScope.".into(),
                Some(t) => { let vr = app.meta.add_vr.clone(); let v = app.meta.add_value.clone(); match app.set_field(&[], t, &v, Some(&vr)) { Ok(()) => { app.meta.add_error.clear(); app.meta.add_tag.clear(); app.meta.add_value.clear(); } Err(m) => app.meta.add_error = m } }
            }
        }
    });
    if !app.meta.add_error.is_empty() { ui.label(RichText::new(&app.meta.add_error).color(BAD).small()); }
}
fn templates(app: &mut App, ui: &mut egui::Ui) {
    section(ui, "Templates");
    note(ui, "A template stores the fields you changed in this file, to apply to other files.");
    ui.horizontal(|ui| {
        let names: Vec<String> = app.prefs.templates.keys().cloned().collect();
        egui::ComboBox::from_id_salt("tpl").selected_text(if app.meta.tpl_sel.is_empty() { "Choose…".to_string() } else { app.meta.tpl_sel.clone() }).width(150.0).show_ui(ui, |ui| { for n in names { ui.selectable_value(&mut app.meta.tpl_sel, n.clone(), n); } });
        let has = app.prefs.templates.contains_key(&app.meta.tpl_sel);
        if ui.add_enabled(has, egui::Button::new("Apply")).clicked() { let n = app.meta.tpl_sel.clone(); app.apply_template(&n); }
        if ui.add_enabled(has, egui::Button::new("Delete")).clicked() { let n = app.meta.tpl_sel.clone(); app.prefs.templates.remove(&n); app.meta.tpl_sel.clear(); }
    });
    ui.horizontal(|ui| {
        ui.add(egui::TextEdit::singleline(&mut app.meta.tpl_name).hint_text("Template name").desired_width(150.0));
        let changed = shots::changed_tags(&app.cur().unwrap().shot.orig_els);
        if ui.add_enabled(!changed.is_empty() && !app.meta.tpl_name.trim().is_empty(), egui::Button::new("Save changed fields")).clicked() {
            let ds: &Dataset = &app.cur().unwrap().shot.file.ds;
            let utf8 = d::charset_is_utf8(ds);
            let v: Vec<(String, Option<String>)> = changed.iter().map(|t| (d::hex8(*t), ds.get(*t).map(|e| d::value_to_text(e, utf8)))).collect();
            let name = app.meta.tpl_name.trim().to_string();
            app.prefs.templates.insert(name.clone(), v);
            app.meta.tpl_sel = name.clone(); app.meta.tpl_name.clear();
            app.toast(format!("Template “{name}” saved ({} field(s)).", changed.len()));
        }
    });
}

// ---------------------------------------------------------------- image
fn slider(ui: &mut egui::Ui, v: &mut f64, r: std::ops::RangeInclusive<f64>, label: &str, step: f64) -> egui::Response {
    ui.add(egui::Slider::new(v, r).text(label).step_by(step).clamping(egui::SliderClamping::Always))
}

fn image_tab(app: &mut App, ui: &mut egui::Ui) {
    let Some(img) = app.img() else {
        let e = app.cur().unwrap();
        ui.label(RichText::new(if e.work.img_error.is_empty() { "Opening…".to_string() } else { e.work.img_error.clone() }).color(BAD));
        return;
    };
    section(ui, "Window / level");
    let (a, b) = (img.min as f64 * img.slope + img.intercept, img.max as f64 * img.slope + img.intercept);
    let (lo, hi) = (a.min(b), a.max(b));
    let mut w = app.win();
    let step = (w.w / 100.0).max(0.1); // fine steps: 1% of the current window width
    let mut changed = false;
    ui.horizontal(|ui| {
        if ui.small_button("−").on_hover_text("Level down a small step").clicked() { w.c -= step; changed = true; }
        if ui.small_button("+").on_hover_text("Level up a small step").clicked() { w.c += step; changed = true; }
        changed |= ui.add(egui::Slider::new(&mut w.c, lo..=hi).text("Level").drag_value_speed(step / 2.0).clamping(egui::SliderClamping::Never)).changed();
    });
    ui.horizontal(|ui| {
        if ui.small_button("−").on_hover_text("Narrower window (more contrast), small step").clicked() { w.w = (w.w * 0.98).max(1.0); changed = true; }
        if ui.small_button("+").on_hover_text("Wider window (less contrast), small step").clicked() { w.w *= 1.02; changed = true; }
        changed |= ui.add(egui::Slider::new(&mut w.w, 1.0..=(hi - lo).max(2.0)).text("Width").logarithmic(true).drag_value_speed(step / 2.0).clamping(egui::SliderClamping::Never)).changed();
    });
    if changed { app.set_win(w); }
    note(ui, "For fine changes use − and +, drag the number, or right-drag on the image (hold Shift for finer steps).");
    ui.horizontal(|ui| {
        if ui.button("Auto").on_hover_text("Window on the main exposure, leaving out unexposed areas and markers").clicked() { app.reset_window("auto"); }
        if ui.add_enabled(img.window_width.map_or(false, |w| w > 0.0) && !app.edge.on, egui::Button::new("File")).on_hover_text("The window stored in the file").clicked() { app.reset_window("file"); }
        if ui.add_enabled(!app.edge.on, egui::Button::new("Full range")).clicked() { app.reset_window("full"); }
    });
    ui.add_enabled(!app.edge.on, egui::Checkbox::new(&mut app.ts.store_window, "Store this window in the saved copy"));

    section(ui, "EDGE-style enhancement");
    let mut on = app.edge.on;
    if ui.checkbox(&mut on, "Show enhanced (display only)").changed() { app.set_edge_on(on); }
    ui.add_enabled_ui(app.edge.on, |ui| {
        let before = app.edge;
        let mut e = app.edge;
        let mut released = false;
        for (v, r, l, s) in [(&mut e.gc, 0.0..=2.0, "Global contrast", 0.05), (&mut e.dc, 0.0..=3.0, "Detail contrast", 0.05), (&mut e.sh, 0.0..=3.0, "Sharpness", 0.05), (&mut e.nr, 0.0..=1.0, "Noise reduction", 0.05), (&mut e.mm, 2.0..=60.0, "Kernel (mm)", 0.5), (&mut e.br, -1.0..=1.0, "Brightness", 0.05)] {
            let resp = slider(ui, v, r, l, s);
            if resp.drag_stopped() || (resp.changed() && !resp.dragged()) { released = true; }
        }
        ui.checkbox(&mut e.ds, "Despeckle (remove white dust specks)");
        let brightness_only = e.br != before.br && EdgeKey::from(e) == EdgeKey::from(before);
        app.edge = e;
        if brightness_only { app.invalidate(); }
        else if e != before && (released || e.ds != before.ds) { app.update_edge(false); }
        else if e != before && !released { app.edge_pending = false; }
        ui.horizontal(|ui| {
            if ui.button("Re-window").on_hover_text("Automatic window for the enhanced image").clicked() { app.reset_window("auto"); }
            if ui.button("Defaults").clicked() { let on = app.edge.on; app.edge = crate::app::EdgeSettings { on, ..Default::default() }; app.update_edge(true); }
            if ui.button(RichText::new("Apply to pixels").color(ACCENT)).on_hover_text("Write the enhancement into the image (undoable); the saved copy is marked DERIVED").clicked() { app.bake_edge(); }
        });
    });
    if let Some(ds) = app.cur().and_then(|e| d::industrex_display_settings(&e.shot.orig.ds)) {
        let parts: Vec<String> = ["Image Class", "Brightness", "Global Contrast", "Detail Contrast", "Sharpness", "Noise Reduction", "Despeckle"].iter()
            .filter_map(|k| ds.get(k).map(|v| format!("{k} {}", match v { d::Setting::Num(n) => n.to_string(), d::Setting::Text(t) => t.clone() }))).collect();
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new(format!("This file's INDUSTREX display settings: {}{}", if ds.filter.is_empty() { "filter" } else { &ds.filter }, if parts.is_empty() { String::new() } else { format!(" · {}", parts.join(" · ")) })).small());
            if ui.small_button("Use these").clicked() { app.edge_from_file(); }
        });
    }
    note(ui, "An approximation in the style of Kodak/Carestream processing (large-scale and detail bands). Carestream's EDGE algorithm is not published; this is not INDUSTREX's EDGE and is not calibrated to it.");

    section(ui, "Orientation");
    ui.horizontal_wrapped(|ui| {
        for (op, l) in [("rot-ccw", "Rotate left"), ("rot-cw", "Rotate right"), ("rot-180", "180°"), ("flip-h", "Flip left–right"), ("flip-v", "Flip top–bottom")] { if ui.button(l).clicked() { app.run_op(op); } }
    });
    note(ui, "These change the pixels in the saved copy. To only turn the view, use Turn view above the image.");

    section(ui, "Clean up");
    ui.horizontal_wrapped(|ui| {
        if ui.button("Reduce noise (3×3 median)").clicked() { app.run_op("median"); }
        if ui.button("Invert pixel values").clicked() { app.run_op("invert"); }
    });
    ui.horizontal(|ui| { ui.add(egui::DragValue::new(&mut app.ts.smooth).range(0.3..=10.0).speed(0.05).prefix("radius ")); if ui.button("Smooth").clicked() { app.run_op("smooth"); } });
    ui.horizontal(|ui| {
        ui.add(egui::DragValue::new(&mut app.ts.sharpen_r).range(0.3..=10.0).speed(0.05).prefix("radius "));
        ui.add(egui::DragValue::new(&mut app.ts.sharpen_a).range(0.1..=10.0).speed(0.05).prefix("amount "));
        if ui.button("Sharpen").clicked() { app.run_op("sharpen"); }
    });
    ui.horizontal(|ui| { ui.add(egui::DragValue::new(&mut app.ts.badpix).range(1.0..=100.0).speed(0.5).prefix("limit ").suffix("% of range")); if ui.button("Fix bad pixels").clicked() { app.run_op("badpix"); } });

    section(ui, "Scratches");
    note(ui, "Only thin lines that read as less radiation than the plate on both sides are repaired. Cracks, voids and anything reading as more radiation are never touched, and IQI wires are left alone.");
    ui.horizontal(|ui| {
        ui.add(egui::Slider::new(&mut app.ts.scratch_w, 1..=15).text("max width (px)"));
    });
    ui.horizontal_wrapped(|ui| {
        if ui.button("Find long scratches").clicked() { app.find_scratches(); }
        if ui.selectable_label(app.tool == crate::app::Tool::Scratch, "Draw over a scratch").clicked() { app.tool = crate::app::Tool::Scratch; }
    });
    if !app.scratches.is_empty() {
        for (i, s) in app.scratches.iter().enumerate() { ui.label(RichText::new(format!("S{}: {:.0} px long, on {:.0}% of its length", i + 1, ((s.x1 - s.x0).powi(2) + (s.y1 - s.y0).powi(2)).sqrt(), s.coverage * 100.0)).color(Color32::from_rgb(0, 220, 255))); }
        ui.horizontal(|ui| {
            if ui.button(RichText::new("Repair found scratches").color(ACCENT)).on_hover_text("Check the cyan lines first").clicked() {
                let segs = app.scratches.iter().map(|s| im::Segment { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }).collect();
                app.repair_scratches(segs, false);
            }
            if ui.button("Clear").clicked() { app.scratches.clear(); }
        });
    }

    section(ui, "Possible indications");
    note(ui, "Marks spots inside the weld band for you to look at, strongest first. It does not measure, accept or reject anything; it can miss indications and it marks things that are not indications. The marks and your calls are never written to the DICONDE file or to exported pictures.");
    let have_model = app.ind_models.is_some() || App::indication_model_path().is_file();
    if !have_model { ui.label(RichText::new(format!("The indication model file is missing. It should be here: {}", App::indication_model_path().display())).color(BAD).small()); }
    ui.horizontal_wrapped(|ui| {
        if ui.add_enabled(have_model, egui::Button::new("Find possible indications")).on_hover_text("Works best on a cropped piece. Takes a few seconds for a piece and longer for a whole plate.").clicked() { app.find_indications(); }
        if ui.selectable_label(app.tool == crate::app::Tool::Mark, "Add one it missed").on_hover_text("Drag a box around an indication the finder did not mark.").clicked() { app.tool = if app.tool == crate::app::Tool::Mark { crate::app::Tool::Pan } else { crate::app::Tool::Mark }; }
        if app.review.is_some() {
            ui.checkbox(&mut app.ind_show, "Show marks").on_hover_text("M");
            if ui.button("Clear").on_hover_text("Takes the marks you have not judged off the screen. Your calls stay.").clicked() { app.clear_marks(); }
        }
    });
    if app.review.is_some() {
        let mut lv = app.prefs.ind_level.clamp(1, 5);
        ui.add(egui::Slider::new(&mut lv, 1..=5).text("sensitivity")).on_hover_text("1 marks only the strongest spots; 5 marks faint ones too, with many more that are not indications.");
        if lv != app.prefs.ind_level { app.prefs.ind_level = lv; app.ind_sel = None; }
        let shown = app.marks_shown();
        let (yes, no, todo) = app.review.as_ref().unwrap().counts(app.cut());
        let band = match &app.ind { None => String::new(), Some(f) => { let (films, sure) = (f.bands.films.len(), f.bands.films.iter().filter(|b| b.sure).count());
            format!("{}{}", if films == 0 { String::new() } else if sure == films { " Weld band found (green lines).".to_string() } else { format!(" Weld band clear on {sure} of {films} film{}; the whole film is searched where it is not (amber lines).", if films == 1 { "" } else { "s" }) }, if f.limited { " Only the strongest candidates were kept on this large image." } else { "" }) } };
        note(ui, &format!("{} mark{}: {yes} indication{}, {no} not, {todo} to look at.{band}", shown.len(), if shown.len() == 1 { "" } else { "s" }, if yes == 1 { "" } else { "s" }));
        let mut go = None;
        egui::ScrollArea::vertical().id_salt("ind_list").max_height(170.0).min_scrolled_height(130.0).show(ui, |ui| {
            let r = app.review.as_ref().unwrap();
            for (rank, n) in shown.iter().enumerate() {
                let m = &r.marks[*n];
                let what = if m.manual { "added by you".to_string() } else { format!("{}? · {:.2}", m.guess, m.score) };
                let (call, col) = match m.verdict { Verdict::Indication => (format!("  →  indication: {}", m.kind), OK), Verdict::NotIndication => ("  →  not an indication".to_string(), Color32::GRAY), Verdict::Unreviewed => (String::new(), ui.visuals().text_color()) };
                if ui.selectable_label(app.ind_sel == Some(*n), RichText::new(format!("{} · {what}{call}", rank + 1)).color(col)).on_hover_text("Show this spot. The finder's type is a guess; the number is its score, not a size.").clicked() { go = Some(*n); }
            }
        });
        if let Some(n) = go { app.show_indication(n); }
        if let Some(n) = app.ind_sel.filter(|n| shown.contains(n)) {
            let m = app.review.as_ref().unwrap().marks[n].clone();
            ui.horizontal_wrapped(|ui| {
                if ui.add(egui::Button::new("Indication").selected(m.verdict == Verdict::Indication)).on_hover_text("Y").clicked() { app.judge(n, Verdict::Indication); }
                if !m.manual && ui.add(egui::Button::new("Not an indication").selected(m.verdict == Verdict::NotIndication)).on_hover_text("N").clicked() { app.judge(n, Verdict::NotIndication); }
                if !m.manual && m.verdict != Verdict::Unreviewed && ui.button("Undo call").clicked() { app.judge(n, Verdict::Unreviewed); }
                if m.manual && ui.button("Remove").clicked() { app.remove_manual(n); }
            });
            if m.verdict == Verdict::Indication {
                let mut kind = m.kind.clone();
                egui::ComboBox::from_id_salt("ind_kind").selected_text(if kind.is_empty() { "type" } else { kind.as_str() }).show_ui(ui, |ui| { for t in weldscope_core::review::TYPES { ui.selectable_value(&mut kind, t.to_string(), t); } });
                if kind != m.kind { app.set_kind(n, &kind); }
            }
        }
        if todo > 0 && ui.button(format!("The other {todo} are not indications")).on_hover_text("Use after you have looked at every mark shown.").clicked() { app.rest_not(); }
        if !app.can_mark() { note(ui, "This image has unsaved changes (or no file on disk), so calls cannot be kept for it yet."); }
        else if let Some(p) = app.review_path().filter(|p| p.exists()) { note(ui, &format!("Your calls are kept in {}", p.display())); }
    }

    section(ui, "Saving");
    let can = img.bits_allocated <= 16;
    ui.add_enabled_ui(can, |ui| {
        ui.radio_value(&mut app.ts.save_j2k, true, "JPEG 2000 Lossless (like INDUSTREX)");
        ui.radio_value(&mut app.ts.save_j2k, false, "Uncompressed");
    });
    note(ui, "Applies to copies with image changes; metadata-only copies keep the original image data byte for byte.");
    let ops = app.cur().map_or(0, |e| e.work.ops.len());
    if ui.add_enabled(ops > 0, egui::Button::new("Revert all image changes")).clicked() { app.revert_image(); }
}

#[derive(PartialEq)]
struct EdgeKey(u64, u64, u64, u64, u64, bool, bool);
impl From<crate::app::EdgeSettings> for EdgeKey { fn from(e: crate::app::EdgeSettings) -> Self { EdgeKey(e.gc.to_bits(), e.dc.to_bits(), e.sh.to_bits(), e.nr.to_bits(), e.mm.to_bits(), e.ds, e.on) } }

// ---------------------------------------------------------------- crop & split
fn crop_tab(app: &mut App, ui: &mut egui::Ui) {
    let Some(img) = app.img() else { ui.label(RichText::new(app.cur().unwrap().work.img_error.clone()).color(BAD)); return; };
    section(ui, "Automatic");
    if ui.add(egui::Button::new(RichText::new("Process this plate…").strong().color(Color32::BLACK)).fill(ACCENT)).on_hover_text("Finds every piece of film, straightens and crops each one, shows you the result, then saves one new file per piece").clicked() { app.process_plate(); }
    note(ui, "One step: find the film pieces, straighten and crop each, preview, then save a new file per piece. Nothing is written until you confirm.");
    ui.horizontal_wrapped(|ui| {
        if ui.button(RichText::new("Straighten & crop to film").color(ACCENT)).on_hover_text("Measures the film's tilt from its edges, rotates it straight (0.05–5°) and crops away the area with no film. With two or more pieces of film, each is saved as its own straightened file.").clicked() { app.auto_straighten(); }
    });
    note(ui, "One piece: straightened and cropped here, as a step you can undo. Two or more: a preview opens, then each is saved as its own file.");
    ui.horizontal(|ui| {
        egui::ComboBox::from_id_salt("sens").selected_text(match app.ts.sens { s if s < 0.5 => "Low", s if s > 0.7 => "High", _ => "Normal" }).width(80.0).show_ui(ui, |ui| {
            ui.selectable_value(&mut app.ts.sens, 0.35, "Low"); ui.selectable_value(&mut app.ts.sens, 0.6, "Normal"); ui.selectable_value(&mut app.ts.sens, 0.85, "High");
        }).response.on_hover_text("How far a gap may sit above background and still split pieces");
        ui.add(egui::DragValue::new(&mut app.ts.margin).range(-50..=50).prefix("margin ").suffix(" px"));
        if ui.button("Find film pieces").clicked() { app.auto_split(); }
    });
    note(ui, "Finds separate pieces of film along the cleanest gaps (lines may tilt up to 2°). A weld band never splits a piece.");

    section(ui, "Crop");
    ui.horizontal(|ui| {
        let mut changed = false;
        for (i, l) in ["x", "y", "w", "h"].iter().enumerate() { changed |= ui.add(egui::TextEdit::singleline(&mut app.ts.crop_in[i]).desired_width(46.0).hint_text(*l)).changed(); }
        if changed {
            let v: Vec<Option<i64>> = app.ts.crop_in.iter().map(|s| s.trim().parse().ok()).collect();
            if let [Some(x), Some(y), Some(w), Some(h)] = v[..] {
                let x0 = x.clamp(0, img.cols as i64); let y0 = y.clamp(0, img.rows as i64);
                let r = Rect::new(x0, y0, w.min(img.cols as i64 - x0), h.min(img.rows as i64 - y0));
                if let Some(e) = app.cur_mut() { e.work.crop = if r.w >= 1 && r.h >= 1 { Some(r) } else { None }; }
            }
        }
    });
    let has = app.cur().map_or(false, |e| e.work.crop.is_some());
    ui.horizontal(|ui| {
        if ui.add_enabled(has, egui::Button::new("Apply crop")).clicked() { app.apply_crop(); }
        if ui.add_enabled(has, egui::Button::new("Clear")).clicked() { if let Some(e) = app.cur_mut() { e.work.crop = None; } app.sync_crop_inputs(); }
        if ui.selectable_label(app.tool == crate::app::Tool::Crop, "Draw").clicked() { app.tool = crate::app::Tool::Crop; }
    });

    section(ui, "Split into files");
    ui.horizontal(|ui| {
        ui.add(egui::DragValue::new(&mut app.ts.parts).range(2..=50).suffix(" parts"));
        egui::ComboBox::from_id_salt("dir").selected_text(if app.ts.stacked { "Stacked" } else { "Side by side" }).width(100.0).show_ui(ui, |ui| { ui.selectable_value(&mut app.ts.stacked, false, "Side by side"); ui.selectable_value(&mut app.ts.stacked, true, "Stacked"); });
        ui.add(egui::DragValue::new(&mut app.ts.overlap).range(0..=500).prefix("overlap ").suffix(" px"));
        if ui.button("Make").clicked() { app.make_equal_parts(); }
    });
    if ui.selectable_label(app.tool == crate::app::Tool::Region, "Draw regions by hand").clicked() { app.tool = crate::app::Tool::Region; }
    let n = app.cur().map_or(0, |e| e.work.regions.len());
    if n > 0 {
        let mut remove = None;
        let regions = app.cur().unwrap().work.regions.clone();
        for (i, r) in regions.iter().enumerate() {
            ui.horizontal(|ui| {
                ui.label(RichText::new(format!("{}", i + 1)).strong());
                let mut l = r.label.clone();
                if ui.add(egui::TextEdit::singleline(&mut l).desired_width(90.0)).changed() { app.cur_mut().unwrap().work.regions[i].label = l; }
                if ui.small_button("✖").clicked() { remove = Some(i); }
                let rr = r.region.rect;
                ui.label(RichText::new(format!("{}×{} at ({}, {}){}{}", rr.w, rr.h, rr.x, rr.y, r.tilt.map(|t| format!(" · tilt {t:.2}°")).unwrap_or_default(), if r.region.cuts.is_empty() { "" } else { " · tilted dividing line" })).small().weak());
            });
        }
        if let Some(i) = remove { app.cur_mut().unwrap().work.regions.remove(i); }
        ui.checkbox(&mut app.ts.straighten, "Straighten each piece and crop it to the film");
        let any_cuts = regions.iter().any(|r| !r.region.cuts.is_empty());
        if any_cuts && !app.ts.straighten {
            ui.add_enabled(img.padding.is_some(), egui::Checkbox::new(&mut app.ts.fill, "Fill the neighbour's sliver with the Pixel Padding Value"))
                .on_disabled_hover_text("This file has no Pixel Padding Value, so slivers are kept.");
        }
        ui.horizontal(|ui| {
            ui.label("Part label goes to");
            egui::ComboBox::from_id_salt("lt").selected_text(["File name only", "Image Comments", "Component ID suffix"][app.ts.label_target as usize]).show_ui(ui, |ui| {
                ui.selectable_value(&mut app.ts.label_target, 0, "File name only"); ui.selectable_value(&mut app.ts.label_target, 1, "Image Comments"); ui.selectable_value(&mut app.ts.label_target, 2, "Component ID suffix");
            });
        });
        ui.horizontal(|ui| {
            if ui.button(RichText::new(format!("Preview and save {n} files…")).color(ACCENT)).clicked() { app.save_split(); }
            if ui.button("Clear regions").clicked() { app.cur_mut().unwrap().work.regions.clear(); }
        });
        note(ui, "Each part is a new file in a new series, numbered in screen order, with a Derivation Description and a reference to the original.");
    }
}

// ---------------------------------------------------------------- overlay
fn overlay_tab(app: &mut App, ui: &mut egui::Ui) {
    let o = &mut app.prefs.overlay;
    ui.checkbox(&mut o.enabled, "Show the information overlay on the image");
    ui.checkbox(&mut o.labels, "Show field names");
    ui.checkbox(&mut o.in_exports, "Include it in PNG and PDF exports");
    ui.horizontal(|ui| { ui.label("Text size"); for (v, l) in [(0u8, "Small"), (1, "Medium"), (2, "Large")] { ui.selectable_value(&mut o.size, v, l); } });
    note(ui, "Display and export only: the overlay is never written into the DICONDE file.");
    let mut layout = o.layout();
    let ds = app.cur().map(|e| e.shot.file.ds.clone()).unwrap_or_default();
    let mut choices: Vec<(String, String)> = LIVE.iter().map(|(k, n)| (k.to_string(), format!("{n} (live)"))).collect();
    for (_, tags) in COMMON { for t in tags.iter() { choices.push((overlay::hex_of(*t), d::tag_info(*t).name)); } }
    for t in ds.el.keys() { let h = overlay::hex_of(*t); if (*t >> 16) & 1 == 0 && *t != d::PIXEL && !choices.iter().any(|c| c.0 == h) { choices.push((h, d::describe_tag(&ds, *t).name)); } }
    let mut changed = false;
    for c in 0..4 {
        section(ui, overlay::corner_name(overlay::CORNERS[c]));
        let mut action: Option<(usize, i32)> = None;
        for (i, k) in layout.corners[c].iter().enumerate() {
            ui.horizontal(|ui| {
                ui.label(overlay::item_name(k, &ds));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.small_button("✖").clicked() { action = Some((i, 0)); }
                    if ui.small_button("↓").clicked() { action = Some((i, 1)); }
                    if ui.small_button("↑").clicked() { action = Some((i, -1)); }
                });
            });
        }
        if let Some((i, a)) = action {
            let v = &mut layout.corners[c];
            match a { 0 => { v.remove(i); } -1 if i > 0 => v.swap(i, i - 1), 1 if i + 1 < v.len() => v.swap(i, i + 1), _ => {} }
            changed = true;
        }
        let mut pick = String::new();
        egui::ComboBox::from_id_salt(format!("ovadd{c}")).selected_text("Add…").width(200.0).show_ui(ui, |ui| { for (k, n) in &choices { ui.selectable_value(&mut pick, k.clone(), n); } });
        if !pick.is_empty() { for cc in layout.corners.iter_mut() { cc.retain(|k| *k != pick); } layout.corners[c].push(pick); changed = true; }
    }
    if ui.button("Reset layout").clicked() { layout = overlay::Layout::default(); changed = true; }
    if changed { app.prefs.overlay.layout = layout.corners.to_vec(); }
}

// ---------------------------------------------------------------- changes
fn changes_tab(app: &mut App, ui: &mut egui::Ui) {
    let e = app.cur().unwrap();
    section(ui, "Image changes");
    if e.work.ops.is_empty() { note(ui, "No image changes."); } else { for o in &e.work.ops { ui.label(format!("• {o}")); } }
    section(ui, "Metadata changes");
    let m = shots::meta_change_list(&e.shot.file, &e.shot.orig_els);
    if m.is_empty() { note(ui, "No metadata changes."); } else { for o in m { ui.label(format!("• {o}")); } }
    section(ui, "INDUSTREX check of the last saved file");
    match &e.compat {
        None => note(ui, "Save as new file to check it. Every saved file is read back and checked against Carestream's INDUSTREX DICOM/DICONDE Conformance Statement and real INDUSTREX files."),
        Some(c) => {
            let s = compat::summary(&c.checks);
            ui.label(RichText::new(if s.fail > 0 { format!("{} problem(s) found", s.fail) } else if s.warn > 0 { format!("Passed with {} warning(s)", s.warn) } else { "All checks passed".to_string() }).strong()
                .color(if s.fail > 0 { BAD } else if s.warn > 0 { crate::app::WARN } else { OK }));
            ui.label(format!("for {} ({} passed)", crate::app::elide(&c.name, 50), s.pass));
            let mut v = c.checks.clone();
            v.sort_by_key(|c| c.level);
            for ch in v {
                let mark = match ch.level { Level::Fail => "✖", Level::Warn => "!", Level::Info => "i", Level::Pass => "✔" };
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new(mark).color(App::compat_level_color(ch.level)).strong());
                    ui.label(&ch.title);
                    if !ch.detail.is_empty() { ui.label(RichText::new(&ch.detail).weak().small()); }
                });
            }
            note(ui, "These checks are strong evidence, not proof: opening the copy in INDUSTREX is the final confirmation.");
        }
    }
    section(ui, "File");
    let ds = &e.shot.orig.ds;
    ui.label(format!("Original SOP Instance UID: {}", { let s = ds.string(0x00080018); if s.is_empty() { "—".into() } else { s } }));
    ui.label(format!("Transfer syntax: {}", d::ts_name(&e.shot.orig.transfer_syntax)));
    match &e.work.img { Some(i) => { ui.label(format!("Pixels: {}-bit {}, {}, {} frame(s)", i.bits_stored, if i.signed { "signed" } else { "unsigned" }, i.photometric, i.frames.len())); } None => { ui.label(&e.work.img_error); } }
    let _ = Win { c: 0.0, w: 1.0 };
}
