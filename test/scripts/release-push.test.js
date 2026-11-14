// Tests for .github/scripts/release-push.sh, the CI scope job's answer: run
// for real at the root of a scratch repo, given the commit before the push.
// A push that only stamps a release (CHANGELOG.md, version spots in the JSON
// files) prints `run=false`; anything else, or a before it cannot read, prints
// `run=true`. A before the shallow CI clone lacks is fetched from origin first.

const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, SPAWN_DEADLINE,
} = require('../lib/harness');
const { BASH, NO_RC, shellPath } = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');

const KIT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(KIT, '.github', 'scripts', 'release-push.sh');

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const plugin = (version) => json({ name: 'fixture', version });
const pkg = (version) => json({ name: 'fixture', version, private: true });
const lock = (version, dep) => json({
  name: 'fixture',
  version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'fixture', version },
    'node_modules/dep': { version: dep, license: 'MIT' },
  },
});
const CHANGELOG = '# Changelog\n\n## [Unreleased]\n';

/** A repo at 1.0.0 with dep 2.0.0, committed; hands back the world and its first sha. */
const mkWorld = () => {
  const w = mkRepo('release-push-', {
    'CHANGELOG.md': CHANGELOG,
    '.claude-plugin/plugin.json': plugin('1.0.0'),
    'package.json': pkg('1.0.0'),
    'package-lock.json': lock('1.0.0', '2.0.0'),
    'src/x.js': 'module.exports = 1;\n',
  });
  return { w, before: w.git('rev-parse', 'HEAD').trim() };
};

/** Write every `files` entry into `w` and commit them as the push. */
const push = (w, files) => {
  for (const [rel, body] of Object.entries(files)) w.write(rel, body);
  w.git('add', '-A');
  w.git('commit', '-q', '-m', 'push');
};

/**
 * The CI world: a local origin (a bare repo) holding the first commit and the
 * push of `files`, and a `--depth 1` clone of it, which holds the push alone.
 * Hands back the clone as a world and the first sha, which only origin has.
 */
const mkShallow = (files) => {
  const { w, before } = mkWorld();
  push(w, files);
  const origin = path.join(w.dir, 'origin.git');
  const clone = path.join(w.dir, 'clone');
  w.git('clone', '-q', '--bare', w.repo, origin);
  w.git('clone', '-q', '--depth', '1', pathToFileURL(origin).href, clone);
  const c = { ...w, repo: clone, git: (...args) => w.git('-C', clone, ...args) };
  if (c.git('rev-list', '--all').split('\n').includes(before)) {
    throw new Error('the shallow clone already holds <before>; the world is wrong');
  }
  return { c, before };
};

/** The script at `w`'s root, given `args`. */
const run = (w, args) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd: w.repo, env: w.env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/**
 * The script's answer for `before` is exactly `line`, exit 0, and the checkout
 * ends as it began: HEAD at the pushed commit and nothing staged or changed.
 */
const answers = (w, before, line, what) => {
  const pushed = w.git('rev-parse', 'HEAD').trim();
  const out = run(w, [before]);
  expect(out.code, `${what}: exit code (stderr: ${out.stderr})`).toBe(0);
  expect(out.stdout, `${what}: the printed line`).toBe(`${line}\n`);
  expect(w.git('rev-parse', 'HEAD').trim(), `${what}: HEAD is back at the pushed commit`).toBe(pushed);
  expect(w.git('status', '--porcelain'), `${what}: the tree is clean`).toBe('');
};

// The release stamp a ship commits beside its CHANGELOG move.
const STAMP = {
  'CHANGELOG.md': `${CHANGELOG}\n## [1.0.1]\n\n### Fixed\n\n- A fix.\n`,
  '.claude-plugin/plugin.json': plugin('1.0.1'),
  'package.json': pkg('1.0.1'),
  'package-lock.json': lock('1.0.1', '2.0.0'),
};

describe('release-push.sh: a release stamp skips', () => {
  test('a push changing CHANGELOG.md and the version in plugin.json, package.json and the lockfile prints run=false', () => {
    const { w, before } = mkWorld();
    push(w, STAMP);
    answers(w, before, 'run=false', 'release stamp');
  });

  test('a push changing only CHANGELOG.md prints run=false', () => {
    const { w, before } = mkWorld();
    push(w, { 'CHANGELOG.md': STAMP['CHANGELOG.md'] });
    answers(w, before, 'run=false', 'changelog only');
  });
});

describe('release-push.sh: any other push runs', () => {
  test('a push changing only a dependency version in package-lock.json prints run=true', () => {
    const { w, before } = mkWorld();
    push(w, { 'package-lock.json': lock('1.0.0', '2.0.1') });
    answers(w, before, 'run=true', 'dependency bump');
  });

  test('a push changing only the version of a JSON file the commit gate does not name prints run=true', () => {
    const { w } = mkWorld();
    w.write('fixtures/app.json', json({ name: 'app', version: '1.0.0' }));
    push(w, {});
    const after = w.git('rev-parse', 'HEAD').trim();
    push(w, { 'fixtures/app.json': json({ name: 'app', version: '1.0.1' }) });
    answers(w, after, 'run=true', 'fixture version');
  });

  test('a release stamp in a nested package.json and package-lock.json prints run=false', () => {
    const { w } = mkWorld();
    w.write('packages/a/package.json', pkg('1.0.0'));
    w.write('packages/a/package-lock.json', lock('1.0.0', '2.0.0'));
    push(w, {});
    const after = w.git('rev-parse', 'HEAD').trim();
    push(w, { 'packages/a/package.json': pkg('1.0.1'), 'packages/a/package-lock.json': lock('1.0.1', '2.0.0') });
    answers(w, after, 'run=false', 'nested stamp');
  });

  test('a push changing a code file prints run=true, alone or beside a release stamp', () => {
    const alone = mkWorld();
    push(alone.w, { 'src/x.js': 'module.exports = 2;\n' });
    answers(alone.w, alone.before, 'run=true', 'code alone');
    const stamped = mkWorld();
    push(stamped.w, { ...STAMP, 'src/x.js': 'module.exports = 2;\n' });
    answers(stamped.w, stamped.before, 'run=true', 'code beside a stamp');
  });

  test('a push that changes no file prints run=true', () => {
    const { w, before } = mkWorld();
    w.git('commit', '-q', '--allow-empty', '-m', 'empty');
    answers(w, before, 'run=true', 'empty push');
  });

  test('a before that is all zeros or empty prints run=true', () => {
    for (const [before, what] of [
      ['0000000000000000000000000000000000000000', 'all zeros'],
      ['', 'empty'],
    ]) {
      const { w } = mkWorld();
      push(w, { 'CHANGELOG.md': STAMP['CHANGELOG.md'] });
      answers(w, before, 'run=true', what);
    }
  });
});

describe('release-push.sh: a <before> the shallow CI clone lacks', () => {
  test('origin holds it: it is fetched, and a release-stamp push prints run=false', () => {
    const { c, before } = mkShallow(STAMP);
    answers(c, before, 'run=false', 'shallow release stamp');
  });

  test('origin lacks it too: the failed fetch is passed over, run=true', () => {
    const { c } = mkShallow(STAMP);
    answers(c, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'run=true', 'unknown everywhere');
  });
});

describe('release-push.sh: usage', () => {
  test('no argument exits 64 and answers nothing', () => {
    const { w } = mkWorld();
    const out = run(w, []);
    expect(out.code, `exit code (stderr: ${out.stderr})`).toBe(64);
    expect(!/run=/.test(out.stdout), `no run= answer on stdout: ${out.stdout}`).toBeTruthy();
  });
});
