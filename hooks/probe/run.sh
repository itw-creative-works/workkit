#!/usr/bin/env bash
# Batch B probe hook — proves a plugin hook fires from ${CLAUDE_PLUGIN_ROOT}.
# Replaced by the real hook groups in Batch C of the extraction.
set -euo pipefail

cat <<JSON
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"WORKKIT-PROBE: plugin hook loaded from ${CLAUDE_PLUGIN_ROOT:-unset}"}}
JSON
