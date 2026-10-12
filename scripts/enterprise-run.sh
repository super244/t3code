#!/usr/bin/env bash
# agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-09
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Color codes
BOLD=$'\033[1m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
CYAN=$'\033[36m'
GRAY=$'\033[90m'
RESET=$'\033[0m'

log_info() {
  echo -e "${CYAN}[ENTERPRISE]${RESET} [$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

log_ok() {
  echo -e "${GREEN}[ENTERPRISE ✔]${RESET} [$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

log_warn() {
  echo -e "${YELLOW}[ENTERPRISE ⚠]${RESET} [$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

log_error() {
  echo -e "${RED}[ENTERPRISE ✖]${RESET} [$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

# Default configuration values
MODE="full" # full | server | web
SERVER_PORT="${T3CODE_PORT:-13773}"
WEB_PORT="${T3CODE_WEB_PORT:-5733}"
HOST="${T3CODE_HOST:-127.0.0.1}"
AUTO_RELOAD=true
RUN_DOCTOR=true
DEV_MODE=false
FORCE_KILL_PORTS=false
DAEMON_MODE=false

print_usage() {
  cat <<EOF
${BOLD}${CYAN}T3 Code Enterprise Production Launcher${RESET}

Usage:
  ./scripts/enterprise-run.sh [options]

Options:
  --mode <full|server|web>   Select components to launch (default: full)
  --server-port <port>       Port for T3 Code backend server (default: 13773)
  --web-port <port>          Port for T3 Code web client (default: 5733)
  --host <host>              Bind host address (default: 127.0.0.1)
  --dev                      Run in development source mode with TypeScript
  --no-reload                Disable supervisor auto-reload on crash
  --doctor                   Run pre-flight enterprise system diagnostics
  --skip-doctor              Skip pre-flight enterprise doctor checks
  --force                    Terminate existing processes blocking required ports
  --help, -h                 Show this help message

Environment Variables:
  T3CODE_PORT                Backend server port
  T3CODE_WEB_PORT            Frontend web port
  T3CODE_HOST                Server listening host
  NODE_OPTIONS               Node.js runtime options (defaults to --max-old-space-size=4096)
EOF
}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --server-port)
      SERVER_PORT="$2"
      shift 2
      ;;
    --web-port)
      WEB_PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --dev)
      DEV_MODE=true
      shift
      ;;
    --no-reload)
      AUTO_RELOAD=false
      shift
      ;;
    --doctor)
      RUN_DOCTOR=true
      shift
      ;;
    --skip-doctor)
      RUN_DOCTOR=false
      shift
      ;;
    --force)
      FORCE_KILL_PORTS=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

echo -e "${BOLD}${CYAN}================================================================${RESET}"
echo -e "${BOLD}${CYAN}          T3 CODE ENTERPRISE RUNNER & PRODUCTION LAUNCHER       ${RESET}"
echo -e "${BOLD}${CYAN}================================================================${RESET}"
log_info "Initializing T3 Code launcher in ${BOLD}${MODE}${RESET} mode..."

# 1. Validate Node.js installation and version
log_info "Validating Node.js environment..."
if ! command -v node >/dev/null 2>&1; then
  log_error "Node.js executable is not installed or not in PATH."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d. -f1)
log_ok "Node.js ${NODE_VERSION} detected."

if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  log_error "T3 Code requires Node.js >= 22 (found v${NODE_VERSION}). Please upgrade your Node runtime."
  exit 1
elif [[ "${NODE_MAJOR}" -lt 24 ]]; then
  log_warn "Node.js v${NODE_VERSION} detected. Production recommended version is Node 24+."
fi

# 2. Validate pnpm installation
log_info "Validating pnpm package manager..."
if ! command -v pnpm >/dev/null 2>&1; then
  log_error "pnpm is not installed. Please install pnpm (e.g. corepack enable && corepack prepare pnpm@11.10.0 --activate)."
  exit 1
fi
PNPM_VERSION=$(pnpm -v)
log_ok "pnpm ${PNPM_VERSION} detected."

# 3. Validate workspace & dependencies
if [[ ! -d "node_modules" ]]; then
  log_warn "node_modules directory is missing. Installing monorepo dependencies..."
  pnpm install --frozen-lockfile || pnpm install
