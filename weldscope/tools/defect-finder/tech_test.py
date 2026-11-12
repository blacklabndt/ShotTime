"""Over-calling test on the technician's accepted welds (jobs the model has never seen): how many regions does
the round 4 pair flag per plate, on stored pixels and with an EDGE-style filter applied first?
The EDGE-style version is rescaled so its typical fine detail is as strong as the unfiltered plate's; otherwise
its 2.4-6x detail gain alone would raise the count and the comparison would say nothing."""
import os,sys,json,pickle,random,collections,numpy as np,cv2,torch
os.environ.setdefault('NORM_K','8'); os.environ.setdefault('FINDER','swrd_r4_keep.pt'); os.environ.setdefault('NAMER','stage2b_k.pt')
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, e2e as E
from finetune import weld_band
SP=S.SP
def edge_style(img,px_mm=0.1):
    a=img.astype(np.float32); mean=float(a.mean()); L=cv2.GaussianBlur(a,(0,0),10.0/px_mm); M=cv2.GaussianBlur(a,(0,0),1.5/px_mm)
    lo,hi=np.percentile(a,[0.5,99.8]); t=1.1*(hi-lo)*2.4
    d=2.4*(M-L)+6.0*(a-M); d=d/(1+np.abs(d)/t); out=mean+1.2*(L-mean)+d
    ref=np.median(np.abs(a-cv2.GaussianBlur(a,(0,0),20))); got=np.median(np.abs(out-cv2.GaussianBlur(out,(0,0),20)))
    return np.clip(mean+(out-mean)*(ref/max(got,1e-3)),0,255).astype(np.uint8)
if __name__=='__main__':
    n_want=int(sys.argv[1]) if len(sys.argv)>1 else 150; torch.set_num_threads(4); random.seed(4)
    T=pickle.load(open(SP+'/tech/table.pkl','rb')); meta={}
    for l in open(SP+'/tech/dcm_meta.jsonl'):
        r=json.loads(l)
        if 'png' in r: meta[r['path']]=r
    acc=[(r,f) for r in T if r['acc'] and not r['rej'] and not r['finds'] and not r['remarks'] for f in r['files'] if f in meta]
    rej=[(r,f) for r in T if (r['rej'] or r['finds'] or r['remarks']) for f in r['files'] if f in meta]
    print('accepted plates with no findings or remarks:',len(acc),'from',len(set(r['job'] for r,f in acc)),'jobs; plates of welds with a finding/remark/reject:',len(rej),flush=True)
    random.shuffle(acc); f_,n_=E.models(); res=[]; perjob=collections.Counter()
    for r,f in acc:
        m=meta[f]
        if perjob[r['job']]>=6: continue
        img=cv2.imread(SP+'/tech/dcm/'+m['png'],0)
        if img is None: continue
        if img.shape[0]>img.shape[1]: img=np.ascontiguousarray(np.rot90(img))
        if img.shape[1]<1.6*img.shape[0] or img.shape[1]<1200: continue      # near-square small-bore shots: weld direction unclear, left for later
        b0,b1=weld_band(img.astype(np.float32)); row=[]
        for name,im in (('stored',img),('edge',edge_style(img))):
            for thr in (0.5,0.8):
                det=E.detect(f_,n_,im,thr,0.5); row+= [len(det),sum(1 for d in det if b0<(d[1]+d[3])/2<b1)]
        res.append((r['job'],r['rt'],m['png'],img.shape[1]/1000.0,*row)); perjob[r['job']]+=1
        if len(res)%25==0: print(len(res),'plates',flush=True)
        if len(res)>=n_want: break
    pickle.dump(res,open(SP+'/tech/test_r4.pkl','wb')); A=np.array([x[3:] for x in res],float)
    print(len(res),'accepted plates from',len(perjob),'jobs; mean plate length %.0f mm'%(A[:,0].mean()*100))
    for j,name in enumerate(['stored pixels, higher sensitivity','stored pixels, lower sensitivity','EDGE-style first, higher sensitivity','EDGE-style first, lower sensitivity']):
        w=A[:,1+2*j]; b=A[:,2+2*j]
        print('  %-38s whole plate: mean %.1f, median %.0f, none on %2.0f%% of plates | weld band: mean %.1f, median %.0f, none on %2.0f%%'%(name,w.mean(),np.median(w),100*np.mean(w==0),b.mean(),np.median(b),100*np.mean(b==0)))
