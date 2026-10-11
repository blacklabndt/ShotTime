const assert=require('node:assert/strict'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json'),historical=require('../scripts/original-techniques.json');
const close=(a,b,tol=1e-12)=>assert.ok(Math.abs(a/b-1)<tol,a+' vs '+b);
const find=(size,schedule)=>data.techniques.find(t=>t.size===size&&t.schedule===schedule);
const steel=t=>2*t.wall*25.4,ref3=find(3,'40 / STD'),ref4=find(4,'40 / STD');
// Independent restatement of the model: inverse square for SFD, exposure doubles every 12.1 mm of total steel.
const scale=(t,r)=>(t.sfd/r.sfd)**2*2**((steel(t)-steel(r))/12.1);
assert.equal(data.techniques.length,114);
// Geometry: SFD rule (12 in for 1-inch, else OD + 0.125 in), ASME B36.10M walls for the sizes and Sch 10 added in 1.21.0.
const OD={1:1.315,2:2.375,3:3.5,4:4.5,5:5.563,6:6.625,8:8.625,10:10.75,12:12.75,14:14,16:16,18:18,20:20,24:24};
for(const t of data.techniques){assert.ok(Math.abs(t.sfd-(t.size===1?12:OD[t.size]+.125))<1e-9,t.size+' '+t.schedule);assert.equal(t.group,t.size<=3?'small':'large');}
assert.equal(new Set(data.techniques.map(t=>t.size+'|'+t.schedule)).size,114);
const b3610={'1|10':.109,'2|10':.109,'3|10':.12,'4|10':.12,'5|10':.134,'6|10':.134,'8|10':.148,'10|10':.165,'12|10':.18,'14|10':.25,'16|10':.25,
  '18|10':.25,'18|STD':.375,'18|XH':.5,'18|40':.562,'18|60':.75,'18|80':.938,'18|100':1.156,'18|120':1.375,'18|140':1.562,'18|160':1.781,
  '20|10':.25,'20|STD':.375,'20|XH':.5,'20|40':.594,'20|60':.812,'20|80':1.031,'20|100':1.281,'20|120':1.5,'20|140':1.75,'20|160':1.969,
  '24|10':.25,'24|STD':.375,'24|XH':.5,'24|40':.688,'24|60':.969,'24|80':1.219,'24|100':1.531,'24|120':1.812,'24|140':2.062,'24|160':2.344};
for(const [key,wall] of Object.entries(b3610)){const [size,schedule]=key.split('|');assert.equal(find(+size,schedule).wall,wall,key);}
// Rows over 90 mm total steel are outside the model's range (hidden by the app).
assert.equal(C.MAX_STEEL_MM,90);assert.deepEqual(data.techniques.filter(t=>!C.withinSteelRange(t)).map(t=>t.size+' '+t.schedule),['18 160','20 160','24 120','24 140','24 160']);
// Every original row keeps its geometry, except truncated walls corrected to ASME B36.10M (e.g. 0.437 -> 0.438).
const corrected={.437:.438,.593:.594,.687:.688,.718:.719,.843:.844,.937:.938,1.093:1.094,1.218:1.219,1.437:1.438,1.593:1.594};
let correctedRows=0;for(const o of historical.techniques){const t=find(o.size,o.schedule),wall=corrected[o.wall]??o.wall;if(wall!==o.wall)correctedRows++;assert.ok(t&&t.wall===wall&&t.sfd===o.sfd&&t.group===o.group,o.size+' '+o.schedule);}
assert.equal(correctedRows,17);assert.ok(data.techniques.every(t=>!(t.wall in corrected)));assert.ok(data.techniques.every(t=>Object.keys(t).join()==='size,schedule,wall,sfd,group'));assert.equal(C.STEEL_HVL_MM,12.1);
for(const [group,r] of [['small',ref3],['large',ref4]])assert.deepEqual(C.REFERENCE_GEOMETRY[group],{wall:r.wall,sfd:r.sfd});
// Large films: calculator targets on 4-inch STD at 26 Ci.
const large={d5:[11,15,19,23,27],t200:[14,18,22,25.5,29],ix80:[13,18,23,28,33]};
for(const [film,times] of Object.entries(large))C.DENSITIES.forEach((d,i)=>close(C.seconds(C.densityExposure(ref4,film,d),26),times[i]));
// Small films: large partner x published Ir-192 ratio at the same geometry and every density (same-hanger pairs).
const small={d4:['d5',3/1.5],mx125:['t200',2.8/1.7],ix50:['ix80',55/30]};
for(const [film,[partner,ratio]] of Object.entries(small)){C.DENSITIES.forEach((d,i)=>close(C.seconds(C.densityExposure(ref3,film,d),26),ratio*large[partner][i]*scale(ref3,ref4)));
  for(const t of data.techniques.filter(t=>t.group==='small'))C.DENSITIES.forEach(d=>close(C.densityExposure(t,film,d),ratio*C.densityExposure(ref4,partner,d)*scale(t,ref4),1e-9));}
assert.equal(C.timeLabel(C.seconds(C.densityExposure(ref3,'d4',3),26)),'22s');
assert.equal(C.timeLabel(C.seconds(C.densityExposure(find(3,'80 / XH'),'d4',3),60)),'12s');
assert.equal(C.timeLabel(C.seconds(C.densityExposure(find(4,'80 / XH'),'d5',3),60)),'11s');
// Every row follows the shared geometry model; all 1,710 combinations are finite and positive.
let count=0;
for(const t of data.techniques)for(const film of data.groups[t.group].films.filter(C.usesDensity))for(const d of C.DENSITIES){
  const e=C.densityExposure(t,film,d),r=t.group==='small'?ref3:ref4;assert.ok(Number.isFinite(e)&&e>0);
  close(e,C.densityExposure(r,film,d)*scale(t,r),1e-9);assert.equal(C.seconds(e,52),C.seconds(e,26)/2);count++;}
assert.equal(count,1710);
// Same total steel at different sizes: exposure / SFD^2 is identical.
for(const film of ['d5','t200','ix80']){const a=find(8,'80 / XH'),b=find(16,'40 / XH');close(C.densityExposure(a,film,3)/a.sfd**2,C.densityExposure(b,film,3)/b.sfd**2);}
// Agfa films keep the shape of the historical Agfa-curve baseline (matched Agfa's own chart) within 4%.
for(const film of ['d4','d5']){const ratios=historical.techniques.filter(t=>film in t.exposures).map(t=>C.densityExposure(t,film,3)/t.exposures[film]).sort((a,b)=>a-b),mid=ratios[ratios.length>>1];
  for(const r of ratios)assert.ok(Math.abs(r/mid-1)<.04,film+' shape drift '+r/mid);}
// Film curve between target densities: exact at the five targets, log-linear between them, refused outside 2.0-4.0.
for(const film of ['d4','d5','ix80'])for(const t of [ref3,ref4].filter(t=>data.groups[t.group].films.includes(film))){C.DENSITIES.forEach(d=>close(C.exposureAtDensity(t,film,d),C.densityExposure(t,film,d)));
  close(C.exposureAtDensity(t,film,2.75),Math.sqrt(C.densityExposure(t,film,2.5)*C.densityExposure(t,film,3)));assert.ok(C.exposureAtDensity(t,film,2.7)>C.densityExposure(t,film,2.5)&&C.exposureAtDensity(t,film,2.7)<C.densityExposure(t,film,3));}
for(const d of [1.99,4.01,NaN])assert.throws(()=>C.exposureAtDensity(ref3,'d4',d));
assert.throws(()=>C.densityExposure(ref3,'d4',4.5));assert.throws(()=>C.densityExposure(ref4,'d4',3));assert.throws(()=>C.densityExposure(ref3,'d5',3));
// Carestream CR formula: Ci·s = 523 × 2^((41 − PMT) ÷ 7.5) × (SFD ÷ 4.625)² × 2^((steel − 4" STD steel) ÷ 14.8 mm),
// every row, both belts, same at every density, PMT defaults to the size's suggested setting.
const crRef=0.237*25.4;close(C.crExposure(2*crRef,4.625,41),523);close(C.densityExposure(ref4,'cr',3),523);
for(const t of data.techniques.filter(C.withinSteelRange))for(const pmt of [C.crPmtRange(t.size).min,C.crSuggestedPmt(t.size),C.crPmtRange(t.size).max]){
  const want=523*Math.pow(2,(41-pmt)/7.5)*Math.pow(t.sfd/4.625,2)*Math.pow(2,(2*t.wall*25.4-2*crRef)/14.8);
  for(const d of C.DENSITIES)close(C.densityExposure(t,'cr',d,pmt),want);close(C.exposureAtDensity(t,'cr',2.7,pmt),want);}
for(const t of data.techniques)close(C.densityExposure(t,'cr',3),C.densityExposure(t,'cr',3,C.crSuggestedPmt(t.size)));
// Same steel and distance give the same exposure; +7.5 PMT halves it; distance squared; steel doubles every 14.8 mm.
close(C.crExposure(25.4,10,50),C.crExposure(2*12.7,10,50));close(C.crExposure(25.4,10,50)/C.crExposure(25.4,10,57.5),2);close(C.crExposure(25.4,20,50)/C.crExposure(25.4,10,50),4);close(C.crExposure(25.4+14.8,10,50)/C.crExposure(25.4,10,50),2);
assert.throws(()=>C.crExposure(0,10,50));assert.throws(()=>C.crExposure(20,10,NaN));
// Slider ranges: 1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70; whole numbers only; suggested PMT inside the range.
const ranges={1:[20,50],2:[20,50],3:[20,50],4:[30,60],5:[30,60],6:[30,60],8:[30,60],10:[40,70],12:[40,70],14:[40,70],16:[40,70],18:[40,70],20:[40,70],24:[40,70]};
for(const [size,[min,max]] of Object.entries(ranges)){const r=C.crPmtRange(Number(size));assert.deepEqual([r.min,r.max],[min,max],size);assert.ok(C.validPmt(Number(size),min)&&C.validPmt(Number(size),max)&&!C.validPmt(Number(size),min-1)&&!C.validPmt(Number(size),max+1)&&!C.validPmt(Number(size),min+.5)&&!C.validPmt(Number(size),String(min)));
  assert.ok(C.validPmt(Number(size),C.crSuggestedPmt(Number(size))));}
// Sizes not in the table get the middle of their range; a missing or invalid size is refused, not a TypeError.
assert.equal(C.crSuggestedPmt(7),45);for(const size of [undefined,NaN,0,-1,'4'])assert.throws(()=>C.crSuggestedPmt(size),/Unsupported pipe size/);for(const size of [undefined,NaN,0])assert.equal(C.validPmt(size,41),false);
assert.throws(()=>C.densityExposure({...ref4,size:undefined},'cr',3),/Unsupported pipe size/);
// An explicit PMT must be a whole number in the size's range; undefined means the suggested setting.
for(const pmt of [29,61,41.5,0,-1000,'41',null,NaN])assert.throws(()=>C.densityExposure(ref4,'cr',3,pmt),/PMT|Unsupported/);
assert.deepEqual(data.techniques.map(t=>t.size).filter((v,i,a)=>a.indexOf(v)===i).map(C.crSuggestedPmt),[35,35,38,41,44,46,52,54,55,55,55,56,56,57]);
// At the suggested PMT the formula reproduces the former chart (scripts/cr-chart.json): median within 7%, no bias,
// every row within 35% except the three entries that disagree with their own size (6" XXH, 24" XH, 14" Sch 40).
const crChart=require('../scripts/cr-chart.json').exposures,crDiff=[];
for(const [key,cs] of Object.entries(crChart)){const t=data.techniques.find(t=>t.size+'|'+t.schedule===key);const d=C.densityExposure(t,'cr',3)/cs-1;if(['6|XXH / XXS','24|XH','14|40'].includes(key))continue;assert.ok(Math.abs(d)<.35,key+' '+d);crDiff.push(d);}
assert.equal(crDiff.length,53);const crAbs=crDiff.map(Math.abs).sort((a,b)=>a-b);assert.ok(crAbs[26]<.07);assert.equal(crAbs.filter(d=>d<=.2).length,51);assert.ok(Math.abs(crDiff.reduce((a,b)=>a+b,0)/53)<.02);
assert.equal(Object.keys(crChart).length,56);assert.equal(C.CHART_EXPOSURES,undefined);
for(const group of ['small','large'])assert.ok(data.groups[group].films.includes('cr'));assert.equal(C.usesDensity('cr'),false);assert.ok(['d4','d5','mx125','t200','ix50','ix80'].every(C.usesDensity));
assert.throws(()=>C.densityExposure(ref4,'cr',4.5));assert.equal(C.timeLabel(C.seconds(C.densityExposure(ref4,'cr',3),26)),'20s');
// Internal / offset: CR ÷8 nearest and ÷3 rounded up; films ÷9 nearest and ×1.15÷4 rounded up.
assert.equal(C.internalSeconds('cr',49),6);assert.equal(C.offsetSeconds('cr',49),17);assert.equal(C.offsetSeconds('cr',48),16);
assert.equal(C.internalSeconds('d5',49),5);assert.equal(C.offsetSeconds('d5',49),15);assert.equal(C.internalSeconds('d5',90),10);assert.equal(C.offsetSeconds('d5',90),26);
for(const s of ['','0','-1','1e3','NaN','1000'])assert.equal(C.parseActivity(s),null);assert.equal(C.parseActivity('26,5'),26.5);assert.equal(C.timeLabel(.1),'0s');assert.equal(C.timeLabel(59.5),'1m 0s');assert.equal(C.timeLabel(3599.5),'1h 0m 0s');assert.equal(C.decay(26,'2026-09-29','2026-09-29'),26);assert.equal(C.decay(26,'2026-09-30','2026-09-29'),null);assert.equal(C.dayNumber('2026-02-30'),null);
console.log(`PASS: ${count} film/density combinations follow the shared steel model, 30 reference targets, published small/large film ratios at every density, Agfa shape within 4%, B36.10M walls, film-curve interpolation, inverse activity, rounding and date validation; Carestream CR formula on every row in both belts, PMT ranges and suggested settings, and agreement with the former CR chart.`);
