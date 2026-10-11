const assert=require('node:assert/strict'),C=require('../assets/calculator.js');
for(const film of Object.keys(C.FILM_REFERENCES)){const ref=C.FILM_REFERENCES[film],g=C.REFERENCE_GEOMETRY[ref.group];for(const d of C.DENSITIES){assert.equal(C.customExposure(g.wall*2,g.sfd,film,d),C.densityExposure({...g,group:ref.group},film,d));const a=C.customExposure(1,36,film,d);assert.ok(Math.abs(C.customExposure(1,72,film,d)/a-4)<1e-10);assert.ok(Math.abs(C.customExposure(1+12.1/25.4,36,film,d)/a-2)<1e-10);}}
for(const args of [[0,36,'t200',3],[4,36,'t200',3],[1,0,'t200',3],[NaN,36,'t200',3],[1,Infinity,'t200',3],[1,36,'cr',3],[1,36,'t200',5]])assert.throws(()=>C.customExposure(...args));
console.log('PASS: custom geometry matches existing model, inverse square, total-steel HVL and invalid/CR rejection');

for(const density of C.DENSITIES)for(const [steel,sfd] of [[1,36],[.5,24],[2,48]])assert.equal(C.customExposure(steel,sfd,'d7',density),C.customExposure(steel,sfd,'d5',density)/1.5);
assert.ok(C.CUSTOM_FILMS.includes('d7'));assert.throws(()=>C.customExposure(1,36,'d7',5));
console.log('PASS: custom-only D7 uses published 1.0/1.5 ratio across densities and geometry');
