//! Core behaviour: reading/writing, editing, derived copies, INDUSTREX rules, JPEG 2000, compatibility check,
//! shots, exports. Ported from diconde-editor/tests/test-core.cjs, with additions for the native codec.

use weldscope_core::compat::{self, CheckOptions, Level};
use weldscope_core::copy::{self, CopyState, PartInfo, SplitOptions};
use weldscope_core::dicom::{self as d, DicomFile};
use weldscope_core::imaging::{self as im, Rect, Region};
use weldscope_core::sample::{make_sample, SampleOptions};
use weldscope_core::{codec, export, overlay, shots};

fn fixture(name: &str) -> Vec<u8> { std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap() }
fn parse(name: &str) -> DicomFile { d::parse(&fixture(name)).unwrap() }
fn reparse(f: &DicomFile) -> DicomFile { d::parse(&d::write(f).unwrap()).unwrap() }
fn fails(r: &[compat::Check]) -> Vec<String> { r.iter().filter(|c| c.level == Level::Fail).map(|c| format!("{} — {}", c.title, c.detail)).collect() }
fn decode(f: &DicomFile) -> d::Image {
    let fb = codec::decode_frames(f.ds.get(d::PIXEL).unwrap().fragments().unwrap(), &d::image_geometry(f)).unwrap();
    d::image_from_frames(f, &fb).unwrap()
}

#[test]
fn writer_round_trips_without_changing_any_element() {
    for name in ["industrex-like.dcm", "industrex-j2k.dcm"] {
        let f = parse(name);
        let a = reparse(&f);
        let b = reparse(&a);
        assert_eq!(d::write(&a).unwrap(), d::write(&b).unwrap(), "{name}: stable");
        assert!(a.ds == f.ds, "{name}: every element unchanged");
        assert_eq!(d::get_string(&a.meta, 0x00020003), d::get_string(&a.ds, 0x00080018));
        assert_eq!(d::get_string(&a.meta, 0x00020013), d::IMPL_NAME);
    }
    let s = make_sample(&SampleOptions::default());
    let r = reparse(&s);
    for (t, e) in &s.ds.el { assert_eq!(d::value_to_text(r.ds.get(*t).unwrap(), false), d::value_to_text(e, false), "{}", d::tag_hex(*t)); }
}

#[test]
fn validation_explains_bad_values() {
    let has = |vr: &str, t: &str, m: &str| { let e = d::validate(vr, t).unwrap_or_default(); assert!(e.contains(m), "{vr} {t:?}: {e:?}"); };
    has("DA", "2026-11-11", "YYYYMMDD"); has("DA", "20260230", "YYYYMMDD");
    assert_eq!(d::validate("DA", "20261111"), None);
    has("SH", &"x".repeat(17), "16 characters"); has("US", "70000", "outside"); has("DS", "abc", "decimal"); has("UI", "1.02.3", "UID");
    assert_eq!(d::validate("LT", "line one\nline two \\ ok"), None);
    has("LO", "a\nb", "Line breaks");
    let mut s = make_sample(&SampleOptions::default());
    assert!(s.ds.set_text(0x00100020, "Ω", None).unwrap_err().0.contains("character set"));
}

#[test]
fn editing_adding_and_removing_tags() {
    let mut f = make_sample(&SampleOptions::default());
    f.ds.set_text(0x00100020, "WELD-0043", None).unwrap();
    f.ds.set_text(0x00140042, "API 5L X52", None).unwrap();
    f.ds.set_text(0x00080008, "derived\\secondary", None).unwrap(); // CS is upper-cased
    f.ds.remove(0x00204000);
    f.ds.set_text(0x00280030, "0.1\\0.12", None).unwrap();
    let out = reparse(&f);
    assert_eq!(out.ds.string(0x00100020), "WELD-0043");
    assert_eq!(out.ds.string(0x00140042), "API 5L X52");
    assert_eq!(out.ds.string(0x00080008), "DERIVED\\SECONDARY");
    assert!(out.ds.get(0x00204000).is_none());
    assert_eq!(d::get_number_at(&out.ds, 0x00280030, 1), Some(0.12));
    assert_eq!(d::tag_info(0x00100020).name, "Component ID Number");
    assert_eq!(d::tag_info(0x00100020).dicom_name, "Patient ID");
    assert_eq!(d::tag_info(0x00101000).dicom_name, "Other Patient IDs");
    assert_eq!(d::parse_tag("(0010,0020)"), Some(0x00100020));
    assert_eq!(d::parse_tag("PatientID"), Some(0x00100020));
    assert!(d::find_tags_by_text("component id").contains(&0x00100020));
}

