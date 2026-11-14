// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in hooks/mods/commit-gate.js:
// a repo with no origin remote is a throwaway (a fixture, a scratch repo), outside the
// pipeline, so the gate stands aside there.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { describe, test } = require('../../lib/harness');
const {
  mkRepo, stage, staleMarker, judge, passes,
} = require('./helpers');

// A throwaway repo: the fixture repo with its origin taken away.
const mkThrowawayRepo = () => mkRepo({ origin: null });

describe('commit-gate: a repo with no origin', () => {
  test('no origin, staged code, no review marker: exit 0 and silent', async () => {
    const r = mkThrowawayRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'pub 1'), '', 'a throwaway repo is not held to the gate');
  });

  test('no origin, staged code, stale review marker: exit 0 and silent', async () => {
    const r = mkThrowawayRepo();
    staleMarker(r);
    stage(r, 'app.js', 'const x = 1;\n');
    passes(await judge(r, 'pub 1'), '', 'a bad marker in a throwaway repo is not judged');
  });
});
