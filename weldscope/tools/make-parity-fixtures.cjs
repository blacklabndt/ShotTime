'use strict';
// Runs the browser prototype (diconde-editor/, frozen) on deterministic synthetic inputs and records what it
// returns, so the Rust core can be checked against it (core/tests/parity.rs). Inputs are regenerated in Rust from
// the same seeds; the input checksums recorded here prove both sides start from identical pixels.
// Usage: node tools/make-parity-fixtures.cjs   (writes core/tests/fixtures/*)
const fs = require('fs');
const path = require('path');
const P = path.resolve(__dirname, '..', '..', 'diconde-editor');
const D = require(P + '/dicom.js');
const I = require(P + '/imaging.js');
const C = require(P + '/codec.js');
const SH = require(P + '/shots.js');
const { makeIndustrexLike, makeIndustrexJ2K, implicitBytes } = require(P + '/tests/industrex-fixture.cjs');
const OUT = path.resolve(__dirname, '..', 'core', 'tests', 'fixtures');

const fnv = arr => { let h = 0x811c9dc5; for (let i = 0; i < arr.length; i++) { const v = arr[i] >>> 0; for (let k = 0; k < 4; k++) { h ^= (v >>> (8 * k)) & 0xFF; h = Math.imul(h, 0x01000193) >>> 0; } } return h >>> 0; };
const fnvBytes = b => { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const lcg = seed => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const r6 = v => Math.round(v * 1e6) / 1e6;

function scan(w, h, pieces, opts = {}) {
  const r = lcg(11), a = new Uint16Array(w * h).fill(20);
  for (const p of pieces) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    const weld = Math.abs(x - (p.x + p.w / 2)) < p.w * 0.1 ? -90 : 0;
    a[y * w + x] = 2800 + weld + Math.round((r() - 0.5) * 120);
  }
  if (opts.line) for (let y = 0; y < h; y++) { const x0 = Math.round(opts.line.a + opts.line.k * y); for (let x = x0 - 2; x <= x0 + 2; x++) if (x >= 0 && x < w) a[y * w + x] = 1400; }
  return a;
}
function plate(w, h) {
  const r = lcg(3), a = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = x < 20 ? 10 : 2800 + Math.round((r() - 0.5) * 80) + (Math.abs(x - 200) < 40 ? -60 : 0);
  return a;
}
const scratchAt = y => Math.round(120 + 0.01 * y);
function damaged(w, h) {
  const a = plate(w, h);
  for (let y = 50; y < 950; y++) { a[y * w + scratchAt(y)] -= 400; a[y * w + scratchAt(y) + 1] -= 250; }
  for (let y = 100; y < 900; y++) a[y * w + 300] += 400;
  for (let y = 300; y < 400; y++) { a[y * w + 340] -= 400; a[y * w + 343] += 400; }
  for (let y = 0; y < h; y++) for (let x = 360; x < 380; x++) a[y * w + x] -= 400;
  return a;
}
function tiltedSource() {
  const r = lcg(2), W = 400, H = 1000, a = new Uint16Array(W * H).fill(20);
  for (let y = 50; y < 950; y++) for (let x = 50; x < 350; x++) a[y * W + x] = 2800 + Math.round((r() - 0.5) * 80) + (x % 40 < 3 ? -300 : 0);
  return a;
}
const img = (a, w, h, extra = {}) => Object.assign({ rows: h, cols: w, frames: [a], min: 0, max: 4095, padding: null, bitsAllocated: 16, bitsStored: 12, signed: false, photometric: 'MONOCHROME2', slope: 1, intercept: 0 }, extra);
const region = r => ({ x: r.x, y: r.y, w: r.w, h: r.h, cuts: (r.cuts || []).map(c => ({ axis: c.axis, a: r6(c.a), k: r6(c.k), keep: c.keep })) });

