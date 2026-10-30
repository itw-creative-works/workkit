// Tests for workflow/workkit.sh's script verbs: `workkit <verb> <sub>` runs
// workflow/<verb>/<sub>.sh or .js with the arguments it was given, and its
// output and exit code are the script's; a verb's unknown or missing
// subcommand is one line naming the subcommands, exit 1. What each script
// does is its own suite's; `review mark` and `triage mark` run through the
// skills' own lines (test/hooks/commit-gate/marker.test.js,
// test/hooks/capture-guard/user-level.test.js).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun, mkTmp,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, NO_NODE_STUB, joinPath, shellPath,
} = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const {
  makeNpmStub, pub, mkPackages,
} = require('../../lib/publish-world');
const { cleanup, mkWorld, runCli, mkRepo } = require('./helpers');

// Each verb and every subcommand it runs.
const VERBS = {
  ship: ['items', 'release', 'watch', 'plan', 'publish'],
  review: ['covers', 'mark'],
  triage: ['mark'],
  proof: ['red'],
  changelog: ['lint'],
};

// An hour back: a file dated here predates any marker written during the case.
const PAST = new Date(Date.now() - 3600 * 1000);

const lines = (text) => text.split('\n').filter(Boolean);

// The world's PATH with node on it, and `first` ahead of everything.
const withNode = (world, ...first) => ({ PATH: joinPath(...first, NODE_DIR, world.env.PATH) });

// A chain the plan orders c after b after a, whatever order the folders list in.
const chain = () => mkPackages({
  root: { name: 'family', version: '1.0.0', private: true, workspaces: ['packages/*'] },
  members: {
    'packages/c': pub('@s/c', '1.0.0', { dependencies: { '@s/b': '1.0.0' } }),
    'packages/b': pub('@s/b', '1.0.0', { dependencies: { '@s/a': '1.0.0' } }),
    'packages/a': pub('@s/a', '1.0.0'),
  },
});
const CHAIN_PLAN = 'publish @s/a 1.0.0 scoped\npublish @s/b 1.0.0 scoped\npublish @s/c 1.0.0 scoped\n';

// The publish cases put a fake `npm` ahead of node's own; node cannot start
// that stub by name on Windows and would reach the real npm instead.
const npmTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

