/**
 * hooks/mods/commit-gate/budget.js: the root run's time budget as check 5
 * says it: the `test-budget:` line when the recorded run took longer than
 * `tests.budget`, the whole minutes a repo allows its root `npm test`.
 */

const MINUTE_MS = 60000;

/**
 * The `test-budget:` line, or null when the run kept to its budget, no budget
 * is set, or the record carries no wall time. Minutes round up, so a run past
 * its budget never reads as equal to it.
 * @param {number|null} ms the recorded root run's wall time
 * @param {*} budget the `tests.budget` setting as read, whole minutes
 * @returns {string|null}
 */
export function budgetLine(ms, budget) {
  const minutes = Number(budget);
  if (ms === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (ms <= minutes * MINUTE_MS) return null;
  return `test-budget: the root run took ${Math.ceil(ms / MINUTE_MS)}m, the budget is ${minutes}m`;
}
