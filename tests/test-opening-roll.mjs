import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {loadApp} from './load-app.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{for(const reducedMotion of ['no-preference','reduce']){
 const page=await browser.newPage({viewport:{width:393,height:852},reducedMotion});const html=await loadApp();
 await page.addInitScript(()=>{localStorage.setItem('shottime.settings',JSON.stringify({schemaVersion:2,source:{mode:'manual',activity:26}}));window.rollSeen=[];new MutationObserver(()=>{for(const el of document.querySelectorAll('.opening-digit'))if(!el.dataset.seen){el.dataset.seen='1';window.rollSeen.push({digit:el.textContent,parent:el.parentElement.id||el.parentElement.className});}}).observe(document,{childList:true,subtree:true});});
 await page.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://shottime.local/');
 await page.waitForTimeout(650);
 const seen=await page.evaluate(()=>rollSeen);assert.equal(seen.length>0,reducedMotion==='no-preference');assert.ok(seen.every(x=>/^\d$/.test(x.digit)&&['source-number','time','value'].includes(x.parent)));
 assert.equal(await page.locator('.opening-digit').count(),0);assert.equal(await page.locator('#source-number').textContent(),'26 Ci');
 const count=seen.length;await page.evaluate(()=>render());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>rollSeen.length),count);assert.ok(!(await page.evaluate(()=>makePrintDocument())).includes('opening-digit'));
 await page.close();
}console.log('PASS: opening roll targets red digits only, keeps final values, cleans up, respects reduced motion and never replays on render/print');}finally{await browser.close();}
