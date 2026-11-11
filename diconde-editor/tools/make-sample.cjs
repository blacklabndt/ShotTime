#!/usr/bin/env node
/* Writes the synthetic sample to disk. Usage: node tools/make-sample.cjs [out.dcm] */
'use strict';
const D = require('../dicom.js');
const { makeSample } = require('../sample.js');
if (require.main === module) {
  const out = process.argv[2] || 'sample-diconde.dcm';
  require('fs').writeFileSync(out, D.write(makeSample()));
  console.log('Wrote', out);
}
module.exports = { makeSample };
