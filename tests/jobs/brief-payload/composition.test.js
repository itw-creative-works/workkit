//
// Tests for jobs/brief-payload.js, the payload the 9am job hands to Claude:
// the composition, the fixture roster swept into a brief.
// The shared prologue (the two fixture worlds, the composer seam, the summaries fixtures, the news gate) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const {
  SLUG, STAMP, cleanup, issueNode, mkWorld, composeIn,
} = require('./helpers');

const run = async () => {
  group('jobs/brief-payload: composition');

  await test('the fixture roster sweeps into a real brief', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.ok, true, 'the sweep answered');
    assertEq(out.generatedAt, STAMP, 'the stamp is the one passed in');
    assertEq(out.counts.open, 2, 'both open issues arrived');
    assertEq(out.waiting.length, 1, 'the blocked issue is waiting on the owner');
    assertEq(out.waiting[0].number, 18, 'that one');
    assertEq(out.ready.length, 1, 'the specced, unclaimed issue is ready');
    assert(/waiting on a decision/.test(out.headline), `the headline names it: ${out.headline}`);
    cleanup(world.root);
  });

  await test('per-repo health rides along as the work sitting on the table', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.warnings.length, 1, 'the one repo has work on the table');
    assertEq(out.warnings[0].repo, SLUG, 'named by its slug');
    assertEq(out.warnings[0].uncommitted, 1, 'the scratch file is uncommitted');
    assertEq(out.warnings[0].unreleased, 1, 'and the CHANGELOG entry is unreleased');
    cleanup(world.root);
  });

  await test('a declined repo leaves the roster, and the brief', () => {
    const world = mkWorld();
    fs.mkdirSync(path.join(world.home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(world.home, '.workkit', '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(world.repo)]: 'declined' },
    }));
    const out = composeIn(world);
    assertEq(out.counts.open, 0, 'nothing is swept');
    assertEq(out.warnings.length, 0, 'and nothing is on the table');
    cleanup(world.root);
  });

  await test('what to work on next rides through the whole composition', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.nextUp.length, 1, 'the one repo has actionable work');
    assertEq(out.nextUp[0].repo, SLUG, 'named by its slug');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '18,17',
      'the decision waiting on the owner leads, then the accepted spec');
    cleanup(world.root);
  });

  await test('a built item waiting on the owner is its own section, and ranks above the specs', () => {
    // Issue #135: `status:qa` is the park a built item sits in until the owner
    // checks it. The composed payload carries it exactly as the tower's does:
    // its own bucket and count, and actionable in nextUp under the decisions.
    const world = mkWorld();
    world.board.data.r0.issues.totalCount = 3;
    world.board.data.r0.issues.nodes.push(issueNode(19, ['status:qa']));
    const out = composeIn(world);
    assertEq(out.qa.map((i) => i.number).join(','), '19', 'the parked item is the qa section');
    assertEq(out.counts.qa, 1, 'and its own count');
    assertEq(out.inFlight.length, 0, 'never counted as work somebody is still on');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '18,19,17',
      'the decision, then the check the owner owes, then the accepted spec');
    cleanup(world.root);
  });

  await test('a QA-passed item rides the morning as the thing that only needs shipping', () => {
    // Issue #196: the stage above qa. The composed payload carries it the way
    // the tower's does: its own bucket and count, and actionable in nextUp
    // under the decisions and above the check still to be given.
    const world = mkWorld();
    world.board.data.r0.issues.totalCount = 3;
    world.board.data.r0.issues.nodes.push(issueNode(19, ['status:complete']));
    const out = composeIn(world);
    assertEq(out.complete.map((i) => i.number).join(','), '19', 'the QA-passed item is the complete section');
    assertEq(out.counts.complete, 1, 'and its own count');
    assertEq(out.qa.length, 0, 'the check it already passed is not still waiting');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '18,19,17',
      'the decision, then the ship, then the accepted spec');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
