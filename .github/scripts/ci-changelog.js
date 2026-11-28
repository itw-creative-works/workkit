#!/usr/bin/env node
// .github/scripts/ci-changelog.js: changelog.yml's entry check of the CHANGELOG.md at the working
// folder, through the kit's linter on this Node. A pull request (BASE_REF set) judges the entries it
// adds against its merge commit's first parent, a push only [Unreleased]; no CHANGELOG.md is one
// line and a pass. The linter's exit code is the script's.

const path = require('path');
const { spawnSync } = require('../../workflow/lib/run');
const { isFile } = require('../../workflow/lib/lock');
const { codeOf } = require('../../workflow/lib/detach');

const FILE = 'CHANGELOG.md';
const LINT = path.join(__dirname, '..', '..', 'workflow', 'changelog', 'lint.js');

const main = () => {
  if (!isFile(FILE)) {
    process.stdout.write(`no ${FILE}, nothing to check\n`);
    return 0;
  }
  const flags = process.env.BASE_REF ? ['--added-only', '--base=HEAD^1'] : ['--unreleased-only'];
  const res = spawnSync(process.execPath, [LINT, FILE, ...flags], { stdio: 'inherit' });
  return codeOf(res);
};

if (require.main === module) {
  process.exitCode = main();
}
