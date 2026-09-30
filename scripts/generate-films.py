"""Build assets/techniques.json (geometry only) from the historical per-film baseline plus added sizes.

scripts/original-techniques.json keeps the pre-1.21 per-film Ci·s values for comparison tests.
Exposure is calculated in assets/calculator.js from geometry, a shared Ir-192 steel
half-value thickness and each film's reference shot.

Added in 1.21.0: Sch 10 on every size and NPS 18, 20 and 24. Walls are ASME B36.10M
(inches; cross-checked against the millimetre tables at wermac.org/pipes). SFD follows the
chart rule: 12 in for 1-inch pipe, otherwise OD + 0.125 in. Original rows whose walls were
truncated (e.g. 0.437) are corrected to B36.10M (0.438). 14" and 16" XXH (1.000 in) are the
owner's entries; B36.10M defines no XXS above 12".
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
OD = {1: 1.315, 2: 2.375, 3: 3.5, 4: 4.5, 5: 5.563, 6: 6.625, 8: 8.625, 10: 10.75, 12: 12.75,
      14: 14.0, 16: 16.0, 18: 18.0, 20: 20.0, 24: 24.0}
SCH10 = {1: 0.109, 2: 0.109, 3: 0.120, 4: 0.120, 5: 0.134, 6: 0.134, 8: 0.148, 10: 0.165,
         12: 0.180, 14: 0.250, 16: 0.250, 18: 0.250, 20: 0.250, 24: 0.250}
B3610_CORRECTIONS = {0.437: 0.438, 0.593: 0.594, 0.687: 0.688, 0.718: 0.719, 0.843: 0.844,
                     0.937: 0.938, 1.093: 1.094, 1.218: 1.219, 1.437: 1.438, 1.593: 1.594}
NEW_SIZES = {
    18: [('STD', 0.375), ('XH', 0.500), ('40', 0.562), ('60', 0.750), ('80', 0.938),
         ('100', 1.156), ('120', 1.375), ('140', 1.562), ('160', 1.781)],
    20: [('STD', 0.375), ('XH', 0.500), ('40', 0.594), ('60', 0.812), ('80', 1.031),
         ('100', 1.281), ('120', 1.500), ('140', 1.750), ('160', 1.969)],
    24: [('STD', 0.375), ('XH', 0.500), ('40', 0.688), ('60', 0.969), ('80', 1.219),
         ('100', 1.531), ('120', 1.812), ('140', 2.062), ('160', 2.344)],
}


def row(size, schedule, wall):
    return {'size': size, 'schedule': schedule, 'wall': wall,
            'sfd': 12 if size == 1 else round(OD[size] + 0.125, 3),
            'group': 'small' if size <= 3 else 'large'}


current = json.loads((root / 'assets/techniques.json').read_text(encoding='utf-8'))
data = json.loads((root / 'scripts/original-techniques.json').read_text(encoding='utf-8'))
original = []
for technique in data['techniques']:
    technique.pop('exposures', None)
    technique.pop('steelMm', None)
    technique['wall'] = B3610_CORRECTIONS.get(technique['wall'], technique['wall'])
    original.append(technique)
techniques = []
for size in sorted(OD):
    techniques.append(row(size, '10', SCH10[size]))
    techniques += [t for t in original if t['size'] == size]
    techniques += [row(size, schedule, wall) for schedule, wall in NEW_SIZES.get(size, [])]
data['techniques'] = techniques
data['groups'] = current['groups']
data['films'] = current['films']
(root / 'assets/techniques.json').write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
