//
// Tests for tower/api/server.js: the edges.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  DEFAULT_BIND, DEFAULT_PORT, cleanup, issueNode, mkWorld, start, getJson, tiles,
} = require('./helpers');

const run = async () => {
  group('tower/api/server: the edges');

  await test('the API serves no pages - / is a 404 like any other non-endpoint', async () => {
    const w = mkWorld();
    const c = await start(w);
    const root = await getJson(c, '/');
    assertEq(root.status, 404, 'the dashboard is the OMEGA app, not this process');
    assertEq(root.body.ok, false, 'the soft shape everywhere');
    const asset = await getJson(c, '/assets/css/omega.css');
    assertEq(asset.status, 404, 'and nothing static is served either');
    await c.stop();
    cleanup(w.root);
  });

  await test('an unknown path is a 404 with a JSON reason', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/nope');
    assertEq(status, 404, '404');
    assertEq(body.ok, false, 'the soft shape everywhere');
    assert(/no such endpoint/.test(body.reason), 'says what was asked for');
    await c.stop();
    cleanup(w.root);
  });

  await test('the defaults bind 127.0.0.1 on 8693 - Tailscale is the only way in', () => {
    assertEq(DEFAULT_BIND, '127.0.0.1', 'localhost only, never 0.0.0.0');
    assertEq(DEFAULT_PORT, 8693, 'TOWER on a keypad');
  });

  // Issue #202: the sweep met a payload shape it did not expect - GitHub had
  // nulled every issue node - and the throw ended the API process, which takes
  // the dashboard down with it (tower/start.sh: either half ending ends both).
  // A bug in a lib is a 500 on that request and nothing more.
  await test('a handler that throws answers 500 and the process keeps serving', async () => {
    const w = mkWorld();
    // A shape no normalizer expects: the connection's nodes are not a list.
    w.board = { data: { r0: { issues: { totalCount: 1, nodes: { nope: true } } } } };
    const c = await start(w);
    const said = [];
    const wasError = console.error;
    console.error = (line) => said.push(line);
    try {
      const board = await getJson(c, '/api/board');
      assertEq(board.status, 500, 'the request that broke is the only thing that failed');
      assertEq(board.body.ok, false, 'the soft shape everywhere');
      assert(board.body.reason.length > 0, `and it carries the message, got: ${board.body.reason}`);
      assertEq(said.length, 1, 'logged once, so the machine has a trail');
      const repos = await getJson(c, '/api/repos');
      assertEq(repos.status, 200, 'and the next request is answered by the same live process');
    } finally {
      console.error = wasError;
    }
    await c.stop();
    cleanup(w.root);
  });

  // And the same bug one page later, where no request is left to answer it: the
  // continuations run on a TIMER, off the request stack, and the throw that
  // ended the API came out of the shaping of what had arrived rather than out of
  // the ask. A round that cannot finish is dropped, not fatal.
  await test('a continuation that throws is dropped, and the process keeps serving', async () => {
    const w = mkWorld();
    // A first page that is whole and says another follows, and a continuation
    // whose issue carries a labels connection that is not a list - a shape the
    // normalizer only meets in `board()`, after the last page has been absorbed.
    w.board = {
      data: { r0: { issues: {
        totalCount: 2,
        pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
        nodes: [issueNode(17, ['status:specced'])],
      } } },
    };
    const plain = w.exec;
    let broken = true;
    w.exec = (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'api' && args[args.length - 1].includes('after: "CUR1"')) {
        w.calls.push([cmd, ...args]);
        const node = issueNode(18, ['status:qa']);
        if (broken) node.labels = { nodes: 5 };
        return JSON.stringify({ data: { r0: { issues: { totalCount: 2, nodes: [node] } } } });
      }
      return plain(cmd, args);
    };

    const c = await start(w);
    const said = [];
    const wasError = console.error;
    console.error = (line) => said.push(line);
    try {
      const first = await getJson(c, '/api/board');
      assertEq(first.status, 200, 'the read that started the sweep is answered with its first page');
      // The drop happens a turn of the loop later. Bounded, so a regression that
      // takes the process down fails here rather than hanging the suite.
      for (let i = 0; i < 100 && said.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
      }
      assertEq(said.length, 1, 'the machine is told once, the way every other catch here tells it');
      // The kit's one line shape (issue #237): the glyph, then the message.
      assert(/^✖ the board sweep was dropped: /.test(said[0]),
        `and in those words, got: ${said[0]}`);

      const alive = await getJson(c, '/api/repos');
      assertEq(alive.status, 200, 'the listener is still up - the timer did not take it with it');

      // The slot stayed COLD, so there is nothing to serve for the minute: the
      // next read sweeps again, and a page that has stopped breaking lands.
      broken = false;
      const second = await getJson(c, '/api/board');
      let body = second.body;
      for (let i = 0; i < 100 && body.repos[0].loading; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        ({ body } = await getJson(c, '/api/board'));
      }
      assertEq(body.issues.length, 2, 'the whole board, from a sweep that was started fresh');
      assertEq(said.length, 1, 'and nothing more was dropped');
    } finally {
      console.error = wasError;
    }
    await c.stop();
    cleanup(w.root);
  });

  await test('an absent roster serves an empty one instead of crashing', async () => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'absent') });
    const repos = await getJson(c, '/api/repos');
    assertEq(repos.body.length, 0, 'empty');
    const health = await getJson(c, '/api/health');
    assertEq(tiles(health.body).length, 0, 'no tiles, no error page');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
