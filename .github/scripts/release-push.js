#!/usr/bin/env node
// .github/scripts/release-push.js <before>: whether the pushed commit at HEAD needs the suite, one
// `run=true|false` line. A release stamp (false) changed since <before> only the root CHANGELOG.md
// and manifests whose change is the version alone (isManifest, versionOnly), read from both commits
// through git, so no ref moves. A <before> the shallow checkout lacks is fetched first.

const { gitIn, hasCommit, textAt } = require('../../workflow/lib/git');
const { writeErr } = require('../../workflow/lib/say');
const { isManifest, versionOnly } = require('../../hooks/mods/commit-gate/checks.js');

const USAGE = 'usage: release-push.js <before>';
// sysexits' EX_USAGE.
const USAGE_CODE = 64;

/**
 * Whether the push from <before> to HEAD needs the suite.
 * @param {string} root - a folder in the checkout
 * @param {string} before - the event's before commit, perhaps empty or all zeros
 * @returns {boolean}
 */
const needsSuite = (root, before) => {
  // A fetch that fails leaves <before> unreadable, which the check below answers.
  if (/^[0-9a-f]+$/.test(before) && !/^0+$/.test(before) && !hasCommit(root, before)) {
    gitIn(root, ['fetch', '-q', '--depth=1', 'origin', before], { stdio: 'ignore' });
  }
  // An unreadable <before> (a new branch, a force push, a commit origin lacks) runs.
  if (before === '' || /^0+$/.test(before) || !hasCommit(root, before)) return true;
  const diff = gitIn(root, ['diff', '--name-only', '--no-renames', '-z', before, 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const paths = diff.status === 0 ? diff.stdout.split('\0').filter(Boolean) : [];
  if (paths.length === 0) return true;
  return paths.some((file) => file !== 'CHANGELOG.md'
    && !(isManifest(file) && versionOnly(textAt(root, before, file), textAt(root, 'HEAD', file))));
};

const main = (argv) => {
  if (argv.length < 1) {
    writeErr(`${USAGE}\n`);
    return USAGE_CODE;
  }
  process.stdout.write(`run=${needsSuite(process.cwd(), argv[0])}\n`);
  return 0;
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
