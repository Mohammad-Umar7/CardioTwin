#!/usr/bin/env python3
"""End-to-end check of a running CardioTwin API.

Talks to a live server over HTTP (standard library only) and verifies the whole serving path against
the ML package's reference artifacts:

* ``health``        status, real predictor, model version = ``fixtures.json`` version, target order, disclaimer
* ``schema``        no LAD/LCX/RCA/Cath inputs, feature count, served schema = ``ml/artifacts/schema.json``,
                    LAD/LCX/RCA <-> 3D anatomy manifest correspondence (CONTRACTS.md section 6)
* ``leakage``       every outcome column is rejected as an input (422 ``leakage_feature``)
* ``fixtures``      every case in ``fixtures.json`` reproduced by the server (server = native), within the
                    fixture tolerances; cases outside the training range must be rejected under the
                    default ``reject`` policy (or predicted identically under ``warn``)
* ``cohort``        every demo patient: invariants, ``/cohort/{id}/prediction`` = ``/predict``, agreement flags,
                    and server = portable ``model.json`` reference (the browser engine's spec) = native model
                    (when ``cardiotwin_ml`` and its dependencies are importable)
* ``batch``         ``/predict/batch`` = single predictions, in request order
* ``frontend``      when the server serves the SPA: index, model/anatomy assets, JSON 404 for unknown API paths
* ``latency``       client and server (``X-Response-Time-ms``) p50/p95/p99 for cache misses and hits

Exit status: 0 all checks passed, 1 at least one check failed, 2 the server could not be reached.

    python scripts/e2e_check.py                                  # http://127.0.0.1:8000
    python scripts/e2e_check.py --url http://127.0.0.1:8010 --wait 120 --json-report e2e.json
"""

from __future__ import annotations

import argparse
import http.client
import itertools
import json
import math
import os
import random
import socket
import statistics
import sys
import time
import urllib.parse
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "http://127.0.0.1:8000"
DEFAULT_ARTIFACTS = REPO_ROOT / "ml" / "artifacts"
DEFAULT_MANIFEST = REPO_ROOT / "frontend" / "public" / "anatomy" / "manifest.json"
ML_SRC = REPO_ROOT / "ml" / "src"

TARGETS: tuple[str, ...] = ("CAD", "LAD", "LCX", "RCA")
VESSELS: tuple[str, ...] = ("LAD", "LCX", "RCA")
LEAKAGE_KEYS: tuple[str, ...] = ("LAD", "LCX", "RCA", "Cath")

#: Tolerances used when ``fixtures.json`` does not state its own (CONTRACTS.md section 1).
DEFAULT_TOLERANCE: dict[str, float] = {"probability": 1e-6, "logit": 1e-6, "base_value": 1e-6, "shap": 1e-5}
#: Internal-consistency tolerance (additivity, summary sums); the model asserts 1e-6 itself.
INVARIANT_TOL = 1e-6
#: Two responses of the same server for the same input must be bit-identical up to float noise.
SAME_SERVER_TOL = 1e-12
BATCH_CHUNK = 64
MAX_REPORTED_FAILURES = 12

PASS, FAIL, SKIP, INFO = "PASS", "FAIL", "SKIP", "INFO"


# ------------------------------------------------------------------------------------------------
# HTTP
# ------------------------------------------------------------------------------------------------


class ServerUnreachable(RuntimeError):
    """The API did not answer (connection refused, DNS, timeout)."""


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    elapsed_ms: float

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "")

    @property
    def server_ms(self) -> float | None:
        raw = self.headers.get("x-response-time-ms")
        try:
            return float(raw) if raw is not None else None
        except ValueError:
            return None

    @property
    def cache(self) -> str | None:
        return self.headers.get("x-cache")


class HttpClient:
    """Minimal keep-alive JSON client (``http.client``) so latency numbers exclude TCP setup."""

    def __init__(self, base_url: str, timeout: float) -> None:
        parts = urllib.parse.urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError(f"--url must be an http(s) URL, got {base_url!r}")
        self.base_url = base_url.rstrip("/")
        self._https = parts.scheme == "https"
        self._host = parts.hostname
        self._port = parts.port or (443 if self._https else 80)
        self._prefix = parts.path.rstrip("/")
        self._timeout = timeout
        self._conn: http.client.HTTPConnection | None = None

    def _connection(self) -> http.client.HTTPConnection:
        if self._conn is None:
            cls = http.client.HTTPSConnection if self._https else http.client.HTTPConnection
            self._conn = cls(self._host, self._port, timeout=self._timeout)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def request(self, method: str, path: str, payload: Any = None) -> HttpResponse:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json", "User-Agent": "cardiotwin-e2e-check"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        for attempt in (1, 2):  # one transparent retry when a kept-alive socket was closed by the server
            conn = self._connection()
            started = time.perf_counter()
            try:
                conn.request(method, self._prefix + path, body=body, headers=headers)
                raw = conn.getresponse()
                data = raw.read()
            except (
                http.client.RemoteDisconnected,
                ConnectionResetError,
                BrokenPipeError,
                http.client.CannotSendRequest,
            ) as exc:
                self.close()
                if attempt == 2:
                    raise ServerUnreachable(f"{method} {self.base_url}{path}: connection dropped ({exc!r})") from exc
                continue
            except (ConnectionRefusedError, socket.gaierror, TimeoutError, OSError) as exc:
                self.close()
                raise ServerUnreachable(f"{method} {self.base_url}{path}: {exc}") from exc
            elapsed = (time.perf_counter() - started) * 1000.0
            return HttpResponse(raw.status, {k.lower(): v for k, v in raw.getheaders()}, data, elapsed)
        raise AssertionError("unreachable")

    def get(self, path: str) -> HttpResponse:
        return self.request("GET", path)

    def post(self, path: str, payload: Any) -> HttpResponse:
        return self.request("POST", path, payload)


