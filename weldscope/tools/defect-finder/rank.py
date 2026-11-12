"""Sensitivity retune: instead of one cut-off, list every candidate the finder sees (down to a low level), score it,
and ask how many real indications are among the top K per film. The reader makes the call; the score only orders."""
import os,sys,pickle,collections,numpy as np,cv2,torch
os.environ.setdefault('NORM_K','8'); os.environ.setdefault('FINDER','swrd_r4_keep.pt'); os.environ.setdefault('NAMER','stage2b_k.pt')
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T, e2e as E
SP=S.SP
def candidates(f,n,img,floor=0.1):
    """[(x0,y0,x1,y1,finder peak,namer defect prob,namer class)]: one per local peak of the finder map above floor."""
    p=S.predict(f,img); d=1-p[0]; mx=cv2.dilate(d,np.ones((5,5),np.uint8)); ys,xs=np.nonzero((d>=mx-1e-6)&(d>floor)); out=[]
    for y,x in zip(ys,xs):
        v=d[y,x]; y0,y1,x0,x1=max(0,y-8),min(d.shape[0],y+9),max(0,x-8),min(d.shape[1],x+9)
        k,cc=cv2.connectedComponents((d[y0:y1,x0:x1]>0.5*v).astype(np.uint8),connectivity=8); m=cc==cc[y-y0,x-x0]
        yy,xx=np.nonzero(m); out.append([(x0+xx.min())*8,(y0+yy.min())*8,(x0+xx.max()+1)*8,(y0+yy.max()+1)*8,float(v)])
    if not out: return []
    X=np.stack([T.crop(img,(b[0],b[1]),(b[2],b[3]),False) for b in out])
    with torch.no_grad(): q=torch.cat([torch.softmax(n(torch.from_numpy(X[i:i+256])[:,None]),1) for i in range(0,len(X),256)]).numpy()
    return [(*b,float(1-pr[0]),int(pr[1:].argmax())+1) for b,pr in zip(out,q)]
SCORES={'finder':lambda c:c[4],'namer':lambda c:c[5],'product':lambda c:c[4]*c[5],'mean':lambda c:(c[4]+c[5])/2}
if __name__=='__main__':
    torch.set_num_threads(4); f,n=E.models(); te=S.load(only=E.is_te); print(len(te),'held-out films',flush=True); C=[]
    for i,d in enumerate(te):
        C.append(candidates(f,n,d['img']))
        if i%100==0: print(i,flush=True)
    pickle.dump(C,open(SP+'/swrd/rank_cands.pkl','wb'))
    hit=lambda e,a,b: e[0]<=b[0]+8 and e[2]>=a[0]-8 and e[1]<=b[1]+8 and e[3]>=a[1]-8
    print('candidates per film: mean %.1f, median %.0f'%(np.mean([len(c) for c in C]),np.median([len(c) for c in C])))
    Ks=(1,2,3,5,8,12,20,999)
    for name,sc in SCORES.items():
        tot=collections.Counter(); found={K:collections.Counter() for K in Ks}; shown={K:0 for K in Ks}; fa={K:0 for K in Ks}
        for d,c in zip(te,C):
            c=sorted(c,key=sc,reverse=True); real=[(k,a,b) for k,a,b in d['objs'] if k>0]
            for k,a,b in real: tot[k]+=1
            for K in Ks:
                top=c[:K]; shown[K]+=len(top); fa[K]+=sum(1 for e in top if not any(hit(e,a,b) for k,a,b in real))
                for k,a,b in real: found[K][k]+= any(hit(e,a,b) for e in top)
        print('ranked by',name)
        for K in Ks:
            print('  top %3s: shown %.1f/film, not on a marked indication %.1f/film, found %3.0f%% |'%('all' if K>100 else K,shown[K]/len(te),fa[K]/len(te),100*sum(found[K].values())/sum(tot.values())),' '.join('%s %.0f'%(S.NAMES[k][:4],100*found[K][k]/max(1,tot[k])) for k in range(1,7)),flush=True)
