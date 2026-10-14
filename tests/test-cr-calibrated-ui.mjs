import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
// Carestream CR (calibrated) in the app: plate exposure slider (Carestream-chart per-size starts, 0.5–12 R) per pipe card, PMT sliders,
// reference shots and measured gain as suggestions only; print, Custom Shot, helper and persistence.
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
const html=await loadApp();
async function open(seed,cal){const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));
  await page.addInitScript(([s,c])=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('shottime.settings',JSON.stringify(s));if(c)localStorage.setItem('shottime.crCalibration',JSON.stringify(c));},[seed,cal||null]);
  await page.goto('https://shottime.local/');page.errors=errors;return page;}
const seed={schemaVersion:2,source:{mode:'manual',activity:26},'film.small':'crcal','film.large':'crcal'};
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a/b-1)<tol,`${a} vs ${b}`);
try{
  const empty={schemaVersion:1,shots:[],gain:[],hvlMm:null,targetPixel:null};
  // A saved calibration with no reference shots: every row has a time from its size's start (from the Carestream chart); timers and print work.
  let page=await open(seed,empty);
  const row=(size,schedule='40 / STD')=>page.locator('.shot[data-size="'+size+'"][data-schedule="'+schedule+'"]');
  const secs=async(size,schedule)=>Number(await row(size,schedule).getAttribute('data-seconds'));
  const lab=x=>Math.round(x)+'s',physics=(steelIn,sfdIn,r,hvl=14.5)=>r*(sfdIn*.0254)**2*3600/.48*2**(steelIn*25.4/hvl)/26;
  assert.equal(await page.locator('.shot[data-film="crcal"]').count(),109);
  assert.equal(await page.locator('.shot[data-film="crcal"] .time',{hasText:'—'}).count(),0);
  close(await secs(4),physics(.474,4.625,2.8));assert.equal(await row(4).locator('.time').textContent(),lab(physics(.474,4.625,2.8)));close(await secs(24,'STD'),physics(.75,24.125,.65));close(await secs(2,'80 / XH'),physics(2*.218,2.5,5));close(await secs(5,'40 / STD'),physics(2*.258,5.688,2.15));
  assert.equal(await page.locator('#dose-4-note').textContent(),'From your Carestream chart (4" rows)');assert.equal(await page.locator('#dose-2-note').textContent(),'From your Carestream chart (2" rows)');assert.equal(await page.locator('#dose-12-note').textContent(),'From your Carestream chart (12" rows)');assert.equal(await page.locator('#dose-1-note').textContent(),'From your Carestream chart (2" rows; none for 1")');assert.equal(await page.locator('#dose-18-note').textContent(),'From your Carestream chart (between 16" and 20")');
  // No short-shot warning (owner, 1.98).
  assert.equal(await page.locator('.shot',{hasText:'Short shot'}).count(),0);
  assert.ok(await row(12,'STD').locator('a.shot-timer-link').count()>0);
  let print=await browser.newPage();await print.setContent(await page.evaluate(()=>makePrintDocument()));assert.equal(await print.locator('td.time',{hasText:'—'}).count(),0);assert.equal(await print.locator('tbody tr').first().locator('td').first().textContent(),'1"PMT 355.00 R');await print.close();
  // Sliders: PMT with the owner's ranges; plate exposure 0.5–12 R in 0.05 R steps, starting at the size's chart value.
  for(const [size,min,max,value] of [[1,20,50,35],[3,20,50,35],[4,30,60,45],[8,30,60,45],[10,40,70,55],[24,40,70,55]]){const s=page.locator('#pmt-'+size);assert.deepEqual([await s.getAttribute('min'),await s.getAttribute('max'),await s.inputValue(),await s.getAttribute('aria-label')],[String(min),String(max),String(value),'PMT for '+size+'-inch pipe']);}
  const dose=page.locator('#dose-4');assert.deepEqual([await dose.getAttribute('min'),await dose.getAttribute('max'),await dose.getAttribute('step'),await dose.inputValue(),await dose.getAttribute('aria-label')],['0.5','12','0.05','2.8','Plate exposure in roentgen for 4-inch pipe']);
  assert.equal(await page.locator('.dose-reset').first().isDisabled(),true);
  // Moving the plate exposure slider scales that size only, is saved, and survives a restart; Use suggested clears it.
  await dose.fill('3');close(await secs(4),physics(.474,4.625,3));assert.equal(await page.locator('#dose-4-value').textContent(),'3.00');await dose.fill('12');close(await secs(4),physics(.474,4.625,12));assert.equal(await dose.evaluate(n=>{n.value='12.5';return n.value;}),'12');
  await dose.fill('2');close(await secs(4),physics(.474,4.625,2));assert.equal(await page.locator('#dose-4-value').textContent(),'2.00');assert.equal(await page.locator('#dose-4-note').textContent(),'Your setting');
  close(await secs(3),physics(2*.216,3.625,3.65));await dose.dispatchEvent('change');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings'))['dose.4']),2);
  await page.reload();assert.equal(await page.locator('#dose-4').inputValue(),'2');close(await secs(4),physics(.474,4.625,2));
  await page.getByRole('button',{name:'Use suggested plate exposure for 4-inch pipe'}).focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dose-4');assert.equal(await page.locator('#dose-4').inputValue(),'2.8');close(await secs(4),physics(.474,4.625,2.8));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings'))['dose.4']),null);

  // A reference shot (4" STD, 26 Ci, 9 s, PMT 40) shows the plate exposure it delivered and becomes the suggestion at PMT 40.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-shot-panel').open=true;});
  await page.locator('#cr-shot-steel').fill('.474');await page.locator('#cr-shot-sfd').fill('4.625');await page.locator('#cr-shot-ci').fill('26');await page.locator('#cr-shot-time').fill('9');await page.locator('#cr-shot-pmt').fill('40.5');
  await page.locator('#cr-shot-form button[type=submit]').click();assert.match(await page.locator('#cr-shot-error').textContent(),/PMT as a whole number.*Nothing has been added/);assert.equal(await page.locator('#cr-shot-list li').count(),0);
  await page.locator('#cr-shot-pmt').fill('40');await page.locator('#cr-shot-form button[type=submit]').click();
  const shotR=9/physics(.474,4.625,1);assert.match(await page.locator('#cr-shot-list li').textContent(),new RegExp('PMT 40 → '+shotR.toFixed(2)+' R at plate'));
  assert.match(await page.locator('#cr-cal-status').textContent(),/^Plate exposure × SFD² ÷ Ir-192 output \(0\.48 R·m²\/Ci·h\) · 1 reference shot, no gain measurements · steel curve 14\.5 mm \(from your Carestream chart\)/);
  await page.locator('#close-sheet').click();
  assert.equal(await page.locator('#pmt-4').inputValue(),'40');assert.equal(await page.locator('#pmt-24').inputValue(),'40');
  close(await secs(4),9);assert.equal(await row(4).locator('.time').textContent(),'9s');close(await secs(12,'STD'),physics(.75,12.875,shotR));
  assert.equal(await page.locator('#dose-4-note').textContent(),'From 1 reference shot at PMT 40');assert.equal(await page.locator('#dose-4-value').textContent(),shotR.toFixed(2));
  // At a PMT the shots do not cover, the starting point applies and the note says why.
  await page.locator('#pmt-4').fill('50');close(await secs(4),physics(.474,4.625,2.8));assert.equal(await page.locator('#dose-4-note').textContent(),'From your Carestream chart (4" rows) · reference shots: no gain measurements covering PMT 40 and PMT 50');
  // Measured gain converts the shot to another PMT, inside the measured range only; outside the slider range it is clamped and said.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-gain-panel').open=true;});
  for(const [pmt,signal,offset] of [['40','2100','100'],['55','6100','100']]){await page.locator('#cr-gain-pmt').fill(pmt);await page.locator('#cr-gain-signal').fill(signal);await page.locator('#cr-gain-offset').fill(offset);await page.locator('#cr-gain-form button[type=submit]').click();}
  await page.locator('#cr-gain-pmt').fill('40');await page.locator('#cr-gain-signal').fill('3000');await page.locator('#cr-gain-offset').fill('100');await page.locator('#cr-gain-form button[type=submit]').click();
  assert.match(await page.locator('#cr-gain-error').textContent(),/PMT 40 is already measured/);assert.equal(await page.locator('#cr-gain-list li').count(),2);
  await page.locator('#close-sheet').click();await page.locator('#pmt-4').fill('51');await page.locator('#pmt-4').fill('50');
  const r50=shotR*2000/(2000*3**(10/15));close(await secs(4),physics(.474,4.625,r50));assert.equal(await page.locator('#dose-4-note').textContent(),'From 1 reference shot (gain-converted) at PMT 50');
  await page.locator('#pmt-4').fill('55');close(await secs(4),physics(.474,4.625,.5));assert.match(await page.locator('#dose-4-note').textContent(),new RegExp('they imply '+(shotR/3).toFixed(2)+' R, outside the slider range$'));
  await page.locator('#pmt-4').fill('60');close(await secs(4),physics(.474,4.625,2.8));assert.match(await page.locator('#dose-4-note').textContent(),/no gain measurements covering PMT 40 and PMT 60/);
  await page.locator('#pmt-4').fill('50');await page.locator('#pmt-4').dispatchEvent('change');await page.locator('#dose-12').fill('1.5');await page.locator('#dose-12').dispatchEvent('change');
  // Screen and print agree at non-default PMT and plate exposure; the printed pipe cell names both.
  print=await browser.newPage();await print.setContent(await page.evaluate(()=>makePrintDocument()));
  assert.deepEqual(await page.locator('.shot .time').allTextContents(),await print.locator('td.time').allTextContents());
  assert.deepEqual(await page.locator('.internal-value .value').allTextContents(),await print.locator('td.internal').allTextContents());
  const cells=await print.locator('td:first-child').allTextContents();assert.ok(cells.includes('4"PMT 50'+r50.toFixed(2)+' R'));assert.ok(cells.includes('12"PMT 401.50 R'));await print.close();
  // "Use reference PMT" returns the slider to the shot's PMT and keeps keyboard focus on the slider.
  await page.getByRole('button',{name:'Use reference PMT 40 for 4-inch pipe'}).focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pmt-4').inputValue(),'40');assert.equal(await page.evaluate(()=>document.activeElement.id),'pmt-4');

  // Steel curve: out-of-range refused; a measured value is used; a pixel target the shot cannot support falls back with the reason.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});
  await page.locator('#cr-hvl').fill('40');await page.locator('#cr-settings-form button[type=submit]').click();assert.match(await page.locator('#cr-settings-error').textContent(),/5 to 30 mm/);
  await page.locator('#cr-hvl').fill('16');await page.locator('#cr-settings-form button[type=submit]').click();assert.match(await page.locator('#cr-hvl-hint').textContent(),/^Using your value, 16 mm\./);
  await page.locator('#close-sheet').click();close(await secs(12,'STD'),physics(.75,12.875,1.5,16));
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});
  await page.locator('#cr-target').fill('2500');await page.locator('#cr-settings-form button[type=submit]').click();await page.locator('#close-sheet').click();
  assert.match(await page.locator('#dose-4-note').textContent(),/reference shots: reference shot has no pixel value/);
  // Persistence: calibration, PMT and plate exposure survive a restart.
  await page.reload();assert.equal(await page.evaluate(()=>crCal.shots.length+':'+crCal.gain.length+':'+crCal.hvlMm+':'+crCal.targetPixel),'1:2:16:2500');assert.equal(await page.locator('#dose-12').inputValue(),'1.5');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.crCalibration')).schemaVersion),1);
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});await page.locator('#cr-target').fill('');await page.locator('#cr-hvl').fill('');await page.locator('#cr-settings-form button[type=submit]').click();
  await page.evaluate(()=>{$('cr-gain-panel').open=true;});await page.getByRole('button',{name:'Delete gain measurement at PMT 55'}).click();await page.locator('#close-sheet').click();
  await page.locator('#pmt-4').fill('50');assert.match(await page.locator('#dose-4-note').textContent(),/no gain measurements/);await page.locator('#pmt-4').fill('40');

  // The factor helper does not apply to calibrated CR: it points to reference shots and changes nothing.
  await page.locator('#edit-source').click();
  assert.equal(await page.evaluate(()=>{document.querySelector('.settings').open=true;$('cal-helper').open=true;$('helper-size').value='4';helperGeometry();$('helper-film').value='crcal';$('helper-film').dispatchEvent(new Event('change'));$('helper-ci').value='26';$('helper-time').value='30';$('helper-form').requestSubmit();return [$('helper-error').textContent,JSON.parse(localStorage.getItem('shottime.settings'))['factor.crcal']].join('|');}),
    'Carestream CR (calibrated) is set from reference shots, not a factor: add this shot under Carestream CR calibration → Reference shots. Nothing has been changed.|');
  await page.locator('#close-sheet').click();

  // Custom Shot: PMT and plate exposure instead of density; blank exposure = reference shots at that PMT, else it asks for one.
  await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.locator('#custom-film').selectOption('crcal');
  assert.ok(await page.locator('#custom-density').isHidden());assert.ok(await page.locator('#custom-pmt').isVisible());assert.ok(await page.locator('#custom-dose').isVisible());
  await page.locator('#custom-steel').fill('.474');await page.locator('#custom-sfd').fill('4.625');await page.locator('#custom-pmt').fill('40');await page.locator('#custom-form button').click();
  assert.equal(await page.locator('#custom-time').textContent(),'9s');assert.match(await page.locator('#custom-summary').textContent(),new RegExp('Carestream CR \\(calibrated\\) · PMT 40 · '+shotR.toFixed(2)+' R plate exposure \\(from reference shots\\)'));
  await page.locator('#custom-dose').fill('2');await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),lab(physics(.474,4.625,2)));assert.match(await page.locator('#custom-summary').textContent(),/2\.00 R plate exposure \(entered\)/);
  await page.locator('#custom-dose').fill('');await page.locator('#custom-pmt').fill('47');await page.locator('#custom-form button').click();assert.match(await page.locator('#custom-error').textContent(),/Enter a plate exposure: there are no reference shots for PMT 47\. Pick a pipe size/);assert.equal(await page.locator('#custom-result').isHidden(),true);
  assert.ok(await page.locator('#custom-dose-size').isVisible());assert.equal(await page.locator('#custom-dose-size option').count(),15);await page.locator('#custom-dose-size').selectOption('8');assert.equal(await page.locator('#custom-dose').inputValue(),'1.05');await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),lab(physics(.474,4.625,1.05)));assert.match(await page.locator('#custom-summary').textContent(),/1\.05 R plate exposure \(entered\)/);
  await page.locator('#custom-dose').fill('2.5');await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),lab(physics(.474,4.625,2.5)));
  await page.locator('#custom-dose').fill('12.5');await page.locator('#custom-form button').click();assert.match(await page.locator('#custom-error').textContent(),/plate exposure from 0\.5 to 12 R/);
  await page.locator('#custom-dose').fill('1.5');await page.locator('#custom-pmt').fill('x');await page.locator('#custom-form button').click();assert.match(await page.locator('#custom-error').textContent(),/PMT as a whole number/);
  await page.locator('#custom-pmt').fill('47');await page.evaluate(()=>{document.querySelector('#custom-shot details').open=true;});await page.locator('#custom-preset-name').fill('CR 47');await page.locator('#custom-save').click();assert.match(await page.locator('#custom-save-status').textContent(),/Setup saved/);
  await page.reload();await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.evaluate(()=>{document.querySelector('#custom-shot details').open=true;});
  await page.locator('#custom-presets').selectOption({label:'CR 47'});await page.locator('#custom-load').click();assert.deepEqual([await page.locator('#custom-pmt').inputValue(),await page.locator('#custom-dose').inputValue(),await page.locator('#custom-film').inputValue()],['47','1.5','crcal']);
  for(const width of [320,360,740]){await page.setViewportSize({width,height:852});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'width '+width);}
  assert.deepEqual(page.errors,[]);await page.close();

  // Stored entries that cannot be read are ignored and reported, never repaired; a second shot enables the cross-check.
  page=await open(seed,{schemaVersion:1,shots:[{totalSteel:.474,sfd:4.625,activity:26,seconds:20,pmt:40},{totalSteel:.73,sfd:10.875,activity:26,seconds:20*(10.875/4.625)**2*2**((.73-.474)*25.4/13),pmt:40},{totalSteel:'1',sfd:4,activity:20,seconds:9,pmt:40}],gain:[{pmt:30,signal:5,offset:9}],hvlMm:13});
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;});
  assert.match(await page.locator('#cr-cal-status').textContent(),/2 reference shots.* · 2 saved entries could not be read and are ignored$/);
  assert.match(await page.locator('#cr-check').textContent(),/2 checked\) is off by a median of 0\.0%, worst 0\.0%/);assert.match(await page.locator('#cr-hvl-hint').textContent(),/imply 13\.0 mm/);
  assert.deepEqual(page.errors,[]);await page.close();
  // CR Formula (70%) was removed: a saved belt choice falls back to the default film, its saved factor stays in
  // storage untouched, and a saved Custom Shot setup stays listed and loads its steel and SFD only.
  page=await open({schemaVersion:2,source:{mode:'manual',activity:26},'film.large':'cr70','film.small':'crfield','factor.cr70':1.4,'fieldPmt.4':50});
  assert.equal(await page.locator('#film-large').inputValue(),'d5');assert.equal(await page.locator('#film-small').inputValue(),'ix50');assert.equal(await page.locator('#custom-film option[value=crfield]').count(),0);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings'))['fieldPmt.4']),50);assert.equal(await page.locator('#film-large option[value=cr70]').count(),0);assert.equal(await page.locator('#custom-film option[value=cr70]').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.settings'))['factor.cr70']),1.4);
  await page.evaluate(()=>localStorage.setItem('shottime.customShots.v1',JSON.stringify({schemaVersion:1,presets:[{name:'Old CR',steel:1,sfd:24,film:'cr70',density:3},{name:'T200 shot',steel:1,sfd:24,film:'t200',density:3},{name:'Field',steel:.75,sfd:12,film:'crfield',density:3,pmt:70}]})));
  await page.reload();await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.evaluate(()=>{document.querySelector('#custom-shot details').open=true;});
  assert.deepEqual(await page.locator('#custom-presets option').allTextContents(),['Choose a saved setup','Old CR (CR Formula removed)','T200 shot','Field (field estimate removed)']);
  await page.locator('#custom-presets').selectOption({label:'Old CR (CR Formula removed)'});await page.locator('#custom-load').click();
  assert.match(await page.locator('#custom-save-status').textContent(),/used CR Formula \(70%\), which was removed in 1\.97/);assert.deepEqual([await page.locator('#custom-steel').inputValue(),await page.locator('#custom-sfd').inputValue()],['1','24']);
  await page.locator('#custom-preset-name').fill('Another');await page.locator('#custom-film').selectOption('t200');assert.ok(await page.locator('#custom-dose-size').isHidden());assert.ok(await page.locator('label[for="custom-dose-size"]').isHidden());await page.locator('#custom-save').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.customShots.v1')).presets.filter(p=>p.film==='cr70'||p.film==='crfield').length),2);
  await page.locator('#custom-presets').selectOption({label:'Field (field estimate removed)'});await page.locator('#custom-load').click();assert.match(await page.locator('#custom-save-status').textContent(),/used the CR field estimate, which was removed in 1\.98/);assert.deepEqual([await page.locator('#custom-steel').inputValue(),await page.locator('#custom-sfd').inputValue()],['0.75','12']);
  assert.deepEqual(page.errors,[]);await page.close();
  // A record with another schema version is not read as calibration.
  // A record of another schema version is ignored: the built-in shots apply instead of its contents.
  page=await open(seed,{schemaVersion:2,shots:[{totalSteel:.474,sfd:4.625,activity:26,seconds:20,pmt:40}]});assert.equal(await page.evaluate(()=>crCal.shots.length+':'+crCal.shots[0].pmt+':'+crCal.targetPixel),'3:20:2850');await page.close();

  // Fresh install (no saved calibration): the owner's three built-in field shots and the 2850 pixel target apply.
  page=await open(seed);assert.equal(await page.evaluate(()=>localStorage.getItem('shottime.crCalibration')),null);
  assert.match(await page.locator('#cr-cal-status').textContent(),/3 reference shots, no gain measurements · steel curve 14\.5 mm \(from your Carestream chart\) · target pixel 2850$/);
  assert.equal(await page.locator('#cr-shot-list li').count(),3);assert.match(await page.locator('#cr-shot-list li').first().textContent(),/0\.436" steel · 2\.5" SFD · 72 Ci · 6 s · PMT 20 → 8\.41 R at plate · pixel 3255 \(unexposed 200\) · 2" XH field shot 2026-10-14, unexposed value estimated/);
  assert.equal(await page.locator('#cr-target').inputValue(),'2850');
  assert.deepEqual([await page.locator('#pmt-2').inputValue(),await page.locator('#pmt-4').inputValue(),await page.locator('#pmt-24').inputValue()],['20','40','40']);
  const geom=(steelIn,sfdIn)=>sfdIn**2*2**(steelIn*25.4/14.5),k20=72*(6/geom(.436,2.5)*11/geom(.432,3.625))**.5*(2850-200)/((3255-200)*(3265-200))**.5,k40=72*15/geom(.56,6.75)*(2850-200)/(3140-200);
  close(await secs(2,'80 / XH'),k20*geom(.436,2.5)/26);close(await secs(4),k40*geom(.474,4.625)/26);close(await secs(24,'STD'),k40*geom(.75,24.125)/26);
  assert.equal(await page.locator('#dose-2-note').textContent(),'From 2 reference shots at PMT 20');assert.equal(await page.locator('#dose-4-note').textContent(),'From 1 reference shot at PMT 40');
  await page.locator('#pmt-4').fill('30');assert.match(await page.locator('#dose-4-note').textContent(),/From your Carestream chart \(4" rows\) · reference shots: no gain measurements covering PMT 20 and PMT 30/);
  // Deleting a built-in shot sticks across reload; Restore built-in shots brings it back and fills a blank target.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-shot-panel').open=true;$('cr-settings-panel').open=true;});
  await page.locator('#cr-shot-list button').nth(2).click();await page.locator('#cr-target').fill('');await page.locator('#cr-settings-form button[type=submit]').click();assert.equal(await page.locator('#toast').textContent(),'CR steel curve and target saved');await page.locator('#close-sheet').click();await page.reload();
  assert.equal(await page.evaluate(()=>crCal.shots.length+':'+crCal.targetPixel),'2:null');
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});await page.locator('#cr-restore').click();assert.equal(await page.locator('#toast').textContent(),'Built-in shots restored');
  assert.equal(await page.evaluate(()=>crCal.shots.length+':'+crCal.targetPixel),'3:2850');await page.locator('#cr-restore').click();assert.equal(await page.locator('#toast').textContent(),'Built-in shots already present');assert.equal(await page.evaluate(()=>crCal.shots.length),3);
  await page.close();
}finally{await browser.close();}
console.log('PASS: CR field estimate and CR Formula (70%) removed with saved choices, factors and setups preserved; calibrated CR times from Carestream-chart per-size starts and no short-shot warning, plate exposure slider (range, save, restart, Use suggested, focus), owner PMT ranges, reference shot entry and plate exposure, shot-based and gain-converted suggestions with fallback and clamping, screen/print agreement with PMT and R printed, reference PMT reset and focus, steel curve and pixel target, persistence, helper refusal, built-in field shots on a fresh install with restore, Custom Shot with PMT, chart fill by pipe size and saved setups, narrow widths, unreadable stored entries, cross-check and suggested steel curve.');
