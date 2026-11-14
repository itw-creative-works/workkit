//
// Tests for tower/api/lib/telemetry.js: subagent attribution (the class via the parent
// tool_use or the sidecar, byClass, working and done). Prologue: ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const {
  resetCache, className, cleanup, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

describe('tower/telemetry: subagent attribution', () => {
  test('a subagent is attributed to its class through the parent tool_use', () => {
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
    expect(session.subagents.length, 'one subagent').toBe(1);
    expect(session.subagents[0].id, 'named by its file').toBe('agent-aaa');
    expect(session.subagents[0].class, 'the namespace is stripped').toBe('worker');
    expect(session.subagents[0].tokens.total, 'with its own tokens').toBe(240);
    expect(session.tokens.total, 'and the parent keeps only its own').toBe(30);
    cleanup(w.root);
  });

  test('the sidecar answers when the parent line is gone, and neither reads unknown', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'bbb', {
      lines: [assistantLine({ id: 's', input: 10 })],
      meta: { agentType: 'workkit:scout', toolUseId: 'toolu_compacted_away' },
    });
    mkSubagent(transcript, 'ccc', { lines: [assistantLine({ id: 't', input: 10 })], meta: null });
    const classes = Object.fromEntries(collect(w).sessions[0].subagents.map((s) => [s.id, s.class]));
    expect(classes['agent-bbb'], 'the meta carries the same value').toBe('scout');
    expect(classes['agent-ccc'], 'and nothing at all is never a guess').toBe('unknown');
    expect(className('general-purpose'), 'an unnamespaced type passes through').toBe('general-purpose');
    cleanup(w.root);
  });

  test('byClass credits the root session to manager and each subagent to its class', () => {
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
    expect(byClass.manager, 'the session drives, so it is the manager').toBe(1000);
    expect(byClass.worker, 'the worker').toBe(500);
    expect(byClass.scout, 'the scout').toBe(100);
    cleanup(w.root);
  });

  test('a subagent is working while its transcript is fresh and done once it goes quiet', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const at = (minutesAgo) => new Date(now - minutesAgo * 60 * 1000).toISOString();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1, timestamp: at(1) })] });
    mkSubagent(transcript, 'fresh', { lines: [assistantLine({ id: 'f', input: 10, timestamp: at(2) })], meta: {} });
    mkSubagent(transcript, 'quiet', { lines: [assistantLine({ id: 'q', input: 10, timestamp: at(180) })], meta: {} });
    mkSubagent(transcript, 'silent', { lines: [], meta: {} });

    const states = Object.fromEntries(collect(w, { now }).sessions[0].subagents.map((s) => [s.id, s.state]));
    expect(states['agent-fresh'], 'two minutes quiet is still working').toBe('working');
    expect(states['agent-quiet'], 'three hours quiet is finished').toBe('done');
    expect(states['agent-silent'], 'one that never spoke is not live crew').toBe('done');
    cleanup(w.root);
  });

  test('the subagent window is the SAME one sessions.js reads, override and all', () => {
    const w = mkWorld();
    const now = Date.parse('2026-07-27T12:00:00.000Z');
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'root', input: 1 })] });
    mkSubagent(transcript, 'edge', {
      lines: [assistantLine({ id: 'e', input: 10, timestamp: new Date(now - 60 * 60 * 1000).toISOString() })],
      meta: {},
    });
    // An hour quiet: outside the 45-minute default, inside a widened window.
    expect(collect(w, { now }).sessions[0].subagents[0].state, 'the default window closed on it').toBe('done');
    resetCache();
    expect(collect(w, { now, idleMinutes: 120 }).sessions[0].subagents[0].state, 'the override moves both tiers').toBe('working');
    cleanup(w.root);
  });
});
