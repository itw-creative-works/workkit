// Tests for workflow/gitshim/git, the `git` shim a Claude session's PATH puts first: each case runs a real shell
// whose PATH holds the kit's shim folder ahead of the real git, in a real scratch repo. Every verb but checkout,
// switch, restore, stash, clean and reset goes straight to git; one of the six, in an opted-in repo inside a Claude
// session, is judged on git's real arguments, so no spelling of the command reaches past it. These cases run on
// every platform CI runs, Git Bash on Windows included. The verdict's own table is test/hooks/tree-guard.test.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, seeded, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  NO_RC, NODE_DIR, shellPath, spawnBash, spawnSync, systemPathWith, homeEnv, which,
} = require('../lib/platform');
const { readArgv } = require('../lib/argv-log');
const { recordingNode } = require('../lib/node-fakes');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const KIT = path.join(__dirname, '..', '..');
const SHIM_DIR = path.join(KIT, 'workflow', 'gitshim');

// The version a recordingNode reads as below the floor.
const OLD_VERSION = '20.15.1';
const FLOOR_LINE = `workkit: this Node is v${OLD_VERSION}; the kit needs 22.22 or newer`;
const NO_NODE = 'git: the workkit check cannot run: no node on PATH';

const APP = 'const x = 1;\n';
const EDITED = 'const x = 2;\n';

// A repo on main with src/app.js and notes.md committed and a second branch, opted in unless the shape
// says not, beside an empty home and TMPDIR; git runs here with the real PATH, never through the shim.
const seed = seeded((dir, { optIn, settings }) => {
  const repo = path.join(dir, 'repo');
  for (const d of [path.join(repo, 'src'), path.join(dir, 'home'), path.join(dir, 'tmp'), path.join(dir, 'elsewhere')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), APP);
  fs.writeFileSync(path.join(repo, 'notes.md'), '# notes\n');
  if (optIn) {
    fs.mkdirSync(path.join(repo, '.workkit'));
    fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), settings || OPT_IN_SHAPES.current);
  }
  const env = homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH });
  // Git for Windows' system config turns autocrlf on, and the scratch home hides CI's global off,
  // so the repo turns it off itself: a file git rewrites reads back with \n on every platform.
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'],
    ['config', 'core.autocrlf', 'false'], ['add', '-A'], ['commit', '-q', '-m', 'init'], ['branch', 'feature']]) {
    const res = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
});

/**
 * A fresh copy of the world. `git(...args)` runs the real git in the repo, past the shim, and
 * throws on a non-zero exit. `edit()` leaves src/app.js changed and unstaged. `settings` is the
 * text of the repo's .workkit/settings.json in place of the opt-in.
 */
