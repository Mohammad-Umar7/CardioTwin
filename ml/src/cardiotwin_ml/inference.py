"""In-process predictor used by the FastAPI backend (``docs/CONTRACTS.md`` §1 and §3.2).

    from cardiotwin_ml.inference import CardioTwinPredictor
    p = CardioTwinPredictor.load("ml/artifacts")
    p.predict({"Age": 63, "Sex": "Male", "Typical Chest Pain": 1})

The predictor runs the *native* models from ``cardiotwin_models.joblib`` (scikit-learn logistic pipeline
and XGBoost booster, margins in float64) and explains each prediction with exact SHAP values. The
browser engine evaluates ``model.json`` and must agree with this class to 1e-6 (``fixtures.json``).
"""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from .ensemble import TargetModel
from .explain import ADDITIVITY_TOL, contribution_list
from .preprocess import FeatureEncoder, compute_derived, normalise_value

BUNDLE_NAME = "cardiotwin_models.joblib"


class CardioTwinPredictor:
    """Load once, predict many times (thread-safe; no mutable state after load)."""

    def __init__(self, bundle: Mapping[str, Any], directory: Path):
        self._bundle = bundle
        self._dir = directory
        self.encoder: FeatureEncoder = bundle["encoder"]
        self.models: dict[str, TargetModel] = bundle["models"]
        self.targets: list[str] = list(bundle["targets"])
        self.vessel_targets: list[str] = list(bundle["vessel_targets"])
        self.defaults: dict[str, Any] = dict(bundle["defaults"])
        self.risk_bands: list[dict[str, Any]] = list(bundle["risk_bands"])
        self._specs = self.encoder.specs
        self._json_cache: dict[str, Any] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ loading
    @classmethod
    def load(cls, directory: str | Path) -> CardioTwinPredictor:
        path = Path(directory)
        bundle = joblib.load(path / BUNDLE_NAME)
        return cls(bundle, path)

    def _json(self, name: str) -> Any:
        with self._lock:
            if name not in self._json_cache:
                with open(self._dir / name, encoding="utf-8") as fh:
                    self._json_cache[name] = json.load(fh)
            return self._json_cache[name]

    @property
    def schema(self) -> dict[str, Any]:
        return self._json("schema.json")

    @property
    def metrics(self) -> dict[str, Any]:
        return self._json("metrics.json")

    @property
    def cohort(self) -> dict[str, Any]:
        return self._json("cohort.json")

    @property
    def version(self) -> str:
        return str(self._bundle["version"])

    @property
    def feature_keys(self) -> list[str]:
        return self.encoder.raw_keys

    # ------------------------------------------------------------------ input handling
    def normalise(self, features: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """Validate and complete a feature dict -> (API-normalised values, imputed keys).

        Raises ``ValueError`` for unknown keys or invalid values. ``None`` counts as missing.
        """
        if not isinstance(features, Mapping):
            raise ValueError("features must be an object mapping feature keys to values")
        unknown = sorted(k for k in features if k not in self._specs)
        if unknown:
            raise ValueError(f"unknown feature(s): {unknown}")
        values: dict[str, Any] = {}
        imputed: list[str] = []
        for key, spec in self._specs.items():
            raw = features.get(key)
            if raw is None:
                values[key] = self.defaults[key]
                imputed.append(key)
            else:
                values[key] = normalise_value(spec, raw)
        return values, imputed

    def _band(self, p: float) -> str:
        for band in self.risk_bands:
            if p < band["max"]:
                return str(band["id"])
        return str(self.risk_bands[-1]["id"])

    # ------------------------------------------------------------------ prediction
    def predict(self, features: Mapping[str, Any]) -> dict[str, Any]:
        """Return the §3.2 response body (``engine = "server"``) for one patient."""
        values, imputed = self.normalise(features)
        x = np.asarray(self.encoder.encode_row(values), dtype=np.float64)
        derived = {d.key: compute_derived(d, values) for d in self.encoder.derived}
        X = x[None, :]
        predictions: dict[str, Any] = {}
        explanations: dict[str, Any] = {}
        for t in self.targets:
            model = self.models[t]
            margin = float(model.margin(X)[0])
            p = float(model.calibrate(np.array([margin]))[0])
            phi = model.shap_row(x)
            base = model.base_value()
            err = abs(base + float(phi.sum()) - margin)
            if err > ADDITIVITY_TOL:  # pragma: no cover - guarded by tests
                raise AssertionError(f"{t}: SHAP additivity violated ({err:.2e})")
            predictions[t] = {
                "probability": p,
                "label": int(p >= model.threshold),
                "threshold": model.threshold,
                "risk_band": self._band(p),
                "logit": margin,
            }
            explanations[t] = {
                "space": "log-odds",
                "base_value": base,
                "output_value": margin,
                "contributions": contribution_list(self.encoder, values, phi, derived, model.platt_a),
                # Same explanation on the scale of the displayed (calibrated) probability:
                # probability = sigmoid(calibrated_base_value + sum(shap_calibrated)) exactly.
                "calibrated_base_value": model.platt_a * base + model.platt_b,
                "calibrated_output_value": model.platt_a * margin + model.platt_b,
            }
        expected = float(sum(predictions[v]["probability"] for v in self.vessel_targets))
        highest = max(self.vessel_targets, key=lambda v: predictions[v]["probability"]) if self.vessel_targets else None
        return {
            "model_version": self.version,
            "engine": "server",
            "imputed": imputed,
            "predictions": predictions,
            "explanations": explanations,
            "summary": {"expected_diseased_vessels": expected, "highest_risk_vessel": highest},
        }

    def predict_proba_matrix(self, X: np.ndarray) -> dict[str, np.ndarray]:
        """Vectorised calibrated probabilities for an encoded matrix (evaluation helper)."""
        return {t: self.models[t].predict_proba(X) for t in self.targets}