fi

# 4. Port availability checks
is_port_in_use() {
  local port="$1"
  node -e "
    const net = require('node:net');
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        process.exit(1);
      }
      process.exit(0);
    });
    server.once('listening', () => {
      server.close(() => process.exit(0));
    });
    server.listen(${port}, '${HOST}');
  " >/dev/null 2>&1
  return $?
}

get_port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :${port} 2>/dev/null || true
  else
    echo ""
  fi
}

check_and_resolve_port() {
  local name="$1"
  local port="$2"

  if ! is_port_in_use "${port}"; then
    local pids=$(get_port_pids "${port}")
    if [[ -n "${pids}" && "${FORCE_KILL_PORTS}" == "true" ]]; then
      log_warn "Port ${port} (${name}) is currently held by PID(s): ${pids}. Terminating (--force)..."
      kill -15 ${pids} 2>/dev/null || true
      sleep 1
      kill -9 ${pids} 2>/dev/null || true
      sleep 0.5
    elif [[ -n "${pids}" ]]; then
      log_error "Port ${port} (${name}) is already in use by process PID(s): ${pids}."
      log_error "Pass --force to automatically kill existing processes, or set a different port."
      exit 1
    else
      log_error "Port ${port} (${name}) is not available on host ${HOST}."
      exit 1
    fi
  fi
  log_ok "Port ${port} (${name}) is available."
}

if [[ "${MODE}" == "full" || "${MODE}" == "server" ]]; then
  check_and_resolve_port "Server" "${SERVER_PORT}"
fi

if [[ "${MODE}" == "full" || "${MODE}" == "web" ]]; then
  check_and_resolve_port "Web" "${WEB_PORT}"
fi

# 5. Pre-flight Enterprise Health Doctor
if [[ "${RUN_DOCTOR}" == "true" ]]; then
  log_info "Running Enterprise Doctor pre-flight diagnostics..."
  if node apps/server/src/enterpriseDoctor.ts; then
    log_ok "Enterprise Doctor diagnostics passed."
  else
    log_warn "Enterprise Doctor completed with warnings or non-fatal findings. Proceeding..."
  fi
fi

# 6. Setup enterprise environment
export NODE_ENV="production"
if [[ "${DEV_MODE}" == "true" ]]; then
  export NODE_ENV="development"
fi
export T3CODE_MODE="enterprise"
export T3CODE_PORT="${SERVER_PORT}"
export T3CODE_WEB_PORT="${WEB_PORT}"
export T3CODE_HOST="${HOST}"
export NODE_OPTIONS="--max-old-space-size=4096 ${NODE_OPTIONS:-}"

mkdir -p "${REPO_ROOT}/.run"
mkdir -p "${REPO_ROOT}/.t3/logs"
RUN_PID_FILE="${REPO_ROOT}/.run/t3code-enterprise.pid"
echo "$$" > "${RUN_PID_FILE}"

SERVER_PID=""
WEB_PID=""
SHUTTING_DOWN=false

# 7. Graceful Shutdown Handlers
cleanup_children() {
  if [[ "${SHUTTING_DOWN}" == "true" ]]; then
    return
  fi
  SHUTTING_DOWN=true

  echo ""
  log_info "Initiating graceful shutdown of T3 Code enterprise processes..."

  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    log_info "Stopping T3 Code Server (PID: ${SERVER_PID})..."
    kill -15 "${SERVER_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    log_info "Stopping T3 Code Web (PID: ${WEB_PID})..."
    kill -15 "${WEB_PID}" 2>/dev/null || true
  fi

  # Grace period wait
  local wait_seconds=5
  log_info "Waiting up to ${wait_seconds}s for clean process termination..."
  for ((i=1; i<=wait_seconds; i++)); do
    local still_alive=false
    if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
      still_alive=true
    fi
    if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
      still_alive=true
    fi
    if [[ "${still_alive}" == "false" ]]; then
      break
    fi
    sleep 1
  done

  # Force kill if still hanging
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    log_warn "Server did not terminate gracefully; sending SIGKILL..."
    kill -9 "${SERVER_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    log_warn "Web client did not terminate gracefully; sending SIGKILL..."
    kill -9 "${WEB_PID}" 2>/dev/null || true
  fi

  rm -f "${RUN_PID_FILE}" 2>/dev/null || true
  log_ok "T3 Code enterprise runner shutdown complete."
}

