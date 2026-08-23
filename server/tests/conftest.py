"""Pytest konfiguracija koja radi bez obzira na radni direktorijum.

CI pokreće `pytest` iz server/ foldera, a testovi importuju `server.*`
pakete — zato projekat root mora biti na sys.path.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
