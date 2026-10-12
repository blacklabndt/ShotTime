import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{
 const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));const html=await loadApp();
 await page.addInitScript(()=>{if(!localStorage.getItem('shottime.settings'))localStorage.setItem('shottime.settings',JSON.stringify({schemaVersion:2,source:{mode:'manual',activity:26},'film.small':'crfield','film.large':'crfield'}));});
 await page.goto('https://shottime.local/');
 assert.equal(await page.locator('.shot[data-film="crfield"]').count(),109,'Field CR available in both belts');
 const row=page.locator('.shot[data-size="4"][data-schedule="40 / STD"]'),seconds=async()=>Number(await row.getAttribute('data-seconds'));
 const before=await seconds();assert.equal(await page.locator('#field-pmt-4').getAttribute('step'),'10');
 await page.locator('#field-pmt-4').fill('50');assert.ok(await seconds()<before);
 await page.locator('#field-pmt-4').dispatchEvent('change');await page.reload();assert.equal(await page.locator('#field-pmt-4').inputValue(),'50');
 assert.match(await page.evaluate(()=>makePrintDocument()),/Field CR<br>estimate<br>PMT 50/);
 await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();
 await page.locator('#custom-film').selectOption('crfield');assert.equal(await page.locator('#custom-density').isVisible(),false);assert.equal(await page.locator('#custom-pmt').isVisible(),true);assert.equal(await page.locator('#custom-dose').isVisible(),false);
 await page.locator('#custom-steel').fill('.474');await page.locator('#custom-sfd').fill('4.625');await page.locator('#custom-pmt').fill('50');
 await page.locator('#custom-form').evaluate(f=>f.requestSubmit());assert.equal(await page.locator('#custom-error').textContent(),'');
 const expected=await row.locator('.time').textContent();assert.equal(await page.locator('#custom-time').textContent(),expected);
 assert.match(await page.locator('#custom-summary').textContent(),/PMT 50/);assert.match(await page.locator('#custom-factor').textContent(),/estimate/i);
 await page.getByText('Saved setups',{exact:true}).click();await page.locator('#custom-preset-name').fill('Field reference');await page.locator('#custom-save').click();
 await page.reload();await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.getByText('Saved setups',{exact:true}).click();await page.locator('#custom-presets').selectOption('0');await page.locator('#custom-load').click();assert.equal(await page.locator('#custom-pmt').inputValue(),'50');assert.equal(await page.locator('#custom-film').inputValue(),'crfield');
 await page.locator('#custom-pmt').fill('45');await page.locator('#custom-form').evaluate(f=>f.requestSubmit());assert.match(await page.locator('#custom-error').textContent(),/steps of 10/);
 assert.deepEqual(errors,[]);console.log('CR field UI controls, print, custom parity, persistence and validation passed');
}finally{await browser.close();}
