'use strict';
// Parser/writer, metadata editing, derived copies, image operations and exporters.
const assert = require('assert');
const zlib = require('zlib');
const D = require('../dicom.js');
const I = require('../imaging.js');
const X = require('../export.js');
const { makeSample } = require('../tools/make-sample.cjs');
const { makeIndustrexLike, implicitBytes } = require('./industrex-fixture.cjs');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Hand-built encodings so the parser is checked against bytes it did not write itself.
function el(tag, vr, value, { explicit = true, le = true } = {}) {
  const v = typeof value === 'string' ? Buffer.from(value.length % 2 ? value + ' ' : value, 'latin1') : Buffer.from(value);
  const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
  const h = Buffer.alloc(explicit ? (long ? 12 : 8) : 8);
  const u16 = (x, p) => (le ? h.writeUInt16LE(x, p) : h.writeUInt16BE(x, p));
  const u32 = (x, p) => (le ? h.writeUInt32LE(x, p) : h.writeUInt32BE(x, p));
  u16(tag >>> 16, 0); u16(tag & 0xFFFF, 2);
  if (!explicit) u32(v.length, 4);
  else { h.write(vr, 4, 'latin1'); if (long) u32(v.length, 8); else u16(v.length, 6); }
  return Buffer.concat([h, v]);
}
function metaFor(ts) {
  const body = Buffer.concat([el(0x00020001, 'OB', [0, 1]), el(0x00020002, 'UI', '1.2.840.10008.5.1.4.1.1.7\0'), el(0x00020003, 'UI', '1.2.3.4\0'), el(0x00020010, 'UI', ts.length % 2 ? ts + '\0' : ts)]);
  const gl = Buffer.alloc(4); gl.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), el(0x00020000, 'UL', gl), body]);
}
const us = (n, le = true) => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(n) : b.writeUInt16BE(n); return b; };

test('reads implicit VR little endian with dictionary VRs', async () => {
  const opt = { explicit: false };
  const px = Buffer.alloc(8); [1, 2, 3, 4].forEach((v, i) => px.writeUInt16LE(v * 1000, i * 2));
  const buf = Buffer.concat([metaFor(D.TS.IMPLICIT_LE), el(0x00100010, '', 'Pipe^A', opt), el(0x00280010, '', us(2), opt), el(0x00280011, '', us(2), opt),
    el(0x00280100, '', us(16), opt), el(0x00280101, '', us(16), opt), el(0x00280103, '', us(0), opt), el(0x7FE00010, '', px, opt)]);
  const f = await D.parse(buf);
  assert.strictEqual(f.transferSyntax, D.TS.IMPLICIT_LE);
  assert.strictEqual(D.getString(f.ds, 0x00100010), 'Pipe^A');
  assert.strictEqual(D.getElement(f.ds, 0x00280010).vr, 'US');
  const img = D.getImage(f);
  assert.deepStrictEqual([...img.frames[0]], [1000, 2000, 3000, 4000]);
  const again = await D.parse(D.write(f));
  assert.strictEqual(again.transferSyntax, D.TS.EXPLICIT_LE);
  assert.deepStrictEqual([...D.getImage(again).frames[0]], [1000, 2000, 3000, 4000]);
});

test('reads explicit VR big endian and converts numbers and pixels', async () => {
  const be = { le: false };
  const px = Buffer.alloc(4); px.writeUInt16BE(0x1234, 0); px.writeUInt16BE(0xABCD, 2);
  const buf = Buffer.concat([metaFor(D.TS.EXPLICIT_BE), el(0x00280010, 'US', us(1, false), be), el(0x00280011, 'US', us(2, false), be),
    el(0x00280100, 'US', us(16, false), be), el(0x7FE00010, 'OW', px, be)]);
  const f = await D.parse(buf);
  assert.strictEqual(D.getNumber(f.ds, 0x00280011), 2);
  assert.deepStrictEqual([...D.getImage(f).frames[0]], [0x1234, 0xABCD]);
});

