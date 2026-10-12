(function(root){
'use strict';
const M=root.ShotNotesModel,P=root.ShotNotesParser,S=root.ShotNotesStorage,J=root.ShotNotesJobs;
let saveFailed=false;
let voice={available:false},voicePending='',voiceInput='phone',voiceSaved=true;
let voiceRecoveryFailed=false;
function hasSavedVoice(){if(!voice.id||deletedList(voice.listId)||deletedList('voice-session:'+voice.id))return true;if(voiceRecoveryFailed)return false;const target=library.lists.find(l=>l.id===voice.listId);return !!target&&(voiceBusy()||!!target.voiceTranscripts?.some(s=>s.id===voice.id&&s.text===voice.events.map(e=>e.text).join('\n')));}
let feedback=null,manualOpen=false,rememberApproved=false;
const pipeOpen=new Map(),latestPipes=new Map();
const voiceBusy=()=>['requesting','permission','preparing','listening','stopping'].includes(voice.state);
let recordingMode='hold',heldInput=null;
try{if(localStorage.getItem('shottime.recordingMode')==='continuous')recordingMode='continuous';}catch{}
function releaseHold(){
 if(heldInput===null)return;
 heldInput=null;location.href='shottime://voice/stop';
 voice={...voice,state:'stopping'};micLevels.fill(0);render();
}
function beginHold(input){
 if(heldInput!==null||voiceBusy())return;
 heldInput=input;
 try{toggleVoice();}catch(e){heldInput=null;throw e;}
}
window.addEventListener('pointerup',e=>{if(heldInput===e.pointerId)releaseHold();},true);
window.addEventListener('pointercancel',e=>{if(heldInput===e.pointerId)releaseHold();},true);
window.addEventListener('keyup',e=>{if(heldInput===e.code){e.preventDefault();releaseHold();}},true);
window.addEventListener('blur',releaseHold);
window.addEventListener('pagehide',releaseHold);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseHold();});
const micLevels=Array(40).fill(0);let micTimer;
function paintLevel(){const bars=document.querySelectorAll('#notes-microphone .notes-wave-bar');bars.forEach((bar,i)=>bar.style.height=(2+micLevels[i]*82)+'%');}
function receiveLevel(level){
 clearTimeout(micTimer);
 if(voice.state!=='listening'||document.hidden){micLevels.fill(0);paintLevel();return;}
 level=typeof level==='number'&&Number.isFinite(level)?Math.max(0,Math.min(1,level)):0;
 micLevels.shift();micLevels.push(level);paintLevel();
 micTimer=setTimeout(()=>{micLevels.fill(0);paintLevel();},450);
}
function receiveVoice(json){
 try{
  voice=JSON.parse(json);if(host&&voice.id&&deletedList('voice-session:'+voice.id)){voiceSaved=true;voicePending='';render();return;}if(voice.state!=='listening'){clearTimeout(micTimer);micLevels.fill(0);}if(!host)return;
  const target=library.lists.find(l=>l.id===voice.listId);
  if(target){
   let result;const updated=J.mutate(library,target.id,list=>{result=root.ShotNotesVoice.reconcile(list,voice,(text,context)=>root.ShotNotesLearning.suggest(storage,text,context),(before,after)=>{if(J.duplicateCNs(library,before,after).length){const error=Error('Duplicate CN# already exists in this job. Confirm before adding.');error.duplicateCN=true;throw error;}});return result.list;});voicePending=result.pending;
   let changed=result.changed;
   if(!voiceBusy()&&voice.id){
    const saved=result.list.voiceTranscripts||[];
    if(!saved.some(s=>s.id===voice.id)){saved.push({id:voice.id,text:voice.events.map(e=>e.text).join('\n')});updated.lists.find(l=>l.id===target.id).voiceTranscripts=saved.slice(-5);changed=true;}
   }
   if(changed){recordFeedback(target,result.list);}
   if(changed)library=updated;
   // Keep the active session bound to its original list after Activity recreation.
   if(voiceBusy()&&library.selectedListId!==target.id){library.selectedListId=target.id;library.selectedJobId=target.jobId;changed=true;}
   voiceRecoveryFailed=false;voiceSaved=!dirty&&hasSavedVoice();
   if(changed||dirty)voiceSaved=persist();
  }else voiceSaved=!voice.id||deletedList(voice.listId);
  if(voiceBusy())closeDialog();render();
 }catch(e){voiceRecoveryFailed=true;voiceSaved=false;recoveryVisibility(true);render();message('Voice transcript needs recovery: '+e.message,true);}
}
function toggleVoice(){
 if(voiceBusy()){location.href='shottime://voice/stop';return;}
 if(!voice.available||!voiceSaved||!persist())throw Error('Save the current notes before recording.');
 const list=current();if(list.pending.length)throw Error('Resolve the pending instructions before starting a new recording.');
 const previous=voice.id||'';voice={...voice,state:'requesting',notice:'',message:'Waiting for microphone permission…'};render();
 // Welder IDs already on this list (most recent first) prime Whisper to spell them the same way.
 const ids=[...new Set([list.context.welder,...list.rows.map(r=>r.welder).reverse()].filter(w=>/^[A-Z0-9-]{1,12}$/.test(w||'')))].slice(0,20).join(',');
 location.href='shottime://voice/start?list='+encodeURIComponent(list.id)+'&previous='+encodeURIComponent(previous)+'&input='+voiceInput+(ids?'&ids='+encodeURIComponent(ids):'')+(recordingMode==='hold'?'&hold=1':'');
}
function csvSpacingButton(){const list=current(),b=button('',()=>{ensureSaved();const live=current();if(!live||live.id!==list.id)throw Error('Open this list again before changing CSV spacing.');live.csvSpoolSpacing=!live.csvSpoolSpacing;persist();paint();});function paint(){b.textContent='CSV spacing: '+(current().csvSpoolSpacing?'On':'Off');b.setAttribute('aria-pressed',String(!!current().csvSpoolSpacing));}b.id='notes-csv-spacing';b.setAttribute('aria-label','Blank CSV row between spools');b.title='Add one blank CSV row between spools';paint();return b;}
function voiceSettings(){
 const f=openDialog('Note Taker settings');modal.classList.add('notes-settings-dialog');
 f.append(el('h3',{},'Recording'));
 const modes=el('div',{class:'notes-record-modes',role:'group','aria-label':'Recording mode'});
 for(const [value,label]of [['hold','Hold to speak'],['continuous','Continuous recording']]){const choice=button(label,()=>{if(voiceBusy())return;storage.setItem('shottime.recordingMode',value);recordingMode=value;for(const b of modes.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===choice));render();});choice.setAttribute('aria-pressed',String(recordingMode===value));choice.disabled=voiceBusy();modes.append(choice);}f.append(modes);

 const input=select(f,'Microphone',[['phone','Phone microphone'],['bluetooth','Bluetooth headset']],voiceInput);input.id='notes-voice-input';input.parentElement.querySelector('label').htmlFor=input.id;input.addEventListener('change',()=>voiceInput=input.value);
 f.append(el('p',{class:'hint'},'Phone only keeps speech on this device. Auto and Cloud use your configured online service.'),button('Voice processing',()=>{closeDialog();location.href='shottime://voice/settings';}),...(current()?[el('h3',{},'Inspection list'),button('List settings',settings),button('Change context',editContext)]:[]),el('h3',{},'CSV export'),...(current()?[csvSpacingButton()]:[]),button('Export columns',exportColumns),el('h3',{},'Saved wording'),button('Forget approved examples',()=>{const confirm=openDialog('Forget approved examples');confirm.append(el('p',{},'Remove remembered wording from this phone? Your inspection lists stay saved.'),button('Forget examples',()=>{root.ShotNotesLearning.clear(storage);closeDialog();}),button('Cancel',closeDialog));}),el('h3',{},'Backup'),button('Save backup file',()=>{backupExport();closeDialog();location.href='shottime://backup/save';}),button('Restore backup',()=>{restoreReady();closeDialog();location.href='shottime://backup/restore';}),button('Copy recovery data',()=>{closeDialog();document.getElementById('notes-backup').click();}),...(current()?[el('h3',{},'Delete'),button('Delete list',deleteList)]:[]),button('Close settings',closeDialog));
}
function recordFeedback(before,after){
 const oldXf=new Set(before.rows.map(r=>r.id)),oldMt=new Set(before.mtRows.map(r=>r.id));
 const xf=after.rows.filter(r=>!oldXf.has(r.id)),mt=after.mtRows.filter(r=>!oldMt.has(r.id));
 const cns=new Set([...xf,...mt].map(r=>r.cn)),messages=[],groups=new Map();let removed=false,updated=false;
 const summarize=ids=>ids.slice(0,8).join(', ')+(ids.length>8?' and '+(ids.length-8)+' more':'');
 for(const [previous,current,mtKind]of [[before.rows,after.rows,false],[before.mtRows,after.mtRows,true]]){
  const next=new Map(current.map(r=>[r.id,r]));
  for(const old of previous){const row=next.get(old.id),label=M.formatId(old.sequence,mtKind?before.mtFormat:old.xfFormat);
   if(!row){const key='Removed';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(label);cns.add(old.cn);removed=true;continue;}
   const fields={cn:'CN#',size:'size',schedule:'schedule',...(mtKind?{type:'description'}:{}),welder:'WID'},changes=[];
   for(const [key,name]of Object.entries(fields))if(old[key]!==row[key])changes.push(name+' '+(row[key]||'blank'));
   if(changes.length){const key=changes.join(', ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(label);cns.add(row.cn);updated=true;}
  }
 }
 if(xf.length||mt.length)messages.push('Added '+xf.length+' weld'+(xf.length===1?'':'s')+' and '+mt.length+' MT fitting'+(mt.length===1?'':'s')+' to '+[...new Set([...xf,...mt].map(r=>r.cn))].map(cn=>cn||'entries without a CN').join(', '));
 for(const [changes,ids]of groups)messages.push(changes==='Removed'?'Removed '+summarize(ids):'Updated '+summarize(ids)+': '+changes);
 if(!messages.length)return;
 feedback={listId:after.id,revision:after.revision,kind:updated?'Updated':removed?'Removed':'Added',text:messages.join('; ')};
 const latest=[...cns].at(-1);latestPipes.set(after.id,latest);for(const cn of new Set([...after.rows,...after.mtRows].map(r=>r.cn)))pipeOpen.set(after.id+'|'+cn,cn===latest);
}
function renderVoice(list){
 const panel=el('section',{class:'notes-recorder','aria-label':'Voice recording'});
 let label=voice.state==='listening'?'Listening':voice.state==='stopping'?'Processing':voiceBusy()?'Preparing':list.pending.length?'Needs review':feedback?.listId===list.id&&feedback.revision===list.revision&&!dirty?(feedback.kind||'Added'):'Ready';
 panel.dataset.state=label.toLowerCase().replace(' ','-');
 const state=el('div',{class:'notes-record-heading'});state.append(el('span',{class:'notes-state',role:'status'},label),el('span',{class:'notes-mode'},(voice.processingMode||'phone')==='phone'?'On this phone':'Online voice'));panel.append(state);
 const mic=button(voiceBusy()?(voice.state==='stopping'?'Processing…':heldInput!==null?'Release to finish':'Stop recording'):(recordingMode==='hold'?'Hold to speak':'Start recording'),()=>{if(recordingMode==='continuous'||voiceBusy()&&heldInput===null)toggleVoice();},true);mic.id='notes-microphone';mic.disabled=!voice.available||['stopping','permission','requesting'].includes(voice.state)||(!voiceBusy()&&(!voiceSaved||dirty||list.pending.length>0));mic.classList.add('notes-microphone');
 if(recordingMode==='hold'){
 mic.classList.add('notes-hold');
 mic.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary||mic.disabled||voiceBusy())return;e.preventDefault();document.documentElement.setPointerCapture(e.pointerId);guard(()=>beginHold(e.pointerId));});
 mic.addEventListener('keydown',e=>{if(!['Space','Enter'].includes(e.code)||e.repeat||mic.disabled||voiceBusy())return;e.preventDefault();guard(()=>beginHold(e.code));});
 mic.addEventListener('contextmenu',e=>e.preventDefault());
 }
 const caption=el('span',{class:'notes-mic-label'},mic.textContent);mic.textContent='';
 if(voice.state==='listening'){const wave=el('span',{class:'notes-wave','aria-hidden':'true'});for(const level of micLevels){const bar=el('span',{class:'notes-wave-bar'});bar.style.height=(2+level*82)+'%';wave.append(bar);}mic.append(wave);}
 const micIcon=el('span',{class:'notes-mic-icon','aria-hidden':'true'});micIcon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6"/></svg>';
 mic.append(micIcon,caption);mic.setAttribute('aria-describedby','notes-voice-status');const dock=el('div',{class:'notes-recorder-dock'});dock.append(mic);
 const hint=voice.notice||(['error','interrupted'].includes(voice.state)?voice.message:'')||(voice.state==='stopping'?'Finishing captured speech. Your rows will appear below.':voice.state==='listening'?(heldInput!==null?'Keep holding while you speak. Release to finish.':'Speak naturally. Tap Stop when this spool is finished.'):voiceBusy()?'Wait for Listening before speaking.':list.pending.length?'Resolve the instruction below to continue recording.':voice.available?(recordingMode==='hold'?'Hold the button, wait for Listening, then speak. Release to finish.':'Record a spool, then check what was added below.'):'Recording is available in the Android app. You can type or add entries manually here.');
 panel.append(el('p',{id:'notes-voice-status',class:'hint'},hint));
 if(voicePending&&voice.listId===list.id)panel.append(el('div',{id:'notes-voice-pending',class:'notes-live'},elText(voice.deferred?'Heard · review after Stop':'Heard · finishing this spool',voicePending)));
 if(voice.id&&!voiceSaved)panel.append(el('p',{class:'error'},'Transcript not safely saved. Retry saving before recording again.'));
 const text=voice.listId===list.id&&voice.events?.length?voice.events.map(e=>e.text).join('\n'):(list.voiceTranscripts||[]).at(-1)?.text;
 if(text){const detail=el('details',{class:'notes-transcript'});detail.append(el('summary',{},'Recognized speech'),el('p',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},text));panel.append(detail);}
 host.append(panel,dock);
}
function elText(title,text){return title+'\n'+text;}
function addManually(){const f=openDialog('Add manually');f.append(button('Add welds',()=>editWeld()),button('Add MT fitting',()=>editMt()),button('Cancel',closeDialog));}
function lockVoiceControls(){if(!voiceBusy())return;for(const control of host.querySelectorAll('button,input,textarea,select'))if(control.id!=='notes-microphone')control.disabled=true;}
let library,host,status,storage,blocked=false,rawBackup=null,modal=null,lastFocus=null,editingReview=null,dirty=false;
const deletedList=id=>(library.deletedLists||[]).includes(id);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const el=(tag,props={},text)=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(props)){if(k==='class')n.className=v;else if(k==='hidden')n.hidden=v;else n.setAttribute(k,v);}if(text!==undefined)n.textContent=text;return n;};
function button(text,action,primary=false){const b=el('button',{type:'button',class:primary?'primary':'secondary'},text);b.addEventListener('click',()=>guard(action));return b;}
function guard(fn){try{return fn();}catch(e){message(e.message,true);}}
function message(text,error=false){const target=modal?modal.querySelector('[role="alert"]'):document.getElementById('notes-message');if(target){target.textContent=text;target.className=error?'error':'hint';}}
function current(){return library.lists.find(l=>l.id===library.selectedListId);}
// Notes share the WebView's ~5 million character storage with the calculator; warn well before it fills.
const STORAGE_CHARS=5000000;
function savedStatus(){const used=JSON.stringify(library).length/STORAGE_CHARS;return used>=.7?'Saved on this device · notes storage '+Math.round(used*100)+'% full. Share and delete old lists.':'Saved on this device';}
let draftTimer=null;
function persistSoon(){dirty=true;clearTimeout(draftTimer);draftTimer=setTimeout(persist,500);}
function flush(){return dirty?persist():true;}
function recoveryVisibility(failed){const panel=document.querySelector('.notes-recovery');if(panel){panel.hidden=!failed;panel.open=failed;}}
function persist(){clearTimeout(draftTimer);dirty=true;if(blocked){status.textContent='Not saved: saved data needs recovery.';recoveryVisibility(true);return false;}try{S.save(storage,library);dirty=false;saveFailed=false;voiceSaved=hasSavedVoice();status.textContent=savedStatus();recoveryVisibility(!voiceSaved);return true;}catch(e){saveFailed=true;status.textContent='Not saved — keep the app open. Retry saving or export your data.';recoveryVisibility(true);return false;}}
function ensureSaved(){if(saveFailed)throw Error('Retry saving or export recovery data before making more changes.');}
function prepared(list){ensureSaved();return J.workingList(library,list.id);}
function applyList(list,command){return M.apply(prepared(list),command);}
function applyListGroup(list,commands,id){return M.applyGroup(prepared(list),commands,id);}
function undoList(list){return M.undo(prepared(list));}
function duplicateDialog(matches,accept,cancel){const f=openDialog('Duplicate CN#');f.append(el('p',{},'These CN numbers already exist in this job:'),...matches.map(m=>el('p',{},m.cn+' - Daily lists: '+m.dates.join(', '))),el('p',{},'Add these entries anyway?'));f.append(button('Add anyway',accept,true),button('Cancel',cancel));}
function replaceList(list,confirmed=false,onAdded,options={}){ensureSaved();const before=library.lists.find(l=>l.id===list.id),matches=J.duplicateCNs(library,before,list,options);
 if(!confirmed&&matches.length){if(before.pending[0]?.duplicateCN)dismissedDuplicates.add(before.pending[0].id);const baseline=JSON.stringify(library);duplicateDialog(matches,()=>{if(JSON.stringify(library)!==baseline){closeDialog();render();message('Notes changed. Review and submit the entry again.',true);return;}replaceList(list,true,onAdded);closeDialog();},()=>{closeDialog();render();});return;}
 library=J.mutate(library,list.id,()=>list);if(before)recordFeedback(before,list);persist();render();if(onAdded)onAdded();
}
const dismissedDuplicates=new Set();
function duplicateCommands(list,item){if(item.reviewMode!=='wording'&&item.fieldsDraft?.mode==='fields')return P.reviewCommands(item.fieldsDraft,list.fieldRequirements);const parsed=P.parse(item.correctionDraft??item.text,list.context,list.rows,list.fieldRequirements,list.mtRows);if(parsed.review.length)throw Error('Review this instruction before adding.');return parsed.commands;}
function offerVoiceDuplicate(list){
 const item=list.pending[0];if(modal||voiceBusy()||document.getElementById('note-taker').hidden||!item?.duplicateCN||dismissedDuplicates.has(item.id))return;
 let commands;try{commands=duplicateCommands(list,item);}catch{return;}
 const candidate=applyListGroup(list,commands,item.id),matches=J.duplicateCNs(library,list,candidate);if(!matches.length)return;
 dismissedDuplicates.add(item.id);
 duplicateDialog(matches,()=>{const live=current();if(!live||live.id!==list.id||live.pending[0]?.id!==item.id)throw Error('Notes changed. Review the pending instruction again.');let next=applyListGroup(live,duplicateCommands(live,live.pending[0]),item.id);next.pending=next.pending.filter(p=>p.id!==item.id);next.draft='';editingReview=null;closeDialog();replaceList(next,true);},()=>{closeDialog();message('Entry was not added. Edit or dismiss the pending instruction.');});
}
function navigate(jobId,listId=null){if(voiceBusy())throw Error('Stop recording before changing lists.');if(!flush())throw Error('Save the current notes before changing lists.');stopCNSelection();library=J.select(library,jobId,listId);editingReview=null;manualOpen=false;persist();render();}
function currentJob(){return library.jobs.find(j=>j.id===library.selectedJobId);}

