"""Read members of a very large zip over HTTP range requests (the archive is far bigger than the local disk)."""
import io, os, requests, zipfile, time
URL=os.environ.get("SWRD_ZIP_URL","")  # a direct, range-capable link to SWXD_Data.zip
class Remote(io.RawIOBase):
    def __init__(s,url=URL,block=1<<22):
        s.s=requests.Session(); s.url=url; s.pos=0; s.block=block; s.cache={}
        r=s.s.get(url,headers={'Range':'bytes=0-0'},timeout=120); r.raise_for_status()
        s.size=int(r.headers['Content-Range'].split('/')[1])
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.pos
    def seek(s,o,w=0):
        s.pos = o if w==0 else s.pos+o if w==1 else s.size+o; return s.pos
    def _get(s,a,b):
        for t in range(3):
            try:
                r=s.s.get(s.url,headers={'Range':'bytes=%d-%d'%(a,b)},timeout=300)
                if r.status_code==206 and len(r.content)==b-a+1: return r.content
                err='status %d len %d'%(r.status_code,len(r.content))
            except Exception as e: err=str(e)[:100]
            time.sleep(2+4*t)
        raise IOError('range read failed: '+err)
    def read(s,n=-1):
        if n<0: n=s.size-s.pos
        n=min(n,s.size-s.pos)
        if n<=0: return b''
        out=bytearray()
        while n>0:
            bi=s.pos//s.block
            if bi not in s.cache:
                if len(s.cache)>24: s.cache.pop(next(iter(s.cache)))
                s.cache[bi]=s._get(bi*s.block,min(s.size,(bi+1)*s.block)-1)
            blk=s.cache[bi]; o=s.pos-bi*s.block; take=min(n,len(blk)-o)
            out+=blk[o:o+take]; s.pos+=take; n-=take
        return bytes(out)
    def readinto(s,b): d=s.read(len(b)); b[:len(d)]=d; return len(d)
def open_zip(): return zipfile.ZipFile(io.BufferedReader(Remote(),buffer_size=1<<20))
if __name__=='__main__':
    import collections, pickle
    z=open_zip(); il=z.infolist(); print(len(il),'entries, total GB %.1f'%(sum(i.file_size for i in il)/1e9))
    pickle.dump([(i.filename,i.file_size,i.compress_size) for i in il],open(os.path.dirname(os.path.abspath(__file__))+'/../swrd/index.pkl','wb'))
    c=collections.Counter(); sz=collections.Counter()
    for i in il:
        d='/'.join(i.filename.split('/')[:3]); c[d]+=1; sz[d]+=i.file_size
    for d,n in sorted(c.items())[:60]: print('%7d %8.1f GB  %s'%(n,sz[d]/1e9,d))

# ---- reading members from a saved index: no need to fetch the archive's directory again
import pickle, struct, zlib
INDEX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','swrd','zipindex.pkl')
def save_index():
    z=open_zip(); pickle.dump({i.filename:(i.header_offset,i.compress_size,i.file_size,i.compress_type) for i in z.infolist()},open(INDEX,'wb')); return len(z.infolist())
class Indexed:
    def __init__(s): s.idx=pickle.load(open(INDEX,'rb')); s.r=Remote(block=1<<20)
    def names(s): return list(s.idx)
    def read(s,name):
        off,csize,size,method=s.idx[name]
        h=s.r._get(off,off+29)
        if h[:4]!=b'PK\x03\x04': raise IOError('not a zip member (download refused?)')
        n,m=struct.unpack('<HH',h[26:30]); start=off+30+n+m
        data=s.r._get(start,start+csize-1) if csize else b''
        if method==0: return data
        if method==8: return zlib.decompress(data,-15)
        raise IOError('unsupported compression %d'%method)
