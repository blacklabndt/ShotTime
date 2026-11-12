"""Fetch the technician's DICONDE files one at a time and keep a compact copy of each: an 8-bit PNG at full
resolution in film convention (more radiation = darker), stretched over the film area, plus the few header
fields needed to match it to a report row. The 14 GB of originals would not fit here. Private job data."""
import sys,os,json,time,io,numpy as np,cv2,pydicom
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import odrive
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); URL=open(SP+'/tech/link.txt').read().strip(); OUT=SP+'/tech/dcm'; os.makedirs(OUT,exist_ok=True)
it=[i for i in json.load(open(SP+'/tech/index.json')) if i['path'].lower().endswith('.dcm')]
s,base=odrive.session(URL); s.get(base,timeout=60); meta_path=SP+'/tech/dcm_meta.jsonl'; done=set()
if os.path.exists(meta_path): done={r['path'] for r in map(json.loads,open(meta_path)) if 'png' in r}   # failed ones are tried again
mf=open(meta_path,'a'); t0=time.time(); n=0
for k,i in enumerate(it):
    if i['path'] in done: continue
    tmp=SP+'/tech/tmp.dcm'; rec=dict(path=i['path'])
    try:
        odrive.fetch(s,i,tmp); d=pydicom.dcmread(tmp); a=d.pixel_array.astype(np.float32)
        if a.ndim>2: a=a[0] if a.shape[0]<8 else a[...,0]
        mono1=str(getattr(d,'PhotometricInterpretation',''))=='MONOCHROME1'
        # raw CR values rise with radiation on these exports; film convention wants more radiation darker
        med=np.median(a[a>np.percentile(a,5)]); film=a>0.6*med
        lo,hi=np.percentile(a[film],[0.5,99.5]) if film.sum()>1000 else (a.min(),a.max())
        img=(255-np.clip((a-lo)/max(hi-lo,1),0,1)*255).astype(np.uint8)
        name='%05d.png'%k; cv2.imwrite(OUT+'/'+name,img)
        g=lambda t: str(getattr(d,t,'') or '')
        rec.update(png=name,rows=int(a.shape[0]),cols=int(a.shape[1]),series=g('SeriesDescription'),study=g('StudyDescription'),comments=g('ImageComments'),instance=g('InstanceNumber'),date=g('StudyDate') or g('ContentDate'),
                   spacing=[float(x) for x in (getattr(d,'ImagerPixelSpacing',None) or getattr(d,'PixelSpacing',None) or [])],mono1=mono1,derived='DERIVED' in g('ImageType'),component=g('PatientID'),lo=float(lo),hi=float(hi))
        n+=1
    except Exception as e:
        rec.update(error=str(e)[:120])
        if 'Unauthor' in str(e) or '401' in str(e) or '403' in str(e): s,base=odrive.session(URL); s.get(base,timeout=60)
    mf.write(json.dumps(rec)+'\n'); mf.flush()
    if k%50==49: print(k+1,'of',len(it),'converted',n,round(time.time()-t0),'s',flush=True)
print('done; converted',n,flush=True)