#[test]
fn character_sets() {
    let mut f = make_sample(&SampleOptions::default());
    f.ds.set_text(0x00080005, "ISO_IR 192", None).unwrap();
    f.ds.set_text(0x00104000, "Soudure n° 3 – Ω", None).unwrap();
    assert_eq!(reparse(&f).ds.string(0x00104000), "Soudure n° 3 – Ω");
    assert_eq!(d::fold_text("Flipped left–right, 90° 3×4", d::Charset::Latin1), "Flipped left-right, 90° 3×4");
    assert_eq!(d::fold_text("Flipped left–right, 90° 3×4", d::Charset::Ascii), "Flipped left-right, 90 deg 3x4");
    let latin = make_sample(&SampleOptions::default());
    let mut a = latin.clone();
    d::derive(&mut a, &latin, &d::DeriveOptions { pixels_changed: true, description: "Flipped left–right; Rotated 90°".into(), ..Default::default() }).unwrap();
    assert_eq!(reparse(&a).ds.string(0x00082111), "Flipped left-right; Rotated 90°");
    let mut plain = make_sample(&SampleOptions::default());
    plain.ds.remove(0x00080005);
    assert_eq!(d::charset_mode(&plain.ds), d::Charset::Ascii);
    assert!(plain.ds.set_text(0x00104000, "Weld n° 3", None).unwrap_err().0.contains("ISO_IR 100"));
    let mut b = plain.clone();
    d::derive(&mut b, &plain, &d::DeriveOptions { pixels_changed: true, description: "Cropped to 5×6; Rotated 90°".into(), ..Default::default() }).unwrap();
    assert_eq!(b.ds.string(0x00082111), "Cropped to 5x6; Rotated 90 deg");
}

#[test]
fn derived_copies() {
    let src = make_sample(&SampleOptions { sop_uid: Some("1.2.3.999".into()), ..Default::default() });
    let mut c = src.clone();
    let series = d::new_uid();
    d::derive(&mut c, &src, &d::DeriveOptions { pixels_changed: true, description: "Rotated 90° clockwise".into(), series_uid: Some(series.clone()), ..Default::default() }).unwrap();
    let out = reparse(&c);
    let uid = out.ds.string(0x00080018);
    assert!(uid.starts_with("2.25.") && uid.len() <= 64 && uid != "1.2.3.999");
    assert_eq!(d::get_string(&out.meta, 0x00020003), uid);
    assert_eq!(out.ds.string(0x00080008), "DERIVED\\SECONDARY");
    assert_eq!(out.ds.string(0x0020000E), series);
    assert!(out.ds.string(0x00082111).contains("Rotated 90"));
    let r = &out.ds.get(0x00082112).unwrap().items().unwrap()[0];
    assert_eq!(r.string(0x00081155), "1.2.3.999");
    assert_eq!(r.string(0x00081150), "1.2.840.10008.5.1.4.1.1.1.1");
    assert_eq!(src.ds.string(0x00080008), "ORIGINAL\\PRIMARY");
    // metadata-only: image type and series kept
    let mut m = src.clone();
    d::derive(&mut m, &src, &d::DeriveOptions::default()).unwrap();
    assert_eq!(m.ds.string(0x00080008), "ORIGINAL\\PRIMARY");
    assert_eq!(m.ds.string(0x0020000E), src.ds.string(0x0020000E));
    assert!(m.ds.get(0x00082112).is_none());
}

#[test]
fn industrex_copies_keep_or_drop_the_right_private_data() {
    let src = parse("industrex-like.dcm");
    // metadata only: private data and icon kept
    let mut m = src.clone();
    m.ds.set_text(0x00100020, "NEW-ID", None).unwrap();
    d::derive(&mut m, &src, &d::DeriveOptions::default()).unwrap();
    let out = reparse(&m);
    for t in [0x00330010u32, 0x00330011, 0x00330012, 0x00331010, 0x00331040, 0x00331050, 0x00331052, 0x00331071, 0x00331072, 0x00331176] {
        assert_eq!(out.ds.get(t).unwrap().bytes(), src.ds.get(t).unwrap().bytes(), "{}", d::tag_hex(t));
    }
    assert_eq!(out.ds.get(0x00880200).unwrap().items().unwrap().len(), 1);
    // processed: INDUSTREX regenerates xx40/xx50/xx52/xx70 and the icon
    let mut p = src.clone();
    let img = im::rotate(&d::get_image(&p).unwrap(), 1);
    d::set_image(&mut p, &img, true).unwrap();
    let removed = d::derive(&mut p, &src, &d::DeriveOptions { pixels_changed: true, description: "Rotated".into(), ..Default::default() }).unwrap();
    assert_eq!(removed, vec![0x00880200, 0x00331040, 0x00331050, 0x00331052, 0x00331070]);
    let out = reparse(&p);
    for t in &removed { assert!(out.ds.get(*t).is_none()); }
    for t in [0x00330010u32, 0x00331010, 0x00331071, 0x00331072, 0x00331176] { assert!(out.ds.has(t), "{}", d::tag_hex(t)); }
    assert_eq!(out.ds.string(0x00080016), "1.2.840.10008.5.1.4.1.1.1");
    assert_eq!(out.ds.string(0x00281040), "LOG");
    assert_eq!(d::describe_tag(&src.ds, 0x00331070).name, "INDUSTREX presentation state (XML)");
    assert_eq!(d::describe_tag(&src.ds, 0x00330011).name, "Private creator");
}

#[test]
fn implicit_vr_private_elements_read_as_un_and_survive() {
    let f = parse("industrex-implicit.dcm");
    assert_eq!(f.transfer_syntax, d::TS_IMPLICIT_LE);
    assert_eq!(f.ds.get(0x00331071).unwrap().vr.as_str(), "UN");
    assert_eq!(d::industrex_info(&f.ds).unwrap().version, "7.2.1");
    assert_eq!(d::industrex_xml_values(&f.ds, 0x00100020), Some(vec!["WELD-0042".to_string()]));
    let out = reparse(&f);
    assert_eq!(out.transfer_syntax, d::TS_EXPLICIT_LE);
    assert_eq!(out.ds.get(0x00331050).unwrap().bytes().unwrap(), &[0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xD9]);
    assert_eq!(d::get_image(&out).unwrap().frames, d::get_image(&f).unwrap().frames);
}