# ------------------------------------------------------------------------------------------------
# Results
# ------------------------------------------------------------------------------------------------


@dataclass
class CheckResult:
    name: str
    status: str
    summary: str
    failures: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def failed(self) -> bool:
        return self.status == FAIL


class Recorder:
    """Collects failures for one check, keeping max deltas for the summary line."""

    def __init__(self) -> None:
        self.failures: list[str] = []
        self.max_delta: dict[str, float] = {}

    def fail(self, message: str) -> None:
        self.failures.append(message)

    def delta(self, kind: str, value: float) -> None:
        if math.isfinite(value):
            self.max_delta[kind] = max(self.max_delta.get(kind, 0.0), value)
        else:
            self.max_delta[kind] = math.inf

    def result(self, name: str, summary: str, details: dict[str, Any] | None = None) -> CheckResult:
        info = dict(details or {})
        if self.max_delta:
            info["max_abs_delta"] = dict(self.max_delta)
        return CheckResult(name, FAIL if self.failures else PASS, summary, self.failures, info)


def fmt_delta(value: float | None) -> str:
    if value is None:
        return "n/a"
    return "0" if value == 0 else f"{value:.1e}"


# ------------------------------------------------------------------------------------------------
# Prediction comparison and invariants
# ------------------------------------------------------------------------------------------------


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _close(a: Any, b: Any, tol: float) -> bool:
    return _is_number(a) and _is_number(b) and abs(float(a) - float(b)) <= tol


def compare_predictions(
    got: Mapping[str, Any],
    want: Mapping[str, Any],
    tol: Mapping[str, float],
    rec: Recorder,
    where: str,
    targets: Sequence[str] = TARGETS,
) -> None:
    """Record every difference between two contract §3.2 bodies (``engine`` is ignored)."""
    if sorted(got.get("imputed", [])) != sorted(want.get("imputed", [])):
        rec.fail(f"{where}: imputed {sorted(got.get('imputed', []))} != {sorted(want.get('imputed', []))}")
    if got.get("model_version") != want.get("model_version"):
        rec.fail(f"{where}: model_version {got.get('model_version')!r} != {want.get('model_version')!r}")
    for target in targets:
        g, w = got["predictions"].get(target), want["predictions"].get(target)
        if g is None or w is None:
            rec.fail(f"{where}: target {target} missing ({'server' if g is None else 'reference'})")
            continue
        for key, kind in (("probability", "probability"), ("logit", "logit"), ("threshold", "probability")):
            d = abs(float(g[key]) - float(w[key]))
            rec.delta(kind if key != "threshold" else "threshold", d)
            if not d <= tol[kind]:
                rec.fail(f"{where}/{target}: {key} {g[key]!r} vs {w[key]!r} (|d|={d:.2e} > {tol[kind]:.0e})")
        for key in ("label", "risk_band"):
            if g[key] != w[key]:
                rec.fail(f"{where}/{target}: {key} {g[key]!r} != {w[key]!r}")
        ge, we = got["explanations"][target], want["explanations"][target]
        if ge.get("space") != we.get("space"):
            rec.fail(f"{where}/{target}: explanation space {ge.get('space')!r} != {we.get('space')!r}")
        for key, kind in (
            ("base_value", "base_value"),
            ("output_value", "logit"),
            ("calibrated_base_value", "logit"),
            ("calibrated_output_value", "logit"),
        ):
            if key not in ge and key not in we:
                continue
            if key not in ge or key not in we:
                rec.fail(f"{where}/{target}: {key} present on one side only")
                continue
            d = abs(float(ge[key]) - float(we[key]))
            rec.delta("base_value" if "base" in key else "logit", d)
            if not d <= tol[kind]:
                rec.fail(f"{where}/{target}: {key} {ge[key]!r} vs {we[key]!r} (|d|={d:.2e})")
        g_rows = {c["feature"]: c for c in ge["contributions"]}
        w_rows = {c["feature"]: c for c in we["contributions"]}
        if set(g_rows) != set(w_rows):
            extra, missing = sorted(set(g_rows) - set(w_rows)), sorted(set(w_rows) - set(g_rows))
            rec.fail(f"{where}/{target}: contribution rows differ (extra {extra}, missing {missing})")
        for feature in sorted(set(g_rows) & set(w_rows)):
            gc, wc = g_rows[feature], w_rows[feature]
            for key in ("shap", "shap_calibrated"):
                if key not in gc and key not in wc:
                    continue
                if key not in gc or key not in wc:
                    rec.fail(f"{where}/{target}/{feature}: {key} present on one side only")
                    continue
                d = abs(float(gc[key]) - float(wc[key]))
                rec.delta("shap", d)
                if not d <= tol["shap"]:
                    rec.fail(f"{where}/{target}/{feature}: {key} {gc[key]!r} vs {wc[key]!r} (|d|={d:.2e})")
            gv, wv = gc.get("value"), wc.get("value")
            same_value = gv == wv or (
                _is_number(gv) and _is_number(wv) and math.isclose(gv, wv, rel_tol=1e-12, abs_tol=1e-12)
            )
            if not same_value:
                rec.fail(f"{where}/{target}/{feature}: echoed value {gv!r} != {wv!r}")
    gs, ws = got.get("summary", {}), want.get("summary", {})
    if gs.get("highest_risk_vessel") != ws.get("highest_risk_vessel"):
        rec.fail(f"{where}: highest_risk_vessel {gs.get('highest_risk_vessel')!r} != {ws.get('highest_risk_vessel')!r}")
    if not _close(gs.get("expected_diseased_vessels"), ws.get("expected_diseased_vessels"), 3 * tol["probability"]):
        got_sum, want_sum = gs.get("expected_diseased_vessels"), ws.get("expected_diseased_vessels")
        rec.fail(f"{where}: expected_diseased_vessels {got_sum!r} vs {want_sum!r}")


