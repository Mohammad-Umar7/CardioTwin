"""Make ``scripts/`` (the tools under test) and ``backend/`` (the API they drive) importable."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
for path in (REPO_ROOT / "scripts", REPO_ROOT / "backend"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