test('reads deflated explicit VR little endian', async () => {
  const body = Buffer.concat([el(0x00100010, 'PN', 'Deflated^Part'), el(0x00100020, 'LO', 'ID-9')]);
  const f = await D.parse(Buffer.concat([metaFor(D.TS.DEFLATED), zlib.deflateRawSync(body)]));
  assert.strictEqual(D.getString(f.ds, 0x00100020), 'ID-9');
  const out = await D.parse(D.write(f));
  assert.strictEqual(out.transferSyntax, D.TS.EXPLICIT_LE);
  assert.strictEqual(D.getString(out.ds, 0x00100010), 'Deflated^Part');
});

test('parses undefined-length sequences and keeps compressed image fragments byte for byte', async () => {
  const item = Buffer.concat([el(0x00081155, 'UI', '1.2.3\0')]);
  const seqHead = Buffer.alloc(12); seqHead.writeUInt16LE(0x0008, 0); seqHead.writeUInt16LE(0x2112, 2); seqHead.write('SQ', 4); seqHead.writeUInt32LE(0xFFFFFFFF, 8);
  const tagLen = (t, l) => { const b = Buffer.alloc(8); b.writeUInt16LE(t >>> 16, 0); b.writeUInt16LE(t & 0xFFFF, 2); b.writeUInt32LE(l, 4); return b; };
  const seq = Buffer.concat([seqHead, tagLen(0xFFFEE000, 0xFFFFFFFF), item, tagLen(0xFFFEE00D, 0), tagLen(0xFFFEE0DD, 0)]);
  const pxHead = Buffer.alloc(12); pxHead.writeUInt16LE(0x7FE0, 0); pxHead.writeUInt16LE(0x0010, 2); pxHead.write('OB', 4); pxHead.writeUInt32LE(0xFFFFFFFF, 8);
  const frag = Buffer.from([0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9, 0]);
  const px = Buffer.concat([pxHead, tagLen(0xFFFEE000, 0), tagLen(0xFFFEE000, frag.length), frag, tagLen(0xFFFEE0DD, 0)]);
  const ts = '1.2.840.10008.1.2.4.90';
  const f = await D.parse(Buffer.concat([metaFor(ts), seq, el(0x00100010, 'PN', 'Comp'), px]));
  assert.strictEqual(f.ds.el.get(0x00082112).items.length, 1);
  assert.strictEqual(D.getString(f.ds.el.get(0x00082112).items[0], 0x00081155), '1.2.3');
  assert.ok(D.getImage(f).compressed);
  D.setText(f.ds, 0x00100010, 'Edited');
  const out = await D.parse(D.write(f));
  assert.strictEqual(out.transferSyntax, ts, 'compressed files keep their transfer syntax');
  assert.deepStrictEqual([...out.ds.el.get(D.PIXEL).fragments[1]], [...frag]);
  assert.strictEqual(D.getString(out.ds, 0x00100010), 'Edited');
});

test('rejects non-DICOM data clearly', async () => {
  await assert.rejects(D.parse(Buffer.from('hello, this is not dicom at all')), D.DicomError);
});

test('writer round-trips the sample without changing any element', async () => {
  const f = makeSample();
  const a = await D.parse(D.write(f));
  const b = await D.parse(D.write(a));
  assert.strictEqual(Buffer.compare(Buffer.from(D.write(a)), Buffer.from(D.write(b))), 0);
  for (const [t, e] of f.ds.el) assert.strictEqual(D.valueToText(a.ds.el.get(t)), D.valueToText(e), D.tagHex(t));
  assert.deepStrictEqual([...a.ds.el.get(D.PIXEL).value], [...f.ds.el.get(D.PIXEL).value]);
  assert.strictEqual(D.getString(a.meta, 0x00020003), D.getString(a.ds, 0x00080018));
});

