#!/bin/bash
# .github/scripts/ci-setup.sh [repo]: ci.yml's setup step, the repo's own CI needs.
# Runs each hooks.ciSetup entry of the repo's .workkit/settings.json, the ship
# hooks' shape (workflow/ship/entries.js), through `bash -c` from the repo root in
# order; the first failure names it and exits with its code. No file or key runs nothing.

set -euo pipefail

entries="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../workflow/ship" && pwd -P)/entries.js"

cd "${1:-.}"

settings=".workkit/settings.json"
[ -f "$settings" ] || exit 0

commands="$(mktemp)"
trap 'rm -f "$commands"' EXIT

# One NUL-ended record per entry, L (local only) or R then the command, so a
# command may span lines.
node -e '
  const fs = require("fs");
  const [entries, file] = process.argv.slice(1);
  const { HooksError, commandsOf } = require(entries);
  const fail = (why) => { console.error(`ci-setup: ${why}`); process.exit(1); };
  const text = fs.readFileSync(file, "utf8");
  if (text.trim() === "") process.exit(0);
  let settings;
  try { settings = JSON.parse(text); } catch (err) { fail(`${file} is not valid JSON: ${err.message}`); }
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) fail(`${file} is not a JSON object`);
  if (settings.hooks === undefined || settings.hooks === null) process.exit(0);
  if (typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) fail(`hooks in ${file} is not an object`);
  if (settings.hooks.ciSetup === undefined || settings.hooks.ciSetup === null) process.exit(0);
  try {
    const list = commandsOf(settings, "ciSetup");
    process.stdout.write(list.map(({ command, local }) => `${local ? "L" : "R"}${command}\0`).join(""));
  } catch (err) {
    if (!(err instanceof HooksError)) throw err;
    fail(err.message);
  }
' "$entries" "$settings" >"$commands"

# Read from fd 3, so a command reading stdin gets the step's own.
while IFS= read -r -d '' record <&3; do
  command="${record:1}"
  if [ "${record:0:1}" = L ]; then
    printf 'ci-setup: skipped, local only: %s\n' "$command"
    continue
  fi
  printf '::group::ci-setup: %s\n' "$command"
  status=0
  bash -c "$command" || status=$?
  printf '::endgroup::\n'
  if [ "$status" -ne 0 ]; then
    printf 'ci-setup: failed: %s\n' "$command" >&2
    exit "$status"
  fi
done 3<"$commands"
