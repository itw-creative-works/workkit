#!/bin/bash
# .github/scripts/ci-test.sh [repo]: ci.yml's test step, run from the repo root
# (repo defaults to the current folder): `xvfb-run -a npm test` when package.json
# has a test script, so a suite that opens a window runs on Linux, plain `npm test`
# where xvfb-run is absent (a Mac); no test script is one line and a pass. It reads
# no event: ci.yml's Scope step decides, before setup, whether a push runs it.

set -euo pipefail

cd "${1:-.}"

if [ -f package.json ] && node -e "process.exit((require('./package.json').scripts || {}).test ? 0 : 1)"; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a npm test
  fi
  exec npm test
fi

echo "no test script, nothing to check"
