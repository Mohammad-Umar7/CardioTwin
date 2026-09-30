#!/usr/bin/env bash
# CardioTwin developer entry point (Linux, macOS, Git Bash on Windows). `make <target>` calls this script.
#
#   bash scripts/dev.sh setup                 create ./.venv (Python 3.11), install ML + API + test deps, npm ci
#   bash scripts/dev.sh dev                   API (uvicorn --reload) + Vite dev server, Ctrl+C stops both
#   bash scripts/dev.sh serve                 one process: uvicorn serving frontend/dist + the API (builds dist if missing)
#   bash scripts/dev.sh build [--base PATH]   production build of the SPA into frontend/dist
#   bash scripts/dev.sh test                  ML, anatomy, API and tooling tests + frontend typecheck, lint, unit tests
#   bash scripts/dev.sh lint                  ruff + mypy (backend, scripts) and eslint (frontend)
#   bash scripts/dev.sh train [args]          retrain the models (python -m cardiotwin_ml.train [args])
#   bash scripts/dev.sh anatomy [args]        rebuild the 3D anatomy assets (needs Blender 5.1, see anatomy/README.md)
#   bash scripts/dev.sh e2e [args]            end-to-end check of a running API (scripts/e2e_check.py)
#
# Options (or the environment variables in brackets):
#   --backend-port N   [BACKEND_PORT, default 8000]    API port for `dev`
#   --frontend-port N  [FRONTEND_PORT, default 5173]   Vite port for `dev`
#   --port N           [PORT, default 8000]            port for `serve`
#   --host H           [HOST, default 127.0.0.1]       bind address
#   --smoke            [SMOKE=1]                        `dev`/`serve`: start, verify end to end, stop, exit 0/1
#   --rebuild                                           `serve`: rebuild frontend/dist first
#   PYTHON=/path/to/python3.11                          interpreter used to create ./.venv
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
SMOKE="${SMOKE:-0}"
REBUILD=0
BASE_PATH=""

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN*) IS_WINDOWS=1 ;;
  *) IS_WINDOWS=0 ;;
esac
if [ "$IS_WINDOWS" = 1 ]; then VENV_PY="$ROOT/.venv/Scripts/python.exe"; else VENV_PY="$ROOT/.venv/bin/python"; fi

if [ -t 1 ]; then BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""; fi
say() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok() { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
die() { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }

# ---------------------------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------------------------

find_base_python() {
  local candidate
  for candidate in ${PYTHON:-} python3.11 python3 python "py -3.11"; do
    [ -n "$candidate" ] || continue
    if $candidate -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 11) else 1)' >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

require_node() {
  command -v node >/dev/null 2>&1 || die "Node.js 22 (>= 20.19) is required: https://nodejs.org"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=19)?0:1)' \
    || die "Node.js >= 20.19 is required (found $(node --version)); CI uses Node 22"
}

ensure_python() {
  [ -x "$VENV_PY" ] || { say "No ./.venv yet - running setup"; cmd_setup; }
}

ensure_node_modules() {
  require_node
  [ -d frontend/node_modules ] || { say "Installing frontend dependencies (npm ci)"; npm ci --prefix frontend --no-audit --no-fund; }
}

# ---------------------------------------------------------------------------------------------
# Process management (dev / serve)
# ---------------------------------------------------------------------------------------------

PIDS=()

# Network probes go through scripts/probe.py so this runner and scripts/dev.ps1 behave identically.
port_in_use() { "$VENV_PY" scripts/probe.py port "$1"; }

assert_port_free() { # port label option
  if port_in_use "$1"; then
    die "port $1 for the $2 is already in use; stop that process or pick another port, e.g. $3 $(($1 + 10))"
  fi
}

# Exit status 0 only for HTTP 2xx (and, with a second argument KEY=VALUE, that top-level JSON field).
url_ok() { "$VENV_PY" scripts/probe.py get "$1" --quiet ${2:+--json-field "$2"}; }

wait_for() { # url label timeout_s pid
  local url=$1 label=$2 timeout=$3 pid=$4 waited=0
  until url_ok "$url"; do
    kill -0 "$pid" 2>/dev/null || die "$label exited during startup"
    [ "$waited" -lt "$timeout" ] || die "$label did not answer $url within ${timeout}s"
    sleep 1
    waited=$((waited + 1))
  done
  ok "$label ready: $url"
}

