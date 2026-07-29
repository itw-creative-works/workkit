//
// Tests for tower/api/lib/repos.js — the roster read.
//
// The fixtures are REAL git repositories with real `origin` remotes (adding a
// remote needs no network), because "what does git call this repo's origin" is
// a question only git answers and a stubbed answer would test the stub. The
// roster itself is a scratch ~/.workkit, so the real one is never read.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { discoverRepos, slugFromRemote } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'repos.js'));

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

/**
 * A ~/.workkit fixture. `repos` is the map verbatim when an object; an array of
 * paths is the ordinary case — every one registered as the engine writes it.
 * `settings` overrides the whole file (a string is written raw).
 */
const mkWorkflowHome = (root, repos, settings) => {
  const dir = path.join(root, 'workflow-home');
  fs.mkdirSync(dir, { recursive: true });
  const map = Array.isArray(repos)
    ? Object.fromEntries(repos.map((p) => [p, 'enabled']))
    : repos;
  const body = settings === undefined
    ? JSON.stringify({ version: 1, repos: map }, null, 2)
    : (typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(dir, 'settings.json'), body);
  return dir;
};

const names = (found) => found.map((r) => r.name).sort().join(',');

const run = async () => {
  group('tower/repos: which repos are in');

  await test('a registered, opted-in repo is on the roster', () => {
    const tmp = mkTmp();
    const repo = mkRepo(tmp, 'Owner/alpha');
    const found = discoverRepos({ workflowHome: mkWorkflowHome(tmp, [repo]) });
    assertEq(names(found), 'alpha', 'alpha listed');
    assertEq(found[0].path, repo, 'path is the repo dir');
    cleanup(tmp);
  });

  await test('a repo nobody registered is NOT found, however opted in it is', () => {
    const tmp = mkTmp();
    const listed = mkRepo(tmp, 'Owner/listed');
    mkRepo(tmp, 'Owner/unlisted');
    const found = discoverRepos({ workflowHome: mkWorkflowHome(tmp, [listed]) });
    assertEq(names(found), 'listed', 'the roster is the whole list — nothing is walked');
    cleanup(tmp);
  });

  await test('a registered repo that lost its opt-in is dropped silently', () => {
    const tmp = mkTmp();
    const yes = mkRepo(tmp, 'Owner/yes');
    const no = mkRepo(tmp, 'Owner/no', { settings: { version: 7, enabled: false } });
    const broken = mkRepo(tmp, 'Owner/broken', { settings: '{ not json' });
    const none = mkRepo(tmp, 'Owner/none', { settings: null });
    const gone = path.join(tmp, 'Owner', 'gone');
    const home = mkWorkflowHome(tmp, [yes, no, broken, none, gone]);
    assertEq(names(discoverRepos({ workflowHome: home })), 'yes', 'only the repo whose committed file still says yes');
    assertEq(fs.readFileSync(path.join(home, 'settings.json'), 'utf8').includes('gone'), true,
      'and the reader never rewrites the index — pruning is the engine\'s');
    cleanup(tmp);
  });

  await test('the opt-in is anything but `enabled: false` — the engine reads it that way', () => {
    // The engine's resolve_state is the SSOT of what enabled means: a committed
    // file that does not say false is a yes, which is how a legacy
    // `{ "version": 1 }` written before the key existed stays a member. Reading
    // it more strictly here would drop repos the heal keeps registering.
    const tmp = mkTmp();
    const yes = mkRepo(tmp, 'Owner/yes');
    const legacy = mkRepo(tmp, 'Owner/legacy', { settings: { version: 1 } });
    const off = mkRepo(tmp, 'Owner/off', { settings: { version: 1, enabled: false } });
    assertEq(names(discoverRepos({ workflowHome: mkWorkflowHome(tmp, [yes, legacy, off]) })), 'legacy,yes',
      'only the repo that said no is out');
    cleanup(tmp);
  });

  await test('a declined entry is skipped, and the enabled ones beside it are not', () => {
    const tmp = mkTmp();
    const kept = mkRepo(tmp, 'Owner/kept');
    const declined = mkRepo(tmp, 'Owner/declined');
    const workflowHome = mkWorkflowHome(tmp, {
      [declined]: 'declined',
      [kept]: 'enabled',
    });
    assertEq(names(discoverRepos({ workflowHome })), 'kept', 'the declined repo is not listed');
    cleanup(tmp);
  });

  await test('a hidden repo directory is listed — .dotfiles is a real repo', () => {
    const tmp = mkTmp();
    const repo = mkRepo(tmp, 'Owner/.dotfiles');
    assertEq(names(discoverRepos({ workflowHome: mkWorkflowHome(tmp, [repo]) })), '.dotfiles', 'dot names are ordinary');
    cleanup(tmp);
  });

  group('tower/repos: the origin slug');

  await test('ssh, ssh-URL and https remotes all parse to owner/repo', () => {
    const tmp = mkTmp();
    const repos = [
      mkRepo(tmp, 'Owner/ssh', { origin: 'git@github.com:ITW-Creative-Works/workkit.git' }),
      mkRepo(tmp, 'Owner/sshurl', { origin: 'ssh://git@github.com/ITW-Creative-Works/workkit' }),
      mkRepo(tmp, 'Owner/https', { origin: 'https://github.com/ianwieds/.dotfiles.git' }),
    ];
    const bySlug = Object.fromEntries(
      discoverRepos({ workflowHome: mkWorkflowHome(tmp, repos) }).map((r) => [r.name, r.slug]),
    );
    assertEq(bySlug.ssh, 'ITW-Creative-Works/workkit', 'ssh shorthand');
    assertEq(bySlug.sshurl, 'ITW-Creative-Works/workkit', 'ssh URL');
    assertEq(bySlug.https, 'ianwieds/.dotfiles', 'https, dot in the repo name kept');
    cleanup(tmp);
  });

  await test('a repo with no origin is still listed, with slug null', () => {
    const tmp = mkTmp();
    const repo = mkRepo(tmp, 'Owner/local');
    const found = discoverRepos({ workflowHome: mkWorkflowHome(tmp, [repo]) });
    assertEq(found.length, 1, 'still listed — health works locally');
    assertEq(found[0].slug, null, 'no slug');
    cleanup(tmp);
  });

  await test('slugFromRemote handles trailing slashes and bare paths', () => {
    assertEq(slugFromRemote('https://github.com/o/r/'), 'o/r', 'trailing slash');
    assertEq(slugFromRemote(''), null, 'empty');
    assertEq(slugFromRemote('notaremote'), null, 'no owner segment');
  });

  group('tower/repos: a roster that says nothing');

  await test('no settings file, no repos key, and an unparseable file are all empty', () => {
    const tmp = mkTmp();
    const absent = discoverRepos({ workflowHome: path.join(tmp, 'nope') });
    assert(Array.isArray(absent) && absent.length === 0, 'a machine that has healed nothing yet');
    assertEq(discoverRepos({ workflowHome: mkWorkflowHome(tmp, null, { version: 1 }) }).length, 0, 'no repos key');
    cleanup(tmp);

    const tmp2 = mkTmp();
    assertEq(discoverRepos({ workflowHome: mkWorkflowHome(tmp2, null, '{ not json') }).length, 0, 'unparseable');
    cleanup(tmp2);
  });

  await test('the sort is by path, so the answer is stable however the map was written', () => {
    const tmp = mkTmp();
    const b = mkRepo(tmp, 'Owner/b');
    const a = mkRepo(tmp, 'Owner/a');
    const found = discoverRepos({ workflowHome: mkWorkflowHome(tmp, [b, a]) });
    assertEq(found.map((r) => r.name).join(','), 'a,b', 'insertion order is not the answer');
    cleanup(tmp);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
