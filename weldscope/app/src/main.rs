// WeldScope: DICONDE image editor for Windows. The opened files are never changed; every save writes a new file.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod app;
mod export_img;
mod organize;
mod panels;
mod viewer;

use eframe::egui;
use std::sync::Arc;

fn decode_png(bytes: &[u8]) -> (Vec<u8>, u32, u32) {
    let mut dec = png::Decoder::new(bytes);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut r = dec.read_info().expect("bundled png");
    let mut buf = vec![0; r.output_buffer_size()];
    let info = r.next_frame(&mut buf).expect("bundled png");
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        _ => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
    };
    (rgba, info.width, info.height)
}
pub fn png_image(bytes: &[u8]) -> egui::ColorImage {
    let (rgba, w, h) = decode_png(bytes);
    egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &rgba)
}

fn main() -> eframe::Result<()> {
    let args: Vec<std::path::PathBuf> = std::env::args_os().skip(1).map(Into::into).collect();
    if args.iter().any(|a| a.as_os_str() == "--version") {
        println!("WeldScope {} (OpenJPEG {})", env!("CARGO_PKG_VERSION"), weldscope_core::codec::version());
        return Ok(());
    }
    let (icon, iw, ih) = decode_png(include_bytes!("../assets/icon.png"));
    let options = |renderer| eframe::NativeOptions {
        renderer,
        viewport: egui::ViewportBuilder::default()
            .with_title("WeldScope")
            .with_app_id("WeldScope")
            .with_icon(Arc::new(egui::IconData { rgba: icon.clone(), width: iw, height: ih }))
            .with_inner_size([1400.0, 900.0])
            .with_min_inner_size([900.0, 560.0])
            .with_drag_and_drop(true),
        ..Default::default()
    };
    // OpenGL first; computers without a usable OpenGL driver (some virtual machines) fall back to Direct3D/Vulkan.
    let a2 = args.clone();
    match eframe::run_native("WeldScope", options(eframe::Renderer::Glow), Box::new(move |cc| Ok(Box::new(app::App::new(cc, args))))) {
        Err(e) => {
            eprintln!("OpenGL renderer failed ({e}); trying Direct3D/Vulkan");
            eframe::run_native("WeldScope", options(eframe::Renderer::Wgpu), Box::new(move |cc| Ok(Box::new(app::App::new(cc, a2)))))
        }
        ok => ok,
    }
}
