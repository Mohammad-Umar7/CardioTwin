"""Settings.from_env parsing and validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import DEFAULT_CORS_ORIGINS, REPO_ROOT, Settings, SettingsError


def test_defaults_point_into_the_repository() -> None:
    settings = Settings.from_env({})
    assert settings.artifacts_dir == REPO_ROOT / "ml" / "artifacts"
    assert settings.frontend_dist == REPO_ROOT / "frontend" / "dist"
    assert settings.model_card_path == REPO_ROOT / "docs" / "MODEL_CARD.md"
    assert settings.predictor == "real"
    assert settings.cors_origins == DEFAULT_CORS_ORIGINS
    assert settings.serve_frontend is True
    assert settings.batch_max_rows == 256


def test_environment_overrides(tmp_path: Path) -> None:
    settings = Settings.from_env(
        {
            "CARDIOTWIN_ARTIFACTS": str(tmp_path / "art"),
            "CARDIOTWIN_PREDICTOR": "FAKE",
            "CARDIOTWIN_CORS_ORIGINS": "https://a.example/, https://b.example",
            "CARDIOTWIN_CACHE_SIZE": "0",
            "CARDIOTWIN_BATCH_MAX_ROWS": "64",
            "CARDIOTWIN_LOG_LEVEL": "debug",
            "CARDIOTWIN_LOG_FORMAT": "TEXT",
            "CARDIOTWIN_GZIP_MIN_SIZE": "10",
            "CARDIOTWIN_MODEL_CARD": str(tmp_path / "card.md"),
        }
    )
    assert settings.artifacts_dir == tmp_path / "art"
    assert settings.predictor == "fake"
    assert settings.cors_origins == ("https://a.example", "https://b.example")
    assert settings.cache_size == 0
    assert settings.batch_max_rows == 64
    assert settings.log_level == "DEBUG"
    assert settings.log_format == "text"
    assert settings.gzip_min_size == 10
    assert settings.model_card_path == tmp_path / "card.md"


def test_relative_paths_resolve_against_the_repository_root() -> None:
    settings = Settings.from_env({"CARDIOTWIN_ARTIFACTS": "ml/other-artifacts"})
    assert settings.artifacts_dir == (REPO_ROOT / "ml" / "other-artifacts").resolve()


@pytest.mark.parametrize(("raw", "enabled"), [("1", True), ("true", True), ("off", False), ("0", False)])
def test_serve_frontend_flag(raw: str, enabled: bool) -> None:
    assert Settings.from_env({"CARDIOTWIN_SERVE_FRONTEND": raw}).serve_frontend is enabled


def test_serve_frontend_accepts_a_path(tmp_path: Path) -> None:
    settings = Settings.from_env({"CARDIOTWIN_SERVE_FRONTEND": str(tmp_path / "build")})
    assert settings.serve_frontend is True
    assert settings.frontend_dist == tmp_path / "build"


def test_frontend_available_requires_an_index(tmp_path: Path) -> None:
    settings = Settings(frontend_dist=tmp_path)
    assert settings.frontend_available is False
    (tmp_path / "index.html").write_text("<html></html>", encoding="utf-8")
    assert settings.frontend_available is True
    assert settings.with_overrides(serve_frontend=False).frontend_available is False


def test_wildcard_cors() -> None:
    assert Settings.from_env({"CARDIOTWIN_CORS_ORIGINS": "https://x.example,*"}).cors_origins == ("*",)


def test_blank_values_are_ignored() -> None:
    assert Settings.from_env({"CARDIOTWIN_PREDICTOR": "  "}).predictor == "real"


@pytest.mark.parametrize(
    ("env", "fragment"),
    [
        ({"CARDIOTWIN_CACHE_SIZE": "lots"}, "CARDIOTWIN_CACHE_SIZE must be an integer"),
        ({"CARDIOTWIN_PREDICTOR": "gpu"}, "predictor must be one of"),
        ({"CARDIOTWIN_BATCH_MAX_ROWS": "1000"}, "batch_max_rows must be between 1 and 256"),
        ({"CARDIOTWIN_BATCH_MAX_ROWS": "0"}, "batch_max_rows must be between 1 and 256"),
        ({"CARDIOTWIN_LOG_FORMAT": "xml"}, "log_format must be one of"),
        ({"CARDIOTWIN_CACHE_SIZE": "-1"}, "cache_size must be >= 0"),
    ],
)
def test_invalid_values_fail_fast(env: dict[str, str], fragment: str) -> None:
    with pytest.raises(SettingsError, match=fragment):
        Settings.from_env(env)
