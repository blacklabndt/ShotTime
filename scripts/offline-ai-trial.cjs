// Desktop feasibility probe only. Never applies commands to a real QC list.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const P=require('../assets/notes-parser.js'),M=require('../assets/notes-model.js');
const out=path.resolve(__dirname,'../build/offline-ai-trial/'+(process.env.TRIAL_OUTPUT||'results-short.json'));
const item=(kind,cn,count,size,schedule,welder,type=null)=>({kind,cn,count,size,schedule,welder,type});
const xf=(cn,count,size,schedule,welder)=>item('XF',cn,count,size,schedule,welder);
const mt=(cn,count,size,schedule,welder,type)=>item('MT',cn,count,size,schedule,welder,type);
const cases=[
 {id:'canonical',text:'CN-47 has 6 4 inch STD welds welded by DD',items:[xf('CN-47',6,'4','STD','DD')]},
 {id:'shorthand',text:'CN-1, 2, 2 inch XS welds DD',items:[xf('CN-1',2,'2','XH','DD')]},
 {id:'natural-order',text:'For spool CN-332A, DD did the welding. There are two welds, both two inch extra heavy.',items:[xf('CN-332A',2,'2','XH','DD')]},
 {id:'mixed-sizes',text:'On CN-13 DD welded three 3 inch XS welds and one 2 inch sched 160 weld.',items:[xf('CN-13',3,'3','XH','DD'),xf('CN-13',1,'2','160','DD')]},
 {id:'mt-correction',text:'CN-69 has two two-inch extra-heavy welds by DD, plus a one-inch thready, 3M. Actually, the thready was welded by AB.',items:[xf('CN-69',2,'2','XH','DD'),mt('CN-69',1,'1','3M','AB','TOL')]},
 {id:'fitting-alias',text:'CN-42 has one 2 inch 6M weld olet welded by RG.',items:[mt('CN-42',1,'2','6M','RG','WOL')]},
 {id:'fraction',text:'CN-8 has two one and a half inch schedule 80 welds, welder DD.',items:[xf('CN-8',2,'1 1/2','80','DD')]},
 {id:'same-spool',text:'Same spool, add one 4 inch STD weld by AB.',context:{cn:'CN-69'},items:[xf('CN-69',1,'4','STD','AB')]},
 {id:'missing-quantity',text:'CN-69 2 inch XS welded by DD',review:true,nullField:'count'},
 {id:'explicit-job-default',text:'CN-69 2 inch XS welded by DD',context:{defaultWeldCount:1},items:[xf('CN-69',1,'2','XH','DD')]},
 {id:'percentage-not-count',text:'CN-69 2 inch XS welded by DD',context:{percentage:10},review:true,nullField:'count'},
 {id:'garbled-cn',text:'CN-XS C9 has two 2 inch XS welds by DD',review:true,nullField:'cn'},
 {id:'ambiguous-welder',text:'CN-2 has one 2 inch STD weld by DD or AB, I cannot remember.',review:true,nullField:'welder'},
 {id:'missing-schedule',text:'CN-8 has two 4 inch welds by DD.',review:true,nullField:'schedule'},
 {id:'background-speech',text:'What time is lunch? Leave the door open.',review:true,items:[]},
 {id:'last-weld-edit',text:'Change the last weld to schedule 80.',context:{lastXfId:'xf-test-9'},items:[],edit:{action:'set',target:'xf-test-9',field:'schedule',value:'80'}},
 {id:'last-mt-delete',text:'Remove the last MT fitting.',context:{lastMtId:'mt-test-3'},items:[],edit:{action:'delete',target:'mt-test-3',field:null,value:null}},
 {id:'missing-edit-target',text:'Change the second weld to schedule 80.',review:true,items:[]},
 {id:'wording-outside-parser',text:'Put down a pair of welds for CN-72B. Four-inch standard wall for both, and the welder is DD.',items:[xf('CN-72B',2,'4','STD','DD')]},
 {id:'uncertain-count',text:'CN-81 has either two or three 2 inch STD welds by DD.',review:true,nullField:'count'}
];
const nullable={type:['string','null']};
const schema={type:'object',additionalProperties:false,required:['needsReview','items','edit','problems'],properties:{needsReview:{type:'boolean'},problems:{type:'array',items:{type:'string'}},items:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','cn','count','size','schedule','welder','type'],properties:{kind:{enum:['XF','MT']},cn:nullable,count:{type:['integer','null'],minimum:1,maximum:1000},size:nullable,schedule:nullable,welder:nullable,type:nullable}}},edit:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['action','target','field','value'],properties:{action:{enum:['set','delete']},target:{type:'string'},field:nullable,value:nullable}}]}}};
const system=`Read the user's text and extract QC records. Return JSON matching the schema.
Ordinary welds: kind XF, type null. Fittings: kind MT, type TOL (thready/threadolet), WOL (weld olet), or SW (socket weld).
Extract the spoken CN, quantity, inch size, schedule and welder. Number words count: two=2, pair=2, a=1. Normalize XS/extra heavy/extra strong to XH, standard wall to STD. Sizes have no unit suffix; fractions use 1 1/2. Keep different groups separate and ordered. Apply explicit corrections to their stated group.
Missing or ambiguous fields are null, not guesses. Preserve all other extracted fields. needsReview=true if any required field is unknown; otherwise false. Schedule and welder are required. context.defaultWeldCount supplies an omitted XF quantity; context.percentage does not. Same spool uses context.cn. Never guess a garbled CN.
Edits need no new weld fields: use action set or delete and the exact context.lastXfId or context.lastMtId as target. No target: edit null and needsReview true. Additions use edit null. Unrelated speech returns no items and needsReview true. Never assign XF or MT sequence numbers. /no_think`;
async function main(){
 let ready=false;for(let attempt=0;attempt<60;attempt++){try{const health=await fetch('http://127.0.0.1:18765/health',{signal:AbortSignal.timeout(2000)});if(health.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Model server is not ready');
 const results=[];
 const evaluationCases=process.env.TRIAL_CASES?JSON.parse(fs.readFileSync(process.env.TRIAL_CASES,'utf8')):cases;
 for(const c of evaluationCases){
  const begin=performance.now();let actual,error;
  try{
   const examples=[
    {role:'user',content:JSON.stringify({context:{},text:'CN-90 has three 6 inch STD welds by ZZ.'})},
    {role:'assistant',content:JSON.stringify({needsReview:false,problems:[],items:[xf('CN-90',3,'6','STD','ZZ')],edit:null})},
    {role:'user',content:JSON.stringify({context:{},text:'CN-91 8 inch STD welds by YY.'})},
    {role:'assistant',content:JSON.stringify({needsReview:true,problems:['Quantity missing'],items:[xf('CN-91',null,'8','STD','YY')],edit:null})},
    {role:'user',content:JSON.stringify({context:{lastXfId:'example-row'},text:'Change the last weld to schedule 40.'})},
    {role:'assistant',content:JSON.stringify({needsReview:false,problems:[],items:[],edit:{action:'set',target:'example-row',field:'schedule',value:'40'}})}
   ];
   const response=await fetch('http://127.0.0.1:18765/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({messages:[{role:'system',content:system},...examples,{role:'user',content:JSON.stringify({context:c.context||{},text:c.text})}],temperature:0,max_tokens:900,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'qc_proposal',strict:true,schema}}})});
   if(!response.ok)throw Error(await response.text());const raw=await response.json();actual=JSON.parse(raw.choices[0].message.content);
   assert.equal(actual.needsReview,!!c.review);
   if(c.items)assert.deepEqual(actual.items,c.items);
   if(c.nullField){assert.ok(actual.items.length>0);for(const i of actual.items)assert.equal(i[c.nullField],null);}
   assert.deepEqual(actual.edit,c.edit||null);
  }catch(e){error=e.message;}
  let baseline;try{const r=P.parse(c.text,c.context||{},[],M.requirements(),[]);baseline={commands:r.commands,review:r.review};}catch(e){baseline={error:e.message};}
  results.push({id:c.id,text:c.text,context:c.context||{},expected:{needsReview:!!c.review,items:c.items,edit:c.edit||null,nullField:c.nullField},actual,error,pass:!error,milliseconds:Math.round(performance.now()-begin),baseline});
  fs.writeFileSync(out,JSON.stringify({model:process.env.TRIAL_MODEL||'unsloth/Qwen3-1.7B-GGUF Q4_K_M',runtime:'llama.cpp b11429 Vulkan',scope:'Synthetic transcript extraction, desktop only; not audio or handset performance',results},null,2));
  console.log(c.id, error?'FAIL':'PASS',results.at(-1).milliseconds+'ms');
 }
 console.log('Passed',results.filter(r=>r.pass).length,'of',results.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