function field(parent,label,value='',type='text'){const id='notes-field-'+uid(),wrap=el('div',{class:'notes-field'}),input=el(type==='textarea'?'textarea':'input',{id,type:type==='textarea'?'text':type});if(type==='textarea')input.removeAttribute('type');input.value=value;if(type==='text')input.maxLength=160;wrap.append(el('label',{for:id},label),input);parent.append(wrap);return input;}
function select(parent,label,values,value){const wrap=el('div',{class:'notes-field'}),id='notes-field-'+uid(),input=el('select',{id});wrap.append(el('label',{for:id},label),input);for(const [v,t]of values)input.append(el('option',{value:v},t));input.value=value;parent.append(wrap);return input;}
function openDialog(title){closeDialog();lastFocus=document.activeElement;modal=el('dialog',{class:'notes-dialog','aria-labelledby':'notes-dialog-title'});modal.append(el('h2',{id:'notes-dialog-title'},title));modal.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});document.body.append(modal);const form=el('form');modal.append(form,el('p',{role:'alert',class:'error'}));modal.showModal();return form;}
function closeDialog(){if(!modal)return;if(modal.dataset.cnSearch==='true')stopCNSelection();modal.close();modal.remove();modal=null;if(lastFocus&&lastFocus.isConnected)lastFocus.focus();}
function actions(form,label,submit,cancel='Cancel'){const bar=el('div',{class:'notes-actions'}),save=el('button',{type:'submit',class:'primary'},label);bar.append(save,button(cancel,closeDialog));form.append(bar);form.addEventListener('submit',e=>{e.preventDefault();guard(submit);});setTimeout(()=>form.querySelector('input,textarea,button')?.focus(),0);}
function formats(form,list){const grid=el('div',{class:'notes-grid'});form.append(grid);const cn=list?.cnFormat||{prefix:'CN',separator:'-',width:0},xf=list?.xfFormat||{prefix:'XF',separator:'-',width:0};const cp=field(grid,'CN prefix',cn.prefix),cs=field(grid,'CN separator',cn.separator),cw=field(grid,'CN minimum digits',cn.width,'number'),xp=field(grid,'XF prefix',xf.prefix),xs=field(grid,'XF separator',xf.separator),xw=field(grid,'XF minimum digits',xf.width,'number');for(const input of [cw,xw]){input.min=0;input.max=12;input.step=1;}return ()=>({cnFormat:{prefix:cp.value,separator:cs.value,width:Number(cw.value)},xfFormat:{prefix:xp.value,separator:xs.value,width:Number(xw.value)}});}
function requiredFields(form,list){
 const saved=list?.fieldRequirements??null,rules=M.requirements(saved);let changed=false;
 const section=el('details',{class:'notes-required-fields'});section.append(el('summary',{},'Required information for this job'),el('p',{class:'hint'},'XF and MT numbers are always assigned automatically. Checked fields must be supplied. Unchecked fields are optional; omitted values stay blank. Quantity is always needed.'));
 for(const kind of ['xf','mt']){const group=el('fieldset');group.append(el('legend',{},kind==='xf'?'XF welds':'MT fittings'));for(const [key,label]of Object.entries({cn:'CN#',welder:'WID',size:'Size',schedule:'Schedule',...(kind==='mt'?{type:'Description'}:{})})){const wrap=el('label',{class:'notes-remember'}),check=el('input',{type:'checkbox','aria-label':kind.toUpperCase()+' '+label+' required'});check.checked=rules[kind][key];check.addEventListener('change',()=>{changed=true;rules[kind][key]=check.checked;});wrap.append(check,document.createTextNode(label));group.append(wrap);}section.append(group);}form.append(section);section.addEventListener('toggle',()=>{if(section.open)changed=true;});return ()=>changed||!list?rules:saved;
}
function listsByDate(){
 const f=openDialog('Lists by date'),date=field(f,'List date',J.localDate(),'date'),results=el('div',{class:'notes-date-results','aria-live':'polite'});date.required=true;
 const controls=el('div',{class:'notes-actions'}),show=el('button',{type:'submit',class:'primary'},'Show lists');controls.append(show,button('Close',closeDialog));f.append(controls,results);
 function search(){
  results.replaceChildren();const matches=library.lists.filter(l=>l.date===date.value).sort((a,b)=>{const ja=library.jobs.find(j=>j.id===a.jobId),jb=library.jobs.find(j=>j.id===b.jobId);return ja.name.localeCompare(jb.name)||ja.lsd.localeCompare(jb.lsd);});
  results.append(el('p',{class:'notes-search-summary'},matches.length+' daily '+(matches.length===1?'list':'lists')+' on '+date.value));
  if(!matches.length)results.append(el('p',{class:'notes-empty'},'No daily lists for this date. Choose another day.'));
  for(const list of matches){const job=library.jobs.find(j=>j.id===list.jobId),siblings=library.lists.filter(l=>l.jobId===job.id&&l.date===list.date),label=list.date+(siblings.length>1?' - List '+(siblings.findIndex(l=>l.id===list.id)+1):''),b=button('',()=>{navigate(job.id,list.id);closeDialog();});b.classList.add('notes-list-button','notes-job-card');b.dataset.dateListId=list.id;b.append(el('span',{class:'notes-job-client'},job.name),el('span',{class:'notes-job-detail'},job.lsd),el('span',{class:'notes-job-detail'},label+' - '+list.rows.length+' '+(list.rows.length===1?'weld':'welds')+' / '+list.mtRows.length+' MT'));results.append(b);}
 }
 f.addEventListener('submit',e=>{e.preventDefault();guard(search);});date.addEventListener('input',()=>results.replaceChildren());search();
}
function renderJobs(){
 const header=el('div',{class:'notes-jobs-header'}),heading=el('div');heading.append(el('h2',{},'Jobs'),el('p',{class:'notes-jobs-count'},library.jobs.length+' '+(library.jobs.length===1?'job':'jobs')));header.append(heading,button('Settings',voiceSettings));
 const actions=el('div',{class:'notes-jobs-actions'});actions.append(button('Create job',newJob,true),button('Lists by date',listsByDate));host.append(header,actions);
 if(!library.jobs.length)host.append(el('div',{class:'notes-empty'},'Create your first job, then add a daily list.'));
 const cards=el('div',{class:'notes-job-cards'});for(const job of [...library.jobs].reverse()){
  const b=button('',()=>navigate(job.id));b.classList.add('notes-list-button','notes-job-card');b.dataset.jobId=job.id;b.setAttribute('aria-label',job.name+' - '+job.lsd+' - '+job.startDate);b.append(el('span',{class:'notes-job-client'},job.name),el('span',{class:'notes-job-detail'},job.lsd),el('span',{class:'notes-job-start'},'Start date: '+job.startDate));cards.append(b);
 }host.append(cards);
}
function renderDailyLists(job){
 const lists=library.lists.filter(l=>l.jobId===job.id),header=el('div',{class:'notes-jobs-header'}),heading=el('div');heading.append(el('h2',{},job.name),el('p',{class:'notes-job-detail'},job.lsd));header.append(heading,button('Job settings',jobSettings));host.append(header,el('p',{class:'notes-context'},'Next '+M.formatId(job.nextSequence,job.xfFormat)+' / '+M.formatId(job.nextMtSequence,job.mtFormat)));
 const actions=el('div',{class:'notes-jobs-actions'});actions.append(button('Add daily list',newList,true),button('Search CN#',searchCNs));host.append(actions,el('p',{class:'notes-search-summary'},lists.length+' daily '+(lists.length===1?'list':'lists')));
 if(!lists.length)host.append(el('div',{class:'notes-empty'},'Add a daily list to start recording spools.'));
 const cards=el('div',{class:'notes-job-cards'});for(const list of [...lists].sort((a,b)=>b.date.localeCompare(a.date))){
  const same=lists.filter(l=>l.date===list.date),label=list.date+(same.length>1?' - List '+(same.findIndex(l=>l.id===list.id)+1):''),b=button('',()=>navigate(job.id,list.id));b.classList.add('notes-list-button','notes-job-card');b.dataset.dailyListId=list.id;b.append(el('span',{class:'notes-job-client'},label),el('span',{class:'notes-job-detail'},list.rows.length+' '+(list.rows.length===1?'weld':'welds')+' / '+list.mtRows.length+' MT'));cards.append(b);
 }host.append(cards);
}
function newJob(){ensureSaved();const f=openDialog('New job'),name=field(f,'Client name'),startDate=field(f,'Start date',J.localDate(),'date'),lsd=field(f,'LSD'),start=field(f,'Starting XF number','1'),mtStart=field(f,'Starting MT number','1'),ff=formats(f),readRequired=requiredFields(f);start.inputMode=mtStart.inputMode='numeric';actions(f,'Save job',()=>{ensureSaved();const chosen=ff();if(/^0\d+$/.test(start.value))chosen.xfFormat.width=Math.max(chosen.xfFormat.width,start.value.length);library=J.createJob(library,{id:uid(),name:name.value,startDate:startDate.value,lsd:lsd.value,start:start.value,mtStart:mtStart.value,fieldRequirements:readRequired(),...chosen});persist();closeDialog();render();});}
function newList(){ensureSaved();const job=currentJob(),f=openDialog('New daily list'),today=new Date(),localDate=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0'),date=field(f,'Date',localDate,'date');f.append(el('p',{class:'hint'},'Continues '+M.formatId(job.nextSequence,job.xfFormat)+' / '+M.formatId(job.nextMtSequence,job.mtFormat)+'. New daily lists start with a blank spool and welder.'));actions(f,'Create daily list',()=>{ensureSaved();library=J.createDailyList(library,job.id,{id:uid(),date:date.value});editingReview=null;manualOpen=false;persist();closeDialog();render();});}
function deleteList(){const list=current();if(voiceBusy())throw Error('Stop recording before deleting this list.');const f=openDialog('Delete list?');f.append(el('p',{},'Delete '+list.date+' — '+list.lsd+' and its '+list.rows.length+' welds and '+list.mtRows.length+' MT fittings? Job numbering will keep its place. This cannot be undone.'),button('Delete list',()=>{ensureSaved();library=J.removeList(library,list.id);editingReview=null;closeDialog();const saved=persist();render();if(saved)message('List deleted.');}),button('Cancel',closeDialog));}
function deleteJob(){const job=currentJob();if(voiceBusy())throw Error('Stop recording before deleting this job.');const lists=library.lists.filter(l=>l.jobId===job.id),f=openDialog('Delete job?');f.append(el('p',{},'Delete '+job.name+' and all '+lists.length+' daily lists ('+lists.reduce((n,l)=>n+l.rows.length,0)+' welds, '+lists.reduce((n,l)=>n+l.mtRows.length,0)+' MT)? This cannot be undone. Export any lists you need first.'),button('Delete job',()=>{ensureSaved();library=J.removeJob(library,job.id);editingReview=null;closeDialog();persist();render();}),button('Cancel',closeDialog));}
function jobSettings(){const job=currentJob(),f=openDialog('Job settings'),name=field(f,'Client name',job.name),startDate=field(f,'Start date',job.startDate,'date'),lsd=field(f,'LSD',job.lsd),start=field(f,'Starting XF number',M.formatId(job.start,{...job.xfFormat,prefix:'',separator:''})),mtStart=field(f,'Starting MT number',M.formatId(job.mtStart,{...job.mtFormat,prefix:'',separator:''}));start.disabled=job.nextSequence!==job.start;mtStart.disabled=job.nextMtSequence!==job.mtStart;const ff=formats(f,job),scope=select(f,'Apply formats to',[['new','New rows in this job'],['all','Existing and new rows in this job']],'new'),readRequired=requiredFields(f,job);f.append(el('p',{class:'hint'},'Required information defaults apply to new daily lists. Existing lists retain their settings.'));actions(f,'Save job settings',()=>{ensureSaved();const chosen=ff();if(!start.disabled&&/^0\d+$/.test(start.value))chosen.xfFormat.width=Math.max(chosen.xfFormat.width,start.value.length);library=J.updateJob(library,job.id,{name:name.value,startDate:startDate.value,lsd:lsd.value,start:start.value,mtStart:mtStart.value,...chosen,fieldRequirements:readRequired()},{existing:scope.value==='all'});closeDialog();persist();render();});const footer=el('div',{class:'notes-job-footer'});footer.append(button('Delete job',deleteJob));f.append(footer);}
function settings(){const list=current(),f=openDialog('List settings'),date=field(f,'Date',list.date,'date'),readRequired=requiredFields(f,list);f.append(el('p',{class:'hint'},'Numbering and identifier formats are managed in Job settings.'));actions(f,'Save settings',()=>{const required=readRequired(),commands=[{type:'metadata',date:date.value,lsd:currentJob().lsd}];if(JSON.stringify(required)!==JSON.stringify(list.fieldRequirements))commands.push({type:'fieldRequirements',value:required});const next=applyListGroup(list,commands,uid());closeDialog();replaceList(next);});}

function editContext(){const list=current(),f=openDialog('Current spool and welder'),cn=field(f,'Current CN',list.context.cn),welder=field(f,'Current welder',list.context.welder);actions(f,'Save context',()=>{const next=applyList(list,{id:uid(),type:'setContext',cn:cn.value,welder:welder.value});closeDialog();replaceList(next);});}
function editWeld(row){const list=current(),rules=M.requirements(list.fieldRequirements).xf,f=openDialog(row?'Edit '+M.formatId(row.sequence,row.xfFormat):'Add welds'),count=row?null:field(f,'Quantity','1','number'),cn=field(f,'CN',row?row.cn:(!list.fieldRequirements||rules.cn?list.context.cn:'')),wid=field(f,'Welder ID',row?row.welder:(!list.fieldRequirements||rules.welder?list.context.welder:'')),size=field(f,'Weld size',row?row.size:''),schedule=field(f,'Weld schedule',row?row.schedule:(rules.schedule?'STD':''));if(count){count.min=1;count.max=1000;count.step=1;}actions(f,row?'Save weld':'Save welds',()=>{const data={cn:cn.value,welder:wid.value,size:size.value,schedule:schedule.value};const next=applyList(list,row?{id:uid(),type:'updateRows',rowIds:[row.id],patch:data}:{id:uid(),type:'addBatch',...data,count:Number(count.value)});closeDialog();replaceList(next);});}
function editMt(row){const list=current(),rules=M.requirements(list.fieldRequirements).mt;if(list.pending.length)throw Error('Resolve pending instructions before editing MT fittings.');const f=openDialog(row?'Edit '+M.formatId(row.sequence,list.mtFormat):'Add MT fitting'),count=row?null:field(f,'Quantity','1','number'),cn=field(f,'CN',row?row.cn:(!list.fieldRequirements||rules.cn?list.context.cn:'')),wid=field(f,'WID',row?row.welder:(!list.fieldRequirements||rules.welder?list.context.welder:'')),size=field(f,'MT size',row?row.size:''),schedule=field(f,'MT schedule',row?row.schedule:''),type=select(f,'Description',[['','Not specified'],...M.FITTING_TYPES.map(type=>[type,type])],row?row.type:(rules.type?'TOL':''));schedule.placeholder='Optional: STD, 80, 3M, 6M, 9M';if(count){count.min=1;count.max=1000;count.step=1;}actions(f,row?'Save MT fitting':'Save MT fittings',()=>{const data={cn:cn.value,welder:wid.value,size:size.value,schedule:schedule.value.trim(),fittingType:type.value};const next=applyList(list,row?{id:uid(),type:'updateMt',rowId:row.id,patch:data}:{id:uid(),type:'addMt',...data,count:Number(count.value)});closeDialog();replaceList(next);});}
function deleteMt(row){if(current().pending.length)throw Error('Resolve pending instructions before deleting MT fittings.');const f=openDialog('Delete '+M.formatId(row.sequence,current().mtFormat)+'?');f.append(el('p',{},'Later MT numbers will stay unchanged.'),button('Delete MT fitting',()=>{const next=applyList(current(),{id:uid(),type:'deleteMt',rowId:row.id});closeDialog();replaceList(next);}),button('Cancel',closeDialog));}
function deleteWeld(row){const f=openDialog('Delete '+M.formatId(row.sequence,row.xfFormat)+'?');f.append(el('p',{},'Later numbers stay unchanged. Deleted numbers are not reused within this job.'));const run=renumber=>{const next=applyList(current(),{id:uid(),type:'deleteRows',rowIds:[row.id],renumber});closeDialog();replaceList(next);};f.append(button('Keep XF numbers',()=>run(false)),button('Cancel',closeDialog));}
function exportText(text,label='Excel rows',title='Export rows'){const f=openDialog(title);f.append(el('p',{},label==='Excel rows'?'Copy this text, then paste into the first cell of your Excel report. Five columns, without headers. Leading apostrophes protect formula-like values and leading zeroes.':'Copy this recovery data to a safe file.'));const area=field(f,label,text,'textarea');area.readOnly=true;area.rows=12;f.append(button(title==='Export rows'?'Close export':'Close recovery',closeDialog));setTimeout(()=>{area.focus();area.select();},0);}
const CSV_ORDER_KEY='shottime.csvColumns.v1';
function readExportOrder(){try{return S.exportOrder(JSON.parse(storage.getItem(CSV_ORDER_KEY)));}catch{return S.exportOrder();}}
function exportColumns(){
 const f=openDialog('Export columns');let order=readExportOrder();
 f.append(el('p',{class:'hint'},'Arrange columns from left to right. Saved for every list on this phone. Add blank columns as spacers (up to 20 per table). Sizes export as numbers without inch marks.'));
 const sections=el('div');f.append(sections);
 function paint(focus){sections.replaceChildren();for(const kind of ['xf','mt']){sections.append(el('h3',{},kind.toUpperCase()+' table'));const preview=el('p',{class:'hint','data-csv-preview':kind,'aria-live':'polite'},order[kind].map(k=>S.CSV_COLUMNS[kind][k]||'Blank column').join(' → '));sections.append(preview);order[kind].forEach((key,i)=>{const row=el('div',{class:'notes-compact-row'}),label=S.CSV_COLUMNS[kind][key]||'Blank column '+order[kind].slice(0,i+1).filter(k=>k==='spacer').length,controls=el('div',{class:'notes-row-actions'});row.append(el('div',{},label));for(const [direction,delta]of [['up',-1],['down',1]]){const b=button(direction==='up'?'↑':'↓',()=>{const next=i+delta;[order[kind][i],order[kind][next]]=[order[kind][next],order[kind][i]];paint(kind+'-'+next+'-'+direction);});b.setAttribute('aria-label','Move '+kind.toUpperCase()+' '+label+' '+direction);b.style.minWidth='44px';b.dataset.csvMove=kind+'-'+i+'-'+direction;b.disabled=i+delta<0||i+delta>=order[kind].length;controls.append(b);}if(key==='spacer'){const remove=button('Remove',()=>{order[kind].splice(i,1);paint();});remove.setAttribute('aria-label','Remove '+kind.toUpperCase()+' '+label);controls.append(remove);}row.append(controls);sections.append(row);});const add=button('Add blank column',()=>{order[kind].push('spacer');paint();});add.setAttribute('aria-label','Add '+kind.toUpperCase()+' blank column');add.disabled=order[kind].length>=25;sections.append(add);}if(focus){const target=sections.querySelector('[data-csv-move="'+focus+'"]');(target?.disabled?target.parentElement.querySelector('button:not(:disabled)'):target)?.focus();}}
 paint();f.append(button('Reset to default order',()=>{order=S.exportOrder();paint();}));actions(f,'Save column order',()=>{try{storage.setItem(CSV_ORDER_KEY,JSON.stringify(S.exportOrder(order)));}catch{throw Error('Could not save column order. Keep this screen open and try again.');}closeDialog();message('CSV column order saved.');});
}
function csvExport(){const list=current();if(!list||!list.rows.length&&!list.mtRows.length)throw Error('Add welds or MT fittings before exporting.');return {name:(list.date+'_'+list.lsd).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)+'.csv',text:S.toCSV(list.rows,list.mtRows,list.mtFormat,readExportOrder(),!!list.csvSpoolSpacing)};}
function shareCSV(){csvExport();location.href='shottime://share-csv';}
function submitInstruction(){const list=current(),text=list.draft.trim();if(!text)throw Error('Enter a batch instruction.');if(list.pending.length&&!editingReview)throw Error('Resolve or dismiss the earlier instruction first so XF numbering stays in order.');if(editingReview&&list.pending[0]?.id!==editingReview)throw Error('Resolve the first pending instruction before later ones.');const approvedReview=editingReview?list.pending.find(p=>p.id===editingReview):null,remember=!!document.getElementById('remember-approved')?.checked,priorContext={...list.context};const result=P.parse(text,list.context,list.rows,list.fieldRequirements,list.mtRows);if(result.review.length){const id=editingReview||uid(),item={id,text,source:approvedReview?.source||approvedReview?.text,reason:result.review[0].reason,correctionDraft:text,reviewMode:approvedReview?.reviewMode};if(list.pending.some(p=>p.id===id))list.pending=list.pending.map(p=>p.id===id?item:p);else list.pending.push(item);editingReview=id;list.draft=text;persist();render();return;}
let next;if(result.commands.length===1&&result.commands[0].type==='undo'){next=undoList(list);if(editingReview)next.processedSegments.push(editingReview);}else next=applyListGroup(list,result.commands,editingReview||uid());if(editingReview)next.pending=next.pending.filter(p=>p.id!==editingReview);next.draft='';editingReview=null;manualOpen=false;rememberApproved=false;replaceList(next,false,()=>{if(remember&&approvedReview&&!dirty){root.ShotNotesLearning.remember(storage,root.ShotNotesVoice.normalize(approvedReview.source||approvedReview.text),text,priorContext,list.rows,list.fieldRequirements,list.mtRows);message('Correction added. Approved wording remembered on this phone.');}},{undo:result.commands.length===1&&result.commands[0].type==='undo'});}
function instructionForm(list,review=false){
 const form=el('form',{class:'notes-instruction-form'}),area=field(form,review?'Corrected instruction':'Batch instruction',list.draft,'textarea');area.rows=3;area.maxLength=20000;area.placeholder='Enter the spool number, quantity, size, schedule and welder';
 area.addEventListener('input',()=>{const active=current();active.draft=area.value;if(review){const pending=active.pending.find(p=>p.id===editingReview);if(pending)pending.correctionDraft=area.value;}persistSoon();});
 if(review){const label=el('label',{class:'notes-remember'}),check=el('input',{type:'checkbox',id:'remember-approved'});check.checked=rememberApproved;check.addEventListener('change',()=>rememberApproved=check.checked);label.append(check,document.createTextNode('Remember this approved wording on this phone'));form.append(label);}
 form.append(el('button',{type:'submit',class:'primary'},review?'Apply correction':'Add instruction'));form.addEventListener('submit',e=>{e.preventDefault();guard(submitInstruction);});return form;
}

