'use strict';
// Carestream CR (calibrated): physics plus the owner's own reference shots and measured scanner gain.
const assert=require('node:assert/strict'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json'),F=require('./fixtures/film-outputs-1.96.json');
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a/b-1)<tol,`${a} vs ${b}`);

// Every remaining film and the CR chart give exactly the 1.96 outputs (T200 included, with its +20%).
// CR Formula (cr70, 70% of T200) was removed in 1.97 and is refused everywhere.
let kept=0;for(const [key,value] of Object.entries(F.densityExposure)){const [size,schedule,film,d]=key.split('|');if(film==='cr70')continue;kept++;const t=data.techniques.find(t=>String(t.size)===size&&t.schedule===schedule);assert.ok(Object.is(C.densityExposure(t,film,Number(d)),value),key);}
for(const [key,value] of Object.entries(F.customExposure)){const [film,steel,sfd,d]=key.split('|');if(film==='cr70'){assert.throws(()=>C.customExposure(Number(steel),Number(sfd),film,Number(d)));continue;}assert.ok(Object.is(C.customExposure(Number(steel),Number(sfd),film,Number(d)),value),key);}
for(const [key,value] of Object.entries(F.internal)){const [film,s]=key.split('|');if(film==='cr70')continue;assert.equal(C.internalSeconds(film,Number(s)),value);assert.equal(C.offsetSeconds(film,Number(s)),F.offset[key]);}
assert.equal(Object.keys(F.densityExposure).length,2825);assert.equal(kept,2280);
for(const t of data.techniques)assert.throws(()=>C.densityExposure(t,'cr70',3));assert.ok(!C.CUSTOM_FILMS.includes('cr70'));assert.equal(C.crExposure,undefined);assert.equal(C.CR_REFERENCE,undefined);
for(const g of ['small','large'])assert.ok(!data.groups[g].films.includes('cr70'));assert.equal(data.films.cr70,undefined);

// Cleaning: valid entries kept, invalid ones dropped and counted, never repaired.
const shot=(o={})=>({totalSteel:.5,sfd:10,activity:20,seconds:60,pmt:40,...o});
let cal=C.crCleanCalibration({shots:[shot(),shot({pmt:40.5}),shot({totalSteel:4}),shot({activity:0}),shot({pixel:2000,offset:2500}),shot({note:'x'.repeat(81)}),null],gain:[{pmt:40,signal:3000,offset:100},{pmt:40,signal:5000,offset:100},{pmt:50,signal:90,offset:100}],hvlMm:40,targetPixel:-1});
assert.equal(cal.shots.length,1);assert.equal(cal.gain.length,1);assert.equal(cal.hvlMm,null);assert.equal(cal.targetPixel,null);assert.equal(cal.dropped,10);
assert.deepEqual(C.crCleanCalibration(null),{shots:[],gain:[],hvlMm:null,targetPixel:null,dropped:0});
assert.equal(C.crCleanCalibration({shots:Array(60).fill(shot())}).shots.length,50);

// No reference shot: no time, with the reason; never a default exposure.
cal=C.crCleanCalibration({});let r=C.crCalibratedExposure(.5,10,40,cal);assert.equal(r.curieSeconds,null);assert.equal(r.reason,'no reference shots');
const ref4=data.techniques.find(t=>t.size===4&&t.schedule==='40 / STD');
assert.equal(C.densityExposure(ref4,'crcal',3,{pmt:40,calibration:cal}),null);assert.throws(()=>C.densityExposure(ref4,'crcal',3));
assert.throws(()=>C.customExposure(.5,10,'crcal',3,{pmt:40,calibration:cal}),/needs calibration: no reference shots/);

// One shot at the requested PMT: reproduces itself; inverse square; inverse activity; steel doubles every 13 mm
// (published QSA value) unless a measured H is entered; same total steel gives the same answer however many walls.
cal=C.crCleanCalibration({shots:[shot()]});const own=20*60;
close(C.crCalibratedExposure(.5,10,40,cal).curieSeconds,own);
close(C.crCalibratedExposure(.5,20,40,cal).curieSeconds,own*4);
close(C.crCalibratedExposure(.5+13/25.4,10,40,cal).curieSeconds,own*2);
assert.equal(C.crCalibratedExposure(.5,10,40,cal).hvlMm,13);assert.equal(C.CR_PUBLISHED_HVL_MM,13);
const measured=C.crCleanCalibration({shots:[shot()],hvlMm:16});close(C.crCalibratedExposure(.5+16/25.4,10,40,measured).curieSeconds,own*2);assert.equal(C.crCalibratedExposure(.5,10,40,measured).hvlMeasured,true);
const tw=data.techniques.find(t=>t.size===8&&t.schedule==='40 / STD');close(C.densityExposure(tw,'crcal',2,{pmt:40,calibration:cal}),C.crCalibratedExposure(2*tw.wall,tw.sfd,40,cal).curieSeconds);
close(C.customExposure(2*tw.wall,tw.sfd,'crcal',3,{pmt:40,calibration:cal}),C.densityExposure(tw,'crcal',4,{pmt:40,calibration:cal}));
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
cal=C.crCleanCalibration({shots:[synth(.3,4),synth(.8,12),synth(1.5,20)]});let check=C.crCrossCheck(cal);assert.equal(check.checked,3);assert.ok(check.max<1e-9);
cal=C.crCleanCalibration({shots:[synth(.3,4),{...synth(.8,12),seconds:synth(.8,12).seconds*1.5}]});check=C.crCrossCheck(cal);close(check.max,.5);
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
console.log('PASS: 1.96 film and CR chart outputs unchanged (2,280 rows, 525 custom), CR Formula (70%) removed, calibrated CR cleaning, no-calibration refusal, inverse square/activity, total steel, published and measured H, gain conversion only inside measured PMT range, pixel target with offsets, geometric mean and spread, cross-check, suggested H, independence from chart and film numbers, CR internal rules.');
