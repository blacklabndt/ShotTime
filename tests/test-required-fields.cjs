const assert=require('node:assert/strict'),M=require('../assets/notes-model.js'),P=require('../assets/notes-parser.js'),S=require('../assets/notes-storage.js'),V=require('../assets/notes-voice.js');
const optional={xf:{cn:false,welder:false,size:false,schedule:false},mt:{cn:false,welder:false,size:false,schedule:false,type:false}};
let l=M.createList({id:'job',date:'2026-10-01',lsd:'optional',start:10,mtStart:20});
l=M.apply(l,{id:'settings',type:'fieldRequirements',value:optional});
function add(text,id){const r=P.parse(text,l.context,l.rows,l.fieldRequirements);assert.deepEqual(r.review,[],text);l=M.applyGroup(l,r.commands,id);}
add('add three welds','three');assert.equal(l.rows.length,3);assert.deepEqual(l.rows.map(r=>r.sequence),[10,11,12]);for(const r of l.rows)for(const key of ['cn','welder','size','schedule'])assert.equal(r[key],'');
add('add two MT fittings','mt');assert.equal(l.mtRows.length,2);assert.equal(l.mtRows[0].sequence,20);assert.equal(l.mtRows[0].type,'');
add('CN-27 has two 4 inch STD welds and a 1 inch 3M TOL welded by DD','full');assert.equal(l.rows.at(-1).welder,'DD');assert.equal(l.mtRows.at(-1).type,'TOL');
add('add a weld','blank');assert.equal(l.rows.at(-1).cn,'');assert.equal(l.rows.at(-1).welder,'');
const strict={xf:{cn:true,welder:true,size:true,schedule:false},mt:{cn:true,welder:true,size:true,schedule:false,type:true}};
l=M.apply(l,{id:'strict',type:'fieldRequirements',value:strict});add('CN-28 has two 4 inch welds welded by RG','no-schedule');assert.equal(l.rows.at(-1).schedule,'');
assert.ok(P.parse('CN-28 has two welds welded by RG',{},[],strict).review.length);
assert.ok(P.parse('CN-bad has 2 welds',{},[],optional).review.length);assert.ok(P.parse('add some welds',{},[],optional).review.length);assert.ok(P.parse('add 2 welds banana',{},[],optional).review.length);
const disk={value:null,getItem(){return this.value},setItem(k,v){this.value=v}};S.save(disk,require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[l],selectedListId:l.id}));assert.equal(S.load(disk).warning,'');assert.deepEqual(M.undo(l).fieldRequirements,strict);
assert.ok(S.toCSV(l.rows,l.mtRows,l.mtFormat).includes('"","XF-10","","",""'));
const legacy=M.createList({id:'old',date:'2026-10-01',lsd:'old',start:1});delete legacy.fieldRequirements;disk.value=JSON.stringify({schemaVersion:3,lists:[legacy],selectedListId:'old'});assert.equal(S.load(disk).library.schemaVersion,7);assert.equal(S.load(disk).library.lists[0].fieldRequirements,null);
console.log('PASS: optional XF/MT fields, required validation, numbering, explicit capture, no stale context, migration and CSV blanks');

for(const kind of ['xf','mt']){const keys=Object.keys(optional[kind]);for(let mask=0;mask<(1<<keys.length);mask++){const r=JSON.parse(JSON.stringify(optional));keys.forEach((k,i)=>r[kind][k]=!!(mask&(1<<i)));const f=r[kind];const text=(f.cn?'CN-47 has ':'add ')+'two '+(f.size?'2 inch ':'')+(f.schedule?(kind==='mt'?'3M ':'STD '):'')+(kind==='xf'?'welds':f.type?'TOLs':'MT fittings')+(f.welder?' welded by DD':'');const parsed=P.parse(text,{},[],r);assert.deepEqual(parsed.review,[],text);const base=M.createList({id:'matrix',date:'2026-10-01',lsd:'matrix',start:1,fieldRequirements:r});const result=M.applyGroup(base,parsed.commands,'matrix');const row=(kind==='xf'?result.rows:result.mtRows)[0];for(const k of keys)assert.equal(!!row[k],f[k],kind+' '+k+' '+text);}}
assert.ok(P.parse('add 2 1/2 inch welds',{},[],optional).review.length);
assert.ok(P.parse('add 2 unknown fittings',{},[],optional).review.length);
console.log('PASS: all 48 XF/MT required-field combinations and fractional ambiguity');
