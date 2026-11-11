//! JPEG 2000 decoding and lossless encoding for DICOM pixel data, through OpenJPEG (statically linked via the
//! openjpeg-sys crate). Ported from diconde-editor/codec.js, which used the OpenJPEG WebAssembly build.

use openjpeg_sys as opj;
use std::ffi::{c_char, c_void, CStr};

pub const J2K_LOSSLESS: &str = crate::dicom::TS_J2K_LOSSLESS;
const J2K_SYNTAXES: [&str; 5] = [J2K_LOSSLESS, "1.2.840.10008.1.2.4.91", "1.2.840.10008.1.2.4.201", "1.2.840.10008.1.2.4.202", "1.2.840.10008.1.2.4.203"];
pub fn can_decode(ts: &str) -> bool { J2K_SYNTAXES.contains(&ts) }
pub fn version() -> String { unsafe { CStr::from_ptr(opj::opj_version()).to_string_lossy().into_owned() } }

#[derive(Debug, Clone, PartialEq)]
pub struct CodecError(pub String);
impl std::fmt::Display for CodecError { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str(&self.0) } }
impl std::error::Error for CodecError {}
type Result<T> = std::result::Result<T, CodecError>;

// ---------------------------------------------------------------- memory streams
struct Mem { data: Vec<u8>, pos: usize, input: bool }

unsafe extern "C" fn mem_read(buf: *mut c_void, n: usize, ud: *mut c_void) -> usize {
    let m = &mut *(ud as *mut Mem);
    if m.pos >= m.data.len() { return usize::MAX; }
    let k = n.min(m.data.len() - m.pos);
    std::ptr::copy_nonoverlapping(m.data.as_ptr().add(m.pos), buf as *mut u8, k);
    m.pos += k;
    k
}
unsafe extern "C" fn mem_write(buf: *mut c_void, n: usize, ud: *mut c_void) -> usize {
    let m = &mut *(ud as *mut Mem);
    let end = m.pos + n;
    if m.data.len() < end { m.data.resize(end, 0); }
    std::ptr::copy_nonoverlapping(buf as *const u8, m.data.as_mut_ptr().add(m.pos), n);
    m.pos = end;
    n
}
unsafe extern "C" fn mem_skip(n: i64, ud: *mut c_void) -> i64 {
    let m = &mut *(ud as *mut Mem);
    let target = m.pos as i64 + n;
    if target < 0 { return -1; }
    if m.input && target as usize > m.data.len() { let moved = m.data.len() as i64 - m.pos as i64; m.pos = m.data.len(); return moved; }
    m.pos = target as usize;
    n
}
unsafe extern "C" fn mem_seek(n: i64, ud: *mut c_void) -> i32 {
    let m = &mut *(ud as *mut Mem);
    if n < 0 || (m.input && n as usize > m.data.len()) { return 0; }
    m.pos = n as usize;
    1
}
unsafe extern "C" fn on_error(msg: *const c_char, ud: *mut c_void) {
    let s = &mut *(ud as *mut String);
    if s.len() < 500 { s.push_str(CStr::from_ptr(msg).to_string_lossy().trim()); s.push(' '); }
}
unsafe extern "C" fn on_quiet(_msg: *const c_char, _ud: *mut c_void) {}

unsafe fn make_stream(mem: &mut Mem) -> *mut opj::opj_stream_t {
    let s = opj::opj_stream_create(1 << 20, if mem.input { 1 } else { 0 });
    opj::opj_stream_set_user_data(s, mem as *mut Mem as *mut c_void, None);
    if mem.input {
        opj::opj_stream_set_user_data_length(s, mem.data.len() as u64);
        opj::opj_stream_set_read_function(s, Some(mem_read));
    } else {
        opj::opj_stream_set_write_function(s, Some(mem_write));
    }
    opj::opj_stream_set_skip_function(s, Some(mem_skip));
    opj::opj_stream_set_seek_function(s, Some(mem_seek));
    s
}

