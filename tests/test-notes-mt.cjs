const assert=require('node:assert/strict');
const M=require('../assets/notes-model.js'),P=require('../assets/notes-parser.js'),V=require('../assets/notes-voice.js'),S=require('../assets/notes-storage.js');
const fresh=()=>M.createList({id:'mt-list',date:'2026-09-30',lsd:'bunker',start:101,mtStart:'007'});
let list=fresh();assert.equal(list.nextMtSequence,7);
function apply(text,id){const r=P.parse(text,list.context,list.rows);assert.deepEqual(r.review,[],text);list=M.applyGroup(list,r.commands,id);}
apply('CN-47 has 6 4" STD welds welded by DD and a 1" TOL','pipe47');
assert.equal(list.rows.length,6);assert.equal(list.mtRows.length,1);assert.equal(list.mtRows[0].cn,'CN-47');assert.equal(M.formatId(list.mtRows[0].sequence,list.mtFormat),'MT-007');assert.equal(list.nextSequence,107);
apply('one 2-inch weld olet','wol');apply('two 2 inch WOLs','wols');
assert.deepEqual(list.mtRows.map(r=>[r.sequence,r.size,r.type]),[[7,'1','TOL'],[8,'2','WOL'],[9,'2','WOL'],[10,'2','WOL']]);
apply('CN-48 has a 1 inch thready and one 2 inch threadolet','pipe48');assert.equal(list.mtRows[4].cn,'CN-48');assert.equal(list.mtRows[5].sequence,12);
for(const alias of ['TOL','TOLs','threadolet','thread olet','threadys','threadies','thready'])assert.equal(P.parse('a 1 inch '+alias,{cn:'CN-1'}).commands[0]?.fittingType,'TOL',alias);
for(const alias of ['WOL','WOLs','weldolet','weld olet','weld olets'])assert.equal(P.parse('one 2 inch '+alias,{cn:'CN-1'}).commands[0]?.fittingType,'WOL',alias);
assert.ok(P.parse('a 1 inch TOL').review.length);assert.ok(P.parse('CN-4 has a 1 inch TOL and some other fittings').review.length);
assert.ok(P.parse('CN-4 has 0 2 inch WOL').review.length);assert.ok(P.parse('CN-4 has 1 1/2 inch TOL').review.length);
assert.equal(P.parse('CN-4 has a 1/2 inch TOL').commands[0]?.size,'1/2');
const saved=list;const edited=M.apply(list,{id:'edit',type:'updateMt',rowId:list.mtRows[0].id,patch:{size:'3',fittingType:'WOL'}});assert.equal(edited.mtRows[0].size,'3');assert.deepEqual(M.undo(edited).mtRows,saved.mtRows);
const deleted=M.apply(list,{id:'delete',type:'deleteMt',rowId:list.mtRows[0].id});assert.equal(deleted.mtRows[0].sequence,8);assert.equal(deleted.nextMtSequence,13);
const formatted=M.apply(list,{id:'fmt',type:'changeFormat',cnFormat:{prefix:'C',separator:'',width:3},xfFormat:list.xfFormat,existing:true});assert.equal(formatted.mtRows[0].cn,'C047');
const session={id:'voice',listId:'mt-list',state:'listening',events:[{text:'CN-47 has 6 4 inch STD welds welded by DD.'},{text:'A 1 inch thready. CN-48 has one 2 inch WOL.'}]};
let voice=V.reconcile(fresh(),session).list;assert.equal(voice.mtRows.length,1);assert.equal(voice.mtRows[0].cn,'CN-47');session.state='stopped';voice=V.reconcile(voice,session).list;assert.equal(voice.mtRows.length,2);assert.equal(voice.mtRows[1].cn,'CN-48');assert.deepEqual(V.reconcile(voice,session).list.mtRows,voice.mtRows);
const undone=M.undo(voice);assert.equal(undone.mtRows.length,1);assert.equal(V.reconcile(undone,session).list.mtRows.length,1);
const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
S.save(storage,require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[list],selectedListId:list.id}));assert.deepEqual(S.load(storage).library.lists[0].mtRows,list.mtRows);
const legacy=M.apply(fresh(),{id:'old',type:'addBatch',cn:'CN-1',count:1,size:'4',schedule:'STD'});for(const state of [legacy,...legacy.history])for(const field of ['mtStart','nextMtSequence','mtFormat','mtRows'])delete state[field];
const raw=JSON.stringify({schemaVersion:1,lists:[legacy],selectedListId:legacy.id});map.set(S.KEY,raw);const loaded=S.load(storage);assert.equal(loaded.warning,'');assert.equal(loaded.library.schemaVersion,7);assert.equal(loaded.library.lists[0].rows.length,1);assert.equal(loaded.library.lists[0].nextMtSequence,1);assert.equal(M.undo(loaded.library.lists[0]).mtRows.length,0);assert.equal(map.get(S.KEY),raw);
assert.ok(!S.toCSV(list.rows).includes('MT-'));console.log('PASS: MT aliases, quantities, CN association, numbering, editing, undo/replay, migration and unchanged XF export');

