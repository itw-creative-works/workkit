// Tests for jobs/morning/brief/brief-payload.js, the payload the 9am job hands
// to Claude: the composition, the fixture roster swept into a brief.
// The shared prologue (fixture worlds, composer seam) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const {
  SLUG, STAMP, cleanup, issueNode, mkWorld, composeIn,
} = require('./helpers');

describe('jobs/brief-payload: composition', () => {
  test('the fixture roster sweeps into a real brief', () => {
    const world = mkWorld();
    const out = composeIn(world);
    expect(out.ok, 'the sweep answered').toBe(true);
    expect(out.generatedAt, 'the stamp is the one passed in').toBe(STAMP);
    expect(out.counts.open, 'both open issues arrived').toBe(2);
    expect(out.waiting.length, 'the blocked issue is waiting on the owner').toBe(1);
    expect(out.waiting[0].number, 'that one').toBe(18);
    expect(out.ready.length, 'the specced, unclaimed issue is ready').toBe(1);
    expect(/waiting on a decision/.test(out.headline), `the headline names it: ${out.headline}`).toBeTruthy();
    cleanup(world.root);
  });

  test('per-repo health rides along as the work sitting on the table', () => {
    const world = mkWorld();
    const out = composeIn(world);
    expect(out.warnings.length, 'the one repo has work on the table').toBe(1);
    expect(out.warnings[0].repo, 'named by its slug').toBe(SLUG);
    expect(out.warnings[0].uncommitted, 'the scratch file is uncommitted').toBe(1);
    expect(out.warnings[0].unreleased, 'and the CHANGELOG entry is unreleased').toBe(1);
    cleanup(world.root);
  });

  test('a declined repo leaves the roster, and the brief', () => {
    const world = mkWorld();
    fs.mkdirSync(path.join(world.home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(world.home, '.workkit', '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(world.repo)]: 'declined' },
    }));
    const out = composeIn(world);
    expect(out.counts.open, 'nothing is swept').toBe(0);
    expect(out.warnings.length, 'and nothing is on the table').toBe(0);
    cleanup(world.root);
  });

  test('what to work on next rides through the whole composition', () => {
    const world = mkWorld();
    const out = composeIn(world);
    expect(out.nextUp.length, 'the one repo has actionable work').toBe(1);
    expect(out.nextUp[0].repo, 'named by its slug').toBe(SLUG);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision waiting on the owner leads, then the accepted spec').toBe('18,17');
    cleanup(world.root);
  });

  test('a built item waiting on the owner is its own section, and ranks above the specs', () => {
    // `status:qa` rides as it does in the tower: its own bucket and count, and
    // actionable in nextUp under the decisions.
    const world = mkWorld();
    world.board.data.r0.issues.totalCount = 3;
    world.board.data.r0.issues.nodes.push(issueNode(19, ['status:qa']));
    const out = composeIn(world);
    expect(out.qa.map((i) => i.number).join(','), 'the parked item is the qa section').toBe('19');
    expect(out.counts.qa, 'and its own count').toBe(1);
    expect(out.inFlight.length, 'never counted as work somebody is still on').toBe(0);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision, then the check the owner owes, then the accepted spec').toBe('18,19,17');
    cleanup(world.root);
  });

  test('a QA-passed item rides the morning as the thing that only needs shipping', () => {
    // The stage above qa rides as it does in the tower: its own bucket and
    // count, and actionable in nextUp above the check still to be given.
    const world = mkWorld();
    world.board.data.r0.issues.totalCount = 3;
    world.board.data.r0.issues.nodes.push(issueNode(19, ['status:complete']));
    const out = composeIn(world);
    expect(out.complete.map((i) => i.number).join(','), 'the QA-passed item is the complete section').toBe('19');
    expect(out.counts.complete, 'and its own count').toBe(1);
    expect(out.qa.length, 'the check it already passed is not still waiting').toBe(0);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision, then the ship, then the accepted spec').toBe('18,19,17');
    cleanup(world.root);
  });
});
