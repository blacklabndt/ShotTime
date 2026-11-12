"""Full-resolution close crops of indications, cut from the original 16-bit SWRD films (which are too big to keep).
For every film that has slag: each outline and each finder region is saved twice at 128x128 — once from the full
resolution film and once from the half-resolution copy — so the naming step can be compared like for like."""
import sys,os,pickle,random,time,numpy as np,cv2,torch
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from rzip import Indexed, save_index, INDEX
import swrd_train as S, stage2b as B, e2e as E
SP=S.SP; OUT=SP+'/swrd/crops'; os.makedirs(OUT,exist_ok=True); N=128
part,parts=int(sys.argv[1]),int(sys.argv[2]); torch.set_num_threads(1)
J=pickle.load(open(SP+'/swrd/jsons.pkl','rb')); f,_=E.models()
def key_of(n): return n.split('crop_weld_images/')[1].rsplit('.',1)[0].replace('/','_')
JJ={k.split('crop_weld_jsons/')[1].rsplit('.',1)[0].replace('/','_'):v for k,v in J.items()}
def cut(img,cx,cy,side):
    h=side/2; M=np.float32([[N/side,0,-(cx-h)*N/side],[0,N/side,-(cy-h)*N/side]])
    return cv2.warpAffine(img,M,(N,N),flags=cv2.INTER_AREA if side>N else cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT_101)
while not os.path.exists(INDEX):
    try: print('index saved,',save_index(),'entries',flush=True)
    except Exception as e: print('archive not readable yet (%s); waiting 20 min'%str(e)[:60],flush=True); time.sleep(1200)
while True:
    try: z=Indexed(); break
    except Exception as e: print('waiting 20 min:',str(e)[:60],flush=True); time.sleep(1200)
names=sorted(n for n in z.names() if n.lower().endswith('.tif') and 'crop_weld_images' in n)
want=[n for n in names if any(s['label']=='夹渣' for s in JJ.get(key_of(n),{}).get('shapes',[]))]
random.Random(5).shuffle(want); streak=0
for k,n in enumerate(want):
    if k%parts!=part: continue
    key=key_of(n); dst=OUT+'/'+key+'.npz'
    if os.path.exists(dst): continue
    try: raw=z.read(n)
    except Exception as e:
        streak+=1; print('read failed',key,str(e)[:80],flush=True)
        if streak>=3: print('download limit: waiting 30 min',flush=True); time.sleep(1800); streak=0
        continue
    streak=0; a=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_UNCHANGED)
    if a is None: continue
    if a.ndim==3: a=a[:,:,0]
    a=a.astype(np.float32); lo,hi=np.percentile(a[::4,::4],[0.3,99.7]); full=np.clip((a-lo)/max(hi-lo,1),0,1)*255
    half=cv2.resize(full,None,fx=0.5,fy=0.5,interpolation=cv2.INTER_AREA); h8=half.astype(np.uint8)
    items=[]   # (class, x0,y0,x1,y1 in half-res px, kind)
    objs=[]
    for s in JJ[key]['shapes']:
        c=S.EN.get(s['label'])
        if c is None and s['label']!=S.FALSE: continue
        p=np.array(s['points'],np.float32)*0.5
        if len(p)<3: continue
        objs.append((c or 0,p.min(0),p.max(0))); items.append((c or 0,*p.min(0),*p.max(0),0))
    for b in B.regions(f,h8): items.append((B.label(b,objs),*b,1))
    if not items: continue
    cf=[];ch=[];meta=[]
    for c,x0,y0,x1,y1,kind in items:
        side=max(40,1.7*max(x1-x0,y1-y0))*1.3; cx,cy=(x0+x1)/2,(y0+y1)/2
        cf.append(cut(full,cx*2,cy*2,side*2)); ch.append(cut(half,cx,cy,side)); meta.append((c,kind,x1-x0,y1-y0))
    np.savez_compressed(dst,full=np.clip(np.stack(cf),0,255).astype(np.uint8),half=np.clip(np.stack(ch),0,255).astype(np.uint8),meta=np.array(meta,np.float32))
print('part',part,'done',flush=True)
