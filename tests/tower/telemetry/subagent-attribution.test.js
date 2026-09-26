//
// Tests for tower/api/lib/telemetry.js: subagent attribution (the class
// through the parent tool_use or the sidecar, byClass, and the working and
// done states).
// The shared prologue (the transcript line builders, the scratch world and its sessions, the collect call, the module under test) is ./helpers.js.
//

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  resetCache, className, cleanup, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

const run = async () => {
  group('tower/telemetry: subagent attribution');

  await test('a subagent is attributed to its class through the parent tool_use', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 'spawn', toolUseId: 'toolu_1', subagentType: 'workkit:worker' }),
        assistantLine({ id: 'root', input: 30 }),
      ],
    });
    mkSubagent(transcript, 'aaa', {
      lines: [assistantLine({ id: 's1', input: 200, output: 40 })],
      meta: { agentType: 'workkit:worker', toolUseId: 'toolu_1', spawnDepth: 1 },
    });
    const [session] = collect(w).sessions;
    assertEq(session.subagents.length, 1, 'one subagent');
    assertEq(session.subagents[0].id, 'agent-aaa', 'named by its file');
    assertEq(session.subagents[0].class, 'worker', 'the namespace is stripped');
    assertEq(session.subagents[0].tokens.total, 240, 'with its own tokens');
    assertEq(session.tokens.total, 30, 'and the parent keeps only its own');
    cleanup(w.root);
  });

  await test('the sidecar answers when the parent line is gone, and neither reads unknown', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'bbb', {
      lines: [assistantLine({ id: 's', input: 10 })],
      meta: { agentType: 'workkit:scout', toolUseId: 'toolu_compacted_away' },
    });
    mkSubagent(transcript, 'ccc', { lines: [assistantLine({ id: 't', input: 10 })], meta: null });
    const classes = Object.fromEntries(collect(w).sessions[0].subagents.map((s) => [s.id, s.class]));
    assertEq(classes['agent-bbb'], 'scout', 'the meta carries the same value');
    assertEq(classes['agent-ccc'], 'unknown', 'and nothing at all is never a guess');
    assertEq(className('general-purpose'), 'general-purpose', 'an unnamespaced type passes through');
    cleanup(w.root);
  });

  await test('byClass credits the root session to manager and each subagent to its class', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's1', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        spawnLine({ id: 's2', toolUseId: 'toolu_s', subagentType: 'workkit:scout' }),
        assistantLine({ id: 'root', input: 1000 }),
      ],
    });
    mkSubagent(transcript, 'w1', { lines: [assistantLine({ id: 'a', input: 500 })], meta: { toolUseId: 'toolu_w' } });
    mkSubagent(transcript, 's1', { lines: [assistantLine({ id: 'b', input: 100 })], meta: { toolUseId: 'toolu_s' } });
    const { byClass } = collect(w);
    assertEq(byClass.manager, 1000, 'the session drives, so it is the manager');
    assertEq(byClass.worker, 500, 'the worker');
    assertEq(byClass.scout, 100, 'the scout');
    cleanup(w.root);
  });

  await test('a subagent is working while its transcript is fresh and done once it goes quiet', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const at = (minutesAgo) => new Date(now - minutesAgo * 60 * 1000).toISOString();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1, timestamp: at(1) })] });
    mkSubagent(transcript, 'fresh', { lines: [assistantLine({ id: 'f', input: 10, timestamp: at(2) })], meta: {} });
    mkSubagent(transcript, 'quiet', { lines: [assistantLine({ id: 'q', input: 10, timestamp: at(180) })], meta: {} });
    mkSubagent(transcript, 'silent', { lines: [], meta: {} });

    const states = Object.fromEntries(collect(w, { now }).sessions[0].subagents.map((s) => [s.id, s.state]));
    assertEq(states['agent-fresh'], 'working', 'two minutes quiet is still working');
    assertEq(states['agent-quiet'], 'done', 'three hours quiet is finished');
    assertEq(states['agent-silent'], 'done', 'one that never spoke is not live crew');
    cleanup(w.root);
  });

  await test('the subagent window is the SAME one sessions.js reads, override and all', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'edge', {
      lines: [assistantLine({ id: 'e', input: 10, timestamp: new Date(now - 60 * 60 * 1000).toISOString() })],
      meta: {},
    });
    // An hour quiet: outside the 45-minute default, inside a widened window.
    assertEq(collect(w, { now }).sessions[0].subagents[0].state, 'done', 'the default window closed on it');
    resetCache();
    assertEq(collect(w, { now, idleMinutes: 120 }).sessions[0].subagents[0].state, 'working', 'the override moves both tiers');
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
