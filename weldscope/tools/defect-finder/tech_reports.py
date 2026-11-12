"""One table from the technician's report workbooks: job, weld (RT #), findings, accept/reject, remarks.
A workbook holds many sheets, some left over from other jobs, so only rows whose RT # matches an image or
DICONDE file in the same job folder are kept. Private data: output stays in the scratchpad."""
import os,sys,json,re,glob,warnings,collections,pickle
import openpyxl
warnings.simplefilter('ignore')
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT=SP+'/tech/files/'
idx=json.load(open(SP+'/tech/index.json'))
def weld_of(name):
    m=re.match(r'^(.*?)(?:[_ ]\d+)?\.(?:jpg|jpeg|dcm|png)$',name,re.I); return m.group(1).strip().upper() if m else None
media=collections.defaultdict(lambda: collections.defaultdict(list))   # job dir -> weld -> files
for i in idx:
    if i['path'].lower().endswith(('.jpg','.jpeg','.dcm')):
        parts=i['path'].split('/'); w=weld_of(parts[-1])
        if w: 
            for d in range(1,len(parts)): media['/'.join(parts[:d])][w].append(i['path'])
# DICONDE files named by a long ID: the weld number is in the header (Series Description), read when they were fetched
_mp=SP+'/tech/dcm_meta.jsonl'
if os.path.exists(_mp):
    for l in open(_mp):
        r=json.loads(l)
        if 'png' not in r or not r.get('series'): continue
        parts=r['path'].split('/'); w=r['series'].strip().upper()
        for d in range(1,len(parts)):
            if r['path'] not in media['/'.join(parts[:d])][w]: media['/'.join(parts[:d])][w].append(r['path'])
def norm(v): return re.sub(r'\s+',' ',str(v)).strip() if v is not None else ''
DEF=['S','P','IP','IF','C','IUC','EUC','UC','IC','EP','HL','TI','HB','BT','LOF','LOP','CP','EC','RC']
def parse(path):
    job=os.path.dirname(os.path.relpath(path,ROOT)); welds=media.get(job,{}); rows=[]
    try: wb=openpyxl.load_workbook(path,data_only=True,read_only=True)
    except Exception as e: return job,rows,'unreadable: '+str(e)[:60]
    for ws in wb.worksheets:
        hdr=None; cols={}
        try: it=ws.iter_rows(min_row=1,max_row=80,max_col=40,values_only=True)
        except Exception: continue
        blank=0
        for r in it:
            cells=[norm(c) for c in r]
            if hdr is None:
                up=[c.upper() for c in cells]
                if any(c in ('RT #','RT#','NDE #','NDE#','WELD #','RT NO.') for c in up):
                    hdr=up
                    for j,c in enumerate(up):
                        k=c.replace('.','').strip()
                        if k in ('RT #','RT#','NDE #','NDE#','WELD #','RT NO'): cols.setdefault('rt',j)
                        elif k in DEF: cols.setdefault(k,j)
                        elif k=='ACC': cols.setdefault('acc',j)
                        elif k=='REJ': cols.setdefault('rej',j)
                        elif k.startswith('REMARK'): cols.setdefault('remarks',j)
                        elif k=='CODE': cols.setdefault('code',j)
                        elif k=='NPS': cols.setdefault('nps',j)
                        elif k=='SCH': cols.setdefault('sch',j)
                continue
            rt=cells[cols['rt']].upper() if 'rt' in cols and cols['rt']<len(cells) else ''
            if not rt:
                blank+=1
                if blank>6: break
                continue
            blank=0
            if rt not in welds: continue
            g=lambda k: cells[cols[k]] if k in cols and cols[k]<len(cells) else ''
            finds={k:g(k) for k in DEF if g(k)}
            if not (g('acc') or g('rej') or finds or g('remarks')): continue
            rows.append(dict(job=job,sheet=ws.title,rt=rt,finds=finds,acc=bool(g('acc')),rej=bool(g('rej')),remarks=g('remarks'),nps=g('nps'),sch=g('sch'),code=g('code'),files=welds[rt]))
    wb.close(); return job,rows,''
if __name__=='__main__':
    files=sorted(glob.glob(ROOT+'**/*.xls[xm]',recursive=True)); allrows=[]; bad=0
    for k,f in enumerate(files):
        job,rows,err=parse(f)
        if err: bad+=1
        allrows+=rows
        if k%50==49: print(k+1,'workbooks,',len(allrows),'weld rows',flush=True)
    # one row per job+weld: prefer a rejected / with-findings row
    best={}
    for r in allrows:
        key=(r['job'],r['rt']); sc=(r['rej'],len(r['finds']),bool(r['remarks']))
        if key not in best or sc>best[key][0]: best[key]=(sc,r)
    T=[v[1] for v in best.values()]; pickle.dump(T,open(SP+'/tech/table.pkl','wb'))
    print(len(files),'workbooks (%d unreadable);'%bad,len(T),'welds matched to image files, in',len(set(r['job'] for r in T)),'jobs')
    print('accepted',sum(r['acc'] and not r['rej'] for r in T),'rejected',sum(r['rej'] for r in T),'neither marked',sum(not r['acc'] and not r['rej'] for r in T))
    c=collections.Counter(k for r in T for k in r['finds']); print('welds with a mark in each findings column',dict(c.most_common()))
    print('with DICONDE files',sum(any(f.lower().endswith('.dcm') for f in r['files']) for r in T),'| rejected with DICONDE',sum(r['rej'] and any(f.lower().endswith('.dcm') for f in r['files']) for r in T))
    rm=collections.Counter(re.sub(r'\d+','#',r['remarks'].upper())[:40] for r in T if r['remarks']); print('commonest remarks',rm.most_common(25))
    vals=collections.Counter(v for r in T for v in r['finds'].values()); print('values used in findings cells',vals.most_common(12))
