// Tests for safety:proof-guard's proof gate, proofVerdict in
// hooks/mods/proof-guard.js over steps: a complete flip and a close need a
// `Proof:` line; an unreadable view fails open. How a command or an argv spells its steps (quoting, redirects,
// the --repo spellings, a never-built close's reason) is the caller's: the
// shim's gate (test/scripts/identity/gate.test.js, gh-shim.test.js), and the
// wiring is gh-shim.test.js's.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  WORLD, comments, viewer, step, judge, denyOf, textOf, BLOCK, SKIPPED, assertBlocks, passText,
} = require('./helpers');

const COMPLETE = 'move to status:complete';
const CLOSE = 'be closed';

// One verdict over `steps` read through a fresh view stub; hands back both.
const judged = async (steps, views = WORLD, opts = {}, over = {}) => {
  const view = viewer(views, opts);
  const r = await judge(steps, { issueView: view.issueView, ...over });
  return { r, calls: view.calls };
};

const complete = (n, remove = ['status:qa']) => [step('edit', n, ['status:complete'], remove)];

const cases = async () => {
  group('proof-guard: the flip to status:complete');

  await test('no Proof: comment, exit 2, naming the issue and the fix: one comments read of #9', async () => {
    const { r, calls } = await judged(complete(9));
    assertBlocks(r, BLOCK(9, COMPLETE), 'a complete flip with no proof blocks');
    assertEq(JSON.stringify(calls), JSON.stringify([['9', null]]), 'exactly one read, of #9, from the session repo');
  });

  await test('a Proof: comment, exit 0', async () => {
    const { r } = await judged(complete(7));
    passText(r, 'a proved item flips');
  });

  await test('the Proof: line inside a longer comment counts', async () => {
    const { r } = await judged(complete(4, []),
      { 4: { comments: comments('what to check: the board page\n\nProof: unit: node tests/x.js') } });
    passText(r, 'any line may open with it');
  });

  await test('any other label flip is not this gate: exit 0, no gh call', async () => {
    for (const s of [
      step('edit', 9, ['status:building'], ['status:specced']),
      step('edit', 9, ['status:inbox'], ['status:complete']),
      step('edit', 9, ['status:building'], ['status:qa']),
      step('edit', 9),
    ]) {
      const { r, calls } = await judged([s]);
      assertEq(passText(r, JSON.stringify(s)), '', `no notice, since nothing ran: ${JSON.stringify(s)}`);
      assertEq(calls.length, 0, `no issue is read: ${JSON.stringify(s)}`);
    }
  });

  group('proof-guard: the close');

  await test('closing an issue with no Proof: comment, exit 2', async () => {
    assertBlocks((await judged([step('close', 9)])).r, BLOCK(9, CLOSE), 'a close with no proof blocks');
  });

  await test('closing a proved issue, exit 0', async () => {
    passText((await judged([step('close', 7)])).r, 'a proved item closes');
  });

  group('proof-guard: scope and cross-repo');

  await test('--repo rides the read, so a cross-repo flip asks its own issue', async () => {
    const { r, calls } = await judged(complete(9, []), WORLD, {}, { repo: 'owner/name' });
    assertBlocks(r, BLOCK(9, COMPLETE), 'the issue is still unproved');
    assertEq(JSON.stringify(calls), JSON.stringify([['9', 'owner/name']]), 'the repo is forwarded');
  });

  await test('every issue in a compound is judged', async () => {
    assertBlocks((await judged([step('close', 7), step('close', 9)])).r, BLOCK(9, CLOSE), 'the unproved half blocks it');
  });

  group('proof-guard: wiring and fail-open');

  await test('a gh view that fails: exit 0, and says the gate did not run: the notice, no deny', async () => {
    const { r } = await judged(complete(9, []), WORLD, { fails: true });
    assertEq(passText(r, 'a failing view fails open'), SKIPPED(9), 'says the gate stood down');
  });

  await test('missing command, exit 0: no steps', async () => {
    const { r, calls } = await judged([]);
    assertEq(denyOf(r), null, 'no steps means fail open');
    assertEq(textOf(r), '', 'silently');
    assertEq(calls.length, 0, 'reads nothing');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
