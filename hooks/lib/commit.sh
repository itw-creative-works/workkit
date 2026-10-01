#!/bin/bash
# hooks/lib/commit.sh: the command-text reads the guards share: the heredoc and
# quote strips, the `NAME=1` escape, the redirect `&` fold, the directory-change
# test, the git-commit finder with its two internal helpers, and the
# redirect-word test. SOURCED by hooks/_lib.sh, never executed, and it runs
# nothing at load: it defines functions and sets nothing. It reads no name of
# the entry's.

# hook_strip_heredocs <cmd>: remove heredoc bodies for command detection, since
# a body is file content. Off entirely when a heredoc feeds an interpreter
# (`bash <<EOF`), whose body is executed code; an unterminated heredoc stays
# visible. Both fail toward gating.
hook_strip_heredocs() {
  if ! command -v perl >/dev/null 2>&1 \
    || printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_.-])(bash|sh|zsh|dash|ksh|eval|env)([[:space:]][^;&|]*)?<<'; then
    printf '%s' "$1"
    return 0
  fi
  printf '%s' "$1" | perl -0777 -pe 's/(<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\2).*?\n[\t ]*\3[\t ]*(?=\n|$)/$1/gs' 2>/dev/null || printf '%s' "$1"
}

# hook_strip_quotes <text>: each quoted span becomes one placeholder word, in one
# left-to-right multiline pass, so a positional walk keeps its slots and a
# mention never reads as a command; an empty span is deleted (`git com""mit`).
# Perl failing passes the text unstripped; the no-perl sed is line-based.
hook_strip_quotes() {
  if command -v perl >/dev/null 2>&1; then
    printf '%s' "$1" | perl -0777 -pe 's{"(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27}{ length($&) > 2 ? "_hookq_" : "" }ges' 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1" | sed -E "s/''|\"\"//g; s/'[^']*'|\"[^\"]*\"/_hookq_/g"
  fi
}

# hook_has_escape <text> <NAME>: is `NAME=1` set as an assignment on this
# command? The one home of every escape's shape. Feed it quote-stripped text.
hook_has_escape() {
  printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_])'"$2"'=1([^[:alnum:]_]|$)'
}

# hook_fold_redirect_amp <text>: fold a redirect's `&` away (`>&`, `&>` to `>`,
# `<&` to `<`) so a split on `;|&` never cuts a clause at a redirect.
hook_fold_redirect_amp() {
  local t="$1"
  t=${t//>&/>}
  t=${t//<&/<}
  t=${t//&>/>}
  printf '%s' "$t"
}

# _hook_count_placeholders <text>: the `_hookq_` count, into
# HOOK_PLACEHOLDER_COUNT. Pure expansion: it runs per clause on every Bash
# command. Internal to hook_find_git_commit.
_hook_count_placeholders() {
  local s="$1"
  HOOK_PLACEHOLDER_COUNT=0
  while :; do
    case "$s" in
      *_hookq_*) s="${s#*_hookq_}"; HOOK_PLACEHOLDER_COUNT=$((HOOK_PLACEHOLDER_COUNT + 1)) ;;
      *) break ;;
    esac
  done
}

# _hook_span_is_commit <src> <n>: does the Nth (0-based) non-empty quoted span
# of the heredoc-stripped original carry `git` and `commit` as words? Without
# perl it asks the whole command instead, toward the gate. Internal.
_hook_span_is_commit() {
  local out rc=0
  if command -v perl >/dev/null 2>&1; then
    out=$(printf '%s' "$1" | perl -0777 -ne '
      my $n = '"$2"'; my $i = 0;
      while (/"(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27/gs) {
        # Copy $& first: matching AGAINST $& would overwrite it mid-test.
        my $s = $&;
        next if length($s) <= 2;
        next unless $i++ == $n;
        print "W" if $s =~ /\bgit\b/ && $s =~ /\bcommit\b/;
        last;
      }' 2>/dev/null) || rc=$?
    if [ "$rc" -eq 0 ]; then
      [ "$out" = "W" ] && return 0
      return 1
    fi
  fi
  printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_]|$)' \
    && printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_])commit([^[:alnum:]_]|$)'
}

