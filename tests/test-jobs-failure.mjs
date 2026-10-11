import assert from 'node:assert/strict';import {chromium} from 'playwright';import {loadApp} from './load-app.mjs';import {beginJob,finishJob,instruction,submitInstruction} from './notes-actions.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});try{
const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');const notes=async()=>{await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();};await notes();await beginJob(p);await p.getByLabel('LSD',{exact:true}).fill('Failures');await finishJob(p);
const first=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).selectedListId);
await p.evaluate(()=>closeTopSheet());await p.getByRole('button',{name:'Add daily list',exact:true}).click();await p.getByRole('button',{name:'Create daily list',exact:true}).click();await (await instruction(p)).fill('CN-1 has two 2 inch STD welds');await submitInstruction(p);
// A stopped native callback can target another day without changing the selected daily list.
const session={available:true,id:'job-voice',listId:first,state:'stopped',events:[{text:'Unknown CN has one 2 inch STD weld unknown welder'}]};
await p.evaluate(s=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='shottime.notes')throw Error('full');return window.originalSetItem.call(this,k,v);};ShotNotesUI.receiveVoice(JSON.stringify(s));},session);
assert.match(await p.locator('#notes-save-status').textContent(),/Not saved/);
await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),session);
const disk=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')));assert.equal(disk.jobs[0].nextSequence,3);
await (await instruction(p)).fill('CN-3 has one 2 inch STD weld');await submitInstruction(p);assert.match(await p.locator('#notes-message').textContent(),/Retry saving/);
await p.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});await p.locator('#notes-retry').click();
const lib=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')));assert.equal(lib.jobs[0].nextSequence,4);assert.equal(lib.lists.find(l=>l.id===first).rows[0].sequence,3);assert.equal(lib.lists.flatMap(l=>l.rows).length,3);
await p.reload();await notes();await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),session);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).jobs[0].nextSequence),4);
await p.evaluate(()=>closeTopSheet());assert.equal(await p.getByRole('button',{name:'Delete job',exact:true}).count(),0);await p.getByRole('button',{name:'Job settings',exact:true}).click();await p.getByRole('button',{name:'Delete job',exact:true}).click();await p.locator('dialog').getByRole('button',{name:'Delete job',exact:true}).click();await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),session);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).lists.length),0);assert.equal(await p.getByRole('button',{name:'Create job',exact:true}).count(),1);
assert.deepEqual(errors,[]);console.log('PASS: background-list voice, failed save, staged replay, retry, reload and deleted-job callbacks');
}finally{await b.close();}