/// One decoded greyscale (or multi-component) frame: samples as i32, row by row.
#[derive(Debug, Clone)]
pub struct Decoded { pub width: usize, pub height: usize, pub precision: u32, pub signed: bool, pub components: usize, pub data: Vec<i32> }

pub fn decode_frame(bytes: &[u8]) -> Result<Decoded> {
    let fail = |what: &str, msg: &str| CodecError(format!("The JPEG 2000 {what} failed (the data may be damaged or unsupported).{}", if msg.trim().is_empty() { String::new() } else { format!(" {}", msg.trim()) }));
    let jp2 = bytes.len() > 12 && &bytes[4..8] == b"jP  ";
    let mut mem = Mem { data: bytes.to_vec(), pos: 0, input: true };
    let mut msg = String::new();
    unsafe {
        let codec = opj::opj_create_decompress(if jp2 { opj::CODEC_FORMAT::OPJ_CODEC_JP2 } else { opj::CODEC_FORMAT::OPJ_CODEC_J2K });
        if codec.is_null() { return Err(fail("decoder", "")); }
        opj::opj_set_error_handler(codec, Some(on_error), &mut msg as *mut String as *mut c_void);
        opj::opj_set_warning_handler(codec, Some(on_quiet), std::ptr::null_mut());
        opj::opj_set_info_handler(codec, Some(on_quiet), std::ptr::null_mut());
        let mut params: opj::opj_dparameters_t = std::mem::zeroed();
        opj::opj_set_default_decoder_parameters(&mut params);
        let stream = make_stream(&mut mem);
        let mut image: *mut opj::opj_image_t = std::ptr::null_mut();
        let ok = opj::opj_setup_decoder(codec, &mut params) != 0
            && opj::opj_read_header(stream, codec, &mut image) != 0
            && opj::opj_decode(codec, stream, image) != 0
            && opj::opj_end_decompress(codec, stream) != 0;
        let out = if ok && !image.is_null() {
            let im = &*image;
            let comps = std::slice::from_raw_parts(im.comps, im.numcomps as usize);
            let c0 = &comps[0];
            let (w, h) = (c0.w as usize, c0.h as usize);
            if c0.data.is_null() { Err(fail("decoder", "no image data")) } else {
                let mut data = Vec::with_capacity(w * h * comps.len());
                for c in comps { if c.w as usize == w && c.h as usize == h && !c.data.is_null() { data.extend_from_slice(std::slice::from_raw_parts(c.data, w * h)); } }
                Ok(Decoded { width: w, height: h, precision: c0.prec, signed: c0.sgnd != 0, components: comps.len(), data })
            }
        } else { Err(fail("decoder", &msg)) };
        if !image.is_null() { opj::opj_image_destroy(image); }
        opj::opj_stream_destroy(stream);
        opj::opj_destroy_codec(codec);
        out
    }
}

// ---------------------------------------------------------------- codestream header
pub const PROGRESSIONS: [&str; 5] = ["LRCP", "RLCP", "RPCL", "PCRL", "CPRL"];

/// Main-header facts of a J2K codestream (SIZ and COD), used to write copies the way the source was written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CodestreamInfo {
    pub width: u32, pub height: u32, pub tile_width: u32, pub tile_height: u32, pub components: u16, pub precision: u32, pub signed: bool,
    pub progression: String, pub layers: u16, pub levels: u8, pub reversible: bool, pub has_siz: bool, pub has_cod: bool,
}
pub fn codestream_info(b: &[u8]) -> Option<CodestreamInfo> {
    let u16_ = |p: usize| ((b[p] as u32) << 8) | b[p + 1] as u32;
    let u32_ = |p: usize| ((b[p] as u32) << 24) | ((b[p + 1] as u32) << 16) | ((b[p + 2] as u32) << 8) | b[p + 3] as u32;
    if b.len() < 4 || u16_(0) != 0xFF4F { return None; }
    let mut info = CodestreamInfo::default();
    let mut p = 2;
    while p + 4 <= b.len() {
        let (m, len) = (u16_(p), u16_(p + 2) as usize);
        if m == 0xFF51 && p + 42 < b.len() {
            info.width = u32_(p + 6); info.height = u32_(p + 10); info.tile_width = u32_(p + 22); info.tile_height = u32_(p + 26);
            info.components = u16_(p + 38) as u16; info.precision = (b[p + 40] & 0x7F) as u32 + 1; info.signed = b[p + 40] & 0x80 != 0; info.has_siz = true;
        }
        if m == 0xFF52 && p + 13 < b.len() {
            info.progression = PROGRESSIONS.get(b[p + 5] as usize).map_or(b[p + 5].to_string(), |s| s.to_string());
            info.layers = u16_(p + 6) as u16; info.levels = b[p + 9]; info.reversible = b[p + 13] == 1; info.has_cod = true;
        }
        if m == 0xFF90 || len < 2 { break; }
        p += 2 + len;
    }
    Some(info)
}

