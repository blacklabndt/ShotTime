'use strict';
// Carestream CR (calibrated): physics plus the owner's own reference shots and measured scanner gain.
const assert=require('node:assert/strict'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json'),F=require('./fixtures/film-outputs-1.96.json');
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a/b-1)<tol,`${a} vs ${b}`);

// Every remaining film gives exactly the 1.96 outputs (T200 included, with its +20%). The CR chart is the owner's Carestream
// sheet as in 1.96 except three corrected cells: 24" XH 6,390 and 14" Sch 40 2,060 (copied from the wrong Fuji column) and
// 6" XXH 2,327 (the sheet's +30% on 2"-6", missed on that one cell). Every other chart row is unchanged.
// CR Formula (cr70, 70% of T200) was removed in 1.97 and is refused everywhere.
// Serialized Math.pow results can differ by one ULP between JS runtimes; use a 1e-12 relative tolerance.
let kept=0;for(const [key,value] of Object.entries(F.densityExposure)){const [size,schedule,film,d]=key.split('|');if(film==='cr70')continue;kept++;const t=data.techniques.find(t=>String(t.size)===size&&t.schedule===schedule);const k=size+'|'+schedule;
  const want=film!=='cr'||value===null?value:k==='24|XH'?6390:k==='14|40'?2060:k==='6|XXH / XXS'?2327:value;assert.ok(want===null?C.densityExposure(t,film,Number(d))===null:Math.abs(C.densityExposure(t,film,Number(d))/want-1)<1e-12,key);}
for(const [key,value] of Object.entries(F.customExposure)){const [film,steel,sfd,d]=key.split('|');if(film==='cr70'){assert.throws(()=>C.customExposure(Number(steel),Number(sfd),film,Number(d)));continue;}assert.ok(Math.abs(C.customExposure(Number(steel),Number(sfd),film,Number(d))/value-1)<1e-12,key);}
for(const [key,value] of Object.entries(F.internal)){const [film,s]=key.split('|');if(film==='cr70')continue;assert.equal(C.internalSeconds(film,Number(s)),value);assert.equal(C.offsetSeconds(film,Number(s)),F.offset[key]);}
assert.equal(Object.keys(F.densityExposure).length,2825);assert.equal(kept,2280);
for(const t of data.techniques)assert.throws(()=>C.densityExposure(t,'cr70',3));assert.ok(!C.CUSTOM_FILMS.includes('cr70'));assert.equal(C.crExposure,undefined);assert.equal(C.CR_REFERENCE,undefined);
for(const g of ['small','large'])assert.ok(!data.groups[g].films.includes('cr70'));assert.equal(data.films.cr70,undefined);

// Cleaning: valid entries kept, invalid ones dropped and counted, never repaired.
const shot=(o={})=>({totalSteel:.5,sfd:10,activity:20,seconds:60,pmt:40,...o});
let cal=C.crCleanCalibration({shots:[shot(),shot({pmt:40.5}),shot({totalSteel:4}),shot({activity:0}),shot({pixel:2000,offset:2500}),shot({note:'x'.repeat(81)}),null],gain:[{pmt:40,signal:3000,offset:100},{pmt:40,signal:5000,offset:100},{pmt:50,signal:90,offset:100}],hvlMm:40,targetPixel:-1});
assert.equal(cal.shots.length,1);assert.equal(cal.gain.length,1);assert.equal(cal.hvlMm,null);assert.equal(cal.targetPixel,null);assert.equal(cal.dropped,10);
assert.deepEqual(C.crCleanCalibration(null),{shots:[],gain:[],hvlMm:null,targetPixel:null,dropped:0});
assert.equal(C.crCleanCalibration({shots:Array(60).fill(shot())}).shots.length,60);

