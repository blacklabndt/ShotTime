"""Scores EDGE-style filter settings against INDUSTREX screenshots (EDGE on) of the owner's plate.
Needs the raw pixels of the plate (little-endian u16, 1353x4266) and the screenshots; none are committed.
  EDGE_RAW=plate.raw EDGE_PLATE_ON=edge.webp EDGE_PLATE_REG=reg_plate.pkl EDGE_STRIP_OFF=strip.png EDGE_STRIP_ON=strip_edge.png python3 evaluate.py
reg_plate.pkl holds the 2x3 affine from common.register() for the full-plate screenshot (crop 199..1723 x 261..744)."""
import os
import sys, numpy as np, cv2, pickle, itertools
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from common import *
raw=load_raw(os.environ['EDGE_RAW'],1353,4266)
plate=(raw>50).astype(np.float32); med=np.median(raw[raw>50]); Vf=np.where(raw>50,raw,med).astype(np.float32)
box3=lambda a,r: cv2.blur(cv2.blur(cv2.blur(a,(2*r+1,2*r+1),borderType=cv2.BORDER_REPLICATE),(2*r+1,2*r+1),borderType=cv2.BORDER_REPLICATE),(2*r+1,2*r+1),borderType=cv2.BORDER_REPLICATE)
def model(Lr,Ms,r,T,kg):
    L=box3(Vf,Lr); M=cv2.GaussianBlur(Vf,(0,0),Ms); d=(M-L)+r*(Vf-M)
    return kg*(L-med)+d/(1+np.abs(d)/T)
def current():
    box=lambda a,r: cv2.blur(cv2.blur(a,(2*r+1,2*r+1),borderType=cv2.BORDER_REPLICATE),(2*r+1,2*r+1),borderType=cv2.BORDER_REPLICATE)
    L=box(Vf,100); M=cv2.GaussianBlur(Vf,(0,0),1.5); dm=M-L; T=0.35*282
    return 0.5*(L-med)+2.4*dm/(1+np.abs(dm)/T)+1.8*(Vf-M)
sm=lambda a: cv2.GaussianBlur(a,(0,0),1.5)
inner=cv2.erode(plate,np.ones((121,121)))
# ---- views
def plate_view():
    e,_=shot(os.environ['EDGE_PLATE_ON']); x0,x1,y0,y1=199,1723,261,744; ec=e[y0:y1,x0:x1]; W,H=x1-x0,y1-y0
    w=pickle.load(open(os.environ['EDGE_PLATE_REG'],'rb'))['w']
    f=lambda a: cv2.warpAffine(cv2.resize(np.rot90(a,1),(W,H),interpolation=cv2.INTER_AREA),w,(W,H),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REPLICATE)
    return ec,f
def strip_view():
    o,_=shot(os.environ['EDGE_STRIP_OFF']); e,_=shot(os.environ['EDGE_STRIP_ON']); x0,x1=889,1033; oc=o[:,x0:x1]; ec=e[:,x0:x1]; H,W=oc.shape
    sc=820/3468.0
    ref=cv2.resize(-Vf,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA)
    n=lambda x:((x-x.mean())/(x.std()+1e-6)).astype(np.float32)
    r=cv2.matchTemplate(n(ref),n(oc[60:940]),cv2.TM_CCOEFF_NORMED); _,mx,_,loc=cv2.minMaxLoc(r); print('strip template match',round(mx,3),loc, 'ref',ref.shape)
    w=np.array([[1,0,loc[0]],[0,1,loc[1]-60]],np.float32)
    crit=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,400,1e-7)
    _,w=cv2.findTransformECC(n(oc),n(ref),w,cv2.MOTION_AFFINE,crit,None,5); print('strip warp',w.round(4).tolist())
    f=lambda a: cv2.warpAffine(cv2.resize(a,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA),w,(W,H),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REPLICATE)
    print('strip original corr',np.corrcoef(f(Vf).ravel(),oc.ravel())[0,1])
    return ec,f
def score(out,ec,f,lo=4):
    E=sm(ec); base=(ec>lo)&(ec<251)&(f(inner)>0.999)
    p=sm(f(out))[base]; return abs(np.corrcoef(p,E[base])[0,1]), int(base.sum())
pe,pf=plate_view(); se,sf=strip_view()
print('strip EDGE grey range',se.min(),se.max())
cur=current(); print('CURRENT   plate %.3f  strip %.3f'%(score(cur,pe,pf)[0],score(cur,se,sf,lo=1)[0]))
best=[]
for Lr,Ms,r,T,kg in itertools.product([40,55,80],[8,11],[1.5,2.5],[40,80,160],[0.085,0.15,0.25,0.4]):
    m=model(Lr,Ms,r,T,kg); a,b=score(m,pe,pf)[0],score(m,se,sf,lo=1)[0]; best.append((min(a,b),a,b,Lr,Ms,r,T,kg))
best.sort(reverse=True)
for b in best[:8]: print('min %.3f plate %.4f strip %.4f  L box r %d  M sigma %d  kS/kD %.1f  limit %d  kG/kD %.3f'%b)