# hook_peel_prefixes <word>...: the one prefix peel every command-word reader
# uses: `(`, `{`, `!`, command, builtin, env, eval, time, NAME=v, a redirect, and
# if/then/elif/else/do/while/until. Sets HOOK_PEEL_SKIP (words skipped),
# HOOK_PEEL_EVAL, and HOOK_PEEL_WORD (the command word, `(` and `\` off).
hook_peel_prefixes() {
  local head n
  HOOK_PEEL_SKIP=0
  HOOK_PEEL_EVAL=0
  HOOK_PEEL_WORD=""
  while [ $# -gt 0 ]; do
    head="$1"
    while :; do
      case "$head" in \(?*) head="${head#\(}" ;; *) break ;; esac
    done
    head="${head#\\}"
    case "$head" in
      \(|\{|\!|command|builtin|env|time|if|then|elif|else|do|while|until|[A-Za-z_]*=*) ;;
      eval) HOOK_PEEL_EVAL=1 ;;
      *'>'*|*'<'*)
        n=$(hook_redirect_span "$head")
        if [ "$n" -eq 0 ]; then HOOK_PEEL_WORD="$head"; break; fi
        [ "$n" -le $# ] || n=$#
        shift "$n"
        HOOK_PEEL_SKIP=$((HOOK_PEEL_SKIP + n))
        continue ;;
      *) HOOK_PEEL_WORD="$head"; break ;;
    esac
    shift
    HOOK_PEEL_SKIP=$((HOOK_PEEL_SKIP + 1))
  done
}

# hook_clause_changes_dir <word>...: is the clause, handed as its QUOTE STRIPPED
# words, a directory change, its command word past the peeled prefixes being
# cd, pushd or popd? The one home of that test; it leaves HOOK_PEEL_* set.
hook_clause_changes_dir() {
  hook_peel_prefixes "$@"
  case "$HOOK_PEEL_WORD" in
    cd|pushd|popd) return 0 ;;
  esac
  return 1
}

