#!/usr/bin/env bash
# The one door to the tower (`workkit tower`, `npm run tower`): restarts the
# JSON API and the dashboard together, filtered quiet through startup, and ends
# both when either ends. WORKKIT_TOWER_API / _APP / _PORTS let the suite run it
# without real servers or ports. The behavior: tower/README.md § Run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The engine's voice for the tower's own lines (workflow/README.md § Output).
# shellcheck source=../workflow/lib.sh
. "$ROOT/workflow/lib.sh"

PORTS="${WORKKIT_TOWER_PORTS-8693 4300}"

# The dashboard's port is the second of the two.
# shellcheck disable=SC2206  # word splitting is the point: PORTS is a list
PORT_LIST=($PORTS)
APP_PORT="${PORT_LIST[1]:-}"

VERBOSE="${WORKKIT_TOWER_VERBOSE:-}"
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
  esac
done

# A half writing to a fifo sees a non-tty and drops its colors; force them back
# only when our own stdout is a terminal and the caller set no FORCE_COLOR.
if [ -t 1 ] && [ -z "${FORCE_COLOR+set}" ]; then
  export FORCE_COLOR=1
fi

# Printed first, so a quiet startup never shows an empty terminal.
wk_ok "starting the dashboard"

# End the whole tree: npm and omega put children between our pid and the
# server, and killing only the parent leaves them serving. Bare `kill`, not
# `wk_end_pid`: these are this shell's own (MSYS) pids. Without pgrep (Git
# Bash) only the named process ends, the same limit as the commit gate's.
end_tree() {
  local pid kid
  pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    for kid in $(pgrep -P "$pid" 2>/dev/null); do end_tree "$kid"; done
  fi
  kill "$pid" 2>/dev/null || true
}

# Take a port back, escalating, and fail loudly rather than start onto an
# occupied port. Free means the lookup answers nothing, never a nonzero exit:
# the platform seam's two tools disagree about that status.
reclaim() {
  local port pid deadline
  port="$1"
  for pid in $(wk_port_pids "$port"); do
    wk_info "replacing what was listening on port $port (pid $pid)"
    wk_end_pid "$pid" 2>/dev/null || true
  done
  deadline=$((SECONDS + 5))
  while [ "$SECONDS" -lt "$deadline" ] && [ -n "$(wk_port_pids "$port")" ]; do
    sleep 1
  done
  for pid in $(wk_port_pids "$port"); do
    wk_end_pid -9 "$pid" 2>/dev/null || true
  done
  deadline=$((SECONDS + 3))
  while [ "$SECONDS" -lt "$deadline" ] && [ -n "$(wk_port_pids "$port")" ]; do
    sleep 1
  done
  if [ -n "$(wk_port_pids "$port")" ]; then
    wk_error "could not free port $port; its listener survived both signals, so nothing is started onto an occupied port"
    exit 1
  fi
}

for port in $PORTS; do reclaim "$port"; done

PIDS=()
FILTERS=()
FIFO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workkit-tower.XXXXXX")"
# Set first in cleanup, which removes the announce marker the down-taker reads:
# a tower killed from outside must read as a shutdown, not a failed boot.
SHUTDOWN=''
cleanup() {
  local pid
  SHUTDOWN=1
  # Guarded: bash 3.2 treats an empty array as unbound under `set -u`.
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do end_tree "$pid"; done
  fi
  # The filters sit beside the halves, not in their trees, so end them by pid.
  if [ "${#FILTERS[@]}" -gt 0 ]; then
    for pid in "${FILTERS[@]}"; do kill "$pid" 2>/dev/null || true; done
  fi
  rm -rf "$FIFO_DIR"
}
trap cleanup EXIT INT TERM

# What survives the quiet phase: problem words, plus omega's own `omega: `
# prefix, which carries its boot refusals (tower/README.md § Run).
KEEP_RE='error|warn|fail|fatal|exception|EADDR|ENOENT|EACCES|not found|cannot find module|missing binding|segmentation fault|killed:|npm ERR!|taken|bumped|^omega: |^[[:space:]]+at [^[:space:]]'

