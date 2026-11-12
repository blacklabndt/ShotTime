import sys,os,pickle,json,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from rzip import open_zip
SP=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
z=open_zip(); J={}
for i in z.infolist():
    if i.filename.startswith('crop_weld_data/crop_weld_jsons/') and i.filename.endswith('.json'):
        J[i.filename]=json.loads(z.read(i))
pickle.dump(J,open(SP+'/swrd/jsons.pkl','wb')); print(len(J),'annotation files')
k=next(iter(J)); print(k); print(json.dumps(J[k])[:900])
c=collections.Counter(s.get('label') for j in J.values() for s in j.get('shapes',[])); print(c)
print('images with no shapes',sum(1 for j in J.values() if not j.get('shapes')))
os.makedirs(SP+'/swrd/sample',exist_ok=True)
names=[i for i in z.infolist() if i.filename.lower().endswith('.tif') and 'crop_weld_images' in i.filename]
for i in [names[0],names[2500],names[4000]]:
    open(SP+'/swrd/sample/'+os.path.basename(i.filename),'wb').write(z.read(i))
