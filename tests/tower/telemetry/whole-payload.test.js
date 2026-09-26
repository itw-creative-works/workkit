//
// Tests for tower/api/lib/telemetry.js: the whole payload (byModel, the
// thirty-day series, what a session row carries, and the one-session read).
// The shared prologue (the transcript line builders, the scratch world and its sessions, the collect call, the module under test) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  sessionTelemetry, dayKey, OVERTIME_DAYS, cleanup, PRICED, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, collect,
} = require('./helpers');

const run = async () => {
  group('tower/telemetry: the whole payload');

  await test('byModel counts tokens per model across the session and its subagents', () => {
    const w = mkWorld();
    const transcript = mkSession(w, { lines: [assistantLine({ id: 'r', model: PRICED, input: 100 })] });
    mkSubagent(transcript, 'x', {
      lines: [assistantLine({ id: 'a', model: 'claude-haiku-4-5', input: 20 })],
      meta: { agentType: 'workkit:scout' },
    });
    const { byModel } = collect(w);
    assertEq(byModel[PRICED], 100, 'the parent model');
    assertEq(byModel['claude-haiku-4-5'], 20, 'and the subagent model');
    cleanup(w.root);
  });

  await test('overTime is 30 days ending today, quiet days present with zero', () => {
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
    assertEq(overTime.length, OVERTIME_DAYS, 'thirty entries');
    assertEq(overTime[overTime.length - 1].label, today, 'ending today');
    const byLabel = Object.fromEntries(overTime.map((d) => [d.label, d.tokens]));
    assertEq(byLabel[today], 10, "today's tokens");
    assertEq(byLabel[threeAgo], 5, 'three days back');
    assertEq(byLabel[longAgo], undefined, 'and nothing older than the window');
    assertEq(overTime.filter((d) => d.tokens === 0).length, OVERTIME_DAYS - 2, 'every quiet day is present at zero');
    cleanup(w.root);
  });

  await test('a session row carries the marker facts, the statusline pair and its span', () => {
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
    assertEq(session.id, 'sess-1', 'the session id');
    assertEq(session.cwd, '/x/fixture', 'its cwd');
    assertEq(session.chatName, 'The tower build', 'its name');
    assertEq(session.state, 'working', 'a live assertion and a fresh transcript');
    assertEq(session.model, 'claude-opus-4-1', 'model from the statusline cache');
    assertEq(session.effort, 'high', 'and effort with it');
    assertEq(session.startedAt, '2026-07-27T09:00:00.000Z', 'the first stamp');
    assertEq(session.lastAt, '2026-07-27T11:00:00.000Z', 'and the last');
    assert(session.cost > 0, 'a priced model reports a cost');
    cleanup(w.root);
  });

  await test('a row says what it last reached for, where its transcript is, and the file times', () => {
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
    assertEq(session.lastTool, 'Read', 'the last tool_use in the parent transcript, not the first');
    assertEq(session.lastToolAt, '2026-07-27T12:30:00.000Z', 'stamped when the line was written');
    assertEq(session.transcript, transcript, 'the file every one of these was read from');
    assert(typeof session.lastActivity === 'number', 'listSessions\' mtime probe travels');
    assert(typeof session.aliveSince === 'number', 'and its birth time');
    const [agent] = session.subagents;
    assertEq(agent.lastTool, 'Edit', 'a subagent says its own last tool');
    assertEq(agent.lastToolAt, '2026-07-27T12:31:00.000Z', 'with its own stamp');
    assertEq(agent.transcript, sub, 'and carries its own transcript path');
    cleanup(w.root);
  });

  await test('a transcript that has called no tool says so with a null, never a guess', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 1 })] });
    const [session] = collect(w).sessions;
    assertEq(session.lastTool, null, 'nothing was called');
    assertEq(session.lastToolAt, null, 'so there is no when either');
    cleanup(w.root);
  });

  await test('with no statusline cache the model comes from the transcript instead', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', model: 'claude-sonnet-4-5', input: 1 })] });
    assertEq(collect(w).sessions[0].model, 'claude-sonnet-4-5', 'a VS Code session still names one');
    cleanup(w.root);
  });

  await test('no markers at all is an empty payload, still the right shape', () => {
    const w = mkWorld();
    const payload = collect(w);
    assertEq(payload.sessions.length, 0, 'nobody running');
    assertEq(Object.keys(payload.byModel).length, 0, 'no models');
    assertEq(payload.overTime.length, OVERTIME_DAYS, 'the series is always thirty long');
    cleanup(w.root);
  });

  await test('sessionTelemetry finds one by id and answers null for anything else', () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'a', input: 42 })] });
    const opts = { home: w.home, markerDir: w.markerDir, stateDir: w.stateDir, exec: w.exec };
    assertEq(sessionTelemetry('sess-1', opts).tokens.total, 42, 'the drill-down');
    assertEq(sessionTelemetry('sess-nope', opts), null, 'and nothing invented');
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
