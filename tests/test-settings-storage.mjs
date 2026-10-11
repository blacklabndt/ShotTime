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
let record=await stored(page);assert.equal(record.schemaVersion,2);for(const [density,film,value] of set)assert.equal(record['factor.'+density+'.'+film],Number(value));assert.ok(!Object.keys(record).some(k=>/densities-v1|baseline-six|original-adjusted|migrated/.test(k)));
await page.locator('#close-sheet').click();await page.reload();await page.locator('#setup-panel>summary').click();for(const [density,film,value] of set){await page.locator('#target-density').selectOption(density);assert.equal(await page.locator('#factor-'+film).inputValue(),value);assert.equal(Object.values(await factorsAt(page)).filter(v=>v!==1).length,1);}
// An out-of-range edit names the film and changes nothing.
await page.evaluate(()=>{document.querySelector('.settings').open=true;});await page.locator('#factor-d4').fill('0.05');await page.locator('#factor-ix50').fill('1.1');await page.locator('#calibration-form button[type="submit"]').click();assert.equal(await page.locator('#calibration-error').textContent(),'Enter a factor from 0.10 to 10.00 for Agfa D4. Nothing has been changed.');assert.equal(await page.evaluate(()=>document.activeElement.id),'factor-d4');assert.equal((await factorsAt(page)).ix50,1);
// Size/schedule factors are saved as weld.<density>.<film>.<size>.<schedule>.
await page.evaluate(()=>{$('weld-panel').open=true;});await page.locator('#weld-size').selectOption('3');await page.locator('#weld-schedule').selectOption({label:'40 / STD'});await page.locator('#weld-film').selectOption('mx125');await page.locator('#weld-density').selectOption('3');await page.locator('#weld-factor').fill('1.25');await page.locator('#weld-form button[type="submit"]').click();assert.equal((await stored(page))['weld.3.mx125.3.40 / STD'],1.25);
// Resets across all five densities persist.
for(const density of ['2','2.5','3','3.5','4']){await page.locator('#target-density').selectOption(density);await page.locator('#reset-factors').click();assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));}
await page.locator('#close-sheet').click();await page.reload();record=await stored(page);for(const [density,film] of set)assert.equal(record['factor.'+density+'.'+film],1);
// Stored factors outside 0.10–10.00 load as 1.00.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},'factor.3.d5':0.05,'factor.3.t200':11,'factor.3.ix80':'2'});assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));assert.equal(await page.evaluate(()=>activeCi),26);
// Drafts restore schedules by name; stale or unknown select values fall back to defaults.
const draft=(values,model='drafts-v2')=>({schemaVersion:2,'source':{mode:'manual',activity:26},draft:{model,values,helper:true,weld:true,calibration:true}});
const selects=['helper-size','helper-schedule','helper-film','weld-size','weld-schedule','weld-film'];const read=page=>page.evaluate(ids=>ids.map(id=>$(id).value),selects);
page=await open(draft({'helper-size':'8','helper-schedule':'XXH / XXS','helper-film':'t200','helper-ci':'25','weld-size':'3','weld-schedule':'80 / XH','weld-film':'mx125','weld-factor':'1.5'}));
assert.deepEqual(await read(page),['8','XXH / XXS','t200','3','80 / XH','mx125']);assert.equal(await page.locator('#helper-ci').inputValue(),'25');assert.equal(await page.locator('#weld-factor').inputValue(),'1.5');
page=await open(draft({'helper-size':'3','helper-schedule':'9','helper-film':'d5','weld-size':'8','weld-schedule':'bogus','weld-film':'d4','source-mode':'x'}));
assert.deepEqual(await read(page),['3','40 / STD','ix50','8','40 / STD','d5']);assert.equal(await page.locator('#source-mode').inputValue(),'manual');
// A blank selection shows a message instead of failing silently or saving to another pipe.
await page.evaluate(()=>{$('helper-film').value='missing';$('helper-ci').value='26';$('helper-time').value='30';$('helper-form').requestSubmit();});assert.equal(await page.locator('#helper-error').textContent(),'Choose a pipe size, schedule, film and density. Nothing has been changed.');assert.equal(await page.locator('#helper-review').isHidden(),true);
const before=await stored(page);await page.evaluate(()=>{$('weld-schedule').value='missing';$('weld-factor').value='2';$('weld-form').requestSubmit();});assert.equal(await page.locator('#weld-error').textContent(),'Choose a pipe size, schedule, film and density. Nothing has changed.');await page.evaluate(()=>$('weld-reset').click());
assert.ok(!Object.keys(await stored(page)).some(k=>k.startsWith('weld.')));assert.deepEqual(Object.keys(await stored(page)).filter(k=>k.startsWith('factor.')),Object.keys(before).filter(k=>k.startsWith('factor.')));
// Drafts from an older draft format are ignored.
page=await open(draft({'helper-ci':'99','helper-size':'3','helper-schedule':'0'},'six-film-density-drafts-v1'));assert.equal(await page.locator('#helper-ci').inputValue(),'');
// The helper pre-fills today's activity rounded to 3 decimals, labelled with its date, including after a restart.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:25.87654}});const day=await page.evaluate(()=>today());
await page.locator('#setup-panel>summary').click();await page.evaluate(()=>{document.querySelector('.settings').open=true;$('cal-helper').open=false;});await page.locator('#cal-helper>summary').click();
assert.equal(await page.locator('#helper-ci').inputValue(),'25.877');assert.equal(await page.locator('#helper-ci-hint').textContent(),'Pre-filled with the source activity for '+day+'. Change it if the shot was on another day.');assert.equal(await page.locator('#helper-ci-hint').isVisible(),true);
await page.locator('#helper-time').fill('30');await page.locator('#helper-form button[type="submit"]').click();assert.match(await page.locator('#helper-review-text').textContent(),new RegExp('Shot activity: 25.877 Ci \\(pre-filled for '+day+'\\)'));
await page.locator('#close-sheet').click();await page.reload();assert.equal(await page.locator('#helper-ci').inputValue(),'25.877');assert.match(await page.locator('#helper-ci-hint').textContent(),new RegExp(day));
await page.locator('#setup-panel>summary').click();await page.locator('#helper-ci').fill('27.8');assert.equal(await page.locator('#helper-ci-hint').isHidden(),true);await page.locator('#helper-form button[type="submit"]').click();assert.doesNotMatch(await page.locator('#helper-review-text').textContent(),/pre-filled/);
// In decay mode the activity box is recalculated, not restored from an older draft; manual drafts still restore it.
const monthAgo=new Date(Date.now()-30*86400000),refDate=monthAgo.getFullYear()+'-'+String(monthAgo.getMonth()+1).padStart(2,'0')+'-'+String(monthAgo.getDate()).padStart(2,'0');
page=await open({schemaVersion:2,'source':{mode:'decay',activity:30,date:refDate},draft:{model:'drafts-v2',values:{'source-mode':'decay','reference-ci':'30','reference-date':refDate,'activity':'99'},sourceDirty:false}});
const decayed=await page.evaluate(()=>String(Number(activeCi.toFixed(6))));assert.ok(Number(decayed)<30);assert.equal(await page.locator('#activity').inputValue(),decayed);
// The results are rebuilt only when the decayed activity changes (once a day), not on every minute tick.
await page.evaluate(()=>document.querySelector('.shot').dataset.marker='kept');await page.evaluate(()=>refreshDecay());assert.equal(await page.locator('.shot[data-marker="kept"]').count(),1);
const earlier=new Date(monthAgo.getTime()-86400000),earlierDate=earlier.getFullYear()+'-'+String(earlier.getMonth()+1).padStart(2,'0')+'-'+String(earlier.getDate()).padStart(2,'0');
assert.ok(await page.evaluate(d=>{const before=activeCi;appliedSource.date=d;refreshDecay();return activeCi<before;},earlierDate));assert.equal(await page.locator('.shot[data-marker="kept"]').count(),0);await page.evaluate(d=>{appliedSource.date=d;refreshDecay();},refDate);
await page.locator('#setup-panel>summary').click();await page.locator('#source-mode').selectOption('manual');assert.equal(await page.locator('#activity').inputValue(),decayed);await page.locator('button[form="activity-form"]').click();assert.equal(String(await page.evaluate(()=>activeCi)),decayed);
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},draft:{model:'drafts-v2',values:{'source-mode':'manual','activity':'30'},sourceDirty:true}});assert.equal(await page.locator('#activity').inputValue(),'30');assert.equal(await page.evaluate(()=>activeCi),null);
// Displays of the current film-wide factor show the factor in use, not an invalid stored value.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},'factor.3.ix50':'abc','factor.2.d5':0.05,'factor.3.mx125':1.25});
await page.locator('#setup-panel>summary').click();await page.evaluate(()=>{document.querySelector('.settings').open=true;$('cal-helper').open=true;$('weld-panel').open=true;});
for(const [size,film,density,shown] of [['3','ix50','3','1.0000'],['3','mx125','3','1.2500'],['4','d5','2','1.0000']]){await page.locator('#helper-size').selectOption(size);await page.locator('#helper-film').selectOption(film);await page.locator('#helper-density').selectOption(density);await page.locator('#helper-ci').fill('26');await page.locator('#helper-time').fill('30');await page.locator('#helper-form button[type="submit"]').click();assert.match(await page.locator('#helper-review-text').textContent(),new RegExp('Current factor: ×'+shown.replace('.','\\.')));
 await page.locator('#weld-size').selectOption(size);await page.locator('#weld-film').selectOption(film);await page.locator('#weld-density').selectOption(density);assert.match(await page.locator('#weld-summary').textContent(),new RegExp('Film-wide factor ×'+shown.slice(0,5).replace('.','\\.')+'$'));}
