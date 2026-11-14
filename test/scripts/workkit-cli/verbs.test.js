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
  describe, test, expect, mkTmp,
} = require('../../lib/harness');
const {
  NODE_DIR, skipWithoutNodeStub, joinPath, shellPath,
} = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const {
  makeNpmStub, pub, mkPackages,
} = require('../../lib/publish-world');
const { cleanup, mkWorld, runCli, mkRepo } = require('./helpers');

// Each verb and every subcommand it runs.
const VERBS = {
  ship: ['items', 'release', 'watch', 'plan', 'publish', 'cut', 'deploy'],
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

describe('workkit ship', () => {
  test('ship items hands its arguments to the script: an unknown one is its usage refusal, exit 2', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['ship', 'items', '--nope']);
    expect(code, `exit 2, got: ${out}${err}`).toBe(2);
    expect(err.startsWith('ship-items: '), `the script's own line, got: ${err}`).toBeTruthy();
    expect(world.ghCalls().length, `gh never asked, got: ${fmtCalls(world.ghCalls())}`).toBe(0);
    cleanup(world.root);
  });

  test('ship release hands its version to the script: a version that is not semver is refused, exit 1', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-release-', {
      'package.json': '{ "name": "scratch", "version": "1.2.3" }\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n### Added\n- [#1](../../issues/1) - A thing.\n',
    });
    const before = fs.readFileSync(path.join(g.repo, 'package.json'), 'utf8');
    const { code, out, err } = runCli(world, ['ship', 'release', '1.3', '--dir', g.repo], { cwd: g.repo, env: withNode(world) });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(lines(err).length, `one line, got: ${err}`).toBe(1);
    expect(err.startsWith('release: ') && err.includes('not a semver version'), `the refusal names why, got: ${err}`).toBeTruthy();
    expect(fs.readFileSync(path.join(g.repo, 'package.json'), 'utf8'), 'package.json untouched').toBe(before);
    cleanup(g.dir);
    cleanup(world.root);
  });

  test('ship watch hands its sha to the script: one that is no sha is usage, exit 2, gh never asked', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['ship', 'watch', 'main']);
    expect(code, `exit 2, got: ${out}${err}`).toBe(2);
    expect(/usage: .*<sha>/.test(err), `the script's usage, got: ${err}`).toBeTruthy();
    expect(world.ghCalls().length, `gh never asked, got: ${fmtCalls(world.ghCalls())}`).toBe(0);
    cleanup(world.root);
  });

  // The publish cases put a fake `npm` ahead of node's own; written before the
  // stub launcher, they still skip on Windows.
  test('ship plan prints the plan in order and publishes nothing', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld();
    const dir = chain();
    const npm = makeNpmStub();
    const { code, out, err } = runCli(world, ['ship', 'plan', '--dir', dir], { cwd: dir, env: withNode(world, npm.binDir) });
    expect(code, `exit 0, stderr: ${err}`).toBe(0);
    expect(out, 'the plan, and nothing after it').toBe(CHAIN_PLAN);
    expect(npm.calls().length, `npm never spawned, got: ${fmtCalls(npm.calls())}`).toBe(0);
    cleanup(npm.dir);
    cleanup(dir);
    cleanup(world.root);
  });

  // What the publish does is publish-plan.test.js's; here, that its exit code
  // and its lines are the command's.
  test('ship publish hands its run to the script: its published line and its exit 1', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld();
    const dir = chain();
    const npm = makeNpmStub({ failPublish: '@s/b' });
    const { code, out, err } = runCli(world, ['ship', 'publish', '--dir', dir], { cwd: dir, env: withNode(world, npm.binDir) });
    expect(code, `a failed publish is exit 1, got: ${out}${err}`).toBe(1);
    expect(out.endsWith('published @s/a 1.0.0\n'), `the published line, got: ${out}`).toBeTruthy();
    cleanup(npm.dir);
    cleanup(dir);
    cleanup(world.root);
  });

  test('ship cut hands its version to the script: a version that is no x.y.z is usage, exit 2, gh never asked', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-cut-', { 'CHANGELOG.md': '# Changelog\n\n## [1.2.3] - 2026-11-01\n\n### Added\n\n- A thing.\n' });
    const { code, out, err } = runCli(world, ['ship', 'cut', '1.2'], { cwd: g.repo, env: withNode(world) });
    expect(code, `exit 2, got: ${out}${err}`).toBe(2);
    expect(/usage/i.test(err), `the script's usage, got: ${err}`).toBeTruthy();
    expect(world.ghCalls().length, `gh never asked, got: ${fmtCalls(world.ghCalls())}`).toBe(0);
    cleanup(g.dir);
    cleanup(world.root);
  });

  test('ship deploy hands its run to the script: a repo with no deploy or release script is its line, exit 0', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-deploy-', { 'package.json': '{ "name": "scratch", "scripts": { "test": "true" } }\n' });
    const { code, out, err } = runCli(world, ['ship', 'deploy'], { cwd: g.repo, env: withNode(world) });
    expect(code, `exit 0, got: ${out}${err}`).toBe(0);
    expect(lines(err).includes('ship-deploy: no deploy or release script'), `the script's own line, got: ${err}`).toBeTruthy();
    cleanup(g.dir);
    cleanup(world.root);
  });
});

