//
// Tests for tower/lib/repos.js — roster discovery.
//
// The fixtures are REAL git repositories with real `origin` remotes (adding a
// remote needs no network), because "what does git call this repo's origin" is
// a question only git answers and a stubbed answer would test the stub. The
// walk itself runs against a scratch tree, so the real Repositories root and
// the real ~/.workkit are never read.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { discoverRepos, slugFromRemote } = require(path.join(__dirname, '..', '..', 'tower', 'lib', 'repos.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-repos-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A repo fixture at `rel` below `root`.
 * `settings` is written verbatim when a string, JSON-encoded otherwise; null
 * writes no settings file at all.
 */
const mkRepo = (root, rel, { settings = { version: 7, enabled: true }, origin = null } = {}) => {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  if (settings !== null) {
    fs.mkdirSync(path.join(dir, '.workkit'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.workkit', 'settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2),
    );
  }
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
};

/** A ~/.workkit fixture carrying a declines map. */
const mkWorkflowHome = (root, repos) => {
  const dir = path.join(root, 'workflow-home');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ version: 1, repos }, null, 2));
  return dir;
};

const names = (found) => found.map((r) => r.name).sort().join(',');

const run = async () => {
  group('tower/repos: which repos are in');

  await test('an opted-in repo is found at owner/repo depth', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/alpha');
    const found = discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') });
    assertEq(names(found), 'alpha', 'alpha discovered');
    assertEq(found[0].path, path.join(tmp, 'Owner', 'alpha'), 'path is the repo dir');
    cleanup(tmp);
  });

  await test('enabled:false is out, and so is an unparseable settings file', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/yes');
    mkRepo(tmp, 'Owner/no', { settings: { version: 7, enabled: false } });
    mkRepo(tmp, 'Owner/broken', { settings: '{ not json' });
    mkRepo(tmp, 'Owner/none', { settings: null });
    assertEq(names(discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') })), 'yes', 'only the enabled repo');
    cleanup(tmp);
  });

  await test('the opt-in is strictly `enabled === true` — absent and stringy are both out', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/yes');
    mkRepo(tmp, 'Owner/silent', { settings: { version: 1 } });
    mkRepo(tmp, 'Owner/stringy', { settings: { version: 1, enabled: 'true' } });
    mkRepo(tmp, 'Owner/numeric', { settings: { version: 1, enabled: 1 } });
    assertEq(names(discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') })), 'yes',
      'a repo joins by saying so, not by nearly saying so');
    cleanup(tmp);
  });

  await test('a decline in the user settings excludes the repo by realpath', () => {
    const tmp = mkTmp();
    const kept = mkRepo(tmp, 'Owner/kept');
    const declined = mkRepo(tmp, 'Owner/declined');
    const workflowHome = mkWorkflowHome(tmp, {
      [fs.realpathSync(declined)]: 'declined',
      [fs.realpathSync(kept)]: 'enabled',
    });
    assertEq(names(discoverRepos({ root: tmp, workflowHome })), 'kept', 'the declined repo is dropped');
    cleanup(tmp);
  });

  await test('a hidden repo directory is discovered — .dotfiles is a real repo', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/.dotfiles');
    assertEq(names(discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') })), '.dotfiles', 'dot dirs are walked');
    cleanup(tmp);
  });

  group('tower/repos: the origin slug');

  await test('ssh, ssh-URL and https remotes all parse to owner/repo', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/ssh', { origin: 'git@github.com:ITW-Creative-Works/workkit.git' });
    mkRepo(tmp, 'Owner/sshurl', { origin: 'ssh://git@github.com/ITW-Creative-Works/workkit' });
    mkRepo(tmp, 'Owner/https', { origin: 'https://github.com/ianwieds/.dotfiles.git' });
    const bySlug = Object.fromEntries(discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') }).map((r) => [r.name, r.slug]));
    assertEq(bySlug.ssh, 'ITW-Creative-Works/workkit', 'ssh shorthand');
    assertEq(bySlug.sshurl, 'ITW-Creative-Works/workkit', 'ssh URL');
    assertEq(bySlug.https, 'ianwieds/.dotfiles', 'https, dot in the repo name kept');
    cleanup(tmp);
  });

  await test('a repo with no origin is still listed, with slug null', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/local');
    const found = discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') });
    assertEq(found.length, 1, 'still listed — health works locally');
    assertEq(found[0].slug, null, 'no slug');
    cleanup(tmp);
  });

  await test('slugFromRemote handles trailing slashes and bare paths', () => {
    assertEq(slugFromRemote('https://github.com/o/r/'), 'o/r', 'trailing slash');
    assertEq(slugFromRemote(''), null, 'empty');
    assertEq(slugFromRemote('notaremote'), null, 'no owner segment');
  });

  group('tower/repos: the walk is bounded');

  await test('a repo deeper than the bound is not found, and one at the bound is', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'a/b/c/deep');
    mkRepo(tmp, 'a/b/c/d/deeper');
    assertEq(names(discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') })), 'deep', 'depth 4 in, depth 5 out');
    cleanup(tmp);
  });

  await test('node_modules is pruned and a repo is a leaf', () => {
    const tmp = mkTmp();
    mkRepo(tmp, 'Owner/outer');
    mkRepo(tmp, 'Owner/outer/node_modules/vendored');
    mkRepo(tmp, 'Owner/outer/nested');
    const found = discoverRepos({ root: tmp, workflowHome: path.join(tmp, 'nope') });
    assertEq(names(found), 'outer', 'nothing inside an opted-in repo is a second repo');
    cleanup(tmp);
  });

  await test('a missing root is empty, not an exception', () => {
    const tmp = mkTmp();
    const found = discoverRepos({ root: path.join(tmp, 'absent'), workflowHome: path.join(tmp, 'nope') });
    assert(Array.isArray(found) && found.length === 0, 'empty roster');
    cleanup(tmp);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