// Plate exposure model: Ci·s = R × (SFD m)² × 3600 ÷ 0.48 × 2^(steel mm ÷ H), H 14.5 mm by default (from the owner's
// Carestream chart). Starting R per pipe size from that chart (5 R at 2" down to 0.65 R at 24"). Slider 0.5–12 R.
assert.equal(C.CR_DOSE.minR,.5);assert.equal(C.CR_DOSE.maxR,12);assert.equal(C.CR_DOSE.stepR,.05);assert.equal(C.CR_DOSE.gamma,.48);assert.equal(C.CR_DEFAULT_HVL_MM,14.5);
assert.deepEqual(C.CR_DOSE.starts,{1:5,2:5,3:3.65,4:2.8,5:2.15,6:1.6,8:1.05,10:.85,12:.75,14:.75,16:.75,18:.7,20:.7,24:.65});
for(const [size,r] of [[1,5],[2,5],[4,2.8],[5,2.15],[8,1.05],[10,.85],[18,.7],[24,.65]])assert.equal(C.crStartDose(size),r);for(const s of [0,NaN,undefined,7,2.5,30])assert.throws(()=>C.crStartDose(s));
assert.deepEqual([...new Set(data.techniques.map(t=>t.size))].sort((a,b)=>a-b),Object.keys(C.CR_DOSE.starts).map(Number).sort((a,b)=>a-b));
// Each start is the geometric mean plate exposure of that size's chart rows at H = 14.5 mm (to 0.05 R); 1" uses 2", 5" and 18" their neighbours.
{const gm=a=>Math.exp(a.reduce((s,x)=>s+Math.log(x),0)/a.length),R=t=>C.crShotDose({totalSteel:2*t.wall,sfd:t.sfd,activity:1,seconds:C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]},C.crCleanCalibration({})),g={};
 for(const s of [2,3,4,6,8,10,12,14,16,20,24]){const rows=data.techniques.filter(t=>t.size===s&&C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]!=null);assert.ok(rows.length>=4,s);g[s]=gm(rows.map(R));}
 g[1]=g[2];g[5]=Math.sqrt(g[4]*g[6]);g[18]=Math.sqrt(g[16]*g[20]);for(const s in g)assert.ok(Math.abs(Math.round(g[s]/.05)*.05-C.crStartDose(Number(s)))<1e-9,s);}
cal=C.crCleanCalibration({});const sfdM=10*.0254;
close(C.crDoseExposure(.5,10,1,cal),1*sfdM*sfdM*3600/.48*Math.pow(2,.5*25.4/14.5));
close(C.crDoseExposure(.5,10,2,cal)/C.crDoseExposure(.5,10,1,cal),2);close(C.crDoseExposure(.5,20,1,cal)/C.crDoseExposure(.5,10,1,cal),4);
close(C.crDoseExposure(.5+14.5/25.4,10,1,cal)/C.crDoseExposure(.5,10,1,cal),2);close(C.crDoseExposure(1,10,1,cal),C.crDoseExposure(2*.5,10,1,cal));
close(C.crDoseExposure(.5+16/25.4,10,1,C.crCleanCalibration({hvlMm:16}))/C.crDoseExposure(.5,10,1,C.crCleanCalibration({hvlMm:16})),2);
for(const r of [.49,12.01,0,NaN,'1',null,undefined])assert.throws(()=>C.crDoseExposure(.5,10,r,cal),/0\.5 to 12 R/);for(const r of [.5,1,3,4.3,6,8.4,12])assert.ok(C.validDose(r));
const ref4=data.techniques.find(t=>t.size===4&&t.schedule==='40 / STD');
close(C.densityExposure(ref4,'crcal',3,{doseR:1,calibration:cal}),C.crDoseExposure(2*.237,4.625,1,cal));close(C.densityExposure(ref4,'crcal',2,{doseR:1.5,calibration:cal}),1.5*C.crDoseExposure(2*.237,4.625,1,cal));
assert.throws(()=>C.densityExposure(ref4,'crcal',3));assert.throws(()=>C.densityExposure(ref4,'crcal',3,{calibration:cal}));
close(C.customExposure(.5,10,'crcal',3,{doseR:1,calibration:cal}),C.crDoseExposure(.5,10,1,cal));assert.throws(()=>C.customExposure(.5,10,'crcal',3),/needs a plate exposure/);
// At 26 Ci and the per-size starts (chart in brackets): 2" XH 10s (11s), 4" STD 20s (25s), 8" STD 33s (38s), 10" STD 45s (52s), 12" Sch 160 9m 20s (9m 47s), 24" STD 2m 55s (2m 54s).
for(const [s,sch,label] of [[2,'80 / XH','10s'],[4,'40 / STD','20s'],[8,'40 / STD','33s'],[10,'40 / STD','45s'],[12,'160','9m 20s'],[24,'STD','2m 55s']]){const t=data.techniques.find(t=>t.size===s&&t.schedule===sch);assert.equal(C.timeLabel(C.seconds(C.densityExposure(t,'crcal',3,{doseR:C.crStartDose(s),calibration:cal}),26)),label,s+' '+sch);}
// A reference shot's plate exposure by the same physics; the suggestion from shots at a PMT (no shots: none).
let shotDose=C.crShotDose({totalSteel:.5,sfd:10,activity:26,seconds:C.crDoseExposure(.5,10,1.3,cal)/26},cal);close(shotDose,1.3);
assert.equal(C.crSuggestedDose(cal,40).doseR,null);assert.equal(C.crSuggestedDose(cal,40).reason,'no reference shots');
let sugg=C.crSuggestedDose(C.crCleanCalibration({shots:[{totalSteel:.5,sfd:10,activity:26,seconds:C.crDoseExposure(.5,10,.8,cal)/26,pmt:40},{totalSteel:1.2,sfd:24,activity:20,seconds:C.crDoseExposure(1.2,24,1.25,cal)/20,pmt:40}]}),40);
close(sugg.doseR,Math.sqrt(.8*1.25));assert.equal(sugg.shotsUsed,2);close(sugg.spread,1.25/.8);
sugg=C.crSuggestedDose(C.crCleanCalibration({shots:[{totalSteel:.5,sfd:10,activity:26,seconds:C.crDoseExposure(.5,10,1,cal)/26,pmt:40}],gain:[{pmt:40,signal:2100,offset:100},{pmt:55,signal:4100,offset:100}]}),55);close(sugg.doseR,.5);assert.equal(sugg.gainScaled,true);
assert.match(C.crSuggestedDose(C.crCleanCalibration({shots:[{totalSteel:.5,sfd:10,activity:26,seconds:10,pmt:40}]}),55).reason,/no gain measurements covering PMT 40 and PMT 55/);
// Up to 100 reference shots are kept; any beyond are counted as unreadable, never silently lost (the whole chart fits).
const many=Array.from({length:105},(_,i)=>({totalSteel:.5,sfd:10,activity:20,seconds:10+i,pmt:40}));let big=C.crCleanCalibration({shots:many});assert.equal(big.shots.length,100);assert.equal(big.dropped,5);
big=C.crCleanCalibration({gain:Array.from({length:32},(_,i)=>({pmt:i+1,signal:200,offset:10}))});assert.equal(big.gain.length,30);assert.equal(big.dropped,2);
// The calibrated reference-shot model (used for the suggestion and the consistency check).
let r=C.crCalibratedExposure(.5,10,40,cal);assert.equal(r.curieSeconds,null);assert.equal(r.reason,'no reference shots');

