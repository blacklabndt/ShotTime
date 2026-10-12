const assert=require('node:assert/strict');
const V=require('../assets/notes-voice.js');
const M=require('../assets/notes-model.js');
const S=require('../assets/notes-storage.js');
const fresh=()=>M.createList({id:'list',date:'2026-09-30',lsd:'bunker',start:101});
assert.equal(V.reconcile(fresh(),{id:'hyphen',listId:'list',state:'stopped',events:[{text:'CN-1 has two four-inch standard welds welded by DD.'}]}).list.rows.length,2);
const session={id:'session',listId:'list',state:'listening',events:[{text:'C N forty-seven has six four inch standard welds.'}]};
// A pause must not commit rows before a trailing welder arrives.
let r=V.reconcile(fresh(),session);assert.equal(r.list.rows.length,0);assert.match(r.pending,/CN/);
session.events.push({text:'Welded by D D. C N thirty-two has two two inch extra strong welds welded by O.'});
r=V.reconcile(r.list,session);assert.equal(r.list.rows.length,6);assert.equal(r.list.rows[0].welder,'DD');assert.equal(r.list.rows[0].cn,'CN-47');
session.events.push({text:'CN-22 has three three inch standard welds welded by T S.'});
r=V.reconcile(r.list,session);assert.equal(r.list.rows.length,8);assert.equal(r.list.rows[7].welder,'O');
session.state='stopped';r=V.reconcile(r.list,session);assert.equal(r.list.rows.length,11);assert.equal(r.list.rows[10].sequence,111);assert.equal(r.list.rows[10].welder,'TS');
// Replay after storage/restart must not duplicate rows, including after undo.
const disk={value:null,setItem(k,v){this.value=v;},getItem(){return this.value;}};
S.save(disk,require('../assets/notes-jobs').fromLegacy({schemaVersion:4,lists:[r.list],selectedListId:'list'}));
let restored=S.load(disk).library.lists[0];restored=V.reconcile(restored,session).list;assert.equal(restored.rows.length,11);
restored=M.undo(restored);restored=V.reconcile(restored,session).list;assert.equal(restored.rows.length,8);
// An ambiguous early pipe blocks later auto-adds; dismissing must prevent replay.
const bad={id:'bad',listId:'list',state:'stopped',events:[{text:'CN-7 has some welds. CN-8 has one four inch STD weld welded by W dash twenty-four.'}]};
r=V.reconcile(fresh(),bad);assert.equal(r.list.rows.length,0);assert.equal(r.list.pending.length,2);
r.list.processedSegments.push(r.list.pending[0].id);r.list.pending.shift();r=V.reconcile(r.list,bad);assert.equal(r.list.pending.length,1);
assert.equal(V.reconcile(fresh(),{...session,listId:'elsewhere'}).list.rows.length,0);
// Spoken corrections close the buffered batch and cannot replay an undo twice.
const corrections={id:'edit',listId:'list',state:'stopped',events:[{text:'CN-47 has one four inch STD weld welded by RG. Change XF-101 welder W dash twenty-four.'}]};
r=V.reconcile(fresh(),corrections);assert.equal(r.list.rows[0].welder,'W-24');
corrections.events.push({text:'Undo last batch.'});r=V.reconcile(r.list,corrections);assert.equal(r.list.rows[0].welder,'RG');
assert.equal(V.reconcile(r.list,corrections).list.rows[0].welder,'RG');
// Undoing a row change must retain archived raw speech after a new session starts.
let audit=M.applyGroup(fresh(),[{type:'addBatch',cn:'CN-1',welder:'O',count:1,size:'4',schedule:'STD'}],'audit');
audit.voiceTranscripts=[{id:'recording',text:'CN-1 has one four inch STD weld welded by O'}];
audit=M.applyGroup(audit,[{type:'addBatch',cn:'CN-2',welder:'O',count:1,size:'4',schedule:'STD'}],'audit2');
audit.voiceTranscripts.push({id:'recording2',text:'CN-2 has one four inch STD weld'});
assert.equal(M.undo(audit).voiceTranscripts.length,2);
const interrupted={id:'interrupted',listId:'list',state:'interrupted',events:[{text:'CN-1 has one four inch STD weld welded by O'}]};
r=V.reconcile(fresh(),interrupted);assert.equal(r.list.rows.length,0);assert.equal(r.list.pending.length,1);
console.log('PASS: voice batch assembly, trailing welder, ordering, persistence, replay, review and corrections');

const cloudSession={id:'cloud',listId:'list',state:'listening',deferred:true,events:[{text:'CN-1 has 2 4 inch STD welds welded by DD. CN-2 has 1 2 inch XS weld.'}]};
let cloudResult=V.reconcile(fresh(),cloudSession);assert.equal(cloudResult.list.rows.length,0);
cloudSession.state='stopped';cloudSession.suggestion='CN-1 has 2 4 inch STD welds welded by DD, CN-2 has 1 2 inch XS weld';
cloudResult=V.reconcile(fresh(),cloudSession);assert.equal(cloudResult.list.rows.length,0);assert.equal(cloudResult.list.pending.length,1);assert.equal(cloudResult.list.pending[0].source,cloudSession.events[0].text);assert.equal(V.reconcile(cloudResult.list,cloudSession).list.pending.length,1);
cloudResult.list.processedSegments.push(cloudResult.list.pending[0].id);cloudResult.list.pending=[];assert.equal(V.reconcile(cloudResult.list,cloudSession).list.pending.length,0);

