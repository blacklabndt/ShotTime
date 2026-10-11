const assert=require('node:assert/strict'),S=require('../assets/notes-storage'),J=require('../assets/notes-jobs'),M=require('../assets/notes-model');
let lib=J.createJob(J.empty(),{id:'job',name:'Client',lsd:'Site'});lib=J.createDailyList(lib,'job',{id:'day',date:'2026-10-07'});lib=J.mutate(lib,'day',l=>M.apply(l,{id:'row',type:'addBatch',cn:'1',count:2,size:'2',schedule:'STD'}));
lib=J.mutate(lib,'day',l=>M.apply(l,{id:'mt',type:'addMt',cn:'2',count:3,size:'1',fittingType:'SW',schedule:'6M'}));lib.lists[0].draft='saved wording';lib.lists[0].pending.push({id:'pending',text:'needs review',reason:'Review'});
const text=S.backup(lib);assert.deepEqual(S.readBackup(text),lib);assert.deepEqual(S.readBackup(JSON.stringify(lib)),lib);
assert.throws(()=>S.readBackup('{bad'),/backup/i);assert.throws(()=>S.readBackup('{}'),/backup/i);assert.throws(()=>S.readBackup(JSON.stringify({...JSON.parse(text),backupVersion:99})),/backup/i);
assert.throws(()=>S.readBackup(JSON.stringify({...lib,selectedJobId:'missing'})),/backup/i);
assert.throws(()=>S.readBackup(' '.repeat(S.MAX_BACKUP+1)),/large/i);
const legacy={...lib,schemaVersion:6};assert.equal(S.readBackup(JSON.stringify(legacy)).schemaVersion,7);
console.log('PASS: backup round trip, legacy migration, malformed/future/oversized rejection');

let restored=structuredClone(lib);restored.deletedLists=['voice-session:retained'];for(let i=0;i<55;i++){restored=J.createDailyList(restored,'job',{id:'temp-'+i,date:'2026-10-07'});restored=J.removeList(restored,'temp-'+i);}assert.ok(restored.deletedLists.includes('voice-session:retained'));assert.ok(restored.deletedLists.length<=50);
