#!/usr/bin/env bash
# workflow/workkit/site.sh: the dashboard site question setup asks once,
# whether the home repo publishes and at what domain, and the one guarded write
# both answers make to the machine's settings file. SOURCED by workkit.sh,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing. Every name it reads (SCRIPT_DIR, HOME_LIBS, the `interactive` check)
# and the one it sets at run time (SITE_PUBLISH) are the entry's.

# The site switch, asked once (issue #84). Setup builds the whole publish path
# (the home repo, the clone, the tower project, its dependencies) and then left
# `site.publish` seeded false, so going live meant knowing to hand-edit a file
# nobody had been told about. Setup is the one command a human runs at a
# terminal, so it is the one place the question can be put.
#
# The switch has THREE states: `true` and `false` are answers and are never
# asked again, null (or no key at all) is a machine that has never been asked.
# Every reader still treats anything but `true` as off, so an unanswered machine
# publishes nothing while it waits.
offer_site_publish() {
  local current
  # Reset at entry: only THIS run's ending may publish, never a stale value.
  SITE_PUBLISH=''

  # The whole step reads and writes the machine's settings file through the
  # engine's library: the same reader, the same JSON edit, the same mutex every
  # other writer of that file takes. Without it there is no safe write to make,
  # and home_steps has already named the incomplete checkout.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "site: the publish question needs the home-repo library beside $SCRIPT_DIR"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "site: reading the publish switch in $WK_HOME_SETTINGS needs jq"
    return 0
  fi
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    wk_skip "site: $WK_HOME_SETTINGS does not exist yet; the first heal seeds it, and the next setup asks"
    return 0
  fi

  # Read RAW rather than through wk_json_get: jq's `//` treats false as absent,
  # and false is the one answer this step must be able to tell from silence.
  # "null" is what an absent key and a null both render as: the same state.
  current="$(wk_jq -r '.site.publish | tostring' "$WK_HOME_SETTINGS" 2>/dev/null || printf '')"
  if [[ -z "$current" ]]; then
    wk_warn "site: $WK_HOME_SETTINGS does not parse as JSON; the publish question was not asked; fix the file, then re-run \`workkit setup\`"
    return 0
  fi

  # No home repo, nothing to publish from: the question would be about a site
  # that has nowhere to go.
  if [[ -z "$(wk_home_slug)" ]]; then
    wk_skip "site: no home repo yet; the publish question comes once there is one to publish from"
    return 0
  fi

  case "$current" in
    true)  SITE_PUBLISH=true; wk_skip "site: publishing is on; edit \`site.publish\` in $WK_HOME_SETTINGS to change it"; return 0 ;;
    false) wk_skip "site: publishing is off; edit \`site.publish\` in $WK_HOME_SETTINGS to change it"; return 0 ;;
  esac

  if ! interactive; then
    wk_info "site: nobody has been asked whether to publish the dashboard; a terminal run of \`workkit setup\` puts the question; until then nothing is published"
    return 0
  fi

  local answer="" value=false
  printf 'Publish the dashboard site to GitHub Pages? [y/N] '
  read -r answer || true
  case "$answer" in
    y|Y|yes|YES) value=true ;;
    *) value=false ;;
  esac
  set_site_publish "$value"
  SITE_PUBLISH="$value"

  # The domain rides the FRESH yes and nothing else: it is the one moment the
  # answer is free (the site has never been built, so no address is in use yet)
  # and asking on every later run would nag a machine that already said yes.
  # An already-answered machine changes its domain by hand edit, as it does
  # today. Nothing to ask either when a domain is already recorded.
  if [[ "$value" == 'true' ]] && [[ "$(wk_jq_default 'null' -r '.site.url | tostring' "$WK_HOME_SETTINGS")" == 'null' ]]; then
    ask_site_url
  fi
}

# The custom domain, asked right after the fresh yes. Empty input is an answer
# too: it means the plain github.io address, so nothing is written, `site.url`
# stays null and publish.sh writes no CNAME. Whatever is typed is taken at its
# word: publish.sh already strips a scheme prefix on its way to the CNAME, and
# the shape of a domain is not this command's to judge.
ask_site_url() {
  local answer=""

  printf 'Custom domain for the site? [enter for none] '
  read -r answer || true
  [[ -n "$answer" ]] || return 0
  set_site_url "$answer"
}

# Record the answer. A whole-file read-modify-write on the file a heal in
# another session may be writing at the same moment, so it takes the engine's
# one state mutex exactly as wk_home_set_slug does.
set_site_publish() {
  local value="$1" rc=0

  write_site_option publish "$value" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    wk_warn "site: the answer could not be written to $WK_HOME_SETTINGS; set \`site.publish\` there by hand"
    return 0
  fi
  if [[ "$value" == 'true' ]]; then
    wk_ok "site: publishing is on; \`workkit publish\` builds it now, and the daily job publishes after the morning brief (what Pages serves is public, even from a private repo)"
  else
    wk_ok "site: publishing stays off; set \`site.publish\` to true in $WK_HOME_SETTINGS whenever you want the dashboard live"
  fi
  return 0
}

# The same write for the domain, in the same voice.
set_site_url() {
  local url="$1" rc=0

  write_site_option url "$(printf '%s' "$url" | wk_jq -R .)" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    wk_warn "site: the domain could not be written to $WK_HOME_SETTINGS; set \`site.url\` there by hand"
    return 0
  fi
  wk_ok "site: the site answers at $url; the publish writes the CNAME, and the DNS record is yours to point at GitHub Pages"
  return 0
}

# The one guarded write of a site option: the whole-file read-modify-write both
# answers make, under the engine's one state mutex. `value` is JSON: a bare
# `true`, or a jq-encoded string.
write_site_option() {
  local key="$1" value="$2" locked=0 rc=0

  if wk_take_state_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg k "$key" --argjson v "$value" '.site = ((.site // {}) + { ($k): $v })' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi

  return "$rc"
}
