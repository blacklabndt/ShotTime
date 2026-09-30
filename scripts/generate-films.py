"""Restore original model data; density scaling lives in calculator.js."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
(root/'assets/techniques.json').write_bytes((root/'scripts/original-techniques.json').read_bytes())
