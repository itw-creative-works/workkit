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
# It is quiet through STARTUP (issues #138, #158): someone who typed
# `workkit tower` asked for a dashboard, not for the framework's boot wall. It
# says it is starting, then both halves run filtered to the lines that read
# like a problem, plus one line naming the URL the dashboard came up on — and
# the app half turns loose at the first line omega tags `[web]`, which is its
# dev server talking, or at that URL line if no such line ever comes. The
# API half stays filtered for its whole life, and a short list of known-benign
# lines is dropped in either phase. `--verbose` — or WORKKIT_TOWER_VERBOSE=1,
# for callers that pass no arguments, the way `npm run tower` hands this
# script none — passes everything through, raw, from the first line.
#
# Quiet is never silent about a boot that did not happen (issue #170): a half
# that ends before the dashboard was announced says so, and names itself, so a
# refusal is never a terminal that just returns to the prompt.
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

# Give the halves their COLORS back (issue #179). Each one writes to a fifo its
# filter reads, so omega's logger sees a non-tty and turns its own colors off —
# the terminal ends up with plain text even though this script strips nothing.
# Told to force them, the framework colors again and the filter passes the
# escapes through. Only when the TOWER's own stdout is a terminal: a run piped
# or redirected into a file was asked for plain text, and a FORCE_COLOR the
# caller already exported is theirs, including a deliberate 0.
if [ -t 1 ] && [ -z "${FORCE_COLOR+set}" ]; then
  export FORCE_COLOR=1
fi

