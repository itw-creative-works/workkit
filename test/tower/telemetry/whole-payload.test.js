//
// Tests for tower/api/lib/telemetry.js: the whole payload (byModel, the thirty-day
// series, a session row, the one-session read). Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  sessionTelemetry, dayKey, OVERTIME_DAYS, cleanup, PRICED, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

describe('tower/telemetry: the whole payload', () => {
  test('byModel counts tokens per model across the session and its subagents', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'r', model: PRICED, input: 100 })] });
    mkSubagent(transcript, 'x', {
      lines: [assistantLine({ id: 'a', model: 'claude-haiku-4-5', input: 20 })],
      meta: { agentType: 'workkit:scout' },
    });
    const { byModel } = collect(w);
    expect(byModel[PRICED], 'the parent model').toBe(100);
    expect(byModel['claude-haiku-4-5'], 'and the subagent model').toBe(20);
    cleanup(w.root);
  });

  test('overTime is 30 days ending today, quiet days present with zero', () => {
    const w = mkWorld();
    const now = Date.now();
    const today = dayKey(new Date(now));
    const threeAgo = dayKey(new Date(now - 3 * 24 * 60 * 60 * 1000));
    const longAgo = dayKey(new Date(now - 200 * 24 * 60 * 60 * 1000));
    mkSession(w, {
      lines: [
        assistantLine({ id: 'a', input: 10, timestamp: new Date(now).toISOString() }),
        assistantLine({ id: 'b', input: 5, timestamp: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }),
        assistantLine({ id: 'c', input: 999, timestamp: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString() }),
      ],
    });
    const { overTime } = collect(w, { now });
    expect(overTime.length, 'thirty entries').toBe(OVERTIME_DAYS);
    expect(overTime[overTime.length - 1].label, 'ending today').toBe(today);
    const byLabel = Object.fromEntries(overTime.map((d) => [d.label, d.tokens]));
    expect(byLabel[today], "today's tokens").toBe(10);
    expect(byLabel[threeAgo], 'three days back').toBe(5);
    expect(byLabel[longAgo], 'and nothing older than the window').toBe(undefined);
    expect(overTime.filter((d) => d.tokens === 0).length, 'every quiet day is present at zero').toBe(OVERTIME_DAYS - 2);
    cleanup(w.root);
  });

  test('a session row carries the marker facts, the statusline pair and its span', () => {
    const w = mkWorld();
    fs.writeFileSync(path.join(w.stateDir, 'sess_1.json'), JSON.stringify({
      model: { id: 'claude-opus-4-1' },
      effort: { level: 'high' },
    }));
    mkSession(w, {
      lines: [
        JSON.stringify({ type: 'summary', customTitle: 'The tower build' }),
        assistantLine({ id: 'a', input: 10, timestamp: '2026-07-27T09:00:00.000Z' }),
        assistantLine({ id: 'b', input: 10, timestamp: '2026-07-27T11:00:00.000Z' }),
      ],
    });
    const [session] = collect(w).sessions;
    expect(session.id, 'the session id').toBe('sess-1');
    expect(session.cwd, 'its cwd').toBe('/x/fixture');
    expect(session.chatName, 'its name').toBe('The tower build');
    expect(session.state, 'a live assertion and a fresh transcript').toBe('working');
    expect(session.model, 'model from the statusline cache').toBe('claude-opus-4-1');
    expect(session.effort, 'and effort with it').toBe('high');
    expect(session.startedAt, 'the first stamp').toBe('2026-07-27T09:00:00.000Z');
    expect(session.lastAt, 'and the last').toBe('2026-07-27T11:00:00.000Z');
    expect(session.cost > 0, 'a priced model reports a cost').toBeTruthy();
    cleanup(w.root);
  });

  test('a row says what it last reached for, where its transcript is, and the file times', () => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        assistantLine({
          id: 'r',
          input: 5,
          timestamp: '2026-07-27T12:30:00.000Z',
          content: [{ type: 'tool_use', id: 'toolu_r', name: 'Read', input: { file_path: '/x/a.js' } }],
        }),
      ],
    });
    const sub = mkSubagent(transcript, 'k1', {
      lines: [assistantLine({
        id: 'w1',
        input: 3,
        timestamp: '2026-07-27T12:31:00.000Z',
        content: [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: {} }],
      })],
      meta: { toolUseId: 'toolu_w' },
    });
    const [session] = collect(w).sessions;
    expect(session.lastTool, 'the last tool_use in the parent transcript, not the first').toBe('Read');
    expect(session.lastToolAt, 'stamped when the line was written').toBe('2026-07-27T12:30:00.000Z');
    expect(session.transcript, 'the file every one of these was read from').toBe(transcript);
    expect(typeof session.lastActivity === 'number', 'listSessions\' mtime probe travels').toBeTruthy();
    expect(typeof session.aliveSince === 'number', 'and its birth time').toBeTruthy();
    const [agent] = session.subagents;
    expect(agent.lastTool, 'a subagent says its own last tool').toBe('Edit');
    expect(agent.lastToolAt, 'with its own stamp').toBe('2026-07-27T12:31:00.000Z');
    expect(agent.transcript, 'and carries its own transcript path').toBe(sub);
    cleanup(w.root);
  });

  test('a transcript that has called no tool says so with a null, never a guess', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 1 })] });
    const [session] = collect(w).sessions;
    expect(session.lastTool, 'nothing was called').toBe(null);
    expect(session.lastToolAt, 'so there is no when either').toBe(null);
    cleanup(w.root);
  });

  test('with no statusline cache the model comes from the transcript instead', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', model: 'claude-sonnet-4-5', input: 1 })] });
    expect(collect(w).sessions[0].model, 'a VS Code session still names one').toBe('claude-sonnet-4-5');
    cleanup(w.root);
  });

  test('no markers at all is an empty payload, still the right shape', () => {
    const w = mkWorld();
    const payload = collect(w);
    expect(payload.sessions.length, 'nobody running').toBe(0);
    expect(Object.keys(payload.byModel).length, 'no models').toBe(0);
    expect(payload.overTime.length, 'the series is always thirty long').toBe(OVERTIME_DAYS);
    cleanup(w.root);
  });

  test('sessionTelemetry finds one by id and answers null for anything else', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 42 })] });
    const opts = { home: w.home, markerDir: w.markerDir, stateDir: w.stateDir, exec: w.exec };
    expect(sessionTelemetry('sess-1', opts).tokens.total, 'the drill-down').toBe(42);
    expect(sessionTelemetry('sess-nope', opts), 'and nothing invented').toBe(null);
    cleanup(w.root);
  });
});
