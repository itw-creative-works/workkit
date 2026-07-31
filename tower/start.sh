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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS="${WORKKIT_TOWER_PORTS-8693 4300}"

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
cleanup() {
  # Guarded, because macOS's bash 3.2 treats an empty array as unbound under
  # `set -u` — a signal landing before the first pid is recorded would
  # otherwise die inside its own trap.
  [ "${#PIDS[@]}" -gt 0 ] || return 0
  for pid in "${PIDS[@]}"; do end_tree "$pid"; done
}
trap cleanup EXIT INT TERM

if [ -n "${WORKKIT_TOWER_API:-}" ]; then
  bash -c "$WORKKIT_TOWER_API" &
else
  node "$ROOT/tower/api/server.js" &
fi
PIDS+=($!)

if [ -n "${WORKKIT_TOWER_APP:-}" ]; then
  bash -c "$WORKKIT_TOWER_APP" &
else
  (cd "$ROOT/tower/app" && npm run dev) &
fi
PIDS+=($!)

# macOS ships bash 3.2, which has no `wait -n` — poll instead: the moment
# either process is gone, take the other down and end.
while kill -0 "${PIDS[0]}" 2>/dev/null && kill -0 "${PIDS[1]}" 2>/dev/null; do
  sleep 1
done
cleanup
