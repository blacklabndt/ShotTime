//! File builders: uncompressed ZIP, greyscale TIFF, PNG/JPEG of the displayed image and a simple PDF report.

use crate::dicom::Image;

fn crc_table() -> &'static [u32; 256] {
    static T: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    T.get_or_init(|| { let mut t = [0u32; 256]; for n in 0..256 { let mut c = n as u32; for _ in 0..8 { c = if c & 1 == 1 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 }; } t[n] = c; } t })
}
pub fn crc32(b: &[u8]) -> u32 { let t = crc_table(); let mut c = 0xFFFF_FFFFu32; for &x in b { c = t[((c ^ x as u32) & 0xFF) as usize] ^ (c >> 8); } c ^ 0xFFFF_FFFF }

/// Stored (uncompressed) ZIP; DICOM pixel data rarely shrinks much.
pub fn zip(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    use chrono::{Datelike, Timelike};
    let now = chrono::Local::now();
    let dos_time = ((now.hour() << 11) | (now.minute() << 5) | (now.second() >> 1)) as u16;
    let dos_date = (((now.year() - 1980) as u32) << 9 | now.month() << 5 | now.day()) as u16;
    let (mut out, mut central) = (Vec::new(), Vec::new());
    for (name, data) in files {
        let (nb, crc, size) = (name.as_bytes(), crc32(data), data.len());
        if size > 0xFFFF_FFFE || out.len() > 0xFFFF_FFFE { return Err("Too much data for a ZIP file; split into fewer parts.".into()); }
        let offset = out.len() as u32;
        let mut h = Vec::with_capacity(30);
        h.extend(0x04034b50u32.to_le_bytes()); h.extend(20u16.to_le_bytes()); h.extend(0x0800u16.to_le_bytes()); h.extend(0u16.to_le_bytes());
        h.extend(dos_time.to_le_bytes()); h.extend(dos_date.to_le_bytes()); h.extend(crc.to_le_bytes()); h.extend((size as u32).to_le_bytes()); h.extend((size as u32).to_le_bytes());
        h.extend((nb.len() as u16).to_le_bytes()); h.extend(0u16.to_le_bytes());
        out.extend(h); out.extend(nb); out.extend(data);
        let mut c = Vec::with_capacity(46);
        c.extend(0x02014b50u32.to_le_bytes()); c.extend(20u16.to_le_bytes()); c.extend(20u16.to_le_bytes()); c.extend(0x0800u16.to_le_bytes()); c.extend(0u16.to_le_bytes());
        c.extend(dos_time.to_le_bytes()); c.extend(dos_date.to_le_bytes()); c.extend(crc.to_le_bytes()); c.extend((size as u32).to_le_bytes()); c.extend((size as u32).to_le_bytes());
        c.extend((nb.len() as u16).to_le_bytes()); c.extend([0u8; 12]); c.extend(offset.to_le_bytes());
        central.extend(c); central.extend(nb);
    }
    let (cd_off, cd_len) = (out.len() as u32, central.len() as u32);
    out.extend(central);
    out.extend(0x06054b50u32.to_le_bytes()); out.extend([0u8; 4]); out.extend((files.len() as u16).to_le_bytes()); out.extend((files.len() as u16).to_le_bytes());
    out.extend(cd_len.to_le_bytes()); out.extend(cd_off.to_le_bytes()); out.extend(0u16.to_le_bytes());
    Ok(out)
}

/// Raw pixel values of one frame, one strip, little-endian baseline TIFF.
pub fn tiff(img: &Image, frame: usize) -> Vec<u8> {
    let a = &img.frames[frame.min(img.frames.len() - 1)];
    let bps = img.bits_allocated as u32;
    let (w, h) = (img.cols as u32, img.rows as u32);
    let mut data = Vec::with_capacity(a.len() * (bps as usize / 8));
    for &v in a { match bps { 8 => data.push(v as u8), 16 => data.extend((v as u16).to_le_bytes()), _ => data.extend((v as u32).to_le_bytes()) } }
    let entries: Vec<(u16, u16, u32)> = vec![(256, 4, w), (257, 4, h), (258, 3, bps), (259, 3, 1), (262, 3, if img.monochrome1() { 0 } else { 1 }),
        (273, 4, 0), (277, 3, 1), (278, 4, h), (279, 4, data.len() as u32), (284, 3, 1), (339, 3, if img.signed { 2 } else { 1 })];
    let ifd = 2 + entries.len() * 12 + 4;
    let data_off = (8 + ifd) as u32;
    let mut o = vec![0x49, 0x49, 42, 0];
    o.extend(8u32.to_le_bytes()); o.extend((entries.len() as u16).to_le_bytes());
    for (tag, ty, val) in entries {
        let val = if tag == 273 { data_off } else { val };
        o.extend(tag.to_le_bytes()); o.extend(ty.to_le_bytes()); o.extend(1u32.to_le_bytes());
        if ty == 3 { o.extend((val as u16).to_le_bytes()); o.extend([0, 0]); } else { o.extend(val.to_le_bytes()); }
    }
    o.extend(0u32.to_le_bytes());
    o.extend(data);
    o
}

/// 8-bit RGBA (or grey) pixels to PNG.
pub fn png_rgba(rgba: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba); enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().map_err(|e| e.to_string())?;
        wr.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}
pub fn jpeg_rgb(rgb: &[u8], w: usize, h: usize, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, quality).encode(rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb).map_err(|e| e.to_string())?;
    Ok(out)
}

