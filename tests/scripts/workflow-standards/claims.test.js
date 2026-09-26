//
// Tests for standards.sh: the two claim sweeps, the stale-claim sweep and the
// claimed-spec flip.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  MANIFEST, desiredLabels, cleanup, makeRepo, makeGhStub, ghCalls, runScript,
} = require('./helpers');

const run = async () => {
  group('standards.sh: the stale-claim sweep');

  // An agent that claimed an issue and then died leaves it locked against every
  // other worker. The claim is the agent:working label (assignee accounts
  // cannot tell an agent from a human: agents run gh as the owner) plus the
  // assignee, and the heal releases both after 24 hours with no activity.
  const CLAIM = 'agent:working';
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const claimStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(), labeled: { [CLAIM]: carried }, ...extra,
  });
  const issueEdits = (stub) => ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit'));
  const hasPair = (call, flag, value) => call.some((a, i) => a === flag && call[i + 1] === value);

  await test('agent:working is a label the manifest creates', () => {
    assert(desiredLabels().some((l) => l.name === CLAIM), 'the sweep queries a label the heal makes');
    assertEq(MANIFEST.groups.agent.exclusive, false, 'the claim marker is not exclusive with agent:ok');
    assert(!Object.keys(MANIFEST.groups.status.values).includes('working'),
      'a claim is not a status: the issue carries status:building while it is worked');
  });

  await test('a claim with recent activity is left exactly as it is', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 5, updatedAt: hoursAgo(2), assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `a live claim is never released, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!output.includes('claims:'), `and nothing is claimed about it, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a claim idle past 24 hours loses the label, the assignee, and gets a comment', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 8, updatedAt: hoursAgo(30), assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a release is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one release, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the label comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'),
      `and so does the assignee: one left behind still reads as a claim, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the release is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /stale-claim sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: released 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // Releasing a building issue and leaving it building would keep it counted as
  // in flight by every surface reading the pipeline, with nobody working it. The
  // spec is still accepted, so it goes back to specced, in the SAME edit, or
  // there is a window where it is unclaimed and still reads as in flight.
  await test('a stale claim on a building issue goes back to specced in the same edit', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 12,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:building' }, { name: 'type:enhancement' }],
    }]);
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a release is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one edit, never two, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the claim comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'), `and the assignee, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-label', 'status:building'),
      `building ends, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--add-label', 'status:specced'),
      `and specced resumes: the spec is still accepted, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `one comment, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /status:specced/.test(a)),
      `the trail says where the issue landed, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a stale claim on an issue that is not building touches no status label', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 13,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:blocked' }, { name: 'type:bug' }],
    }]);
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one release, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!edits[0].some((a) => /^status:/.test(a)),
      `the sweep releases a claim, it does not re-route a queue, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assert(!comments[0].some((a) => /status:specced/.test(a)),
      `and the comment claims no flip, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // `gh issue edit` fails whole when it is handed a label the repo does not
  // have, so a flip added blind would cost the release itself on exactly the
  // repos least able to afford it: the ones whose labels never reached GitHub.
  await test('a missing status:specced costs the flip, never the release', () => {
    const repo = makeRepo();
    const stub = claimStub([{
      number: 14,
      updatedAt: hoursAgo(30),
      assignees: [{ login: 'someone' }],
      labels: [{ name: CLAIM }, { name: 'status:building' }, { name: 'type:enhancement' }],
    }], { labels: desiredLabels().filter((l) => l.name !== 'status:specced') });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `the claim is still released, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the claim comes off, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-assignee', 'someone'), `and the assignee, got: ${fmtCalls(edits)}`);
    assert(!edits[0].some((a) => /^status:/.test(a)),
      `and no status label is named at all: the edit must not fail on one, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assert(!comments[0].some((a) => /status:specced/.test(a)),
      `the comment claims no flip either, got: ${fmtCalls(comments)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed query releases nothing and asks for another session', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 8, updatedAt: hoursAgo(30), assignees: [] }], { labelQueryFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'an unfinished heal reports itself');
    assertEq(issueEdits(stub).length, 0, 'an unreachable GitHub is not an idle claim');
    assert(output.includes('left in place'), `says what it did not do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an issue assigned without the label is never touched: a human claim is not swept', () => {
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      // Nothing carries agent:working; the human claim is only in the whole-repo
      // report, which the sweep never reads.
      issues: [{
        number: 9,
        labels: [{ name: 'status:specced' }, { name: 'type:bug' }],
        assignees: [{ login: 'alice' }],
      }],
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `a human claim has no expiry, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the claimed-spec flip');

  // status:specced is the authorization to start and the assignee is the claim,
  // so an issue carrying both has started. The flip is what let the readers drop
  // the claimed-specced tolerance (issue #62): nothing flipped these before, so
  // the transitional branch was permanent by default.
  const SPECCED = 'status:specced';
  const BUILDING = 'status:building';
  const speccedStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(), labeled: { [SPECCED]: carried }, ...extra,
  });

  await test('a specced issue with an assignee moves to building, with a comment', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 21, assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a flip is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one flip, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', SPECCED), `specced ends, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--add-label', BUILDING), `and building begins, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the flip is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /standards sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: flipped 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a specced issue nobody has claimed is left exactly as it is', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 22, assignees: [] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `an unclaimed spec is the ready queue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!output.includes('claims: flipped'), `and nothing is claimed about it, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo without status:building is left alone rather than edited into a failure', () => {
    // `gh issue edit` fails whole when it is handed a label the repo does not
    // have, so a flip attempted blind is an error report on exactly the repos
    // whose labels never reached GitHub.
    const repo = makeRepo();
    const stub = speccedStub([{ number: 23, assignees: [{ login: 'someone' }] }], {
      labels: desiredLabels().filter((l) => l.name !== BUILDING),
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `no flip attempted, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a released claim is not re-promoted by the flip that follows it', () => {
    // The two sweeps run in one session and move issues in opposite directions.
    // The release removes the assignee in the same edit that demotes the issue,
    // so what it hands back carries no claim for the flip to find.
    const repo = makeRepo();
    const stub = makeGhStub({
      labels: desiredLabels(),
      labeled: {
        [CLAIM]: [{
          number: 24,
          updatedAt: hoursAgo(30),
          assignees: [{ login: 'someone' }],
          labels: [{ name: CLAIM }, { name: BUILDING }, { name: 'type:bug' }],
        }],
        // What the release just made: specced again, and unassigned.
        [SPECCED]: [{ number: 24, assignees: [] }],
      },
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `the release, and nothing after it, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--add-label', SPECCED), `the issue stays where the release put it, got: ${fmtCalls(edits)}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a failed specced query flips nothing and asks for another session', () => {
    const repo = makeRepo();
    const stub = speccedStub([{ number: 25, assignees: [{ login: 'someone' }] }], { labelQueryFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'an unfinished heal reports itself');
    assertEq(issueEdits(stub).length, 0, 'an unreachable GitHub is not a claimed spec');
    assert(output.includes('nothing was flipped'), `says what it did not do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
