"""Make the pipeline modules importable (they are scripts, not an installed package)."""
from __future__ import annotations

import sys
from pathlib import Path

ANATOMY = Path(__file__).resolve().parents[1]
for sub in ("scripts", "blender"):
    path = str(ANATOMY / sub)
    if path not in sys.path:
        sys.path.insert(0, path)