def band_for(probability: float, bands: Sequence[Mapping[str, Any]]) -> str | None:
    """Risk band = first band whose ``max`` exceeds p, else the last (CONTRACTS.md section 2)."""
    for band in bands:
        if probability < float(band["max"]):
            return str(band["id"])
    return str(bands[-1]["id"]) if bands else None


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def check_invariants(
    body: Mapping[str, Any],
    rec: Recorder,
    where: str,
    *,
    risk_bands: Sequence[Mapping[str, Any]] = (),
    feature_keys: Iterable[str] | None = None,
) -> None:
    """Internal consistency of one prediction: labels, bands, SHAP additivity, summary."""
    if body.get("engine") != "server":
        rec.fail(f"{where}: engine {body.get('engine')!r} != 'server'")
    predictions, explanations = body.get("predictions", {}), body.get("explanations", {})
    if list(predictions)[: len(TARGETS)] != list(TARGETS):
        rec.fail(f"{where}: target order {list(predictions)} does not start with {list(TARGETS)}")
    known = set(feature_keys) if feature_keys is not None else None
    for target, p in predictions.items():
        prob = float(p["probability"])
        if not 0.0 <= prob <= 1.0:
            rec.fail(f"{where}/{target}: probability {prob} outside [0, 1]")
        if p["label"] != int(prob >= float(p["threshold"])):
            rec.fail(f"{where}/{target}: label {p['label']} inconsistent with p={prob:.6f} >= t={p['threshold']:.6f}")
        if risk_bands and p["risk_band"] != band_for(prob, risk_bands):
            rec.fail(
                f"{where}/{target}: risk_band {p['risk_band']!r} != {band_for(prob, risk_bands)!r} for p={prob:.4f}"
            )
        e = explanations.get(target)
        if e is None:
            rec.fail(f"{where}/{target}: no explanation")
            continue
        rows = e["contributions"]
        additivity = abs(float(e["base_value"]) + math.fsum(float(c["shap"]) for c in rows) - float(e["output_value"]))
        rec.delta("additivity", additivity)
        if additivity > INVARIANT_TOL:
            rec.fail(f"{where}/{target}: base + sum(shap) - output = {additivity:.2e}")
        if abs(float(e["output_value"]) - float(p["logit"])) > 1e-9:
            rec.fail(f"{where}/{target}: explanation output {e['output_value']} != logit {p['logit']}")
        if (
            "calibrated_output_value" in e
            and "calibrated_base_value" in e
            and all("shap_calibrated" in c for c in rows)
        ):
            cal = abs(
                float(e["calibrated_base_value"])
                + math.fsum(float(c["shap_calibrated"]) for c in rows)
                - float(e["calibrated_output_value"])
            )
            rec.delta("additivity", cal)
            if cal > INVARIANT_TOL:
                rec.fail(f"{where}/{target}: calibrated additivity off by {cal:.2e}")
            if abs(sigmoid(float(e["calibrated_output_value"])) - prob) > 1e-9:
                rec.fail(f"{where}/{target}: sigmoid(calibrated_output_value) != probability")
        magnitudes = [abs(float(c["shap"])) for c in rows]
        if any(a + 1e-12 < b for a, b in itertools.pairwise(magnitudes)):
            rec.fail(f"{where}/{target}: contributions not sorted by |shap|")
        if known is not None:
            unknown = {c["feature"] for c in rows} - known
            if unknown:
                rec.fail(f"{where}/{target}: contributions for unknown features {sorted(unknown)}")
            leaked = {c["feature"] for c in rows} & set(LEAKAGE_KEYS)
            if leaked:
                rec.fail(f"{where}/{target}: outcome columns used as inputs {sorted(leaked)}")
    vessels = {v: float(predictions[v]["probability"]) for v in VESSELS if v in predictions}
    summary = body.get("summary", {})
    if vessels:
        if abs(float(summary.get("expected_diseased_vessels", math.nan)) - math.fsum(vessels.values())) > 1e-9:
            rec.fail(f"{where}: expected_diseased_vessels != sum of LAD/LCX/RCA probabilities")
        if summary.get("highest_risk_vessel") != max(vessels, key=vessels.__getitem__):
            rec.fail(f"{where}: highest_risk_vessel {summary.get('highest_risk_vessel')!r} is not the argmax vessel")


