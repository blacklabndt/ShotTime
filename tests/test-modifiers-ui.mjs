import {beginJob,finishJob} from './notes-actions.mjs';
import assert from 'node:assert/strict';
import {instruction,submitInstruction} from './notes-actions.mjs';
import {chromium} from 'playwright';import {loadApp} from './load-app.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();await beginJob(p);await p.getByLabel('LSD',{exact:true}).fill('Bunker A');await finishJob(p);

const enter=async text=>{await (await instruction(p)).fill(text);await submitInstruction(p);};
await enter('CN-3 has 3 2 inch STD welds and a 2 inch 3M WOL welded by AA');
await enter('Change the last two welds to XH');
assert.match(await p.locator('#notes-confirmation').textContent(),/Updated XF-2, XF-3.*schedule XH/);
assert.equal(await p.locator('#notes-confirmation').getByRole('button',{name:'Undo',exact:true}).isEnabled(),true);
await p.locator('#notes-confirmation').getByRole('button',{name:'Undo',exact:true}).click();
const saved=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')).lists[0]);assert.deepEqual((await saved()).rows.map(r=>r.schedule),['STD','STD','STD']);
await enter('Change the last MT fitting to a one-inch 6M TOL');assert.match(await p.locator('#notes-confirmation').textContent(),/Updated MT-1.*size 1.*schedule 6M.*description TOL/);
await enter('Set all welders on CN-3 to DD');assert.ok([...(await saved()).rows,...(await saved()).mtRows].every(r=>r.welder==='DD'));await p.locator('#notes-confirmation').getByRole('button',{name:'Undo',exact:true}).click();assert.ok([...(await saved()).rows,...(await saved()).mtRows].every(r=>r.welder==='AA'));
await enter('Move the last weld to CN-4');assert.match(await p.locator('#notes-confirmation').textContent(),/Updated XF-3.*CN# CN-4/);assert.equal((await saved()).rows.at(-1).sequence,3);
await enter('Add two more welds like the last');assert.equal((await saved()).rows.length,5);await enter('Undo that');assert.equal((await saved()).rows.length,3);
await enter('Remove the last MT fitting');assert.match(await p.locator('#notes-confirmation').textContent(),/Removed MT-1/);await p.locator('#notes-confirmation').getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await saved()).mtRows.length,1);
await p.screenshot({path:'build/modifier-confirmation.png',animations:'disabled',fullPage:true});
assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
console.log('PASS: modifier entry, precise confirmations, inline Undo, atomic welder updates, numbering and mobile width');
}finally{await b.close();}
