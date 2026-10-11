// Research calibration only. The Android app does not load this module.
'use strict';
const C=require('../assets/calculator.js'),data=require('../assets/techniques.json');
const EXCLUDED_KEYS=Object.freeze(['6|160','6|XXH / XXS','24|XH']);
const REFERENCE_STEEL=2*C.REFERENCE_GEOMETRY.large.wall;
const T200_LOG_SLOPE=Math.log(2)*25.4/C.STEEL_HVL_MM;
const DIAGNOSTIC_THRESHOLD_PERCENT=20; // Reporting threshold, not an image acceptance criterion.
function checkGeometry(g){
  if(!g||!Number.isFinite(g.totalSteel)||g.totalSteel<=0)throw Error('Enter positive total steel penetrated in inches.');
  if(!Number.isFinite(g.sfd)||g.sfd<=0)throw Error('Enter a positive source-to-detector distance in inches.');
}
function baseline(g){
  checkGeometry(g);
  // Use the existing T200 curve without changing it or applying saved film settings.
  return C.customExposure(g.totalSteel,g.sfd,'t200',3);
}
function calibrationRows(){
  return data.techniques.filter(t=>{
    const id=t.size+'|'+t.schedule;
    return C.densityExposure(t,'cr',3)!==null&&!EXCLUDED_KEYS.includes(id);
  }).map(t=>({
    id:t.size+'|'+t.schedule,pipeSize:t.size,schedule:t.schedule,
    totalSteel:2*t.wall,sfd:t.sfd,ciSeconds:C.densityExposure(t,'cr',3),
    source:'CR chart with app-assumed SFD'
  }));
}
function errorMetrics(rows){
  if(!rows.length)return null;
  const errors=rows.map(r=>Math.abs(r.predicted/r.observed-1)*100).sort((a,b)=>a-b);
  const quantile=q=>{const p=(errors.length-1)*q;return errors[Math.floor(p)]+(errors[Math.ceil(p)]-errors[Math.floor(p)])*(p-Math.floor(p));};
  return {
    count:rows.length,medianAbsolutePercent:quantile(.5),p90AbsolutePercent:quantile(.9),
    maxAbsolutePercent:errors.at(-1),within10Percent:errors.filter(e=>e<=10).length,
    within20Percent:errors.filter(e=>e<=20).length
  };
}
function fit(references){
  if(!Array.isArray(references)||references.length===0)throw Error('At least one reference exposure is required.');
  const ids=new Set();
  const points=references.map(r=>{
    checkGeometry(r);
    if(typeof r.id!=='string'||!r.id.trim())throw Error('Each reference needs an identifier.');
    if(ids.has(r.id))throw Error('Duplicate reference identifier: '+r.id);
    ids.add(r.id);
    if(!Number.isFinite(r.ciSeconds)||r.ciSeconds<=0)throw Error('Each reference needs positive Ci seconds.');
    return {id:r.id,totalSteel:r.totalSteel,x:r.totalSteel-REFERENCE_STEEL,
      y:Math.log(r.ciSeconds/baseline(r)),observed:r.ciSeconds,baseline:baseline(r)};
  });
  const n=points.length,mx=points.reduce((s,p)=>s+p.x,0)/n,my=points.reduce((s,p)=>s+p.y,0)/n;
  const variance=points.reduce((s,p)=>s+(p.x-mx)**2,0);
  const attenuationCalibrated=variance>1e-16;
  const slope=attenuationCalibrated?points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/variance:0;
  const intercept=my-slope*mx;
  const logExposureSlope=T200_LOG_SLOPE+slope;
  if(!(logExposureSlope>0))throw Error('Distance-normalized exposure decreases with total steel; check reference distances and exposures.');
  const residuals=points.map(p=>({id:p.id,observed:p.observed,predicted:p.baseline*Math.exp(intercept+slope*p.x)}));
  const diagnostics=errorMetrics(residuals);
  const flags=[];
  if(!attenuationCalibrated)flags.push('steel-curve-inherited-from-t200');
  if(diagnostics.maxAbsolutePercent>DIAGNOSTIC_THRESHOLD_PERCENT)flags.push('inconsistent-reference-data');
  return Object.freeze({
    model:'total-steel-cr-v2',referenceSteel:REFERENCE_STEEL,intercept,slope,logExposureSlope,
    attenuationCalibrated,minSteel:Math.min(...points.map(p=>p.totalSteel)),
    maxSteel:Math.max(...points.map(p=>p.totalSteel)),referenceIds:[...ids],
    diagnostics,diagnosticThresholdPercent:DIAGNOSTIC_THRESHOLD_PERCENT,residuals,flags
  });
}
function predict(g,profile){
  checkGeometry(g);
  if(!profile||profile.model!=='total-steel-cr-v2'||![profile.intercept,profile.slope,profile.referenceSteel,profile.minSteel,profile.maxSteel].every(Number.isFinite))throw Error('Pass a CR calibration profile from fit().');
  if(!(T200_LOG_SLOPE+profile.slope>0)||profile.minSteel<=0||profile.maxSteel<profile.minSteel)throw Error('Invalid CR calibration profile.');
  if(g.totalSteel*25.4>C.MAX_STEEL_MM)return {ciSeconds:null,correction:null,extrapolated:false,status:'outside-steel-range',flags:[]};
  const correction=Math.exp(profile.intercept+profile.slope*(g.totalSteel-profile.referenceSteel));
  const ciSeconds=baseline(g)*correction;
  if(!Number.isFinite(ciSeconds)||ciSeconds<=0)throw Error('CR estimate is out of range.');
  const extrapolated=g.totalSteel<profile.minSteel||g.totalSteel>profile.maxSteel;
  const flags=[...profile.flags];
  if(extrapolated)flags.push('thickness-extrapolation');
  return {ciSeconds,correction,extrapolated,status:'research-estimate',flags};
}
function shot(g,activity,profile){
  C.seconds(1,activity);
  const result=predict(g,profile);
  return {...result,seconds:result.ciSeconds===null?null:C.seconds(result.ciSeconds,activity)};
}
module.exports={EXCLUDED_KEYS,REFERENCE_STEEL,T200_LOG_SLOPE,DIAGNOSTIC_THRESHOLD_PERCENT,baseline,calibrationRows,errorMetrics,fit,predict,shot};
