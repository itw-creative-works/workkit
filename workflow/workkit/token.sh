#!/usr/bin/env bash
# workflow/workkit/token.sh: the token handover, setup's last site step: this
# machine's gh login token handed to the published dashboard's Settings page
# once Pages serves the publish. SOURCED by workkit.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. Every name it
# reads (SCRIPT_DIR, HOME_LIBS, PAGES_WAIT) is the entry's, and `bounded_read`
# is workkit/secrets.sh's.

# The token handover (issue #230). Setup has just published the dashboard, and a
# published copy is LOCKED until a token reaches its Settings page. GitHub mints
# none through an API, so nothing can create a fresh one for that page; this
# machine's `gh` login already holds one carrying the `repo` scope the page names
# as the working kind, and the secrets step above already pushes that same token
# to the home repo. So setup hands it to the browser rather than leaving a paste
# to do: wait until Pages serves the commit the publish pushed, then open the
# Settings page with the token in the URL FRAGMENT. A fragment is never sent to
# a server, which is the whole reason it is the carrier and `?` never is; the
# page stores it where a typed one goes and strips it from the address bar
# (tower/README.md, where the ramification is stated too: the browser holds this
# login, so a `gh auth logout` locks the copy until setup runs again).
#
# Every ending here is a NAMED SKIP and a return 0. The site is published either
# way, and typing a token on the Settings page stays a path a human can walk.
handover_token() {
  local slug base host owner name url sha token page opener latest status commit waited=0 blanks=0 rc=0

  # A leftover from a run interrupted between the write and the removal below.
  # Cleared before anything new is written, so this directory never accumulates
  # pages that carry a token.
  rm -f "${TMPDIR:-/tmp}"/workkit-handover.*

  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "site: the token handover needs the home-repo library beside $SCRIPT_DIR"
    return 0
  fi
  slug="$(wk_home_slug 2>/dev/null || true)"
  if [[ -z "$slug" ]]; then
    wk_skip "site: the token handover needs a home repo to name the published site"
    return 0
  fi

  # The site's own base address, composed here because this is the first caller
  # that needs the whole URL: publish.sh derives only the PATH the build emits
  # its own links under. Both read the host through the engine's one reader
  # (`wk_site_host` in home/options.sh), and the rule is the same one, for the same
  # reason a CNAME carries no path: a custom domain serves at its root, and the
  # github.io default serves a project site under `/<name>/`. The owner is
  # lowercased because a github.io hostname is, whatever case the slug carries.
  host="$(wk_site_host 2>/dev/null || true)"
  if [[ -n "$host" ]]; then
    base="https://$host/"
  else
    owner="$(printf '%s' "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"
    name="${slug##*/}"
    base="https://$owner.github.io/$name/"
  fi
  # The app's own Settings path, under that base (its libs/tower/scope.js).
  url="${base}settings"

  # A recorded `site.url` is taken at its word where it is written down
  # (`ask_site_url`), so the address is checked before it reaches a message or
  # the page's JS string literal below: a quote, a backslash, an angle bracket
  # or any whitespace in it would end that literal or the tag around it, and a
  # `#` would open a fragment of its own that swallows the token's, leaving a
  # success line over a Settings page that was handed nothing. Refused rather
  # than escaped, the way the token is, because a domain shaped like that serves
  # nothing and is worth saying out loud.
  if [[ "$url" == *'"'* || "$url" == *'\'* || "$url" == *'<'* || "$url" == *'>'* || "$url" == *'#'* || "$url" =~ [[:space:]] ]]; then
    wk_skip "site: the recorded \`site.url\` cannot be put in a URL as it stands, so the token was not handed over; fix it in $WK_HOME_SETTINGS, then re-run \`workkit setup\`"
    return 0
  fi

  # The one thing this step cannot supply for itself. The skip names the URL
  # WITHOUT the fragment: no token is in that line, and it is the address the
  # same handover is done by hand at. A TERMINAL is not among the conditions
  # (issue #235): only `setup` calls this step, and setup is a human's act or the
  # ship's, never the 9am job's, so a piped run hands the token over exactly as
  # a run at a terminal does.
  if ! opener="$(wk_opener)"; then
    wk_skip "site: the token handover needs a browser opener; open $url and paste \`gh auth token\` on its Settings page"
    return 0
  fi

  # The commit the publish pushed. Waiting on the BUILD alone would hand the
  # token to whatever Pages is serving, which on a first publish is a 404.
  sha="$(wk_spin "reading $WK_HOME_PAGES_BRANCH on $slug" bounded_read gh api "repos/$slug/git/ref/heads/$WK_HOME_PAGES_BRANCH" --jq .object.sha 2>/dev/null || true)"
  if [[ -z "$sha" ]]; then
    wk_skip "site: $slug's $WK_HOME_PAGES_BRANCH head could not be read, so there is no publish to wait for; open $url and paste \`gh auth token\` on its Settings page"
    return 0
  fi

  # One line before the wait, because a silent minute at the end of setup reads
  # as a command that hung.
  wk_info "site: waiting for GitHub Pages to serve the publish"
  while :; do
    latest="$(wk_spin 'reading the latest Pages build' bounded_read gh api "repos/$slug/pages/builds/latest" --jq '[.status, .commit] | @tsv' 2>/dev/null || true)"
    status="${latest%%$'\t'*}"
    commit="${latest##*$'\t'}"
    # A read that came back with nothing at all, three polls running. TWO things
    # look like this and the line says both rather than picking one: a repo with
    # no Pages site (home/services.sh's Pages step can be refused, and
    # `pages/builds/latest` then 404s for ever) and a read that could not be
    # made at all, since `bounded_read`'s own contract is that a bound which
    # fired looks exactly like a listing that would not come. Either way the
    # wait would burn its whole ceiling, so it ends here with both the page that
    # turns Pages on and the by-hand URL. A status, `building` included, resets
    # the count and keeps the wait going.
    if [[ -z "$latest" ]]; then
      blanks=$((blanks + 1))
      if (( blanks >= 3 )); then
        wk_skip "site: three reads of $slug's latest Pages build came back with nothing, so the token was not handed over; Pages may be off (https://github.com/$slug/settings/pages) or unreachable; open $url and paste \`gh auth token\` on its Settings page"
        return 0
      fi
    else
      blanks=0
    fi
    if [[ "$status" == 'errored' ]]; then
      wk_warn "site: the GitHub Pages build for $slug errored, so nothing was handed over; open $url once it is green and paste \`gh auth token\` on its Settings page"
      return 0
    fi
    if [[ "$status" == 'built' && "$commit" == "$sha" ]]; then break; fi
    if (( waited >= PAGES_WAIT )); then
      wk_skip "site: GitHub Pages has not served the publish after ${PAGES_WAIT}s, so the token was not handed over; open $url and paste \`gh auth token\` on its Settings page"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  token="$(wk_spin 'reading the gh login token' gh auth token 2>/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 || -z "$token" ]]; then
    wk_skip "site: \`gh auth token\` returned nothing, so there was no token to hand over; run \`gh auth login\`, then open $url and paste it on the Settings page"
    return 0
  fi
  # A gh token is opaque but URL-safe as it stands, so it rides the fragment
  # unchanged. Anything else is not escaped on a guess: a token mangled on the
  # way in reads exactly like one GitHub refused, and that shape is also the
  # only one that could end the quoted string it is written into below.
  if [[ ! "$token" =~ ^[A-Za-z0-9_-]+$ ]]; then
    wk_skip "site: this login's token carries characters a URL fragment would have to escape, so it was not handed over; open $url and paste \`gh auth token\` on its Settings page"
    return 0
  fi

  # The token must never be an ARGUMENT: `open` puts a command's argv in `ps`
  # for as long as it runs, and `xdg-open` hands it to a browser whose argv
  # keeps it for that process's whole life. So the value travels in a file only
  # this user can read, and the browser follows the redirect out of it. mktemp
  # takes no suffix portably and an opener hands a file to a browser by its
  # extension, so the name is taken in two moves: create it, lock it down before
  # a byte is written, then rename it `.html` with the mode it already has.
  page="$(mktemp "${TMPDIR:-/tmp}/workkit-handover.XXXXXX")"
  chmod 600 "$page"
  mv "$page" "$page.html"
  page="$page.html"
  # The browser reads that file asynchronously: the opener returns as soon as an
  # app has been handed the path, so a removal on the next line races the read.
  # It happens at EXIT instead, after three seconds of grace, and the sweep at
  # the top of this step covers a run interrupted before it ever got here.
  #
  # A SIGNAL takes it at once and without the grace, because the grace is not
  # the whole of the window: setup carries on to its next question, and a Ctrl-C
  # at that prompt would otherwise leave a 600 page holding a live token in
  # TMPDIR. Each handler drops the EXIT trap it has just done the work of, then
  # exits with the signal's conventional code (128 plus the number), since a
  # handler that returned would swallow the interrupt for the rest of setup.
  trap "trap - EXIT; rm -f '$page'; exit 130" INT
  trap "trap - EXIT; rm -f '$page'; exit 143" TERM
  trap "sleep 3; rm -f '$page'" EXIT
  printf '%s' "<!doctype html><meta charset=\"utf-8\"><script>location.replace(\"$url#token=$token\")</script>" >"$page"

  if ! "$opener" "$page" >/dev/null 2>&1; then
    wk_warn "site: \`$opener\` did not open the handover page, so the token was not handed over; open $url and paste \`gh auth token\` on its Settings page"
    return 0
  fi
  wk_ok "site: the dashboard's Settings page was opened with this machine's gh login token; the browser now holds it"
}
