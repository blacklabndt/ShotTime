(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CodeCalculator=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// Metric code values are used throughout. Inch inputs are geometry conversions,
// not a switch to the independently rounded US customary code tables.
const sources={
 b311:'ASME B31.1-2012, 127.4.2, Table 127.4.2 and 136.4.2–136.4.5',
 b313:'ASME B31.3-2024, Table 341.3.2-1 and criterion notes',
 csa:'CSA Z662:23 (March 2024 revision), 7.11, Tables 7.8–7.11',
 csaSour:'CSA Z662:23 (March 2024 revision), 7.11, 16.6.8.1, 16.9.3; Tables 7.8–7.11',
 viii:'ASME BPVC VIII-1 (2025), UW-35, UW-51 and UW-52',
 ix:'ASME BPVC IX (2025), QW-191.1.2',
 i:'ASME BPVC I (2025), PW-51.3',
 legacy:'NDE Acceptance Code Calculator Ver. 1.2, supplied workbook (2014-10-10)',
 iqi:'ASME BPVC V (2025), T-276.2 / Table T-276 (film radiography)'
};
const definitions=[
 {id:'b313-normal',name:'B31.3 · Normal / Category M',edition:'2024',source:'b313',length:true,scope:'Girth butt welds with filler metal, excluding aluminum. RT limits and accompanying visual checks.'},
 {id:'b313-severe',name:'B31.3 · Severe cyclic',edition:'2024',source:'b313',scope:'Girth butt welds with filler metal, excluding aluminum. RT limits and accompanying visual checks.'},
 {id:'csa-sweet',name:'CSA Z662 · Sweet service',edition:'2023 (March 2024 revision)',source:'csa',length:true,nps:true,scope:'Full-penetration steel butt welds evaluated under 7.11. Excludes sour service, alternative acceptance criteria and unequal-thickness IQI selection.'},
 {id:'csa-sour',name:'CSA Z662 · Sour service',edition:'2023 (March 2024 revision)',source:'csaSour',nps:true,length:true,scope:'Full-penetration carbon-steel butt welds under 7.11 and Clause 16. Confirm sour applicability under 16.1–16.2; 16.9 adds requirements for qualifying gas and multiphase systems. Excludes alternative acceptance criteria and unequal-thickness IQI selection.'},
 {id:'b311',name:'ASME B31.1',edition:'2012',source:'b311',scope:'Butt-weld reference retained at the requested edition. Use the thinner member; reinforcement depends on design temperature and welding from one or both sides.'},
 {id:'viii-full',name:'VIII-1 · UW-51 full RT',edition:'2025',source:'viii',category:true,scope:'Full-penetration butt welds. t excludes reinforcement and is the thinner member at the joint; combined fillet/butt joints need separate evaluation.'},
 {id:'viii-spot',name:'VIII-1 · UW-52 spot RT',edition:'2025',source:'viii',category:true,length:true,scope:'Spot RT of butt welds. Enter the radiograph evaluation length. Sampling and retest requirements remain in UW-52.'},
 {id:'ix',name:'Section IX · Qualification RT',edition:'2025',source:'ix',scope:'Welder / welding-operator qualification RT under QW-191. t is weld thickness excluding reinforcement (thinner member if unequal). Not production-weld acceptance.'},
 {id:'i',name:'Section I · PW-51 RT',edition:'2025',source:'i',scope:'Butt-weld RT under PW-51.3. t is the thinner section at the weld. Reinforcement and surface examinations require their separate clauses.'}
];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const positive=x=>x!==null&&x!==undefined&&String(x).trim()!==''&&finite(Number(x))&&Number(x)>0;
function evaluateCell(sheet,cell,inputs={},seen=new Set()){
 if(Object.prototype.hasOwnProperty.call(inputs,cell))return inputs[cell];
 if(seen.has(cell))return null;
 const next=new Set(seen);next.add(cell);
 const ast=sheet.formulas[cell];
 if(!ast){const v=sheet.values[cell];return v===undefined||v===false||/^error$/i.test(String(v))?null:v;}
 function run(a){
  if(!a)return null;
  const [op,x,y,z]=a;
  if(op==='literal')return x===false?null:x;
  if(op==='ref')return evaluateCell(sheet,x,inputs,next);
  if(op==='if'){const c=run(x);return c===null?null:run(c?y:z);}
  const l=run(x),r=run(y);if(l===null||r===null)return null;
  if(['+','-','*','/'].includes(op)){
   if(!finite(l)||!finite(r))return null;
   const v=op==='+'?l+r:op==='-'?l-r:op==='*'?l*r:r===0?NaN:l/r;return finite(v)?v:null;
  }
  if(op==='<')return l<r;if(op==='<=')return l<=r;if(op==='>')return l>r;if(op==='>=')return l>=r;if(op==='=')return l===r;if(op==='<>')return l!==r;return null;
 }
 const v=run(ast);return v===false||/^error$/i.test(String(v))?null:v;
}
function asmeIqi(t){
 if(!finite(t)||t<=0)return null;
 const bounds=[6.4,9.5,12.7,19,25.4,38.1,50.8,63.5,101.6,152.4,203.2,254,304.8,406.4,508];
 const n=bounds.findIndex(v=>t<=v);if(n<0)return null;
 return {source:[5,6,7,8,9,10,11,12,13,14,16,17,18,20,21][n],film:[4,5,6,7,8,9,10,11,12,13,14,16,17,18,20][n],basis:t};
}
function csaIqi(t,radiation){
 if(!finite(t)||t<=0||!['gamma','xray'].includes(radiation))return null;
 const n=[8,11,14,18,25,38,44].findIndex(v=>t<=v);if(n<0)return null;
 return {iso:(radiation==='gamma'?[13,12,11,10,10,9,8]:[14,13,12,11,10,9,8])[n],diameter:(radiation==='gamma'?[.2,.25,.32,.4,.4,.5,.63]:[.16,.2,.25,.32,.4,.5,.63])[n],basis:t,radiation};
}
function calculate(input,workbook){
 const d=definitions.find(x=>x.id===input.id);if(!d)throw Error('Choose a code.');
 if(!['mm','in'].includes(input.unit))throw Error('Choose mm or inches.');
 if(!positive(input.thickness))throw Error('Enter a positive wall / weld thickness.');
 const scale=input.unit==='in'?25.4:1;
 const mm=v=>Number((Number(v)*scale).toPrecision(12));
 const t=mm(input.thickness);if(t>1000)throw Error('Thickness exceeds the calculator input range of 1000 mm.');
 const length=positive(input.length)?mm(input.length):null;
 if(d.id==='viii-spot'&&length!==null&&length<150)throw Error('UW-52 requires a spot radiograph at least 150 mm long.');
 if(d.length&&input.length!==''&&input.length!=null&&!positive(input.length))throw Error('Enter a positive evaluation length, or leave it blank.');
 const nps=positive(input.nps)?Number(input.nps):null;
 if(d.nps&&(!nps||nps>48))throw Error('Choose a nominal pipe size up to 48 inches.');
 const cards=[];
 const add=(key,title,ref,note,values=[],method='RT')=>cards.push({key,title,ref,note,values,method});
 const val=(label,value,unit='mm')=>({label,value:finite(value)?value:null,unit});
 // Appendix 4 reference authorized by owner; edition provenance stays in result source.
 const appendix4=(ref,factor=1,a250=false)=>{
  const start=cards.length;
  const base=factor!==1?' · D base reference':'';
  const adjustment=factor!==1?'Criterion E requires 1.5 times D size/distribution limits. The values below are D base references; evaluate distribution adjustment manually. ':'';
  add('rounded','Rounded indications',ref+' / Appendix 4, 4-3(b),(c)',
   'Include tails. Rounded length is at most 3 times width. Isolated allowance requires separation of at least 25 mm. '+(factor!==1?'Size maxima include the 1.5× E allowance; relevance threshold is the Appendix 4 base definition. ':''),
   [val('Relevant when greater than',t<3?t/10:t<=6?.4:t<=50?.8:1.6),val('Maximum dimension',Math.min(t/4,4)*factor),val('Isolated maximum dimension',(t>50?10:Math.min(t/3,6))*factor)]);
  add('rounded-aligned','Aligned rounded indications'+base,'Appendix 4, 4-2(b), 4-3(d)',
   adjustment+'Alignment: four or more indications touching the weld-parallel line through the outer centres. Also check group length and spacing in Figure 4-2.',
   [val('Diameter sum must be less than',t),val('Evaluation span',12*t)]);
  add('rounded-clusters','Rounded clusters'+base,'Appendix 4, 4-3(h)',
   adjustment+'Cluster concentration also requires chart comparison.',
   [val('Maximum cluster length',Math.min(25,2*t)),val('Combined cluster length per 150 mm',25)]);
  add('rounded-distribution','Rounded distribution'+base,'Appendix 4, 4-3(f),(g)',
   adjustment+(t<3?'At most 12 indications per 150 mm; proportionately fewer for shorter welds. ':'Manual chart comparison required using Figures 4-3 through 4-8 for the thickness range; preserve the specified full scale. ')+
   'Size limits alone do not establish acceptance.');
  if(a250){
   const refs=['A-250.3.2–3','A-250.2.2 / A-250.3.4','A-250.3.8','A-250.3.6–7'];
   cards.slice(start).forEach((c,i)=>{c.ref=ref+' / '+refs[i];c.note=c.note.replace('Figure 4-2','Figure A-250.3.4-2').replace('Figures 4-3 through 4-8','Figures A-250.3.6-1 through A-250.3.6-6');});
  }
 };
 const none=(key,title,ref)=>add(key,title,ref,'No indication permitted.');
 const span=length===null?'Enter an evaluation length for the cumulative limit.':length<300?'Cumulative limit applies to the complete short weld.':'Cumulative limit applies in any 300 mm of weld.';
 const cap=(amount,ratio)=>length===null?null:length<300?ratio*length:amount;
 let iqi=null,iqiNote='',coverage='Selected RT limits; chart, distribution, spacing and surface checks remain applicable. No automatic accept/reject decision.';
 if(d.id==='b311'){
  const band=input.temperatureBand;
  if(!['high','mid','low'].includes(band))throw Error('Choose the design temperature range.');
  if(!['single','double'].includes(input.weldSides))throw Error('Choose single- or double-welded joint.');
  const n=t<=3?0:t<=5?1:t<=13?2:t<=25?3:t<=50?4:5;
  let reinforcement=band==='high'?[2,2,2,2.5,3,4][n]:band==='mid'?[2.5,3,4,5,6,null][n]:[5,5,5,5,6,null][n];
  if(reinforcement===null){if(!positive(input.weldWidth))throw Error('Enter weld width for reinforcement.');reinforcement=Math.max(6,mm(input.weldWidth)/8);}
  const ref='136.4.5(A)';
  none('crack','Cracks / incomplete fusion / penetration',ref+'(1)');
  add('linear','Other elongated indications',ref+'(2)','Use the thinner section.',[val('Individual length',t<=19?6:t<=57?t/3:19)]);
  add('aligned','Aligned indications',ref+'(3)','Spacing exception: successive gaps greater than six times the longest indication.',[val('Aggregate maximum',t),val('Evaluation span',12*t)]);
  add('concavity','Root concavity',ref+'(5) / 127.4.2(C.5)','No abrupt RT density change; smooth root contour and remaining weld thickness at least equal to the thinner member.');
  appendix4(ref+'(4)',1,true);
  add('undercut','Undercut','127.4.2(C.3)','Must also preserve the minimum required section thickness.',[val('Depth maximum',1)],'Visual');
  add('reinforcement','Maximum reinforcement','Table 127.4.2','Based on the thinner member; measure from the higher abutting surface. '+(input.weldSides==='double'?'Limit applies independently to both faces.':'Table applies to the outside face only.'),[val('Height',reinforcement)],'Visual');
  add('penetration','Inside reinforcement / penetration','Table 127.4.2 notes (a),(b)',input.weldSides==='double'?'Inside-face reinforcement is limited separately.':'For a single-welded joint, this table limits the outside only; it does not specify the workbook’s claimed matching root cap.',input.weldSides==='double'?[val('Inside height',reinforcement)]:[],'Visual');
  add('mtpt','MT / PT indications','136.4.3(B) / 136.4.4(B)','Relevant cracks/linear indications are unacceptable. Reject four or more rounded indications in line at gaps of 2 mm or less; also reject ten or more in any 3870 mm² area with longest dimension ≤150 mm.',[val('Relevant when greater than',2),val('Rounded maximum dimension',5)],'MT/PT');
  coverage='Selected 2012 clauses with separately sourced A-250 and IQI references; see Basis and remaining checks. No automatic acceptance decision.';
 }else if(d.id.startsWith('b313')){
  const severe=d.id==='b313-severe',ref='Table 341.3.2-1';
  none('crack','Cracks',ref+' · A');
  if(severe){none('fusion','Incomplete fusion / penetration',ref+' · A');none('undercut','Undercut',ref+' · A');}
  else{
   add('fusion','Incomplete fusion / penetration',ref+' · C','Combined cumulative length in any 150 mm, also limited by total weld length. External-surface incomplete fusion is prohibited.',[val('Cumulative maximum',length===null?null:Math.min(38,.25*length))]);
   add('undercut','Undercut',ref+' · H','Depth must be evaluated visually. Internal and external lengths are combined within any 150 mm and limited by total length.',[val('Depth maximum',Math.min(1,t/4)),val('Cumulative maximum',length===null?null:Math.min(38,.25*length))],'RT / Visual');
  }
  add('linear','Other linear indications',ref+(severe?' · F':' · G'),severe?'Aggregate length within any 12t. Excludes incomplete fusion and penetration.':'Aggregate length within any 150 mm, also capped at 8% of total weld length. Excludes incomplete fusion and penetration.',[val('Individual length',severe?t/3:2*t),val('Width',Math.min(severe?2.5:3,severe?t/3:t/2)),val('Aggregate length',severe?t:length===null?null:Math.min(4*t,.08*length)),...(severe?[val('Evaluation span',12*t)]:[])]);
  const roundedFactor=!severe&&t>6?1.5:1;
  appendix4(ref+(severe?' · D':' · E')+' / note 2',roundedFactor);
  add('concavity','Concavity / burn-through',ref+' · K','For this weld scope, compare RT density (or digital brightness) with adjacent base metal; the affected region must not be darker.');
  add('reinforcement','Face / root reinforcement',ref+' · L','Each side is evaluated separately, from the lower adjacent surface; weld must blend smoothly.',[val('Maximum height',t<=6?1.5:t<=13?3:t<=25?4:5)],'Visual');
  add('surface','Surface porosity / exposed slag',ref+' · A, note 7',t<=5?'No evident imperfection.':'Table note 7 applies this criterion only at nominal thickness ≤5 mm. Follow any additional design requirements.',[],'Visual');
  if(severe)add('finish','Surface finish',ref+' · J','Surface roughness limit.',[val('Maximum Ra',12.5,'µm')],'Visual');
 }else if(d.id.startsWith('csa-')){
  const sour=d.id==='csa-sour';
  none('crack','Cracks / arc burns','7.11.15');
  if(sour){
   none('root','Root incomplete penetration / root incomplete fusion','16.6.8.1 / 16.9.3.3');
   add('top-fusion','Incomplete fusion at top of joint','7.11.4','Applies only at the top of the joint, not the root. '+span,[val('Individual length',12),val('Cumulative length',cap(25,.08))]);
   add('sour-scope','Sour-service application','16.1–16.2 / 16.9.1–16.9.3','For gas and multiphase systems within 16.9.1: full-circumference RT/UT is required and partial-penetration butt welds are prohibited. Root IP/IF also requires removal or qualified repair under 16.6.8.1. This screen does not determine service classification, hardness compliance or repair procedure suitability.',[],'Scope');
  }else add('root','Root IP / incomplete fusion at root or top','7.11.3 / 7.11.4',span,[val('Individual length',12),val('Cumulative length',cap(25,.08))]);
  add('cold','Cold lap / cross-penetration','7.11.7 / 7.11.8',span,[val('Individual length',50),val('Cumulative length',cap(50,.16))]);
  add('concavity','Internal concavity','7.11.5','If RT image is no darker than adjacent base metal, no length restriction under this clause; otherwise the following limits apply. '+span,[val('Individual length',50),val('Cumulative length',cap(50,.16))]);
  add('undercut','Undercut','7.11.6','Depth strictly below this threshold is unrestricted in length only with qualifying depth assessment (RT requires comparator shims). Otherwise apply the length limits. Welder-test outside undercut also has a 1 mm depth maximum.',[val('Depth threshold (strictly less)',Math.min(.5,.06*t)),val('Individual length',50),val('Cumulative length',cap(50,.16))]);
  add('slag','Elongated slag','7.11.9','Width <1.5 mm. Parallel lines are separate when either width >0.8 mm. '+(nps<2?'Small-pipe cumulative limit applies to the whole weld.':span),[val('Individual length',nps<2?3*t:50),val('Cumulative length',nps<2?3*t:cap(50,.16))]);
  add('hollow','Hollow bead','7.11.10','Width ≤1.5 mm; wider indications use wormhole criteria. '+span,[val('Individual length',12),val('Cumulative length',cap(25,.08))]);
  add('burn','Burn-through','7.11.11','Measure when any portion is darker than the thinnest adjacent parent metal. '+(nps<2?'At most one indication in the weld.':'Cumulative dimensions ≤12 mm in any 300 mm; also apply combined-defect limits.'),[val('Individual dimension',Math.min(6,t)),...(nps<2?[]:[val('Cumulative dimensions',12)])]);
  add('isolated','Isolated slag','7.11.12','Width ≥1.5 mm. '+(nps<2?'Small-pipe cumulative limit applies to the whole weld.':'At most four maximum-sized indications per 300 mm; adjacent indications require ≥50 mm sound weld.'),[val('Individual dimension',Math.min(2.5,.33*t)),val('Cumulative dimensions',nps<2?2*t:10)]);
  add('porosity','Spherical porosity','7.11.13 / Table 7.9','Distribution is evaluated by projected image area; see Figure 7.22.',[val('Individual dimension',Math.min(3,.25*t)),val('Projected area maximum',t<14?3:t<=18?4:5,'%')]);
  add('worm','Wormhole porosity','7.11.14','Within any 300 mm: ≤4 maximum-sized indications, ≥50 mm sound separation. Orientation and image density also matter.',[val('Individual dimension',Math.min(2.5,.33*t)),val('Cumulative length',10)]);
  add('aggregate','Combined imperfections','7.11.17.1',span+' Apply in addition to individual-defect limits.'+(sour?' Root IP and root IF remain prohibited; no cumulative allowance overrides that restriction.':''),[val(sour?'Top IF + hollow bead + burn-through':'IP / IF + hollow bead + burn-through',cap(25,.08)),val('Other restricted imperfections',cap(50,.16))]);
  add('reinforcement','Outside crown height','7.11.2 / Table 7.8','No underfill. Company-authorized localized allowance is not assumed.',[val('Maximum height',t<=10?2.5:3.5)],'Visual');
  iqiNote='Enter weld thickness for IQI selection. No ASME table or automatic small-pipe wire relaxation is substituted.';
  if(input.iqiThickness!=null&&String(input.iqiThickness).trim()!==''){
   if(!positive(input.iqiThickness))throw Error('Enter positive IQI weld thickness.');
   const it=mm(input.iqiThickness);
   if(it<t||it>t+(t<=10?2.5:3.5))throw Error('IQI weld thickness must be between nominal wall and nominal wall plus the standard maximum crown height.');
   if(!['gamma','xray'].includes(input.radiation))throw Error('Choose the IQI radiation type.');
   iqi=csaIqi(it,input.radiation);
   iqiNote=iqi?'ISO essential wire; use a qualifying equivalent ASTM wire where applicable. Small-pipe gamma allowance is not assumed. Follow 7.14.4 placement requirements.':'IQI weld thickness exceeds the verified CSA table range (44 mm).';
  }
 }else{
  const ix=d.id==='ix',spot=d.id==='viii-spot',boiler=d.id==='i';
  const ref=ix?'QW-191.1.2.2':boiler?'PW-51.3':spot?'UW-52(c)':'UW-51(b)';
  none('crack','Cracks / incomplete fusion / penetration',ref);
  if(spot){
   add('linear','Slag inclusions / cavities',ref+'(2)','Indications less than 6 mm are acceptable under this individual-length rule; those greater than 19 mm are unacceptable. Between these, use 2t/3 (including exactly 6 mm).',[val('2t/3',2*t/3)]);
   add('aligned','Aligned indications',ref+'(2)','Each indication must satisfy its individual limit and separation ≥3L, where L is its length. Aggregate limit scales down for radiographs shorter than 6t.',[val('Aggregate maximum',length===null?null:Math.min(t,length/6)),val('Full evaluation span',6*t)]);
   add('rounded','Rounded indications',ref+'(3)','Not a factor for welds that are not required to be fully radiographed.');
  }else{
   add('linear','Other elongated indications',ref,ix?'Linear means length >3 × width.':'Other elongated indications, excluding cracks and incomplete fusion / penetration.',[val('Individual length',ix?(t<=10?3:t<=57?t/3:19):(t<=19?6:t<=57?t/3:19))]);
   add('aligned','Aligned indications',ref,'Aggregate rule has an exception when successive spacing exceeds 6L, with L the longest indication in the group.',[val('Aggregate maximum',t),val('Evaluation span',12*t)]);
   if(ix){
    add('rounded','Rounded indications',ref+'(b)','Length ≤3 × width. Distribution still requires the qualification chart. For t <3 mm: at most 12 per 150 mm, proportionately fewer for shorter welds.',[val('Maximum dimension',Math.min(.2*t,3)),val('Relevant only when larger than',t<3?t/10:t<=6?.4:t<=50?.8:1.5)]);
   }else if(boiler){
    appendix4('PW-51.3.4',1,true);
   }else{
    appendix4(ref+'(4)');
   }
  }
  if(d.category){
   const category=input.category||'bc';if(!['bc','other'].includes(category))throw Error('Choose the weld category.');
   const band=t<2.4?0:t<=4.8?1:t<=13?2:t<=25?3:t<=51?4:t<=76?5:t<=102?6:t<=127?7:8;
   add('reinforcement','Maximum reinforcement','Table UW-35-1','Select the correct joint category. Smooth transition and all UW-35 surface conditions also apply.',[val('Height',(category==='bc'?[2.5,3,4,5,6,6,6,6,8]:[.8,1.5,2.5,2.5,3,4,5.5,6,8])[band])],'Visual');
  }else if(boiler){
   if(!['pipe','other'].includes(input.boilerJoint))throw Error('Choose the PW-35 joint type.');
   const n=t<=3?0:t<=5?1:t<=13?2:t<=25?3:t<=50?4:t<=75?5:t<=100?6:t<=125?7:8;
   let height=input.boilerJoint==='pipe'?[2.5,3,4,5,6,null,null,null,null][n]:[2.5,2.5,2.5,2.5,3,4,5.5,6,8][n];
   if(height===null){if(!positive(input.weldWidth))throw Error('Enter weld width for PW-35 reinforcement.');height=Math.max(6,mm(input.weldWidth)/8);}
   add('reinforcement','Maximum reinforcement','PW-35.1','Limit applies separately to each face. '+(input.boilerJoint==='pipe'?'Circumferential pipe/tubing joint.':'Other weld; includes pipe or tube used as a shell.'),[val('Height',height)],'Visual');
   add('undercut','Undercut / surface finish','PW-35.1','Preserve required section thickness; avoid abrupt surface irregularities and retain an interpretable examination surface.',[val('Depth maximum',Math.min(.8,.1*t))],'Visual');
  }
 }
 if(!d.id.startsWith('csa-')){
  if(input.reinforcement!==null&&input.reinforcement!==undefined&&String(input.reinforcement).trim()!==''){
   const r=Number(input.reinforcement);if(!finite(r)||r<0)throw Error('IQI reinforcement must be zero or positive.');
   const maximum=cards.find(c=>c.key==='reinforcement');
   if(!(d.id==='b311'&&input.weldSides==='single')&&maximum&&maximum.values.length&&mm(r)>2*maximum.values[0].value)throw Error('Total IQI reinforcement exceeds the combined face and root limits for this selection.');
   iqi=asmeIqi(Number((t+mm(r)).toPrecision(12)));
   iqiNote=iqi?'ASTM essential wires, film RT. Basis = nominal single wall + representative total ID and OD reinforcement (within permitted heights). Excludes backing. Film-side placement requires T-277 conditions and F marker.':'IQI thickness exceeds the supported Table T-276 range (508 mm).';
  }else iqiNote='Enter representative total ID + OD reinforcement, or 0 for a flush weld, to show essential wires. No maximum reinforcement is assumed.';
 }
 // Fixed external references; Android opens only these exact URLs in the browser.
 const chartSources={
  appendix:{url:'https://www.sulzer.com/en/-/media/files/q_documents_pe/tp/tp-0008.pdf#page=25',label:'Appendix 4 — Figures 4-1 through 4-8',source:'Sulzer TP-0008 Rev. 10; appendix basis 2023. PDF pages 25–28.'},
  boiler:{url:'https://www.ipgmservicios.com/wp-content/uploads/2024/03/ASME-SEC-I-2019.pdf#page=334',label:'A-250 — alignment and distribution charts',source:'Section I, 2019 reproduction. Figures A-250.3.4-1/2 and A-250.3.6 charts; PDF pages 334–338.'},
  csa:{url:'https://download.bibis.ir/Books/Construction/Pipeline/2024/CSA%20Z662-23%20(March%202024)%20Oil%20and%20gas%20pipeline%20systems_bibis.ir.pdf#page=259',label:'Figure 7.22 — spherical porosity',source:'CSA Z662:23, March 2024 reproduction. PDF page 259 (printed page 253).'},
  ix:{url:'https://studylib.net/doc/28042843/asme-sec-ix-2025',label:'Figure QW-191.1.2.2(b)(4) — rounded indications',source:'Section IX, 2025 reproduction. Printed page 23; search the figure number.'}
 };
 for(const c of cards){
  if(['rounded-aligned','rounded-clusters','rounded-distribution'].includes(c.key))c.charts=[chartSources[['i','b311'].includes(d.id)?'boiler':'appendix']];
  if(c.key==='porosity'&&d.id.startsWith('csa-'))c.charts=[chartSources.csa];
  if(c.key==='rounded'&&d.id==='ix'&&t>=3)c.charts=[chartSources.ix];
 }
 return {id:d.id,name:d.name,edition:d.edition,scope:d.scope,source:sources[d.source]+(['i','b311'].includes(d.id)?'; A-250 numerical reference: Section I (2019), A-250.2–3; later appendix revisions not verified.':'')+(d.id==='viii-full'||d.id.startsWith('b313')?'; rounded-indication reference: VIII-1 Appendix 4 (2023), reproduced in Sulzer TQ TP-0008 Rev. 10, pp. 21–28. Later appendix revisions not verified.':''),thickness:t,cards,iqi,iqiNote,iqiSource:iqi?(d.id.startsWith('csa-')?'CSA Z662:23 (March 2024 revision), Table '+(input.radiation==='gamma'?'7.11':'7.10'):d.id==='b311'?'ASME V-2010 with 2011a addenda, T-276.2 / Table T-276; confirm governing procedure edition':sources.iqi):null,coverage,notes:[]};
}
// Figure viewports display the supplied screenshots without modifying their pixels.
function offlineAppendixChart(id,t){
 if(!['viii-full','b313-normal','b313-severe'].includes(id)||!Number.isFinite(t)||t<3)return null;
 const n=t<=6?0:t<=10?1:t<=19?2:t<=50?3:t<=100?4:5;
 const figures=[
  ['0','94 428 432 237','3–6 mm inclusive'],
  ['appendix-44-clear','26 525 552 337','over 6–10 mm inclusive'],
  ['1','94 400 432 290','over 10–19 mm inclusive'],
  ['appendix-46-clear','11 254 575 392','over 19–50 mm inclusive'],
  ['2','94 432 432 344','over 50–100 mm inclusive'],
  ['3','94 403 432 397','over 100 mm']
 ];
 return {figure:'4-'+(n+3),image:figures[n][0],viewBox:figures[n][1],range:figures[n][2],obscured:false};
}
function offlineQualificationChart(t){
 if(!Number.isFinite(t)||t<3)return null;
 const band=t<=6?0:t<=13?1:t<=25?2:3;
 return {figure:'QW-191.1.2.2(b)(4)',image:'ix',band,
  viewBox:['36 310 540 104','36 453 540 109','36 600 540 128','36 767 540 130'][band],
  range:['3–6 mm inclusive','over 6–13 mm inclusive','over 13–25 mm inclusive','over 25 mm'][band],
  source:'Supplied screenshot of ASME BPVC.IX-2025, printed page 23.',
  description:'Rounded indication distribution for a 150 mm weld length',obscured:false};
}
function offlineBoilerCharts(key,t){
 if(!Number.isFinite(t)||t<=0)return [];
 const source='Supplied screenshot of ASME BPVC.I-2019, A-250 reference.';
 if(key==='rounded-aligned')return [
  {figure:'A-250.3.4-1',image:'boiler-aligned',viewBox:'90 202 885 200',transform:'translate(1280 0) rotate(90)',range:'all thicknesses',description:'Aligned rounded indications and summed dimensions',source},
  {figure:'A-250.3.4-2',image:'boiler-groups',viewBox:'115 91 874 264',transform:'translate(1280 0) rotate(90)',range:'all thicknesses',description:'Aligned group lengths and minimum spacing',source}
 ];
 if(!['rounded-clusters','rounded-distribution'].includes(key)||t<3)return [];
 const n=t<=6?0:t<=10?1:t<=19?2:t<=50?3:t<=100?4:5;
 const rows=[['boiler-12','12 219 573 316','3–6 mm inclusive'],['boiler-12','12 684 573 307','over 6–10 mm inclusive'],['boiler-34','0 213 574 348','over 10–19 mm inclusive'],['boiler-34','0 626 574 360','over 19–50 mm inclusive'],['boiler-5','2 340 573 465','over 50–100 mm inclusive'],['boiler-6','2 257 574 489','over 100 mm']];
 return [{figure:'A-250.3.6-'+(n+1),image:rows[n][0],viewBox:rows[n][1],range:rows[n][2],source}];
}
function offlineCsaChart(t){
 if(!Number.isFinite(t)||t<=0)return null;
 const n=t<14?0:t<=18?1:2;
 return {figure:'7.22 '+['a','b','c'][n]+')',image:'csa',percent:n+3,
  viewBox:['32 472 533 143','32 638 533 163','32 824 533 163'][n],
  range:['less than 14 mm','14–18 mm inclusive','greater than 18 mm'][n],
  description:'Spherical porosity — '+(n+3)+'% projected area',
  source:'Supplied screenshot of CSA Z662:23, Table 7.9 / Figure 7.22. '+(n+3)+'% maximum projected area.'};
}
return {definitions,sources,calculate,evaluateCell,asmeIqi,csaIqi,offlineAppendixChart,offlineQualificationChart,offlineBoilerCharts,offlineCsaChart};
});