def outside_training_range(features: Mapping[str, Any], schema: Mapping[str, Any]) -> set[str]:
    """Numeric inputs outside the schema ``min``/``max`` (rejected by the default ``reject`` policy)."""
    specs = {f["key"]: f for f in schema["features"]}
    outside: set[str] = set()
    for key, value in features.items():
        spec = specs.get(key)
        if spec is None or spec.get("type") != "numeric" or value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        lo, hi = spec.get("min"), spec.get("max")
        if (lo is not None and number < lo) or (hi is not None and number > hi):
            outside.add(key)
    return outside


# ------------------------------------------------------------------------------------------------
# Reference engines (portable model.json evaluator; native cardiotwin_ml predictor)
# ------------------------------------------------------------------------------------------------


def load_portable(artifacts: Path) -> tuple[Callable[[dict[str, Any]], dict[str, Any]] | None, str]:
    """The stdlib-only reference evaluator of ``model.json`` (the spec the browser engine ports)."""
    model_json = artifacts / "model.json"
    if not model_json.is_file():
        return None, f"{model_json} not found"
    if str(ML_SRC) not in sys.path:
        sys.path.insert(0, str(ML_SRC))
    try:
        from cardiotwin_ml.portable import PortableModel  # stdlib only; importing the package is light
    except Exception as exc:
        return None, f"cardiotwin_ml.portable not importable ({type(exc).__name__}: {exc})"
    model = PortableModel.load(str(model_json))
    return model.predict, "portable model.json evaluator"


def load_native(artifacts: Path) -> tuple[Callable[[dict[str, Any]], dict[str, Any]] | None, str]:
    """The trained Python predictor (needs numpy, scikit-learn, xgboost, joblib)."""
    if str(ML_SRC) not in sys.path:
        sys.path.insert(0, str(ML_SRC))
    try:
        from cardiotwin_ml.inference import CardioTwinPredictor
    except Exception as exc:
        return None, f"cardiotwin_ml.inference not importable ({type(exc).__name__})"
    try:
        predictor = CardioTwinPredictor.load(artifacts)
    except Exception as exc:
        return None, f"native predictor failed to load ({type(exc).__name__}: {exc})"
    return predictor.predict, "native cardiotwin_ml predictor"


# ------------------------------------------------------------------------------------------------
# Checks
# ------------------------------------------------------------------------------------------------


@dataclass
class Context:
    client: HttpClient
    artifacts: Path
    manifest_path: Path
    fixtures: dict[str, Any]
    tolerance: dict[str, float]
    use_native: bool
    allow_fake: bool
    latency_n: int
    seed: int | None
    max_p95_ms: float | None
    health: dict[str, Any] = field(default_factory=dict)
    schema: dict[str, Any] = field(default_factory=dict)
    cohort: list[dict[str, Any]] = field(default_factory=list)
    single: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def feature_keys(self) -> list[str]:
        return [f["key"] for f in self.schema.get("features", [])]

    @property
    def risk_bands(self) -> list[dict[str, Any]]:
        return list(self.schema.get("risk_bands", []))


def check_health(ctx: Context) -> CheckResult:
    rec = Recorder()
    response = ctx.client.get("/api/health")
    if response.status != 200:
        rec.fail(f"GET /api/health -> {response.status}")
        return rec.result("health", f"HTTP {response.status}")
    body = response.json()
    ctx.health = body
    if body.get("status") != "ok":
        rec.fail(f"status {body.get('status')!r}")
    if body.get("predictor") != "real" and not ctx.allow_fake:
        rec.fail(f"predictor {body.get('predictor')!r}: the synthetic dev predictor cannot be checked against fixtures")
    if body.get("model_version") != ctx.fixtures.get("model_version"):
        rec.fail(f"server model {body.get('model_version')!r} != fixtures {ctx.fixtures.get('model_version')!r}")
    if list(body.get("targets", []))[: len(TARGETS)] != list(TARGETS):
        rec.fail(f"targets {body.get('targets')} do not start with {list(TARGETS)}")
    if body.get("engine") != "server":
        rec.fail(f"engine {body.get('engine')!r}")
    disclaimer = str(body.get("disclaimer", ""))
    if "not a substitute" not in disclaimer.lower():
        rec.fail("clinical-safety disclaimer missing from /api/health")
    return rec.result(
        "health",
        f"{body.get('predictor')} predictor, model {body.get('model_version')}, "
        f"{len(body.get('targets', []))} targets, {body.get('n_features')} features, "
        f"warm-up {body.get('cache_warmup')}",
        {"health": {k: body.get(k) for k in ("model_version", "predictor", "targets", "n_features", "cache_warmup")}},
    )


def _served_json(ctx: Context, path: str) -> Any | None:
    response = ctx.client.get(path)
    if response.status == 200 and "json" in response.content_type:
        return response.json()
    return None


