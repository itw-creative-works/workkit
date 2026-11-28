#!/usr/bin/env node
// .github/scripts/ci-test.js [repo]: ci.yml's test step, from the repo root. With a test script,
// `xvfb-run -a npm test` (a suite that opens a window runs on Linux), plain `npm test` where xvfb-run
// is absent, each through a shell on PATH's Node; no test script is one line and a pass. It reads no
// event: ci.yml's Scope step decides, before the repo's own setup, whether a push runs it.

const path = require('path');
const { spawnSync } = require('../../workflow/lib/run');
const { readJsonOrNull } = require('../../workflow/lib/read');
const { isDir } = require('../../workflow/lib/lock');
const { sayAs } = require('../../workflow/lib/say');
const { codeOf } = require('../../workflow/lib/detach');
const { hasTestScript } = require('../../hooks/mods/suite.js');

// By name through a shell, so npm and the suite it starts are PATH's, never the kit's Node.
const SUITE = 'if command -v xvfb-run >/dev/null 2>&1; then exec xvfb-run -a npm test; fi; exec npm test';

const main = (argv) => {
  const dir = argv[0] || '.';
  const root = path.resolve(dir);
  if (!isDir(root)) {
    sayAs('ci-test')(`${dir} is no folder`);
    return 1;
  }
  if (!hasTestScript(readJsonOrNull(path.join(root, 'package.json')))) {
    process.stdout.write('no test script, nothing to check\n');
    return 0;
  }
  const res = spawnSync('bash', ['-c', SUITE], { cwd: root, stdio: 'inherit' });
  return codeOf(res);
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
