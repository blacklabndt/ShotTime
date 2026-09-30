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
  function usesDensity(film){return !CHART_EXPOSURES[film];}
  function densityExposure(technique,film,density){
    const index=DENSITIES.indexOf(density),chart=CHART_EXPOSURES[film];
    if(chart){if(index<0||!technique)throw new Error('Unsupported density or film');const value=chart[technique.size+'|'+technique.schedule];return value===undefined?null:value;}
    const reference=FILM_REFERENCES[film];
    if(index<0||!reference||reference.group!==technique.group||!Number.isFinite(technique.wall)||!(technique.sfd>0))throw new Error('Unsupported density or film');
    return REFERENCE_CURIE_SECONDS[film][index]*geometryFactor(technique,REFERENCE_GEOMETRY[reference.group]);
  }
  // Internal and internal-offset times from the unrounded shot time: CR uses its chart's ÷8 and ÷3,
  // films ÷9 and ×1.15÷4. Internal rounds to the nearest second, offset rounds up.
  function internalSeconds(film,shot){return Math.round(shot/(CHART_EXPOSURES[film]?8:9));}
  function offsetSeconds(film,shot){return Math.ceil(CHART_EXPOSURES[film]?shot/3:shot*1.15/4);}
  // Exposure for any density between 2.0 and 4.0 on the film's curve: log-linear between the five
  // target densities, so a measured density such as 2.7 can be used for calibration.
  function exposureAtDensity(technique,film,density){
    if(!usesDensity(film))return densityExposure(technique,film,DENSITIES[0]);
    if(!Number.isFinite(density)||density<DENSITIES[0]||density>DENSITIES[DENSITIES.length-1])throw new Error('Density outside the film curve');
    let i=0;while(i<DENSITIES.length-2&&density>DENSITIES[i+1])i++;
    const lower=densityExposure(technique,film,DENSITIES[i]),upper=densityExposure(technique,film,DENSITIES[i+1]);
    return lower*Math.pow(upper/lower,(density-DENSITIES[i])/(DENSITIES[i+1]-DENSITIES[i]));
  }
  const api={DENSITIES,CHART_EXPOSURES,usesDensity,internalSeconds,offsetSeconds,exposureAtDensity,STEEL_HVL_MM,MAX_STEEL_MM,withinSteelRange,REFERENCE_GEOMETRY,FILM_REFERENCES,REFERENCE_CURIE_SECONDS,geometryFactor,parseActivity,seconds,timeLabel,matchesSchedule,dayNumber,decay,densityExposure};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ShotCalculator=api;
})(typeof globalThis!=='undefined'?globalThis:this);
