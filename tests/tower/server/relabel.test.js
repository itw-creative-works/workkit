//
// Tests for tower/api/server.js: the board’s relabel write path.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  MOVE_STATUSES, cleanup, SLUG, mkWorld, start, getJson, postJson, raw, ghCalls,
} = require('./helpers');
const {
  WITH_CONTRACT, WITHOUT_CONTRACT, SMALL_ITEM, SMALL_ITEM_PADDED, NO_SPEC, contractReason, noSpecReason,
} = require('../spec-bodies');

const run = async () => {
  group('tower/api/server: the board’s relabel write path');

  const MOVE = '/api/issues/status';
  const validMove = { repo: SLUG, number: 17, from: 'specced', to: 'blocked' };

  await test('a valid move calls gh with exactly the expected ARGV and reports the new status', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, validMove);
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'moved');
    assertEq(body.status, 'blocked', 'the status it now carries');
    assertEq(body.number, 17, 'on the issue that was dragged');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:blocked`,
      'ARGV, not a shell string - and both halves of the move in ONE call, so the issue never carries two statuses');
    await c.stop();
    cleanup(w.root);
  });

  await test('the vocabulary is the label SSOT’s own seven, never a second copy', () => {
    assertEq(MOVE_STATUSES.join(','), 'inbox,specced,building,qa,complete,blocked,backlog', 'the pipeline, in its own order');
  });

  await test('a move into status:building is a valid move - in-flight work is a column like any other', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'building' });
    assertEq(status, 200, 'ok');
    assertEq(body.status, 'building', 'the status it now carries');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:specced --add-label status:building`,
      'the flip that starts the work is one call, like every other move');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move out of status:building is valid too - the board can pull work back', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'building', to: 'blocked' });
    assertEq(status, 200, 'ok');
    assertEq(body.status, 'blocked', 'a question mid-build is still a question');
    await c.stop();
    cleanup(w.root);
  });

  await test('an issue number that is not a positive integer is refused, gh untouched', async () => {
    const w = mkWorld();
    const c = await start(w);
    for (const number of [0, -3, 2.5, '17', null, undefined]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, number });
      assertEq(status, 400, `${JSON.stringify(number)} is rejected`);
      assert(/positive integer/.test(body.reason), 'and the reason says what one is');
    }
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against any of them');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo that is not shaped like a slug never reaches the roster comparison', async () => {
    const w = mkWorld();
    const c = await start(w);
    for (const repo of ['', 'nope', 'owner/name/extra', 'owner/name;rm -rf /', '../../etc/passwd', 42]) {
      const { status, body } = await postJson(c, MOVE, { ...validMove, repo });
      assertEq(status, 400, `${JSON.stringify(repo)} is rejected`);
      assert(/not a repository slug/.test(body.reason), 'on its shape alone');
    }
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a well-formed slug the roster does not hold is refused too', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, repo: 'someone/else' });
    assertEq(status, 400, 'the shape test is the first gate, not the only one');
    assert(/unknown repo/.test(body.reason), 'the roster is what a repo is judged against');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against an arbitrary repository');
    await c.stop();
    cleanup(w.root);
  });

  await test('a status outside the vocabulary is refused at either end', async () => {
    const w = mkWorld();
    const c = await start(w);
    const bad = await postJson(c, MOVE, { ...validMove, to: 'shipped' });
    assertEq(bad.status, 400, 'an invented status is not one');
    assert(/to is not a status/.test(bad.body.reason), 'and the end it was on is named');
    const worse = await postJson(c, MOVE, { ...validMove, from: '' });
    assertEq(worse.status, 400, 'and neither is none at all - the No-status column is not a move');
    assert(/from is not a status/.test(worse.body.reason), 'named too');
    const label = await postJson(c, MOVE, { ...validMove, to: 'status:backlog' });
    assertEq(label.status, 400, 'the value is a status, not a whole label');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a drop on the column the card came from is refused rather than run', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, to: 'specced' });
    assertEq(status, 400, 'nothing to change');
    assert(/already status:specced/.test(body.reason), 'and it says so');
    assertEq(ghCalls(w, 'issue').length, 0, 'a no-op never becomes a write');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo named in another case is accepted, and gh gets the roster’s spelling', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status } = await postJson(c, MOVE, { ...validMove, repo: SLUG.toUpperCase() });
    assertEq(status, 200, 'GitHub names are case-insensitive');
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--repo') + 1], SLUG, 'gh receives the roster spelling, not the caller’s');
    await c.stop();
    cleanup(w.root);
  });

  await test('a gh failure is a soft-fail body the page can revert on, never a 500', async () => {
    const w = mkWorld();
    const err = execError('Command failed: gh issue edit', { stderr: 'gh: could not add label: not found\n' });
    w.editResult = err;
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, validMove);
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'not moved');
    assert(/could not add label/.test(body.reason), 'the underlying message survives');
    await c.stop();
    cleanup(w.root);
  });

  // ── The proof gate on the drag ───────────────────────────────────────────
  // The board is the second door into the flip the hooks hold on the shell path
  // (safety/proof-guard, safety/commit-gate check 6): nothing reaches Complete
  // without a `Proof:` comment, whichever door it comes through.

  /** The `gh issue` calls a move makes, told apart by their subcommand. */
  const moveCalls = (world, sub) => ghCalls(world, 'issue').filter((call) => call[2] === sub);

  await test('a move to Complete on an issue with no Proof: line is refused, and the label is never written', async () => {
    const w = mkWorld();
    w.viewResult = JSON.stringify({ comments: [{ body: 'looks good' }, { body: 'shipping this. proof: lowercase is not the line' }] });
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    assertEq(status, 200, 'soft, like the other refusals gh is reached for - the page reverts the card on the body');
    assertEq(body.ok, false, 'the gate refused it');
    assert(/no comment whose line starts with "Proof:"/.test(body.reason), `the reason names what is missing, got: ${body.reason}`);
    assert(/Park it with a Proof: comment first/.test(body.reason), 'and the fix that exists');
    assertEq(moveCalls(w, 'edit').length, 0, 'the drag is not a door around the hooks');
    const [view] = moveCalls(w, 'view');
    assertEq(view.join(' '), `gh issue view 17 --repo ${SLUG} --json comments`,
      'one read of the issue\u2019s own comments, the same read hook_issue_has_proof makes');
    await c.stop();
    cleanup(w.root);
  });

  await test('a Proof: line opening any line of any comment lets that move through', async () => {
    const w = mkWorld();
    w.viewResult = JSON.stringify({
      comments: [{ body: 'first pass' }, { body: 'parked at qa.\n  Proof:\n- unit: node tests/tower/server.test.js\n- e2e: skipped, no surface' }],
    });
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the item is proved');
    assertEq(body.status, 'complete', 'and the card lands');
    const [edit] = moveCalls(w, 'edit');
    assertEq(edit.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:qa --add-label status:complete`,
      'the ordinary move, after the gate said yes');
    await c.stop();
    cleanup(w.root);
  });

  await test('a proof that cannot be READ refuses the move - a gate never fails open', async () => {
    const w = mkWorld();
    w.viewResult = execError('Command failed: gh issue view', { stderr: 'gh: could not resolve to an Issue\n' });
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'and the move did not land');
    assert(/could not be read/.test(body.reason), `the reason says the question could not be asked, got: ${body.reason}`);
    assert(/could not resolve to an Issue/.test(body.reason), 'carrying gh\u2019s own message');
    assertEq(moveCalls(w, 'edit').length, 0, 'nothing was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('an answer that is not JSON is unreadable too, and refused the same way', async () => {
    const w = mkWorld();
    w.viewResult = 'gh printed something else entirely';
    const c = await start(w);
    const { body } = await postJson(c, MOVE, { ...validMove, from: 'qa', to: 'complete' });
    assertEq(body.ok, false, 'an answer that does not parse is not a proof');
    assert(/could not be read/.test(body.reason), `and says so, got: ${body.reason}`);
    assertEq(moveCalls(w, 'edit').length, 0, 'nothing was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move to any column but Complete or Specced reads nothing at all', async () => {
    const w = mkWorld();
    const c = await start(w);
    for (const to of ['building', 'qa', 'blocked', 'backlog']) {
      const { body } = await postJson(c, MOVE, { ...validMove, from: 'inbox', to });
      assertEq(body.ok, true, `a move to ${to} is not a gated one`);
    }
    assertEq(moveCalls(w, 'view').length, 0, 'only the two gated flips pay for a read - no comments, no body');
    assertEq(moveCalls(w, 'edit').length, 4, 'and every one of them was written');
    await c.stop();
    cleanup(w.root);
  });

  // ── The Spec gate on the drag ────────────────────────────────────────────
  // The board's door into status:specced holds the rule safety/spec-guard holds
  // on the shell path: a written `## Spec` carries a `### Contract`, or is the
  // small-item line, and an issue with no Spec has nothing to be specced on.

  /** An issue body as `gh issue view --json body` answers it. */
  const bodyView = (text) => JSON.stringify({ body: text });
  const toSpecced = { ...validMove, from: 'inbox', to: 'specced' };

  const CONTRACT_REASON = contractReason(17);
  const NO_SPEC_REASON = noSpecReason(17);

  await test('a move to Specced whose Spec holds a ### Contract reads the body once, then writes the move', async () => {
    const w = mkWorld();
    w.viewResult = bodyView(WITH_CONTRACT);
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, toSpecced);
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the Spec carries its Contract, past a fenced ## line');
    assertEq(body.status, 'specced', 'and the card lands');
    const views = moveCalls(w, 'view');
    assertEq(views.length, 1, 'one read');
    assertEq(views[0].join(' '), `gh issue view 17 --repo ${SLUG} --json body`,
      'of the issue’s own body, the same read safety/spec-guard makes');
    const [edit] = moveCalls(w, 'edit');
    assertEq(edit && edit.join(' '),
      `gh issue edit 17 --repo ${SLUG} --remove-label status:inbox --add-label status:specced`,
      'the ordinary move, after the gate said yes');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move to Specced whose Spec is exactly the small-item line goes through', async () => {
    const w = mkWorld();
    w.viewResult = bodyView(SMALL_ITEM);
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, toSpecced);
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'None needed: small item. is a whole Spec');
    assertEq(moveCalls(w, 'edit').length, 1, 'and the move was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('a small-item Spec saved with CRLF line ends and a padded line goes through', async () => {
    const w = mkWorld();
    w.viewResult = bodyView(SMALL_ITEM_PADDED);
    const c = await start(w);
    const { body } = await postJson(c, MOVE, toSpecced);
    assertEq(body.ok, true, 'the line is judged trimmed, CRLF read as LF');
    assertEq(moveCalls(w, 'edit').length, 1, 'and the move was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move to Specced whose Spec is prose with no ### Contract is refused, and nothing is written', async () => {
    const w = mkWorld();
    w.viewResult = bodyView(WITHOUT_CONTRACT);
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, toSpecced);
    assertEq(status, 200, 'soft, like the proof refusal - the page reverts the card on the body');
    assertEq(body.ok, false, 'the gate refused it - a Contract outside the Spec does not count');
    assertEq(body.reason, CONTRACT_REASON, 'the reason names what is missing and the fix');
    assertEq(moveCalls(w, 'view').length, 1, 'the body was read');
    assertEq(moveCalls(w, 'edit').length, 0, 'the drag is not a door around safety/spec-guard');
    await c.stop();
    cleanup(w.root);
  });

  await test('a move to Specced on an issue with no ## Spec is refused, and nothing is written', async () => {
    const w = mkWorld();
    w.viewResult = bodyView(NO_SPEC);
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, toSpecced);
    assertEq(status, 200, 'soft, like the proof refusal - the page reverts the card on the body');
    assertEq(body.ok, false, 'nothing to be specced on');
    assertEq(body.reason, NO_SPEC_REASON, 'and the reason says so');
    assertEq(moveCalls(w, 'edit').length, 0, 'nothing was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('a Spec that cannot be READ refuses the move to Specced - the gate never fails open', async () => {
    const w = mkWorld();
    w.viewResult = execError('Command failed: gh issue view', { stderr: 'gh: could not resolve to an Issue\n' });
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, toSpecced);
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'and the move did not land');
    assert(/could not be read/.test(body.reason), `the reason says the question could not be asked, got: ${body.reason}`);
    assert(/status:specced/.test(body.reason), 'names the move it refused');
    assert(/could not resolve to an Issue/.test(body.reason), 'carrying gh’s own message');
    assertEq(moveCalls(w, 'edit').length, 0, 'nothing was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('a body read that is not JSON is unreadable too, and refuses the move to Specced the same way', async () => {
    const w = mkWorld();
    w.viewResult = 'gh printed something else entirely';
    const c = await start(w);
    const { body } = await postJson(c, MOVE, toSpecced);
    assertEq(body.ok, false, 'an answer that does not parse is not a Spec');
    assert(/could not be read/.test(body.reason), `and says so, got: ${body.reason}`);
    assert(/status:specced/.test(body.reason), 'naming the move it refused');
    assertEq(moveCalls(w, 'edit').length, 0, 'nothing was written');
    await c.stop();
    cleanup(w.root);
  });

  await test('the preflight covers this POST too - one answer, both write paths', async () => {
    const w = mkWorld();
    const c = await start(w);
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
    assertEq(res.status, 204, 'answered, not 405');
    assert(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'for the dashboard origin');

    const wrote = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    assertEq(wrote.status, 200, 'and the POST that follows it lands');
    assertEq(wrote.headers['access-control-allow-origin'], 'https://localhost:4300', 'readable to the page');
    await c.stop();
    cleanup(w.root);
  });

  await test('an off-list Origin cannot move an issue', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'POST',
      path: MOVE,
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(validMove),
    });
    assertEq(res.status, 403, 'the same gate the read paths and intake pass');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('a body that is not a JSON object is refused before anything is read out of it', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, MOVE, 'just a string');
    assertEq(status, 400, 'rejected');
    assert(/JSON object/.test(body.reason), 'says what a body is');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('the endpoint is a write and nothing else - a GET of it is a 404', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status } = await getJson(c, MOVE);
    assertEq(status, 404, 'there is no such read endpoint');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
