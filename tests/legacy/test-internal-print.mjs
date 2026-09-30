import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=new URL('../',import.meta.url);
let html=await fs.readFile(new URL('assets/index.html',dir),'utf8');
for(const [marker,file] of [['/*__TECHNIQUES__*/','techniques.json'],['/*__CALCULATOR__*/','calculator.js']]){const data=await fs.readFile(new URL('assets/'+file,dir),'utf8');html=html.replace(marker,()=>data);}
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY,headless:true,args:['--no-sandbox']});
const p=await b.newPage();await p.route('https://shottime.local/**',r=>r.fulfill({contentType:'text/html',body:html}));await p.goto('https://shottime.local/');
await p.locator('#setup-panel>summary').click();await p.locator('#activity').fill('25');await p.locator('button[form="activity-form"]').click();
const q=await b.newPage({viewport:{width:816,height:1056}});
for(const font of ['small','medium','large']){
 await p.locator('#print-size').selectOption(font,{force:true});await q.setContent(await p.evaluate(()=>makePrintDocument()));
 assert.deepEqual(await q.locator('th').allTextContents(),['Pipe','Schedule','Time','Internal','Internaloffset']);
 assert.equal(await q.locator('tbody tr').count(),73);
 // First IX50 exposure = 4441 Ci.s / 25 Ci = 177.64 s. Round only after conversion.
 assert.deepEqual(await q.locator('tbody tr').first().locator('td').allTextContents(),['1"','40 / STD','3m 4s','—','—']);
 const shots=await p.locator('.shot').evaluateAll(ns=>ns.map(n=>({size:Number(n.dataset.size),time:Number(n.dataset.seconds)})));
 assert.deepEqual(await p.locator('.internal-value').allTextContents(),(await q.locator('td.internal').allTextContents()));assert.deepEqual(await p.locator('.offset-value').allTextContents(),(await q.locator('td.internal-offset').allTextContents()));
 const internal=await q.locator('td.internal').allTextContents(),offset=await q.locator('td.internal-offset').allTextContents();
 const seconds=s=>[...s.matchAll(/(\d+)([hms])/g)].reduce((n,m)=>n+Number(m[1])*({h:3600,m:60,s:1}[m[2]]),0);
 for(let i=0;i<73;i++){if(shots[i].size<6){assert.equal(internal[i],'—');assert.equal(offset[i],'—');}else{assert.equal(seconds(internal[i]),Math.round(shots[i].time/9));assert.equal(seconds(offset[i]),Math.ceil(shots[i].time*1.15/4));}}
 assert.ok(await q.locator('table').evaluate(t=>t.getBoundingClientRect().width<=276));
 assert.ok(await q.locator('td,th').evaluateAll(ns=>ns.every(n=>n.scrollWidth<=n.clientWidth+1)));
}
await q.screenshot({path:new URL('verification/internal-print.png',dir).pathname});
await p.setViewportSize({width:320,height:900});await p.locator('.has-internal').first().scrollIntoViewIfNeeded();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:new URL('verification/internal-ui.png',dir).pathname});await b.close();console.log('PASS: 73 printed rows, both conversions from unrounded times, three print sizes, foldable width and no cell overflow.');
