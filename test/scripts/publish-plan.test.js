// Tests for workflow/ship/plan.js (`workkit ship plan`) and workflow/ship/publish.js
// (`workkit ship publish`): the ship's publish step reads the plan it prints, so the
// plan is the whole question here. Each case builds a fixture repo; the plan cases
// stub nothing, and the publish cases put a fake `npm` first on PATH and read back
// every argv it was handed and the folder it ran in. Both speak as `publish-plan:`.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, SPAWN_DEADLINE, WORKKIT_DIR,
} = require('../lib/harness');
const { gitPath, pathWith } = require('../lib/platform');
const { fmtCalls } = require('../lib/argv-log');
const { enabledWith } = require('../lib/ship-world');
const { homeOf, runFolders } = require('../lib/workflow-home');
const {
  mkPackages, mkPackagesRepo, makeNpmStub, view, pub, SPEC, SPEC_FIXTURE,
} = require('../lib/publish-world');

const SHIP = path.join(__dirname, '..', '..', 'workflow', 'ship');
const PLAN = path.join(SHIP, 'plan.js');
const PUBLISH = path.join(SHIP, 'publish.js');
const { plan } = require(PLAN);

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * The package repo `spec` committed, enabled and declaring one afterPublish
 * hook, by default one that marks ran.txt in the folder it runs in; `ran()`
 * reads the repo root's mark, null when it never ran there.
 */
const withAfterPublish = (spec, command = 'echo hook >> ran.txt') => {
  const w = mkPackagesRepo(spec, { [`${WORKKIT_DIR}/settings.json`]: enabledWith({ afterPublish: [command] }) });
  const mark = path.join(w.repo, 'ran.txt');
  return { w, ran: () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : null) };
};

