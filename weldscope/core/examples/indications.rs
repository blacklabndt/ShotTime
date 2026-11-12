//! Development aid for the possible-indication finder.
//!   indications <model file> <folder of DICONDE files>     ranked candidates per file, with timing
//!   indications <model file> --raw <w> <h> <8-bit file>    every candidate on a film-sense image (for comparing with rank.py)
use weldscope_core::{codec, dicom as d, indications as ind};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let m = ind::load_models(&std::fs::read(&a[1]).expect("model file")).expect("model");
    if a[2] == "--raw" {
        let (w, h): (usize, usize) = (a[3].parse().unwrap(), a[4].parse().unwrap());
        let g = std::fs::read(&a[5]).unwrap();
        let t = std::time::Instant::now();
        let (dm, gw, gh) = ind::finder_map(&m, &g, w, h, &|_| {});
        eprintln!("finder {} ms", t.elapsed().as_millis());
        for b in ind::peaks(&dm, gw, gh, 0.1) { let p = ind::name_crop(&m, &ind::close_crop(&g, w, h, (b.0, b.1, b.2, b.3))); println!("{} {} {} {} {:.4} {:.4}", b.0, b.1, b.2, b.3, b.4, 1.0 - p[0]); }
        return;
    }
    let mut names: Vec<_> = std::fs::read_dir(&a[2]).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).collect(); names.sort();
    for p in names {
        let Ok(bytes) = std::fs::read(&p) else { continue };
        let Ok(file) = d::parse(&bytes) else { continue };
        let img = match d::get_image(&file) { Ok(i) => i, Err(_) => { let Some(fr) = file.ds.get(d::PIXEL).and_then(|p| p.fragments()) else { continue }; let Ok(fb) = codec::decode_frames(fr, &d::image_geometry(&file)) else { continue }; let Ok(i) = d::image_from_frames(&file, &fb) else { continue }; i } };
        let px = file.ds.number(0x00181164).or_else(|| file.ds.number(0x00280030)).unwrap_or(0.1);
        let t = std::time::Instant::now();
        let f = ind::find(&m, &img.frames[0], img.cols, img.rows, img.padding, px, &|_| {});
        println!("{:<28} {}x{} {:>6} ms  films {} (sure {})  at each sensitivity {:?}", p.file_name().unwrap().to_string_lossy().chars().take(26).collect::<String>(), img.cols, img.rows, t.elapsed().as_millis(),
            f.bands.films.len(), f.bands.films.iter().filter(|b| b.sure).count(), ind::CUTS.iter().map(|c| f.items.iter().filter(|i| i.score > *c).count()).collect::<Vec<_>>());
    }
}
