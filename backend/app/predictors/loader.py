"""Locate and load the configured predictor, failing with actionable messages."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType

from app.config import REPO_ROOT, Settings
from app.predictors.base import Predictor, PredictorLoadError, missing_members
from app.predictors.fake import FakePredictor

REQUIRED_ARTIFACTS: tuple[str, ...] = ("schema.json", "metrics.json", "cohort.json", "cardiotwin_models.joblib")
ML_PACKAGE = "cardiotwin_ml"
ML_INFERENCE_MODULE = "cardiotwin_ml.inference"
ML_SRC_DIR = REPO_ROOT / "ml" / "src"

_FIX_HINT = (
    "Fix: train the models (see ml/README.md) so the artifacts exist, point CARDIOTWIN_ARTIFACTS at an "
    "existing artifacts directory, or - for UI development only - start with CARDIOTWIN_PREDICTOR=fake."
)


def load_predictor(settings: Settings) -> Predictor:
    """Return the predictor selected by ``settings.predictor``.

    Raises:
        PredictorLoadError: with a message naming what is missing and how to fix it.
    """
    if settings.predictor == "fake":
        return FakePredictor()
    return load_real_predictor(settings.artifacts_dir)


def load_real_predictor(artifacts_dir: Path) -> Predictor:
    """Load ``cardiotwin_ml.inference.CardioTwinPredictor`` from ``artifacts_dir``."""
    artifacts_dir = Path(artifacts_dir)
    if not artifacts_dir.is_dir():
        raise PredictorLoadError(f"ML artifacts directory not found: {artifacts_dir}. {_FIX_HINT}")
    missing = [name for name in REQUIRED_ARTIFACTS if not (artifacts_dir / name).is_file()]
    if missing:
        raise PredictorLoadError(
            f"ML artifacts directory {artifacts_dir} is incomplete; missing: {', '.join(missing)}. {_FIX_HINT}"
        )

    module = import_inference_module()
    predictor_cls = getattr(module, "CardioTwinPredictor", None)
    if predictor_cls is None or not hasattr(predictor_cls, "load"):
        raise PredictorLoadError(
            f"{ML_INFERENCE_MODULE} does not define CardioTwinPredictor.load(); the installed ML package does "
            "not match docs/CONTRACTS.md section 1."
        )
    try:
        predictor = predictor_cls.load(artifacts_dir)
    except Exception as exc:  # the ML package may raise anything (joblib, xgboost, version skew ...)
        raise PredictorLoadError(
            f"CardioTwinPredictor.load({str(artifacts_dir)!r}) failed: {type(exc).__name__}: {exc}"
        ) from exc

    gaps = missing_members(predictor)
    if gaps:
        raise PredictorLoadError(
            f"CardioTwinPredictor is missing contract members: {', '.join(gaps)} (docs/CONTRACTS.md section 1)."
        )
    return predictor


def import_inference_module() -> ModuleType:
    """Import ``cardiotwin_ml.inference``, falling back to the in-repo ``ml/src`` checkout.

    The fallback means the API works from a fresh clone even before ``pip install -e ml``.
    """
    try:
        return importlib.import_module(ML_INFERENCE_MODULE)
    except ModuleNotFoundError as exc:
        if exc.name not in (ML_PACKAGE, ML_INFERENCE_MODULE):
            raise PredictorLoadError(
                f"{ML_INFERENCE_MODULE} needs the Python package {exc.name!r}, which is not installed. "
                "Install the ML package with its dependencies: python -m pip install -e ml"
            ) from exc
        if ML_SRC_DIR.is_dir() and str(ML_SRC_DIR) not in sys.path:
            sys.path.insert(0, str(ML_SRC_DIR))
            importlib.invalidate_caches()
            return import_inference_module()
        raise PredictorLoadError(
            f"The ML package '{ML_PACKAGE}' is not importable (looked in site-packages and {ML_SRC_DIR}). "
            "Install it with: python -m pip install -e ml"
        ) from exc
    except ImportError as exc:
        raise PredictorLoadError(f"Importing {ML_INFERENCE_MODULE} failed: {exc}") from exc


def ml_package_available() -> bool:
    """True when ``cardiotwin_ml.inference`` can be imported (used by integration-test skips)."""
    try:
        import_inference_module()
    except PredictorLoadError:
        return False
    return True
