"""Reruns must be bit-identical (seeds everywhere, order-independent parallelism)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from cardiotwin_ml import train


def _strip(obj: dict) -> dict:
    obj = dict(obj)
    obj.pop("generated_at", None)
    return obj


def test_dev_cv_is_deterministic(tmp_path: Path) -> None:
    """Two fast development-set runs (ablations + nested CV + ensemble fitting) give identical output."""
    a = train.run(fast=True, artifacts_dir=tmp_path / "a", figures_dir=None, reports_dir=None, frontend_dir=None, dev_only=True)
    b = train.run(fast=True, artifacts_dir=tmp_path / "b", figures_dir=None, reports_dir=None, frontend_dir=None, dev_only=True)
    ja = (tmp_path / "a" / "dev_summary.json").read_text(encoding="utf-8")
    jb = (tmp_path / "b" / "dev_summary.json").read_text(encoding="utf-8")
    assert ja == jb
    assert a["targets"].keys() == b["targets"].keys()


@pytest.mark.skipif(os.environ.get("CARDIOTWIN_SLOW") != "1", reason="set CARDIOTWIN_SLOW=1 for the end-to-end rerun check")
def test_full_fast_pipeline_is_deterministic(tmp_path: Path) -> None:
    for name in ("a", "b"):
        train.run(fast=True, artifacts_dir=tmp_path / name, figures_dir=None, reports_dir=None, frontend_dir=None)
    for fname in ("schema.json", "model.json", "cohort.json", "fixtures.json"):
        assert (tmp_path / "a" / fname).read_bytes() == (tmp_path / "b" / fname).read_bytes(), fname
    ma = json.loads((tmp_path / "a" / "metrics.json").read_text(encoding="utf-8"))
    mb = json.loads((tmp_path / "b" / "metrics.json").read_text(encoding="utf-8"))
    assert _strip(ma) == _strip(mb)
