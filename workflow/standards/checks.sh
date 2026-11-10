#!/usr/bin/env bash
# workflow/standards/checks.sh: the repo's checks.yml, the caller the kit owns,
# rewritten whenever it differs from the template (changelog-job.sh renders it),
# each customization a replaced copy held named first. Sourced by standards.sh,
# functions only.

# wk_checks_leaves <checks.yml>: one `<path>\t<value>` line per key of the file,
# the path's keys joined by \037, a sequence item `[<i>]`; a block scalar is one
# value, a shell block joined into one line. Read without carriage returns.
wk_checks_leaves() {
  awk -v BINMODE=3 '
    function ind(s) { match(s, /^ */); return RLENGTH }
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    function unq(s) {
      s = trim(s)
      if (s ~ /^#/) return ""
      if (s ~ /^".*"$/ || s ~ /^\047.*\047$/) s = substr(s, 2, length(s) - 2)
      return s
    }
    function path(   i, p) {
      p = ""
      for (i = 1; i <= n; i++) p = p (i > 1 ? "\037" : "") key[i]
      return p
    }
    function pop(at) { while (n > 0 && indent[n] >= at) n-- }
    # "; " between commands, a space after a line that continues (then, do,
    # else, an operator, a backslash).
    function join(v, s) {
      if (s == "" || s ~ /^#/) return v
      if (v == "") return s
      if (v ~ /\\$/) return substr(v, 1, length(v) - 1) " " s
      if (v ~ /(^|[ ;])(then|do|else)$/ || v ~ /(\{|&&|\|\||\|)$/) return v " " s
      return v "; " s
    }
    BEGIN { KEY = "^(\"[^\"]*\"|\047[^\047]*\047|[^ \"\047#][^:]*):([ \t]|$)" }
    { sub(/\r$/, "") }
    bs {
      if ($0 ~ /^[[:space:]]*$/) next
      if (ind($0) > bsind) { bsval = join(bsval, trim($0)); next }
      print bspath "\t" bsval
      bs = 0
    }
    /^[[:space:]]*(#.*)?$/ { next }
    {
      at = ind($0); rest = substr($0, at + 1)
      while (rest ~ /^-([ \t]|$)/) {
        pop(at)
        item = count[path()]++
        n++; key[n] = "[" item "]"; indent[n] = at
        rest = substr(rest, 2); match(rest, /^[ \t]*/)
        at += 1 + RLENGTH; rest = substr(rest, RLENGTH + 1)
        if (rest == "") next
        if (rest !~ KEY) { print path() "\t" unq(rest); next }
      }
      if (rest !~ KEY) next
      k = rest; sub(/:([ \t].*)?$/, "", k)
      v = trim(substr(rest, length(k) + 2))
      if (k ~ /^".*"$|^\047.*\047$/) k = substr(k, 2, length(k) - 2)
      pop(at)
      n++; key[n] = k; indent[n] = at
      if (v ~ /^[|>][-+0-9]*([ \t]+#.*)?$/) { bs = 1; bsind = at; bspath = path(); bsval = ""; next }
      print path() "\t" unq(v)
    }
    END { if (bs) print bspath "\t" bsval }
  ' "$1"
}

# wk_checks_kept_out <checks.yml> <default branch>: one `<reason>\t<what>` line per
# customization the caller does not keep, in file order: a step of the repo's own,
# a kit step changed, a trigger, filter, job or workflow setting the caller lacks
# (one it holds at the same value is none). An empty <what> stands alone.
wk_checks_kept_out() {
  local caller
  caller="$(wk_checks_leaves "$(wk_checks_template)")" || return 1
  # Each step a kit template carried, by name or else the action a nameless step
  # uses, and its body there; `*` is the kit's whatever it holds, `!` retired.
  local known=$'actions/checkout\tuses=actions/checkout|run=|with=|env=|other=\n'
  known+=$'actions/setup-node\tuses=actions/setup-node|run=|with=node-version=lts/*|env=|other=\n'
  known+=$'Configure git identity\tuses=|run=git config --global user.name "checks"; git config --global user.email "checks@ci.local"|with=|env=|other=\n'
  known+=$'Install dependencies\tuses=|run=if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; elif [ -f package.json ]; then npm install --no-audit --no-fund; fi|with=|env=|other=\n'
  known+=$'Test\tuses=|run=if [ -f package.json ] && node -e "process.exit((require(\'./package.json\').scripts || {}).test ? 0 : 1)"; then npm test; else echo "no test script, nothing to check"; fi|with=|env=|other=\n'
  known+=$'Check out the workkit kit\'s runner\t!\nCHANGELOG entry format\t*'
  wk_checks_leaves "$1" | KNOWN="$known" CALLER="$caller" BRANCH="$2" awk -v BINMODE=3 -F '\t' '
    function cat(a, b, sep) { return a == "" ? b : b == "" ? a : a sep b }
    function rel(from,   i, r) { r = ""; for (i = from; i <= np; i++) if (k[i] !~ /^\[/) r = cat(r, k[i], "."); return r }
    function part(from,   r) { r = rel(from); return r == "" ? v : v == "" ? "" : r "=" v }
    function note(gid, why, what, p) {
      if (!(gid in reason)) { order[++no] = gid; reason[gid] = why; label[gid] = what }
      parts[gid] = cat(parts[gid], p, ", ")
    }
    # The template triggers on pull_request and on push to the default branch; an
    # old copy ignoring a CHANGELOG-only push is none, as the release-push skip took
    # its place. Anything past that is named; the branches are judged whole at the end.
    function trigger(t, from) {
      if (t != "push" && t != "pull_request") { note("on" S t, "this trigger is not kept", t, np < from ? "" : part(from)); return }
      if (np < from) return
      if (t == "push" && k[from] == "branches") {
        if (!("branches" in reason)) { order[++no] = "branches"; reason["branches"] = "this trigger filter is not kept"; label["branches"] = "push.branches" }
        if (np == from) pbflow = v
        else pbitems = cat(pbitems, v, ", ")
        return
      }
      if (t == "push" && k[from] == "paths-ignore" && (v == "[CHANGELOG.md]" || v == "CHANGELOG.md" || v == "")) return
      note("on" S t S k[from], "this trigger filter is not kept", t "." k[from], part(from + 1))
    }
    function branches(   val) {
      val = pbflow != "" ? pbflow : "[" pbitems "]"
      if (val == "[" ENVIRON["BRANCH"] "]" || val == ENVIRON["BRANCH"]) return
      print reason["branches"] "\t" label["branches"] ": " val
    }
    function step(   sid, f) {
      sid = "step" S k[2] S k[4]
      if (!(sid in reason)) { order[++no] = sid; reason[sid] = "" }
      f = k[5]
      if (f == "name") sname[sid] = v
      else if (f == "uses") suses[sid] = v
      else if (f == "run") { gsub(" \342\200\224 ", ", ", v); srun[sid] = v }
      else if (f == "with") swith[sid] = cat(swith[sid], part(6), ", ")
      else if (f == "env") senv[sid] = cat(senv[sid], part(6), ", ")
      else if (f != "") sother[sid] = cat(sother[sid], part(5), ", ")
    }
    function judge(sid,   act, id, sig, what) {
      act = suses[sid]; sub(/@.*/, "", act)
      id = sname[sid] != "" ? sname[sid] : act
      if ((id in known) && known[id] == "*") return
      if ((id in known) && known[id] == "!") { print "the kit no longer clones itself; a repo whose tests need WORKKIT_ENGINE sets it in hooks.ciSetup\t"; return }
      sig = "uses=" act "|run=" srun[sid] "|with=" swith[sid] "|env=" senv[sid] "|other=" sother[sid]
      if (id in known && known[id] == sig) return
      what = srun[sid] != "" ? srun[sid] : "uses: " suses[sid]
      if (swith[sid] != "") what = what " (with: " swith[sid] ")"
      if (senv[sid] != "") what = what " (env: " senv[sid] ")"
      if (sother[sid] != "") what = what " (" sother[sid] ")"
      print (id in known ? "the kit'"'"'s own step runs in place of this one" : "move this step into hooks.ciSetup") "\t" (sname[sid] != "" ? sname[sid] : suses[sid] != "" ? suses[sid] : "a nameless step") ": " what
    }
    BEGIN {
      S = "\037"
      nk = split(ENVIRON["KNOWN"], l, "\n")
      for (i = 1; i <= nk; i++) { t = index(l[i], "\t"); known[substr(l[i], 1, t - 1)] = substr(l[i], t + 1) }
      nc = split(ENVIRON["CALLER"], l, "\n")
      for (i = 1; i <= nc; i++) caller[l[i]] = 1
    }
    $0 in caller { next }
    {
      v = substr($0, length($1) + 2)
      np = split($1, k, S)
      if (k[1] == "name" || (k[1] == "jobs" && np < 3)) next
      if (k[1] == "on") {
        if (np == 1) {
          gsub(/^\[|\]$/, "", v); nt = split(v, ts, ",")
          for (i = 1; i <= nt; i++) { t = ts[i]; gsub(/^[ \t]+|[ \t]+$/, "", t); if (t != "") trigger(t, 3) }
        } else if (k[2] ~ /^\[/) trigger(v, 3)
        else trigger(k[2], 3)
        next
      }
      if (k[1] != "jobs") { note("wf" S k[1], "this workflow setting is not kept", k[1], part(2)); next }
      if (k[3] == "steps") { if (np >= 5) step(); next }
      if (k[3] == "name" || (k[3] == "runs-on" && v == "ubuntu-latest") || (k[3] == "uses" && v ~ /^itw-creative-works\/workkit\/\.github\/workflows\/changelog\.yml@/)) next
      note("job" S k[2] S k[3], "this job setting is not kept", k[2] "." k[3], part(4))
    }
    END {
      for (i = 1; i <= no; i++) {
        g = order[i]
        if (g ~ /^step/) judge(g)
        else if (g == "branches") branches()
        else print reason[g] "\t" label[g] (parts[g] != "" ? ": " parts[g] : "")
      }
    }
  '
}

# ── 2b. The CI caller ──
# The kit owns checks.yml: any file that is not the rendered caller is
# rewritten, and each customization it held is named, for hooks.ciSetup or by hand.
ensure_ci_workflow() {
  local dest=".github/workflows/checks.yml" src tmp out="" why what had=0 branch
  src="$(wk_checks_template)"

  # The kit's own checks.yml runs its suite on Windows too and is no caller.
  if wk_is_kit_checkout "$PWD"; then
    wk_skip "checks: this is the workkit kit, whose $dest is its own"
    return 0
  fi
  # A repo with no GitHub remote has no Actions to call.
  if ! git remote get-url origin >/dev/null 2>&1; then
    wk_skip "checks: no origin remote, so no CI to call"
    return 0
  fi
  if [[ ! -f "$src" ]]; then
    wk_warn "checks: template missing at $(wk_native_path "$src"); reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  if ! branch="$(wk_default_branch)"; then
    wk_warn "checks: cannot tell the default branch (GitHub did not answer and origin/HEAD is unset), so $dest is left as it is; run \`git remote set-head origin -a\`"
    needs_attention=1
    return 0
  fi
  mkdir -p .github/workflows
  tmp="$dest.tmp.$$"
  if ! wk_checks_heal_rewrite "$src" >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    wk_warn "checks: could not render the kit's caller from $(wk_native_path "$src")"
    needs_attention=1
    return 0
  fi
  if [[ -f "$dest" ]] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    wk_skip "checks: $dest is the kit's caller"
    return 0
  fi

  # A copy that cannot be read is kept, so nothing is dropped unnamed.
  if [[ -f "$dest" ]]; then
    had=1
    if ! out="$(wk_checks_kept_out "$dest" "$branch" 2>/dev/null)"; then
      rm -f "$tmp"
      wk_warn "checks: could not read $dest; kept it, so replace it with the kit's caller by hand"
      needs_attention=1
      return 0
    fi
  fi
  if ! mv "$tmp" "$dest"; then
    rm -f "$tmp"
    wk_warn "checks: could not write $dest"
    needs_attention=1
    return 0
  fi
  if [[ "$had" -eq 0 ]]; then
    wk_ok "checks: created $dest, the kit's caller; commit it so it runs on every pull request and push"
    return 0
  fi
  wk_ok "checks: rewrote $dest to the kit's caller; commit it"
  while IFS=$'\t' read -r why what; do
    [[ -n "$why" ]] || continue
    wk_warn "checks.yml: replaced by the kit's caller; $why${what:+: $what}"
    needs_attention=1
  done <<<"$out"
}
