"""Parity fixture for core/tests/indications.rs: tiny networks with random weights (nothing trained, no real
image), run through the same Python code the research used. Needs swrd_train.py / stage2.py importable.
  NORM_K=8 python3 make_fixture.py ../../core/tests/fixtures"""
import os,sys,json,numpy as np,torch,torch.nn as nn
os.environ['NORM_K']='8'; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import swrd_train as S, stage2 as T, export_weights as X, rank as R
torch.manual_seed(1); rng=np.random.RandomState(1); out=sys.argv[1]
f=S.Net(w=(4,6,8,10)); n=T.Net2()
def blk(i,o): return nn.Sequential(nn.Conv2d(i,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.Conv2d(o,o,3,1,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True),nn.MaxPool2d(2))
n.f=nn.Sequential(blk(1,4),blk(4,6),blk(6,8),blk(8,10),nn.AdaptiveAvgPool2d(1),nn.Flatten(),nn.Dropout(0.2)); n.h=nn.Linear(10,7)
for net in (f,n):
    for m in net.modules():
        if isinstance(m,nn.BatchNorm2d): m.weight.data.uniform_(0.5,1.5); m.bias.data.uniform_(-.3,.3); m.running_mean.uniform_(-.3,.3); m.running_var.uniform_(0.5,1.5)
        if isinstance(m,nn.Conv2d): m.weight.data.mul_(1.6)
    net.eval()
X.write(out+'/indication-test-model.bin',X.tensors(f.state_dict(),n.state_dict()))
import cv2
H,W=612,700                                      # not a multiple of 8, and more than one tile each way
img=cv2.GaussianBlur(rng.rand(H,W).astype(np.float32),(0,0),6); img=(img-img.min())/(img.max()-img.min())*200+20
img+=rng.randn(H,W)*4; img[300:306,100:400]-=30; img=np.clip(img,0,255).astype(np.uint8)
d=1-S.predict(f,img)[0]
boxes=[(96,40,136,64),(8,8,24,24),(600,500,696,608),(300,296,420,312)]
crops=np.stack([T.crop(img,(b[0],b[1]),(b[2],b[3]),False) for b in boxes])
with torch.no_grad(): probs=torch.softmax(n(torch.from_numpy(crops)[:,None]),1).numpy()
cands=R.candidates(f,n,img,0.1)
json.dump(dict(w=W,h=H,img=img.ravel().tolist(),gw=d.shape[1],gh=d.shape[0],d=[round(float(v),6) for v in d.ravel()],boxes=boxes,
    crop0=[round(float(v),5) for v in crops[0].ravel()],probs=[[round(float(v),6) for v in p] for p in probs],
    cands=[[float(v) for v in c] for c in cands]),open(out+'/indication-parity.json','w'))
print('finder map',d.shape,'range %.3f-%.3f'%(d.min(),d.max()),'candidates',len(cands))