for(const [text,type,sch] of [['a 1 inch 3M TOL','TOL','3M'],['one 2 inch socket weld schedule 6M','SW','6M'],['two 2 inch 9M SWs','SW','9M'],['a 1 inch TOL schedule 80','TOL','80'],['a 1 inch schedule 40 WOL','WOL','40'],['one 2 inch three M socket weld','SW','3M']]){const r=P.parse(text,{cn:'CN-47'});assert.deepEqual(r.review,[],text);assert.equal(r.commands[0].fittingType,type,text);assert.equal(r.commands[0].schedule,sch,text);}
assert.ok(P.parse('one 2 inch 4M WOL',{cn:'CN-1'}).review.length);assert.equal(P.parse('a 1 inch TOL',{cn:'CN-1'}).commands[0].schedule,'');
const mtOnly=M.apply(fresh(),{id:'only',type:'addMt',cn:'CN-7',count:2,size:'1',fittingType:'SW',schedule:'6M'});
const csv=S.toCSV([],mtOnly.mtRows,mtOnly.mtFormat);assert.ok(csv.includes('"CN#","MT#","WID","Size","Schedule/Description"'));assert.ok(csv.includes('"CN-7","MT-007","","1","6M SW"'));assert.equal(csv.trimEnd().split('\r\n').length,3);
const combined=S.toCSV(list.rows,mtOnly.mtRows,mtOnly.mtFormat);assert.equal(combined.trimEnd().split('\r\n').length,7);assert.ok(combined.includes('"CN-47","XF-101","DD","4","STD","","CN-7","MT-007"'));
console.log('PASS: MT schedules, socket welds and independent side-by-side CSV tables');

for(const id of ['TOL','WOL','SW'])assert.equal(P.parse('CN-7 has 2 4 inch STD welds welded by '+id).commands[0]?.welder,id,'fitting aliases must not override welder IDs');
assert.ok(P.parse('2 inch WOLs',{cn:'CN-7'}).review.length,'plural fitting needs a quantity');
const corrupt=JSON.parse(JSON.stringify(list));delete corrupt.mtRows[0].schedule;assert.throws(()=>M.validateList(corrupt),/MT schedule/);

assert.equal(P.parse('a 1 inch T O L',{cn:'CN-47'}).commands[0]?.fittingType,'TOL');
assert.equal(P.parse('one 2 inch W O L',{cn:'CN-47'}).commands[0]?.fittingType,'WOL');
assert.equal(P.parse('one 2 inch S W',{cn:'CN-47'}).commands[0]?.fittingType,'SW');

assert.throws(()=>M.createList({id:'badmt',date:'2026-09-30',lsd:'test',start:1,mtStart:'00000000000001'}),/padding/);

// Final welder assignment may follow the MT notes for the pipe.
const trailing=P.parse('CN-69 has 2 2 inch XS welds and 4 4 inch STD welds and 1 1 inch 3M thready welded by DD');
assert.deepEqual(trailing.review,[]);assert.deepEqual(trailing.commands.filter(c=>c.type==='addBatch').map(c=>[c.count,c.size,c.welder]),[[2,'2','DD'],[4,'4','DD']]);assert.equal(trailing.commands.at(-1).fittingType,'TOL');
assert.ok(P.parse('CN-69 has 2 2 inch XS welds welded by AA and a 1 inch TOL welded by DD').review.length,'conflicting welder assignments require review');
assert.ok(P.parse('CN-XS C9 has 2 2 inch XS welds and a 1 inch TOL welded by DD',{cn:'CN-47'}).review.length,'never guess or inherit a CN for a malformed explicit identifier');
assert.equal(V.normalize('CN-69 has 2 2" XS welds'),'CN-69 has 2 2" XS welds');

const noComma=P.parse('CN-69 has 2 2 inch XS welds 4 4 inch STD welds and 1 1 inch 3M thready welded by DD');assert.deepEqual(noComma.review,[]);assert.equal(noComma.commands.filter(c=>c.type==='addBatch').reduce((n,c)=>n+c.count,0),6);

