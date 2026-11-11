/* INDUSTREX compatibility check for a saved copy, compared with the file it came from.
   Rules come from Carestream's INDUSTREX DICOM/DICONDE Conformance Statement (rev. 10.0, 2017) and from what
   real INDUSTREX 7.2.1 exports contain. Passing these checks is strong evidence, not proof: only opening the
   copy in INDUSTREX itself confirms it. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dicom.js'), require('./codec.js'));
  else root.Compat = factory(root.Dicom, root.Codec);
})(typeof self !== 'undefined' ? self : this, function (D, C) {
  // Transfer syntaxes INDUSTREX reads (Conformance Statement 3.1.2).
  const READABLE_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2', '1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51',
    '1.2.840.10008.1.2.4.70', '1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91']);
  // SOP classes INDUSTREX processes (3.1.1).
  const SOP = { '1.2.840.10008.5.1.4.1.1.1': 'CR Image Storage', '1.2.840.10008.5.1.4.1.1.1.1': 'DX Image Storage (for presentation)', '1.2.840.10008.5.1.4.1.1.1.1.1': 'DX Image Storage (for processing)' };
  // Hex of a value without its padding byte, for comparing elements (works in browsers and Node).
  const hexv = v => { let h = ''; for (let i = 0; i < (v ? v.length : 0); i++) h += (v[i] < 16 ? '0' : '') + v[i].toString(16); return h.replace(/(00|20)$/, ''); };
  const PIXEL_TAGS = [0x00280010, 0x00280011, 0x00280008, 0x00280106, 0x00280107, 0x7FE00010];

  // bytes: the saved file exactly as written. src: the parsed source file (optional). opts.removed: tags the
  // editor deliberately left out; opts.edited: tags the user changed; opts.pixelsChanged.
  async function check(bytes, src, opts = {}) {
    const out = [], add = (level, title, detail) => out.push({ level, title, detail: detail || '' });
    let f;
    try { f = await D.parse(bytes); } catch (e) { add('fail', 'File can be read as DICOM', e.message); return out; }
    const ds = f.ds, s = t => D.getString(ds, t), n = t => D.getNumber(ds, t);
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    // File structure
    const dicm = b.length > 132 && String.fromCharCode(b[128], b[129], b[130], b[131]) === 'DICM';
    add(dicm ? 'pass' : 'fail', 'DICOM Part 10 file with preamble and "DICM"');
    const gl = D.getNumber(f.meta, 0x00020000);
    { const end = 132 + 12 + (gl || 0); add(gl && end + 2 <= b.length && new DataView(b.buffer, b.byteOffset + end, 2).getUint16(0, true) !== 0x0002 ? 'pass' : 'fail', 'File meta group length is correct', `${gl} bytes`); }
    add(READABLE_TS.has(f.transferSyntax) ? 'pass' : 'fail', 'Transfer syntax is one INDUSTREX reads', D.TS_NAMES[f.transferSyntax] || f.transferSyntax);
    const sop = s(0x00080016);
    add(SOP[sop] ? 'pass' : 'fail', 'SOP class is one INDUSTREX processes', SOP[sop] || sop || 'missing');
    add(D.getString(f.meta, 0x00020002) === sop ? 'pass' : 'fail', 'File meta SOP class matches the data set');
    const uid = s(0x00080018);
    add(uid && D.validate('UI', uid) === '' && D.getString(f.meta, 0x00020003) === uid ? 'pass' : 'fail', 'SOP Instance UID is valid and matches the file meta', uid);
    if (src) add(uid !== D.getString(src.ds, 0x00080018) ? 'pass' : 'fail', 'Copy has its own SOP Instance UID (INDUSTREX does the same on save)');
    if (src && src.ds.el.has(0x00200013)) add(s(0x00200013) ? 'pass' : 'warn', 'Instance Number present');

    // Image pixel module
    const rows = n(0x00280010), cols = n(0x00280011), ba = n(0x00280100), bs = n(0x00280101), hb = n(0x00280102), pr = n(0x00280103), spp = n(0x00280002) || 1;
    const photo = s(0x00280004), frames = Math.max(1, n(0x00280008) || 1);
    add(rows > 0 && cols > 0 && [8, 16].includes(ba) && bs > 0 && bs <= ba && hb === bs - 1 && (pr === 0 || pr === 1) && spp === 1 && /^MONOCHROME[12]$/.test(photo) ? 'pass' : 'fail',
      'Image pixel attributes are consistent', `${cols}×${rows}, ${bs}/${ba} bits, high bit ${hb}, ${photo}`);
    if (src) {
      const same = [0x00280100, 0x00280101, 0x00280102, 0x00280103, 0x00280004, 0x00280002].every(t => D.getString(src.ds, t) === s(t));
      add(same ? 'pass' : 'fail', 'Bit depth, sign and photometric interpretation unchanged from the original');
    }

    // Pixel data
    const px = ds.el.get(D.PIXEL);
    let pixels = null;
    if (!px) add('fail', 'Pixel data present');
    else if (px.fragments) {
      add(px.fragments.length >= 2 ? 'pass' : 'fail', 'Compressed pixel data has an offset table item and at least one fragment');
      add(px.fragments[0].length === 4 * frames || px.fragments[0].length === 0 ? 'pass' : 'fail', 'Basic Offset Table is valid', `${px.fragments[0].length} bytes`);
      if (C && C.canDecode(f.transferSyntax)) {
        const streams = C.frameStreams(px.fragments, frames), info = C.codestreamInfo(streams[0]) || {};
        add(info.width === cols && info.height === rows && info.components === 1 ? 'pass' : 'fail', 'JPEG 2000 header matches Rows/Columns, one component', `${info.width}×${info.height}`);
        if (f.transferSyntax === C.J2K_LOSSLESS) add(info.reversible ? 'pass' : 'fail', 'Lossless syntax uses the reversible 5/3 wavelet');
        add(info.precision >= bs && info.precision <= ba ? 'pass' : 'fail', 'JPEG 2000 precision fits Bits Stored and Bits Allocated', `precision ${info.precision}, stored ${bs}`);
        if (src && src.encapsulated && C.canDecode(src.transferSyntax)) {
          const si = C.codestreamInfo(C.frameStreams(src.ds.el.get(D.PIXEL).fragments, 1)[0]) || {};
          const diffs = [];
          if (si.precision !== info.precision) diffs.push(`precision ${info.precision} (original ${si.precision})`);
          if (si.progression !== info.progression) diffs.push(`progression ${info.progression} (original ${si.progression})`);
          if (si.reversible !== info.reversible) diffs.push('wavelet differs');
          const tiling = si.tileWidth !== info.tileWidth || si.tileHeight !== info.tileHeight;
          add(diffs.length ? 'warn' : 'pass', 'JPEG 2000 encoded like the original', diffs.join(', ') || `${info.progression}, ${info.precision}-bit, reversible`);
          if (tiling) add('info', 'JPEG 2000 tiling differs from the original', `copy ${info.tileWidth}×${info.tileHeight}, original ${si.tileWidth}×${si.tileHeight}; both are baseline JPEG 2000`);
        }
        try {
          if (C.isReady()) {
            const img = D.imageFromFrames(f, C.decodeFrames(px.fragments, D.imageGeometry(f)));
            pixels = img; add(img.error ? 'fail' : 'pass', 'JPEG 2000 data decodes to the stated image size', img.error || `${frames} frame(s)`);
          } else add('info', 'JPEG 2000 data not decoded (codec not loaded)');
        } catch (e) { add('fail', 'JPEG 2000 data decodes', e.message); }
      }
    } else {
      const need = rows * cols * (ba / 8) * frames;
      add(px.value.length >= need && px.value.length <= need + 1 ? 'pass' : 'fail', 'Uncompressed pixel data length matches the image size', `${px.value.length} bytes, expected ${need}`);
      const img = D.getImage(f); if (!img.error) pixels = img;
    }
    if (pixels && pixels.frames) {
      let lo = Infinity, hi = -Infinity;
      pixels.frames.forEach(a => { for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; } });
      add(lo >= pixels.min && hi <= pixels.max ? 'pass' : 'fail', 'Pixel values fit in Bits Stored', `${lo}–${hi}`);
      if (ds.el.has(0x00280106) && ds.el.has(0x00280107)) add(n(0x00280106) === lo && n(0x00280107) === hi ? 'pass' : 'fail', 'Smallest/Largest Image Pixel Value match the pixels', `${n(0x00280106)}–${n(0x00280107)}`);
    }

    // Metadata compared with the original
    if (src) {
      const removed = new Set((opts.removed || []).map(t => t >>> 0)), edited = new Set((opts.edited || []).map(t => t >>> 0));
      const derivedTags = new Set([0x00080018, 0x00080012, 0x00080013, 0x00080008, 0x00082111, 0x00082112, 0x0020000E, 0x00200013, 0x00281050, 0x00281051, ...PIXEL_TAGS]);
      const missing = [], vrChanged = [], changed = [];
      for (const [t, e] of src.ds.el) {
        const o = ds.el.get(t);
        if (!o) { if (!removed.has(t) && !edited.has(t)) missing.push(D.tagHex(t)); continue; }
        // Pixel data is OB when compressed and OW when uncompressed 16-bit, so its VR follows the transfer syntax.
        if (o.vr !== e.vr && e.vr !== 'UN' && t !== D.PIXEL) vrChanged.push(`${D.tagHex(t)} ${e.vr}→${o.vr}`);
        if (!edited.has(t) && !derivedTags.has(t) && !(f.ds.el.get(t).items) && !e.items) {
          const a = e.fragments ? null : hexv(e.value), z = o.fragments ? null : hexv(o.value);
          if (a !== z && t !== (opts.xmlTag >>> 0)) changed.push(D.tagHex(t));
        }
      }
      add(missing.length ? 'fail' : 'pass', 'Every original element is kept (except ones deliberately left out)', missing.length ? 'missing: ' + missing.slice(0, 8).join(', ') : `${src.ds.el.size - removed.size} of ${src.ds.el.size} kept${removed.size ? `, ${removed.size} left out on purpose` : ''}`);
      add(vrChanged.length ? 'fail' : 'pass', 'Value representations unchanged', vrChanged.slice(0, 6).join(', '));
      add(changed.length ? 'fail' : 'pass', 'Only edited and derived fields changed', changed.slice(0, 8).join(', '));
      const pc = D.industrexInfo(src.ds), oc = D.industrexInfo(ds);
      if (pc) add(oc && oc.block === pc.block && oc.creator === pc.creator && oc.version === pc.version ? 'pass' : 'fail', 'INDUSTREX private block kept at the same place', oc ? `${oc.creator} ${oc.version}` : 'missing');
      const changedPixels = !!opts.pixelsChanged;
      if (changedPixels) add(/^DERIVED\\SECONDARY/.test(s(0x00080008)) ? 'pass' : 'fail', 'Processed image marked DERIVED\\SECONDARY (as INDUSTREX does)');
      else add(s(0x00080008) === D.getString(src.ds, 0x00080008) ? 'pass' : 'fail', 'Image Type unchanged for a metadata-only copy');
    }

    // Values and text
    const bad = [];
    for (const [t, e] of ds.el) {
      if (!e.value || e.items || e.fragments || (t >>> 16) & 1 || !D.editable(e.vr)) continue;
      const err = D.validate(e.vr, D.valueToText(e, D.charsetIsUtf8(ds)));
      if (err) bad.push(`${D.tagHex(t)}: ${err}`);
    }
    add(bad.length ? 'warn' : 'pass', 'Text and number values are valid for their VR', bad.slice(0, 5).join('; '));
    const x = D.industrexXmlValues(ds, 0x00080060) !== null;
    if (x) {
      const ix = D.industrexInfo(ds), text = new TextDecoder().decode(ds.el.get(ix.xmlTag).value).replace(/[\0 ]+$/, '');
      const open = (text.match(/<(non_)?diconde /g) || []).length, close = (text.match(/<\/(non_)?diconde>|<(non_)?diconde [^>]*\/>/g) || []).length;
      add(/^<\?xml/.test(text) && /<\/presentation_state>$/.test(text) && open === close ? 'pass' : 'fail', 'INDUSTREX XML presentation state is intact');
      const stale = (opts.edited || []).filter(t => { const v = D.industrexXmlValues(ds, t); if (v === null) return false; const cur = ds.el.get(t >>> 0); const want = cur && cur.value ? D.valueToText(cur, D.charsetIsUtf8(ds)) : ''; return v.join('\\') !== want; });
      add(stale.length ? 'fail' : 'pass', "INDUSTREX's XML copy agrees with edited fields", stale.map(D.tagHex).join(', '));
    } else if (src && D.industrexXmlValues(src.ds, 0x00080060) !== null) add('info', 'INDUSTREX XML presentation state left out (pixels changed); INDUSTREX will use its default view');
    return out;
  }
  const summary = r => ({ fail: r.filter(c => c.level === 'fail').length, warn: r.filter(c => c.level === 'warn').length, pass: r.filter(c => c.level === 'pass').length });
  return { READABLE_TS, SOP, check, summary };
});
