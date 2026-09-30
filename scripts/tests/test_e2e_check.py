"""Tests for ``scripts/e2e_check.py``: comparison/invariant helpers and full runs against a live API."""

from __future__ import annotations

import copy
import json
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

import e2e_check as e2e

ARTIFACTS = e2e.DEFAULT_ARTIFACTS
FIXTURES = ARTIFACTS / "fixtures.json"
SCHEMA = ARTIFACTS / "schema.json"

pytestmark = pytest.mark.skipif(not FIXTURES.is_file(), reason="ml/artifacts/fixtures.json not built")


@pytest.fixture(scope="module")
def fixtures() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURES.read_text(encoding="utf-8"))
    return data


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(SCHEMA.read_text(encoding="utf-8"))
    return data


@pytest.fixture()
def expected(fixtures: dict[str, Any]) -> dict[str, Any]:
    case = next(c for c in fixtures["cases"] if not c["id"].startswith("out-of-range"))
    body: dict[str, Any] = copy.deepcopy(case["expected"])
    return body


# ------------------------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------------------------


def test_band_follows_the_first_upper_bound(schema: dict[str, Any]) -> None:
    bands = schema["risk_bands"]
    assert e2e.band_for(0.0, bands) == "low"
    assert e2e.band_for(0.25, bands) == "moderate"  # bounds are exclusive
    assert e2e.band_for(0.749, bands) == "high"
    assert e2e.band_for(1.0, bands) == bands[-1]["id"]


def test_percentiles_interpolate_linearly() -> None:
    stats = e2e._percentiles([5.0, 1.0, 3.0, 2.0, 4.0])
    assert stats["n"] == 5
    assert stats["p50"] == pytest.approx(3.0)
    assert stats["p95"] == pytest.approx(4.8)
    assert stats["max"] == 5.0
    assert e2e._percentiles([]) == {}


def test_out_of_range_detection_uses_schema_bounds(schema: dict[str, Any]) -> None:
    age = next(f for f in schema["features"] if f["key"] == "Age")
    assert e2e.outside_training_range({"Age": age["max"] + 1, "Sex": "Male"}, schema) == {"Age"}
    assert e2e.outside_training_range({"Age": age["min"], "Age2": 1e9}, schema) == set()


def test_identical_predictions_compare_clean(expected: dict[str, Any], fixtures: dict[str, Any]) -> None:
    rec = e2e.Recorder()
    e2e.compare_predictions(expected, copy.deepcopy(expected), e2e.DEFAULT_TOLERANCE, rec, "self")
    assert rec.failures == []
    assert set(rec.max_delta.values()) == {0.0}


def test_probability_drift_beyond_tolerance_is_reported(expected: dict[str, Any]) -> None:
    drifted = copy.deepcopy(expected)
    drifted["predictions"]["LAD"]["probability"] += 1e-4
    rec = e2e.Recorder()
    e2e.compare_predictions(drifted, expected, e2e.DEFAULT_TOLERANCE, rec, "case")
    assert any("case/LAD: probability" in f for f in rec.failures)
    assert rec.max_delta["probability"] == pytest.approx(1e-4)


def test_shap_drift_and_missing_rows_are_reported(expected: dict[str, Any]) -> None:
    drifted = copy.deepcopy(expected)
    rows = drifted["explanations"]["RCA"]["contributions"]
    rows[0]["shap"] += 1e-3
    removed = rows.pop()
    rec = e2e.Recorder()
    e2e.compare_predictions(drifted, expected, e2e.DEFAULT_TOLERANCE, rec, "case")
    assert any(f"case/RCA/{rows[0]['feature']}: shap" in f for f in rec.failures)
    assert any("contribution rows differ" in f and removed["feature"] in f for f in rec.failures)


def test_reference_bodies_satisfy_every_invariant(fixtures: dict[str, Any], schema: dict[str, Any]) -> None:
    keys = [f["key"] for f in schema["features"]]
    for case in fixtures["cases"]:
        rec = e2e.Recorder()
        e2e.check_invariants(case["expected"], rec, case["id"], risk_bands=schema["risk_bands"], feature_keys=keys)
        assert rec.failures == [], case["id"]


