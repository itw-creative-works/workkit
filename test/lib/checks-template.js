// The kit's checks.yml template as the heal suites read it: its opening
// sentence, the three-line rewrap both changelog-job suites prove the heal
// against, and the kit clone step an older template carried, put back in.

const { assert } = require('./harness');

// A template's opening sentence: its leading `#` lines up to and including the
// first that ends in a period.
const openingLines = (text) => {
  const lines = text.split('\n');
  const end = lines.findIndex((l) => !l.startsWith('#') || l.endsWith('.'));
  assert(end >= 0 && lines[end].startsWith('#'), 'the template opens with a # sentence ending in a period');
  return `${lines.slice(0, end + 1).join('\n')}\n`;
};

const TOP_THREE = '# Checks (workflow spec): the test gate that runs on every\n'
  + '# pull request and every push to the\n# default branch.\n';

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

// A checks.yml text with the kit clone step put back right before its Test step.
const withCloneStep = (text) => {
  const lines = text.split('\n');
  const at = lines.indexOf('      - name: Test');
  assert(at > 0, 'the template carries the Test step');
  return [...lines.slice(0, at), ...CLONE_STEP, ...lines.slice(at)].join('\n');
};

module.exports = { openingLines, TOP_THREE, withCloneStep };