kill_tree() {
  local pid=$1
  kill -0 "$pid" 2>/dev/null || return 0
  if [ "$IS_WINDOWS" = 1 ] && [ -r "/proc/$pid/winpid" ]; then
    # Native Windows children (python.exe reload workers, node.exe) are not MSYS processes: kill the tree.
    taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1 || true
  fi
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  trap - INT TERM EXIT
  if [ "${#PIDS[@]}" -gt 0 ]; then
    say "Stopping ${#PIDS[@]} process(es)"
    for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
    wait 2>/dev/null || true
  fi
  exit "$status"
}

start_bg() { # label, command...
  local label=$1
  shift
  "$@" &
  PIDS+=("$!")
  printf '%s  started %s (pid %s)%s\n' "$DIM" "$label" "$!" "$RESET"
}

watch_processes() {
  while :; do
    for pid in "${PIDS[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" 2>/dev/null && status=0 || status=$?
        die "a service exited (pid $pid, status $status); stopping the others"
      fi
    done
    sleep 1
  done
}

# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

cmd_setup() {
  local base
  if [ ! -x "$VENV_PY" ]; then
    base="$(find_base_python)" || die "Python 3.11 is required (set PYTHON=/path/to/python3.11)"
    say "Creating ./.venv with $base ($($base --version 2>&1))"
    $base -m venv "$ROOT/.venv"
  fi
  "$VENV_PY" -c 'import sys; v=sys.version_info[:2]; sys.exit(0 if v >= (3, 11) else 1)' \
    || die ".venv uses $("$VENV_PY" --version 2>&1); Python >= 3.11 is required - delete .venv and rerun"
  "$VENV_PY" -c 'import sys; v=sys.version_info[:2]; v == (3, 11) or print("warning: artifacts and pins were produced with Python 3.11; found %d.%d" % v)'
  say "Installing Python dependencies (ML pinned stack, API, test and lint tools)"
  "$VENV_PY" -m pip install --disable-pip-version-check --upgrade pip
  "$VENV_PY" -m pip install --disable-pip-version-check -r scripts/requirements-dev.txt
  "$VENV_PY" -m pip install --disable-pip-version-check -e ml -c scripts/constraints.txt
  require_node
  say "Installing frontend dependencies (npm ci)"
  npm ci --prefix frontend --no-audit --no-fund
  say "Installing anatomy QA tooling (npm ci)"
  npm ci --prefix anatomy --no-audit --no-fund
  ok "setup complete - next: scripts/dev.sh dev"
}

cmd_dev() {
  ensure_python
  ensure_node_modules
  assert_port_free "$BACKEND_PORT" "API" --backend-port
  assert_port_free "$FRONTEND_PORT" "Vite dev server" --frontend-port
  set -m # every background job gets its own process group, so cleanup can stop whole trees
  trap cleanup INT TERM EXIT
  say "Starting API on http://$HOST:$BACKEND_PORT and Vite on http://$HOST:$FRONTEND_PORT"
  CARDIOTWIN_LOG_FORMAT="${CARDIOTWIN_LOG_FORMAT:-text}" \
    CARDIOTWIN_SERVE_FRONTEND="${CARDIOTWIN_SERVE_FRONTEND:-0}" \
    CARDIOTWIN_CORS_ORIGINS="${CARDIOTWIN_CORS_ORIGINS:-http://$HOST:$FRONTEND_PORT,http://localhost:$FRONTEND_PORT}" \
    start_bg "API" "$VENV_PY" -m uvicorn app.main:app --app-dir backend --host "$HOST" --port "$BACKEND_PORT" \
    --reload --reload-dir backend/app --reload-dir ml/src
  VITE_API_PROXY="http://$HOST:$BACKEND_PORT" \
    start_bg "Vite" npm --prefix frontend run dev -- --host "$HOST" --port "$FRONTEND_PORT" --strictPort
  wait_for "http://$HOST:$BACKEND_PORT/api/health" "API" 180 "${PIDS[0]}"
  wait_for "http://$HOST:$FRONTEND_PORT/" "Vite" 120 "${PIDS[1]}"
  url_ok "http://$HOST:$FRONTEND_PORT/api/health" status=ok || die "Vite does not proxy /api to the API"
  ok "Vite proxies /api -> API"
  printf '\n  %sApp%s  http://%s:%s\n  %sAPI%s  http://%s:%s/docs\n\n' \
    "$BOLD" "$RESET" "$HOST" "$FRONTEND_PORT" "$BOLD" "$RESET" "$HOST" "$BACKEND_PORT"
  if [ "$SMOKE" = 1 ]; then
    ok "smoke test passed"
    exit 0
  fi
  say "Press Ctrl+C to stop both"
  watch_processes
}

