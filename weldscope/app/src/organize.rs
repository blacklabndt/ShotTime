//! The file pane (Edit tab) and the Organize shots view: shots grouped by weld, multi-select, batch metadata edits
//! (every shot is validated before any changes), renumbering and saving all edited files.

use crate::app::{batch_tags, elide, App, ACCENT, BAD, COMMON, OK};
use eframe::egui::{self, Color32, RichText};
use std::collections::BTreeSet;
use weldscope_core::dicom as d;
use weldscope_core::shots::{self, Common, GROUP_FIELDS};

fn group_name(tag: u32) -> String { d::tag_info(tag).name }

/// Entry ids in display order, grouped by the chosen weld field.
pub fn grouped(app: &App) -> Vec<(String, Vec<u64>)> {
    let refs: Vec<&shots::Shot> = app.entries.iter().map(|e| &e.shot).collect();
    shots::groups(&refs, app.prefs.group_tag).into_iter().map(|(k, v)| (k, v.into_iter().map(|i| refs[i].id).collect())).collect()
}

fn group_picker(app: &mut App, ui: &mut egui::Ui) {
    egui::ComboBox::from_id_salt(ui.next_auto_id()).selected_text(format!("Weld: {}", group_name(app.prefs.group_tag))).show_ui(ui, |ui| {
        for t in GROUP_FIELDS { ui.selectable_value(&mut app.prefs.group_tag, t, group_name(t)); }
    }).response.on_hover_text("The field that identifies the weld (INDUSTREX keeps the weld/shot ID in Series Description)");
}

/// "X-81 · Shot 1" when the file has a weld or shot number; None when it has neither.
fn short_label(e: &crate::app::FileEntry, group_tag: u32) -> Option<String> {
    let (weld, shot) = (e.shot.text(group_tag).trim().to_string(), e.shot.text(0x00200013));
    match (weld.is_empty(), shot.is_empty()) { (true, true) => None, (false, true) => Some(elide(&weld, 26)), (true, false) => Some(format!("Shot {shot}")), _ => Some(format!("{} · Shot {shot}", elide(&weld, 20))) }
}
fn date_text(e: &crate::app::FileEntry) -> String {
    let dt = { let a = e.shot.text(0x00080022); if a.is_empty() { e.shot.text(0x00080020) } else { a } };
    weldscope_core::overlay::format_value("DA", &dt)
}

pub fn file_pane(app: &mut App, ui: &mut egui::Ui) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(if app.folder.is_empty() { "Files".to_string() } else { std::path::Path::new(&app.folder).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(app.folder.clone()) }).strong())
            .on_hover_text(&app.folder);
        ui.label(RichText::new(format!("{}", app.entries.len())).weak());
    });
    if app.entries.is_empty() { ui.label(RichText::new("Open a folder to list its files here.").weak()); return; }
    group_picker(app, ui);
    let n = app.entries.iter().filter(|e| e.dirty).count();
    if ui.add_enabled(n > 0, egui::Button::new(format!("Save all edited ({n})"))).on_hover_text("Writes a new file for every edited file into the folder shown at the bottom; originals and existing files are never overwritten").clicked() { app.save_all_edited(); }
    ui.separator();
    let groups = grouped(app);
    let mut open = None;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for (key, ids) in groups {
            let title = if key.is_empty() { format!("No {} ({})", group_name(app.prefs.group_tag), ids.len()) } else { format!("{key} ({})", ids.len()) };
            egui::CollapsingHeader::new(RichText::new(title).strong()).id_salt(&key).default_open(true).show(ui, |ui| {
                for id in ids {
                    let Some(i) = app.idx(id) else { continue };
                    let e = &app.entries[i];
                    let sel = app.cur == Some(id);
                    ui.horizontal(|ui| {
                        if let Some(t) = &e.thumb { ui.add(egui::Image::new(t).fit_to_exact_size(egui::vec2(34.0, 34.0)).maintain_aspect_ratio(true)); } else { ui.add_space(38.0); }
                        // main label: weld and shot number; the long file name goes underneath
                        let main = short_label(e, app.prefs.group_tag);
                        let r = ui.vertical(|ui| {
                            ui.spacing_mut().item_spacing.y = 0.0;
                            let mut text = RichText::new(main.clone().unwrap_or_else(|| elide(&e.shot.name, 30)));
                            if sel { text = text.strong(); }
                            let r = ui.selectable_label(sel, text);
                            if main.is_some() { ui.label(RichText::new(elide(&e.shot.name, 22)).weak().small()); }
                            r
                        }).inner;
                        if e.dirty { ui.label(RichText::new("●").color(ACCENT)).on_hover_text("Changes not saved as a new file yet"); }
                        else if let Some(c) = &e.compat {
                            let sm = weldscope_core::compat::summary(&c.checks);
                            if sm.fail > 0 { ui.label(RichText::new("✖").color(BAD)).on_hover_text(format!("Saved as {}, but the INDUSTREX check found {} problem(s)", e.shot.saved_as, sm.fail)); }
                            else { ui.label(RichText::new("✔").color(OK)).on_hover_text(format!("Saved as {} — passed the INDUSTREX check", e.shot.saved_as)); }
                        }
                        else if !e.shot.saved_as.is_empty() { ui.label(RichText::new("✔").color(OK)).on_hover_text(format!("Saved as {}", e.shot.saved_as)); }
                        if r.clicked() { open = Some(id); }
                        r.on_hover_text(format!("{}\n{}", e.shot.name, e.shot.path));
                    });
                }
            });
        }
    });
    if let Some(id) = open { app.open_entry(id); }
}