# The first thing a user sees, before the reclaim pass and in a verbose run
# too: a quiet startup is otherwise a terminal with nothing on it at all.
echo "tower: starting the dashboard…"

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
# Set the moment a take-down begins, because cleanup DESTROYS the evidence the
# down-taker below reads: it removes the fifo directory, announce marker and
# all, and ends both halves. Running from a signal's trap it does that while
# the script is still inside its poll loop, so without this a tower that had
# its dashboard and was then killed from the outside read as one that never
# came up, and named whichever half its already-ended pids answered for.
SHUTDOWN=''
cleanup() {
  local pid
  SHUTDOWN=1
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

# What survives the quiet phase: anything shaped like a problem, plus anything
# the framework says in its OWN voice (issue #170) — omega prefixes the lines it
# writes as itself, including the ones refusing to boot ("the monorepo
# src-to-dist watch is not running"), which carry no problem word at all and
# were dropped whole. Everything else — the missing-key chatter, the build
# timings, the targets' own logs — is the toolchain talking to its author, not
# to whoever wanted a dashboard.
KEEP_RE='error|warn|fail|fatal|exception|EADDR|ENOENT|EACCES|not found|cannot find module|missing binding|segmentation fault|killed:|npm ERR!|taken|bumped|^omega: |^[[:space:]]+at [^[:space:]]'

# What the keep net catches by accident (issue #158): known-benign lines whose
# WORDING carries a trigger word. Both are the framework talking about itself —
# the duplicate-class warning is two bundled copies of glib in omega's own
# node_modules, ours to neither fix nor read, and the manager's check summary is
# a passing run's bookkeeping. The summary is dropped only where it reports no
# failures, so a run with real ones still reaches the terminal; the non-digit
# before the zero is what keeps `10 failed` out of that exemption, and the loose
# middle is because chalk wraps the parts of that line in escapes.
NOISE_RE='^objc\[[0-9]+\]: Class .* is implemented in both|Results:.*[^0-9]0 failed'

# Read one half's combined output and print what is worth reading, plus — for
# the half that owns a port — one line naming the URL it came up on, taken from
# the app's OWN announcement rather than composed here, because the scheme is
# not fixed (omega serves https when a mkcert pair exists and plain http when
# it does not).
#
# The half that owns a port also has a PHASE BOUNDARY (issue #158): everything
# before it is the startup wall, which nobody asked for, and everything after
# it is the dev server itself — its own boot lines, then the requests and
# rebuilds, the running log of the thing the terminal is now watching. omega
# tags every line it forwards from the web target `[web]` at column 0, so the
# FIRST of those turns the half loose; the URL announce turns it loose too,
# whichever lands first, which is the fallback if that tagging ever changes.
# The manage cycle that runs BEFORE the dev server prints bracketed lines of
# its own (`[11ty] Wrote…`), which is why the trigger is that one prefix and
# not any bracket. The API half owns no port, so neither trigger applies to it
# and it stays quiet for its whole life. The drop list applies in both phases;
# the keep net only matters in the quiet one. A trigger line is judged in the
# phase it OPENS — a `[web]` line is one of the lines the switch exists to
# show — so the app's own URL line prints beside the announce rather than
# being replaced by it.
#
# Every judgement is made on a COLOR-STRIPPED copy of the line and the ORIGINAL
# is what prints (issue #179): with the halves forcing their colors on, a keep
# word, omega's prefix and the `[web]` tag all arrive wrapped in escapes, and a
# pattern anchored at column 0 sees the escape rather than the tag. The strip is
# bash's own pattern substitution rather than a sed per line — one fork per line
# of a dev server's log is a cost this loop should not carry — and it is why the
# announce, which composes its line out of BASH_REMATCH, names a bare URL with
# no escape trailing it.
#
# `read` takes one line at a time, so this is line-buffered by construction:
# an error appears the moment the child writes it. EOF on the child's output
# ends the loop, which is how this process dies with the child instead of
# holding the pipe open.
filter_output() {
  local port line plain url_re web_re announced='' flowing=''
  port="$1"
  # ANY url the half names, on whatever port it ended up on — omega bumps to
  # the next free port when the one it asked for is taken, and a match pinned
  # to the port we asked for leaves that run with a silent terminal. First one
  # wins; the port argument only says which half owns a dashboard to announce.
  url_re='(https?://[^[:space:]]*:[0-9]+)'
  # The web target's own tag, at column 0 and nowhere else in the line. omega
  # pads the tag to its widest target name (`[web    ]` beside a backend), so
  # trailing spaces are tolerated; `[webhook]` still is not.
  web_re='^\[web[[:space:]]*\][[:space:]]'
  shopt -s nocasematch
  # extglob is what makes the strip below a pattern and not a literal: `*(...)`
  # is the repeat the escape's digits and semicolons need.
  shopt -s extglob
  while IFS= read -r line || [ -n "$line" ]; do
    plain="${line//$'\033'\[*([0-9;])m/}"
    # Tested before the URL branch, so that branch owns BASH_REMATCH when it
    # reads the URL out of a line carrying both.
    if [ -n "$port" ] && [[ "$plain" =~ $web_re ]]; then
      flowing=1
    fi
    if [ -n "$port" ] && [ -z "$announced" ] && [[ "$plain" =~ $url_re ]]; then
      announced=1
      flowing=1
      # The filter runs beside the script, not in it, so the fact that a
      # dashboard was named is left where the down-taker below can read it.
      : > "$FIFO_DIR/announced"
      echo "tower: dashboard at ${BASH_REMATCH[1]}"
    fi
    if [[ "$plain" =~ $NOISE_RE ]]; then
      continue
    fi
    if [ -n "$flowing" ] || [[ "$plain" =~ $KEEP_RE ]]; then
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

# A half that ended before any dashboard was named did not shut down — it never
# came up (issue #170). Say which one, and where the rest of what it printed is,
# since a filtered run has by definition shown less than the whole of it. Only
# in a filtered run: a verbose one already put every line on the terminal, and
# announces nothing this could read. And only where nothing has taken the tower
# down yet — a run ended from the outside is a shutdown, whatever it had
# announced, and both the marker and the pids are gone by then anyway.
if [ -z "$VERBOSE" ] && [ -z "$SHUTDOWN" ] && [ ! -e "$FIFO_DIR/announced" ]; then
  ended='app'
  kill -0 "${PIDS[0]}" 2>/dev/null || ended='API'
  echo "tower: the $ended half ended before the dashboard came up — run \`npm run tower -- --verbose\` to see everything it printed" >&2
fi

cleanup
