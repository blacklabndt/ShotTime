import {undoLast} from './notes-actions.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {loadApp} from './load-app.mjs';import {instruction,submitInstruction} from './notes-actions.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{
 const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');
 const notes=async()=>{await p.locator('#app-menu-button').click();await p.locator('#nav-notes').click();};await notes();
 await p.getByRole('button',{name:'Create job',exact:true}).click({timeout:1500});
 await p.getByLabel('Client name',{exact:true}).fill('Job A');await p.getByLabel('LSD',{exact:true}).fill('Site A');await p.getByRole('button',{name:'Save job',exact:true}).click();
 const day=async date=>{await p.getByRole('button',{name:'Add daily list',exact:true}).click();await p.getByLabel('Date',{exact:true}).fill(date);await p.getByRole('button',{name:'Create daily list',exact:true}).click();};
 const add=async t=>{await (await instruction(p)).fill(t);await submitInstruction(p);};
 await day('2026-10-05');await add('Unknown CN has two 4 inch STD welds unknown welder');
 await p.evaluate(()=>closeTopSheet());await day('2026-10-06');await add('CN-3 has one 2 inch STD weld and one 2 inch Manway');
 assert.match(await p.locator('[data-weld-row]').textContent(),/XF-3/);
 await p.evaluate(()=>closeTopSheet());await p.locator('[data-daily-list-id]').filter({hasText:'2026-10-05'}).click();await add('CN-4 has one 2 inch STD weld');
 assert.match(await p.locator('[data-weld-row]').last().textContent(),/XF-4/);
 await undoLast(p);await add('CN-4 has one 2 inch STD weld');assert.match(await p.locator('[data-weld-row]').last().textContent(),/XF-5/);
 await p.reload();await notes();assert.equal(await p.locator('[data-weld-row]').count(),3);
 const lib=await p.evaluate(()=>JSON.parse(localStorage.getItem('shottime.notes')));assert.equal(lib.schemaVersion,7);assert.equal(lib.jobs[0].nextSequence,6);assert.equal(lib.jobs[0].nextMtSequence,2);
 assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: Jobs > daily lists, mixed numbering, older-day additions, undo gaps, reload and mobile layout');
}finally{await b.close();}
