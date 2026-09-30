"""Predictor loading: actionable failures, the lazy cardiotwin_ml import and startup behaviour."""

from __future__ import annotations

import sys
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import StartupError, create_app
from app.predictors import loader
from app.predictors.base import PredictorLoadError, missing_members
from app.predictors.fake import FakePredictor
from app.predictors.loader import REQUIRED_ARTIFACTS, load_predictor, load_real_predictor


def write_artifacts(directory: Path, skip: tuple[str, ...] = ()) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_ARTIFACTS:
        if name not in skip:
            (directory / name).write_bytes(b"{}")
    return directory


@pytest.fixture
def stub_ml_package(monkeypatch: pytest.MonkeyPatch) -> Iterator[types.ModuleType]:
    """Install an in-memory ``cardiotwin_ml.inference`` whose predictor is a FakePredictor."""

    class CardioTwinPredictor(FakePredictor):
        loaded_from: Path | None = None

        @classmethod
        def load(cls, artifacts_dir: Any) -> CardioTwinPredictor:
            instance = cls(version="1.0.0")
            instance.loaded_from = Path(artifacts_dir)
            return instance

    package = types.ModuleType("cardiotwin_ml")
    package.__path__ = []
    inference = types.ModuleType("cardiotwin_ml.inference")
    inference.CardioTwinPredictor = CardioTwinPredictor  # type: ignore[attr-defined]
    package.inference = inference  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "cardiotwin_ml", package)
    monkeypatch.setitem(sys.modules, "cardiotwin_ml.inference", inference)
    yield inference


def test_fake_predictor_is_selected_explicitly(settings: Settings) -> None:
    assert isinstance(load_predictor(settings), FakePredictor)
    assert missing_members(FakePredictor()) == []


def test_missing_artifacts_directory_explains_the_fix(tmp_path: Path) -> None:
    with pytest.raises(PredictorLoadError) as info:
        load_real_predictor(tmp_path / "nowhere")
    message = str(info.value)
    assert "not found" in message
    assert "CARDIOTWIN_ARTIFACTS" in message
    assert "CARDIOTWIN_PREDICTOR=fake" in message


def test_incomplete_artifacts_list_missing_files(tmp_path: Path) -> None:
    directory = write_artifacts(tmp_path / "art", skip=("cardiotwin_models.joblib", "cohort.json"))
    with pytest.raises(PredictorLoadError, match=r"missing: cohort\.json, cardiotwin_models\.joblib"):
        load_real_predictor(directory)


def test_real_loader_uses_cardiotwin_ml(tmp_path: Path, stub_ml_package: types.ModuleType) -> None:
    directory = write_artifacts(tmp_path / "art")
    predictor = load_real_predictor(directory)
    assert predictor.version == "1.0.0"
    assert predictor.loaded_from == directory  # type: ignore[attr-defined]


def test_load_exceptions_are_wrapped(tmp_path: Path, stub_ml_package: types.ModuleType,
                                     monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(cls: type, artifacts_dir: Any) -> None:
        raise ValueError("model trained with xgboost 9")

    monkeypatch.setattr(stub_ml_package.CardioTwinPredictor, "load", classmethod(explode))
    with pytest.raises(PredictorLoadError, match="ValueError: model trained with xgboost 9"):
        load_real_predictor(write_artifacts(tmp_path / "art"))


def test_predictor_missing_contract_members_is_rejected(tmp_path: Path, stub_ml_package: types.ModuleType,
                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    class Incomplete:
        schema: dict[str, Any] = {}
        version = "x"

    monkeypatch.setattr(stub_ml_package.CardioTwinPredictor, "load", classmethod(lambda cls, d: Incomplete()))
    with pytest.raises(PredictorLoadError, match="missing contract members: metrics, cohort, predict"):
        load_real_predictor(write_artifacts(tmp_path / "art"))


def test_missing_ml_package_explains_how_to_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # None entries make the import fail even if the real package was imported earlier in the session.
    monkeypatch.setitem(sys.modules, "cardiotwin_ml", None)
    monkeypatch.setitem(sys.modules, "cardiotwin_ml.inference", None)
    monkeypatch.setattr(loader, "ML_SRC_DIR", tmp_path / "no-src")
    with pytest.raises(PredictorLoadError, match="pip install -e ml"):
        load_real_predictor(write_artifacts(tmp_path / "art"))
    assert loader.ml_package_available() is False


def test_ml_src_checkout_is_added_to_sys_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src = tmp_path / "src"
    (src / "cardiotwin_ml_probe").mkdir(parents=True)
    (src / "cardiotwin_ml_probe" / "__init__.py").write_text("", encoding="utf-8")
    (src / "cardiotwin_ml_probe" / "inference.py").write_text("VALUE = 42\n", encoding="utf-8")
    monkeypatch.setattr(loader, "ML_SRC_DIR", src)
    monkeypatch.setattr(loader, "ML_PACKAGE", "cardiotwin_ml_probe")
    monkeypatch.setattr(loader, "ML_INFERENCE_MODULE", "cardiotwin_ml_probe.inference")
    monkeypatch.setattr(sys, "path", [p for p in sys.path if p != str(src)])
    module = loader.import_inference_module()
    assert module.VALUE == 42
    assert str(src) in sys.path
    for name in ("cardiotwin_ml_probe", "cardiotwin_ml_probe.inference"):
        sys.modules.pop(name, None)


def test_startup_fails_with_a_clear_message(settings: Settings, tmp_path: Path) -> None:
    app = create_app(settings.with_overrides(predictor="real", artifacts_dir=tmp_path / "missing"))
    with pytest.raises(StartupError, match="CardioTwin API cannot start: ML artifacts directory not found"):
        with TestClient(app):
            pass
    assert "not found" in app.state.load_error


def test_startup_loads_the_real_predictor(settings: Settings, tmp_path: Path,
                                          stub_ml_package: types.ModuleType) -> None:
    directory = write_artifacts(tmp_path / "art")
    app = create_app(settings.with_overrides(predictor="real", artifacts_dir=directory))
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        assert health["predictor"] == "real"
        assert health["model_version"] == "1.0.0"
        assert client.post("/api/predict", json={"features": {"Age": 70}}).status_code == 200


def test_schema_exposing_target_columns_aborts_startup(settings: Settings) -> None:
    class Leaky(FakePredictor):
        def __init__(self) -> None:
            super().__init__()
            self.schema["features"].append(dict(self.schema["features"][3], key="LAD", label="LAD"))

    with pytest.raises(StartupError, match="leakage"):
        create_app(settings, predictor=Leaky())


def test_requests_before_the_model_is_loaded_get_503(settings: Settings) -> None:
    app = create_app(settings.with_overrides(predictor="real"))
    client = TestClient(app)  # not entered: lifespan (model loading) has not run
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["error"] == "model_not_ready"
    assert response.headers["Retry-After"] == "5"
