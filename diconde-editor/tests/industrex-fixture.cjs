'use strict';
/* An INDUSTREX-style CR file built from Carestream's INDUSTREX DICOM/DICONDE Conformance Statement
   (rev. 10.0, 2017): CR SOP class, DICONDE attributes in the reused DICOM tags, the private block in
   group 0033 and an icon image. The private creator string is not published; 'CSH_TEST' is a stand-in.
   This is not a real INDUSTREX export. */
const D = require('../dicom.js');
const { makeSample } = require('../sample.js');

function makeIndustrexLike(opts = {}) {
  const f = makeSample({ rows: opts.rows || 40, cols: opts.cols || 80, sopUID: opts.sopUID });
  const ds = f.ds, set = (t, v, vr) => D.setText(ds, t, v, vr), raw = (tag, vr, bytes) => ds.el.set(tag, { tag, vr, value: Uint8Array.from(bytes) });
  set(0x00080016, '1.2.840.10008.5.1.4.1.1.1'); set(0x00080060, 'CR');
  set(0x00080090, 'Pipeline Owner Ltd'); set(0x00081048, 'Inspect Co'); set(0x00081050, 'Inspector^One');
  set(0x00180015, 'GIRTH WELD'); set(0x00324000, 'Shot 3 of 4'); set(0x00181260, 'FLEX HR');
  set(0x00281040, 'LIN'); set(0x00281041, '1', 'SS');
  raw(0x00330010, 'LO', [...'CSH_TEST'].map(c => c.charCodeAt(0)));
  raw(0x00331010, 'DS', [...'5.2 '].map(c => c.charCodeAt(0)));
  raw(0x00331040, 'OB', [1, 2, 3, 4]);
  raw(0x00331071, 'OB', [9, 9, 9, 9]);
  raw(0x00331072, 'OB', [7, 7]);
  const icon = D.newDataset();
  D.setText(icon, 0x00280010, '2', 'US'); D.setText(icon, 0x00280011, '2', 'US');
  icon.el.set(D.PIXEL, { tag: D.PIXEL, vr: 'OB', value: new Uint8Array([0, 1, 2, 3]) });
  ds.el.set(0x00880200, { tag: 0x00880200, vr: 'SQ', items: [icon] });
  return f;
}

// Implicit VR little endian encoding of the top-level elements (no sequences), as some systems write.
function implicitBytes(file) {
  const parts = [];
  const out = Buffer.from(D.write(Object.assign({}, file, { ds: { el: new Map([...file.ds.el].filter(([, e]) => !e.items)) } })));
  const metaEnd = 132 + 12 + out.readUInt32LE(140);
  const ds = out.subarray(metaEnd);
  let p = 0;
  while (p < ds.length) {
    const g = ds.readUInt16LE(p), e = ds.readUInt16LE(p + 2), vr = ds.toString('latin1', p + 4, p + 6);
    const long = ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV'].includes(vr);
    const len = long ? ds.readUInt32LE(p + 8) : ds.readUInt16LE(p + 6), hl = long ? 12 : 8;
    const h = Buffer.alloc(8); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.writeUInt32LE(len, 4);
    parts.push(h, ds.subarray(p + hl, p + hl + len)); p += hl + len;
  }
  const ts = Buffer.from('1.2.840.10008.1.2\0');
  const tsEl = Buffer.alloc(8); tsEl.writeUInt16LE(2, 0); tsEl.writeUInt16LE(0x10, 2); tsEl.write('UI', 4); tsEl.writeUInt16LE(ts.length, 6);
  const gl = Buffer.alloc(12); gl.writeUInt16LE(2, 0); gl.writeUInt16LE(0, 2); gl.write('UL', 4); gl.writeUInt16LE(4, 6); gl.writeUInt32LE(tsEl.length + ts.length, 8);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), gl, tsEl, ts, ...parts]);
}

module.exports = { makeIndustrexLike, implicitBytes };