// One shot at the requested PMT: reproduces itself; inverse square; inverse activity; steel doubles every 14.5 mm
// (the default) unless a measured H is entered; same total steel gives the same answer however many walls.
cal=C.crCleanCalibration({shots:[shot()]});const own=20*60;
close(C.crCalibratedExposure(.5,10,40,cal).curieSeconds,own);
close(C.crCalibratedExposure(.5,20,40,cal).curieSeconds,own*4);
close(C.crCalibratedExposure(.5+14.5/25.4,10,40,cal).curieSeconds,own*2);
assert.equal(C.crCalibratedExposure(.5,10,40,cal).hvlMm,14.5);assert.equal(C.CR_PUBLISHED_HVL_MM,13);
const measured=C.crCleanCalibration({shots:[shot()],hvlMm:16});close(C.crCalibratedExposure(.5+16/25.4,10,40,measured).curieSeconds,own*2);assert.equal(C.crCalibratedExposure(.5,10,40,measured).hvlMeasured,true);
const tw=data.techniques.find(t=>t.size===8&&t.schedule==='40 / STD');close(C.crShotDose(cal.shots[0],cal)*C.crDoseExposure(2*tw.wall,tw.sfd,1,cal),C.crCalibratedExposure(2*tw.wall,tw.sfd,40,cal).curieSeconds);
close(C.seconds(C.crCalibratedExposure(.5,10,40,cal).curieSeconds,10),120);
assert.equal(C.crCalibratedExposure(.5,10,41.5,cal).reason,'PMT must be a whole number');assert.throws(()=>C.crCalibratedExposure(4,10,40,cal));assert.throws(()=>C.crCalibratedExposure(.5,0,40,cal));

// Another PMT: refused without measured gain covering both settings; converted by G only inside the measured range.
assert.match(C.crCalibratedExposure(.5,10,50,cal).reason,/no gain measurements covering PMT 40 and PMT 50/);
cal=C.crCleanCalibration({shots:[shot()],gain:[{pmt:30,signal:1100,offset:100},{pmt:40,signal:2100,offset:100},{pmt:60,signal:8100,offset:100}]});
close(C.crCalibratedExposure(.5,10,60,cal).curieSeconds,own*2000/8000);close(C.crCalibratedExposure(.5,10,30,cal).curieSeconds,own*2);
close(C.crGainAt(cal,50).gain,Math.sqrt(2000*8000));close(C.crCalibratedExposure(.5,10,50,cal).curieSeconds,own*2000/4000);
assert.equal(C.crGainAt(cal,61),null);assert.equal(C.crGainAt(cal,29),null);assert.match(C.crCalibratedExposure(.5,10,70,cal).reason,/no gain measurements/);
assert.equal(C.crCalibratedExposure(.5,10,60,cal).gainScaled,true);assert.equal(C.crCalibratedExposure(.5,10,40,cal).gainScaled,false);

