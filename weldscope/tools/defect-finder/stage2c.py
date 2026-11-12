"""Does full resolution help name slag? Trains the naming step twice on the same indications from films that
contain slag — once on crops cut from the full-resolution film, once from the half-resolution copy — and
scores both on the same held-out films. Usage: stage2c.py STEPS"""
import os,sys,glob,random,time,hashlib,collections,numpy as np,cv2,torch,torch.nn as nn,torch.nn.functional as F
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T
SP=S.SP; C=96
def prep(p,aug):
    if aug:
        o=random.randint(0,32); s=random.randint(C-16,128-o) if 128-o>=C-16 else C; s=min(s,128-o); oy=random.randint(0,128-s); ox=random.randint(0,128-s); p=p[oy:oy+s,ox:ox+s]
        p=cv2.resize(p,(C,C)).astype(np.float32)
        if random.random()<.5: p=p[:,::-1]
        if random.random()<.5: p=p[::-1]
        if random.random()<.4: p=p+np.random.randn(C,C).astype(np.float32)*random.uniform(.5,5)
    else: p=p[16:112,16:112].astype(np.float32)
    p=np.ascontiguousarray(p); return np.clip((p-p.mean())/(p.std()+1.5),-4,4)
class Net3(nn.Module):
    def __init__(s,n=7):
        super().__init__()
        def blk(i,o): return nn.Sequential(nn.Conv2d(i,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.Conv2d(o,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.MaxPool2d(2))
        s.f=nn.Sequential(blk(1,24),blk(24,48),blk(48,96),blk(96,160),blk(160,192),nn.AdaptiveAvgPool2d(1),nn.Flatten(),nn.Dropout(0.2)); s.h=nn.Linear(192,n)
    def forward(s,x): return s.h(s.f(x))
def run(X,Y,te,steps,seed=0):
    torch.manual_seed(seed); random.seed(seed); np.random.seed(seed)
    tr=np.where(~te)[0]; byc=collections.defaultdict(list)
    for j in tr: byc[int(Y[j])].append(j)
    cl=[c for c in byc if len(byc[c])>=5]; net=Net3(); opt=torch.optim.AdamW(net.parameters(),1e-3,weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,3e-3,total_steps=steps)
    for st in range(steps):
        js=[random.choice(byc[random.choice(cl)]) for _ in range(64)]
        loss=F.cross_entropy(net(torch.from_numpy(np.stack([prep(X[j],True) for j in js]))[:,None]),torch.tensor([int(Y[j]) for j in js]),label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    net.eval(); cm=np.zeros((7,7),int); ti=np.where(te)[0]
    with torch.no_grad():
        for k in range(0,len(ti),256):
            b=ti[k:k+256]; q=net(torch.from_numpy(np.stack([prep(X[j],False) for j in b]))[:,None]).argmax(1).numpy()
            for j,c in zip(b,q): cm[int(Y[j]),c]+=1
    return cm,net
if __name__=='__main__':
    steps=int(sys.argv[1]); torch.set_num_threads(4); F_=[];H_=[];Y=[];te=[]
    files=sorted(glob.glob(SP+'/swrd/crops/*.npz'))
    for f in files:
        d=np.load(f); t=int(hashlib.md5(S.film_id(os.path.basename(f)[:-4]).encode()).hexdigest(),16)%100<15
        F_.append(d['full']); H_.append(d['half']); Y+=list(d['meta'][:,0]); te+=[t]*len(d['meta'])
    F_=np.concatenate(F_); H_=np.concatenate(H_); Y=np.array(Y); te=np.array(te)
    print(len(files),'films,',len(Y),'indications; train per class',np.bincount(Y[~te].astype(int),minlength=7),'test',np.bincount(Y[te].astype(int),minlength=7),flush=True)
    for name,X in (('half resolution',H_),('full resolution',F_)):
        cm,net=run(X,Y,te,steps); torch.save({'net':net.state_dict()},SP+'/ml/stage2c_%s.pt'%name.split()[0])
        print(name); 
        for c in range(7):
            if cm[c].sum(): print('  %-20s %5d  right %3.0f%%'%(T.NAMES[c],cm[c].sum(),100*cm[c,c]/cm[c].sum()))
        print('  slag called porosity %.0f%%, porosity called slag %.0f%%'%(100*cm[2,1]/max(1,cm[2].sum()),100*cm[1,2]/max(1,cm[1].sum())),flush=True)
