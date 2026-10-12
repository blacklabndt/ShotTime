(function(){
'use strict';
const U=Unsharpness,host=document.getElementById('unsharpness');
host.innerHTML=`<h1 id="ug-title" tabindex="-1">Unsharpness Calculator</h1><p class="hint">Geometric unsharpness · Ug = F × d ÷ D</p>
<form id="ug-form" class="panel" novalidate>
<label for="ug-code">Code reference</label><select id="ug-code"></select>
<label for="ug-medium">Imaging method</label><select id="ug-medium"><option value="film">Film</option><option value="cr">Computed radiography (CR)</option></select>
<label for="ug-unit">Measurement units</label><select id="ug-unit"><option value="in">Inches</option><option value="mm">Millimetres (mm)</option></select>
<label for="ug-source">Source size · F <span class="ug-unit-label">(in)</span></label><input id="ug-source" inputmode="decimal" maxlength="24" aria-describedby="ug-source-help"><p id="ug-source-help" class="hint">Maximum projected active source dimension or effective focal spot across the beam. Use the source certificate.</p>
<label for="ug-distance">Source to object · D <span class="ug-unit-label">(in)</span></label><input id="ug-distance" inputmode="decimal" maxlength="24" aria-describedby="ug-distance-help"><p id="ug-distance-help" class="hint">From the source to the source-side surface of the weld being evaluated.</p>
<label for="ug-gap">Source-side weld surface to image · d <span class="ug-unit-label">(in)</span></label><input id="ug-gap" inputmode="decimal" maxlength="24" aria-describedby="ug-gap-help"><p id="ug-gap-help" class="hint">Includes the depth of the evaluated weld and any gap to the film or plate. For CSA, use the weld surface farthest from the imaging media.</p>
<div id="ug-thickness-field"><label for="ug-thickness">IQI basis thickness <span class="ug-unit-label">(in)</span></label><input id="ug-thickness" inputmode="decimal" maxlength="24"><p class="hint">Thickness used for IQI selection, including applicable reinforcement. Separate from d; do not automatically add both pipe walls.</p></div>
<p id="ug-error" role="alert" class="error"></p><button id="ug-calculate" class="primary" type="submit">Calculate unsharpness</button></form>
<section id="ug-result" class="panel" aria-live="polite" hidden><span class="hint">Your geometric unsharpness · Ug</span><div id="ug-value"></div><p id="ug-status"></p><p id="ug-explanation" class="hint"></p><dl id="ug-results"></dl><p id="ug-adjustment"></p><p class="hint">Geometry check only. Image quality, procedure requirements and weld acceptance are separate.</p></section>
<details class="panel"><summary>Code reference, formulas &amp; thickness limits</summary><div id="ug-basis-field"><label for="ug-basis">Code table basis</label><select id="ug-basis"><option value="mm">Published metric values</option><option value="in">Published inch values</option></select><p class="hint">Independent of measurement units. Published code values are rounded differently; changing input units alone keeps this basis unchanged.</p></div><p id="ug-reference"></p><p id="ug-code-note" class="hint"></p><p id="ug-table-note" class="hint"></p></details>
<details class="panel"><summary>Which distances do I measure?</summary>
<svg viewBox="0 0 360 190" role="img" aria-labelledby="ug-diagram-title"><title id="ug-diagram-title">Source to source-side weld surface is D; that surface to imaging plane is d. Total source-to-image distance equals D plus d. Diagram not to scale.</title>
<path d="M30 68L320 30M30 52L320 110" fill="none" stroke="#d18073" stroke-width="2"/>
<path d="M30 50V70" stroke="#d18073" stroke-width="6"/><rect x="220" y="30" width="38" height="80" fill="#807168" stroke="#dfd4cb"/><path d="M320 20V116" stroke="#dfd4cb" stroke-width="4"/>
<g fill="currentColor" font-size="13" text-anchor="middle"><text x="32" y="20">F</text><text x="128" y="132">D</text><text x="270" y="132">d</text><text x="174" y="174">Source-to-image = D + d</text></g>
<g fill="none" stroke="currentColor"><path d="M30 118V145M220 118V145M320 118V145M30 138H220M220 138H320"/></g></svg>
<p class="hint">Schematic, not to scale. Measure along the beam at the area of interest. For double-wall work, identify which wall is being evaluated before entering D and d. The total source-to-film/plate distance is D + d.</p></details>`;
const $=id=>document.getElementById('ug-'+id),fields=['source','distance','gap','thickness'];let unit='in';
for(const p of U.profiles){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;$('code').append(o);}
function invalidate(){$('result').hidden=true;$('error').textContent='';}
function references(){
 const p=U.profiles.find(x=>x.id===$('code').value),csa=p.id.startsWith('csa-'),fixed=['b311','i'].includes(p.id),cr=$('medium').value==='cr';
 $('thickness-field').hidden=csa||fixed;$('basis-field').hidden=csa;
 $('reference').textContent=p.name+' · '+p.ref+(csa?'':' · Calculation: ASME V (2025), T-274.1')+(!csa&&!fixed?' · T-274.2':'')+(cr&&!csa?' · CR: Section V, Article 2, Mandatory Appendix VIII, VIII-210':'');
 $('code-note').textContent=p.note+(cr?' CR result covers geometric blur only; plate/scanner resolution and IQI performance require their own checks.':'');
 $('table-note').textContent=csa?'Ug is calculated for information. Minimum D = 6d; preferred D = 9d, since source-to-image distance = D + d.':fixed?'Minimum D = F × d ÷ the selected code threshold.':$('basis').value==='mm'?'Metric T-274.2: thickness <50 → 0.51 mm; 50–75 → 0.76 mm; >75–100 → 1.02 mm; >100 → 1.78 mm. Minimum D = F × d ÷ the recommendation.':'Inch T-274.2: thickness <2 → 0.020 in; 2–3 → 0.030 in; >3–4 → 0.040 in; >4 → 0.070 in. Minimum D = F × d ÷ the recommendation.';
}
function format(n){return Number(n.toPrecision(5)).toString();}
function both(mm,roundUp=false){const primary=unit==='in'?mm/25.4:mm,secondary=unit==='in'?mm:mm/25.4;const show=n=>roundUp?String(Math.ceil(n*1000)/1000):format(n);return show(primary)+' '+unit+' ('+show(secondary)+' '+(unit==='in'?'mm':'in')+')';}
function row(label,value,id){const r=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;if(id)dd.id=id;r.append(dt,dd);$('results').append(r);}
for(const id of fields)$(id).addEventListener('input',invalidate);
for(const id of ['code','medium','basis'])$(id).addEventListener('change',()=>{invalidate();references();});
$('unit').addEventListener('change',()=>{
 const next=$('unit').value,scale=next==='mm'?25.4:1/25.4;
 if(next!==unit)for(const id of fields){const el=$(id),value=el.value.trim();if(value!==''&&Number.isFinite(Number(value)))el.value=String(Number((Number(value)*scale).toPrecision(15)));}
 unit=next;for(const label of host.querySelectorAll('.ug-unit-label'))label.textContent='('+unit+')';invalidate();
});
$('form').addEventListener('submit',e=>{
 e.preventDefault();invalidate();
 try{
  const input={code:$('code').value,medium:$('medium').value,basis:$('basis').value,unit};for(const id of fields)input[id]=$(id).value;
  const r=U.calculate(input);$('value').textContent=both(r.ug);$('results').replaceChildren();
  const geometry=r.kind==='geometry',mandatory=r.kind==='threshold';
  $('status').textContent=geometry?(r.within?'Meets minimum source distance (7×)':'Source distance is too short'):(r.within?'Within ':'Exceeds ')+(mandatory?'code Ug limit':'recommended limit');
  $('status').className=r.within?'ug-within':'ug-outside';
  const image=input.medium==='cr'?'plate':'film',distanceLabel='Source to '+image;
  $('explanation').textContent=geometry?'This CSA check compares source distance with weld-to-image distance. It does not set a numerical unsharpness limit.': 'Lower unsharpness means less geometric blur. '+(mandatory?'A result above this code limit exceeds the stated Ug rejection threshold.':'This is a recommended maximum, not a standalone pass/fail decision for the radiograph.');
  if(r.limit!==null){
   row(mandatory?'Maximum allowed Ug':'Recommended maximum Ug',both(r.limit),'ug-limit');
   const delta=r.limit-r.ug,atLimit=Math.abs(delta)<=Math.max(r.limit,r.ug)*1e-12;
   row(atLimit?'At the maximum':r.within?'Margin below maximum':'Amount above maximum',both(atLimit?0:Math.abs(delta)),'ug-margin');
   row('Code values used',input.basis==='mm'?'Published metric values':'Published inch values');
  }
  row(distanceLabel+' · actual',both(r.sfd),'ug-actual-distance');
  row(geometry?distanceLabel+' · minimum (7×)':distanceLabel+' · minimum for this '+(mandatory?'limit':'recommendation'),both(r.minimumSfd,true),'ug-minimum-distance');
  row('Source to weld surface · minimum D',both(r.minimumD,true));
  if(geometry){
   row(distanceLabel+' · preferred (10×)',both(r.preferredSfd,true),'ug-preferred-distance');
   row('Preferred distance check',r.preferred?'Preferred distance reached':'Preferred distance not reached','ug-preferred-status');
  }
  $('adjustment').textContent=!r.within?'Increase source distance. With the same source size and weld-to-image distance, use at least '+both(r.minimumD,true)+' from source to weld surface, or '+both(r.minimumSfd,true)+' from source to '+image+'.':geometry&&!r.preferred?'Minimum met. For the preferred setup, increase source-to-'+image+' distance to at least '+both(r.preferredSfd,true)+'.':'No increase in source distance is needed for this '+(geometry?'geometry minimum':mandatory?'Ug limit':'Ug recommendation')+'.';
  $('result').hidden=false;
 }catch(error){$('error').textContent=error.message;}
});
references();
})();
