'use strict';
const assert=require('assert');
const M=require('../scripts/cr-profile-model.cjs');
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a/b-1)<tol,`${a} vs ${b}`);

// Reference geometry returns K itself.
const p={name:'test',K:500,hvlMm:M.HVL_MM};
close(M.curieSeconds(M.REF.steelMm,M.REF.sfdIn,p),500);
// Same total steel and distance give the same time whether one wall or two.
close(M.shotSeconds(25.4,10,26,p),M.shotSeconds(2*12.7,10,26,p));
// Inverse square, inverse activity, one doubling per H of steel.
close(M.shotSeconds(20,10,26,p)/M.shotSeconds(20,5,26,p),4);
close(M.shotSeconds(20,10,13,p)/M.shotSeconds(20,10,26,p),2);
close(M.curieSeconds(20+M.HVL_MM,10,p)/M.curieSeconds(20,10,p),2);
assert.throws(()=>M.shotSeconds(20,10,0,p));
assert.throws(()=>M.curieSeconds(-1,10,p));

// Calibration recovers K from exact anchors at mixed geometry; spread is 1 when they agree.
const anchors=[[12,3,20],[30,10,40],[50,16,90]].map(([steelMm,sfdIn,activityCi])=>({steelMm,sfdIn,activityCi,seconds:M.shotSeconds(steelMm,sfdIn,activityCi,p)}));
const c=M.calibrate(anchors,{name:'PMT x'});
close(c.K,500);close(c.spread,1);assert.strictEqual(c.anchors,3);
assert.throws(()=>M.calibrate([]));
assert.throws(()=>M.calibrate([{steelMm:10,sfdIn:5,activityCi:20}]));
// Geometric mean: anchors 2x high and 2x low cancel.
const g=M.calibrate([{...anchors[0],seconds:anchors[0].seconds*2},{...anchors[1],seconds:anchors[1].seconds/2}]);
close(g.K,500);close(g.spread,4);
// Doubling the scanner gain halves the exposure needed; a 3x higher pixel target triples it.
close(M.rescale(p,{gainRatio:2}).K,250);close(M.rescale(p,{pixelRatio:3}).K,1500);
assert.throws(()=>M.rescale(p,{gainRatio:0}));

// fitChart recovers a synthetic two-setting chart exactly.
const synth=[];for(const [size,sfdIn,K] of [[4,4.625,600],[12,12.875,150]])for(const steelMm of [12,25,40])
  synth.push({size,sfdIn,steelMm,curieSeconds:K*M.geometry(steelMm,sfdIn,13.5)});
const f=M.fitChart(synth);close(f.hvlMm,13.5,1e-6);close(f.K['4'],600,1e-6);close(f.K['12'],150,1e-6);

// Owner's chart: a single fixed-gain curve cannot reproduce it; one setting per size with a shared
// steel curve can, and that curve is close to Ir-192 in steel. Pins HVL_MM to the chart fit.
const rows=M.chartRows().filter(r=>!M.SUSPECT.includes(r.key));
assert.strictEqual(rows.length,53);
const perSize=M.fitChart(rows);
assert.ok(Math.abs(perSize.hvlMm-M.HVL_MM)<0.05,`fitted H ${perSize.hvlMm}`);
// The app's CR steel curve is this fitted value.
assert.equal(require('../assets/calculator.js').CR_STEEL_HVL_MM,M.HVL_MM);
assert.ok(M.leaveOneOut(rows,r=>String(r.size)).median<0.08);
assert.ok(M.leaveOneOut(rows,()=>'all').median>0.4);
// Large pipes need several times the gain of small ones at the same pixel target.
assert.ok(perSize.K['2']/perSize.K['24']>6&&perSize.K['10']/perSize.K['24']<1.4);

console.log('cr-profile-model: all checks passed');
