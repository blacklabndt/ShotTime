(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./notes-model.js'):root.ShotNotesModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.ShotNotesParser=api;})(globalThis,function(M){
'use strict';
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
function normalize(s){s=s.replace(/[“”″]/g,'"').replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/gi,(_,a,b)=>String(tens[a.toLowerCase()]+small.indexOf(b.toLowerCase())));s=s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,m=>String(tens[m.toLowerCase()]??small.indexOf(m.toLowerCase())));return cnSpeech(s).replace(/\b(?:sched|sced)\s+(?=\d{1,3}(?:S|M)?\b|STD\b|XS\b|XH\b|XXS\b|XXH\b)/gi,'schedule ').replace(/\bextra[\s-]+(?:strong|heavy)\b/gi,'XH').replace(/\bstandard\b/gi,'STD').replace(/\binches\b/gi,'inch').replace(/\s+/g,' ').trim();}
// Welder IDs are spoken as letters. Whisper may write a letter's name ("dee", "oh", "are") or the speaker may use
// the NATO alphabet ("delta"); map them only when the whole ID is letters, digits or dashes.
const LETTER={ay:'A',bee:'B',be:'B',see:'C',sea:'C',cee:'C',dee:'D',ee:'E',eff:'F',ef:'F',gee:'G',jee:'G',aitch:'H',haitch:'H',eye:'I',jay:'J',kay:'K',el:'L',elle:'L',em:'M',en:'N',oh:'O',pee:'P',pea:'P',cue:'Q',queue:'Q',ar:'R',are:'R',ess:'S',es:'S',tee:'T',tea:'T',you:'U',vee:'V',ex:'X',why:'Y',zed:'Z',zee:'Z',
 alpha:'A',alfa:'A',bravo:'B',charlie:'C',delta:'D',echo:'E',foxtrot:'F',golf:'G',hotel:'H',india:'I',juliet:'J',juliett:'J',kilo:'K',lima:'L',mike:'M',november:'N',oscar:'O',papa:'P',quebec:'Q',romeo:'R',sierra:'S',tango:'T',uniform:'U',victor:'V',whiskey:'W',whisky:'W',xray:'X','x-ray':'X',yankee:'Y',zulu:'Z'};
