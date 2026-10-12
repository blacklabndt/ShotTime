const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js'),V=require('../assets/notes-voice.js');
const texts=['2 2 inch AD welds on CN-3 DD','2 2 inch 80 welds on CN-3 DD','two two inch eighty welds on CN-3 welded by DD','2 2 inch sch80 welds on CN-3 DD','CN-3 has 2 2 inch AD welds DD'];
for(const text of texts){const parsed=P.parse(text,{cn:'CN-46',welder:'O'},[],M.requirements());assert.deepEqual(parsed.review,[],text);assert.deepEqual(parsed.commands.filter(c=>c.type==='addBatch').map(c=>[c.cn,c.count,c.size,c.schedule,c.welder]),[['CN-3',2,'2','80','DD']]);}
assert.equal(P.parse('2 2 inch 80 welds on CN-3 AD').commands[0].welder,'AD');
for(const text of ['2 2 inch AD welds on CN-ABC DD','CN-4 has 2 2 inch 80 welds on CN-3 DD','2 2 inch AD welds on CN-3 DD random words','2 2 inch BAD welds on CN-3 DD'])assert.ok(P.parse(text,{cn:'CN-46',welder:'O'}).review.length,text);
const list=M.createList({id:'last',date:'2026-10-02',lsd:'test',start:21,fieldRequirements:M.requirements()});const result=V.reconcile(list,{id:'suffix',listId:'last',state:'stopped',events:[{text:texts[0]}]});assert.equal(result.list.pending.length,0);assert.deepEqual(result.list.rows.map(r=>[r.cn,r.sequence,r.size,r.schedule,r.welder]),[['CN-3',21,'2','80','DD'],['CN-3',22,'2','80','DD']]);
console.log('PASS: CN-at-end, AD schedule correction, numeric/spoken/sch80, preserved AD WID, ambiguity and stopped voice');

const punctuationCases=['2 2 inch XS welds CN, 1 DD','2 2 inch XS welds CN-1 DD','2 2 inch XS welds on CN, 1 DD','CN, 1 has 2 2 inch XS welds DD','2 2 inch XS welds C N, one DD'];
for(const text of punctuationCases){
 const parsed=P.parse(text,{cn:'CN-46',welder:'O'},[],M.requirements());
 assert.deepEqual(parsed.review,[],text);
 assert.deepEqual(parsed.commands.map(c=>[c.cn,c.count,c.size,c.schedule,c.welder]),[['CN-1',2,'2','XH','DD']],text);
 const session={id:'comma-cn',listId:list.id,state:'stopped',events:[{text}]};
 const applied=V.reconcile(list,session).list;
 assert.equal(applied.pending.length,0,text);
 assert.deepEqual(applied.rows.map(r=>[r.cn,r.sequence,r.size,r.schedule,r.welder]),[['CN-1',21,'2','XH','DD'],['CN-1',22,'2','XH','DD']],text);
 assert.equal(V.reconcile(applied,session).list.rows.length,2,'replay '+text);
}
for(const text of ['2 2 inch XS welds CN, ABC DD','2 2 inch XS welds CN, 1 CN-2 DD','CN-4 has 2 2 inch XS welds CN, 1 DD','2 2 inch XS welds CN, 1 DD random words']){
 const parsed=P.parse(text,{cn:'CN-46',welder:'O'});assert.ok(parsed.review.length,text);assert.equal(parsed.commands.length,0,text);
}
console.log('PASS: comma inside CN, bare trailing CN, stopped voice, replay and conflicting CN guards');
