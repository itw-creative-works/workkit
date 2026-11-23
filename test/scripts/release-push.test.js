// Tests for .github/scripts/release-push.js, the CI scope job's answer, started with
// Node at the root of a scratch repo with no jq on PATH. A push that only stamps a
// release prints `run=false`; anything else, or a before it cannot read, `run=true`.
// A before the shallow CI clone lacks is fetched from origin first.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const { spawnSync, basePathWithout } = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');

const KIT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(KIT, '.github', 'scripts', 'release-push.js');

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

// The machine's PATH with jq left out, built once per process.
let noJq = null;
const noJqPath = () => {
  if (!noJq) noJq = basePathWithout(mkTmp('release-push-'), 'jq');
  return noJq;
};

/** The script at `w`'s root, started with this Node, given `args`. */
const run = (w, args) => {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: w.repo, env: { ...w.env, PATH: noJqPath() }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
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

// A sha no world holds.
const UNKNOWN = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

describe('release-push.js: a release stamp skips', () => {
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

describe('release-push.js: any other push runs', () => {
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

describe('release-push.js: a <before> the shallow CI clone lacks', () => {
  test('origin holds it: it is fetched, and a release-stamp push prints run=false', () => {
    const { c, before } = mkShallow(STAMP);
    answers(c, before, 'run=false', 'shallow release stamp');
  });

  test('origin lacks it too: the failed fetch is passed over, run=true', () => {
    const { c } = mkShallow(STAMP);
    answers(c, UNKNOWN, 'run=true', 'unknown everywhere');
  });
});

const member = (name, version, deps) => json({ name, version, ...(deps ? { dependencies: deps } : {}) });
/** A workspace's package files at `version`, member a pinning its sibling b at `pin`. */
const workspace = (version, pin = version) => ({
  'package.json': json({ name: 'fixture', version, private: true, workspaces: ['packages/*'] }),
  'packages/a/package.json': member('@fixture/a', version, { '@fixture/b': pin }),
  'packages/b/package.json': member('@fixture/b', version),
});

describe('release-push.js: a workspace whose packages release together', () => {
  test('the CHANGELOG, each member\'s version and its sibling pin moving to that version prints run=false; a pin to another number runs', () => {
    for (const [pin, line, what] of [['1.0.1', 'run=false', 'pins equal to the version'], ['2.0.0', 'run=true', 'a pin off the version']]) {
      const w = mkRepo('release-push-', { 'CHANGELOG.md': CHANGELOG, ...workspace('1.0.0') });
      const before = w.git('rev-parse', 'HEAD').trim();
      push(w, { 'CHANGELOG.md': STAMP['CHANGELOG.md'], ...workspace('1.0.1', pin) });
      answers(w, before, line, what);
    }
  });
});

/** Stage a new file and leave an unstaged edit, so a run that touched the index would show. */
const dirty = (w) => {
  fs.writeFileSync(path.join(w.repo, 'staged.txt'), 'staged\n');
  w.git('add', 'staged.txt');
  fs.appendFileSync(path.join(w.repo, 'CHANGELOG.md'), '\nunstaged\n');
};

/** HEAD, the ref it names, its reflog, the index and the working changes. */
const checkoutState = (w) => ({
  head: w.git('rev-parse', 'HEAD'),
  ref: w.git('rev-parse', '--symbolic-full-name', 'HEAD'),
  reflog: w.git('reflog', 'show', '--format=%H %gs', 'HEAD'),
  index: w.git('ls-files', '--stage'),
  status: w.git('status', '--porcelain'),
});

describe('release-push.js: the checkout is left as it was', () => {
  test('HEAD never moves and the index keeps its staged work, on every path through the script', () => {
    const pushed = (files) => {
      const { w, before } = mkWorld();
      push(w, files);
      return { w, before };
    };
    const shallow = mkShallow(STAMP);
    const paths = [
      ['release stamp', pushed(STAMP), null, 'run=false'],
      ['code change', pushed({ 'src/x.js': 'module.exports = 2;\n' }), null, 'run=true'],
      ['a before fetched from origin', { w: shallow.c, before: shallow.before }, null, 'run=false'],
      ['a before nowhere', { w: mkShallow(STAMP).c }, UNKNOWN, 'run=true'],
      ['an unknown before', pushed(STAMP), UNKNOWN, 'run=true'],
      ['an all-zero before', pushed(STAMP), '0'.repeat(40), 'run=true'],
      ['an empty before', pushed(STAMP), '', 'run=true'],
    ];
    for (const [what, world, given, line] of paths) {
      dirty(world.w);
      const was = checkoutState(world.w);
      const out = run(world.w, [given === null ? world.before : given]);
      expect(out.code, `${what}: exit code (stderr: ${out.stderr})`).toBe(0);
      expect(out.stdout, `${what}: the printed line`).toBe(`${line}\n`);
      const now = checkoutState(world.w);
      for (const key of Object.keys(was)) expect(now[key], `${what}: ${key} as it was`).toBe(was[key]);
    }
  });
});

describe('release-push.js: usage', () => {
  test('no argument exits 64 with the usage line naming the file, and answers nothing', () => {
    const { w } = mkWorld();
    const out = run(w, []);
    expect(out.code, `exit code (stderr: ${out.stderr})`).toBe(64);
    expect(`${out.stdout}${out.stderr}`.split(/\r?\n/).includes('usage: release-push.js <before>'), `the usage line, got: ${out.stdout}${out.stderr}`).toBeTruthy();
    expect(!/run=/.test(out.stdout), `no run= answer on stdout: ${out.stdout}`).toBeTruthy();
  });
});
