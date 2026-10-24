// Tests for safety:commit-gate's first commit, commitGateGuard over a real
// scratch repo with no HEAD (test/lib/real-gate.js): the gate stands down with
// one line, and once that commit exists the next code commit is judged again.
// A repo with a HEAD is every other suite beside this one.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { gateOn } = require('../../lib/real-gate');
const { PREFIX, T, NOTICE, pkg } = require('./helpers');

// A fresh repo before its first commit: the opt-in, a root test script and a
// code file staged, no HEAD, no review marker and no suite record.
const mkUnbornRepo = () => {
  const world = mkGitRepo('cg-first-', { 'package.json': pkg('1.0.0'), 'app.js': 'const x = 1;\n' });
  world.git('update-ref', '-d', 'HEAD');
  return world;
};

const commitOn = (world) => gateOn(world.repo, 'git commit -m "feat: first"', world.env);

const run = async () => {
  group('commit-gate: a repo with no HEAD');

  await test('staged code, no review marker, no suite record, no HEAD: the stand-down line, never a deny', async () => {
    const world = mkUnbornRepo();
    const out = await commitOn(world);
    assertEq(out.deny, null, 'the first commit is never blocked');
    assertEq(out.context, NOTICE.firstCommit, 'it passes saying the gate stood down');
  });

  await test('after that first commit, the next code commit is judged again: the review is asked for', async () => {
    const world = mkUnbornRepo();
    world.git('commit', '-q', '-m', 'feat: first');
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const out = await commitOn(world);
    assertEq(out.deny, `${PREFIX}${T.noReview}`, 'a repo with a HEAD gets the full gate');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
