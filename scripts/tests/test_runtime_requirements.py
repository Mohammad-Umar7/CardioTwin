"""Tests for ``scripts/runtime_requirements.py`` (the pinned requirement set installed in the Docker image)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import runtime_requirements as rr


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_parse_keeps_extras_spec_and_marker() -> None:
    req = rr.Requirement.parse("uvicorn[standard] >= 0.30, <1 ; python_version >= '3.11'")
    assert (req.name, req.extras, req.spec, req.marker) == (
        "uvicorn",
        ("standard",),
        ">=0.30,<1",
        "python_version >= '3.11'",
    )
    assert req.render(spec="==0.54.0") == "uvicorn[standard]==0.54.0 ; python_version >= '3.11'"
    assert rr.Requirement.parse("PyYAML==6.0.3").key == "pyyaml"
    assert rr.canonical("pydantic_core") == rr.canonical("Pydantic.Core") == "pydantic-core"
    with pytest.raises(rr.RequirementsError):
        rr.Requirement.parse("==1.0")


def test_requirement_lines_skip_comments_and_options() -> None:
    lines = ("# header", "-c constraints.txt", "-r ../ml/requirements.txt", "", "fastapi>=0.115  # web")
    text = "\n".join((*lines, "  --index-url x", "numpy==2.4.6", ""))
    assert list(rr.requirement_lines(text)) == ["fastapi>=0.115", "numpy==2.4.6"]


def test_pins_are_read_from_exact_specs_only_and_conflicts_fail(tmp_path: Path) -> None:
    a = _write(tmp_path / "a.txt", "numpy==2.4.6\nPyYAML==6.0.3\nfastapi>=0.1\n")
    b = _write(tmp_path / "b.txt", "pyyaml==6.0.3\nuvicorn==0.54.0\n")
    assert rr.read_pins([a, b]) == {"numpy": "2.4.6", "pyyaml": "6.0.3", "uvicorn": "0.54.0"}
    c = _write(tmp_path / "c.txt", "numpy==2.3.0\n")
    with pytest.raises(rr.RequirementsError, match=re.escape("numpy is pinned to 2.4.6")):
        rr.read_pins([a, c])


def test_pinning_swaps_xgboost_and_refuses_unpinned_packages() -> None:
    requirements = [
        rr.Requirement.parse(s) for s in ("xgboost>=3.0,<4", "uvicorn[standard]>=0.30", "numpy>=2.0", "numpy")
    ]
    pins = {"xgboost": "3.2.0", "uvicorn": "0.54.0", "numpy": "2.4.6"}
    assert rr.pin_requirements(requirements, pins) == ["xgboost==3.2.0", "uvicorn[standard]==0.54.0", "numpy==2.4.6"]
    assert rr.pin_requirements(requirements, pins, xgboost_cpu=True)[0] == "xgboost-cpu==3.2.0"
    loose = [rr.Requirement.parse("pandas>=2.2")]
    with pytest.raises(rr.RequirementsError, match=re.escape("no exact pin for pandas>=2.2")):
        rr.pin_requirements(loose, pins)
    assert rr.pin_requirements(loose, pins, allow_unpinned=True) == ["pandas>=2.2"]


def test_repository_runtime_set_is_fully_pinned() -> None:
    """The real inputs: every API and ML runtime dependency has an exact pin (what the Docker build relies on)."""
    lines = rr.runtime_requirements(xgboost_cpu=True)
    names = [rr.Requirement.parse(line).key for line in lines]
    assert all("==" in line for line in lines), lines
    for required in ("fastapi", "uvicorn", "pydantic", "numpy", "scikit-learn", "xgboost-cpu", "joblib"):
        assert required in names
    assert "xgboost" not in names
    assert not {"pytest", "shap"} & set(names), "test-only tools must not reach the runtime image"
    assert rr.Requirement.parse(lines[names.index("uvicorn")]).extras == ("standard",)


def test_cli_writes_the_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "runtime.txt"
    assert rr.main(["--xgboost-cpu", "-o", str(out)]) == 0
    assert capsys.readouterr().out == ""
    assert "xgboost-cpu==" in out.read_text(encoding="utf-8")
    assert rr.main([]) == 0
    assert "xgboost==" in capsys.readouterr().out