trap cleanup_children SIGINT SIGTERM SIGHUP EXIT

# 8. Launch Server Process
launch_server() {
  log_info "Starting T3 Code Server on http://${HOST}:${SERVER_PORT}..."
  if [[ "${DEV_MODE}" == "true" ]]; then
    node --watch apps/server/src/bin.ts &
    SERVER_PID=$!
  elif [[ -f "apps/server/dist/bin.mjs" ]]; then
    node apps/server/dist/bin.mjs &
    SERVER_PID=$!
  else
    log_warn "apps/server/dist/bin.mjs not found. Running from src with node..."
    node apps/server/src/bin.ts &
    SERVER_PID=$!
  fi
  log_ok "Server process started with PID: ${SERVER_PID}"
}

# 9. Launch Web Process
launch_web() {
  log_info "Starting T3 Code Web client on http://${HOST}:${WEB_PORT}..."
  if [[ "${DEV_MODE}" == "true" ]]; then
    pnpm exec vp run --filter @t3tools/web dev --port "${WEB_PORT}" --host "${HOST}" &
    WEB_PID=$!
  elif [[ -d "apps/web/dist" ]]; then
    pnpm exec vp run --filter @t3tools/web preview --port "${WEB_PORT}" --host "${HOST}" &
    WEB_PID=$!
  else
    log_warn "apps/web/dist not found. Running web dev server..."
    pnpm exec vp run --filter @t3tools/web dev --port "${WEB_PORT}" --host "${HOST}" &
    WEB_PID=$!
  fi
  log_ok "Web client process started with PID: ${WEB_PID}"
}

if [[ "${MODE}" == "full" || "${MODE}" == "server" ]]; then
  launch_server
fi

if [[ "${MODE}" == "full" || "${MODE}" == "web" ]]; then
  launch_web
fi

echo -e "${BOLD}${GREEN}================================================================${RESET}"
echo -e "${BOLD}${GREEN}  T3 CODE ENTERPRISE CLUSTER ACTIVE                             ${RESET}"
if [[ -n "${SERVER_PID}" ]]; then
  echo -e "  Backend Server:  ${BOLD}http://${HOST}:${SERVER_PORT}${RESET} (PID: ${SERVER_PID})"
fi
if [[ -n "${WEB_PID}" ]]; then
  echo -e "  Web Interface:   ${BOLD}http://${HOST}:${WEB_PORT}${RESET} (PID: ${WEB_PID})"
fi
echo -e "  PID File:        ${GRAY}${RUN_PID_FILE}${RESET}"
echo -e "  Auto-Reload:     ${AUTO_RELOAD}"
echo -e "  Press ${BOLD}Ctrl+C${RESET} for graceful shutdown."
echo -e "${BOLD}${GREEN}================================================================${RESET}"

# 10. Process Supervisor Loop with Auto-Reload on unexpected crash
while [[ "${SHUTTING_DOWN}" == "false" ]]; do
  sleep 2

  if [[ -n "${SERVER_PID}" ]] && ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    if [[ "${SHUTTING_DOWN}" == "true" ]]; then
      break
    fi
    log_error "T3 Code Server process (PID: ${SERVER_PID}) exited unexpectedly!"
    if [[ "${AUTO_RELOAD}" == "true" ]]; then
      log_warn "Auto-Reload: Restarting T3 Code Server in 2s..."
      sleep 2
      launch_server
    else
      log_error "Auto-Reload disabled. Exiting..."
      exit 1
    fi
  fi

  if [[ -n "${WEB_PID}" ]] && ! kill -0 "${WEB_PID}" 2>/dev/null; then
    if [[ "${SHUTTING_DOWN}" == "true" ]]; then
      break
    fi
    log_error "T3 Code Web process (PID: ${WEB_PID}) exited unexpectedly!"
    if [[ "${AUTO_RELOAD}" == "true" ]]; then
      log_warn "Auto-Reload: Restarting T3 Code Web in 2s..."
      sleep 2
      launch_web
    else
      log_error "Auto-Reload disabled. Exiting..."
      exit 1
    fi
  fi
done
