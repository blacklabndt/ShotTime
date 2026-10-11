(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./notes-parser.js'):root.ShotNotesParser);if(typeof module==='object'&&module.exports)module.exports=api;else root.ShotNotesLearning=api;})(globalThis,function(P){
'use strict';const KEY='shottime.approved-examples';
const key=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
const contextKey=c=>JSON.stringify([c.cn||'',c.welder||'']);
function read(storage){const raw=storage.getItem(KEY);if(raw===null)return [];const data=JSON.parse(raw);if(data.schemaVersion!==1||!Array.isArray(data.examples)||data.examples.length>100||data.examples.some(e=>typeof e.source!=='string'||typeof e.instruction!=='string'||typeof e.context!=='string'))throw Error('Saved examples need recovery. Nothing was overwritten.');return data.examples;}
function remember(storage,source,instruction,context,rows=[],required=null,mtRows=[]){if(!source||source.length>20000||instruction.length>20000||P.parse(instruction,context,rows,required,mtRows).review.length)throw Error('Only complete approved instructions can be remembered.');const examples=read(storage).filter(e=>key(e.source)!==key(source)||e.context!==contextKey(context));examples.push({source,instruction,context:contextKey(context)});storage.setItem(KEY,JSON.stringify({schemaVersion:1,examples:examples.slice(-100)}));}
function suggest(storage,source,context){try{return read(storage).find(e=>key(e.source)===key(source)&&e.context===contextKey(context))?.instruction||null;}catch{return null;}}
function clear(storage){storage.setItem(KEY,JSON.stringify({schemaVersion:1,examples:[]}));}
return {remember,suggest,clear,read};});
