// Tests for .github/scripts/release-push.sh, the CI scope job's answer: run
// for real at the root of a scratch repo, given the commit before the push.
// A push that only stamps a release (CHANGELOG.md, version spots in the JSON
// files) prints `run=false`; anything else, or a before it cannot read, prints
// `run=true`.

const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, SPAWN_DEADLINE,
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

/** The script at `w`'s root, given `args`. */
const run = (w, args) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd: w.repo, env: w.env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/** The script's answer for `before` is exactly `line`, exit 0. */
const answers = (w, before, line, what) => {
  const out = run(w, [before]);
  assertEq(out.code, 0, `${what}: exit code (stderr: ${out.stderr})`);
  assertEq(out.stdout, `${line}\n`, `${what}: the printed line`);
};

// The release stamp a ship commits beside its CHANGELOG move.
const STAMP = {
  'CHANGELOG.md': `${CHANGELOG}\n## [1.0.1]\n\n### Fixed\n\n- A fix.\n`,
  '.claude-plugin/plugin.json': plugin('1.0.1'),
  'package.json': pkg('1.0.1'),
  'package-lock.json': lock('1.0.1', '2.0.0'),
};

const cases = async () => {
  group('release-push.sh: a release stamp skips');

  await test('a push changing CHANGELOG.md and the version in plugin.json, package.json and the lockfile prints run=false', () => {
    const { w, before } = mkWorld();
    push(w, STAMP);
    answers(w, before, 'run=false', 'release stamp');
  });

  await test('a push changing only CHANGELOG.md prints run=false', () => {
    const { w, before } = mkWorld();
    push(w, { 'CHANGELOG.md': STAMP['CHANGELOG.md'] });
    answers(w, before, 'run=false', 'changelog only');
  });

  group('release-push.sh: any other push runs');

  await test('a push changing only a dependency version in package-lock.json prints run=true', () => {
    const { w, before } = mkWorld();
    push(w, { 'package-lock.json': lock('1.0.0', '2.0.1') });
    answers(w, before, 'run=true', 'dependency bump');
  });

  await test('a push changing only the version of a JSON file the commit gate does not name prints run=true', () => {
    const { w } = mkWorld();
    w.write('fixtures/app.json', json({ name: 'app', version: '1.0.0' }));
    push(w, {});
    const after = w.git('rev-parse', 'HEAD').trim();
    push(w, { 'fixtures/app.json': json({ name: 'app', version: '1.0.1' }) });
    answers(w, after, 'run=true', 'fixture version');
  });

  await test('a release stamp in a nested package.json and package-lock.json prints run=false', () => {
    const { w } = mkWorld();
    w.write('packages/a/package.json', pkg('1.0.0'));
    w.write('packages/a/package-lock.json', lock('1.0.0', '2.0.0'));
    push(w, {});
    const after = w.git('rev-parse', 'HEAD').trim();
    push(w, { 'packages/a/package.json': pkg('1.0.1'), 'packages/a/package-lock.json': lock('1.0.1', '2.0.0') });
    answers(w, after, 'run=false', 'nested stamp');
  });

  await test('a push changing a code file prints run=true, alone or beside a release stamp', () => {
    const alone = mkWorld();
    push(alone.w, { 'src/x.js': 'module.exports = 2;\n' });
    answers(alone.w, alone.before, 'run=true', 'code alone');
    const stamped = mkWorld();
    push(stamped.w, { ...STAMP, 'src/x.js': 'module.exports = 2;\n' });
    answers(stamped.w, stamped.before, 'run=true', 'code beside a stamp');
  });

  await test('a push that changes no file prints run=true', () => {
    const { w, before } = mkWorld();
    w.git('commit', '-q', '--allow-empty', '-m', 'empty');
    answers(w, before, 'run=true', 'empty push');
  });

  await test('a before that is all zeros, not a commit here, or empty prints run=true', () => {
    for (const [before, what] of [
      ['0000000000000000000000000000000000000000', 'all zeros'],
      ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'unknown sha'],
      ['', 'empty'],
    ]) {
      const { w } = mkWorld();
      push(w, { 'CHANGELOG.md': STAMP['CHANGELOG.md'] });
      answers(w, before, 'run=true', what);
    }
  });

  group('release-push.sh: usage');

  await test('no argument exits 64 and answers nothing', () => {
    const { w } = mkWorld();
    const out = run(w, []);
    assertEq(out.code, 64, `exit code (stderr: ${out.stderr})`);
    assert(!/run=/.test(out.stdout), `no run= answer on stdout: ${out.stdout}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
