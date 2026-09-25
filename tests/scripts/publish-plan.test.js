//
// Tests for workflow/publish-plan.js: the ship's publish step reads the plan it
// prints, so the plan is the whole question here. Which packages publish, in
// which order, which are skipped and why, and every refusal that stops the step
// before a single package reaches npm.
//
// Each case builds a fixture repo in a tmp dir: a root package.json and its
// workspace members.
// The plan cases stub nothing, because the plan reaches nothing: the script
// reads files and prints. The `--run` cases put a fake `npm` in front of the
// real one, the only npm any case here may reach, and read back every argv it
// was handed.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { IS_WINDOWS, NO_NODE_STUB, stubTool, pathWith } = require('../lib/platform');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'publish-plan.js');
const { plan } = require(SCRIPT);

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pplan-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A fixture repo: `root` is the root package.json, `members` maps a relative
 * directory to its package.json.
 */
const mkRepo = ({ root, members = {} } = {}) => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(root));
  for (const [rel, pkg] of Object.entries(members)) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify(pkg));
  }
  return dir;
};

const runPlan = (dir) => {
  const res = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8', timeout: 20000 });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/**
 * A fake `npm`. `view` answers the version for every `name@version` in `taken`
 * and E404 for everything else, or, with `viewBreaks`, fails some other way so
 * the check stands down. `publish` succeeds unless its `--workspace=` names
 * `failPublish`. Every call is recorded.
 */
const makeNpmStub = ({ taken = [], viewBreaks = false, failPublish = null } = {}) => {
  const dir = mkTmp();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  stubTool(bin, 'npm', [
    '#!/usr/bin/env bash',
    recordArgv(path.join(dir, 'npm.log')),
    'if [ "$1" = view ]; then',
    ...(viewBreaks ? ['  echo "npm error code ETIMEDOUT" >&2', '  echo "npm error network timeout" >&2', '  exit 1'] : []),
    '  case "${@: -2:1}" in',
    ...taken.map((t) => `    '${t}') echo "${t.slice(t.lastIndexOf('@') + 1)}"; exit 0 ;;`),
    '  esac',
    '  echo "npm error code E404" >&2',
    '  exit 1',
    'fi',
    ...(failPublish ? [`case " $* " in *" --workspace=${failPublish} "*) echo "npm error code E403" >&2; exit 1 ;; esac`] : []),
    'exit 0',
  ]);
  return { binDir: bin, dir, calls: () => readArgv(path.join(dir, 'npm.log')) };
};

/** The script with the stub's npm first on PATH. */
const runWith = (dir, stub, args) => {
  const res = spawnSync('node', [SCRIPT, '--dir', dir, ...args], {
    env: { ...process.env, PATH: pathWith(stub.binDir) },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/** The registry question the run asks, argv for argv. */
const view = (spec) => ['view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', spec, 'version'];

// A public workspace: explicitly not private, and a `files` publish signal.
const pub = (name, version = '0.5.0', extra = {}) => ({ name, version, private: false, files: ['dist'], ...extra });

// The spec's fixture: a private root, three public workspaces pinned in a chain
// (c needs b, b needs a), one private workspace, one with no publish signal.
const SPEC_FIXTURE = () => mkRepo({
  root: { name: 'family', version: '0.5.0', private: true, workspaces: ['packages/*'] },
  members: {
    'packages/c': pub('@s/c', '0.5.0', { dependencies: { '@s/b': '0.5.0' } }),
    'packages/b': pub('@s/b', '0.5.0', { dependencies: { '@s/a': '0.5.0' } }),
    'packages/a': pub('@s/a'),
    'packages/secret': { name: '@s/secret', version: '0.5.0', private: true, files: ['dist'] },
    'packages/app': { name: '@s/app', version: '0.5.0', private: false },
  },
});

const run = async () => {
  group('publish-plan: which packages, in which order');

  await test("the spec's fixture publishes a, b, c in dependency order and names both skips", () => {
    const dir = SPEC_FIXTURE();
    const result = plan(dir);
    assertEq(result.publish.map((p) => p.name).join(','), '@s/a,@s/b,@s/c', 'dependencies publish first');
    assert(result.publish.every((p) => p.scoped), 'every @-name is scoped');
    const skips = result.skip.map((s) => `${s.name}:${s.reason}`).sort().join(',');
    assertEq(skips, '@s/app:no publish signal,@s/secret:private', 'the two skips and their reasons');
    cleanup(dir);
  });

  await test('the CLI prints the publish lines in order, then the skips, and exits 0', () => {
    const dir = SPEC_FIXTURE();
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 0, `a plan is exit 0, stderr: ${stderr}`);
    assertEq(stdout, [
      'publish @s/a 0.5.0 scoped',
      'publish @s/b 0.5.0 scoped',
      'publish @s/c 0.5.0 scoped',
      'skip @s/app 0.5.0 no publish signal',
      'skip @s/secret 0.5.0 private',
      '',
    ].join('\n'), 'the printed plan');
    assertEq(stderr, '', 'nothing on stderr');
    cleanup(dir);
  });

  await test('a workspace with no private key is skipped as private absent', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/loose': { name: 'loose', version: '1.0.0', files: ['dist'] } },
    });
    const { code, stdout } = runPlan(dir);
    assertEq(code, 0, 'a skip is not a refusal');
    assertEq(stdout, 'skip loose 1.0.0 private absent\n', 'the reason names the missing key');
    cleanup(dir);
  });

  await test('a devDependency and a peerDependency order the publish too', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { devDependencies: { b: '^1.0.0' } }),
        'packages/b': pub('b', '1.0.0', { peerDependencies: { c: '*' } }),
        'packages/c': pub('c', '1.0.0'),
      },
    });
    assertEq(plan(dir).publish.map((p) => p.name).join(','), 'c,b,a', 'every dependency field orders');
    cleanup(dir);
  });

  await test('independent candidates break their tie by name', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/z': pub('zeta', '1.0.0'),
        'packages/m': pub('alpha', '1.0.0'),
        'packages/q': pub('mid', '1.0.0', { dependencies: { zeta: '1.0.0' } }),
      },
    });
    assertEq(plan(dir).publish.map((p) => p.name).join(','), 'alpha,zeta,mid', 'name order among the ready');
    cleanup(dir);
  });

  await test('a single-package repo is its own one candidate', () => {
    const dir = mkRepo({ root: pub('widget', '2.1.0') });
    const { code, stdout } = runPlan(dir);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, 'publish widget 2.1.0 unscoped\n', 'the root publishes, unscoped');
    cleanup(dir);
  });

  await test('a literal member and a dir/* pattern in the same array are both read, the root never', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: false, files: ['x'], workspaces: ['tools/cli', 'packages/*'] },
      members: {
        'tools/cli': pub('cli', '1.0.0', { dependencies: { core: '1.0.0' } }),
        'packages/core': pub('core', '1.0.0'),
      },
    });
    const result = plan(dir);
    assertEq(result.publish.map((p) => p.name).join(','), 'core,cli', 'both members, in order');
    assertEq(result.skip.length, 0, 'the root is not a candidate, not even a skipped one');
    cleanup(dir);
  });

  await test('the object form of workspaces reads its packages', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: { packages: ['packages/*'] } },
      members: { 'packages/core': pub('core', '1.0.0') },
    });
    assertEq(plan(dir).publish.map((p) => p.name).join(','), 'core', 'the packages key');
    cleanup(dir);
  });

  await test('a dependency on a skipped member orders nothing, and a loop through one is no cycle', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { dependencies: { secret: '1.0.0', app: '1.0.0' } }),
        'packages/b': pub('b', '1.0.0'),
        'packages/secret': { name: 'secret', version: '1.0.0', private: true, dependencies: { a: '1.0.0' } },
        'packages/app': { name: 'app', version: '1.0.0', private: false },
      },
    });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 0, `a loop through a private member is not a cycle, stderr: ${stderr}`);
    assertEq(stdout, [
      'publish a 1.0.0 unscoped',
      'publish b 1.0.0 unscoped',
      'skip app 1.0.0 no publish signal',
      'skip secret 1.0.0 private',
      '',
    ].join('\n'), 'the skipped members order nothing: a and b fall back to name order');
    cleanup(dir);
  });

  group('publish-plan: refusals');

  await test('a candidate whose version is not semver refuses, naming the package', () => {
    const dir = mkRepo({ root: pub('widget', '1.0') });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 1, 'refused');
    assertEq(stdout, '', 'no plan printed');
    assertEq(stderr, 'publish-plan: widget has the version 1.0, which is not a semver version.\n', 'the line names the package');
    cleanup(dir);
  });

  await test('a root package.json that is not a JSON object refuses, never a stack trace', () => {
    for (const [what, repo] of [
      ['a null root', () => {
        const dir = mkRepo({ root: pub('widget', '1.0.0') });
        fs.writeFileSync(path.join(dir, 'package.json'), 'null');
        return dir;
      }],
      ['an array root', () => {
        const dir = mkRepo({ root: pub('widget', '1.0.0') });
        fs.writeFileSync(path.join(dir, 'package.json'), '[]');
        return dir;
      }],
    ]) {
      const dir = repo();
      const { code, stdout, stderr } = runPlan(dir);
      assertEq(code, 1, `${what} is refused, stderr: ${stderr}`);
      assertEq(stdout, '', `${what}: no plan printed`);
      assert(/^publish-plan: .*\n$/.test(stderr), `${what}: one publish-plan line, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a cycle refuses with the cycle spelled, and nothing on stdout', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { dependencies: { b: '1.0.0' } }),
        'packages/b': pub('b', '1.0.0', { dependencies: { a: '1.0.0' } }),
      },
    });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 1, 'a cycle has no order');
    assertEq(stdout, '', 'no plan printed');
    assert(stderr.startsWith('publish-plan: '), `speaks as itself, got: ${stderr}`);
    assert(stderr.includes('a -> b -> a'), `spells the cycle, got: ${stderr}`);
    cleanup(dir);
  });

  await test('an unexpanded pattern refuses, naming the pattern', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/**'] },
      members: { 'packages/deep/core': pub('core', '1.0.0') },
    });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 1, 'a plan that leaves packages out is refused');
    assertEq(stdout, '', 'no plan printed');
    assert(stderr.includes('packages/**'), `names the pattern, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a dir/* pattern that matches no package says so on stderr, and the plan stands', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packges/*', 'packages/*'] },
      members: { 'packages/a': pub('a', '1.0.0') },
    });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 0, 'a pattern matching nothing is not a refusal');
    assertEq(stdout, 'publish a 1.0.0 unscoped\n', 'the members that were found are still planned');
    assert(stderr.includes('packges/*'), `names the pattern, got: ${stderr}`);
    assertEq(plan(dir).notes.length, 1, 'the module returns the note too');
    cleanup(dir);
  });

  await test('a literal member with no package.json refuses, naming it', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/gone'] },
    });
    const { code, stdout, stderr } = runPlan(dir);
    assertEq(code, 1, 'refused');
    assertEq(stdout, '', 'no plan printed');
    assert(stderr.includes('packages/gone'), `names the member, got: ${stderr}`);
    cleanup(dir);
  });

  group('publish-plan --run');

  // Every case here puts a fake `npm` in front of the script under test, which
  // spawns it directly: no stub is startable that way on Windows
  // (tests/lib/platform.js, `stubTool`), so each case would ask the machine's
  // own npm instead of the one it wrote, and publish for real.
  const runTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

  await runTest('publishes in plan order, asking the registry first, with --workspace and --access public only when scoped', () => {
    const dir = mkRepo({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/ui': pub('@s/ui', '1.0.0', { dependencies: { core: '1.0.0' } }),
        'packages/core': pub('core', '1.0.0'),
      },
    });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 0, `a clean run is exit 0, stderr: ${stderr}`);
    assertEq(stdout, [
      'publish core 1.0.0 unscoped',
      'publish @s/ui 1.0.0 scoped',
      'published core 1.0.0',
      'published @s/ui 1.0.0',
      '',
    ].join('\n'), 'the plan, then one line per package published');
    const want = [
      view('core@1.0.0'),
      ['publish', '--workspace=core'],
      view('@s/ui@1.0.0'),
      ['publish', '--workspace=@s/ui', '--access', 'public'],
    ];
    assertEq(fmtCalls(stub.calls()), fmtCalls(want), 'every npm call, in order');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('a single root package gets a plain npm publish', () => {
    const dir = mkRepo({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 0, `exit 0, stderr: ${stderr}`);
    assertEq(stdout, 'publish widget 2.1.0 unscoped\npublished widget 2.1.0\n', 'the plan and the publish');
    assertEq(fmtCalls(stub.calls()), fmtCalls([view('widget@2.1.0'), ['publish']]), 'no --workspace at a root with no workspaces');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('a package already on npm is skipped and the rest publish', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ taken: ['@s/a@0.5.0'] });
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 0, `a skip is not a failure, stderr: ${stderr}`);
    assert(stdout.endsWith([
      'skipped @s/a 0.5.0 already on npm',
      'published @s/b 0.5.0',
      'published @s/c 0.5.0',
      '',
    ].join('\n')), `the skip, then the publishes, got: ${stdout}`);
    const published = stub.calls().filter((c) => c[0] === 'publish').map((c) => c[1]);
    assertEq(published.join(','), '--workspace=@s/b,--workspace=@s/c', 'the taken one is never published');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('every package already on npm is one line and exit 0', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ taken: ['@s/a@0.5.0', '@s/b@0.5.0', '@s/c@0.5.0'] });
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 0, `nothing to do is not a failure, stderr: ${stderr}`);
    assert(stdout.endsWith([
      'skipped @s/c 0.5.0 already on npm',
      'nothing to publish: every package is already on npm at its version',
      '',
    ].join('\n')), `the closing line, got: ${stdout}`);
    assertEq(stub.calls().filter((c) => c[0] === 'publish').length, 0, 'nothing published');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('a failed publish stops the run, names what was and was not done, and exits 1', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ failPublish: '@s/b' });
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 1, 'a failed publish is exit 1');
    assert(stdout.endsWith('published @s/a 0.5.0\n'), `only a published, got: ${stdout}`);
    assert(stderr.includes('npm error code E403\n'), `npm's own output reaches the terminal, got: ${stderr}`);
    assert(stderr.endsWith('publish-plan: npm publish failed for @s/b@0.5.0 (exit 1); 1 published, 1 not attempted: @s/c.\n'),
      `the stop line, got: ${stderr}`);
    assert(!stub.calls().some((c) => c.some((arg) => arg.includes('@s/c'))), `c is never asked about, got: ${fmtCalls(stub.calls())}`);
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('a registry check that cannot be made says so and still publishes', () => {
    const dir = mkRepo({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub({ viewBreaks: true });
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 0, `a stand-down is not a failure, stderr: ${stderr}`);
    assertEq(stderr, 'publish-plan: the npm check stood down for widget@2.1.0: npm error code ETIMEDOUT; publishing anyway, npm refuses a taken version.\n',
      'the stand-down line, first stderr line only');
    assert(stdout.endsWith('published widget 2.1.0\n'), `the publish went ahead, got: ${stdout}`);
    assertEq(fmtCalls(stub.calls()), fmtCalls([view('widget@2.1.0'), ['publish']]), 'asked, then published');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('a refused plan publishes nothing', () => {
    const dir = mkRepo({ root: pub('widget', '1.0') });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runWith(dir, stub, ['--run']);
    assertEq(code, 1, 'refused');
    assertEq(stdout, '', 'no plan printed');
    assertEq(stderr, 'publish-plan: widget has the version 1.0, which is not a semver version.\n', 'the refusal, alone');
    assertEq(stub.calls().length, 0, 'npm never spawned');
    cleanup(dir);
    cleanup(stub.dir);
  });

  await runTest('without --run the plan prints and no npm is spawned', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub();
    const { code, stdout } = runWith(dir, stub, []);
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('published'), `only the plan, got: ${stdout}`);
    assertEq(stub.calls().length, 0, 'npm never spawned');
    cleanup(dir);
    cleanup(stub.dir);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
