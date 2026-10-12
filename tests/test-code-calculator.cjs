const assert=require('node:assert/strict');
const C=require('../assets/code-calculator.js');
const data=require('../assets/code-data.json');
const calc=(id,t,extra={})=>C.calculate({id,thickness:t,unit:'mm',length:300,nps:4,boilerJoint:'pipe',temperatureBand:'mid',weldSides:'single',weldWidth:40,...extra},data);
const limit=(r,key)=>r.cards.find(c=>c.key===key);
for(const bad of ['',null,0,-1,Infinity,NaN,'abc'])assert.throws(()=>calc('b313-normal',bad),/thickness/i);
assert.throws(()=>calc('missing',5),/code/i);
assert.equal(C.definitions.find(d=>d.id==='b311').edition,'2012');
assert.equal(limit(calc('b313-normal',6),'reinforcement').values[0].value,1.5);
assert.equal(limit(calc('b313-normal',6.001),'reinforcement').values[0].value,3);
assert.equal(limit(calc('b313-normal',13.001),'reinforcement').values[0].value,4);
assert.equal(limit(calc('b313-normal',25.001),'reinforcement').values[0].value,5);
assert.equal(limit(calc('b313-normal',8,{length:100}),'fusion').values[0].value,25);
assert.equal(limit(calc('b313-normal',8,{length:100}),'linear').values[2].value,8);
assert.equal(limit(calc('b313-severe',9),'linear').values[0].value,3);
assert.equal(limit(calc('b313-severe',9),'linear').values[1].value,2.5);
assert.equal(limit(calc('ix',10),'linear').values[0].value,3);
assert.equal(limit(calc('ix',10.5),'linear').values[0].value,3.5);
assert.equal(limit(calc('ix',58),'linear').values[0].value,19);
assert.equal(limit(calc('ix',5),'rounded').values[0].value,1);
assert.equal(limit(calc('ix',20),'rounded').values[0].value,3);
assert.equal(limit(calc('viii-full',19),'linear').values[0].value,6);
assert.equal(limit(calc('viii-full',30),'linear').values[0].value,10);
assert.equal(limit(calc('viii-full',58),'linear').values[0].value,19);
assert.match(limit(calc('viii-spot',5),'linear').note,/less than 6 mm/);
assert.equal(limit(calc('viii-spot',40,{length:150}),'aligned').values[0].value,25);
assert.throws(()=>calc('viii-spot',20,{length:149}),/150/);
assert.equal(limit(calc('csa-sweet',5),'burn').values[0].value,5);
assert.equal(limit(calc('csa-sweet',10),'burn').values[0].value,6);
assert.equal(limit(calc('csa-sweet',8,{length:200}),'root').values[1].value,16);
assert.equal(limit(calc('csa-sweet',8,{length:300}),'root').values[1].value,25);
assert.equal(limit(calc('csa-sweet',8,{nps:1.5}),'slag').values[0].value,24);
assert.equal(limit(calc('csa-sweet',8,{nps:2}),'slag').values[0].value,50);
assert.equal(limit(calc('csa-sweet',5),'undercut').values[0].value,.3);
assert.deepEqual(calc('ix',25.4).cards,calc('ix',1,{unit:'in',length:300/25.4}).cards);
assert.equal(C.asmeIqi(6.4).source,5);
assert.equal(C.asmeIqi(6.40001).source,6);
assert.equal(C.asmeIqi(63.5).source,12);
assert.equal(C.asmeIqi(63.50001).source,13);
assert.equal(C.asmeIqi(508).source,21);
assert.equal(C.asmeIqi(508.01),null);
assert.equal(C.asmeIqi(0),null);
assert.equal(calc('b311',5).iqi,null); // Never substitute current IQI rules into the legacy edition.
assert.throws(()=>calc('b313-normal',6,{reinforcement:3.01}),/reinforcement/i);
assert.equal(C.evaluateCell(data[4],'AD12',{I4:30}),10);
assert.equal(C.evaluateCell(data[4],'AD15',{I4:30}),null);
assert.equal(C.evaluateCell(data[4],'T5',{I4:30}),null);
assert.equal(C.evaluateCell(data[4],'I5',{I4:30}),null);
assert.equal(C.evaluateCell({values:{},formulas:{A1:['ref','A1']}},'A1',{}),null);
for(const d of C.definitions){const r=calc(d.id,6);assert.ok(r.cards.length);assert.equal(r.edition,d.edition);assert.ok(!JSON.stringify(r).includes('NaN'));}
assert.equal(C.csaIqi(8,'gamma').iso,13);
assert.equal(C.csaIqi(8.001,'gamma').iso,12);
assert.equal(C.csaIqi(8,'xray').iso,14);
assert.equal(C.csaIqi(44,'gamma').iso,8);
assert.equal(C.csaIqi(44.001,'gamma'),null);
assert.equal(calc('csa-sweet',6,{iqiThickness:8,radiation:'gamma'}).iqi.iso,13);
assert.throws(()=>calc('csa-sweet',6,{iqiThickness:9,radiation:'gamma'}),/crown/i);
// Verified Z662:23 sour supplements must not inherit sweet-service root allowances.
const sour=calc('csa-sour',6,{length:200,iqiThickness:8,radiation:'gamma'});
assert.equal(sour.edition,'2023 (March 2024 revision)');
assert.equal(C.definitions.find(d=>d.id==='csa-sour').legacy,undefined);
assert.match(limit(sour,'root').note,/No indication permitted/);
assert.equal(limit(sour,'root').values.length,0);
assert.match(limit(sour,'root').ref,/16\.9\.3\.3/);
assert.equal(limit(sour,'top-fusion').values[0].value,12);
assert.equal(limit(sour,'top-fusion').values[1].value,16);
assert.equal(limit(sour,'cold').values[1].value,32);
assert.equal(limit(sour,'aggregate').values[0].value,16);
assert.match(limit(sour,'aggregate').note,/Root IP and root IF remain prohibited/);
assert.match(limit(sour,'sour-scope').note,/16\.9\.1/);
assert.equal(sour.iqi.iso,13);
assert.match(sour.iqiSource,/7\.11/);
assert.equal(sour.notes.length,0);
assert.ok(!sour.cards.some(c=>c.key.startsWith('legacy-')));
for(const length of [100,299,300,600]){
 const r=calc('csa-sour',8,{length});
 assert.equal(limit(r,'cold').values[1].value,length<300?.16*length:50);
 assert.equal(limit(r,'aggregate').values[0].value,length<300?.08*length:25);
 assert.equal(limit(r,'root').values.length,0);
}
assert.equal(limit(calc('csa-sour',8,{length:''}),'top-fusion').values[1].value,null);
assert.deepEqual(calc('csa-sour',25.4).cards,calc('csa-sour',1,{unit:'in',length:300/25.4}).cards);
for(const key of ['slag','burn','isolated','porosity','worm','hollow','undercut','concavity','reinforcement']){
 for(const nps of [1.5,2,4])assert.deepEqual(limit(calc('csa-sour',8,{nps}),key),limit(calc('csa-sweet',8,{nps}),key));
}
// Corrected Table 7.10: check every upper boundary and the next band.
for(const [t,wire,next] of [[8,14,13],[11,13,12],[14,12,11],[18,11,10],[25,10,9],[38,9,8],[44,8,null]]){
 assert.equal(C.csaIqi(t,'xray').iso,wire);
 assert.equal(C.csaIqi(t+.001,'xray')?.iso??null,next);
}
assert.equal(calc('csa-sour',6,{iqiThickness:8,radiation:'xray'}).iqi.iso,14);
assert.throws(()=>calc('csa-sour',6,{iqiThickness:9,radiation:'gamma'}),/crown/i);
assert.equal(calc('csa-sour',6,{reinforcement:0}).iqi,null);
console.log('PASS: code editions, thickness boundaries, short-weld limits, numeric validation, unit equivalence and missing spreadsheet references');