const cases = async () => {
  group('workkit ship');

  await test('ship items hands its arguments to the script: an unknown one is its usage refusal, exit 2', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['ship', 'items', '--nope']);
    assertEq(code, 2, `exit 2, got: ${out}${err}`);
    assert(err.startsWith('ship-items: '), `the script's own line, got: ${err}`);
    assertEq(world.ghCalls().length, 0, `gh never asked, got: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('ship release hands its version to the script: a version that is not semver is refused, exit 1', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-release-', {
      'package.json': '{ "name": "scratch", "version": "1.2.3" }\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n### Added\n- [#1](../../issues/1) - A thing.\n',
    });
    const before = fs.readFileSync(path.join(g.repo, 'package.json'), 'utf8');
    const { code, out, err } = runCli(world, ['ship', 'release', '1.3', '--dir', g.repo], { cwd: g.repo, env: withNode(world) });
    assertEq(code, 1, `exit 1, got: ${out}${err}`);
    assertEq(out, '', 'nothing on stdout');
    assertEq(lines(err).length, 1, `one line, got: ${err}`);
    assert(err.startsWith('release: ') && err.includes('not a semver version'), `the refusal names why, got: ${err}`);
    assertEq(fs.readFileSync(path.join(g.repo, 'package.json'), 'utf8'), before, 'package.json untouched');
    cleanup(g.dir);
    cleanup(world.root);
  });

  await test('ship watch hands its sha to the script: one that is no sha is usage, exit 2, gh never asked', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['ship', 'watch', 'main']);
    assertEq(code, 2, `exit 2, got: ${out}${err}`);
    assert(/usage: .*<sha>/.test(err), `the script's usage, got: ${err}`);
    assertEq(world.ghCalls().length, 0, `gh never asked, got: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await npmTest('ship plan prints the plan in order and publishes nothing', () => {
    const world = mkWorld();
    const dir = chain();
    const npm = makeNpmStub();
    const { code, out, err } = runCli(world, ['ship', 'plan', '--dir', dir], { cwd: dir, env: withNode(world, npm.binDir) });
    assertEq(code, 0, `exit 0, stderr: ${err}`);
    assertEq(out, CHAIN_PLAN, 'the plan, and nothing after it');
    assertEq(npm.calls().length, 0, `npm never spawned, got: ${fmtCalls(npm.calls())}`);
    cleanup(npm.dir);
    cleanup(dir);
    cleanup(world.root);
  });

  // What the publish does is publish-plan.test.js's; here, that its exit code
  // and its lines are the command's.
  await npmTest('ship publish hands its run to the script: its published line and its exit 1', () => {
    const world = mkWorld();
    const dir = chain();
    const npm = makeNpmStub({ failPublish: '@s/b' });
    const { code, out, err } = runCli(world, ['ship', 'publish', '--dir', dir], { cwd: dir, env: withNode(world, npm.binDir) });
    assertEq(code, 1, `a failed publish is exit 1, got: ${out}${err}`);
    assert(out.endsWith('published @s/a 1.0.0\n'), `the published line, got: ${out}`);
    cleanup(npm.dir);
    cleanup(dir);
    cleanup(world.root);
  });

  group('workkit review');

  await test('review covers is stale before review mark full and covered after it', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-review-', { 'src/x.js': "module.exports = 'x';\n" }, PAST);
    // A new size: git's stat check would read the same size at the same date as clean.
    g.write('src/x.js', "module.exports = 'changed';\n", PAST);
    const before = runCli(world, ['review', 'covers'], { cwd: g.repo });
    assertEq(before.code, 1, `stale is exit 1, got: ${before.said}`);
    assertEq(before.out, 'review-covers: stale: no full-panel marker\n', 'no marker yet');
    const mark = runCli(world, ['review', 'mark', 'full'], { cwd: g.repo });
    assertEq(mark.code, 0, `the marker is written, got: ${mark.said}`);
    const after = runCli(world, ['review', 'covers'], { cwd: g.repo });
    assertEq(after.code, 0, `covered is exit 0, got: ${after.said}`);
    assertEq(after.out, 'review-covers: covered\n', 'the full marker covers the diff');
    cleanup(g.dir);
    cleanup(world.root);
  });

  group('workkit proof');

  await test('proof red hands its arguments to the script: outside a git repo it is not runnable, exit 2', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['proof', 'red', 'src/x.js', '--', 'true']);
    assertEq(code, 2, `exit 2, got: ${out}${err}`);
    assertEq(out, '', 'no verdict');
    assertEq(lines(err).length, 1, `one line, got: ${err}`);
    assert(err.startsWith('red-proof: '), `the script's own line, got: ${err}`);
    cleanup(world.root);
  });

  group('workkit changelog');

  await test('changelog lint hands the file and its flags to the linter', () => {
    const world = mkWorld();
    const file = path.join(world.root, 'CHANGELOG.md');
    fs.writeFileSync(file, [
      '# Changelog', '', '## [Unreleased]', '', '### Added', '', '- [#4](https://github.com/o/r/issues/4) - A short entry.', '',
      '## [1.0.0] - 2026-01-01', '', '### Added', '', '- A released entry with no issue link.', '',
    ].join('\n'));
    const whole = runCli(world, ['changelog', 'lint', file], { env: withNode(world) });
    assertEq(whole.code, 1, `the released entry violates, got: ${whole.said}`);
    assert(/line \d+ \[issue-link\]/.test(whole.said), `names the line and the rule, got: ${whole.said}`);
    const unreleased = runCli(world, ['changelog', 'lint', file, '--unreleased-only'], { env: withNode(world) });
    assertEq(unreleased.code, 0, `--unreleased-only reached the linter, got: ${unreleased.said}`);
    assertEq(unreleased.said.trim(), '', 'and a clean answer says nothing');
    cleanup(world.root);
  });

  group('workkit state');

  await test('state names a repo\'s participation, the current folder by default', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const named = runCli(world, ['state', shellPath(repo)]);
    assertEq(named.code, 0, `exit 0, got: ${named.said}`);
    assertEq(named.out, 'enabled\n', 'an opted-in repo');
    const here = runCli(world, ['state'], { cwd: mkTmp('workkit-cli-') });
    assertEq(here.out, 'nogit\n', `a folder outside every repo, got: ${here.said}`);
    cleanup(repo);
    cleanup(world.root);
  });

  group('workkit: a verb\'s subcommands');

  for (const [verb, subs] of Object.entries(VERBS)) {
    await test(`${verb} with an unknown or no subcommand is one line naming ${subs.join(', ')}, exit 1`, () => {
      const world = mkWorld();
      for (const args of [[verb, 'dance'], [verb]]) {
        const { code, out, err } = runCli(world, args);
        assertEq(code, 1, `exit 1 for [${args}], got: ${out}${err}`);
        assertEq(out, '', `nothing on stdout for [${args}]`);
        assertEq(lines(err).length, 1, `one line for [${args}], got: ${err}`);
        const missing = subs.filter((sub) => !new RegExp(`\\b${sub}\\b`).test(err));
        assertEq(missing.join(', '), '', `the subcommands the line leaves out for [${args}], got: ${err}`);
      }
      cleanup(world.root);
    });
  }

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
