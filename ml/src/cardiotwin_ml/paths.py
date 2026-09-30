"""Canonical filesystem locations used by the pipeline.

Everything is resolved relative to the repository root so the pipeline runs identically from any
working directory. Set ``CARDIOTWIN_ROOT`` to point the package at a different checkout.
"""

from __future__ import annotations

import os
from pathlib import Path


def _default_root() -> Path:
    # ml/src/cardiotwin_ml/paths.py -> parents[3] is the repository root.
    return Path(__file__).resolve().parents[3]


REPO_ROOT: Path = Path(os.environ.get("CARDIOTWIN_ROOT", _default_root())).resolve()
ML_DIR: Path = REPO_ROOT / "ml"
CONFIG_DIR: Path = ML_DIR / "configs"
ARTIFACTS_DIR: Path = ML_DIR / "artifacts"
REPORTS_DIR: Path = ML_DIR / "reports"
DATA_DIR: Path = REPO_ROOT / "data"
RAW_DATA_DIR: Path = DATA_DIR / "raw"
FIGURES_DIR: Path = REPO_ROOT / "docs" / "figures"
FRONTEND_MODEL_DIR: Path = REPO_ROOT / "frontend" / "public" / "model"
MODEL_CARD_PATH: Path = REPO_ROOT / "docs" / "MODEL_CARD.md"
