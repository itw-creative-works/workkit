#!/usr/bin/env node
// .github/scripts/release-push.js: whether the event needs the suite, one `run=true|false` line
// appended to the file GITHUB_OUTPUT names. An event other than a push runs (true). A push from
// BEFORE to HEAD that is a release stamp (false) changed only the root CHANGELOG.md and manifests
// whose change is the version alone (isManifest, versionOnly), read from both commits through git,
// so no ref moves. A BEFORE the shallow checkout lacks is fetched first.

const { gitIn, hasCommit, textAt } = require('../../workflow/lib/git');
const { isManifest, versionOnly } = require('../../hooks/mods/commit-gate/checks.js');
const { appendTo } = require('../../workflow/lib/step-value');

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

const main = () => {
  const { GITHUB_EVENT_NAME: event, BEFORE: before = '' } = process.env;
  const run = event !== 'push' || needsSuite(process.cwd(), before);
  return appendTo('release-push', 'GITHUB_OUTPUT', `run=${run}\n`);
};

if (require.main === module) {
  process.exitCode = main();
}