def check_schema(ctx: Context) -> CheckResult:
    rec = Recorder()
    response = ctx.client.get("/api/schema")
    if response.status != 200:
        rec.fail(f"GET /api/schema -> {response.status}")
        return rec.result("schema", f"HTTP {response.status}")
    schema = response.json()
    ctx.schema = schema
    keys = ctx.feature_keys
    leaked = sorted(set(keys) & set(LEAKAGE_KEYS))
    if leaked:
        rec.fail(f"outcome columns exposed as inputs: {leaked}")
    if len(keys) != len(set(keys)):
        rec.fail("duplicate feature keys")
    if ctx.health and ctx.health.get("n_features") != len(keys):
        rec.fail(f"/api/health n_features {ctx.health.get('n_features')} != {len(keys)} schema features")
    target_ids = [t["id"] for t in schema.get("targets", [])]
    if target_ids[: len(TARGETS)] != list(TARGETS):
        rec.fail(f"schema targets {target_ids} do not start with {list(TARGETS)}")
    local_path = ctx.artifacts / "schema.json"
    if local_path.is_file():
        local = json.loads(local_path.read_text(encoding="utf-8"))
        if [f["key"] for f in local["features"]] != keys:
            rec.fail("served feature list differs from ml/artifacts/schema.json (server runs other artifacts)")
        local_thresholds = {t["id"]: t.get("threshold") for t in local.get("targets", [])}
        for target in schema.get("targets", []):
            want = local_thresholds.get(target["id"])
            if want is not None and not _close(target.get("threshold"), want, 1e-12):
                rec.fail(f"{target['id']}: served threshold {target.get('threshold')} != artifacts {want}")

    # Model output <-> anatomy correspondence (the 3D view colours schema.targets[].anatomy nodes).
    manifest = _served_json(ctx, "/anatomy/manifest.json") if ctx.health.get("frontend_served") else None
    manifest_source = "served /anatomy/manifest.json"
    if manifest is None and ctx.manifest_path.is_file():
        manifest = json.loads(ctx.manifest_path.read_text(encoding="utf-8"))
        manifest_source = (
            str(ctx.manifest_path.relative_to(REPO_ROOT))
            if ctx.manifest_path.is_relative_to(REPO_ROOT)
            else str(ctx.manifest_path)
        )
    mapping_note = "anatomy manifest not available"
    if manifest is not None:
        structures = {s["node"]: s for s in manifest.get("structures", [])}
        by_target = {t["id"]: t for t in schema.get("targets", [])}
        for vessel in VESSELS:
            nodes = list(by_target.get(vessel, {}).get("anatomy", []))
            if not nodes:
                rec.fail(f"{vessel}: schema target has no anatomy nodes")
                continue
            manifest_nodes = sorted(manifest.get("targets", {}).get(vessel, []))
            if sorted(nodes) != manifest_nodes:
                rec.fail(f"{vessel}: schema anatomy {sorted(nodes)} != manifest targets {manifest_nodes}")
            for node in nodes:
                if node not in structures:
                    rec.fail(f"{vessel}: node {node} missing from the anatomy manifest")
                elif structures[node].get("target") != vessel:
                    rec.fail(f"{vessel}: manifest maps {node} to {structures[node].get('target')!r}")
        mapped = {s["node"]: s.get("target") for s in structures.values() if s.get("target") in VESSELS}
        for node, target in mapped.items():
            if node not in by_target.get(str(target), {}).get("anatomy", []):
                rec.fail(f"manifest node {node} ({target}) is not listed in schema target {target}")
        mapping_note = f"LAD/LCX/RCA <-> anatomy consistent ({manifest_source})"
    return rec.result(
        "schema",
        f"{len(keys)} features, no outcome inputs, {len(target_ids)} targets; {mapping_note}",
        {"n_features": len(keys), "targets": target_ids},
    )


def check_leakage(ctx: Context) -> CheckResult:
    rec = Recorder()
    for key in LEAKAGE_KEYS:
        response = ctx.client.post("/api/predict", {"features": {key: 1}})
        if response.status != 422:
            rec.fail(f"{key}: expected 422, got {response.status}")
            continue
        types = {item.get("type") for item in response.json().get("detail", [])}
        if "leakage_feature" not in types:
            rec.fail(f"{key}: 422 without a leakage_feature error (types {sorted(map(str, types))})")
    return rec.result("leakage", f"{', '.join(LEAKAGE_KEYS)} rejected as inputs (422 leakage_feature)")


def check_fixtures(ctx: Context) -> CheckResult:
    rec = Recorder()
    cases = ctx.fixtures.get("cases", [])
    matched = rejected = 0
    for case in cases:
        where = f"fixture {case['id']}"
        response = ctx.client.post("/api/predict", {"features": case["features"]})
        outside = outside_training_range(case["features"], ctx.schema)
        if response.status == 422 and outside:
            detail = response.json().get("detail", [])
            flagged = {item["loc"][-1] for item in detail if item.get("type") == "out_of_range"}
            other = [item for item in detail if item.get("type") != "out_of_range"]
            if flagged != outside or other:
                rec.fail(
                    f"{where}: 422 flagged {sorted(flagged)} (+{len(other)} other), "
                    f"expected out_of_range {sorted(outside)}"
                )
            else:
                rejected += 1
            continue
        if response.status != 200:
            rec.fail(f"{where}: HTTP {response.status} {response.body[:200]!r}")
            continue
        body = response.json()
        if outside and not body.get("warnings"):
            rec.fail(f"{where}: out-of-range inputs {sorted(outside)} predicted without warnings")
        check_invariants(body, rec, where, risk_bands=ctx.risk_bands, feature_keys=ctx.feature_keys)
        compare_predictions(body, case["expected"], ctx.tolerance, rec, where)
        matched += 1
    if not cases:
        rec.fail("fixtures.json has no cases")
    d = rec.max_delta
    summary = (
        f"{matched}/{len(cases)} server = native reference "
        f"(max |dp| {fmt_delta(d.get('probability'))}, |dlogit| {fmt_delta(d.get('logit'))}, "
        f"|dshap| {fmt_delta(d.get('shap'))})"
    )
    if rejected:
        summary += f"; {rejected} outside the training range rejected by the 'reject' policy as designed"
    return rec.result("fixtures", summary, {"cases": len(cases), "matched": matched, "rejected_out_of_range": rejected})