(async () => {
  const out = { pieces: [], levels: [], straighten: [], scratches: [], repairs: [], windows: [], edge: [], rotate: [], noise: [], stats: [] };
  // ---- film pieces
  const three = [{ x: 30, y: 20, w: 250, h: 200 }, { x: 320, y: 25, w: 240, h: 190 }, { x: 40, y: 280, w: 520, h: 190 }];
  const cases = [
    { name: 'three', gen: { kind: 'scan', w: 600, h: 500, pieces: three }, opts: {} },
    { name: 'three-margin-speck', gen: { kind: 'scan', w: 600, h: 500, pieces: three.concat([{ x: 5, y: 480, w: 6, h: 6 }]) }, opts: { margin: 5 } },
    { name: 'tilted-line', gen: { kind: 'scan', w: 400, h: 1200, pieces: [{ x: 0, y: 0, w: 400, h: 1200 }], line: { a: 190, k: 0.02 } }, opts: {} },
    { name: 'weld-band-only', gen: { kind: 'scan', w: 400, h: 1200, pieces: [{ x: 0, y: 0, w: 400, h: 1200 }] }, opts: {} },
    { name: 'high-sensitivity', gen: { kind: 'scan', w: 600, h: 500, pieces: three }, opts: { sensitivity: 0.9 } },
  ];
  for (const c of cases) {
    const g = c.gen, a = scan(g.w, g.h, g.pieces, { line: g.line });
    const found = I.findPieces(a, g.w, g.h, c.opts);
    out.pieces.push({ name: c.name, gen: g, opts: c.opts, input: fnv(a), found: found.map(region) });
    const lv = I.plateLevels(a, g.w, g.h, null);
    out.levels.push({ name: c.name, sign: lv.sign, bg: r6(lv.bg), base: r6(lv.base), thr: r6(lv.thr), iqr: r6(lv.iqr), hasBackground: lv.hasBackground });
    const w = I.autoWindow(a, 1, 0, 0.5, 99.8, null);
    out.windows.push({ name: c.name, center: r6(w.center), width: r6(w.width) });
    const st = I.stats(a, null);
    out.stats.push({ name: c.name, min: st.min, max: st.max, count: st.count, p01: r6(st.pct(0.1)), p50: r6(st.pct(50)), p90: r6(st.pct(90)), p999: r6(st.pct(99.9)) });
  }
  // padding counted as background
  {
    const w = 300, h = 300, a = scan(w, h, [{ x: 0, y: 0, w: 200, h }]);
    for (let y = 0; y < h; y++) for (let x = 200; x < w; x++) a[y * w + x] = 0;
    out.pieces.push({ name: 'padding', gen: { kind: 'scan-pad', w, h }, opts: { padding: 0 }, input: fnv(a), found: I.findPieces(a, w, h, { padding: 0 }).map(region) });
  }
  // ---- straightening
  const src = tiltedSource();
  for (const tilt of [-1.2, 0.85, 3, 8]) {
    const t = I.rotateBy(src, 400, 1000, tilt, 20, 0, 4095);
    out.rotate.push({ tilt, w: t.w, h: t.h, hash: fnv(t.frame) });
    const im = img(t.frame, t.w, t.h), r = I.straightenPiece(im, { x: 0, y: 0, w: t.w, h: t.h });
    const lv = I.plateLevels(t.frame, t.w, t.h, null);
    out.straighten.push({ name: 'tilted ' + tilt, tilt, angle: r6(r.angle), measured: r6(r.measured), rotated: r.rotated, tooSteep: r.tooSteep, crop: r.crop, cols: r.img.cols, rows: r.img.rows, hash: fnv(r.img.frames[0]),
      edges: r.edges.map(e => ({ side: e.side, angle: r6(e.angle), points: e.points })), levels: { thr: r6(lv.thr), hasBackground: lv.hasBackground } });
  }
  {
    const W = 400, H = 1200, line = { a: 190, k: 0.015 }, a = new Uint16Array(W * H), r = lcg(4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.abs(x - (line.a + line.k * y)) <= 2 ? 1400 : 2800 + Math.round((r() - 0.5) * 80);
    const pieces = I.findPieces(a, W, H);
    out.straighten.push({ name: 'two strips', input: fnv(a), pieces: pieces.map(region), results: pieces.map(p => { const s = I.straightenPiece(img(a, W, H), p); return { angle: r6(s.angle), cols: s.img.cols, rows: s.img.rows, hash: fnv(s.img.frames[0]) }; }) });
  }
  // ---- scratches
  {
    const w = 400, h = 1000, a = damaged(w, h), noise = I.noiseLevel(a, w, h);
    out.noise.push({ name: 'damaged', input: fnv(a), noise: r6(noise) });
    const o = { sign: 1, noise, min: 0, max: 4095 };
    for (const seg of [{ x0: 120.5, y0: 50, x1: 129.5, y1: 949 }, { x0: 300, y0: 100, x1: 300, y1: 899 }, { x0: 340, y0: 300, x1: 340, y1: 399 }, { x0: 370, y0: 0, x1: 370, y1: 999 }, { x0: 60, y0: 0, x1: 60, y1: 999 }, { x0: 20, y0: 0, x1: 20, y1: 999 }]) {
      const r = I.repairScratch(a, w, h, seg, o);
      out.repairs.push({ seg, count: r.count, hash: fnv(r.frame) });
    }
    const r2 = I.repairScratch(a, w, h, { x0: 120.5, y0: 50, x1: 129.5, y1: 949 }, { sign: 1, min: 0, max: 4095 }); // noise worked out per spot
    out.repairs.push({ seg: { x0: 120.5, y0: 50, x1: 129.5, y1: 949 }, localNoise: true, count: r2.count, hash: fnv(r2.frame) });
    const f = damaged(w, h);
    for (let y = 400; y < 520; y++) f[y * w + 60] -= 300;
    for (let y = 0; y < h; y++) for (let x = 268; x <= 272; x++) f[y * w + x] = 1400;
    out.scratches.push({ name: 'damaged+wire+gap', input: fnv(f), found: I.findScratches(f, w, h, {}).map(s => ({ x0: r6(s.x0), y0: r6(s.y0), x1: r6(s.x1), y1: r6(s.y1), coverage: s.coverage })) });
    out.scratches.push({ name: 'clean plate', input: fnv(plate(w, h)), found: I.findScratches(plate(w, h), w, h, {}) });
  }
  // ---- EDGE-style filter
  {
    const w = 400, h = 1000, a = damaged(w, h);
    for (const [name, o] of [['default', { kernelPx: 200 }], ['neutral', { kG: 1, kD: 1, kS: 1 }], ['full', { globalContrast: 1.3, detailContrast: 0.8, sharpness: 1.5, noiseReduction: 0.4, kernelPx: 120, despeckle: true, despeckleThreshold: 200, whiteSign: 1, detailLimit: 300, padding: 10 }]]) {
      const e = I.edgeEnhance(a, w, h, o);
      let sum = 0, nan = 0; for (const v of e) { if (v !== v) nan++; else sum += v; }
      const wnd = I.autoWindow(e, 1, 0);
      out.edge.push({ name, opts: o, specks: e.specks, mean: r6(sum / (e.length - nan)), nan, samples: [0, 1234, 55555, 200000, 399999].map(i => (e[i] !== e[i] ? null : r6(e[i]))), window: { center: r6(wnd.center), width: r6(wnd.width) } });
    }
  }
  fs.writeFileSync(path.join(OUT, 'parity-imaging.json'), JSON.stringify(out, null, 1));

  // ---- DICOM files written by the prototype (synthetic; no real inspection data)
  const files = {};
  const ind = makeIndustrexLike({ rows: 40, cols: 80, sopUID: '1.2.826.0.1.4242' });
  files['industrex-like.dcm'] = D.write(ind);
  files['industrex-implicit.dcm'] = implicitBytes(makeIndustrexLike({ rows: 20, cols: 30, sopUID: '1.2.826.0.1.4243' }));
  const j2k = await makeIndustrexJ2K({ rows: 64, cols: 96, sopUID: '1.2.826.0.1.4244' });
  files['industrex-j2k.dcm'] = D.write(j2k);
  const meta = { files: {} };
  await C.load();
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), bytes);
    const f = await D.parse(bytes), utf8 = D.charsetIsUtf8(f.ds);
    const els = [...f.ds.el.entries()].sort((a, b) => a[0] - b[0]).map(([t, e]) => ({ tag: t, vr: e.vr, text: D.valueToText(e, utf8), hash: e.value ? fnvBytes(e.value) : null, items: e.items ? e.items.length : null, fragments: e.fragments ? e.fragments.length : null }));
    let pixels = null;
    try {
      const im = f.encapsulated ? D.imageFromFrames(f, C.decodeFrames(f.ds.el.get(D.PIXEL).fragments, D.imageGeometry(f))) : D.getImage(f);
      if (!im.error) pixels = { rows: im.rows, cols: im.cols, min: im.min, max: im.max, hash: fnv(im.frames[0]), photometric: im.photometric, padding: im.padding };
    } catch (e) { pixels = { error: e.message }; }
    const ix = D.industrexInfo(f.ds);
    // metadata edit + XML sync, exactly as a metadata-only copy does it
    const e = await SH.load(bytes, name);
    SH.applyBatch([e], { '00100020': 'WELD-ÅB 7', '00081048': 'New & <Co>', '00204000': 'Line one' });
    const synced = D.syncIndustrexXml(e.file.ds, SH.changedTags(e));
    const xml = ix && ix.xmlTag ? new TextDecoder().decode(e.file.ds.el.get(ix.xmlTag).value) : null;
    meta.files[name] = { transferSyntax: f.transferSyntax, encapsulated: f.encapsulated, elements: els, pixels, industrex: ix && { creator: ix.creator, block: ix.block, version: ix.version, xmlTag: ix.xmlTag, staleTags: ix.staleTags },
      angle: D.industrexXmlEntry(f.ds, 'ANGLE'), display: D.industrexDisplaySettings(f.ds), synced, xmlAfterSync: xml, describe: els.filter(x => (x.tag >>> 16) & 1).map(x => [x.tag, D.describeTag(f.ds, x.tag).name]),
      codestream: f.encapsulated ? C.codestreamInfo(C.frameStreams(f.ds.el.get(D.PIXEL).fragments, 1)[0]) : null };
  }
  fs.writeFileSync(path.join(OUT, 'parity-dicom.json'), JSON.stringify(meta, null, 1));
  console.log('wrote parity fixtures to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