test('validation explains bad values', () => {
  assert.match(D.validate('DA', '2026-11-11'), /YYYYMMDD/);
  assert.match(D.validate('DA', '20260230'), /YYYYMMDD/);
  assert.strictEqual(D.validate('DA', '20261111'), '');
  assert.match(D.validate('SH', 'x'.repeat(17)), /16 characters/);
  assert.match(D.validate('US', '70000'), /outside/);
  assert.match(D.validate('DS', 'abc'), /decimal/);
  assert.match(D.validate('UI', '1.02.3'), /UID/);
  assert.strictEqual(D.validate('LT', 'line one\nline two \\ ok'), '');
  assert.match(D.validate('LO', 'a\nb'), /Line breaks/);
  assert.throws(() => D.setText(makeSample().ds, 0x00100020, 'Ω'), /character set/);
});

test('editing, adding and removing tags', async () => {
  const f = makeSample();
  D.setText(f.ds, 0x00100020, 'WELD-0043');
  D.setText(f.ds, 0x00140042, 'API 5L X52');
  D.setText(f.ds, 0x00080008, 'derived\\secondary'); // CS is upper-cased
  D.remove(f.ds, 0x00204000);
  D.setText(f.ds, 0x00280030, '0.1\\0.12');
  const out = await D.parse(D.write(f));
  assert.strictEqual(D.getString(out.ds, 0x00100020), 'WELD-0043');
  assert.strictEqual(D.getString(out.ds, 0x00140042), 'API 5L X52');
  assert.strictEqual(D.getString(out.ds, 0x00080008), 'DERIVED\\SECONDARY');
  assert.strictEqual(D.getElement(out.ds, 0x00204000), null);
  assert.strictEqual(D.getNumber(out.ds, 0x00280030, 1), 0.12);
  assert.strictEqual(D.tagInfo(0x00100020).name, 'Component ID Number');
  assert.strictEqual(D.tagInfo(0x00100020).dicomName, 'Patient ID');
  assert.strictEqual(D.parseTag('(0010,0020)'), 0x00100020);
  assert.strictEqual(D.parseTag('PatientID'), 0x00100020);
});

test('UTF-8 files accept any characters', async () => {
  const f = makeSample();
  D.setText(f.ds, 0x00080005, 'ISO_IR 192');
  D.setText(f.ds, 0x00104000, 'Soudure n° 3 – Ω');
  const out = await D.parse(D.write(f));
  assert.strictEqual(D.getString(out.ds, 0x00104000), 'Soudure n° 3 – Ω');
});

test('derived copy gets new UID, DERIVED type, description and source reference; source untouched', async () => {
  const src = makeSample({ sopUID: '1.2.3.999' });
  const copy = D.clone(src);
  const series = D.newUID();
  D.derive(copy, src, { pixelsChanged: true, description: 'Rotated 90° clockwise', seriesUID: series });
  const out = await D.parse(D.write(copy));
  assert.notStrictEqual(D.getString(out.ds, 0x00080018), '1.2.3.999');
  assert.match(D.getString(out.ds, 0x00080018), /^2\.25\.\d+$/);
  assert.ok(D.getString(out.ds, 0x00080018).length <= 64);
  assert.strictEqual(D.getString(out.meta, 0x00020003), D.getString(out.ds, 0x00080018));
  assert.strictEqual(D.getString(out.ds, 0x00080008), 'DERIVED\\SECONDARY');
  assert.strictEqual(D.getString(out.ds, 0x0020000E), series);
  assert.match(D.getString(out.ds, 0x00082111), /Rotated 90/);
  const ref = out.ds.el.get(0x00082112).items[0];
  assert.strictEqual(D.getString(ref, 0x00081155), '1.2.3.999');
  assert.strictEqual(D.getString(ref, 0x00081150), '1.2.840.10008.5.1.4.1.1.1.1');
  assert.strictEqual(D.getString(src.ds, 0x00080018), '1.2.3.999');
  assert.strictEqual(D.getString(src.ds, 0x00080008), 'ORIGINAL\\PRIMARY');
});