#[test]
fn rejects_non_dicom_data_clearly() {
    assert!(d::parse(b"hello").unwrap_err().0.contains("Not a DICOM"));
    let mut t = fixture("industrex-like.dcm");
    t.truncate(2000);
    assert!(d::parse(&t).is_err());
}

#[test]
fn jpeg2000_round_trips_losslessly() {
    let mut seed: u32 = 3;
    let mut r = |m: u32| { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); seed % m };
    for (bits, signed) in [(12u32, false), (16, false), (16, true)] {
        let (w, h) = (37, 23);
        let a: Vec<i32> = (0..w * h).map(|_| if signed { r(65536) as i32 - 32768 } else { r(1 << bits) as i32 }).collect();
        let cs = codec::encode_frame_lossless(&a, &codec::EncodeOptions { width: w, height: h, bits_per_sample: bits, signed, ..Default::default() }).unwrap();
        assert_eq!(&cs[..4], &[0xFF, 0x4F, 0xFF, 0x51], "raw J2K codestream");
        let dd = codec::decode_frame(&cs).unwrap();
        assert_eq!((dd.width, dd.height, dd.components), (w, h, 1));
        assert_eq!(dd.data, a, "{bits}-bit signed={signed}");
    }
    for (w, h) in [(1usize, 1usize), (3, 200), (31, 31)] {
        let a: Vec<i32> = (0..w * h).map(|i| ((i * 131) % 4096) as i32).collect();
        let cs = codec::encode_frame_lossless(&a, &codec::EncodeOptions { width: w, height: h, bits_per_sample: 12, ..Default::default() }).unwrap();
        assert_eq!(codec::decode_frame(&cs).unwrap().data, a, "{w}x{h}");
    }
    // INDUSTREX-style tiling, progression and precision
    let (w, h) = (1100usize, 700usize);
    let a: Vec<i32> = (0..w * h).map(|i| ((i * 7919) % 4096) as i32).collect();
    let cs = codec::encode_frame_lossless(&a, &codec::EncodeOptions { width: w, height: h, bits_per_sample: 16, signed: false, progression: Some("RLCP".into()), tile: Some((512, 512)) }).unwrap();
    let info = codec::codestream_info(&cs).unwrap();
    assert_eq!((info.tile_width, info.tile_height, info.precision, info.progression.as_str(), info.reversible), (512, 512, 16, "RLCP", true));
    assert_eq!(codec::decode_frame(&cs).unwrap().data, a);
    assert!(codec::decode_frames(&[vec![], vec![0xFF, 0x4F, 0xFF, 0x51, 1, 2, 3]], &d::Geometry { rows: 4, cols: 4, frames: 1, bits_allocated: 16, bits_stored: 16, signed: false, samples_per_pixel: 1 }).is_err(), "damaged data is reported");
}

#[test]
fn frame_splitting() {
    let (f1a, f1b, f2) = (vec![0xFFu8, 0x4F, 0xFF, 0x51, 1], vec![2u8, 3], vec![0xFFu8, 0x4F, 0xFF, 0x51, 9]);
    let mut bot = vec![0u8; 8];
    bot[4..8].copy_from_slice(&((8 + f1a.len() + 8 + f1b.len()) as u32).to_le_bytes());
    assert_eq!(codec::frame_streams(&[bot, f1a.clone(), f1b.clone(), f2.clone()], 2).unwrap(), vec![vec![0xFF, 0x4F, 0xFF, 0x51, 1, 2, 3], vec![0xFF, 0x4F, 0xFF, 0x51, 9]]);
    assert_eq!(codec::frame_streams(&[vec![], f1a.clone(), f2.clone()], 2).unwrap().iter().map(|x| x.len()).collect::<Vec<_>>(), vec![5, 5]);
    assert_eq!(codec::frame_streams(&[vec![], f1a.clone(), f1b.clone(), f2.clone()], 2).unwrap().iter().map(|x| x.len()).collect::<Vec<_>>(), vec![7, 5]);
    assert_eq!(codec::frame_streams(&[vec![], f1a.clone(), f1b.clone()], 1).unwrap()[0].len(), 7);
    assert!(codec::frame_streams(&[vec![], f1a, f1b, f2], 4).unwrap_err().0.contains("expected 4"));
}

fn state<'a>(file: &'a DicomFile, orig: &'a DicomFile, img: Option<&'a d::Image>, ops: &'a [String], turns: i32, orig_els: &'a shots::OrigEls, j2k: bool) -> CopyState<'a> {
    CopyState { file, orig, img, ops, turns, orig_els, store_window: None, j2k }
}

