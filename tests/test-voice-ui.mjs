import {beginJob,finishJob} from './notes-actions.mjs';
import {instruction,submitInstruction,exposePipe} from './notes-actions.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try {
 const page=await browser.newPage({viewport:{width:360,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('shottime.recordingMode','continuous'));const html=await loadApp();await page.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://shottime.local/');
 const notes=async()=>{await page.locator('#app-menu-button').click();await page.locator('#nav-notes').click();};await notes();
 await beginJob(page);await page.getByLabel('LSD',{exact:true}).fill('voice-test');await finishJob(page);
 const listId=await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).selectedListId);
 const session={available:true,id:'ui-session',listId,state:'listening',message:'Listening',route:'Phone microphone',events:[{text:'CN-47 has six four inch standard welds'}]};
 const receive=async()=>page.evaluate(s=>ShotNotesUI.receiveVoice(JSON.stringify(s)),session);
 await receive();assert.equal(await page.locator('[data-weld-row]').count(),0);assert.equal(await page.getByRole('button',{name:'Stop recording',exact:true}).isEnabled(),true);
 assert.equal(await page.locator('#notes-settings').isDisabled(),true);
 session.events.push({text:'welded by DD. CN-32 has two two inch XS welds welded by O.'});await receive();assert.equal(await page.locator('[data-weld-row]').count(),6);
 session.state='stopped';await receive();assert.equal(await page.locator('[data-weld-row]').count(),8);assert.equal(await page.locator('#notes-settings').isEnabled(),true);
 await page.reload();await notes();await receive();assert.equal(await page.locator('[data-weld-row]').count(),8);
 // Resolving a reviewed spoken undo must consume its native ID exactly once.
 session.id='review-undo';session.events=[{text:'CN-2 has some welds. Undo last batch.'}];await receive();
 assert.equal(await page.locator('[data-review-item]').nth(1).getByRole('button',{name:'Edit wording instead',exact:true}).count(),0);
 assert.match(await page.locator('[data-review-item]').nth(1).textContent(),/Waiting for earlier correction/);
 await page.getByRole('button',{name:'Edit wording instead',exact:true}).first().click();
 await submitInstruction(page);
 assert.match(await page.locator('[data-review-item]').first().textContent(),/CN-2/);
 await (await instruction(page)).fill('CN-2 has one four inch STD weld');await submitInstruction(page);
 await page.getByRole('button',{name:'Edit wording instead',exact:true}).click();await submitInstruction(page);
 assert.equal(await page.locator('[data-weld-row]').count(),8);await page.reload();await notes();await receive();assert.equal(await page.locator('[data-weld-row]').count(),8);
 // Cloud proposals require approval and can be remembered explicitly; replay cannot duplicate them.
 session.id='cloud-approved';session.deferred=true;session.suggestion='CN-55 has 2 4 inch STD welds welded by RG';session.events=[{text:'pipe fifty five two fours standard by RG'}];await receive();
 assert.equal(await page.locator('[data-weld-row]').count(),8);assert.equal(await page.locator('[data-review-item]').count(),1);
 await page.getByRole('button',{name:'Edit wording instead',exact:true}).click();await page.getByLabel('Remember this approved wording on this phone').check();await submitInstruction(page);
 assert.equal(await page.locator('[data-weld-row]').count(),10);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.approved-examples')).examples.length),1);
 await receive();assert.equal(await page.locator('[data-weld-row]').count(),10);assert.equal(await page.locator('[data-review-item]').count(),0);
 delete session.deferred;delete session.suggestion;
 // Native session must not be replaced when browser storage cannot save the rows.
 await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('full');};});
 session.id='failure-session';session.events=[{text:'CN-8 has one four inch STD weld'}];await receive();
 assert.match(await page.locator('#notes-save-status').textContent(),/not saved/i);
 assert.equal(await page.getByRole('button',{name:'Start recording',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});await page.locator('#notes-retry').click();
 assert.equal(await page.getByRole('button',{name:'Start recording',exact:true}).isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Start recording sends the list's welder IDs (current welder first) so Whisper can spell them.
 const starts=[];page.on('request',r=>{if(r.url().startsWith('shottime://voice/start'))starts.push(r.url());});
 await page.getByRole('button',{name:'Start recording',exact:true}).click();await page.waitForTimeout(300);
 assert.equal(starts.length,1);const ids=new URL(starts[0]).searchParams.get('ids').split(',');assert.ok(ids.includes('DD')&&ids.includes('O'),starts[0]);assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual(errors,[]);console.log('PASS: native voice UI, live rows, recording locks, replay, save-failure protection and welder-ID hints');
}finally{await browser.close();}
