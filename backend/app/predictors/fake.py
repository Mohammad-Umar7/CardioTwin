"""Deterministic, contract-shaped stand-in for the trained CardioTwin predictor.

``FakePredictor`` is an *additive* model: for every target ``t``

    margin_t(x) = b_t + sum_i g_ti(x_i),   with g_ti(default_i) = 0

so its exact SHAP values against a point-mass background at the schema defaults are simply
``phi_ti = g_ti(x_i)`` and ``base_value = b_t``. This keeps the contract invariant
``base_value + sum(shap) == output_value`` exact, which lets the API tests exercise every code
path (imputation, explanations, risk bands, summary) without the ML artifacts.

It is **not** a trained model. The service only uses it when ``CARDIOTWIN_PREDICTOR=fake`` and then
reports ``"predictor": "fake"`` in ``GET /api/health``.
"""

from __future__ import annotations

import copy
import math
from collections.abc import Mapping
from typing import Any

FAKE_VERSION = "0.0.0-fake"

_GROUPS: list[dict[str, Any]] = [
    {"id": "demographics", "label": "Demographics", "order": 1, "icon": "user"},
    {"id": "risk_factors", "label": "Risk factors", "order": 2, "icon": "alert-triangle"},
    {"id": "symptoms", "label": "Symptoms", "order": 3, "icon": "activity"},
    {"id": "exam", "label": "Clinical exam", "order": 4, "icon": "stethoscope"},
    {"id": "ecg", "label": "ECG", "order": 5, "icon": "heart-pulse"},
    {"id": "labs", "label": "Laboratory", "order": 6, "icon": "flask"},
    {"id": "echo", "label": "Echocardiography", "order": 7, "icon": "waves"},
]


def _num(key: str, label: str, group: str, unit: str | None, lo: float, hi: float, step: float,
         default: float, normal: tuple[float | None, float | None], description: str) -> dict[str, Any]:
    return {
        "key": key, "label": label, "group": group, "type": "numeric", "unit": unit,
        "min": lo, "max": hi, "step": step, "default": default,
        "normal": {"low": normal[0], "high": normal[1]}, "description": description, "options": None,
    }


def _bin(key: str, label: str, group: str, default: int, description: str) -> dict[str, Any]:
    return {
        "key": key, "label": label, "group": group, "type": "binary", "unit": None,
        "min": 0, "max": 1, "step": 1, "default": default,
        "normal": {"low": None, "high": None}, "description": description, "options": None,
    }


def _cat(key: str, label: str, group: str, default: str, options: list[tuple[str, str]],
         description: str) -> dict[str, Any]:
    return {
        "key": key, "label": label, "group": group, "type": "categorical", "unit": None,
        "min": None, "max": None, "step": None, "default": default,
        "normal": {"low": None, "high": None}, "description": description,
        "options": [{"value": v, "label": lab} for v, lab in options],
    }