test('metadata-only copy keeps image type and series', () => {
  const src = makeSample();
  const copy = D.derive(D.clone(src), src, {});
  assert.strictEqual(D.getString(copy.ds, 0x00080008), 'ORIGINAL\\PRIMARY');
  assert.strictEqual(D.getString(copy.ds, 0x0020000E), D.getString(src.ds, 0x0020000E));
  assert.notStrictEqual(D.getString(copy.ds, 0x00080018), D.getString(src.ds, 0x00080018));
});

test('INDUSTREX private block and DICONDE names are recognised', () => {
  const f = makeIndustrexLike();
  const ix = D.industrexInfo(f.ds);
  assert.deepStrictEqual([ix.creator, ix.version, ix.staleTags], ['CSH_TEST', '5.2', [0x00331040, 0x00331071, 0x00331072]]);
  assert.strictEqual(D.describeTag(f.ds, 0x00331071).name, 'INDUSTREX presentation image');
  assert.strictEqual(D.describeTag(f.ds, 0x00330010).name, 'Private creator');
  assert.strictEqual(D.tagInfo(0x00081048).name, 'Inspecting Company Name');
  assert.strictEqual(D.tagInfo(0x00081048).dicomName, 'Physicians Of Record');
  assert.strictEqual(D.tagInfo(0x00100030).name, 'Component Manufacturing Date');
  assert.strictEqual(D.tagInfo(0x00180015).name, 'Part Examined');
});

test('another vendor block in group 0033 is left alone', () => {
  const f = makeSample();
  f.ds.el.set(0x00330010, { tag: 0x00330010, vr: 'LO', value: Uint8Array.from(Buffer.from('OTHER VENDOR')) });
  f.ds.el.set(0x00331040, { tag: 0x00331040, vr: 'OB', value: new Uint8Array(2) });
  assert.strictEqual(D.industrexInfo(f.ds), null);
  assert.strictEqual(D.describeTag(f.ds, 0x00331040).name, 'Private data (OTHER VENDOR)');
  const copy = D.derive(D.clone(f), f, { pixelsChanged: true, description: 'x' });
  assert.ok(copy.ds.el.has(0x00331040));
});

test('metadata-only copy of an INDUSTREX file keeps private data and icon byte for byte', async () => {
  const src = makeIndustrexLike();
  const copy = D.clone(src);
  D.setText(copy.ds, 0x00100020, 'NEW-ID');
  const out = await D.parse(D.write(D.derive(copy, src, {})));
  for (const t of [0x00330010, 0x00331010, 0x00331040, 0x00331071, 0x00331072]) assert.deepStrictEqual([...out.ds.el.get(t).value], [...src.ds.el.get(t).value].concat(src.ds.el.get(t).value.length % 2 ? [src.ds.el.get(t).vr === 'OB' ? 0 : 0x20] : []), D.tagHex(t));
  assert.strictEqual(out.ds.el.get(0x00880200).items.length, 1);
  assert.strictEqual(D.getString(out.ds, 0x00080016), '1.2.840.10008.5.1.4.1.1.1', 'CR SOP class kept');
});

test('processed copy drops stale INDUSTREX presentation data and icon, keeps version', async () => {
  const src = makeIndustrexLike();
  const copy = D.clone(src), removed = [];
  D.setImage(copy, I.rotate(D.getImage(copy), 1), { swapSpacing: true });
  D.derive(copy, src, { pixelsChanged: true, description: 'Rotated', removed });
  assert.deepStrictEqual(removed, [0x00880200, 0x00331040, 0x00331071, 0x00331072]);
  const out = await D.parse(D.write(copy));
  for (const t of removed) assert.strictEqual(D.getElement(out.ds, t), null, D.tagHex(t));
  assert.ok(out.ds.el.has(0x00330010) && out.ds.el.has(0x00331010));
  assert.strictEqual(D.getString(out.ds, 0x00080008), 'DERIVED\\SECONDARY', 'matches what INDUSTREX itself writes after a pixel change');
  assert.strictEqual(D.getString(out.ds, 0x00080016), '1.2.840.10008.5.1.4.1.1.1');
  assert.strictEqual(D.getString(out.ds, 0x00281040), 'LIN');
});

