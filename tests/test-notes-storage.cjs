const assert=require('node:assert/strict'),S=require('../assets/notes-storage.js'),M=require('../assets/notes-model.js');
const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
let library=require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[],selectedListId:null});S.save(storage,library);assert.deepEqual(S.load(storage).library,library);assert.throws(()=>S.save({setItem(){throw Error('quota');}},library),/quota/);
map.set(S.KEY,'broken');assert.ok(S.load(storage).warning);assert.equal(map.get(S.KEY),'broken');assert.equal(S.load(storage).rawBackup,'broken');
map.set(S.KEY,JSON.stringify({schemaVersion:9}));assert.ok(S.load(storage).warning);
const cmd={id:'seg',type:'addBatch',cn:'CN-001',welder:'O',count:2,size:'4',schedule:'STD'};
let list=M.apply(M.createList({id:'l',date:'2026-09-30',lsd:'test',start:1}),cmd);library=require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[list],selectedListId:'l'});S.save(storage,library);let loaded=S.load(storage).library.lists[0];assert.equal(M.apply(loaded,cmd).rows.length,2);assert.equal(S.toTSV(loaded.rows),'CN-001\tXF-1\tO\t4"\tSTD\r\nCN-001\tXF-2\tO\t4"\tSTD');
assert.equal(S.toTSV([{...list.rows[0],cn:'=2+2',welder:'@SUM(1)'}]).split('\t')[0],"'=2+2");
assert.throws(()=>S.toTSV([{...list.rows[0],cn:'x\ty'}]));
const bad=JSON.parse(JSON.stringify(library));bad.lists[0].nextSequence=1;map.set(S.KEY,JSON.stringify(bad));assert.ok(S.load(storage).warning);
assert.ok(S.load({getItem(){throw Error('disabled');}}).warning);
console.log('PASS: persistent notes, replay, corruption recovery, failed writes and safe five-column export');

assert.equal(S.toCSV(list.rows), '\ufeff"CN#s","XF#s","WID","Weld Size","Weld Schedule"\r\n"CN-001","XF-1","O","4","STD"\r\n"CN-001","XF-2","O","4","STD"\r\n');
assert.ok(S.toCSV([{...list.rows[0],cn:'A,B',welder:'=1+1'}]).includes('"A,B","XF-1","\'=1+1"'));
// CSV: leading zeroes survive Excel as ="007"; formula-like values keep the apostrophe; deleted list IDs validate.
assert.ok(S.toCSV([{...list.rows[0],welder:'007'}]).includes('"=""007"""'));assert.ok(S.toTSV([{...list.rows[0],welder:'007'}]).includes("'007"));
assert.throws(()=>S.validate({schemaVersion:4,lists:[],selectedListId:null,deletedLists:'x'}));assert.equal(S.validate({...require('../assets/notes-jobs').empty(),deletedLists:['a']}),true);
console.log('PASS: CSV leading zeroes and deleted-list records');
