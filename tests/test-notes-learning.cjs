const assert=require('node:assert/strict'),L=require('../assets/notes-learning.js');
const store={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}};
L.remember(store,'pipe forty seven two fours','CN-47 has 2 4 inch STD welds welded by DD',{cn:'',welder:''});
assert.equal(L.suggest(store,'pipe forty seven two fours',{cn:'',welder:''}),'CN-47 has 2 4 inch STD welds welded by DD');
assert.equal(L.suggest(store,'pipe forty eight two fours',{cn:'',welder:''}),null);
assert.equal(L.suggest(store,'pipe forty seven two fours',{cn:'CN-99',welder:''}),null);
assert.throws(()=>L.remember(store,'bad','guess something',{}));
store.value='broken';assert.throws(()=>L.remember(store,'a','CN-1 has 1 4 inch STD weld',{}));assert.equal(store.value,'broken');
console.log('PASS: approved examples, exact context, no fuzzy ID substitution and corruption preservation');

L.clear(store);const M=require('../assets/notes-model.js');const list=M.applyGroup(M.createList({id:'l',date:'2026-09-30',lsd:'test',start:1}),[{type:'addBatch',cn:'CN-1',count:1,size:'4',schedule:'STD',welder:'DD'}],'rows');
L.remember(store,'fix the first welder','Change XF-1 welder to RG',list.context,list.rows);assert.equal(L.suggest(store,'fix the first welder',list.context),'Change XF-1 welder to RG');