// Pixel target: needs the shot's pixel and the offsets; scales by (target − offset) ÷ (shot pixel − offset).
cal=C.crCleanCalibration({shots:[shot()],targetPixel:2500});assert.match(C.crCalibratedExposure(.5,10,40,cal).reason,/no pixel value/);
cal=C.crCleanCalibration({shots:[shot({pixel:5100})],targetPixel:2500});assert.match(C.crCalibratedExposure(.5,10,40,cal).reason,/offset unknown at PMT 40/);
cal=C.crCleanCalibration({shots:[shot({pixel:5100,offset:100})],targetPixel:2600});close(C.crCalibratedExposure(.5,10,40,cal).curieSeconds,own*2500/5000);assert.equal(C.crCalibratedExposure(.5,10,40,cal).pixelScaled,true);
cal=C.crCleanCalibration({shots:[shot({pixel:5100})],gain:[{pmt:40,signal:2100,offset:100},{pmt:60,signal:8100,offset:300}],targetPixel:2300});
close(C.crCalibratedExposure(.5,10,60,cal).curieSeconds,own*(2000/7800)*((2300-300)/(5100-100)));
cal=C.crCleanCalibration({shots:[shot({pixel:5100,offset:100})],targetPixel:50});assert.match(C.crCalibratedExposure(.5,10,40,cal).reason,/not above the scanner offset/);

// Several shots: geometric mean, spread reported; unusable shots skipped while others still give a time.
cal=C.crCleanCalibration({shots:[shot(),shot({seconds:240}),shot({pmt:55})]});r=C.crCalibratedExposure(.5,10,40,cal);
close(r.curieSeconds,own*2);close(r.spread,4);assert.equal(r.shotsUsed,2);

// Cross-check: each shot predicted from the others; consistent synthetic shots agree exactly.
const synth=(steel,sfd,pmt=40)=>shot({totalSteel:steel,sfd,pmt,seconds:300*sfd*sfd*Math.pow(2,steel*25.4/13)/20/100});
cal=C.crCleanCalibration({shots:[synth(.3,4),synth(.8,12),synth(1.5,20)],hvlMm:13});let check=C.crCrossCheck(cal);assert.equal(check.checked,3);assert.ok(check.max<1e-9);
cal=C.crCleanCalibration({shots:[synth(.3,4),{...synth(.8,12),seconds:synth(.8,12).seconds*1.5}],hvlMm:13});check=C.crCrossCheck(cal);close(check.max,.5);
assert.equal(C.crCrossCheck(C.crCleanCalibration({shots:[shot()]})),null);

// Suggested H from shots at one PMT spanning 6 mm or more; never applied to the calibration.
cal=C.crCleanCalibration({shots:[synth(.3,4),synth(.8,12),synth(1.5,20),synth(.3,4,55)]});const h=C.crSuggestedHvl(cal);close(h.hvlMm,13,1e-9);assert.equal(h.pmt,40);assert.equal(h.shots,3);assert.equal(cal.hvlMm,null);
assert.equal(C.crSuggestedHvl(C.crCleanCalibration({shots:[synth(.3,4),synth(.4,12)]})),null);

// Independent of every chart and film number: changing them leaves calibrated CR untouched.
cal=C.crCleanCalibration({shots:[shot()]});const before=C.crCalibratedExposure(1,24,40,cal).curieSeconds,savedChart={...C.CHART_EXPOSURES.cr},savedT200=[...C.REFERENCE_CURIE_SECONDS.t200];
try{for(const k of Object.keys(C.CHART_EXPOSURES.cr))C.CHART_EXPOSURES.cr[k]=1;C.REFERENCE_CURIE_SECONDS.t200.fill(1);assert.equal(C.crCalibratedExposure(1,24,40,cal).curieSeconds,before);}
finally{Object.assign(C.CHART_EXPOSURES.cr,savedChart);savedT200.forEach((v,i)=>C.REFERENCE_CURIE_SECONDS.t200[i]=v);}

// CR rules: no film density; Internal ÷ 8, offset ÷ 3 rounded up.
assert.equal(C.usesDensity('crcal'),false);assert.equal(C.internalSeconds('crcal',49),6);assert.equal(C.offsetSeconds('crcal',49),17);
assert.ok(C.CUSTOM_FILMS.includes('crcal'));for(const g of ['small','large'])assert.ok(data.groups[g].films.includes('crcal'));
assert.equal(data.films.crcal.name,'Carestream CR (calibrated)');
console.log('PASS: 1.96 film outputs unchanged and CR chart restored to the Carestream sheet with three corrected cells (2,280 rows, 525 custom), CR Formula (70%) removed, plate exposure model (Carestream-chart per-size starts, 14.5 mm, 0.5–12 R, inverse square, steel, activity), shot plate exposure and suggestions, 100-shot limit counted, calibrated CR cleaning, no-calibration refusal, inverse square/activity, total steel, published and measured H, gain conversion only inside measured PMT range, pixel target with offsets, geometric mean and spread, cross-check, suggested H, independence from chart and film numbers, CR internal rules.');
