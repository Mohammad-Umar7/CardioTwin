"""Pydantic v2 models mirroring ``docs/CONTRACTS.md`` (§2 schema, §3 REST API, §4 metrics).

Response models use ``extra="allow"`` so fields *added* by the ML package (the contract permits
additions, never renames/removals) flow through to clients unchanged. Request models use
``extra="forbid"`` so typos surface as helpful 422 errors instead of being silently ignored.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TARGET_ORDER: tuple[str, ...] = ("CAD", "LAD", "LCX", "RCA")
VESSEL_TARGETS: tuple[str, ...] = ("LAD", "LCX", "RCA")
LEAKAGE_KEYS: frozenset[str] = frozenset({"LAD", "LCX", "RCA", "Cath"})

RiskBandId = Literal["low", "moderate", "high", "critical"]
FeatureValue = float | int | str | bool | None


class _Open(BaseModel):
    """Base for contract payloads produced by the ML package: unknown (added) fields are kept."""

    model_config = ConfigDict(extra="allow", protected_namespaces=())


class _Closed(BaseModel):
    """Base for request bodies: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())


# --------------------------------------------------------------------------------------------
# §2 Feature schema
# --------------------------------------------------------------------------------------------


class FeatureGroup(_Open):
    id: str
    label: str
    order: int | None = None
    icon: str | None = None


class FeatureOption(_Open):
    value: str | int
    label: str


class NormalRange(_Open):
    low: float | None = None
    high: float | None = None


class FeatureSpec(_Open):
    key: str = Field(description="Exact dataset column name, used as the request key.")
    label: str
    group: str
    type: Literal["numeric", "binary", "categorical"]
    unit: str | None = None
    min: int | float | None = None
    max: int | float | None = None
    step: int | float | None = None
    default: float | int | str | None = None
    normal: NormalRange | None = None
    description: str | None = None
    options: list[FeatureOption] | None = None

    @field_validator("options", mode="before")
    @classmethod
    def _coerce_plain_options(cls, value: Any) -> Any:
        """Accept ``["N", "LBBB"]`` as shorthand for ``[{"value": "N", "label": "N"}, ...]``."""
        if isinstance(value, list):
            return [{"value": o, "label": str(o)} if isinstance(o, (str, int)) else o for o in value]
        return value


class TargetSpec(_Open):
    id: str
    label: str
    short: str | None = None
    anatomy: list[str] = Field(default_factory=list)
    description: str | None = None
    territory: str | None = None


class RiskBand(_Open):
    id: RiskBandId
    max: float


class FeatureSchema(_Open):
    version: str
    groups: list[FeatureGroup] = Field(default_factory=list)
    features: list[FeatureSpec]
    targets: list[TargetSpec]
    risk_bands: list[RiskBand] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------
# §3.2 Prediction
# --------------------------------------------------------------------------------------------

_PREDICT_EXAMPLE_FEATURES: dict[str, Any] = {
    "Age": 62,
    "Sex": "Male",
    "DM": 1,
    "HTN": 1,
    "Typical Chest Pain": 1,
    "EF-TTE": 45,
    "Region RWMA": 2,
}


class PredictRequest(_Closed):
    """Raw clinical features keyed by dataset column name.

    Missing keys (or ``null`` values) are filled with the schema ``default`` and reported back in
    ``imputed``. Binary features take ``0``/``1`` (``true``/``false`` and ``"Y"``/``"N"`` are also
    accepted); categorical features take a value from the schema ``options``.
    """

    # Values are typed ``Any`` on purpose: the schema-driven validator reports type problems with
    # feature-specific messages (allowed range/options) instead of generic union errors.
    features: dict[str, Any] = Field(
        default_factory=dict,
        description="Raw feature values keyed by exact dataset column name (see GET /api/schema).",
    )

    model_config = ConfigDict(
        extra="forbid", json_schema_extra={"examples": [{"features": _PREDICT_EXAMPLE_FEATURES}]}
    )


class TargetPrediction(_Open):
    probability: float = Field(ge=0.0, le=1.0, description="Calibrated probability.")
    label: int = Field(ge=0, le=1, description="1 when probability >= threshold.")
    threshold: float = Field(ge=0.0, le=1.0)
    risk_band: RiskBandId
    logit: float = Field(description="Uncalibrated ensemble margin (log-odds space).")


class Contribution(_Open):
    feature: str
    value: FeatureValue = None
    shap: float


