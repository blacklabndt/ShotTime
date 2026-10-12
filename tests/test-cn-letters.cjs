const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js'),V=require('../assets/notes-voice.js'),S=require('../assets/notes-storage.js');
const fresh=()=>M.createList({id:'letters',date:'2026-10-03',lsd:'test',start:1});
for(const text of ['CN-332A has 2 2 inch XS welds DD','2 2 inch XS welds on CN-332A DD','2 2 inch XS welds CN, 332a DD','CN 332 A has 2 2 inch XS welds DD','CN 332 alpha has 2 2 inch XS welds DD']){
 const p=P.parse(text,{cn:'CN-46',welder:'O'});assert.deepEqual(p.review,[],text);
 const l=M.applyGroup(fresh(),p.commands,'test');assert.deepEqual(l.rows.map(r=>[r.cn,r.size,r.schedule,r.welder]),[['CN-332A','2','XH','DD'],['CN-332A','2','XH','DD']],text);
}
let l=fresh();const session={id:'letters-voice',listId:l.id,state:'stopped',events:[{text:'CN 332 alpha has a 2 inch STD weld and a 1 inch 3M TOL welded by DD. CN 332 bravo has a 4 inch XS weld welded by ZZ.'}]};
l=V.reconcile(l,session).list;assert.deepEqual(l.pending,[]);assert.deepEqual(l.rows.map(r=>r.cn),['CN-332A','CN-332B']);assert.equal(l.mtRows[0].cn,'CN-332A');assert.equal(V.reconcile(l,session).list.rows.length,2);
const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};S.save(store,require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[l],selectedListId:l.id}));l=S.load(store).library.lists[0];assert.ok(S.toCSV(l.rows,l.mtRows).includes('CN-332A'));assert.ok(S.toCSV(l.rows,l.mtRows).includes('CN-332B'));
const moved=P.parse('Move the last weld to CN-332A',l.context,l.rows,null,l.mtRows);assert.deepEqual(moved.review,[]);const updated=M.applyGroup(l,moved.commands,'move');assert.equal(updated.rows[1].cn,'CN-332A');assert.equal(M.undo(updated).rows[1].cn,'CN-332B');
const all=P.parse('Set all welders on CN-332A to FF',l.context,l.rows,null,l.mtRows);assert.deepEqual(all.review,[]);const edited=M.applyGroup(l,all.commands,'welder');assert.deepEqual(edited.rows.map(r=>r.welder),['FF','ZZ']);assert.equal(edited.mtRows[0].welder,'FF');
const formatted=M.apply(l,{id:'format',type:'changeFormat',cnFormat:{prefix:'S',separator:'/',width:5},xfFormat:l.xfFormat,existing:true});assert.deepEqual(formatted.rows.map(r=>r.cn),['S/00332A','S/00332B']);assert.equal(formatted.mtRows[0].cn,'S/00332A');
const custom=M.applyGroup({...fresh(),cnFormat:{prefix:'S',separator:'/',width:5}},P.parse('CN-332A has a 2 inch STD weld DD').commands,'custom');assert.equal(custom.rows[0].cn,'S/00332A');
assert.equal(M.apply(fresh(),{id:'manual',type:'addBatch',cn:'332b',count:1,size:'2',schedule:'80',welder:'DD'}).rows[0].cn,'CN-332B');
assert.deepEqual(P.parse('CN-332 a 2 inch STD weld DD').review,[]);
for(const text of ['CN-XS C9 has a 2 inch STD weld DD','CN-332A/332B has a 2 inch STD weld DD','2 2 inch STD welds CN-332A CN-332B DD'])assert.ok(P.parse(text,{cn:'CN-46',welder:'O'}).review.length,text);
console.log('PASS: letter CN identities, spoken suffixes, XF/MT separation, modifiers, formats, storage, CSV, undo and replay');