const fallbackSession={id:'fallback',listId:'list',state:'stopped',deferred:true,events:[{text:'CN-1 has 2 4 inch STD welds welded by DD'}]};const fallback=V.reconcile(fresh(),fallbackSession);assert.equal(fallback.list.rows.length,0);assert.equal(fallback.list.pending.length,1);
let lookupCalls=0;const learnedParsed=V.reconcile(fresh(),{id:'learned',listId:'list',state:'stopped',events:[{text:'CN-1 has 2 4 inch STD welds welded by DD'}]},()=>{lookupCalls++;return 'CN-1 has 2 4 inch STD welds welded by RG';});assert.equal(lookupCalls,1);assert.equal(learnedParsed.list.rows.length,0);assert.equal(learnedParsed.list.pending.length,1);

let deferredCalls=0;const learnedDeferred=V.reconcile(fresh(),fallbackSession,()=>{deferredCalls++;return 'CN-1 has 2 4 inch STD welds welded by RG';});assert.equal(deferredCalls,1);assert.match(learnedDeferred.list.pending[0].text,/RG/);
const longSession={...fallbackSession,id:'long',events:[{text:'CN-1 has 2 4 inch STD welds welded by DD. '.repeat(700)}]};const longResult=V.reconcile(fresh(),longSession).list;M.validateList(longResult);assert.ok(longResult.pending.length>1);assert.ok(longResult.pending.every(p=>p.text.length<=19000));assert.equal(V.reconcile(longResult,longSession).changed,false);

const longCanonical={...fallbackSession,id:'long-approved',events:[{text:'CN-1 has 2 4 inch STD welds welded by DD, '.repeat(700)}]};let sequential=V.reconcile(fresh(),longCanonical).list;const P=require('../assets/notes-parser.js');
for(const part of [...sequential.pending]){const parsed=P.parse(part.text,sequential.context,sequential.rows);assert.equal(parsed.review.length,0);sequential=M.applyGroup(sequential,parsed.commands.slice(0,2),part.id);sequential.pending=sequential.pending.filter(p=>p.id!==part.id);}
assert.equal(sequential.rows.length,8);assert.equal(V.reconcile(sequential,longCanonical).changed,false);
// A failed cloud interpretation is not an interrupted recording; the review says what failed.
{const s={id:'interp',listId:'list',state:'stopped',deferred:true,interpretError:'timeout',events:[{text:'CN-5 has 2 4 inch STD welds'}]};const r=V.reconcile(fresh(),s);assert.match(r.list.pending[0].reason,/Cloud interpretation failed/);assert.doesNotMatch(r.list.pending[0].reason,/interrupted/);}
console.log('PASS: cloud interpretation failure reason');
// Whisper transcript habits (from small.en test runs): CM for CN, glued CN47, "welders,", "Weldero", punctuation commas.
{const P=require('../assets/notes-parser.js');const parsed=t=>{const r=P.parse(V.normalize(t),{},[{id:'r1',cn:'CN-47',sequence:1,xfFormat:{prefix:'XF',separator:'-',width:0}}]);assert.equal(r.review.length,0,t+' '+JSON.stringify(r.review));return r.commands[0];};
let c=parsed('CN22 has three 3-inch standard welds, welders, TS.');assert.deepEqual([c.cn,c.count,c.size,c.schedule,c.welder],['CN-22',3,'3','STD','TS']);
c=parsed('CN32 has 2 2 inch XS welds, Weldero.');assert.equal(c.welder,'O');c=parsed('CM61 has one 4-inch extra-strong weld, welder B.');assert.deepEqual([c.cn,c.schedule,c.welder],['CN-61','XH','B']);
c=parsed('CN51 has 4 6-inch, schedule 80, welds, welder R G.');assert.deepEqual([c.count,c.size,c.schedule,c.welder],[4,'6','80','RG']);
c=parsed('Change CN47, welder to PJ.');assert.deepEqual([c.type,c.patch.welder],['updateRows','PJ']);
assert.equal(parsed('CN-43 has 1, 2, 3, 4, 2 inch 80s welder DD').count,4);}
console.log('PASS: Whisper transcript habits normalized');
// Counting aloud in words survives voice normalization: commas before number words are kept for the parser.
{const P=require('../assets/notes-parser.js');const r=P.parse(V.normalize('CN-43 has one, two, three, four 2 inch STD welds welded by DD'),{},[]);assert.equal(r.review.length,0,JSON.stringify(r.review));assert.deepEqual([r.commands[0].count,r.commands[0].size,r.commands[0].welder],[4,'2','DD']);
assert.equal(P.parse(V.normalize('CN51 has 4 6-inch, schedule 80, welds, welder R G.'),{},[]).commands[0].schedule,'80');}
console.log('PASS: counting aloud in number words through voice');
