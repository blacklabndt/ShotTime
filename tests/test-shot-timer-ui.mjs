import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadApp} from './load-app.mjs';
const html=await loadApp(),browser=await chromium.launch({executablePath:process.env.CHROME_BINARY,args:['--no-sandbox']});
try{
 const context=await browser.newContext();await context.route('https://shottime.local/**',r=>r.fulfill({body:html,contentType:'text/html'}));const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('https://shottime.local/');
 await page.locator('#edit-source').click();await page.locator('#activity').fill('26');await page.locator('button[form="activity-form"]').click();
 for(const film of ['t200','cr']){
  await page.locator('#edit-source').click();const choices=page.locator('.film-options button[data-film="'+film+'"]');for(let i=0;i<await choices.count();i++)await choices.nth(i).click();await page.locator('#close-sheet').click();
  const count=await page.evaluate(()=>{
   let count=0;
   for(const row of document.querySelectorAll('.shot')){
    const value=row.dataset.seconds==='null'?null:Number(row.dataset.seconds),size=Number(row.dataset.size),film=row.dataset.film;
    for(const [selector,kind,seconds]of [['.timing','External',value===null?0:Math.round(value)],['.internal-value','Internal',value!==null&&size>=6?ShotCalculator.internalSeconds(film,value):0],['.offset-value','Internal offset',value!==null&&size>=6?ShotCalculator.offsetSeconds(film,value):0]]){
     const link=row.querySelector(selector+' a');
     if(seconds<1||seconds>604800){if(link)throw Error('Unavailable time linked');continue;}
     if(!link)throw Error('Missing timer link');const u=new URL(link.href);
     if(Number(u.searchParams.get('seconds'))!==seconds)throw Error('Wrong rounding');
     if(!u.searchParams.get('detail').startsWith(kind+' · '))throw Error('Wrong shot type');
     if(!u.searchParams.get('label').includes(row.dataset.schedule))throw Error('Wrong context');count++;
    }
   }return count;
  });assert.ok(count>10);
 }
 for(const width of [320,393,430]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 const printed=await page.evaluate(()=>makePrintDocument());assert.ok(!printed.includes('shottime://timer'));
 assert.deepEqual(errors,[]);console.log('PASS: timer links preserve displayed film/CR rounding, shot type, missing-value rules, mobile layout and print isolation');
}finally{await browser.close();}
