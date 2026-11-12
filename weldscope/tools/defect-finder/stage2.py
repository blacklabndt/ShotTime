"""Second step: name the type of an indication from a close crop around it (and reject film artefacts).
Trained on SWRD outlines, 'false defect' outlines as class 0. Same held-out films as the finder."""
import os,sys,random,time,hashlib,collections,numpy as np,cv2,torch,torch.nn as nn,torch.nn.functional as F
sys.argv=sys.argv[:1]+sys.argv[1:]; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S
SP=S.SP; N=64; NAMES=['not_a_defect']+S.NAMES[1:]
def crop(img,a,b,aug):
    cx,cy=(a[0]+b[0])/2,(a[1]+b[1])/2; side=max(40,1.7*max(b[0]-a[0],b[1]-a[1]))
    if aug: side*=random.uniform(0.8,1.3); cx+=random.uniform(-.12,.12)*side; cy+=random.uniform(-.12,.12)*side
    h=side/2; M=np.float32([[N/side,0,-(cx-h)*N/side],[0,N/side,-(cy-h)*N/side]])
    p=cv2.warpAffine(img,M,(N,N),flags=cv2.INTER_AREA if side>N else cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101).astype(np.float32)
    if aug:
        if random.random()<.5: p=p[:,::-1]
        if random.random()<.5: p=p[::-1]
        if random.random()<.4: p=p+np.random.randn(N,N).astype(np.float32)*random.uniform(.5,5)
        if random.random()<.3: p=cv2.GaussianBlur(p,(0,0),random.uniform(.4,1.2))
    p=np.ascontiguousarray(p)
    if S.NORM_K>0: return np.clip((p-np.median(p))/S.NORM_K,-6,6)     # keep how dark the indication really is
    return np.clip((p-p.mean())/(p.std()+1.5),-4,4)
class Net2(nn.Module):
    def __init__(s,n=7):
        super().__init__()
        def blk(i,o): return nn.Sequential(nn.Conv2d(i,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.Conv2d(o,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.MaxPool2d(2))
        s.f=nn.Sequential(blk(1,32),blk(32,64),blk(64,128),blk(128,192),nn.AdaptiveAvgPool2d(1),nn.Flatten(),nn.Dropout(0.2)); s.h=nn.Linear(192,n)
    def forward(s,x): return s.h(s.f(x))
if __name__=='__main__':
    steps=int(sys.argv[1]); limit=int(sys.argv[2]) if len(sys.argv)>2 else None
    torch.manual_seed(0); random.seed(0); np.random.seed(0); torch.set_num_threads(4); t0=time.time()
    D=S.load(limit); is_te=lambda d:int(hashlib.md5(d['film'].encode()).hexdigest(),16)%100<15
    tr=[(d['img'],o) for d in D if not is_te(d) for o in d['objs']]; te=[(d['img'],o) for d in D if is_te(d) for o in d['objs']]
    byc=collections.defaultdict(list)
    for it in tr: byc[it[1][0]].append(it)
    print('train objects',{NAMES[c]:len(v) for c,v in sorted(byc.items())},'test',len(te),round(time.time()-t0),'s',flush=True)
    net=Net2(); opt=torch.optim.AdamW(net.parameters(),1e-3,weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3,total_steps=steps); B=96
    for st in range(steps):
        items=[random.choice(byc[random.choice(list(byc))]) for _ in range(B)]     # every class equally often
        x=torch.from_numpy(np.stack([crop(i,o[1],o[2],True) for i,o in items]))[:,None]; y=torch.tensor([o[0] for i,o in items])
        loss=F.cross_entropy(net(x),y,label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if st%500==499: print('step',st+1,'loss %.3f'%loss.item(),round(time.time()-t0),'s',flush=True)
    torch.save({'net':net.state_dict()},SP+'/ml/stage2.pt'); net.eval(); cm=np.zeros((7,7),int)
    with torch.no_grad():
        for k in range(0,len(te),512):
            b=te[k:k+512]; p=net(torch.from_numpy(np.stack([crop(i,o[1],o[2],False) for i,o in b]))[:,None]).argmax(1).numpy()
            for (i,o),q in zip(b,p): cm[o[0],q]+=1
    print('held-out films: type named from a close crop of each outlined indication')
    for c in range(7):
        if cm[c].sum(): print('  %-20s %5d  right %3.0f%%   most often confused with %s (%d%%)'%(NAMES[c],cm[c].sum(),100*cm[c,c]/cm[c].sum(),NAMES[int(np.argsort(cm[c]*(np.arange(7)!=c))[-1])],100*np.sort(cm[c]*(np.arange(7)!=c))[-1]/cm[c].sum()))
    print(cm)