_FEATURES: list[dict[str, Any]] = [
    _num("Age", "Age", "demographics", "years", 30, 86, 1, 58, (None, None), "Age at presentation."),
    _cat("Sex", "Sex", "demographics", "Male", [("Male", "Male"), ("Female", "Female")], "Biological sex."),
    _num("BMI", "Body-mass index", "demographics", "kg/m²", 18, 41, 0.1, 26, (18.5, 25), "Weight / height²."),
    _bin("DM", "Diabetes mellitus", "risk_factors", 0, "History of diabetes mellitus."),
    _bin("HTN", "Hypertension", "risk_factors", 1, "History of hypertension."),
    _bin("Current Smoker", "Current smoker", "risk_factors", 0, "Currently smokes tobacco."),
    _bin("FH", "Family history", "risk_factors", 0, "Premature CAD in a first-degree relative."),
    _bin("DLP", "Dyslipidaemia", "risk_factors", 0, "Known dyslipidaemia."),
    _bin("Typical Chest Pain", "Typical chest pain", "symptoms", 1, "Typical (anginal) chest pain."),
    _bin("Atypical", "Atypical chest pain", "symptoms", 0, "Atypical chest pain."),
    _bin("Dyspnea", "Dyspnoea", "symptoms", 0, "Shortness of breath."),
    _num("BP", "Blood pressure (systolic)", "exam", "mmHg", 90, 190, 1, 130, (90, 140), "Systolic blood pressure."),
    _num("PR", "Pulse rate", "exam", "bpm", 50, 110, 1, 70, (60, 100), "Resting pulse rate."),
    _bin("St Depression", "ST depression", "ecg", 0, "ST-segment depression on resting ECG."),
    _bin("Tinversion", "T-wave inversion", "ecg", 0, "T-wave inversion on resting ECG."),
    _cat("BBB", "Bundle branch block", "ecg", "N",
         [("N", "None"), ("LBBB", "Left bundle branch block"), ("RBBB", "Right bundle branch block")],
         "Bundle branch block on resting ECG."),
    _num("FBS", "Fasting blood sugar", "labs", "mg/dL", 62, 400, 1, 98, (70, 100), "Fasting plasma glucose."),
    _num("LDL", "LDL cholesterol", "labs", "mg/dL", 18, 232, 1, 100, (None, 130), "Low-density lipoprotein."),
    _num("HDL", "HDL cholesterol", "labs", "mg/dL", 15, 111, 1, 38, (40, None), "High-density lipoprotein."),
    _num("ESR", "Erythrocyte sedimentation rate", "labs", "mm/h", 1, 90, 1, 15, (None, 20), "Inflammation marker."),
    _num("EF-TTE", "Ejection fraction (TTE)", "echo", "%", 15, 60, 1, 50, (50, None),
         "Left-ventricular ejection fraction on transthoracic echo."),
    _num("Region RWMA", "Regional wall-motion abnormality", "echo", "regions", 0, 4, 1, 0, (0, 0),
         "Number of regions with abnormal wall motion (an echo finding, not a lesion map)."),
    _cat("VHD", "Valvular heart disease", "echo", "N",
         [("N", "None"), ("mild", "Mild"), ("Moderate", "Moderate"), ("Severe", "Severe")],
         "Severity of valvular heart disease."),
]

_TARGETS: list[dict[str, Any]] = [
    {"id": "CAD", "label": "Coronary artery disease", "short": "CAD", "anatomy": ["heart"],
     "description": ">= 50% stenosis in at least one major coronary artery."},
    {"id": "LAD", "label": "Left anterior descending artery", "short": "LAD",
     "anatomy": ["Coronary_LAD", "Coronary_LAD_Septal"], "territory": "Anterior wall, anterior septum, apex",
     "description": "Stenosis of the left anterior descending artery."},
    {"id": "LCX", "label": "Left circumflex artery", "short": "LCX", "anatomy": ["Coronary_LCX"],
     "territory": "Lateral and posterolateral wall", "description": "Stenosis of the left circumflex artery."},
    {"id": "RCA", "label": "Right coronary artery", "short": "RCA",
     "anatomy": ["Coronary_RCA", "Coronary_RCA_Marginal", "Coronary_RCA_PDA", "Coronary_RCA_PL",
                 "Coronary_RCA_Septal"],
     "territory": "Inferior wall, inferior septum, right ventricle",
     "description": "Stenosis of the right coronary artery."},
]

_RISK_BANDS: list[dict[str, Any]] = [
    {"id": "low", "max": 0.25}, {"id": "moderate", "max": 0.5},
    {"id": "high", "max": 0.75}, {"id": "critical", "max": 1.0},
]

_INTERCEPTS: dict[str, float] = {"CAD": 0.91, "LAD": 0.34, "LCX": -0.43, "RCA": -0.51}

# Weight per standardised unit (numeric), per 0->1 step (binary) or per option (categorical).
_WEIGHTS: dict[str, dict[str, Any]] = {
    "CAD": {"Age": 0.55, "Sex": {"Female": -0.35}, "BMI": 0.05, "DM": 0.62, "HTN": 0.41,
            "Current Smoker": 0.22, "FH": 0.18, "DLP": 0.15, "Typical Chest Pain": 1.35, "Atypical": -0.85,
            "Dyspnea": 0.05, "BP": 0.12, "PR": 0.05, "St Depression": 0.38, "Tinversion": 0.46,
            "BBB": {"LBBB": 0.2, "RBBB": 0.1}, "FBS": 0.2, "LDL": 0.06, "HDL": -0.12, "ESR": 0.08,
            "EF-TTE": -0.45, "Region RWMA": 0.52, "VHD": {"mild": -0.1, "Moderate": -0.3, "Severe": -0.5}},
    "LAD": {"Age": 0.35, "Sex": {"Female": -0.2}, "DM": 0.35, "HTN": 0.25, "Typical Chest Pain": 1.0,
            "Atypical": -0.6, "St Depression": 0.25, "Tinversion": 0.55, "BBB": {"LBBB": 0.3},
            "FBS": 0.1, "EF-TTE": -0.5, "Region RWMA": 0.45, "Current Smoker": 0.15},
    "LCX": {"Age": 0.3, "DM": 0.3, "HTN": 0.2, "Typical Chest Pain": 0.8, "Atypical": -0.4,
            "St Depression": 0.35, "Tinversion": 0.2, "FBS": 0.15, "EF-TTE": -0.3, "Region RWMA": 0.3,
            "HDL": -0.1},
    "RCA": {"Age": 0.3, "DM": 0.3, "HTN": 0.25, "Typical Chest Pain": 0.85, "Atypical": -0.45,
            "St Depression": 0.2, "Tinversion": 0.25, "PR": -0.1, "EF-TTE": -0.25, "Region RWMA": 0.35,
            "Current Smoker": 0.2},
}

