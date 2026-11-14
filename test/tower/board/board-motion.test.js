//
// Tests for the tower dashboard's board-motion.js: where each Board card moves
// between two repaints. The lib loader is ../app/helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { load } = require('../app/helpers');

/** A map of `data-issue` to the card's on-screen spot, as the page measures it. */
const spots = (entries) => new Map(Object.entries(entries));

const sorted = (keys) => [...keys].sort();

describe('tower/board: motion - where each card moves between repaints', () => {
  let motionPlan;
  before(async () => { ({ motionPlan } = await load('board-motion.js')); });

  test('a card at the same spot is not in moved', () => {
    const plan = motionPlan(
      spots({ 'workkit#1': { x: 10, y: 20 }, 'workkit#2': { x: 300, y: 40 } }),
      spots({ 'workkit#1': { x: 10, y: 20 }, 'workkit#2': { x: 300, y: 140 } }),
    );
    expect(!plan.moved.some((move) => move.key === 'workkit#1'), 'a card that stayed put does not slide').toBeTruthy();
    expect(plan.moved.length, 'only the card whose spot changed is in moved').toBe(1);
    expect(plan.entered.length, 'a card on both sides never enters').toBe(0);
    expect(plan.left.length, 'and never leaves').toBe(0);
  });

  test('a moved card\'s dx and dy are its old spot minus its new one', () => {
    const plan = motionPlan(
      spots({ 'workkit#7': { x: 40, y: 500 }, 'omega#3': { x: 900, y: 60 } }),
      spots({ 'workkit#7': { x: 340, y: 120 }, 'omega#3': { x: 100, y: 60 } }),
    );
    const right = plan.moved.find((move) => move.key === 'workkit#7');
    expect(right, 'the card that changed column is in moved').toBeTruthy();
    expect(right.dx, 'dx is old x minus new x, so the card starts back where it was').toBe(-300);
    expect(right.dy, 'dy is old y minus new y').toBe(380);
    const left = plan.moved.find((move) => move.key === 'omega#3');
    expect(left, 'a move to the left is a move too').toBeTruthy();
    expect(left.dx, 'old x minus new x, positive for a leftward move').toBe(800);
    expect(left.dy, 'and a spot unchanged on one axis is zero on that axis').toBe(0);
  });

  test('a key only in after is entered, a key only in before is left', () => {
    const plan = motionPlan(
      spots({ 'workkit#1': { x: 0, y: 0 }, 'workkit#2': { x: 0, y: 100 } }),
      spots({ 'workkit#1': { x: 0, y: 0 }, 'workkit#9': { x: 200, y: 0 }, 'omega#4': { x: 400, y: 0 } }),
    );
    expect(JSON.stringify(sorted(plan.entered)), 'the cards new to the board fade in').toBe(JSON.stringify(['omega#4', 'workkit#9']));
    expect(JSON.stringify(plan.left), 'the card that left fades out').toBe(JSON.stringify(['workkit#2']));
    expect(!plan.moved.some((move) => ['workkit#2', 'workkit#9', 'omega#4'].includes(move.key)),
      'a card on one side only has no old or new spot to slide between').toBeTruthy();
  });

  test('empty maps give an empty plan', () => {
    const plan = motionPlan(new Map(), new Map());
    expect(JSON.stringify(plan), 'nothing moves, enters or leaves').toBe(JSON.stringify({ moved: [], entered: [], left: [] }));
  });
});
