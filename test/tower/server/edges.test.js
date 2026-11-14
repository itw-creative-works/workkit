//
// Tests for tower/api/server.js: the edges.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const path = require('path');
const { describe, test, expect, until } = require('../../lib/harness');
const {
  DEFAULT_BIND, DEFAULT_PORT, cleanup, issueNode, mkWorld, start, getJson, sweptBoard, tiles,
} = require('./helpers');

describe('tower/api/server: the edges', () => {
  test('the API serves no pages - / is a 404 like any other non-endpoint', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const root = await getJson(c, '/');
    expect(root.status, 'the dashboard is the OMEGA app, not this process').toBe(404);
    expect(root.body.ok, 'the soft shape everywhere').toBe(false);
    const asset = await getJson(c, '/assets/css/omega.css');
    expect(asset.status, 'and nothing static is served either').toBe(404);
    cleanup(w.root);
  });

  test('an unknown path is a 404 with a JSON reason', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/nope');
    expect(status, '404').toBe(404);
    expect(body.ok, 'the soft shape everywhere').toBe(false);
    expect(/no such endpoint/.test(body.reason), 'says what was asked for').toBeTruthy();
    cleanup(w.root);
  });

  test('the defaults bind 127.0.0.1 on 8693 - Tailscale is the only way in', () => {
    expect(DEFAULT_BIND, 'localhost only, never 0.0.0.0').toBe('127.0.0.1');
    expect(DEFAULT_PORT, 'TOWER on a keypad').toBe(8693);
  });

  // A throw in a handler must not end the API process, which takes the dashboard
  // down with it (tower/start.sh: either half ending ends both). A bug in a lib
  // is a 500 on that request and nothing more.
  test('a handler that throws answers 500 and the process keeps serving', async (t) => {
    const w = mkWorld();
    // A shape no normalizer expects: the connection's nodes are not a list.
    w.board = { data: { r0: { issues: { totalCount: 1, nodes: { nope: true } } } } };
    const c = await start(w);
    t.after(() => c.stop());
    const said = [];
    const wasError = console.error;
    console.error = (line) => said.push(line);
    try {
      const board = await getJson(c, '/api/board');
      expect(board.status, 'the request that broke is the only thing that failed').toBe(500);
      expect(board.body.ok, 'the soft shape everywhere').toBe(false);
      expect(board.body.reason.length > 0, `and it carries the message, got: ${board.body.reason}`).toBeTruthy();
      expect(said.length, 'logged once, so the machine has a trail').toBe(1);
      const repos = await getJson(c, '/api/repos');
      expect(repos.status, 'and the next request is answered by the same live process').toBe(200);
    } finally {
      console.error = wasError;
    }
    cleanup(w.root);
  });

  // The same bug one page later, where no request is left to answer it: the
  // continuations run on a timer, off the request stack, so a round that cannot
  // finish is dropped, not fatal.
  test('a continuation that throws is dropped, and the process keeps serving', async (t) => {
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
    t.after(() => c.stop());
    const said = [];
    const wasError = console.error;
    console.error = (line) => said.push(line);
    try {
      const first = await getJson(c, '/api/board');
      expect(first.status, 'the read that started the sweep is answered with its first page').toBe(200);
      // The drop happens a turn of the loop later. Bounded, so a regression that
      // takes the process down fails here rather than hanging the suite.
      await until(() => said.length > 0);
      expect(said.length, 'the machine is told once, the way every other catch here tells it').toBe(1);
      // The kit's one line shape: the glyph, then the message.
      expect(/^✖ the board sweep was dropped: /.test(said[0]),
        `and in those words, got: ${said[0]}`).toBeTruthy();

      const alive = await getJson(c, '/api/repos');
      expect(alive.status, 'the listener is still up - the timer did not take it with it').toBe(200);

      // The slot stayed cold, so there is nothing to serve for the minute: the
      // next read sweeps again, and a page that has stopped breaking lands.
      broken = false;
      const second = await getJson(c, '/api/board');
      const body = await sweptBoard(c, second.body);
      expect(body.issues.length, 'the whole board, from a sweep that was started fresh').toBe(2);
      expect(said.length, 'and nothing more was dropped').toBe(1);
    } finally {
      console.error = wasError;
    }
    cleanup(w.root);
  });

  test('an absent roster serves an empty one instead of crashing', async (t) => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'absent') });
    t.after(() => c.stop());
    const repos = await getJson(c, '/api/repos');
    expect(repos.body.length, 'empty').toBe(0);
    const health = await getJson(c, '/api/health');
    expect(tiles(health.body).length, 'no tiles, no error page').toBe(0);
    cleanup(w.root);
  });
});
