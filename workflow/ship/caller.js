// workflow/ship/caller.js: a repo's checks caller, the workflow whose `release`
// job makes the ship's GitHub release: its path, the job check, and the two git
// reads the ship judges it by (the caller as committed, and whether it is pending).
// Usage: const { CALLER, hasReleaseJob, callerAtHead, callerPending } = require('./caller');

const { gitIn, textAt } = require('../lib/git');
const { endOf } = require('../lib/say');

const CALLER = '.github/workflows/checks.yml';

/**
 * Whether a checks.yml's top-level `jobs:` holds a job named `release`.
 * @param {string} text - the workflow file
 * @returns {boolean}
 */
const hasReleaseJob = (text) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((line) => /^["']?jobs["']?\s*:\s*(#.*)?$/.test(line));
  if (start < 0) return false;
  let indent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const at = line.search(/\S/);
    if (at === 0) return false;
    if (indent === null) indent = at;
    if (at === indent && /^["']?release["']?\s*:/.test(line.slice(at))) return true;
  }
  return false;
};

/**
 * The caller's text as HEAD holds it, the file CI ran.
 * @param {string} root - the repo root
 * @returns {string|null} null when HEAD has no such file or the repo has no HEAD
 */
const callerAtHead = (root) => textAt(root, 'HEAD', CALLER);

/**
 * Whether the caller is changed, staged or untracked: `git status --porcelain`
 * prints a line for it, an untracked one shown whatever status.showUntrackedFiles says.
 * @param {string} root - the repo root
 * @returns {boolean}
 * @throws {Error} when git status fails, which a repo git already read never should
 */
const callerPending = (root) => {
  const res = gitIn(root, ['status', '--porcelain', '--untracked-files=normal', '--', CALLER], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) throw new Error(`git status ${endOf(res)}: ${(res.stderr || '').trim()}`);
  return res.stdout.trim() !== '';
};

module.exports = {
  CALLER, hasReleaseJob, callerAtHead, callerPending,
};