#[test]
fn saved_copies_pass_the_industrex_check() {
    let src = parse("industrex-j2k.dcm");
    let xml = d::industrex_info(&src.ds).unwrap().xml_tag;
    // metadata-only: XML synced, compressed data byte for byte
    let mut shot = shots::load(&fixture("industrex-j2k.dcm"), "a.dcm", "", 1).unwrap();
    shots::set_on(&mut shot, 0x00100020, Some("NEW"), None).unwrap();
    let c = copy::build_copy(&state(&shot.file, &src, None, &[], 0, &shot.orig_els, true), None, None, SplitOptions::default()).unwrap();
    assert_eq!(c.synced, vec![0x00100020]);
    let bytes = d::write(&c.file).unwrap();
    assert_eq!(fails(&compat::check(&bytes, Some(&src), &CheckOptions { edited: c.edited.clone(), xml_tag: xml, ..Default::default() })), Vec::<String>::new());
    let mo = d::parse(&bytes).unwrap();
    assert_eq!(mo.transfer_syntax, codec::J2K_LOSSLESS);
    assert_eq!(mo.ds.get(d::PIXEL).unwrap().fragments().unwrap()[1], src.ds.get(d::PIXEL).unwrap().fragments().unwrap()[1]);
    // processed (rotated) J2K copy: re-encoded like the source, lossless, passes
    let img = decode(&src);
    let rot = im::rotate(&img, 1);
    let ops = vec!["Rotated 90° clockwise".to_string()];
    let none = shots::OrigEls::new();
    let pc = copy::build_copy(&state(&src, &src, Some(&rot), &ops, 1, &none, true), None, None, SplitOptions::default()).unwrap();
    let pb = d::write(&pc.file).unwrap();
    let r = compat::check(&pb, Some(&src), &CheckOptions { removed: pc.removed.clone(), pixels_changed: true, ..Default::default() });
    assert_eq!(fails(&r), Vec::<String>::new());
    assert!(r.iter().any(|c| c.title == "JPEG 2000 encoded like the original" && c.level == Level::Pass), "{r:?}");
    let po = d::parse(&pb).unwrap();
    let back = decode(&po);
    assert_eq!((back.rows, back.cols), (img.cols, img.rows));
    assert_eq!(back.frames, rot.frames);
    assert_eq!(po.ds.string(0x00080008), "DERIVED\\SECONDARY");
    assert!(po.ds.string(0x00082111).contains("Rotated 90"));
    assert_ne!(po.ds.string(0x0020000E), src.ds.string(0x0020000E), "processed copies get a new series");
    // the same, uncompressed
    let uc = copy::build_copy(&state(&src, &src, Some(&rot), &ops, 1, &none, false), None, None, SplitOptions::default()).unwrap();
    let ub = d::write(&uc.file).unwrap();
    assert_eq!(d::parse(&ub).unwrap().transfer_syntax, d::TS_EXPLICIT_LE);
    assert_eq!(fails(&compat::check(&ub, Some(&src), &CheckOptions { removed: uc.removed, pixels_changed: true, ..Default::default() })).iter().filter(|f| !f.contains("Transfer")).count(), 0);
    // broken copies are caught
    let mut bad = pc.file.clone();
    bad.ds.set_text(0x00280010, "79", Some("US")).unwrap();
    assert!(fails(&compat::check(&d::write(&bad).unwrap(), Some(&src), &CheckOptions { removed: pc.removed.clone(), pixels_changed: true, ..Default::default() })).iter().any(|t| t.contains("JPEG 2000 header matches Rows")));
    let mut lost = c.file.clone();
    lost.ds.remove(0x00181260);
    lost.ds.el.get_mut(&0x00080090).unwrap().vr = d::Vr::new("LO");
    let lf = fails(&compat::check(&d::write(&lost).unwrap(), Some(&src), &CheckOptions { edited: vec![0x00100020], ..Default::default() }));
    assert!(lf.iter().any(|t| t.contains("missing: (0018,1260)")) && lf.iter().any(|t| t.contains("(0008,0090) PN→LO")), "{lf:?}");
    let mut stale = src.clone();
    stale.ds.set_text(0x00100020, "NOT-SYNCED", None).unwrap();
    d::derive(&mut stale, &src, &d::DeriveOptions::default()).unwrap();
    assert!(fails(&compat::check(&d::write(&stale).unwrap(), Some(&src), &CheckOptions { edited: vec![0x00100020], ..Default::default() })).iter().any(|t| t.contains("XML copy agrees")));
    let mut ls = src.clone();
    ls.transfer_syntax = "1.2.840.10008.1.2.4.80".into();
    assert!(fails(&compat::check(&d::write(&ls).unwrap(), Some(&src), &CheckOptions::default())).iter().any(|t| t.contains("Transfer syntax is one INDUSTREX reads")));
    let mut sc = make_sample(&SampleOptions::default());
    sc.ds.set_text(0x00080016, "1.2.840.10008.5.1.4.1.1.7", None).unwrap();
    assert!(fails(&compat::check(&d::write(&sc).unwrap(), None, &CheckOptions::default())).iter().any(|t| t.contains("SOP class")));
}

