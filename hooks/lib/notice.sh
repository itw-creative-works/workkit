#!/bin/bash
# hooks/lib/notice.sh: the notice a PreToolUse hook exiting 0 is heard by.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads hook_jq from the entry.

# hook_pretool_notice <message>: the line as stdout JSON, systemMessage for the
# user and additionalContext for the model, with no permissionDecision: stderr
# from a hook exiting 0 reaches neither. Consumers: safety/commit-gate,
# manager/spawn-guard, safety/proof-guard, safety/tree-guard.
hook_pretool_notice() {
  hook_jq -n --arg m "$1" '{
    "systemMessage": $m,
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": $m
    }
  }'
}