// Version 1 records (previous exposure model): film-wide and size/schedule factors and drafts reset, everything else is kept.
page=await open({schemaVersion:1,'source':{mode:'manual',activity:26},'film.small':'d4','density':2.5,'filter.pipe':['3','4'],'factor.3.d4':1.3,'factor.2.d5':0.8,'weld.3.mx125.3.40 / STD':1.25,draft:{model:'drafts-v2',values:{'helper-ci':'25'}}});
record=await stored(page);assert.equal(record.schemaVersion,2);assert.ok(!Object.keys(record).some(k=>k.startsWith('factor.')||k.startsWith('weld.')||k==='draft'));
assert.equal(record['film.small'],'d4');assert.equal(record.density,2.5);assert.deepEqual(record['filter.pipe'],['3','4']);
assert.ok(Object.values(await factorsAt(page)).every(v=>v===1));assert.equal(await page.evaluate(()=>activeCi),26);assert.equal(await page.locator('#helper-ci').inputValue(),'');assert.match(await page.locator('#toast').textContent(),/Film and size\/schedule factors reset to 1\.00/);
await page.reload();assert.doesNotMatch(await page.locator('#toast').textContent(),/factors reset/);assert.equal((await stored(page)).schemaVersion,2);
// Filters: a 1.20 (version 1) full list means "all", once, during migration, so new sizes and Sch 10 appear.
page=await open({schemaVersion:1,'source':{mode:'manual',activity:26},'filter.pipe':['1','2','3','4','5','6','8','10','12','14','16'],'filter.schedule':['STD','40','60','XH','80','100','120','140','160','XXH']});
assert.equal(await page.locator('#pipe-summary').textContent(),'All pipe sizes');assert.equal(await page.locator('#schedule-summary').textContent(),'All schedules');assert.equal(await page.locator('.shot[data-schedule="10"]').count(),14);assert.equal(await page.locator('.shot[data-size="24"][data-schedule="STD"]').count(),1);
record=await stored(page);assert.equal(record['filter.pipe'],null);assert.equal(record['filter.schedule'],null);
// A current record that leaves out only the newer options is the user's choice and stays that way after a restart.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},'filter.pipe':['1','2','3','4','5','6','8','10','12','14','16'],'filter.schedule':['STD','40','60','XH','80','100','120','140','160','XXH']});
for(let i=0;i<2;i++){assert.equal(await page.locator('#pipe-summary').textContent(),'1", 2", 3", 4", 5", 6", 8", 10", 12", 14", 16"');assert.equal(await page.locator('.shot[data-size="20"]').count(),0);assert.equal(await page.locator('.shot[data-schedule="10"]').count(),0);await page.reload();}
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},'filter.schedule':['STD','XH']});assert.equal(await page.locator('#schedule-summary').textContent(),'STD, XH');assert.equal(await page.locator('.shot[data-schedule="10"]').count(),0);
await page.locator('#schedule-filter>summary').click();await page.locator('#sheet-content .choice-actions button',{hasText:'All'}).click();assert.equal((await stored(page))['filter.schedule'],null);assert.equal(await page.locator('.shot[data-schedule="10"]').count(),14);
await page.locator('#sheet-content .choice-actions button',{hasText:'Clear'}).click();assert.deepEqual((await stored(page))['filter.schedule'],[]);
// CR PMT: a saved value outside the size's range, not a whole number, or not a number falls back to the suggested PMT.
const crSeed={schemaVersion:2,'source':{mode:'manual',activity:26},'film.small':'cr','film.large':'cr'};
page=await open({...crSeed,'pmt.4':25,'pmt.3':30.5,'pmt.10':'60','pmt.8':60});
assert.deepEqual(await page.evaluate(()=>['4','3','10','8'].map(s=>$('pmt-'+s).value)),['41','38','54','60']);
const crRow=(size,schedule='40 / STD')=>page.locator('.shot[data-size="'+size+'"][data-schedule="'+schedule+'"] .time');assert.equal(await crRow(4).textContent(),'20s');assert.equal(await crRow(3).textContent(),'16s');
// Both belts on CR: the factor summary names CR once.
assert.equal(await page.locator('#factor-summary').textContent(),'Film factors: Carestream CR ×1.000');
// Printed CR times follow the slider (not only the suggested PMT) and match the screen.
await page.locator('#pmt-4').fill('56');await page.locator('#pmt-24').fill('70');await page.locator('#pmt-1').fill('20');
const print=await (await page.context().newPage());await print.setContent(await page.evaluate(()=>makePrintDocument()));
for(const [screen,printed] of [['.shot .time','td.time'],['.internal-value .value','td.internal'],['.offset-value .value','td.internal-offset']])assert.deepEqual(await page.locator(screen).allTextContents(),await print.locator(printed).allTextContents());
assert.equal(await crRow(4).textContent(),'5s');assert.ok((await print.locator('td.time').allTextContents()).includes('5s'));await print.close();
// The preview keeps the print sheet's small, unwrapped PMT line.
await page.locator('#open-print').click();await page.locator('#preview-list').click();assert.deepEqual(await page.locator('#preview-content .pmt-print').first().evaluate(n=>[getComputedStyle(n).whiteSpace,getComputedStyle(n).fontSize]),['nowrap','9px']);await page.locator('#close-preview').click();await page.locator('#close-sheet').click();
// Slider and its button name the pipe size; "Use suggested" from the keyboard leaves focus on the slider.
assert.equal(await page.locator('#pmt-4').getAttribute('aria-label'),'PMT for 4-inch pipe');assert.equal(await page.getByRole('button',{name:'Use suggested PMT 41 for 4-inch pipe'}).count(),1);
await page.getByRole('button',{name:'Use suggested PMT 41 for 4-inch pipe'}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'pmt-4');assert.equal(await page.locator('#pmt-4').inputValue(),'41');
// The helper's PMT follows the pipe's slider until the user types a different value; the size/schedule summary follows it too.
await page.locator('#setup-panel>summary').click();await page.evaluate(()=>{document.querySelector('.settings').open=true;$('cal-helper').open=true;$('weld-panel').open=true;$('helper-size').value='8';$('helper-size').dispatchEvent(new Event('change'));$('helper-film').value='cr';$('helper-film').dispatchEvent(new Event('change'));$('weld-size').value='8';weldGeometry();$('weld-film').value='cr';$('weld-film').dispatchEvent(new Event('change'));$('weld-factor').value='1.7';});
assert.equal(await page.locator('#helper-pmt').inputValue(),'60');await page.locator('#close-sheet').click();
await page.locator('#pmt-8').fill('45');await page.locator('#pmt-8').dispatchEvent('change');
assert.equal(await page.locator('#helper-pmt').inputValue(),'45');assert.match(await page.locator('#weld-summary').textContent(),/at PMT 45, every density/);assert.equal(await page.locator('#weld-factor').inputValue(),'1.7');
await page.evaluate(()=>{$('helper-pmt').value='50';$('helper-pmt').dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#pmt-8').fill('55');await page.locator('#pmt-8').dispatchEvent('change');assert.equal(await page.locator('#helper-pmt').inputValue(),'50');
// "Reset this density's factors" leaves the density-free CR factor alone.
await page.evaluate(()=>{$('factor-cr').value='1.5';$('calibration-form').requestSubmit();$('reset-factors').click();});assert.equal((await stored(page))['factor.cr'],1.5);assert.equal(await page.locator('#factor-cr').inputValue(),'1.5');
// Restored helper drafts set up the CR / density fields for the restored film, not the belt's film.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},'film.large':'d5',draft:{model:'drafts-v2',values:{'helper-size':'8','helper-film':'cr','helper-pmt':''}}});
assert.deepEqual(await page.evaluate(()=>[$('helper-film').value,$('helper-pmt').hidden,$('helper-pmt').value,$('helper-measured').hidden,$('helper-density').hidden]),['cr',false,'52',true,true]);
page=await open({...crSeed,draft:{model:'drafts-v2',values:{'helper-size':'8','helper-film':'d5','helper-measured':'2.2','helper-density':'2'}}});
assert.deepEqual(await page.evaluate(()=>[$('helper-film').value,$('helper-pmt').hidden,$('helper-measured').hidden,$('helper-density').hidden]),['d5',true,false,false]);
// A restored auto-filled helper PMT keeps following the slider after a restart; one the user typed does not.
page=await open({...crSeed,'pmt.8':60,draft:{model:'drafts-v2',values:{'helper-size':'8','helper-film':'cr','helper-pmt':'52'},helperPmtAuto:'52'}});assert.equal(await page.locator('#helper-pmt').inputValue(),'60');
page=await open({...crSeed,'pmt.8':60,draft:{model:'drafts-v2',values:{'helper-size':'8','helper-film':'cr','helper-pmt':'52'}}});assert.equal(await page.locator('#helper-pmt').inputValue(),'52');
// A corrupt draft sheet name is ignored and does not stop drafts from saving afterwards.
page=await open({schemaVersion:2,'source':{mode:'manual',activity:26},draft:{model:'drafts-v2',values:{},sheet:'constructor'}});
await page.locator('#setup-panel>summary').click();await page.locator('#activity').fill('12.5');assert.equal((await stored(page)).draft.values.activity,'12.5');
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: filters saved as all/null, version 1 full lists migrated to all once and current partial lists kept, CR PMT range fallback, print at non-suggested PMT, preview PMT style, slider labels and focus, helper PMT following the slider and its draft, size/schedule summary refresh, CR factor kept by the density reset, helper fields after draft restore, corrupt draft sheet, unversioned records ignored, version 1 migration, per-density factor and size/schedule keys, schema version, persistence, range checks, resets across five densities, validated draft restoration, the labelled helper activity pre-fill, decay-mode activity restoration, once-a-day decay re-rendering and displayed factors matching the factors in use.');
