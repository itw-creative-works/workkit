//
// Tests for workflow/publish-plan.js: the ship's publish step reads the plan it
// prints, so the plan is the whole question here. Which packages publish, in
// which order, which are skipped and why, and every refusal that stops the step
// before a single package reaches npm.
//
// Each case builds a fixture repo in a tmp dir: a root package.json and its
// workspace members.
// Nothing is stubbed, because nothing here reaches anything: the script reads
// files and prints.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');

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
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
