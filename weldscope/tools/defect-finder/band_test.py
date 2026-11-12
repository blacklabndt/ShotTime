"""How the weld band finder changes what is shown on the technician's accepted plates (round 4 pair, stored pixels)."""
import os,sys,pickle,numpy as np,cv2,torch
os.environ.setdefault('NORM_K','8'); os.environ.setdefault('FINDER','swrd_r4_keep.pt'); os.environ.setdefault('NAMER','stage2b_k.pt')
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, e2e as E, band as B
from finetune import weld_band
SP=S.SP
def inside(res,x,y):
    """'band' inside a sure film's band, 'film' on a film whose band is unsure, else 'out'."""
    for r in res:
        y0,y1,x0,x1=r['rect']; b=r['band']
        if not (y0<=y<y1 and x0<=x<x1): continue
        if not b['sure']: return 'film'
        t=np.interp(x-x0,b['xs'],b['top'])+y0; bo=np.interp(x-x0,b['xs'],b['bot'])+y0
        return 'band' if t<=y<=bo else 'out'
    return 'out'
if __name__=='__main__':
    torch.set_num_threads(4); R=pickle.load(open(SP+'/tech/test_r4.pkl','rb')); f_,n_=E.models(); out=[]
    for i,x in enumerate(R):
        img=cv2.imread(SP+'/tech/dcm/'+x[2],0); im,res,_=B.find(img); b0,b1=weld_band(im.astype(np.float32))
        row={'png':x[2],'films':len(res),'sure':sum(r['band']['sure'] for r in res)}
        for thr in (0.5,0.8):
            det=E.detect(f_,n_,im,thr,0.5); k=[inside(res,(d[0]+d[2])/2,(d[1]+d[3])/2) for d in det]
            row[thr]=dict(all=len(det),old=sum(1 for d in det if b0<(d[1]+d[3])/2<b1),band=k.count('band'),film=k.count('film'),out=k.count('out'),det=det)
        out.append(row)
        if i%25==0: print(i,flush=True)
    pickle.dump(out,open(SP+'/tech/band_test.pkl','wb'))
    allsure=[r for r in out if r['sure']==r['films']]
    print(len(out),'plates;',len(allsure),'with every film sure;',sum(r['films'] for r in out),'films,',sum(r['sure'] for r in out),'sure')
    for thr in (0.5,0.8):
        for name,S_ in (('all plates',out),('plates with every film sure',allsure)):
            a=lambda k: np.mean([r[thr][k] for r in S_])
            print(' thr %.1f %-28s whole %.1f | old band %.1f | new: in band %.1f, on unsure films %.1f, outside %.1f | shown (band+unsure) none on %.0f%%'%(thr,name,a('all'),a('old'),a('band'),a('film'),a('out'),100*np.mean([r[thr]['band']+r[thr]['film']==0 for r in S_])))
