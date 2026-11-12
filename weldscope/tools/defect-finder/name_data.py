"""Data for the bigger naming-model test: every region the round 4 finder produces (plus the hand-drawn outlines on
training films), cut at three scales: the close crop the current naming step sees, and two wider ones that take in
the weld cross-section around it. Held-out films give finder regions only, with the current naming step's answer
stored beside them so both models are scored on exactly the same regions."""
import os,sys,random,time,collections,numpy as np,cv2,torch
os.environ.setdefault('NORM_K','8'); os.environ.setdefault('FINDER','swrd_r4_keep.pt'); os.environ.setdefault('NAMER','stage2b_k.pt')
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T, e2e as E
from stage2b import regions,label
SP=S.SP; N=112; SCALES=(1,3,6); CAP=9000
def cut(img,cx,cy,side):
    h=side/2; x0,y0,x1,y1=int(round(cx-h)),int(round(cy-h)),int(round(cx+h)),int(round(cy+h)); H,W=img.shape
    pl,pt,pr,pb=max(0,-x0),max(0,-y0),max(0,x1-W),max(0,y1-H)
    c=img[max(0,y0):min(H,y1),max(0,x0):min(W,x1)]
    if pl or pt or pr or pb: c=cv2.copyMakeBorder(c,min(pt,c.shape[0]-1),min(pb,c.shape[0]-1),min(pl,c.shape[1]-1),min(pr,c.shape[1]-1),cv2.BORDER_REFLECT_101)
    p=cv2.resize(c,(N,N),interpolation=cv2.INTER_AREA if c.shape[0]>N else cv2.INTER_LINEAR).astype(np.float32)
    return np.clip((p-np.median(p))/8*20,-120,120).astype(np.int8)        # grey levels from the crop's median, kept to scale
def crops(img,a,b):
    cx,cy=(a[0]+b[0])/2,(a[1]+b[1])/2; base=max(40,1.7*max(b[0]-a[0],b[1]-a[1]))
    return np.stack([cut(img,cx,cy,base*k) for k in SCALES])
if __name__=='__main__':
    random.seed(0); np.random.seed(0); torch.set_num_threads(4); t0=time.time(); f,n=E.models(); D=S.load(); print(len(D),'films',round(time.time()-t0),'s',flush=True)
    byc=collections.defaultdict(list); te=[]
    for k,d in enumerate(D):
        reg=regions(f,d['img'])
        if E.is_te(d['film']):
            for b in reg: te.append((k,(b[0],b[1]),(b[2],b[3]),label(b,d['objs'])))
        else:
            for b in reg: byc[label(b,d['objs'])].append((k,(b[0],b[1]),(b[2],b[3])))
            for c,a,e in d['objs']: byc[c].append((k,tuple(a),tuple(e)))
        if k%500==499: print('regions for',k+1,'films',round(time.time()-t0),'s',flush=True)
    print('train samples',{T.NAMES[c]:len(v) for c,v in sorted(byc.items())},'test regions',len(te),flush=True)
    tr=[(it,c) for c,v in byc.items() for it in (random.sample(v,CAP) if len(v)>CAP else v)]; random.shuffle(tr)
    Xtr=np.stack([crops(D[k]['img'],a,b) for (k,a,b),c in tr]); ytr=np.array([c for _,c in tr],np.int8); print('train crops',Xtr.shape,round(time.time()-t0),'s',flush=True)
    Xte=np.stack([crops(D[k]['img'],a,b) for k,a,b,c in te]); yte=np.array([c for *_,c in te],np.int8)
    base=[]
    with torch.no_grad():
        for i in range(0,len(te),256):
            X=np.stack([T.crop(D[k]['img'],a,b,False) for k,a,b,c in te[i:i+256]]); base.append(torch.softmax(n(torch.from_numpy(X)[:,None]),1).numpy())
    np.savez(SP+'/swrd/name_data.npz',Xtr=Xtr,ytr=ytr,Xte=Xte,yte=yte,base=np.concatenate(base),film=np.array([k for k,*_ in te]))
    print('saved',Xte.shape,collections.Counter(yte.tolist()),round(time.time()-t0),'s')
