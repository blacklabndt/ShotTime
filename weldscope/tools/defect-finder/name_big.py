"""Bigger naming model test. A ResNet pretrained on ImageNet is fine-tuned to name finder regions.
  name_big.py <mode> <steps> [arch]     mode: ctx = close crop + two wider views; close = close crop only (x3)
Scored on the held-out finder regions next to the current small naming step (its answers are in name_data.npz)."""
import os,sys,time,random,collections,numpy as np,torch,torch.nn as nn,torch.nn.functional as F,torchvision
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); NAMES=['not_a_defect','porosity','slag','undercut','lack_of_penetration','lack_of_fusion','crack']
def report(name,P,y):
    real=y>0; pred=P[:,1:].argmax(1)+1; out=[]
    for c in range(1,7):
        m=y==c; out.append(100*np.mean(pred[m]==c) if m.any() else float('nan'))
    slag=y==2; conf=collections.Counter(pred[slag].tolist())
    # how well "is it a defect at all" separates (area under the curve)
    s=1-P[:,0]; o=np.argsort(s); r=np.empty(len(s)); r[o]=np.arange(1,len(s)+1); npos=real.sum(); auc=(r[real].sum()-npos*(npos+1)/2)/(npos*(len(s)-npos))
    print('%-22s'%name,' '.join('%s %3.0f'%(NAMES[c][:5],out[c-1]) for c in range(1,7)),'| mean of types %.0f | all real regions %.0f | defect-or-not AUC %.3f | slag called:'%(np.nanmean(out),100*np.mean(pred[real]==y[real]),auc),{NAMES[k][:5]:v for k,v in conf.most_common(3)},flush=True)
def batch(X,idx,mode,train):
    x=torch.from_numpy(X[idx]).float()/60.0                      # int8 (grey levels x 20 / 8) -> about +-2
    if train:
        i,j=random.randint(0,16),random.randint(0,16); x=x[:,:,i:i+96,j:j+96]
        if random.random()<.5: x=x.flip(3)
        if random.random()<.5: x=x.flip(2)
        x=x+torch.randn_like(x)*random.uniform(0,.08)
    else: x=x[:,:,8:104,8:104]
    if mode=='close': x=x[:,:1].repeat(1,3,1,1)
    return x
if __name__=='__main__':
    mode,steps=sys.argv[1],int(sys.argv[2]); arch=sys.argv[3] if len(sys.argv)>3 else 'resnet18'
    torch.manual_seed(0); random.seed(0); np.random.seed(0); torch.set_num_threads(4); t0=time.time()
    Z=np.load(SP+'/swrd/name_data.npz'); Xtr,ytr,Xte,yte,base=Z['Xtr'],Z['ytr'].astype(int),Z['Xte'],Z['yte'].astype(int),Z['base']
    print('train',Xtr.shape,collections.Counter(ytr.tolist()),'test',Xte.shape,collections.Counter(yte.tolist()),flush=True)
    report('current small step',base,yte)
    net=getattr(torchvision.models,arch)(); net.load_state_dict(torch.load(SP+'/ml/pre/%s.pth'%arch)); net.fc=nn.Linear(net.fc.in_features,7)
    out=SP+'/ml/name_%s_%s.pt'%(arch,mode); start=0
    head=list(net.fc.parameters()); body=[p for n_,p in net.named_parameters() if not n_.startswith('fc.')]
    opt=torch.optim.AdamW([{'params':body,'lr':3e-4},{'params':head,'lr':1.5e-3}],weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,[6e-4,3e-3],total_steps=steps,pct_start=0.15)
    if os.path.exists(out):
        ck=torch.load(out,weights_only=False); net.load_state_dict(ck['net']); opt.load_state_dict(ck['opt']); sched.load_state_dict(ck['sched']); start=ck['step']; print('resumed at',start)
    idx={c:np.nonzero(ytr==c)[0] for c in range(7)}; cl=list(range(7))+[1,1,0,0]; B=64
    def evaluate():
        net.eval(); P=[]
        with torch.no_grad():
            for i in range(0,len(Xte),256): P.append(torch.softmax(net(batch(Xte,slice(i,i+256),mode,False)),1).numpy())
        net.train(); return np.concatenate(P)
    net.train()
    for st in range(start,steps):
        js=np.sort(np.array([random.choice(idx[random.choice(cl)]) for _ in range(B)])); y=torch.from_numpy(ytr[js])
        loss=F.cross_entropy(net(batch(Xtr,js,mode,True)),y,label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if st%100==99: print('step',st+1,'loss %.3f'%loss.item(),round(time.time()-t0),'s',flush=True)
        if st%500==499 or st==steps-1:
            torch.save({'net':net.state_dict(),'opt':opt.state_dict(),'sched':sched.state_dict(),'step':st+1},out); report('%s %s step %d'%(arch,mode,st+1),evaluate(),yte)
    np.save(SP+'/swrd/name_%s_%s_probs.npy'%(arch,mode),evaluate())