pub struct Report<'a> { pub title: &'a str, pub subtitle: &'a str, pub fields: Vec<(String, String)>, pub jpeg: Option<(&'a [u8], usize, usize)>, pub caption: &'a str }

/// Letter-size PDF: page 1 = title + field list, page 2 = image (JPEG bytes).
pub fn pdf_report(r: &Report) -> Vec<u8> {
    let (w, h, m) = (612.0f64, 792.0f64, 48.0f64);
    let esc = |s: &str| -> String {
        s.chars().map(|c| if (c as u32) >= 0x20 && (c as u32) <= 0x7E || ((c as u32) >= 0xA0 && (c as u32) <= 0xFF) { c } else { '?' })
            .flat_map(|c| if c == '\\' || c == '(' || c == ')' { vec!['\\', c] } else { vec![c] }).collect()
    };
    let latin = |s: &str| -> Vec<u8> { s.chars().map(|c| (c as u32 & 0xFF) as u8).collect() };
    let wrap = |s: &str, n: usize| -> Vec<String> {
        let mut out = Vec::new();
        for line in s.split('\n') {
            let mut line: Vec<char> = line.trim_end_matches('\r').chars().collect();
            while line.len() > n {
                let mut k = line[..n.min(line.len())].iter().rposition(|&c| c == ' ').unwrap_or(0);
                if k < n / 2 { k = n; }
                out.push(line[..k].iter().collect());
                line = line[k..].to_vec();
                if line.first() == Some(&' ') { line.remove(0); }
            }
            out.push(line.iter().collect());
        }
        out
    };
    let mut pages: Vec<String> = Vec::new();
    let mut ops: Vec<String> = Vec::new();
    let mut y = h - m;
    let text = |ops: &mut Vec<String>, s: &str, size: u32, x: f64, y: f64, font: &str| ops.push(format!("BT /{font} {size} Tf {x} {y} Td ({}) Tj ET", esc(s)));
    text(&mut ops, r.title, 16, m, y, "F2"); y -= 20.0;
    if !r.subtitle.is_empty() { text(&mut ops, r.subtitle, 9, m, y, "F1"); y -= 18.0; }
    for (label, value) in &r.fields {
        let ls = wrap(if value.is_empty() { "-" } else { value }, 70);
        if y - ls.len() as f64 * 12.0 < m { pages.push(ops.join("\n")); ops.clear(); y = h - m; }
        text(&mut ops, label, 9, m, y, "F2");
        for (i, l) in ls.iter().enumerate() { text(&mut ops, l, 9, m + 170.0, y, "F1"); if i < ls.len() - 1 { y -= 12.0; } }
        y -= 14.0;
    }
    if !ops.is_empty() { pages.push(ops.join("\n")); }
    if let Some((_, iw, ih)) = r.jpeg {
        let (max_w, max_h) = (w - 2.0 * m, h - 2.0 * m - 30.0);
        let s = (max_w / iw as f64).min(max_h / ih as f64);
        let (dw, dh) = (iw as f64 * s, ih as f64 * s);
        let (x, top) = ((w - dw) / 2.0, h - m - 10.0);
        let yy = top - dh - 18.0;
        pages.push(format!("q {dw:.2} 0 0 {dh:.2} {x:.2} {:.2} cm /Im1 Do Q\n{}", top - dh, if r.caption.is_empty() { String::new() } else { format!("BT /F1 9 Tf {m} {yy:.2} Td ({}) Tj ET", esc(r.caption)) }));
    }
    let has_img = r.jpeg.is_some();
    let first = if has_img { 6 } else { 5 };
    let mut objs: Vec<Vec<u8>> = vec![Vec::new(); first + pages.len() * 2];
    let kids: Vec<String> = (0..pages.len()).map(|i| format!("{} 0 R", first + i * 2)).collect();
    objs[1] = latin("<< /Type /Catalog /Pages 2 0 R >>");
    objs[2] = latin(&format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), pages.len()));
    objs[3] = latin("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objs[4] = latin("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    if let Some((jpg, iw, ih)) = r.jpeg {
        let mut o = latin(&format!("<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n", jpg.len()));
        o.extend(jpg); o.extend(latin("\nendstream"));
        objs[5] = o;
    }
    for (i, content) in pages.iter().enumerate() {
        let p = first + i * 2;
        let c = latin(content);
        objs[p] = latin(&format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>{} >> /Contents {} 0 R >>", if has_img { " /XObject << /Im1 5 0 R >>" } else { "" }, p + 1));
        let mut o = latin(&format!("<< /Length {} >>\nstream\n", c.len())); o.extend(c); o.extend(latin("\nendstream"));
        objs[p + 1] = o;
    }
    let mut out = latin("%PDF-1.4\n%\u{E2}\u{E3}\u{CF}\u{D3}\n");
    let mut offsets = vec![0usize; objs.len()];
    for i in 1..objs.len() {
        offsets[i] = out.len();
        out.extend(latin(&format!("{i} 0 obj\n"))); out.extend(&objs[i]); out.extend(latin("\nendobj\n"));
    }
    let pos = out.len();
    let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", objs.len());
    for o in offsets.iter().skip(1) { xref += &format!("{o:010} 00000 n \n"); }
    xref += &format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{pos}\n%%EOF\n", objs.len());
    out.extend(latin(&xref));
    out
}