test('implicit VR INDUSTREX-style file: private elements read as UN and survive', async () => {
  const src = makeIndustrexLike();
  const f = await D.parse(implicitBytes(src));
  assert.strictEqual(f.transferSyntax, D.TS.IMPLICIT_LE);
  assert.strictEqual(f.ds.el.get(0x00331071).vr, 'UN');
  assert.strictEqual(D.industrexInfo(f.ds).version, '5.2');
  assert.strictEqual(D.getString(f.ds, 0x00081048), 'Inspect Co');
  const out = await D.parse(D.write(f));
  assert.strictEqual(out.transferSyntax, D.TS.EXPLICIT_LE);
  assert.deepStrictEqual([...out.ds.el.get(0x00331071).value], [9, 9, 9, 9]);
  assert.deepStrictEqual([...D.getImage(out).frames[0]], [...D.getImage(src).frames[0]]);
});

test('character sets: editor text is folded, user text is checked', async () => {
  assert.strictEqual(D.foldText('Flipped left–right, 90° 3×4', false), 'Flipped left-right, 90° 3×4');
  assert.strictEqual(D.foldText('Flipped left–right, 90° 3×4', 'ascii'), 'Flipped left-right, 90 deg 3x4');
  assert.strictEqual(D.foldText('Ω–', true), 'Ω–');
  const latin = makeSample();
  const a = D.derive(D.clone(latin), latin, { pixelsChanged: true, description: 'Flipped left–right; Rotated 90°' });
  assert.strictEqual(D.getString((await D.parse(D.write(a))).ds, 0x00082111), 'Flipped left-right; Rotated 90°');
  const plain = makeSample(); D.remove(plain.ds, 0x00080005);
  assert.strictEqual(D.charsetMode(plain.ds), 'ascii');
  const b = D.derive(D.clone(plain), plain, { pixelsChanged: true, description: 'Cropped to 5×6; Rotated 90°' });
  assert.strictEqual(D.getString(b.ds, 0x00082111), 'Cropped to 5x6; Rotated 90 deg');
  assert.throws(() => D.setText(plain.ds, 0x00104000, 'Weld n° 3'), /ISO_IR 100/);
  D.setText(plain.ds, 0x00080005, 'ISO_IR 100');
  D.setText(plain.ds, 0x00104000, 'Weld n° 3');
  assert.strictEqual(D.getString(plain.ds, 0x00104000), 'Weld n° 3');
});

const tiny = (vals, rows, cols, extra = {}) => Object.assign({ rows, cols, frames: [Uint16Array.from(vals)], min: 0, max: 65535, bitsAllocated: 16, bitsStored: 16, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0 }, extra);

test('rotation, flips and crop move pixels correctly', () => {
  const img = tiny([1, 2, 3, 4, 5, 6], 2, 3); // 1 2 3 / 4 5 6
  const cw = I.rotate(img, 1);
  assert.deepStrictEqual([cw.rows, cw.cols, ...cw.frames[0]], [3, 2, 4, 1, 5, 2, 6, 3]);
  const ccw = I.rotate(img, -1);
  assert.deepStrictEqual([...ccw.frames[0]], [3, 6, 2, 5, 1, 4]);
  assert.deepStrictEqual([...I.rotate(img, 2).frames[0]], [6, 5, 4, 3, 2, 1]);
  assert.deepStrictEqual([...I.flip(img, true).frames[0]], [3, 2, 1, 6, 5, 4]);
  assert.deepStrictEqual([...I.flip(img, false).frames[0]], [4, 5, 6, 1, 2, 3]);
  const c = I.crop(img, { x: 1, y: 0, w: 2, h: 2 });
  assert.deepStrictEqual([c.rows, c.cols, ...c.frames[0]], [2, 2, 2, 3, 5, 6]);
  assert.throws(() => I.crop(img, { x: 5, y: 5, w: 2, h: 2 }), /outside/);
  assert.deepStrictEqual([...img.frames[0]], [1, 2, 3, 4, 5, 6], 'input untouched');
});