const runPlan = (dir, ...extra) => {
  const res = spawnSync('node', [PLAN, '--dir', dir, ...extra], { encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/** The publish with the stub's npm first on PATH, under `env` (a git world's own scratch home). */
const runPublish = (dir, stub, env = process.env) => {
  const res = spawnSync('node', [PUBLISH, '--dir', dir], {
    env: { ...env, PATH: pathWith(stub.binDir) },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/** The line a publish from a copy prints first, for `n` changed paths and the world's HEAD. */
const differs = (w, n) => `publish-plan: the folder differs from HEAD (${n} ${n === 1 ? 'path' : 'paths'}), so this publishes from a copy of ${w.git('rev-parse', 'HEAD').trim().slice(0, 7)}.\n`;

/** The stub's `npm publish` runs, each with the folder it ran in and the text it read there. */
const publishes = (stub) => stub.runs().filter((r) => r.argv[0] === 'publish');

/** That the copy a run used is gone: its folder, its run folder and git's worktree entry. */
const assertCopyGone = (w, copyDir, label) => {
  expect(fs.existsSync(copyDir), `${label}: the copy's folder ${copyDir} is gone`).toBe(false);
  expect(runFolders(homeOf(w)).join(', '), `${label}: proof/ holds no run folder`).toBe('');
  const listed = w.git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  expect(listed.length, `${label}: git lists only the repo, got: ${listed.join(', ')}`).toBe(1);
};

/** A committed one-package repo whose index.js says `committed`. */
const widgetRepo = (extra = {}) => mkPackagesRepo({ root: pub('widget', '2.1.0') }, { 'index.js': 'committed\n', ...extra });

describe('ship plan: which packages, in which order', () => {
  test('the CLI prints the publish lines in order, then the skips, and exits 0', () => {
    const dir = SPEC_FIXTURE();
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, `a plan is exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout, 'the printed plan').toBe([
      'publish @s/a 0.5.0 scoped',
      'publish @s/b 0.5.0 scoped',
      'publish @s/c 0.5.0 scoped',
      'skip @s/app 0.5.0 no publish signal',
      'skip @s/secret 0.5.0 private',
      '',
    ].join('\n'));
    expect(stderr, 'nothing on stderr').toBe('');
    cleanup(dir);
  });

  test('a workspace with no private key is skipped as private absent', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/loose': { name: 'loose', version: '1.0.0', files: ['dist'] } },
    });
    const { code, stdout } = runPlan(dir);
    expect(code, 'a skip is not a refusal').toBe(0);
    expect(stdout, 'the reason names the missing key').toBe('skip loose 1.0.0 private absent\n');
    cleanup(dir);
  });

  test('a devDependency, a peerDependency and an optionalDependency order the publish too', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { devDependencies: { b: '^1.0.0' } }),
        'packages/b': pub('b', '1.0.0', { peerDependencies: { c: '*' } }),
        'packages/c': pub('c', '1.0.0', { optionalDependencies: { d: '*' } }),
        'packages/d': pub('d', '1.0.0'),
      },
    });
    // By name alone c would go before d; the optional dependency puts d first.
    expect(plan(dir).publish.map((p) => p.name).join(','), 'every dependency field orders').toBe('d,c,b,a');
    cleanup(dir);
  });

  test('independent candidates break their tie by name', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/z': pub('zeta', '1.0.0'),
        'packages/m': pub('alpha', '1.0.0'),
        'packages/q': pub('mid', '1.0.0', { dependencies: { zeta: '1.0.0' } }),
      },
    });
    expect(plan(dir).publish.map((p) => p.name).join(','), 'name order among the ready').toBe('alpha,zeta,mid');
    cleanup(dir);
  });

  test('a single-package repo is its own one candidate', () => {
    const dir = mkPackages({ root: pub('widget', '2.1.0') });
    const { code, stdout } = runPlan(dir);
    expect(code, 'exit 0').toBe(0);
    expect(stdout, 'the root publishes, unscoped').toBe('publish widget 2.1.0 unscoped\n');
    cleanup(dir);
  });

  test('a literal member and a dir/* pattern in the same array are both read, the root never', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: false, files: ['x'], workspaces: ['tools/cli', 'packages/*'] },
      members: {
        'tools/cli': pub('cli', '1.0.0', { dependencies: { core: '1.0.0' } }),
        'packages/core': pub('core', '1.0.0'),
      },
    });
    const result = plan(dir);
    expect(result.publish.map((p) => p.name).join(','), 'both members, in order').toBe('core,cli');
    expect(result.skip.length, 'the root is not a candidate, not even a skipped one').toBe(0);
    cleanup(dir);
  });

  test('the object form of workspaces reads its packages', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: { packages: ['packages/*'] } },
      members: { 'packages/core': pub('core', '1.0.0') },
    });
    expect(plan(dir).publish.map((p) => p.name).join(','), 'the packages key').toBe('core');
    cleanup(dir);
  });

  // The kit read as it stands: its one member publishes at the plugin's version.
  test('on the kit itself: publish workkit-core at the kit\'s version, unscoped, and never the root', () => {
    const kit = path.join(__dirname, '..', '..');
    const { version } = JSON.parse(fs.readFileSync(path.join(kit, '.claude-plugin', 'plugin.json'), 'utf8'));
    const { code, stdout, stderr } = runPlan(kit);
    expect(code, `a plan is exit 0, stderr: ${stderr}`).toBe(0);
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines.filter((l) => l.startsWith('publish ')).join('\n'), `the one publish line, got: ${stdout}`).toBe(`publish workkit-core ${version} unscoped`);
    expect(!lines.some((l) => l.split(' ')[1] === 'workkit'), `the root is in no line, got: ${stdout}`).toBeTruthy();
  });

  test('a dependency on a skipped member orders nothing, and a loop through one is no cycle', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { dependencies: { secret: '1.0.0', app: '1.0.0' } }),
        'packages/b': pub('b', '1.0.0'),
        'packages/secret': { name: 'secret', version: '1.0.0', private: true, dependencies: { a: '1.0.0' } },
        'packages/app': { name: 'app', version: '1.0.0', private: false },
      },
    });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, `a loop through a private member is not a cycle, stderr: ${stderr}`).toBe(0);
    expect(stdout, 'the skipped members order nothing: a and b fall back to name order').toBe([
      'publish a 1.0.0 unscoped',
      'publish b 1.0.0 unscoped',
      'skip app 1.0.0 no publish signal',
      'skip secret 1.0.0 private',
      '',
    ].join('\n'));
    cleanup(dir);
  });
});

describe('ship plan: refusals', () => {
  test('an argument the plan does not take, such as --run, is refused with exit 2, naming it', () => {
    const dir = mkPackages({ root: pub('widget', '1.0.0') });
    const { code, stdout, stderr } = runPlan(dir, '--run');
    expect(code, `refused as usage, stderr: ${stderr}`).toBe(2);
    expect(stdout, 'no plan printed').toBe('');
    expect(/^publish-plan: .*--run.*\n$/.test(stderr), `one publish-plan line naming --run, got: ${stderr}`).toBeTruthy();
    cleanup(dir);
  });

  test('a candidate whose version is not semver refuses, naming the package', () => {
    const dir = mkPackages({ root: pub('widget', '1.0') });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, 'refused').toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr, 'the line names the package').toBe('publish-plan: widget has the version 1.0, which is not a semver version.\n');
    cleanup(dir);
  });

  test('a root package.json that is not a JSON object refuses, never a stack trace', () => {
    for (const [what, repo] of [
      ['a null root', () => {
        const dir = mkPackages({ root: pub('widget', '1.0.0') });
        fs.writeFileSync(path.join(dir, 'package.json'), 'null');
        return dir;
      }],
      ['an array root', () => {
        const dir = mkPackages({ root: pub('widget', '1.0.0') });
        fs.writeFileSync(path.join(dir, 'package.json'), '[]');
        return dir;
      }],
    ]) {
      const dir = repo();
      const { code, stdout, stderr } = runPlan(dir);
      expect(code, `${what} is refused, stderr: ${stderr}`).toBe(1);
      expect(stdout, `${what}: no plan printed`).toBe('');
      expect(/^publish-plan: .*\n$/.test(stderr), `${what}: one publish-plan line, got: ${stderr}`).toBeTruthy();
      cleanup(dir);
    }
  });

  test('a cycle refuses with the cycle spelled, and nothing on stdout', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/a': pub('a', '1.0.0', { dependencies: { b: '1.0.0' } }),
        'packages/b': pub('b', '1.0.0', { dependencies: { a: '1.0.0' } }),
      },
    });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, 'a cycle has no order').toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr.startsWith('publish-plan: '), `speaks as itself, got: ${stderr}`).toBeTruthy();
    expect(stderr.includes('a -> b -> a'), `spells the cycle, got: ${stderr}`).toBeTruthy();
    cleanup(dir);
  });

  test('an unexpanded pattern refuses, naming the pattern', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/**'] },
      members: { 'packages/deep/core': pub('core', '1.0.0') },
    });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, 'a plan that leaves packages out is refused').toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr.includes('packages/**'), `names the pattern, got: ${stderr}`).toBeTruthy();
    cleanup(dir);
  });

  test('a dir/* pattern that matches no package says so on stderr, and the plan stands', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packges/*', 'packages/*'] },
      members: { 'packages/a': pub('a', '1.0.0') },
    });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, 'a pattern matching nothing is not a refusal').toBe(0);
    expect(stdout, 'the members that were found are still planned').toBe('publish a 1.0.0 unscoped\n');
    expect(stderr.includes('packges/*'), `names the pattern, got: ${stderr}`).toBeTruthy();
    expect(plan(dir).notes.length, 'the module returns the note too').toBe(1);
    cleanup(dir);
  });

  test('a literal member with no package.json refuses, naming it', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/gone'] },
    });
    const { code, stdout, stderr } = runPlan(dir);
    expect(code, 'refused').toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr.includes('packages/gone'), `names the member, got: ${stderr}`).toBeTruthy();
    cleanup(dir);
  });
});

describe('ship publish', () => {
  test('publishes in plan order, asking the registry first, with --workspace and --access public only when scoped', () => {
    const dir = mkPackages({
      root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/ui': pub('@s/ui', '1.0.0', { dependencies: { core: '1.0.0' } }),
        'packages/core': pub('core', '1.0.0'),
      },
    });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, `a clean run is exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout, 'the plan, then one line per package published').toBe([
      'publish core 1.0.0 unscoped',
      'publish @s/ui 1.0.0 scoped',
      'published core 1.0.0',
      'published @s/ui 1.0.0',
      '',
    ].join('\n'));
    const want = [
      view('core@1.0.0'),
      ['publish', '--workspace=core'],
      view('@s/ui@1.0.0'),
      ['publish', '--workspace=@s/ui', '--access', 'public'],
    ];
    expect(fmtCalls(stub.calls()), 'every npm call, in order').toBe(fmtCalls(want));
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('a single root package gets a plain npm publish', () => {
    const dir = mkPackages({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout, 'the plan and the publish').toBe('publish widget 2.1.0 unscoped\npublished widget 2.1.0\n');
    expect(fmtCalls(stub.calls()), 'no --workspace at a root with no workspaces').toBe(fmtCalls([view('widget@2.1.0'), ['publish']]));
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('a package already on npm is skipped and the rest publish', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ taken: ['@s/a@0.5.0'] });
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, `a skip is not a failure, stderr: ${stderr}`).toBe(0);
    expect(stdout.endsWith([
      'skipped @s/a 0.5.0 already on npm',
      'published @s/b 0.5.0',
      'published @s/c 0.5.0',
      '',
    ].join('\n')), `the skip, then the publishes, got: ${stdout}`).toBeTruthy();
    const published = stub.calls().filter((c) => c[0] === 'publish').map((c) => c[1]);
    expect(published.join(','), 'the taken one is never published').toBe('--workspace=@s/b,--workspace=@s/c');
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('every package already on npm is one line and exit 0', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ taken: ['@s/a@0.5.0', '@s/b@0.5.0', '@s/c@0.5.0'] });
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, `nothing to do is not a failure, stderr: ${stderr}`).toBe(0);
    expect(stdout.endsWith([
      'skipped @s/c 0.5.0 already on npm',
      'nothing to publish: every package is already on npm at its version',
      '',
    ].join('\n')), `the closing line, got: ${stdout}`).toBeTruthy();
    expect(stub.calls().filter((c) => c[0] === 'publish').length, 'nothing published').toBe(0);
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('a failed publish stops the run, names what was and was not done, and exits 1', () => {
    const dir = SPEC_FIXTURE();
    const stub = makeNpmStub({ failPublish: '@s/b' });
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, 'a failed publish is exit 1').toBe(1);
    expect(stdout.endsWith('published @s/a 0.5.0\n'), `only a published, got: ${stdout}`).toBeTruthy();
    expect(stderr.includes('npm error code E403\n'), `npm's own output reaches the terminal, got: ${stderr}`).toBeTruthy();
    expect(stderr.endsWith('publish-plan: npm publish failed for @s/b@0.5.0 (npm exited 1); 1 published, 1 not attempted: @s/c.\n'),
      `the stop line, got: ${stderr}`).toBeTruthy();
    expect(!stub.calls().some((c) => c.some((arg) => arg.includes('@s/c'))), `c is never asked about, got: ${fmtCalls(stub.calls())}`).toBeTruthy();
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('a registry check that cannot be made says so and still publishes', () => {
    const dir = mkPackages({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub({ viewBreaks: true });
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, `a stand-down is not a failure, stderr: ${stderr}`).toBe(0);
    expect(stderr, 'the stand-down line, first stderr line only').toBe('publish-plan: the npm check stood down for widget@2.1.0: npm error code ETIMEDOUT; publishing anyway, npm refuses a taken version.\n');
    expect(stdout.endsWith('published widget 2.1.0\n'), `the publish went ahead, got: ${stdout}`).toBeTruthy();
    expect(fmtCalls(stub.calls()), 'asked, then published').toBe(fmtCalls([view('widget@2.1.0'), ['publish']]));
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('a refused plan publishes nothing', () => {
    const dir = mkPackages({ root: pub('widget', '1.0') });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(dir, stub);
    expect(code, 'refused').toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr, 'the refusal, alone').toBe('publish-plan: widget has the version 1.0, which is not a semver version.\n');
    expect(stub.calls().length, 'npm never spawned').toBe(0);
    cleanup(dir);
    cleanup(stub.dir);
  });
});

describe('ship publish: the afterPublish hooks', () => {
  test('a run that publishes a package runs the afterPublish hooks, exit 0', () => {
    const { w, ran } = withAfterPublish({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout.includes('published widget 2.1.0\n'), `the publish ran, got: ${stdout}`).toBeTruthy();
    expect(ran(), 'the hook ran once').toBe('hook\n');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a run from a workspace member folder runs the afterPublish hooks the repo root declares', () => {
    const { w, ran } = withAfterPublish({
      root: { name: 'family', version: '2.1.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/widget': pub('widget', '2.1.0') },
    });
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(path.join(w.repo, 'packages', 'widget'), stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout.includes('published widget 2.1.0\n'), `the member published, got: ${stdout}`).toBeTruthy();
    expect(ran(), 'the root hook ran once').toBe('hook\n');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a run that publishes a package and then fails an afterPublish hook names the count and exits 1', () => {
    const { w } = withAfterPublish({ root: pub('widget', '2.1.0') }, 'exit 4');
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 1, stderr: ${stderr}`).toBe(1);
    expect(stdout.includes('published widget 2.1.0\n'), `the publish ran, got: ${stdout}`).toBeTruthy();
    expect(stderr.endsWith('publish-plan: 1 published; an afterPublish hook failed.\n'), `the published-but line, got: ${stderr}`).toBeTruthy();
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a run that publishes nothing, or fails, runs no afterPublish hook', () => {
    const runs = {
      'every package already on npm': [0, { taken: ['@s/a@0.5.0', '@s/b@0.5.0', '@s/c@0.5.0'] }],
      'a publish failing after one published': [1, { failPublish: '@s/b' }],
    };
    for (const [name, [exit, opts]] of Object.entries(runs)) {
      const { w, ran } = withAfterPublish(SPEC);
      const stub = makeNpmStub(opts);
      const { code, stderr } = runPublish(w.repo, stub, w.env);
      expect(code, `${name}: the run's own exit, stderr: ${stderr}`).toBe(exit);
      expect(ran(), `${name}: no hook ran, stderr: ${stderr}`).toBe(null);
      cleanup(w.dir);
      cleanup(stub.dir);
    }
  });

  test('a publish from a copy runs the afterPublish hooks in the real repo root, never the copy', () => {
    const { w, ran } = withAfterPublish({ root: pub('widget', '2.1.0') });
    w.write('index.js', 'held\n');
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stderr.startsWith(differs(w, 1)), `the publish used a copy, got: ${stderr}`).toBeTruthy();
    expect(stdout.includes('published widget 2.1.0\n'), `the publish ran, got: ${stdout}`).toBeTruthy();
    expect(ran(), `the hook marked the repo root, stderr: ${stderr}`).toBe('hook\n');
    cleanup(w.dir);
    cleanup(stub.dir);
  });
});

describe('ship publish: what HEAD holds, never the folder', () => {
  test('a folder equal to HEAD publishes in place, with no copy line', () => {
    const w = widgetRepo();
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stdout, 'the plan and the publish').toBe('publish widget 2.1.0 unscoped\npublished widget 2.1.0\n');
    expect(stderr.includes('differs from HEAD'), `no copy line, got: ${stderr}`).toBe(false);
    expect(publishes(stub).map((r) => r.cwd).join(', '), 'npm published from the repo itself').toBe(w.repo);
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a root in no git repo publishes in place, with no copy line', () => {
    const dir = mkPackages({ root: pub('widget', '2.1.0') });
    const stub = makeNpmStub();
    const { code, stderr } = runPublish(dir, stub);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stderr.includes('differs from HEAD'), `no copy line, got: ${stderr}`).toBe(false);
    expect(publishes(stub).map((r) => r.cwd).join(', '), 'npm published from the folder itself').toBe(dir);
    cleanup(dir);
    cleanup(stub.dir);
  });

  test('held work publishes from a copy of HEAD: an unstaged edit, a staged one, an untracked file', () => {
    const holds = {
      'an unstaged edit': (w) => w.write('index.js', 'held\n'),
      'a staged edit': (w) => {
        w.write('index.js', 'held\n');
        w.git('add', 'index.js');
      },
      'an untracked file': (w) => w.write('extra.js', 'held\n'),
    };
    for (const [label, hold] of Object.entries(holds)) {
      const w = widgetRepo();
      hold(w);
      const stub = makeNpmStub({ read: ['index.js', 'extra.js'] });
      const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
      expect(code, `${label}: exit 0, stderr: ${stderr}`).toBe(0);
      expect(stderr.startsWith(differs(w, 1)), `${label}: the copy line first, got: ${stderr}`).toBeTruthy();
      expect(stdout, `${label}: the plan and the publish`).toBe('publish widget 2.1.0 unscoped\npublished widget 2.1.0\n');
      const [run] = publishes(stub);
      expect(run.cwd !== w.repo, `${label}: npm published from another folder, got: ${run.cwd}`).toBeTruthy();
      expect(stub.runs().every((r) => r.cwd === run.cwd), `${label}: the npm check ran in the copy too, got: ${JSON.stringify(stub.runs())}`).toBeTruthy();
      expect(JSON.stringify(run.text), `${label}: the copy holds the committed text and no untracked file`).toBe(JSON.stringify({ 'index.js': 'committed\n', 'extra.js': null }));
      assertCopyGone(w, run.cwd, label);
      cleanup(w.dir);
      cleanup(stub.dir);
    }
  });

  test('a gitignored build output is in the copy, filled from the folder', () => {
    const w = widgetRepo({ '.gitignore': 'dist/\n' });
    w.write('dist/out.js', 'built\n');
    w.write('index.js', 'held\n');
    const stub = makeNpmStub({ read: ['dist/out.js', 'index.js'] });
    const { code, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stderr.startsWith(differs(w, 1)), `the copy line counts the edit, never the ignored file, got: ${stderr}`).toBeTruthy();
    const [run] = publishes(stub);
    expect(JSON.stringify(run.text), 'the build output beside the committed text').toBe(JSON.stringify({ 'dist/out.js': 'built\n', 'index.js': 'committed\n' }));
    assertCopyGone(w, run.cwd, 'ignored');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a --dir member of a repo that differs publishes from the same member inside the copy', () => {
    const w = mkPackagesRepo({
      root: { name: 'family', version: '2.1.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/widget': pub('widget', '2.1.0') },
    }, { 'packages/widget/index.js': 'committed\n' });
    w.write('packages/widget/index.js', 'held\n');
    w.write('notes.txt', 'held\n');
    const stub = makeNpmStub({ read: ['index.js'] });
    const { code, stderr } = runPublish(path.join(w.repo, 'packages', 'widget'), stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    expect(stderr.startsWith(differs(w, 2)), `the copy line counts the whole repo, got: ${stderr}`).toBeTruthy();
    const [run] = publishes(stub);
    expect(run.cwd.endsWith(path.join('copy', 'packages', 'widget')), `npm ran in the copy's member, got: ${run.cwd}`).toBeTruthy();
    expect(run.text['index.js'], 'the member\'s committed text').toBe('committed\n');
    assertCopyGone(w, path.dirname(path.dirname(run.cwd)), 'member');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a workspaces repo that differs runs each npm publish --workspace in the copy\'s root', () => {
    const w = mkPackagesRepo(SPEC);
    w.write('notes.txt', 'held\n');
    const stub = makeNpmStub();
    const { code, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, `exit 0, stderr: ${stderr}`).toBe(0);
    const runs = publishes(stub);
    expect(runs.map((r) => r.argv.join(' ')).join(', '), 'every member, in plan order').toBe('publish --workspace=@s/a --access public, publish --workspace=@s/b --access public, publish --workspace=@s/c --access public');
    expect(path.basename(runs[0].cwd), `the copy's root, got: ${runs[0].cwd}`).toBe('copy');
    expect(runs.every((r) => r.cwd === runs[0].cwd), `every publish in one folder, got: ${runs.map((r) => r.cwd).join(', ')}`).toBeTruthy();
    assertCopyGone(w, runs[0].cwd, 'workspaces');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('npm failing in the copy is today\'s failure line, exit 1, and the copy is removed', () => {
    const w = mkPackagesRepo(SPEC);
    w.write('notes.txt', 'held\n');
    const stub = makeNpmStub({ failPublish: '@s/b' });
    const { code, stderr } = runPublish(w.repo, stub, w.env);
    expect(code, 'a failed publish is exit 1').toBe(1);
    expect(stderr.endsWith('publish-plan: npm publish failed for @s/b@0.5.0 (npm exited 1); 1 published, 1 not attempted: @s/c.\n'), `the stop line, got: ${stderr}`).toBeTruthy();
    assertCopyGone(w, publishes(stub)[0].cwd, 'failed');
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a copy that cannot be made refuses, exit 1, and npm never runs', () => {
    const w = widgetRepo();
    w.write('index.js', 'held\n');
    // A file where the cache folder goes: no run folder can be made under it.
    fs.writeFileSync(path.join(homeOf(w), '.cache'), '');
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    const sha7 = w.git('rev-parse', 'HEAD').trim().slice(0, 7);
    expect(code, `refused, stderr: ${stderr}`).toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr, 'the refusal, alone').toBe(`publish-plan: could not make a copy of ${sha7} to publish from (could not make a run folder under ${gitPath(homeOf(w))}/.cache/workkit/proof); nothing was published.\n`);
    expect(stub.calls().length, `npm never spawned, got: ${fmtCalls(stub.calls())}`).toBe(0);
    cleanup(w.dir);
    cleanup(stub.dir);
  });

  test('a file only the folder\'s uncommitted .gitignore ignores refuses the copy, exit 1, and npm never runs', () => {
    const w = widgetRepo({ '.gitignore': 'dist/\n' });
    w.write('.gitignore', 'dist/\nheld.txt\n');
    w.write('held.txt', 'held\n');
    const stub = makeNpmStub();
    const { code, stdout, stderr } = runPublish(w.repo, stub, w.env);
    const sha7 = w.git('rev-parse', 'HEAD').trim().slice(0, 7);
    expect(code, `refused, stderr: ${stderr}`).toBe(1);
    expect(stdout, 'no plan printed').toBe('');
    expect(stderr, 'the refusal, alone').toBe(`publish-plan: could not make a copy of ${sha7} to publish from (the copy holds a file HEAD's ignore rules do not ignore); nothing was published.\n`);
    expect(stub.calls().length, `npm never spawned, got: ${fmtCalls(stub.calls())}`).toBe(0);
    expect(runFolders(homeOf(w)).join(', '), 'proof/ holds no run folder').toBe('');
    const listed = w.git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
    expect(listed.length, `git lists only the repo, got: ${listed.join(', ')}`).toBe(1);
    cleanup(w.dir);
    cleanup(stub.dir);
  });
});
