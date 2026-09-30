"""Measure ``POST /api/predict`` latency percentiles.

Examples (from the repository root)::

    # in-process (ASGI stack, no network), real model from ml/artifacts
    ./.venv/Scripts/python backend/scripts/bench_latency.py --n 200

    # against a running server (network + uvicorn included)
    ./.venv/Scripts/python backend/scripts/bench_latency.py --url http://127.0.0.1:8000 --n 200

Two scenarios are measured: ``cold`` sends a different random, schema-valid patient on every call
(cache always misses, so this is true model + SHAP latency) and ``cached`` repeats one payload
(LRU hits, i.e. what a UI sees when a user toggles back to a previous state).
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

Post = Callable[[dict[str, Any]], tuple[int, str | None]]


def random_patient(schema: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """A random patient within the schema bounds (numeric values snapped to the UI step)."""
    features: dict[str, Any] = {}
    for spec in schema["features"]:
        kind = spec["type"]
        if kind == "binary":
            features[spec["key"]] = rng.randint(0, 1)
        elif kind == "categorical":
            options = spec.get("options") or []
            if options:
                choice = rng.choice(options)
                features[spec["key"]] = choice["value"] if isinstance(choice, dict) else choice
        else:
            lo, hi = spec.get("min"), spec.get("max")
            if lo is None or hi is None:
                continue
            step = spec.get("step") or 0
            value = rng.uniform(lo, hi)
            if step:
                value = min(hi, max(lo, round(round((value - lo) / step) * step + lo, 6)))
            features[spec["key"]] = int(value) if float(step).is_integer() and step else value
    return features


def percentile(samples: list[float], q: float) -> float:
    ordered = sorted(samples)
    rank = (len(ordered) - 1) * q
    low, high = int(rank), min(int(rank) + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def measure(post: Post, payloads: list[dict[str, Any]]) -> dict[str, float]:
    timings: list[float] = []
    hits = 0
    for payload in payloads:
        start = time.perf_counter()
        status, cache = post(payload)
        timings.append((time.perf_counter() - start) * 1000)
        if status != 200:
            raise SystemExit(f"request failed with HTTP {status}: {json.dumps(payload)[:200]}")
        hits += cache == "HIT"
    return {
        "n": len(timings),
        "p50_ms": round(percentile(timings, 0.50), 3),
        "p95_ms": round(percentile(timings, 0.95), 3),
        "p99_ms": round(percentile(timings, 0.99), 3),
        "mean_ms": round(statistics.fmean(timings), 3),
        "max_ms": round(max(timings), 3),
        "cache_hit_rate": round(hits / len(timings), 3),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=200, help="calls per scenario (default 200)")
    parser.add_argument("--warmup", type=int, default=10, help="unmeasured warm-up calls (default 10)")
    parser.add_argument("--url", help="base URL of a running server; omit to benchmark in-process")
    parser.add_argument("--fake", action="store_true", help="in-process with the FakePredictor (no artifacts)")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON only")
    args = parser.parse_args(argv)

    rng = random.Random(args.seed)
    if args.url:
        import httpx

        http = httpx.Client(base_url=args.url.rstrip("/"), timeout=30.0)
        schema = http.get("/api/schema").json()
        mode = f"http {args.url}"

        def post(payload: dict[str, Any]) -> tuple[int, str | None]:
            response = http.post("/api/predict", json=payload)
            return response.status_code, response.headers.get("X-Cache")

        close: Callable[[], None] = http.close
    else:
        warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app

        settings = Settings.from_env().with_overrides(
            predictor="fake" if args.fake else "real", serve_frontend=False, log_level="ERROR"
        )
        client = TestClient(create_app(settings))
        client.__enter__()
        schema = client.get("/api/schema").json()
        mode = f"in-process ({settings.predictor} predictor)"

        def post(payload: dict[str, Any]) -> tuple[int, str | None]:
            response = client.post("/api/predict", json=payload)
            return response.status_code, response.headers.get("X-Cache")

        def close() -> None:
            client.__exit__(None, None, None)

    try:
        warm = [{"features": random_patient(schema, rng)} for _ in range(args.warmup)]
        if warm:
            measure(post, warm)
        cold = [{"features": random_patient(schema, rng)} for _ in range(args.n)]
        repeated = [{"features": random_patient(schema, rng)}] * args.n
        results = {"mode": mode, "cold": measure(post, cold), "cached": measure(post, repeated)}
    finally:
        close()

    if args.json:
        print(json.dumps(results))
    else:
        print(f"POST /api/predict latency - {mode}")
        for scenario in ("cold", "cached"):
            r = results[scenario]
            assert isinstance(r, dict)
            print(
                f"  {scenario:<7} n={r['n']:<4} p50={r['p50_ms']:>8.2f} ms  p95={r['p95_ms']:>8.2f} ms  "
                f"p99={r['p99_ms']:>8.2f} ms  mean={r['mean_ms']:>8.2f} ms  hit-rate={r['cache_hit_rate']:.0%}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