const mkWorld = ({ optIn = true, settings = null } = {}) => {
  const dir = mkTmp('wk-gitshim-');
  seed(dir, { optIn, settings });
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const git = (...args) => {
    const res = spawnSync('git', args, { cwd: repo, env: homeEnv(home, { PATH: process.env.PATH }), encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout;
  };
  const app = () => fs.readFileSync(path.join(repo, 'src', 'app.js'), 'utf8');
  const edit = () => fs.writeFileSync(path.join(repo, 'src', 'app.js'), EDITED);
  return { dir, repo, home, tmp: path.join(dir, 'tmp'), elsewhere: path.join(dir, 'elsewhere'), git, app, edit };
};

/**
 * Run `line` in a real bash from `cwd` (the repo by default), PATH the shim's folder first, then
 * `before` (folders ahead of node), node, then the system tools (where git is). `claude: false`
 * leaves CLAUDECODE unset; `env` adds variables. Returns git's answer as the shell saw it.
 */
const sh = (world, line, { cwd = world.repo, claude = true, env: extra = {}, before = [], node = true } = {}) => {
  const dirs = [SHIM_DIR, ...before, ...(node ? [NODE_DIR] : [])];
  const env = homeEnv(world.home, {
    PATH: systemPathWith(...dirs),
    TMPDIR: shellPath(world.tmp),
    WORKFLOW_HOME: shellPath(path.join(world.home, '.workkit')),
    ...(claude ? { CLAUDECODE: '1' } : {}),
    ...extra,
  });
  const res = spawnBash([...NO_RC, '-c', line], { cwd, env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const BLOCKED = 'tree-guard: BLOCKED';

/** Asserts the run was refused before git ran: exit 1, the block text on stderr naming `found`. */
const refused = (res, found, label) => {
  expect(res.code, `${label}: exit 1, stderr: ${res.stderr}`).toBe(1);
  expect(res.stderr.includes(BLOCKED), `${label}: the block text on stderr, got: ${res.stderr}`).toBeTruthy();
  expect(res.stderr.includes(found), `${label}: naming ${found}, got: ${res.stderr}`).toBeTruthy();
};

/** Asserts git ran and nothing was judged in the way: exit 0, no block. */
const ran = (res, label) => {
  expect(res.code, `${label}: exit 0, stderr: ${res.stderr}`).toBe(0);
  expect(!res.stderr.includes(BLOCKED), `${label}: no block, got: ${res.stderr}`).toBeTruthy();
};

// sh's options for a PATH of the shim and the system tools alone, which must hold no node.
const noNode = () => {
  expect(which('node', systemPathWith(SHIM_DIR)), 'no node among the system tools').toBe(null);
  return { node: false };
};

const branch = (world) => world.git('rev-parse', '--abbrev-ref', 'HEAD').trim();

// a1 for a2, a2 for a3, ... the last hop for status: `hops` aliases in all.
const chain = (world, hops) => {
  for (let i = 1; i <= hops; i++) world.git('config', `alias.a${i}`, i === hops ? 'status' : `a${i + 1}`);
};

describe('gitshim: the hot path', () => {
  test('git status through the shim answers with the real git\'s output and exit code, and starts no node', async () => {
    const world = mkWorld();
    world.edit();
    // A node ahead of the real one that records each start, so a judge that ran would be seen.
    const log = path.join(world.dir, 'node.argv');
    const stubs = recordingNode(path.join(world.dir, 'stubs'), { log });
    const status = sh(world, 'git status --porcelain', { before: [stubs], node: false });
    expect(status.code, `exit 0, stderr: ${status.stderr}`).toBe(0);
    expect(status.stdout.replace(/\r/g, ''), 'the real git\'s porcelain line').toBe(' M src/app.js\n');
    const missing = sh(world, 'git rev-parse --verify --quiet refs/heads/nosuch', { before: [stubs], node: false });
    expect(missing.code, 'git\'s own non-zero exit comes back').toBe(1);
    expect(readArgv(log).length, `no node started, got: ${JSON.stringify(readArgv(log))}`).toBe(0);
  });

  test('a guarded verb starts node once in a Claude session, and none outside one', async () => {
    const world = mkWorld();
    const log = path.join(world.dir, 'node.argv');
    const stubs = recordingNode(path.join(world.dir, 'stubs'), { log });
    ran(sh(world, 'git checkout feature', { before: [stubs], node: false }), 'in a session');
    expect(readArgv(log).length, `one node started, got: ${JSON.stringify(readArgv(log))}`).toBe(1);
    ran(sh(world, 'git checkout main', { before: [stubs], node: false, claude: false }), 'outside a session');
    expect(readArgv(log).length, `no node started outside, got: ${JSON.stringify(readArgv(log))}`).toBe(1);
    expect(branch(world), 'both checkouts ran').toBe('main');
  });
});

describe('gitshim: when the check cannot run', () => {
  test('a guarded verb in an opted-in repo inside a Claude session, no node on PATH: the no-node line and 1, git not run', async () => {
    const world = mkWorld();
    const res = sh(world, 'git checkout feature', noNode());
    expect(res.code, `exit 1, stderr: ${res.stderr}`).toBe(1);
    expect(res.stderr.includes(NO_NODE), `the no-node line, got: ${res.stderr}`).toBeTruthy();
    expect(branch(world), 'the checkout never ran').toBe('main');
  });

  test('a guarded verb in a repo with no .workkit/settings.json inside a Claude session, no node on PATH: git runs', async () => {
    const world = mkWorld({ optIn: false });
    ran(sh(world, 'git checkout feature', noNode()), 'not opted in');
    expect(branch(world), 'the checkout ran').toBe('feature');
  });

  test('HOOK_DISABLE=1 in an opted-in repo inside a Claude session: with no node on PATH, or under a node below 22.22, a guarded verb runs git with no line and no node started', async () => {
    const none = mkWorld();
    const bare = sh(none, 'git checkout feature', { ...noNode(), env: { HOOK_DISABLE: '1' } });
    ran(bare, 'no node on PATH');
    expect(!bare.stderr.includes(NO_NODE), `no line about node, got: ${bare.stderr}`).toBeTruthy();
    expect(branch(none), 'no node: the checkout ran').toBe('feature');

    const old = mkWorld();
    const log = path.join(old.dir, 'node.argv');
    const below = sh(old, 'git checkout feature',
      { before: [recordingNode(path.join(old.dir, 'old-node'), { log, older: OLD_VERSION })], node: false, env: { HOOK_DISABLE: '1' } });
    ran(below, 'a node below the floor');
    expect(!below.stderr.includes(FLOOR_LINE), `no floor line, got: ${below.stderr}`).toBeTruthy();
    expect(readArgv(log).length, `no node started, got: ${JSON.stringify(readArgv(log))}`).toBe(0);
    expect(branch(old), 'a node below the floor: the checkout ran').toBe('feature');
  });

  test('a guarded verb in an opted-in repo inside a Claude session, under a node below 22.22: the floor line and 1, git not run', async () => {
    const world = mkWorld();
    const res = sh(world, 'git checkout feature', { before: [recordingNode(path.join(world.dir, 'old-node'), { older: OLD_VERSION })], node: false });
    expect(res.code, `exit 1, stderr: ${res.stderr}`).toBe(1);
    expect(res.stderr.includes(FLOOR_LINE), `the floor line, got: ${res.stderr}`).toBeTruthy();
    expect(branch(world), 'the checkout never ran').toBe('main');
  });
});

describe('gitshim: a discard in an opted-in repo inside a Claude session', () => {
  test('git reset --hard exits 1 with the block text, and the tree is unchanged', async () => {
    const world = mkWorld();
    world.edit();
    refused(sh(world, 'git reset --hard'), 'git reset --hard', 'reset --hard');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });

  test('the same command spelled through bash -c, a script file, or quotes with a line break is refused the same way', async () => {
    const world = mkWorld();
    world.edit();
    const script = path.join(world.dir, 'discard.sh');
    fs.writeFileSync(script, 'git reset --hard\n');
    for (const [line, label] of [
      ["bash -c 'git reset --hard'", 'bash -c'],
      [`bash "${shellPath(script)}"`, 'a script file'],
      ['"git" \'re\'set \\\n  "--hard"', 'quotes and a line break'],
    ]) {
      refused(sh(world, line), 'git reset --hard', label);
      expect(world.app(), `${label}: the edit is still there`).toBe(EDITED);
    }
  });

  test('WORKKIT_ALLOW_DISCARD=1 in the environment: the stand-aside line prints and git runs', async () => {
    const world = mkWorld();
    world.edit();
    const res = sh(world, 'git reset --hard', { env: { WORKKIT_ALLOW_DISCARD: '1' } });
    expect(res.code, `git ran, stderr: ${res.stderr}`).toBe(0);
    expect(res.stderr.includes('tree-guard: stood aside'), `the stand-aside line, got: ${res.stderr}`).toBeTruthy();
    expect(world.app(), 'the discard happened').toBe(APP);
  });

  test('each allowed form runs: checkout <branch>, checkout -b <new>, restore --staged, stash list, reset <file>, clean -n', async () => {
    const world = mkWorld();
    world.edit();
    world.git('add', 'src/app.js');
    for (const line of ['git checkout feature', 'git checkout -b fresh', 'git restore --staged src/app.js', 'git stash list',
      'git reset src/app.js', 'git clean -n']) {
      ran(sh(world, line), line);
    }
    expect(world.git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'the branch checkouts ran').toBe('fresh');
    expect(world.app(), 'none touched the working tree').toBe(EDITED);
  });

  test('an alias co for checkout: git co -- <file> is refused', async () => {
    const world = mkWorld();
    world.edit();
    world.git('config', 'alias.co', 'checkout');
    refused(sh(world, 'git co -- src/app.js'), 'git checkout with a pathspec', 'the alias');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });

  test('a chained alias (a for rh, rh for reset --hard) is refused through git a', async () => {
    const world = mkWorld();
    world.edit();
    world.git('config', 'alias.a', 'rh');
    world.git('config', 'alias.rh', 'reset --hard');
    refused(sh(world, 'git a'), 'git reset --hard', 'the chained alias');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });

  test('an alias with leading global options (-c core.x=1 reset --hard) is refused through git nb', async () => {
    const world = mkWorld();
    world.edit();
    world.git('config', 'alias.nb', '-c core.x=1 reset --hard');
    refused(sh(world, 'git nb'), 'git reset --hard', 'the alias with options');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });

  test('an alias chain six hops deep fails closed: exit 1, no git output, and the depth named', async () => {
    const world = mkWorld();
    world.edit();
    chain(world, 6);
    const res = sh(world, 'git a1');
    expect(res.code, `exit 1, stderr: ${res.stderr}`).toBe(1);
    expect(!res.stdout.includes('src/app.js'), `git's status output is absent, got: ${res.stdout}`).toBeTruthy();
    expect(res.stderr.includes('deeper than five hops'), `the depth named, got: ${res.stderr}`).toBeTruthy();
  });

  test('an alias chain five hops deep ending at status runs', async () => {
    const world = mkWorld();
    world.edit();
    chain(world, 5);
    const res = sh(world, 'git a1');
    ran(res, 'five hops');
    expect(res.stdout.includes('src/app.js'), `git status ran, got: ${res.stdout}`).toBeTruthy();
  });

  test('a ! alias, a shell command, is not judged as a verb: it runs', async () => {
    const world = mkWorld();
    world.git('config', 'alias.say', '!echo shell-alias-ran');
    const res = sh(world, 'git say');
    ran(res, 'the ! alias');
    expect(res.stdout.includes('shell-alias-ran'), `the shell command ran, got: ${res.stdout}`).toBeTruthy();
  });

  test('git -C <opted-in repo> reset --hard from another folder is refused', async () => {
    const world = mkWorld();
    world.edit();
    refused(sh(world, `git -C "${shellPath(world.repo)}" reset --hard`, { cwd: world.elsewhere }), 'git reset --hard', 'git -C');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });

  test('git -C <repo> checkout <file> from another folder, the file changed only in the repo: refused as a discard of a path', async () => {
    const world = mkWorld();
    world.edit();
    refused(sh(world, `git -C "${shellPath(world.repo)}" checkout src/app.js`, { cwd: world.elsewhere }),
      'git checkout with a pathspec', 'git -C checkout <file>');
    expect(world.app(), 'the edit is still there').toBe(EDITED);
  });
});

describe('gitshim: where the shim stands aside', () => {
  test('a repo that has not opted in, or no CLAUDECODE: git reset --hard runs', async () => {
    const plain = mkWorld({ optIn: false });
    plain.edit();
    ran(sh(plain, 'git reset --hard'), 'not opted in');
    expect(plain.app(), 'not opted in: git ran').toBe(APP);
    const outside = mkWorld();
    outside.edit();
    ran(sh(outside, 'git reset --hard', { claude: false }), 'no CLAUDECODE');
    expect(outside.app(), 'no CLAUDECODE: git ran').toBe(APP);
  });

  test('a repo whose .workkit/settings.json says "enabled": false, in a Claude session: git reset --hard runs, and a six-hop alias runs with no refusal', async () => {
    const off = () => mkWorld({ settings: '{\n  "enabled": false\n}\n' });
    const discard = off();
    discard.edit();
    ran(sh(discard, 'git reset --hard'), 'reset --hard');
    expect(discard.app(), 'the discard happened').toBe(APP);

    const deep = off();
    deep.edit();
    chain(deep, 6);
    const res = sh(deep, 'git a1');
    ran(res, 'six hops');
    expect(!res.stderr.includes('deeper than five hops'), `no too-deep refusal, got: ${res.stderr}`).toBeTruthy();
    expect(res.stdout.includes('src/app.js'), `git status ran, got: ${res.stdout}`).toBeTruthy();
  });
});
