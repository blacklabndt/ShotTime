const assert=require('node:assert/strict'),M=require('../assets/notes-model'),J=require('../assets/notes-jobs');
function fixture(){let l=J.empty();for(const id of ['a','b']){l=J.createJob(l,{id,name:id,lsd:id,start:1,mtStart:10});for(const day of ['1','2'])l=J.createDailyList(l,id,{id:id+day,date:'2026-10-0'+day});}for(const [id,cn,token]of [['a1','001','x'],['a2','2','y'],['a1','3','z'],['b1','001','b']])l=J.mutate(l,id,s=>M.applyGroup(s,[{type:'addBatch',cn,count:2,size:'4',schedule:'STD'},{type:'addMt',cn,count:2,size:'2',fittingType:'Plate'}],token));return l;}
const lib=fixture(),before=JSON.stringify(lib),selection=[{listId:'a1',cn:'CN-001'}];
assert.equal(J.searchCNs(lib,'a','cn#1').length,1);
assert.equal(J.searchCNs(lib,'a','').length,3);
let r=J.bulkCNs(lib,{jobId:'a',selection,action:'delete',numbering:'keep'});
assert.deepEqual(r.library.lists[0].rows.map(r=>r.sequence),[5,6]);assert.equal(r.library.jobs[0].nextSequence,7);assert.equal(r.library.jobs[0].nextMtSequence,16);
r=J.bulkCNs(lib,{jobId:'a',selection,action:'delete',numbering:'renumber'});
assert.deepEqual(r.library.lists[1].rows.map(r=>r.sequence),[1,2]);assert.deepEqual(r.library.lists[1].mtRows.map(r=>r.sequence),[10,11]);assert.equal(r.library.jobs[0].nextSequence,5);assert.equal(r.library.jobs[0].nextMtSequence,14);assert.ok(r.library.lists.filter(l=>l.jobId==='a').every(l=>!l.history.length));
r=J.bulkCNs(lib,{jobId:'a',selection,action:'move',destinationId:'a2',numbering:'keep'});assert.equal(r.library.lists[1].rows.length,4);assert.equal(r.library.jobs[0].nextSequence,7);assert.equal(r.library.lists[0].rows.length,2);
assert.throws(()=>J.bulkCNs(lib,{jobId:'a',selection,action:'move',destinationId:'b2',numbering:'keep'}),/number.*already|collision/i);
r=J.bulkCNs(lib,{jobId:'a',selection,action:'move',destinationId:'b2',numbering:'renumber'});assert.deepEqual(r.library.lists[3].rows.map(r=>r.sequence),[3,4]);assert.deepEqual(r.library.lists[3].mtRows.map(r=>r.sequence),[12,13]);assert.equal(r.duplicates.length,1);assert.equal(r.library.jobs[0].nextSequence,5);assert.equal(r.library.jobs[1].nextSequence,5);assert.equal(r.library.lists[3].lsd,'b');assert.ok(r.library.lists[0].processedSegments.includes('x'));
const replay=J.mutate(r.library,'a1',s=>M.applyGroup(s,[], 'x'));assert.equal(replay.lists[0].rows.length,2);
assert.throws(()=>M.undo(r.library.lists[0]),/Nothing to undo/);
assert.throws(()=>J.bulkCNs(lib,{jobId:'a',selection,action:'move',destinationId:'a1',numbering:'keep'}),/destination/i);
assert.throws(()=>J.bulkCNs(lib,{jobId:'a',selection:[{listId:'b1',cn:'CN-001'}],action:'delete',numbering:'keep'}));
const pending=structuredClone(lib);pending.lists[1].pending.push({id:'p',text:'CN',reason:'review'});assert.throws(()=>J.bulkCNs(pending,{jobId:'a',selection,action:'delete',numbering:'renumber'}),/pending|review/i);
assert.equal(JSON.stringify(lib),before);J.validate(r.library);
console.log('PASS: CN search, atomic bulk delete/move, both numbering modes, duplicates, replay and undo boundaries');
// Multiple CNs across lists, MT-only data, suffixes and unknown placeholders.
let extra=fixture();extra=J.mutate(extra,'a2',l=>M.apply(l,{id:'suffix',type:'addMt',cn:'22A',count:1,size:'2',fittingType:'Plate'}));extra=J.mutate(extra,'a2',l=>M.apply(l,{id:'unknown',type:'addMt',cn:'?',count:1,size:'2',fittingType:'Plate'}));
assert.equal(J.searchCNs(extra,'a','22a').length,1);assert.equal(J.searchCNs(extra,'a','?').length,1);
extra=J.updateJob(extra,'b',{cnFormat:{prefix:'S',separator:':',width:4}},{existing:true});
let moved=J.bulkCNs(extra,{jobId:'a',selection:[{listId:'a2',cn:'CN-22A'},{listId:'a2',cn:'?'},{listId:'a1',cn:'CN-3'}],action:'move',destinationId:'b2',numbering:'renumber'});
assert.deepEqual(moved.library.lists[3].mtRows.map(r=>r.cn),['S:0003','S:0003','S:0022A','?']);assert.equal(J.searchCNs(moved.library,'b','22a').length,1);assert.equal(moved.duplicates.length,0);assert.equal(moved.library.lists[3].rows.length,2);
// Keep numbers permits non-colliding cross-job moves and never consumes counters twice.
moved=J.bulkCNs(lib,{jobId:'a',selection:[{listId:'a1',cn:'CN-3'}],action:'move',destinationId:'b2',numbering:'keep'});assert.deepEqual(moved.library.lists[3].rows.map(r=>r.sequence),[5,6]);assert.deepEqual(moved.library.lists[3].mtRows.map(r=>r.sequence),[14,15]);assert.equal(moved.library.jobs[1].nextSequence,7);assert.equal(moved.library.jobs[0].nextSequence,7);
const opts={jobId:'a',selection:[{listId:'a1',cn:'CN-001'},{listId:'a2',cn:'CN-2'}],action:'delete',numbering:'renumber'};moved=J.bulkCNs(lib,opts);assert.deepEqual(moved.library.lists[0].rows.map(r=>r.sequence),[1,2]);assert.deepEqual(moved.library.lists[0].mtRows.map(r=>r.sequence),[10,11]);
console.log('PASS: cross-list selection, suffix/unknown CNs, destination formats, MT-only entries and keep-number transfers');
