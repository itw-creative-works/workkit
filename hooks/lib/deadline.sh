#!/bin/bash
# hooks/lib/deadline.sh: the wait on a background run under a deadline, and the
# walk that ends it when the deadline passes. SOURCED by hooks/_lib.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# It reads no name of the entry's.

# hook_end_tree <pid>: end the process and every child under it, leaves first.
# `pgrep` is not everywhere: Git Bash ships no procps, so on Windows only the
# named process itself is ended and its children are left to the shell that
# spawned them. A PowerShell walk would be a second mechanism for one platform.
hook_end_tree() {
  local pid kid
  pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    for kid in $(pgrep -P "$pid" 2>/dev/null); do hook_end_tree "$kid"; done
  fi
  kill -9 "$pid" 2>/dev/null || true
}

# hook_wait_deadline <pid> <seconds>: poll until the process ends or the
# deadline passes. 0 = it ended in time, 1 = it was still running, and its tree
# has been ended. The caller still `wait`s on a 0 for the exit status.
# Consumers: safety/commit-gate (check 5), safety/proof-guard (the qa flip).
hook_wait_deadline() {
  local pid limit start
  pid="$1"
  limit="$2"
  start=$SECONDS
  while kill -0 "$pid" 2>/dev/null && [ $((SECONDS - start)) -lt "$limit" ]; do
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    hook_end_tree "$pid"
    return 1
  fi
  return 0
}
