#!/bin/bash
# hooks/lib/gh-edit.sh: the read of a `gh issue edit|close` command the two
# label gates share (safety/proof-guard, safety/spec-guard): the clause split, a
# flag's values, the repo, the issue numbers, and the bounce behind a cd.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing. It reads hook_redirect_span and hook_strip_quotes (lib/commit.sh).

# hook_gh_clauses <text>: the clauses, one a line, in one awk pass whose cost
# grows once with the command: a separator inside a quoted span is data, and a
# line break there becomes a space. With no awk the split is quote blind.
hook_gh_clauses() {
  local split='
    BEGIN { st = "" }
    {
      out = ""; n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (st == "") {
          if (c == DQ || c == SQ) { st = c; out = out c }
          else if (c == BS) { out = out c; i++; if (i <= n) out = out substr($0, i, 1) }
          else if (c == ";" || c == "|" || c == "&") { out = out "\n" }
          else out = out c
        } else if (st == DQ) {
          if (c == DQ) { st = "" ; out = out c }
          else if (c == BS) { out = out c; i++; if (i <= n) out = out substr($0, i, 1) }
          else out = out c
        } else {
          if (c == SQ) st = ""
          out = out c
        }
      }
      printf "%s", out
      printf "%s", (st == "" ? "\n" : " ")
    }
  '
  local clauses
  if command -v awk >/dev/null 2>&1 \
    && clauses=$(printf '%s' "$1" | awk -v DQ='"' -v SQ="'" -v BS='\\' "$split" 2>/dev/null); then
    printf '%s\n' "$clauses"
    return 0
  fi
  printf '%s' "$1" | tr ';|&' '\n'
}

# hook_gh_flag_values <clause> <long> [<short>]: every value the clause hands
# the flag, raw, one a line (`--flag v`, `--flag=v`, `-Sv`), a redirect before a
# separate value skipped. The words keep a quoted span whole, so a flag named in
# a body is part of the body's word; without awk they split quote blind.
hook_gh_flag_values() {
  local w words want=0 skip_next=0 span
  local split_words='
    {
      n = length($0); w = ""; st = ""; inw = 0
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (st == "") {
          if (c == " " || c == "\t") { if (inw) { print w; w = ""; inw = 0 }; continue }
          inw = 1; w = w c
          if (c == DQ || c == SQ) st = c
          else if (c == BS && i < n) { i++; w = w substr($0, i, 1) }
        } else {
          w = w c
          if (st == DQ && c == BS && i < n) { i++; w = w substr($0, i, 1) }
          else if (c == st) st = ""
        }
      }
      if (inw) print w
    }
  '
  words=$(printf '%s\n' "$1" | awk -v DQ='"' -v SQ="'" -v BS='\\' "$split_words" 2>/dev/null) \
    || words=$(printf '%s\n' "$1" | tr ' \t' '\n\n')
  while IFS= read -r w; do
    [ -n "$w" ] || continue
    if [ "$skip_next" -gt 0 ]; then skip_next=$((skip_next - 1)); continue; fi
    if [ "$want" -eq 1 ]; then
      span=$(hook_redirect_span "$w")
      if [ "$span" -gt 0 ]; then skip_next=$((span - 1)); continue; fi
      want=0; printf '%s\n' "$w"; continue
    fi
    case "$w" in
      "$2") want=1 ;;
      "$2"=*) printf '%s\n' "${w#"$2"=}" ;;
      *)
        if [ -n "${3:-}" ]; then
          case "$w" in "$3") want=1 ;; "$3"?*) printf '%s\n' "${w#"$3"}" ;; esac
        fi
        ;;
    esac
  done <<EOF
$words
EOF
  return 0
}

# hook_gh_repo <clause>: the first `--repo`/`-R` value in any spelling gh takes,
# quotes off; with no flag, the repo an issue URL names (read off the
# quote-stripped clause, so a body naming either is not one), else nothing. 1
# when the value cannot be resolved here (empty, a variable, a substitution).
hook_gh_repo() {
  local repo stripped url
  stripped=$(hook_strip_quotes "$1")
  if ! printf '%s' "$stripped" | grep -Eq -- '(^|[[:space:]])(--repo([=[:space:]]|$)|-R)'; then
    url=$(printf '%s' "$stripped" | grep -Eo 'https://[^/[:space:]]+/[^/[:space:]]+/[^/[:space:]]+/issues/[0-9]+' | sed -n 1p)
    [ -n "$url" ] || return 0
    url="${url#https://}"
    url="${url%/issues/*}"
    printf '%s\n' "${url#github.com/}"
    return 0
  fi
  repo=$(hook_gh_flag_values "$1" --repo -R | sed -n 1p | tr -d "\"'")
  case "$repo" in
    ''|*'$'*|*'`'*|*_hookq_*) return 1 ;;
  esac
  printf '%s\n' "$repo"
}

# hook_gh_issue_numbers <stripped clause> <edit|close>: the issue numbers after
# `gh issue <sub>`, space-led, each once: every positional (a number, `#N`, an
# issue URL's tail) among the flags. A bare flag takes the next word unless gh
# gives it no value; a redirect is shell syntax, never the positional.
hook_gh_issue_numbers() {
  local after tok n issues="" skip_next=0 span toks opts=1
  after=$(printf '%s' "$1" | sed -E "s/^.*gh[[:space:]]+issue[[:space:]]+$2[[:space:]]+//")
  read -r -a toks <<<"$after"
  for tok in ${toks[@]+"${toks[@]}"}; do
    if [ "$skip_next" -gt 0 ]; then skip_next=$((skip_next - 1)); continue; fi
    case "$tok" in
      *'>'*|*'<'*)
        span=$(hook_redirect_span "$tok")
        if [ "$span" -gt 0 ]; then skip_next=$((span - 1)); continue; fi
        ;;
    esac
    if [ "$opts" -eq 1 ]; then
      case "$tok" in
        --) opts=0; continue ;;
        --remove-milestone|--help|-h|--*=*) continue ;;
        --*|-?) skip_next=1; continue ;;
        -*) continue ;;
      esac
    fi
    n="${tok#\#}"
    case "$n" in
      https://*/issues/*) n="${n##*/issues/}"; n="${n%%[/?#]*}" ;;
    esac
    case "$n" in
      ''|*[!0-9]*) continue ;;
    esac
    case " $issues " in
      *" $n "*) continue ;;
    esac
    issues="$issues $n"
  done
  printf '%s\n' "$issues"
}

# hook_gh_block_cd <hook>: bounce a gated flip or close behind a cd, pushd or
# popd, exit 2. The hook is handed the session's directory, so that command
# acts on a tree and repo it cannot see: never judge the wrong one.
hook_gh_block_cd() {
  echo "$1: BLOCKED this command. It changes directory (cd, pushd or popd) before a gated gh issue flip or close, so the gate cannot tell which tree and repo that command acts on. Run the cd in its own Bash call first, then the gh command alone; where the directory resets between calls (a subagent), run the flip from a session whose directory is that repo." >&2
  exit 2
}
