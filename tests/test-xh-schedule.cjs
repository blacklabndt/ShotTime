const assert=require('node:assert/strict'),M=require('../assets/notes-model.js'),P=require('../assets/notes-parser.js'),S=require('../assets/notes-storage.js');
for(const alias of ['XS','XH','extra heavy','extra-heavy','extra strong']){
 const result=P.parse(`CN-42 has 2 2 inch ${alias} welds welded by DD`);assert.deepEqual(result.review,[],alias);assert.equal(result.commands[0].schedule,'XH');
 const mt=P.parse(`CN-42 has a 2 inch ${alias} TOL welded by DD`);assert.deepEqual(mt.review,[]);assert.equal(mt.commands.find(c=>c.type==='addMt').schedule,'XH');
}
const text='CN-42 has 2 welds Both 2 inch extra heavy Welded by DD',parsed=P.parse(text);assert.deepEqual(parsed.review,[]);assert.deepEqual([parsed.commands[0].count,parsed.commands[0].size,parsed.commands[0].schedule,parsed.commands[0].welder],[2,'2','XH','DD']);
assert.ok(P.parse('CN-42 has 3 welds both 2 inch extra heavy welded by DD').review.length);
assert.equal(P.parse('CN-42 has 2 2 inch XS welds welded by XS').commands[0].welder,'XS');
let list=M.createList({id:'xh',date:'2026-10-01',lsd:'test',start:1});list=M.applyGroup(list,parsed.commands,'first');
list=M.apply(list,{id:'mt',type:'addMt',count:1,cn:'CN-42',size:'2',schedule:'extra heavy',fittingType:'TOL',welder:'DD'});assert.equal(list.mtRows[0].schedule,'XH');
const legacy=JSON.parse(JSON.stringify(list));for(const state of [legacy,...legacy.history])for(const row of [...state.rows,...state.mtRows])row.schedule='XS';
const loaded=S.load({getItem:()=>JSON.stringify({schemaVersion:4,lists:[legacy],selectedListId:'xh'})});assert.equal(loaded.warning,'');for(const state of [loaded.library.lists[0],...loaded.library.lists[0].history])for(const row of [...state.rows,...state.mtRows])assert.equal(row.schedule,'XH');
assert.ok(!S.toCSV(legacy.rows,legacy.mtRows).includes('XS'));assert.ok(S.toCSV(legacy.rows,legacy.mtRows).includes('XH TOL'));
const V=require('../assets/notes-voice.js');const voice=V.reconcile(M.createList({id:'v',date:'2026-10-01',lsd:'test',start:1}),{id:'session',listId:'v',state:'stopped',events:[{text}]});assert.equal(voice.list.pending.length,0);assert.deepEqual(voice.list.rows.map(r=>r.schedule),['XH','XH']);
console.log('PASS: XH aliases, exact both-welds sentence, count mismatch, WID preservation, manual MT, legacy/history conversion and CSV');
