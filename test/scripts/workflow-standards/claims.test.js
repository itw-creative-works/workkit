// Tests for standards.sh: the two claim sweeps, the stale-claim sweep and the
// claimed-spec flip.
// The shared prologue is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  MANIFEST, desiredLabels, cleanup, makeRepo, makeGhStub, ghCalls, runScript,
} = require('./helpers');

const cases = async () => {
  group('standards.sh: the stale-claim sweep');

  // An agent that claimed an issue and then died leaves it locked against every
  // other worker. The claim is the agent:claimed label and the assignee is a
  // person, so the heal releases the label after 24 hours with no activity and
  // leaves whoever is assigned where they are.
  const CLAIM = 'agent:claimed';
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const claimStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(), labeled: { [CLAIM]: carried }, ...extra,
  });
  const issueEdits = (stub) => ghCalls(stub).filter((c) => isCall(c, 'issue', 'edit'));
  const hasPair = (call, flag, value) => call.some((a, i) => a === flag && call[i + 1] === value);

  await test('agent:claimed is a label the manifest creates', () => {
    assert(desiredLabels().some((l) => l.name === CLAIM), 'the sweep queries a label the heal makes');
    assertEq(MANIFEST.groups.agent.exclusive, false, 'the claim marker is not exclusive with agent:ok');
    assert(!Object.keys(MANIFEST.groups.status.values).includes('claimed'),
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

  await test('a claim idle past 24 hours loses the label, keeps its assignee, and gets a comment', () => {
    const repo = makeRepo();
    const stub = claimStub([{ number: 8, updatedAt: hoursAgo(30), assignees: [{ login: 'someone' }] }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a release is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one release, got: ${fmtCalls(ghCalls(stub))}`);
    assert(hasPair(edits[0], '--remove-label', CLAIM), `the label comes off, got: ${fmtCalls(edits)}`);
    assert(!edits[0].includes('--remove-assignee'),
      `the assignee stays: an assignee is a person, not the claim, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the release is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /stale-claim sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: released 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // Releasing a building issue and leaving it building would keep it counted as
  // in flight by every surface reading the pipeline, with nobody working it. The
  // spec is still accepted, so it goes back to specced, in the same edit, or
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
    assert(!edits[0].includes('--remove-assignee'), `the assignee stays, got: ${fmtCalls(edits)}`);
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
    assert(!edits[0].includes('--remove-assignee'), `the assignee stays, got: ${fmtCalls(edits)}`);
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
      // Nothing carries agent:claimed; the human claim is only in the whole-repo
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

  // status:specced is the authorization to start and agent:claimed is the
  // claim, so an issue carrying both has started, and the flip is what lets the
  // readers carry no claimed-specced tolerance. An assignee is a person, never a
  // claim, so an assignee alone moves nothing.
  const SPECCED = 'status:specced';
  const BUILDING = 'status:building';
  const carries = (entry, label) => (entry.labels || []).some((l) => l.name === label);
  // Each issue answers the status:specced query, and one carrying the claim
  // answers the agent:claimed query too, fresh, so the stale sweep leaves it be.
  const speccedStub = (carried, extra = {}) => makeGhStub({
    labels: desiredLabels(),
    labeled: {
      [SPECCED]: carried,
      [CLAIM]: carried.filter((e) => carries(e, CLAIM)).map((e) => ({ ...e, updatedAt: hoursAgo(1) })),
    },
    ...extra,
  });
  const claimedSpec = (number) => ({
    number,
    assignees: [],
    labels: [{ name: SPECCED }, { name: CLAIM }, { name: 'type:enhancement' }],
  });

  await test('a specced issue carrying agent:claimed and no assignee moves to building, with a comment', () => {
    const repo = makeRepo();
    const stub = speccedStub([claimedSpec(21)]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'a flip is a heal, not a failure');
    const edits = issueEdits(stub);
    assertEq(edits.length, 1, `one flip, got: ${fmtCalls(ghCalls(stub))}`);
    assert(edits[0].includes('21'), `the claimed issue is the one flipped, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--remove-label', SPECCED), `specced ends, got: ${fmtCalls(edits)}`);
    assert(hasPair(edits[0], '--add-label', BUILDING), `and building begins, got: ${fmtCalls(edits)}`);
    const comments = ghCalls(stub).filter((c) => isCall(c, 'issue', 'comment'));
    assertEq(comments.length, 1, `the flip is recorded on the issue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(comments[0].some((a) => /standards sweep/.test(a)), `naming the sweep, got: ${fmtCalls(comments)}`);
    assert(output.includes('claims: flipped 1'), `and the run says so, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a specced issue with an assignee and no agent:claimed is left exactly as it is', () => {
    const repo = makeRepo();
    const stub = speccedStub([{
      number: 22,
      assignees: [{ login: 'someone' }],
      labels: [{ name: SPECCED }, { name: 'type:enhancement' }],
    }]);
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0,
      `an assignee is a person, not a claim: the spec is still the ready queue, got: ${fmtCalls(ghCalls(stub))}`);
    assert(!output.includes('claims: flipped'), `and nothing is claimed about it, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a repo without status:building is left alone rather than edited into a failure', () => {
    // `gh issue edit` fails whole when it is handed a label the repo does not
    // have, so a flip attempted blind is an error report on exactly the repos
    // whose labels never reached GitHub.
    const repo = makeRepo();
    const stub = speccedStub([claimedSpec(23)], {
      labels: desiredLabels().filter((l) => l.name !== BUILDING),
    });
    const { code } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assertEq(issueEdits(stub).length, 0, `no flip attempted, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a released claim is not re-promoted by the flip that follows it', () => {
    // The two sweeps run in one session and move issues in opposite directions.
    // The release removes agent:claimed in the same edit that demotes the issue,
    // so what it hands back carries no claim for the flip to find, assignee or not.
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
        // What the release just made: specced again, still assigned, unclaimed.
        [SPECCED]: [{
          number: 24,
          assignees: [{ login: 'someone' }],
          labels: [{ name: SPECCED }, { name: 'type:bug' }],
        }],
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
    const stub = speccedStub([claimedSpec(25)], { labelQueryFails: true });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 1, 'an unfinished heal reports itself');
    assertEq(issueEdits(stub).length, 0, 'an unreachable GitHub is not a claimed spec');
    assert(output.includes('nothing was flipped'), `says what it did not do, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
