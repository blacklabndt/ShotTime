// Offline fitting only. Enumerates monotone, per-size PMT assignments in the printed ranges.
// ln(Ci s / SFD_in^2) = a + b * totalSteel_mm - c * (PMT - 40).
// PMTs are latent assumptions, not measured settings. No film baseline is used.
'use strict';
const bounds=size=>size<=3?[20,50]:size<=8?[30,60]:[40,70];
function fit(rows){
  if(rows.length<3)throw Error('At least three reference rows required');
  const sizes=[...new Set(rows.map(r=>r.size))].sort((a,b)=>a-b);
  const groups=sizes.map(size=>{const rr=rows.filter(r=>r.size===size);return {n:rr.length,x:rr.reduce((s,r)=>s+r.x,0),y:rr.reduce((s,r)=>s+Math.log(r.y/(r.d*r.d)),0)};});
  let sx=0,sy=0,sxx=0,sxy=0,syy=0;const n=rows.length;
  for(const r of rows){const y=Math.log(r.y/(r.d*r.d));sx+=r.x;sy+=y;sxx+=r.x*r.x;sxy+=r.x*y;syy+=y*y;}
  const xx=sxx-sx*sx/n,xy=sxy-sx*sy/n,yy=syy-sy*sy/n,candidates=[];
  function visit(ps){
    if(ps.length<sizes.length){const [lo,hi]=bounds(sizes[ps.length]);for(let p=Math.max(lo,ps.at(-1)||lo);p<=hi;p+=10)visit([...ps,p]);return;}
    let sz=0,szz=0,sxz=0,syz=0;
    ps.forEach((p,i)=>{const z=40-p,g=groups[i];sz+=z*g.n;szz+=z*z*g.n;sxz+=z*g.x;syz+=z*g.y;});
    const zz=szz-sz*sz/n,xz=sxz-sx*sz/n,yz=syz-sy*sz/n,det=xx*zz-xz*xz;if(det<1e-10)return;
    const b=(xy*zz-yz*xz)/det,c=(yz*xx-xy*xz)/det,a=(sy-b*sx-c*sz)/n;
    if(b<Math.LN2/30||b>Math.LN2/5||c<=0)return;
    const sse=Math.max(0,yy-b*xy-c*yz);
    candidates.push({a,b,c,sse,pmts:Object.fromEntries(sizes.map((s,i)=>[s,ps[i]]))});
  }
  visit([]);candidates.sort((a,b)=>a.sse-b.sse||Math.abs(a.pmts[4]-40)-Math.abs(b.pmts[4]-40));
  if(!candidates.length)throw Error('No positive attenuation/gain model fits these constraints');
  const best=candidates[0];return {...best,candidateCount:candidates.length,alternatives:candidates.filter(c=>c.sse<=best.sse*1.05+1e-10).slice(0,30)};
}
function pmtAt(model,size){
  const keys=Object.keys(model.pmts).map(Number).sort((a,b)=>a-b);if(model.pmts[size]!=null)return model.pmts[size];
  let p=model.pmts[size<keys[0]?keys[0]:keys.at(-1)];
  for(let i=1;i<keys.length;i++)if(size>keys[i-1]&&size<keys[i]){const lo=keys[i-1],hi=keys[i];p=model.pmts[lo]+(model.pmts[hi]-model.pmts[lo])*(size-lo)/(hi-lo);break;}
  const [lo,hi]=bounds(size);return Math.max(lo,Math.min(hi,Math.round(p/10)*10));
}
function predict(model,r){return r.d*r.d*Math.exp(model.a+model.b*r.x-model.c*((r.p??pmtAt(model,r.size))-40));}
function metrics(rows){const e=rows.map(r=>Math.abs(r.predicted/r.y-1)*100).sort((a,b)=>a-b);return {count:e.length,median:(e[Math.floor((e.length-1)/2)]+e[Math.floor(e.length/2)])/2,p90:e[Math.floor(.9*(e.length-1))],max:e.at(-1),within20:e.filter(v=>v<=20).length};}
function chartRows(){const C=require('../assets/calculator.js'),T=require('../assets/techniques.json');return T.techniques.filter(t=>C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]!=null).map(t=>({id:t.size+'|'+t.schedule,size:t.size,x:2*t.wall*25.4,d:t.sfd,y:C.CHART_EXPOSURES.cr[t.size+'|'+t.schedule]}));}
function evaluate(rows){const model=fit(rows),fitted=rows.map(r=>({...r,p:pmtAt(model,r.size),predicted:predict(model,r)}));
  const held=rows.map(r=>({...r,predicted:predict(fit(rows.filter(q=>q!==r)),r)}));
  const sizeHeld=[];for(const size of [...new Set(rows.map(r=>r.size))]){const m=fit(rows.filter(r=>r.size!==size));for(const r of rows.filter(r=>r.size===size))sizeHeld.push({...r,p:pmtAt(m,size),predicted:predict(m,r)});}
  return {model,fit:metrics(fitted),rowHoldout:metrics(held),sizeHoldout:metrics(sizeHeld),rows:fitted.map(r=>({...r,errorPercent:100*(r.predicted/r.y-1),holdout:held.find(h=>h.id===r.id).predicted,sizeHoldout:sizeHeld.find(h=>h.id===r.id).predicted}))};
}
module.exports={fit,predict,pmtAt,metrics,chartRows,evaluate};
if(require.main===module){const report=evaluate(chartRows());require('node:fs').writeFileSync(require('node:path').join(__dirname,'../docs/CR-FIELD-FIT.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));}