#[test]
fn split_parts_are_straightened_numbered_and_pass() {
    // two strips meeting at a tilted line, in an INDUSTREX-like file
    let mut src = parse("industrex-like.dcm");
    let (w, h) = (300usize, 900usize);
    let mut seed: u32 = 4;
    let mut r = || { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); seed as f64 / 4294967296.0 };
    let px: Vec<i32> = (0..w * h).map(|i| { let (x, y) = ((i % w) as f64, (i / w) as f64); if (x - (140.0 + 0.015 * y)).abs() <= 2.0 { 1400 } else { 2800 + ((r() - 0.5) * 80.0).round() as i32 } }).collect();
    let mut img = d::get_image(&src).unwrap();
    img = img.with_frames(h, w, vec![px]);
    d::set_image(&mut src, &img, false).unwrap();
    let src = reparse(&src);
    let img = d::get_image(&src).unwrap();
    let pieces = im::find_pieces(&img.frames[0], w, h, &im::PieceOptions { padding: img.padding, ..Default::default() });
    assert_eq!(pieces.len(), 2, "{pieces:?}");
    let series = d::new_uid();
    let none = shots::OrigEls::new();
    for (i, p) in pieces.iter().enumerate() {
        let part = PartInfo { series: series.clone(), index: i + 1, text: format!("Split part {} of 2", i + 1) };
        let c = copy::build_copy(&state(&src, &src, Some(&img), &[], 0, &none, true), Some(p), Some(&part), SplitOptions { straighten: true, fill_slivers: false, turns: 0 }).unwrap();
        let b = d::write(&c.file).unwrap();
        assert_eq!(fails(&compat::check(&b, Some(&src), &CheckOptions { removed: c.removed.clone(), pixels_changed: true, ..Default::default() })), Vec::<String>::new());
        let o = d::parse(&b).unwrap();
        assert_eq!(o.ds.string(0x0020000E), series);
        assert_eq!(o.ds.string(0x00200013), (i + 1).to_string());
        assert!(o.ds.string(0x00082111).contains("straightened 0.8"), "{}", o.ds.string(0x00082111));
        let oi = decode(&o);
        assert!(oi.frames[0].iter().all(|&v| v > 2000), "no dividing line left");
    }
    // fill slivers instead of straightening (uses only the Pixel Padding Value)
    let p = pieces.iter().find(|p| !p.cuts.is_empty()).unwrap();
    let part = PartInfo { series, index: 1, text: "Split part 1 of 2".into() };
    let c = copy::build_copy(&state(&src, &src, Some(&img), &[], 0, &none, false), Some(p), Some(&part), SplitOptions { straighten: false, fill_slivers: true, turns: 0 }).unwrap();
    assert!(c.description.contains("Pixel Padding Value"));
    assert!(d::get_image(&c.file).unwrap().frames[0].contains(&0));
}

#[test]
fn shots_grouping_batch_edit_undo_and_names() {
    let base = fixture("industrex-like.dcm");
    let mk = |name: &str, weld: &str, inst: u32, acq: &str, id: u64| {
        let mut s = shots::load(&base, name, "", id).unwrap();
        s.file.ds.set_text(0x0008103E, weld, None).unwrap(); s.file.ds.set_text(0x00200013, &inst.to_string(), Some("IS")).unwrap(); s.file.ds.set_text(0x00080032, acq, None).unwrap();
        s
    };
    let mut list = vec![mk("a.dcm", "X-81", 2, "101500", 1), mk("b.dcm", "X-82", 1, "110000", 2), mk("c.dcm", "X-81", 1, "101000", 3), mk("d.dcm", "X-81", 1, "100500", 4), mk("e.dcm", "", 1, "120000", 5), mk("f.dcm", "X-9", 1, "090000", 6)];
    let refs: Vec<&shots::Shot> = list.iter().collect();
    let g = shots::groups(&refs, 0x0008103E);
    let names: Vec<(String, Vec<&str>)> = g.iter().map(|(k, v)| (k.clone(), v.iter().map(|&i| refs[i].name.as_str()).collect())).collect();
    assert_eq!(names, vec![("X-9".into(), vec!["f.dcm"]), ("X-81".into(), vec!["d.dcm", "c.dcm", "a.dcm"]), ("X-82".into(), vec!["b.dcm"]), ("".into(), vec!["e.dcm"])]);
    match &shots::common_values(&refs[..2], &[0x0008103E, 0x00081048])[&0x0008103E] { shots::Common::Mixed(n) => assert_eq!(*n, 2), x => panic!("{x:?}") }
    // batch: everything is validated before anything changes
    let snap = shots::snapshot(&list.iter().collect::<Vec<_>>());
    {
        let mut sel: Vec<&mut shots::Shot> = list.iter_mut().take(3).collect();
        let err = shots::apply_batch(&mut sel, &[(0x00181004, Some("PL-1".into())), (0x00080020, Some("2026-01-01".into()))]).unwrap_err();
        assert_eq!(err.len(), 3);
        assert!(err[0].message.contains("YYYYMMDD"));
    }
    assert!(list.iter().all(|s| !s.is_edited()), "nothing changed after a failed batch");
    {
        let mut sel: Vec<&mut shots::Shot> = list.iter_mut().take(3).collect();
        assert_eq!(shots::apply_batch(&mut sel, &[(0x00181004, Some("PL-1".into())), (0x00204000, None)]).unwrap(), 3);
        shots::renumber(&mut sel, 1).unwrap();
    }
    assert_eq!(list[0].text(0x00181004), "PL-1");
    assert!(!list[0].file.ds.has(0x00204000));
    assert_eq!(list.iter().take(3).map(|s| s.text(0x00200013)).collect::<Vec<_>>(), vec!["1", "2", "3"]);
    assert!(list[0].is_edited() && list[2].orig_els.contains_key("00200013"));
    {
        let mut all: Vec<&mut shots::Shot> = list.iter_mut().collect();
        shots::restore(&mut all, snap);
    }
    assert!(list.iter().all(|s| !s.is_edited()) && list[0].text(0x00181004) != "PL-1");
    // setting a field back to its original value clears the edit record
    shots::set_on(&mut list[0], 0x00081048, Some("X"), None).unwrap();
    assert!(list[0].is_edited());
    shots::set_on(&mut list[0], 0x00081048, Some("Inspect Co"), None).unwrap();
    assert!(!list[0].is_edited());
    // copy names unique, metadata copies pass
    assert_eq!(shots::copy_names(&["a.dcm", "A.DCM", "b.dicom", "c"]), vec!["a_edited.dcm", "A_edited_2.dcm", "b_edited.dcm", "c_edited.dcm"]);
    shots::set_on(&mut list[1], 0x00100020, Some("BATCH-7"), None).unwrap();
    let mc = shots::build_meta_copy(&list[1]).unwrap();
    assert_eq!(mc.synced, vec![0x00100020]);
    assert_eq!(fails(&compat::check(&mc.bytes, Some(&list[1].orig), &CheckOptions { edited: mc.edited.clone(), xml_tag: Some(0x00331070), ..Default::default() })), Vec::<String>::new());
    // editor helpers: set, delete, revert, change list, undo snapshot
    let mut f = list[2].file.clone();
    let mut oe = shots::OrigEls::new();
    assert_eq!(shots::set_field(&mut f, &mut oe, &[], 0x00100020, "Z-1", None).unwrap().unwrap(), "Component ID Number: “WELD-0042” → “Z-1”");
    assert!(shots::set_field(&mut f, &mut oe, &[], 0x00080020, "bad", None).is_err());
    let snap = shots::meta_snapshot(&f, &oe);
    shots::delete_field(&mut f, &mut oe, &[], 0x00324000);
    assert_eq!(shots::meta_change_list(&f, &oe).len(), 2);
    shots::meta_restore(&mut f, &mut oe, snap);
    assert!(f.ds.has(0x00324000) && oe.len() == 1);
    shots::revert_field(&mut f, &mut oe, &[], 0x00100020);
    assert!(oe.is_empty() && f.ds.string(0x00100020) == "WELD-0042");
    // inside a sequence item
    shots::set_field(&mut f, &mut oe, &[(0x00880200, 0)], 0x00280010, "3", None).unwrap();
    assert_eq!(oe.keys().next().unwrap(), "00880200/0/00280010");
    assert!(shots::meta_change_list(&f, &oe)[0].contains("(in sequence)"));
}

