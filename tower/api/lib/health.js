//
// Per-repo health — the work sitting on the table.
//
// Four numbers, all of them things git and the CHANGELOG already know:
//   unpushed          commits ahead of the upstream (null when there is none —
//                     a branch with no upstream is a DIFFERENT state from a
//                     branch that is level with one, and collapsing them to 0
//                     would hide the repo that has never been pushed)
//   uncommitted       working-tree entries
//   unreleasedEntries bullets under the CHANGELOG's [Unreleased] heading
//   lastTag           the most recent release tag
//
// Nothing here throws. The tower renders a tile per repo on a poll, and one
// unreadable checkout must not take the pane down — a broken repo reports nulls
// and names the problem in `error`.
//
// Usage:
//   const { repoHealth } = require('./health');
//   repoHealth('/path/to/repo');
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UNRELEASED_RE = /^##\s+\[Unreleased\]/i;
const SECTION_RE = /^##\s+\[/;
const BULLET_RE = /^-\s/;

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

const countLines = (text) => text.split('\n').filter((l) => l.trim() !== '').length;

/**
 * Bullets under `## [Unreleased]`, stopping at the next version section. A repo
 * with no CHANGELOG, or one whose [Unreleased] section was just emptied by a
 * release, counts 0.
 * @param {string} file
 * @returns {number}
 */
const unreleasedCount = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  let inSection = false;
  let count = 0;
  for (const line of text.split('\n')) {
    if (UNRELEASED_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && SECTION_RE.test(line)) break;
    if (inSection && BULLET_RE.test(line)) count++;
  }
  return count;
};

/**
 * One repo's health.
 * @param {string} repoPath
 * @param {object} [opts]
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git seam
 * @returns {{unpushed: number|null, uncommitted: number|null, unreleasedEntries: number, lastTag: string|null, error: string|null}}
 */
const repoHealth = (repoPath, opts = {}) => {
  const exec = opts.exec || defaultExec;
  const git = (...args) => exec('git', ['-C', repoPath, ...args]);

  const health = {
    unpushed: null,
    uncommitted: null,
    unreleasedEntries: unreleasedCount(path.join(repoPath, 'CHANGELOG.md')),
    lastTag: null,
    error: null,
  };

  try {
    git('rev-parse', '--git-dir');
  } catch {
    health.error = `not a git repository: ${repoPath}`;
    return health;
  }

  try {
    health.uncommitted = countLines(git('status', '--porcelain'));
  } catch (err) {
    health.error = err.message;
  }

  try {
    // No upstream makes this fail; that IS the null, not an error to report.
    health.unpushed = countLines(git('log', '@{u}..HEAD', '--oneline'));
  } catch {
    health.unpushed = null;
  }

  try {
    health.lastTag = git('describe', '--tags', '--abbrev=0').trim() || null;
  } catch {
    // An unreleased repo has no tags. Expected, not an error.
    health.lastTag = null;
  }

  return health;
};

module.exports = { repoHealth, unreleasedCount };
