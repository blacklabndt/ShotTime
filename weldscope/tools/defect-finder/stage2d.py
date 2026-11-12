"""Position-and-shape test. The naming step is trained twice on the same indications (hand outlines plus the
finder's own regions): once from the close crop alone, once with three extra numbers the study material says
matter — how far across the weld the indication sits (0 centre, 1 edge), its length-to-width ratio, and whether
it runs along or across the weld — plus its size relative to the weld width. Scored on the held-out films."""
import os,sys,random,time,pickle,collections,numpy as np,cv2,torch,torch.nn as nn,torch.nn.functional as F
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T, stage2b as B, e2e as E
SP=S.SP; CACHE=SP+'/swrd/regions.pkl'
def feats(a,b,welds,H):
    x0,y0,x1,y1=float(a[0]),float(a[1]),float(b[0]),float(b[1]); cx,cy=(x0+x1)/2,(y0+y1)/2; w,h=max(1.,x1-x0),max(1.,y1-y0)
    best=None; wh=H
    for wd in welds:
        near=wd[np.abs(wd[:,0]-cx)<max(75,0.05*(wd[:,0].max()-wd[:,0].min()))]
        if len(near)<2: near=wd
        top,bot=near[:,1].min(),near[:,1].max()
        if bot-top<5: continue
        r=abs(cy-(top+bot)/2)/((bot-top)/2)
        if best is None or r<best: best=r; wh=bot-top
    if best is None: best=abs(cy-H/2)/(H/2)
    return np.array([min(best,2.0),np.log(max(w,h)/min(w,h))/3.0,1.0 if w>=h else -1.0,np.log(max(w,h)/wh+1e-3)/3.0],np.float32)
class Net2F(nn.Module):
    def __init__(s,nf=4,use=True):
        super().__init__(); b=T.Net2(); s.f=b.f; s.use=use
        s.g=nn.Sequential(nn.Linear(nf,32),nn.ReLU(inplace=True)); s.h=nn.Linear(192+(32 if use else 0),7)
    def forward(s,x,v): z=s.f(x); return s.h(torch.cat([z,s.g(v)],1) if s.use else z)
if __name__=='__main__':
    mode=sys.argv[1]; torch.set_num_threads(4); t0=time.time(); D=S.load()
    if mode=='regions':
        f,_=E.models(); R={}
        for k,d in enumerate(D):
            R[d['key']]=B.regions(f,d['img'])
            if k%500==499: print('regions for',k+1,'films',round(time.time()-t0),'s',flush=True)
        pickle.dump(R,open(CACHE,'wb')); print('saved',len(R)); sys.exit()
    steps=int(sys.argv[2]); R=pickle.load(open(CACHE,'rb'))
    pool=[]   # (img, a, b, class, features, is_test, is_region)
    for d in D:
        te=E.is_te(d['film']); H=d['img'].shape[0]
        for c,a,b in d['objs']: pool.append((d['img'],a,b,c,feats(a,b,d['welds'],H),te,False))
        for bx in R.get(d['key'],[]): a,b=(bx[0],bx[1]),(bx[2],bx[3]); pool.append((d['img'],a,b,B.label(bx,d['objs']),feats(a,b,d['welds'],H),te,True))
    tr=[j for j,p in enumerate(pool) if not p[5]]; te=[j for j,p in enumerate(pool) if p[5] and p[6]]   # test on what the finder hands over
    idx=collections.defaultdict(list)
    for j in tr: idx[pool[j][3]].append(j)
    cl=list(idx); print('train',{T.NAMES[c]:len(v) for c,v in sorted(idx.items())},'test finder regions',len(te),round(time.time()-t0),'s',flush=True)
    for name,use in (('crop only',False),('crop + position and shape',True)):
        torch.manual_seed(0); random.seed(0); np.random.seed(0)
        net=Net2F(use=use); net.f.load_state_dict({k[2:]:v for k,v in torch.load(SP+'/ml/stage2.pt',weights_only=False)['net'].items() if k.startswith('f.')})
        opt=torch.optim.AdamW(net.parameters(),1e-3,weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,2e-3,total_steps=steps)
        for st in range(steps):
            js=[random.choice(idx[random.choice(cl+[1,1,0,0])]) for _ in range(96)]
            x=torch.from_numpy(np.stack([T.crop(pool[j][0],pool[j][1],pool[j][2],True) for j in js]))[:,None]; v=torch.from_numpy(np.stack([pool[j][4] for j in js]))
            v=v+torch.randn_like(v)*0.03
            loss=F.cross_entropy(net(x,v),torch.tensor([pool[j][3] for j in js]),label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            if st%500==499: print(' ',name,'step',st+1,'loss %.3f'%loss.item(),round(time.time()-t0),'s',flush=True)
        torch.save({'net':net.state_dict(),'use':use},SP+'/ml/stage2d_%d.pt'%use); net.eval(); cm=np.zeros((7,7),int)
        with torch.no_grad():
            for k in range(0,len(te),512):
                b=te[k:k+512]; q=net(torch.from_numpy(np.stack([T.crop(pool[j][0],pool[j][1],pool[j][2],False) for j in b]))[:,None],torch.from_numpy(np.stack([pool[j][4] for j in b]))).argmax(1).numpy()
                for j,c in zip(b,q): cm[pool[j][3],c]+=1
        print(name,'- held-out films, finder regions')
        for c in range(7):
            if cm[c].sum(): print('  %-20s %5d  right %3.0f%%'%(T.NAMES[c],cm[c].sum(),100*cm[c,c]/cm[c].sum()))
        d_=cm[1:].sum(); print('  real indications kept (not thrown out as artefact) %.0f%%; false regions thrown out %.0f%%; overall %.0f%%'%(100*(1-cm[1:,0].sum()/d_),100*cm[0,0]/cm[0].sum(),100*cm.diagonal().sum()/cm.sum()),flush=True)
        print(cm,flush=True)
