// Reproducible chart-consistency analysis, not physical exposure validation.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const M=require('./cr-calibrated-model.cjs'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json');
const refs=M.calibrationRows(),profile=M.fit(refs);
const metric=rows=>M.errorMetrics(rows);
function holdout(mode){
  const predictions=[];
  for(const t of refs){
    // Remove every equal-thickness reference, including duplicates across pipe sizes.
    const train=refs.filter(r=>mode==='size'?r.pipeSize!==t.pipeSize:r.totalSteel!==t.totalSteel);
    const fitted=M.fit(train),p=M.predict(t,fitted);
    assert.ok(!fitted.referenceIds.includes(t.id));
    assert.ok(train.every(r=>mode==='size'?r.pipeSize!==t.pipeSize:r.totalSteel!==t.totalSteel));
    assert.ok(Number.isFinite(p.ciSeconds)&&p.ciSeconds>0);
    predictions.push({
      id:t.id,pipeSize:t.pipeSize,totalSteel:t.totalSteel,sfd:t.sfd,observed:t.ciSeconds,
      predicted:p.ciSeconds,errorPercent:100*(p.ciSeconds/t.ciSeconds-1),
      extrapolated:p.extrapolated,trainingReferenceIds:fitted.referenceIds
    });
  }
  return {
    all:metric(predictions),interpolation:metric(predictions.filter(r=>!r.extrapolated)),
    extrapolation:metric(predictions.filter(r=>r.extrapolated)),predictions
  };
}
const thickness=holdout('thickness'),size=holdout('size');
// Compare with retaining the T200 attenuation exactly and fitting only a detector multiplier.
const constantFactor=references=>Math.exp(references.reduce((sum,r)=>sum+Math.log(r.ciSeconds/M.baseline(r)),0)/references.length);
const constant=constantFactor(refs);
const constantSizePredictions=refs.map(t=>({
  observed:t.ciSeconds,predicted:M.baseline(t)*constantFactor(refs.filter(r=>r.pipeSize!==t.pipeSize))
}));
const rows=data.techniques.map(t=>{
  const geometry={totalSteel:2*t.wall,sfd:t.sfd};
  const estimate=M.shot(geometry,26,profile),id=t.size+'|'+t.schedule;
  return {
    id,pipeSize:t.size,schedule:t.schedule,...geometry,chartCiSeconds:C.densityExposure(t,'cr',3),
    t200BaselineCiSeconds:estimate.ciSeconds===null?null:M.baseline(geometry),
    excludedFromCalibration:M.EXCLUDED_KEYS.includes(id),...estimate
  };
});
const normalizedGroups=new Map();
for(const r of refs){
  if(!normalizedGroups.has(r.totalSteel))normalizedGroups.set(r.totalSteel,[]);
  normalizedGroups.get(r.totalSteel).push({
    id:r.id,sfd:r.sfd,ciSeconds:r.ciSeconds,normalizedCiSeconds:r.ciSeconds/r.sfd**2
  });
}
const equalSteelComparisons=[...normalizedGroups].filter(([,group])=>group.length>1).map(([totalSteel,references])=>{
  const values=references.map(r=>r.normalizedCiSeconds);
  return {totalSteel,maximumToMinimumRatio:Math.max(...values)/Math.min(...values),references};
});
const confirmedEndpoints=['2|80 / XH','10|40 / STD'].map(id=>{
  const r=refs.find(r=>r.id===id);
  assert.ok(r,'Missing confirmed endpoint '+id);
  return {...r,source:'Chart exposure; successful shot and actual SFD confirmed by owner',normalizedCiSeconds:r.ciSeconds/r.sfd**2};
});
let endpointFitError=null;
try{M.fit(confirmedEndpoints);}catch(error){endpointFitError=error.message;}
assert.match(endpointFitError||'',/decreases with total steel/);
const allChartRefs=rows.filter(r=>r.chartCiSeconds!==null).map(r=>({
  id:r.id,totalSteel:r.totalSteel,sfd:r.sfd,ciSeconds:r.chartCiSeconds
}));
const allChartProfile=M.fit(allChartRefs);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex');
const productionHashes={
  'assets/calculator.js':hash('assets/calculator.js'),'assets/techniques.json':hash('assets/techniques.json'),
  'assets/index.html':hash('assets/index.html')
};
// The later, separate cr70 option changed source files but not these analysis inputs.
const calibrationInputs={t200:{hvl:C.STEEL_HVL_MM,reference:C.REFERENCE_GEOMETRY.large,curieSeconds:C.REFERENCE_CURIE_SECONDS.t200[2]},techniques:data.techniques,crChart:C.CHART_EXPOSURES.cr};
const calibrationInputHash=crypto.createHash('sha256').update(JSON.stringify(calibrationInputs)).digest('hex');
assert.equal(calibrationInputHash,'972d7e5dc02e5f84849fa01e6d28f5988378932cbeef525217dcf1cafe19fe8e','Reassess this dated report if its T200, geometry or chart inputs change.');
const summary={
  model:profile.model,chartRows:allChartRefs.length,calibrationRows:refs.length,
  distinctCalibrationThicknesses:normalizedGroups.size,excluded:M.EXCLUDED_KEYS,
  coefficients:{
    referenceSteelInches:profile.referenceSteel,logCorrectionIntercept:profile.intercept,
    logCorrectionSlopePerInch:profile.slope,logExposureSlopePerInch:profile.logExposureSlope,
    empiricalExposureDoublingThicknessMm:25.4*Math.log(2)/profile.logExposureSlope
  },
  calibrationSteelRangeInches:[profile.minSteel,profile.maxSteel],
  trainingFit:profile.diagnostics,thicknessHoldout:thickness.all,wholeSizeHoldout:size.all,
  retainedT200Attenuation:{
    correction:constant,
    trainingFit:metric(refs.map(r=>({observed:r.ciSeconds,predicted:M.baseline(r)*constant}))),
    wholeSizeHoldout:metric(constantSizePredictions)
  },
  includingAll56ChartRows:{trainingFit:allChartProfile.diagnostics},
  flags:profile.flags,missingWithinSteelRange:rows.filter(r=>r.chartCiSeconds===null&&r.ciSeconds!==null).length,
  blockedOutsideSteelRange:rows.filter(r=>r.status==='outside-steel-range').length,
  confirmedEndpoints,endpointFitError,calibrationInputHash,productionHashes
};
assert.equal(thickness.all.count,53);assert.equal(size.all.count,53);
assert.equal(summary.chartRows,56);assert.equal(rows.length,114);
assert.equal(summary.missingWithinSteelRange,53);assert.equal(summary.blockedOutsideSteelRange,5);
const report={
  date:'2026-10-10',status:'Research chart comparison only; fitted curve differs from chart, but CR image acceptability has not been evaluated; not loaded by the app.',
  interpretation:'Successful CR shots can lie at different points within an acceptable exposure range. Residuals and 10%/20% bins measure chart reproduction, not image failure. The diagnostic named inconsistent-reference-data is a model-to-reference mismatch flag, not proof of incorrect chart values. No acceptable exposure interval or universal 70%-of-T200 target is established.',
  supersedes:'Earlier size-dependent CR model and its holdout accuracy figures.',
  laterImplementation:'A separate owner-selected cr70 formula is available in both calculators at 70% of the fixed T200 density-3 baseline. It does not use this chart-fit model. See docs/CR-FORMULA-70.md.',
  normalization:'Unchanged T200 density-3 baseline; total steel and actual SFD in inches; Ci seconds divided by activity; example times at 26 Ci.',
  sourceInterpretation:'Chart pipe rows use totalSteel = 2 * wall. This conversion belongs to chart import, not the generic predictor.',
  fieldEvidence:'Owner reports some successful CR shots from 2-inch XH through 10-inch STD and confirms actual endpoint SFDs 2.5 and 10.875 inches. Intermediate schedules, adjustments and image-quality targets were not recorded.',
  summary,profile,thicknessHoldout:thickness,sizeHoldout:size,equalSteelComparisons,rows
};
if(process.argv.includes('--write')){
  const target=path.join(__dirname,'../docs/CR-CALIBRATION-2026-10-10.json');
  fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
  console.log('Saved docs/CR-CALIBRATION-2026-10-10.json');
}
console.log(JSON.stringify(summary,null,2));
