(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./notes-model.js'):root.ShotNotesModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.ShotNotesJobs=api;})(globalThis,function(M){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const empty=()=>({schemaVersion:7,jobs:[],lists:[],selectedJobId:null,selectedListId:null,deletedLists:[]});
function text(v,label){if(typeof v!=='string'||!v.trim()||v.length>160||/[\x00-\x1f\x7f]/.test(v))throw Error('Enter a valid '+label+' (one line, up to 160 characters).');return v.trim();}
function localDate(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('Enter a valid start date.');return v;}
function number(n){if(!Number.isSafeInteger(n)||n<1||n>=Number.MAX_SAFE_INTEGER)throw Error('Invalid job numbering.');return n;}
function jobOf(lib,id){const j=lib.jobs.find(j=>j.id===id);if(!j)throw Error('Job is missing.');return j;}
function listOf(lib,id){const l=lib.lists.find(l=>l.id===id);if(!l)throw Error('Daily list is missing.');return l;}
function project(l,j){return {...l,jobId:j.id,lsd:j.lsd,start:j.start,nextSequence:j.nextSequence,mtStart:j.mtStart,nextMtSequence:j.nextMtSequence,cnFormat:clone(j.cnFormat),xfFormat:clone(j.xfFormat),mtFormat:clone(j.mtFormat)};}
function sync(lib){lib.lists=lib.lists.map(l=>project(l,jobOf(lib,l.jobId)));return lib;}
function validate(lib){
 if(!lib||lib.schemaVersion!==7||!Array.isArray(lib.jobs)||!Array.isArray(lib.lists))throw Error('Invalid jobs library.');
 const jobs=new Set(),ids=new Set(),used=new Map();
 for(const j of lib.jobs){text(j.id,'job ID');text(j.name,'client name');date(j.startDate);text(j.lsd,'LSD');if(jobs.has(j.id))throw Error('Duplicate job IDs.');jobs.add(j.id);for(const k of ['start','nextSequence','mtStart','nextMtSequence'])number(j[k]);if(j.nextSequence<j.start||j.nextMtSequence<j.mtStart)throw Error('Invalid job counters.');for(const f of [j.cnFormat,j.xfFormat,j.mtFormat])M.formatId(1,f);M.requirements(j.fieldRequirements);used.set(j.id,{xf:new Set(),mt:new Set()});}
 for(const l of lib.lists){if(ids.has(l.id))throw Error('Duplicate daily-list IDs.');ids.add(l.id);const j=jobOf(lib,l.jobId);M.validateList(l);if(l.nextSequence!==j.nextSequence||l.nextMtSequence!==j.nextMtSequence)throw Error('Daily-list counters are out of sync.');for(const [kind,rows,next]of [['xf',l.rows,j.nextSequence],['mt',l.mtRows,j.nextMtSequence]])for(const r of rows){const seen=used.get(j.id)[kind];if(seen.has(r.sequence)||r.sequence>=next)throw Error('Duplicate or invalid job numbers.');seen.add(r.sequence);}}
 if(lib.selectedJobId!==null&&!jobs.has(lib.selectedJobId))throw Error('Selected job is missing.');if(lib.selectedListId!==null&&(!ids.has(lib.selectedListId)||listOf(lib,lib.selectedListId).jobId!==lib.selectedJobId))throw Error('Selected daily list does not belong to this job.');
 if(lib.deletedLists!==undefined&&(!Array.isArray(lib.deletedLists)||lib.deletedLists.length>50||lib.deletedLists.some(id=>typeof id!=='string')))throw Error('Invalid deleted lists.');return true;
}
function createJob(lib,o){validate(lib);const out=clone(lib);const probe=M.createList({id:o.id,date:'2000-01-01',lsd:o.lsd,start:o.start??1,mtStart:o.mtStart??1,cnFormat:o.cnFormat,xfFormat:o.xfFormat,fieldRequirements:o.fieldRequirements??M.requirements()});
 const j={id:text(o.id,'job ID'),name:text(o.name,'client name'),startDate:date(o.startDate??localDate()),lsd:probe.lsd,start:probe.start,nextSequence:probe.start,mtStart:probe.mtStart,nextMtSequence:probe.mtStart,cnFormat:probe.cnFormat,xfFormat:probe.xfFormat,mtFormat:o.mtFormat||probe.mtFormat,fieldRequirements:probe.fieldRequirements};out.jobs.push(j);out.selectedJobId=j.id;out.selectedListId=null;validate(out);return out;
}
function createDailyList(lib,jobId,o){validate(lib);const out=clone(lib),j=jobOf(out,jobId);const l=M.createList({id:o.id,date:o.date,lsd:j.lsd,start:j.start,mtStart:j.mtStart,fieldRequirements:j.fieldRequirements,cnFormat:j.cnFormat,xfFormat:j.xfFormat});out.lists.push(project(l,j));out.selectedJobId=jobId;out.selectedListId=l.id;validate(out);return out;}
function workingList(lib,id){const l=listOf(lib,id);return project(clone(l),jobOf(lib,l.jobId));}
function mutate(lib,id,transform){validate(lib);const out=clone(lib),before=workingList(out,id),changed=transform(before),j=jobOf(out,before.jobId);if(!changed||changed.id!==before.id||changed.jobId!==before.jobId)throw Error('Daily-list identity changed.');
 j.nextSequence=Math.max(j.nextSequence,changed.nextSequence);j.nextMtSequence=Math.max(j.nextMtSequence,changed.nextMtSequence);out.lists=out.lists.map(l=>l.id===id?changed:l);sync(out);validate(out);return out;
}
function cnKey(row,format){
 format=row.cnSourceFormat||format;
 let value=(row.cn||'').trim().toUpperCase();if(!value||value==='?')return '';
 if(row.cnNumber!=null&&/^\d+$/.test(String(row.cnNumber)))return 'number:'+String(row.cnNumber).replace(/^0+(?=\d)/,'');
 const lead=(format.prefix+format.separator).toUpperCase();if(lead&&value.startsWith(lead))value=value.slice(lead.length);else value=value.replace(/^CN[ #\-]*/,'');
 const match=value.match(/^(\d+)([A-Z]*)$/);return match?'number:'+match[1].replace(/^0+(?=\d)/,'')+match[2]:'text:'+value;
}
function duplicateCNs(lib,before,after,options={}){
 if(options.undo===true)return [];
 const old=new Map([...before.rows,...before.mtRows].map(r=>[r.id,r])),matches=new Map();
 for(const row of [...after.rows,...after.mtRows]){
  const key=cnKey(row,after.cnFormat);if(old.has(row.id)&&cnKey(old.get(row.id),before.cnFormat)===key)continue;if(!key||matches.has(key))continue;
  const dates=[];for(const l of lib.lists.filter(l=>l.jobId===before.jobId)){
   const source=l.id===before.id?before:l;
   if([...source.rows,...source.mtRows].some(r=>cnKey(r,source.cnFormat)===key))dates.push(l.date);
  }
  if(dates.length)matches.set(key,{cn:row.cn,dates:[...new Set(dates)].sort()});
 }
 return [...matches.values()];
}
function select(lib,jobId,listId=null){validate(lib);const out=clone(lib);out.selectedJobId=jobId;out.selectedListId=listId;validate(out);return out;}
function tombstone(lib,ids){const all=[...new Set([...(lib.deletedLists||[]),...ids])],session=all.filter(id=>id.startsWith('voice-session:')).slice(-1);lib.deletedLists=[...all.filter(id=>!id.startsWith('voice-session:')).slice(-(50-session.length)),...session];}
function removeList(lib,id){validate(lib);const out=clone(lib);listOf(out,id);out.lists=out.lists.filter(l=>l.id!==id);tombstone(out,[id]);if(out.selectedListId===id)out.selectedListId=null;validate(out);return out;}
function removeJob(lib,id){validate(lib);const out=clone(lib);jobOf(out,id);const removed=out.lists.filter(l=>l.jobId===id).map(l=>l.id);out.lists=out.lists.filter(l=>l.jobId!==id);out.jobs=out.jobs.filter(j=>j.id!==id);tombstone(out,removed);if(out.selectedJobId===id){out.selectedJobId=null;out.selectedListId=null;}validate(out);return out;}
function updateJob(lib,id,patch,options={}){
 validate(lib);if(!patch||Object.keys(patch).some(k=>!['name','startDate','lsd','start','mtStart','cnFormat','xfFormat','mtFormat','fieldRequirements'].includes(k)))throw Error('Invalid job settings.');
 const out=clone(lib),j=jobOf(out,id),old=clone(j);
 for(const [k,v]of Object.entries(patch)){
  if(k==='start'||k==='mtStart'){const next=k==='start'?'nextSequence':'nextMtSequence',n=number(Number(v));if(k==='mtStart'&&j[next]===j[k])j.mtFormat={...j.mtFormat,width:/^0\d+$/.test(String(v))?String(v).length:0};if(n!==j[k]){if(j[next]!==j[k])throw Error('Starting numbers cannot change after use.');j[k]=n;j[next]=n;}}
  else if(k==='startDate')j[k]=date(v);else if(k==='name'||k==='lsd')j[k]=text(v,k==='name'?'client name':'LSD');else if(k==='fieldRequirements')j[k]=v===null?null:M.requirements(v);else{M.formatId(1,v);j[k]=clone(v);}
 }
 const formatChanged=JSON.stringify(old.cnFormat)!==JSON.stringify(j.cnFormat)||JSON.stringify(old.xfFormat)!==JSON.stringify(j.xfFormat);
 for(const l of out.lists.filter(l=>l.jobId===id)){
  const convert=state=>{
   let result=state;
   if(formatChanged){const temp={...clone(state),history:[],processedSegments:state.processedSegments||[],pending:[],draft:''};const formatted=M.apply(temp,{id:'job-format',type:'changeFormat',cnFormat:j.cnFormat,xfFormat:j.xfFormat,existing:!!options.existing});result={...state,rows:formatted.rows,mtRows:formatted.mtRows,context:formatted.context};}
   return project(result,j);
  };
  const history=l.history.map(convert);Object.assign(l,convert(l),{history});
 }
 sync(out);validate(out);return out;
}
function fromLegacy(lib){
 if(lib.schemaVersion===7){validate(lib);return clone(lib);}if(lib.schemaVersion===6){const out=clone(lib);out.schemaVersion=7;for(const l of out.lists)for(const state of [l,...l.history])for(const r of [...state.rows,...state.mtRows])if(!r.cnSourceFormat&&r.cnNumber==null&&r.cn&&r.cn!=='?')r.cnSourceFormat=clone(state.cnFormat);validate(out);return out;}if(lib.schemaVersion===5){const out=clone(lib);out.schemaVersion=6;for(const j of out.jobs){const dates=out.lists.filter(l=>l.jobId===j.id).map(l=>l.date).sort();j.startDate=dates[0]||localDate();}return fromLegacy(out);}if(lib.schemaVersion!==4||!Array.isArray(lib.lists))throw Error('Invalid legacy library.');const out={...clone(lib),schemaVersion:7,jobs:[],selectedJobId:null,deletedLists:clone(lib.deletedLists||[])};
 for(const l of out.lists){M.validateList(l);const id='legacy-job:'+out.jobs.length,j={id,startDate:l.date,name:(l.lsd+' — '+l.date).slice(0,160),lsd:l.lsd,start:l.start,mtStart:l.mtStart,nextSequence:l.nextSequence,nextMtSequence:l.nextMtSequence,cnFormat:clone(l.cnFormat),xfFormat:clone(l.xfFormat),mtFormat:clone(l.mtFormat),fieldRequirements:clone(l.fieldRequirements)};
  for(const s of [l,...l.history]){j.nextSequence=Math.max(j.nextSequence,s.nextSequence,...s.rows.map(r=>r.sequence+1));j.nextMtSequence=Math.max(j.nextMtSequence,s.nextMtSequence,...s.mtRows.map(r=>r.sequence+1));s.jobId=id;}out.jobs.push(j);if(out.selectedListId===l.id)out.selectedJobId=id;
 }sync(out);out.schemaVersion=6;return fromLegacy(out);
}
function searchCNs(lib,jobId,query=''){
 jobOf(lib,jobId);const q=query.trim().toUpperCase(),needle=q.replace(/^CN[ #\-]*/,'').replace(/^0+(?=\d)/,'');const found=[];
 for(const l of lib.lists.filter(l=>l.jobId===jobId))for(const cn of new Set([...l.rows,...l.mtRows].map(r=>r.cn))){const rows=l.rows.filter(r=>r.cn===cn),mt=l.mtRows.filter(r=>r.cn===cn),key=cnKey(rows[0]||mt[0],l.cnFormat).replace(/^(number|text):/,'');if(!q||cn.toUpperCase().includes(q)||needle&&key.includes(needle))found.push({listId:l.id,cn,date:l.date,xf:rows.length,mt:mt.length});}
 return found.sort((a,b)=>b.date.localeCompare(a.date)||a.cn.localeCompare(b.cn,undefined,{numeric:true}));
}
// A bulk edit is one library transaction. Old list-local undo snapshots cannot safely
// restore rows after they have moved or job-wide numbering has changed.
function bulkCNs(lib,o){
 validate(lib);if(!['delete','move'].includes(o.action)||!['keep','renumber'].includes(o.numbering))throw Error('Choose an action and numbering option.');
 const out=clone(lib),source=jobOf(out,o.jobId),dest=o.action==='move'?listOf(out,o.destinationId):null,target=dest?jobOf(out,dest.jobId):null;
 if(!Array.isArray(o.selection)||!o.selection.length)throw Error('Select at least one CN.');
 const selected=new Map();for(const s of o.selection){const l=listOf(out,s.listId);if(l.jobId!==source.id)throw Error('Selected CN is outside this job.');if(dest?.id===l.id)throw Error('Choose a destination outside the selected source lists.');if(![...l.rows,...l.mtRows].some(r=>r.cn===s.cn))throw Error('A selected CN no longer exists.');if(!selected.has(l.id))selected.set(l.id,new Set());selected.get(l.id).add(s.cn);}
 const affected=new Set([source.id,...(target?[target.id]:[])]),lists=out.lists.filter(l=>affected.has(l.jobId));
 if(lists.some(l=>l.pending.length||l.draft.trim()))throw Error('Resolve pending instructions and drafts in the affected jobs first.');
 const moved={rows:[],mtRows:[]},duplicates=new Map();
 for(const l of lists){const cns=selected.get(l.id);if(!cns)continue;for(const kind of ['rows','mtRows']){for(const row of l[kind].filter(r=>cns.has(r.cn))){moved[kind].push(row);if(dest){const key=cnKey(row,l.cnFormat);if(key){const matches=out.lists.filter(x=>x.jobId===target.id&&[...x.rows,...x.mtRows].some(r=>!selected.get(x.id)?.has(r.cn)&&cnKey(r,x.cnFormat)===key));if(matches.length)duplicates.set(key,{cn:row.cn,dates:[...new Set(matches.map(x=>x.date))]});}}}l[kind]=l[kind].filter(r=>!cns.has(r.cn));}}
 for(const kind of ['rows','mtRows'])moved[kind].sort((a,b)=>a.sequence-b.sequence);
 if(dest){for(const [kind,next,start]of [['rows','nextSequence','start'],['mtRows','nextMtSequence','mtStart']]){
  const used=new Set(out.lists.filter(l=>l.jobId===target.id).flatMap(l=>l[kind].map(r=>r.sequence))),ids=new Set(dest[kind].map(r=>r.id));
  for(const row of moved[kind]){if(target.id!==source.id&&o.numbering==='renumber')row.sequence=target[next]++;
   else if(used.has(row.sequence)||row.sequence<target[start])throw Error('XF or MT number collision: a number already exists or is below the destination start. Choose Renumber continuously.');
   used.add(row.sequence);target[next]=Math.max(target[next],row.sequence+1);let id=row.id;while(ids.has(id))id+=':m';row.id=id;ids.add(id);if(target.id!==source.id){if(kind==='rows'&&o.numbering==='renumber')row.xfFormat=clone(target.xfFormat);if(JSON.stringify(row.cnSourceFormat||source.cnFormat)!==JSON.stringify(target.cnFormat)){const identity=cnKey(row,source.cnFormat).match(/^number:(\d+)([A-Z]*)$/);if(identity){row.cn=M.formatId(row.cnNumber??identity[1],target.cnFormat)+identity[2];row.cnNumber=identity[2]?null:(row.cnNumber??identity[1]);if(row.cnNumber==null)row.cnSourceFormat=clone(target.cnFormat);else delete row.cnSourceFormat;}}}dest[kind].push(row);
  }
 }}
 if(o.numbering==='renumber')for(const [kind,next,start]of [['rows','nextSequence','start'],['mtRows','nextMtSequence','mtStart']]){const rows=out.lists.filter(l=>l.jobId===source.id).flatMap(l=>l[kind]).sort((a,b)=>a.sequence-b.sequence);let n=source[start];for(const row of rows)row.sequence=n++;source[next]=n;}
 for(const l of lists){l.history=[];l.revision++;for(const kind of ['rows','mtRows'])l[kind].sort((a,b)=>a.sequence-b.sequence);}
 sync(out);validate(out);
 const summaries=[];for(const jobId of affected){const j=jobOf(out,jobId),old=jobOf(lib,jobId),range=(library,kind)=>{const ns=library.lists.filter(l=>l.jobId===jobId).flatMap(l=>l[kind].map(r=>r.sequence));return ns.length?Math.min(...ns)+'–'+Math.max(...ns):'none';};summaries.push({jobId,name:j.name,lsd:j.lsd,xf:range(lib,'rows')+' → '+range(out,'rows'),mt:range(lib,'mtRows')+' → '+range(out,'mtRows'),nextXF:old.nextSequence+' → '+j.nextSequence,nextMT:old.nextMtSequence+' → '+j.nextMtSequence});}
 return {library:out,duplicates:[...duplicates.values()],summaries,xf:moved.rows.length,mt:moved.mtRows.length};
}
return {searchCNs,bulkCNs,duplicateCNs,localDate,empty,validate,createJob,createDailyList,workingList,mutate,updateJob,removeList,removeJob,select,fromLegacy};
});
