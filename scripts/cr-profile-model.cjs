// Carestream CR exposure model with scan profiles. Research module: not loaded by the app.
//
//   Ci·s = K(profile) × (D / 4.625 in)² × 2^((X − 12.04 mm) / H)
//
// X is total steel in the beam (mm), D the actual source-to-plate distance (in), H the effective
// steel doubling thickness for CR, and K the Ci·s a scan profile (PMT, laser, pitch, target pixel
// value) needs at the reference geometry (4" STD double wall). Geometry moves exposure by physics
// alone; everything the scanner does lives in K. Changing PMT changes K, never H or the distance law.
//
// Run `node scripts/cr-profile-model.cjs` for the chart decomposition report.
'use strict';
const REF={steelMm:2*0.237*25.4,sfdIn:4.625};
// Fitted within pipe sizes of the owner's chart (one setting per size), so PMT changes between
// sizes cannot leak into it. Ir-192 narrow-beam steel HVL is ~13 mm; CR with build-up reads a bit higher.
const HVL_MM=14.8;
const geometry=(steelMm,sfdIn,hvl=HVL_MM)=>Math.pow(sfdIn/REF.sfdIn,2)*Math.pow(2,(steelMm-REF.steelMm)/hvl);

// Profile constant from anchor shots that gave good images at one scanner setting. Each anchor:
// {steelMm, sfdIn, activityCi, seconds}. Geometric mean, so one long shot does not dominate.
function calibrate(anchors,{name='profile',hvlMm=HVL_MM}={}){
  if(!Array.isArray(anchors)||!anchors.length)throw new Error('At least one anchor shot is needed');
  const logs=anchors.map(a=>{
    if(!(a.steelMm>0&&a.sfdIn>0&&a.activityCi>0&&a.seconds>0))throw new Error('Anchor needs positive steelMm, sfdIn, activityCi and seconds');
    return Math.log(a.activityCi*a.seconds/geometry(a.steelMm,a.sfdIn,hvlMm));});
  const mean=logs.reduce((s,v)=>s+v,0)/logs.length;
  const spread=logs.length>1?Math.exp(Math.max(...logs)-Math.min(...logs)):1;
  return {name,K:Math.exp(mean),hvlMm,anchors:anchors.length,spread};
}
// Move a profile to another PMT/pixel target without new shots, only from a measured relative gain
// (signal at new setting ÷ signal at old, same exposure, offset-subtracted linear pixels).
function rescale(profile,{gainRatio=1,pixelRatio=1,name}={}){
  if(!(gainRatio>0&&pixelRatio>0))throw new Error('Ratios must be positive');
  return {...profile,name:name||profile.name+' (rescaled)',K:profile.K*pixelRatio/gainRatio};
}
function curieSeconds(steelMm,sfdIn,profile){
  if(!(steelMm>0&&sfdIn>0))throw new Error('Steel and distance must be positive');
  return profile.K*geometry(steelMm,sfdIn,profile.hvlMm);
}
function shotSeconds(steelMm,sfdIn,activityCi,profile){
  if(!(activityCi>0))throw new Error('Activity must be positive');
  return curieSeconds(steelMm,sfdIn,profile)/activityCi;
}

// Chart decomposition: ln(Ci·s / D²) = ln K_group + (X − Xref)·ln2/H, least squares, one K per group.
function solve(X,y){const n=X[0].length,A=X[0].map(()=>Array(n).fill(0)),b=Array(n).fill(0);
  X.forEach((x,i)=>{for(let p=0;p<n;p++){b[p]+=x[p]*y[i];for(let q=0;q<n;q++)A[p][q]+=x[p]*x[q];}});
  for(let i=0;i<n;i++){let m=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[m][i]))m=r;
    [A[i],A[m]]=[A[m],A[i]];[b[i],b[m]]=[b[m],b[i]];
    for(let r=0;r<n;r++)if(r!==i){const f=A[r][i]/A[i][i];for(let c=i;c<n;c++)A[r][c]-=f*A[i][c];b[r]-=f*b[i];}}
  return b.map((v,i)=>v/A[i][i]);}
