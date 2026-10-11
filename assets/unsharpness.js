(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Unsharpness=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const profiles=[
 {id:'b313',name:'ASME B31.3 · 2024',ref:'344.5.1 → Section V, Article 2',note:'Weld radiography follows Article 2. T-274.2 supplies a recommended maximum; image quality and the approved procedure remain applicable.'},
 {id:'b311',name:'ASME B31.1 · 2012',ref:'136.4.5',note:'T-274 is guidance. The stated Ug rejection threshold is 0.07 in. / 2.0 mm. The published inch and metric values are independently rounded.'},
 {id:'i',name:'ASME Section I · 2025',ref:'PW-51.1',note:'T-274 is guidance. The stated Ug rejection threshold is 0.07 in. / 1.8 mm.'},
 {id:'viii',name:'ASME VIII-1 · 2025',ref:'UW-51(a)(3)',note:'The film-specific exception treats T-274.2 as guidance only. For CR, show the Article 2 recommendation without extending that film exception.'},
 {id:'ix',name:'ASME Section IX · 2025',ref:'QW-191.1.1(a),(b)',note:'Qualification radiography follows Article 2 with exceptions. Final image acceptance is based on the required IQI image; Ug alone does not establish acceptance.'},
 {id:'csa-sweet',name:'CSA Z662 · Sweet · 2023 / March 2024',ref:'7.14.2.1–7.14.2.2',note:'Place imaging media close to the weld. Source-to-image distance must be at least 7 × the distance to the farthest weld surface; 10 × is preferred. This clause does not specify a numerical Ug maximum.'},
 {id:'csa-sour',name:'CSA Z662 · Sour · 2023 / March 2024',ref:'7.14.2.1–7.14.2.2; Clause 16',note:'The same Chapter 7 geometry check applies. Sour-service acceptance provisions remain separate from this geometry calculation.'}
];
function number(value,label){if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<=0)throw Error('Enter a positive decimal number for '+label+'.');return Number(value);}
// Remove only floating-point conversion noise, not meaningful measurement precision.
const stable=n=>Number(n.toPrecision(12));
const atMost=(a,b)=>a<=b||Math.abs(a-b)<=Math.max(Math.abs(a),Math.abs(b))*1e-12;
function calculate(input){
 const profile=profiles.find(p=>p.id===input.code);if(!profile)throw Error('Choose a code.');
 if(!['mm','in'].includes(input.unit)||!['mm','in'].includes(input.basis))throw Error('Choose measurement units and a code table basis.');
 if(!['film','cr'].includes(input.medium))throw Error('Choose film or CR.');
 const scale=input.unit==='in'?25.4:1;
 const F=stable(number(input.source,'source size')*scale),D=stable(number(input.distance,'source-to-object distance')*scale),d=stable(number(input.gap,'source-side surface to image distance')*scale);
 const ug=F*d/D,sfd=D+d,csa=input.code.startsWith('csa-');
 let limit=null,kind='recommendation',minimumD,preferredD=null,within,preferred=null;
 if(csa){kind='geometry';minimumD=6*d;preferredD=9*d;within=atMost(7*d,sfd);preferred=atMost(10*d,sfd);}
 else{
  if(input.code==='b311'||input.code==='i'){limit=input.basis==='in'?.07*25.4:input.code==='b311'?2:1.8;kind='threshold';}
  else{
   const t=stable(number(input.thickness,'IQI basis thickness')*scale/(input.basis==='in'?25.4:1));
   const bounds=input.basis==='in'?[2,3,4]:[50,75,100];
   const index=t<bounds[0]?0:t<=bounds[1]?1:t<=bounds[2]?2:3;
   limit=input.basis==='in'?[.02,.03,.04,.07][index]*25.4:[.51,.76,1.02,1.78][index];
   if(input.code==='ix'||input.code==='viii'&&input.medium==='film')kind='guide';
  }
  minimumD=F*d/limit;within=atMost(ug,limit);
 }
 if(![F,D,d,ug,sfd,minimumD,...(preferredD===null?[]:[preferredD])].every(n=>Number.isFinite(n)&&n>0))throw Error('Dimensions are outside the calculation range.');
 return {ug,sfd,limit,kind,minimumD,minimumSfd:minimumD+d,preferredD,preferredSfd:preferredD===null?null:preferredD+d,within,preferred,ratio:sfd/d};
}
return {profiles,calculate};
});
