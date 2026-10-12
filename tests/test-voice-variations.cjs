const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js'),V=require('../assets/notes-voice.js');
const context={cn:'CN-3',welder:'DD'},rules=M.requirements();
const cases=[
 ['CN number three, two welds at two-inch schedule eighty, by DD',2,'2','80','DD'],
 ['C N three, two off two-inch heavy, DD',2,'2','XH','DD'],
 ['Two off two-inch heavy, CN-3, DD',2,'2','XH','DD'],
 ['CN-3, a pair of two-inch schedule 80 welds, DD',2,'2','80','DD'],
 ['Two welds on CN-3, both two-inch heavy, DD',2,'2','XH','DD'],
 ['CN-3 has two welds, two-inch, schedule 80',2,'2','80',''],
 ['CN-3, two two-inch schedule 80, DD',2,'2','80','DD'],
 ['CN-3, two two-inch standard, both by DD',2,'2','STD','DD'],
 ['CN-3, two two-inch standard by Delta Delta',2,'2','STD','DD'],
 ['CN-3, two two-inch schedule eight zero, DD',2,'2','80','DD'],
 ['CN-3, two two-inch one sixty welds DD',2,'2','160','DD'],
 ['CN-3, two two-inch one hundred sixty welds DD',2,'2','160','DD'],
 ['same spool, another two-inch standard weld',1,'2','STD',''],
 ['CN-3, two half-inch standard welds DD',2,'0.5','STD','DD'],
 ['CN-3, two three-quarter-inch standard welds DD',2,'0.75','STD','DD'],
 ['CN-3, two inch and a half standard welds DD',2,'1.5','STD','DD'],
 ['CN-3, two two and a half inch standard welds DD',2,'2.5','STD','DD']
];
for(const [text,count,size,schedule,welder]of cases){const p=P.parse(text,context,[],rules);assert.deepEqual(p.review,[],text);assert.deepEqual(p.commands.filter(c=>c.type==='addBatch').map(c=>[c.cn,c.count,c.size,c.schedule,c.welder]),[['CN-3',count,size,schedule,welder]],text);}
for(const text of ['One half-inch three-thousand thready on CN-3','same spool, one one-inch 3M socket weld, DD']){const p=P.parse(text,context,[],rules);assert.deepEqual(p.review,[],text);assert.equal(p.commands.find(c=>c.type==='addMt').cn,'CN-3');assert.equal(p.commands.find(c=>c.type==='addMt').schedule,'3M');}
const mixed=P.parse('CN-3, two two-inch standard and one four-inch heavy, all DD',context,[],rules);assert.deepEqual(mixed.review,[]);assert.deepEqual(mixed.commands.map(c=>[c.count,c.welder]),[[2,'DD'],[1,'DD']]);
let list=M.createList({id:'variants',date:'2026-10-02',lsd:'test',start:1,fieldRequirements:rules});list=M.applyGroup(list,P.parse('CN-3 has a 2 inch STD weld DD',context,[],rules).commands,'first');list=M.apply(list,{id:'mt',type:'addMt',cn:'CN-3',welder:'DD',count:1,size:'1',schedule:'3M',fittingType:'TOL'});
for(const text of ['Add one more like the last weld','same spool, one more weld like the last']){const p=P.parse(text,list.context,list.rows,rules,list.mtRows);assert.deepEqual(p.review,[],text);assert.equal(p.commands[0].welder,'DD');assert.equal(p.commands[0].count,1);}
const edit=P.parse("Change the last weld’s schedule to 80",list.context,list.rows,rules,list.mtRows);assert.deepEqual(edit.review,[]);assert.equal(edit.commands[0].patch.schedule,'80');
const removal=P.parse('Remove the last MT fitting',list.context,list.rows,rules,list.mtRows);assert.deepEqual(removal.review,[]);assert.equal(removal.commands[0].rowId,list.mtRows[0].id);const removed=M.applyGroup(list,removal.commands,'remove');assert.equal(removed.mtRows.length,0);assert.equal(M.undo(removed).mtRows.length,1);
for(const text of ['one and a half inch standard weld on CN-3','same spool, a 2 inch STD weld','Add one more like the last weld','Remove the last MT fitting'])assert.ok(P.parse(text,{},[],rules,[]).review.length,text);
assert.ok(P.parse('CN-3 two welds both 2 inch standard on CN-4 DD',context,[],rules).review.length);
console.log('PASS: flexible wording, fractions, schedule words, same spool, repeat, correction and undoable MT removal');

const optional={xf:{cn:false,welder:false,size:true,schedule:true},mt:{cn:false,welder:false,size:true,schedule:false,type:true}};
const both=P.parse('same spool, a 2 inch STD weld and a 1 inch TOL',context,[],optional);assert.deepEqual(both.review,[]);assert.ok(both.commands.filter(c=>c.type.startsWith('add')).every(c=>c.cn==='CN-3'));
for(const [word,expected]of [['three','3M'],['six','6M'],['nine','9M']]){const p=P.parse('CN-3 a half-inch '+word+' thousand thready',context,[],rules);assert.deepEqual(p.review,[]);assert.equal(p.commands.find(c=>c.type==='addMt').schedule,expected);}
let voice=V.reconcile(list,{id:'multi-variants',listId:list.id,state:'stopped',events:[{text:'Same spool, one more weld like the last. Remove the last MT fitting.'}]});assert.equal(voice.list.pending.length,0);assert.equal(voice.list.rows.length,2);assert.equal(voice.list.mtRows.length,0);const replay=V.reconcile(voice.list,{id:'multi-variants',listId:list.id,state:'stopped',events:[{text:'Same spool, one more weld like the last. Remove the last MT fitting.'}]});assert.equal(replay.list.rows.length,2);
console.log('PASS: optional-CN same-spool groups, pressure classes, chained voice repeat/removal and replay');
