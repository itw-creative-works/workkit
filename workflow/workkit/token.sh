#!/usr/bin/env bash
# workflow/workkit/token.sh: the token handover, setup's last site step: this
# machine's gh login token handed to the published dashboard's Settings page
# once Pages serves the publish. Sourced by workkit.sh, functions only;
# SCRIPT_DIR, HOME_LIBS and PAGES_WAIT are the entry's, and `bounded_read` is
# workkit/secrets.sh's.

# The gh login token opened on the site's Settings page in the URL fragment,
# which a browser never sends to a server (`workflow/README.md` § The home
# repo's lifecycle, step 13). Every ending is a named skip and a return 0.
handover_token() {
  local slug base host owner name url sha token page opener latest status commit waited=0 blanks=0 rc=0

  # Sweep a leftover from an interrupted run before writing anything new.
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

  # The rule publish.sh's path prefix follows: a custom domain serves at its
  # root, github.io under `/<name>/`, its owner lowercased as a hostname is.
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

  # `site.url` is taken at its word, so an address that would break the page's
  # string literal or open its own fragment is refused rather than escaped.
  if [[ "$url" == *'"'* || "$url" == *'\'* || "$url" == *'<'* || "$url" == *'>'* || "$url" == *'#'* || "$url" =~ [[:space:]] ]]; then
    wk_skip "site: the recorded \`site.url\` cannot be put in a URL as it stands, so the token was not handed over; fix it in $WK_HOME_SETTINGS, then re-run \`workkit setup\`"
    return 0
  fi

  # The skip names the URL without the fragment, the by-hand address. A
  # terminal is not a condition: only setup calls this, a human's or a ship's.
  if ! opener="$(wk_opener)"; then
    wk_skip "site: the token handover needs a browser opener; open $url and paste \`gh auth token\` on its Settings page"
    return 0
  fi

  # The commit the publish pushed: waiting on any build would hand the token to
  # whatever Pages serves, a 404 on a first publish.
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
    # Three empty reads running is Pages off or GitHub unreachable, and the line
    # names both; any status, `building` included, resets the count.
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

  # Never an argument, since `open` and `xdg-open` expose argv. The page is 600
  # before a byte lands, then renamed `.html` so the opener hands it to a browser.
  page="$(mktemp "${TMPDIR:-/tmp}/workkit-handover.XXXXXX")"
  chmod 600 "$page"
  mv "$page" "$page.html"
  page="$page.html"
  # The browser reads the page asynchronously, so EXIT removes it after three
  # seconds. A signal removes it at once and exits 128 plus its number, since a
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
