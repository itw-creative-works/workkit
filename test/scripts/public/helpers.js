// The shared world of the public pairing suites beside this one: a private repo
// (origin acme/private) on a scratch home's roster, paired with acme/public in
// its committed settings or not, a CHANGELOG, and a stateful fake GitHub on PATH,
// so `workkit public intake|mirror|close` runs whole and nothing reaches GitHub.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  WORKKIT_DIR: W, mkTmp, seeded, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, SYSTEM_PATH, shellPath, gitPath, homeEnv, joinPath,
} = require('../../lib/platform');
const { mkOriginRepo } = require('../../lib/git-repo');
const { mkGhWorld } = require('../../lib/gh-world');

const CLI = path.join(__dirname, '..', '..', '..', 'workflow', 'workkit.sh');
const PRIVATE = 'acme/private';
const PUBLIC = 'acme/public';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.4.0] - 2026-10-29',
  '',
  '### Fixed',
  '',
  '- [#12](../../issues/12) [`abc1234`](../../commit/abc1234) Thanks [@acme]! - Lists over 20 MB split into parts, so jsDelivr serves each one.',
  '- [#13](../../issues/13) [`abc1234`](../../commit/abc1234) Thanks [@acme]! - The harvest retries a source that timed out once.',
  '',
].join('\n');

const seed = seeded((dir) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  mkOriginRepo(repo, `https://github.com/${PRIVATE}.git`);
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), CHANGELOG);
  fs.mkdirSync(path.join(dir, 'home', '.workkit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'));
});

/** The private body line that links a public issue. */
const publicLine = (n) => `Public: https://github.com/${PUBLIC}/issues/${n}`;

/**
 * A copied world: the repo paired with acme/public unless `paired` is false,
 * on the roster as enabled, and GitHub holding `issues` (`{ public, private }`,
 * each a list of the fake's issue fixtures), `fail` the writes it refuses once.
 * @returns {{repo: string, home: string, gh: object, run: Function}} `run(args)`
 *   runs `workkit public <args>` in the repo, resolving `{ code, out, err }`
 */
const mkPublicWorld = ({ paired = true, issues = {}, fail = [] } = {}) => {
  const dir = mkTmp('wk-public-');
  seed(dir);
  const repo = fs.realpathSync(path.join(dir, 'repo'));
  const home = path.join(dir, 'home');
  const settings = { version: 1, enabled: true, ...(paired ? { public: PUBLIC } : {}) };
  fs.mkdirSync(path.join(repo, W));
  fs.writeFileSync(path.join(repo, W, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  fs.writeFileSync(path.join(home, '.workkit', '.repos.json'),
    `${JSON.stringify({ version: 1, repos: { [gitPath(repo)]: 'enabled' } })}\n`);
  const gh = mkGhWorld({ [PUBLIC]: issues.public || [], [PRIVATE]: issues.private || [] }, { fail });
  const env = homeEnv(home, {
    PATH: joinPath(gh.binDir, SYSTEM_PATH, NODE_DIR),
    TMPDIR: shellPath(path.join(dir, 'tmp')),
    WORKFLOW_HOME: shellPath(path.join(home, '.workkit')),
    WORKFLOW_CLAUDE_HOME: shellPath(path.join(home, '.claude')),
  });
  const run = (args) => {
    const res = spawnSync(BASH, [...NO_RC, shellPath(CLI), 'public', ...args], {
      cwd: repo, env, input: '', encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
  };
  return {
    repo, home, env, gh, run,
  };
};

/** A run's own words for an assertion message. */
const said = (res) => `exit ${res.code}, stdout: ${res.out.trim()}, stderr: ${res.err.trim()}`;

module.exports = {
  mkPublicWorld, publicLine, said, PRIVATE, PUBLIC,
};
