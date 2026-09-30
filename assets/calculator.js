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
  // Approximate user-supplied calculator targets at 26 Ci. Index 3 is interpolated.
  // Small-film reference: 3-inch STD. Large-film reference: 4-inch STD.
  const FILM_REFERENCES={
    d4:{curieSeconds:250,times:[9,13,16,19.5,23]},
    mx125:{curieSeconds:450,times:[16,20,24,27.5,31]},
    ix50:{curieSeconds:495,times:[17,21,25,29.5,34]},
    d5:{curieSeconds:220,times:[11,15,19,23,27]},
    t200:{curieSeconds:390,times:[14,18,22,25.5,29]},
    ix80:{curieSeconds:466,times:[13,18,23,28,33]}
  };
  // Retained for one-time migration from editable density-3 baseline factors.
  const BASELINE_FACTORS={};
  for(const film of Object.keys(FILM_REFERENCES)){const r=FILM_REFERENCES[film];BASELINE_FACTORS[film]=26*r.times[2]/r.curieSeconds;}
  function densityExposure(technique,film,density){
    const index=DENSITIES.indexOf(density),reference=FILM_REFERENCES[film];
    if(index<0||!reference||!Number.isFinite(technique.exposures[film]))throw new Error('Unsupported density or film');
    return technique.exposures[film]*26*reference.times[index]/reference.curieSeconds;
  }
  const api={DENSITIES,FILM_REFERENCES,BASELINE_FACTORS,parseActivity,seconds,timeLabel,matchesSchedule,dayNumber,decay,densityExposure};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.ShotCalculator=api;
})(typeof globalThis!=='undefined'?globalThis:this);