for(const prefix of ['SCED','sched','schedule','sch']){
 const text='CN-13 has 3 3 inch XS welds, 1, 2 inch '+prefix+' 160 welds And 1 1 inch 3M TOL welded by DD';
 const result=P.parse(text);assert.deepEqual(result.review,[],text);
 const applied=M.applyGroup(fresh(),result.commands,'screenshot-'+prefix);
 assert.deepEqual(applied.rows.map(r=>[r.cn,r.size,r.schedule,r.welder]),[['CN-13','3','XH','DD'],['CN-13','3','XH','DD'],['CN-13','3','XH','DD'],['CN-13','2','160','DD']]);
 assert.deepEqual(applied.mtRows.map(r=>[r.cn,r.size,r.schedule,r.type]),[['CN-13','1','3M','TOL']]);
 const voiceResult=V.reconcile(fresh(),{id:'screenshot-'+prefix,listId:'mt-list',state:'stopped',events:[{text}]}).list;
 assert.equal(voiceResult.rows.length,4);assert.equal(voiceResult.mtRows.length,1);
}

// WID follows each pipe's assignment, stays editable, and survives undo/storage.
const widParsed=P.parse('CN-13 has 3 3 inch XS welds and 1 1 inch 3M TOL welded by DD');
let widList=M.applyGroup(fresh(),widParsed.commands,'wid-pipe');
assert.equal(widList.mtRows[0].welder,'DD');
const inherited=P.parse('CN-14 has a 2 inch WOL',widList.context,widList.rows);
widList=M.applyGroup(widList,inherited.commands,'wid-inherited');assert.equal(widList.mtRows[1].welder,'DD');
widList=M.apply(widList,{id:'wid-edit',type:'updateMt',rowId:widList.mtRows[0].id,patch:{welder:'RG'}});assert.equal(widList.mtRows[0].welder,'RG');assert.equal(M.undo(widList).mtRows[0].welder,'DD');
assert.ok(S.toCSV(widList.rows,widList.mtRows,widList.mtFormat).includes('"CN-13","MT-007","RG","1","3M TOL"'));
const oldMt=JSON.parse(JSON.stringify(widList));for(const state of [oldMt,...oldMt.history])for(const row of state.mtRows)delete row.welder;
const oldRaw=JSON.stringify({schemaVersion:2,lists:[oldMt],selectedListId:oldMt.id});map.set(S.KEY,oldRaw);
const upgraded=S.load(storage);assert.equal(upgraded.warning,'');assert.equal(upgraded.library.schemaVersion,7);assert.equal(upgraded.library.lists[0].mtRows[0].welder,'');assert.equal(M.undo(upgraded.library.lists[0]).mtRows[0].welder,'');assert.equal(map.get(S.KEY),oldRaw);
S.save(storage,upgraded.library);assert.equal(S.load(storage).library.lists[0].mtRows[0].welder,'');
const multi=P.parse('CN-20 has a 1 inch TOL welded by DD CN-21 has a 2 inch WOL welded by RG');assert.deepEqual(multi.review,[]);assert.deepEqual(M.applyGroup(fresh(),multi.commands,'multi-wid').mtRows.map(r=>r.welder),['DD','RG']);
console.log('PASS: MT WID inheritance, per-pipe assignments, editing, undo, migration and combined CSV');
const descriptions=['D-Leg','Dummy Leg','Lifting Lug','Manway','Plate','Fillet Weld','Slip-On Flange'];
for(const description of descriptions){
 const parsed=P.parse('CN-7 has two 2 inch '+description.toLowerCase()+'s');
 assert.deepEqual(parsed.review,[],description);
 assert.equal(parsed.commands[0].fittingType,description);
 const added=M.applyGroup(fresh(),parsed.commands,'description-'+description);
 assert.equal(added.rows.length,0);assert.equal(added.mtRows.length,2);
 assert.equal(added.mtRows[0].type,description);
 S.save(storage,require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[added],selectedListId:added.id}));
 assert.equal(S.load(storage).library.lists[0].mtRows[0].type,description);
 assert.ok(S.toCSV([],added.mtRows,added.mtFormat).includes(description));
 const draft=P.reviewDraft('CN-7 has two 2 inch '+description+' unclear',{},null);
 assert.equal(draft.groups[0].kind,'mt',description);
 assert.equal(draft.groups[0].fittingType,description);
}
console.log('PASS: additional MT descriptions, plurals, review, persistence and CSV');