test('invert uses the stored bit range', () => {
  const img = tiny([0, 100, 4095], 1, 3, { max: 4095, bitsStored: 12 });
  assert.deepStrictEqual([...I.invert(img).frames[0]], [4095, 3995, 0]);
});

test('median network matches sorting', () => {
  let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) % 1000);
  const vals = Array.from({ length: 25 }, r), img = tiny(vals, 5, 5);
  const m = I.median(img).frames[0];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const n = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n.push(vals[Math.min(4, Math.max(0, y + dy)) * 5 + Math.min(4, Math.max(0, x + dx))]);
    n.sort((a, b) => a - b);
    assert.strictEqual(m[y * 5 + x], n[4]);
  }
});

test('bad pixel fix replaces only outliers', () => {
  const vals = new Array(49).fill(1000); vals[24] = 65535; vals[10] = 1010;
  const out = I.fixBadPixels(tiny(vals, 7, 7), 500);
  assert.strictEqual(out.fixedCount, 1);
  assert.strictEqual(out.frames[0][24], 1000);
  assert.strictEqual(out.frames[0][10], 1010);
});

test('smooth and sharpen stay in range and behave', () => {
  const vals = []; for (let i = 0; i < 100; i++) vals.push(i % 10 < 5 ? 100 : 65000);
  const img = tiny(vals, 10, 10);
  const s = I.smooth(img, 1).frames[0], sh = I.sharpen(img, 1, 2).frames[0];
  assert.ok(s[4] < 65000 && s[4] > 100, 'edge softened');
  assert.strictEqual(sh[4], 0, 'dark side of edge clipped at minimum, not wrapped');
  assert.strictEqual(sh[5], 65535, 'bright side clipped at maximum');
  assert.throws(() => I.smooth(img, 0));
});

test('auto window and split regions', () => {
  const vals = []; for (let i = 0; i < 10000; i++) vals.push(i);
  const w = I.autoWindow(Uint16Array.from(vals));
  assert.ok(Math.abs(w.center - 5000) < 20 && Math.abs(w.width - 9900) < 30);
  const r = I.splitRegions(100, 301, 3, 'cols', 5);
  assert.deepStrictEqual(r, [{ x: 0, y: 0, w: 105, h: 100 }, { x: 95, y: 0, w: 106 + 5, h: 100 }, { x: 196, y: 0, w: 105, h: 100 }]);
  assert.deepStrictEqual(I.splitRegions(10, 10, 2, 'rows').map(x => [x.y, x.h]), [[0, 5], [5, 5]]);
});

test('render applies window, rescale and MONOCHROME1', () => {
  const img = tiny([0, 50, 100], 1, 3);
  const px = I.render(img.frames[0], img, 50, 100, false);
  assert.deepStrictEqual([px[0], px[8]], [0, 255]);
  assert.ok(px[4] === 127 || px[4] === 128);
  const m1 = I.render(img.frames[0], Object.assign({}, img, { photometric: 'MONOCHROME1' }), 50, 100, false);
  assert.deepStrictEqual([m1[0], m1[8]], [255, 0]);
  const resc = I.render(img.frames[0], Object.assign({}, img, { slope: 2, intercept: -100 }), 0, 200, false);
  assert.deepStrictEqual([resc[0], resc[8]], [0, 255]);
});