def check_cohort(ctx: Context) -> CheckResult:
    rec = Recorder()
    response = ctx.client.get("/api/cohort")
    if response.status != 200:
        rec.fail(f"GET /api/cohort -> {response.status}")
        return rec.result("cohort", f"HTTP {response.status}")
    patients = response.json().get("patients", [])
    ctx.cohort = patients
    if not patients:
        rec.fail("empty demo cohort")

    references: list[tuple[str, Callable[[dict[str, Any]], dict[str, Any]]]] = []
    notes: list[str] = []
    portable, why = load_portable(ctx.artifacts)
    if portable is not None:
        references.append(("portable", portable))
    else:
        notes.append(f"portable skipped: {why}")
    if ctx.use_native:
        native, why = load_native(ctx.artifacts)
        if native is not None:
            references.append(("native", native))
        else:
            notes.append(f"native skipped: {why}")

    ref_recorders = {name: Recorder() for name, _ in references}
    agreement: dict[str, dict[str, list[int]]] = {}
    for patient in patients:
        pid = patient["id"]
        where = f"cohort {pid}"
        via_cohort = ctx.client.get(f"/api/cohort/{urllib.parse.quote(pid)}/prediction")
        via_predict = ctx.client.post("/api/predict", {"features": patient["features"]})
        if via_cohort.status != 200 or via_predict.status != 200:
            rec.fail(f"{where}: HTTP {via_cohort.status} (cohort) / {via_predict.status} (predict)")
            continue
        body = via_predict.json()
        ctx.single[pid] = body
        check_invariants(body, rec, where, risk_bands=ctx.risk_bands, feature_keys=ctx.feature_keys)
        cohort_body = via_cohort.json()
        compare_predictions(
            cohort_body["prediction"],
            body,
            {k: SAME_SERVER_TOL for k in ctx.tolerance},
            rec,
            f"{where} (cohort vs predict)",
        )
        labels: dict[str, int] = patient.get("labels", {})
        flags = cohort_body.get("agreement", {})
        for target, truth in labels.items():
            if target not in body["predictions"]:
                continue
            agrees = body["predictions"][target]["label"] == truth
            if flags.get(target) is not agrees:
                rec.fail(f"{where}/{target}: agreement flag {flags.get(target)!r} != {agrees}")
            split = patient.get("split", "all")
            agreement.setdefault(split, {}).setdefault(target, []).append(int(agrees))
        for name, predict in references:
            try:
                reference = predict(dict(patient["features"]))
            except Exception as exc:
                ref_recorders[name].fail(f"{where}: {name} reference raised {type(exc).__name__}: {exc}")
                continue
            compare_predictions(body, reference, ctx.tolerance, ref_recorders[name], f"{where} (server vs {name})")

    for sub in ref_recorders.values():
        rec.failures.extend(sub.failures)
    parity = []
    for name, sub in ref_recorders.items():
        parity.append(
            f"server = {name} (max |dp| {fmt_delta(sub.max_delta.get('probability'))}, "
            f"|dshap| {fmt_delta(sub.max_delta.get('shap'))})"
        )
    accuracy = {
        split: {t: round(sum(v) / len(v), 3) for t, v in per_target.items() if v}
        for split, per_target in agreement.items()
    }
    test_acc = accuracy.get("test", {})
    acc_note = (
        "test-split label agreement " + ", ".join(f"{t} {test_acc[t]:.2f}" for t in TARGETS if t in test_acc)
        if test_acc
        else ""
    )
    summary = f"{len(patients)} patients consistent; " + "; ".join(parity or ["no reference engine"])
    if acc_note:
        summary += f"; {acc_note}"
    if notes:
        summary += " [" + "; ".join(notes) + "]"
    details = {
        "patients": len(patients),
        "references": [name for name, _ in references],
        "reference_max_abs_delta": {name: sub.max_delta for name, sub in ref_recorders.items()},
        "label_agreement_by_split": accuracy,
    }
    return rec.result("cohort", summary, details)


def check_batch(ctx: Context) -> CheckResult:
    rec = Recorder()
    rows = [{"id": p["id"], "features": p["features"]} for p in ctx.cohort if p["id"] in ctx.single]
    if not rows:
        return CheckResult("batch", SKIP, "no cohort predictions to compare")
    for start in range(0, len(rows), BATCH_CHUNK):
        chunk = rows[start : start + BATCH_CHUNK]
        response = ctx.client.post("/api/predict/batch", {"rows": chunk})
        if response.status != 200:
            rec.fail(f"batch rows {start}-{start + len(chunk) - 1}: HTTP {response.status}")
            continue
        results = response.json().get("results", [])
        if [r.get("id") for r in results] != [r["id"] for r in chunk]:
            rec.fail(f"batch rows {start}-{start + len(chunk) - 1}: results not in request order")
            continue
        for row, result in zip(chunk, results, strict=True):
            compare_predictions(
                result["prediction"],
                ctx.single[row["id"]],
                {k: SAME_SERVER_TOL for k in ctx.tolerance},
                rec,
                f"batch {row['id']}",
            )
    return rec.result(
        "batch", f"{len(rows)} rows in {math.ceil(len(rows) / BATCH_CHUNK)} call(s) = single predictions, in order"
    )


