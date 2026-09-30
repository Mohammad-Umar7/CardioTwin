# CardioTwin - one-command workflows. Every target delegates to scripts/dev.sh (Linux, macOS, Git Bash);
# on Windows without make use the same targets through PowerShell: .\scripts\dev.ps1 <target>
#
#   make setup                       .venv (Python 3.11) with the pinned ML stack + API + test tools, npm ci
#   make dev                         API :8000 (reload) + Vite :5173, /api proxied; Ctrl+C stops both
#   make dev BACKEND_PORT=8010 FRONTEND_PORT=5180
#   make serve [PORT=8000]           one process serving frontend/dist and the API (builds dist if missing)
#   make build [BASE=/CardioTwin/]   production SPA build (BASE for sub-path hosting such as GitHub Pages)
#   make test                        ML, anatomy, API, tooling tests + frontend typecheck, lint, unit tests
#   make lint                        ruff + mypy + eslint
#   make train [ARGS=--fast]         retrain the models and republish the artifacts
#   make anatomy [ARGS=...]          rebuild the 3D anatomy assets (Blender 5.1)
#   make e2e [BACKEND_PORT=8000]     end-to-end check of a running API
#   make smoke                       start dev + serve on spare ports, verify end to end, stop

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

DEV := bash scripts/dev.sh
BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 5173
PORT ?= 8000
HOST ?= 127.0.0.1
BASE ?=
ARGS ?=

export BACKEND_PORT FRONTEND_PORT PORT HOST

.PHONY: help setup dev serve build test lint train anatomy e2e smoke

help:
	@awk '/^#/ { sub(/^# ?/, ""); print; next } { exit }' $(firstword $(MAKEFILE_LIST))

setup:
	$(DEV) setup

dev:
	$(DEV) dev

serve:
	$(DEV) serve

build:
	$(DEV) build $(if $(BASE),--base $(BASE),)

test:
	$(DEV) test

lint:
	$(DEV) lint

train:
	$(DEV) train $(ARGS)

anatomy:
	$(DEV) anatomy $(ARGS)

e2e:
	$(DEV) e2e $(ARGS)

smoke:
	$(DEV) dev --smoke --backend-port 8010 --frontend-port 5180
	$(DEV) serve --smoke --port 8012
