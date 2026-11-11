#!/usr/bin/env node
/* Checks an edited DICONDE file for INDUSTREX compatibility, optionally against the original it came from.
   Usage: node tools/check-industrex.cjs edited.dcm [original.dcm]
   Exit code 1 when any check fails. Passing is strong evidence, not proof; open the file in INDUSTREX to confirm. */
'use strict';
const fs = require('fs');
const D = require('../dicom.js'), C = require('../codec.js'), K = require('../compat.js');
(async () => {
  const [edited, original] = process.argv.slice(2);
  if (!edited) { console.error('Usage: node tools/check-industrex.cjs edited.dcm [original.dcm]'); process.exit(2); }
  await C.load();
  const src = original ? await D.parse(fs.readFileSync(original)) : null;
  const out = await D.parse(fs.readFileSync(edited));
  // Without the editor's own record, infer what it changed: left-out stale elements and differing text fields.
  const removed = src ? D.stalePresentationTags(src.ds).filter(t => !out.ds.el.has(t)) : [];
  const pixelsChanged = /^DERIVED/.test(D.getString(out.ds, 0x00080008)) && (!src || !/^DERIVED/.test(D.getString(src.ds, 0x00080008)));
  const edited_ = src ? [...src.ds.el.keys(), ...out.ds.el.keys()].filter((t, i, a) => a.indexOf(t) === i && !((t >>> 16) & 1) && t !== D.PIXEL && (() => {
    const a = src.ds.el.get(t), b = out.ds.el.get(t); if (!a || !b) return true; if (!a.value || !b.value) return false;
    return D.valueToText(a, false) !== D.valueToText(b, false);
  })()) : [];
  const r = await K.check(fs.readFileSync(edited), src, { removed, edited: edited_, pixelsChanged, xmlTag: src && (D.industrexInfo(src.ds) || {}).xmlTag });
  const mark = { pass: '✓', warn: '!', fail: '✗', info: 'i' };
  for (const c of r) console.log(` ${mark[c.level]} ${c.title}${c.detail ? ' — ' + c.detail : ''}`);
  const s = K.summary(r);
  console.log(`\n${s.fail ? s.fail + ' problem(s)' : 'No problems'}; ${s.pass} passed, ${s.warn} warning(s).`);
  process.exit(s.fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
