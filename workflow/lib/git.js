// workflow/lib/git.js: the git reads the kit's Node scripts share, the default
// branch GitHub names among them, so a lookup has one spelling and every
// caller keeps its own reaction to a miss.
// Usage: const { repoRoot, headSha, gitIn, hasCommit, textAt, commitIdentity, defaultBranch } = require('../lib/git');

const { spawnSync } = require('./run');

// The most output one git read keeps, ample for a repo's whole path list.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * git run in `root` (`git -C <root> <args>`), as spawnSync answers, its output
 * kept up to GIT_MAX_BUFFER; each caller passes its own stdio, encoding and env.
 * @param {string} root
 * @param {string[]} args
 * @param {object} [options] spawnSync's options
 * @returns {object} spawnSync's result
 */
const gitIn = (root, args, options = {}) => spawnSync('git', ['-C', root, ...args], {
  maxBuffer: GIT_MAX_BUFFER, windowsHide: true, ...options,
});

/**
 * The git top level of `cwd`, or null outside a repo or for a folder that is
 * not there (git does not start in it).
 * @param {string} cwd
 * @returns {string|null}
 */
const repoRoot = (cwd) => {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  return res.status === 0 ? res.stdout.trim() : null;
};

/**
 * The full sha of HEAD in `cwd`'s repo, or null outside a repo or in one with
 * no commit yet.
 * @param {string} cwd
 * @returns {string|null}
 */
const headSha = (cwd) => {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  return res.status === 0 ? res.stdout.trim() : null;
};

/**
 * Whether `rev` names a commit the repo at `root` holds (`git cat-file -e
 * <rev>^{commit}`); false for any other answer, a shallow clone's missing one too.
 * @param {string} root
 * @param {string} rev
 * @returns {boolean}
 */
const hasCommit = (root, rev) => gitIn(root, ['cat-file', '-e', `${rev}^{commit}`], { stdio: 'ignore' }).status === 0;

/**
 * The text of `file` at `rev` in the repo at `root` (`git show <rev>:<file>`),
 * or null when git cannot read it there: no such commit, or no such file in it.
 * @param {string} root
 * @param {string} rev
 * @param {string} file the path from the repo root
 * @returns {string|null}
 */
const textAt = (root, rev, file) => {
  const res = gitIn(root, ['show', `${rev}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? res.stdout : null;
};

/**
 * The `-c` pairs a kit commit runs under, so a machine with no git identity
 * still commits: GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL when set, else workkit's.
 * @returns {string[]}
 */
const commitIdentity = () => [
  '-c', `user.name=${process.env.GIT_AUTHOR_NAME || 'workkit'}`,
  '-c', `user.email=${process.env.GIT_AUTHOR_EMAIL || 'workkit@localhost'}`,
];

/**
 * The default branch of the repo at `root`, the one read the checks caller and
 * branch protection share: GitHub's answer, else origin/HEAD's, else null:
 * neither is a failure, never a guess.
 * @param {string} root
 * @returns {string|null}
 */
const defaultBranch = (root) => {
  const gh = spawnSync('gh', ['api', 'repos/{owner}/{repo}', '--jq', '.default_branch'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  const branch = gh.status === 0 ? gh.stdout.trim() : '';
  if (branch) return branch;
  const head = gitIn(root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const origin = head.status === 0 ? head.stdout.trim().replace(/^origin\//, '') : '';
  return origin || null;
};

module.exports = {
  repoRoot, headSha, gitIn, hasCommit, textAt, commitIdentity, defaultBranch, GIT_MAX_BUFFER,
};
