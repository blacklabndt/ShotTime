import {beginJob,finishJob} from './notes-actions.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {loadApp} from './load-app.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();await beginJob(p);await p.getByLabel('LSD',{exact:true}).fill('Bunker A');await finishJob(p);

const listId=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).selectedListId);
const snapshot={available:true,id:'wave',listId,state:'listening',events:[]};
await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),snapshot);
const before=await p.evaluate(()=>localStorage.getItem('shottime.notes'));
await p.evaluate(()=>{for(let i=0;i<40;i++)ShotNotesUI.receiveLevel(i%2?.8:.2);});
assert.equal(await p.locator('.notes-wave-bar').count(),40);
assert.equal(await p.getByRole('button',{name:'Stop recording',exact:true}).isEnabled(),true);
assert.equal(await p.locator('.notes-wave-bar').last().evaluate(e=>e.style.height),'67.6%');
assert.equal(await p.evaluate(()=>localStorage.getItem('shottime.notes')),before);
await p.screenshot({path:'build/microphone-waveform.png',animations:'disabled'});
await p.waitForTimeout(550);
assert.equal(await p.locator('.notes-wave-bar').last().evaluate(e=>e.style.height),'2%');
await p.evaluate(()=>ShotNotesUI.receiveLevel(NaN));
assert.equal(await p.locator('.notes-wave-bar').last().evaluate(e=>e.style.height),'2%');
await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify({...s,state:'stopping'})),snapshot);
assert.equal(await p.locator('.notes-wave-bar').count(),0);
await p.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),snapshot);
assert.equal(await p.locator('.notes-wave-bar').last().evaluate(e=>e.style.height),'2%');
assert.deepEqual(errors,[]);
console.log('PASS: live waveform, unchanged storage, accessible Stop, stale-feed clearing, processing and restart');
}finally{await b.close();}
