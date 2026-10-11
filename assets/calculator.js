(function(root) {
  'use strict';
  function parseActivity(text) {
    const clean=String(text).trim().replace(',', '.');
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)) return null;
    const value=Number(clean);
    return Number.isFinite(value) && value > 0 && value <= 999.9 ? value : null;
  }
  function seconds(curieSeconds, activity) {
    if(!Number.isFinite(activity) || activity<=0 || activity>999.9) throw new Error('Invalid activity');
    return curieSeconds / activity;
  }
  function timeLabel(value) {
    if(!Number.isFinite(value) || value<0 || value>Number.MAX_SAFE_INTEGER/10) return 'Out of range';
    const rounded=Math.round(value);
    const hours=Math.floor(rounded/3600), minutes=Math.floor((rounded%3600)/60), secs=rounded%60;
    return (hours ? hours+'h ' : '')+(minutes || hours ? minutes+'m ' : '')+secs+'s';
  }

  function matchesSchedule(technique, schedule) {
    return schedule==='all' || technique.schedule.split('/').map(x=>x.trim()).includes(schedule);
  }
  function dayNumber(iso) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)))return null;
    const ms=Date.parse(iso+'T00:00:00Z');
    return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===iso?ms/86400000:null;
  }
  function decay(activity,referenceDate,targetDate){
    const start=dayNumber(referenceDate),end=dayNumber(targetDate);
    if(!Number.isFinite(activity)||activity<=0||activity>999.9||start===null||end===null||end<start)return null;
    return activity*Math.pow(2,-(end-start)/73.83);
  }
  const DENSITIES=[2,2.5,3,3.5,4];
  // Ir-192 through steel: exposure doubles every 12.1 mm of total (double-wall) steel.
  // Measured from the GE/Agfa STRUCTURIX Ir-192 exposure diagram (Pb screens); all films share it.
  const STEEL_HVL_MM=12.1;
  // Reference shots: 3-inch STD for small films, 4-inch STD for large films.
  // Rows above this total steel lie beyond the Agfa Ir-192 chart (10-90 mm) the curve was measured from;
  // the app hides them rather than extrapolate.
  const MAX_STEEL_MM=90;
  // Owner-selected CR baseline (2026-10-10): 70% of the current T200 density-3
  // reference. Fixed separately so changes to film references cannot change CR.
  const CR_REFERENCE=Object.freeze({curieSeconds:480.48,totalSteel:.474,sfd:4.625,steelHvlMm:12.1});
  function crExposure(totalSteel,sfd){
    if(!Number.isFinite(totalSteel)||totalSteel<=0||totalSteel*25.4>MAX_STEEL_MM)throw new Error('Enter total steel greater than 0 and no more than 90 mm (3.5433 inches).');
    if(!Number.isFinite(sfd)||sfd<=0)throw new Error('Enter an SFD greater than zero.');
    const r=CR_REFERENCE,value=r.curieSeconds*Math.pow(sfd/r.sfd,2)*Math.pow(2,(totalSteel-r.totalSteel)*25.4/r.steelHvlMm);
    if(!Number.isFinite(value)||value<=0)throw new Error('Exposure is out of range.');
    return value;
  }
  function withinSteelRange(technique){return 2*technique.wall*25.4<=MAX_STEEL_MM;}
  const REFERENCE_GEOMETRY={small:{wall:0.216,sfd:3.625},large:{wall:0.237,sfd:4.625}};
  // Large films: approximate calculator targets at 26 Ci on 4-inch STD (index 3 interpolated).
  // Small films: large partner x published Ir-192 exposure ratio at the same geometry and density
  // (Agfa D4 3.0 / D5 1.5; Carestream MX125 2.8 / T200 1.7; Fuji IX80 speed 55 / IX50 30), so a small
  // film and its partner aim at the same density at every target and can share a hanger.
  const FILM_REFERENCES={
    d5:{group:'large',times:[11,15,19,23,27]},
    // Owner adjustment 2026-10-02: +20% baseline; MX125 inherits it once through its T200 partner.
    t200:{group:'large',times:[14,18,22,25.5,29].map(t=>t*1.2)},
    ix80:{group:'large',times:[13,18,23,28,33]},
    d4:{group:'small',partner:'d5',ratio:3/1.5},
    mx125:{group:'small',partner:'t200',ratio:2.8/1.7},
    ix50:{group:'small',partner:'ix80',ratio:55/30}
  };
  function geometryFactor(technique,reference) {
    return Math.pow(technique.sfd/reference.sfd,2)*Math.pow(2,2*(technique.wall-reference.wall)*25.4/STEEL_HVL_MM);
  }
  // Ci·s at each film's own reference geometry, per density.
  const REFERENCE_CURIE_SECONDS={};
  for(const film of Object.keys(FILM_REFERENCES)){const r=FILM_REFERENCES[film];if(r.times)REFERENCE_CURIE_SECONDS[film]=r.times.map(t=>t*26);}
  for(const film of Object.keys(FILM_REFERENCES)){const r=FILM_REFERENCES[film];if(!r.partner)continue;
    const move=geometryFactor(REFERENCE_GEOMETRY.small,REFERENCE_GEOMETRY.large);
    REFERENCE_CURIE_SECONDS[film]=REFERENCE_CURIE_SECONDS[r.partner].map(cs=>r.ratio*cs*move);}
  // Owner's Carestream CR chart (Ci·s per size and schedule), used exactly as given. CR plates have no film
  // density, so the value is the same at every target density; rows not in the chart have no CR time (null).
  const CHART_EXPOSURES={
    cr:{'2|40 / STD':234,'2|80 / XH':273,'2|160':338,'2|XXH / XXS':403,'3|40 / STD':481,'3|80 / XH':546,'3|160':637,'3|XXH / XXS':754,
      '4|40 / STD':637,'4|80 / XH':741,'4|120':845,'4|160':975,'4|XXH / XXS':1170,'6|40 / STD':845,'6|80 / XH':1080,'6|120':1340,'6|160':2070,'6|XXH / XXS':1790,
      '8|40 / STD':980,'8|80 / XH':1400,'8|120':1930,'8|160':3240,'8|XXH / XXS':2980,'10|40 / STD':1340,'10|60 / XH':1590,'10|80':2070,'10|120':3310,'10|160':7200,'10|XXH / XXS':5090,
      '12|STD':1550,'12|40':1690,'12|XH':2050,'12|80':3190,'12|120':7020,'12|160':15270,'12|XXH / XXS':7020,
      '14|STD':1770,'14|40':1770,'14|XH':2450,'14|80':4540,'14|120':10870,'14|160':23660,'16|STD':2230,'16|40 / XH':2930,'16|80':7010,'16|120':18160,'16|160':46700,
      '20|STD':3140,'20|40':5830,'20|XH':4490,'20|80':16550,'20|120':55220,'24|STD':4520,'24|40':9930,'24|80':36050,'24|XH':85610}
  };
  function usesDensity(film){return film!=='cr70'&&film!=='crcal'&&!CHART_EXPOSURES[film];}
  // crcal needs {pmt, calibration} (a clean calibration); it returns null when the calibration cannot cover the row.
  function densityExposure(technique,film,density,options){
    const index=DENSITIES.indexOf(density),chart=CHART_EXPOSURES[film];
    if(film==='crcal'){if(index<0||!technique||!options||!options.calibration)throw new Error('Unsupported density or film');return crCalibratedExposure(2*technique.wall,technique.sfd,options.pmt,options.calibration).curieSeconds;}
    if(film==='cr70'){if(index<0||!technique)throw new Error('Unsupported density or film');return crExposure(2*technique.wall,technique.sfd);}
    if(chart){if(index<0||!technique)throw new Error('Unsupported density or film');const value=chart[technique.size+'|'+technique.schedule];return value===undefined?null:value;}
    const reference=FILM_REFERENCES[film];
    if(index<0||!reference||reference.group!==technique.group||!Number.isFinite(technique.wall)||!(technique.sfd>0))throw new Error('Unsupported density or film');
    return REFERENCE_CURIE_SECONDS[film][index]*geometryFactor(technique,REFERENCE_GEOMETRY[reference.group]);
  }
  // Internal and internal-offset times from the unrounded shot time: CR uses its chart's ÷8 and ÷3,
  // films ÷9 and ÷3.2. Film times round to the nearest second; CR offset rounds up.
  function internalSeconds(film,shot){return Math.round(shot/(usesDensity(film)?9:8));}
  function offsetSeconds(film,shot){return usesDensity(film)?Math.round(shot/3.2):Math.ceil(shot/3);}
  // Exposure for any density between 2.0 and 4.0 on the film's curve: log-linear between the five
  // target densities, so a measured density such as 2.7 can be used for calibration.
  function exposureAtDensity(technique,film,density,options){
    if(!usesDensity(film))return densityExposure(technique,film,DENSITIES[0],options);
    if(!Number.isFinite(density)||density<DENSITIES[0]||density>DENSITIES[DENSITIES.length-1])throw new Error('Density outside the film curve');
    let i=0;while(i<DENSITIES.length-2&&density>DENSITIES[i+1])i++;
    const lower=densityExposure(technique,film,DENSITIES[i]),upper=densityExposure(technique,film,DENSITIES[i+1]);
    return lower*Math.pow(upper/lower,(density-DENSITIES[i])/(DENSITIES[i+1]-DENSITIES[i]));
  }
  // Carestream CR (calibrated), film id 'crcal': physics plus the owner's own calibration, no chart numbers.
  //   Ci·s = K × (SFD in)² × 2^(total steel mm ÷ H)
  // K comes only from reference shots the owner records (good images: steel, SFD, activity, time, PMT, and
  // optionally the linear pixel value P and the scanner offset B). A shot read at another PMT, or a different
  // target pixel, is converted with P − B = k·G(PMT)·exposure: ×(P_target − B_target)/(P_shot − B_shot) and
  // ×G(PMT_shot)/G(PMT_target), with G from the owner's measured gain table only. Nothing is extrapolated:
  // without data covering the request the result is null with a reason.
  // H: steel exposure-doubling thickness. Default is QSA Global's published Ir-192 steel HVL (~13 mm), a
  // narrow-beam shielding figure not verified for CR; the owner can enter a measured value.
  const CR_PUBLISHED_HVL_MM=13;
  const CR_LIMITS=Object.freeze({pmtMin:1,pmtMax:999,hvlMin:5,hvlMax:30,pixelMax:1e6,shots:50,gain:30,note:80});
  function crHvl(cal){return cal&&Number.isFinite(cal.hvlMm)?cal.hvlMm:CR_PUBLISHED_HVL_MM;}
  function crGeometry(totalSteel,sfd,hvlMm){return sfd*sfd*Math.pow(2,totalSteel*25.4/hvlMm);}
  function checkSteelAndSfd(totalSteel,sfd){
    if(!Number.isFinite(totalSteel)||totalSteel<=0||totalSteel*25.4>MAX_STEEL_MM)throw new Error('Enter total steel greater than 0 and no more than 90 mm (3.5433 inches).');
    if(!Number.isFinite(sfd)||sfd<=0)throw new Error('Enter an SFD greater than zero.');
  }
  const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  const validPmtNumber=v=>Number.isInteger(v)&&v>=CR_LIMITS.pmtMin&&v<=CR_LIMITS.pmtMax;
  // Stored calibration in, clean calibration out: invalid entries are dropped and counted, never repaired.
  function crCleanCalibration(raw){
    const cal={shots:[],gain:[],hvlMm:null,targetPixel:null,dropped:0};if(!raw||typeof raw!=='object')return cal;
    for(const s of Array.isArray(raw.shots)?raw.shots.slice(0,CR_LIMITS.shots):[]){
      const ok=s&&positive(s.totalSteel)&&s.totalSteel*25.4<=MAX_STEEL_MM&&positive(s.sfd)&&positive(s.activity)&&s.activity<=999.9&&positive(s.seconds)&&validPmtNumber(s.pmt)
        &&(s.pixel==null||positive(s.pixel)&&s.pixel<=CR_LIMITS.pixelMax)&&(s.offset==null||typeof s.offset==='number'&&s.offset>=0&&(s.pixel==null||s.offset<s.pixel))&&(s.note==null||typeof s.note==='string'&&s.note.length<=CR_LIMITS.note);
      if(!ok){cal.dropped++;continue;}
      cal.shots.push({totalSteel:s.totalSteel,sfd:s.sfd,activity:s.activity,seconds:s.seconds,pmt:s.pmt,pixel:s.pixel==null?null:s.pixel,offset:s.offset==null?null:s.offset,note:s.note||''});
    }
    for(const g of Array.isArray(raw.gain)?raw.gain.slice(0,CR_LIMITS.gain):[]){
      const ok=g&&validPmtNumber(g.pmt)&&positive(g.signal)&&g.signal<=CR_LIMITS.pixelMax&&typeof g.offset==='number'&&g.offset>=0&&g.offset<g.signal&&!cal.gain.some(x=>x.pmt===g.pmt);
      if(!ok){cal.dropped++;continue;}cal.gain.push({pmt:g.pmt,signal:g.signal,offset:g.offset});
    }
    cal.gain.sort((a,b)=>a.pmt-b.pmt);
    if(raw.hvlMm!=null){if(typeof raw.hvlMm==='number'&&raw.hvlMm>=CR_LIMITS.hvlMin&&raw.hvlMm<=CR_LIMITS.hvlMax)cal.hvlMm=raw.hvlMm;else cal.dropped++;}
    if(raw.targetPixel!=null){if(positive(raw.targetPixel)&&raw.targetPixel<=CR_LIMITS.pixelMax)cal.targetPixel=raw.targetPixel;else cal.dropped++;}
    return cal;
  }
  // Relative gain G = signal − offset at a fixed exposure, log-linear between measured PMT settings, and the
  // offset linear between them. null outside the measured range (no extrapolation).
  function crGainAt(cal,pmt){
    const rows=cal.gain;if(!Number.isFinite(pmt)||!rows.length)return null;
    for(let i=0;i<rows.length;i++){const a=rows[i];if(a.pmt===pmt)return {gain:a.signal-a.offset,offset:a.offset};
      const b=rows[i+1];if(b&&pmt>a.pmt&&pmt<b.pmt){const f=(pmt-a.pmt)/(b.pmt-a.pmt),ga=a.signal-a.offset,gb=b.signal-b.offset;return {gain:ga*Math.pow(gb/ga,f),offset:a.offset+(b.offset-a.offset)*f};}}
    return null;
  }
  // Offset at a PMT: the gain table if it covers it, else offsets recorded with shots read at that PMT.
  function crOffsetAt(cal,pmt){const g=crGainAt(cal,pmt);if(g)return g.offset;const own=cal.shots.filter(s=>s.pmt===pmt&&s.offset!=null).map(s=>s.offset);return own.length?own.reduce((a,b)=>a+b,0)/own.length:null;}
  // K (Ci·s per in² at zero steel) that one shot implies for the requested PMT and pixel target, or a reason.
  function crShotK(cal,shot,pmt,targetPixel,hvl){
    let k=shot.activity*shot.seconds/crGeometry(shot.totalSteel,shot.sfd,hvl),gainScaled=false,pixelScaled=false;
    if(shot.pmt!==pmt){const a=crGainAt(cal,shot.pmt),b=crGainAt(cal,pmt);if(!a||!b)return {reason:'no gain measurements covering PMT '+shot.pmt+' and PMT '+pmt};k*=a.gain/b.gain;gainScaled=true;}
    if(targetPixel!=null){
      if(shot.pixel==null)return {reason:'reference shot has no pixel value for the pixel target'};
      const bs=shot.offset!=null?shot.offset:crOffsetAt(cal,shot.pmt),bt=shot.pmt===pmt&&shot.offset!=null?shot.offset:crOffsetAt(cal,pmt);
      if(bs==null||bt==null)return {reason:'scanner offset unknown at PMT '+(bs==null?shot.pmt:pmt)};
      if(!(shot.pixel>bs)||!(targetPixel>bt))return {reason:'pixel value not above the scanner offset'};
      k*=(targetPixel-bt)/(shot.pixel-bs);pixelScaled=true;
    }
    return {k,gainScaled,pixelScaled};
  }
  function crCalibratedExposure(totalSteel,sfd,pmt,cal,skip){
    checkSteelAndSfd(totalSteel,sfd);
    const hvl=crHvl(cal),base={curieSeconds:null,hvlMm:hvl,hvlMeasured:cal.hvlMm!=null};
    if(!validPmtNumber(pmt))return {...base,reason:'PMT must be a whole number'};
    const shots=cal.shots.filter((s,i)=>i!==skip);
    if(!shots.length)return {...base,reason:'no reference shots'};
    const used=[],reasons=[];
    for(const shot of shots){const r=crShotK(cal,shot,pmt,cal.targetPixel,hvl);if(r.k)used.push(r);else reasons.push(r.reason);}
    if(!used.length)return {...base,reason:reasons[0]};
    const logs=used.map(u=>Math.log(u.k)),k=Math.exp(logs.reduce((a,b)=>a+b,0)/logs.length);
    return {...base,curieSeconds:k*crGeometry(totalSteel,sfd,hvl),shotsUsed:used.length,spread:Math.exp(Math.max(...logs)-Math.min(...logs)),
      gainScaled:used.some(u=>u.gainScaled),pixelScaled:used.some(u=>u.pixelScaled)};
  }
  // Each reference shot predicted from the others at its own geometry and PMT (its own pixel value as the
  // target when the calibration uses one): how well the owner's data agree with each other and with H.
  function crCrossCheck(cal){
    if(cal.shots.length<2)return null;const errors=[];
    cal.shots.forEach((shot,i)=>{const own={...cal,targetPixel:cal.targetPixel!=null?shot.pixel:null};if(own.targetPixel===null&&cal.targetPixel!=null)return;
      const r=crCalibratedExposure(shot.totalSteel,shot.sfd,shot.pmt,own,i);if(r.curieSeconds)errors.push(r.curieSeconds/(shot.activity*shot.seconds)-1);});
    if(!errors.length)return null;const abs=errors.map(Math.abs).sort((a,b)=>a-b);
    return {checked:errors.length,median:abs[abs.length>>1],max:abs[abs.length-1]};
  }
  // Doubling thickness implied by shots at one PMT that span at least 6 mm of steel (least squares on
  // ln(A·t/SFD²) against steel), assuming each was an equally good image. Shown to the owner, never applied.
  function crSuggestedHvl(cal){
    let best=null;
    for(const pmt of [...new Set(cal.shots.map(s=>s.pmt))]){
      const group=cal.shots.filter(s=>s.pmt===pmt);if(group.length<2)continue;const xs=group.map(s=>s.totalSteel*25.4),span=Math.max(...xs)-Math.min(...xs);if(span<6)continue;
      const ys=group.map(s=>Math.log(s.activity*s.seconds/(s.sfd*s.sfd))),mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
      const slope=xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0)/xs.reduce((a,x)=>a+(x-mx)*(x-mx),0);if(!(slope>0))continue;
      const hvl=Math.LN2/slope;if(!best||group.length>best.shots)best={pmt,hvlMm:hvl,shots:group.length,spanMm:span};
    }
    return best;
  }
  const CUSTOM_FILMS=[...Object.keys(FILM_REFERENCES),'d7','cr70','crcal'];
  function customExposure(totalSteel,sfd,film,density,options){
    checkSteelAndSfd(totalSteel,sfd);
    if(film==='crcal'){if(!options||!options.calibration)throw new Error('Carestream CR (calibrated) needs its calibration.');const r=crCalibratedExposure(totalSteel,sfd,options.pmt,options.calibration);if(r.curieSeconds===null)throw new Error('Carestream CR (calibrated) needs calibration: '+r.reason+'.');return r.curieSeconds;}
    if(film==='d7')return customExposure(totalSteel,sfd,'d5',density)/1.5; // Published STRUCTURIX Ir-192 exposure factors: D7 1.0 / D5 1.5.
    if(film==='cr70')return crExposure(totalSteel,sfd);
    if(!Object.prototype.hasOwnProperty.call(FILM_REFERENCES,film))throw new Error('Custom CR needs a reference exposure; choose a film.');
    const value=densityExposure({wall:totalSteel/2,sfd,group:FILM_REFERENCES[film].group},film,density);
    if(!Number.isFinite(value)||value<=0)throw new Error('Exposure is out of range.');
    return value;
  }
  const api={CR_PUBLISHED_HVL_MM,CR_LIMITS,crCleanCalibration,crGainAt,crOffsetAt,crCalibratedExposure,crCrossCheck,crSuggestedHvl,checkSteelAndSfd,CR_REFERENCE,crExposure,CUSTOM_FILMS,customExposure,DENSITIES,CHART_EXPOSURES,usesDensity,internalSeconds,offsetSeconds,exposureAtDensity,STEEL_HVL_MM,MAX_STEEL_MM,withinSteelRange,REFERENCE_GEOMETRY,FILM_REFERENCES,REFERENCE_CURIE_SECONDS,geometryFactor,parseActivity,seconds,timeLabel,matchesSchedule,dayNumber,decay,densityExposure};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ShotCalculator=api;
})(typeof globalThis!=='undefined'?globalThis:this);
