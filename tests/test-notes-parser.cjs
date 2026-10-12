const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js');
const input='CN-47 has 6 4 inch STD welds welded by DD, CN-32 has 2 2 inch XS welds welded by O, CN-22 has 3 3 inch STD welds welded by TS';
for(const phrase of ['all welded by TS','all of them welded by TS']){const r=P.parse('CN-43 has 6 6 inch STD welds, '+phrase);assert.equal(r.review.length,0,phrase);assert.equal(r.commands[0].count,6);assert.equal(r.commands[0].welder,'TS');}
assert.equal(P.parse('CN-43 has 2 6 inch STD welds, both welded by TS').commands[0]?.count,2);
const bothConflict=P.parse('CN-43 has 6 6 inch STD welds, both welded by TS',{cn:'CN-1',welder:'DD'});assert.equal(bothConflict.commands.length,0);assert.match(bothConflict.review[0].reason,/both.*6 welds/i);assert.deepEqual(bothConflict.context,{cn:'CN-1',welder:'DD'});
const allGroups=P.parse('CN-43 has 2 6 inch STD welds and 4 2 inch XS welds, all welded by TS');assert.deepEqual(allGroups.commands.map(c=>[c.count,c.welder]),[[2,'TS'],[4,'TS']]);
assert.equal(P.parse('CN-43 has 6 6 inch STD welds, some welded by TS').commands.length,0);
const parsed=P.parse(input,{},[]);assert.equal(parsed.review.length,0);assert.deepEqual(parsed.commands.map(c=>[c.cn,c.count,c.size,c.schedule,c.welder]),[['CN-47',6,'4','STD','DD'],['CN-32',2,'2','XH','O'],['CN-22',3,'3','STD','TS']]);
let list=M.applyGroup(M.createList({id:'l',date:'2026-09-30',lsd:'test',start:101}),parsed.commands,'batch');assert.equal(list.rows.length,11);assert.equal(list.nextSequence,112);assert.equal(M.undo(list).rows.length,0);
const mixed=P.parse('CN-47 has six 4"xs welds and one 2"sch160 welded by DD',{},[]);assert.equal(mixed.review.length,0);assert.deepEqual(mixed.commands.map(c=>[c.count,c.size,c.schedule,c.welder]),[[6,'4','XH','DD'],[1,'2','160','DD']]);
assert.equal(P.parse('Add two four inch standard welds',{cn:'CN-47',welder:'RG'},[]).commands[0].welder,'RG');
assert.equal(P.parse('CN-047 has 2 1 1/2 inch XS welds, welder W dash twenty-four',{},[]).commands[0].welder,'W-24');
assert.equal(P.parse('CN-047 has 2 1 1/2 inch XS welds, welder W dash twenty-four',{},[]).commands[0].size,'1 1/2');
assert.equal(P.parse('CN-47, welder R G',{},[]).commands[0].welder,'RG');
assert.equal(P.parse('Change XF-103 welder to W-24',{},list.rows).commands[0].rowIds[0],list.rows[2].id);
assert.equal(P.parse('Set XF-104 through XF-106 welder DD',{},list.rows).commands[0].rowIds.length,3);
assert.equal(P.parse('Change CN-47 welder to RG',{},list.rows).commands[0].rowIds.length,6);
assert.equal(P.parse('Change the last weld to schedule 80',{},list.rows).commands[0].patch.schedule,'80');
assert.equal(P.parse('Undo the last batch',{},list.rows).commands[0].type,'undo');
for(const text of ['make that eight','CN-32 has','CN-47 has 0 4 inch STD welds','CN-47 has 1.5 4 inch STD welds','CN-47 has 2000 4 inch STD welds','CN-47 has 2 4 inch mystery welds','CN-47 has 2 4 inch STD welds, CN-32 has','Set XF-999 welder DD','CN-47 has 2 4 inch STD welds extra nonsense']){const r=P.parse(text,{},list.rows);assert.ok(r.review.length,text);assert.equal(r.commands.length,0,text);}
assert.equal(P.parse('CN-47 has one 4 inch STD weld welder letter O',{},[]).commands[0].welder,'O');
console.log('PASS: owner transcript, inherited context, fractions, exact IDs, corrections and ambiguity');
// Review regressions: parser honors configured CN format via numeric identity, and rejects competing targets.
const custom=M.createList({id:'custom',date:'2026-09-30',lsd:'test',start:1,cnFormat:{prefix:'Pipe',separator:'/',width:4}});
const customAdded=M.applyGroup(custom,P.parse('CN-047 has one 4 inch STD weld',{},[]).commands,'custom-batch');assert.equal(customAdded.rows[0].cn,'Pipe/0047');
const ambiguous=M.applyGroup(M.createList({id:'amb',date:'2026-09-30',lsd:'test',start:1}),[{type:'addBatch',cn:'XF-2',welder:'O',count:1,size:'4',schedule:'STD'},{type:'addBatch',cn:'CN-47',welder:'RG',count:1,size:'4',schedule:'STD'}],'amb-batch');const ambiguousResult=P.parse('Change XF-2 welder to DD',{},ambiguous.rows);assert.equal(ambiguousResult.commands.length,0);assert.ok(ambiguousResult.review.length);

