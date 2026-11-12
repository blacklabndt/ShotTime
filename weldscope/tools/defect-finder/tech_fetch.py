"""Download files of given types from the technician's shared OneDrive folder, keeping the folder layout.
Private job data: stays in the scratchpad, never in the repository. Usage: tech_fetch.py .xlsx,.xlsm"""
import sys,os,json,time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import odrive
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); URL=open(SP+'/tech/link.txt').read().strip()
exts=tuple(sys.argv[1].lower().split(',')); it=[i for i in json.load(open(SP+'/tech/index.json')) if i['path'].lower().endswith(exts)]
s,base=odrive.session(URL); s.get(base,timeout=60); n=0; bad=0; t0=time.time()
for k,i in enumerate(it):
    dst=SP+'/tech/files/'+i['path']
    if os.path.exists(dst) and os.path.getsize(dst)==i['size']: continue
    for attempt in range(3):
        try: odrive.fetch(s,i,dst); n+=1; break
        except Exception as e:
            if attempt==1: s,base=odrive.session(URL); s.get(base,timeout=60)
            if attempt==2: bad+=1; print('failed',i['path'][:100],str(e)[:80],flush=True)
            time.sleep(3)
    if k%100==99: print(k+1,'of',len(it),'downloaded',n,'failed',bad,round(time.time()-t0),'s',flush=True)
print('done',len(it),'files; downloaded',n,'failed',bad,flush=True)