/// How to write a lossless codestream. Copies follow the source file's own encoding: INDUSTREX writes RLCP,
/// 16-bit precision and 512×512 tiles.
#[derive(Debug, Clone, Default)]
pub struct EncodeOptions { pub width: usize, pub height: usize, pub bits_per_sample: u32, pub signed: bool, pub progression: Option<String>, pub tile: Option<(u32, u32)> }

/// Lossless (reversible 5/3 wavelet) codestream of one greyscale frame.
pub fn encode_frame_lossless(pixels: &[i32], o: &EncodeOptions) -> Result<Vec<u8>> {
    let (w, h) = (o.width, o.height);
    if pixels.len() < w * h || w == 0 || h == 0 { return Err(CodecError("The image to compress is empty or too short.".into())); }
    let mut msg = String::new();
    let mut mem = Mem { data: Vec::with_capacity(w * h), pos: 0, input: false };
    unsafe {
        let mut params: opj::opj_cparameters_t = std::mem::zeroed();
        opj::opj_set_default_encoder_parameters(&mut params);
        params.tcp_numlayers = 1;
        params.tcp_rates[0] = 0.0;
        params.cp_disto_alloc = 1;
        params.irreversible = 0;
        let mut side = w.min(h);
        if let Some((tw, th)) = o.tile {
            if (tw as usize) < w || (th as usize) < h {
                params.tile_size_on = 1; params.cp_tdx = tw as i32; params.cp_tdy = th as i32; params.cp_tx0 = 0; params.cp_ty0 = 0;
                side = side.min(tw.min(th) as usize);
            }
        }
        // OpenJPEG needs each side (of a tile) to be at least 2^levels pixels; the default is 5 levels.
        let levels = (((side.max(1)) as f64).log2().floor() as i32).clamp(0, 5);
        params.numresolution = levels + 1;
        if let Some(p) = o.progression.as_deref().and_then(|p| PROGRESSIONS.iter().position(|x| *x == p)) {
            params.prog_order = match p { 0 => opj::PROG_ORDER::OPJ_LRCP, 1 => opj::PROG_ORDER::OPJ_RLCP, 2 => opj::PROG_ORDER::OPJ_RPCL, 3 => opj::PROG_ORDER::OPJ_PCRL, _ => opj::PROG_ORDER::OPJ_CPRL };
        }
        let mut cp: opj::opj_image_cmptparm_t = std::mem::zeroed();
        cp.dx = 1; cp.dy = 1; cp.w = w as u32; cp.h = h as u32; cp.prec = o.bits_per_sample; cp.sgnd = o.signed as u32;
        let image = opj::opj_image_create(1, &mut cp, opj::COLOR_SPACE::OPJ_CLRSPC_GRAY);
        if image.is_null() { return Err(CodecError("The JPEG 2000 encoder could not start.".into())); }
        (*image).x0 = 0; (*image).y0 = 0; (*image).x1 = w as u32; (*image).y1 = h as u32;
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), (*(*image).comps).data, w * h);
        let codec = opj::opj_create_compress(opj::CODEC_FORMAT::OPJ_CODEC_J2K);
        opj::opj_set_error_handler(codec, Some(on_error), &mut msg as *mut String as *mut c_void);
        opj::opj_set_warning_handler(codec, Some(on_quiet), std::ptr::null_mut());
        opj::opj_set_info_handler(codec, Some(on_quiet), std::ptr::null_mut());
        let stream = make_stream(&mut mem);
        let ok = opj::opj_setup_encoder(codec, &mut params, image) != 0
            && opj::opj_start_compress(codec, image, stream) != 0
            && opj::opj_encode(codec, stream) != 0
            && opj::opj_end_compress(codec, stream) != 0;
        opj::opj_stream_destroy(stream);
        opj::opj_destroy_codec(codec);
        opj::opj_image_destroy(image);
        if !ok { return Err(CodecError(format!("The JPEG 2000 encoder failed. {}", msg.trim()))); }
    }
    mem.data.truncate(mem.data.len().max(mem.pos));
    Ok(mem.data)
}

