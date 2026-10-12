(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./notes-model.js'):root.ShotNotesModel,typeof module==='object'&&module.exports?require('./notes-jobs.js'):root.ShotNotesJobs);if(typeof module==='object'&&module.exports)module.exports=api;else root.ShotNotesStorage=api;})(globalThis,function(M,J){
'use strict';
const KEY='shottime.notes',empty=J.empty;
function validate(library){return J.validate(library);}
function validateLegacy(library){if(!library||library.schemaVersion!==4||!Array.isArray(library.lists))throw Error('Unsupported or damaged notes storage.');const ids=new Set();for(const l of library.lists){M.validateList(l);if(ids.has(l.id))throw Error('Duplicate list IDs.');ids.add(l.id);}if(library.selectedListId!==null&&!ids.has(library.selectedListId))throw Error('Selected list is missing.');if(library.deletedLists!==undefined&&(!Array.isArray(library.deletedLists)||library.deletedLists.length>50||library.deletedLists.some(id=>typeof id!=='string')))throw Error('Invalid deleted lists.');return true;}
function load(storage){let raw=null;try{raw=storage.getItem(KEY);if(raw===null)return {library:empty(),warning:'',rawBackup:null};let library=JSON.parse(raw);if(library.schemaVersion===1){if(!Array.isArray(library.lists))throw Error('Invalid legacy lists.');for(const l of library.lists){if(!Array.isArray(l.history))throw Error('Invalid legacy history.');for(const state of [l,...l.history]){if(['mtRows','mtStart','nextMtSequence','mtFormat'].some(k=>k in state))throw Error('Unexpected MT fields in legacy data.');Object.assign(state,M.mtNumbering());}}library.schemaVersion=2;}if(library.schemaVersion===2){if(!Array.isArray(library.lists))throw Error('Invalid legacy lists.');for(const l of library.lists){if(!Array.isArray(l.history))throw Error('Invalid legacy history.');for(const state of [l,...l.history]){if(!Array.isArray(state.mtRows))throw Error('Invalid legacy MT records.');for(const row of state.mtRows){if(!Object.prototype.hasOwnProperty.call(row,'welder'))row.welder='';}}}library.schemaVersion=3;}if(library.schemaVersion===3){if(!Array.isArray(library.lists))throw Error('Invalid lists.');for(const l of library.lists){if(!Array.isArray(l.history))throw Error('Invalid history.');for(const state of [l,...l.history]){if('fieldRequirements' in state&&state.fieldRequirements!==null)throw Error('Unexpected job fields.');state.fieldRequirements=null;}}library.schemaVersion=4;}if(library.schemaVersion===4){validateLegacy(library);library=J.fromLegacy(library);}if(library.schemaVersion===5||library.schemaVersion===6)library=J.fromLegacy(library);validate(library);for(const l of library.lists){for(const state of [l,...l.history]){for(const row of state.rows)row.schedule=M.schedule(row.schedule);for(const row of state.mtRows)row.schedule=M.mtSchedule(row.schedule);}l.history=M.trimHistory(l.history);}return {library,warning:'',rawBackup:null};}catch(e){return {library:empty(),warning:'Saved notes could not be read. The original data has been preserved. Export recovery data before replacing it.',rawBackup:raw};}}
function save(storage,library){validate(library);storage.setItem(KEY,JSON.stringify(library));}
const MAX_BACKUP=20000000;
function backup(library){validate(library);return JSON.stringify({format:'rt-handbook-notes',backupVersion:1,createdAt:new Date().toISOString(),notes:library});}
function readBackup(text){
 if(typeof text!=='string'||text.length>MAX_BACKUP)throw Error('Backup file is too large.');
 try{const data=JSON.parse(text.replace(/^\uFEFF/,''));let notes=data;
  if(data.format!==undefined){if(data.format!=='rt-handbook-notes'||data.backupVersion!==1)throw Error('Unsupported backup version.');notes=data.notes;}
  const result=load({getItem:()=>JSON.stringify(notes)});if(result.warning)throw Error(result.warning);return result.library;
 }catch(e){throw Error('Invalid or unsupported backup file. Current notes have not been changed.');}
}
function cell(value){const s=String(value);if(/[\x00-\x1f\x7f]/.test(s))throw Error('Export fields must not contain tabs or newlines.');return /^[=+\-@]/.test(s)||/^0\d+$/.test(s)?"'"+s:s;}
function toTSV(rows){return rows.map(r=>[r.cn,M.formatId(r.sequence,r.xfFormat),r.welder,(r.size?r.size+'"':''),M.schedule(r.schedule)].map(cell).join('\t')).join('\r\n');}
// Excel shows a CSV's guard apostrophe literally, so leading zeroes are written as the text formula ="007"
// (shown as 007); formula-like values keep the apostrophe because neutralizing them matters more.
function csvCell(value){const s=String(value);return /^0\d+$/.test(s)?'="'+s+'"':cell(s);}
const CSV_COLUMNS={xf:{cn:'CN#s',number:'XF#s',welder:'WID',size:'Weld Size',schedule:'Weld Schedule'},mt:{cn:'CN#',number:'MT#',welder:'WID',size:'Size',schedule:'Schedule/Description'}};
function exportOrder(value){const out={};for(const kind of ['xf','mt']){const keys=Object.keys(CSV_COLUMNS[kind]),order=value?.[kind],fields=Array.isArray(order)?order.filter(k=>k!=='spacer'):[];out[kind]=Array.isArray(order)&&order.length<=25&&fields.length===keys.length&&new Set(fields).size===keys.length&&fields.every(k=>keys.includes(k))?[...order]:keys;}return out;}
function toCSV(rows,mtRows=[],mtFormat={prefix:'MT',separator:'-',width:0},preferences,spoolSpacing=false){
 const order=exportOrder(preferences),headers=order.xf.map(k=>CSV_COLUMNS.xf[k]??''),right=order.mt.map(k=>CSV_COLUMNS.mt[k]??''),records=[mtRows.length?[...headers,'',...right]:headers],pairs=[];
 const append=(xf,mt)=>{for(let i=0;i<Math.max(xf.length,mt.length);i++)pairs.push([xf[i],mt[i]]);};
 const spaced=items=>{const out=[];for(let i=0;i<items.length;i++){if(i&&items[i].cn!==items[i-1].cn)out.push(null);out.push(items[i]);}return out;};
 append(spoolSpacing?spaced(rows):rows,spoolSpacing?spaced(mtRows):mtRows);
 for(const [r,m]of pairs){const xf=r?{cn:r.cn,number:M.formatId(r.sequence,r.xfFormat),welder:r.welder,size:r.size,schedule:M.schedule(r.schedule)}:{},mt=m?{cn:m.cn,number:M.formatId(m.sequence,mtFormat),welder:m.welder,size:m.size,schedule:[M.mtSchedule(m.schedule),m.type].filter(Boolean).join(' ')}:{},left=order.xf.map(k=>xf[k]??'');records.push(mtRows.length?[...left,'',...order.mt.map(k=>mt[k]??'')]:left);}
 return '\ufeff'+records.map(record=>record.map(value=>'"'+csvCell(value).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
return {KEY,load,save,toTSV,toCSV,validate,exportOrder,CSV_COLUMNS,backup,readBackup,MAX_BACKUP};
});
