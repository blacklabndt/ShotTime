'use strict';
// Parser/writer, metadata editing, derived copies, image operations and exporters.
const assert = require('assert');
const zlib = require('zlib');
const D = require('../dicom.js');
const I = require('../imaging.js');
const X = require('../export.js');
const { makeSample } = require('../tools/make-sample.cjs');
const { makeIndustrexLike, makeIndustrexJ2K, implicitBytes } = require('./industrex-fixture.cjs');
const C = require('../codec.js');
const O = require('../overlay.js');
const K = require('../compat.js');
const SH = require('../shots.js');

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

test('INDUSTREX 7.2.1 private block and DICONDE names are recognised', () => {
  const f = makeIndustrexLike();
  const ix = D.industrexInfo(f.ds);
  assert.deepStrictEqual([ix.creator, ix.version, ix.xmlTag, ix.staleTags], ['CSH_NDT', '7.2.1', 0x00331070, [0x00331040, 0x00331050, 0x00331052, 0x00331070]]);
  assert.strictEqual(D.describeTag(f.ds, 0x00331070).name, 'INDUSTREX presentation state (XML)');
  assert.strictEqual(D.describeTag(f.ds, 0x00331072).name, 'INDUSTREX display processing');
  assert.strictEqual(D.describeTag(f.ds, 0x00331176).name, 'Private data (E2737)', 'E2737 block is named by its own creator');
  assert.strictEqual(D.describeTag(f.ds, 0x003312A0).name, 'Private data (Diconde Private Tags 0033 Group)');
  assert.strictEqual(D.describeTag(f.ds, 0x00330011).name, 'Private creator');
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

test('INDUSTREX XML mirror: read, update in place, escape, leave the rest unchanged', () => {
  const f = makeIndustrexLike();
  const before = new TextDecoder().decode(f.ds.el.get(0x00331070).value);
  assert.deepStrictEqual(D.industrexXmlValues(f.ds, 0x00080008), ['ORIGINAL', 'PRIMARY']);
  assert.strictEqual(D.industrexXmlValues(f.ds, 0x00181004), null, 'no entry');
  D.setText(f.ds, 0x00100020, 'A&B <weld> "7"');
  D.setText(f.ds, 0x00204000, 'Comment');
  D.setText(f.ds, 0x00181004, 'PL-1');
  D.remove(f.ds, 0x00081048);
  const done = D.syncIndustrexXml(f.ds, [0x00100020, 0x00204000, 0x00181004, 0x00081048, 0x00331072]);
  assert.deepStrictEqual(done, [0x00100020, 0x00204000, 0x00081048]);
  assert.deepStrictEqual(D.industrexXmlValues(f.ds, 0x00100020), ['A&B <weld> "7"']);
  assert.deepStrictEqual(D.industrexXmlValues(f.ds, 0x00204000), ['Comment'], 'self-closing entry filled');
  assert.deepStrictEqual(D.industrexXmlValues(f.ds, 0x00081048), [''], 'removed tag becomes an empty value, as INDUSTREX writes it');
  const after = new TextDecoder().decode(f.ds.el.get(0x00331070).value);
  assert.match(after, /<value>A&amp;B &lt;weld&gt; &quot;7&quot;<\/value>/);
  const strip = x => x.replace(/<diconde KEY="(0010,0020|0020,4000|0008,1048)"[\s\S]*?(\/>|<\/diconde>)/g, '');
  assert.strictEqual(strip(after), strip(before), 'everything else is byte for byte the same');
  assert.ok(after.includes('<rotation>0,0,90</rotation>') && after.includes('C:\\fixture\\sample.dcm'));
});

test('metadata-only copy of an INDUSTREX file keeps private data and icon', async () => {
  const src = makeIndustrexLike();
  const copy = D.clone(src);
  D.setText(copy.ds, 0x00100020, 'NEW-ID');
  const out = await D.parse(D.write(D.derive(copy, src, {})));
  for (const t of [0x00330010, 0x00330011, 0x00330012, 0x00331010, 0x00331040, 0x00331050, 0x00331052, 0x00331071, 0x00331072, 0x00331176]) {
    const a = src.ds.el.get(t).value, b = out.ds.el.get(t).value;
    assert.deepStrictEqual([...b.subarray(0, a.length)], [...a], D.tagHex(t));
  }
  assert.strictEqual(out.ds.el.get(0x00880200).items.length, 1);
  assert.strictEqual(D.getString(out.ds, 0x00080016), '1.2.840.10008.5.1.4.1.1.1', 'CR SOP class kept');
});

test('processed copy drops what INDUSTREX regenerates, keeps version, flag and display processing', async () => {
  const src = makeIndustrexLike();
  const copy = D.clone(src), removed = [];
  D.setImage(copy, I.rotate(D.getImage(copy), 1), { swapSpacing: true });
  D.derive(copy, src, { pixelsChanged: true, description: 'Rotated', removed });
  assert.deepStrictEqual(removed, [0x00880200, 0x00331040, 0x00331050, 0x00331052, 0x00331070]);
  const out = await D.parse(D.write(copy));
  for (const t of removed) assert.strictEqual(D.getElement(out.ds, t), null, D.tagHex(t));
  for (const t of [0x00330010, 0x00331010, 0x00331071, 0x00331072, 0x00331176]) assert.ok(out.ds.el.has(t), D.tagHex(t));
  assert.strictEqual(D.getString(out.ds, 0x00080008), 'DERIVED\\SECONDARY', 'matches what INDUSTREX itself writes after a pixel change');
  assert.strictEqual(D.getString(out.ds, 0x00080016), '1.2.840.10008.5.1.4.1.1.1');
  assert.strictEqual(D.getString(out.ds, 0x00281040), 'LOG');
});

test('implicit VR INDUSTREX-style file: private elements read as UN and survive', async () => {
  const src = makeIndustrexLike();
  const f = await D.parse(implicitBytes(src));
  assert.strictEqual(f.transferSyntax, D.TS.IMPLICIT_LE);
  assert.strictEqual(f.ds.el.get(0x00331071).vr, 'UN');
  assert.strictEqual(D.industrexInfo(f.ds).version, '7.2.1');
  assert.deepStrictEqual(D.industrexXmlValues(f.ds, 0x00100020), ['WELD-0042'], 'XML readable from UN bytes');
  assert.strictEqual(D.getString(f.ds, 0x00081048), 'Inspect Co');
  const out = await D.parse(D.write(f));
  assert.strictEqual(out.transferSyntax, D.TS.EXPLICIT_LE);
  assert.deepStrictEqual([...out.ds.el.get(0x00331050).value], [0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xD9]);
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

test('JPEG 2000 lossless round trip: 12-bit, 16-bit and signed', async () => {
  await C.load();
  let seed = 3; const r = m => ((seed = (seed * 1103515245 + 12345) >>> 0) % m);
  for (const [Ctor, bits, signed] of [[Uint16Array, 12, false], [Uint16Array, 16, false], [Int16Array, 16, true]]) {
    const w = 37, h = 23, a = new Ctor(w * h);
    for (let i = 0; i < a.length; i++) a[i] = signed ? r(65536) - 32768 : r(2 ** bits);
    const cs = C.encodeFrameLossless(a, { width: w, height: h, bitsPerSample: bits, isSigned: signed });
    assert.deepStrictEqual([...cs.subarray(0, 4)], [0xFF, 0x4F, 0xFF, 0x51], 'raw J2K codestream');
    const d = C.decodeFrame(cs);
    assert.deepStrictEqual([d.width, d.height, d.componentCount], [w, h, 1]);
    assert.deepStrictEqual([...new Ctor(d.data.buffer)], [...a], `${bits}-bit ${signed ? 'signed' : 'unsigned'}`);
  }
  for (const [w, h] of [[1, 1], [3, 200], [31, 31]]) { // small crops and split parts need fewer wavelet levels
    const a = Uint16Array.from({ length: w * h }, (_, i) => (i * 131) % 4096);
    assert.deepStrictEqual([...new Uint16Array(C.decodeFrame(C.encodeFrameLossless(a, { width: w, height: h, bitsPerSample: 12 })).data.buffer)], [...a], `${w}x${h}`);
  }
  assert.throws(() => C.decodeFrames([new Uint8Array(0), Uint8Array.from([0xFF, 0x4F, 0xFF, 0x51, 1, 2, 3])], { rows: 4, cols: 4, frames: 1, bitsAllocated: 16 }), /decoded|failed/, 'damaged data is reported');
});

test('frame splitting: offset table, one fragment per frame, and start markers', () => {
  const j = (...b) => Uint8Array.from(b);
  const f1a = j(0xFF, 0x4F, 0xFF, 0x51, 1), f1b = j(2, 3), f2 = j(0xFF, 0x4F, 0xFF, 0x51, 9);
  const bot = new Uint8Array(8); new DataView(bot.buffer).setUint32(4, (8 + f1a.length) + (8 + f1b.length), true);
  assert.deepStrictEqual(C.frameStreams([bot, f1a, f1b, f2], 2).map(x => [...x]), [[0xFF, 0x4F, 0xFF, 0x51, 1, 2, 3], [0xFF, 0x4F, 0xFF, 0x51, 9]]);
  assert.deepStrictEqual(C.frameStreams([new Uint8Array(0), f1a, f2], 2).map(x => x.length), [5, 5]);
  assert.deepStrictEqual(C.frameStreams([new Uint8Array(0), f1a, f1b, f2], 2).map(x => x.length), [7, 5]);
  assert.deepStrictEqual(C.frameStreams([new Uint8Array(0), f1a, f1b], 1).map(x => x.length), [7]);
  assert.throws(() => C.frameStreams([new Uint8Array(0), f1a, f1b, f2], 4), /expected 4/);
});

test('INDUSTREX-style JPEG 2000 file: decode, metadata-only copy keeps codestream, processed copy re-encodes losslessly', async () => {
  const src = await D.parse(D.write(await makeIndustrexJ2K()));
  assert.strictEqual(src.transferSyntax, C.J2K_LOSSLESS);
  assert.ok(D.getImage(src).compressed);
  const expect = D.getImage(makeIndustrexLike());
  const img = D.imageFromFrames(src, C.decodeFrames(src.ds.el.get(D.PIXEL).fragments, D.imageGeometry(src)));
  assert.deepStrictEqual([img.rows, img.cols, img.bitsStored, img.photometric, img.padding], [40, 80, 12, 'MONOCHROME1', 0]);
  assert.deepStrictEqual([...img.frames[0]], [...expect.frames[0]]);
  // metadata only
  const meta = D.clone(src); D.setText(meta.ds, 0x00100020, 'X'); D.derive(meta, src, {});
  const mo = await D.parse(D.write(meta));
  assert.strictEqual(mo.transferSyntax, C.J2K_LOSSLESS);
  assert.deepStrictEqual([...mo.ds.el.get(D.PIXEL).fragments[1]], [...src.ds.el.get(D.PIXEL).fragments[1]]);
  // processed
  const rot = I.rotate(img, 1), proc = D.clone(src);
  D.setImage(proc, rot, { swapSpacing: true });
  D.setEncapsulated(proc, rot.frames.map(a => C.encodeFrameLossless(a, { width: rot.cols, height: rot.rows, bitsPerSample: 12, isSigned: false })), C.J2K_LOSSLESS);
  D.derive(proc, src, { pixelsChanged: true, description: 'Rotated' });
  const po = await D.parse(D.write(proc));
  assert.strictEqual(po.transferSyntax, C.J2K_LOSSLESS);
  const back = D.imageFromFrames(po, C.decodeFrames(po.ds.el.get(D.PIXEL).fragments, D.imageGeometry(po)));
  assert.deepStrictEqual([back.rows, back.cols], [80, 40]);
  assert.deepStrictEqual([...back.frames[0]], [...rot.frames[0]]);
  assert.strictEqual(D.getString(po.ds, 0x00080008), 'DERIVED\\SECONDARY');
});

test('decoded size must match the file', async () => {
  const f = await makeIndustrexJ2K();
  D.setText(f.ds, 0x00280010, '41', 'US');
  assert.throws(() => C.decodeFrames(f.ds.el.get(D.PIXEL).fragments, D.imageGeometry(f)), /decoded as 80×40×1, but the file says 80×41/);
});

test('view rotation maps coordinates both ways', () => {
  const W = 30, H = 10;
  for (const rot of [0, 90, 180, 270]) for (const [x, y] of [[0, 0], [3, 7], [29.5, 9.5]]) {
    const v = I.toView(x, y, W, H, rot), back = I.fromView(v.x, v.y, W, H, rot);
    assert.deepStrictEqual([back.x, back.y], [x, y], `rot ${rot}`);
  }
  assert.deepStrictEqual(I.viewDims(W, H, 90), { w: 10, h: 30 });
  assert.deepStrictEqual(I.toView(0, 0, W, H, 90), { x: 10, y: 0 }, 'top-left goes to top-right when turned right');
  assert.deepStrictEqual(I.rectToView({ x: 2, y: 1, w: 5, h: 3 }, W, H, 270), { x: 1, y: 23, w: 3, h: 5 });
});

test('EDGE-style filter: neutral is exact, defaults compress thickness and raise detail', () => {
  const w = 200, h = 60, a = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = 1000 + x * 5 + (x % 20 < 10 ? 50 : 0);
  const id = I.edgeEnhance(a, w, h, { kG: 1, kD: 1, kS: 1 });
  assert.ok(id.every((v, i) => Math.abs(v - a[i]) < 1e-3), 'neutral gains return the input');
  const e = I.edgeEnhance(a, w, h, { kernelPx: 40 }), row = 30 * w;
  const rampIn = a[row + 180] - a[row + 20], rampOut = e[row + 180] - e[row + 20];
  const stepIn = Math.abs(a[row + 70] - a[row + 69]), stepOut = Math.abs(e[row + 70] - e[row + 69]);
  assert.ok(rampOut < 0.6 * rampIn, `large-scale range reduced (${rampOut} vs ${rampIn})`);
  assert.ok(stepOut > 1.5 * stepIn, `fine detail raised (${stepOut} vs ${stepIn})`);
  const flat = I.edgeEnhance(new Uint16Array(w * h).fill(700), w, h, {});
  assert.ok(flat.every(v => Math.abs(v - 700) < 1e-3), 'flat image stays flat');
});

test('EDGE-style filter: padding, halo limit, despeckle direction, box blur', () => {
  const w = 40, h = 40, a = new Uint16Array(w * h).fill(2000);
  for (let i = 0; i < w * 10; i++) a[i] = 0; // padding rows
  const e = I.edgeEnhance(a, w, h, { padding: 0, kernelPx: 10 });
  assert.ok(Number.isNaN(e[0]) && Math.abs(e[20 * w + 20] - 2000) < 1e-3, 'padding becomes NaN and does not pull the rest');
  // A bright wire: the dark band beside it is shallower with the detail limit.
  const b = new Uint16Array(w * h).fill(2000); for (let y = 0; y < h; y++) b[y * w + 20] = 4000;
  const depth = o => 2000 - I.edgeEnhance(b, w, h, Object.assign({ kernelPx: 12 }, o))[20 * w + 24];
  assert.ok(depth({ detailLimit: 100 }) < depth({}) * 0.6, `halo reduced (${depth({ detailLimit: 100 })} vs ${depth({})})`);
  // Despeckle removes specks on the white side only: MONOCHROME1 shows low values white.
  const c = new Float32Array(25).fill(1000); c[12] = 100; c[6] = 1900;
  const n = I.despeckle(c, 5, 5, -1, 300);
  assert.deepStrictEqual([n, c[12], c[6]], [1, 1000, 1900]);
  const box = I.boxBlur(Float32Array.from({ length: 50 }, (_, i) => i % 10), 10, 5, 1);
  assert.ok(Math.abs(box[2 * 10 + 5] - 5) < 1e-6, 'moving average of 4,5,6');
});

test('INDUSTREX display settings are read from the file', () => {
  const f = makeIndustrexLike();
  assert.deepStrictEqual(D.industrexDisplaySettings(f.ds), { filter: 'EDGE', settings: { 'Image Class': 'HD 1' } });
  f.ds.el.get(0x00331072).value = Uint8Array.from(Buffer.from('EDGE\\Brightness: 0.0\\Global Contrast: 1.2\\Despeckle: 1 '));
  assert.deepStrictEqual(D.industrexDisplaySettings(f.ds).settings, { Brightness: 0, 'Global Contrast': 1.2, Despeckle: 1 });
  f.ds.el.get(0x00331072).value = new Uint8Array(0);
  assert.strictEqual(D.industrexDisplaySettings(f.ds), null);
  assert.strictEqual(D.industrexDisplaySettings(makeSample().ds), null);
});

test('overlay: values written for people, empty fields left out, live items, labels', () => {
  assert.strictEqual(O.formatValue('PN', 'Cline^Mark^^^'), 'Cline Mark');
  assert.strictEqual(O.formatValue('DA', '20261101'), '2026-11-01');
  assert.strictEqual(O.formatValue('TM', '101451.123'), '10:14:51');
  assert.strictEqual(O.formatValue('TM', '1014'), '10:14');
  assert.strictEqual(O.formatValue('DS', '0.1\\0.1'), '0.1, 0.1');
  assert.strictEqual(O.formatValue('LT', 'a\\b  c'), 'a\\b c');
  const f = makeIndustrexLike();
  D.setText(f.ds, 0x00081060, 'Inspector^One');
  const layout = { tl: ['00100020', '00080020', '00181004'], tr: ['00081060'], bl: [], br: ['live:wl', 'live:zoom'] };
  const l = O.lines(f.ds, layout, { 'live:wl': 'W 300 L 2800', 'live:zoom': '' }, { labels: true });
  assert.deepStrictEqual(l.tl, ['Component ID Number: WELD-0042', 'Study Date: 2026-10-14'], 'Plate ID is empty and left out');
  assert.deepStrictEqual(l.tr, ['Certifying Inspector Name: Inspector One']);
  assert.deepStrictEqual(l.br, ['Window / level: W 300 L 2800'], 'empty live item left out');
  assert.deepStrictEqual(O.lines(f.ds, layout, {}, { labels: false }).tl, ['WELD-0042', '2026-10-14']);
});

test('overlay: damaged saved layouts are cleaned, corners found', () => {
  const c = O.cleanLayout({ tl: ['00100020', 'nonsense', 5, 'live:zoom'], tr: 'x', zz: ['00100010'] });
  assert.deepStrictEqual(c.tl, ['00100020', 'live:zoom']);
  assert.deepStrictEqual(c.tr, O.DEFAULT_LAYOUT.tr, 'malformed corner falls back to the default');
  assert.ok(!('zz' in c));
  assert.strictEqual(O.cornerOf(c, 'live:zoom'), 'tl');
  assert.strictEqual(O.cornerOf(c, '00999999'), null);
  assert.strictEqual(O.cleanLayout(null).br.length, O.DEFAULT_LAYOUT.br.length);
});

test('INDUSTREX compatibility check: edited copies pass, broken ones are caught', async () => {
  await C.load();
  const src = await D.parse(D.write(await makeIndustrexJ2K()));
  const fails = r => r.filter(c => c.level === 'fail').map(c => c.title + (c.detail ? ' — ' + c.detail : ''));
  // metadata-only, XML synced
  const meta = D.clone(src); D.setText(meta.ds, 0x00100020, 'NEW'); D.syncIndustrexXml(meta.ds, [0x00100020]); D.derive(meta, src, {});
  assert.deepStrictEqual(fails(await K.check(D.write(meta), src, { edited: [0x00100020], xmlTag: 0x00331070 })), []);
  // processed, re-encoded like the source, Smallest/Largest recalculated
  const img = D.imageFromFrames(src, C.decodeFrames(src.ds.el.get(D.PIXEL).fragments, D.imageGeometry(src)));
  const rot = I.rotate(img, 1), proc = D.clone(src), removed = [];
  D.setText(proc.ds, 0x00280106, '0', 'US'); D.setText(proc.ds, 0x00280107, '4095', 'US');
  D.setImage(proc, rot, { swapSpacing: true });
  const si = C.codestreamInfo(C.frameStreams(src.ds.el.get(D.PIXEL).fragments, 1)[0]);
  D.setEncapsulated(proc, [C.encodeFrameLossless(rot.frames[0], { width: rot.cols, height: rot.rows, bitsPerSample: si.precision, isSigned: false, progression: si.progression })], C.J2K_LOSSLESS);
  D.derive(proc, src, { pixelsChanged: true, description: 'Rotated', removed });
  const rp = await K.check(D.write(proc), src, { removed, pixelsChanged: true });
  assert.deepStrictEqual(fails(rp), []);
  assert.ok(rp.some(c => c.title === 'Smallest/Largest Image Pixel Value match the pixels' && c.level === 'pass'));
  assert.ok(rp.some(c => c.title === 'JPEG 2000 encoded like the original' && c.level === 'pass'));
  // broken: Rows disagree with the pixel data
  const bad = D.clone(proc); D.setText(bad.ds, 0x00280010, '79', 'US');
  assert.ok(fails(await K.check(D.write(bad), src, { removed, pixelsChanged: true })).some(t => /JPEG 2000 header matches Rows/.test(t)));
  // broken: an original element silently lost and a VR changed
  const lost = D.clone(meta); D.remove(lost.ds, 0x00181260); lost.ds.el.get(0x00080090).vr = 'LO';
  const lf = fails(await K.check(D.write(lost), src, { edited: [0x00100020] }));
  assert.ok(lf.some(t => /Every original element is kept.* — missing: \(0018,1260\)/.test(t)) && lf.some(t => /Value representations unchanged — \(0008,0090\) PN→LO/.test(t)), lf.join('; '));
  // broken: XML left disagreeing with an edited field
  const stale = D.clone(src); D.setText(stale.ds, 0x00100020, 'NOT-SYNCED'); D.derive(stale, src, {});
  assert.ok(fails(await K.check(D.write(stale), src, { edited: [0x00100020] })).some(t => /XML copy agrees/.test(t)));
  // broken: a transfer syntax INDUSTREX does not list
  const ls = D.clone(src); ls.transferSyntax = '1.2.840.10008.1.2.4.80'; D.derive(ls, src, {});
  assert.ok(fails(await K.check(D.write(ls), src, {})).some(t => /Transfer syntax is one INDUSTREX reads/.test(t)));
  // a non-INDUSTREX SOP class is flagged
  const sc = makeSample(); D.setText(sc.ds, 0x00080016, '1.2.840.10008.5.1.4.1.1.7');
  assert.ok(fails(await K.check(D.write(sc))).some(t => /SOP class/.test(t)));
});

// A synthetic scan: background 20, plate ~2800 with noise and a shallow weld band; pieces as given.
function scan(w, h, pieces, opts = {}) {
  let seed = 11; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const a = new Uint16Array(w * h).fill(20);
  for (const p of pieces) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    const weld = Math.abs(x - (p.x + p.w / 2)) < p.w * 0.1 ? -90 : 0; // ~3% dip along each piece
    a[y * w + x] = 2800 + weld + Math.round((r() - 0.5) * 120);
  }
  if (opts.line) for (let y = 0; y < h; y++) { const x0 = Math.round(opts.line.a + opts.line.k * y); for (let x = x0 - 2; x <= x0 + 2; x++) if (x >= 0 && x < w) a[y * w + x] = 1400; }
  return a;
}
const near = (r, e, tol = 3) => ['x', 'y', 'w', 'h'].every(k => Math.abs(r[k] - e[k]) <= tol);

test('film pieces: separate pieces on background are found and trimmed', () => {
  const w = 600, h = 500, want = [{ x: 30, y: 20, w: 250, h: 200 }, { x: 320, y: 25, w: 240, h: 190 }, { x: 40, y: 280, w: 520, h: 190 }];
  const found = I.findPieces(scan(w, h, want), w, h);
  assert.strictEqual(found.length, 3, JSON.stringify(found));
  for (const e of want) assert.ok(found.some(f => near(f, e)), `missing ${JSON.stringify(e)} in ${JSON.stringify(found)}`);
  // margin grows each rectangle; small specks are ignored
  const withMargin = I.findPieces(scan(w, h, want.concat([{ x: 5, y: 480, w: 6, h: 6 }])), w, h, { margin: 5 });
  assert.strictEqual(withMargin.length, 3);
  assert.ok(withMargin.some(f => near(f, { x: 25, y: 15, w: 260, h: 210 })));
});

test('film pieces: a thin tilted dividing line splits two strips; the weld band does not', () => {
  const w = 400, h = 1200, line = { a: 190, k: 0.02 };
  const a = scan(w, h, [{ x: 0, y: 0, w, h }], { line });
  const found = I.findPieces(a, w, h).sort((p, q) => p.x - q.x);
  assert.strictEqual(found.length, 2, JSON.stringify(found));
  const c = found[0].cuts[0];
  assert.strictEqual(c.axis, 'x'); assert.strictEqual(c.keep, '<'); assert.strictEqual(found[1].cuts[0].keep, '>');
  assert.ok(Math.abs(c.k - 0.02) < 0.004 && Math.abs(c.a - 190) < 4, JSON.stringify(c));
  // bounding boxes follow the tilt: left piece reaches the line's far end, right piece starts at its near end
  assert.ok(found[0].x === 0 && found[0].x + found[0].w >= 190 + 0.02 * h - 10, JSON.stringify(found[0]));
  assert.ok(found[1].x <= 196 && found[1].x + found[1].w === w, JSON.stringify(found[1]));
  // filling across the line touches only the neighbour's side
  const r = found[0], frame = I.crop({ rows: h, cols: w, frames: [a], min: 0, max: 4095 }, r).frames[0].slice();
  const n = I.fillOutsideCuts(frame, r, 0);
  const lineAt = y => c.a + c.k * (r.y + y);
  assert.ok(n > 0 && frame[0 * r.w + (r.w - 1)] === 0 && frame[(h - 1) * r.w + 10] !== 0);
  assert.ok(frame[0 * r.w + Math.floor(lineAt(0)) - r.x - 3] !== 0, 'own side kept');
  // without the line, the weld band (a 3% dip) never splits the plate
  assert.strictEqual(I.findPieces(scan(w, h, [{ x: 0, y: 0, w, h }]), w, h).length, 1);
});

test('film pieces: padding is background, a full-frame plate is one piece, empty is none', () => {
  const w = 300, h = 300, a = scan(w, h, [{ x: 0, y: 0, w: 200, h }]);
  for (let y = 0; y < h; y++) for (let x = 200; x < w; x++) a[y * w + x] = 0;
  const f = I.findPieces(a, w, h, { padding: 0 });
  assert.strictEqual(f.length, 1); assert.ok(near(f[0], { x: 0, y: 0, w: 200, h }));
  assert.strictEqual(I.findPieces(scan(w, h, [{ x: 0, y: 0, w, h }]), w, h).length, 1);
  assert.deepStrictEqual(I.findPieces(new Uint16Array(w * h).fill(20), w, h, { padding: 20 }), []);
});

// Plate ~2800 with noise and a weld band, a background strip, then optional damage.
function plate(w, h) {
  let seed = 3; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const a = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = x < 20 ? 10 : 2800 + Math.round((r() - 0.5) * 80) + (Math.abs(x - 200) < 40 ? -60 : 0);
  return a;
}
const scratchAt = y => Math.round(120 + 0.01 * y);

test('scratch repair: removes a phosphor scratch, never touches cracks, edges or plain plate', () => {
  const w = 400, h = 1000, a = plate(w, h), clean = a.slice();
  for (let y = 50; y < 950; y++) { a[y * w + scratchAt(y)] -= 400; a[y * w + scratchAt(y) + 1] -= 250; }  // less radiation: scratch
  for (let y = 100; y < 900; y++) a[y * w + 300] += 400;                                               // more radiation: crack
  for (let y = 300; y < 400; y++) { a[y * w + 340] -= 400; a[y * w + 343] += 400; }                    // scratch beside a crack
  for (let y = 0; y < h; y++) for (let x = 360; x < 380; x++) a[y * w + x] -= 400;                      // 20 px band: too wide to be a scratch
  const o = { sign: 1, noise: I.noiseLevel(a, w, h), min: 0, max: 4095 };
  const r = I.repairScratch(a, w, h, { x0: 120.5, y0: 50, x1: 129.5, y1: 949 }, o);
  let worst = 0; for (let y = 60; y < 940; y++) for (const x of [scratchAt(y), scratchAt(y) + 1]) worst = Math.max(worst, Math.abs(r.frame[y * w + x] - clean[y * w + x]));
  assert.ok(r.count > 1700 && worst < 90, `repaired ${r.count}, worst ${worst}`);
  const changed = (f, g) => { let n = 0; for (let i = 0; i < f.length; i++) if (f[i] !== g[i]) n++; return n; };
  assert.strictEqual(changed(r.frame, a), r.count, 'only scratch pixels changed');
  for (const seg of [{ x0: 300, y0: 100, x1: 300, y1: 899 }, { x0: 340, y0: 300, x1: 340, y1: 399 }, { x0: 370, y0: 0, x1: 370, y1: 999 }, { x0: 60, y0: 0, x1: 60, y1: 999 }, { x0: 20, y0: 0, x1: 20, y1: 999 }])
    assert.strictEqual(I.repairScratch(a, w, h, seg, o).count, 0, `segment ${JSON.stringify(seg)} must not change`);
  // when higher values mean less radiation, the same logic works the other way round
  const inv = Uint16Array.from(a, v => 4095 - v), ri = I.repairScratch(inv, w, h, { x0: 120.5, y0: 50, x1: 129.5, y1: 949 }, Object.assign({}, o, { sign: -1 }));
  assert.ok(ri.count > 1700);
  assert.strictEqual(I.repairScratch(inv, w, h, { x0: 300, y0: 100, x1: 300, y1: 899 }, Object.assign({}, o, { sign: -1 })).count, 0);
});

test('find long scratches: only long thin less-radiation lines, not cracks, IQI wires, gaps or edges', () => {
  const w = 400, h = 1000, a = plate(w, h);
  for (let y = 50; y < 950; y++) { a[y * w + scratchAt(y)] -= 400; a[y * w + scratchAt(y) + 1] -= 250; }
  for (let y = 100; y < 900; y++) a[y * w + 300] += 400;          // crack
  for (let y = 400; y < 520; y++) a[y * w + 60] -= 300;           // IQI wire: short
  for (let y = 0; y < h; y++) for (let x = 268; x <= 272; x++) a[y * w + x] = 1400; // gap between two strips
  const found = I.findScratches(a, w, h, {});
  assert.strictEqual(found.length, 1, JSON.stringify(found));
  assert.ok(Math.abs(found[0].x0 - scratchAt(found[0].y0)) <= 3 && Math.abs(found[0].x1 - scratchAt(found[0].y1)) <= 3 && found[0].y1 - found[0].y0 > 800, JSON.stringify(found[0]));
  assert.deepStrictEqual(I.findScratches(plate(w, h), w, h, {}), [], 'undamaged plate');
  // horizontal scratch on a transposed plate
  const t = new Uint16Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = a[y * w + x];
  const ft = I.findScratches(t, h, w, {});
  assert.ok(ft.some(f => Math.abs(f.y0 - scratchAt(f.x0)) <= 3), JSON.stringify(ft));
});

async function shotSet() {
  const mk = async (name, weld, inst, acq) => {
    const f = makeIndustrexLike({ rows: 8, cols: 8 });
    D.setText(f.ds, 0x0008103E, weld); D.setText(f.ds, 0x00200013, String(inst), 'IS'); D.setText(f.ds, 0x00080032, acq);
    return SH.load(D.write(f), name);
  };
  return [await mk('a.dcm', 'X-81', 2, '101500'), await mk('b.dcm', 'X-82', 1, '110000'), await mk('c.dcm', 'X-81', 1, '101000'),
    await mk('d.dcm', 'X-81', 1, '100500'), await mk('e.dcm', '', 1, '120000')];
}

test('shots: grouped by weld field, ordered by shot number then time, no-weld last', async () => {
  const s = await shotSet();
  const g = SH.groups(s, 0x0008103E);
  assert.deepStrictEqual(g.map(x => x.key), ['X-81', 'X-82', '']);
  assert.deepStrictEqual(g[0].shots.map(e => e.name), ['d.dcm', 'c.dcm', 'a.dcm']);
  assert.deepStrictEqual(SH.groups(s, 0x00100020).map(x => x.shots.length), [5], 'all share the same Component ID');
});

test('shots: batch edit applies only changed fields, validates first, undo restores, renumber', async () => {
  const s = await shotSet(), sel = s.slice(0, 3);
  const cv = SH.commonValues(sel, [0x00081048, 0x0008103E]);
  assert.deepStrictEqual(cv['00081048'], { value: 'Inspect Co', mixed: false });
  assert.ok(cv['0008103e'].mixed && cv['0008103e'].count === 2);
  // one bad value: nothing changes anywhere
  const bad = SH.applyBatch(sel, { '00081048': 'New Co', '00080020': '2026-11-01' });
  assert.strictEqual(bad.applied, 0); assert.strictEqual(bad.errors.length, 3);
  assert.ok(sel.every(e => D.getString(e.file.ds, 0x00081048) === 'Inspect Co' && !SH.isEdited(e)));
  const snap = SH.snapshot(sel);
  const ok = SH.applyBatch(sel, { '00081048': 'New Co', '00204000': null, '00181004': 'PL-7' });
  assert.deepStrictEqual([ok.applied, ok.errors.length], [3, 0]);
  assert.ok(sel.every(e => D.getString(e.file.ds, 0x00081048) === 'New Co' && D.getString(e.file.ds, 0x00181004) === 'PL-7' && !e.file.ds.el.has(0x00204000)));
  assert.deepStrictEqual(SH.changedTags(sel[0]).sort(), [0x00081048, 0x00181004, 0x00204000].sort());
  assert.ok(!SH.isEdited(s[3]), 'unselected shots untouched');
  assert.ok(sel[0].orig.ds.el.has(0x00204000) && D.getString(sel[0].orig.ds, 0x00081048) === 'Inspect Co', 'original parsed file never edited');
  SH.restore(snap);
  assert.ok(sel.every(e => D.getString(e.file.ds, 0x00081048) === 'Inspect Co' && !SH.isEdited(e)));
  // setting a value back to the original clears the edit record
  SH.applyBatch([s[0]], { '00081048': 'X' }); SH.applyBatch([s[0]], { '00081048': 'Inspect Co' });
  assert.ok(!SH.isEdited(s[0]));
  // renumber a weld 1..n in shown order, and move a shot to another weld
  const x81 = SH.groups(s, 0x0008103E)[0].shots;
  SH.renumber(x81);
  assert.deepStrictEqual(x81.map(e => D.getString(e.file.ds, 0x00200013)), ['1', '2', '3']);
  SH.applyBatch([s[4]], { '0008103e': 'X-82' });
  assert.deepStrictEqual(SH.groups(s, 0x0008103E).map(x => x.key), ['X-81', 'X-82']);
});

test('shots: saved copies sync the INDUSTREX XML, get unique names, pass the compatibility check', async () => {
  const s = await shotSet();
  SH.applyBatch(s.slice(0, 2), { '00081048': 'Batch Co', '0008103e': 'X-90' });
  const names = SH.copyNames([s[0], s[0], s[1]]);
  assert.deepStrictEqual(names, ['a_edited.dcm', 'a_edited_2.dcm', 'b_edited.dcm']);
  const { bytes, edited, synced } = SH.buildCopy(s[0]);
  const out = await D.parse(bytes);
  assert.strictEqual(D.getString(out.ds, 0x00081048), 'Batch Co');
  assert.deepStrictEqual(D.industrexXmlValues(out.ds, 0x00081048), ['Batch Co']);
  assert.ok(synced.includes(0x00081048));
  assert.notStrictEqual(D.getString(out.ds, 0x00080018), D.getString(s[0].orig.ds, 0x00080018));
  const fails = (await K.check(bytes, s[0].orig, { edited, xmlTag: 0x00331070 })).filter(c => c.level === 'fail');
  assert.deepStrictEqual(fails.map(c => c.title), []);
});

// A straight 300x900 plate with grid lines on background, tilted by `tilt` degrees.
function tiltedPlate(tilt) {
  let seed = 2; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const W = 400, H = 1000, a = new Uint16Array(W * H).fill(20);
  for (let y = 50; y < 950; y++) for (let x = 50; x < 350; x++) a[y * W + x] = 2800 + Math.round((r() - 0.5) * 80) + (x % 40 < 3 ? -300 : 0);
  const t = I.rotateBy(a, W, H, tilt, 20, 0, 4095);
  return { rows: t.h, cols: t.w, frames: [t.frame], min: 0, max: 4095, padding: null, bitsAllocated: 16, bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0 };
}

test('straighten: measures tilt from the edges, rotates it straight and crops to the film', () => {
  for (const tilt of [-1.2, 0.85, 3]) {
    const img = tiltedPlate(tilt), r = I.straightenPiece(img, { x: 0, y: 0, w: img.cols, h: img.rows });
    assert.ok(Math.abs(r.angle + tilt) < 0.05, `tilt ${tilt}: angle ${r.angle}`);
    assert.ok(Math.abs(r.img.cols - 300) <= 2 && Math.abs(r.img.rows - 900) <= 2, `tilt ${tilt}: ${r.img.cols}x${r.img.rows}`);
    const o = r.img.frames[0], w = r.img.cols, h = r.img.rows;
    assert.ok(o.every(v => v > 1000), 'no background left');
    const grid = y => { let best = 0, bv = 1e9; for (let x = 0; x < 60; x++) if (o[y * w + x] < bv) { bv = o[y * w + x]; best = x; } return best; };
    assert.ok(Math.abs(grid(5) - grid(h - 6)) <= 1, 'grid lines run straight');
  }
  // over the limit: not rotated, still cropped, and reported
  const steep = tiltedPlate(8), rs = I.straightenPiece(steep, { x: 0, y: 0, w: steep.cols, h: steep.rows });
  assert.ok(!rs.rotated && rs.tooSteep && Math.abs(rs.measured + 8) < 0.1);
  // a straight plate filling the frame stays as it is
  const flat = tiltedPlate(0), rf = I.straightenPiece(flat, { x: 50, y: 50, w: 300, h: 900 });
  assert.strictEqual(rf.angle, 0); assert.deepStrictEqual([rf.img.cols, rf.img.rows], [300, 900]);
});

test('straighten: two strips meeting at a tilted line are each straightened from that line', () => {
  const W = 400, H = 1200, line = { a: 190, k: 0.015 }, a = new Uint16Array(W * H);
  let seed = 4; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.abs(x - (line.a + line.k * y)) <= 2 ? 1400 : 2800 + Math.round((r() - 0.5) * 80);
  const img = { rows: H, cols: W, frames: [a], min: 0, max: 4095, padding: null, bitsAllocated: 16, bitsStored: 12, signed: false };
  const pieces = I.findPieces(a, W, H).sort((p, q) => p.x - q.x);
  assert.strictEqual(pieces.length, 2);
  for (const p of pieces) {
    const res = I.straightenPiece(img, p);
    assert.ok(Math.abs(res.angle - Math.atan(0.015) * 180 / Math.PI) < 0.1, `angle ${res.angle}`);
    assert.ok(res.img.frames[0].every(v => v > 2000), 'no dividing line or neighbour left');
    assert.ok(res.img.rows > H - 40 && res.img.cols > 150 && res.img.cols < 215, `${res.img.cols}x${res.img.rows}`);
  }
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
  assert.ok(Math.abs(w.center - 5010) < 30 && Math.abs(w.width - 9930) < 40, JSON.stringify(w)); // uniform: 0.5th–99.8th percentile
  const padded = Uint16Array.from(vals.map((v, i) => (i < 5000 ? 0 : v)));
  const wp = I.autoWindow(padded, 1, 0, 0.5, 99.8, 0);
  assert.ok(wp.center - wp.width / 2 > 5000, 'padding pixels are ignored');
  assert.strictEqual(I.stats(padded, 0).count, 5000);
  // A plate with an unexposed half (pile at 1), a long ramp, a few marker pixels, and the exposure around 2800.
  const plate = new Uint16Array(20000);
  for (let i = 0; i < plate.length; i++) plate[i] = i < 8000 ? 1 : i < 9000 ? 1 + (i - 8000) * 2 : i < 9050 ? 300 : 2700 + (i % 300);
  const wpl = I.autoWindow(plate);
  assert.ok(wpl.center - wpl.width / 2 > 2650 && wpl.center + wpl.width / 2 < 3010, JSON.stringify(wpl));
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
