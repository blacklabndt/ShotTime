"""Replace the 17 PDF-rendered charts with the original scalable paths.
Uses the reviewed crop manifest; requires PyMuPDF in build/pdf-tools.
No screenshot tracing or geometry simplification.
"""
import base64, copy, hashlib, json, sys
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0,'build/pdf-tools')
import pymupdf

ns='http://www.w3.org/2000/svg'
ET.register_namespace('',ns);ET.register_namespace('xlink','http://www.w3.org/1999/xlink')
manifest=json.loads(Path('docs/code-chart-render-manifest.json').read_text())
assets_path=Path('assets/code-chart-images.json');assets=json.loads(assets_path.read_text())
destination=Path('assets/code-chart-vectors');destination.mkdir(exist_ok=True)
records=[]
for record in manifest:
 source=Path(record['pdf']);assert hashlib.sha256(source.read_bytes()).hexdigest()==record['pdfSha256']
 document=pymupdf.open(source);page=document[record['page']-1];assert not page.get_images()
 original=ET.fromstring(page.get_svg_image(text_as_path=True));svg=copy.deepcopy(original)
 geometry=lambda node:[(el.tag,el.get('d'),el.get('transform')) for el in node.iter()]
 before=geometry(svg)
 svg.set('fill','#c7c1bd')
 for el in svg.iter():
  for attr in ('fill','stroke'):
   color=el.get(attr)
   if color and color!='none':el.set(attr,'#121212' if color.lower() in ('#ffffff','#fff','white') else '#c7c1bd')
 assert geometry(svg)==before
 factor=max(page.rect.width,page.rect.height)/1000
 x,y,w,h=[round(v*factor,6) for v in record['cropAt1000']]
 svg.set('viewBox',f'{x} {y} {w} {h}');svg.set('width',str(w));svg.set('height',str(h));svg.set('overflow','hidden')
 width,height=(h,w) if record['rotate'] else (w,h)
 wrapper=ET.Element('{'+ns+'}svg',{'width':str(width),'height':str(height),'viewBox':f'0 0 {width} {height}'})
 if record['rotate']:
  group=ET.SubElement(wrapper,'{'+ns+'}g',{'transform':f'translate({h} 0) rotate(90)'});group.append(svg)
 else:wrapper.append(svg)
 assert not list(wrapper.iter('{'+ns+'}image'))
 data=ET.tostring(wrapper,encoding='utf-8')
 name=record['figure'].replace(' ','-').replace(')','')+'.svg';(destination/name).write_bytes(data)
 old=assets['hq:'+record['figure']]
 assets['hq:'+record['figure']]={'href':'data:image/svg+xml;base64,'+base64.b64encode(data).decode(),'width':width,'height':height,'viewBox':f'0 0 {width} {height}','themed':True,'source':old['source'].replace('rendered from the original PDF','original vector artwork')}
 records.append({**record,'vectorFile':str(destination/name),'vectorWidth':width,'vectorHeight':height,'svgSha256':hashlib.sha256(data).hexdigest(),'drawingPaths':len(page.get_drawings()),'rasterImages':0,'geometryPreserved':True})
assets_path.write_text(json.dumps(assets,separators=(',',':')),encoding='utf-8')
Path('docs/code-chart-vector-manifest.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
print(f'Extracted {len(records)} original vector figures with preserved path data and transforms.')
