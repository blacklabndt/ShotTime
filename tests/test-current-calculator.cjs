const assert=require('node:assert/strict'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json'),historical=require('../scripts/original-techniques.json');
const close=(a,b,tol=1e-12)=>assert.ok(Math.abs(a/b-1)<tol,a+' vs '+b);
const find=(size,schedule)=>data.techniques.find(t=>t.size===size&&t.schedule===schedule);
const steel=t=>2*t.wall*25.4,ref3=find(3,'40 / STD'),ref4=find(4,'40 / STD');
// Independent restatement of the model: inverse square for SFD, exposure doubles every 12.1 mm of total steel.
const scale=(t,r)=>(t.sfd/r.sfd)**2*2**((steel(t)-steel(r))/12.1);
assert.equal(data.techniques.length,73);assert.equal(C.STEEL_HVL_MM,12.1);
for(const [group,r] of [['small',ref3],['large',ref4]])assert.deepEqual(C.REFERENCE_GEOMETRY[group],{wall:r.wall,sfd:r.sfd});
// Large films: calculator targets on 4-inch STD at 26 Ci.
const large={d5:[11,15,19,23,27],t200:[14,18,22,25.5,29],ix80:[13,18,23,28,33]};
for(const [film,times] of Object.entries(large))C.DENSITIES.forEach((d,i)=>close(C.seconds(C.densityExposure(ref4,film,d),26),times[i]));
// Small films: large partner x published Ir-192 ratio at the same geometry (density 3), own density-curve shape.
const small={d4:['d5',3/1.5,[9,13,16,19.5,23]],mx125:['t200',2.8/1.7,[16,20,24,27.5,31]],ix50:['ix80',55/30,[17,21,25,29.5,34]]};
for(const [film,[partner,ratio,shape]] of Object.entries(small)){const density3=ratio*large[partner][2]*scale(ref3,ref4);
  C.DENSITIES.forEach((d,i)=>close(C.seconds(C.densityExposure(ref3,film,d),26),density3*shape[i]/shape[2]));}
assert.equal(C.timeLabel(C.seconds(C.densityExposure(ref3,'d4',3),26)),'22s');
assert.equal(C.timeLabel(C.seconds(C.densityExposure(find(3,'80 / XH'),'d4',3),60)),'12s');
assert.equal(C.timeLabel(C.seconds(C.densityExposure(find(4,'80 / XH'),'d5',3),60)),'11s');
// Every row follows the shared geometry model; all 1,095 combinations are finite and positive.
let count=0;
for(const t of data.techniques)for(const film of data.groups[t.group].films)for(const d of C.DENSITIES){
  const e=C.densityExposure(t,film,d),r=t.group==='small'?ref3:ref4;assert.ok(Number.isFinite(e)&&e>0);
  close(e,C.densityExposure(r,film,d)*scale(t,r),1e-9);assert.equal(C.seconds(e,52),C.seconds(e,26)/2);count++;}
assert.equal(count,1095);
// Same total steel at different sizes: exposure / SFD^2 is identical.
for(const film of ['d5','t200','ix80']){const a=find(8,'80 / XH'),b=find(16,'40 / XH');close(C.densityExposure(a,film,3)/a.sfd**2,C.densityExposure(b,film,3)/b.sfd**2);}
// Agfa films keep the shape of the historical Agfa-curve baseline (matched Agfa's own chart) within 4%.
for(const film of ['d4','d5']){const ratios=historical.techniques.filter(t=>film in t.exposures).map(t=>C.densityExposure(t,film,3)/t.exposures[film]).sort((a,b)=>a-b),mid=ratios[ratios.length>>1];
  for(const r of ratios)assert.ok(Math.abs(r/mid-1)<.04,film+' shape drift '+r/mid);}
assert.throws(()=>C.densityExposure(ref3,'d4',4.5));assert.throws(()=>C.densityExposure(ref4,'d4',3));assert.throws(()=>C.densityExposure(ref3,'d5',3));
for(const s of ['','0','-1','1e3','NaN','1000'])assert.equal(C.parseActivity(s),null);assert.equal(C.parseActivity('26,5'),26.5);assert.equal(C.timeLabel(.1),'0s');assert.equal(C.timeLabel(59.5),'1m 0s');assert.equal(C.timeLabel(3599.5),'1h 0m 0s');assert.equal(C.decay(26,'2026-09-29','2026-09-29'),26);assert.equal(C.decay(26,'2026-09-30','2026-09-29'),null);assert.equal(C.dayNumber('2026-02-30'),null);
console.log(`PASS: ${count} film/density combinations follow the shared steel model, 30 reference targets, published small/large film ratios, Agfa shape within 4%, inverse activity, rounding and date validation.`);
