//! The Rust core against the browser prototype it replaces. tools/make-parity-fixtures.cjs ran the prototype on
//! the same deterministic inputs and recorded its answers in tests/fixtures/parity-*.json.

use serde_json::Value as J;
use weldscope_core::dicom::{self as d, Image};
use weldscope_core::imaging::{self as im, Axis, Rect, Region};
use weldscope_core::{codec, shots};

fn fixture(name: &str) -> J { serde_json::from_str(&std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap() }
fn bytes(name: &str) -> Vec<u8> { std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap() }
fn fnv(a: &[i32]) -> u32 { let mut h: u32 = 0x811c9dc5; for &v in a { for k in 0..4 { h ^= (v as u32 >> (8 * k)) & 0xFF; h = h.wrapping_mul(0x01000193); } } h }
fn fnv_bytes(b: &[u8]) -> u32 { let mut h: u32 = 0x811c9dc5; for &x in b { h ^= x as u32; h = h.wrapping_mul(0x01000193); } h }
struct Lcg(u32);
// The prototype computes seed * 1103515245 + 12345 in doubles (losing low bits above 2^53), then >>> 0.
impl Lcg { fn next(&mut self) -> f64 { let v = self.0 as f64 * 1103515245.0 + 12345.0; self.0 = v.rem_euclid(4294967296.0) as u32; self.0 as f64 / 4294967296.0 } }
fn jr(v: f64) -> i32 { im::js_round(v) as i32 }
fn f(j: &J) -> f64 { j.as_f64().unwrap() }
fn u(j: &J) -> usize { j.as_u64().unwrap() as usize }
fn close(a: f64, b: f64, tol: f64, what: &str) { assert!((a - b).abs() <= tol, "{what}: rust {a} vs prototype {b}"); }

fn scan(w: usize, h: usize, pieces: &[(usize, usize, usize, usize)], line: Option<(f64, f64)>) -> Vec<i32> {
    let mut r = Lcg(11);
    let mut a = vec![20i32; w * h];
    for &(px, py, pw, ph) in pieces { for y in py..py + ph { for x in px..px + pw {
        let weld = if (x as f64 - (px as f64 + pw as f64 / 2.0)).abs() < pw as f64 * 0.1 { -90 } else { 0 };
        a[y * w + x] = 2800 + weld + jr((r.next() - 0.5) * 120.0);
    } } }
    if let Some((la, lk)) = line { for y in 0..h { let x0 = jr(la + lk * y as f64) as i64; for x in x0 - 2..=x0 + 2 { if x >= 0 && (x as usize) < w { a[y * w + x as usize] = 1400; } } } }
    a
}
fn plate(w: usize, h: usize) -> Vec<i32> {
    let mut r = Lcg(3);
    let mut a = vec![0i32; w * h];
    for y in 0..h { for x in 0..w { a[y * w + x] = if x < 20 { 10 } else { 2800 + jr((r.next() - 0.5) * 80.0) + if (x as i64 - 200).abs() < 40 { -60 } else { 0 } }; } }
    a
}
fn scratch_at(y: usize) -> usize { jr(120.0 + 0.01 * y as f64) as usize }
fn damaged(w: usize, h: usize) -> Vec<i32> {
    let mut a = plate(w, h);
    // values are Uint16 in the prototype; keep within 0..65535 the same way (no wrap happens for these inputs)
    for y in 50..950 { a[y * w + scratch_at(y)] -= 400; a[y * w + scratch_at(y) + 1] -= 250; }
    for y in 100..900 { a[y * w + 300] += 400; }
    for y in 300..400 { a[y * w + 340] -= 400; a[y * w + 343] += 400; }
    for y in 0..h { for x in 360..380 { a[y * w + x] -= 400; } }
    a
}
fn tilted_source() -> Vec<i32> {
    let mut r = Lcg(2);
    let (w, h) = (400, 1000);
    let mut a = vec![20i32; w * h];
    for y in 50..950 { for x in 50..350 { a[y * w + x] = 2800 + jr((r.next() - 0.5) * 80.0) + if x % 40 < 3 { -300 } else { 0 }; } }
    a
}
fn image(a: Vec<i32>, w: usize, h: usize) -> Image {
    Image { rows: h, cols: w, frames: vec![a], bits_allocated: 16, bits_stored: 12, signed: false, photometric: "MONOCHROME2".into(), min: 0, max: 4095, slope: 1.0, intercept: 0.0, padding: None, window_center: None, window_width: None }
}
fn check_regions(got: &[Region], want: &J, what: &str) {
    let want = want.as_array().unwrap();
    assert_eq!(got.len(), want.len(), "{what}: piece count {got:?} vs {want:?}");
    for (g, w) in got.iter().zip(want) {
        assert_eq!((g.rect.x, g.rect.y, g.rect.w, g.rect.h), (w["x"].as_i64().unwrap(), w["y"].as_i64().unwrap(), w["w"].as_i64().unwrap(), w["h"].as_i64().unwrap()), "{what}: rectangle");
        let wc = w["cuts"].as_array().unwrap();
        assert_eq!(g.cuts.len(), wc.len(), "{what}: cut count");
        for (c, e) in g.cuts.iter().zip(wc) {
            assert_eq!(c.axis, if e["axis"] == "x" { Axis::X } else { Axis::Y });
            assert_eq!(c.keep_less, e["keep"] == "<");
            close(c.a, f(&e["a"]), 1e-5, what); close(c.k, f(&e["k"]), 1e-5, what);
        }
    }
}

#[test]
fn film_pieces_levels_windows_and_stats_match_the_prototype() {
    let p = fixture("parity-imaging.json");
    for (i, c) in p["pieces"].as_array().unwrap().iter().enumerate() {
        let g = &c["gen"];
        let (w, h) = (u(&g["w"]), u(&g["h"]));
        let a = if g["kind"] == "scan-pad" {
            let mut a = scan(w, h, &[(0, 0, 200, h)], None);
            for y in 0..h { for x in 200..w { a[y * w + x] = 0; } }
            a
        } else {
            let pieces: Vec<_> = g["pieces"].as_array().unwrap().iter().map(|q| (u(&q["x"]), u(&q["y"]), u(&q["w"]), u(&q["h"]))).collect();
            scan(w, h, &pieces, g.get("line").map(|l| (f(&l["a"]), f(&l["k"]))))
        };
        assert_eq!(fnv(&a) as u64, c["input"].as_u64().unwrap(), "{}: generated input differs", c["name"]);
        let o = &c["opts"];
        let opts = im::PieceOptions { sensitivity: o.get("sensitivity").map(f).unwrap_or(0.6), margin: o.get("margin").map(|m| m.as_i64().unwrap()).unwrap_or(0), padding: o.get("padding").map(|v| v.as_i64().unwrap() as i32), ..Default::default() };
        check_regions(&im::find_pieces(&a, w, h, &opts), &c["found"], c["name"].as_str().unwrap());
        if g["kind"] == "scan-pad" { continue; }
        let lv = &p["levels"][i];
        let l = im::plate_levels(&a, w, h, None, 0.6);
        assert_eq!(l.sign, f(&lv["sign"]));
        close(l.bg, f(&lv["bg"]), 1e-4, "bg"); close(l.base, f(&lv["base"]), 1e-4, "base"); close(l.thr, f(&lv["thr"]), 1e-4, "thr"); close(l.iqr, f(&lv["iqr"]), 1e-4, "iqr");
        assert_eq!(l.has_background, lv["hasBackground"].as_bool().unwrap());
        let wnd = im::auto_window(&a, 1.0, 0.0, 0.5, 99.8, None);
        close(wnd.center, f(&p["windows"][i]["center"]), 1e-4, "window centre"); close(wnd.width, f(&p["windows"][i]["width"]), 1e-4, "window width");
        let st = im::stats(&a, None);
        let s = &p["stats"][i];
        assert_eq!((st.min, st.max, st.count as f64), (f(&s["min"]), f(&s["max"]), f(&s["count"])));
        for (k, pc) in [("p01", 0.1), ("p50", 50.0), ("p90", 90.0), ("p999", 99.9)] { close(st.pct(pc), f(&s[k]), 1e-4, k); }
    }
}

#[test]
fn rotation_and_straightening_match_the_prototype() {
    let p = fixture("parity-imaging.json");
    let src = tilted_source();
    for (r, s) in p["rotate"].as_array().unwrap().iter().zip(p["straighten"].as_array().unwrap()) {
        let (fr, w, h) = im::rotate_by(&src, 400, 1000, f(&r["tilt"]), 20, 0, 4095);
        assert_eq!((w, h), (u(&r["w"]), u(&r["h"])));
        assert_eq!(fnv(&fr) as u64, r["hash"].as_u64().unwrap(), "rotate_by {} pixels", r["tilt"]);
        let res = im::straighten_piece(&image(fr, w, h), &Region { rect: Rect::new(0, 0, w as i64, h as i64), cuts: vec![] }, None, 5.0, 0.02, 0).unwrap();
        let name = s["name"].as_str().unwrap();
        close(res.angle, f(&s["angle"]), 1e-5, name); close(res.measured, f(&s["measured"]), 1e-5, name);
        assert_eq!((res.rotated, res.too_steep), (s["rotated"].as_bool().unwrap(), s["tooSteep"].as_bool().unwrap()), "{name}");
        assert_eq!((res.img.cols, res.img.rows), (u(&s["cols"]), u(&s["rows"])), "{name}");
        let c = &s["crop"];
        assert_eq!((res.crop.x, res.crop.y, res.crop.w, res.crop.h), (c["x"].as_i64().unwrap(), c["y"].as_i64().unwrap(), c["w"].as_i64().unwrap(), c["h"].as_i64().unwrap()), "{name}");
        assert_eq!(fnv(&res.img.frames[0]) as u64, s["hash"].as_u64().unwrap(), "{name}: straightened pixels");
        assert_eq!(res.edges.len(), s["edges"].as_array().unwrap().len(), "{name}: edges");
        for (e, x) in res.edges.iter().zip(s["edges"].as_array().unwrap()) { assert_eq!(e.side, x["side"].as_str().unwrap()); assert_eq!(e.points, u(&x["points"])); close(e.angle, f(&x["angle"]), 1e-5, name); }
    }
    // two strips meeting at a tilted line
    let s = p["straighten"].as_array().unwrap().iter().find(|s| s["name"] == "two strips").unwrap();
    let (w, h) = (400usize, 1200usize);
    let mut r = Lcg(4);
    let mut a = vec![0i32; w * h];
    for y in 0..h { for x in 0..w { a[y * w + x] = if (x as f64 - (190.0 + 0.015 * y as f64)).abs() <= 2.0 { 1400 } else { 2800 + jr((r.next() - 0.5) * 80.0) }; } }
    assert_eq!(fnv(&a) as u64, s["input"].as_u64().unwrap());
    let pieces = im::find_pieces(&a, w, h, &im::PieceOptions::default());
    check_regions(&pieces, &s["pieces"], "two strips");
    let img = image(a, w, h);
    for (pc, want) in pieces.iter().zip(s["results"].as_array().unwrap()) {
        let res = im::straighten_piece(&img, pc, None, 5.0, 0.02, 0).unwrap();
        close(res.angle, f(&want["angle"]), 1e-5, "strip angle");
        assert_eq!((res.img.cols, res.img.rows), (u(&want["cols"]), u(&want["rows"])));
        assert_eq!(fnv(&res.img.frames[0]) as u64, want["hash"].as_u64().unwrap(), "strip pixels");
    }
}

#[test]
fn scratch_finding_and_repair_match_the_prototype() {
    let p = fixture("parity-imaging.json");
    let (w, h) = (400usize, 1000usize);
    let a = damaged(w, h);
    let nz = &p["noise"][0];
    assert_eq!(fnv(&a) as u64, nz["input"].as_u64().unwrap());
    let noise = im::noise_level(&a, w, h, None);
    close(noise, f(&nz["noise"]), 1e-6, "noise");
    for rp in p["repairs"].as_array().unwrap() {
        let sg = &rp["seg"];
        let seg = im::Segment { x0: f(&sg["x0"]), y0: f(&sg["y0"]), x1: f(&sg["x1"]), y1: f(&sg["y1"]) };
        let o = im::ScratchOptions { band: 8.0, max_width: 9.0, sign: 1.0, min: 0, max: 4095, padding: None, noise: if rp.get("localNoise").is_some() { 0.0 } else { noise }, min_contrast: 0.0 };
        let (out, count) = im::repair_scratch(&a, w, h, seg, &o);
        assert_eq!(count, u(&rp["count"]), "repair count for {sg}");
        assert_eq!(fnv(&out) as u64, rp["hash"].as_u64().unwrap(), "repaired pixels for {sg}");
    }
    let mut fa = damaged(w, h);
    for y in 400..520 { fa[y * w + 60] -= 300; }
    for y in 0..h { for x in 268..=272 { fa[y * w + x] = 1400; } }
    for (img, want) in [(fa, &p["scratches"][0]), (plate(w, h), &p["scratches"][1])] {
        assert_eq!(fnv(&img) as u64, want["input"].as_u64().unwrap());
        let found = im::find_scratches(&img, w, h, None, None, None, 0.6, 2.0);
        let wf = want["found"].as_array().unwrap();
        assert_eq!(found.len(), wf.len(), "{}: {found:?}", want["name"]);
        for (g, e) in found.iter().zip(wf) { for (a, b) in [(g.x0, &e["x0"]), (g.y0, &e["y0"]), (g.x1, &e["x1"]), (g.y1, &e["y1"]), (g.coverage, &e["coverage"])] { close(a, f(b), 1e-5, "scratch"); } }
    }
}

#[test]
fn edge_filter_matches_the_prototype() {
    let p = fixture("parity-imaging.json");
    let (w, h) = (400usize, 1000usize);
    let a = damaged(w, h);
    for e in p["edge"].as_array().unwrap() {
        let o = &e["opts"];
        let g = |k: &str, d: f64| o.get(k).map(f).unwrap_or(d);
        let params = im::EdgeParams {
            global_contrast: g("globalContrast", 1.0), detail_contrast: g("detailContrast", 1.0), sharpness: g("sharpness", 1.0), noise_reduction: g("noiseReduction", 0.0),
            kernel_px: g("kernelPx", 60.0), padding: o.get("padding").map(|v| v.as_i64().unwrap() as i32), despeckle: o.get("despeckle").is_some(), white_sign: g("whiteSign", 1.0),
            despeckle_threshold: g("despeckleThreshold", 0.0), detail_limit: g("detailLimit", 0.0), kg: o.get("kG").map(f), kd: o.get("kD").map(f), ks: o.get("kS").map(f),
        };
        let (out, specks) = im::edge_enhance(&a, w, h, &params);
        let name = e["name"].as_str().unwrap();
        assert_eq!(specks, u(&e["specks"]), "{name} specks");
        let nan = out.iter().filter(|v| v.is_nan()).count();
        assert_eq!(nan, u(&e["nan"]), "{name} padding");
        let mean = out.iter().filter(|v| !v.is_nan()).map(|&v| v as f64).sum::<f64>() / (out.len() - nan) as f64;
        close(mean, f(&e["mean"]), 2e-3, name);
        for (i, s) in [0usize, 1234, 55555, 200000, 399999].iter().zip(e["samples"].as_array().unwrap()) {
            if s.is_null() { assert!(out[*i].is_nan()); } else { close(out[*i] as f64, f(s), 2e-2, name); }
        }
        let wnd = im::auto_window(&out, 1.0, 0.0, 0.5, 99.8, None);
        close(wnd.center, f(&e["window"]["center"]), 0.05, name); close(wnd.width, f(&e["window"]["width"]), 0.05, name);
    }
}

#[test]
fn dicom_files_read_like_the_prototype() {
    let p = fixture("parity-dicom.json");
    for (name, want) in p["files"].as_object().unwrap() {
        let b = bytes(name);
        let file = d::parse(&b).unwrap();
        assert_eq!(file.transfer_syntax, want["transferSyntax"].as_str().unwrap(), "{name}");
        assert_eq!(file.encapsulated(), want["encapsulated"].as_bool().unwrap());
        let utf8 = d::charset_is_utf8(&file.ds);
        let els = want["elements"].as_array().unwrap();
        assert_eq!(file.ds.el.len(), els.len(), "{name}: element count");
        for (e, w) in file.ds.el.values().zip(els) {
            assert_eq!(e.tag as u64, w["tag"].as_u64().unwrap(), "{name}");
            assert_eq!(e.vr.as_str(), w["vr"].as_str().unwrap(), "{name} {}", d::tag_hex(e.tag));
            assert_eq!(d::value_to_text(e, utf8), w["text"].as_str().unwrap(), "{name} {}", d::tag_hex(e.tag));
            if let Some(h) = w["hash"].as_u64() { assert_eq!(fnv_bytes(e.bytes().unwrap()) as u64, h, "{name} {} bytes", d::tag_hex(e.tag)); }
            if let Some(n) = w["items"].as_u64() { assert_eq!(e.items().unwrap().len() as u64, n); }
            if let Some(n) = w["fragments"].as_u64() { assert_eq!(e.fragments().unwrap().len() as u64, n); }
        }
        for dsc in want["describe"].as_array().unwrap() { assert_eq!(d::describe_tag(&file.ds, dsc[0].as_u64().unwrap() as u32).name, dsc[1].as_str().unwrap()); }
        // pixels (JPEG 2000 decoded through native OpenJPEG must equal the WebAssembly build's output)
        let px = &want["pixels"];
        let img = if file.encapsulated() {
            let fb = codec::decode_frames(file.ds.get(d::PIXEL).unwrap().fragments().unwrap(), &d::image_geometry(&file)).unwrap();
            d::image_from_frames(&file, &fb).unwrap()
        } else { d::get_image(&file).unwrap() };
        assert_eq!((img.rows, img.cols, img.min as i64, img.max as i64), (u(&px["rows"]), u(&px["cols"]), px["min"].as_i64().unwrap(), px["max"].as_i64().unwrap()));
        assert_eq!(fnv(&img.frames[0]) as u64, px["hash"].as_u64().unwrap(), "{name}: pixels");
        assert_eq!(img.photometric, px["photometric"].as_str().unwrap());
        assert_eq!(img.padding.map(|p| p as i64), px["padding"].as_i64());
        // INDUSTREX private block, viewing angle and display processing
        let ix = d::industrex_info(&file.ds).unwrap();
        let wi = &want["industrex"];
        assert_eq!((ix.creator.as_str(), ix.block as u64, ix.version.as_str()), (wi["creator"].as_str().unwrap(), wi["block"].as_u64().unwrap(), wi["version"].as_str().unwrap()));
        assert_eq!(ix.xml_tag.map(|t| t as u64), wi["xmlTag"].as_u64());
        assert_eq!(ix.stale_tags.iter().map(|t| *t as u64).collect::<Vec<_>>(), wi["staleTags"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect::<Vec<_>>());
        assert_eq!(d::industrex_xml_entry(&file.ds, "ANGLE").map(|v| serde_json::json!(v)), if want["angle"].is_null() { None } else { Some(want["angle"].clone()) });
        let ds = d::industrex_display_settings(&file.ds).unwrap();
        assert_eq!(ds.filter, want["display"]["filter"].as_str().unwrap());
        for (k, v) in want["display"]["settings"].as_object().unwrap() {
            match ds.get(k).unwrap() { d::Setting::Num(n) => assert_eq!(*n, f(v)), d::Setting::Text(t) => assert_eq!(t, v.as_str().unwrap()) }
        }
        if let Some(cs) = want["codestream"].as_object() {
            let info = codec::codestream_info(&codec::frame_streams(file.ds.get(d::PIXEL).unwrap().fragments().unwrap(), 1).unwrap()[0]).unwrap();
            assert_eq!((info.width as u64, info.height as u64, info.precision as u64, info.progression.as_str(), info.reversible), (cs["width"].as_u64().unwrap(), cs["height"].as_u64().unwrap(), cs["precision"].as_u64().unwrap(), cs["progression"].as_str().unwrap(), cs["reversible"].as_bool().unwrap()));
        }
        // batch edit + XML mirror sync gives byte-identical XML
        let mut shot = shots::load(&b, name, "", 1).unwrap();
        shots::apply_batch(&mut [&mut shot], &[(0x00100020, Some("WELD-ÅB 7".into())), (0x00081048, Some("New & <Co>".into())), (0x00204000, Some("Line one".into()))]).unwrap();
        let synced = d::sync_industrex_xml(&mut shot.file.ds, &shots::changed_tags(&shot.orig_els));
        let mut got: Vec<u64> = synced.iter().map(|t| *t as u64).collect(); got.sort();
        let mut exp: Vec<u64> = want["synced"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect(); exp.sort();
        assert_eq!(got, exp, "{name} synced");
        let xml = String::from_utf8(shot.file.ds.get(ix.xml_tag.unwrap()).unwrap().bytes().unwrap().to_vec()).unwrap();
        assert_eq!(xml, want["xmlAfterSync"].as_str().unwrap(), "{name}: XML after sync");
    }
}