pub fn organize(app: &mut App, ui: &mut egui::Ui) {
    ui.horizontal_wrapped(|ui| {
        ui.heading("Organize shots");
        ui.separator();
        group_picker(app, ui);
        if ui.button("Select all").clicked() { app.org.sel = app.entries.iter().map(|e| e.shot.id).collect(); }
        if ui.button("Select none").clicked() { app.org.sel.clear(); }
        ui.label(RichText::new(format!("{} shots, {} selected", app.entries.len(), app.org.sel.len())).weak());
        if ui.button("Add files").clicked() { app.open_files_dialog(); }
        let n = app.entries.iter().filter(|e| e.dirty).count();
        if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("Save all edited ({n})")).color(if n > 0 { ACCENT } else { ui.visuals().text_color() }))).clicked() { app.save_all_edited(); }
    });
    if !app.org.result.is_empty() { ui.label(RichText::new(&app.org.result).color(OK)); }
    ui.label(RichText::new("Click to select, Ctrl+click to add, Shift+click for a range, double-click to open. Drag shots onto another weld to move them there.").weak().small());
    ui.separator();
    if app.entries.is_empty() { ui.label("Open a folder or add files to organize them by weld."); return; }
    let groups = grouped(app);
    let order: Vec<u64> = groups.iter().flat_map(|(_, v)| v.iter().copied()).collect();
    let mut clicked: Option<(u64, egui::Modifiers)> = None;
    let mut open = None;
    let mut rename: Option<(String, String)> = None;
    let mut drop_on: Option<String> = None;
    let dragging: Option<u64> = egui::DragAndDrop::payload::<u64>(ui.ctx()).map(|p| *p);
    let (pointer, released) = ui.input(|i| (i.pointer.interact_pos(), i.pointer.any_released()));
    let field = group_name(app.prefs.group_tag);
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for (key, ids) in &groups {
            ui.add_space(4.0);
            let group = ui.scope(|ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    let editing = app.rename_weld.as_ref().map_or(false, |(k, _)| k == key);
                    if editing {
                        let buf = &mut app.rename_weld.as_mut().unwrap().1;
                        let r = ui.add(egui::TextEdit::singleline(buf).desired_width(180.0).hint_text(format!("New {field}")));
                        r.request_focus();
                        let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
                        if ui.button("Rename").clicked() || enter { rename = app.rename_weld.take(); }
                        else if ui.button("Cancel").clicked() || ui.input(|i| i.key_pressed(egui::Key::Escape)) { app.rename_weld = None; }
                    } else {
                        ui.label(RichText::new(if key.is_empty() { format!("No {field}") } else { key.clone() }).size(16.0).strong());
                        ui.label(RichText::new(format!("{} shot{}", ids.len(), if ids.len() == 1 { "" } else { "s" })).weak());
                        if ui.small_button("Select weld").clicked() { app.org.sel = ids.iter().copied().collect(); }
                        if ui.small_button(if key.is_empty() { "Name this weld" } else { "Rename weld" }).on_hover_text(format!("Changes {field} on every shot in this group (one undo step)")).clicked() { app.rename_weld = Some((key.clone(), key.clone())); }
                    }
                });
                ui.horizontal_wrapped(|ui| {
                    for &id in ids {
                        let Some(i) = app.idx(id) else { continue };
                        let e = &app.entries[i];
                        let sel = app.org.sel.contains(&id);
                        let frame = egui::Frame::group(ui.style()).fill(if sel { Color32::from_rgb(0x4A, 0x30, 0x12) } else { Color32::from_gray(30) }).stroke(egui::Stroke::new(if sel { 2.0_f32 } else { 1.0 }, if sel { ACCENT } else { Color32::from_gray(60) }));
                        let r = frame.show(ui, |ui| {
                            ui.set_width(150.0);
                            ui.vertical_centered(|ui| {
                                match &e.thumb { Some(t) => { ui.add(egui::Image::new(t).fit_to_exact_size(egui::vec2(140.0, 120.0)).maintain_aspect_ratio(true)); } None => { ui.add_sized([140.0, 120.0], egui::Spinner::new()); } }
                                // key fields, so mistakes show without selecting the shot
                                let (weld, shot, date) = (e.shot.text(app.prefs.group_tag), e.shot.text(0x00200013), date_text(e));
                                ui.label(RichText::new(format!("{}{}", if weld.trim().is_empty() { "(no weld)".to_string() } else { elide(weld.trim(), 16) }, if shot.is_empty() { " · no shot no.".to_string() } else { format!(" · Shot {shot}") })).strong());
                                if !date.is_empty() { ui.label(RichText::new(date).small()); }
                                ui.label(RichText::new(elide(&e.shot.name, 26)).small().weak()).on_hover_text(&e.shot.name);
                                if e.dirty { ui.label(RichText::new("● edited").small().color(ACCENT)); }
                                else if let Some(c) = &e.compat { if weldscope_core::compat::summary(&c.checks).fail > 0 { ui.label(RichText::new("✖ saved, check failed").small().color(BAD)); } else { ui.label(RichText::new("✔ saved, check passed").small().color(OK)); } }
                                else if !e.shot.saved_as.is_empty() { ui.label(RichText::new("✔ saved").small().color(OK)); }
                            });
                        }).response.interact(egui::Sense::click_and_drag());
                        if r.drag_started() { egui::DragAndDrop::set_payload(ui.ctx(), id); }
                        if r.double_clicked() { open = Some(id); } else if r.clicked() { clicked = Some((id, ui.input(|i| i.modifiers))); }
                    }
                });
            }).response.rect;
            // drop target: another weld's area while shots are being dragged
            if let (Some(d), Some(p)) = (dragging, pointer) {
                if group.contains(p) && !ids.contains(&d) {
                    ui.painter().rect_stroke(group.expand(2.0), 6.0, egui::Stroke::new(2.0_f32, ACCENT));
                    if released { drop_on = Some(key.clone()); }
                }
            }
        }
    });
    if let Some(d) = dragging {
        let moving: Vec<u64> = if app.org.sel.contains(&d) { order.iter().copied().filter(|x| app.org.sel.contains(x)).collect() } else { vec![d] };
        if let Some(p) = pointer {
            egui::Area::new(egui::Id::new("dragtip")).fixed_pos(p + egui::vec2(14.0, 14.0)).order(egui::Order::Tooltip).interactable(false).show(ui.ctx(), |ui| {
                egui::Frame::popup(ui.style()).show(ui, |ui| { ui.label(format!("Move {} shot{} to another weld", moving.len(), if moving.len() == 1 { "" } else { "s" })); });
            });
        }
        if released {
            egui::DragAndDrop::clear_payload(ui.ctx());
            if let Some(key) = drop_on { set_weld(app, &moving, &key, &format!("Moved {} shot{} to {}", moving.len(), if moving.len() == 1 { "" } else { "s" }, if key.is_empty() { format!("no {field}") } else { key.clone() })); }
        }
    }
    if let Some((old, new)) = rename {
        let new = new.trim().to_string();
        if new != old {
            let ids = groups.iter().find(|(k, _)| *k == old).map(|(_, v)| v.clone()).unwrap_or_default();
            set_weld(app, &ids, &new, &format!("Renamed weld {} to {}", if old.is_empty() { "(none)" } else { &old }, if new.is_empty() { "(none)" } else { &new }));
        }
    }
    if let Some((id, m)) = clicked {
        if m.shift { if let Some(a) = app.org.anchor { let (p, q) = (order.iter().position(|x| *x == a).unwrap_or(0), order.iter().position(|x| *x == id).unwrap_or(0)); for k in p.min(q)..=p.max(q) { app.org.sel.insert(order[k]); } } }
        else if m.command || m.ctrl { if !app.org.sel.remove(&id) { app.org.sel.insert(id); } app.org.anchor = Some(id); }
        else { app.org.sel = [id].into_iter().collect(); app.org.anchor = Some(id); }
    }
    if let Some(id) = open { app.open_entry(id); }
}

