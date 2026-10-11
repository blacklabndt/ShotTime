import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
// Carestream CR (calibrated) in the app: no times until the owner's reference shots cover a row; PMT sliders;
// gain conversion only from measured data; print, Custom Shot, helper and persistence.
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY});
const html=await loadApp();
async function open(seed,cal){const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));
  await page.addInitScript(([s,c])=>{if(localStorage.getItem('seeded'))return;localStorage.setItem('seeded','1');localStorage.setItem('shottime.settings',JSON.stringify(s));if(c)localStorage.setItem('shottime.crCalibration',JSON.stringify(c));},[seed,cal||null]);
  await page.goto('https://shottime.local/');page.errors=errors;return page;}
const seed={schemaVersion:2,source:{mode:'manual',activity:26},'film.small':'crcal','film.large':'crcal'};
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a/b-1)<tol,`${a} vs ${b}`);
try{
  // Uncalibrated: every row shows — and says why; nothing printable is invented; no timer links.
  let page=await open(seed);
  const row=(size,schedule='40 / STD')=>page.locator('.shot[data-size="'+size+'"][data-schedule="'+schedule+'"]');
  assert.equal(await page.locator('.shot[data-film="crcal"]').count(),109);
  assert.equal(await page.locator('.shot[data-film="crcal"] .time',{hasText:'—'}).count(),109);
  assert.match(await row(4).textContent(),/Needs calibration/);assert.match(await page.locator('#pmt-4-reason').textContent(),/Needs calibration: no reference shots/);
  assert.equal(await page.locator('.shot[data-film="crcal"] a.shot-timer-link').count(),0);
  let print=await browser.newPage();await print.setContent(await page.evaluate(()=>makePrintDocument()));assert.equal(await print.locator('td.time',{hasText:'—'}).count(),109);assert.match(await print.locator('tbody tr').first().locator('td').first().textContent(),/^1"PMT 35$/);await print.close();
  // Slider ranges are the owner's: 1"–3" 20–50, 4"–8" 30–60, 10"+ 40–70, starting mid-range without shots.
  for(const [size,min,max,value] of [[1,20,50,35],[3,20,50,35],[4,30,60,45],[8,30,60,45],[10,40,70,55],[24,40,70,55]]){const s=page.locator('#pmt-'+size);assert.deepEqual([await s.getAttribute('min'),await s.getAttribute('max'),await s.inputValue(),await s.getAttribute('aria-label')],[String(min),String(max),String(value),'PMT for '+size+'-inch pipe']);}

  // Adding a reference shot through the form: 4" STD geometry, 26 Ci, 20 s, PMT 40.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-shot-panel').open=true;});
  await page.locator('#cr-shot-steel').fill('.474');await page.locator('#cr-shot-sfd').fill('4.625');await page.locator('#cr-shot-ci').fill('26');await page.locator('#cr-shot-time').fill('20');await page.locator('#cr-shot-pmt').fill('40.5');
  await page.locator('#cr-shot-form button[type=submit]').click();assert.match(await page.locator('#cr-shot-error').textContent(),/PMT as a whole number.*Nothing has been added/);assert.equal(await page.locator('#cr-shot-list li').count(),0);
  await page.locator('#cr-shot-pmt').fill('40');await page.locator('#cr-shot-form button[type=submit]').click();
  assert.equal(await page.locator('#cr-shot-list li').count(),1);assert.match(await page.locator('#cr-cal-status').textContent(),/^1 reference shot, no gain measurements · steel curve 13 mm \(published, not verified for CR\)/);
  assert.match(await page.locator('#cr-check').textContent(),/Add a second reference shot/);
  await page.locator('#close-sheet').click();
  // Every row in a PMT-40 range now defaults to the shot's PMT; 4" STD reproduces the shot; others follow physics.
  assert.equal(await page.locator('#pmt-4').inputValue(),'40');assert.equal(await page.locator('#pmt-24').inputValue(),'40');assert.equal(await page.locator('#pmt-2').inputValue(),'40');
  close(Number(await row(4).getAttribute('data-seconds')),20);assert.equal(await row(4).locator('.time').textContent(),'20s');
  const geo=(wall,sfd)=>sfd*sfd*Math.pow(2,2*wall*25.4/13),K=26*20/geo(.237,4.625);
  close(Number(await row(12,'STD').getAttribute('data-seconds')),K*geo(.375,12.875)/26);
  assert.equal(await page.locator('.shot[data-film="crcal"] .time',{hasText:'—'}).count(),0);assert.ok(await row(12,'STD').locator('a.shot-timer-link').count()>0);
  assert.equal(await page.locator('#pmt-4-reason').isHidden(),true);

  // Another PMT needs measured gain covering both settings.
  await page.locator('#pmt-4').fill('50');assert.match(await page.locator('#pmt-4-reason').textContent(),/no gain measurements covering PMT 40 and PMT 50/);assert.equal(await row(4).locator('.time').textContent(),'—');
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-gain-panel').open=true;});
  for(const [pmt,signal,offset] of [['40','2100','100'],['55','6100','100']]){await page.locator('#cr-gain-pmt').fill(pmt);await page.locator('#cr-gain-signal').fill(signal);await page.locator('#cr-gain-offset').fill(offset);await page.locator('#cr-gain-form button[type=submit]').click();}
  await page.locator('#cr-gain-pmt').fill('40');await page.locator('#cr-gain-signal').fill('3000');await page.locator('#cr-gain-offset').fill('100');await page.locator('#cr-gain-form button[type=submit]').click();
  assert.match(await page.locator('#cr-gain-error').textContent(),/PMT 40 is already measured/);assert.equal(await page.locator('#cr-gain-list li').count(),2);
  await page.locator('#close-sheet').click();
  const g50=2000*Math.pow(6000/2000,10/15);close(Number(await row(4).getAttribute('data-seconds')),20*2000/g50);
  await page.locator('#pmt-4').fill('60');assert.match(await page.locator('#pmt-4-reason').textContent(),/no gain measurements covering PMT 40 and PMT 60/);
  await page.locator('#pmt-4').fill('55');close(Number(await row(4).getAttribute('data-seconds')),20/3);await page.locator('#pmt-4').dispatchEvent('change');
  // Screen and print agree at a non-default PMT, and the printed pipe cell names that PMT.
  print=await browser.newPage();await print.setContent(await page.evaluate(()=>makePrintDocument()));
  assert.deepEqual(await page.locator('.shot .time').allTextContents(),await print.locator('td.time').allTextContents());
  assert.deepEqual(await page.locator('.internal-value .value').allTextContents(),await print.locator('td.internal').allTextContents());
  assert.ok((await print.locator('td:first-child').allTextContents()).includes('4"PMT 55'));await print.close();
  // "Use reference PMT" returns the slider to the shot's PMT and keeps keyboard focus on the slider.
  await page.getByRole('button',{name:'Use reference PMT 40 for 4-inch pipe'}).focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pmt-4').inputValue(),'40');assert.equal(await page.evaluate(()=>document.activeElement.id),'pmt-4');

  // Steel curve: out-of-range refused; a measured value is used and named; the published one is the default.
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});
  await page.locator('#cr-hvl').fill('40');await page.locator('#cr-settings-form button[type=submit]').click();assert.match(await page.locator('#cr-settings-error').textContent(),/5 to 30 mm/);
  await page.locator('#cr-hvl').fill('16');await page.locator('#cr-settings-form button[type=submit]').click();assert.match(await page.locator('#cr-hvl-hint').textContent(),/^Using your value, 16 mm\./);
  // A pixel target needs the shot's pixel value: refused with the reason, not guessed.
  await page.locator('#cr-target').fill('2500');await page.locator('#cr-settings-form button[type=submit]').click();await page.locator('#close-sheet').click();
  assert.match(await page.locator('#pmt-4-reason').textContent(),/reference shot has no pixel value/);
  // Persistence: calibration and slider survive a restart.
  await page.reload();assert.equal(await page.evaluate(()=>crCal.shots.length+':'+crCal.gain.length+':'+crCal.hvlMm+':'+crCal.targetPixel),'1:2:16:2500');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shottime.crCalibration')).schemaVersion),1);
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;$('cr-settings-panel').open=true;});await page.locator('#cr-target').fill('');await page.locator('#cr-hvl').fill('');await page.locator('#cr-settings-form button[type=submit]').click();
  // Deleting a gain measurement brings back the refusal for other PMTs.
  await page.evaluate(()=>{$('cr-gain-panel').open=true;});await page.getByRole('button',{name:'Delete gain measurement at PMT 55'}).click();await page.locator('#close-sheet').click();
  await page.locator('#pmt-4').fill('50');assert.match(await page.locator('#pmt-4-reason').textContent(),/no gain measurements/);await page.locator('#pmt-4').fill('40');

  // The factor helper does not apply to calibrated CR: it points to reference shots and changes nothing.
  await page.locator('#edit-source').click();
  assert.equal(await page.evaluate(()=>{document.querySelector('.settings').open=true;$('cal-helper').open=true;$('helper-size').value='4';helperGeometry();$('helper-film').value='crcal';$('helper-film').dispatchEvent(new Event('change'));$('helper-ci').value='26';$('helper-time').value='30';$('helper-form').requestSubmit();return [$('helper-error').textContent,JSON.parse(localStorage.getItem('shottime.settings'))['factor.crcal']].join('|');}),
    'Carestream CR (calibrated) is set from reference shots, not a factor: add this shot under Carestream CR calibration → Reference shots. Nothing has been changed.|');
  await page.locator('#close-sheet').click();

  // Custom Shot: PMT instead of density; refuses an uncovered PMT; saves and reloads a setup with its PMT.
  await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.locator('#custom-film').selectOption('crcal');
  assert.ok(await page.locator('#custom-density').isHidden());assert.ok(await page.locator('#custom-pmt').isVisible());
  await page.locator('#custom-steel').fill('.474');await page.locator('#custom-sfd').fill('4.625');await page.locator('#custom-pmt').fill('40');await page.locator('#custom-form button').click();
  assert.equal(await page.locator('#custom-time').textContent(),'20s');assert.match(await page.locator('#custom-summary').textContent(),/Carestream CR \(calibrated\) · PMT 40/);assert.match(await page.locator('#custom-factor').textContent(),/1 reference shot/);
  await page.locator('#custom-sfd').fill('9.25');await page.locator('#custom-form button').click();assert.equal(await page.locator('#custom-time').textContent(),'1m 20s');
  await page.locator('#custom-pmt').fill('47');await page.locator('#custom-form button').click();assert.match(await page.locator('#custom-error').textContent(),/needs calibration: no gain measurements covering PMT 40 and PMT 47/);
  await page.locator('#custom-pmt').fill('x');await page.locator('#custom-form button').click();assert.match(await page.locator('#custom-error').textContent(),/PMT as a whole number/);
  await page.locator('#custom-pmt').fill('47');await page.evaluate(()=>{document.querySelector('#custom-shot details').open=true;});await page.locator('#custom-preset-name').fill('CR 47');await page.locator('#custom-save').click();assert.match(await page.locator('#custom-save-status').textContent(),/Setup saved/);
  await page.reload();await page.locator('#app-menu-button').click();await page.locator('#nav-custom').click();await page.evaluate(()=>{document.querySelector('#custom-shot details').open=true;});
  await page.locator('#custom-presets').selectOption({label:'CR 47'});await page.locator('#custom-load').click();assert.equal(await page.locator('#custom-pmt').inputValue(),'47');assert.equal(await page.locator('#custom-film').inputValue(),'crcal');
  for(const width of [320,360,740]){await page.setViewportSize({width,height:852});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'width '+width);}
  assert.deepEqual(page.errors,[]);await page.close();

  // Stored entries that cannot be read are ignored and reported, never repaired; a second shot enables the cross-check.
  page=await open(seed,{schemaVersion:1,shots:[{totalSteel:.474,sfd:4.625,activity:26,seconds:20,pmt:40},{totalSteel:.73,sfd:10.875,activity:26,seconds:20*(10.875/4.625)**2*2**((.73-.474)*25.4/13),pmt:40},{totalSteel:'1',sfd:4,activity:20,seconds:9,pmt:40}],gain:[{pmt:30,signal:5,offset:9}]});
  await page.locator('#edit-source').click();await page.evaluate(()=>{$('cr-cal').open=true;});
  assert.match(await page.locator('#cr-cal-status').textContent(),/2 reference shots.* · 2 saved entries could not be read and are ignored$/);
  assert.match(await page.locator('#cr-check').textContent(),/2 checked\) is off by a median of 0\.0%, worst 0\.0%/);assert.match(await page.locator('#cr-hvl-hint').textContent(),/imply 13\.0 mm/);
  assert.deepEqual(page.errors,[]);await page.close();
  // A record with another schema version is not read as calibration.
  page=await open(seed,{schemaVersion:2,shots:[{totalSteel:.474,sfd:4.625,activity:26,seconds:20,pmt:40}]});assert.equal(await page.evaluate(()=>crCal.shots.length),0);await page.close();
}finally{await browser.close();}
console.log('PASS: calibrated CR refuses uncovered rows (screen, print, no timers), owner slider ranges, reference shot entry and validation, physics scaling, gain-only PMT conversion with no extrapolation, screen/print agreement and printed PMT, reference PMT reset and focus, steel curve and pixel target, persistence, helper refusal, Custom Shot with PMT and saved setups, narrow widths, unreadable stored entries, cross-check and suggested steel curve.');