// ---------------------------------------------------------------- frames in DICOM fragments
/// Groups encapsulated fragments into one byte stream per frame (PS3.5 A.4).
pub fn frame_streams(fragments: &[Vec<u8>], frames: usize) -> Result<Vec<Vec<u8>>> {
    let items = if fragments.is_empty() { &[][..] } else { &fragments[1..] };
    let bot: &[u8] = fragments.first().map_or(&[], |v| v.as_slice());
    if frames <= 1 { return Ok(vec![items.concat()]); }
    if bot.len() >= 4 * frames {
        let offs: Vec<usize> = (0..frames).map(|i| u32::from_le_bytes(bot[i * 4..i * 4 + 4].try_into().unwrap()) as usize).collect();
        let mut starts = Vec::new();
        let mut pos = 0;
        for f in items { starts.push(pos); pos += 8 + f.len(); }
        return Ok((0..frames).map(|i| items.iter().enumerate().filter(|(k, _)| starts[*k] >= offs[i] && (i == frames - 1 || starts[*k] < offs[i + 1])).map(|(_, f)| f.as_slice()).collect::<Vec<_>>().concat()).collect());
    }
    if items.len() == frames { return Ok(items.to_vec()); }
    // No offset table: a new frame starts at each J2K codestream start marker (FF4F FF51).
    let mut out: Vec<Vec<u8>> = Vec::new();
    for f in items {
        if out.is_empty() || f.starts_with(&[0xFF, 0x4F, 0xFF, 0x51]) { out.push(f.clone()); } else { out.last_mut().unwrap().extend_from_slice(f); }
    }
    if out.len() != frames { return Err(CodecError(format!("Found {} compressed frames, expected {}.", out.len(), frames))); }
    Ok(out)
}

/// Decodes every frame and checks it against the image attributes. Returns raw little-endian pixel bytes per
/// frame (Bits Allocated wide), ready for `dicom::image_from_frames`.
pub fn decode_frames(fragments: &[Vec<u8>], g: &crate::dicom::Geometry) -> Result<Vec<Vec<u8>>> {
    let bpp = (g.bits_allocated / 8) as usize;
    frame_streams(fragments, g.frames)?.iter().enumerate().map(|(i, s)| {
        let d = decode_frame(s)?;
        if d.width != g.cols || d.height != g.rows || d.components != 1 {
            return Err(CodecError(format!("Frame {} decoded as {}×{}×{}, but the file says {}×{} greyscale.", i + 1, d.width, d.height, d.components, g.cols, g.rows)));
        }
        if !(bpp == 1 || bpp == 2 || bpp == 4) { return Err(CodecError(format!("{}-bit images cannot be decoded.", g.bits_allocated))); }
        let mut out = Vec::with_capacity(d.data.len() * bpp);
        for &v in &d.data { match bpp { 1 => out.push(v as u8), 2 => out.extend((v as u16).to_le_bytes()), _ => out.extend((v as u32).to_le_bytes()) } }
        Ok(out)
    }).collect()
}
