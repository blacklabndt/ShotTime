const assert=require('node:assert/strict'),P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js');
let d=P.reviewDraft('CN-332A has 2 2 inch strange welds and a 1 inch 3M TOL welded by DD',{cn:'CN-46',welder:'ZZ'});
assert.equal(d.groups.length,2);assert.deepEqual(d.groups.map(g=>[g.kind,g.cn,g.count,g.size,g.schedule,g.welder,g.fittingType]),[['xf','CN-332A','2','2','','DD',''],['mt','CN-332A','1','1','3M','DD','TOL']]);assert.ok(P.reviewIssues(d.groups[0],M.requirements()).schedule);assert.ok(!P.reviewIssues(d.groups[0],M.requirements()).cn);
d.groups[0].schedule='80';d.groups.forEach(g=>g.confirmed=true);const commands=P.reviewCommands(d,M.requirements());let l=M.applyGroup(M.createList({id:'x',date:'2026-10-04',lsd:'Test',start:1}),commands,'review');assert.equal(l.rows.length,2);assert.equal(l.mtRows.length,1);assert.equal(M.undo(l).rows.length,0);
d=P.reviewDraft('CN-XS C9 has some 2 inch STD welds welded by DD',{cn:'CN-46',welder:'ZZ'});assert.equal(d.groups[0].cn,'');assert.equal(d.groups[0].count,'');assert.ok(P.reviewIssues(d.groups[0],M.requirements()).cn);assert.ok(P.reviewIssues(d.groups[0],M.requirements()).count);
d=P.reviewDraft('CN-1 has 2 2 inch STD welds DD CN-2 has a 4 inch weld ZZ',{});assert.equal(d.groups.length,2);assert.equal(d.groups[1].cn,'CN-2');assert.equal(d.groups[1].size,'4');assert.ok(P.reviewIssues(d.groups[1],M.requirements()).schedule);
const optional=M.requirements();optional.xf.schedule=false;optional.xf.welder=false;assert.ok(!P.reviewIssues(d.groups[1],optional).schedule);
d=P.reviewDraft('Move the last weld to CN-blah',{});assert.equal(d.mode,'wording');assert.throws(()=>P.reviewCommands(d,M.requirements()));
d=P.reviewDraft('CN-1 has 1 1/2 inch STD weld DD',{});assert.ok(P.reviewIssues(d.groups[0],M.requirements()).count);assert.ok(P.reviewIssues(d.groups[0],M.requirements()).size);
console.log('PASS: partial fields, mixed XF/MT, malformed CN, required/optional highlights, fractions, modifiers and atomic save');

d=P.reviewDraft('CN-1 has 2 1 inch 3M MT fittings',{});assert.equal(d.groups[0].kind,'mt');assert.ok(P.reviewIssues(d.groups[0],M.requirements()).fittingType);
d=P.reviewDraft('CN-1 has a 2 inch STD weld welded by DD and ZZ',{});assert.ok(P.reviewIssues(d.groups[0],M.requirements()).welder);
d=P.reviewDraft('CN-1 has 3 welds both 2 inch strange',{});assert.ok(P.reviewIssues(d.groups[0],M.requirements()).count);

const V=require('../assets/notes-voice.js');
function confirmDeferred(text,rules,context={cn:'',welder:''}){
 let list=M.createList({id:'deferred',date:'2026-10-04',lsd:'Test',start:1,fieldRequirements:rules});list.context=context;
 const session={id:'review-parity',listId:list.id,state:'stopped',deferred:true,interpretError:'timeout',events:[{text}]};
 list=V.reconcile(list,session).list;assert.equal(list.pending.length,1);
 const pending=list.pending[0],draft=P.reviewDraft(pending.text,list.context,rules),strict=P.parse(text,context,[],rules);
 assert.deepEqual(strict.review,[]);draft.groups.forEach(g=>{assert.deepEqual(P.reviewIssues(g,M.requirements(rules)),{});assert.equal(g.unresolved,'');});
 list=M.applyGroup(list,P.reviewCommands(draft,rules),pending.id);list.pending=[];
 const direct=M.applyGroup(M.createList({id:'direct',date:'2026-10-04',lsd:'Test',start:1,fieldRequirements:rules}),strict.commands,'direct');
 const fields=r=>[r.cn,r.sequence,r.size,r.schedule,r.welder,r.type||''];
 assert.deepEqual(list.rows.map(fields),direct.rows.map(fields));assert.deepEqual(list.mtRows.map(fields),direct.mtRows.map(fields));
 assert.equal(list.nextSequence,direct.nextSequence);assert.equal(list.nextMtSequence,direct.nextMtSequence);
 assert.equal(V.reconcile(list,session).changed,false);assert.equal(M.undo(list).rows.length,0);assert.equal(M.undo(list).mtRows.length,0);
 return list;
}
const relaxed=M.requirements();relaxed.xf.schedule=false;relaxed.xf.size=false;
for(const schedule of ['XS','XH']){
 const saved=confirmDeferred('CN-1 has 2 2 inch '+schedule,relaxed);assert.equal(saved.rows.length,2);assert.equal(saved.rows[0].schedule,'XH');assert.equal(saved.rows[0].welder,'');
}
const socket=confirmDeferred('CN-1 has a 1 inch SW',relaxed);assert.equal(socket.rows.length,0);assert.equal(socket.mtRows.length,1);assert.equal(socket.mtRows[0].type,'SW');
for(const rules of [relaxed,M.requirements(),null]){const saved=confirmDeferred('CN-1 has 1, 2, 3 2 inch STD welds welded by DD',rules);assert.equal(saved.rows.length,3);assert.equal(saved.nextSequence,4);}
const requiredWid=M.requirements();requiredWid.xf.welder=true;
for(const token of ['XS','XH','SW']){
 const draft=P.reviewDraft('CN-1 has some 2 inch '+token,{},requiredWid),g=draft.groups[0];
 assert.equal(g.welder,'');assert.equal(g.kind,token==='SW'?'mt':'xf');assert.equal(token==='SW'?g.fittingType:g.schedule,token==='XS'?'XH':token);
}
const countingMissingWid=P.reviewDraft('CN-1 has 1, 2, 3 2 inch STD welds',{},requiredWid);
assert.equal(countingMissingWid.groups.length,1);assert.equal(countingMissingWid.groups[0].count,'3');assert.ok(P.reviewIssues(countingMissingWid.groups[0],requiredWid).welder);
const invalidCounting=P.reviewDraft('CN-1 has 1, 3, 4 2 inch STD welds',{},relaxed);assert.equal(invalidCounting.mode,'wording');assert.throws(()=>P.reviewCommands(invalidCounting,relaxed));
for(const rules of [requiredWid,null,M.requirements()]){
 const saved=confirmDeferred('CN-1 has 1 2 inch STD weld welded by DD CN-2 has 1 2 inch STD weld',rules,{cn:'CN-9',welder:'ZZ'});
 assert.deepEqual(saved.rows.map(r=>r.welder),rules&& !rules.xf.welder?['DD','']:['DD','DD']);
}
// Partial later spools must use the latest spoken WID too, while optional omissions remain blank.
for(const rules of [requiredWid,null,M.requirements()]){
 const draft=P.reviewDraft('CN-1 has 1 2 inch STD weld welded by DD CN-2 has 1 2 inch strange weld', {cn:'CN-9',welder:'ZZ'},rules);
 assert.equal(draft.groups[1].welder,rules&&!rules.xf.welder?'':'DD');
}
console.log('PASS: deferred field confirmation matches strict parsing, numbering, undo and replay for schedules, socket welds, counting and WID inheritance');
