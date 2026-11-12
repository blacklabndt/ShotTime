//! Prints the location-number rows read from each DICONDE file in a folder (development aid).
use weldscope_core::{codec, dicom as d, markers};
fn main() {
    let dir = std::env::args().nth(1).expect("folder");
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).collect(); names.sort();
    for p in names {
        let Ok(bytes) = std::fs::read(&p) else { continue };
        let Ok(file) = d::parse(&bytes) else { continue };
        let img = match d::get_image(&file) { Ok(i) => i, Err(_) => { let Some(fr) = file.ds.get(d::PIXEL).and_then(|p| p.fragments()) else { continue }; let Ok(fb) = codec::decode_frames(fr, &d::image_geometry(&file)) else { continue }; let Ok(i) = d::image_from_frames(&file, &fb) else { continue }; i } };
        let px = file.ds.number(0x00181164).or_else(|| file.ds.number(0x00280030)).unwrap_or(0.1);
        let t = std::time::Instant::now();
        let belts = markers::find_belts(&img.frames[0], img.cols, img.rows, img.padding, px);
        println!("{:<28} {:>4} ms  {}  {:?}", p.file_name().unwrap().to_string_lossy().chars().take(26).collect::<String>(), t.elapsed().as_millis(), markers::coverage_text(&belts), belts.iter().map(|b| (b.confidence, b.reads, b.wraps)).collect::<Vec<_>>());
    }
}