def check_frontend(ctx: Context) -> CheckResult:
    if not ctx.health.get("frontend_served"):
        return CheckResult("frontend", SKIP, "server does not serve the SPA (frontend/dist not built or disabled)")
    rec = Recorder()
    index = ctx.client.get("/")
    if index.status != 200 or "text/html" not in index.content_type:
        rec.fail(f"GET / -> {index.status} {index.content_type}")
    elif b'id="root"' not in index.body and b"<script" not in index.body:
        rec.fail("GET / does not look like the built SPA")
    for path in ("/model/schema.json", "/anatomy/manifest.json"):
        response = ctx.client.get(path)
        if response.status != 200 or "json" not in response.content_type:
            rec.fail(f"GET {path} -> {response.status} {response.content_type}")
    glb = ctx.client.request("HEAD", "/anatomy/cardiotwin_anatomy.glb")
    if glb.status != 200:
        rec.fail(f"HEAD /anatomy/cardiotwin_anatomy.glb -> {glb.status}")
    missing_api = ctx.client.get("/api/definitely-not-a-route")
    if missing_api.status != 404 or "json" not in missing_api.content_type:
        rec.fail(
            f"unknown /api path -> {missing_api.status} {missing_api.content_type} (must be a JSON 404, not the SPA)"
        )
    return rec.result("frontend", "SPA index, model and anatomy assets served; unknown /api paths stay JSON 404s")


def _percentiles(values: Sequence[float]) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values)

    def pct(q: float) -> float:
        # Linear interpolation between closest ranks (numpy's default "linear" method).
        pos = (len(ordered) - 1) * q
        lo, hi = math.floor(pos), math.ceil(pos)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)

    return {
        "n": len(ordered),
        "mean": statistics.fmean(ordered),
        "p50": pct(0.50),
        "p95": pct(0.95),
        "p99": pct(0.99),
        "max": ordered[-1],
    }


def _jittered_patient(base: Mapping[str, Any], schema: Mapping[str, Any], rng: random.Random) -> dict[str, Any]:
    """A cohort patient with two numeric inputs re-drawn on their schema grid (unique cache key, in range)."""
    numeric = [
        f
        for f in schema["features"]
        if f.get("type") == "numeric" and f.get("min") is not None and f.get("max") is not None
    ]
    features = dict(base)
    for spec in rng.sample(numeric, k=min(2, len(numeric))):
        lo, hi = float(spec["min"]), float(spec["max"])
        step = float(spec.get("step") or (hi - lo) / 1000.0) or 1.0
        value = lo + rng.randint(0, max(0, int((hi - lo) / step))) * step
        value = min(hi, max(lo, round(value, 6)))
        features[spec["key"]] = int(value) if float(value).is_integer() and step >= 1 else value
    return features


def check_latency(ctx: Context) -> CheckResult:
    n = ctx.latency_n
    if n <= 0 or not ctx.cohort:
        return CheckResult("latency", SKIP, "disabled" if n <= 0 else "no cohort patients to sample")
    rng = random.Random(ctx.seed if ctx.seed is not None else int.from_bytes(os.urandom(8), "big"))
    miss_client: list[float] = []
    miss_server: list[float] = []
    hit_client: list[float] = []
    hit_server: list[float] = []
    failures: list[str] = []
    for i in range(n):
        features = _jittered_patient(ctx.cohort[i % len(ctx.cohort)]["features"], ctx.schema, rng)
        response = ctx.client.post("/api/predict", {"features": features})
        if response.status != 200:
            failures.append(f"latency sample {i}: HTTP {response.status} {response.body[:160]!r}")
            continue
        bucket = (hit_client, hit_server) if response.cache == "HIT" else (miss_client, miss_server)
        bucket[0].append(response.elapsed_ms)
        if response.server_ms is not None:
            bucket[1].append(response.server_ms)
    repeat = {"features": ctx.cohort[0]["features"]}
    ctx.client.post("/api/predict", repeat)  # make sure it is cached
    for _ in range(n):
        response = ctx.client.post("/api/predict", repeat)
        if response.status == 200 and response.cache == "HIT":
            hit_client.append(response.elapsed_ms)
            if response.server_ms is not None:
                hit_server.append(response.server_ms)
    stats = {
        "cache_miss": {"client_ms": _percentiles(miss_client), "server_ms": _percentiles(miss_server)},
        "cache_hit": {"client_ms": _percentiles(hit_client), "server_ms": _percentiles(hit_server)},
    }

    def line(label: str, s: Mapping[str, float]) -> str:
        if not s:
            return f"{label} n/a"
        return f"{label} p50 {s['p50']:.1f} / p95 {s['p95']:.1f} / p99 {s['p99']:.1f} ms (n={int(s['n'])})"

    summary = "; ".join(
        (
            line("miss (model + exact SHAP)", stats["cache_miss"]["client_ms"]),
            line("hit", stats["cache_hit"]["client_ms"]),
        )
    )
    status = INFO
    if ctx.max_p95_ms is not None and stats["cache_miss"]["client_ms"]:
        p95 = stats["cache_miss"]["client_ms"]["p95"]
        if p95 > ctx.max_p95_ms:
            failures.append(f"cache-miss p95 {p95:.1f} ms exceeds the --max-p95-ms budget {ctx.max_p95_ms:.1f} ms")
    if failures:
        status = FAIL
    return CheckResult("latency", status, summary, failures, stats)


# ------------------------------------------------------------------------------------------------
# Driver
# ------------------------------------------------------------------------------------------------

