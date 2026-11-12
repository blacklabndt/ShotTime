//! Possible-indication finder: the Rust port against the Python research code (tiny random networks, a synthetic
//! image; tools/defect-finder/make_fixture.py), and the weld band finder on synthetic plates.
use weldscope_core::indications as ind;

fn fixture() -> (ind::Models, serde_json::Value) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
    let m = ind::load_models(&std::fs::read(format!("{dir}indication-test-model.bin")).unwrap()).unwrap();
    (m, serde_json::from_slice(&std::fs::read(format!("{dir}indication-parity.json")).unwrap()).unwrap())
}
fn floats(v: &serde_json::Value) -> Vec<f64> { v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect() }

#[test]
fn finder_map_matches_the_research_code() {
    let (m, j) = fixture();
    let (w, h) = (j["w"].as_u64().unwrap() as usize, j["h"].as_u64().unwrap() as usize);
    let img: Vec<u8> = floats(&j["img"]).iter().map(|v| *v as u8).collect();
    let (d, gw, gh) = ind::finder_map(&m, &img, w, h, &|_| {});
    assert_eq!((gw as u64, gh as u64), (j["gw"].as_u64().unwrap(), j["gh"].as_u64().unwrap()));
    let want = floats(&j["d"]);
    let worst = d.iter().zip(&want).map(|(a, b)| (*a as f64 - b).abs()).fold(0.0, f64::max);
    assert!(worst < 2e-3, "finder map differs by {worst}");
}

#[test]
fn close_crop_and_second_network_match() {
    let (m, j) = fixture();
    let (w, h) = (j["w"].as_u64().unwrap() as usize, j["h"].as_u64().unwrap() as usize);
    let img: Vec<u8> = floats(&j["img"]).iter().map(|v| *v as u8).collect();
    for (i, b) in j["boxes"].as_array().unwrap().iter().enumerate() {
        let b = floats(b);
        let c = ind::close_crop(&img, w, h, (b[0], b[1], b[2], b[3]));
        if i == 0 {
            let want = floats(&j["crop0"]);
            let off = c.iter().zip(&want).filter(|(a, b)| (**a as f64 - **b).abs() > 0.126).count(); // one grey level = 0.125
            assert!(off == 0, "{off} crop pixels differ by more than one grey level");
        }
        let p = ind::name_crop(&m, &c);
        let want = floats(&j["probs"][i]);
        let worst = p.iter().zip(&want).map(|(a, b)| (*a as f64 - b).abs()).fold(0.0, f64::max);
        assert!(worst < 0.02, "box {i}: probabilities differ by {worst}");
    }
}

#[test]
fn candidates_match() {
    let (m, j) = fixture();
    let (w, h) = (j["w"].as_u64().unwrap() as usize, j["h"].as_u64().unwrap() as usize);
    let img: Vec<u8> = floats(&j["img"]).iter().map(|v| *v as u8).collect();
    let (d, gw, gh) = ind::finder_map(&m, &img, w, h, &|_| {});
    let got = ind::peaks(&d, gw, gh, 0.1);
    let want: Vec<Vec<f64>> = j["cands"].as_array().unwrap().iter().map(floats).collect();
    // peaks that are clear in both must agree on the box; near-ties may differ
    let mut same = 0;
    for c in &want { if got.iter().any(|g| g.0 == c[0] && g.1 == c[1] && g.2 == c[2] && g.3 == c[3] && (g.4 as f64 - c[4]).abs() < 2e-3) { same += 1; } }
    assert!(same as f64 >= 0.95 * want.len() as f64 && (got.len() as f64 - want.len() as f64).abs() <= 0.05 * want.len() as f64, "{same} of {} boxes agree; got {}", want.len(), got.len());
}

#[test]
fn a_damaged_model_file_is_refused() {
    assert!(ind::load_models(b"not a model").is_err());
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
    let b = std::fs::read(format!("{dir}indication-test-model.bin")).unwrap();
    assert!(ind::load_models(&b[..b.len() - 9]).is_err());
}

/// A plate in film sense: darker plate, a lighter weld ridge, a belt of light "numbers" and an unexposed gap.
fn plate(w: usize, h: usize, films: &[(usize, usize, usize, usize)], vertical: bool) -> Vec<u8> {
    let mut g = vec![255u8; w * h];
    let mut put = |x: usize, y: usize, v: u8| { let (x, y) = if vertical { (y, x) } else { (x, y) }; g[y * w + x] = v; };
    let (len, _) = if vertical { (h, w) } else { (w, h) };
    for &(y0, y1, ridge, half) in films {
        for y in y0..y1 { for x in 0..len {
            let tilt = (x as f64 / len as f64 * 12.0) as usize;
            let on = (y as i64 - (ridge + tilt) as i64).unsigned_abs() as usize <= half;
            let mut v = 70 + ((x * 7 + y * 13) % 5) as u8 + if on { 60 } else { 0 };
            if y >= y1 - 60 && y < y1 - 30 && (x / 25) % 2 == 0 && (x / 5) % 2 == 0 { v = 235; } // number belt
            put(x, y, v);
        } }
    }
    g
}

#[test]
fn weld_band_is_found_and_the_number_belt_is_not() {
    let (w, h) = (1200, 300);
    let g = plate(w, h, &[(0, 300, 120, 18)], false);
    let b = ind::find_bands(&g, w, h);
    assert_eq!(b.films.len(), 1);
    assert!(b.films[0].sure, "band should be sure: {:?}", b.films[0]);
    assert_eq!(b.locate(600.0, 126.0), ind::Where::Band);
    assert_eq!(b.locate(100.0, 121.0), ind::Where::Band);
    assert_eq!(b.locate(600.0, 255.0), ind::Where::Outside, "number belt must be outside the band");
    assert_eq!(b.locate(600.0, 30.0), ind::Where::Outside);
}

#[test]
fn two_films_side_by_side_get_a_band_each_whichever_way_they_run() {
    for vertical in [false, true] {
        let (len, across) = (1200usize, 620usize);
        let (w, h) = if vertical { (across, len) } else { (len, across) };
        let g = plate(w, h, &[(0, 300, 110, 16), (320, 620, 470, 16)], vertical);
        let b = ind::find_bands(&g, w, h);
        assert_eq!(b.turned, vertical);
        assert_eq!(b.films.len(), 2, "vertical {vertical}");
        assert!(b.films.iter().all(|f| f.sure), "vertical {vertical}: {:?}", b.films);
        let at = |along: f64, acr: f64| if vertical { b.locate(acr, along) } else { b.locate(along, acr) };
        assert_eq!(at(600.0, 116.0), ind::Where::Band);
        assert_eq!(at(600.0, 476.0), ind::Where::Band);
        assert_eq!(at(600.0, 200.0), ind::Where::Outside);
        assert_eq!(at(600.0, 310.0), ind::Where::Outside, "the gap between films");
        assert_eq!(b.outlines().len(), 4);
    }
}

#[test]
fn a_plate_with_no_clear_weld_is_reported_unsure_not_guessed() {
    let (w, h) = (900, 300);
    let g: Vec<u8> = (0..w * h).map(|i| 90 + ((i % w * 3 + i / w * 7) % 9) as u8).collect();
    let b = ind::find_bands(&g, w, h);
    assert!(b.films.iter().all(|f| !f.sure));
    assert_eq!(b.locate(450.0, 150.0), ind::Where::UnsureFilm);
}
