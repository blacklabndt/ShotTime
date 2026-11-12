"""Write the finder and the naming step as one WeldScope model file (core/src/indications.rs reads it).
Batch norm is folded into each convolution. The file holds trained weights: never commit it.
  python3 export_weights.py finder.pt namer.pt indication-models.bin"""
import sys,struct,numpy as np,torch
def fold(sd,conv,bn):
    w=sd[conv+'.weight'].double(); g=sd[bn+'.weight'].double(); b=sd[bn+'.bias'].double(); m=sd[bn+'.running_mean'].double(); v=sd[bn+'.running_var'].double()
    s=g/torch.sqrt(v+1e-5); return (w*s[:,None,None,None]).float().numpy(),(b-m*s).float().numpy()
def tensors(finder,namer):
    out=[]
    for sd in (finder,namer):
        for blk in range(4):
            for conv,bn in ((0,1),(3,4)): out+=list(fold(sd,'f.%d.%d'%(blk,conv),'f.%d.%d'%(blk,bn)))
        if sd is finder: out+=[sd['h.weight'].float().numpy(),sd['h.bias'].float().numpy()]
    return out+[namer['h.weight'].float().numpy(),namer['h.bias'].float().numpy()]
def write(path,ts):
    with open(path,'wb') as f:
        f.write(b'WSIND001'+struct.pack('<I',len(ts)))
        for t in ts: f.write(struct.pack('<I',t.ndim)+struct.pack('<%dI'%t.ndim,*t.shape)+np.ascontiguousarray(t,'<f4').tobytes())
if __name__=='__main__':
    sd=lambda p: torch.load(p,weights_only=False,map_location='cpu')['net']
    write(sys.argv[3],tensors(sd(sys.argv[1]),sd(sys.argv[2]))); print('wrote',sys.argv[3])
