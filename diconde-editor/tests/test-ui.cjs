'use strict';
// Browser test: open a file, edit metadata, process the image, save a copy, split, export.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const D = require('../dicom.js');
const { makeSample } = require('../sample.js');
const { makeIndustrexLike, makeIndustrexJ2K } = require('./industrex-fixture.cjs');
const C = require('../codec.js');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diconde-ui-'));
const sampleSrc = makeSample({ rows: 60, cols: 120, sopUID: '1.2.826.0.1.42' });
const samplePath = path.join(tmp, 'weld 7.dcm');
fs.writeFileSync(samplePath, D.write(sampleSrc));

async function grab(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const p = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(p);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p) };
}
const field = (page, tag) => page.locator(`.field[data-tag="${tag}"]`);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BINARY || undefined });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Site A' : undefined));
  await page.goto(PAGE);
  let n = 0;
  const ok = msg => { n++; if (process.env.VERBOSE) console.log('ok', msg); };

  // Not-DICOM file is rejected with a message, nothing opens.
  const junk = path.join(tmp, 'notes.txt'); fs.writeFileSync(junk, 'not a dicom file at all, just text');
  await page.setInputFiles('#file-input', junk);
  await page.waitForFunction(() => /Could not open/.test(document.getElementById('toast').textContent));
  assert.ok(await page.isDisabled('#btn-save')); ok('rejects non-DICOM');

  await page.setInputFiles('#file-input', samplePath);
  await page.waitForFunction(() => /Opened/.test(document.getElementById('toast').textContent));
  assert.match(await page.textContent('#fileinfo'), /weld 7\.dcm · 120×60/); ok('opens file');

  // Metadata: DICONDE labels, validation, edit, add, remove, revert.
  assert.match(await field(page, '(0010,0020)').textContent(), /Component ID Number.*DICOM: Patient ID/);
  const studyDate = field(page, '(0008,0020)').locator('input');
  await studyDate.fill('2026-11-11'); await studyDate.press('Enter');
  assert.match(await field(page, '(0008,0020)').locator('.err').textContent(), /YYYYMMDD/);
  await studyDate.fill('20261111'); await studyDate.press('Enter');
  assert.strictEqual(await field(page, '(0008,0020)').locator('.err').textContent(), '');
  assert.ok(await field(page, '(0008,0020)').evaluate(e => e.classList.contains('changed')));
  const compId = field(page, '(0010,0020)').locator('input');
  await compId.fill('WELD-0099'); await compId.press('Enter');
  const plate = field(page, '(0018,1004)').locator('input');
  await plate.fill('PL-77'); await plate.press('Enter');
  await field(page, '(0018,1110)').getByRole('button', { name: /Remove/ }).click();
  const station = field(page, '(0008,0080)').locator('input');
  await station.fill('Temporary'); await station.press('Enter');
  await field(page, '(0008,0080)').getByRole('button', { name: /Revert/ }).click();
  assert.strictEqual(await field(page, '(0008,0080)').locator('input').inputValue(), 'Sample Inspection Co'); ok('metadata edits and revert');

  // Add a tag through the form.
  await page.click('#btn-add-tag');
  await page.fill('#add-tag', '(0014,0042)'); await page.dispatchEvent('#add-tag', 'change');
  assert.strictEqual(await page.inputValue('#add-vr'), 'ST');
  await page.fill('#add-value', 'API 5L X52');
  await page.click('#addform button[type=submit]');
  await page.waitForSelector('.field[data-tag="(0014,0042)"]');
  assert.strictEqual(await page.getAttribute('[data-metaview="all"]', 'aria-pressed'), 'true'); ok('add tag');

  // Template saved from changed fields, applied after revert.
  await page.click('#tpl-save');
  assert.match(await page.textContent('#tpl-select'), /Site A \(5 fields\)/);
  ok('template saved');

  // Image: rotate right, fix bad pixels, undo/redo.
  await page.click('[data-tab=image]');
  await page.click('[data-op=rot-cw]');
  await page.waitForFunction(() => window.__editor.S.img.rows === 120);
  await page.fill('#bp-t', '30'); await page.dispatchEvent('#bp-t', 'change');
  await page.click('[data-op=badpix]');
  await page.waitForFunction(() => window.__editor.S.ops.length === 2);
  assert.match(await page.textContent('#btn-undo'), /Undo: Fixed \d+ bad pixel/);
  await page.click('#btn-undo'); await page.waitForFunction(() => window.__editor.S.ops.length === 1);
  await page.click('#btn-redo'); await page.waitForFunction(() => window.__editor.S.ops.length === 2);
  await page.check('#store-window'); ok('image operations');

  // Crop with typed box.
  await page.click('[data-tab=crop]');
  for (const [id, v] of [['#cr-x', '5'], ['#cr-y', '10'], ['#cr-w', '50'], ['#cr-h', '100']]) { await page.fill(id, v); await page.dispatchEvent(id, 'change'); }
  await page.click('#crop-apply');
  await page.waitForFunction(() => window.__editor.S.img.cols === 50 && window.__editor.S.img.rows === 100); ok('crop');

  // Save a copy and check it independently.
  const saved = await grab(page, () => page.click('#btn-save'));
  assert.strictEqual(saved.name, 'weld 7_edited.dcm');
  const out = await D.parse(saved.bytes);
  const s = t => D.getString(out.ds, t);
  assert.strictEqual(s(0x00080020), '20261111');
  assert.strictEqual(s(0x00100020), 'WELD-0099');
  assert.strictEqual(s(0x00181004), 'PL-77');
  assert.strictEqual(s(0x00140042), 'API 5L X52');
  assert.strictEqual(s(0x00080080), 'Sample Inspection Co');
  assert.strictEqual(D.getElement(out.ds, 0x00181110), null);
  assert.strictEqual(s(0x00080008), 'DERIVED\\SECONDARY');
  assert.notStrictEqual(s(0x00080018), '1.2.826.0.1.42');
  assert.notStrictEqual(s(0x0020000E), D.getString(sampleSrc.ds, 0x0020000E));
  assert.match(s(0x00082111), /Rotated 90° clockwise; Fixed \d+ bad pixels? .*; Cropped to 50×100 at \(5, 10\)/);
  assert.strictEqual(D.getString(out.ds.el.get(0x00082112).items[0], 0x00081155), '1.2.826.0.1.42');
  assert.ok(s(0x00281051) !== '' && s(0x00281050) !== '');
  const img = D.getImage(out);
  assert.deepStrictEqual([img.rows, img.cols], [100, 50]);
  // Rotated-then-cropped pixel equals the original pixel at the mapped spot (a non-hot-pixel location).
  const orig = D.getImage(sampleSrc);
  const ox = 10 + 20, oy = 60 - 1 - (5 + 3);              // new (x=3,y=20) after crop -> rotated (8,30) -> original (30, 51)
  assert.strictEqual(img.frames[0][20 * 50 + 3], orig.frames[0][oy * 120 + ox]);
  assert.deepStrictEqual(fs.readFileSync(samplePath), Buffer.from(D.write(sampleSrc)), 'original file untouched');
  ok('saved copy');

  // Split the current image into 2 stacked parts with labels in Component ID.
  await page.fill('#sp-n', '2'); await page.selectOption('#sp-dir', 'rows'); await page.fill('#sp-o', '4');
  await page.click('#sp-make');
  await page.fill('[aria-label="Label for part 1"]', 'A');
  await page.fill('[aria-label="Label for part 2"]', 'B');
  await page.selectOption('#sp-target', 'compid');
  const zip = await grab(page, () => page.click('#sp-export'));
  assert.strictEqual(zip.name, 'weld 7_split.zip');
  const entries = []; const z = zip.bytes; let p = 0;
  while (z.readUInt32LE(p) === 0x04034b50) { const size = z.readUInt32LE(p + 18), nl = z.readUInt16LE(p + 26); entries.push({ name: z.toString('utf8', p + 30, p + 30 + nl), data: z.subarray(p + 30 + nl, p + 30 + nl + size) }); p += 30 + nl + size; }
  assert.deepStrictEqual(entries.map(e => e.name), ['weld 7_A.dcm', 'weld 7_B.dcm']);
  const parts = await Promise.all(entries.map(e => D.parse(e.data)));
  assert.deepStrictEqual(parts.map(f => D.getString(f.ds, 0x00100020)), ['WELD-0099-A', 'WELD-0099-B']);
  assert.deepStrictEqual(parts.map(f => D.getString(f.ds, 0x00200013)), ['1', '2']);
  assert.strictEqual(D.getString(parts[0].ds, 0x0020000E), D.getString(parts[1].ds, 0x0020000E));
  assert.notStrictEqual(D.getString(parts[0].ds, 0x00080018), D.getString(parts[1].ds, 0x00080018));
  assert.deepStrictEqual(parts.map(f => [D.getImage(f).rows, D.getImage(f).cols]), [[54, 50], [54, 50]]);
  assert.match(D.getString(parts[1].ds, 0x00082111), /Split part 2 of 2/); ok('split');

  // Exports.
  for (const [kind, ext, magic] of [['png', '.png', '\x89PNG'], ['tiff', '.tif', 'II*\0'], ['pdf', '_report.pdf', '%PDF']]) {
    const f = await grab(page, async () => { await page.click('#btn-export'); await page.click(`[data-export=${kind}]`); });
    assert.ok(f.name.endsWith(ext), f.name);
    assert.strictEqual(f.bytes.toString('latin1', 0, magic.length), magic);
  }
  ok('exports');

  // Changes tab lists everything.
  await page.click('[data-tab=history]');
  const hist = await page.textContent('#tab-history');
  assert.match(hist, /Component ID Number: “WELD-0042” → “WELD-0099”/);
  assert.match(hist, /Distance Source To Detector: removed/);
  assert.match(hist, /Cropped to 50×100/); ok('changes list');

  // Compressed file: metadata editable, image tools explain why they are unavailable.
  const comp = makeSample({ rows: 4, cols: 4 });
  comp.transferSyntax = '1.2.840.10008.1.2.4.80'; // JPEG-LS: no decoder bundled
  comp.ds.el.set(D.PIXEL, { tag: D.PIXEL, vr: 'OB', fragments: [new Uint8Array(0), new Uint8Array([0xFF, 0x4F, 0xFF, 0x51])] });
  const compPath = path.join(tmp, 'j2k.dcm'); fs.writeFileSync(compPath, D.write(comp));
  await page.setInputFiles('#file-input', compPath); // beforeunload-style confirm is accepted by the dialog handler
  await page.waitForFunction(() => /Opened j2k/.test(document.getElementById('toast').textContent));
  await page.click('[data-tab=image]');
  assert.match(await page.textContent('#img-unavail'), /compressed \(JPEG-LS Lossless\)/);
  await page.click('[data-tab=meta]'); await page.click('[data-metaview="common"]');
  const cn = field(page, '(0010,0010)').locator('input'); await cn.fill('Renamed'); await cn.press('Enter');
  const c2 = await D.parse((await grab(page, () => page.click('#btn-save'))).bytes);
  assert.strictEqual(c2.transferSyntax, '1.2.840.10008.1.2.4.80');
  assert.strictEqual(D.getString(c2.ds, 0x00100010), 'Renamed');
  assert.deepStrictEqual([...c2.ds.el.get(D.PIXEL).fragments[1]], [0xFF, 0x4F, 0xFF, 0x51]);
  assert.strictEqual(D.getString(c2.ds, 0x00080008), 'ORIGINAL\\PRIMARY'); ok('compressed metadata-only');

  // Damaged JPEG 2000 data: explained, metadata still editable.
  comp.transferSyntax = '1.2.840.10008.1.2.4.90';
  const badPath = path.join(tmp, 'bad-j2k.dcm'); fs.writeFileSync(badPath, D.write(comp));
  await page.setInputFiles('#file-input', badPath);
  await page.waitForFunction(() => /Opened bad-j2k/.test(document.getElementById('toast').textContent));
  await page.click('[data-tab=image]');
  assert.match(await page.textContent('#img-unavail'), /JPEG 2000 image could not be decoded .*Metadata can still be edited/);
  await page.click('[data-tab=meta]'); ok('damaged JPEG 2000');

  // Template applies to another file.
  await page.selectOption('#tpl-select', 'Site A'); await page.click('#tpl-apply');
  assert.strictEqual(await field(page, '(0010,0020)').locator('input').inputValue(), 'WELD-0099'); ok('template applied');

  // INDUSTREX-style CR file: summary, DICONDE names, compare, unsaved indicator, stale data left out.
  const ixPath = path.join(tmp, 'industrex.dcm'); fs.writeFileSync(ixPath, D.write(makeIndustrexLike({ sopUID: '1.2.826.0.1.77' })));
  await page.setInputFiles('#file-input', ixPath);
  await page.waitForFunction(() => /Opened industrex/.test(document.getElementById('toast').textContent));
  await page.click('[data-tab=meta]'); await page.click('[data-metaview="common"]');
  const summary = await page.textContent('#summary');
  assert.match(summary, /CR image/); assert.match(summary, /INDUSTREX 7\.2\.1/); assert.match(summary, /HPX-PRO/);
  assert.match(summary, /second copy of these fields in its XML/);
  assert.match(summary, /leave out icon thumbnail, internal data, preview image, presentation state \(XML\)/);
  // Metadata-only save updates INDUSTREX's XML copy of the field.
  const cid = field(page, '(0010,0020)').locator('input'); await cid.fill('WELD-7&8'); await cid.press('Enter');
  const ixMeta = await grab(page, () => page.click('#btn-save'));
  await page.waitForFunction(() => /Updated 1 field\(s\) in INDUSTREX's XML copy/.test(document.getElementById('toast').textContent));
  const ixMetaOut = await D.parse(ixMeta.bytes);
  assert.deepStrictEqual(D.industrexXmlValues(ixMetaOut.ds, 0x00100020), ['WELD-7&8']);
  assert.ok(ixMetaOut.ds.el.has(0x00331050) && ixMetaOut.ds.el.has(0x00880200));
  assert.strictEqual(await field(page, '(0008,1048)').locator('input').inputValue(), 'Inspect Co');
  assert.match(await field(page, '(0008,1048)').textContent(), /Inspecting Company Name.*DICOM: Physicians Of Record/);
  assert.ok(await page.isHidden('#dirty'), 'saved state');
  assert.ok(await page.isDisabled('#btn-compare'));
  await page.click('[data-tab=image]'); await page.click('[data-op=flip-h]');
  await page.waitForFunction(() => window.__editor.S.ops.length === 1);
  assert.ok(await page.isVisible('#dirty'));
  const cmpBox = await page.locator('#btn-compare').boundingBox();
  await page.mouse.move(cmpBox.x + 5, cmpBox.y + 5); await page.mouse.down();
  assert.strictEqual(await page.getAttribute('#btn-compare', 'aria-pressed'), 'true');
  await page.mouse.up();
  assert.strictEqual(await page.getAttribute('#btn-compare', 'aria-pressed'), 'false');
  const ixSaved = await grab(page, () => page.click('#btn-save'));
  await page.waitForFunction(() => /Left out 5 element/.test(document.getElementById('toast').textContent));
  assert.ok(await page.isHidden('#dirty'));
  const ixOut = await D.parse(ixSaved.bytes);
  for (const t of [0x00880200, 0x00331040, 0x00331050, 0x00331052, 0x00331070]) assert.strictEqual(D.getElement(ixOut.ds, t), null);
  assert.ok(ixOut.ds.el.has(0x00331072), 'display processing kept');
  assert.strictEqual(D.industrexInfo(ixOut.ds).version, '7.2.1');
  assert.strictEqual(D.getString(ixOut.ds, 0x00100020), 'WELD-7&8');
  assert.strictEqual(D.getString(ixOut.ds, 0x00080016), '1.2.840.10008.5.1.4.1.1.1');
  ok('INDUSTREX-style file');

  // JPEG 2000 INDUSTREX-style file: decoded on open, shown at INDUSTREX's angle, saved as JPEG 2000 or uncompressed.
  const j2kSrc = await makeIndustrexJ2K({ sopUID: '1.2.826.0.1.88' });
  const j2kPath = path.join(tmp, 'industrex-j2k.dcm'); fs.writeFileSync(j2kPath, D.write(j2kSrc));
  await page.setInputFiles('#file-input', j2kPath);
  await page.waitForFunction(() => /Opened industrex-j2k/.test(document.getElementById('toast').textContent));
  assert.ok(await page.evaluate(() => window.__editor.S.decoded), 'decoded');
  assert.strictEqual(await page.textContent('#btn-viewrot'), '⟳ View: 90° left', 'INDUSTREX ANGLE 90 shown as a quarter turn left');
  assert.strictEqual(await page.inputValue('#save-format'), 'j2k');
  await page.click('[data-tab=image]');
  assert.ok(await page.isHidden('#img-unavail'));
  // Side by side as shown on screen = split along image rows when the view is turned.
  await page.click('[data-tab=crop]');
  await page.fill('#sp-n', '2'); await page.fill('#sp-o', '0'); await page.selectOption('#sp-dir', 'cols'); await page.click('#sp-make');
  assert.deepStrictEqual(await page.evaluate(() => window.__editor.S.regions.map(r => [r.x, r.y, r.w, r.h])), [[0, 0, 80, 20], [0, 20, 80, 20]]);
  await page.click('#sp-clear');
  // PNG export follows the view: 40 rows × 80 columns turned a quarter = 40 wide, 80 tall.
  const png = await grab(page, async () => { await page.click('#btn-export'); await page.click('[data-export=png]'); });
  assert.deepStrictEqual([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)], [40, 80]);
  await page.click('#btn-viewrot');
  assert.strictEqual(await page.textContent('#btn-viewrot'), '⟳ View: upright');
  // Flip and save as JPEG 2000 lossless.
  await page.click('[data-tab=image]'); await page.click('[data-op=flip-h]');
  await page.waitForFunction(() => window.__editor.S.ops.length === 1);
  const flipped = await page.evaluate(() => Array.from(window.__editor.S.img.frames[0]));
  await C.load();
  const decodeOut = f => D.imageFromFrames(f, C.decodeFrames(f.ds.el.get(D.PIXEL).fragments, D.imageGeometry(f)));
  const j2kOut = await D.parse((await grab(page, () => page.click('#btn-save'))).bytes);
  assert.strictEqual(j2kOut.transferSyntax, C.J2K_LOSSLESS);
  assert.deepStrictEqual(Array.from(decodeOut(j2kOut).frames[0]), flipped, 'JPEG 2000 copy is lossless');
  assert.strictEqual(D.getElement(j2kOut.ds, 0x00331070), null);
  await page.selectOption('#save-format', 'raw');
  const rawOut = await D.parse((await grab(page, () => page.click('#btn-save'))).bytes);
  assert.strictEqual(rawOut.transferSyntax, D.TS.EXPLICIT_LE);
  assert.deepStrictEqual(Array.from(D.getImage(rawOut).frames[0]), flipped);
  // Metadata-only copy of the JPEG 2000 file keeps the original codestream.
  await page.click('#btn-revert-img');
  await page.waitForFunction(() => window.__editor.S.ops.length === 0);
  const metaOnly = await D.parse((await grab(page, () => page.click('#btn-save'))).bytes);
  assert.strictEqual(metaOnly.transferSyntax, C.J2K_LOSSLESS);
  assert.deepStrictEqual([...metaOnly.ds.el.get(D.PIXEL).fragments[1]], [...j2kSrc.ds.el.get(D.PIXEL).fragments[1]]);
  ok('JPEG 2000 file');

  // Narrow layout has no horizontal scroll.
  await page.setViewportSize({ width: 380, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); ok('narrow layout');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log(`diconde UI: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
