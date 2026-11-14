//
// Tests for tower/api/lib/telemetry.js: the two endpoints through the real server.
// Prologue: ./helpers.js.
//

const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  OVERTIME_DAYS, createServer, cleanup, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, listen, getJson,
} = require('./helpers');

describe('tower/telemetry: the endpoints', () => {
  test('/api/telemetry serves the whole payload through the real server', async (t) => {
    const w = mkWorld();
    const transcript = mkSession(w, {
      lines: [
        spawnLine({ id: 's', toolUseId: 'toolu_w', subagentType: 'workkit:worker' }),
        assistantLine({ id: 'r', input: 100, output: 10 }),
      ],
    });
    mkSubagent(transcript, 'w1', { lines: [assistantLine({ id: 'a', input: 60 })], meta: { toolUseId: 'toolu_w' } });
    const c = await listen(createServer({
      workflowHome: path.join(w.root, 'no-roster'),
      home: w.home,
      markerDir: w.markerDir,
      stateDir: w.stateDir,
      exec: w.exec,
    }));
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/telemetry');
    expect(status, 'ok').toBe(200);
    expect(body.sessions.length, 'one session').toBe(1);
    expect(body.sessions[0].tokens.total, 'its own tokens').toBe(110);
    expect(body.sessions[0].subagents[0].class, 'with its crew attributed').toBe('worker');
    expect(body.byClass.manager, 'byClass is there').toBe(110);
    expect(body.overTime.length, 'and the series').toBe(OVERTIME_DAYS);
    cleanup(w.root);
  });

  test('/api/telemetry/<id> drills into one session, and an unknown id is a 404', async (t) => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'r', input: 77 })] });
    const c = await listen(createServer({
      workflowHome: path.join(w.root, 'no-roster'),
      home: w.home,
      markerDir: w.markerDir,
      stateDir: w.stateDir,
      exec: w.exec,
    }));
    t.after(() => c.stop());
    const found = await getJson(c, '/api/telemetry/sess-1');
    expect(found.status, 'ok').toBe(200);
    expect(found.body.id, 'the session object itself, not a list').toBe('sess-1');
    expect(found.body.tokens.total, 'with its tokens').toBe(77);

    const missing = await getJson(c, '/api/telemetry/sess-nope');
    expect(missing.status, 'no such session').toBe(404);
    expect(missing.body.ok, 'the soft shape everywhere').toBe(false);
    expect(/no such session/.test(missing.body.reason), 'the reason names it').toBeTruthy();
    cleanup(w.root);
  });
});