describe('workkit review', () => {
  test('review covers is stale before review mark full and covered after it', () => {
    const world = mkWorld();
    const g = mkGitRepo('wk-review-', { 'src/x.js': "module.exports = 'x';\n" }, PAST);
    // A new size: git's stat check would read the same size at the same date as clean.
    g.write('src/x.js', "module.exports = 'changed';\n", PAST);
    const before = runCli(world, ['review', 'covers'], { cwd: g.repo });
    expect(before.code, `stale is exit 1, got: ${before.said}`).toBe(1);
    expect(before.out, 'no marker yet').toBe('review-covers: stale: no full-panel marker\n');
    const mark = runCli(world, ['review', 'mark', 'full'], { cwd: g.repo });
    expect(mark.code, `the marker is written, got: ${mark.said}`).toBe(0);
    const after = runCli(world, ['review', 'covers'], { cwd: g.repo });
    expect(after.code, `covered is exit 0, got: ${after.said}`).toBe(0);
    expect(after.out, 'the full marker covers the diff').toBe('review-covers: covered\n');
    cleanup(g.dir);
    cleanup(world.root);
  });
});

describe('workkit proof', () => {
  test('proof red hands its arguments to the script: outside a git repo it is not runnable, exit 2', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['proof', 'red', 'src/x.js', '--', 'true']);
    expect(code, `exit 2, got: ${out}${err}`).toBe(2);
    expect(out, 'no verdict').toBe('');
    expect(lines(err).length, `one line, got: ${err}`).toBe(1);
    expect(err.startsWith('red-proof: '), `the script's own line, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit changelog', () => {
  test('changelog lint hands the file and its flags to the linter', () => {
    const world = mkWorld();
    const file = path.join(world.root, 'CHANGELOG.md');
    fs.writeFileSync(file, [
      '# Changelog', '', '## [Unreleased]', '', '### Added', '', '- [#4](https://github.com/o/r/issues/4) - A short entry.', '',
      '## [1.0.0] - 2026-01-01', '', '### Added', '', '- A released entry with no issue link.', '',
    ].join('\n'));
    const whole = runCli(world, ['changelog', 'lint', file], { env: withNode(world) });
    expect(whole.code, `the released entry violates, got: ${whole.said}`).toBe(1);
    expect(/line \d+ \[issue-link\]/.test(whole.said), `names the line and the rule, got: ${whole.said}`).toBeTruthy();
    const unreleased = runCli(world, ['changelog', 'lint', file, '--unreleased-only'], { env: withNode(world) });
    expect(unreleased.code, `--unreleased-only reached the linter, got: ${unreleased.said}`).toBe(0);
    expect(unreleased.said.trim(), 'and a clean answer says nothing').toBe('');
    cleanup(world.root);
  });
});

describe('workkit state', () => {
  test('state names a repo\'s participation, the current folder by default', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const named = runCli(world, ['state', shellPath(repo)]);
    expect(named.code, `exit 0, got: ${named.said}`).toBe(0);
    expect(named.out, 'an opted-in repo').toBe('enabled\n');
    const here = runCli(world, ['state'], { cwd: mkTmp('workkit-cli-') });
    expect(here.out, `a folder outside every repo, got: ${here.said}`).toBe('nogit\n');
    cleanup(repo);
    cleanup(world.root);
  });
});

describe('workkit: a verb\'s subcommands', () => {
  for (const [verb, subs] of Object.entries(VERBS)) {
    test(`${verb} with an unknown or no subcommand is one line naming ${subs.join(', ')}, exit 1`, () => {
      const world = mkWorld();
      for (const args of [[verb, 'dance'], [verb]]) {
        const { code, out, err } = runCli(world, args);
        expect(code, `exit 1 for [${args}], got: ${out}${err}`).toBe(1);
        expect(out, `nothing on stdout for [${args}]`).toBe('');
        expect(lines(err).length, `one line for [${args}], got: ${err}`).toBe(1);
        const missing = subs.filter((sub) => !new RegExp(`\\b${sub}\\b`).test(err));
        expect(missing.join(', '), `the subcommands the line leaves out for [${args}], got: ${err}`).toBe('');
      }
      cleanup(world.root);
    });
  }
});
