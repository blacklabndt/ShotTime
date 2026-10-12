"""Render verified PDF figure crops; never upscale or redraw screenshot patterns.
Run from project root with --renderer pointing to pdftoppm.
Crop coordinates are measured against 1000-pixel-high page previews.
"""
import argparse, base64, hashlib, json, struct, subprocess
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--renderer',required=True)
args=parser.parse_args()
out=Path('build/chart-sources/high-resolution');out.mkdir(parents=True,exist_ok=True)
sources={
 'viii':('build/viii-2023-reference.pdf','ASME BPVC.VIII.1-2023, Appendix 4; rendered from the original PDF.'),
 'boiler':('build/section-i-2019.pdf','ASME BPVC.I-2019, A-250; rendered from the original PDF.'),
 'csa':('build/csa-z662-23-march2024-reference.pdf','CSA Z662:23, Figure 7.22; rendered from the original PDF.')}
# key, source, PDF page (one based), x/y/width/height at preview scale, clockwise rotation
figures=[
 ('4-3','viii',434,(62,583,626,344),False),
 ('4-4','viii',435,(85,85,626,383),False),
 ('4-5','viii',435,(85,483,626,423),False),
 ('4-6','viii',436,(62,85,626,460),False),
 ('4-7','viii',437,(85,85,626,498),False),
 ('4-8','viii',438,(62,85,626,577),False),
 ('A-250.3.4-1','boiler',334,(292,140,174,780),True),
 ('A-250.3.4-2','boiler',335,(290,140,225,780),True),
 ('A-250.3.6-1','boiler',336,(62,85,626,345),False),
 ('A-250.3.6-2','boiler',336,(62,591,626,336),False),
 ('A-250.3.6-3','boiler',337,(85,85,626,380),False),
 ('A-250.3.6-4','boiler',337,(85,534,626,393),False),
 ('A-250.3.6-5','boiler',338,(62,85,626,508),False),
 ('A-250.3.6-6','boiler',339,(85,85,626,535),False),
 ('7.22 a)','csa',259,(130,278,514,158),False),
 ('7.22 b)','csa',259,(130,456,514,157),False),
 ('7.22 c)','csa',259,(130,635,514,158),False)]
assets_path=Path('assets/code-chart-images.json')
assets=json.loads(assets_path.read_text())
records=[]
for index,(figure,source,page,crop,rotate) in enumerate(figures):
 pdf,description=sources[source];prefix=out/str(index)
 x,y,w,h=[v*4 for v in crop]
 subprocess.run([args.renderer,'-f',str(page),'-l',str(page),'-singlefile','-scale-to','4000','-x',str(x),'-y',str(y),'-W',str(w),'-H',str(h),'-png',pdf,str(prefix)],check=True)
 data=prefix.with_suffix('.png').read_bytes();width,height=struct.unpack('>II',data[16:24]);assert (width,height)==(w,h)
 asset={'href':'data:image/png;base64,'+base64.b64encode(data).decode(),'width':width,'height':height,'viewBox':f'0 0 {height if rotate else width} {width if rotate else height}','source':description}
 if rotate:asset['transform']=f'translate({height} 0) rotate(90)'
 assets['hq:'+figure]=asset
 records.append({'figure':figure,'pdf':pdf,'page':page,'cropAt1000':crop,'width':width,'height':height,'rotate':rotate,'pdfSha256':hashlib.sha256(Path(pdf).read_bytes()).hexdigest(),'pngSha256':hashlib.sha256(data).hexdigest()})
assets_path.write_text(json.dumps(assets,separators=(',',':')),encoding='utf-8')
Path('docs/code-chart-render-manifest.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
print(f'Rendered {len(records)} original-PDF charts at 4x preview resolution.')
