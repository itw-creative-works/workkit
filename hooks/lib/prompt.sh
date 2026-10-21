#!/bin/bash
# hooks/lib/prompt.sh: whose words a prompt is, the owner's or Claude Code's own.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads the HOOK_PROMPT_*_RE patterns
# from the entry.

# hook_prompt_is_system <text>: 0 when Claude Code delivered the prompt (a
# notification, a hand-back, an agent message), 1 for the owner's. No shell hook
# calls it; close-guard reads HOOK_PROMPT_*_RE in jq, and the JS copies
# (hooks/mods/frame.js, the dotfiles harness's frame.js) pin to them.
hook_prompt_is_system() {
  local text="${1:-}"
  [[ $text =~ $HOOK_PROMPT_FRAME_RE ]] && return 0
  [[ $text =~ $HOOK_PROMPT_TAG_RE ]] && ! [[ $text =~ $HOOK_PROMPT_PASTE_RE ]]
}
