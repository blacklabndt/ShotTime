import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const root=new URL('../',import.meta.url);let html=await fs.readFile(new URL('assets/index.html',root),'utf8');for(const [m,f] of [['/*__TECHNIQUES__*/','techniques.json'],['/*__CALCULATOR__*/','calculator.js']]){const x=await fs.readFile(new URL('assets/'+f,root),'utf8');html=html.replace(m,()=>x);}
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY,args:['--no-sandbox']});const errors=[];
async function open(seed){const context=await browser.newContext();await context.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));if(seed)await context.addInitScript(s=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('shottime.settings',s);},JSON.stringify(seed));const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto('https://shottime.local/');return page;}
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings')));
const factorsAt=page=>page.evaluate(()=>({...factors}));
// Pre-release records without schemaVersion are ignored: factors, film choice and source start fresh.
let page=await open({'source':{mode:'manual',activity:26},'film.small':'d4','factor.baseline-six-v1.3.ix50':2,'factor.agfa-densities-v1.3.d4':1.3,'weld.original-adjusted-v3.3.ix50.3.40 / STD':2});
assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));assert.equal(await page.evaluate(()=>activeCi),null);assert.equal(await page.locator('#film-small').inputValue(),'ix50');
// Film factors are saved per density as factor.<density>.<film>, with the schema version, and survive reload.
await page.locator('#setup-panel>summary').click();await page.evaluate(()=>{document.querySelector('.settings').open=true;});
const set=[['2','d4','1.3'],['2.5','ix50','1.4'],['3','d5','0.5'],['3.5','mx125','2'],['4','t200','1.5']];
for(const [density,film,value] of set){await page.locator('#target-density').selectOption(density);await page.locator('#factor-'+film).fill(value);await page.locator('#calibration-form button[type="submit"]').click();assert.equal(await page.locator('#calibration-error').textContent(),'');}
let record=await stored(page);assert.equal(record.schemaVersion,1);for(const [density,film,value] of set)assert.equal(record['factor.'+density+'.'+film],Number(value));assert.ok(!Object.keys(record).some(k=>/densities-v1|baseline-six|original-adjusted|migrated/.test(k)));
await page.locator('#close-sheet').click();await page.reload();await page.locator('#setup-panel>summary').click();for(const [density,film,value] of set){await page.locator('#target-density').selectOption(density);assert.equal(await page.locator('#factor-'+film).inputValue(),value);assert.equal(Object.values(await factorsAt(page)).filter(v=>v!==1).length,1);}
// An out-of-range edit names the film and changes nothing.
await page.evaluate(()=>{document.querySelector('.settings').open=true;});await page.locator('#factor-d4').fill('0.05');await page.locator('#factor-ix50').fill('1.1');await page.locator('#calibration-form button[type="submit"]').click();assert.equal(await page.locator('#calibration-error').textContent(),'Enter a factor from 0.10 to 10.00 for Agfa D4. Nothing has been changed.');assert.equal(await page.evaluate(()=>document.activeElement.id),'factor-d4');assert.equal((await factorsAt(page)).ix50,1);
// Size/schedule factors are saved as weld.<density>.<film>.<size>.<schedule>.
await page.evaluate(()=>{$('weld-panel').open=true;});await page.locator('#weld-size').selectOption('3');await page.locator('#weld-schedule').selectOption({label:'40 / STD'});await page.locator('#weld-film').selectOption('mx125');await page.locator('#weld-density').selectOption('3');await page.locator('#weld-factor').fill('1.25');await page.locator('#weld-form button[type="submit"]').click();assert.equal((await stored(page))['weld.3.mx125.3.40 / STD'],1.25);
// Resets across all five densities persist.
for(const density of ['2','2.5','3','3.5','4']){await page.locator('#target-density').selectOption(density);await page.locator('#reset-factors').click();assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));}
await page.locator('#close-sheet').click();await page.reload();record=await stored(page);for(const [density,film] of set)assert.equal(record['factor.'+density+'.'+film],1);
// Stored factors outside 0.10–10.00 load as 1.00.
page=await open({schemaVersion:1,'source':{mode:'manual',activity:26},'factor.3.d5':0.05,'factor.3.t200':11,'factor.3.ix80':'2'});assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));assert.equal(await page.evaluate(()=>activeCi),26);
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: unversioned records ignored, per-density factor and size/schedule keys, schema version, persistence, range checks and resets across five densities.');