#[test]
fn image_operations() {
    let img = d::Image { rows: 2, cols: 3, frames: vec![vec![1, 2, 3, 4, 5, 6]], bits_allocated: 16, bits_stored: 16, signed: false, photometric: "MONOCHROME2".into(), min: 0, max: 65535, slope: 1.0, intercept: 0.0, padding: None, window_center: None, window_width: None };
    assert_eq!(im::rotate(&img, 1).frames[0], vec![4, 1, 5, 2, 6, 3]);
    assert_eq!(im::rotate(&img, -1).frames[0], vec![3, 6, 2, 5, 1, 4]);
    assert_eq!(im::rotate(&img, 2).frames[0], vec![6, 5, 4, 3, 2, 1]);
    assert_eq!(im::flip(&img, true).frames[0], vec![3, 2, 1, 6, 5, 4]);
    assert_eq!(im::flip(&img, false).frames[0], vec![4, 5, 6, 1, 2, 3]);
    assert_eq!(im::crop(&img, Rect::new(1, 0, 2, 2)).unwrap().frames[0], vec![2, 3, 5, 6]);
    assert!(im::crop(&img, Rect::new(5, 5, 2, 2)).is_err());
    let mut i12 = img.clone(); i12.max = 4095;
    assert_eq!(im::invert(&i12).frames[0], vec![4094, 4093, 4092, 4091, 4090, 4089]);
    let (fixed, n) = im::fix_bad_pixels(&img.with_frames(3, 3, vec![vec![10, 10, 10, 10, 900, 10, 10, 10, 10]]), 100.0);
    assert_eq!((fixed.frames[0][4], n), (10, 1));
    // render: window, MONOCHROME1 and the LUT path agree
    let g = im::render(&img.frames[0], &img, 3.5, 5.0, false);
    assert_eq!(g, vec![0, 51, 102, 153, 204, 255]);
    let mut m1 = img.clone(); m1.photometric = "MONOCHROME1".into();
    assert_eq!(im::render(&m1.frames[0], &m1, 3.5, 5.0, false)[1], 204);
    assert_eq!(im::split_regions(100, 300, 3, false, 5), vec![Rect::new(0, 0, 105, 100), Rect::new(95, 0, 110, 100), Rect::new(195, 0, 105, 100)]);
    // EDGE neutral settings return the input
    let a: Vec<i32> = (0..2000).map(|i| (i * 37 % 1000) as i32).collect();
    let (e, _) = im::edge_enhance(&a, 50, 40, &im::EdgeParams { kg: Some(1.0), kd: Some(1.0), ks: Some(1.0), ..Default::default() });
    assert!(e.iter().zip(&a).all(|(x, y)| (*x as f64 - *y as f64).abs() < 0.01));
    let (e2, _) = im::edge_enhance_v2(&a, 50, 40, &im::EdgeParams { kg: Some(1.0), kd: Some(1.0), ks: Some(1.0), kernel_px: 12.0, ..Default::default() }, 2.0);
    assert!(e2.iter().zip(&a).all(|(x, y)| (*x as f64 - *y as f64).abs() < 0.01), "v2 neutral settings return the input");
    // v2 defaults: large-scale shading keeps half the detail gain, a fine ripple is raised, a huge spike is limited
    let (w2, h2) = (400usize, 60usize);
    let ramp: Vec<i32> = (0..w2 * h2).map(|i| 2000 + (i % w2) as i32 + if (i % w2) % 8 < 4 { 3 } else { -3 } + if i == 30 * w2 + 200 { 1500 } else { 0 }).collect();
    let (e3, _) = im::edge_enhance_v2(&ramp, w2, h2, &im::EdgeParams { kernel_px: 60.0, detail_limit: 40.0, ..Default::default() }, 6.0);
    let at = |x: usize| e3[30 * w2 + x] as f64;
    let slope = (at(304) - at(104)) / 200.0;
    assert!(slope > 1.0 && slope < 1.4, "ramp slope {slope} (kG 1.2, half of kD 2.4)");
    assert!((at(101) - at(105)).abs() > 12.0, "ripple of 6 raised: {}", (at(101) - at(105)).abs());
    assert!(at(200) - at(180) < 200.0, "spike of 1500 (9000 unlimited) limited: {}", at(200) - at(180));
    // empty area beside the film must not change how the film looks
    let film: Vec<i32> = (0..w2 * h2).map(|i| 2800 + ((i % w2) % 7) as i32).collect();
    let with_gap: Vec<i32> = film.iter().enumerate().map(|(i, &v)| if i % w2 < 120 { 15 } else { v }).collect();
    let p = im::EdgeParams { kernel_px: 60.0, detail_limit: 300.0, ..Default::default() };
    let lv = im::plate_levels(&with_gap, w2, h2, None, 0.6);
    assert!(lv.has_background);
    let (alone, _) = im::edge_enhance_v2(&film, w2, h2, &p, 6.0);
    let (masked, _) = im::edge_enhance_v2(&with_gap, w2, h2, &im::EdgeParams { background: Some((lv.sign, lv.thr)), ..p.clone() }, 6.0);
    let (unmasked, _) = im::edge_enhance_v2(&with_gap, w2, h2, &p, 6.0);
    let worst = |x: &[f32]| (130..w2).map(|c| (x[30 * w2 + c] - alone[30 * w2 + c]).abs()).fold(0f32, f32::max);
    assert!(worst(&masked) < 25.0 && worst(&unmasked) > 500.0, "masked {} unmasked {}", worst(&masked), worst(&unmasked));
    assert_eq!(masked[30 * w2 + 10], 15.0, "empty area keeps its own value");
    // view rotation maps both ways
    for rot in [0, 90, 180, 270] { let (x, y) = im::to_view(10.0, 20.0, 300.0, 200.0, rot); assert_eq!(im::from_view(x, y, 300.0, 200.0, rot), (10.0, 20.0)); }
}