# hook_find_git_commit <cmd>: find a real `git ... commit` clause past the peeled
# prefixes. Sets HOOK_COMMIT_CLAUSE (quote-stripped, or empty), HOOK_SAW_CD (a
# cd/pushd/popd clause), HOOK_SAW_STAGE (add/rm/mv/stage before the commit), and
# HOOK_WRAPPED_COMMIT (an `sh -c`/`eval` string carrying one, read by position).
hook_find_git_commit() {
  HOOK_COMMIT_CLAUSE=""
  HOOK_SAW_CD=0
  HOOK_SAW_STAGE=0
  HOOK_WRAPPED_COMMIT=0
  local src stripped clause sub n pre expect saw_eval nc ci pi=0 had_glob=1
  src=$(hook_strip_heredocs "$1")
  stripped=$(hook_strip_quotes "$src")
  # The `&` of a redirect (`2>&1`, `&>f`, `<&3`) belongs to the redirect, never
  # separates a clause: fold it away so the split below keeps what follows.
  stripped=$(hook_fold_redirect_amp "$stripped")
  # No glob expansion during the word split below; restore on return.
  case $- in *f*) had_glob=0 ;; esac
  set -f
  while IFS= read -r clause; do
    # Placeholder bookkeeping for the wrapped test: `pi` placeholders sit in
    # the clauses already scanned, `ci` in the words of this clause already
    # walked, so a candidate's span sits at ordinal pi+ci in the ORIGINAL.
    _hook_count_placeholders "$clause"
    nc=$HOOK_PLACEHOLDER_COUNT
    # shellcheck disable=SC2086  # word splitting is intentional; quotes are stripped
    set -- $clause
    # Peel wrapper prefixes so `(git …`, `{ git …; }`, `command git …`,
    # `GIT_DIR=x git …`, an unquoted `eval git …` and the rest of the peel's list
    # read as the git clause they run; the peeled words stay in HOOK_COMMIT_CLAUSE.
    if hook_clause_changes_dir "$@"; then HOOK_SAW_CD=1; fi
    saw_eval=$HOOK_PEEL_EVAL
    # A skipped assignment or redirect target may hold a placeholder.
    _hook_count_placeholders "${*:1:$HOOK_PEEL_SKIP}"
    ci=$HOOK_PLACEHOLDER_COUNT
    shift "$HOOK_PEEL_SKIP"
    if [ $# -gt 0 ]; then shift; set -- "$HOOK_PEEL_WORD" "$@"; fi
    # eval of a quoted span: the placeholder hides it, so test the original span.
    # A surviving quote means the strip did not run; the span test then degrades
    # to the coarse whole-command test, toward the gate.
    if [ "$saw_eval" -eq 1 ]; then
      case "${1:-}" in
        _hookq_*|\"*|\'*)
          if _hook_span_is_commit "$src" "$((pi + ci))"; then HOOK_WRAPPED_COMMIT=1; fi
          pi=$((pi + nc))
          continue
          ;;
      esac
    fi
    # An interpreter in command position with a -c string is the same wrapped
    # shape: `sh -c "git commit …"`, `bash -lc '…'`, and the attached `bash -c"…"`.
    case "${1:-}" in
      sh|bash|zsh|dash|ksh|*/sh|*/bash|*/zsh|*/dash|*/ksh)
        shift
        expect=0
        while [ $# -gt 0 ]; do
          case "$1" in
            _hookq_*|\"*|\'*)
              # The string operand. Only a preceding -c cluster makes it
              # executed code: `bash "script.sh"` names a FILE.
              if [ "$expect" -eq 1 ] && _hook_span_is_commit "$src" "$((pi + ci))"; then
                HOOK_WRAPPED_COMMIT=1
              fi
              break
              ;;
            -[!-]*)
              # A short option cluster. With the string ATTACHED (`-c_hookq_`,
              # or a raw quote when the strip did not run) the cluster before
              # it must end in c; otherwise a cluster carrying c makes the
              # NEXT operand the string.
              pre="${1%%_hookq_*}"
              [ "$pre" = "$1" ] && pre="${1%%[\"\']*}"
              if [ "$pre" != "$1" ]; then
                case "$pre" in
                  *c) if _hook_span_is_commit "$src" "$((pi + ci))"; then HOOK_WRAPPED_COMMIT=1; fi ;;
                esac
                break
              fi
              case "$1" in *c*) expect=1 ;; esac
              shift
              ;;
            --*) _hook_count_placeholders "$1"; ci=$((ci + HOOK_PLACEHOLDER_COUNT)); shift ;;
            *'>'*|*'<'*)
              n=$(hook_redirect_span "$1")
              [ "$n" -gt 0 ] || break
              [ "$n" -le $# ] || n=$#
              _hook_count_placeholders "${*:1:$n}"; ci=$((ci + HOOK_PLACEHOLDER_COUNT)); shift "$n" ;;
            *) break ;;
          esac
        done
        pi=$((pi + nc))
        continue
        ;;
    esac
    case "${1:-}" in
      git|*/git) ;;
      *) pi=$((pi + nc)); continue ;;
    esac
    shift
    # Find git's subcommand: skip global options, where value-taking ones
    # (-C <dir>, -c <k=v>, --git-dir <p>, …) consume their separate value so
    # it can never be read as the subcommand.
    sub=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -C|-c|--git-dir|--work-tree|--namespace|--exec-path) [ $# -ge 2 ] || break; shift 2 ;;
        -*) shift ;;
        *'>'*|*'<'*)
          n=$(hook_redirect_span "$1")
          [ "$n" -gt 0 ] || { sub="$1"; break; }
          [ "$n" -le $# ] || n=$#
          shift "$n" ;;
        *) sub="$1"; break ;;
      esac
    done
    # A staging subcommand in the same command line, ahead of the commit: what
    # the commit will carry is written by a clause that has not run yet.
    case "$sub" in
      add|rm|mv|stage) HOOK_SAW_STAGE=1 ;;
    esac
    if [ "$sub" = "commit" ]; then HOOK_COMMIT_CLAUSE="$clause"; break; fi
    pi=$((pi + nc))
  done <<EOF
$(printf '%s' "$stripped" | tr ';|&' '\n')
EOF
  [ "$had_glob" -eq 1 ] && set +f
  return 0
}

# hook_redirect_word <word>: a QUOTE STRIPPED word that is a shell redirect.
# Prints `bare` when its target is the next word (`>`, `2>`, `<<<`, `&>>`),
# `attached` when the word carries it (`2>&1`, `>file`, `<<<msg`); else 1.
# Consumer: hook_redirect_span, the form every walk calls.
hook_redirect_word() {
  local fd op
  fd="${1%%[!0-9]*}"
  op="${1#"$fd"}"
  if [ -z "$fd" ]; then
    case "$op" in '&>'*) op="${op#&}" ;; esac
  fi
  case "$op" in
    '>'|'>>'|'>|'|'<'|'<>'|'<<'|'<<-'|'<<<') printf '%s\n' bare ;;
    '>'*|'<'*) printf '%s\n' attached ;;
    *) return 1 ;;
  esac
}

# hook_redirect_span <word>: how many words a redirect starting at this QUOTE
# STRIPPED word spans (2 bare, its target being the next word; 1 attached; 0 no
# redirect), so a walk skips it whole. Always exits 0. Every command-text walk
# uses it: hook_peel_prefixes, the finder's two, and the hooks' own.
hook_redirect_span() {
  case "$(hook_redirect_word "$1")" in
    bare) printf '2\n' ;;
    attached) printf '1\n' ;;
    *) printf '0\n' ;;
  esac
}