// Join only explicit suffixes; keep "CN-332 a 2 inch weld" as quantity one.
function cnSpeech(s){return s.replace(/\bC\s+N\b/gi,'CN').replace(/\bCN\s*[, -]?\s*(\d+)\s+(alpha|alfa|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|juliett|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|whisky|xray|yankee|zulu)\b/gi,(_,n,l)=>'CN-'+n+LETTER[l.toLowerCase()]).replace(/\bCN\s*[, -]?\s*(\d+)\s+([a-z])(?=\s*(?:has\b|[,;]|$)|\s+(?:welded\b|wid\b|welder\b|[A-Z]{2}\s*$))/gi,(_,n,l)=>'CN-'+n+l.toUpperCase());}
function letters(s){s=s.replace(/\bdouble[\s-]+(?:you|u)\b/gi,'W');const tokens=s.split(/\s+/);return tokens.every(t=>/^(?:[a-z]|\d+|-|dash)$/i.test(t)||LETTER[t.toLowerCase()])?tokens.map(t=>LETTER[t.toLowerCase()]||t).join(' '):s;}
function welder(s){if(/^(?:unknown|\?)$/i.test(s.trim()))return '?';s=letters(s.replace(/^to\s+/i,'').replace(/^letter\s+/i,'').trim()).replace(/\s+dash\s+/gi,'-').replace(/\s*-\s*/g,'-').trim();if(/^(?:[a-z]\s+)+[a-z]$/i.test(s))s=s.replace(/\s/g,'');if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(s))throw Error('Clarify the Welder ID.');return s.toUpperCase();}
// Spoken/typed lowercase "40s" means schedule 40; an explicit capital S (40S) is a stainless schedule and is kept.
function scheduleOf(raw){return M.mtSchedule(/^\d{1,3}s$/.test(raw)?raw.slice(0,-1):raw);}
function mtDescriptions(part){return part.replace(/\bslip[ -]+on[ -]+flange(s?)\b/gi,'Slip-On Flange$1').replace(/\b(?:d|dee)[ -]+legs?\b/gi,'D-Leg').replace(/\bdummy[ -]+legs?\b/gi,'Dummy Leg').replace(/\blifting[ -]+lugs?\b/gi,'Lifting Lug').replace(/\bman[ -]+ways?\b/gi,'Manway');}
function mtSuffix(part){
 const source=mtDescriptions(part).replace(/\bMT\s+(?:fittings?|items?|entries)\b/gi,'MTFIT').replace(/\bW\s+O\s+L\b/gi,'WOL').replace(/\bT\s+O\s+L\b/gi,'TOL').replace(/\bS\s+W\b/gi,'SW').replace(/\bweld[ -]*olets?\b/gi,'WOL').replace(/\bthread[ -]*olets?\b|\bthread(?:y|ys|ies)\b/gi,'TOL').replace(/\bsocket[ -]*welds?\b/gi,'SW').replace(/(\d)-inch\b/gi,'$1 inch').replace(/\b([369])\s+(?:M|em)\b/gi,'$1M');
 if(!/\b(?:WOL|TOL|SW|D-Leg|Dummy Leg|Lifting Lug|Manway|Plate|Slip-On Flange|Fillet Weld|MTFIT)s?\b/i.test(source))return null;
 const pattern=/\b(?:(a|an|\d+)\s+)?(?:((?:\d+\s+)?\d+\/[1-9]\d*|\d+(?:\.\d+)?)\s*(?:"|inch)\s*)?(?:(?:sch(?:edule)?\s*)?(STD|XS|XH|XXS|XXH|[369]M|\d{1,3}S?)\s+)?(WOL|TOL|SW|D-Leg|Dummy Leg|Lifting Lug|Manway|Plate|Slip-On Flange|Fillet Weld|MTFIT)s?\b(?:\s+(?:sch(?:edule)?)\s*(STD|XS|XH|XXS|XXH|[369]M|\d{1,3}S?)\b)?/gi,items=[];
 let match,end=0,body='';
 while((match=pattern.exec(source))){
  if(!match[1]&&!match[2])continue;
  if(!items.length)body=source.slice(0,match.index).replace(/[\s,;.]+$/,'').replace(/\b(?:and|plus|with)\s*$/i,'').trim();
  else if(!/^[\s,;.]*(?:(?:and|plus|with)\s*)?$/i.test(source.slice(end,match.index)))throw Error('Clarify the MT quantity, size and fitting type.');
  if(!match[1]&&/\b(?:WOL|TOL|SW|D-Leg|Dummy Leg|Lifting Lug|Manway|Plate|Slip-On Flange|Fillet Weld)s\b/i.test(match[0]))throw Error('Specify how many MT fittings.');const count=!match[1]||/^(?:a|an)$/i.test(match[1])?1:Number(match[1]);if(count<1||count>1000)throw Error('Use an MT quantity from 1 to 1000.');
  if(match[1]&&/^\d+$/.test(match[1])&&/^\d+\/\d+$/.test(match[2]))throw Error('Clarify the MT quantity and fractional size; use Add MT fitting to specify the fractional size.');
  if(match[3]&&match[5]&&scheduleOf(match[3])!==scheduleOf(match[5]))throw Error('Conflicting MT schedules.');items.push({count,size:match[2]||'',schedule:scheduleOf(match[3]||match[5]||''),fittingType:match[4].toUpperCase()==='MTFIT'?'':M.fittingType(match[4])});end=pattern.lastIndex;
 }
 if(!items.length)return null;
 const tail=source.slice(end),assignment=tail.match(/^[\s,;.]*(?:welded(?: by)?|welder(?: id)?|wid)\s+(.+?)\s*[.;]*$/i);if(!assignment&&!/^[\s,;.]*$/.test(tail))throw Error('Clarify the MT quantity, size and fitting type.');
 return {body:body.replace(/^add\s*$/i,''),items,welder:assignment?welder(assignment[1]):null};
}
// Bounded spoken forms; retain the ordinary parser as the final validator.
function spokenForms(s){
 return s.replace(/\bC\s+N\b/gi,'CN')
 .replace(/\bunknown\s+CN(?:#|[ -]+number\b)?[ -]*/gi,'CN-? ')
 .replace(/\bCN(?:#|[ -]+number\b)?[ -]+unknown\b/gi,'CN-?')
 .replace(/\b(?:and\s+)?unknown\s+welder(?:[ -]+id\b)?/gi,'welder ?')
 .replace(/\bCN\s*,\s*(?=\d+[a-z]*\b)/gi,'CN-').replace(/\bCN\s+number\s+(?=\d)/gi,'CN-')
 .replace(/\b(\d+)\s+and\s+a\s+half[ -]+inch\b/gi,(_,n)=>(Number(n)+.5)+' inch')
 .replace(/\binch\s+and\s+a\s+half\b/gi,'1.5 inch')
 .replace(/\b(?:3[ -]+quarters?|three[ -]+quarters?)[ -]+inch\b/gi,'0.75 inch')
 .replace(/\bhalf[ -]+inch\b/gi,'0.5 inch').replace(/(\d)[ -]+inch\b/gi,'$1 inch')
 .replace(/\b([369])[ -]+thousand\b(?=\s+(?:TOL|WOL|SW|thread\w*|weld[ -]*olet\w*|socket\b))/gi,'$1M')
 .replace(/((?:\binch|\")\s+(?:(?:sch(?:edule)?|sched)\s*)?|\bschedule\s+)1\s+(?:hundred\s+)?60\b/gi,(_,lead)=>lead+'160')
 .replace(/((?:\binch|\")\s+(?:(?:sch(?:edule)?|sched)\s*)?|\bschedule\s+)8\s+0\b/gi,(_,lead)=>lead+'80')
 .replace(/((?:\binch|\")\s+)heavy\b/gi,'$1XH')
 .replace(/\ba pair of\s+/gi,'2 ').replace(/\b(\d+)\s+off\s+/gi,'$1 ')
 .replace(/\banother\s+/gi,'a ')
 .replace(/(\binch|\")\s*,\s*(?=(?:sch(?:edule)?|STD|XH|XS|\d)\b)/gi,'$1 ')
 .replace(/\bweld['’]s schedule to\s+/gi,'weld to schedule ')
 .replace(/\bby\s+/gi,'welded by ').replace(/\bwelded\s+welded\s+by\b/gi,'welded by');
}
function countingAloud(part){return part.replace(/(^|\s+and\s+|,\s*)((?:\d+\s*,\s*)+\d+)(?:\s*,\s*|\s+)((?:(?:\d+\s+)?\d+\/[1-9]\d*|\d+(?:\.\d+)?)\s*(?:"|inch)\s*)((?:(?:sch(?:edule)?)\s*)?)(STD|XS|XH|XXS|XXH|\d{1,3}S?)\b/gi,(whole,lead,counting,size,prefix,schedule)=>{const counts=counting.split(',').map(Number);if(counts.some((n,i)=>n!==i+1))throw Error('Counting aloud must start at 1 and increase by 1. Clarify the total weld quantity.');return lead+counts.length+' '+size+prefix+schedule;});}
function parse(input,context={},rows=[],required=null,mtRows=[]){const fail=reason=>({commands:[],review:[{text:input,reason,span:[0,typeof input==='string'?input.length:0]}],context:{...context}});if(typeof input!=='string'||!input.trim()||input.length>20000)return fail('Enter an instruction up to 20,000 characters.');let s=spokenForms(normalize(input)).replace(/[.;]+$/,'');const state={cn:context.cn||'',welder:context.welder||''};
try{
const rules=M.requirements(required);
const sameSpool=/^same spool\b/i.test(s);
if(sameSpool){if(!state.cn)throw Error('There is no current spool. Say the CN number.');s=s.replace(/^same spool\s*[,;]?\s*/i,'');}
const repeat=s.match(/^(?:add )?(\d+) more (?:welds? )?like the last(?: weld)?$/i);
if(repeat){
 const count=Number(repeat[1]);if(count<1||count>1000)throw Error('Use a repeat quantity from 1 to 1000.');
 const last=rows.at(-1);if(!last)throw Error('There is no last weld to repeat.');if(sameSpool&&last.cn!==state.cn)throw Error('The last weld belongs to a different spool. Specify the weld details.');
 const c={type:'addBatch',cn:last.cn,cnNumber:last.cnNumber??undefined,count,size:last.size,schedule:last.schedule,welder:last.welder};M.requireFields(c,rules.xf);return {commands:[c],review:[],context:{...state,cn:last.cn,welder:last.welder}};
}
if(/^(?:remove|delete) (?:the )?last MT fitting$/i.test(s)){const last=mtRows.at(-1);if(!last)throw Error('There is no MT fitting to remove.');return {commands:[{type:'deleteMt',rowId:last.id}],review:[],context:state};}

if(/^(?:undo that|undo (?:the )?last (?:batch|operation|change))$/i.test(s))return {commands:[{type:'undo'}],review:[],context:state};
// Explicit modifiers use existing atomic update/delete operations and stable row IDs.
const sizeChange=s.match(/^(?:change|set) (?:the )?last weld(?:['’]s)? size to (.+?)(?:\s*inch|\s*\")?$/i);
if(sizeChange){const last=rows.at(-1);if(!last)throw Error('There is no last weld to change.');const size=M.size(sizeChange[1].trim());return {commands:[{type:'updateRows',rowIds:[last.id],patch:{size}}],review:[],context:state};}
const scheduleChange=s.match(/^(?:change|set) (?:the )?last (\d+) welds to (?:(?:schedule|sch)\s*)?(\d{1,3}S?|STD|XS|XH|XXS|XXH)$/i);
if(scheduleChange){const count=Number(scheduleChange[1]);if(count<1||count>1000||count>rows.length)throw Error('The list does not contain that many welds.');return {commands:[{type:'updateRows',rowIds:rows.slice(-count).map(r=>r.id),patch:{schedule:scheduleOf(scheduleChange[2])}}],review:[],context:state};}
const move=s.match(/^move (?:the )?last weld to CN\s*[- ]?\s*(\d+[a-z]*)$/i);
if(move){const last=rows.at(-1);if(!last)throw Error('There is no last weld to move.');return {commands:[{type:'updateRows',rowIds:[last.id],patch:{cn:move[1]}}],review:[],context:state};}
const allWelders=s.match(/^(?:set|change) all welders? on (CN\s*[- ]?\s*\d+[a-z]*) to (.+)$/i);
if(allWelders){const cn=allWelders[1].replace(/^CN\s*[- ]?\s*/i,'CN-').toUpperCase(),wid=welder(allWelders[2]),xf=rows.filter(r=>r.cn.toUpperCase()===cn.toUpperCase()),mt=mtRows.filter(r=>r.cn.toUpperCase()===cn.toUpperCase());if(!xf.length&&!mt.length)throw Error('No entries match '+cn+'.');const commands=[];if(xf.length)commands.push({type:'updateRows',rowIds:xf.map(r=>r.id),patch:{welder:wid}});for(const r of mt)commands.push({type:'updateMt',rowId:r.id,patch:{welder:wid}});return {commands,review:[],context:state};}
const mtChange=s.match(/^(?:change|set) (?:the )?last MT fitting to (.+)$/i);
if(mtChange){const last=mtRows.at(-1);if(!last)throw Error('There is no MT fitting to change.');const mt=mtSuffix(mtChange[1]);if(!mt||mt.body||mt.welder!==null||mt.items.length!==1||mt.items[0].count!==1)throw Error('Specify one fitting size, schedule and description.');const item=mt.items[0];if(!item.size||!item.fittingType)throw Error('Specify the fitting size and description.');const patch={size:M.size(item.size),fittingType:item.fittingType};if(item.schedule)patch.schedule=item.schedule;return {commands:[{type:'updateMt',rowId:last.id,patch}],review:[],context:state};}
let match=s.match(/^change (?:the )?last weld to (?:schedule|sch)\s*(\d{1,3}S?|STD|XS|XH|XXS|XXH)$/i);if(match){if(!rows.length)throw Error('There is no last weld to change.');return {commands:[{type:'updateRows',rowIds:[rows[rows.length-1].id],patch:{schedule:scheduleOf(match[1])}}],review:[],context:state};}
match=s.match(/^(?:change|set) (.+?)\s+(?:welder(?: id)?|wid)\s+(.+)$/i);
if(match){let target=match[1].replace(/['’]s$/,'').trim(),selected=[];const range=target.split(/\s+(?:through|to)\s+/i);const label=r=>M.formatId(r.sequence,r.xfFormat).toUpperCase();if(range.length===2){const a=rows.find(r=>label(r)===range[0].toUpperCase()),b=rows.find(r=>label(r)===range[1].toUpperCase());if(!a||!b||a.sequence>b.sequence)throw Error('Clarify the XF range.');selected=rows.filter(r=>r.sequence>=a.sequence&&r.sequence<=b.sequence);if(selected.length!==b.sequence-a.sequence+1)throw Error('The XF range includes missing weld numbers.');}else{const xfRows=rows.filter(r=>label(r)===target.toUpperCase()),cnRows=rows.filter(r=>r.cn.toUpperCase()===target.toUpperCase());if(xfRows.length&&cnRows.length)throw Error('This target matches both a CN and an XF. Edit the intended rows directly.');selected=xfRows.length?xfRows:cnRows;}if(!selected.length)throw Error('No matching CN or XF was found.');return {commands:[{type:'updateRows',rowIds:selected.map(r=>r.id),patch:{welder:welder(match[2])}}],review:[],context:state};}
// Owner-confirmed recognition: AD means eighty only between an inch size and weld(s).
s=s.replace(/((?:\binch|")\s+(?:(?:sch(?:edule)?|sched|sced)\s*)?)AD(?=\s+welds?\b)/gi,(_,prefix)=>prefix+'80');
// Reorder a single trailing spool reference before ordinary validation; never choose between two CNs.
const trailingCN=s.match(/^(.+?)(?:\s+(?:on\s+)?|\s*,\s*)CN\s*[- ]?\s*(\d+[a-z]*)\b(.*)$/i);
if(trailingCN&&!/\bCN\b/i.test(trailingCN[1])&&/\bCN\b/i.test(trailingCN[3]))throw Error('Conflicting CN numbers. Clarify which spool these welds belong to.');
if(trailingCN&&/\bCN\b/i.test(trailingCN[1])&&/^\s*,?\s*(?:(?:welded by|wid|welder)\s+)?[A-Z]{1,2}\s*$/.test(trailingCN[3]))throw Error('Conflicting CN numbers. Clarify which spool these welds belong to.');
if(trailingCN&&!/\bCN\b/i.test(trailingCN[1])&&!/\bCN\b/i.test(trailingCN[3]))s='CN-'+trailingCN[2]+' has '+trailingCN[1]+' '+trailingCN[3].replace(/^\s*,\s*/,'');
let numericCN;const pieces=s.split(/(?=\bCN\s*[- ]?\s*(?:\d|\?))/i).map(x=>x.replace(/^[,; ]+|[,; ]+$/g,'')).filter(Boolean),commands=[];
for(let part of pieces){
// A short uppercase WID immediately after a complete weld phrase is explicit shorthand.
// Leave other trailing words and existing welder assignments to the normal review path.
part=part.replace(/\b(all|both)\s+(?=[A-Z]{1,2}\s*$)/g,'$1 welded by ');
if(!/\b(?:welded|welder|wid)\b/i.test(part)){
 const bare=part.match(/(?:\bwelds?|\b(?:TOL|WOL|SW|thready|threadolet)|\b(?:STD|XS|XH|XXS|XXH|\d{1,3}S?))\s*[,]?\s+([A-Z]{1,2}|[A-Z]\s+[A-Z])\s*$/);
 if(bare&&!/^(?:A|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|NO|OF|ON|OR|SO|TO|UP|US|WE)$/.test(bare[1]))part=part.slice(0,part.length-bare[1].length).replace(/[, ]+$/,'')+' welded by '+bare[1];
}
if(!/\b(?:welded|welder|wid)\b/i.test(part)){
 const initials=part.match(/\b[wW][eE][lL][dD][sS]?\s+([A-Z]{1,2}|[A-Z]\s+[A-Z])\s*[.;]*$/);
 if(initials&&!/^(?:A|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|NO|OF|ON|OR|SO|TO|UP|US|WE)$/.test(initials[1]))part=part.slice(0,initials.index)+initials[0].split(/\s/)[0]+' welded by '+initials[1];
}
const spokenCN=part.match(/^CN\s*[- ]\s*([^\s,;.]+)/i);if(spokenCN&&!/^(?:\d+[a-z]*|\?)$/i.test(spokenCN[1]))throw Error('The CN number was not recognized. Correct the CN before adding this spool.');const spokenWid=/\b(?:welded(?: by)?|welder(?: id)?|wid)\s+/i.test(part);const expectsBatch=/\bhas\b/i.test(part);let cnMatch=part.match(/^CN\s*[- ]?\s*(\d+[a-z]*\b|\?(?=\s|$|[,;]))/i);if(cnMatch){state.cn=cnMatch[1]==='?'?'?':'CN-'+cnMatch[1].toUpperCase();numericCN=cnMatch[1].toUpperCase();part=part.slice(cnMatch[0].length).replace(/^\s*(?:has\b|[,;])\s*/i,'').trim();}
const mt=mtSuffix(part);if(mt){if(!state.cn&&rules.mt.cn)throw Error('CN# is required for MT fittings on this job.');if(mt.welder!==null){const prior=mt.body.match(/\b(?:welded(?: by)?|welder(?: id)?|wid)\s+(.+)$/i);if(prior&&welder(prior[1])!==mt.welder)throw Error('Conflicting Welder IDs. Clarify which welds belong to each welder.');if(mt.body&&!prior)mt.body+=' welded by '+mt.welder;else if(!mt.body)commands.push({type:'setContext',cn:state.cn,cnNumber:numericCN,welder:mt.welder});state.welder=mt.welder;}if(mt.body){const base=parse((cnMatch?'CN-'+numericCN+' has ':'')+mt.body,state,rows,required,mtRows);if(base.review.length)throw Error(base.review[0].reason);if(sameSpool)for(const c of base.commands)if(c.type==='addBatch'||c.type==='addMt')c.cn=state.cn;commands.push(...base.commands);Object.assign(state,base.context);}for(const item of mt.items)commands.push({type:'addMt',cn:required&&!rules.mt.cn&&numericCN===undefined&&!sameSpool?'':state.cn,cnNumber:numericCN,welder:required&&!rules.mt.welder&&!spokenWid?'':state.welder,...item});continue;}
const batchStart=commands.length;let w=part.match(/(?:,?\s*)\b(?:(all(?: of them)?|both)\s+)?(?:welded(?: by)?|welder(?: id)?|wid)\s+(.+)$/i);if(w){state.welder=welder(w[2]);part=part.slice(0,w.index).trim();}
part=part.replace(/^add\s+/i,'').replace(/[,; ]+$/,'');if(!state.cn&&rules.xf.cn)throw Error('CN# is required for XF welds on this job.');
if(!part){if(w&&w[1])throw Error('Specify the weld quantity for this welder assignment.');if(expectsBatch)throw Error('Complete the weld quantity, size and schedule.');if(!cnMatch&&!w)throw Error('Clarify this instruction.');commands.push({type:'setContext',cn:state.cn,cnNumber:numericCN,welder:state.welder});continue;}
part=countingAloud(part);
const shared=part.match(/^(\d+)\s+welds?\s*[,;]?\s*(both|all)\s+(?:are\s+)?(.+)$/i);
if(shared){if(/^both$/i.test(shared[2])&&Number(shared[1])!==2)throw Error('Both means 2 welds. Clarify the weld quantity.');part=shared[1]+' '+shared[3];}
part=part.replace(/^(\d+)\s+welds?\s*(?:at\s+|,\s*)(?=\d)/i,'$1 ');
part=part.replace(/\bwelds?\s+(?=\d)/gi,'welds and ');
// A comma between quantity and an explicitly inch-labelled size is speech punctuation.
part=part.replace(/(^|\band\s+|,\s*)(\d+)\s*,\s*(?=\d+(?:\.\d+)?\s*(?:"|inch))/gi,'$1$2 ');
const groups=part.split(/\s+and\s+|\s*,\s*/i);for(const group of groups){const g=group.match(/^(a|an|\d+)\s+(?:((?:\d+\s+)?\d+\/[1-9]\d*|\d+(?:\.\d+)?)\s*(?:"|inch)\s*)?(?:(?:(?:sch(?:edule)?)\s*)?(STD|XS|XH|XXS|XXH|\d{1,3}S?)\s*)?(?:welds?)?$/i);if(!g||!g[2]&&!/\bwelds?\b/i.test(group))throw Error('Clarify quantity, size and schedule; no rows were added.');const count=/^(?:a|an)$/i.test(g[1])?1:Number(g[1]);if(count<1||count>1000)throw Error('Use a quantity from 1 to 1000.');
// "1 1/2 inch" could be one 1/2" weld or a 1 1/2" weld with no quantity; never guess.
if(/^\d+$/.test(g[1])&&/^\d+\/\d+$/.test(g[2]))throw Error('Clarify "'+g[1]+' '+g[2]+'": put the quantity first, e.g. 1 1 1/2 inch, or use Add welds for '+g[2]+'" welds.');
commands.push({type:'addBatch',cn:required&&!rules.xf.cn&&numericCN===undefined&&!sameSpool?'':state.cn,cnNumber:numericCN,welder:required&&!rules.xf.welder&&!spokenWid?'':state.welder,count,size:g[2]||'',schedule:scheduleOf(g[3]||'')});}
if(w&&/^both$/i.test(w[1]||'')){const total=commands.slice(batchStart).reduce((n,c)=>n+c.count,0);if(total!==2)throw Error('The transcript says both, but lists '+total+' welds. Clarify which welds were welded by '+state.welder+'; use all welded by '+state.welder+' if it applies to every weld.');}
}
if(!commands.length)throw Error('No complete instruction was found.');for(const c of commands)if(c.type==='addBatch'||c.type==='addMt')M.requireFields({...c,type:c.fittingType},c.type==='addMt'?rules.mt:rules.xf);return {commands,review:[],context:state};
}catch(e){return fail(e.message);}}

// Review extraction never creates records. Only explicit user confirmation can apply these drafts.
function reviewDraft(input,context={},required=null){
 const source=String(input||'').slice(0,20000),rules=M.requirements(required);
 if(/\b(?:change|set|move|remove|delete|undo|like the last)\b/i.test(source))return {mode:'wording',groups:[]};
 let s=spokenForms(normalize(source)).replace(/\bCN\s*,\s*(?=\d)/gi,'CN-');
 const trailing=s.match(/^(.+?)\s+(?:on\s+)?CN\s*[- ]?\s*(\d+[a-z]*)\b(.*)$/i);
 if(trailing&&!/\bCN\b/i.test(trailing[1])&&!/\bCN\b/i.test(trailing[3]))s='CN-'+trailing[2]+' has '+trailing[1]+' '+trailing[3];
 const parts=s.split(/(?=\bCN\b)/i).map(x=>x.trim()).filter(Boolean),groups=[],state={...context};
 for(let part of parts){
  const original=part;let cn='',wid='',cnInherited=false,widInherited=false,widUncertain=false;
  // Keep complete additions identical to typed parsing before extracting partial fields.
  const parsed=parse(original,state,[],required),additions=parsed.commands.filter(c=>c.type==='addBatch'||c.type==='addMt');
  if(!parsed.review.length&&additions.length){
   for(const c of additions)groups.push({kind:c.type==='addMt'?'mt':'xf',cn:c.cn,welder:c.welder,count:String(c.count),size:c.size,schedule:c.schedule,fittingType:c.fittingType||'',source:original,unresolved:'',confirmed:false,uncertain:{},inherited:{cn:!/^CN\b/i.test(original)&&!!c.cn,welder:!/\b(?:welded|welder|wid)\b/i.test(original)&&!!c.welder&&c.welder===state.welder}});
   Object.assign(state,parsed.context);continue;
  }
  if(/^CN\b/i.test(part)){const head=part.match(/^CN\s*[- ]?\s*([^\s,;]+)/i);if(head&&/^(?:\d+[a-z]*|\?)$/i.test(head[1])){cn=head[1]==='?'?'?':'CN-'+head[1].toUpperCase();part=part.slice(head[0].length).replace(/^\s*(?:has\b|[,;])\s*/i,'');}else part=part.includes(' has ')?part.slice(part.indexOf(' has ')+5):part;}
  else if(state.cn){cn=state.cn;cnInherited=true;}
  const assignment=part.match(/\b(?:welded(?: by)?|welder(?: id)?|wid)\s+(.+?)\s*[.;]*$/i);
  if(assignment){try{wid=welder(assignment[1]);}catch{widUncertain=true;}part=part.slice(0,assignment.index).trim();}
  else{const bare=part.match(/\s+([A-Z]{2}|[A-Z]\s+[A-Z])\s*[.;]*$/);if(bare&&!/^(?:XS|XH|SW|MT)$/.test(bare[1].replace(/\s/g,''))){wid=bare[1].replace(/\s/g,'');part=part.slice(0,bare.index);}else if(state.welder){wid=state.welder;widInherited=true;}}
  if(cn&&!cnInherited)state.cn=cn;if(wid&&!widInherited&&!widUncertain)state.welder=wid;
  try{part=countingAloud(part);}catch{return {mode:'wording',groups:[]};}
  part=mtDescriptions(part).replace(/\bW\s+O\s+L\b/gi,'WOL').replace(/\bT\s+O\s+L\b/gi,'TOL').replace(/\bS\s+W\b/gi,'SW').replace(/\bweld[ -]*olets?\b/gi,'WOL').replace(/\bthread[ -]*olets?\b|\bthread(?:y|ys|ies)\b/gi,'TOL').replace(/\bsocket[ -]*welds?\b/gi,'SW').replace(/\bwelds?\s+(?=\d)/gi,'welds and ').replace(/(\d)\s*,\s*(?=\d+(?:\.\d+)?\s*inch)/gi,'$1 ');
  const chunks=part.split(/\s+(?:and|plus|with)\s+|\s*[,;]\s*/i).map(x=>x.trim()).filter(Boolean);
  for(const chunk of chunks.length?chunks:['']){
   let remaining=chunk.replace(/^[.\s]+|[.\s]+$/g,'').replace(/^add\s+/i,'');const fitting=remaining.match(/\b(TOL|WOL|SW|D-Leg|Dummy Leg|Lifting Lug|Manway|Plate|Slip-On Flange|Fillet Weld)s?\b/i),kind=fitting||/\b(?:MT|fittings?)\b/i.test(remaining)?'mt':'xf',r=rules[kind];
   const g={kind,cn:required&&cnInherited&&!r.cn?'':cn,welder:required&&widInherited&&!r.welder?'':wid,count:'',size:'',schedule:'',fittingType:fitting?M.fittingType(fitting[1]):'',source:original,unresolved:'',confirmed:false,uncertain:widUncertain?{welder:'The welder assignment was not understood.'}:{},inherited:{cn:cnInherited,welder:widInherited}};
   // Accept fully understood groups through the strict parser first.
   const complete=parse((cn?cn+' has ':'')+chunk+(wid?' welded by '+wid:''),{},[],{xf:{...rules.xf,cn:false,welder:false,size:false,schedule:false},mt:{...rules.mt,cn:false,welder:false,size:false,schedule:false,type:false}});
   const adds=complete.commands.filter(c=>c.type==='addBatch'||c.type==='addMt');
   if(!complete.review.length&&adds.length===1){const c=adds[0];Object.assign(g,{count:String(c.count),size:c.size,schedule:c.schedule,fittingType:c.fittingType||'',kind:c.type==='addMt'?'mt':'xf'});remaining='';}
   else{
    const sizeMatch=remaining.match(/((?:\d+\s+)?\d+\/[1-9]\d*|\d+(?:\.\d+)?)\s*(?:inch|\")/i);
    if(sizeMatch){const before=remaining.slice(0,sizeMatch.index).trim(),qty=before.match(/^(a|an|\d+)\s*$/i);g.size=sizeMatch[1];if(qty)g.count=/^a/i.test(qty[1])?'1':qty[1];remaining=remaining.slice(sizeMatch.index+sizeMatch[0].length);if(before&&!qty)g.unresolved=before;
     if(!before&&/^\d+\s+\d+\//.test(g.size)){g.uncertain.count='Quantity and fractional size are ambiguous.';g.uncertain.size='Confirm the fractional size.';g.size='';}
    }else{const qty=remaining.match(/^(a|an|\d+)\b/i);if(qty){g.count=/^a/i.test(qty[1])?'1':qty[1];remaining=remaining.slice(qty[0].length);}}
    const schedule=remaining.match(/\b(?:(?:schedule|sch)\s*)?(STD|XS|XH|XXS|XXH|[369]M|\d{1,3}S?)\b/i);if(schedule){try{g.schedule=kind==='mt'?M.mtSchedule(schedule[1]):M.schedule(schedule[1]);remaining=remaining.slice(0,schedule.index)+remaining.slice(schedule.index+schedule[0].length);}catch{}}
    remaining=remaining.replace(/\b(?:Slip-On Flanges?|Fillet Welds?|D-Legs?|Dummy Legs?|Lifting Lugs?|Manways?|Plates?|welds?|TOLs?|WOLs?|SWs?|MT\s+fittings?)\b/gi,'').trim();g.unresolved=[g.unresolved,remaining].filter(Boolean).join(' ');
   }
   if(/\bboth\b/i.test(chunk)&&g.count&&g.count!=='2')g.uncertain.count='Both means two. Confirm the quantity.';groups.push(g);
  }
 }
 if(!groups.length)groups.push({kind:'xf',cn:'',welder:'',count:'',size:'',schedule:'',fittingType:'',source,unresolved:source,confirmed:false,uncertain:{},inherited:{}});
 return groups.length>100?{mode:'wording',groups:[]}:{mode:'fields',groups};
}
function reviewIssues(g,rules){const r=rules[g.kind==='mt'?'mt':'xf'],issues={...(g.uncertain||{})};for(const [key,name]of [['cn','CN#'],['welder','WID'],['size','Size'],['schedule','Schedule']])if(r[key]&&!String(g[key]||'').trim())issues[key]=name+' is required for this job.';
 if(!/^\d+$/.test(String(g.count))||Number(g.count)<1||Number(g.count)>1000)issues.count='Enter a quantity from 1 to 1000.';
 for(const [key,check]of [['size',M.size],['schedule',g.kind==='mt'?M.mtSchedule:M.schedule],['cn',v=>{if(v.length>160||/[\x00-\x1f]/.test(v))throw Error('Enter a valid CN#.');}],['welder',v=>{if(v.length>160||/[\x00-\x1f]/.test(v))throw Error('Enter a valid WID.');}]])try{check(String(g[key]||'').trim());}catch(e){issues[key]=e.message;}
 if(g.kind==='mt'){if(r.type&&!g.fittingType)issues.fittingType='Choose the fitting type.';else if(!['',...M.FITTING_TYPES].includes(g.fittingType||''))issues.fittingType='Choose a valid MT description.';}
 return issues;
}
function reviewCommands(draft,required){if(draft.mode!=='fields'||!Array.isArray(draft.groups)||!draft.groups.length||draft.groups.length>100)throw Error('Review the instruction wording.');const rules=M.requirements(required);return draft.groups.map(g=>{const issues=reviewIssues(g,rules);if(Object.keys(issues).length)throw Error('Check the highlighted fields.');if(g.unresolved&&!g.confirmed)throw Error('Confirm the unrecognized wording for each highlighted group.');return {type:g.kind==='mt'?'addMt':'addBatch',cn:String(g.cn||'').trim(),cnNumber:String(g.cn||'').trim().match(/^CN-(\d+[a-z]*)$/i)?.[1],count:Number(g.count),size:String(g.size||'').trim(),schedule:String(g.schedule||'').trim(),welder:String(g.welder||'').trim(),...(g.kind==='mt'?{fittingType:g.fittingType||''}:{})};});}
return {parse,normalize,reviewDraft,reviewIssues,reviewCommands};
});
