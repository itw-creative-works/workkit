#!/usr/bin/env bash
#
# The one door to the tower (issue #97): the JSON API (tower/api, port 8693)
# and the dashboard (tower/app, port 4300) together, from one command —
# `workkit tower`, or `npm run tower` at the repo root. One interrupt ends
# both, and either process ending takes the other with it, so nothing
# lingers half-up.
#
# Running it RESTARTS the tower (owner ruling, issue #97): whatever is
# already listening on either port is a previous instance — these two ports
# belong to the tower — and is replaced, with a line saying so, instead of
# the fresh API dying on the address being in use.
#
# The two commands and the ports are injectable (WORKKIT_TOWER_API /
# WORKKIT_TOWER_APP / WORKKIT_TOWER_PORTS) so the suite can run this script
# without starting a server or touching the real ports.
#
# It is QUIET by default (issue #138): someone who typed `workkit tower`
# asked for a dashboard, not for the dev server's log wall. Each half's
# output is filtered to the lines that read like a problem, plus one line
# naming the URL the dashboard came up on. `--verbose` — or
# WORKKIT_TOWER_VERBOSE=1, for callers that pass no arguments, the way
# `npm run tower` hands this script none — passes everything through.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS="${WORKKIT_TOWER_PORTS-8693 4300}"

# The dashboard's port, second of the two — what the announce line watches for
# in the app's own output.
# shellcheck disable=SC2206  # word splitting is the point: PORTS is a list
PORT_LIST=($PORTS)
APP_PORT="${PORT_LIST[1]:-}"

VERBOSE="${WORKKIT_TOWER_VERBOSE:-}"
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
  esac
done

# Ending a half means ending its TREE: npm and omega both put children between
# the pid this script holds and the server that owns the port, and a plain
# kill of the parent leaves those children orphaned and still serving.
end_tree() {
  local pid kid
  pid="$1"
  for kid in $(pgrep -P "$pid" 2>/dev/null); do end_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}

# Take a port back: end whatever listens on it (its parents notice and end
# themselves), then wait for the address to actually free before starting.
# A listener that rides out the polite signal is escalated, and a port that
# STILL cannot be freed ends the run loudly — proceeding would be the exact
# EADDRINUSE death this reclaim exists to prevent, blamed on nothing.
reclaim() {
  local port pid deadline
  port="$1"
  command -v lsof >/dev/null 2>&1 || return 0
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null); do
    echo "tower: replacing what was listening on port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  done
  deadline=$((SECONDS + 5))
  while [ "$SECONDS" -lt "$deadline" ] && lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
  done
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null); do
    kill -9 "$pid" 2>/dev/null || true
  done
  deadline=$((SECONDS + 3))
  while [ "$SECONDS" -lt "$deadline" ] && lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
  done
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "tower: could not free port $port — its listener survived both signals; not starting onto an occupied port" >&2
    exit 1
  fi
}

for port in $PORTS; do reclaim "$port"; done

PIDS=()
FILTERS=()
# Where the halves hand their output to their filters — one fifo each, made
# and removed by this script.
FIFO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/workkit-tower.XXXXXX")"
cleanup() {
  local pid
  # Guarded, because macOS's bash 3.2 treats an empty array as unbound under
  # `set -u` — a signal landing before the first pid is recorded would
  # otherwise die inside its own trap.
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do end_tree "$pid"; done
  fi
  # The filters sit BESIDE the halves rather than in their trees, so they are
  # ended by name: one whose half left a background child behind still holding
  # the writing end would otherwise read on, and print, after the tower is gone.
  if [ "${#FILTERS[@]}" -gt 0 ]; then
    for pid in "${FILTERS[@]}"; do kill "$pid" 2>/dev/null || true; done
  fi
  rm -rf "$FIFO_DIR"
}
trap cleanup EXIT INT TERM

# What survives the quiet default: anything shaped like a problem. Everything
# else — the cloudflare notes, the missing-key chatter, the build timings — is
# the framework talking to its author, not to whoever wanted a dashboard.
KEEP_RE='error|warn|fail|fatal|exception|EADDR|ENOENT|EACCES|not found|cannot find module|missing binding|segmentation fault|killed:|npm ERR!|taken|bumped|^[[:space:]]+at [^[:space:]]'

# Read one half's combined output and print only what is worth reading: the
# problem lines, plus — for the half that owns a port — one line naming the
# URL it came up on, taken from the app's OWN announcement rather than
# composed here, because the scheme is not fixed (omega serves https when a
# mkcert pair exists and plain http when it does not).
#
# `read` takes one line at a time, so this is line-buffered by construction:
# an error appears the moment the child writes it. EOF on the child's output
# ends the loop, which is how this process dies with the child instead of
# holding the pipe open.
filter_output() {
  local port line url_re announced=''
  port="$1"
  # ANY url the half names, on whatever port it ended up on — omega bumps to
  # the next free port when the one it asked for is taken, and a match pinned
  # to the port we asked for leaves that run with a silent terminal. First one
  # wins; the port argument only says which half owns a dashboard to announce.
  url_re='(https?://[^[:space:]]*:[0-9]+)'
  shopt -s nocasematch
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$port" ] && [ -z "$announced" ] && [[ "$line" =~ $url_re ]]; then
      announced=1
      echo "tower: dashboard at ${BASH_REMATCH[1]}"
    fi
    if [[ "$line" =~ $KEEP_RE ]]; then
      echo "$line"
    fi
  done
}

# Start one half in the background and record it: the port whose URL its output
# announces (empty for the API, which has none to announce), then the command.
#
# The filter runs BESIDE the half, reading a fifo, rather than downstream of it
# in a pipeline. A pipeline's `$!` is the wrapper around the whole thing, which
# lives until every writer of the pipe has closed — so a half that exits
# leaving a background child holding its stdout would keep that wrapper alive
# and the down-taker below waiting on a tower that is already half-down. This
# way the pid recorded is the HALF ITSELF, and the filter's is recorded too,
# since nothing else can reach it once its half is gone.
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

# macOS ships bash 3.2, which has no `wait -n` — poll instead: the moment
# either process is gone, take the other down and end.
while kill -0 "${PIDS[0]}" 2>/dev/null && kill -0 "${PIDS[1]}" 2>/dev/null; do
  sleep 1
done
cleanup