def test_broken_additivity_label_and_leakage_are_caught(expected: dict[str, Any], schema: dict[str, Any]) -> None:
    body = copy.deepcopy(expected)
    body["explanations"]["CAD"]["contributions"][0]["shap"] += 0.01
    body["predictions"]["LCX"]["label"] = 1 - body["predictions"]["LCX"]["label"]
    body["explanations"]["LAD"]["contributions"].append({"feature": "Cath", "value": 1, "shap": 0.0})
    body["summary"]["highest_risk_vessel"] = "nowhere"
    rec = e2e.Recorder()
    keys = [f["key"] for f in schema["features"]]
    e2e.check_invariants(body, rec, "bad", risk_bands=schema["risk_bands"], feature_keys=keys)
    joined = "\n".join(rec.failures)
    assert "bad/CAD: base + sum(shap) - output" in joined
    assert "bad/LCX: label" in joined
    assert "outcome columns used as inputs ['Cath']" in joined
    assert "highest_risk_vessel" in joined


def test_jittered_patients_stay_in_range_and_on_grid(schema: dict[str, Any], fixtures: dict[str, Any]) -> None:
    import random

    rng = random.Random(7)
    base = fixtures["cases"][0]["features"]
    for _ in range(50):
        patient = e2e._jittered_patient(base, schema, rng)
        assert e2e.outside_training_range(patient, schema) == set()
        assert set(patient) == set(base)


# ------------------------------------------------------------------------------------------------
# Full runs against the real API served by uvicorn in a background thread
# ------------------------------------------------------------------------------------------------


def _real_api_unavailable() -> str | None:
    try:
        import uvicorn  # noqa: F401
        from app.predictors.loader import REQUIRED_ARTIFACTS, ml_package_available
    except ImportError as exc:
        return f"backend dependencies missing ({exc})"
    missing = [name for name in REQUIRED_ARTIFACTS if not (ARTIFACTS / name).is_file()]
    if missing:
        return f"ML artifacts missing: {missing}"
    if not ml_package_available():
        return "cardiotwin_ml is not importable"
    return None


@pytest.fixture(scope="module")
def live_api(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    reason = _real_api_unavailable()
    if reason:
        pytest.skip(reason)
    import uvicorn
    from app.config import Settings
    from app.main import create_app

    settings = Settings(
        artifacts_dir=ARTIFACTS,
        predictor="real",
        serve_frontend=False,
        warm_cache=False,
        model_card_path=tmp_path_factory.mktemp("card") / "absent.md",
        log_level="WARNING",
        log_format="text",
    )
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 120
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            pytest.fail("the API did not start")
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=30)
        sock.close()


def test_real_api_passes_every_check(live_api: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    report_path = tmp_path / "report.json"
    code = e2e.main(["--url", live_api, "--latency-n", "4", "--seed", "3", "--json-report", str(report_path)])
    out = capsys.readouterr().out
    assert code == 0, out
    report = json.loads(report_path.read_text(encoding="utf-8"))
    status = {c["name"]: c["status"] for c in report["checks"]}
    assert status == {
        "health": "PASS",
        "schema": "PASS",
        "leakage": "PASS",
        "fixtures": "PASS",
        "cohort": "PASS",
        "batch": "PASS",
        "frontend": "SKIP",  # serve_frontend=False
        "latency": "INFO",
    }
    cohort = next(c for c in report["checks"] if c["name"] == "cohort")
    assert "portable" in cohort["details"]["references"]
    assert "RESULT: PASS" in out


def test_a_tampered_reference_fails_the_run(live_api: str, tmp_path: Path, fixtures: dict[str, Any]) -> None:
    tampered = copy.deepcopy(fixtures)
    case = next(c for c in tampered["cases"] if not c["id"].startswith("out-of-range"))
    case["expected"]["predictions"]["LAD"]["probability"] += 1e-3
    path = tmp_path / "fixtures.json"
    path.write_text(json.dumps(tampered), encoding="utf-8")
    code = e2e.main(["--url", live_api, "--fixtures", str(path), "--latency-n", "0", "--no-native"])
    assert code == 1


def test_latency_budget_is_enforced(live_api: str) -> None:
    assert e2e.main(["--url", live_api, "--latency-n", "2", "--max-p95-ms", "0.001", "--no-native"]) == 1


def test_unreachable_server_exits_with_2(capsys: pytest.CaptureFixture[str]) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert e2e.main(["--url", f"http://127.0.0.1:{port}", "--latency-n", "0", "--timeout", "2"]) == 2
    assert "unreachable" in capsys.readouterr().err
