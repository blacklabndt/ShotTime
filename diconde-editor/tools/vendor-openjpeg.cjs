#!/usr/bin/env node
/* Copies the OpenJPEG WebAssembly codec into vendor/openjpeg/ for offline use.
   Usage: npm pack @cornerstonejs/codec-openjpeg@1.3.6 && tar xzf cornerstonejs-codec-openjpeg-1.3.6.tgz
          node tools/vendor-openjpeg.cjs package/
   The .wasm is embedded as base64 because browsers will not fetch a .wasm file from a file:// page. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const src = process.argv[2];
if (!src) { console.error('Usage: node tools/vendor-openjpeg.cjs <extracted package dir>'); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
if (pkg.name !== '@cornerstonejs/codec-openjpeg') throw new Error('Unexpected package ' + pkg.name);
const out = path.resolve(__dirname, '..', 'vendor', 'openjpeg');
fs.mkdirSync(out, { recursive: true });
const js = fs.readFileSync(path.join(src, 'dist', 'openjpegwasm.js'));
const wasm = fs.readFileSync(path.join(src, 'dist', 'openjpegwasm.wasm'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(out, 'openjpegwasm.js'), js);
fs.writeFileSync(path.join(out, 'openjpegwasm-binary.js'),
  `/* ${pkg.name} ${pkg.version} dist/openjpegwasm.wasm, base64. sha256 ${sha(wasm)} */\n` +
  `(typeof self !== 'undefined' ? self : globalThis).OPENJPEG_WASM_BASE64 = '${wasm.toString('base64')}';\n` +
  `if (typeof module === 'object' && module.exports) module.exports = (typeof self !== 'undefined' ? self : globalThis).OPENJPEG_WASM_BASE64;\n`);
fs.writeFileSync(path.join(out, 'VERSION.json'), JSON.stringify({ package: pkg.name, version: pkg.version, openjpeg: '2.5.4',
  files: { 'dist/openjpegwasm.js': sha(js), 'dist/openjpegwasm.wasm': sha(wasm) } }, null, 2) + '\n');
console.log(`Vendored ${pkg.name} ${pkg.version}: js ${sha(js).slice(0, 12)}…, wasm ${sha(wasm).slice(0, 12)}…`);
