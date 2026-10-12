const assert=require('node:assert/strict');
const M=require('../scripts/cr-calibrated-model.cjs'),C=require('../assets/calculator.js');
const close=(a,b)=>assert.ok(Math.abs(a/b-1)<1e-10,a+' versus '+b);
const before=JSON.stringify({films:C.FILM_REFERENCES,chart:C.CHART_EXPOSURES});
assert.equal(typeof M.fit,'function','CR needs a geometry-independent calibration fit');
const refs=[
  {id:'thin',totalSteel:.474,sfd:4.625,ciSeconds:343.2},
  {id:'thick',totalSteel:.474+12.1/25.4,sfd:9.25,ciSeconds:2745.6}
];
const profile=M.fit(refs);
close(M.baseline({totalSteel:.474,sfd:4.625}),686.4);
close(M.shot({totalSteel:.474,sfd:4.625},26,profile).seconds,13.2);
for(const totalSteel of [.3,.5,1,2,3]){
  const a=M.predict({totalSteel,sfd:24},profile);
  close(a.ciSeconds,C.customExposure(totalSteel,24,'t200',3)*.5);
  close(M.predict({totalSteel,sfd:48},profile).ciSeconds,a.ciSeconds*4);
  close(M.shot({totalSteel,sfd:24},52,profile).seconds,M.shot({totalSteel,sfd:24},26,profile).seconds/2);
  close(M.predict({totalSteel,sfd:24,size:2,schedule:'XH',wallCount:1},profile).ciSeconds,
    M.predict({totalSteel,sfd:24,size:24,schedule:'STD',wallCount:2},profile).ciSeconds);
}
// Independent detector curve: dose doubles per inch of total steel.
const differentSlope=M.fit([
  {id:'a',totalSteel:.5,sfd:10,ciSeconds:100},
  {id:'b',totalSteel:1.5,sfd:10,ciSeconds:200}
]);
close(M.predict({totalSteel:1,sfd:20},differentSlope).ciSeconds,Math.sqrt(100*200)*4);
assert.equal(M.predict({totalSteel:1,sfd:20},differentSlope).extrapolated,false);
assert.equal(M.predict({totalSteel:.25,sfd:20},differentSlope).extrapolated,true);
assert.ok(M.predict({totalSteel:1.5,sfd:10},differentSlope).ciSeconds>M.predict({totalSteel:.5,sfd:10},differentSlope).ciSeconds);
const single=M.fit([refs[0]]);
close(M.predict({totalSteel:.474+12.1/25.4,sfd:4.625},single).ciSeconds,686.4);
assert.equal(single.attenuationCalibrated,false);
assert.throws(()=>M.fit([
  {id:'a',totalSteel:.5,sfd:10,ciSeconds:200},
  {id:'b',totalSteel:1.5,sfd:10,ciSeconds:100}
]),/decreases with total steel/);
assert.throws(()=>M.fit([]));
assert.throws(()=>M.fit([{...refs[0],ciSeconds:0}]));
assert.throws(()=>M.fit([{...refs[0],sfd:0}]));
assert.throws(()=>M.fit([refs[0],{...refs[1],id:'thin'}]),/Duplicate/);
assert.throws(()=>M.predict({wall:.5,size:8,sfd:24},profile),/total steel/i);
assert.throws(()=>M.predict({totalSteel:0,sfd:24},profile));
assert.throws(()=>M.predict({totalSteel:1,sfd:Infinity},profile));
assert.equal(M.predict({totalSteel:4,sfd:24},profile).ciSeconds,null);
for(const activity of [0,-1,1000,NaN])assert.throws(()=>M.shot({totalSteel:1,sfd:24},activity,profile));
const chart=M.calibrationRows();
assert.equal(chart.length,53);
assert.ok(chart.every(r=>!M.EXCLUDED_KEYS.includes(r.id)));
const fitted=M.fit(chart);
assert.ok(fitted.diagnostics.maxAbsolutePercent>100,'Chart inconsistency must remain visible');
assert.ok(M.predict({totalSteel:1,sfd:24},fitted).flags.includes('inconsistent-reference-data'));
assert.equal(M.predict({totalSteel:1,sfd:24},fitted).status,'research-estimate');
assert.equal(JSON.stringify({films:C.FILM_REFERENCES,chart:C.CHART_EXPOSURES}),before);
console.log('PASS: total-steel CR fit, independent dose curve, no size/wall-count dependency, distance/activity scaling, invalid calibration rejection, explicit chart conflicts and unchanged film data.');
