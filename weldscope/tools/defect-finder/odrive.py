"""List / download a publicly shared personal OneDrive folder (anonymous 'Badger' token, as the web viewer does)."""
import base64,json,os,sys,requests
def session(url):
    s=requests.Session()
    r=s.post('https://api-badgerp.svc.ms/v1.0/token',json={'appId':'5cbed6ac-a083-4e14-b191-b4ba07653de2'},timeout=60); r.raise_for_status()
    s.headers.update({'Authorization':'Badger '+r.json()['token'],'Prefer':'autoredeem'})
    enc='u!'+base64.urlsafe_b64encode(url.encode()).decode().rstrip('=')
    return s,'https://my.microsoftpersonalcontent.com/_api/v2.0/shares/'+enc+'/driveItem'
def walk(s,base,path=''):
    url=base+'/children?$top=200' if not path else None
    stack=[(base,'')]; out=[]
    while stack:
        b,p=stack.pop(); u=b+'/children?$top=200'
        while u:
            r=s.get(u,timeout=90); r.raise_for_status(); j=r.json()
            for it in j.get('value',[]):
                name=p+it['name']
                if 'folder' in it:
                    stack.append(('https://my.microsoftpersonalcontent.com/_api/v2.0/drives/%s/items/%s'%(it['parentReference']['driveId'],it['id']),name+'/'))
                else: out.append(dict(path=name,size=it.get('size',0),url=it.get('@content.downloadUrl'),id=it['id'],drive=it['parentReference']['driveId']))
            u=j.get('@odata.nextLink')
    return out
if __name__=='__main__':
    s,base=session(sys.argv[1]); r=s.get(base,timeout=60); print(r.status_code, r.text[:300] if r.status_code!=200 else r.json().get('name'))
    if r.status_code==200:
        items=walk(s,base); json.dump(items,open(sys.argv[2],'w'))
        import collections
        print(len(items),'files, %.1f GB'%(sum(i['size'] for i in items)/1e9)); print(collections.Counter(os.path.splitext(i['path'])[1].lower() for i in items).most_common(12))
        print(collections.Counter(i['path'].split('/')[0] for i in items).most_common(25))

def fetch(s,item,dst):
    """Download one file; the stored link is tried first, then a fresh one from the item's record."""
    os.makedirs(os.path.dirname(dst),exist_ok=True)
    r=requests.get(item['url'],timeout=300) if item.get('url') else None
    if r is None or r.status_code!=200:
        m=s.get('https://my.microsoftpersonalcontent.com/_api/v2.0/drives/%s/items/%s'%(item['drive'],item['id']),timeout=60); m.raise_for_status()
        r=requests.get(m.json()['@content.downloadUrl'],timeout=300); r.raise_for_status()
    open(dst,'wb').write(r.content); return len(r.content)
