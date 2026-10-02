// Tests for workflow/publish/build.sh: the one home of the install, the mint
// and the build that turn a tower project into a built site. Each case drives
// the script whole against a scratch project with a stub `omega` inside it and
// an `npm` shim on PATH. No omega, no network.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, joinPath,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { REPO_ROOT, writeStub } = require('./helpers');

const SCRIPT = path.join(REPO_ROOT, 'workflow', 'publish', 'build.sh');

const readLog = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  : []);

/**
 * A scratch project and the two tools build.sh reaches. The npm shim records
 * `<cwd>|<argv>|<OMEGA_PATH_PREFIX>` and the omega stub `<cwd>|<argv>`.
 * `installExit` is what `npm install` exits with. `mint` is `logo` (exit 0 and
 * a logo folder), `nothing` (exit 0, no logo) or `fails` (says why, exit 3).
 * `build` is `dist` (exit 0 and the output folder), `nothing` or `fails`.
 */
const mkProject = ({ installExit = 0, mint = 'logo', build = 'dist' } = {}) => {
  const root = mkTmp('workkit-build-');
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, 'targets', 'web'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const npmLog = path.join(root, 'npm.log');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s|%s\\n' "$PWD" "$*" "\${OMEGA_PATH_PREFIX:-unset}" >> ${JSON.stringify(shellPath(npmLog))}`,
    `if [[ "$1" == install ]]; then exit ${installExit}; fi`,
    'prefix="$2"',
    ...({
      dist: ['mkdir -p "$prefix/dist"', 'exit 0'],
      nothing: ['exit 0'],
      fails: ['printf \'omega: the build could not resolve a page\\n\' >&2', 'exit 1'],
    })[build],
  ]);

  const mintLog = path.join(root, 'mint.log');
  writeStub(path.join(project, 'node_modules', '.bin', 'omega'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
    ...({
      logo: ['mkdir -p "$PWD/.omega/assets/logo/brandmark"', 'exit 0'],
      nothing: ['exit 0'],
      fails: ['printf \'omega: the brandmark could not be read\\n\' >&2', 'exit 3'],
    })[mint],
  ]);

  return {
    root,
    project,
    npms: () => readLog(npmLog),
    mints: () => readLog(mintLog),
    env: homeEnv(home, { PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR) }),
  };
};

// Run from the scratch root, never the project, so a step that lands in the
// project got there by entering it.
const build = (world, args) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd: world.root, env: world.env, encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `build.sh finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The one stderr line a refusal prints, which must open with `opening`.
const assertOneLine = (err, opening, what) => {
  const lines = err.trim().split('\n');
  assertEq(lines.length, 1, `${what} prints one stderr line, got: ${err}`);
  assert(lines[0].startsWith(opening), `${what} opens with "${opening}", got: ${lines[0]}`);
};

const run = async () => {
  group('workflow/publish/build.sh: install');

  await test('install runs npm install with the project dir as the working directory', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['install', shellPath(world.project)]);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const npms = world.npms();
    assertEq(npms.length, 1, `one npm call: ${npms.join(' | ')}`);
    assertEq(npms[0].split('|').slice(0, 2).join('|'), `${shellPath(world.project)}|install`,
      'npm install, run inside the project');

    const failing = mkProject({ installExit: 7 });
    assertEq(build(failing, ['install', shellPath(failing.project)]).code, 7, 'and the exit is npm’s own');
  });

  group('workflow/publish/build.sh: mint');

  await test('mint runs the project’s own omega at the project, and a minted logo is success', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['mint', shellPath(world.project)]);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const mints = world.mints();
    assertEq(mints.length, 1, `one call of the project’s omega: ${mints.join(' | ')}`);
    assert(mints[0].startsWith(`${shellPath(world.project)}|`), `run at the project, got: ${mints[0]}`);
  });

  await test('a mint that exits 0 and leaves no logo folder exits 1 and says so', () => {
    const world = mkProject({ mint: 'nothing' });
    const { code, err } = build(world, ['mint', shellPath(world.project)]);
    assertEq(code, 1, `exit 1: ${err}`);
    assertOneLine(err, 'build: the mint left no logo at', 'the missing logo');
  });

  await test('a mint that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ mint: 'fails' });
    const { code, out, err } = build(world, ['mint', shellPath(world.project)]);
    assert(code !== 0, `non-zero: ${out}${err}`);
    assert(err.includes('omega: the brandmark could not be read'), `what the mint said passes through, got: ${out}${err}`);
  });

  group('workflow/publish/build.sh: build');

  await test('build hands the prefix to the build as OMEGA_PATH_PREFIX and succeeds when dist exists', () => {
    const world = mkProject();
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const npms = world.npms();
    assertEq(npms.length, 1, `one npm call: ${npms.join(' | ')}`);
    const [, argv, prefix] = npms[0].split('|');
    assertEq(argv, `--prefix ${shellPath(world.project)}/targets/web run build`, 'the web target’s build script');
    assertEq(prefix, '/x/', 'the build was told the prefix the site serves at');
    assert(fs.existsSync(path.join(world.project, 'targets', 'web', 'dist')), 'and the output is there');
  });

  await test('a build that exits 0 and leaves no dist exits 1 and says so', () => {
    const world = mkProject({ build: 'nothing' });
    const { code, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assertEq(code, 1, `exit 1: ${err}`);
    assertOneLine(err, 'build: the build left no output at', 'the missing output');
  });

  await test('a build that fails exits non-zero with its own output shown', () => {
    const world = mkProject({ build: 'fails' });
    const { code, out, err } = build(world, ['build', shellPath(world.project), '/x/']);
    assert(code !== 0, `non-zero: ${out}${err}`);
    assert(err.includes('omega: the build could not resolve a page'), `what the build said passes through, got: ${out}${err}`);
  });

  group('workflow/publish/build.sh: usage');

  await test('a build with no prefix, an unknown verb and an install with no dir are usage errors', () => {
    const world = mkProject();
    const calls = [
      ['build', shellPath(world.project)],
      ['nope', shellPath(world.project)],
      ['install'],
    ];
    for (const args of calls) {
      const { code, err } = build(world, args);
      assertEq(code, 2, `build.sh ${args.join(' ')} exits 2: ${err}`);
      assertOneLine(err, 'usage: build.sh', `build.sh ${args.join(' ')}`);
    }
    assertEq(world.npms().length + world.mints().length, 0, 'and no tool ran for any of them');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