class Explanation(_Open):
    space: str = Field(default="log-odds", description="Always 'log-odds' (margin of the uncalibrated ensemble).")
    base_value: float
    output_value: float
    contributions: list[Contribution]


class PredictionSummary(_Open):
    expected_diseased_vessels: float = Field(ge=0.0, le=3.0)
    highest_risk_vessel: Literal["LAD", "LCX", "RCA"]


class PredictResponse(_Open):
    model_version: str
    engine: Literal["server", "edge"]
    imputed: list[str]
    predictions: dict[str, TargetPrediction]
    explanations: dict[str, Explanation]
    summary: PredictionSummary

    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "examples": [
                {
                    "model_version": "1.0.0",
                    "engine": "server",
                    "imputed": ["ESR"],
                    "predictions": {
                        "CAD": {"probability": 0.87, "label": 1, "threshold": 0.46, "risk_band": "critical", "logit": 1.93},
                        "LAD": {"probability": 0.71, "label": 1, "threshold": 0.5, "risk_band": "high", "logit": 0.9},
                        "LCX": {"probability": 0.38, "label": 0, "threshold": 0.45, "risk_band": "moderate", "logit": -0.5},
                        "RCA": {"probability": 0.63, "label": 1, "threshold": 0.44, "risk_band": "high", "logit": 0.53},
                    },
                    "explanations": {
                        "CAD": {
                            "space": "log-odds",
                            "base_value": 0.52,
                            "output_value": 1.93,
                            "contributions": [
                                {"feature": "Typical Chest Pain", "value": 1, "shap": 0.94},
                                {"feature": "Age", "value": 62, "shap": 0.47},
                            ],
                        }
                    },
                    "summary": {"expected_diseased_vessels": 1.72, "highest_risk_vessel": "LAD"},
                }
            ]
        },
    )


class BatchRow(_Closed):
    id: str | None = Field(default=None, max_length=128, description="Optional caller-side row id, echoed back.")
    features: dict[str, Any] = Field(default_factory=dict)


class BatchPredictRequest(_Closed):
    rows: list[BatchRow] = Field(description="1-256 rows, each shaped like a POST /api/predict body.")

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "rows": [
                        {"id": "a", "features": {"Age": 45, "Typical Chest Pain": 0}},
                        {"id": "b", "features": _PREDICT_EXAMPLE_FEATURES},
                    ]
                }
            ]
        },
    )


class BatchResult(_Open):
    index: int
    id: str | None = None
    prediction: PredictResponse


class BatchPredictResponse(_Open):
    model_version: str
    engine: Literal["server"]
    count: int
    results: list[BatchResult]


# --------------------------------------------------------------------------------------------
# §3.3 Cohort
# --------------------------------------------------------------------------------------------


class CohortPatient(_Open):
    id: str
    split: str = Field(description="'test' (held-out) or 'dev'.")
    summary: str
    features: dict[str, Any]
    labels: dict[str, int]


class CohortResponse(_Open):
    patients: list[CohortPatient]


class CohortPredictionResponse(_Open):
    patient: CohortPatient
    prediction: PredictResponse
    agreement: dict[str, bool] = Field(
        description="Per target: does the predicted label match the catheterisation ground truth?"
    )


# --------------------------------------------------------------------------------------------
# §4 Metrics (served verbatim; modelled loosely for documentation)
# --------------------------------------------------------------------------------------------


class MetricsReport(_Open):
    version: str
    generated_at: str | None = None
    dataset: dict[str, Any] = Field(default_factory=dict)
    protocol: dict[str, Any] = Field(default_factory=dict)
    targets: dict[str, dict[str, Any]]


# --------------------------------------------------------------------------------------------
# Service endpoints
# --------------------------------------------------------------------------------------------


class CacheStats(_Open):
    capacity: int
    size: int
    hits: int
    misses: int


class HealthResponse(_Open):
    status: Literal["ok"]
    model_version: str
    targets: list[str]
    engine: Literal["server"]
    predictor: Literal["real", "fake"] = Field(description="'fake' only in development/test mode.")
    schema_version: str
    n_features: int
    uptime_s: float
    cache: CacheStats
    frontend_served: bool
    disclaimer: str


class ErrorItem(_Open):
    type: str
    loc: list[str | int]
    msg: str
    input: Any = None
    ctx: dict[str, Any] | None = None


class ErrorResponse(_Open):
    error: str = Field(description="Machine-readable error code, e.g. 'validation_error', 'not_found'.")
    message: str
    detail: list[ErrorItem] | None = None
    request_id: str | None = None