/// Sets the weld field on the given shots (every shot is checked first; one undo step).
fn set_weld(app: &mut App, ids: &[u64], value: &str, text: &str) {
    if ids.is_empty() { return; }
    let tag = app.prefs.group_tag;
    let changes = vec![(tag, Some(value.to_string()))];
    if app.shots_change(ids, text, |list| shots::apply_batch(list, &changes).map(|_| ()).map_err(|errs| errs.into_iter().map(|e| format!("{}: {} — {}", e.name, e.field, e.message)).collect())) {
        app.remember_value(tag, value);
    } else { let m = app.org.errors.first().cloned().unwrap_or_default(); app.error(format!("Not changed: {m}")); }
}

pub fn batch_panel(app: &mut App, ui: &mut egui::Ui) {
    ui.heading("Batch edit");
    let order: Vec<u64> = grouped(app).into_iter().flat_map(|(_, v)| v).collect();
    let sel: Vec<u64> = order.iter().copied().filter(|id| app.org.sel.contains(id)).collect();
    if sel.is_empty() { ui.label(RichText::new("Select shots on the left to edit their metadata together.").weak()); return; }
    ui.label(format!("{} shot{} selected", sel.len(), if sel.len() == 1 { "" } else { "s" }));
    let tags = batch_tags();
    let common = { let refs: Vec<&shots::Shot> = app.entries.iter().filter(|e| sel.contains(&e.shot.id)).map(|e| &e.shot).collect(); shots::common_values(&refs, &tags) };
    let mut apply = false;
    egui::ScrollArea::vertical().auto_shrink([false, false]).max_height(ui.available_height() - 150.0).show(ui, |ui| {
        for (group, gtags) in COMMON.iter().filter(|(n, _)| *n != "Display") {
            egui::CollapsingHeader::new(RichText::new(*group).strong()).default_open(*group == "Inspection" || *group == "Component").show(ui, |ui| {
                for &t in gtags.iter() {
                    let name = d::tag_info(t).name;
                    let pending = app.org.pending.contains_key(&t) || app.org.removals.contains(&t);
                    ui.label(if pending { RichText::new(&name).color(ACCENT) } else { RichText::new(&name) }).on_hover_text(d::tag_hex(t));
                    ui.horizontal(|ui| {
                        let hint = match common.get(&t) { Some(Common::Same(v)) if !v.is_empty() => v.clone(), Some(Common::Same(_)) => "(empty)".into(), Some(Common::Mixed(n)) => format!("({n} different values)"), None => String::new() };
                        let mut buf = app.org.pending.get(&t).cloned().unwrap_or_else(|| match common.get(&t) { Some(Common::Same(v)) => v.clone(), _ => String::new() });
                        let removing = app.org.removals.contains(&t);
                        let r = ui.add_enabled(!removing, egui::TextEdit::singleline(&mut buf).hint_text(hint).desired_width(ui.available_width() - 88.0));
                        if r.changed() { app.org.pending.insert(t, buf.clone()); }
                        let sug = app.suggestions(t, &buf);
                        if !removing && !sug.is_empty() && !matches!(d::tag_info(t).vr, Some("DA") | Some("TM") | Some("DT")) {
                            ui.menu_button("▾", |ui| {
                                ui.label(RichText::new("Used before").weak().small());
                                for v in &sug { if ui.button(elide(v, 48)).clicked() { app.org.pending.insert(t, v.clone()); ui.close_menu(); } }
                            });
                        }
                        if r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) { apply = true; }
                        if pending { if ui.small_button("↺").on_hover_text("Leave this field as it is").clicked() { app.org.pending.remove(&t); app.org.removals.remove(&t); } }
                        else if ui.small_button("✖").on_hover_text("Remove this field from the selected shots").clicked() { app.org.removals.insert(t); }
                    });
                    if app.org.removals.contains(&t) { ui.label(RichText::new("will be removed").small().color(BAD)); }
                }
            });
        }
    });
    ui.separator();
    // only fields whose value really changes for at least one shot are applied
    let changes: Vec<(u32, Option<String>)> = app.org.pending.iter().filter(|(t, v)| !matches!(common.get(t), Some(Common::Same(c)) if c == *v)).map(|(t, v)| (*t, Some(v.clone())))
        .chain(app.org.removals.iter().map(|t| (*t, None))).collect();
    ui.horizontal(|ui| {
        if ui.add_enabled(!changes.is_empty(), egui::Button::new(RichText::new(format!("Apply to {} shot{}", sel.len(), if sel.len() == 1 { "" } else { "s" })).color(ACCENT))).clicked() { apply = true; }
        if ui.add_enabled(!app.org.pending.is_empty() || !app.org.removals.is_empty(), egui::Button::new("Clear")).clicked() { app.org.pending.clear(); app.org.removals.clear(); }
    });
    if apply && !changes.is_empty() {
        let text = format!("Batch edit: {} field(s) on {} shot(s)", changes.len(), sel.len());
        let ok = app.shots_change(&sel, &text, |shots_| shots::apply_batch(shots_, &changes).map(|_| ()).map_err(|errs| errs.into_iter().map(|e| format!("{}: {} — {}", e.name, e.field, e.message)).collect()));
        if ok { for (t, v) in &changes { if let Some(v) = v { app.remember_value(*t, v); } } app.org.pending.clear(); app.org.removals.clear(); }
    }
    for e in app.org.errors.iter().take(8) { ui.label(RichText::new(e).color(BAD).small()); }
    if !app.org.errors.is_empty() { ui.label(RichText::new("Nothing was changed. Correct the values and apply again.").color(BAD).small()); }
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        ui.add(egui::DragValue::new(&mut app.org.renumber_start).range(0..=99999).prefix("from "));
        if ui.button("Renumber shots").on_hover_text("Instance Number 1…n in the order shown").clicked() {
            let start = app.org.renumber_start;
            app.shots_change(&sel, &format!("Renumbered {} shot(s) from {start}", sel.len()), |list| {
                // keep the display order
                list.sort_by_key(|s| sel.iter().position(|x| *x == s.id).unwrap_or(usize::MAX));
                shots::renumber(list, start).map_err(|m| vec![m])
            });
        }
    });
    let names: Vec<String> = app.prefs.templates.keys().cloned().collect();
    if !names.is_empty() {
        ui.horizontal(|ui| {
            let mut pick = String::new();
            egui::ComboBox::from_id_salt("btpl").selected_text("Apply template…").show_ui(ui, |ui| { for n in &names { ui.selectable_value(&mut pick, n.clone(), n); } });
            if !pick.is_empty() {
                let tpl = app.prefs.templates[&pick].clone();
                let changes: Vec<(u32, Option<String>)> = tpl.iter().filter_map(|(k, v)| u32::from_str_radix(k, 16).ok().map(|t| (t, v.clone()))).collect();
                app.shots_change(&sel, &format!("Applied template “{pick}” to {} shot(s)", sel.len()), |list| shots::apply_batch(list, &changes).map(|_| ()).map_err(|errs| errs.into_iter().map(|e| format!("{}: {} — {}", e.name, e.field, e.message)).collect()));
            }
        });
    }
    ui.horizontal(|ui| {
        if sel.len() == 1 && ui.button("Open in editor").clicked() { app.open_entry(sel[0]); }
        if ui.button("Remove from list").on_hover_text("The files on disk are not touched").clicked() {
            let dirty = app.entries.iter().filter(|e| sel.contains(&e.shot.id) && e.dirty).count();
            let go = dirty == 0 || rfd::MessageDialog::new().set_title("WeldScope").set_description(format!("{dirty} of these files have unsaved changes. Remove them from the list anyway?")).set_buttons(rfd::MessageButtons::YesNo).show() == rfd::MessageDialogResult::Yes;
            if go {
                if app.cur.map_or(false, |c| sel.contains(&c)) { app.leave_current(); app.cur = None; }
                app.entries.retain(|e| !sel.contains(&e.shot.id));
                app.org.sel = BTreeSet::new();
                app.org.undo.clear(); app.org.redo.clear();
            }
        }
    });
}
