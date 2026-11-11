/* JPEG 2000 decoding/encoding for DICOM pixel data, using the bundled OpenJPEG WebAssembly build
   (vendor/openjpeg, see THIRD-PARTY-NOTICES.md). Works in browsers (including file:// pages) and Node. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root, true);
  else root.Codec = factory(root, false);
})(typeof self !== 'undefined' ? self : this, function (root, isNode) {
  const J2K_LOSSLESS = '1.2.840.10008.1.2.4.90';
  const J2K = new Set([J2K_LOSSLESS, '1.2.840.10008.1.2.4.91', '1.2.840.10008.1.2.4.201', '1.2.840.10008.1.2.4.202', '1.2.840.10008.1.2.4.203']);
  let lib = null, loading = null;

  function load() {
    if (lib) return Promise.resolve(lib);
    if (!loading) loading = (async () => {
      let factory, b64;
      if (isNode) { factory = require('./vendor/openjpeg/openjpegwasm.js'); b64 = require('./vendor/openjpeg/openjpegwasm-binary.js'); }
      else { factory = root.OpenJPEGWASM; b64 = root.OPENJPEG_WASM_BASE64; }
      if (typeof factory !== 'function' || !b64) throw new Error('The JPEG 2000 codec files are missing.');
      const wasmBinary = isNode ? new Uint8Array(Buffer.from(b64, 'base64')) : Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      lib = await factory({ wasmBinary, print() {}, printErr() {} });
      return lib;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }
  const canDecode = ts => J2K.has(ts);
  function need() { if (!lib) throw new Error('The JPEG 2000 codec is not loaded yet.'); return lib; }

  // Emscripten throws a bare number (an exception pointer) on C++ errors; give the user words instead.
  const wrap = (what, e) => (typeof e === 'number' ? new Error(`The JPEG 2000 ${what} failed (the data may be damaged or unsupported).`) : e);
  function decodeFrame(bytes) {
    const dec = new (need().J2KDecoder)();
    try {
      dec.getEncodedBuffer(bytes.length).set(bytes);
      dec.decode();
      const fi = dec.getFrameInfo();
      return { width: fi.width, height: fi.height, bitsPerSample: fi.bitsPerSample, componentCount: fi.componentCount, isSigned: !!fi.isSigned,
        data: new Uint8Array(dec.getDecodedBuffer()).slice() };
    } catch (e) { throw wrap('decoder', e); } finally { if (dec.delete) dec.delete(); }
  }
  // Lossless (reversible 5/3 wavelet) codestream of one greyscale frame.
  function encodeFrameLossless(pixels, { width, height, bitsPerSample, isSigned }) {
    const enc = new (need().J2KEncoder)();
    try {
      enc.getDecodedBuffer({ width, height, bitsPerSample, componentCount: 1, isSigned: !!isSigned })
        .set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
      enc.setQuality(true, 0);
      // OpenJPEG needs each side to be at least 2^levels pixels; the default is 5 levels.
      enc.setDecompositions(Math.max(0, Math.min(5, Math.floor(Math.log2(Math.max(1, Math.min(width, height)))))));
      enc.encode();
      return new Uint8Array(enc.getEncodedBuffer()).slice();
    } catch (e) { throw wrap('encoder', e); } finally { if (enc.delete) enc.delete(); }
  }

  // Groups encapsulated fragments into one byte stream per frame (PS3.5 A.4).
  function frameStreams(fragments, frames) {
    const concat = list => { let n = 0; list.forEach(f => { n += f.length; }); const o = new Uint8Array(n); let p = 0; list.forEach(f => { o.set(f, p); p += f.length; }); return o; };
    const items = fragments.slice(1), bot = fragments[0] || new Uint8Array(0);
    if (frames <= 1) return [concat(items)];
    if (bot.length >= 4 * frames) {
      const dv = new DataView(bot.buffer, bot.byteOffset, bot.byteLength), offs = [];
      for (let i = 0; i < frames; i++) offs.push(dv.getUint32(i * 4, true));
      const starts = []; let pos = 0; items.forEach(f => { starts.push(pos); pos += 8 + f.length; });
      return offs.map((o, i) => concat(items.filter((_, k) => starts[k] >= o && (i === frames - 1 || starts[k] < offs[i + 1]))));
    }
    if (items.length === frames) return items;
    // No offset table: a new frame starts at each J2K codestream start marker (FF4F FF51).
    const out = [];
    items.forEach(f => { if (!out.length || (f[0] === 0xFF && f[1] === 0x4F && f[2] === 0xFF && f[3] === 0x51)) out.push([f]); else out[out.length - 1].push(f); });
    if (out.length !== frames) throw new Error(`Found ${out.length} compressed frames, expected ${frames}.`);
    return out.map(concat);
  }

  // Decodes every frame and checks it against the image attributes. Returns raw little-endian pixel bytes.
  function decodeFrames(fragments, { rows, cols, frames, bitsAllocated }) {
    return frameStreams(fragments, frames).map((s, i) => {
      const d = decodeFrame(s);
      if (d.width !== cols || d.height !== rows || d.componentCount !== 1) throw new Error(`Frame ${i + 1} decoded as ${d.width}×${d.height}×${d.componentCount}, but the file says ${cols}×${rows} greyscale.`);
      const expected = rows * cols * (bitsAllocated / 8);
      if (d.data.length !== expected) throw new Error(`Frame ${i + 1} decoded to ${d.data.length} bytes, expected ${expected}.`);
      return d.data;
    });
  }

  return { J2K_LOSSLESS, load, canDecode, isReady: () => !!lib, decodeFrame, encodeFrameLossless, frameStreams, decodeFrames };
});
