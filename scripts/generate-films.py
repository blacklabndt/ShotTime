"""Build assets/techniques.json (geometry only) from the historical per-film baseline.

scripts/original-techniques.json keeps the pre-1.21 per-film Ci·s values for comparison tests.
Exposure is now calculated in assets/calculator.js from geometry, a shared Ir-192 steel
half-value thickness and each film's reference shot.
"""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
current=json.loads((root/'assets/techniques.json').read_text(encoding='utf-8'))
data=json.loads((root/'scripts/original-techniques.json').read_text(encoding='utf-8'))
for technique in data['techniques']: technique.pop('exposures',None)
data['films']=current['films']
(root/'assets/techniques.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
