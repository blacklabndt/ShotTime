// Read-only analysis. Prints candidate exposures; does not change runtime data.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),calc=require('../assets/calculator.js');
const rows=JSON.parse(fs.readFileSync(path.join(root,'assets/techniques.json'))).techniques;
const key=t=>`${t.size}|${t.schedule}`;
const exclusions=new Set(['6|160','6|XXH / XXS','24|XH']);
const known=rows.filter(t=>calc.densityExposure(t,'cr',3)!==null&&!exclusions.has(key(t)));
function wallEstimate(t,refs){
  const points=[...new Map(refs.filter(r=>r.size===t.size).map(r=>[r.wall,r])).values()].sort((a,b)=>a.wall-b.wall);
  if(points.length<2)return null;
  const exact=points.find(r=>r.wall===t.wall);
  if(exact)return {value:calc.densityExposure(exact,'cr',3),method:'Equivalent wall',anchors:[key(exact)]};
  let lo=points.filter(r=>r.wall<t.wall).at(-1),hi=points.find(r=>r.wall>t.wall),method='Wall interpolation';
  if(!lo){[lo,hi]=points;method='Thin-wall extrapolation';}
  else if(!hi){[lo,hi]=points.slice(-2);method='Thick-wall extrapolation';}
  const a=calc.densityExposure(lo,'cr',3),b=calc.densityExposure(hi,'cr',3);
  return {value:a*Math.pow(b/a,(t.wall-lo.wall)/(hi.wall-lo.wall)),method,anchors:[key(lo),key(hi)]};
}
function estimate(t,refs){
  const same=wallEstimate(t,refs);if(same)return same;
  // Owner confirms NPS 1 only uses 12-inch SFD, with film against the spool.
  // Provisional transfer from NPS 2 at equal wall, then inverse-square scaling.
  // Assumes comparable CR response/scatter; no NPS 1 test-shot anchor exists.
  if(t.size===1){
    const base=wallEstimate({...t,size:2},refs),reference=refs.find(r=>r.size===2);
    if(!base||!reference)return null;
    return {value:base.value*(t.sfd/reference.sfd)**2,method:'1-inch 12-inch SFD transfer; '+base.method,anchors:base.anchors};
  }
  const sizes=[...new Set(refs.map(r=>r.size))].sort((a,b)=>a-b);
  const lo=sizes.filter(s=>s<t.size).at(-1),hi=sizes.find(s=>s>t.size);
  if(lo===undefined||hi===undefined)return null;
  const a=wallEstimate({...t,size:lo},refs),b=wallEstimate({...t,size:hi},refs);
  const da=refs.find(r=>r.size===lo).sfd,db=refs.find(r=>r.size===hi).sfd;
  const fraction=Math.log(t.sfd/da)/Math.log(db/da);
  const value=t.sfd**2*Math.exp(Math.log(a.value/da**2)*(1-fraction)+Math.log(b.value/db**2)*fraction);
  return {value,method:'Size interpolation'+([a,b].some(x=>/extrapolation/.test(x.method))?' with wall extrapolation':''),anchors:[...a.anchors,...b.anchors]};
}
const candidates=rows.filter(t=>calc.densityExposure(t,'cr',3)===null).map(t=>{
  const e=estimate(t,known);
  return {nps:t.size,schedule:t.schedule,wall:t.wall,sfd:t.sfd,ciSeconds:e?Math.round(e.value):null,method:e?.method||'No supporting reference',anchors:e?.anchors||[],outsideSteelRange:!calc.withinSteelRange(t)};
});
function metrics(errors){const a=errors.sort((a,b)=>a-b);return {count:a.length,medianPercent:100*(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2,maxPercent:100*a.at(-1)};}
const pointErrors=known.map(t=>{const e=estimate(t,known.filter(r=>r!==t&&!(r.size===t.size&&r.wall===t.wall)));return e?Math.abs(e.value/calc.densityExposure(t,'cr',3)-1):null;}).filter(x=>x!==null);
const sizeErrors=known.map(t=>{const e=estimate(t,known.filter(r=>r.size!==t.size));return e?Math.abs(e.value/calc.densityExposure(t,'cr',3)-1):null;}).filter(x=>x!==null);
if(candidates.length!==58||candidates.filter(x=>x.ciSeconds!==null).length!==58)throw Error('Unexpected coverage');
if(candidates.some(x=>x.ciSeconds!==null&&!(x.ciSeconds>0)))throw Error('Invalid estimate');
console.log(JSON.stringify({candidates,pointHoldout:metrics(pointErrors),sizeHoldout:metrics(sizeErrors)},null,2));
