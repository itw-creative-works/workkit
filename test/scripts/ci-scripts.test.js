// Tests for the scripts the kit's reusable ci.yml runs beside a repo's checkout:
// .github/scripts/ci-node-version.sh (the Node version), ci-setup.sh (the repo's
// hooks.ciSetup commands) and ci-test.sh (the suite).
// Each runs for real through bash, given a scratch repo, from a folder outside it.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, WORKKIT_DIR, SPAWN_DEADLINE,
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
  expect(res.status !== null, `${name} finished (no timeout): ${res.error || ''}`).toBeTruthy();
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

describe('ci-node-version.sh: which Node the job sets up', () => {
  test('a root .nvmrc is the version, over a root .node-version', () => {
    const w = mkWorld({ '.nvmrc': '20.11.1\n', '.node-version': '18.19.0\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    expect(code, `exit 0, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the .nvmrc value').toBe('20.11.1');
  });

  test('only a root .node-version: its value', () => {
    const w = mkWorld({ '.node-version': '22.3.0\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    expect(code, `exit 0, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'the .node-version value').toBe('22.3.0');
  });

  test('neither at the root, a targets/web/.nvmrc below it: lts/*', () => {
    const w = mkWorld({ 'targets/web/.nvmrc': '20\n' });
    const { code, out, err } = run(w, 'ci-node-version.sh');
    expect(code, `exit 0, stderr: ${err}`).toBe(0);
    expect(out.trim(), 'no folder below the root is read').toBe('lts/*');
  });

  test('nvm\'s spellings: vN/* and vN are N; lts/*, node and a plain version pass through', () => {
    const forms = [
      ['v22/*\n', '22'], ['v22\n', '22'], ['v20.11.1\n', '20.11.1'], ['lts/*\n', 'lts/*'], ['node\n', 'node'],
      ['22.3.0\n', '22.3.0'], ['lts/iron\n', 'lts/iron'],
    ];
    for (const [body, want] of forms) {
      const { code, out } = run(mkWorld({ '.nvmrc': body }), 'ci-node-version.sh');
      expect(code, `${JSON.stringify(body)}: exit 0`).toBe(0);
      expect(out, `${JSON.stringify(body)}: the version setup-node takes`).toBe(`${want}\n`);
    }
  });

  test('blank and comment lines are skipped, a trailing comment and a CR stripped', () => {
    const forms = [
      ['\n# the version\n\nv22/*\n', '22'], ['  v22/* # current LTS\r\n', '22'], ['20 # pinned\n', '20'],
      ['\r\n#only\r\n18\r\n', '18'],
    ];
    for (const [body, want] of forms) {
      expect(run(mkWorld({ '.nvmrc': body }), 'ci-node-version.sh').out, `${JSON.stringify(body)}`).toBe(`${want}\n`);
    }
    expect(run(mkWorld({ '.nvmrc': '# nothing\n\n', '.node-version': '21\n' }), 'ci-node-version.sh').out, 'an .nvmrc of comments alone falls through to .node-version').toBe('21\n');
  });
});

describe('ci-setup.sh: the repo\'s hooks.ciSetup commands', () => {
  test('two commands run in order, from the repo root', () => {
    const w = mkWorld(settings(ciSetup('echo one >> order.txt', 'echo two >> order.txt && pwd -P > where.txt')));
    const { code, all } = run(w, 'ci-setup.sh');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('order.txt'), 'both ran, first then second').toBe('one\ntwo\n');
    expect(w.read('where.txt'), 'from the repo root, not the folder the step started in').toBe(`${shellPath(fs.realpathSync(w.repo))}\n`);
  });

  test('a failing first command: the second never runs, the job fails naming the command', () => {
    const w = mkWorld(settings(ciSetup('exit 3', 'echo two >> order.txt')));
    const { code, all } = run(w, 'ci-setup.sh');
    expect(code !== 0, `a non-zero exit, got ${code}: ${all}`).toBeTruthy();
    expect(all.split('\n').includes('ci-setup: failed: exit 3'), `the line naming the command, got: ${all}`).toBeTruthy();
    expect(w.read('order.txt'), 'the second command never ran').toBe(null);
  });

  test('a command appending FOO=1 to $GITHUB_ENV leaves it there for the later steps', () => {
    const w = mkWorld(settings(ciSetup('echo FOO=1 >> "$GITHUB_ENV"')));
    const envFile = path.join(w.dir, 'github-env');
    fs.writeFileSync(envFile, '');
    const { code, all } = run(w, 'ci-setup.sh', { env: { GITHUB_ENV: shellPath(envFile) } });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(fs.readFileSync(envFile, 'utf8'), 'the runner\'s env file holds the line').toBe('FOO=1\n');
  });

  test('a local: true entry is skipped on the runner, and the entries after it run', () => {
    const w = mkWorld(settings({ ciSetup: [{ command: 'echo local >> order.txt', local: true }, { command: 'echo two >> order.txt' }] }));
    const { code, all } = run(w, 'ci-setup.sh');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('order.txt'), 'the local entry alone did not run').toBe('two\n');
  });

  test('an entry with no string command fails the job naming hooks.ciSetup[<i>]', () => {
    for (const [name, bad] of Object.entries({ 'no command': {}, 'a number command': { command: 5 }, 'a bare string': 'echo bare >> order.txt' })) {
      const w = mkWorld(settings({ ciSetup: [{ command: 'true' }, bad] }));
      const { code, all } = run(w, 'ci-setup.sh');
      expect(code !== 0, `${name}: a non-zero exit, got ${code}: ${all}`).toBeTruthy();
      expect(all.includes('hooks.ciSetup[1]'), `${name}: the entry named, got: ${all}`).toBeTruthy();
      expect(w.read('order.txt'), `${name}: the bad entry never ran`).toBe(null);
    }
  });

  test('no hooks.ciSetup: nothing runs, exit 0', () => {
    const shapes = {
      'no settings file': {},
      'settings with no hooks': settings(),
      'hooks for a ship event only': settings({ afterRelease: [{ command: 'echo ran >> ran.txt' }] }),
    };
    for (const [name, files] of Object.entries(shapes)) {
      const w = mkWorld(files);
      const { code, all } = run(w, 'ci-setup.sh');
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(w.read('ran.txt'), `${name}: nothing ran`).toBe(null);
    }
  });
});

describe('ci-test.sh: the suite', () => {
  test('a test script with xvfb-run on PATH: the suite runs as xvfb-run -a npm test', () => {
    const w = mkWorld(withTestScript());
    const xvfb = xvfbStub(w);
    const { code, all } = run(w, 'ci-test.sh', { PATH: xvfb.PATH });
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(xvfb.argv(), 'the wrapper got -a npm test').toBe('-a\nnpm\ntest\n');
    expect(w.read('ran.txt'), 'and the repo\'s test script ran').toBe('ran');
  });

  test('a test script without xvfb-run: plain npm test, its failure the step\'s', () => {
    const w = mkWorld(withTestScript());
    const { code, all } = run(w, 'ci-test.sh');
    expect(code, `exit 0, got: ${all}`).toBe(0);
    expect(w.read('ran.txt'), 'the repo\'s test script ran').toBe('ran');
    const red = mkWorld(withTestScript(4));
    const failed = run(red, 'ci-test.sh');
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
      const { code, all } = run(w, 'ci-test.sh', { PATH: xvfb.PATH });
      expect(code, `${name}: exit 0, got: ${all}`).toBe(0);
      expect(all.trim().split('\n').length, `${name}: one line, got: ${all}`).toBe(1);
      expect(all.trim() !== '', `${name}: a line, not silence`).toBeTruthy();
      expect(xvfb.argv(), `${name}: xvfb-run never called`).toBe(null);
    }
  });
});
