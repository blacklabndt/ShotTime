import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
const b=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const html=await loadApp();await p.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('https://shottime.local/');
 for(const [nav,section] of [['nav-notes','note-taker'],['nav-pipe-chart','pipe-chart'],['nav-custom','custom-shot'],['nav-code','code-calculator']]){
  await p.locator('#app-menu-button').click();await p.locator('#'+nav).click();
  assert.equal(await p.locator('#'+section).isVisible(),true);
  await p.locator('#app-menu-button').click();assert.equal(await p.evaluate(()=>closeTopSheet()),true);
  assert.equal(await p.locator('#'+section).isVisible(),true,'First Back closes navigation menu');
  assert.equal(await p.evaluate(()=>closeTopSheet()),true,'Back returns '+section+' to calculator');
  assert.equal(await p.locator('#calculator-screen').isVisible(),true);
  assert.equal(await p.locator('#'+section).isVisible(),false);
  assert.equal(await p.locator('#screen-label').textContent(),'Shot Time Calc');
  assert.equal(await p.locator('#nav-calculator').getAttribute('aria-current'),'page');
  assert.equal(await p.evaluate(()=>closeTopSheet()),false,'Only calculator root delegates to Android');
 }
 assert.deepEqual(errors,[]);console.log('PASS: Back from all four sections returns to Shot Time Calc, after closing overlays');
}finally{await b.close();}
