// Tests for .github/scripts/ci-changelog.js, changelog.yml's one step: no CHANGELOG.md
// passes with its line; a pull request's base ref lints the entries it adds against the
// merge commit's first parent; anything else lints [Unreleased] alone. The lint is
// started by its path beside the script, so each case lays out a scratch kit: the
// script, re-exports of the real workflow/lib, and a recording lint in its place.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const { homeEnv, spawnSync } = require('../lib/platform');
const { recordArgvJs, readArgv, fmtCalls } = require('../lib/argv-log');

const KIT = path.join(__dirname, '..', '..');
const LIB = path.join(KIT, 'workflow', 'lib');
const NO_CHANGELOG = 'no CHANGELOG.md, nothing to check';

/**
 * A scratch kit whose lint records its folder and argv, then exits `exit`, and a
 * caller's repo beside it, holding a CHANGELOG.md when `changelog` is true.
 */
const mkWorld = ({ exit = 0, changelog = true } = {}) => {
  const dir = mkTmp('ci-changelog-');
  const kit = path.join(dir, 'kit');
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const log = path.join(dir, 'lint.argv');
  for (const d of [path.join(kit, '.github', 'scripts'), path.join(kit, 'workflow', 'lib'), path.join(kit, 'workflow', 'changelog'), repo, home]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.copyFileSync(path.join(KIT, '.github', 'scripts', 'ci-changelog.js'), path.join(kit, '.github', 'scripts', 'ci-changelog.js'));
  for (const file of fs.readdirSync(LIB).filter((f) => f.endsWith('.js'))) {
    fs.writeFileSync(path.join(kit, 'workflow', 'lib', file), `module.exports = require(${JSON.stringify(path.join(LIB, file))});\n`);
  }
  fs.writeFileSync(path.join(kit, 'workflow', 'changelog', 'lint.js'),
    `${recordArgvJs(JSON.stringify(log), '[process.cwd(), ...process.argv.slice(2)]')}\nprocess.exitCode = ${exit};\n`);
  if (changelog) fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n');
  return {
    kit, repo, home, calls: () => readArgv(log),
  };
};

/** The script started as the step starts it: from the caller's root, no argument, `env` laid on. */
const run = (w, env = {}) => {
  const res = spawnSync(process.execPath, [path.join(w.kit, '.github', 'scripts', 'ci-changelog.js')], {
    cwd: w.repo, env: homeEnv(w.home, { PATH: process.env.PATH, ...env }), encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `ci-changelog.js finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, all: `${res.stdout || ''}${res.stderr || ''}` };
};

/** The one lint start's flags, after checking it read the caller's CHANGELOG.md. */
const lintFlags = (w, what) => {
  const calls = w.calls();
  expect(calls.length, `${what}: the lint started once, got: ${fmtCalls(calls)}`).toBe(1);
  const [cwd, ...args] = calls[0];
  const files = args.filter((a) => !a.startsWith('--'));
  expect(files.length, `${what}: one file named, got: ${fmtCalls(calls)}`).toBe(1);
  expect(fs.realpathSync(path.resolve(cwd, files[0])), `${what}: the file is the caller's CHANGELOG.md`)
    .toBe(fs.realpathSync(path.join(w.repo, 'CHANGELOG.md')));
  return args.filter((a) => a.startsWith('--')).join(' ');
};

describe('ci-changelog.js: no CHANGELOG.md', () => {
  test('prints its line and ends 0, the lint never started, with or without a base ref', () => {
    for (const [what, env] of [['a pull request', { BASE_REF: 'main' }], ['a push', { BASE_REF: '' }]]) {
      const w = mkWorld({ exit: 4, changelog: false });
      const { code, all } = run(w, env);
      expect(code, `${what}: exit 0, got: ${all}`).toBe(0);
      expect(all.split(/\r?\n/).includes(NO_CHANGELOG), `${what}: the line, got: ${all}`).toBeTruthy();
      expect(fmtCalls(w.calls()), `${what}: no lint start`).toBe('');
    }
  });
});

describe('ci-changelog.js: a pull request', () => {
  test('a base ref lints with --added-only --base=HEAD^1, and the lint\'s exit is the script\'s', () => {
    for (const exit of [0, 3]) {
      const w = mkWorld({ exit });
      const { code, all } = run(w, { BASE_REF: 'main' });
      expect(code, `lint exit ${exit} passed on, got: ${all}`).toBe(exit);
      expect(lintFlags(w, `lint exit ${exit}`), `lint exit ${exit}: the flags`).toBe('--added-only --base=HEAD^1');
    }
  });
});

describe('ci-changelog.js: a push', () => {
  test('no base ref, or the empty one a push hands the step, lints with --unreleased-only, its exit passed on', () => {
    for (const [what, env] of [['BASE_REF unset', {}], ['BASE_REF empty', { BASE_REF: '' }]]) {
      for (const exit of [0, 5]) {
        const w = mkWorld({ exit });
        const { code, all } = run(w, env);
        expect(code, `${what}, lint exit ${exit}: passed on, got: ${all}`).toBe(exit);
        expect(lintFlags(w, `${what}, lint exit ${exit}`), `${what}: the flags`).toBe('--unreleased-only');
      }
    }
  });
});