const counted=P.parse('CN-43 has 1, 2, 3, 4, 2 inch 80s And 1 3 inch STD welded by DD');
assert.equal(counted.review.length,0);assert.deepEqual(counted.commands.map(c=>[c.count,c.size,c.schedule,c.welder]),[[4,'2','80','DD'],[1,'3','STD','DD']]);
const countedList=M.applyGroup(M.createList({id:'counted',date:'2026-09-30',lsd:'test',start:101}),counted.commands,'counted');assert.equal(countedList.rows.length,5);assert.equal(countedList.nextSequence,106);
assert.equal(P.parse('CN-43 has one, two, three, four 2 inch STD welded by DD').commands[0]?.count,4);
assert.equal(P.parse('CN-43 has 1, 2, 2 inch schedule 80S welded by DD').commands[0]?.schedule,'80S');
assert.equal(P.parse('CN-43 has 2 2 inch 80S welded by DD').commands[0]?.schedule,'80S');
for(const text of ['CN-43 has 1, 3, 4, 2 inch STD','CN-43 has 1, 2, 2, 2 inch STD','CN-43 has 2, 3, 4, 2 inch STD'])assert.equal(P.parse(text).commands.length,0,text);
// Review fixes: lowercase "40s" is schedule 40 with or without counting aloud; capital 40S stays stainless.
for(const text of ['CN-47 has 2 4 inch 40s welded by DD','CN-47 has 1, 2 4 inch 40s welded by DD','CN-47 has 2 4 inch schedule 40s','CN-47 has 1, 2 4 inch schedule 40s'])assert.equal(P.parse(text,{},[]).commands[0]?.schedule,'40',text);
assert.equal(P.parse('CN-47 has 2 4 inch 40S',{},[]).commands[0]?.schedule,'40S');assert.equal(P.parse('change last weld to schedule 80s',{},[{id:'r'}]).commands[0].patch.schedule,'80');
// A count followed by a bare fraction is ambiguous (one 1/2" weld or one 1 1/2" weld); it goes to review.
for(const text of ['CN-47 has 1 1/2 inch STD','CN-47 has 3 3/4 inch XS']){const r=P.parse(text,{},[]);assert.equal(r.commands.length,0,text);assert.match(r.review[0].reason,/Clarify/);assert.ok(r.review[0].reason.length<=160);}
assert.equal(P.parse('CN-47 has 1 1 1/2 inch STD',{},[]).commands[0].size,'1 1/2');
console.log('PASS: 40s recorded as schedule 40, explicit 40S kept, ambiguous fractions sent to review');
// Welder IDs spoken as letters: letter names and the NATO alphabet map to letters; other words are left alone.
for(const [spoken,id] of [['D D','DD'],['Dee Dee','DD'],['delta delta','DD'],['oh','O'],['are gee','RG'],['Romeo Golf','RG'],['double you dash 24','W-24'],['tango sierra','TS'],['B J','BJ']])assert.equal(P.parse('CN-47 has 2 4 inch STD welds welder '+spoken,{},[]).commands[0]?.welder,id,spoken);
assert.equal(P.parse('CN-47 has 2 4 inch STD welds welder W-24',{},[]).commands[0].welder,'W-24');assert.equal(P.parse('CN-22 has 3 3 inch STD welds welded TS',{},[]).commands[0].welder,'TS');
assert.equal(P.parse('CN-47 has 2 4 inch extra-strong welds',{},[]).commands[0].schedule,'XH');
console.log('PASS: spoken letter names and NATO alphabet for welder IDs, welded without by');

assert.equal(P.parse("Change CN-69's welder to DD",{},[{id:'r69',cn:'CN-69',sequence:1,xfFormat:{prefix:'XF',separator:'-',width:0}}]).commands[0]?.type,'updateRows');
assert.equal(P.parse('CN-69 has 2 2 inch XS welds welded by CN-ABC').commands[0]?.welder,'CN-ABC');

for(const phrase of ['a 4 inch STD weld','an 8 inch XS weld','a 1/2 inch STD weld']){
 const r=P.parse('CN-27 has '+phrase+' welded by DD');assert.deepEqual(r.review,[],phrase);assert.equal(r.commands[0].count,1);assert.equal(r.commands[0].welder,'DD');assert.equal(r.commands[0].cn,'CN-27');
}
assert.deepEqual(P.parse('CN-27 has a 4 inch STD weld and 2 2 inch XS welds welded by DD').commands.map(c=>c.count),[1,2]);
assert.ok(P.parse('CN-27 has a few 4 inch STD welds').review.length);
assert.equal(P.parse('CN-27 has a 4 inch STD weld welded by A').commands[0]?.welder,'A');
