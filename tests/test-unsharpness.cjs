const assert=require('node:assert/strict');
const fs=require('node:fs');
const file=require('node:path').join(__dirname,'../assets/unsharpness.js');
assert.ok(fs.existsSync(file),'Geometric unsharpness calculation module is implemented');
const U=require(file);
const base={code:'b313',medium:'film',unit:'mm',basis:'mm',source:3,distance:600,gap:25,thickness:25};
const calc=o=>U.calculate({...base,...o});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
// Catch the common error of dividing by SFD instead of source-to-object distance.
near(calc({}).ug,.125);near(calc({}).sfd,625);near(calc({}).minimumD,147.05882352941177);
near(calc({unit:'in',source:3/25.4,distance:600/25.4,gap:25/25.4,thickness:25/25.4}).ug,.125);
for(const [thickness,limit] of [[49.999,.51],[50,.76],[75,.76],[75.001,1.02],[100,1.02],[100.001,1.78]])assert.equal(calc({thickness}).limit,limit);
for(const [thickness,limit] of [[1.999,.020],[2,.030],[3,.030],[3.001,.040],[4,.040],[4.001,.070]])near(calc({unit:'in',basis:'in',thickness}).limit,limit*25.4);
assert.equal(calc({source:.51,distance:25,gap:25}).within,true);
assert.equal(calc({source:.510001,distance:25,gap:25}).within,false);
// Overrides must not inherit the thinner-wall Section V recommendation.
assert.equal(calc({code:'b311'}).limit,2);assert.equal(calc({code:'i'}).limit,1.8);
near(calc({code:'b311',basis:'in'}).limit,1.778);
assert.equal(calc({code:'viii',medium:'film'}).kind,'guide');
assert.equal(calc({code:'viii',medium:'cr'}).kind,'recommendation');
assert.equal(calc({code:'ix'}).kind,'guide');
// CSA checks SFD/d, not D/d, and does not invent a maximum Ug.
for(const code of ['csa-sweet','csa-sour']){
 const r=calc({code,distance:150});assert.equal(r.limit,null);assert.equal(r.within,true);near(r.minimumD,150);near(r.preferredD,225);
 assert.equal(calc({code,distance:149.999}).within,false);assert.equal(calc({code,distance:225}).preferred,true);
}
for(const key of ['source','distance','gap'])for(const bad of ['',0,-1,'no',Infinity,NaN,'1/2'])assert.throws(()=>calc({[key]:bad}));
for(const bad of ['',0,-1,Infinity])assert.throws(()=>calc({thickness:bad}));
for(const key of ['code','unit','basis','medium'])assert.throws(()=>calc({[key]:'bad'}));
assert.throws(()=>calc({source:1e308,distance:1e-308,gap:1e308}));
console.log('Unsharpness: formula, units, boundaries, code overrides, CSA geometry and invalid inputs passed.');
