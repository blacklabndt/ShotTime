const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js'),V=require('../assets/notes-voice.js');
const exact='CN-1, 2, 2 inch XS welds DD';
for(const text of [exact,'CN-1, 2, 2 inch XH welds DD','CN-1 has a 2 inch STD weld RG','CN-1 has 2 2 inch XS welds D D']){
 const p=P.parse(text,{cn:'CN-46',welder:'O'},[],M.requirements());assert.deepEqual(p.review,[],text);assert.equal(p.commands[0].cn,'CN-1');assert.equal(p.commands[0].welder,text.endsWith('RG')?'RG':'DD');
}
assert.equal(P.parse('CN-1 has 2 2 inch XS WELDS D').commands[0]?.welder,'D');
const fresh=()=>M.createList({id:'short',date:'2026-10-02',lsd:'test',start:21,fieldRequirements:M.requirements()});
const r=V.reconcile(fresh(),{id:'voice',listId:'short',state:'stopped',events:[{text:exact}]});assert.equal(r.list.pending.length,0);assert.deepEqual(r.list.rows.map(x=>[x.cn,x.sequence,x.size,x.schedule,x.welder]),[['CN-1',21,'2','XH','DD'],['CN-1',22,'2','XH','DD']]);
for(const suffix of ['banana','and DD','DD RG','NO','BY'])assert.ok(P.parse('CN-1 has 2 2 inch XS welds '+suffix).review.length,suffix);
assert.ok(P.parse('CN-1 has some 2 inch XS welds DD').review.length);
assert.ok(P.parse('CN-1 has 2 2 inch XS welds welded by AA DD').review.length);
console.log('PASS: bare trailing initials, exact screenshot, explicit WID with optional settings, safe rejection and sequential rows');
