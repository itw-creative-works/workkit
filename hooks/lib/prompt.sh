#!/bin/bash
# hooks/lib/prompt.sh: whose words a prompt is, the owner's or Claude Code's own.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads the HOOK_PROMPT_*_RE patterns
# from the entry.

# hook_prompt_is_system <text>: 0 when Claude Code delivered the prompt itself
# (a task notification, a subagent hand-back, an agent message), 1 when the
# owner typed or pasted it. Consumers: docs/checkpoint, workflow/feature, and
# the dotfiles hooks; manager/close-guard reads the same patterns in jq.
hook_prompt_is_system() {
  local text="${1:-}"
  [[ $text =~ $HOOK_PROMPT_FRAME_RE ]] && return 0
  [[ $text =~ $HOOK_PROMPT_TAG_RE ]] && ! [[ $text =~ $HOOK_PROMPT_PASTE_RE ]]
}