CHECKS: tuple[Callable[[Context], CheckResult], ...] = (
    check_health,
    check_schema,
    check_leakage,
    check_fixtures,
    check_cohort,
    check_batch,
    check_frontend,
    check_latency,
)


def wait_until_ready(client: HttpClient, timeout_s: float, *, settle: bool = True) -> dict[str, Any]:
    """Poll ``/api/health`` until the model answers (and, with ``settle``, the cache warm-up is over)."""
    deadline = time.monotonic() + max(0.0, timeout_s)
    last_error = "no response"
    while True:
        try:
            response = client.get("/api/health")
            if response.status == 200:
                body: dict[str, Any] = response.json()
                if not settle or body.get("cache_warmup") != "running" or time.monotonic() >= deadline:
                    return body
                last_error = "cache warm-up running"
            else:
                last_error = f"HTTP {response.status}"
        except ServerUnreachable as exc:
            last_error = str(exc)
        if time.monotonic() >= deadline:
            raise ServerUnreachable(f"{client.base_url} not ready after {timeout_s:.0f} s ({last_error})")
        time.sleep(0.5)


def run(ctx: Context, *, emit: Callable[[str], None]) -> list[CheckResult]:
    results: list[CheckResult] = []
    for check in CHECKS:
        started = time.perf_counter()
        try:
            result = check(ctx)
        except ServerUnreachable:
            raise
        except Exception as exc:
            result = CheckResult(
                check.__name__.removeprefix("check_"), FAIL, f"crashed: {type(exc).__name__}: {exc}", [repr(exc)]
            )
        result.details["duration_s"] = round(time.perf_counter() - started, 3)
        results.append(result)
        emit(f"  {result.status:<4}  {result.name:<9} {result.summary}")
        for message in result.failures[:MAX_REPORTED_FAILURES]:
            emit(f"          - {message}")
        if len(result.failures) > MAX_REPORTED_FAILURES:
            emit(f"          ... {len(result.failures) - MAX_REPORTED_FAILURES} more")
    return results


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="End-to-end check of a running CardioTwin API against the ML reference artifacts.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--url", default=os.environ.get("CARDIOTWIN_E2E_URL", DEFAULT_URL), help="API base URL")
    parser.add_argument(
        "--artifacts", type=Path, default=DEFAULT_ARTIFACTS, help="ML artifacts directory (fixtures.json, model.json)"
    )
    parser.add_argument(
        "--fixtures", type=Path, default=None, help="fixtures.json (default: <artifacts>/fixtures.json)"
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="anatomy manifest used when the server does not serve the SPA",
    )
    parser.add_argument(
        "--wait",
        type=float,
        default=0.0,
        metavar="SECONDS",
        help="wait up to this long for the server (and its cache warm-up)",
    )
    parser.add_argument("--timeout", type=float, default=30.0, metavar="SECONDS", help="per-request timeout")
    parser.add_argument("--latency-n", type=int, default=40, help="requests per latency scenario (0 disables)")
    parser.add_argument(
        "--max-p95-ms", type=float, default=None, help="fail when the cache-miss p95 exceeds this budget"
    )
    parser.add_argument(
        "--seed", type=int, default=None, help="seed for the latency sample (default: random, so misses stay misses)"
    )
    parser.add_argument("--no-native", action="store_true", help="skip the in-process native predictor comparison")
    parser.add_argument("--allow-fake", action="store_true", help="do not fail health on the synthetic predictor")
    parser.add_argument("--json-report", type=Path, default=None, help="write every result as JSON to this file")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    fixtures_path: Path = args.fixtures or args.artifacts / "fixtures.json"
    if not fixtures_path.is_file():
        print(f"error: {fixtures_path} not found (train the model or pass --fixtures)", file=sys.stderr)
        return 2
    fixtures = json.loads(fixtures_path.read_text(encoding="utf-8"))
    tolerance = {**DEFAULT_TOLERANCE, **{k: float(v) for k, v in fixtures.get("tolerance", {}).items()}}
    client = HttpClient(args.url, args.timeout)
    ctx = Context(
        client=client,
        artifacts=args.artifacts,
        manifest_path=args.manifest,
        fixtures=fixtures,
        tolerance=tolerance,
        use_native=not args.no_native,
        allow_fake=args.allow_fake,
        latency_n=args.latency_n,
        seed=args.seed,
        max_p95_ms=args.max_p95_ms,
    )
    print(
        f"CardioTwin end-to-end check: {client.base_url} (fixtures model {fixtures.get('model_version')}, "
        f"{len(fixtures.get('cases', []))} cases)"
    )
    started = time.perf_counter()
    try:
        wait_until_ready(client, args.wait)
        results = run(ctx, emit=print)
    except ServerUnreachable as exc:
        print(f"error: server unreachable: {exc}", file=sys.stderr)
        return 2
    finally:
        client.close()
    failed = [r for r in results if r.failed]
    elapsed = time.perf_counter() - started
    verdict = "FAIL" if failed else "PASS"
    print(f"RESULT: {verdict} ({len(results)} checks, {len(failed)} failed, {elapsed:.1f} s)")
    if args.json_report is not None:
        report = {
            "url": client.base_url,
            "verdict": verdict,
            "elapsed_s": round(elapsed, 3),
            "model_version": ctx.health.get("model_version"),
            "tolerance": tolerance,
            "checks": [asdict(r) for r in results],
        }
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
