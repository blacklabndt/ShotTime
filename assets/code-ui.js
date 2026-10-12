(function(){
'use strict';
const $=id=>document.getElementById(id),C=CodeCalculator;
const root=$('code-calculator');
root.innerHTML=`<h1 id="code-title" tabindex="-1">Code Calculator</h1>
<p class="intro">Weld acceptance reference · metric code basis</p>
<form id="code-form" class="panel" novalidate>
 <label for="code-select">Code and service</label><select id="code-select"></select>
 <p id="code-basis" class="code-basis"></p><p id="code-scope" class="hint"></p>
 <label for="code-unit">Input units</label><select id="code-unit"><option value="mm">Millimetres</option><option value="in">Inches</option></select>
 <p class="hint">Inches are converted to mm. Results use metric code limits, not US customary tables.</p>
 <div id="code-nps-field"><label for="code-nps">Nominal pipe size (inches)</label><select id="code-nps"><option value="">Choose size</option></select></div>
 <label for="code-schedule">Pipe schedule</label><select id="code-schedule" disabled><option value="">Choose schedule</option></select>
 <label for="code-thickness" id="code-thickness-label">Thickness, t (mm)</label><input id="code-thickness" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 6.4"><p id="code-wall-hint" class="hint">Choose size and schedule to fill nominal wall thickness, or enter a thickness.</p><button type="button" id="code-use-wall" disabled>Use schedule thickness</button>
 <div id="code-length-field"><label for="code-length" id="code-length-label">Total weld length (mm)</label><input id="code-length" type="text" inputmode="decimal" autocomplete="off" placeholder="Needed for cumulative limits"><p class="hint" id="code-length-hint">Choose a pipe size to use its circumference, or enter a length. Leave blank for individual limits only.</p><button type="button" id="code-use-circumference">Use circumference</button></div>
 <div id="code-category-field" hidden><label for="code-category">Joint category for reinforcement</label><select id="code-category"><option value="">Choose category</option><option value="bc">Category B / C butt weld</option><option value="other">Other weld</option></select></div>
 <div id="code-boiler-field" hidden><label for="code-boiler-joint">PW-35 joint type</label><select id="code-boiler-joint"><option value="">Choose joint type</option><option value="pipe">Circumferential joint in pipe / tubing</option><option value="other">Other weld (including pipe used as a shell)</option></select></div>
 <div id="code-b311-fields" hidden><label for="code-temperature">Design temperature range</label><select id="code-temperature"><option value="">Choose range</option><option value="low">Below 175°C</option><option value="mid">175°C through 400°C</option><option value="high">Above 400°C</option></select><label for="code-weld-sides">Weld construction</label><select id="code-weld-sides"><option value="">Choose construction</option><option value="single">Single-welded butt joint</option><option value="double">Double-welded butt joint</option></select></div>
 <div id="code-width-field" hidden><label for="code-weld-width" id="code-width-label">Weld width (mm)</label><input id="code-weld-width" type="text" inputmode="decimal" autocomplete="off"><p class="hint">Width of the face being evaluated. Evaluate faces separately if their widths differ.</p></div>
 <details id="code-iqi-input"><summary id="code-iqi-label">IQI · ASME V 2025 film reference</summary><div id="code-iqi-asme"><label for="code-reinforcement" id="code-reinforcement-label">Total ID + OD reinforcement (mm)</label><input id="code-reinforcement" type="text" inputmode="decimal" autocomplete="off" placeholder="0 for flush"><p class="hint">Use representative reinforcement within the governing code’s permitted heights. Exclude backing. Confirm the procedure’s required Section V edition.</p></div><div id="code-iqi-csa" hidden><label for="code-radiation">Radiation type</label><select id="code-radiation"><option value="gamma">Gamma radiography</option><option value="xray">X-ray radiography</option></select><label for="code-iqi-thickness" id="code-iqi-thickness-label">Weld thickness for IQI (mm)</label><input id="code-iqi-thickness" type="text" inputmode="decimal" autocomplete="off" placeholder="Include crown"><p class="hint">Not more than wall thickness plus the standard maximum crown height. No small-pipe wire relaxation assumed.</p></div></details>
 <button class="primary" id="code-calculate" type="submit">Show limits</button><p class="error" id="code-error" role="alert"></p>
</form>
<p id="code-status" class="hint" role="status"></p>
<section id="code-results" aria-labelledby="code-result-heading" hidden><h2 id="code-result-heading" tabindex="-1"></h2><p id="code-coverage" class="code-notice"></p>
<div id="code-iqi" class="panel"></div><div id="code-cards"></div><details class="details"><summary>Basis and remaining checks</summary><p id="code-source"></p><p>Use the job’s governing edition and any stricter project requirements. These are reference limits, not a complete weld acceptance decision. Distribution charts, spacing conditions and required examinations still apply. Edition labels identify the checked revision where available. Later updates and remaining code requirements still need review.</p><div id="code-notes"></div></details></section>`;
const labels={'0.125':'1/8','0.25':'1/4','0.375':'3/8','0.5':'1/2','0.75':'3/4','1.25':'1 1/4','1.5':'1 1/2','2.5':'2 1/2','3.5':'3 1/2'};
for(const n of [.125,.25,.375,.5,.75,1,1.25,1.5,2,2.5,3,3.5,4,5,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,40,42,48])$('code-nps').add(new Option(labels[n]||String(n),String(n)));
for(const d of C.definitions)$('code-select').add(new Option(d.name+' — '+d.edition,d.id));
const fmt=n=>Number(n.toFixed(5)).toString();
function syncWidth(){const id=$('code-select').value,t=Number((Number($('code-thickness').value)*($('code-unit').value==='in'?25.4:1)).toPrecision(12));$('code-width-field').hidden=!(t>50&&((id==='i'&&$('code-boiler-joint').value==='pipe')||(id==='b311'&&['low','mid'].includes($('code-temperature').value))));}
function invalidate(){syncWidth();const had=!$('code-results').hidden;$('code-results').hidden=true;$('code-error').textContent='';if(had)$('code-status').textContent='Inputs changed. Tap Show limits to update.';}
function config(){const d=C.definitions.find(x=>x.id===$('code-select').value),csa=d.id.startsWith('csa-');$('code-basis').textContent=d.edition+(d.legacy!==undefined?' · Legacy workbook':' · Selected clauses');$('code-scope').textContent=d.scope;$('code-length-field').hidden=!d.length;$('code-nps-field').hidden=false;syncLength();$('code-category-field').hidden=!d.category;$('code-iqi-input').hidden=false;$('code-boiler-field').hidden=d.id!=='i';$('code-b311-fields').hidden=d.id!=='b311';syncWidth();$('code-iqi-asme').hidden=csa;$('code-iqi-csa').hidden=!csa;$('code-iqi-label').textContent=csa?'IQI · CSA Z662:23 reference':d.id==='b311'?'IQI · ASME V 2010 / 2011a film reference':'IQI · ASME V 2025 film reference';units();invalidate();}
function units(){const u=$('code-unit').value==='mm'?'mm':'inches';$('code-width-label').textContent='Weld width ('+u+')';$('code-thickness-label').textContent='Thickness, t ('+u+')';$('code-reinforcement-label').textContent='Total ID + OD reinforcement ('+u+')';$('code-iqi-thickness-label').textContent='Weld thickness for IQI ('+u+')';$('code-length-label').textContent=($('code-select').value==='viii-spot'?'Radiograph evaluation length':'Total weld length')+' ('+u+')';}
let manualWall=false;
let unit='mm',manualLength=false,spotMode=false,savedLength='';
function syncLength(){
 const spot=$('code-select').value==='viii-spot';
 if(spot!==spotMode){const previous=$('code-length').value;$('code-length').value=savedLength;savedLength=previous;spotMode=spot;}
 $('code-use-circumference').hidden=spot;
 const selected=$('code-nps').value;
 $('code-use-circumference').disabled=!selected;
 if(!spot&&!manualLength){
  const row=selected?PIPE_CHART.rows.find(r=>r.nps===(labels[selected]||selected)):null;
  $('code-length').value=row?Number((row.od*Math.PI*(unit==='mm'?25.4:1)).toPrecision(12)).toString():'';
 }
 $('code-length-hint').textContent=spot?'Enter the radiograph evaluation length.':manualLength?'Custom length. Use circumference to follow the selected pipe size.':selected?'Default: full circumference from the pipe outside diameter. You can edit this length.':'Choose a pipe size to use its circumference, or enter a length. Leave blank for individual limits only.';
}
$('code-length').addEventListener('input',()=>{if(!spotMode)manualLength=true;syncLength();});
function pipeRow(){const n=$('code-nps').value;return n?PIPE_CHART.rows.find(r=>r.nps===(labels[n]||n)):null;}
function syncWall(){
 const row=pipeRow(),wall=row&&row.walls[$('code-schedule').value];
 $('code-use-wall').disabled=wall===undefined||wall===null;
 if(!manualWall)$('code-thickness').value=wall?Number((wall*(unit==='mm'?25.4:1)).toPrecision(12)).toString():'';
 $('code-wall-hint').textContent=manualWall?'Custom thickness. Use schedule thickness to restore the chart value.':wall?'Nominal wall thickness from the pipe schedule chart. Edit if needed.':'Choose size and schedule to fill nominal wall thickness, or enter a thickness.';
}
$('code-nps').addEventListener('change',()=>{
 const row=pipeRow(),previous=$('code-schedule').value;
 $('code-schedule').replaceChildren(new Option('Choose schedule',''));
 for(const key of ['5','10','20','30','STD','40','60','XH','80','100','120','140','160','XXH'])if(row&&row.walls[key]!==undefined)$('code-schedule').add(new Option(key,key));
 $('code-schedule').disabled=!row;
 $('code-schedule').value=row&&row.walls[previous]!==undefined?previous:'';
 syncWall();syncLength();invalidate();
});
$('code-schedule').addEventListener('change',()=>{syncWall();invalidate();});
$('code-thickness').addEventListener('input',()=>{manualWall=true;syncWall();});
$('code-use-wall').addEventListener('click',()=>{manualWall=false;syncWall();invalidate();});
$('code-use-circumference').addEventListener('click',()=>{manualLength=false;syncLength();invalidate();});
$('code-unit').addEventListener('change',()=>{const next=$('code-unit').value;for(const id of ['code-thickness','code-length','code-reinforcement','code-iqi-thickness','code-weld-width']){const e=$(id),s=e.value.trim();if(s&&Number.isFinite(Number(s))){const value=Number(s)*(unit==='in'?25.4:1)/(next==='in'?25.4:1);e.value=Number(value.toPrecision(15)).toString();}}savedLength=savedLength&&Number.isFinite(Number(savedLength))?Number((Number(savedLength)*(unit==='in'?25.4:1)/(next==='in'?25.4:1)).toPrecision(12)).toString():savedLength;unit=next;units();syncLength();invalidate();});
$('code-select').addEventListener('change',config);
$('code-form').addEventListener('input',invalidate);
$('code-form').addEventListener('change',invalidate);
function text(tag,content,cls){const e=document.createElement(tag);e.textContent=content;if(cls)e.className=cls;return e;}
// Original measurement schematics, not reproductions of code distribution charts.
function explanation(c){
 if(!/Appendix 4|A-250/.test(c.ref)||!['rounded','rounded-aligned','rounded-clusters'].includes(c.key))return null;
 const details=text('details','', 'code-explanation');details.append(text('summary','Explain with a diagram'));
 details.append(text('p','Explanation—not to scale','hint'));
 if(c.title.includes('D base reference'))details.append(text('p','D base reference only. Criterion E distribution adjustment still requires manual evaluation.','code-notice'));
 const measure=label=>c.values.find(v=>v.label===label)?.value;
 const mm=n=>fmt(n)+' mm';
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 300 130');svg.setAttribute('role','img');
 function shape(tag,attrs,label){const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(label)e.textContent=label;svg.append(e);return e;}
 const line=(x1,y1,x2,y2)=>shape('line',{x1,y1,x2,y2,stroke:'currentColor','stroke-width':1.5});
 const caption=(x,y,t)=>shape('text',{x,y,'text-anchor':'middle',fill:'currentColor','font-size':13},t);
 const bracket=(x1,x2,y,label)=>{line(x1,y,x2,y);line(x1,y-5,x1,y+5);line(x2,y-5,x2,y+5);caption((x1+x2)/2,y+21,label);};
 const dot=(x,y,r=5)=>shape('circle',{cx:x,cy:y,r,fill:'currentColor'});
 let label,description,examples=[];
 if(c.key==='rounded'){
  label='Measure the longest dimension and the clear gap to an isolated indication';
  shape('ellipse',{cx:63,cy:43,rx:23,ry:11,fill:'currentColor'});dot(239,43,14);
  bracket(40,86,68,'Dimension');bracket(86,225,15,'Clear gap');caption(239,89,'Isolated');
  const max=measure('Maximum dimension'),isolated=measure('Isolated maximum dimension');
  description='Measure the longest dimension, including any tail. Ordinary maximum: '+mm(max)+'. The isolated allowance is '+mm(isolated)+' only with at least 25 mm clear separation from adjacent indications. Rounded length must also be no more than three times its width.';
  examples=['Within ordinary size limit: '+mm(max)+' (at the limit).','Exceeds ordinary size limit: '+mm(max*1.1)+'. Check the isolated rule separately if applicable.'];
 }else if(c.key==='rounded-aligned'){
  label='Add the indication diameters, not the intervening gaps';
  line(20,42,280,42);[48,102,165,246].forEach((x,i)=>{dot(x,42,7);caption(x,23,'d'+(i+1));});bracket(20,280,73,'Evaluation window');
  const sum=measure('Diameter sum must be less than'),span=measure('Evaluation span');
  description='Across '+mm(span)+', add d1 + d2 + d3 + d4 (and any other aligned indications). Their total must be strictly less than '+mm(sum)+'. Do not add the empty gaps. Check the group limits below as well.';
  examples=['Within diameter-sum limit: '+mm(sum*.75)+'.','Exceeds the strict limit: '+mm(sum)+'—equality is not allowed.'];
  const groupMax=sum<19?6:sum<=57?sum/3:19;
  svg.setAttribute('viewBox','0 0 300 240');
  line(25,146,100,146);line(198,146,275,146);caption(63,134,'Group A');caption(236,134,'Group B');bracket(100,198,162,'Gap ≥ 3L');caption(150,211,'L = longer adjacent group');
  description+=' Each aligned group may be at most '+mm(groupMax)+'. The clear gap between groups must be at least three times the longer adjacent group length. The sum of group lengths must also be strictly less than '+mm(sum)+' within '+mm(span)+'.';

 }else{
  label='Measure each cluster from end to end, then add the cluster lengths';
  shape('rect',{x:25,y:22,width:90,height:42,rx:14,fill:'none',stroke:'currentColor','stroke-dasharray':'4 3'});
  shape('rect',{x:176,y:22,width:93,height:42,rx:14,fill:'none',stroke:'currentColor','stroke-dasharray':'4 3'});
  caption(70,48,'Cluster A');caption(223,48,'Cluster B');bracket(25,115,77,'Length A');bracket(176,269,77,'Length B');
  const max=measure('Maximum cluster length'),total=measure('Combined cluster length per 150 mm');
  description='Each cluster length must be no more than '+mm(max)+'. Within any 150 mm of weld, Length A + Length B + any other cluster lengths must total no more than '+mm(total)+'. These outlined regions show what to measure; they do not illustrate permitted porosity density.';
  const each=Math.min(max,total/2)*.8;
  examples=['Within these length limits: two clusters of '+mm(each)+' each; total '+mm(each*2)+'.','Exceeds the individual length limit: one cluster of '+mm(max*1.1)+'.'];
 }
 svg.setAttribute('aria-label',label);details.append(svg,text('p',description,'code-condition'));
 for(const [i,example] of examples.entries())details.append(text('p',(i===0?'✓ ':'× ')+example,'code-example '+(i===0?'within':'exceeds')));
 details.append(text('p','Examples assess only the named measurement rule. All other size, spacing, distribution and examination requirements still apply.','hint'));
 return details;
}
function offlineChart(ref,key){
 const highRes=CODE_CHART_IMAGES['hq:'+ref.figure];
 const details=text('details','','code-offline-chart');details.append(text('summary','Offline chart · Figure '+ref.figure));
 details.append(text('p','Thickness '+ref.range+'. '+(highRes?.source||ref.source||'Supplied screenshot from Sulzer TP-0008 Rev. 10 (Appendix 4 reference, 2023).')+(ref.percent?' '+ref.percent+'% maximum projected area.':''),'hint'));
 details.append(text('p','Reference image—not calibrated to physical size. Zoom changes display size, not the code limits.','hint'));
 if(ref.obscured)details.append(text('p','Incomplete image: the phone page counter covers part of this figure’s cluster pattern. Do not use the hidden region for comparison.','code-notice'));
 const tools=text('div','','code-chart-tools');
 const label=text('label','Zoom chart');label.htmlFor='chart-zoom-'+key;
 const zoom=document.createElement('input');zoom.type='range';zoom.min='100';zoom.max='300';zoom.step='25';zoom.value='100';zoom.id=label.htmlFor;
 const viewport=text('div','','code-chart-window');viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','Figure '+ref.figure+' scrollable chart');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('code-chart-canvas');svg.setAttribute('viewBox',highRes?.viewBoxes?.[ref.band]||highRes?.viewBox||ref.viewBox);svg.setAttribute('role','img');svg.setAttribute('aria-label','Figure '+ref.figure+': '+(ref.description||'random rounded indications, isolated indication and cluster')+', '+ref.range+(ref.obscured?'; cluster partially obscured':''));svg.style.width='100%';
 const image=document.createElementNS(svg.namespaceURI,'image');image.setAttribute('href',highRes?.href||CODE_CHART_IMAGES[ref.image]);image.setAttribute('width',String(highRes?.width||591));image.setAttribute('height',String(highRes?.height||1280));const transform=highRes?highRes.transform:ref.transform;if(transform)image.setAttribute('transform',transform);const defs=document.createElementNS(svg.namespaceURI,'defs'),filter=document.createElementNS(svg.namespaceURI,'filter'),matrix=document.createElementNS(svg.namespaceURI,'feColorMatrix');
 // Map original luminance onto the app's charcoal/warm-grey palette without changing geometry.
 const filterId='chart-tone-'+key;filter.id=filterId;filter.setAttribute('color-interpolation-filters','sRGB');
 matrix.setAttribute('type','matrix');matrix.setAttribute('values','-.1509 -.5076 -.0512 0 .7804 -.1459 -.4908 -.0496 0 .7569 -.1426 -.4796 -.0484 0 .7412 0 0 0 1 0');filter.append(matrix);defs.append(filter);
 if(highRes?.themed&&highRes.href.startsWith('data:image/svg+xml;base64,')){
  const vector=document.importNode(new DOMParser().parseFromString(atob(highRes.href.split(',')[1]),'image/svg+xml').documentElement,true);vector.classList.add('code-chart-vector');vector.setAttribute('aria-hidden','true');
  // Inline paths scale at the current zoom instead of using an SVG-image raster cache.
  for(const node of [vector,...vector.querySelectorAll('*')]){
   if(node.id)node.id='chart-'+key+'-'+node.id;
   for(const attr of [...node.attributes]){if(attr.localName==='href'&&attr.value.startsWith('#'))attr.value='#chart-'+key+'-'+attr.value.slice(1);else if(attr.value.includes('url(#'))attr.value=attr.value.replaceAll('url(#','url(#chart-'+key+'-');}
  }
  svg.append(vector);
 }else svg.append(defs,image);
 viewport.append(svg);
 if(!highRes?.themed)image.setAttribute('filter','url(#'+filterId+')');
 const value=text('output','100%');value.htmlFor=zoom.id;value.setAttribute('aria-label','Chart zoom');
 const reset=text('button','Reset zoom','secondary');reset.type='button';
 function applyZoom(){svg.style.width=zoom.value+'%';zoom.setAttribute('aria-valuetext',zoom.value+' percent');value.textContent=zoom.value+'%';}
 reset.addEventListener('click',()=>{zoom.value='100';applyZoom();viewport.scrollTo(0,0);});tools.append(label,value,reset);

 zoom.addEventListener('input',applyZoom);applyZoom();
 details.append(tools,zoom,viewport);return details;
}
$('code-form').addEventListener('submit',event=>{
 event.preventDefault();invalidate();
 try{
  const d=C.definitions.find(x=>x.id===$('code-select').value);
  if(d.category&&!$('code-category').value)throw Error('Choose the joint category for reinforcement.');
  const r=C.calculate({id:d.id,unit,thickness:$('code-thickness').value,length:$('code-length').value,nps:$('code-nps').value,category:$('code-category').value,reinforcement:$('code-reinforcement').value,iqiThickness:$('code-iqi-thickness').value,radiation:$('code-radiation').value,boilerJoint:$('code-boiler-joint').value,temperatureBand:$('code-temperature').value,weldSides:$('code-weld-sides').value,weldWidth:$('code-weld-width').value},CODE_DATA);
  $('code-result-heading').textContent=r.name+' · '+r.edition;
  $('code-coverage').textContent=r.coverage;
  const iqi=$('code-iqi');iqi.replaceChildren(text('h3','IQI reference'));
  if(r.iqi){iqi.append(text('p',r.iqi.iso?'ISO wire '+r.iqi.iso+' · '+fmt(r.iqi.diameter)+' mm maximum diameter':'Source side: ASTM wire '+r.iqi.source+' · Film side: ASTM wire '+r.iqi.film,'code-wire'),text('p','Selection thickness: '+fmt(r.iqi.basis)+' mm','hint'),text('p',r.iqiSource,'hint'));}
  iqi.append(text('p',r.iqiNote,'hint'));
  const list=$('code-cards');list.replaceChildren();
  for(const c of r.cards){
   const card=document.createElement('article');card.className='panel code-card';card.dataset.codeKey=c.key;
   card.append(text('p',c.method+' · '+c.ref,'hint'),text('h3',c.title));
   if(c.values.length){const dl=document.createElement('dl');for(const v of c.values){const row=document.createElement('div');row.append(text('dt',v.label),text('dd',v.value===null?'Needs input':fmt(v.value)+' '+v.unit));if(v.value!==null&&v.unit==='mm')row.lastChild.append(text('small',fmt(v.value/25.4)+' in (converted)'));dl.append(row);}card.append(dl);}
   card.append(text('p',c.note,'code-condition'));
   const guide=explanation(c);if(guide)card.append(guide);
   const localChart=['rounded-clusters','rounded-distribution'].includes(c.key)?C.offlineAppendixChart(r.id,r.thickness):(r.id==='ix'&&c.key==='rounded'?C.offlineQualificationChart(r.thickness):(r.id.startsWith('csa-')&&c.key==='porosity'?C.offlineCsaChart(r.thickness):null));
   const boilerCharts=['i','b311'].includes(r.id)?C.offlineBoilerCharts(c.key,r.thickness):[];
   if(localChart)card.append(offlineChart(localChart,c.key));
   boilerCharts.forEach((ref,i)=>card.append(offlineChart(ref,c.key+'-'+i)));
   if(c.charts&&c.key!=='rounded-aligned'&&(!localChart||localChart.obscured)&&!boilerCharts.length){
    const details=document.createElement('details');details.className='code-chart-links';details.append(text('summary','Chart links'));
    for(const ref of c.charts){const a=text('a',ref.label);a.href=ref.url;a.rel='noopener noreferrer';details.append(a,text('p',ref.source,'hint'));}
    details.append(text('p','Opens in your browser · internet required. PDF viewers may ignore the page link. Use the figure number to locate the chart; screen zoom is not a full-scale comparison.','hint'));card.append(details);
   }
   list.append(card);
  }
  $('code-source').textContent=r.source;
  $('code-notes').replaceChildren(...r.notes.map(n=>text('p',n)));
  $('code-results').hidden=false;$('code-status').textContent='Reference limits updated.';$('code-result-heading').focus();
 }catch(e){$('code-error').textContent=e.message;$('code-status').textContent='';}
});
config();
})();
