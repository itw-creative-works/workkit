// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in hooks/mods/commit-gate.js:
// a repo with no origin remote is a throwaway (a fixture, a scratch repo), outside the
// pipeline, so the gate stands aside there.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, summary, selfRun } = require('../../lib/harness');
const {
  mkRepo, stage, staleMarker, judge, passes,
} = require('./helpers');

// A throwaway repo: the fixture repo with its origin taken away.
const mkThrowawayRepo = () => mkRepo({ origin: null });

const cases = async () => {
  group('commit-gate: a repo with no origin');

  await test('no origin, staged code, no review marker: exit 0 and silent', async () => {
    const r = mkThrowawayRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'pub 1'), '', 'a throwaway repo is not held to the gate');
  });

  await test('no origin, staged code, stale review marker: exit 0 and silent', async () => {
    const r = mkThrowawayRepo();
    staleMarker(r);
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'pub 1'), '', 'a bad marker in a throwaway repo is not judged');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
