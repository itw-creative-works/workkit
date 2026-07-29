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
 * A ~/.workkit fixture, in the two files the engine keeps there: the
 * machine-maintained `.repos.json` (the roster and the declines) and the
 * hand-edited `settings.json` (the site options, `site.repo` among them).
 *
 * `repos` is the map verbatim when an object; an array of paths is the ordinary
 * case — every one registered as the engine writes it. `homeSlug` is what the
 * owner set as the repo the site publishes from, which is what by-path
 * discovery of the clone matches against. `roster` overrides the whole roster
 * file (a string is written raw).
 */
const mkWorkflowHome = (root, repos, { homeSlug = null, roster } = {}) => {
  const dir = path.join(root, 'workflow-home');
  fs.mkdirSync(dir, { recursive: true });
  const map = Array.isArray(repos)
    ? Object.fromEntries(repos.map((p) => [p, 'enabled']))
    : repos;
  const body = roster === undefined
    ? JSON.stringify({ version: 1, repos: map }, null, 2)
    : (typeof roster === 'string' ? roster : JSON.stringify(roster, null, 2));
  fs.writeFileSync(path.join(dir, '.repos.json'), body);
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    `${JSON.stringify({ version: 1, site: { repo: homeSlug, publish: false, url: null } }, null, 2)}\n`,
  );
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

  await test('the roster is read from .repos.json — a `repos` key in settings.json is not one', () => {
    // The split (issue #80): the machine writes `.repos.json`, a human writes
    // `settings.json`, and the reader takes the roster from the file whose
    // writer maintains it. A leftover `repos` block in the hand-edited file is
    // not a roster and must not put a repo on the dashboard.
    const tmp = mkTmp();
    const repo = mkRepo(tmp, 'Owner/alpha');
    const home = mkWorkflowHome(tmp, [repo]);
    assertEq(names(discoverRepos({ workflowHome: home })), 'alpha', 'the roster file is what is read');

    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify({ version: 1, repos: {} }, null, 2)}\n`);
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify({ version: 1, repos: { [repo]: 'enabled' }, site: { repo: null } }, null, 2)}\n`,
    );
    assertEq(names(discoverRepos({ workflowHome: home })), '', 'and settings.json is not a second roster');
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
    assertEq(fs.readFileSync(path.join(home, '.repos.json'), 'utf8').includes('gone'), true,
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

  await test('the tower clone is discovered by path, though no roster lists it', () => {
    // The home repo carries no committed opt-in of its own (issue #79): the
    // engine knows it by path and so does the board, which exists to show
    // exactly the cross-project issues it holds.
    const tmp = mkTmp();
    const listed = mkRepo(tmp, 'Owner/listed');
    const home = mkWorkflowHome(tmp, [listed], { homeSlug: 'owner/workkit' });
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    git(tower, 'init', '-q', '-b', 'main');
    git(tower, 'remote', 'add', 'origin', 'https://github.com/owner/workkit.git');

    const found = discoverRepos({ workflowHome: home });
    assertEq(names(found), 'listed,tower', 'the clone joins the roster entries');
    assertEq(found.find((r) => r.name === 'tower').slug, 'owner/workkit', 'named from its origin like any other');
    cleanup(tmp);
  });

  await test('a tower path this user declined is not listed', () => {
    // By-path discovery has no committed file to read, so the decline in the
    // roster is the only record of the answer — and it is an answer.
    const tmp = mkTmp();
    const home = mkWorkflowHome(tmp, {}, { homeSlug: 'owner/workkit' });
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    git(tower, 'init', '-q', '-b', 'main');
    git(tower, 'remote', 'add', 'origin', 'https://github.com/owner/workkit.git');
    fs.writeFileSync(
      path.join(home, '.repos.json'),
      `${JSON.stringify({ version: 1, repos: { [tower]: 'declined' } }, null, 2)}\n`,
    );
    assertEq(names(discoverRepos({ workflowHome: home })), '', 'a declined clone stays off the board');
    cleanup(tmp);
  });

  await test('a foreign repo parked at the tower path is not listed', () => {
    // The origin slug is the only proof by-path discovery has that this IS the
    // home repo: no origin, no recorded home slug, or a mismatch means someone
    // else's checkout is sitting at that name.
    const tmp = mkTmp();
    const home = mkWorkflowHome(tmp, {}, { homeSlug: 'owner/workkit' });
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    git(tower, 'init', '-q', '-b', 'main');
    assertEq(names(discoverRepos({ workflowHome: home })), '', 'no origin at all proves nothing');

    git(tower, 'remote', 'add', 'origin', 'https://github.com/someone/else.git');
    assertEq(names(discoverRepos({ workflowHome: home })), '', 'a different slug is a different repo');

    git(tower, 'remote', 'set-url', 'origin', 'https://github.com/owner/workkit.git');
    assertEq(names(discoverRepos({ workflowHome: home })), 'tower', 'the matching clone still is');
    cleanup(tmp);
  });

  await test('the tower clone is skipped when the settings file records no home slug', () => {
    const tmp = mkTmp();
    const home = mkWorkflowHome(tmp, {});
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    git(tower, 'init', '-q', '-b', 'main');
    git(tower, 'remote', 'add', 'origin', 'https://github.com/owner/workkit.git');
    assertEq(names(discoverRepos({ workflowHome: home })), '', 'nothing to match against, nothing listed');
    cleanup(tmp);
  });

  await test('a tower path that is not a git repo, or absent, adds nothing', () => {
    const tmp = mkTmp();
    const listed = mkRepo(tmp, 'Owner/listed');
    const home = mkWorkflowHome(tmp, [listed]);
    assertEq(names(discoverRepos({ workflowHome: home })), 'listed', 'nothing cloned yet');
    fs.mkdirSync(path.join(home, 'tower'), { recursive: true });
    assertEq(names(discoverRepos({ workflowHome: home })), 'listed', 'a plain folder is not the home repo');
    cleanup(tmp);
  });

  await test('a tower clone the roster also lists is one entry, not two', () => {
    const tmp = mkTmp();
    const home = mkWorkflowHome(tmp, []);
    const tower = path.join(home, 'tower');
    fs.mkdirSync(path.join(tower, '.workkit'), { recursive: true });
    git(tower, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(tower, '.workkit', 'settings.json'), '{ "version": 1, "enabled": true }\n');
    fs.writeFileSync(
      path.join(home, '.repos.json'),
      `${JSON.stringify({ version: 1, repos: { [tower]: 'enabled' } }, null, 2)}\n`,
    );
    const found = discoverRepos({ workflowHome: home });
    assertEq(found.length, 1, `deduplicated by path: ${found.map((r) => r.path).join(', ')}`);
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
