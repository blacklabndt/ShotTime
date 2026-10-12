const assert=require('node:assert/strict'),S=require('../assets/notes-storage.js'),M=require('../assets/notes-model.js');
let l=M.createList({id:'csv',date:'2026-10-03',lsd:'test',start:1});l=M.apply(l,{id:'xf',type:'addBatch',cn:'CN-332A',count:1,welder:'DD',size:'2',schedule:'80'});l=M.apply(l,{id:'mt',type:'addMt',cn:'CN-332B',count:1,welder:'ZZ',size:'1 1/2',schedule:'3M',fittingType:'TOL'});
const order={xf:['number','cn','size','schedule','welder'],mt:['size','cn','number','welder','schedule']};const before=JSON.stringify(l);
const csv=S.toCSV(l.rows,l.mtRows,l.mtFormat,order);assert.equal(csv,'\ufeff"XF#s","CN#s","Weld Size","Weld Schedule","WID","","Size","CN#","MT#","WID","Schedule/Description"\r\n"XF-1","CN-332A","2","80","DD","","1 1/2","CN-332B","MT-1","ZZ","3M TOL"\r\n');assert.equal(JSON.stringify(l),before);
assert.ok(S.toCSV(l.rows).includes('"DD","2","80"'));assert.ok(!S.toCSV(l.rows).includes('MT#'));
for(const invalid of [null,{}, {xf:['cn','cn'],mt:[]},{xf:['cn','number','welder','size','evil'],mt:[]}])assert.equal(S.toCSV(l.rows,l.mtRows,l.mtFormat,invalid),S.toCSV(l.rows,l.mtRows,l.mtFormat));
assert.ok(S.toCSV([],[{...l.mtRows[0],size:''}],l.mtFormat,order).includes('"","CN-332B","MT-1","ZZ","3M TOL"'));
console.log('PASS: custom XF/MT columns, plain sizes and fractions, empty fields, invalid preferences and unchanged records');

const spaced={xf:['spacer','cn','number','spacer','welder','size','schedule','spacer'],mt:['cn','spacer','number','welder','size','schedule','spacer']};
assert.deepEqual(S.exportOrder(spaced),spaced);
const lines=S.toCSV(l.rows,l.mtRows,l.mtFormat,spaced).slice(1).trimEnd().split('\r\n').map(line=>JSON.parse('['+line+']'));
assert.deepEqual(lines[0],['','CN#s','XF#s','','WID','Weld Size','Weld Schedule','','','CN#','','MT#','WID','Size','Schedule/Description','']);
assert.deepEqual(lines[1],['','CN-332A','XF-1','','DD','2','80','','','CN-332B','','MT-1','ZZ','1 1/2','3M TOL','']);
assert.deepEqual(S.exportOrder({xf:[...spaced.xf,...Array(30).fill('spacer')]}).xf,S.exportOrder().xf);
assert.equal(S.toCSV(l.rows,[],l.mtFormat,spaced).slice(1).split('\r\n')[0].split(',').length,8);
assert.equal(JSON.stringify(l),before);
console.log('PASS: repeated, leading and trailing blank CSV spacers, table alignment and bounded preferences');
