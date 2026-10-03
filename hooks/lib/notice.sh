#!/bin/bash
# hooks/lib/notice.sh: the notice a hook exiting 0 is heard by.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads hook_jq from the entry.

# hook_pretool_notice <message> [event, default PreToolUse]: the line as stdout
# JSON for the user and the model, since stderr from a hook exiting 0 reaches
# neither. Consumers: safety/commit-gate, manager/spawn-guard,
# safety/proof-guard, safety/tree-guard, workflow/snapshot (PostToolUse).
hook_pretool_notice() {
  hook_jq -n --arg m "$1" --arg e "${2:-PreToolUse}" '{
    "systemMessage": $m,
    "hookSpecificOutput": {
      "hookEventName": $e,
      "additionalContext": $m
    }
  }'
}
