"""Stream the cropped SWRD weld radiographs out of the remote zip and keep a compact copy of each
(8-bit, half resolution, contrast stretched) — the 16-bit originals would not fit on this disk."""
import sys,os,io,random,numpy as np,cv2,time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from rzip import open_zip
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=SP+'/swrd/img'; os.makedirs(OUT,exist_ok=True)
part,parts=int(sys.argv[1]),int(sys.argv[2])
z=open_zip()
names=sorted(i.filename for i in z.infolist() if i.filename.lower().endswith('.tif') and 'crop_weld_images' in i.filename)
random.Random(7).shuffle(names)
for k,n in enumerate(names):
    if k%parts!=part: continue
    key=n.split('crop_weld_images/')[1].rsplit('.',1)[0].replace('/','_'); dst=OUT+'/'+key+'.png'
    if os.path.exists(dst): continue
    try:
        a=cv2.imdecode(np.frombuffer(z.read(n),np.uint8),cv2.IMREAD_UNCHANGED)
        if a is None: print('undecodable',n,flush=True); continue
        if a.ndim==3: a=a[:,:,0]
        a=a.astype(np.float32); lo,hi=np.percentile(a[::4,::4],[0.3,99.7]); a=np.clip((a-lo)/max(hi-lo,1),0,1)*255
        a=cv2.resize(a,None,fx=0.5,fy=0.5,interpolation=cv2.INTER_AREA).astype(np.uint8)
        cv2.imwrite(dst+'.tmp.png',a); os.replace(dst+'.tmp.png',dst)
    except Exception as e: print('failed',n,str(e)[:120],flush=True); time.sleep(5)
print('part',part,'done',flush=True)
