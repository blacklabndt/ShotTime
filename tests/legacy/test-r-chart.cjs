const assert=require('node:assert/strict'),C=require('../assets/calculator.js'),data=require('../assets/techniques.json');
// Independently transcribed columns 2, 2.5, 3, 4 from the supplied upper table.
const reference={d4:[1.8,2.4,3,4.3],mx125:[3,3.7,4.4,5.7],ix50:[3.1,3.8,4.6,6.3],d5:[1.2,1.6,2,2.9],t200:[1.5,1.9,2.3,3.1],ix80:[1.4,1.9,2.4,3.5]};
let count=0;
for(const t of data.techniques)for(const f of data.groups[t.group].films)for(const [i,d] of [2,2.5,3,3.5].entries()){
 const r=i===3?(reference[f][2]+reference[f][3])/2:reference[f][i];assert.ok(Math.abs(C.R_FACTORS[f][i]-r)<1e-12);
 const distance=t.sfd*2.54/100,totalSteel=2*t.wall*25.4;
 const ratePerCi=.48/(distance*distance)*Math.exp(-Math.LN2*totalSteel/13);
 const expected=r/ratePerCi*3600,actual=C.densityExposure(t,f,d);assert.ok(Math.abs(actual/expected-1)<1e-12);count++;
}
const t=data.techniques.find(t=>t.size===10&&t.schedule==='40 / STD');assert.ok(Math.abs(C.seconds(C.densityExposure(t,'d5',3),26)-118.30559224968601)<1e-9);assert.equal(C.timeLabel(C.seconds(C.densityExposure(t,'d5',3),26)),'1m 58s');assert.equal(C.timeLabel(.1),'0s');
console.log('PASS:',count,'chart/film/density combinations, interpolated values, independently expressed attenuation equation, 10-inch D5 regression and unchanged zero rounding.');
