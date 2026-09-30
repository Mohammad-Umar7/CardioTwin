"""Shared fixtures: isolated settings, a deterministic FakePredictor and TestClient factories."""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:  # allow `pytest backend/tests` from anywhere
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.predictors.base import Predictor  # noqa: E402
from app.predictors.fake import FakePredictor  # noqa: E402


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Settings that never touch the real repository artifacts or frontend build."""
    return Settings(
        artifacts_dir=tmp_path / "artifacts",
        predictor="fake",
        serve_frontend=False,
        frontend_dist=tmp_path / "dist",
        model_card_path=tmp_path / "MODEL_CARD.md",
        log_level="WARNING",
        log_format="text",
    )


@pytest.fixture
def predictor() -> FakePredictor:
    return FakePredictor()


ClientFactory = Callable[..., TestClient]


@pytest.fixture
def make_client(settings: Settings, predictor: FakePredictor) -> Iterator[ClientFactory]:
    """Build a started TestClient; keyword arguments override settings (``predictor=`` swaps the model)."""
    opened: list[TestClient] = []

    def factory(*, predictor_override: Predictor | None = None, **overrides: Any) -> TestClient:
        app = create_app(settings.with_overrides(**overrides) if overrides else settings,
                         predictor=predictor_override or predictor)
        client = TestClient(app)
        client.__enter__()
        opened.append(client)
        return client

    yield factory
    for client in opened:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return make_client()


@pytest.fixture
def schema_features(predictor: FakePredictor) -> dict[str, dict[str, Any]]:
    return {f["key"]: f for f in predictor.schema["features"]}
