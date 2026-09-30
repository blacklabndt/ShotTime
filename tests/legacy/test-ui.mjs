import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const raw=await fs.readFile(path.join(dir,'assets/index.html'),'utf8');
const data=await fs.readFile(path.join(dir,'assets/techniques.json'),'utf8');
const calculator=await fs.readFile(path.join(dir,'assets/calculator.js'),'utf8');
const html=raw.replace('/*__TECHNIQUES__*/',()=>data).replace('/*__CALCULATOR__*/',()=>calculator);
const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(process.env.CHROME_BINARY) options.executablePath=process.env.CHROME_BINARY;
const browser=await chromium.launch(options);
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));let requests=0;await page.route('**/*',route=>{requests++;return route.abort();});
async function choose(kind,values){
 const filter=page.locator('#'+kind+'-filter');
 if(!await filter.evaluate(n=>n.open))await filter.locator('summary').click();
 await filter.getByRole('button',{name:values==='all'?'All':'Clear',exact:true}).click();
 if(values!=='all')for(const v of values)await filter.locator('input[value="'+v+'"]').check();
 await filter.locator('summary').click();
}

await page.setContent(html);
assert.equal(await page.locator('.shot').count(),0);assert.ok(await page.locator('#print-list').isDisabled());
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#activity').fill('50');await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('button[form="activity-form"]').click();
assert.equal(await page.locator('.shot').count(),73);assert.equal(await page.locator('.belt-heading').count(),2);
assert.equal(await page.locator('.time').first().textContent(),'1m 29s');
const rowData=()=>page.locator('.shot').evaluateAll(ns=>ns.map(n=>({...n.dataset})));
const largeBefore=(await rowData()).filter(r=>Number(r.size)>=4);
for(const film of ['d4','mx125','ix50']){
 await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#film-small').selectOption(film);assert.equal(await page.locator('.shot').count(),73);
 assert.deepEqual((await rowData()).filter(r=>Number(r.size)>=4),largeBefore);
 assert.ok((await rowData()).filter(r=>Number(r.size)<=3).every(r=>r.film===film));
}
const smallBefore=(await rowData()).filter(r=>Number(r.size)<=3);
for(const film of ['t200','ix80','d5']){
 await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#film-large').selectOption(film);assert.equal(await page.locator('.shot').count(),73);
 assert.deepEqual((await rowData()).filter(r=>Number(r.size)<=3),smallBefore);
 assert.ok((await rowData()).filter(r=>Number(r.size)>=4).every(r=>r.film===film));
}
for(const r of await rowData())assert.equal(Number(r.seconds),Number(r.cs)/50);
await choose('pipe',['1','16']);await choose('schedule',['40','160']);assert.equal(await page.locator('.shot').count(),4);
assert.equal(await page.locator('.belt-heading').count(),2);
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#film-small').selectOption('mx125');assert.equal(await page.locator('.shot').count(),4);
const printHtml=await page.evaluate(()=>makePrintDocument());
const printPage=await browser.newPage();await printPage.setContent(printHtml);
assert.equal(await printPage.locator('tbody tr').count(),4);
assert.match(await printPage.locator('body').textContent(),/Carestream MX125/);
assert.match(await printPage.locator('body').textContent(),/50 Ci/);
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#activity').fill('100');assert.ok(await page.locator('#print-list').isDisabled());assert.equal(await page.evaluate(()=>makePrintDocument()),null);
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('button[form="activity-form"]').click();assert.equal(await page.locator('.shot[data-size="16"][data-schedule="160"] .time').textContent(),'23m 20s');
await choose('pipe',[]);assert.equal(await page.locator('.shot').count(),0);assert.ok(await page.locator('#print-list').isDisabled());assert.equal(await page.evaluate(()=>makePrintDocument()),null);
await choose('pipe',['1','3']);await choose('schedule',['40','STD']);assert.equal(await page.locator('.shot').count(),2);
await choose('pipe','all');await choose('schedule','all');
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#activity').fill('0');await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('button[form="activity-form"]').click();assert.equal(await page.locator('.shot').count(),0);
await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#activity').fill('50,5');await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('button[form="activity-form"]').click();assert.equal(await page.locator('.shot').count(),73);
for(const r of await rowData())assert.equal(Number(r.seconds),Number(r.cs)/50.5);
for(const width of [320,393,740]){
 await page.setViewportSize({width,height:852});await page.locator('#pipe-filter summary').click();await page.locator('#schedule-filter summary').click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.locator('#pipe-filter summary').click();await page.locator('#schedule-filter summary').click();
}
await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#film-small').selectOption('ix50');await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('#activity').fill('50');await page.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await page.locator('button[form="activity-form"]').click();
await fs.mkdir(path.join(dir,'verification'),{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));
await page.screenshot({path:path.join(dir,'verification/ShotTime-preview.png')});
await printPage.setContent(await page.evaluate(()=>makePrintDocument()));assert.equal(await printPage.locator('tbody tr').count(),73);
await printPage.pdf({path:path.join(dir,'verification/ShotTime-print-check.pdf'),format:'Letter',margin:{top:'.25in',bottom:'.25in',left:'.25in',right:'.25in'},printBackground:true});
assert.equal(requests,0);assert.deepEqual(errors,[]);
const savedContext=await browser.newContext();
await savedContext.route('https://shottime.local/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
let savedPage=await savedContext.newPage();await savedPage.goto('https://shottime.local/');
await savedPage.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await savedPage.locator('#film-small').selectOption('mx125');await savedPage.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await savedPage.locator('#film-large').selectOption('t200');
await savedPage.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await savedPage.locator('#activity').fill('75');await savedPage.evaluate(()=>{document.getElementById('setup-panel').open=true;document.getElementById('print-panel').open=true;});await savedPage.locator('button[form="activity-form"]').click();await savedPage.close();
savedPage=await savedContext.newPage();await savedPage.goto('https://shottime.local/');
assert.equal(await savedPage.locator('#film-small').inputValue(),'mx125');assert.equal(await savedPage.locator('#film-large').inputValue(),'t200');assert.equal(await savedPage.locator('#activity').inputValue(),'75');assert.equal(await savedPage.locator('.shot').count(),73);assert.match(await savedPage.locator('#input-hint').textContent(),/Saved activity/);
await savedPage.evaluate(()=>localStorage.setItem('shottime.film.small','d5'));await savedPage.reload();assert.equal(await savedPage.locator('#film-small').inputValue(),'ix50');assert.equal(await savedPage.locator('#film-large').inputValue(),'t200');
await savedContext.close();console.log('PASS: remembered film choices on reopening, invalid stored film fallback, activity and calculated list restored.');
await browser.close();console.log('PASS: both groups, all six films independently, 73 displayed rows, combined filters, stale/empty print prevention, 73-row print snapshot, mobile widths.');
