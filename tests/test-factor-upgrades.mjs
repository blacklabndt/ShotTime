import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const root=new URL('../',import.meta.url);let html=await fs.readFile(new URL('assets/index.html',root),'utf8');for(const [m,f] of [['/*__TECHNIQUES__*/','techniques.json'],['/*__CALCULATOR__*/','calculator.js']]){const x=await fs.readFile(new URL('assets/'+f,root),'utf8');html=html.replace(m,()=>x);}

const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY,args:['--no-sandbox']});
const context=await browser.newContext();await context.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));
await context.addInitScript(()=>{if(localStorage.getItem('upgrade-seeded'))return;localStorage.setItem('upgrade-seeded','1');localStorage.setItem('shottime.settings',JSON.stringify({'source':{mode:'manual',activity:26},'factor.original-adjusted-v3.3.ix50':2,'factor.original-adjusted-v3.3.d5':3,'factor.agfa-densities-v1.2.d4':1.3,'factor.fuji-densities-v1.2.5.ix50':1.4,'factor.carestream-densities-v1.4.t200':1.5}));});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('https://shottime.local/');
const migrated=await page.evaluate(()=>({ix:filmFactor('ix50'),d5:filmFactor('d5')}));assert.ok(Math.abs(migrated.ix-2/(650/495))<1e-12);assert.ok(Math.abs(migrated.d5-3/(494/220))<1e-12);
await page.reload();assert.deepEqual(await page.evaluate(()=>({ix:filmFactor('ix50'),d5:filmFactor('d5')})),migrated);
await page.locator('#setup-panel>summary').click();await page.locator('.settings>summary').click();
for(const [density,film,expected] of [['2','d4','1.3'],['2.5','ix50','1.4'],['4','t200','1.5']]){await page.locator('#target-density').selectOption(density);assert.equal(await page.locator('#factor-'+film).inputValue(),expected);}
for(const density of ['2','2.5','3','3.5','4']){await page.locator('#target-density').selectOption(density);await page.locator('#reset-factors').click();assert.ok(await page.evaluate(()=>Object.values(factors).every(v=>v===1)));}
await page.locator('#close-sheet').click();await page.reload();assert.equal(await page.evaluate(()=>filmFactor('t200')),1);
await page.locator('#setup-panel>summary').click();await page.locator('#target-density').selectOption('3');assert.equal(await page.locator('#factor-ix50').inputValue(),'1');assert.equal(await page.locator('#factor-d5').inputValue(),'1');await page.locator('#close-sheet').click();await page.reload();assert.equal(await page.evaluate(()=>filmFactor('ix50')),1);
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: old factors migrate once, current per-density factors survive, all five density resets persist without remigration.');
