const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../assets/calculator.js');
const {techniques}=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/techniques.json')));
assert.equal(techniques.length,73);
for(const value of ['', '0','-1','NaN','Infinity','1e3','1000','1,000.0','50abc'])assert.equal(C.parseActivity(value),null,value);
assert.equal(C.parseActivity('50,5'),50.5);assert.equal(C.parseActivity(' 50.5 '),50.5);
assert.equal(C.timeLabel(59.96),'1m 0s');assert.equal(C.timeLabel(3599.96),'1h 0m 0s');assert.equal(C.timeLabel(88.82),'1m 29s');
assert.equal(C.timeLabel(4.06),'4s');assert.equal(C.timeLabel(.01),'0s');
for(const t of techniques){
 assert.ok(t.curieSeconds>0&&t.sfd>0&&t.wall>0);
 for(const ci of [.1,1,50,87.4,999.9])assert.equal(C.seconds(t.curieSeconds,ci),t.curieSeconds/ci);
 assert.equal(C.matchesSchedule(t,'all'),true);
}
assert.ok(Math.abs(techniques.find(t=>t.size===1&&t.schedule==='40 / STD').curieSeconds-4595.16654112642)<1e-8);
assert.ok(Math.abs(techniques.find(t=>t.size===16&&t.schedule==='160').curieSeconds-188215.75243020922)<1e-8);
assert.equal(C.timeLabel(C.seconds(140000,50)),'46m 40s');
console.log('Calculator: 73 records, 365 activity conversions, parsing and time carry checks passed.');

for(const t of techniques){assert.equal(Object.keys(t.exposures).length,3);for(const cs of Object.values(t.exposures)){assert.ok(Number.isFinite(cs)&&cs>0);assert.equal(C.seconds(cs,50),cs/50);assert.equal(C.seconds(cs,100),C.seconds(cs,50)/2);}}
console.log('All 219 film exposures are positive and scale inversely with activity.');

for(const [value,label] of [[4.49,'4s'],[4.5,'5s'],[59.49,'59s'],[59.5,'1m 0s'],[3599.5,'1h 0m 0s']])assert.equal(C.timeLabel(value),label);
assert.equal(C.decay(100,'2026-01-01','2026-01-01'),100);
assert.ok(Math.abs(C.decay(100,'2026-01-01','2026-03-16')-100*2**(-74/73.83))<1e-12);
assert.equal(C.decay(100,'2026-02-30','2026-03-16'),null);
assert.equal(C.decay(100,'2026-03-16','2026-01-01'),null);
assert.equal(C.dayNumber('2024-03-01')-C.dayNumber('2024-02-28'),2);
for(const t of techniques)for(const film of Object.keys(t.exposures)){
 const estimates=[2,2.5,3,3.5].map(d=>C.densityExposure(t,film,d));
 assert.equal(estimates[2],t.exposures[film]);
 assert.ok(estimates.every((n,i)=>Number.isFinite(n)&&n>0&&(i===0||n>estimates[i-1])));
}
assert.equal(C.R_FACTORS.mx125[0],3);
assert.equal(C.R_FACTORS.t200[3],2.7);
assert.throws(()=>C.densityExposure(techniques[0],'ix50',4));
console.log('PASS: all 219 film techniques at four densities, exact density-3 retention, R-factor reference checks.');
