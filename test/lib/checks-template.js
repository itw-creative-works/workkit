// The checks.yml copies the heal suites hand the heal: the whole template as it
// shipped before the caller, and that text with steps put in, the kit clone step
// an older template carried among them.

const { expect } = require('./harness');

// The kit clone step as the template carried it before the runner was a
// package, the comment lines above it included.
const CLONE_STEP = [
  "      # A repo's test/run.js reaches the kit's runner, and a runner has no kit:",
  '      # a shallow clone of the public kit, WORKKIT_ENGINE and, for the hooks, a',
  '      # `workkit` wrapper on PATH; no link, since npm on Windows would need a',
  '      # .cmd wrapper. The kit itself skips it.',
  "      - name: Check out the workkit kit's runner",
  '        shell: bash',
  '        run: |',
  '          if [ -f workflow/test/run.js ]; then',
  '            echo "this repo is the kit, its runner is already here"',
  '          else',
  '            git clone --depth 1 https://github.com/itw-creative-works/workkit "$HOME/workkit-kit"',
  "            # node and the runner cannot resolve Git Bash's /c/... spelling, so a Windows",
  '            # runner exports the mixed form of both paths.',
  '            engine="$HOME/workkit-kit/workflow"',
  '            bin="$HOME/.local/bin"',
  '            if command -v cygpath >/dev/null 2>&1; then',
  '              engine="$(cygpath -m "$engine")"',
  '              bin="$(cygpath -m "$bin")"',
  '            fi',
  '            echo "WORKKIT_ENGINE=$engine" >> "$GITHUB_ENV"',
  '            mkdir -p "$HOME/.local/bin"',
  '            printf \'#!/usr/bin/env bash\\nexec bash "$HOME/workkit-kit/workflow/workkit.sh" "$@"\\n\' > "$HOME/.local/bin/workkit"',
  '            chmod +x "$HOME/.local/bin/workkit"',
  '            echo "$bin" >> "$GITHUB_PATH"',
  '          fi',
];

// The checks.yml the template installed before the kit owned the caller: the
// copy a repo that never edited it still holds.
const OLD_CHECKS = `${[
  '# Checks (workflow spec): the test gate that runs on every pull request and',
  '# every push to the default branch.',
  '# Making it a REQUIRED check is a repo setting (branch protection / ruleset)',
  '# a human turns on; until then it runs and reports, and the ship skill treats',
  '# a red run as unmergeable.',
  '# Installed once by workflow/standards.sh; after that this copy is the repo\'s',
  '# own, so repo-specific steps (extra tools, matrix builds) belong here, not in',
  '# the workflow core\'s template.',
  '#',
  '# The jobs mirror what the local hooks run: the npm test suite',
  '# (safety:commit-gate) and the CHANGELOG entry format (docs:changelog-guard).',
  '# A repo without a test script or without a CHANGELOG passes trivially. The',
  '# checks exist so a pull request from ANY author (cloud agent, collaborator,',
  '# laptop without the hooks) meets the same bar before merge.',
  '#',
  '# A push to the default branch (main in the template) runs them too, so work a',
  '# local session commits direct gets the clean-runner suite; a push changing only',
  '# the CHANGELOG runs nothing. The heal adds this push trigger once to a',
  '# checks.yml that runs on pull requests only. A repo whose default branch is not',
  '# main edits its own copy.',
  '#',
  '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,',
  '# appended once at the end of `jobs:`. It calls the kit\'s reusable workflow,',
  '# which runs the kit\'s own changelog/lint.js, so the linter lives in the kit',
  '# and nowhere else. That workflow (.github/workflows/changelog.yml in the kit)',
  '# decides what a push and a pull request judge.',
  'name: checks',
  '',
  'on:',
  '  pull_request:',
  '  push:',
  '    branches: [main]',
  '    paths-ignore: [CHANGELOG.md]',
  '',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v5',
  '      - uses: actions/setup-node@v5',
  '        with:',
  '          node-version: lts/*',
  '      # A runner has no global git identity, so any test that builds a scratch',
  '      # repo and commits into it fails at "Author identity unknown".',
  '      - name: Configure git identity',
  '        run: |',
  '          git config --global user.name "checks"',
  '          git config --global user.email "checks@ci.local"',
  '      - name: Install dependencies',
  '        run: |',
  '          if [ -f package-lock.json ]; then',
  '            npm ci --no-audit --no-fund',
  '          elif [ -f package.json ]; then',
  '            npm install --no-audit --no-fund',
  '          fi',
  '      - name: Test',
  '        run: |',
  '          if [ -f package.json ] && node -e "process.exit((require(\'./package.json\').scripts || {}).test ? 0 : 1)"; then',
  '            npm test',
  '          else',
  '            echo "no test script, nothing to check"',
  '          fi',
  '  changelog:',
  '    uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main',
].join('\n')}\n`;

// A checks.yml text with `steps` (lines) put in right before its Test step.
const withSteps = (text, steps) => {
  const lines = text.split('\n');
  const at = lines.indexOf('      - name: Test');
  expect(at > 0, 'the template carries the Test step').toBeTruthy();
  return [...lines.slice(0, at), ...steps, ...lines.slice(at)].join('\n');
};

// A checks.yml text with the kit clone step put back right before its Test step.
const withCloneStep = (text) => withSteps(text, CLONE_STEP);

module.exports = { withSteps, withCloneStep, OLD_CHECKS };
