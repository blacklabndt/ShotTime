const assert=require('node:assert/strict');
const M=require('../assets/notes-model'),P=require('../assets/notes-parser'),V=require('../assets/notes-voice'),S=require('../assets/notes-storage');
const fresh=()=>M.createList({id:'unknown',date:'2026-10-06',lsd:'test',start:1});
for(const cn of ['unknown CN','unknown CN#','unknown CN number','CN unknown','CN# unknown','CN ?']){
 for(const wid of ['unknown welder','welder unknown','welded by unknown']){
  const text=cn+' has two 4 inch STD welds '+wid;
  const r=P.parse(text,{cn:'CN-99',welder:'DD'});
  assert.deepEqual(r.review,[],text);
  const l=M.applyGroup(fresh(),r.commands,'test');
  assert.equal(l.rows[0].cn,'?',text);assert.equal(l.rows[0].welder,'?',text);
  assert.equal(l.rows[0].cnNumber,null);
 }
}
const optional=M.requirements();for(const kind of ['xf','mt'])for(const key of Object.keys(optional[kind]))optional[kind][key]=false;
for(const required of [null,M.requirements(),optional]){
 const text='CN-7 has one 2 inch STD weld welded by DD; Unknown CN has one 2 inch slip-on flange unknown welder';
 const r=P.parse(text,{},[],required);assert.deepEqual(r.review,[],text);
 const l=M.applyGroup({...fresh(),fieldRequirements:required},r.commands,'mixed');
 assert.equal(l.rows[0].cn,'CN-7');assert.equal(l.mtRows[0].cn,'?');assert.equal(l.mtRows[0].welder,'?');
 const changed=M.apply(l,{id:'fmt',type:'changeFormat',cnFormat:{prefix:'C',separator:'',width:3},xfFormat:l.xfFormat,existing:true});
 assert.equal(changed.mtRows[0].cn,'?');assert.equal(changed.rows[0].cn,'C007');
 assert.ok(S.toCSV(l.rows,l.mtRows,l.mtFormat).includes('"?"'));
}
const draft=P.reviewDraft('unknown CN has two 4 inch welds unknown welder',{cn:'CN-99',welder:'DD'});
assert.equal(draft.groups[0].cn,'?');assert.equal(draft.groups[0].welder,'?');
const session={id:'unknown-voice',listId:'unknown',state:'stopped',events:[{text:'Unknown CN has two 4 inch standard welds unknown welder.'}]};
const voice=V.reconcile(fresh(),session).list;
assert.equal(voice.rows.length,2);assert.equal(voice.rows[0].cn,'?');assert.equal(voice.rows[0].welder,'?');
assert.ok(P.parse('CN nonsense has two 4 inch STD welds').review.length);
console.log('PASS: explicit unknown CN/WID, stale context, MT, optional fields, formatting, CSV, review and voice');
