(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./notes-model.js'):root.ShotNotesModel,typeof module==='object'&&module.exports?require('./notes-parser.js'):root.ShotNotesParser);if(typeof module==='object'&&module.exports)module.exports=api;else root.ShotNotesVoice=api;})(globalThis,function(M,P){
'use strict';
// Whisper habits: CM for CN before a number, "welders," or a letter glued to welder ("Weldero"), and commas
// that are punctuation rather than counting aloud (commas before a digit or a number word are kept, since
// number words only become digits later, in the parser).
const NUMBER_WORD='zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
function normalize(text){return P.normalize(text.replace(/\bC\s*\.?\s*M(?=\s*-?\s*\d)/gi,'CN').replace(/\bwelders\b/gi,'welder').replace(/\bwelder([a-z])\b/gi,'welder $1').replace(/\bwelder\s*[,:;.]\s*/gi,'welder ').replace(new RegExp(',(?!\\s*(?:\\d|(?:'+NUMBER_WORD+')\\b))','gi'),' ').replace(/\bC\s*\.?\s*N\b/gi,'CN').replace(/\bX\s*\.?\s*F\b/gi,'XF').replace(/\bS\s+T\s+D\b/gi,'STD').replace(/\bX\s+S\b/gi,'XS').replace(/[- ]inch(?:es)?\b/gi,' inch').replace(/\b(CN|XF)\s+(?:dash\s+)?/gi,'$1-').replace(/\b(CN|XF)(?=\d)/gi,'$1-')).replace(/\.(?!\d)/g,' ').replace(/[!?]/g,' ').replace(/\s+/g,' ').trim();}
function assemble(session){
 const text=normalize(session.events.map(e=>e.text).join(' '));
 const pieces=text.split(/(?=\bCN\s*[- ]?\s*\d+[a-z]*\s+has\b|\b(?:change|set|move)\s+|\bundo\s+(?:(?:the\s+)?last\s+|that\b)|\b(?:remove|delete)\s+(?:the\s+)?last\s+MT\b|\bsame spool\b|\badd\s+\d+\s+more\b)/i).map(s=>s.replace(/^[,; ]+|[,; ]+$/g,'')).filter(Boolean);
 const active=['preparing','listening','stopping'].includes(session.state);
 const pending=active?(pieces.pop()||''):'';
 return {pieces,pending};
}
function reconcile(list,session,learned,checkAddition){
 if(!session||session.listId!==list.id)return {list,pending:'',changed:false};
 if(session.deferred&&['preparing','listening','stopping'].includes(session.state))return {list,pending:session.events.map(e=>e.text).join(' '),changed:false};
 if(session.deferred){
  const id='voice:'+session.id+':cloud';if(list.processedSegments.includes(id)||list.pending.some(p=>p.id===id))return {list,pending:'',changed:false};
  const source=session.events.map(e=>e.text).join(' ');if(!source.trim())return {list,pending:'',changed:false};
  const healthy=!session.uncertain&&session.state==='stopped';const remembered=healthy&&learned&&!list.pending.length?learned(normalize(source),list.context):null;
  let remaining=remembered||(healthy&&session.suggestion)||normalize(source);const chunks=[];
  while(remaining.length>19000){let cut=remaining.lastIndexOf(' CN',19000);if(cut<1)cut=remaining.lastIndexOf(' ',19000);if(cut<1)cut=19000;chunks.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();}if(remaining)chunks.push(remaining);
  const next=JSON.parse(JSON.stringify(list));chunks.forEach((text,index)=>next.pending.push({id:index?id+':part:'+index:id,text,source:chunks.length===1?source:text,reason:!healthy?'Recording interrupted. Check original speech for missing audio.':session.interpretError?'Cloud interpretation failed. Check every quantity, size, schedule and Welder ID in the recognized speech.':chunks.length>1?'Long session, part '+(index+1)+' of '+chunks.length+'. Check adjoining parts and all weld details before adding.':remembered?'Previously approved wording. Review all weld details before adding.':'Review this session before adding. Check every quantity, size, schedule and Welder ID.'}));return {list:next,pending:'',changed:true};
 }
 const {pieces,pending}=assemble(session);let next=JSON.parse(JSON.stringify(list)),changed=false;
 pieces.forEach((text,index)=>{
  const id='voice:'+session.id+':'+index;
  if(next.processedSegments.includes(id)||next.pending.some(p=>p.id===id))return;
  if(text.length>19000){
   let remaining=text,part=0;while(remaining){let cut=Math.min(19000,remaining.length);if(cut<remaining.length){const space=remaining.lastIndexOf(' ',cut);if(space>0)cut=space;}const chunk=remaining.slice(0,cut);next.pending.push({id:id+':part:'+part++,text:chunk,source:chunk,reason:'Long recording. Review this part and adjoining parts before adding.'});remaining=remaining.slice(cut).trimStart();}
   next.processedSegments.push(id);changed=true;return;
  }
  const remembered=learned&&!session.uncertain&&!['error','interrupted'].includes(session.state)&&!next.pending.length?learned(text,next.context):null;
  if(remembered){next.pending.push({id,text:remembered,source:text,reason:'Previously approved wording for this exact transcript and context. Review before adding.'});changed=true;return;}
  let result=P.parse(text,next.context,next.rows,next.fieldRequirements,next.mtRows);
  if(session.uncertain||['error','interrupted'].includes(session.state))result={review:[{reason:'Recording was interrupted. Check this instruction for missing audio before adding its welds.'}]};
  if(next.pending.length)result={review:[{reason:'Resolve earlier instructions first to keep XF numbering in order.'}]};
  try {
   if(result.review.length)throw Error(result.review[0].reason);
   if(result.commands.length===1&&result.commands[0].type==='undo'){next=M.undo(next);next.processedSegments.push(id);}
   else {const candidate=M.applyGroup(next,result.commands,id);if(checkAddition)checkAddition(next,candidate);next=candidate;}
  }catch(e){next.pending.push({id,text,reason:e.message.slice(0,160),...(e.duplicateCN?{duplicateCN:true}:{})});}
  changed=true;
 });
 return {list:next,pending,changed};
}
return {normalize,assemble,reconcile};
});
