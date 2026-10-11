from pathlib import Path
import re,json
rows=[]
for page in range(137,143):
 text=Path(f'build/pipe-{page}.txt').read_text(encoding='utf-8')
 for block in re.split(r'\n\s*\n',text):
  found=re.search(r'^(\d+(?: \d/\d)?|\d/\d) (\d+\.\d{3}) (std|Xs|XXs|\d+)(?: |$)',block,re.M)
  if not found:continue
  nps,od=found.group(1),float(found.group(2));walls={}
  for line in block.splitlines():
   line=re.sub(r'^'+re.escape(nps)+r' '+re.escape(found.group(2))+r' ','',line)
   m=re.fullmatch(r'(std|Xs|XXs|\d+)(?: \((\d+)\))? ((?:\d+\.)\d+) (?:[\d.]+ ){4}[\d.]+',line)
   if m:
    sch={'std':'STD','Xs':'XH','XXs':'XXH'}.get(m[1],m[1]);walls[sch]=float(m[3])
    if m[2]:walls[m[2]]=float(m[3])
  assert walls,(page,nps)
  rows.append({'nps':nps,'od':od,'walls':walls})
# Additional carbon-steel entries from Alaskan Copper catalogue p43; blank cells are not filled by inference.
for nps,od,walls in [
 ('1/8',.405,{'STD':.068,'40':.068,'XH':.095,'80':.095}),('1/4',.540,{'STD':.088,'40':.088,'XH':.119,'80':.119}),('3/8',.675,{'STD':.091,'40':.091,'XH':.126,'80':.126}),
 ('22',22,{'10':.250,'20':.375,'30':.500,'STD':.375,'XH':.500,'60':.875,'80':1.125,'100':1.375}),
 ('26',26,{'10':.312,'20':.500,'STD':.375,'XH':.500}),('28',28,{'10':.312,'20':.500,'30':.625,'STD':.375,'XH':.500}),
 ('32',32,{'10':.312,'20':.500,'30':.625,'40':.688,'STD':.375,'XH':.500}),('34',34,{'10':.312,'20':.500,'30':.625,'40':.688,'STD':.375,'XH':.500}),('40',40,{'STD':.375,'XH':.500})]:rows.append({'nps':nps,'od':od,'walls':walls})
def number(s):
 return sum(float(a.split('/')[0])/float(a.split('/')[1]) if '/' in a else float(a) for a in s.split())
rows.sort(key=lambda r:number(r['nps']))
assert len({r['nps'] for r in rows})==len(rows)
Path('assets/pipe-chart.json').write_text(json.dumps({'sources':['Weldbend catalogue pp. 138-143','Alaskan Copper catalogue p. 43'], 'rows':rows},indent=2)+'\n',encoding='utf-8')
print([(r['nps'],len(r['walls'])) for r in rows])
