import json,re,sys
from pathlib import Path
# Regenerate with the supplied workbook path and a Python environment with openpyxl.
# Never execute workbook formulas or load macros.
if len(sys.argv)>1:
 import openpyxl
 raw=openpyxl.load_workbook(sys.argv[1],data_only=False,read_only=True)
 cached=openpyxl.load_workbook(sys.argv[1],data_only=True,read_only=True)
 sheets=[]
 for sheet in raw.worksheets[:9]:
  vals={c.coordinate:c.value for row in cached[sheet.title] for c in row if c.value is not None}
  cells={c.coordinate:{'value':c.value,'cached':vals.get(c.coordinate),'format':c.number_format} for row in sheet for c in row if c.value is not None}
  sheets.append({'sheet':sheet.title,'cells':cells})
else:
 sheets=json.loads(Path('build/code-workbook.json').read_text(encoding='utf-8'))
class Parser:
 def __init__(self,s):
  token=re.compile(r'\s*("[^"]*"|<=|>=|<>|[A-Z]+[0-9]+|[A-Z]+|\d+(?:\.\d+)?|[+*/(),<>=-])\s*')
  self.t=[];self.i=0;pos=1
  while pos<len(s):
   match=token.match(s,pos)
   if not match:raise ValueError('Unsupported formula token: '+s[pos:])
   self.t.append(match.group(1));pos=match.end()
 def pop(self):
  x=self.t[self.i];self.i+=1;return x
 def expr(self,level=0):
  ops=[['<','>','<=','>=','=','<>'],['+','-'],['*','/']]
  if level==3:
   x=self.pop()
   if x=='IF':
    assert self.pop()=='(';a=[self.expr()]
    while self.t[self.i]==',':self.pop();a.append(self.expr())
    assert self.pop()==')';return ['if',*a]
   if x=='FALSE':return ['literal',False]
   if x.startswith('"'):return ['literal',x[1:-1]]
   if re.fullmatch('[A-Z]+[0-9]+',x):return ['ref',x]
   return ['literal',float(x)]
  a=self.expr(level+1)
  while self.i<len(self.t) and self.t[self.i] in ops[level]:
   op=self.pop();a=[op,a,self.expr(level+1)]
  return a
out=[]
for idx,s in enumerate(sheets[:9]):
 cells=s['cells'];values={k:c['value'] for k,c in cells.items() if not k.startswith(('AN','AS3')) and not (isinstance(c['value'],str) and c['value'].startswith("='"))}
 formulas={}
 for k,v in values.items():
  if isinstance(v,str) and v.startswith('=') and v!='=':
   p=Parser(v);formulas[k]=p.expr();assert p.i==len(p.t),(k,v)
 groups=[];group=None;section=values['A7']
 for r in range(9,48):
  title=values.get('A'+str(r));desc=values.get('I'+str(r))
  if title and ('(MT)' in str(title)):section=title;group=None
  if not desc or desc=='Acceptance Limits':continue
  if title:
   group={'title':title,'section':section,'rows':[]};groups.append(group)
  if group:group['rows'].append({'row':r,'text':desc,'cells':[k+str(r) for k in ['AD','AF','AH','AJ','AK','AR','AT','AV'] if k+str(r) in values]})
 notes=[v for k,v in values.items() if k.startswith('A') and isinstance(v,str) and v.startswith('Note ')]
 out.append({'id':str(idx),'sheet':s['sheet'],'name':values['I2'],'edition':next(v for v in values.values() if isinstance(v,str) and 'Edition' in v),'service':values.get('S2') if idx<4 else '', 'nps':idx in [2,3],'values':values,'formulas':formulas,'groups':groups,'notes':notes,'cached':{k:cells[k]['cached'] for k in formulas}})
Path('assets/code-data.json').write_text(json.dumps(out,ensure_ascii=True,indent=2),encoding='utf-8')
print('Extracted',len(out),'code sheets and',sum(len(s['formulas']) for s in out),'formulas')

