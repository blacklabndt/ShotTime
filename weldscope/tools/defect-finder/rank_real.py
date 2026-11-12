"""Ranked candidates inside the weld band on real plates: the technician's accepted plates (every film's band sure)
and the owner's cropped pieces. Counts per plate at the cut-offs that gave 2 / 5 / 10 / 20 false alarms per SWRD film."""
import os,sys,glob,pickle,numpy as np,cv2,torch
os.environ.setdefault('NORM_K','8'); os.environ.setdefault('FINDER','swrd_r4_keep.pt'); os.environ.setdefault('NAMER','stage2b_k.pt')
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, e2e as E, band as B, rank as R
from band_test import inside
SP=S.SP; CUTS=(0.523,0.310,0.180,0.096)
def run(img,f,n):
    im,res,_=B.find(img); c=R.candidates(f,n,im); return im,res,[(e,inside(res,(e[0]+e[2])/2,(e[1]+e[3])/2)) for e in c]
if __name__=='__main__':
    torch.set_num_threads(4); f,n=E.models(); out={'tech':[],'owner':[]}
    for p in sorted(glob.glob(SP+'/crpieces/*.npy')):
        a=np.load(p).astype(np.float32); lo,hi=np.percentile(a,[0.5,99.5]); img=(255-np.clip((a-lo)/(hi-lo+1e-6),0,1)*255).astype(np.uint8)
        im,res,c=run(img,f,n); out['owner'].append((os.path.basename(p),res,c))
        print(os.path.basename(p),'band sure' if all(r['band']['sure'] for r in res) else 'band unsure','| in band at each cut-off:',[sum(1 for e,k in c if k!='out' and e[4]*e[5]>t) for t in CUTS],'| whole piece:',[sum(1 for e,k in c if e[4]*e[5]>t) for t in CUTS],flush=True)
    T=[r for r in pickle.load(open(SP+'/tech/band_test.pkl','rb')) if r['sure']==r['films']]
    for i,r in enumerate(T):
        im,res,c=run(cv2.imread(SP+'/tech/dcm/'+r['png'],0),f,n); out['tech'].append((r['png'],res,c))
    pickle.dump(out,open(SP+'/tech/rank_real.pkl','wb'))
    print(len(T),'accepted technician plates, every band sure')
    for t,fa in zip(CUTS,(2,5,10,20)):
        b=np.array([sum(1 for e,k in c if k=='band' and e[4]*e[5]>t) for _,_,c in out['tech']]); w=np.array([sum(1 for e,k in c if e[4]*e[5]>t) for _,_,c in out['tech']])
        print('  cut-off %.3f (SWRD %2d false alarms/film): in band mean %.1f, median %.0f, none on %2.0f%%, most %d | whole plate mean %.1f'%(t,fa,b.mean(),np.median(b),100*np.mean(b==0),b.max(),w.mean()))
