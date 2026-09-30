#!/usr/bin/env python3
"""Network probes for the dev runners (``scripts/dev.ps1``, ``scripts/dev.sh``); standard library only.

    python scripts/probe.py port 8010                         exit 0 when something listens on 8010 (IPv4/IPv6 loopback)
    python scripts/probe.py get URL [--json-field status=ok]  print the body; exit 0 on HTTP 2xx (and the JSON field)

Both runners probe through Python on purpose: they then behave identically on every OS, and some Windows
antivirus products quarantine a PowerShell script as soon as it downloads content with Invoke-WebRequest.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence

LOOPBACKS: tuple[tuple[socket.AddressFamily, str], ...] = (
    (socket.AF_INET, "127.0.0.1"),
    (socket.AF_INET6, "::1"),
)


def port_in_use(port: int, timeout: float = 0.3) -> bool:
    """True when a TCP server accepts connections on ``port`` on any loopback address."""
    for family, host in LOOPBACKS:
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except OSError:  # address family unavailable (e.g. no IPv6)
            continue
    return False


def http_get(url: str, timeout: float = 3.0) -> tuple[int, str]:
    """``(status, body)``; status 0 when no HTTP response was received."""
    request = urllib.request.Request(url, headers={"User-Agent": "cardiotwin-dev-probe"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError):
        return 0, ""


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    port = sub.add_parser("port", help="exit 0 if the port is in use")
    port.add_argument("port", type=int)
    get = sub.add_parser("get", help="GET a URL, print the body, exit 0 on 2xx")
    get.add_argument("url")
    get.add_argument("--json-field", default=None, metavar="KEY=VALUE", help="also require this top-level JSON field")
    get.add_argument("--timeout", type=float, default=3.0)
    get.add_argument("--quiet", action="store_true", help="do not print the body")
    args = parser.parse_args(argv)

    if args.command == "port":
        return 0 if port_in_use(args.port) else 1
    status, body = http_get(args.url, args.timeout)
    if not args.quiet:
        sys.stdout.write(body)
    ok = 200 <= status < 300
    if ok and args.json_field:
        key, _, expected = args.json_field.partition("=")
        try:
            document = json.loads(body)
        except ValueError:
            return 1
        ok = isinstance(document, dict) and str(document.get(key)) == expected
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
