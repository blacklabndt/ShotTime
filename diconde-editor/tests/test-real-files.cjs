'use strict';
/* Checks real DICONDE exports without storing them in the repository.
   Usage: DICONDE_REAL_DIR=/path/to/dcm/files node tests/test-real-files.cjs   (skips when the variable is unset)
   For each file: parse, edit one field, save a metadata-only copy, and confirm every other element is unchanged,
   compressed image data is byte for byte identical, and INDUSTREX's XML copy (if any) was updated.
   JPEG 2000 images are also decoded, checked against the file's Smallest/Largest Image Pixel Value and
   re-encoded losslessly. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../dicom.js');
const C = require('../codec.js');
const I = require('../imaging.js');

const dir = process.env.DICONDE_REAL_DIR;
if (!dir) { console.log('diconde real files: skipped (set DICONDE_REAL_DIR to a folder of .dcm files)'); process.exit(0); }
const ser = e => e.fragments ? e.fragments.map(f => Buffer.from(f).toString('hex')).join('|') : e.items ? `items:${e.items.length}` : Buffer.from(e.value || []).toString('hex').replace(/(00|20)$/, '');

(async () => {
  const files = fs.readdirSync(dir).filter(f => /\.(dcm|dicom)$/i.test(f));
  assert.ok(files.length, 'no .dcm files in ' + dir);
  for (const f of files) {
    const src = await D.parse(fs.readFileSync(path.join(dir, f)));
    const copy = D.clone(src), tag = 0x00204000;
    D.setText(copy.ds, tag, 'diconde-editor test');
    const synced = D.syncIndustrexXml(copy.ds, [tag]);
    D.derive(copy, src, {});
    const out = await D.parse(D.write(copy));
    assert.strictEqual(out.transferSyntax, src.encapsulated ? src.transferSyntax : D.TS.EXPLICIT_LE, f);
    const ix = D.industrexInfo(src.ds);
    const skip = new Set([tag, 0x00080018, 0x00080012, 0x00080013, ...(synced.length ? [ix.xmlTag] : [])]);
    for (const [t, e] of src.ds.el) {
      if (skip.has(t)) continue;
      assert.ok(out.ds.el.has(t), `${f}: ${D.tagHex(t)} missing`);
      assert.strictEqual(ser(out.ds.el.get(t)), ser(e), `${f}: ${D.tagHex(t)} changed`);
    }
    assert.strictEqual(D.getString(out.ds, tag), 'diconde-editor test');
    if (ix && ix.xmlTag && D.industrexXmlValues(src.ds, tag)) {
      assert.deepStrictEqual(D.industrexXmlValues(out.ds, tag), ['diconde-editor test'], `${f}: XML copy`);
      const x = new TextDecoder().decode(out.ds.el.get(ix.xmlTag).value);
      assert.strictEqual((x.match(/<diconde /g) || []).length, (x.match(/<\/diconde>|<diconde [^>]*\/>/g) || []).length, `${f}: XML balanced`);
    }
    let pix = '';
    if (src.encapsulated && C.canDecode(src.transferSyntax)) {
      await C.load();
      const g = D.imageGeometry(src), img = D.imageFromFrames(src, C.decodeFrames(src.ds.el.get(D.PIXEL).fragments, g));
      const st = I.stats(img.frames[0]), lo = D.getNumber(src.ds, 0x00280106), hi = D.getNumber(src.ds, 0x00280107);
      if (lo != null && hi != null && g.frames === 1) assert.deepStrictEqual([st.min, st.max], [lo, hi], `${f}: decoded range matches the file`);
      const cs = C.encodeFrameLossless(img.frames[0], { width: img.cols, height: img.rows, bitsPerSample: img.bitsStored, isSigned: img.signed });
      const again = new img.frames[0].constructor(C.decodeFrame(cs).data.buffer);
      assert.ok(again.every((v, i) => v === img.frames[0][i]), `${f}: lossless re-encode`);
      pix = `, decoded ${img.cols}×${img.rows} range ${st.min}–${st.max}, re-encoded ${(cs.length / 1e6).toFixed(2)} MB`;
    }
    console.log(`  ${f.slice(0, 40)}: ${src.ds.el.size} elements, ${D.TS_NAMES[src.transferSyntax] || src.transferSyntax}${ix ? `, INDUSTREX ${ix.version}` : ''}${synced.length ? ', XML synced' : ''}${pix}`);
  }
  console.log(`diconde real files: ${files.length} files passed`);
})().catch(e => { console.error(e); process.exit(1); });
