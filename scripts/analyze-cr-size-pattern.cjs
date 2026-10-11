// Research only: fit the original CR chart without changing calculator assets.
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../assets/calculator.js');
const root = path.resolve(__dirname, '..');
const excluded = new Set(['6|160', '6|XXH / XXS', '24|XH']);
const rows = JSON.parse(fs.readFileSync(path.join(root, 'assets/techniques.json'))).techniques
  .map(t => ({...t, id: `${t.size}|${t.schedule}`, x: 2*t.wall,
    e: calc.CHART_EXPOSURES.cr[`${t.size}|${t.schedule}`]}))
  .filter(t => t.e !== undefined);
const beta = Math.log(2)*25.4/12.1;
const models = [
  {name:'T200 thickness + constant factor', f:t=>[1]},
  {name:'T200 thickness + size power', f:t=>[1, Math.log(t.sfd/4.625)]},
  {name:'T200 thickness + curved size factor', f:t=>[1, Math.log(t.sfd/4.625), Math.log(t.sfd/4.625)**2]},
  {name:'Free thickness + size power', f:t=>[1, t.x-.474, Math.log(t.sfd/4.625)]},
  {name:'Free thickness + curved size factor', f:t=>[1, t.x-.474, Math.log(t.sfd/4.625), Math.log(t.sfd/4.625)**2]},
  {name:'Curved thickness + size power', f:t=>[1, t.x-.474, (t.x-.474)**2, Math.log(t.sfd/4.625)]},
  {name:'Thickness-size interaction', f:t=>[1, t.x-.474, Math.log(t.sfd/4.625), (t.x-.474)*Math.log(t.sfd/4.625)]},
  {name:'Free thickness + reciprocal size', f:t=>[1, t.x-.474, 4.625/t.sfd-1]},
  ...[6,8,10,12,14,16].map(k=>({name:`Free thickness + size slope break at ${k} inch reference SFD`,f:t=>[1,t.x-.474,Math.log(t.sfd/4.625),Math.max(0,Math.log(t.sfd/k))]})),
];
const baseline = t => 686.4*(t.sfd/4.625)**2*Math.exp(beta*(t.x-.474));
function solve(a,b){
  const n=b.length, m=a.map((r,i)=>[...r,b[i]]);
  for(let k=0;k<n;k++){
    let pivot=k;
    for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[pivot][k]))pivot=i;
    [m[k],m[pivot]]=[m[pivot],m[k]];
    if(Math.abs(m[k][k])<1e-10)throw Error('Singular fit');
    const d=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=d;
    for(let i=0;i<n;i++)if(i!==k){const f=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=f*m[k][j];}
  }
  return m.map(r=>r[n]);
}
function fit(model,train){
  const n=model.f(train[0]).length, a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
  for(const t of train){const f=model.f(t),y=Math.log(t.e/baseline(t));
    for(let i=0;i<n;i++){b[i]+=f[i]*y;for(let j=0;j<n;j++)a[i][j]+=f[i]*f[j];}}
  return solve(a,b);
}
function predict(model,c,t){return baseline(t)*Math.exp(model.f(t).reduce((s,v,i)=>s+v*c[i],0));}
function stats(results){
  const a=results.map(t=>Math.abs(t.predicted/t.e-1)*100).sort((a,b)=>a-b);
  const quantile=p=>{const k=(a.length-1)*p,l=Math.floor(k);return a[l]+(a[Math.ceil(k)]-a[l])*(k-l);};
  return {count:a.length,medianPercent:quantile(.5),p90Percent:quantile(.9),worstPercent:a.at(-1),within10:a.filter(x=>x<=10).length,within20:a.filter(x=>x<=20).length};
}
function evaluate(data){return models.map(model=>{
  const c=fit(model,data);
  const fitted=data.map(t=>({...t,predicted:predict(model,c,t)}));
  const sizeHoldout=data.map(t=>({...t,predicted:predict(model,fit(model,data.filter(r=>r.size!==t.size)),t)}));
  const thicknessHoldout=data.map(t=>({...t,predicted:predict(model,fit(model,data.filter(r=>r.x!==t.x)),t)}));
  return {name:model.name,coefficients:c,fit:stats(fitted),sizeHoldout:stats(sizeHoldout),interiorSizeHoldout:stats(sizeHoldout.filter(t=>t.size!==2&&t.size!==24)),thicknessHoldout:stats(thicknessHoldout),rows:fitted.map(t=>({id:t.id,x:t.x,sfd:t.sfd,e:t.e,predicted:t.predicted,errorPercent:100*(t.predicted/t.e-1),sizeHoldoutPercent:100*(sizeHoldout.find(r=>r.id===t.id).predicted/t.e-1)}))};
});}
// Check the regression and normalization on known synthetic coefficients.
const syntheticModel=models[3], expected=[-.3,.2,-.7];
const synthetic=rows.map(t=>({...t,e:predict(syntheticModel,expected,t)}));
if(fit(syntheticModel,synthetic).some((c,i)=>Math.abs(c-expected[i])>1e-9))throw Error('Synthetic regression failed');
const kept=rows.filter(t=>!excluded.has(t.id));
function selectBreak(train){
  return models.filter(m=>m.name.includes('slope break')).map(model=>{
    const c=fit(model,train),sse=train.reduce((s,t)=>s+Math.log(predict(model,c,t)/t.e)**2,0);
    return {model,c,sse};
  }).sort((a,b)=>a.sse-b.sse)[0];
}
function nestedBreak(data){
  const selected=selectBreak(data);
  const predictions=data.map(t=>{const held=selectBreak(data.filter(r=>r.size!==t.size));return {...t,predicted:predict(held.model,held.c,t),selected:held.model.name};});
  return {selected:selected.model.name,coefficients:selected.c,fit:stats(data.map(t=>({...t,predicted:predict(selected.model,selected.c,t)}))),sizeHoldout:stats(predictions),interiorSizeHoldout:stats(predictions.filter(t=>t.size!==2&&t.size!==24)),foldModels:[...new Set(data.map(t=>t.size))].map(size=>({size,selected:predictions.find(t=>t.size===size).selected})),rows:predictions.map(t=>({id:t.id,errorPercent:100*(t.predicted/t.e-1)}))};
}
const report={description:'Chart reproduction only; SFD in these fits is a proxy for pipe size in the source-contact chart, not a replacement for inverse-square scaling of actual shooting distance.',excluded:[...excluded],beta,retained:evaluate(kept),all:evaluate(rows),sameSteelGroups:[...new Set(kept.map(t=>t.x))].map(x=>({x,rows:kept.filter(t=>t.x===x).map(t=>({id:t.id,sfd:t.sfd,e:t.e,normalized:t.e/t.sfd**2,ratioT200:t.e/baseline(t)}))})).filter(g=>new Set(g.rows.map(t=>t.id.split('|')[0])).size>2)};
report.nestedBreak={retained:nestedBreak(kept),all:nestedBreak(rows)};
if(process.argv.includes('--write'))fs.writeFileSync(path.join(root,'docs/CR-SIZE-PATTERN-2026-10-10.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({retained:report.retained.map(({rows,...r})=>r),all:report.all.map(({rows,...r})=>r),sameSteelGroups:report.sameSteelGroups},null,2));