// Appendix 4 metric boundaries, isolated exception, and profile isolation.
const value=(c,label)=>c.values.find(v=>v.label===label)?.value;
for(const [t,relevance,ordinary,isolated] of [[2,.2,.5,2/3],[3,.4,.75,1],[6,.4,1.5,2],[6.001,.8,6.001/4,6.001/3],[16,.8,4,16/3],[50,.8,4,6],[50.001,1.6,4,10]]){
 const r=calc('viii-full',t),c=limit(r,'rounded');
 assert.equal(value(c,'Relevant when greater than'),relevance);
 assert.equal(value(c,'Maximum dimension'),ordinary);
 assert.equal(value(c,'Isolated maximum dimension'),isolated);
 assert.match(c.note,/25 mm/);
 assert.match(r.source,/Appendix 4.*2023/);
 assert.doesNotMatch(c.title,/2023/);
 assert.deepEqual(r.cards,calc('viii-full',t/25.4,{unit:'in'}).cards);
}
const aligned=limit(calc('viii-full',8),'rounded-aligned');
assert.equal(value(aligned,'Diameter sum must be less than'),8);
assert.equal(value(aligned,'Evaluation span'),96);
assert.match(aligned.note,/Figure 4-2/);
const cluster=limit(calc('viii-full',8),'rounded-clusters');
assert.equal(value(cluster,'Maximum cluster length'),16);
assert.equal(value(cluster,'Combined cluster length per 150 mm'),25);
assert.equal(value(limit(calc('viii-full',20),'rounded-clusters'),'Maximum cluster length'),25);
assert.match(limit(calc('viii-full',2),'rounded-distribution').note,/12.*150 mm.*proportion/i);
assert.match(limit(calc('viii-full',3),'rounded-distribution').note,/chart/i);
for(const [id,t,factor] of [['b313-normal',6,1],['b313-normal',6.001,1.5],['b313-severe',6.001,1]]){
 const r=calc(id,t),c=limit(r,'rounded');
 assert.equal(value(c,'Maximum dimension'),Math.min(t/4,4)*factor);
 assert.equal(value(c,'Isolated maximum dimension'),Math.min(t/3,6)*factor);
 assert.match(limit(r,'rounded-distribution').note,/Manual chart comparison required/);
 if(factor===1.5){assert.match(limit(r,'rounded-aligned').title,/base reference/);assert.match(limit(r,'rounded-aligned').note,/1.5/);}
}
for(const id of ['viii-spot','ix','csa-sweet','csa-sour']){
 assert.ok(!calc(id,8).cards.some(c=>c.key==='rounded-clusters'));
}
assert.match(limit(calc('viii-spot',8),'rounded').note,/Not a factor/);
assert.match(limit(calc('i',8),'rounded').ref,/A-250/);
console.log('PASS: Appendix 4 thresholds, size limits, strict alignment, clusters, units and B31.3 factors');