# Benign lines the keep net would catch. The non-digit before the zero keeps
# `10 failed` printing; the loose middle is chalk's escapes.
NOISE_RE='^objc\[[0-9]+\]: Class .* is implemented in both|Results:.*[^0-9]0 failed'

# Print what one half says that is worth reading; the phases, the announce and
# the drop list: tower/README.md § Run. Patterns judge a color-stripped copy and
# the original prints; the strip is a bash substitution, not a fork per line.
filter_output() {
  local port line plain url_re web_re announced='' flowing=''
  port="$1"
  # Any port: omega bumps to the next free one when its own is taken.
  url_re='(https?://[^[:space:]]*:[0-9]+)'
  # omega pads the tag to its widest target name (`[web    ]`); `[webhook]` fails.
  web_re='^\[web[[:space:]]*\][[:space:]]'
  shopt -s nocasematch
  # extglob makes the strip's `*(...)` a repeat, not a literal.
  shopt -s extglob
  while IFS= read -r line || [ -n "$line" ]; do
    plain="${line//$'\033'\[*([0-9;])m/}"
    # Before the URL branch, so that branch owns BASH_REMATCH.
    if [ -n "$port" ] && [[ "$plain" =~ $web_re ]]; then
      flowing=1
    fi
    if [ -n "$port" ] && [ -z "$announced" ] && [[ "$plain" =~ $url_re ]]; then
      announced=1
      flowing=1
      # The filter is its own process, so the fact goes on disk for the down-taker.
      : > "$FIFO_DIR/announced"
      wk_ok "dashboard at ${BASH_REMATCH[1]}"
    fi
    if [[ "$plain" =~ $NOISE_RE ]]; then
      continue
    fi
    if [ -n "$flowing" ] || [[ "$plain" =~ $KEEP_RE ]]; then
      echo "$line"
    fi
  done
}

# Start one half: the port it announces (empty for the API), then the command.
# The filter reads a fifo rather than a pipe, so `$!` is the half itself and not
# a pipeline wrapper a leftover child would keep alive.
start_half() {
  local port fifo
  port="$1"
  shift
  if [ -n "$VERBOSE" ]; then
    "$@" &
    PIDS+=($!)
    return 0
  fi
  fifo="$FIFO_DIR/half-${#PIDS[@]}"
  mkfifo "$fifo"
  filter_output "$port" < "$fifo" &
  FILTERS+=($!)
  "$@" > "$fifo" 2>&1 &
  PIDS+=($!)
}

api_default() { node "$ROOT/tower/api/server.js"; }
app_default() { cd "$ROOT/tower/app" && npm run dev; }

if [ -n "${WORKKIT_TOWER_API:-}" ]; then
  start_half '' bash -c "$WORKKIT_TOWER_API"
else
  start_half '' api_default
fi

if [ -n "${WORKKIT_TOWER_APP:-}" ]; then
  start_half "$APP_PORT" bash -c "$WORKKIT_TOWER_APP"
else
  start_half "$APP_PORT" app_default
fi

# Poll: macOS's bash 3.2 has no `wait -n`.
while kill -0 "${PIDS[0]}" 2>/dev/null && kill -0 "${PIDS[1]}" 2>/dev/null; do
  sleep 1
done

# A half that ended before any announce never came up: name it. Only in a
# filtered run (verbose already showed everything) and not after a shutdown.
if [ -z "$VERBOSE" ] && [ -z "$SHUTDOWN" ] && [ ! -e "$FIFO_DIR/announced" ]; then
  ended='app'
  kill -0 "${PIDS[0]}" 2>/dev/null || ended='API'
  wk_error "the $ended half ended before the dashboard came up; run \`npm run tower -- --verbose\` to see everything it printed"
fi

cleanup
