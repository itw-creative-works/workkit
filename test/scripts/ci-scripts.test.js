// Tests for the scripts the kit's reusable ci.yml runs beside a repo's checkout:
// .github/scripts/ci-node-version.sh (the Node version), ci-setup.sh (the repo's
// hooks.ciSetup commands) and ci-test.sh (the suite, skipped for a release push).
// Each runs for real through bash, given a scratch repo, from a folder outside it.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, WORKKIT_DIR, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, shellPath, stubTool, joinPath, homeEnv, basePathWithout, spawnSync,
} = require('../lib/platform');

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

/** `bash .github/scripts/<name> <repo>` from a folder outside the repo; `all` is stdout then stderr. */
const run = (w, name, { PATH = basePath(), env = {} } = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(SCRIPTS, name)), shellPath(w.repo)], {
    cwd: w.away,
    env: homeEnv(w.home, { ...env, PATH, NPM_CONFIG_UPDATE_NOTIFIER: 'false' }),
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  assert(res.status !== null, `${name} finished (no timeout): ${res.error || ''}`);
  const out = res.stdout || '';
  const err = res.stderr || '';
  return { code: res.status, out, err, all: out + err };
};

/** The repo's settings text: workkit on, `hooks` as given. */
const ciSetup = (...commands) => ({ ciSetup: commands.map((command) => ({ command })) });
const settings = (hooks) => ({ [`${WORKKIT_DIR}/settings.json`]: `${JSON.stringify({ enabled: true, ...(hooks ? { hooks } : {}) })}\n` });

/** A package.json whose test script writes ran.txt and exits `code`. */
const withTestScript = (code = 0) => ({
  'package.json': `${JSON.stringify({
    name: 'fixture',
    private: true,
    scripts: { test: `node -e "require('fs').writeFileSync('ran.txt', 'ran'); process.exit(${code})"` },
  })}\n`,
});

/** `git <args>` in `w`'s repo under its scratch home; the output. */
const gitIn = (w, ...args) => {
  const res = spawnSync('git', args, {
    cwd: w.repo, env: homeEnv(w.home, { PATH: basePath() }), encoding: 'utf8',
  });
  assertEq(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
};

/** `w`'s files committed, then `files` written over them and committed as the push; the push's event file. */
const pushOf = (w, files) => {
  gitIn(w, 'init', '-q', '-b', 'main');
  gitIn(w, 'config', 'user.email', 'test@example.com');
  gitIn(w, 'config', 'user.name', 'Test');
  gitIn(w, 'add', '-A');
  gitIn(w, 'commit', '-q', '-m', 'init');
  const before = gitIn(w, 'rev-parse', 'HEAD');
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(w.repo, rel), body);
  gitIn(w, 'add', '-A');
  gitIn(w, 'commit', '-q', '-m', 'push');
  const event = path.join(w.dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ before, after: gitIn(w, 'rev-parse', 'HEAD') }));
  return { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event };
};

// A stub, not the real xvfb-run: a Mac has none, and this is the only way to see
// the wrapper there. It records its argv, then runs the command after `-a`.
const xvfbStub = (w) => {
  const log = path.join(w.dir, 'xvfb-argv.txt');
  stubTool(w.bin, 'xvfb-run', [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$@" > "${shellPath(log)}"`,
    '[ "$1" = "-a" ] && shift',
    'exec "$@"',
  ]);
  return { PATH: joinPath(w.bin, basePath()), argv: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null) };
};

