#!/bin/bash
# .github/scripts/ci-test.sh [repo]: ci.yml's test step, run from the repo root
# (repo defaults to the current folder): `xvfb-run -a npm test` when package.json
# has a test script, so a suite that opens a window runs on Linux, plain `npm test`
# where xvfb-run is absent (a Mac); no test script is one line and a pass. A release
# push (GITHUB_EVENT_NAME push, its <before> read from GITHUB_EVENT_PATH, judged by
# release-push.sh) runs no suite either: one line and a pass.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

cd "${1:-.}"

# The checkout is the pushed commit alone, so <before> is fetched when missing; a
# fetch that fails leaves it unreadable, which release-push.sh answers with run.
if [ "${GITHUB_EVENT_NAME:-}" = push ] && [ -n "${GITHUB_EVENT_PATH:-}" ]; then
  before="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).before || ""))' "$GITHUB_EVENT_PATH")"
  if [[ "$before" =~ ^[0-9a-f]+$ && ! "$before" =~ ^0+$ ]] && ! git cat-file -e "$before^{commit}" 2>/dev/null; then
    git fetch -q --depth=1 origin "$before" 2>/dev/null || true
  fi
  if [ "$(bash "$here/release-push.sh" "$before")" = "run=false" ]; then
    echo "a release push: every change is the CHANGELOG or a version stamp, so no suite"
    exit 0
  fi
fi

if [ -f package.json ] && node -e "process.exit((require('./package.json').scripts || {}).test ? 0 : 1)"; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a npm test
  fi
  exec npm test
fi

echo "no test script, nothing to check"
