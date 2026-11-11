'use strict';
/* An INDUSTREX-style CR file. Its layout copies real INDUSTREX 7.2.1 / HPX-PRO exports supplied by the owner
   (JPEG 2000 there; uncompressed here so the image tools work): DICONDE attributes in reused DICOM tags,
   three private creators in group 0033 (CSH_NDT, E2737, "Diconde Private Tags 0033 Group"), the CSH_NDT
   elements (version, internal data, JPEG preview, XML presentation state, flag, display processing) and an
   icon image. All values are synthetic; no real inspection data is included. */
const D = require('../dicom.js');
const { makeSample } = require('../sample.js');

const bytes = s => Uint8Array.from(Buffer.from(s, 'latin1'));
function presentationXml(ds) {
  const entry = (key, vals) => `<diconde KEY="${key}">${vals.map(v => `<value>${v}</value>`).join('')}</diconde>`;
  const tagVals = (t) => (D.getString(ds, t) ? D.getString(ds, t).split('\\') : ['']);
  return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?><presentation_state><display_state><color_table>0</color_table>' +
    '<rotation>0,0,90</rotation><viewplane_rect>-100.0,50.0,300.0,200.0</viewplane_rect><wl_range>11.0000,2915.00</wl_range><zoom>0.500000,0.500000</zoom></display_state><metadata>' +
    entry('0008,0060', ['CR']) + entry('0008,0008', ['ORIGINAL', 'PRIMARY']) + entry('0010,0010', tagVals(0x00100010)) + entry('0010,0020', tagVals(0x00100020)) +
    entry('0008,1048', ['Inspect Co']) + '<diconde KEY="0020,4000"/>' + entry('0033,XX72', ['EDGE', 'Image Class: HD 1']) +
    entry('DEFAULTWL', ['1513.00', '1488.00']) + entry('ANGLE', ['0', '0', '90']) + entry('FILENAME', ['C:\\fixture\\sample.dcm']) +
    '</metadata><graphics /></presentation_state>';
}

function makeIndustrexLike(opts = {}) {
  const f = makeSample({ rows: opts.rows || 40, cols: opts.cols || 80, sopUID: opts.sopUID, bitsStored: 12 });
  const ds = f.ds, set = (t, v, vr) => D.setText(ds, t, v, vr), raw = (tag, vr, b) => ds.el.set(tag, { tag, vr, value: b });
  set(0x00080016, '1.2.840.10008.5.1.4.1.1.1'); set(0x00080060, 'CR'); set(0x00280004, 'MONOCHROME1');
  set(0x00080070, 'Carestream Health, Inc.'); set(0x00081090, 'HPX-PRO');
  set(0x00080090, 'Pipeline Owner Ltd'); set(0x00081048, 'Inspect Co'); set(0x00081060, 'Inspector One (Level 2)');
  set(0x00180015, ''); set(0x00324000, 'Shot 3 of 4'); set(0x00181260, '3 Shot - S/M'); set(0x00141010, 'CSA Z662 SWEET');
  set(0x00181020, 'DICONDE11\\INDUSTREX 7.2.1\\HPX-PRO');
  set(0x00281040, 'LOG'); set(0x00281041, '-1', 'SS'); set(0x00280120, '0', 'US');
  raw(0x00330010, 'LO', bytes('CSH_NDT '));
  raw(0x00330011, 'LO', bytes('E2737 '));
  raw(0x00330012, 'LO', bytes('Diconde Private Tags 0033 Group '));
  raw(0x00331010, 'ST', bytes('7.2.1 '));
  raw(0x00331040, 'OB', Uint8Array.from([0x53, 0x52, 0, 6, 0x78, 0x9c]));
  raw(0x00331050, 'OB', Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xD9]));
  raw(0x00331052, 'OB', Uint8Array.from([0x79, 7, 0, 0]));
  raw(0x00331070, 'OB', new TextEncoder().encode(presentationXml(ds)));
  raw(0x00331071, 'IS', bytes('0 '));
  raw(0x00331072, 'LO', bytes('EDGE\\Image Class: HD 1'));
  raw(0x00331176, 'DS', new Uint8Array(0));
  raw(0x003312A0, 'ST', new Uint8Array(0));
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
