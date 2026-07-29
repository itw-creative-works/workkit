//
// Tests for workflow/home.sh — the home repo's lifecycle (issue #27).
//
// Every world is a scratch HOME with a scratch ~/.workkit (WORKFLOW_HOME) and a
// `gh` shim that answers `api user`, `repo view`, `repo create` and the
// Discussions/Pages calls with canned JSON. The REMOTE is a local bare repo
// (WORKKIT_HOME_REMOTE), so every clone, fetch and push in this suite runs
// against a directory on this machine: nothing here reaches GitHub, and nothing
// here touches the real ~/.workkit.
//
// The library is sourced by a one-line driver rather than executed — it is a
// library, and the shell it is asked its questions in is the one the CLI and
// the heal ask them in.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-home-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/**
 * A bare repo standing in for the one on GitHub, with an initial commit when
 * `seed` is given — the difference between a repo just created (empty) and one
 * a first machine already pushed to.
 */
const mkRemote = (root, { seed = null } = {}) => {
  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
  if (seed) {
    const work = path.join(root, 'seed');
    fs.mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'main');
    for (const [file, body] of Object.entries(seed)) {
      fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      fs.writeFileSync(path.join(work, file), body);
    }
    git(work, 'add', '-A');
    git(work, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore: seed');
    git(work, 'remote', 'add', 'origin', bare);
    git(work, 'push', '-q', '-u', 'origin', 'main');
  }
  return bare;
};

/**
 * A scratch machine. `login` is who `gh api user` says you are; `repoExists`
 * decides whether `gh repo view` finds the home repo already; `discussionsOn`
 * and `categories` are what the Discussions API reports; `pagesOn` whether Pages
 * is already configured, and `pagesFails` whether enabling it is refused (the
 * private-repo-on-a-free-plan case).
 */
const mkWorld = ({
  login = 'owner', repoExists = false, discussionsOn = false,
  categories = ['Daily', 'Weekly', 'Monthly'], pagesOn = false, pagesFails = false,
  settings = { version: 1, repos: {} }, remote = null,
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (settings !== null) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  }

  const ghLog = path.join(root, 'gh-argv.log');
  const nodes = categories.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    'all="$*"',
    'case "$all" in',
    `  *"api user"*) printf '%s\\n' '${login}' ;;`,
    `  *"repo view"*) exit ${repoExists ? 0 : 1} ;;`,
    '  *"repo create"*) exit 0 ;;',
    `  *updateRepository*) printf '%s' '{"data":{"updateRepository":{"repository":{"hasDiscussionsEnabled":true}}}}' ;;`,
    '  *createDiscussion*)',
    `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/workkit/discussions/3"}}}}' ;;`,
    '  *"discussions(first"*)',
    `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[`
      + `{"title":"daily: 2026-07-27","createdAt":"2026-07-27T09:00:00Z","body":"yesterday"},`
      + `{"title":"daily: 2026-06-01","createdAt":"2026-06-01T09:00:00Z","body":"long ago"}]}}}}' ;;`,
    '  *discussionCategories*)',
    `    printf '%s' '{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":${discussionsOn},"discussionCategories":{"nodes":[${nodes}]}}}}' ;;`,
    `  *"pages"*) exit ${pagesOn ? 0 : (pagesFails ? 1 : 0)} ;;`,
    `  *) printf '%s' '{}' ;;`,
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  // The Pages calls are a GET (is it on?) then a POST (turn it on), and the two
  // must be able to answer differently.
  if (!pagesOn) {
    fs.writeFileSync(path.join(bin, 'gh'), fs.readFileSync(path.join(bin, 'gh'), 'utf8').replace(
      `  *"pages"*) exit ${pagesFails ? 1 : 0} ;;`,
      [
        '  *"-X POST"*pages*)',
        `    exit ${pagesFails ? 1 : 0} ;;`,
        '  *pages*) exit 1 ;;',
      ].join('\n'),
    ));
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  }

  return {
    root,
    home,
    workflowHome,
    remote: remote === null ? null : remote,
    ghCalls: () => readArgv(ghLog),
    settings: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'settings.json'), 'utf8')),
    config: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'workkit.json'), 'utf8')),
    env: {
      HOME: home,
      PATH: `${bin}:${BASE_PATH}:${path.dirname(process.execPath)}`,
      WORKFLOW_HOME: workflowHome,
      ...(remote ? { WORKKIT_HOME_REMOTE: remote } : {}),
    },
  };
};