#[test]
fn exports_are_valid() {
    let z = export::zip(&[("a.dcm".into(), b"hello".to_vec()), ("b.txt".into(), vec![1, 2, 3])]).unwrap();
    assert_eq!(&z[..4], &[0x50, 0x4B, 3, 4]);
    let end = z.len() - 22;
    assert_eq!(u32::from_le_bytes(z[end..end + 4].try_into().unwrap()), 0x06054b50);
    assert_eq!(u16::from_le_bytes([z[end + 10], z[end + 11]]), 2);
    assert_eq!(export::crc32(b"hello"), 0x3610a686);
    let img = d::get_image(&make_sample(&SampleOptions { rows: 10, cols: 12, ..Default::default() })).unwrap();
    let t = export::tiff(&img, 0);
    assert_eq!(&t[..4], &[0x49, 0x49, 42, 0]);
    assert_eq!(t.len(), 8 + 2 + 11 * 12 + 4 + 10 * 12 * 2);
    let jpg = export::jpeg_rgb(&vec![128u8; 4 * 4 * 3], 4, 4, 90).unwrap();
    let pdf = export::pdf_report(&export::Report { title: "Radiograph report", subtitle: "x", fields: vec![("Component".into(), "Pipe (12) \\ ok".into())], jpeg: Some((&jpg, 4, 4)), caption: "cap" });
    let s: String = pdf.iter().map(|&b| b as char).collect(); // Latin-1: byte offsets stay character offsets
    assert!(s.starts_with("%PDF-1.4") && s.trim_end().ends_with("%%EOF"));
    let sx: usize = s[s.rfind("startxref").unwrap() + 10..].lines().next().unwrap().trim().parse().unwrap();
    assert!(pdf[sx..].starts_with(b"xref"), "startxref points at the cross-reference table");
    assert!(s.contains("Pipe \\(12\\) \\\\ ok"));
    let png = export::png_rgba(&vec![255u8; 2 * 2 * 4], 2, 2).unwrap();
    assert_eq!(&png[1..4], b"PNG");
}

#[test]
fn overlay_text() {
    assert_eq!(overlay::format_value("PN", "Tech^Sample=Other"), "Sample".replace("Sample", "Tech Sample"));
    assert_eq!(overlay::format_value("DA", "20261111"), "2026-11-11");
    assert_eq!(overlay::format_value("TM", "143005.25"), "14:30:05");
    assert_eq!(overlay::format_value("DT", "20261111143005"), "2026-11-11 14:30:05");
    assert_eq!(overlay::format_value("LO", "a\\b"), "a, b");
    let f = parse("industrex-like.dcm");
    let l = overlay::lines(&f.ds, &overlay::Layout::default(), &|k| if k == "live:zoom" { "50%".into() } else { String::new() }, true);
    assert!(l[0].iter().any(|s| s == "Component ID Number: WELD-0042"), "{l:?}");
    assert_eq!(l[3], vec!["Zoom: 50%".to_string()]);
    let clean = overlay::clean_layout(&[vec!["live:zoom".into(), "junk".into(), "00100020".into()]]);
    assert_eq!(clean.corners[0], vec!["live:zoom", "00100020"]);
    assert_eq!(clean.corners[1], overlay::Layout::default().corners[1]);
    assert_eq!(overlay::corner_of(&clean, "00100020"), Some(0));
}

