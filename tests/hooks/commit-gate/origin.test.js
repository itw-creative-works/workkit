// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: a repo with no origin remote is a throwaway (a
// fixture, a scratch repo), outside the pipeline, so the gate stands aside
// there; the cd and -C blocks hold in every repo. Each case ports the HEAD
// case its name quotes; "no cwd" is a fact with an empty cwd now.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, summary, selfRun } = require('../../lib/harness');
const {
  T, mkRepo, stage, write, staleMarker, judge, blocks, passes,
} = require('./helpers');

// A throwaway repo: the fixture repo with its origin taken away.
const mkThrowawayRepo = () => mkRepo({ origin: null });

const run = async () => {
  group('commit-gate: a repo with no origin');

  await test('ports "no origin, staged code, no review marker: exit 0 and silent"', async () => {
    const r = mkThrowawayRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'git commit -m "pub 1"'), '', 'a throwaway repo is not held to the gate');
  });

  await test('ports "no origin, staged code, stale review marker: exit 0 and silent"', async () => {
    const r = mkThrowawayRepo();
    staleMarker(r);
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'git commit -m "pub 1"'), '', 'a bad marker in a throwaway repo is not judged');
  });

  await test('ports "with an origin, staged code, no review marker: exit 2 as today"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "pub 1"'), T.noReview, 'a project repo still needs its review');
  });

  group('commit-gate: stage and commit in one call');

  await test('ports "no origin, git add -A && git commit: exit 0 and silent"', async () => {
    const r = mkThrowawayRepo();
    write(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'git add -A && git commit -m "pub 1"'), '', 'a throwaway repo may stage and commit at once');
  });

  await test('ports "with an origin, git add -A && git commit: exit 2 naming the stage-first rule"', async () => {
    const r = mkRepo();
    write(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git add -A && git commit -m "pub 1"'), T.stage, 'a project repo still stages first');
  });

  group('commit-gate: cd and -C still block in a repo with no origin');

  await test('ports "cd x && git commit: exit 2"', async () => {
    blocks(await judge(mkThrowawayRepo(), 'cd pub-src && git commit -qm "pub 1"'), T.cd, 'a directory change before a commit still fails closed');
  });

  await test('ports "git -C x commit: exit 2"', async () => {
    blocks(await judge(mkThrowawayRepo(), 'git -C pub-src commit -qm "pub 1"'), T.dashC, 'a commit aimed elsewhere still fails closed');
  });

  group('commit-gate: no cwd in the payload');

  await test('ports "no cwd: exit 0, even run from a project repo with unreviewed code"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'git commit -m "pub 1"', { cwd: '' }), '', 'no cwd fails open');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
