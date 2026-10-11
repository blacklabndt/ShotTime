import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
try{
  const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://shottime.local/**',async r=>r.fulfill({body:await loadApp(),contentType:'text/html'}));
  await page.addInitScript(()=>{
    if(localStorage.getItem('seeded'))return;
    localStorage.setItem('seeded','1');
    localStorage.setItem('shottime.settings',JSON.stringify({schemaVersion:2,source:{mode:'manual',activity:26},'factor.3.t200':2,'factor.cr':4,'weld.cr.4.40 / STD':3}));
  });
  await page.goto('https://shottime.local/');
  assert.equal(await page.locator('#custom-film option[value=cr70]').count(),1);
  const open=async id=>{await page.locator('#app-menu-button').click();await page.locator(id).click();};
  await page.locator('#edit-source').click();
  await page.locator('#film-small+.film-options button[data-film="cr70"]').click();await page.locator('#film-large+.film-options button[data-film="cr70"]').click();
  const reference=page.locator('.shot[data-size="4"][data-schedule="40 / STD"]');
  for(const d of ['2','3','4']){
    await page.locator('#target-density').selectOption(d);
    assert.ok(Math.abs(Number(await reference.getAttribute('data-seconds'))-18.48)<1e-10);
  }
  assert.equal(await reference.locator('.time').textContent(),'18s');
  assert.ok(Number(await page.locator('.shot[data-size="4"][data-schedule="10"]').getAttribute('data-seconds'))>0);
  assert.equal(await page.locator('.shot[data-film="cr70"]').count(),109);
  assert.match(await page.locator('#note-large').textContent(),/70%.*T200.*3\.0/);
  await page.locator('#close-sheet').click();
  const print=await browser.newPage();await print.setContent(await page.evaluate(()=>makePrintDocument()));
  assert.deepEqual(await page.locator('.shot .time').allTextContents(),await print.locator('td.time').allTextContents());
  await print.close();
  await open('#nav-custom');await page.locator('#custom-film').selectOption('cr70');
  assert.ok(await page.locator('#custom-density').isHidden());
  await page.locator('#custom-steel').fill('.474');await page.locator('#custom-sfd').fill('4.625');
  await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),'18s');
  assert.doesNotMatch(await page.locator('#custom-summary').textContent(),/ · density /);
  await page.locator('#custom-sfd').fill('9.25');await page.locator('#custom-form button').click();
  assert.equal(await page.locator('#custom-time').textContent(),'1m 14s');
  await page.locator('#custom-units').selectOption('mm');await page.locator('#custom-form button').click();
  assert.equal(await page.locator('#custom-time').textContent(),'1m 14s');
  await page.getByText('Saved setups',{exact:true}).click();await page.locator('#custom-preset-name').fill('CR formula setup');await page.locator('#custom-save').click();
  await page.reload();await open('#nav-custom');await page.getByText('Saved setups',{exact:true}).click();
  await page.locator('#custom-presets').selectOption('0');await page.locator('#custom-load').click();
  assert.equal(await page.locator('#custom-film').inputValue(),'cr70');assert.ok(await page.locator('#custom-density').isHidden());
  await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),'1m 14s');
  await page.locator('#custom-film').selectOption('t200');assert.ok(await page.locator('#custom-density').isVisible());
  await open('#nav-calculator');await page.locator('#edit-source').click();
  await page.locator('#target-density').selectOption('3');await page.locator('.settings>summary').click();
  await page.locator('#factor-cr70').fill('1.5');await page.locator('#calibration-form button[type=submit]').click();
  assert.equal(await reference.locator('.time').textContent(),'28s');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings')));
  assert.equal(saved['factor.cr70'],1.5);assert.equal(saved['factor.cr'],4);assert.equal(saved['factor.3.t200'],2);
  await page.locator('#close-sheet').click();await page.reload();
  assert.equal(await reference.locator('.time').textContent(),'28s');
  await open('#nav-custom');await page.locator('#custom-film').selectOption('cr70');
  await page.locator('#custom-steel').fill('.474');await page.locator('#custom-sfd').fill('4.625');
  await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),'28s');
  for(const width of [320,393,740]){await page.setViewportSize({width,height:852});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);
  console.log('PASS: CR formula in both belts and Custom Shot, density-independent isolated factors, units, presets, print and narrow layout.');
}finally{await browser.close();}