/// Real INDUSTREX exports, never stored in the repository: DICONDE_REAL_DIR=/path cargo test real_files
#[test]
fn real_files() {
    let Ok(dir) = std::env::var("DICONDE_REAL_DIR") else { eprintln!("real files: skipped (set DICONDE_REAL_DIR)"); return };
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let p = entry.unwrap().path();
        if !p.extension().map_or(false, |e| e.eq_ignore_ascii_case("dcm")) { continue; }
        let bytes = std::fs::read(&p).unwrap();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        let src = d::parse(&bytes).unwrap();
        assert_eq!(d::write(&reparse(&src)).unwrap().len(), d::write(&src).unwrap().len());
        let ix = d::industrex_info(&src.ds);
        // metadata-only copy
        let mut shot = shots::load(&bytes, &name, "", 1).unwrap();
        shots::set_on(&mut shot, 0x00204000, Some("weldscope test"), None).unwrap();
        let mc = shots::build_meta_copy(&shot).unwrap();
        let out = d::parse(&mc.bytes).unwrap();
        for (t, e) in &src.ds.el {
            if [0x00204000u32, 0x00080018, 0x00080012, 0x00080013].contains(t) || Some(*t) == ix.as_ref().and_then(|i| i.xml_tag) { continue; }
            assert_eq!(out.ds.get(*t).map(|o| (&o.value, o.vr)), Some((&e.value, e.vr)), "{name}: {} changed", d::tag_hex(*t));
        }
        assert_eq!(fails(&compat::check(&mc.bytes, Some(&src), &CheckOptions { edited: mc.edited.clone(), xml_tag: ix.as_ref().and_then(|i| i.xml_tag), ..Default::default() })), Vec::<String>::new(), "{name}: metadata-only");
        if src.encapsulated() {
            let img = decode(&src);
            let st = im::stats(&img.frames[0], None);
            if let (Some(lo), Some(hi)) = (src.ds.number(0x00280106), src.ds.number(0x00280107)) { assert_eq!((st.min, st.max), (lo, hi), "{name}: decoded range"); }
            let rot = im::rotate(&img, 1);
            let ops = vec!["Rotated 90° clockwise".to_string()];
            let none = shots::OrigEls::new();
            let t0 = std::time::Instant::now();
            let pc = copy::build_copy(&state(&src, &src, Some(&rot), &ops, 1, &none, true), None, None, SplitOptions::default()).unwrap();
            let enc = t0.elapsed();
            let pb = d::write(&pc.file).unwrap();
            let r = compat::check(&pb, Some(&src), &CheckOptions { removed: pc.removed.clone(), pixels_changed: true, ..Default::default() });
            assert_eq!(fails(&r), Vec::<String>::new(), "{name}: processed");
            assert!(r.iter().all(|c| c.title != "JPEG 2000 tiling differs from the original"), "{name}: tiles follow the source");
            assert_eq!(decode(&d::parse(&pb).unwrap()).frames, rot.frames, "{name}: lossless");
            let pieces = im::find_pieces(&img.frames[0], img.cols, img.rows, &im::PieceOptions { padding: img.padding, ..Default::default() });
            let info = copy::source_encoding(&src).unwrap();
            eprintln!("  {name:.40}: {}×{}, {} tiles {}×{} {}, encode {:?}, {} piece(s), {} → {} bytes", img.cols, img.rows, info.progression, info.tile_width, info.tile_height, info.precision, enc, pieces.len(), bytes.len(), pb.len());
            let _ = Region::default();
        }
        n += 1;
    }
    assert!(n > 0, "no .dcm files in {dir}");
    eprintln!("real files: {n} passed");
}

#[test]
fn saved_pieces_can_be_turned_to_the_viewing_angle() {
    let src = d::parse(&fixture("industrex-j2k.dcm")).unwrap();
    let img = decode(&src);
    let none = shots::OrigEls::new();
    let region = Region { rect: Rect { x: 0, y: 0, w: (img.cols / 2) as i64, h: img.rows as i64 }, cuts: vec![] };
    let part = PartInfo { series: d::new_uid(), index: 1, text: "Split part 1 of 2".into() };
    let plain = copy::build_copy(&state(&src, &src, Some(&img), &[], 0, &none, false), Some(&region), Some(&part), SplitOptions::default()).unwrap();
    let turned = copy::build_copy(&state(&src, &src, Some(&img), &[], 0, &none, false), Some(&region), Some(&part), SplitOptions { turns: 3, ..Default::default() }).unwrap();
    let (a, b) = (d::get_image(&plain.file).unwrap(), d::get_image(&turned.file).unwrap());
    assert_eq!((b.cols, b.rows), (a.rows, a.cols));
    assert_eq!(b.frames[0], im::rotate(&a, 3).frames[0]);
    assert!(turned.description.contains("turned 270° clockwise to the viewing angle") && !plain.description.contains("turned"));
    let bytes = d::write(&turned.file).unwrap();
    assert_eq!(fails(&compat::check(&bytes, Some(&src), &CheckOptions { removed: turned.removed.clone(), pixels_changed: true, ..Default::default() })), Vec::<String>::new());
}
