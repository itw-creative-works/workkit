#!/usr/bin/env node
// .github/scripts/ci-install.js: the dependency install of the repo at the working folder, by its
// lockfile: `npm ci` with a package-lock.json, else `npm install` with a package.json, else nothing
// and a pass. npm's exit code is the script's.

const { spawnSync } = require('../../workflow/lib/run');
const { isFile } = require('../../workflow/lib/lock');
const { codeOf } = require('../../workflow/lib/detach');

const FLAGS = ['--no-audit', '--no-fund'];

/** The npm verb the working folder's files pick, or null for none. */
const verbOf = () => {
  if (isFile('package-lock.json')) return 'ci';
  if (isFile('package.json')) return 'install';
  return null;
};

const main = () => {
  const verb = verbOf();
  if (verb === null) return 0;
  // By name, so the npm is PATH's, the repo's, never the kit's Node's.
  return codeOf(spawnSync('npm', [verb, ...FLAGS], { stdio: 'inherit' }));
};

if (require.main === module) {
  process.exitCode = main();
}
