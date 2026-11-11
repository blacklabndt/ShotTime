//! Corner text overlay: which fields appear in which corner of the viewer, and how values are written. Display
//! and export only; nothing here is ever written into the DICONDE file.

use crate::dicom::{self as d, Dataset};

pub const CORNERS: [&str; 4] = ["tl", "tr", "bl", "br"];
pub fn corner_name(c: &str) -> &'static str { match c { "tl" => "Top left", "tr" => "Top right", "bl" => "Bottom left", _ => "Bottom right" } }
/// Items that are not DICOM tags: worked out from the current view.
pub const LIVE: [(&str, &str); 6] = [("live:wl", "Window / level"), ("live:zoom", "Zoom"), ("live:size", "Image size"), ("live:view", "View rotation"), ("live:file", "File name"), ("live:frame", "Frame")];
pub fn live_name(k: &str) -> Option<&'static str> { LIVE.iter().find(|(a, _)| *a == k).map(|(_, n)| *n) }

#[derive(Clone, Debug, PartialEq)]
pub struct Layout { pub corners: [Vec<String>; 4] }

impl Default for Layout {
    /// In the spirit of INDUSTREX's corner annotations: identification top left, company and people top right,
    /// technique bottom left, live display state bottom right.
    fn default() -> Self {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        Layout { corners: [v(&["00100010", "00100020", "00081030", "0008103E", "00080020"]), v(&["00080080", "00081048", "00081060", "00080090"]),
            v(&["00102160", "00140030", "00181260", "00204000"]), v(&["live:wl", "live:zoom", "live:view"])] }
    }
}
pub fn tag_of(k: &str) -> Option<u32> { if k.len() == 8 && k.chars().all(|c| c.is_ascii_hexdigit()) { u32::from_str_radix(k, 16).ok() } else { None } }
pub fn hex_of(t: u32) -> String { format!("{t:08X}") }
pub fn item_name(key: &str, ds: &Dataset) -> String {
    if let Some(n) = live_name(key) { return n.into(); }
    match tag_of(key) { Some(t) => d::describe_tag(ds, t).name, None => key.into() }
}

/// Writes a value the way a person reads it: names without ^, dates as YYYY-MM-DD, times as HH:MM:SS.
pub fn format_value(vr: &str, text: &str) -> String {
    if text.is_empty() { return String::new(); }
    let vals: Vec<&str> = if d::is_single_text(vr) { vec![text] } else { text.split('\\').collect() };
    vals.iter().map(|v| {
        let v = v.trim();
        let digits = |s: &str, n: usize| s.len() >= n && s[..n].bytes().all(|c| c.is_ascii_digit());
        if vr == "PN" { return v.split('=').next().unwrap_or("").split('^').filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" "); }
        if vr == "DA" && v.len() == 8 && digits(v, 8) { return format!("{}-{}-{}", &v[0..4], &v[4..6], &v[6..8]); }
        if vr == "TM" && digits(v, 2) {
            let dd = v.split('.').next().unwrap_or("");
            let parts: Vec<&str> = [dd.get(0..2), dd.get(2..4), dd.get(4..6)].into_iter().flatten().filter(|s| !s.is_empty()).collect();
            return parts.join(":");
        }
        if vr == "DT" && digits(v, 8) { return format_value("DA", &v[..8]) + &if v.len() > 8 { format!(" {}", format_value("TM", &v[8..])) } else { String::new() }; }
        v.split_whitespace().collect::<Vec<_>>().join(" ")
    }).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ")
}

/// Lines per corner. `live` supplies values for live:* items; empty fields are left out.
pub fn lines(ds: &Dataset, layout: &Layout, live: &dyn Fn(&str) -> String, labels: bool) -> [Vec<String>; 4] {
    let utf8 = d::charset_is_utf8(ds);
    let mut out: [Vec<String>; 4] = Default::default();
    for (c, keys) in layout.corners.iter().enumerate() {
        for key in keys {
            let value = if live_name(key).is_some() { live(key) } else {
                match tag_of(key).and_then(|t| ds.el.get(&t)) { Some(el) if el.bytes().is_some() => format_value(el.vr.as_str(), &d::value_to_text(el, utf8)), _ => String::new() }
            };
            if value.is_empty() { continue; }
            let text = if labels { format!("{}: {value}", item_name(key, ds)) } else { value };
            out[c].push(if text.chars().count() > 90 { text.chars().take(87).collect::<String>() + "…" } else { text });
        }
    }
    out
}

/// Keeps only known corners and well-formed keys, so a damaged saved layout cannot break the viewer.
pub fn clean_layout(l: &[Vec<String>]) -> Layout {
    let def = Layout::default();
    let mut out = def.clone();
    for c in 0..4 {
        out.corners[c] = match l.get(c) { Some(v) => v.iter().filter(|k| live_name(k).is_some() || tag_of(k).is_some()).take(20).cloned().collect(), None => def.corners[c].clone() };
    }
    out
}
pub fn corner_of(layout: &Layout, key: &str) -> Option<usize> { layout.corners.iter().position(|c| c.iter().any(|k| k == key)) }
