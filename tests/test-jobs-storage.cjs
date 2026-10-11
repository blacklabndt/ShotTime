const assert=require('node:assert/strict'),M=require('../assets/notes-model'),J=require('../assets/notes-jobs'),S=require('../assets/notes-storage');
const list=id=>M.createList({id,date:'2026-10-06',lsd:'Same',start:1});
const old={schemaVersion:4,lists:[list('x'),list('y')],selectedListId:'y'};
let raw=JSON.stringify(old);const storage={getItem:()=>raw,setItem:(k,v)=>raw=v};
const loaded=S.load(storage);assert.equal(loaded.library.schemaVersion,7);assert.equal(loaded.library.jobs.length,2);assert.notEqual(loaded.library.lists[0].jobId,loaded.library.lists[1].jobId);assert.equal(loaded.library.selectedJobId,loaded.library.lists[1].jobId);assert.equal(raw,JSON.stringify(old));
S.save(storage,loaded.library);assert.deepEqual(S.load(storage).library,loaded.library);
const withHistory=list('history');withHistory.history.push({...structuredClone(withHistory),nextSequence:42,nextMtSequence:19});delete withHistory.history[0].history;
raw=JSON.stringify({schemaVersion:4,lists:[withHistory],selectedListId:null});const hist=S.load(storage).library;assert.equal(hist.jobs[0].nextSequence,42);assert.equal(hist.jobs[0].nextMtSequence,19);
raw='{"schemaVersion":5,"jobs":[]}';const broken=S.load(storage);assert.ok(broken.warning);assert.equal(broken.rawBackup,raw);
assert.throws(()=>S.save({setItem:()=>{throw Error('full');}},loaded.library));
console.log('PASS: schema 5 migration, independent legacy jobs, history counters, round-trip and corruption preservation');
// Legacy IDs at the old maximum length must still migrate.
const longList=list('x'.repeat(160));raw=JSON.stringify({schemaVersion:4,lists:[longList],selectedListId:longList.id});
assert.equal(S.load(storage).warning,'');assert.equal(S.load(storage).library.lists[0].id,longList.id);

// Version 5 adds stable start dates without changing names, lists or counters.
let v5=J.createJob(J.empty(),{id:'dated',name:'Client',lsd:'Site'});
v5=J.createDailyList(v5,'dated',{id:'later',date:'2026-10-06'});
v5=J.createDailyList(v5,'dated',{id:'earlier',date:'2026-10-01'});
v5=J.createJob(v5,{id:'empty',name:'Other',lsd:'Other'});
v5.schemaVersion=5;for(const j of v5.jobs)delete j.startDate;
raw=JSON.stringify(v5);const migrated=S.load(storage);assert.equal(migrated.warning,'');
assert.equal(migrated.library.jobs[0].startDate,'2026-10-01');assert.equal(migrated.library.jobs[1].startDate,J.localDate());
assert.deepEqual(migrated.library.lists,v5.lists);assert.equal(raw,JSON.stringify(v5));
const edited=J.updateJob(migrated.library,'dated',{name:'New client',startDate:'2026-09-30'});
S.save(storage,edited);assert.deepEqual(S.load(storage).library,edited);
assert.throws(()=>J.updateJob(edited,'dated',{startDate:'2026-02-30'}));
assert.throws(()=>J.createJob(J.empty(),{id:'bad',name:'Client',lsd:'Site',startDate:'invalid'}));
