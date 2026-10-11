const assert=require('node:assert/strict');
const C=require('../assets/calculator.js'),data=require('../assets/techniques.json');
const close=(actual,expected)=>assert.ok(Math.abs(actual/expected-1)<1e-12,actual+' versus '+expected);
assert.equal(typeof C.crExposure,'function','CR needs an independent total-steel exposure function');
close(C.crExposure(.474,4.625),480.48);
close(C.seconds(C.crExposure(.474,4.625),26),18.48);
let count=0;
for(const t of data.techniques.filter(C.withinSteelRange)){
  const steel=2*t.wall,cr=C.crExposure(steel,t.sfd);
  close(cr,C.customExposure(steel,t.sfd,'t200',3)*.7);
  close(C.crExposure(steel,t.sfd*2),cr*4);
  close(C.seconds(cr,52),C.seconds(cr,26)/2);
  count++;
}
assert.equal(count,109);
assert.ok(C.CUSTOM_FILMS.includes('cr70'));
assert.equal(C.usesDensity('cr70'),false);
for(const t of data.techniques.filter(C.withinSteelRange))for(const density of C.DENSITIES){
  close(C.densityExposure(t,'cr70',density),C.crExposure(t.wall*2,t.sfd));
  close(C.customExposure(t.wall*2,t.sfd,'cr70',density),C.crExposure(t.wall*2,t.sfd));
}
close(C.exposureAtDensity({wall:.237,sfd:4.625},'cr70',2.7),480.48);
assert.equal(C.internalSeconds('cr70',49),6);assert.equal(C.offsetSeconds('cr70',49),17);
assert.throws(()=>C.densityExposure({wall:.237,sfd:4.625},'cr70',5));
close(C.crExposure(2*.5,4),C.crExposure(1,4));
close(C.crExposure(1+12.1/25.4,4),C.crExposure(1,4)*2);
for(const [steel,sfd] of [[0,4],[-1,4],[NaN,4],[Infinity,4],[4,4],[1,0],[1,-1],[1,NaN],[1,Infinity],[1,Number.MAX_VALUE]])assert.throws(()=>C.crExposure(steel,sfd));
// A later T200 reference adjustment must not silently change CR's independent baseline.
const original=[...C.REFERENCE_CURIE_SECONDS.t200],before=C.crExposure(1,24);
try{C.REFERENCE_CURIE_SECONDS.t200.fill(9999);close(C.crExposure(1,24),before);}finally{C.REFERENCE_CURIE_SECONDS.t200.splice(0,original.length,...original);}
assert.equal(C.REFERENCE_CURIE_SECONDS.t200[2],686.4);
console.log('PASS: independent CR reference, 70% of T200 density 3 across 109 geometries, inverse square, activity, total steel and invalid inputs.');