const cases = async () => {
  group('ci-node-version.sh: which Node the job sets up');

  await test('a root .nvmrc is the version, over a root .node-version', () => {
    const w = mkWorld({ '.nvmrc': '20.11.1\n', '.node-version': '18.19.0\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    assertEq(code, 0, `exit 0, stderr: ${err}`);
    assertEq(out.trim(), '20.11.1', 'the .nvmrc value');
  });

  await test('only a root .node-version: its value', () => {
    const w = mkWorld({ '.node-version': '22.3.0\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    assertEq(code, 0, `exit 0, stderr: ${err}`);
    assertEq(out.trim(), '22.3.0', 'the .node-version value');
  });

  await test('neither at the root, a targets/web/.nvmrc below it: lts/*', () => {
    const w = mkWorld({ 'targets/web/.nvmrc': '20\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    assertEq(code, 0, `exit 0, stderr: ${err}`);
    assertEq(out.trim(), 'lts/*', 'no folder below the root is read');
  });

  await test('nvm\'s spellings: vN/* and vN are N; lts/*, node and a plain version pass through', () => {
    const forms = [
      ['v22/*\n', '22'], ['v22\n', '22'], ['v20.11.1\n', '20.11.1'], ['lts/*\n', 'lts/*'], ['node\n', 'node'],
      ['22.3.0\n', '22.3.0'], ['lts/iron\n', 'lts/iron'],
    ];
    for (const [body, want] of forms) {
      const { code, out } = run(mkWorld({ '.nvmrc': body }), 'ci-node-version.sh');
      assertEq(code, 0, `${JSON.stringify(body)}: exit 0`);
      assertEq(out, `${want}\n`, `${JSON.stringify(body)}: the version setup-node takes`);
    }
  });

  await test('blank and comment lines are skipped, a trailing comment and a CR stripped', () => {
    const forms = [
      ['\n# the version\n\nv22/*\n', '22'], ['  v22/* # current LTS\r\n', '22'], ['20 # pinned\n', '20'],
      ['\r\n#only\r\n18\r\n', '18'],
    ];
    for (const [body, want] of forms) {
      assertEq(run(mkWorld({ '.nvmrc': body }), 'ci-node-version.sh').out, `${want}\n`, `${JSON.stringify(body)}`);
    }
    assertEq(run(mkWorld({ '.nvmrc': '# nothing\n\n', '.node-version': '21\n' }), 'ci-node-version.sh').out, '21\n',
      'an .nvmrc of comments alone falls through to .node-version');
  });

  group('ci-setup.sh: the repo\'s hooks.ciSetup commands');

  await test('two commands run in order, from the repo root', () => {
    const w = mkWorld(settings(ciSetup('echo one >> order.txt', 'echo two >> order.txt && pwd -P > where.txt')));
    const { code, all } = run(w, 'ci-setup.sh');
    assertEq(code, 0, `exit 0, got: ${all}`);
    assertEq(w.read('order.txt'), 'one\ntwo\n', 'both ran, first then second');
    assertEq(w.read('where.txt'), `${shellPath(fs.realpathSync(w.repo))}\n`, 'from the repo root, not the folder the step started in');
  });

  await test('a failing first command: the second never runs, the job fails naming the command', () => {
    const w = mkWorld(settings(ciSetup('exit 3', 'echo two >> order.txt')));
    const { code, all } = run(w, 'ci-setup.sh');
    assert(code !== 0, `a non-zero exit, got ${code}: ${all}`);
    assert(all.split('\n').includes('ci-setup: failed: exit 3'), `the line naming the command, got: ${all}`);
    assertEq(w.read('order.txt'), null, 'the second command never ran');
  });

  await test('a command appending FOO=1 to $GITHUB_ENV leaves it there for the later steps', () => {
    const w = mkWorld(settings(ciSetup('echo FOO=1 >> "$GITHUB_ENV"')));
    const envFile = path.join(w.dir, 'github-env');
    fs.writeFileSync(envFile, '');
    const { code, all } = run(w, 'ci-setup.sh', { env: { GITHUB_ENV: shellPath(envFile) } });
    assertEq(code, 0, `exit 0, got: ${all}`);
    assertEq(fs.readFileSync(envFile, 'utf8'), 'FOO=1\n', 'the runner\'s env file holds the line');
  });

  await test('a local: true entry is skipped on the runner, and the entries after it run', () => {
    const w = mkWorld(settings({ ciSetup: [{ command: 'echo local >> order.txt', local: true }, { command: 'echo two >> order.txt' }] }));
    const { code, all } = run(w, 'ci-setup.sh');
    assertEq(code, 0, `exit 0, got: ${all}`);
    assertEq(w.read('order.txt'), 'two\n', 'the local entry alone did not run');
  });

  await test('an entry with no string command fails the job naming hooks.ciSetup[<i>]', () => {
    for (const [name, bad] of Object.entries({ 'no command': {}, 'a number command': { command: 5 }, 'a bare string': 'echo bare >> order.txt' })) {
      const w = mkWorld(settings({ ciSetup: [{ command: 'true' }, bad] }));
      const { code, all } = run(w, 'ci-setup.sh');
      assert(code !== 0, `${name}: a non-zero exit, got ${code}: ${all}`);
      assert(all.includes('hooks.ciSetup[1]'), `${name}: the entry named, got: ${all}`);
      assertEq(w.read('order.txt'), null, `${name}: the bad entry never ran`);
    }
  });

  await test('no hooks.ciSetup: nothing runs, exit 0', () => {
    const shapes = {
      'no settings file': {},
      'settings with no hooks': settings(),
      'hooks for a ship event only': settings({ afterRelease: [{ command: 'echo ran >> ran.txt' }] }),
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const { code, all } = run(w, 'ci-setup.sh');
      assertEq(code, 0, `${name}: exit 0, got: ${all}`);
      assertEq(w.read('ran.txt'), null, `${name}: nothing ran`);
    }
  });

  group('ci-test.sh: the suite');

  await test('a test script with xvfb-run on PATH: the suite runs as xvfb-run -a npm test', () => {
    const w = mkWorld(withTestScript());
    const xvfb = xvfbStub(w);
    const { code, all } = run(w, 'ci-test.sh', { PATH: xvfb.PATH });
    assertEq(code, 0, `exit 0, got: ${all}`);
    assertEq(xvfb.argv(), '-a\nnpm\ntest\n', 'the wrapper got -a npm test');
    assertEq(w.read('ran.txt'), 'ran', 'and the repo\'s test script ran');
  });

  await test('a test script without xvfb-run: plain npm test, its failure the step\'s', () => {
    const w = mkWorld(withTestScript());
    const { code, all } = run(w, 'ci-test.sh');
    assertEq(code, 0, `exit 0, got: ${all}`);
    assertEq(w.read('ran.txt'), 'ran', 'the repo\'s test script ran');
    const red = mkWorld(withTestScript(4));
    const failed = run(red, 'ci-test.sh');
    assert(failed.code !== 0, `a failing suite fails the step, got ${failed.code}: ${failed.all}`);
  });

  await test('no test script: one line, exit 0, nothing wrapped', () => {
    const shapes = {
      'no package.json': {},
      'a package.json with no test script': { 'package.json': '{ "name": "fixture", "private": true, "scripts": { "build": "exit 1" } }\n' },
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const xvfb = xvfbStub(w);
      const { code, all } = run(w, 'ci-test.sh', { PATH: xvfb.PATH });
      assertEq(code, 0, `${name}: exit 0, got: ${all}`);
      assertEq(all.trim().split('\n').length, 1, `${name}: one line, got: ${all}`);
      assert(all.trim() !== '', `${name}: a line, not silence`);
      assertEq(xvfb.argv(), null, `${name}: xvfb-run never called`);
    }
  });

  await test('a push that only stamps a release: one line, exit 0, the suite never run; a code push runs it', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n';
    const stamped = mkWorld({ ...withTestScript(), 'CHANGELOG.md': changelog });
    const skip = run(stamped, 'ci-test.sh', { env: pushOf(stamped, { 'CHANGELOG.md': `${changelog}\n## [1.0.1]\n\n### Fixed\n\n- A fix.\n` }) });
    assertEq(skip.code, 0, `exit 0, got: ${skip.all}`);
    assertEq(skip.all.trim().split('\n').length, 1, `one line, got: ${skip.all}`);
    assert(skip.all.trim() !== '', 'a line, not silence');
    assertEq(stamped.read('ran.txt'), null, 'the repo\'s test script never ran');
    const code = mkWorld({ ...withTestScript(), 'CHANGELOG.md': changelog, 'x.js': 'module.exports = 1;\n' });
    const ran = run(code, 'ci-test.sh', { env: pushOf(code, { 'x.js': 'module.exports = 2;\n' }) });
    assertEq(ran.code, 0, `exit 0, got: ${ran.all}`);
    assertEq(code.read('ran.txt'), 'ran', 'a push changing code runs the suite');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
