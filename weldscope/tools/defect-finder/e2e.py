"""Finder + type-naming step together, scored on the held-out SWRD films."""
import os,sys,hashlib,collections,numpy as np,cv2,torch
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T
SP=S.SP; is_te=lambda f:int(hashlib.md5(f.encode()).hexdigest(),16)%100<15
def models():
    f=S.Net(); f.load_state_dict(torch.load(SP+'/ml/'+os.environ.get('FINDER','swrd_r3_keep.pt'),weights_only=False)['net']); f.eval()
    n=T.Net2(); n.load_state_dict(torch.load(SP+'/ml/'+os.environ.get('NAMER','stage2.pt'),weights_only=False)['net']); n.eval(); return f,n
def detect(f,n,img,thr=0.5,reject=0.5):
    """[(x0,y0,x1,y1,class,prob_defect)] in pixels: finder regions, each named (or thrown out) by the close-crop step."""
    p=S.predict(f,img); hit=((1-p[0])>thr).astype(np.uint8); k,cc,st,_=cv2.connectedComponentsWithStats(hit,connectivity=8); out=[]
    if k<2: return out
    boxes=[(st[i][0]*8,st[i][1]*8,(st[i][0]+st[i][2])*8,(st[i][1]+st[i][3])*8) for i in range(1,k)]
    X=np.stack([T.crop(img,(b[0],b[1]),(b[2],b[3]),False) for b in boxes])
    with torch.no_grad(): q=torch.softmax(n(torch.from_numpy(X)[:,None]),1).numpy()
    for i,(b,pr) in enumerate(zip(boxes,q)):
        fin=int(np.bincount((p[1:].argmax(0)+1)[cc==i+1]).argmax())
        if pr[0]>reject: continue
        out.append((*b,int(pr[1:].argmax())+1,float(1-pr[0]),fin))
    return out
if __name__=='__main__':
    torch.set_num_threads(4); f,n=models(); te=S.load(only=is_te); print(len(te),'held-out films')
    for thr,rej in ((0.5,0.5),(0.5,0.3),(0.8,0.5),(0.5,1.01)):
        tot=collections.Counter(); found=collections.Counter(); right=collections.Counter(); rightf=collections.Counter(); fa=0
        for d in te:
            det=detect(f,n,d['img'],thr,rej); used=[False]*len(det)
            for c,a,b in d['objs']:
                if c==0:
                    for i,e in enumerate(det):
                        if e[0]<=b[0]+8 and e[2]>=a[0]-8 and e[1]<=b[1]+8 and e[3]>=a[1]-8: used[i]=used[i] or 'artefact'
                    continue
                tot[c]+=1; hit=[i for i,e in enumerate(det) if e[0]<=b[0]+8 and e[2]>=a[0]-8 and e[1]<=b[1]+8 and e[3]>=a[1]-8]
                if hit:
                    found[c]+=1; best=max(hit,key=lambda i:det[i][5]); right[c]+= det[best][4]==c; rightf[c]+= det[best][6]==c
                    for i in hit: used[i]=True
            fa+=sum(1 for u in used if u is False or u=='artefact')
        print('finder threshold',thr,'artefact rejection','off' if rej>1 else rej)
        for c in range(1,7): print('  %-20s %5d  found %3.0f%%  named right %3.0f%% (finder alone %3.0f%%)'%(S.NAMES[c],tot[c],100*found[c]/max(1,tot[c]),100*right[c]/max(1,found[c]),100*rightf[c]/max(1,found[c])))
        print('  all found %.0f%%; false alarms %.1f per film'%(100*sum(found.values())/sum(tot.values()),fa/len(te)),flush=True)
