import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {instruction} from './notes-actions.mjs';
import {loadApp} from './load-app.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{
 const p=await b.newPage({viewport:{width:360,height:800}});
 const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');
 await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();
 await p.getByRole('button',{name:'Create job',exact:true}).click();
 // This fallback allows the navigation regression to run against the old labels.
 await p.getByLabel(/^(Client name|Job name)$/).fill('Acme');await p.getByLabel('LSD',{exact:true}).fill('01-02-003-04');
 await p.getByRole('button',{name:'Save job',exact:true}).click();
 assert.equal(await p.evaluate(()=>closeTopSheet()),true,'Android Back must consume job navigation');
 assert.equal(await p.getByRole('button',{name:'Create job',exact:true}).count(),1);
 await p.locator('[data-job-id]').click();await p.getByRole('button',{name:'Add daily list',exact:true}).click();await p.getByRole('button',{name:'Create daily list',exact:true}).click();
 const id=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).selectedListId);
 await p.evaluate(id=>ShotNotesUI.receiveVoice(JSON.stringify({available:true,state:'listening',id:'back-test',listId:id,events:[]})),id);
 assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.match(await p.locator('#notes-message').textContent(),/Stop recording/);
 await p.evaluate(id=>ShotNotesUI.receiveVoice(JSON.stringify({available:true,state:'stopped',id:'back-test',listId:id,events:[]})),id);
 await p.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('full');};});
 await (await instruction(p)).fill('CN-7 has');
 assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.equal(await p.locator('#notes-settings').count(),1);
 await p.evaluate(()=>Storage.prototype.setItem=window.savedSetItem);await p.locator('#notes-retry').click();
 assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.equal(await p.getByRole('button',{name:'Add daily list',exact:true}).count(),1);
 await p.getByRole('button',{name:'Job settings',exact:true}).click();
 await p.getByLabel('Client name',{exact:true}).fill('Acme Energy');await p.getByLabel('Start date',{exact:true}).fill('2026-10-01');await p.getByRole('button',{name:'Save job settings',exact:true}).click();
 await p.getByRole('button',{name:'Job settings',exact:true}).click();assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.equal(await p.getByRole('button',{name:'Add daily list',exact:true}).count(),1);
 assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.equal(await p.locator('[data-job-id]').getAttribute('aria-label'),'Acme Energy - 01-02-003-04 - 2026-10-01');assert.equal(await p.evaluate(()=>closeTopSheet()),true);assert.equal(await p.locator('#calculator-screen').isVisible(),true);assert.equal(await p.evaluate(()=>closeTopSheet()),false);
 await p.reload();await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();assert.equal(await p.locator('[data-job-id]').getAttribute('aria-label'),'Acme Energy - 01-02-003-04 - 2026-10-01');
 await p.screenshot({path:'build/qc-client-jobs.png',fullPage:true});
 console.log('PASS: native Back callback, recording/save guards, dialogs, client labels and persisted start date');
}finally{await b.close();}
