"""Single-URL demo: the built SPA served at / next to the API."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.frontend import is_spa_route

INDEX = "<!doctype html><html><body><div id=root></div><script type=module src=/assets/app-3f9a.js></script>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "anatomy").mkdir()
    (root / "model").mkdir()
    (root / "index.html").write_text(INDEX, encoding="utf-8")
    (root / "assets" / "app-3f9a.js").write_text("console.log('cardiotwin')", encoding="utf-8")
    (root / "assets" / "app-3f9a.css").write_text("body{margin:0}", encoding="utf-8")
    (root / "anatomy" / "cardiotwin_anatomy.glb").write_bytes(b"glTF" + bytes(64))
    (root / "model" / "model.json").write_text('{"columns": []}', encoding="utf-8")
    return root


@pytest.fixture
def spa(make_client: Any, dist: Path) -> TestClient:
    client: TestClient = make_client(serve_frontend=True, frontend_dist=dist)
    return client


def test_index_is_served_at_root(spa: TestClient) -> None:
    response = spa.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id=root' in response.text
    assert response.headers["Cache-Control"] == "no-cache"


@pytest.mark.parametrize("route", ["/patients/P-017", "/explain", "/vessel/lad/details"])
def test_client_side_routes_fall_back_to_index(spa: TestClient, route: str) -> None:
    response = spa.get(route)
    assert response.status_code == 200
    assert response.text == INDEX
    assert response.headers["Cache-Control"] == "no-cache"


def test_hashed_assets_are_immutable_with_correct_types(spa: TestClient) -> None:
    js = spa.get("/assets/app-3f9a.js")
    assert js.status_code == 200
    assert js.headers["content-type"].startswith("text/javascript")
    assert js.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert spa.get("/assets/app-3f9a.css").headers["content-type"].startswith("text/css")


def test_3d_and_model_files_are_served(spa: TestClient) -> None:
    glb = spa.get("/anatomy/cardiotwin_anatomy.glb")
    assert glb.status_code == 200
    assert glb.headers["content-type"] == "model/gltf-binary"
    assert glb.content.startswith(b"glTF")
    assert glb.headers["Cache-Control"] == "no-cache"
    assert spa.get("/model/model.json").json() == {"columns": []}


def test_missing_files_are_404_not_html(spa: TestClient) -> None:
    for path in ("/anatomy/missing.glb", "/assets/gone-123.js", "/favicon.ico"):
        response = spa.get(path)
        assert response.status_code == 404, path
        assert "html" not in response.headers.get("content-type", "")


def test_api_keeps_priority_and_unknown_api_paths_stay_json(spa: TestClient) -> None:
    assert spa.get("/api/health").json()["frontend_served"] is True
    response = spa.get("/api/unknown/thing")
    assert response.status_code == 404
    assert response.json()["error"] == "not_found"
    assert spa.get("/docs").status_code == 200
    assert spa.get("/openapi.json").json()["info"]["title"] == "CardioTwin API"


def test_conditional_requests_on_static_files(spa: TestClient) -> None:
    first = spa.get("/anatomy/cardiotwin_anatomy.glb")
    etag = first.headers["etag"]
    assert spa.get("/anatomy/cardiotwin_anatomy.glb", headers={"If-None-Match": etag}).status_code == 304


def test_frontend_disabled_serves_api_root_document(make_client: Any, dist: Path) -> None:
    client = make_client(serve_frontend=False, frontend_dist=dist)
    assert client.get("/").json()["docs"] == "/docs"
    assert client.get("/patients/P-017").status_code == 404


def test_missing_build_falls_back_to_api_only(make_client: Any, tmp_path: Path) -> None:
    client = make_client(serve_frontend=True, frontend_dist=tmp_path / "not-built")
    assert client.get("/api/health").json()["frontend_served"] is False
    assert "frontend" in client.get("/").json()


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("", True),
        ("patients/P-017", True),
        ("apical-view", True),
        ("api/x", False),
        ("api", False),
        ("docs/extra", False),
        ("anatomy/heart.glb", False),
        ("favicon.ico", False),
    ],
)
def test_is_spa_route(path: str, expected: bool) -> None:
    assert is_spa_route(path) is expected
