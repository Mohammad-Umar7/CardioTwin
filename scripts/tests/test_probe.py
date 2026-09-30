"""Tests for ``scripts/probe.py`` (the network probe behind ``dev.ps1`` / ``dev.sh``)."""

from __future__ import annotations

import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import probe


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        routes = {"/health": (200, {"status": "ok"}), "/down": (200, {"status": "down"}), "/text": (200, "plain")}
        status, payload = routes.get(self.path, (404, {"error": "not_found"}))
        body = (json.dumps(payload) if isinstance(payload, dict) else payload).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # silence test output
        return


@pytest.fixture(scope="module")
def server() -> Iterator[str]:
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
    return port


def test_port_probe_sees_listeners_only(server: str) -> None:
    port = int(server.rsplit(":", 1)[1])
    assert probe.port_in_use(port)
    assert probe.main(["port", str(port)]) == 0
    free = _free_port()
    assert not probe.port_in_use(free)
    assert probe.main(["port", str(free)]) == 1


def test_get_reports_status_and_body(server: str) -> None:
    assert probe.http_get(f"{server}/health") == (200, '{"status": "ok"}')
    assert probe.http_get(f"{server}/missing")[0] == 404
    assert probe.http_get(f"http://127.0.0.1:{_free_port()}/", timeout=1.0) == (0, "")


def test_get_exit_codes_and_json_field(server: str, capsys: pytest.CaptureFixture[str]) -> None:
    assert probe.main(["get", f"{server}/health"]) == 0
    assert '"status": "ok"' in capsys.readouterr().out
    assert probe.main(["get", f"{server}/health", "--quiet", "--json-field", "status=ok"]) == 0
    assert capsys.readouterr().out == ""
    assert probe.main(["get", f"{server}/down", "--quiet", "--json-field", "status=ok"]) == 1
    assert probe.main(["get", f"{server}/text", "--quiet", "--json-field", "status=ok"]) == 1
    assert probe.main(["get", f"{server}/missing", "--quiet"]) == 1
