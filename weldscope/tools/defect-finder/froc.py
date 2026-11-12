"""Found % against false alarms per film as the score cut-off moves (candidates from rank.py)."""
import os,sys,pickle,numpy as np
os.environ.setdefault('NORM_K','8'); sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, e2e as E, rank as R
te=S.load(only=E.is_te); C=pickle.load(open(S.SP+'/swrd/rank_cands.pkl','rb'))
hit=lambda e,a,b: e[0]<=b[0]+8 and e[2]>=a[0]-8 and e[1]<=b[1]+8 and e[3]>=a[1]-8
for name,sc in R.SCORES.items():
    fa=[]; obj=[]; cls=[]                      # false-alarm scores; per real indication its best covering score
    for d,c in zip(te,C):
        real=[(k,a,b) for k,a,b in d['objs'] if k>0]; art=[(a,b) for k,a,b in d['objs'] if k==0]
        for e in c:
            if not any(hit(e,a,b) for k,a,b in real): fa.append(sc(e))
        for k,a,b in real: obj.append(max([sc(e) for e in c if hit(e,a,b)],default=-1)); cls.append(k)
    fa=np.sort(np.array(fa))[::-1]; obj=np.array(obj); cls=np.array(cls); print('ranked by',name)
    for per in (0.5,1,2,3,5,10,20):
        t=fa[int(per*len(te))]; print('  %4.1f false alarms/film: found %3.0f%% |'%(per,100*np.mean(obj>t)),' '.join('%s %.0f'%(S.NAMES[k][:4],100*np.mean(obj[cls==k]>t)) for k in range(1,7)),'| cut-off %.3f'%t)
