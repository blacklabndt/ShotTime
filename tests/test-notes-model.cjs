const assert=require('node:assert/strict');
const M=require('../assets/notes-model.js');
const fresh=()=>M.createList({id:'a',date:'2026-09-30',lsd:'test',start:101});
const command={id:'s1',type:'addBatch',cn:'CN-047',welder:'O',count:6,size:'4',schedule:'STD'};
const list=fresh(), next=M.apply(list,command);
assert.equal(next.rows.length,6);assert.equal(next.nextSequence,107);assert.equal(next.rows[0].welder,'O');assert.equal(next.rows[0].cn,'CN-047');assert.equal(M.formatId(next.rows[0].sequence,next.rows[0].xfFormat),'XF-101');assert.equal(list.rows.length,0);
assert.deepEqual(M.apply(next,command),next);
const undone=M.undo(next);assert.equal(undone.rows.length,0);assert.equal(M.apply(undone,command).rows.length,0);
let kept=M.apply(next,{id:'del1',type:'deleteRows',rowIds:[next.rows[1].id],renumber:false});assert.deepEqual(kept.rows.map(r=>r.sequence),[101,103,104,105,106]);assert.equal(kept.nextSequence,107);
let renumbered=M.apply(next,{id:'del2',type:'deleteRows',rowIds:[next.rows[1].id],renumber:true});assert.deepEqual(renumbered.rows.map(r=>r.sequence),[101,102,103,104,105]);assert.equal(renumbered.nextSequence,106);assert.deepEqual(M.undo(renumbered).rows,next.rows);
let formatted=M.apply(next,{id:'fmt',type:'changeFormat',cnFormat:{prefix:'C',separator:'',width:4},xfFormat:{prefix:'X',separator:'',width:4},existing:true});assert.equal(formatted.rows[0].cn,'C0047');assert.equal(M.formatId(formatted.rows[0].sequence,formatted.rows[0].xfFormat),'X0101');
let future=M.apply(next,{id:'fmt2',type:'changeFormat',cnFormat:{prefix:'C',separator:'',width:0},xfFormat:{prefix:'X',separator:'',width:4},existing:false});assert.equal(future.rows[0].cn,'CN-047');assert.equal(M.formatId(future.rows[0].sequence,future.rows[0].xfFormat),'XF-101');
const updated=M.apply(next,{id:'edit',type:'updateRows',rowIds:[next.rows[0].id],patch:{welder:'W-24'}});assert.equal(updated.rows[0].welder,'W-24');assert.equal(updated.rows[1].welder,'O');
for(const count of [0,-1,1.5,1001,NaN])assert.throws(()=>M.apply(list,{...command,count}));
assert.throws(()=>M.apply(next,{id:'bad',type:'updateRows',rowIds:['missing'],patch:{welder:'DD'}}));
assert.throws(()=>M.apply(next,{id:'bad',type:'updateRows',rowIds:[next.rows[0].id],patch:{sequence:4}}));
assert.throws(()=>M.createList({id:'bad',date:'2026-02-31',lsd:'x',start:1}));
assert.throws(()=>M.apply(list,{...command,cn:'CN\t47'}));
assert.equal(M.apply(list,{...command,welder:''}).rows[0].welder,'');
assert.equal(M.createList({id:'z',date:'2026-09-30',lsd:'x',start:'001'}).xfFormat.width,3);
assert.equal(M.validateList(next),true);
console.log('PASS: notes model numbering, context, formats, deletion, undo, replay and validation');
// Review regressions: formats must survive their history and independent XF changes.
const cf={prefix:'C',separator:'/',width:4},df={prefix:'D',separator:'-',width:2};
const historic=M.apply(M.apply(next,{id:'future-format',type:'changeFormat',cnFormat:cf,xfFormat:next.xfFormat,existing:false}),{id:'all-format',type:'changeFormat',cnFormat:df,xfFormat:next.xfFormat,existing:true});assert.equal(historic.rows[0].cn,'D-047');
const arbitrary=M.apply(fresh(),{...command,id:'manual',cn:'pipe-A'});const xfOnly=M.apply(arbitrary,{id:'xf-only',type:'changeFormat',cnFormat:arbitrary.cnFormat,xfFormat:{prefix:'W',separator:'-',width:0},existing:true});assert.equal(xfOnly.rows[0].cn,'pipe-A');assert.equal(M.formatId(xfOnly.rows[0].sequence,xfOnly.rows[0].xfFormat),'W-101');
// Storage budget: undo snapshots leave out processed IDs and stay under ~300,000 characters per list.
{let l=M.createList({id:'big',date:'2026-09-30',lsd:'t',start:1});for(let i=0;i<300;i++)l=M.applyGroup(l,[{type:'addBatch',cn:'CN-'+(i+1),welder:'DD',count:2,size:'4',schedule:'STD'}],'voice:session:'+i);
const chars=JSON.stringify(l).length;assert.ok(chars<700000,'list is '+chars+' characters');assert.ok(JSON.stringify(l.history).length<=300000);assert.ok(l.history.length>=1&&l.history.every(h=>!('processedSegments' in h)));
const undone=M.undo(l);assert.equal(undone.rows.length,598);assert.equal(M.applyGroup(undone,[{type:'addBatch',cn:'CN-300',welder:'DD',count:2,size:'4',schedule:'STD'}],'voice:session:299').rows.length,598);
const small=M.applyGroup(M.createList({id:'s',date:'2026-09-30',lsd:'t',start:1}),[{type:'addBatch',cn:'CN-1',welder:'DD',count:1,size:'4',schedule:'STD'}],'g');let many=small;for(let i=0;i<40;i++)many=M.apply(many,{id:'m'+i,type:'setContext',welder:'W'+i});assert.equal(many.history.length,30);
// Lists saved before this change still validate (history entries may carry processedSegments).
const legacy={...small,history:[{...small.history[0],processedSegments:['x']}]};assert.equal(M.validateList(legacy),true);}
console.log('PASS: bounded undo history without processed IDs, undo replay safety and legacy history');
