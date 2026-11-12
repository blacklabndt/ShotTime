"""Defect finder trained on SWRD (scanned weld films with every defect outlined). The net labels each 8x8-pixel
cell of a weld radiograph as none / porosity / slag / undercut / lack of penetration / lack of fusion / crack.
SWRD's 'false defect' outlines (film artefacts) are trained as 'none'. Test films are held out by film."""
import os,sys,glob,pickle,random,time,re,collections,numpy as np,cv2,torch,torch.nn as nn,torch.nn.functional as F
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES=['none','porosity','slag','undercut','lack_of_penetration','lack_of_fusion','crack']
EN={'气孔':1,'夹渣':2,'咬边':3,'未焊透':4,'未熔合':5,'裂纹':6}
FALSE='伪缺陷'; STRIDE=8; CROP=256
def lnorm(a):
    a=a.astype(np.float32); m=cv2.GaussianBlur(a,(0,0),20); v=cv2.GaussianBlur((a-m)**2,(0,0),20)
    return np.clip((a-m)/(np.sqrt(v)+2.0),-4,4)
class Net(nn.Module):
    def __init__(s,n=len(NAMES),w=(32,64,128,192)):
        super().__init__()
        def blk(i,o,st,d=1): return nn.Sequential(nn.Conv2d(i,o,3,st,d,dilation=d,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.Conv2d(o,o,3,1,d,dilation=d,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True))
        s.f=nn.Sequential(blk(1,w[0],2),blk(w[0],w[1],2),blk(w[1],w[2],2),blk(w[2],w[3],1,2),nn.Dropout2d(0.1)); s.h=nn.Conv2d(w[3],n,1)
    def forward(s,x): return s.h(s.f(x))
def film_id(key): return re.sub(r'^[LT]_\d_[A-Z]_','',key)
def load(limit=None):
    J=pickle.load(open(SP+'/swrd/jsons.pkl','rb')); JJ={k.split('crop_weld_jsons/')[1].rsplit('.',1)[0].replace('/','_'):v for k,v in J.items()}
    D=[]
    for f in sorted(glob.glob(SP+'/swrd/img/*.png'))[:limit]:
        key=os.path.basename(f)[:-4]; j=JJ.get(key)
        if j is None: continue
        img=cv2.imread(f,0)
        if img is None or min(img.shape)<64: continue
        lab=np.zeros(img.shape,np.uint8); objs=[]
        shapes=sorted(j['shapes'],key=lambda s: EN.get(s['label'],0))
        for s in shapes:
            c=EN.get(s['label'])
            if c is None and s['label']!=FALSE: continue
            p=(np.array(s['points'],np.float32)*0.5).astype(np.int32)
            if len(p)<3: continue
            if c is None: objs.append((0,p.min(0),p.max(0))); continue
            cv2.fillPoly(lab,[p],c); cv2.polylines(lab,[p],True,c,2); objs.append((c,p.min(0),p.max(0)))
        D.append(dict(key=key,film=film_id(key),img=img,lab=lab,objs=objs))
    return D
def cells(lab):  # the highest-numbered class present in each cell
    t=torch.from_numpy(lab)[None,None].float(); return F.max_pool2d(t,STRIDE,STRIDE)[0,0].long()
def sample(d,by_class=None):
    img,lab=d['img'],d['lab']; H,W=img.shape; sc=random.uniform(0.6,1.5); n=int(CROP/sc)
    cand=[o for o in d['objs'] if by_class is None or o[0]==by_class]
    if cand and random.random()<0.8:
        o=random.choice(cand); cx=random.randint(int(o[1][0]),int(o[2][0])); cy=random.randint(int(o[1][1]),int(o[2][1]))
        x=cx-random.randint(n//5,4*n//5); y=cy-random.randint(n//5,4*n//5)
    else: x=random.randint(0,max(0,W-n)); y=random.randint(0,max(0,H-n))
    x=min(max(0,x),max(0,W-n)); y=min(max(0,y),max(0,H-n))
    a=img[y:y+n,x:x+n]; l=lab[y:y+n,x:x+n]
    if a.shape!=(n,n):
        a=cv2.copyMakeBorder(a,0,n-a.shape[0],0,n-a.shape[1],cv2.BORDER_REFLECT_101); l=cv2.copyMakeBorder(l,0,n-l.shape[0],0,n-l.shape[1],cv2.BORDER_CONSTANT,value=0)
    a=cv2.resize(a.astype(np.float32),(CROP,CROP),interpolation=cv2.INTER_AREA if n>CROP else cv2.INTER_LINEAR); l=cv2.resize(l,(CROP,CROP),interpolation=cv2.INTER_NEAREST)
    if random.random()<0.5: a=a[:,::-1]; l=l[:,::-1]
    if random.random()<0.5: a=a[::-1]; l=l[::-1]
    if random.random()<0.4: a=cv2.GaussianBlur(a,(0,0),random.uniform(0.4,1.4))
    if random.random()<0.5: a=a+np.random.randn(CROP,CROP).astype(np.float32)*random.uniform(0.5,6)
    a=(a-a.mean())*random.uniform(0.6,1.5)+a.mean()
    return lnorm(np.ascontiguousarray(a)),cells(np.ascontiguousarray(l))
def predict(net,img):
    x=torch.from_numpy(lnorm(img))[None,None]
    H,W=img.shape; ph=(-H)%STRIDE; pw=(-W)%STRIDE
    x=F.pad(x,(0,pw,0,ph),mode='reflect')
    with torch.no_grad(): return torch.softmax(net(x),1)[0].numpy()
def evaluate(net,test,thr=0.5):
    """Per outlined defect: found if any cell under it is called a defect; right type if the top class there matches.
    False alarms: connected groups of defect cells that touch no outline (SWRD 'false defect' outlines included as not-defect)."""
    net.eval(); found=collections.Counter(); right=collections.Counter(); tot=collections.Counter(); fa=0; area=0
    for d in test:
        p=predict(net,d['img']); pd=1-p[0]; cls=p[1:].argmax(0)+1; hit=(pd>thr).astype(np.uint8); used=np.zeros_like(hit)
        for c,a,b in d['objs']:
            x0,y0,x1,y1=int(a[0])//STRIDE,int(a[1])//STRIDE,int(b[0])//STRIDE+1,int(b[1])//STRIDE+1
            if c==0: continue
            tot[c]+=1; r=hit[y0:y1,x0:x1]
            if r.any():
                found[c]+=1; used[max(0,y0-1):y1+1,max(0,x0-1):x1+1]=1
                votes=np.bincount(cls[y0:y1,x0:x1][r>0],minlength=len(NAMES)); right[c]+= int(votes.argmax()==c)
        n,cc=cv2.connectedComponents(hit,connectivity=8)
        for i in range(1,n):
            if not used[cc==i].any(): fa+=1
        area+=d['img'].shape[1]
    net.train(); return found,right,tot,fa,area
if __name__=='__main__':
    steps=int(sys.argv[1]); tag=sys.argv[2]; init=sys.argv[3] if len(sys.argv)>3 else None
    torch.manual_seed(0); random.seed(0); np.random.seed(0); torch.set_num_threads(4); t0=time.time()
    D=load(); import hashlib; films=sorted(set(d['film'] for d in D)); test_f=set(f for f in films if int(hashlib.md5(f.encode()).hexdigest(),16)%100<15)   # fixed per film, so later rounds keep the same test films
    tr=[d for d in D if d['film'] not in test_f]; te=[d for d in D if d['film'] in test_f]
    cnt=collections.Counter(o[0] for d in tr for o in d['objs']); print('films',len(D),'train',len(tr),'test',len(te),'train outlines',{(NAMES[k] if k else 'false'):v for k,v in sorted(cnt.items())},round(time.time()-t0),'s',flush=True)
    byc={c:[d for d in tr if any(o[0]==c for o in d['objs'])] for c in range(0,len(NAMES))}
    net=Net()
    if init: net.load_state_dict(torch.load(init,weights_only=False)['net'])
    opt=torch.optim.AdamW(net.parameters(),1e-3,weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3 if not init else 1e-3,total_steps=steps)
    w=torch.tensor([1,1.5,2,3,3,3,3],dtype=torch.float32); B=24; run=0
    for st in range(steps):
        xs=[];ys=[]
        for b in range(B):
            c=random.choice([None,0,1,2,3,4,5,6,2,3,4,5,6]); pool=byc.get(c) if c is not None else tr
            d=random.choice(pool if pool else tr); x,y=sample(d,c); xs.append(x); ys.append(y)
        loss=F.cross_entropy(net(torch.from_numpy(np.stack(xs))[:,None]),torch.stack(ys),weight=w)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); run=0.98*run+0.02*loss.item() if st else loss.item()
        if st%200==199: print('step',st+1,'loss %.3f'%run,round(time.time()-t0),'s',flush=True); torch.save({'net':net.state_dict(),'test_films':sorted(test_f)},SP+'/ml/swrd_%s.pt'%tag)
    torch.save({'net':net.state_dict(),'test_films':sorted(test_f)},SP+'/ml/swrd_%s.pt'%tag)
    for thr in (0.5,0.8):
        found,right,tot,fa,area=evaluate(net,te,thr)
        print('held-out films, threshold',thr)
        for c in range(1,len(NAMES)):
            if tot[c]: print('  %-20s outlined %5d  found %3.0f%%  of those, right type %3.0f%%'%(NAMES[c],tot[c],100*found[c]/tot[c],100*right[c]/max(1,found[c])))
        print('  all defects found %.0f%%; false alarms %.1f per film (%d films)'%(100*sum(found.values())/max(1,sum(tot.values())),fa/max(1,len(te)),len(te)))