function reviewFields(list,p){
 const f=el('form',{class:'notes-review-fields'}),rules=M.requirements(list.fieldRequirements);
 if(!p.fieldsDraft)p.fieldsDraft=P.reviewDraft(p.correctionDraft??p.text,list.context,list.fieldRequirements);
 const draft=p.fieldsDraft;
 if(draft.mode!=='fields'||!Array.isArray(draft.groups)||draft.groups.length>100){f.append(el('p',{},'This instruction changes existing records. Use Edit wording instead to clarify the action and its target.'));return f;}
 f.append(el('p',{class:'hint'},'Check the captured details. Amber fields need attention; blank optional fields can stay empty.'));
 draft.groups.forEach((g,index)=>{
  const group=el('fieldset',{class:'notes-review-group'});group.append(el('legend',{},'Group '+(index+1)+' · '+(g.kind==='mt'?'MT fittings':'XF welds')));const grid=el('div',{class:'notes-grid'});group.append(grid);
  const controls={};const label=k=>'Group '+(index+1)+' '+k;
  controls.kind=select(grid,label('Entry type'),[['xf','XF welds'],['mt','MT fittings']],g.kind);
  for(const [key,name]of [['cn','CN#'],['count','Quantity'],['size','Size'],['schedule','Schedule'],['welder','WID']])controls[key]=field(grid,label(name),g[key]||'');
  controls.count.inputMode='numeric';controls.size.inputMode='decimal';
  if(g.kind==='mt')controls.fittingType=select(grid,label('Fitting type'),[['','Choose type'],...M.FITTING_TYPES.map(type=>[type,type])],g.fittingType||'');
  const help={};for(const [key,input]of Object.entries(controls)){input.setAttribute('data-review-field',key);const hint=el('p',{class:'hint',id:input.id+'-help'});input.parentElement.append(hint);input.setAttribute('aria-describedby',hint.id);help[key]=hint;
   input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{g[key]=input.value;if(g.uncertain)delete g.uncertain[key];if(g.inherited)delete g.inherited[key];p.fieldError='';persistSoon();if(key==='kind')render();else paint();});}
  function paint(){const issues=P.reviewIssues(g,rules);for(const [key,input]of Object.entries(controls)){const issue=issues[key];input.setAttribute('aria-invalid',issue?'true':'false');input.parentElement.classList.toggle('needs-clarification',!!issue);help[key].textContent=issue||(g.inherited?.[key]&&g[key]?'From current context':key!=='count'&&key!=='kind'&&!rules[g.kind][key==='fittingType'?'type':key]?'Optional for this job':'');}}
  paint();
  if(g.unresolved){const box=el('div',{class:'notes-unresolved'});box.append(el('p',{},'Not understood: '+g.unresolved));const lab=el('label',{class:'notes-remember'}),check=el('input',{type:'checkbox'});check.checked=!!g.confirmed;check.addEventListener('change',()=>{g.confirmed=check.checked;persistSoon();});lab.append(check,document.createTextNode('I checked group '+(index+1)+' against the transcript'));box.append(lab);group.append(box);}
  const source=el('details');source.append(el('summary',{},'Show group transcript'),el('p',{},g.source||p.text));group.append(source);
  if(draft.groups.length>1)group.append(button('Remove group '+(index+1),()=>{draft.groups.splice(index,1);persist();render();}));f.append(group);
 });
 const add=kind=>{if(draft.groups.length>=100)throw Error('Review up to 100 groups at a time.');draft.groups.push({kind,cn:'',welder:'',count:'',size:'',schedule:'',fittingType:'',source:'Added during review',unresolved:'',uncertain:{},inherited:{}});persist();render();};
 const buttons=el('div',{class:'notes-actions'});buttons.append(button('Add weld group',()=>add('xf')),button('Add MT group',()=>add('mt')));f.append(buttons,el('p',{class:'error',role:'alert'},p.fieldError||''),el('button',{type:'submit',class:'primary'},'Confirm and add'));
 f.addEventListener('submit',e=>{e.preventDefault();guard(()=>{if(current().pending[0]?.id!==p.id)throw Error('Resolve the first pending instruction first.');try{const commands=P.reviewCommands(draft,list.fieldRequirements);let next=applyListGroup(list,commands,p.id);next.pending=next.pending.filter(x=>x.id!==p.id);next.draft='';editingReview=null;rememberApproved=false;manualOpen=false;replaceList(next);}catch(error){p.fieldError=error.message;persist();render();host.querySelector('[data-review-field][aria-invalid="true"]')?.focus();}});});
 return f;
}
const cnSelection=new Map();
let cnSelectionMode=false,cancelCNHold=()=>{};
function stopCNSelection(){cancelCNHold();cnSelectionMode=false;cnSelection.clear();}
function enableCNHold(card,summary,listId,cn,paint){
 let suppressClick=false;
 const begin=()=>{if(voiceBusy())return;if(!cnSelectionMode)cnSelection.clear();cnSelectionMode=true;cnSelection.set(cnSelectionKey(listId,cn),{listId,cn});paint();};
 card.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||voiceBusy()||e.target.closest('button,input,label,select,textarea,a'))return;
  cancelCNHold();suppressClick=false;const x=e.clientX,y=e.clientY,id=e.pointerId;
  const cleanup=()=>{clearTimeout(timer);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);document.removeEventListener('scroll',cleanup,true);cancelCNHold=()=>{};};
  const move=event=>{if(event.pointerId===id&&Math.hypot(event.clientX-x,event.clientY-y)>10)cleanup();},end=event=>{if(event.pointerId===id)cleanup();};
  const timer=setTimeout(()=>{if(card.isConnected&&!voiceBusy()){suppressClick=true;begin();}},500);
  cancelCNHold=cleanup;document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);document.addEventListener('scroll',cleanup,true);
 });
 card.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();}},true);
 card.addEventListener('contextmenu',e=>{if(!e.target.closest('button,input,label,select,textarea,a'))e.preventDefault();});
 summary.addEventListener('keydown',e=>{if(e.key===' '&&e.shiftKey){e.preventDefault();begin();}});
 summary.setAttribute('aria-keyshortcuts','Shift+Space');
}
window.addEventListener('blur',()=>cancelCNHold());
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelCNHold();});
const cnSelectionKey=(listId,cn)=>JSON.stringify([listId,cn]);
function cnCheckbox(listId,cn,changed){const wrap=el('label',{class:'notes-cn-check'}),input=el('input',{type:'checkbox','aria-label':'Select '+(cn||'No CN assigned')});input.checked=cnSelection.has(cnSelectionKey(listId,cn));input.addEventListener('click',e=>e.stopPropagation());wrap.addEventListener('click',e=>e.stopPropagation());input.addEventListener('change',()=>{const key=cnSelectionKey(listId,cn);if(input.checked)cnSelection.set(key,{listId,cn});else cnSelection.delete(key);changed();});wrap.append(input,el('span',{class:'notes-sr'},'Select '+cn));return wrap;}
function cnToolbar(container,results,refresh){
 container.replaceChildren();const count=cnSelection.size;container.append(el('span',{class:'notes-search-summary','aria-live':'polite'},count+' CN'+(count===1?'':'s')+' selected'));
 container.append(button('Select all shown',()=>{for(const r of results)cnSelection.set(cnSelectionKey(r.listId,r.cn),{listId:r.listId,cn:r.cn});refresh();}));if(!count)return;container.append(button('Clear selection',()=>{cnSelection.clear();refresh();}));
 for(const [action,label]of [['move','Move selected'],['delete','Delete selected']]){const b=button(label,()=>bulkCNDialog(action));b.disabled=!count||voiceBusy();container.append(b);}
}
function dailyLabel(list){const peers=library.lists.filter(l=>l.jobId===list.jobId&&l.date===list.date);return list.date+(peers.length>1?' - List '+(peers.findIndex(l=>l.id===list.id)+1):'');}
function searchCNs(){
 ensureSaved();if(voiceBusy())throw Error('Stop recording before searching.');stopCNSelection();render();const job=currentJob(),f=openDialog('Search CN#'),query=field(f,'Search CN#'),bar=el('div',{class:'notes-cn-toolbar'}),results=el('div',{class:'notes-date-results'});query.placeholder='CN number or part of a number';f.append(el('p',{class:'hint'},'Search all daily lists in '+job.name+'. Each tick selects that CN’s XF and MT entries on the displayed list.'),bar,results,button('Close',closeDialog));
 function paint(){const matches=J.searchCNs(library,job.id,query.value);cnToolbar(bar,matches,paint);results.replaceChildren(el('p',{class:'notes-search-summary'},matches.length+' matches'));for(const r of matches){const card=el('div',{class:'notes-cn-result','data-cn-result':r.cn,'data-cn-list':r.listId}),list=library.lists.find(l=>l.id===r.listId),open=button('',()=>{navigate(job.id,r.listId);closeDialog();pipeOpen.set(r.listId+'|'+r.cn,true);render();});open.append(el('strong',{},r.cn||'No CN assigned'),el('span',{},dailyLabel(list)+' · '+r.xf+' welds · '+r.mt+' MT'));card.append(cnCheckbox(r.listId,r.cn,()=>cnToolbar(bar,matches,paint)),open);results.append(card);}if(!matches.length)results.append(el('p',{class:'notes-empty'},'No matching CNs in this job.'));}
 modal.dataset.cnSearch='true';query.addEventListener('input',paint);f.addEventListener('submit',e=>e.preventDefault());paint();
}
function bulkCNDialog(action){
 ensureSaved();if(voiceBusy())throw Error('Stop recording before changing CNs.');if(!flush())throw Error('Save your notes before changing CNs.');const selection=[...cnSelection.values()],job=currentJob(),f=openDialog(action==='move'?'Move selected CNs':'Delete selected CNs');
 f.append(el('p',{},selection.length+' selected CNs. Each selection includes all its XF welds and MT fittings on that daily list.'));
 let targetJob,targetList;if(action==='move'){
  targetJob=select(f,'Destination job',library.jobs.map(j=>[j.id,j.name+' - '+j.lsd+' - '+j.startDate]),job.id);targetList=select(f,'Destination daily list',[],'');
  const fillLists=()=>{targetList.replaceChildren();for(const l of library.lists.filter(l=>l.jobId===targetJob.value&&!selection.some(s=>s.listId===l.id)))targetList.append(el('option',{value:l.id},dailyLabel(l)));};targetJob.addEventListener('change',fillLists);fillLists();
  f.append(el('p',{class:'hint'},'Choose an existing daily list. Source lists are excluded.'));
 }
 const numbering=select(f,'XF and MT numbering',[['keep','Keep existing numbers'],['renumber','Renumber continuously']],'keep');f.append(el('p',{class:'hint'},'Keep existing numbers leaves gaps and prevents number collisions. Renumber continuously closes gaps across the source job; moves to another job use its next available XF and MT numbers.'));
 actions(f,'Preview changes',()=>{const baseline=JSON.stringify(library),result=J.bulkCNs(library,{jobId:job.id,selection,action,numbering:numbering.value,destinationId:targetList?.value});const preview=openDialog('Confirm '+(action==='move'?'move':'deletion'));
  preview.append(el('p',{},(action==='move'?'Move ':'Delete ')+selection.length+' CNs: '+result.xf+' XF welds and '+result.mt+' MT fittings.'),el('p',{},numbering.options[numbering.selectedIndex].textContent));
  const selectedNames=el('ul',{class:'notes-selected-cns'});for(const item of selection){const source=library.lists.find(l=>l.id===item.listId);selectedNames.append(el('li',{},(item.cn||'No CN assigned')+' — '+dailyLabel(source)));}preview.append(selectedNames);
  if(targetList){const l=library.lists.find(l=>l.id===targetList.value),j=library.jobs.find(j=>j.id===l.jobId);preview.append(el('p',{},'Destination: '+j.name+' - '+j.lsd+' - '+dailyLabel(l)));}
  for(const s of result.summaries)preview.append(el('p',{class:'notes-bulk-range'},s.name+' - '+s.lsd+'\nXF range: '+s.xf+' · next: '+s.nextXF+'\nMT range: '+s.mt+' · next: '+s.nextMT));
  if(result.duplicates.length)preview.append(el('p',{class:'error'},'Duplicate CN# in destination job: '+result.duplicates.map(d=>d.cn+' ('+d.dates.join(', ')+')').join('; ')+'. Confirming will add these entries anyway.'));
  preview.append(el('p',{class:'hint'},'This cannot be undone. Previous undo history in the affected jobs will be cleared to prevent restoring moved rows or old numbers. Existing exports will not change.'));
  preview.append(button(action==='move'?'Confirm move':'Confirm deletion',()=>{ensureSaved();if(voiceBusy())throw Error('Stop recording first.');if(JSON.stringify(library)!==baseline)throw Error('Notes changed. Cancel and preview these changes again.');
   // Persist the entire candidate before replacing the live library. A quota failure
   // must leave both source and destination untouched and allow the same retry.
   try{S.save(storage,result.library);}catch{throw Error('Changes were not saved. Nothing was moved or deleted. Free storage and retry, or cancel.');}
   library=result.library;dirty=false;saveFailed=false;feedback=null;stopCNSelection();closeDialog();render();status.textContent=savedStatus();message(action==='move'?'Selected CNs moved.':'Selected CNs deleted.');
  },true),button('Cancel',()=>{closeDialog();render();}));
 });
}
function renderPipes(list){
 const cns=[...new Set([...list.rows,...list.mtRows].map(r=>r.cn))],section=el('section',{class:'notes-pipes','aria-label':'Spools'});section.append(el('h3',{},'Spools'),el('p',{class:'hint'},cns.length+' spool'+(cns.length===1?'':'s')+' · '+list.rows.length+' welds · '+list.mtRows.length+' MT fittings'));
 if(!cns.length)section.append(el('div',{class:'notes-empty'},'Your spools will appear here. Record an instruction or add an entry manually.'));
 const tools=el('div',{class:'notes-cn-toolbar'}),search=button('Search CN#',searchCNs),hint=el('p',{class:'hint'},'Press and hold a CN card to select entries.');section.append(search,hint,tools);const shown=cns.map(cn=>({listId:list.id,cn}));
 const paintTools=()=>{tools.hidden=!cnSelectionMode;hint.hidden=cnSelectionMode;if(cnSelectionMode){cnToolbar(tools,shown,paintTools);tools.append(button('Cancel selection',()=>{stopCNSelection();paintTools();}));}for(const card of section.querySelectorAll('[data-pipe-card]')){const cn=card.dataset.pipeCard,check=card.querySelector('.notes-cn-check');check.hidden=!cnSelectionMode;check.querySelector('input').checked=cnSelection.has(cnSelectionKey(list.id,cn));card.classList.toggle('is-selected',cnSelectionMode&&check.querySelector('input').checked);}};
 const latest=latestPipes.get(list.id)||(cns.includes(list.context.cn)?list.context.cn:cns.at(-1));
 for(const cn of cns){
  const rows=list.rows.filter(r=>r.cn===cn),mts=list.mtRows.filter(r=>r.cn===cn),key=list.id+'|'+cn,card=el('details',{'data-pipe-card':cn,class:'notes-pipe'});card.open=pipeOpen.has(key)?pipeOpen.get(key):cn===latest;
  card.addEventListener('toggle',()=>{if(card.isConnected)pipeOpen.set(key,card.open);});
  const summary=el('summary'),heading=el('span',{class:'notes-pipe-heading'}),wids=[...new Set([...rows,...mts].map(r=>r.welder||'Unassigned'))];heading.append(el('strong',{},cn||'No CN assigned'),el('span',{class:'notes-pipe-wid'},'WID '+wids.join(', ')));summary.append(cnCheckbox(list.id,cn,paintTools),heading,el('span',{class:'notes-pipe-count'},rows.length+' weld'+(rows.length===1?'':'s')+' · '+mts.length+' MT'));card.append(summary);
  const body=el('div',{class:'notes-pipe-body'});
  if(rows.length){body.append(el('h4',{},'XF welds'));const groups=[];for(const r of rows){const prior=groups.at(-1);if(prior&&prior.at(-1).sequence+1===r.sequence&&prior[0].size===r.size&&prior[0].schedule===r.schedule&&prior[0].welder===r.welder&&JSON.stringify(prior[0].xfFormat)===JSON.stringify(r.xfFormat))prior.push(r);else groups.push([r]);}
   for(const group of groups){const first=group[0],last=group.at(-1),label=M.formatId(first.sequence,first.xfFormat)+(group.length>1?'–'+M.formatId(last.sequence,last.xfFormat):'');body.append(el('p',{class:'notes-group-summary'},label+' · '+group.length+' × '+(first.size?first.size+'″ ':'')+first.schedule+' · '+(first.welder||'No WID')));}
   for(const r of rows){const row=el('article',{'data-weld-row':r.id,class:'notes-compact-row','aria-label':M.formatId(r.sequence,r.xfFormat)});row.append(el('div',{},M.formatId(r.sequence,r.xfFormat)+' · '+(r.size?r.size+'″ ':'')+r.schedule+' · WID '+(r.welder||'—')),el('span',{class:'notes-sr'},cn));const actions=el('div',{class:'notes-row-actions'});actions.append(button('Edit',()=>editWeld(r)),button('Delete',()=>deleteWeld(r)));row.append(actions);body.append(row);}
  }
  if(mts.length){body.append(el('h4',{},'MT fittings'));for(const r of mts){const row=el('article',{'data-mt-row':r.id,class:'notes-compact-row'});row.append(el('div',{},M.formatId(r.sequence,list.mtFormat)+' · '+(r.size?r.size+'″ · ':'')+[r.schedule,r.type].filter(Boolean).join(' ')+' · WID '+(r.welder||'—')));const actions=el('div',{class:'notes-row-actions'});actions.append(button('Edit',()=>editMt(r)),button('Delete',()=>deleteMt(r)));row.append(actions);body.append(row);}}
  enableCNHold(card,summary,list.id,cn,paintTools);card.append(body);section.append(card);
 }
 paintTools();host.append(section);
}
let reviewSheetId=null,reviewLayoutFrame,editingSheetKey=null;
function layoutReviewSheet(){
 cancelAnimationFrame(reviewLayoutFrame);reviewLayoutFrame=requestAnimationFrame(()=>{
  const viewport=window.visualViewport,bottom=viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
  host.style.setProperty('--notes-viewport-bottom',bottom+'px');
  host.style.setProperty('--notes-viewport-height',(viewport?.height||innerHeight)+'px');
  const sheet=host.querySelector('.notes-review-sheet'),dock=host.querySelector('.notes-recorder-dock');
  const dockHeight=dock?.getBoundingClientRect().height;if(dockHeight)host.style.setProperty('--notes-dock-height',dockHeight+'px');
  const active=document.activeElement;if(sheet&&sheet.contains(active)&&active.matches('input,select,textarea,button')){
   const r=active.getBoundingClientRect(),s=sheet.getBoundingClientRect();
   if(r.bottom>s.bottom-16)sheet.scrollTop+=r.bottom-s.bottom+16;
   else if(r.top<s.top+16)sheet.scrollTop-=s.top+16-r.top;
  }
 });
}
function render(){
 cancelCNHold();
 const reviewKey=current()?.pending[0]?current().id+':'+current().pending[0].id:null;if(editingSheetKey!==reviewKey)editingSheetKey=null;host.classList.toggle('editing-clarification',!!editingSheetKey);
 host.classList.toggle('has-recorder',!blocked&&!!current());
 host.replaceChildren();const messageNode=el('p',{id:'notes-message',role:'status',class:'hint'});host.append(messageNode);
 if(blocked){host.append(el('p',{class:'error'},'Saved notes need recovery. Copy the original data, or restore a saved backup after confirmation.'),button('Export recovery data',()=>exportText(rawBackup||'Storage is inaccessible. Enable device storage and reload.','Recovery data','Recovery data')),button('Restore backup',()=>{restoreReady();location.href='shottime://backup/restore';}));return;}
 const list=current(),job=currentJob();if(!list){reviewSheetId=null;
 if(!job){renderJobs();}
 else{renderDailyLists(job);}
 return;}

 if(!editingReview&&typeof list.pending[0]?.correctionDraft==='string'){editingReview=list.pending[0].id;list.draft=list.pending[0].correctionDraft;}
 const header=el('div',{class:'notes-jobs-header notes-entry-header'}),heading=el('div');heading.append(el('h2',{},job.name),el('p',{class:'notes-job-detail'},list.lsd),el('p',{class:'notes-job-start'},list.date));header.append(heading,Object.assign(button('Settings',voiceSettings),{id:'notes-settings'}));host.append(header);
 renderVoice(list);
 const context=el('div',{id:'notes-context',class:'notes-context'});context.append(el('span',{},(list.context.cn||'No current spool')+' · WID '+(list.context.welder||'—')),el('span',{},'Next '+M.formatId(list.nextSequence,list.xfFormat)+' / '+M.formatId(list.nextMtSequence,list.mtFormat)));host.append(context);
 if(feedback?.listId===list.id&&feedback.revision===list.revision&&!dirty){const confirmation=el('div',{id:'notes-confirmation',class:'notes-confirmation',role:'status'});confirmation.append(el('p',{},feedback.text));const undoHere=button('Undo',()=>{feedback=null;replaceList(undoList(current()),false,null,{undo:true});});undoHere.disabled=!list.history.length||voiceBusy();confirmation.append(undoHere);host.append(confirmation);}
 const bar=el('div',{class:'notes-jobs-actions notes-entry-actions'}),add=button('Add manually',addManually);add.disabled=!!list.pending.length;const share=button('Share CSV',shareCSV);share.disabled=!list.rows.length&&!list.mtRows.length;bar.append(add,share);host.append(bar);
 for(const [index,p] of list.pending.entries()){
  const review=el('section',{'data-review-item':p.id,class:'notes-review'});review.append(el('strong',{},index?'Waiting for earlier correction':'Needs review'),el('p',{class:'notes-review-reason'},p.reason));
  if(index===0){review.classList.add('notes-review-sheet');if(reviewSheetId!==p.id)review.classList.add('notes-review-enter');review.setAttribute('role','region');review.setAttribute('aria-label','Clarify recording');review.addEventListener('focusin',e=>{if(!voiceBusy()&&e.target.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])')){editingSheetKey=list.id+':'+p.id;host.classList.add('editing-clarification');}layoutReviewSheet();});editingReview=p.id;if(p.reviewMode==='wording')review.append(instructionForm(list,true));else review.append(reviewFields(list,p));
   review.append(button(p.reviewMode==='wording'?'Use fields':'Edit wording instead',()=>{if(p.reviewMode==='wording'){p.reviewMode='fields';delete p.fieldsDraft;}else{p.reviewMode='wording';list.draft=p.correctionDraft??p.text;p.correctionDraft=list.draft;}persist();render();}));
  }else review.append(el('p',{},p.text));
  const original=el('details');original.append(el('summary',{},'Show transcript'),el('p',{},p.source||p.text));review.append(original);
  review.append(button('Dismiss instruction',()=>{if(p.id.startsWith('voice:'))list.processedSegments.push(p.id);list.pending=list.pending.filter(x=>x.id!==p.id);if(editingReview===p.id){editingReview=null;list.draft='';rememberApproved=false;}persist();render();}));host.append(review);
 }

 if(!list.pending.length&&list.draft.trim()){
  const saved=el('section',{class:'notes-review','aria-label':'Saved draft'});saved.append(el('strong',{},'Saved draft'),el('p',{},list.draft.slice(0,200)),button('Review saved draft',()=>{ensureSaved();list.pending.push({id:'draft:'+uid(),text:list.draft,correctionDraft:list.draft,reviewMode:'wording',reason:'Review the instruction saved before this list was closed.'});persist();render();}),button('Discard saved draft',()=>{const f=openDialog('Discard saved draft?');f.append(el('p',{},'Remove this saved instruction? Existing XF and MT entries stay unchanged.'),button('Discard draft',()=>{ensureSaved();list.draft='';persist();closeDialog();render();}),button('Cancel',closeDialog));}));host.append(saved);
 }
 reviewSheetId=list.pending[0]?.id||null;renderPipes(list);lockVoiceControls();layoutReviewSheet();if(!saveFailed)offerVoiceDuplicate(list);
}
window.addEventListener('resize',()=>{if(host)layoutReviewSheet();});
window.visualViewport?.addEventListener('resize',()=>{if(host)layoutReviewSheet();});
window.visualViewport?.addEventListener('scroll',()=>{if(host)layoutReviewSheet();});

function backupExport(){
 if(voiceBusy())throw Error('Stop recording before saving a backup.');
 if(blocked||voiceRecoveryFailed||!voiceSaved)throw Error('Recover the current notes first, or use Copy recovery data.');
 return S.backup(library);
}
function restoreReady(){
 if(voiceBusy()||voiceRecoveryFailed||!voiceSaved)throw Error('Stop recording and recover its transcript before restoring a backup.');
 if(!blocked&&!flush())throw Error('Save the current notes before restoring a backup.');return true;
}
function receiveBackup(text){
 try{restoreReady();const candidate=S.readBackup(text),baseline=JSON.stringify(library),originalRaw=storage.getItem(S.KEY),session=voice.id||'';
  const counts=candidate.lists.reduce((a,l)=>[a[0]+l.rows.length,a[1]+l.mtRows.length],[0,0]);
  const f=openDialog('Restore backup');f.append(el('p',{},candidate.jobs.length+' job(s), '+candidate.lists.length+' daily list(s), '+counts[0]+' XF entries and '+counts[1]+' MT entries.'),el('p',{},'This replaces ALL current jobs and lists. Save a backup of your current notes first if you want to keep them. Calculator settings are unchanged.'),button('Replace all jobs and lists',()=>{
   restoreReady();if(JSON.stringify(library)!==baseline||storage.getItem(S.KEY)!==originalRaw||(voice.id||'')!==session)throw Error('Notes changed after preview. Open the backup again.');
   // A session tombstone prevents the separate native journal replaying into an older restore.
   if(session)candidate.deletedLists=[...new Set([...(candidate.deletedLists||[]).filter(id=>!id.startsWith('voice-session:')),'voice-session:'+session])].slice(-50);
   S.save(storage,candidate);library=candidate;blocked=false;rawBackup=null;dirty=false;saveFailed=false;voiceRecoveryFailed=false;voiceSaved=true;voicePending='';feedback=null;manualOpen=false;editingReview=null;clearTimeout(draftTimer);stopCNSelection();pipeOpen.clear();latestPipes.clear();closeDialog();render();status.textContent='Backup restored and saved on this device';recoveryVisibility(false);
  },true),button('Cancel',closeDialog));
 }catch(e){message(e.message,true);}
}

function init(){if(host)return;host=document.getElementById('notes-app');if(!host)return;status=document.getElementById('notes-save-status');try{storage=localStorage;}catch{storage={getItem(){throw Error('Storage unavailable');}};}const loaded=S.load(storage);library=loaded.library;blocked=!!loaded.warning;rawBackup=loaded.rawBackup;status.textContent=loaded.warning||'Saved on this device';document.getElementById('notes-retry').addEventListener('click',()=>{if(voiceRecoveryFailed){receiveVoice(JSON.stringify(voice));}else if(persist())render();});document.getElementById('notes-backup').addEventListener('click',()=>exportText(rawBackup||JSON.stringify(voiceRecoveryFailed?{notes:library,voiceRecovery:voice}:library,null,2),'Recovery data','Recovery data'));window.addEventListener('beforeunload',e=>{if(!flush()){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();});status.textContent=loaded.warning||savedStatus();recoveryVisibility(blocked);render();}
function canLeave(){if(!host)return true;const reason=voiceBusy()?'Stop recording before leaving QC Notes.':!flush()?'Save the current notes before leaving QC Notes.':!voiceSaved?'Recover the voice transcript before leaving QC Notes.':'';if(reason){recoveryVisibility(!voiceSaved||saveFailed);message(reason,true);return false;}return true;}
function back(){if(host&&cnSelectionMode&&!document.getElementById('note-taker').hidden){stopCNSelection();render();return true;}if(!host||document.getElementById('note-taker').hidden||!currentJob())return false;try{navigate(current()?current().jobId:null);}catch(e){message(e.message,true);}return true;}
root.ShotNotesUI={backupExport,receiveBackup,restoreReady,back,canLeave,init,receiveVoice,receiveLevel,csvExport,flush:()=>!host||flush(),closeDialog:()=>{if(!modal)return false;closeDialog();return true;}};
})(globalThis);
