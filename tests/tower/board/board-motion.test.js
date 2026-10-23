//
// Tests for the tower dashboard's board-motion.js: where each Board card moves
// between two repaints. The lib loader is ../app/helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { load } = require('../app/helpers');

/** A map of `data-issue` to the card's on-screen spot, as the page measures it. */
const spots = (entries) => new Map(Object.entries(entries));

const sorted = (keys) => [...keys].sort();

const run = async () => {
  const { motionPlan } = await load('board-motion.js');

  group('tower/board: motion - where each card moves between repaints');

  await test('a card at the same spot is not in moved', () => {
    const plan = motionPlan(
      spots({ 'workkit#1': { x: 10, y: 20 }, 'workkit#2': { x: 300, y: 40 } }),
      spots({ 'workkit#1': { x: 10, y: 20 }, 'workkit#2': { x: 300, y: 140 } }),
    );
    assert(!plan.moved.some((move) => move.key === 'workkit#1'), 'a card that stayed put does not slide');
    assertEq(plan.moved.length, 1, 'only the card whose spot changed is in moved');
    assertEq(plan.entered.length, 0, 'a card on both sides never enters');
    assertEq(plan.left.length, 0, 'and never leaves');
  });

  await test('a moved card\'s dx and dy are its old spot minus its new one', () => {
    const plan = motionPlan(
      spots({ 'workkit#7': { x: 40, y: 500 }, 'omega#3': { x: 900, y: 60 } }),
      spots({ 'workkit#7': { x: 340, y: 120 }, 'omega#3': { x: 100, y: 60 } }),
    );
    const right = plan.moved.find((move) => move.key === 'workkit#7');
    assert(right, 'the card that changed column is in moved');
    assertEq(right.dx, -300, 'dx is old x minus new x, so the card starts back where it was');
    assertEq(right.dy, 380, 'dy is old y minus new y');
    const left = plan.moved.find((move) => move.key === 'omega#3');
    assert(left, 'a move to the left is a move too');
    assertEq(left.dx, 800, 'old x minus new x, positive for a leftward move');
    assertEq(left.dy, 0, 'and a spot unchanged on one axis is zero on that axis');
  });

  await test('a key only in after is entered, a key only in before is left', () => {
    const plan = motionPlan(
      spots({ 'workkit#1': { x: 0, y: 0 }, 'workkit#2': { x: 0, y: 100 } }),
      spots({ 'workkit#1': { x: 0, y: 0 }, 'workkit#9': { x: 200, y: 0 }, 'omega#4': { x: 400, y: 0 } }),
    );
    assertEq(JSON.stringify(sorted(plan.entered)), JSON.stringify(['omega#4', 'workkit#9']), 'the cards new to the board fade in');
    assertEq(JSON.stringify(plan.left), JSON.stringify(['workkit#2']), 'the card that left fades out');
    assert(!plan.moved.some((move) => ['workkit#2', 'workkit#9', 'omega#4'].includes(move.key)),
      'a card on one side only has no old or new spot to slide between');
  });

  await test('empty maps give an empty plan', () => {
    const plan = motionPlan(new Map(), new Map());
    assertEq(JSON.stringify(plan), JSON.stringify({ moved: [], entered: [], left: [] }), 'nothing moves, enters or leaves');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
