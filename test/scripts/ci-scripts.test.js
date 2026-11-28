// Tests for the scripts the kit's reusable ci.yml runs beside a repo's checkout:
// .github/scripts/ci-env.js (the variables it appends to GITHUB_ENV), ci-node-version.js
// (the Node version), ci-hooks.js (the repo's hooks.ciSetup and hooks.ciPostInstall
// commands), ci-install.js (the dependency install) and ci-test.js (the suite).
// Each runs for real under this Node, given a scratch repo, from a folder outside it
// or, as the workflow starts the install, from the repo's root.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, WORKKIT_DIR, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  NODE_DIR, RUN_JS, EMPTY_PATH, shellPath, stubToolJs, joinPath, homeEnv, basePathWithout, spawnSync,
} = require('../lib/platform');
const {
  recordArgvJs, readArgv, eqArgv, fmtCalls,
} = require('../lib/argv-log');
const { enabledWith } = require('../lib/ship-world');

const SCRIPTS = path.join(__dirname, '..', '..', '.github', 'scripts');

/** A scratch world: a repo folder, a home, a folder to start from, a bin for stubs. */
const mkWorld = (files = {}) => {
  const dir = mkTmp('ci-scripts-');
  const w = {
    dir,
    repo: path.join(dir, 'repo'),
    home: path.join(dir, 'home'),
    away: path.join(dir, 'away'),
    bin: path.join(dir, 'bin'),
  };
  for (const d of [w.repo, w.home, w.away, w.bin]) fs.mkdirSync(d, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(w.repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(w.repo, rel), body);
  }
  w.read = (rel) => {
    const file = path.join(w.repo, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return w;
};

// A Linux runner carries xvfb-run in /usr/bin, so every case starts from a PATH
// without it, built once, and the xvfb cases put their stub first.
let mirror = null;
const basePath = () => {
  if (!mirror) mirror = joinPath(basePathWithout(mkTmp('ci-scripts-'), 'xvfb-run'), NODE_DIR);
  return mirror;
};

/** `node .github/scripts/<name> <args>` (default the repo) from `cwd` (default a folder outside the repo); `all` is stdout then stderr. */
const run = (w, name, {
  PATH = basePath(), env = {}, args = [w.repo], cwd = w.away,
} = {}) => {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], {
    cwd,
    env: homeEnv(w.home, { ...env, PATH, NPM_CONFIG_UPDATE_NOTIFIER: 'false' }),
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `${name} finished (no timeout): ${res.error || ''}`).toBeTruthy();
  const out = res.stdout || '';
  const err = res.stderr || '';
  return { code: res.status, out, err, all: out + err };
};

/** `node .github/scripts/ci-hooks.js <event> <repo>`, as run() answers. */
const hooks = (w, event, opts = {}) => run(w, 'ci-hooks.js', { ...opts, args: [event, w.repo] });

const SETTINGS = `${WORKKIT_DIR}/settings.json`;
/** The repo's settings text: workkit on, `hooks` as given. */
const settings = (hooks) => ({ [SETTINGS]: `${JSON.stringify({ enabled: true, ...(hooks ? { hooks } : {}) })}\n` });

/** A package.json whose test script writes ran.txt and exits `code`. */
const withTestScript = (code = 0) => ({
  'package.json': `${JSON.stringify({
    name: 'fixture',
    private: true,
    scripts: { test: `node -e "require('fs').writeFileSync('ran.txt', 'ran'); process.exit(${code})"` },
  })}\n`,
});

// A stand-in, not the real xvfb-run: a Mac has none, and this is the only way to see
// the wrapper there. It records its argv, then runs the command after `-a`, passing its exit on.
const xvfbStub = (w) => {
  const log = path.join(w.dir, 'xvfb-argv.log');
  stubToolJs(w.bin, 'xvfb-run', [
    recordArgvJs(JSON.stringify(log)),
    'const args = process.argv.slice(2);',
    "if (args[0] === '-a') args.shift();",
    `const res = require(${JSON.stringify(RUN_JS)}).spawnSync(args[0], args.slice(1), { stdio: 'inherit' });`,
    'process.exit(res.status === null ? 1 : res.status);',
  ].join('\n'));
  return { PATH: joinPath(w.bin, basePath()), calls: () => readArgv(log) };
};

/** A scratch file holding `seed`, as the runner's GITHUB_ENV or GITHUB_OUTPUT file; `read()` is its text. */
const runnerFile = (w, name, seed = 'seed=1\n') => {
  const file = path.join(w.dir, name);
  fs.writeFileSync(file, seed);
  return { file, seed, read: () => fs.readFileSync(file, 'utf8') };
};

/** ci-node-version.js over `files`: the version line it appended after the output file's seed, or its failure. */
const nodeVersion = (files) => {
  const w = mkWorld(files);
  const output = runnerFile(w, 'github-output');
  const res = run(w, 'ci-node-version.js', { env: { GITHUB_OUTPUT: output.file } });
  expect(res.code, `${JSON.stringify(files)}: exit 0, got: ${res.all}`).toBe(0);
  const text = output.read();
  expect(text.startsWith(output.seed), `${JSON.stringify(files)}: appended after the file's own lines, got: ${JSON.stringify(text)}`).toBeTruthy();
  return text.slice(output.seed.length);
};

describe('ci-node-version.js: which Node the job sets up, appended to GITHUB_OUTPUT', () => {
  test('a root .nvmrc is the version, over a root .node-version', () => {
    expect(nodeVersion({ '.nvmrc': '20.11.1\n', '.node-version': '18.19.0\n' }), 'the .nvmrc value').toBe('version=20.11.1\n');
  });

  test('only a root .node-version: its value', () => {
    expect(nodeVersion({ '.node-version': '22.3.0\n' }), 'the .node-version value').toBe('version=22.3.0\n');
  });

  test('neither at the root, a targets/web/.nvmrc below it: lts/*', () => {
    expect(nodeVersion({ 'targets/web/.nvmrc': '20\n' }), 'no folder below the root is read').toBe('version=lts/*\n');
  });

  test('nvm\'s spellings: vN/* and vN are N; lts/*, node and a plain version pass through', () => {
    const forms = [
      ['v22/*\n', '22'], ['v22\n', '22'], ['v20.11.1\n', '20.11.1'], ['lts/*\n', 'lts/*'], ['node\n', 'node'],
      ['22.3.0\n', '22.3.0'], ['lts/iron\n', 'lts/iron'],
    ];
    for (const [body, want] of forms) {
      expect(nodeVersion({ '.nvmrc': body }), `${JSON.stringify(body)}: the version setup-node takes`).toBe(`version=${want}\n`);
    }
  });

  test('blank and comment lines are skipped, a trailing comment and a CR stripped', () => {
    const forms = [
      ['\n# the version\n\nv22/*\n', '22'], ['  v22/* # current LTS\r\n', '22'], ['20 # pinned\n', '20'],
      ['\r\n#only\r\n18\r\n', '18'],
    ];
    for (const [body, want] of forms) {
      expect(nodeVersion({ '.nvmrc': body }), `${JSON.stringify(body)}`).toBe(`version=${want}\n`);
    }
    expect(nodeVersion({ '.nvmrc': '# nothing\n\n', '.node-version': '21\n' }), 'an .nvmrc of comments alone falls through to .node-version').toBe('version=21\n');
  });

  test('GITHUB_OUTPUT unset: the line naming it, exit 1', () => {
    const { code, all } = run(mkWorld({ '.nvmrc': '22\n' }), 'ci-node-version.js');
    expect(code, `exit 1, got: ${all}`).toBe(1);
    expect(all.split(/\r?\n/).includes('ci-node-version: GITHUB_OUTPUT names no file'), `the line, got: ${all}`).toBeTruthy();
  });
});

describe('ci-env.js: the variables a job\'s later steps read, appended to GITHUB_ENV', () => {
  test('node appends exactly WORKKIT_NODE=<the Node that ran it>, never the first node on PATH', () => {
    const w = mkWorld();
    stubToolJs(w.bin, 'node', 'process.exit(0);');
    const env = runnerFile(w, 'github-env');
    const { code, all } = run(w, 'ci-env.js', { args: ['node'], PATH: joinPath(w.bin, basePath()), env: { GITHUB_ENV: env.file } });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(env.read(), 'the seed, then the one line').toBe(`${env.seed}WORKKIT_NODE=${process.execPath}\n`);
  });

  test('temp appends TEMP= and TMPDIR=, each the runner\'s temp folder', () => {
    const w = mkWorld();
    const runnerTemp = path.join(w.dir, 'runner temp');
    const env = runnerFile(w, 'github-env');
    const { code, all } = run(w, 'ci-env.js', { args: ['temp'], env: { GITHUB_ENV: env.file, RUNNER_TEMP: runnerTemp } });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(env.read(), 'the seed, then the two lines').toBe(`${env.seed}TEMP=${runnerTemp}\nTMPDIR=${runnerTemp}\n`);
  });

  test('another word, no word, GITHUB_ENV unset or temp with no RUNNER_TEMP: exit 1, nothing appended', () => {
    const w = mkWorld();
    const shapes = {
      'another word': { args: ['path'], set: true, line: true },
      'no word': { args: [], set: true, line: true },
      'GITHUB_ENV unset': { args: ['node'], set: false, says: 'ci-env: GITHUB_ENV names no file' },
      'temp with no RUNNER_TEMP': { args: ['temp'], set: true },
    };
    for (const [name, { args, set, line, says }] of Object.entries(shapes)) {
      const env = runnerFile(w, 'github-env');
      const { code, all } = run(w, 'ci-env.js', { args, env: set ? { GITHUB_ENV: env.file } : {} });
      expect(code, `${name}: exit 1, got: ${all}`).toBe(1);
      expect(env.read(), `${name}: nothing appended`).toBe(env.seed);
      if (line) expect(all.trim().split(/\r?\n/).length, `${name}: one usage line, got: ${all}`).toBe(1);
      if (says) expect(all.split(/\r?\n/).includes(says), `${name}: the line, got: ${all}`).toBeTruthy();
    }
  });
});

// An npm ahead of the real one on PATH, recording each start and exiting `exit`.
const npmStandIn = (w, exit = 0) => {
  const log = path.join(w.dir, 'npm.argv');
  stubToolJs(w.bin, 'npm', `${recordArgvJs(JSON.stringify(log))}\nprocess.exit(${exit});`);
  return { PATH: joinPath(w.bin, basePath()), calls: () => readArgv(log) };
};

/** ci-install.js started as the workflow starts it, from the repo's root, with no argument. */
const install = (w, npm) => run(w, 'ci-install.js', { PATH: npm.PATH, args: [], cwd: w.repo });

describe('ci-install.js: the install the lockfile picks, on PATH\'s npm', () => {
  test('a lockfile starts npm ci, a package.json alone npm install, each once', () => {
    const shapes = [
      ['a lockfile', { 'package.json': '{}\n', 'package-lock.json': '{}\n' }, ['ci', '--no-audit', '--no-fund']],
      ['a package.json alone', { 'package.json': '{}\n' }, ['install', '--no-audit', '--no-fund']],
    ];
    for (const [name, files, want] of shapes) {
      const w = mkWorld(files);
      const npm = npmStandIn(w);
      const { code, all } = install(w, npm);
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(fmtCalls(npm.calls()), `${name}: npm's one start`).toBe(fmtCalls([want]));
    }
  });

  test('neither file: npm never starts, exit 0', () => {
    const w = mkWorld();
    const npm = npmStandIn(w);
    const { code, all } = install(w, npm);
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(fmtCalls(npm.calls()), 'no npm start').toBe('');
  });

  test('npm\'s failure is the script\'s exit code', () => {
    const w = mkWorld({ 'package.json': '{}\n', 'package-lock.json': '{}\n' });
    const npm = npmStandIn(w, 7);
    const { code, all } = install(w, npm);
    expect(code, `npm's exit 7 passed on, got: ${all}`).toBe(7);
    expect(npm.calls().length, 'npm started once').toBe(1);
  });
});

describe('ci-hooks.js ciSetup: the repo\'s hooks.ciSetup commands', () => {
  test('two commands run in order, from the repo root', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciSetup: ['echo one >> order.txt', 'echo two >> order.txt && pwd -P > where.txt'] }) });
    const { code, all } = hooks(w, 'ciSetup');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('order.txt'), 'both ran, first then second').toBe('one\ntwo\n');
    expect(w.read('where.txt'), 'from the repo root, not the folder the step started in').toBe(`${shellPath(fs.realpathSync(w.repo))}\n`);
  });

  test('a failing first command: the second never runs, the job fails naming the command', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciSetup: ['exit 3', 'echo two >> order.txt'] }) });
    const { code, all } = hooks(w, 'ciSetup');
    expect(code !== 0, `a non-zero exit, got ${code}: ${all}`).toBeTruthy();
    expect(all.split('\n').includes('ci-setup: failed: exit 3'), `the line naming the command, got: ${all}`).toBeTruthy();
    expect(w.read('order.txt'), 'the second command never ran').toBe(null);
  });

  test('a command appending FOO=1 to $GITHUB_ENV leaves it there for the later steps', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciSetup: ['echo FOO=1 >> "$GITHUB_ENV"'] }) });
    const envFile = path.join(w.dir, 'github-env');
    fs.writeFileSync(envFile, '');
    const { code, all } = hooks(w, 'ciSetup', { env: { GITHUB_ENV: shellPath(envFile) } });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(fs.readFileSync(envFile, 'utf8'), 'the runner\'s env file holds the line').toBe('FOO=1\n');
  });

  test('a local: true entry is skipped on the runner, and the entries after it run', () => {
    const w = mkWorld(settings({ ciSetup: [{ command: 'echo local >> order.txt', local: true }, { command: 'echo two >> order.txt' }] }));
    const { code, all } = hooks(w, 'ciSetup');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('order.txt'), 'the local entry alone did not run').toBe('two\n');
  });

  test('an entry with no string command fails the job naming hooks.ciSetup[<i>]', () => {
    for (const [name, bad] of Object.entries({ 'no command': {}, 'a number command': { command: 5 }, 'a bare string': 'echo bare >> order.txt' })) {
      const w = mkWorld(settings({ ciSetup: [{ command: 'true' }, bad] }));
      const { code, all } = hooks(w, 'ciSetup');
      expect(code !== 0, `${name}: a non-zero exit, got ${code}: ${all}`).toBeTruthy();
      expect(all.includes('hooks.ciSetup[1]'), `${name}: the entry named, got: ${all}`).toBeTruthy();
      expect(w.read('order.txt'), `${name}: the bad entry never ran`).toBe(null);
    }
  });

  test('no hooks.ciSetup: nothing runs, exit 0', () => {
    const shapes = {
      'no settings file': {},
      'settings with no hooks': settings(),
      'hooks for a ship event only': { [SETTINGS]: enabledWith({ afterRelease: ['echo ran >> ran.txt'] }) },
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const { code, all } = hooks(w, 'ciSetup');
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(w.read('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });
});

describe('ci-hooks.js ciPostInstall: the repo\'s hooks.ciPostInstall commands', () => {
  test('two commands run from the repo root in order, each inside a log group named ci-post-install: <command>', () => {
    const first = 'echo one >> order.txt';
    const second = 'echo two >> order.txt && pwd -P > where.txt';
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciPostInstall: [first, second] }) });
    const { code, out, all } = hooks(w, 'ciPostInstall');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('order.txt'), 'both ran, first then second').toBe('one\ntwo\n');
    expect(w.read('where.txt'), 'from the repo root, not the folder the step started in').toBe(`${shellPath(fs.realpathSync(w.repo))}\n`);
    const groups = out.split(/\r?\n/).filter((l) => l.startsWith('::group::') || l === '::endgroup::');
    expect(groups.join('\n'), 'one group per command, opened and closed in order')
      .toBe([`::group::ci-post-install: ${first}`, '::endgroup::', `::group::ci-post-install: ${second}`, '::endgroup::'].join('\n'));
  });

  test('a ciPostInstall list alone: ci-hooks.js ciSetup runs none of it', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciPostInstall: ['echo post >> ran.txt'] }) });
    const { code, all } = hooks(w, 'ciSetup');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('ran.txt'), 'no ciPostInstall command ran').toBe(null);
  });

  test('both lists set: each event runs only its own list', () => {
    const both = { [SETTINGS]: enabledWith({ ciSetup: ['echo setup >> setup.txt'], ciPostInstall: ['echo post >> post.txt'] }) };
    for (const [event, own, wrote, other] of [['ciSetup', 'setup.txt', 'setup\n', 'post.txt'], ['ciPostInstall', 'post.txt', 'post\n', 'setup.txt']]) {
      const w = mkWorld(both);
      const { code, all } = hooks(w, event);
      expect(code, `${event}: exit 0, got: ${all}`).toBe(0);
      expect(w.read(own), `${event}: its own list ran`).toBe(wrote);
      expect(w.read(other), `${event}: the other list never ran`).toBe(null);
    }
  });

  test('no settings file, or no hooks.ciPostInstall key: nothing runs, exit 0', () => {
    const shapes = {
      'no settings file': {},
      'settings with no hooks': settings(),
      'hooks.ciSetup alone': { [SETTINGS]: enabledWith({ ciSetup: ['echo setup >> ran.txt'] }) },
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const { code, all } = hooks(w, 'ciPostInstall');
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(w.read('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });

  test('a second command exiting 3: the line names it, the script exits 3, the third never runs', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciPostInstall: ['echo one >> order.txt', 'exit 3', 'echo three >> order.txt'] }) });
    const { code, all } = hooks(w, 'ciPostInstall');
    expect(code, `exit 3, got: ${all}`).toBe(3);
    expect(all.split(/\r?\n/).includes('ci-post-install: failed: exit 3'), `the line naming the command, got: ${all}`).toBeTruthy();
    expect(w.read('order.txt'), 'the first ran, the third never did').toBe('one\n');
  });

  test('a local: true entry is skipped with its line, and the entry after it runs', () => {
    const local = 'echo local >> order.txt';
    const w = mkWorld(settings({ ciPostInstall: [{ command: local, local: true }, { command: 'echo two >> order.txt' }] }));
    const { code, all } = hooks(w, 'ciPostInstall');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(all.split(/\r?\n/).includes(`ci-post-install: skipped, local only: ${local}`), `the skip line, got: ${all}`).toBeTruthy();
    expect(w.read('order.txt'), 'the local entry alone did not run').toBe('two\n');
  });

  test('a list that is not a list, or an entry with no command: exit 1, a ci-post-install: line naming the key', () => {
    const shapes = {
      'a string': 'echo bare >> ran.txt',
      'an object': { command: 'echo bare >> ran.txt' },
      'an entry with no command': [{ command: 'echo one >> ran.txt' }, {}],
    };
    for (const [name, value] of Object.entries(shapes)) {
      const w = mkWorld(settings({ ciPostInstall: value }));
      const { code, all } = hooks(w, 'ciPostInstall');
      expect(code, `${name}: exit 1, got: ${all}`).toBe(1);
      const said = all.split(/\r?\n/).filter((l) => l.startsWith('ci-post-install:') && l.includes('hooks.ciPostInstall'));
      expect(said.length > 0, `${name}: a ci-post-install: line naming hooks.ciPostInstall, got: ${all}`).toBeTruthy();
      expect(w.read('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });
});

describe('ci-hooks.js: the event', () => {
  test('no event, or a word that is neither: exit 1 naming ciSetup and ciPostInstall', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ afterRelease: ['echo ran >> ran.txt'] }) });
    const calls = { 'no event': [], 'afterRelease': ['afterRelease', w.repo], 'ciTeardown': ['ciTeardown', w.repo] };
    for (const [name, args] of Object.entries(calls)) {
      const { code, all } = run(w, 'ci-hooks.js', { args });
      expect(code, `${name}: exit 1, got: ${all}`).toBe(1);
      expect(all.includes('ciSetup') && all.includes('ciPostInstall'), `${name}: both events named, got: ${all}`).toBeTruthy();
      expect(w.read('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });
});

describe('ci-test.js: the suite', () => {
  test('a test script with xvfb-run on PATH: the suite runs as xvfb-run -a npm test', () => {
    const w = mkWorld(withTestScript());
    const xvfb = xvfbStub(w);
    const { code, all } = run(w, 'ci-test.js', { PATH: xvfb.PATH });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(fmtCalls(xvfb.calls()), 'the wrapper got -a npm test').toBe(fmtCalls([['-a', 'npm', 'test']]));
    expect(w.read('ran.txt'), 'and the repo\'s test script ran').toBe('ran');
  });

  test('a test script without xvfb-run: plain npm test, its failure the step\'s', () => {
    const w = mkWorld(withTestScript());
    const { code, all } = run(w, 'ci-test.js');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('ran.txt'), 'the repo\'s test script ran').toBe('ran');
    const red = mkWorld(withTestScript(4));
    const failed = run(red, 'ci-test.js');
    expect(failed.code !== 0, `a failing suite fails the step, got ${failed.code}: ${failed.all}`).toBeTruthy();
  });

  test('no test script: one line, exit 0, nothing wrapped', () => {
    const shapes = {
      'no package.json': {},
      'a package.json with no test script': { 'package.json': '{ "name": "fixture", "private": true, "scripts": { "build": "exit 1" } }\n' },
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const xvfb = xvfbStub(w);
      const { code, all } = run(w, 'ci-test.js', { PATH: xvfb.PATH });
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(all.trim().split('\n').length, `${name}: one line, got: ${all}`).toBe(1);
      expect(all.trim() !== '', `${name}: a line, not silence`).toBeTruthy();
      expect(fmtCalls(xvfb.calls()), `${name}: xvfb-run never called`).toBe('');
    }
  });
});

// A PATH where bash cannot start: nothing but this suite's node, which runs the script.
const NO_BASH = joinPath(EMPTY_PATH, NODE_DIR);

/** A run's stderr holds no detach: line and no stack frame. */
const noStack = (err) => !err.split(/\r?\n/).some((line) => line.startsWith('detach:') || /^\s+at /.test(line));

describe('ci-hooks.js and ci-test.js: a shell that cannot start fails the step on its own line', () => {
  test('ci-hooks.js: exit 127, the line naming the command, no stack', () => {
    const w = mkWorld({ [SETTINGS]: enabledWith({ ciSetup: ['echo one >> order.txt'] }) });
    const { code, err, all } = hooks(w, 'ciSetup', { PATH: NO_BASH });
    expect(code, `exit 127, got: ${all}`).toBe(127);
    expect(all.split(/\r?\n/).includes('ci-setup: failed: echo one >> order.txt'), `the line naming the command, got: ${all}`).toBeTruthy();
    expect(noStack(err), `no detach: line and no stack, got: ${err}`).toBeTruthy();
  });

  test('ci-test.js: exit 127, no stack', () => {
    const w = mkWorld(withTestScript());
    const { code, err, all } = run(w, 'ci-test.js', { PATH: NO_BASH });
    expect(code, `exit 127, got: ${all}`).toBe(127);
    expect(noStack(err), `no detach: line and no stack, got: ${err}`).toBeTruthy();
  });
});

// A node and an npm ahead of the real ones on PATH, each recording its start. The
// scripts run under this suite's Node, so a command that reached it instead leaves no record.
const pathTools = (w) => {
  const logs = { node: path.join(w.dir, 'node.argv'), npm: path.join(w.dir, 'npm.argv') };
  for (const [name, log] of Object.entries(logs)) stubToolJs(w.bin, name, recordArgvJs(JSON.stringify(log)));
  return { PATH: joinPath(w.bin, basePath()), calls: (name) => readArgv(logs[name]) };
};

describe('ci-hooks.js and ci-test.js: the repo runs on PATH\'s Node, not the one that started the script', () => {
  test('a ciSetup or ciPostInstall command starting node reaches PATH\'s node', () => {
    for (const event of ['ciSetup', 'ciPostInstall']) {
      const w = mkWorld({ [SETTINGS]: enabledWith({ [event]: [`node --probe ${event}`] }) });
      const tools = pathTools(w);
      const { code, all } = hooks(w, event, { PATH: tools.PATH });
      expect(code, `${event}: exit 0, got: ${all}`).toBe(0);
      const calls = tools.calls('node');
      expect(calls.some((c) => eqArgv(c, ['--probe', event])), `${event}: PATH's node ran the command, got: ${fmtCalls(calls)}`).toBeTruthy();
    }
  });

  test('the suite runs as PATH\'s npm test', () => {
    const w = mkWorld(withTestScript());
    const tools = pathTools(w);
    const { code, all } = run(w, 'ci-test.js', { PATH: tools.PATH });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    const calls = tools.calls('npm');
    expect(calls.some((c) => eqArgv(c, ['test'])), `PATH's npm ran test, got: ${fmtCalls(calls)}`).toBeTruthy();
  });
});
