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
  function withinSteelRange(technique){return 2*technique.wall*25.4<=MAX_STEEL_MM;}
  const REFERENCE_GEOMETRY={small:{wall:0.216,sfd:3.625},large:{wall:0.237,sfd:4.625}};
  // Large films: approximate calculator targets at 26 Ci on 4-inch STD (index 3 interpolated).
  // Small films: large partner x published Ir-192 exposure ratio at the same geometry and density
  // (Agfa D4 3.0 / D5 1.5; Carestream MX125 2.8 / T200 1.7; Fuji IX80 speed 55 / IX50 30), so a small
  // film and its partner aim at the same density at every target and can share a hanger.
  const FILM_REFERENCES={
    d5:{group:'large',times:[11,15,19,23,27]},
    t200:{group:'large',times:[14,18,22,25.5,29]},
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
  // Carestream CR: no film density. Ci·s = CR_K_REF × 2^((CR_PMT_REF − PMT) ÷ CR_PMT_DOUBLING) × (SFD ÷ 4.625)²
  // × 2^((total steel − 4" STD steel) ÷ CR_STEEL_HVL_MM). Fitted to the owner's former CR chart (53 of 56 rows,
  // one scanner setting per pipe size): the chart's wall-to-wall changes give 14.8 mm, and the per-size gain
  // steps set the suggested PMT. PMT_DOUBLING (signal doubles every 7.5 PMT units) is the owner's slider ranges
  // fitted to those steps, not a measured HPX gain curve; measure and replace it.
  const CR_STEEL_HVL_MM=14.8,CR_K_REF=523,CR_PMT_REF=41,CR_PMT_DOUBLING=7.5;
  const CR_PMT_RANGES=[{maxSize:3,min:20,max:50},{maxSize:8,min:30,max:60},{maxSize:Infinity,min:40,max:70}];
  // PMT at which each size best matches the former chart (median 6%, not exact); 1", 5" and 18" had no chart rows and are interpolated.
  const CR_SUGGESTED_PMT={1:35,2:35,3:38,4:41,5:44,6:46,8:52,10:54,12:55,14:55,16:55,18:56,20:56,24:57};
  function crPmtRange(size){const r=Number.isFinite(size)&&size>0?CR_PMT_RANGES.find(r=>size<=r.maxSize):undefined;if(!r)throw new Error('Unsupported pipe size');return r;}
  function crSuggestedPmt(size){const r=crPmtRange(size),n=CR_SUGGESTED_PMT[size];return Math.min(r.max,Math.max(r.min,Number.isFinite(n)?n:Math.round((r.min+r.max)/2)));}
  function validPmt(size,pmt){if(!Number.isFinite(size)||size<=0)return false;const r=crPmtRange(size);return Number.isInteger(pmt)&&pmt>=r.min&&pmt<=r.max;}
  function crExposure(totalSteelMm,sfd,pmt){
    if(!(totalSteelMm>0&&sfd>0&&Number.isFinite(pmt)))throw new Error('Unsupported CR geometry or PMT');
    return CR_K_REF*Math.pow(2,(CR_PMT_REF-pmt)/CR_PMT_DOUBLING)*Math.pow(sfd/REFERENCE_GEOMETRY.large.sfd,2)*Math.pow(2,(totalSteelMm-2*REFERENCE_GEOMETRY.large.wall*25.4)/CR_STEEL_HVL_MM);
  }
  function usesDensity(film){return film!=='cr';}
  // CR needs the PMT setting: a whole number in the size's slider range, or undefined for the suggested setting.
  function densityExposure(technique,film,density,pmt){
    const index=DENSITIES.indexOf(density);
    if(film==='cr'){if(index<0||!technique)throw new Error('Unsupported density or film');if(pmt!==undefined&&!validPmt(technique.size,pmt))throw new Error('PMT outside the range for this pipe size');return crExposure(2*technique.wall*25.4,technique.sfd,pmt===undefined?crSuggestedPmt(technique.size):pmt);}
    const reference=FILM_REFERENCES[film];
    if(index<0||!reference||reference.group!==technique.group||!Number.isFinite(technique.wall)||!(technique.sfd>0))throw new Error('Unsupported density or film');
    return REFERENCE_CURIE_SECONDS[film][index]*geometryFactor(technique,REFERENCE_GEOMETRY[reference.group]);
  }
  // Internal and internal-offset times from the unrounded shot time: CR uses the owner's ÷8 and ÷3,
  // films ÷9 and ×1.15÷4. Internal rounds to the nearest second, offset rounds up.
  function internalSeconds(film,shot){return Math.round(shot/(film==='cr'?8:9));}
  function offsetSeconds(film,shot){return Math.ceil(film==='cr'?shot/3:shot*1.15/4);}
  // Exposure for any density between 2.0 and 4.0 on the film's curve: log-linear between the five
  // target densities, so a measured density such as 2.7 can be used for calibration.
  function exposureAtDensity(technique,film,density,pmt){
    if(!usesDensity(film))return densityExposure(technique,film,DENSITIES[0],pmt);
    if(!Number.isFinite(density)||density<DENSITIES[0]||density>DENSITIES[DENSITIES.length-1])throw new Error('Density outside the film curve');
    let i=0;while(i<DENSITIES.length-2&&density>DENSITIES[i+1])i++;
    const lower=densityExposure(technique,film,DENSITIES[i]),upper=densityExposure(technique,film,DENSITIES[i+1]);
    return lower*Math.pow(upper/lower,(density-DENSITIES[i])/(DENSITIES[i+1]-DENSITIES[i]));
  }
  const api={DENSITIES,CR_STEEL_HVL_MM,CR_K_REF,CR_PMT_REF,CR_PMT_DOUBLING,CR_PMT_RANGES,crPmtRange,crSuggestedPmt,validPmt,crExposure,usesDensity,internalSeconds,offsetSeconds,exposureAtDensity,STEEL_HVL_MM,MAX_STEEL_MM,withinSteelRange,REFERENCE_GEOMETRY,FILM_REFERENCES,REFERENCE_CURIE_SECONDS,geometryFactor,parseActivity,seconds,timeLabel,matchesSchedule,dayNumber,decay,densityExposure};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ShotCalculator=api;
})(typeof globalThis!=='undefined'?globalThis:this);