function fitChart(rows,group=r=>String(r.size),{hvlMm}={}){
  const groups=[...new Set(rows.map(group))];
  const X=rows.map(r=>[...groups.map(g=>group(r)===g?1:0),...(hvlMm?[]:[r.steelMm-REF.steelMm])]);
  const y=rows.map(r=>Math.log(r.curieSeconds/Math.pow(r.sfdIn/REF.sfdIn,2))-(hvlMm?(r.steelMm-REF.steelMm)*Math.LN2/hvlMm:0));
  const c=solve(X,y),hvl=hvlMm||Math.LN2/c[groups.length];
  const K=Object.fromEntries(groups.map((g,i)=>[g,Math.exp(c[i])]));
  return {hvlMm:hvl,K,predict:r=>K[group(r)]*geometry(r.steelMm,r.sfdIn,hvl)};
}
function errorStats(errors){const e=errors.map(Math.abs).sort((a,b)=>a-b);
  return {n:e.length,median:e[e.length>>1],p90:e[Math.floor(.9*(e.length-1))],max:e[e.length-1],within20:e.filter(v=>v<=.2).length};}
function leaveOneOut(rows,group,opts){
  return errorStats(rows.map(r=>{const f=fitChart(rows.filter(q=>q!==r),group,opts);return f.predict(r)/r.curieSeconds-1;}));}

function chartRows(){
  const C=require('../assets/calculator.js'),T=require('../assets/techniques.json').techniques;
  return T.filter(t=>C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]!=null).map(t=>({key:t.size+'|'+t.schedule,size:t.size,
    steelMm:2*t.wall*25.4,sfdIn:t.sfd,curieSeconds:C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]}));
}
// Entries that disagree with their own pipe size's trend (not proof they are wrong; owner to check).
const SUSPECT=['6|XXH / XXS','14|40','24|XH'];

module.exports={REF,HVL_MM,SUSPECT,geometry,calibrate,rescale,curieSeconds,shotSeconds,fitChart,leaveOneOut,errorStats,chartRows};

if(require.main===module){
  const all=chartRows(),rows=all.filter(r=>!SUSPECT.includes(r.key)),pct=v=>(100*v).toFixed(1)+'%';
  const line=(name,group,opts)=>{const f=fitChart(rows,group,opts),l=leaveOneOut(rows,group,opts);
    console.log(`${name.padEnd(40)} H ${f.hvlMm.toFixed(2)} mm  leave-one-out median ${pct(l.median)}  p90 ${pct(l.p90)}  max ${pct(l.max)}  ≤20% ${l.within20}/${l.n}`);return f;};
  console.log(`Owner CR chart: ${all.length} rows, ${rows.length} used (${SUSPECT.join(', ')} set aside)\n`);
  line('One K for every size (fixed scanner gain)',()=>'all');
  const f=line('One K per pipe size (setting per size)',r=>String(r.size));
  line('Same, H fixed 13.0 mm',r=>String(r.size),{hvlMm:13});
  line('Same, H fixed 12.1 mm (film model)',r=>String(r.size),{hvlMm:12.1});
  console.log('\nK per size (Ci·s at 4" STD geometry) and gain the scanner must add vs 4":');
  for(const [s,K] of Object.entries(f.K))console.log(`  NPS ${s.padStart(2)}  K ${K.toFixed(0).padStart(4)}  ×${(f.K['4']/K).toFixed(2)}`);
  console.log('\nSet-aside rows, chart vs model:');
  for(const k of SUSPECT){const r=all.find(q=>q.key===k);console.log(`  ${k.padEnd(12)} chart ${r.curieSeconds}  model ${f.predict(r).toFixed(0)}`);}
}
