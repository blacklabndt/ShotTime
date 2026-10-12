"""Extract original Section IX paths and outlined captions; no raster tracing.
Requires PyMuPDF in build/pdf-tools. Run from the project root.
"""
import base64, hashlib, json, sys
from pathlib import Path
import xml.etree.ElementTree as ET
sys.path.insert(0,'build/pdf-tools')
import pymupdf

source=Path('build/chart-sources/ix-2025-full.pdf')
page=pymupdf.open(source)[72]
assert not page.get_images()
assert 'Rounded Indication Charts' in page.get_text()
ns='http://www.w3.org/2000/svg'
ET.register_namespace('',ns);ET.register_namespace('xlink','http://www.w3.org/1999/xlink')
svg=ET.fromstring(page.get_svg_image(text_as_path=True))
# Exclude the download host's red advertising overlay, separate from the code artwork.
removed=0
for element in list(svg):
 if element.tag=='{'+ns+'}use' and element.get('fill')=='#ff0000' and element.get('fill-opacity')=='.5':
  svg.remove(element);removed+=1
assert removed==87
paths_before=[e.get('d') for e in svg.iter('{'+ns+'}path')]
svg.set('fill','#c7c1bd')
for element in svg.iter():
 for attr in ('fill','stroke'):
  color=element.get(attr)
  if color and color!='none':element.set(attr,'#121212' if color.lower() in ('#ffffff','#fff','white') else '#c7c1bd')
assert paths_before==[e.get('d') for e in svg.iter('{'+ns+'}path')]
assert not list(svg.iter('{'+ns+'}image'))
data=ET.tostring(svg,encoding='utf-8')
Path('assets/code-chart-ix.svg').write_bytes(data)
views=['96 123 438 82','96 237 438 87','96 355 438 102','96 488 438 100']
asset={'href':'data:image/svg+xml;base64,'+base64.b64encode(data).decode(),'width':612,'height':792,'viewBoxes':views,'themed':True,'source':'ASME BPVC.IX-2025, printed page 23; original vector artwork.'}
path=Path('assets/code-chart-images.json');assets=json.loads(path.read_text());assets['hq:QW-191.1.2.2(b)(4)']=asset;path.write_text(json.dumps(assets,separators=(',',':')),encoding='utf-8')
manifest={'sourceUrl':'https://tg.government.bg/docu/dokladi2019/ASME%20BPVC.IX%20%28ASME%20BPVC%20Section%205%29%202025.pdf','pdfPage':73,'printedPage':23,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'svgSha256':hashlib.sha256(data).hexdigest(),'pathCount':len(paths_before),'viewBoxes':views,'drawingPaths':len(page.get_drawings()),'rasterImages':0,'note':'Original paths/transforms retained, text outlined; app colours applied. Separate red download-host advertising overlay excluded.'}
Path('docs/code-chart-ix-vector.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Extracted Section IX original vector paths with all four thickness-band viewports.')
