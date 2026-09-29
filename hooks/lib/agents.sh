#!/bin/bash
# hooks/lib/agents.sh: the one measurement of an AGENTS.md against its budget.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads HOOK_AGENTS_MAX_BYTES from the entry.

# hook_agents_budget <file>: "<lines> <dense> <named>": the line count, the lines
# over HOOK_AGENTS_MAX_BYTES, and the first three as "line N (M bytes)". Bytes via
# LC_ALL=C (gawk counts characters under UTF-8); an unreadable file reads "0 0".
# Consumers: docs/board-guard, docs/state-check.
hook_agents_budget() {
  LC_ALL=C awk -v max="$HOOK_AGENTS_MAX_BYTES" '
    length($0) > max {
      n++
      if (n <= 3) named = named sprintf("%sline %d (%d bytes)", (n > 1 ? ", " : ""), NR, length($0))
    }
    END {
      if (n > 3) named = named sprintf(", and %d more", n - 3)
      printf "%d %d %s\n", NR, n, named
    }
  ' "$1" 2>/dev/null || echo "0 0"
}
