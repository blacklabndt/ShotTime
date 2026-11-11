#!/usr/bin/env node
/* Inlines the scripts into one self-contained HTML file: dist/diconde-editor.html.
   Usage: node tools/build-single.cjs [out.html] */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'diconde-editor.html'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (_, f) => {
  const js = fs.readFileSync(path.join(root, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>/* ${f} */\n${js}</script>`;
});
if (/<script src=/.test(html)) throw new Error('A script was not inlined.');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
