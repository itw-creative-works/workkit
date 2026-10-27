//
// Tests for tower/api/lib/telemetry.js: the two endpoints through the real server.
// Prologue: ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  OVERTIME_DAYS, createServer, cleanup, assistantLine, spawnLine, mkWorld, mkSession, mkSubagent, listen, getJson,
} = require('./helpers');

const cases = async () => {
  group('tower/telemetry: the endpoints');

  await test('/api/telemetry serves the whole payload through the real server', async () => {
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
    const { status, body } = await getJson(c, '/api/telemetry');
    assertEq(status, 200, 'ok');
    assertEq(body.sessions.length, 1, 'one session');
    assertEq(body.sessions[0].tokens.total, 110, 'its own tokens');
    assertEq(body.sessions[0].subagents[0].class, 'worker', 'with its crew attributed');
    assertEq(body.byClass.manager, 110, 'byClass is there');
    assertEq(body.overTime.length, OVERTIME_DAYS, 'and the series');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/telemetry/<id> drills into one session, and an unknown id is a 404', async () => {
    const w = mkWorld();
    mkSession(w, { lines: [assistantLine({ id: 'r', input: 77 })] });
    const c = await listen(createServer({
      workflowHome: path.join(w.root, 'no-roster'),
      home: w.home,
      markerDir: w.markerDir,
      stateDir: w.stateDir,
      exec: w.exec,
    }));
    const found = await getJson(c, '/api/telemetry/sess-1');
    assertEq(found.status, 200, 'ok');
    assertEq(found.body.id, 'sess-1', 'the session object itself, not a list');
    assertEq(found.body.tokens.total, 77, 'with its tokens');

    const missing = await getJson(c, '/api/telemetry/sess-nope');
    assertEq(missing.status, 404, 'no such session');
    assertEq(missing.body.ok, false, 'the soft shape everywhere');
    assert(/no such session/.test(missing.body.reason), 'the reason names it');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