/**
 * Source the library and run one line of shell in it — how every caller uses
 * it. stdin is a pipe, so any prompt that forgot its tty guard hangs the test
 * rather than production.
 */
const inHome = (world, script, { input = '' } = {}) => {
  const driver = [
    'set -euo pipefail',
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'lib.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'discussions.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'home.sh'))}`,
    script,
  ].join('\n');
  const res = spawnSync('bash', ['-c', driver], {
    env: world.env, input, encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const run = async () => {
  group('workflow/home: shape');

  await test('the three libraries parse and run nothing at load', () => {
    for (const lib of ['lib.sh', 'discussions.sh', 'home.sh']) {
      const file = path.join(WORKFLOW_DIR, lib);
      assertEq(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status, 0, `bash -n is clean for ${lib}`);
    }
    const world = mkWorld();
    // Sourcing all three prints nothing: a library that acted at load would
    // act every time the CLI, the heal or the job started.
    assertEq(inHome(world, 'true').out, '', 'sourcing says nothing');
    cleanup(world.root);
  });

  await test('no absolute personal path is written into the engine', () => {
    for (const lib of ['lib.sh', 'discussions.sh', 'home.sh', 'publish.sh']) {
      const text = fs.readFileSync(path.join(WORKFLOW_DIR, lib), 'utf8');
      assert(!/\/Users\/[a-z]/i.test(text), `${lib} carries no machine-specific path`);
    }
  });

  group('workflow/home: the folder becomes the clone');

  await test('an empty folder is cloned', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root, { seed: { 'workkit.json': '{ "version": 1 }\n' } });
    world.env.WORKKIT_HOME_REMOTE = remote;
    fs.rmSync(path.join(world.workflowHome, 'settings.json'));

    const { code, out } = inHome(world, 'wk_home_convert owner/workkit');
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(fs.existsSync(path.join(world.workflowHome, '.git')), 'the folder is a git repo');
    assert(fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'with the remote’s files in it');
    assert(/cloned/.test(out), `and it says what it did, got: ${out}`);
    cleanup(world.root);
  });

  await test('a folder that predates the repo is converted IN PLACE, keeping its files', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    fs.writeFileSync(path.join(world.workflowHome, 'inbox.md'), '- a thought\n');

    const { code, out } = inHome(world, 'wk_home_convert owner/workkit');
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(fs.existsSync(path.join(world.workflowHome, '.git')), 'the folder is now a git repo');
    assertEq(fs.readFileSync(path.join(world.workflowHome, 'inbox.md'), 'utf8'), '- a thought\n', 'and every file it had is still there');
    assertEq(
      spawnSync('git', ['-C', world.workflowHome, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim(),
      remote,
      'pointed at the home repo',
    );
    cleanup(world.root);
  });

  await test('only the schema files are ever committed — the machine-local ones stay untracked', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    fs.writeFileSync(path.join(world.workflowHome, 'inbox.md'), '- private\n');

    const { out } = inHome(world, [
      'wk_home_convert owner/workkit',
      'wk_home_write_files',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): the schema files"',
    ].join('\n'));

    const tracked = spawnSync('git', ['-C', world.workflowHome, 'ls-files'], { encoding: 'utf8' })
      .stdout.split('\n').filter(Boolean).sort();
    assertEq(tracked.join(','), '.gitignore,workkit.json', `the committed layer and nothing else, got: ${tracked.join(', ')} — ${out}`);

    // And it really left the remote: a fresh clone sees the same two files.
    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, 'workkit.json')), 'the push landed');
    assert(!fs.existsSync(path.join(check, 'settings.json')), 'and carried nothing machine-local');
    cleanup(world.root);
  });

  await test('a folder that is already the clone is a no-op', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root, { seed: { 'workkit.json': '{ "version": 1 }\n' } });
    world.env.WORKKIT_HOME_REMOTE = remote;
    fs.rmSync(path.join(world.workflowHome, 'settings.json'));
    inHome(world, 'wk_home_convert owner/workkit');
    const head = spawnSync('git', ['-C', world.workflowHome, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const { code, out } = inHome(world, 'wk_home_convert owner/workkit');
    assertEq(code, 0, 'exit 0');
    assert(/is the clone of/.test(out), `it says there is nothing to do, got: ${out}`);
    assertEq(spawnSync('git', ['-C', world.workflowHome, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head, 'and the repo is untouched');
    cleanup(world.root);
  });

  await test('a folder pointing at ANOTHER remote stops the home steps', () => {
    // The one state that must never be adopted: converting it would push this
    // machine's settings into a repo that belongs to someone else.
    const world = mkWorld();
    const ours = mkRemote(world.root);
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    world.env.WORKKIT_HOME_REMOTE = ours;
    git(world.workflowHome, 'init', '-q', '-b', 'main');
    git(world.workflowHome, 'remote', 'add', 'origin', theirs);

    const { code, out } = inHome(world, 'rc=0; wk_home_convert owner/workkit || rc=$?; printf "rc=%s\\n" "$rc"');
    assertEq(code, 0, 'the driver finished');
    assert(/rc=3/.test(out), `the caller is told to stop, got: ${out}`);
    assert(/leaving it alone/.test(out), 'and nothing was adopted');
    assertEq(
      spawnSync('git', ['-C', world.workflowHome, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim(),
      theirs,
      'the other remote is exactly as it was',
    );
    cleanup(world.root);
  });

  await test('a second machine joins a home repo that already has history', () => {
    // The WHOLE path, not the convert alone: what a second machine does to the
    // remote only becomes visible after the write and the push, and the folder
    // it converts is one that predates the repo.
    const world = mkWorld();
    const remote = mkRemote(world.root, {
      seed: {
        'workkit.json': '{ "version": 1, "projects": { "owner/first": { "name": "first" } } }\n',
        '.gitignore': 'settings.json\n',
        'docs/index.html': '<html>machine one’s board</html>\n',
      },
    });
    world.env.WORKKIT_HOME_REMOTE = remote;
    fs.writeFileSync(path.join(world.workflowHome, 'inbox.md'), '- this machine’s own\n');

    const { code, out } = inHome(world, [
      'wk_home_convert owner/workkit',
      'wk_home_write_files',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): the schema files"',
    ].join('\n'));
    assertEq(code, 0, `exit 0 — ${out}`);

    const log = spawnSync('git', ['-C', world.workflowHome, 'log', '--oneline'], { encoding: 'utf8' }).stdout;
    assert(log.includes('seed'), `the existing history is joined, not replaced: ${log}`);
    assert(fs.existsSync(path.join(world.workflowHome, 'inbox.md')), 'and this machine’s files survived');

    // The folder GAINED what the repo already carried — a reset alone would
    // have left every one of these reading as deleted.
    assert(fs.existsSync(path.join(world.workflowHome, 'docs', 'index.html')), 'the published site is checked out here');
    assertEq(world.config().projects['owner/first'].name, 'first', 'and the project list is the one the repo carries');

    // And the REMOTE is intact. This is the assertion that matters: a push that
    // carried the deletions would have emptied the home repo of machine one's
    // work, and only a fresh clone can say it did not.
    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, 'docs', 'index.html')), 'the site is still on the remote');
    const config = JSON.parse(fs.readFileSync(path.join(check, 'workkit.json'), 'utf8'));
    assertEq(config.projects['owner/first'].name, 'first', 'and the populated workkit.json was never replaced by the template');
    cleanup(world.root);
  });

  await test('a folder carrying machine-local job state commits none of it', () => {
    // `~/.workkit/jobs/` is one machine's record of what it has already seen.
    // Committed, a second machine would read it as its own and skip news it
    // never got.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    fs.mkdirSync(path.join(world.workflowHome, 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(world.workflowHome, 'jobs', 'cc-news.json'), '{ "seen": "0.9.0" }\n');
    fs.writeFileSync(path.join(world.workflowHome, 'inbox.md'), '- private\n');

    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files');
    // What `git add -A` WOULD stage, asked without staging it.
    const staged = spawnSync('git', ['-C', world.workflowHome, 'add', '-An', '.'], { encoding: 'utf8' }).stdout;
    assert(!/jobs\//.test(staged), `the job state is not added: ${staged}`);
    assert(!/inbox\.md/.test(staged), `nor the scratchpad: ${staged}`);
    assert(/workkit\.json/.test(staged), `the committed layer is: ${staged}`);
    cleanup(world.root);
  });

  await test('an existing .gitignore gains only the rules it is missing', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { '.gitignore': '# theirs\nsettings.json\nmy-own-thing\n' } });
    inHome(world, 'wk_home_convert owner/workkit');

    const { out } = inHome(world, 'wk_home_write_files');
    const ignore = fs.readFileSync(path.join(world.workflowHome, '.gitignore'), 'utf8');
    const lines = ignore.split('\n').filter(Boolean);
    assertEq(lines.filter((l) => l === 'settings.json').length, 1, `a rule already there is not doubled: ${ignore}`);
    assert(lines.includes('my-own-thing'), 'and a rule someone added themselves is kept');
    assert(lines.includes('jobs/'), `the missing rules are appended: ${ignore}`);
    assert(/added the ignore rules/.test(out), `and it says which, got: ${out}`);

    // Idempotent: a second run has nothing left to add.
    inHome(world, 'wk_home_write_files');
    assertEq(fs.readFileSync(path.join(world.workflowHome, '.gitignore'), 'utf8'), ignore, 'a second run changes nothing');
    cleanup(world.root);
  });

  group('workflow/home: the wizard');

  await test('setup creates the repo, converts the folder, and records the slug', () => {
    const world = mkWorld({ login: 'owner' });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;

    const { code, out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input: 'y\n' });
    assertEq(code, 0, `exit 0 — ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`);
    assertEq(world.settings().home, 'owner/workkit', 'the home slug is recorded');
    assert(fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'the schema files are written');
    assert(fs.existsSync(path.join(world.workflowHome, '.gitignore')), 'both of them');
    assertEq(world.config().version, 1, 'and workkit.json is the fixed schema');
    assertEq(JSON.stringify(world.config().site), '{"url":null,"board":false}',
      'with the site key, and the public board snapshot off until the owner says otherwise');
    cleanup(world.root);
  });

  await test('a second setup does the same work and changes nothing', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input: 'y\n' });
    fs.writeFileSync(path.join(world.workflowHome, 'workkit.json'), `${JSON.stringify({
      version: 1, projects: { 'owner/kept': { name: 'kept' } }, site: { url: null }, preferences: {},
    }, null, 2)}\n`);

    const { code, out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input: 'y\n' });
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(!/created the private repo/.test(out), `nothing is created twice, got: ${out}`);
    assertEq(world.config().projects['owner/kept'].name, 'kept', 'and the file it found is not overwritten');
    cleanup(world.root);
  });

  await test('without a terminal it says what a terminal run would do, and asks nothing', () => {
    const world = mkWorld({ login: 'owner' });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;

    const { code, out } = inHome(world, 'interactive() { return 1; }\nwk_home_setup');
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(/workkit setup/.test(out), `and hands over the command, got: ${out}`);
    assertEq(world.settings().home, undefined, 'a machine that never answered gets no home');
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and its folder is left as it was');
    cleanup(world.root);
  });

  await test('an answer that is not yes leaves everything alone', () => {
    const world = mkWorld({ login: 'owner' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input: 'n\n' });
    assert(/left as it is/.test(out), `it says so, got: ${out}`);
    assertEq(world.settings().home, undefined, 'and no home is recorded');
    cleanup(world.root);
  });

  await test('a gh that cannot say who you are points at the login command', () => {
    const world = mkWorld({ login: '' });
    const { code, out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup');
    assertEq(code, 0, 'exit 0');
    assert(/gh auth login/.test(out), `it prints the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('Discussions are enabled, and missing categories get a one-time pointer', () => {
    // GitHub has NO mutation that creates a discussion category — probed
    // against the live schema — so the only honest step is to name the page.
    const world = mkWorld({ login: 'owner', categories: ['General'] });
    const { code, out } = inHome(world, 'wk_home_discussions owner/workkit');
    assertEq(code, 0, 'exit 0');
    assert(/Discussions enabled/.test(out), `it turns them on, got: ${out}`);
    assert(/Daily, Weekly, Monthly/.test(out), 'names every category that is missing');
    assert(/discussions\/categories/.test(out), 'and the page that makes them');
    assert(/no API that creates one/.test(out), 'saying why it cannot do it itself');
    cleanup(world.root);
  });

  await test('Discussions already on are left alone', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { out } = inHome(world, 'wk_home_discussions owner/workkit');
    assert(/Discussions are on/.test(out), `it reports the state, got: ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(!calls.some((c) => c.includes('updateRepository')), `and never writes: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('Pages is asked for main /docs, and a refusal warns with the fix', () => {
    const world = mkWorld({ login: 'owner' });
    const ok = inHome(world, 'wk_home_pages owner/workkit');
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('POST'));
    assert(posted && posted.includes('source[path]=/docs'), `the only subdirectory the API accepts: ${fmtCalls(world.ghCalls())}`);
    assert(posted.includes('source[branch]=main'), 'from the default branch');
    assert(/serves .* from main \/docs/.test(ok.out), `and it says so, got: ${ok.out}`);

    const refused = mkWorld({ login: 'owner', pagesFails: true });
    const { code, out } = inHome(refused, 'wk_home_pages owner/workkit');
    assertEq(code, 0, 'a refusal never stops the wizard');
    assert(/paid plan/.test(out) && /settings\/pages/.test(out), `it warns with the fix, got: ${out}`);
    cleanup(world.root); cleanup(refused.root);
  });

  group('workflow/discussions: posting and reading back');

  await test('a summary is posted, and the discussion URL comes back', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, '## Went well\nA day.\n');
    const { code, out } = inHome(world, [
      'wk_disc_resolve_category owner/workkit Daily',
      `wk_disc_create owner/workkit "$WK_DISC_CATEGORY_ID" "daily: 2026-07-28" ${JSON.stringify(body)}`,
    ].join('\n'));
    assertEq(code, 0, 'exit 0');
    assert(/discussions\/3/.test(out), `the URL is what a caller logs, got: ${out}`);
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('createDiscussion'));
    assert(posted.includes(`body=@${body}`), `the body is sent from a file, never as an argument: ${posted}`);
    cleanup(world.root);
  });

  await test('a rollup reads prior summaries back, and the window is applied here', () => {
    // The API takes no date argument — only an order — so the period is a
    // filter on what came back, not a query the server ran.
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { code, out } = inHome(world, 'wk_disc_list owner/workkit Daily 2026-07-21T00:00:00Z');
    assertEq(code, 0, 'exit 0');
    const listed = JSON.parse(out.trim());
    assertEq(listed.length, 1, `only the summaries inside the window: ${out}`);
    assertEq(listed[0].body, 'yesterday', 'and they carry their bodies for the rollup to read');
    cleanup(world.root);
  });

  await test('the resolution falls back to the default category, and says which', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    const { out } = inHome(world, 'wk_disc_resolve_category owner/workkit Weekly\nprintf "%s %s\\n" "$WK_DISC_CATEGORY_NAME" "$WK_DISC_CATEGORY_ID"');
    assert(/^General DIC_0$/m.test(out.trim()), `the caller learns both name and id, got: ${out}`);
    cleanup(world.root);
  });

  group('workflow/home: the project list');

  await test('a repo’s slug is upserted into workkit.json, and a second call writes nothing', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files\nwk_home_set_slug owner/workkit');

    inHome(world, 'wk_home_upsert_project owner/thing thing');
    assertEq(world.config().projects['owner/thing'].name, 'thing', 'the slug carries its display name');

    const before = fs.statSync(path.join(world.workflowHome, 'workkit.json')).mtimeMs;
    inHome(world, 'wk_home_upsert_project owner/thing thing');
    assertEq(fs.statSync(path.join(world.workflowHome, 'workkit.json')).mtimeMs, before, 'an unchanged value is not rewritten');
    cleanup(world.root);
  });

  await test('a repo that says no is removed from the list', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files\nwk_home_set_slug owner/workkit');
    inHome(world, 'wk_home_upsert_project owner/thing thing\nwk_home_upsert_project owner/other other');
    inHome(world, 'wk_home_remove_project owner/thing');
    const projects = world.config().projects;
    assertEq(Object.keys(projects).join(','), 'owner/other', 'only the one that said no is gone');
    cleanup(world.root);
  });

  await test('with no home clone the project list is never written', () => {
    const world = mkWorld();
    const { code } = inHome(world, 'wk_home_upsert_project owner/thing thing');
    assertEq(code, 0, 'it is a no-op, not a failure');
    assert(!fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'and nothing is created to hold it');
    cleanup(world.root);
  });

  group('workflow/home: doctor');

  await test('no home configured is a notice naming the command', () => {
    const world = mkWorld();
    const { code, out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assertEq(code, 0, 'exit 0');
    assert(/home: not set/.test(out), `it says so, got: ${out}`);
    assert(/rc=0/.test(out), 'and counts as nothing needing attention');
    cleanup(world.root);
  });

  await test('a home named but a folder that is not its clone needs attention', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is not a clone of it/.test(out), `it names the state, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a folder pointing at another remote is reported, never adopted', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    git(world.workflowHome, 'init', '-q', '-b', 'main');
    git(world.workflowHome, 'remote', 'add', 'origin', theirs);
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/pointing at/.test(out) && /move it aside/.test(out), `it says what is in the way, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a clone in step with its upstream is green', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files\nwk_home_commit_push "chore(home): the schema files"');
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is its clone/.test(out), `it reports the clone, got: ${out}`);
    assert(/rc=0/.test(out), 'and nothing needs attention');
    cleanup(world.root);
  });

  await test('a clone with unpushed commits says the daily publish will push them', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files\nwk_home_commit_push "chore(home): the schema files"');
    fs.writeFileSync(path.join(world.workflowHome, 'workkit.json'), '{ "version": 1, "projects": { "a/b": { "name": "b" } } }\n');
    git(world.workflowHome, 'add', '-A');
    git(world.workflowHome, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): a project');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/unpushed commits/.test(out), `it says what is waiting, got: ${out}`);
    assert(/rc=0/.test(out), 'which is not a problem to fix');
    cleanup(world.root);
  });

  await test('a clone behind its upstream is told which command catches it up', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, 'wk_home_convert owner/workkit\nwk_home_write_files\nwk_home_commit_push "chore(home): the schema files"');

    // Someone else pushed. This machine only learns it on a fetch.
    const other = path.join(world.root, 'other');
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    fs.writeFileSync(path.join(other, 'workkit.json'), '{ "version": 1, "projects": {} }\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');
    git(world.workflowHome, 'fetch', '-q');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is behind/.test(out) && /pull --rebase/.test(out), `it names the fix, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