// PW-35 table columns and width-dependent branch.
for(const [t,pipe,other] of [[3,2.5,2.5],[3.001,3,2.5],[5,3,2.5],[5.001,4,2.5],[13,4,2.5],[13.001,5,2.5],[25,5,2.5],[25.001,6,3],[50,6,3],[50.001,6,4],[75.001,6,5.5],[100.001,6,6],[125.001,6,8]]){
 assert.equal(limit(calc('i',t),'reinforcement').values[0].value,pipe);
 assert.equal(limit(calc('i',t,{boilerJoint:'other'}),'reinforcement').values[0].value,other);
}
assert.equal(limit(calc('i',60,{weldWidth:80}),'reinforcement').values[0].value,10);
assert.throws(()=>calc('i',60,{weldWidth:''}),/width/i);
assert.throws(()=>calc('i',8,{boilerJoint:''}),/joint/i);
assert.equal(limit(calc('i',5),'undercut').values[0].value,.5);
assert.equal(limit(calc('i',10),'undercut').values[0].value,.8);
for(const id of ['i','b311']){
 assert.equal(value(limit(calc(id,50.001),'rounded'),'Isolated maximum dimension'),10);
 assert.match(limit(calc(id,8),'rounded').ref,/A-250/);
 assert.match(calc(id,8).source,/2019/);
}
// B31.1 columns: high, mid and low design-temperature ranges.
for(const [t,high,mid,low] of [[3,2,2.5,5],[3.001,2,3,5],[5.001,2,4,5],[13.001,2.5,5,5],[25.001,3,6,6],[50.001,4,6,6]]){
 for(const [temperatureBand,n] of [['high',high],['mid',mid],['low',low]])assert.equal(limit(calc('b311',t,{temperatureBand}),'reinforcement').values[0].value,n);
}
assert.equal(limit(calc('b311',60,{weldWidth:80}),'reinforcement').values[0].value,10);
assert.throws(()=>calc('b311',8,{temperatureBand:''}),/temperature/i);
assert.throws(()=>calc('b311',60,{weldWidth:''}),/width/i);
assert.equal(limit(calc('b311',8),'undercut').values[0].value,1);
assert.match(limit(calc('b311',8),'penetration').note,/outside only/);
assert.equal(limit(calc('b311',8,{weldSides:'double'}),'penetration').values[0].value,4);
assert.equal(limit(calc('b311',8),'mtpt').values[0].value,2);
assert.match(limit(calc('b311',8),'mtpt').note,/2 mm or less/);
assert.match(limit(calc('b311',8),'mtpt').note,/ten or more/);
assert.equal(calc('b311',5,{reinforcement:0}).iqi.source,5);
assert.match(calc('b311',5,{reinforcement:0}).iqiSource,/2010.*2011a/);
assert.deepEqual(calc('i',60,{weldWidth:80}).cards,calc('i',60/25.4,{unit:'in',weldWidth:80/25.4}).cards);
console.log('PASS: PW-35, A-250 and B31.1 repaired calculations');
const charts=limit(calc('b313-normal',8),'rounded-distribution').charts;
assert.ok(charts[0].url.startsWith('https://www.sulzer.com/'));
assert.match(limit(calc('i',8),'rounded-aligned').charts[0].label,/A-250/);
assert.match(limit(calc('csa-sour',8),'porosity').charts[0].label,/7.22/);
assert.match(limit(calc('ix',8),'rounded').charts[0].label,/QW-191/);
assert.equal(limit(calc('viii-spot',8),'rounded').charts,undefined);
assert.equal(limit(calc('ix',2),'rounded').charts,undefined);
for(const [t,figure] of [[3,'4-3'],[6,'4-3'],[6.001,'4-4'],[10,'4-4'],[10.001,'4-5'],[19,'4-5'],[19.001,'4-6'],[50,'4-6'],[50.001,'4-7'],[100,'4-7'],[100.001,'4-8']])assert.equal(C.offlineAppendixChart('viii-full',t).figure,figure);
assert.equal(C.offlineAppendixChart('viii-full',2.99),null);
for(const id of ['i','b311','ix','csa-sour','viii-spot'])assert.equal(C.offlineAppendixChart(id,8),null);
assert.equal(C.offlineAppendixChart('b313-normal',8).obscured,false);
assert.equal(C.offlineAppendixChart('b313-severe',12).obscured,false);
for(const [t,band] of [[3,0],[6,0],[6.001,1],[13,1],[13.001,2],[25,2],[25.001,3]])assert.equal(C.offlineQualificationChart(t).band,band);
for(const t of [2.99,0,NaN,Infinity])assert.equal(C.offlineQualificationChart(t),null);
for(const [t,n] of [[3,1],[6,1],[6.01,2],[10,2],[10.01,3],[19,3],[19.01,4],[50,4],[50.01,5],[100,5],[100.01,6],[200,6]])assert.equal(C.offlineBoilerCharts('rounded-distribution',t)[0].figure,'A-250.3.6-'+n);
for(const t of [2.99,NaN,Infinity])assert.deepEqual(C.offlineBoilerCharts('rounded-distribution',t),[]);
assert.equal(C.offlineBoilerCharts('rounded-aligned',8).length,2);
for(const [t,percent] of [[1,3],[13.999,3],[14,4],[18,4],[18.001,5]])assert.equal(C.offlineCsaChart(t).percent,percent);
for(const t of [0,-1,NaN,Infinity])assert.equal(C.offlineCsaChart(t),null);

assert.equal(C.offlineAppendixChart('viii-full',20).obscured,false);
