/* File builders: uncompressed ZIP, greyscale TIFF and a simple PDF report. No dependencies. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Exporters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s);
  function concat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }

  // files: [{ name, data: Uint8Array }]; stored without compression (DICOM pixel data rarely shrinks much).
  function zip(files, date = new Date()) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = utf8(f.name), crc = crc32(f.data), size = f.data.length;
      if (size > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('Too much data for a ZIP file; split into fewer parts.');
      const h = new Uint8Array(30), dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true); dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      const c = new Uint8Array(46), cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      parts.push(h, name, f.data); central.push(c, name);
      offset += 30 + name.length + size;
    }
    const cd = concat(central), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cd.length, true); ev.setUint32(16, offset, true);
    return concat(parts.concat([cd, end]));
  }

  // Raw pixel values, one strip, little-endian baseline TIFF.
  function tiff(img, frameIndex = 0) {
    const a = img.frames[frameIndex], bps = img.bitsAllocated, w = img.cols, h = img.rows;
    const data = new Uint8Array(a.buffer, a.byteOffset, w * h * (bps / 8));
    const entries = [[256, 4, w], [257, 4, h], [258, 3, bps], [259, 3, 1], [262, 3, img.photometric === 'MONOCHROME1' ? 0 : 1],
      [273, 4, 0], [277, 3, 1], [278, 4, h], [279, 4, data.length], [284, 3, 1], [339, 3, img.signed ? 2 : 1]];
    const ifdSize = 2 + entries.length * 12 + 4, dataOffset = 8 + ifdSize;
    entries.find(e => e[0] === 273)[2] = dataOffset;
    const head = new Uint8Array(dataOffset), dv = new DataView(head.buffer);
    head.set([0x49, 0x49, 42, 0]); dv.setUint32(4, 8, true); dv.setUint16(8, entries.length, true);
    entries.forEach(([tag, type, val], i) => {
      const p = 10 + i * 12; dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, 1, true);
      if (type === 3) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true);
    });
    return concat([head, data]);
  }

  // Letter-size PDF: page 1 = title + field list, page 2 = image (JPEG bytes from a canvas).
  function pdfReport({ title, subtitle, fields, jpeg, imageWidth, imageHeight, caption }) {
    const W = 612, H = 792, M = 48;
    const esc = s => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').replace(/([\\()])/g, '\\$1');
    const latin = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; };
    const wrap = (s, n) => { const out = []; String(s).split(/\r?\n/).forEach(line => { while (line.length > n) { let k = line.lastIndexOf(' ', n); if (k < n / 2) k = n; out.push(line.slice(0, k)); line = line.slice(k).replace(/^ /, ''); } out.push(line); }); return out; };
    const pages = []; let ops = [], y = H - M;
    const newPage = () => { if (ops.length) pages.push(ops.join('\n')); ops = []; y = H - M; };
    const text = (s, size, x, font = 'F1') => { ops.push(`BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`); };
    text(title, 16, M, 'F2'); y -= 20;
    if (subtitle) { text(subtitle, 9, M); y -= 18; }
    for (const [label, value] of fields) {
      const lines = wrap(value || '-', 70);
      if (y - lines.length * 12 < M) newPage();
      text(label, 9, M, 'F2');
      lines.forEach((l, i) => { text(l, 9, M + 170); if (i < lines.length - 1) y -= 12; });
      y -= 14;
    }
    newPage();
    let img = null;
    if (jpeg) {
      const maxW = W - 2 * M, maxH = H - 2 * M - 30, s = Math.min(maxW / imageWidth, maxH / imageHeight);
      const dw = imageWidth * s, dh = imageHeight * s, x = (W - dw) / 2, top = H - M - 10;
      y = top - dh - 18;
      pages.push(`q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${(top - dh).toFixed(2)} cm /Im1 Do Q\n` + (caption ? `BT /F1 9 Tf ${M} ${y.toFixed(2)} Td (${esc(caption)}) Tj ET` : ''));
      img = jpeg;
    }
    // objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 image (optional), then page/content pairs
    const objs = [];
    const first = img ? 6 : 5;
    const kids = pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
    objs[1] = latin('<< /Type /Catalog /Pages 2 0 R >>');
    objs[2] = latin(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
    objs[3] = latin('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs[4] = latin('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    if (img) objs[5] = concat([latin(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`), img, latin('\nendstream')]);
    pages.forEach((content, i) => {
      const p = first + i * 2, c = latin(content);
      objs[p] = latin(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${img ? ' /XObject << /Im1 5 0 R >>' : ''} >> /Contents ${p + 1} 0 R >>`);
      objs[p + 1] = concat([latin(`<< /Length ${c.length} >>\nstream\n`), c, latin('\nendstream')]);
    });
    const parts = [latin('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')], offsets = [];
    let pos = parts[0].length;
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = pos;
      const chunk = concat([latin(`${i} 0 obj\n`), objs[i], latin('\nendobj\n')]);
      parts.push(chunk); pos += chunk.length;
    }
    let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    xref += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(latin(xref));
    return concat(parts);
  }

  return { crc32, zip, tiff, pdfReport };
});