_COHORT_FEATURES: list[tuple[str, str, dict[str, Any]]] = [
    ("P-001", "test", {"Age": 67, "Sex": "Male", "DM": 1, "HTN": 1, "Typical Chest Pain": 1, "Tinversion": 1,
                       "St Depression": 1, "FBS": 160, "EF-TTE": 35, "Region RWMA": 3}),
    ("P-002", "test", {"Age": 41, "Sex": "Female", "HTN": 0, "Typical Chest Pain": 0, "Atypical": 1,
                       "EF-TTE": 60, "HDL": 55}),
    ("P-003", "test", {"Age": 58, "Sex": "Male", "Current Smoker": 1, "Typical Chest Pain": 1, "EF-TTE": 50}),
    ("P-004", "dev", {"Age": 72, "Sex": "Female", "DM": 1, "HTN": 1, "Typical Chest Pain": 1, "EF-TTE": 45,
                      "Region RWMA": 1, "VHD": "mild"}),
    ("P-005", "dev", {"Age": 49, "Sex": "Male", "HTN": 0, "Typical Chest Pain": 0, "Dyspnea": 1,
                      "BBB": "RBBB", "EF-TTE": 55}),
    ("P-006", "test", {"Age": 63, "Sex": "Male", "DM": 0, "HTN": 1, "Typical Chest Pain": 1, "FH": 1,
                       "LDL": 160, "EF-TTE": 40, "Region RWMA": 2}),
]


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


