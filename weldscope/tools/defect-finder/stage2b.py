"""Type-naming step retrained on the regions the finder actually produces (not just the hand-drawn outlines),
so it sees merged groups of pores, loose boxes and the finder's own false alarms. Then scored end to end."""
import os,sys,random,time,hashlib,collections,pickle,numpy as np,cv2,torch,torch.nn.functional as F
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T, e2e as E
SP=S.SP; is_te=E.is_te
def regions(f,img,thr=0.5):
    p=S.predict(f,img); hit=((1-p[0])>thr).astype(np.uint8); k,cc,st,_=cv2.connectedComponentsWithStats(hit,connectivity=8)
    return [(st[i][0]*8,st[i][1]*8,(st[i][0]+st[i][2])*8,(st[i][1]+st[i][3])*8) for i in range(1,k)]
def label(b,objs):
    best=(0,0)
    for c,a,e in objs:
        ix=min(b[2],e[0]+8)-max(b[0],a[0]-8); iy=min(b[3],e[1]+8)-max(b[1],a[1]-8)
        if ix>0 and iy>0 and c and ix*iy>best[0]: best=(ix*iy,c)
    return best[1]
if __name__=='__main__':
    steps=int(sys.argv[1]); torch.manual_seed(0); random.seed(0); np.random.seed(0); torch.set_num_threads(4); t0=time.time()
    os.environ.setdefault('NAMER','stage2.pt'); f,_=E.models(); D=S.load(); tr=[d for d in D if not is_te(d['film'])]; print('train films',len(tr),flush=True)
    byc=collections.defaultdict(list)
    for k,d in enumerate(tr):
        for b in regions(f,d['img']): byc[label(b,d['objs'])].append((d['img'],(b[0],b[1]),(b[2],b[3])))
        for c,a,e in d['objs']: byc[c].append((d['img'],a,e))
        if k%500==499: print('regions for',k+1,'films',round(time.time()-t0),'s',flush=True)
    print('samples',{T.NAMES[c]:len(v) for c,v in sorted(byc.items())},flush=True)
    net=T.Net2(); OUT=SP+'/ml/'+os.environ.get('OUT','stage2b.pt')
    if S.NORM_K<=0: net.load_state_dict(torch.load(SP+'/ml/stage2.pt',weights_only=False)['net'])
    opt=torch.optim.AdamW(net.parameters(),1e-3,weight_decay=1e-4); sched=torch.optim.lr_scheduler.OneCycleLR(opt,2e-3,total_steps=steps); B=96; cl=list(byc)
    # labels travel with the items: rebuild as (item, class) lists to keep the loop simple
    pool=[(it,c) for c,v in byc.items() for it in v]; idx=collections.defaultdict(list)
    for j,(it,c) in enumerate(pool): idx[c].append(j)
    for st in range(steps):
        js=[random.choice(idx[random.choice(cl+[1,1,0,0])]) for _ in range(B)]
        x=torch.from_numpy(np.stack([T.crop(pool[j][0][0],pool[j][0][1],pool[j][0][2],True) for j in js]))[:,None]; y=torch.tensor([pool[j][1] for j in js])
        loss=F.cross_entropy(net(x),y,label_smoothing=0.05); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if st%500==499: print('step',st+1,'loss %.3f'%loss.item(),round(time.time()-t0),'s',flush=True); torch.save({'net':net.state_dict()},OUT)
    torch.save({'net':net.state_dict()},OUT); net.eval(); del pool,byc,tr
    te=[d for d in D if is_te(d['film'])]
    for thr,rej in ((0.5,0.5),(0.8,0.5),(0.5,0.7)):
        tot=collections.Counter(); found=collections.Counter(); right=collections.Counter(); fa=0
        for d in te:
            det=E.detect(f,net,d['img'],thr,rej); used=[False]*len(det)
            for c,a,b in d['objs']:
                if c==0: continue
                tot[c]+=1; hit=[i for i,e in enumerate(det) if e[0]<=b[0]+8 and e[2]>=a[0]-8 and e[1]<=b[1]+8 and e[3]>=a[1]-8]
                if hit:
                    found[c]+=1; right[c]+= det[max(hit,key=lambda i:det[i][5])][4]==c
                    for i in hit: used[i]=True
            fa+=sum(1 for u in used if not u)
        print('finder threshold',thr,'artefact rejection',rej)
        for c in range(1,7): print('  %-20s %5d  found %3.0f%%  named right %3.0f%%'%(S.NAMES[c],tot[c],100*found[c]/max(1,tot[c]),100*right[c]/max(1,found[c])))
        print('  all found %.0f%%; false alarms %.1f per film'%(100*sum(found.values())/sum(tot.values()),fa/len(te)),flush=True)