test('edited image written back and read again', async () => {
  const f = makeSample({ rows: 20, cols: 30 });
  const img = D.getImage(f);
  const rot = I.rotate(I.crop(img, { x: 5, y: 2, w: 10, h: 8 }), 1);
  D.setImage(f, rot, { swapSpacing: true });
  const out = await D.parse(D.write(f));
  const back = D.getImage(out);
  assert.deepStrictEqual([back.rows, back.cols], [10, 8]);
  assert.deepStrictEqual([...back.frames[0]], [...rot.frames[0]]);
  assert.strictEqual(D.getElement(out.ds, 0x00280106), null);
});

test('12-bit data with junk high bits is masked', async () => {
  const f = makeSample({ rows: 1, cols: 2, bitsStored: 12 });
  f.ds.el.get(D.PIXEL).value = new Uint8Array(Uint16Array.from([0xF123, 0x0FFF]).buffer);
  assert.deepStrictEqual([...D.getImage(f).frames[0]], [0x123, 0xFFF]);
});

test('ZIP output is valid', () => {
  const a = new Uint8Array([1, 2, 3]), b = new TextEncoder().encode('hello');
  const z = Buffer.from(X.zip([{ name: 'a.dcm', data: a }, { name: 'b.txt', data: b }]));
  assert.strictEqual(X.crc32(b), zlib.crc32(b));
  // Walk the central directory and check each local entry's data.
  const eocd = z.length - 22; assert.strictEqual(z.readUInt32LE(eocd), 0x06054b50);
  let p = z.readUInt32LE(eocd + 16); const names = [];
  for (let i = 0; i < z.readUInt16LE(eocd + 10); i++) {
    const nl = z.readUInt16LE(p + 28), off = z.readUInt32LE(p + 42), name = z.toString('utf8', p + 46, p + 46 + nl);
    const size = z.readUInt32LE(off + 18), lnl = z.readUInt16LE(off + 26), data = z.subarray(off + 30 + lnl, off + 30 + lnl + size);
    assert.strictEqual(zlib.crc32(data), z.readUInt32LE(off + 14));
    names.push(name); p += 46 + nl;
  }
  assert.deepStrictEqual(names, ['a.dcm', 'b.txt']);
});

test('TIFF header describes the raw data', () => {
  const img = tiny([1, 2, 3, 4, 5, 6], 2, 3);
  const t = Buffer.from(X.tiff(img));
  assert.strictEqual(t.toString('latin1', 0, 2), 'II');
  const ifd = t.readUInt32LE(4), n = t.readUInt16LE(ifd), tags = {};
  for (let i = 0; i < n; i++) { const p = ifd + 2 + i * 12; tags[t.readUInt16LE(p)] = t.readUInt16LE(p + 2) === 3 ? t.readUInt16LE(p + 8) : t.readUInt32LE(p + 8); }
  assert.strictEqual(tags[256], 3); assert.strictEqual(tags[257], 2); assert.strictEqual(tags[258], 16);
  assert.strictEqual(t.readUInt16LE(tags[273] + 10), 6);
});

test('PDF report has a valid cross-reference table', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
  const fields = Array.from({ length: 80 }, (_, i) => [`Field ${i}`, i === 3 ? 'Paren (x) \\ back – dash' : 'value']);
  const pdf = Buffer.from(X.pdfReport({ title: 'Report', subtitle: 'sub', fields, jpeg, imageWidth: 100, imageHeight: 50, caption: 'W/L' }));
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const startxref = +/startxref\n(\d+)/.exec(s)[1];
  assert.ok(s.slice(startxref).startsWith('xref'));
  const entries = s.slice(startxref).split('\n').slice(3).filter(l => / n $/.test(l)).map(l => +l.slice(0, 10));
  entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  assert.match(s, /\/Count 3/, 'two field pages plus the image page');
  assert.match(s, /Paren \\\(x\\\) \\\\ back \? dash/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; } catch (e) { console.error('FAIL', name); console.error(e); process.exit(1); }
  }
  console.log(`diconde core: ${passed} tests passed`);
})();