class FakePredictor:
    """Deterministic additive predictor that satisfies :class:`~app.predictors.base.Predictor`."""

    def __init__(self, version: str = FAKE_VERSION, thresholds: Mapping[str, float] | None = None) -> None:
        self._version = version
        self._thresholds = {t["id"]: 0.5 for t in _TARGETS} | dict(thresholds or {})
        self._schema: dict[str, Any] = {
            "version": version,
            "groups": copy.deepcopy(_GROUPS),
            "features": copy.deepcopy(_FEATURES),
            "targets": copy.deepcopy(_TARGETS),
            "risk_bands": copy.deepcopy(_RISK_BANDS),
        }
        self._specs = {f["key"]: f for f in self._schema["features"]}
        self.calls = 0  # number of predict() invocations (lets tests observe caching)
        self._cohort = self._build_cohort()
        self._metrics = self._build_metrics()

    # -- Predictor protocol ---------------------------------------------------------------

    @property
    def schema(self) -> dict[str, Any]:
        return self._schema

    @property
    def metrics(self) -> dict[str, Any]:
        return self._metrics

    @property
    def cohort(self) -> dict[str, Any]:
        return self._cohort

    @property
    def version(self) -> str:
        return self._version

    def predict(self, features: Mapping[str, Any]) -> dict[str, Any]:
        self.calls += 1
        return self._compute(features)

    # -- internals ------------------------------------------------------------------------

    def _compute(self, features: Mapping[str, Any]) -> dict[str, Any]:
        unknown = sorted(set(features) - set(self._specs))
        if unknown:
            raise KeyError(f"Unknown feature(s): {unknown}")

        values: dict[str, Any] = {}
        imputed: list[str] = []
        for key, spec in self._specs.items():
            value = features.get(key)
            if value is None:
                value = spec["default"]
                imputed.append(key)
            values[key] = value

        predictions: dict[str, Any] = {}
        explanations: dict[str, Any] = {}
        for target in (t["id"] for t in _TARGETS):
            contributions = [
                {"feature": key, "value": values[key], "shap": self._term(target, key, values[key])}
                for key in self._specs
            ]
            base = _INTERCEPTS[target]
            margin = base + math.fsum(c["shap"] for c in contributions)
            contributions.sort(key=lambda c: (-abs(c["shap"]), c["feature"]))
            probability = _sigmoid(margin)
            threshold = self._thresholds[target]
            predictions[target] = {
                "probability": probability,
                "label": int(probability >= threshold),
                "threshold": threshold,
                "risk_band": self._band(probability),
                "logit": margin,
            }
            explanations[target] = {
                "space": "log-odds",
                "base_value": base,
                "output_value": margin,
                "contributions": contributions,
            }

        vessels = {v: predictions[v]["probability"] for v in ("LAD", "LCX", "RCA")}
        return {
            "model_version": self._version,
            "engine": "server",
            "imputed": imputed,
            "predictions": predictions,
            "explanations": explanations,
            "summary": {
                "expected_diseased_vessels": math.fsum(vessels.values()),
                "highest_risk_vessel": max(vessels, key=lambda v: vessels[v]),
            },
        }

    def _term(self, target: str, key: str, value: Any) -> float:
        weight = _WEIGHTS[target].get(key)
        if weight is None:
            return 0.0
        spec = self._specs[key]
        if spec["type"] == "categorical":
            return float(weight.get(value, 0.0)) - float(weight.get(spec["default"], 0.0))
        if spec["type"] == "binary":
            return float(weight) * (float(value) - float(spec["default"]))
        scale = (float(spec["max"]) - float(spec["min"])) / 4.0
        return float(weight) * (float(value) - float(spec["default"])) / scale

    def _band(self, probability: float) -> str:
        for band in self._schema["risk_bands"]:
            if probability < band["max"]:
                return str(band["id"])
        return str(self._schema["risk_bands"][-1]["id"])

    def _build_cohort(self) -> dict[str, Any]:
        patients = []
        for pid, split, feats in _COHORT_FEATURES:
            full = {k: feats.get(k, spec["default"]) for k, spec in self._specs.items()}
            result = self._compute(full)
            labels = {t: result["predictions"][t]["label"] for t in ("CAD", "LAD", "LCX", "RCA")}
            bits = [f"{full['Age']} y", str(full["Sex"])]
            bits.append("typical angina" if full["Typical Chest Pain"] else "atypical/no chest pain")
            if full["DM"]:
                bits.append("DM")
            patients.append({"id": pid, "split": split, "summary": " · ".join(bits), "features": full,
                             "labels": labels})
        return {"patients": patients}

    def _build_metrics(self) -> dict[str, Any]:
        chance = {"mean": 0.5, "std": 0.0}
        point = {"value": 0.5, "ci": [0.5, 0.5]}
        targets: dict[str, Any] = {}
        for target in ("CAD", "LAD", "LCX", "RCA"):
            importance = sorted(
                ({"feature": k, "mean_abs_shap": abs(w) if isinstance(w, (int, float)) else max(map(abs, w.values()))}
                 for k, w in _WEIGHTS[target].items()),
                key=lambda d: -float(d["mean_abs_shap"]),
            )
            targets[target] = {
                "selected_model": "FakePredictor (deterministic additive stub - not a trained model)",
                "cv": {m: dict(chance) for m in ("roc_auc", "f1", "accuracy", "precision", "recall")},
                "test": {m: dict(point) for m in ("roc_auc", "accuracy", "precision", "recall", "specificity",
                                                  "f1", "pr_auc", "brier", "mcc")},
                "threshold": self._thresholds[target],
                "confusion_matrix": {"tn": 0, "fp": 0, "fn": 0, "tp": 0},
                "curves": {
                    "roc": {"fpr": [0.0, 1.0], "tpr": [0.0, 1.0]},
                    "pr": {"recall": [0.0, 1.0], "precision": [0.5, 0.5]},
                    "calibration": {"mean_predicted": [], "fraction_positive": [], "count": []},
                    "dca": {"thresholds": [], "model": [], "treat_all": [], "treat_none": []},
                },
                "leaderboard": [],
                "global_importance": importance,
                "beeswarm": [],
            }
        return {
            "version": self._version,
            "generated_at": "2026-01-01T00:00:00+00:00",
            "dataset": {"name": "Extension of Z-Alizadeh Sani (synthetic stand-in)", "n": 303, "n_dev": 242,
                        "n_test": 61, "prevalence": {"CAD": 0.713, "LAD": 0.584, "LCX": 0.393, "RCA": 0.376}},
            "protocol": {"note": "FakePredictor: fixed hand-set weights for API tests; no training or evaluation.",
                         "seed": 42},
            "targets": targets,
        }
