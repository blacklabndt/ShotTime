const assert=require('node:assert/strict'),crypto=require('node:crypto');
const assets=require('../assets/code-chart-images.json'),manifest=require('../docs/code-chart-vector-manifest.json');
assert.equal(manifest.length,17);
for(const record of manifest){
 const asset=assets['hq:'+record.figure];assert.ok(asset,record.figure);
 assert.ok(asset.href.startsWith('data:image/svg+xml;base64,'));
 const svg=Buffer.from(asset.href.split(',')[1],'base64').toString();assert.doesNotMatch(svg,/<(?:image|script|foreignObject)\b/);assert.ok(svg.includes('<path'));assert.equal(asset.themed,true);assert.equal(crypto.createHash('sha256').update(svg).digest('hex'),record.svgSha256);assert.equal(record.geometryPreserved,true);assert.equal(record.rasterImages,0);
 assert.equal(asset.viewBox,`0 0 ${asset.width} ${asset.height}`);assert.ok(asset.width>asset.height);assert.match(asset.source,/original vector artwork/);
}
const ix=assets['hq:QW-191.1.2.2(b)(4)'],record=require('../docs/code-chart-ix-vector.json');assert.ok(ix.href.startsWith('data:image/svg+xml;base64,'));
const vector=Buffer.from(ix.href.split(',')[1],'base64');assert.equal(crypto.createHash('sha256').update(vector).digest('hex'),record.svgSha256);
assert.deepEqual(ix.viewBoxes,record.viewBoxes);assert.equal(ix.viewBoxes.length,4);assert.equal(ix.themed,true);assert.doesNotMatch(vector.toString(),/<(?:image|script|foreignObject)\b/);assert.equal(record.rasterImages,0);assert.equal(record.drawingPaths,254);

console.log('PASS: 17 original vector chart assets, dimensions, rotation, geometry hashes and original IX vector artwork');
