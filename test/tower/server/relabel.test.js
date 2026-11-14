//
// Tests for tower/api/server.js: the board’s relabel write path.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  MOVE_STATUSES, cleanup, SLUG, mkWorld, start, getJson, postJson, raw, ghCalls,
} = require('./helpers');
const {
  WITH_CONTRACT, WITHOUT_CONTRACT, SMALL_ITEM, SMALL_ITEM_PADDED, NO_SPEC, contractReason, noSpecReason,
} = require('../spec-bodies');

describe('tower/api/server: the board’s relabel write path', () => {
  const MOVE = '/api/issues/status';
  const validMove = { repo: SLUG, number: 17, from: 'specced', to: 'blocked' };

  test('a valid move calls gh with exactly the expected ARGV and reports the new status', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, validMove);
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'moved').toBe(true);
    expect(body.status, 'the status it now carries').toBe('blocked');
    expect(body.number, 'on the issue that was dragged').toBe(17);
    const [call] = ghCalls(w, 'issue');
    expect(call.join(' '), 'ARGV, not a shell string - and both halves of the move in ONE call, so the issue never carries two statuses').toBe(`gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:blocked`);
    cleanup(w.root);
  });

  test('the vocabulary is the label SSOT’s own seven, never a second copy', () => {
    expect(MOVE_STATUSES.join(','), 'the pipeline, in its own order').toBe('inbox,specced,building,qa,complete,blocked,backlog');
  });

  test('a move into status:building is a valid move - in-flight work is a column like any other', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'building' });
    expect(status, 'ok').toBe(200);
    expect(body.status, 'the status it now carries').toBe('building');
    const [call] = ghCalls(w, 'issue');
    expect(call.join(' '), 'the flip that starts the work is one call, like every other move').toBe(`gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:building`);
    cleanup(w.root);
  });

  test('a move out of status:building is valid too - the board can pull work back', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'building', to: 'blocked' });
    expect(status, 'ok').toBe(200);
    expect(body.status, 'a question mid-build is still a question').toBe('blocked');
    cleanup(w.root);
  });

  test('an issue number that is not a positive integer is refused, gh untouched', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    for (const number of [0, -3, 2.5, '17', null, undefined]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, number });
      expect(status, `${JSON.stringify(number)} is rejected`).toBe(400);
      expect(/positive integer/.test(body.reason), 'and the reason says what one is').toBeTruthy();
    }
    expect(ghCalls(w, 'issue').length, 'gh never ran against any of them').toBe(0);
    cleanup(w.root);
  });

  test('a repo that is not shaped like a slug never reaches the roster comparison', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    for (const repo of ['', 'nope', 'owner/name/extra', 'owner/name;rm -rf /', '../../etc/passwd', 42]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, repo });
      expect(status, `${JSON.stringify(repo)} is rejected`).toBe(400);
      expect(/not a repository slug/.test(body.reason), 'on its shape alone').toBeTruthy();
    }
    expect(ghCalls(w, 'issue').length, 'gh never ran').toBe(0);
    cleanup(w.root);
  });

  test('a well-formed slug the roster does not hold is refused too', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, repo: 'someone/else' });
    expect(status, 'the shape test is the first gate, not the only one').toBe(400);
    expect(/unknown repo/.test(body.reason), 'the roster is what a repo is judged against').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'gh never ran against an arbitrary repository').toBe(0);
    cleanup(w.root);
  });

  test('a status outside the vocabulary is refused at either end', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const bad = await postJson(c, MOVE, { ...validMove, to: 'shipped' });
    expect(bad.status, 'an invented status is not one').toBe(400);
    expect(/to is not a status/.test(bad.body.reason), 'and the end it was on is named').toBeTruthy();
    const worse = await postJson(c, MOVE, { ...validMove, from: '' });
    expect(worse.status, 'and neither is none at all - the No-status column is not a move').toBe(400);
    expect(/from is not a status/.test(worse.body.reason), 'named too').toBeTruthy();
    const label = await postJson(c, MOVE, { ...validMove, to: 'status:backlog' });
    expect(label.status, 'the value is a status, not a whole label').toBe(400);
    expect(ghCalls(w, 'issue').length, 'gh never ran').toBe(0);
    cleanup(w.root);
  });

  test('a drop on the column the card came from is refused rather than run', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'specced' });
    expect(status, 'nothing to change').toBe(400);
    expect(/already status:specced/.test(body.reason), 'and it says so').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'a no-op never becomes a write').toBe(0);
    cleanup(w.root);
  });

  test('a repo named in another case is accepted, and gh gets the roster’s spelling', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status } = await postJson(c, MOVE, { ...validMove, repo: SLUG.toUpperCase() });
    expect(status, 'GitHub names are case-insensitive').toBe(200);
    const [call] = ghCalls(w, 'issue');
    expect(call[call.indexOf('--repo') + 1], 'gh receives the roster spelling, not the caller’s').toBe(SLUG);
    cleanup(w.root);
  });

  test('a gh failure is a soft-fail body the page can revert on, never a 500', async (t) => {
    const w = mkWorld();
    const err = execError('Command failed: gh issue edit', { stderr: 'gh: could not add label: not found\n' });
    w.editResult = err;
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, validMove);
    expect(status, 'the tower stays up').toBe(200);
    expect(body.ok, 'not moved').toBe(false);
    expect(/could not add label/.test(body.reason), 'the underlying message survives').toBeTruthy();
    cleanup(w.root);
  });

  // ── The proof gate on the drag ───────────────────────────────────────────
  // The board is the second door into the flip the hooks hold on the shell path
  // (safety:proof-guard, safety:commit-gate check 6): nothing reaches Complete
  // without a `Proof:` comment, whichever door it comes through.

  /** The `gh issue` calls a move makes, told apart by their subcommand. */
  const moveCalls = (world, sub) => ghCalls(world, 'issue').filter((call) => call[2] === sub);

  test('a move to Complete on an issue with no Proof: line is refused, and the label is never written', async (t) => {
    const w = mkWorld();
    w.viewResult = JSON.stringify({ comments: [{ body: 'looks good' }, { body: 'shipping this. proof: lowercase is not the line' }] });
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    expect(status, 'soft, like the other refusals gh is reached for - the page reverts the card on the body').toBe(200);
    expect(body.ok, 'the gate refused it').toBe(false);
    expect(/no comment whose line starts with "Proof:"/.test(body.reason), `the reason names what is missing, got: ${body.reason}`).toBeTruthy();
    expect(/Park it with a Proof: comment first/.test(body.reason), 'and the fix that exists').toBeTruthy();
    expect(moveCalls(w, 'edit').length, 'the drag is not a door around the hooks').toBe(0);
    const [view] = moveCalls(w, 'view');
    expect(view.join(' '), 'one read of the issue\u2019s own comments, the same read hook_issue_has_proof makes').toBe(`gh issue view 17 --repo ${SLUG} --json comments`);
    cleanup(w.root);
  });

  test('a Proof: line opening any line of any comment lets that move through', async (t) => {
    const w = mkWorld();
    w.viewResult = JSON.stringify({
      comments: [{ body: 'first pass' }, { body: 'parked at qa.\n  Proof:\n- unit: node tests/tower/server.test.js\n- e2e: skipped, no surface' }],
    });
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'the item is proved').toBe(true);
    expect(body.status, 'and the card lands').toBe('complete');
    const [edit] = moveCalls(w, 'edit');
    expect(edit.join(' '), 'the ordinary move, after the gate said yes').toBe(`gh issue edit 17 --repo ${SLUG} --remove-label status:qa --add-label status:complete`);
    cleanup(w.root);
  });

  test('a proof that cannot be READ refuses the move - a gate never fails open', async (t) => {
    const w = mkWorld();
    w.viewResult = execError('Command failed: gh issue view', { stderr: 'gh: could not resolve to an Issue\n' });
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    expect(status, 'the tower stays up').toBe(200);
    expect(body.ok, 'and the move did not land').toBe(false);
    expect(/could not be read/.test(body.reason), `the reason says the question could not be asked, got: ${body.reason}`).toBeTruthy();
    expect(/could not resolve to an Issue/.test(body.reason), 'carrying gh\u2019s own message').toBeTruthy();
    expect(moveCalls(w, 'edit').length, 'nothing was written').toBe(0);
    cleanup(w.root);
  });

  test('an answer that is not JSON is unreadable too, and refused the same way', async (t) => {
    const w = mkWorld();
    w.viewResult = 'gh printed something else entirely';
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    expect(body.ok, 'an answer that does not parse is not a proof').toBe(false);
    expect(/could not be read/.test(body.reason), `and says so, got: ${body.reason}`).toBeTruthy();
    expect(moveCalls(w, 'edit').length, 'nothing was written').toBe(0);
    cleanup(w.root);
  });

  test('a move to any column but Complete or Specced reads nothing at all', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    for (const to of ['building', 'qa', 'blocked', 'backlog']) {
      const { body } = await postJson(c, MOVE, { ...validMove, from: 'inbox', to });
      expect(body.ok, `a move to ${to} is not a gated one`).toBe(true);
    }
    expect(moveCalls(w, 'view').length, 'only the two gated flips pay for a read - no comments, no body').toBe(0);
    expect(moveCalls(w, 'edit').length, 'and every one of them was written').toBe(4);
    cleanup(w.root);
  });

  // ── The Spec gate on the drag ────────────────────────────────────────────
  // The board's door into status:specced holds the rule safety:spec-guard holds
  // on the shell path: a written `## Spec` carries a `### Contract`, or is the
  // small-item line, and an issue with no Spec has nothing to be specced on.

  /** An issue body as `gh issue view --json body` answers it. */
  const bodyView = (text) => JSON.stringify({ body: text });
  const toSpecced = { ...validMove, from: 'inbox', to: 'specced' };

  const CONTRACT_REASON = contractReason(17);
  const NO_SPEC_REASON = noSpecReason(17);

  test('a move to Specced whose Spec holds a ### Contract reads the body once, then writes the move', async (t) => {
    const w = mkWorld();
    w.viewResult = bodyView(WITH_CONTRACT);
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, toSpecced);
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'the Spec carries its Contract, past a fenced ## line').toBe(true);
    expect(body.status, 'and the card lands').toBe('specced');
    const views = moveCalls(w, 'view');
    expect(views.length, 'one read').toBe(1);
    expect(views[0].join(' '), 'of the issue’s own body, the same read safety:spec-guard makes').toBe(`gh issue view 17 --repo ${SLUG} --json body`);
    const [edit] = moveCalls(w, 'edit');
    expect(edit && edit.join(' '), 'the ordinary move, after the gate said yes').toBe(`gh issue edit 17 --repo ${SLUG} --remove-label status:inbox --add-label status:specced`);
    cleanup(w.root);
  });

  test('a move to Specced whose Spec is exactly the small-item line goes through', async (t) => {
    const w = mkWorld();
    w.viewResult = bodyView(SMALL_ITEM);
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, toSpecced);
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'None needed: small item. is a whole Spec').toBe(true);
    expect(moveCalls(w, 'edit').length, 'and the move was written').toBe(1);
    cleanup(w.root);
  });

  test('a small-item Spec saved with CRLF line ends and a padded line goes through', async (t) => {
    const w = mkWorld();
    w.viewResult = bodyView(SMALL_ITEM_PADDED);
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await postJson(c, MOVE, toSpecced);
    expect(body.ok, 'the line is judged trimmed, CRLF read as LF').toBe(true);
    expect(moveCalls(w, 'edit').length, 'and the move was written').toBe(1);
    cleanup(w.root);
  });

  test('a move to Specced whose Spec is prose with no ### Contract is refused, and nothing is written', async (t) => {
    const w = mkWorld();
    w.viewResult = bodyView(WITHOUT_CONTRACT);
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, toSpecced);
    expect(status, 'soft, like the proof refusal - the page reverts the card on the body').toBe(200);
    expect(body.ok, 'the gate refused it - a Contract outside the Spec does not count').toBe(false);
    expect(body.reason, 'the reason names what is missing and the fix').toBe(CONTRACT_REASON);
    expect(moveCalls(w, 'view').length, 'the body was read').toBe(1);
    expect(moveCalls(w, 'edit').length, 'the drag is not a door around safety:spec-guard').toBe(0);
    cleanup(w.root);
  });

  test('a move to Specced on an issue with no ## Spec is refused, and nothing is written', async (t) => {
    const w = mkWorld();
    w.viewResult = bodyView(NO_SPEC);
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, toSpecced);
    expect(status, 'soft, like the proof refusal - the page reverts the card on the body').toBe(200);
    expect(body.ok, 'nothing to be specced on').toBe(false);
    expect(body.reason, 'and the reason says so').toBe(NO_SPEC_REASON);
    expect(moveCalls(w, 'edit').length, 'nothing was written').toBe(0);
    cleanup(w.root);
  });

  test('a Spec that cannot be READ refuses the move to Specced - the gate never fails open', async (t) => {
    const w = mkWorld();
    w.viewResult = execError('Command failed: gh issue view', { stderr: 'gh: could not resolve to an Issue\n' });
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, toSpecced);
    expect(status, 'the tower stays up').toBe(200);
    expect(body.ok, 'and the move did not land').toBe(false);
    expect(/could not be read/.test(body.reason), `the reason says the question could not be asked, got: ${body.reason}`).toBeTruthy();
    expect(/status:specced/.test(body.reason), 'names the move it refused').toBeTruthy();
    expect(/could not resolve to an Issue/.test(body.reason), 'carrying gh’s own message').toBeTruthy();
    expect(moveCalls(w, 'edit').length, 'nothing was written').toBe(0);
    cleanup(w.root);
  });

  test('a body read that is not JSON is unreadable too, and refuses the move to Specced the same way', async (t) => {
    const w = mkWorld();
    w.viewResult = 'gh printed something else entirely';
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await postJson(c, MOVE, toSpecced);
    expect(body.ok, 'an answer that does not parse is not a Spec').toBe(false);
    expect(/could not be read/.test(body.reason), `and says so, got: ${body.reason}`).toBeTruthy();
    expect(/status:specced/.test(body.reason), 'naming the move it refused').toBeTruthy();
    expect(moveCalls(w, 'edit').length, 'nothing was written').toBe(0);
    cleanup(w.root);
  });

  test('the preflight covers this POST too - one answer, both write paths', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'OPTIONS',
      path: MOVE,
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status, 'answered, not 405').toBe(204);
    expect(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed').toBeTruthy();
    expect(res.headers['access-control-allow-origin'], 'for the dashboard origin').toBe('https://localhost:4300');

    const wrote = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    expect(wrote.status, 'and the POST that follows it lands').toBe(200);
    expect(wrote.headers['access-control-allow-origin'], 'readable to the page').toBe('https://localhost:4300');
    cleanup(w.root);
  });

  test('an off-list Origin cannot move an issue', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    expect(res.status, 'the same gate the read paths and intake pass').toBe(403);
    expect(ghCalls(w, 'issue').length, 'gh never ran').toBe(0);
    cleanup(w.root);
  });

  test('a body that is not a JSON object is refused before anything is read out of it', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, MOVE, 'just a string');
    expect(status, 'rejected').toBe(400);
    expect(/JSON object/.test(body.reason), 'says what a body is').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'gh never ran').toBe(0);
    cleanup(w.root);
  });

  test('the endpoint is a write and nothing else - a GET of it is a 404', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status } = await getJson(c, MOVE);
    expect(status, 'there is no such read endpoint').toBe(404);
    cleanup(w.root);
  });
});