cmd_build() {
  ensure_node_modules
  if [ -n "$BASE_PATH" ]; then
    say "Building the SPA with base $BASE_PATH"
    npm --prefix frontend run build -- --base "$BASE_PATH"
  else
    say "Building the SPA"
    npm --prefix frontend run build
  fi
  ok "frontend/dist"
}

cmd_serve() {
  ensure_python
  if [ "$REBUILD" = 1 ] || [ ! -f frontend/dist/index.html ]; then cmd_build; fi
  assert_port_free "$PORT" "server" --port
  set -m
  trap cleanup INT TERM EXIT
  say "Serving the app and the API from one process on http://$HOST:$PORT"
  CARDIOTWIN_SERVE_FRONTEND=1 CARDIOTWIN_LOG_FORMAT="${CARDIOTWIN_LOG_FORMAT:-text}" \
    start_bg "server" "$VENV_PY" -m uvicorn app.main:app --app-dir backend --host "$HOST" --port "$PORT"
  wait_for "http://$HOST:$PORT/api/health" "server" 180 "${PIDS[0]}"
  printf '\n  %sApp%s  http://%s:%s\n  %sAPI%s  http://%s:%s/docs\n\n' \
    "$BOLD" "$RESET" "$HOST" "$PORT" "$BOLD" "$RESET" "$HOST" "$PORT"
  if [ "$SMOKE" = 1 ]; then
    "$VENV_PY" scripts/e2e_check.py --url "http://$HOST:$PORT" --wait 120 --latency-n 20
    exit $?
  fi
  say "Press Ctrl+C to stop"
  watch_processes
}

cmd_test() {
  ensure_python
  ensure_node_modules
  say "ML tests";        "$VENV_PY" -m pytest ml/tests -q
  say "Anatomy tests";   "$VENV_PY" -m pytest anatomy -q
  say "API tests";       "$VENV_PY" -m pytest backend -q
  say "Tooling tests";   "$VENV_PY" -m pytest scripts/tests -q
  say "Frontend typecheck"; npm --prefix frontend run typecheck
  say "Frontend lint";      npm --prefix frontend run lint
  say "Frontend tests";     npm --prefix frontend test
  ok "all tests passed"
}

cmd_lint() {
  ensure_python
  ensure_node_modules
  say "ruff";  "$VENV_PY" -m ruff check backend scripts && (cd ml && "$VENV_PY" -m ruff check .)
  say "mypy";  (cd backend && "$VENV_PY" -m mypy app) && "$VENV_PY" -m mypy --strict --ignore-missing-imports scripts/e2e_check.py scripts/probe.py scripts/runtime_requirements.py
  say "eslint"; npm --prefix frontend run lint
  ok "lint clean"
}

main() {
  local command="${1:-help}"
  [ "$#" -gt 0 ] && shift
  local passthrough=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --backend-port) BACKEND_PORT="$2"; shift 2 ;;
      --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --host) HOST="$2"; shift 2 ;;
      --smoke) SMOKE=1; shift ;;
      --rebuild) REBUILD=1; shift ;;
      --base) BASE_PATH="$2"; shift 2 ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done
  case "$command" in
    setup) cmd_setup ;;
    dev) cmd_dev ;;
    serve) cmd_serve ;;
    build) cmd_build ;;
    test) cmd_test ;;
    lint) cmd_lint ;;
    train) ensure_python; "$VENV_PY" -m cardiotwin_ml.train ${passthrough[@]+"${passthrough[@]}"} ;;
    anatomy) ensure_python; "$VENV_PY" anatomy/build.py ${passthrough[@]+"${passthrough[@]}"} ;;
    e2e) ensure_python; "$VENV_PY" scripts/e2e_check.py --url "http://$HOST:$BACKEND_PORT" ${passthrough[@]+"${passthrough[@]}"} ;;
    help | -h | --help) usage ;;
    *) usage; die "unknown command '$command'" ;;
  esac
}

main "$@"
