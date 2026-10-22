// Tests for safety:proof-guard's proof gate, proofGuardVerdict in
// hooks/mods/proof-guard.js: a complete flip and a close need a `Proof:` line;
// a never-built close passes, an unreadable view fails open. Each case ports
// the HEAD case its name quotes. Dropped with the shell spawn: "malformed JSON"
// and the timing half of "a long table body stays fast". In
// tests/mods/guards-proof-guard.test.ts: the read's folder, the loader's quoted
// comment and "gh not on PATH".

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const {
  WORLD, comments, viewer, judge, denyOf, textOf, BLOCK, UNREAD, CD_BOUNCE, SKIPPED, assertBlocks, passText,
} = require('./helpers');

const COMPLETE = 'move to status:complete';
const CLOSE = 'be closed';

// One verdict over `command` read through a fresh view stub; hands back both.
const judged = async (command, views = WORLD, opts = {}) => {
  const view = viewer(views, opts);
  const r = await judge(command, { issueView: view.issueView });
  return { r, calls: view.calls };
};

const run = async () => {
  group('proof-guard: the flip to status:complete');

  await test('ports "no Proof: comment, exit 2, naming the issue and the fix": one comments read of #9', async () => {
    const { r, calls } = await judged('gh issue edit 9 --remove-label status:qa --add-label status:complete');
    assertBlocks(r, BLOCK(9, COMPLETE), 'a complete flip with no proof blocks');
    assertEq(JSON.stringify(calls), JSON.stringify([['9', null]]), 'exactly one read, of #9, from the session repo');
  });

  await test('ports "a Proof: comment, exit 0"', async () => {
    const { r } = await judged('gh issue edit 7 --remove-label status:qa --add-label status:complete');
    passText(r, 'a proved item flips');
  });

  await test('ports "the Proof: line inside a longer comment counts"', async () => {
    const { r } = await judged('gh issue edit 4 --add-label status:complete',
      { 4: { comments: comments('what to check: the board page\n\nProof: unit: node tests/x.js') } });
    passText(r, 'any line may open with it');
  });

  await test('ports "a separator inside a quoted value never cuts the clause"', async () => {
    for (const c of [
      'gh issue edit 9 --body "a; b" --add-label status:complete',
      'gh issue edit 9 --body "why it matters | how" --add-label status:complete',
      'gh issue edit 9 --body "don\'t; ship" --add-label status:complete',
    ]) {
      assertBlocks((await judged(c)).r, BLOCK(9, COMPLETE), `the quoted span is data: ${c}`);
    }
  });

  await test('ports "a redirect\'s & never cuts the clause before its labels"', async () => {
    assertBlocks((await judged('gh issue edit 9 2>&1 --remove-label status:qa --add-label status:complete')).r,
      BLOCK(9, COMPLETE), 'the redirect is not a clause break');
  });

  await test('ports "a redirect before or after the issue number never hides it"', async () => {
    for (const c of [
      'gh issue edit 2>&1 9 --add-label status:complete',
      'gh issue edit > /tmp/out 9 --add-label status:complete',
      'gh issue edit 9 --add-label status:complete > /tmp/out',
    ]) {
      assertBlocks((await judged(c)).r, BLOCK(9, COMPLETE), `the number after the redirect is the issue: ${c}`);
    }
  });

  await test('ports "a long table body stays fast, gated and ungated alike": the gated table body blocks, the ungated passes', async () => {
    const body = ['| a | b | c |', '|---|---|---|',
      ...Array.from({ length: 100 }, (_, i) => `| row ${i} | value ${i} | note ${i} |`)].join('\n');
    assertBlocks((await judged(`gh issue edit 9 --body "${body}" --add-label status:complete`)).r,
      BLOCK(9, COMPLETE), 'the unproved issue still bounces, table body and all');
    const ungated = await judged(`gh issue edit 9 --body "${body}" --add-label status:building`);
    assertEq(passText(ungated.r, 'an ungated edit'), '', 'silently');
    assertEq(ungated.calls.length, 0, 'an ungated edit reads nothing');
  });

  await test('ports "a redirect between --add-label and its value is skipped, never read as the label"', async () => {
    for (const c of [
      'gh issue edit 9 --add-label 2>&1 status:complete',
      'gh issue edit 9 --add-label > /tmp/out status:complete',
    ]) {
      assertBlocks((await judged(c)).r, BLOCK(9, COMPLETE), `the flip is still to status:complete: ${c}`);
    }
  });

  await test('ports "a flag named inside a quoted body is data, never the flag"', async () => {
    for (const c of [
      'gh issue edit 9 --body "see --add-label status:complete here"',
      "gh issue edit 9 --body 'x --add-label=status:complete'",
    ]) {
      const { r, calls } = await judged(c);
      assertEq(passText(r, c), '', `no label is added, silently: ${c}`);
      assertEq(calls.length, 0, `no issue is read: ${c}`);
    }
  });

  await test('ports "the attached and quoted label spellings are read whole"', async () => {
    for (const c of ['gh issue edit 9 --add-label=status:complete', 'gh issue edit 9 --add-label "type:bug, status:complete"']) {
      assertBlocks((await judged(c)).r, BLOCK(9, COMPLETE), `the unproved flip blocks: ${c}`);
    }
    for (const c of ["gh issue edit 9 --add-label 'a b'", 'gh issue edit 9 --add-label "x y" status:complete']) {
      passText((await judged(c)).r, `only the flag's own value is a label: ${c}`);
    }
  });

  await test('ports "a label list carrying status:complete blocks too"', async () => {
    assertBlocks((await judged('gh issue edit 9 --add-label "type:bug,status:complete"')).r,
      BLOCK(9, COMPLETE), 'the label is read out of the list');
  });

  await test('ports "any other label flip is not this gate: exit 0, no gh call"', async () => {
    for (const c of [
      'gh issue edit 9 --remove-label status:specced --add-label status:building',
      'gh issue edit 9 --remove-label status:complete --add-label status:inbox',
      'gh issue edit 9 --remove-label status:qa --add-label status:building',
      'gh issue edit 9 --add-assignee @me',
    ]) {
      const { r, calls } = await judged(c);
      assertEq(passText(r, c), '', `no notice, since nothing ran: ${c}`);
      assertEq(calls.length, 0, `no issue is read: ${c}`);
    }
  });

  group('proof-guard: the close');

  await test('ports "closing an issue with no Proof: comment, exit 2"', async () => {
    assertBlocks((await judged('gh issue close 9 --comment "shipped in 0.54.0"')).r, BLOCK(9, CLOSE), 'a close with no proof blocks');
  });

  await test('ports "closing a proved issue, exit 0"', async () => {
    passText((await judged('gh issue close 7')).r, 'a proved item closes');
  });

  await test('ports "--reason \\"not planned\\" passes, in every quoting": and --duplicate-of, reading nothing', async () => {
    for (const c of [
      'gh issue close 9 --reason "not planned"',
      "gh issue close 9 --reason 'not planned'",
      'gh issue close 9 --reason=not\\ planned',
      'gh issue close 9 -r "not planned"',
      'gh issue close 9 --duplicate-of 7',
    ]) {
      const { r, calls } = await judged(c);
      passText(r, `nothing was built, so nothing is proved: ${c}`);
      assertEq(calls.length, 0, `a never-built close reads nothing: ${c}`);
    }
  });

  await test('ports "--reason completed is gated like a bare close"', async () => {
    assertBlocks((await judged('gh issue close 9 --reason completed')).r, BLOCK(9, CLOSE), 'completed means built');
  });

  group('proof-guard: scope and cross-repo');

  await test('ports "unrelated gh commands: exit 0, no gh call"', async () => {
    for (const c of [
      'gh issue list --label status:complete',
      'gh issue view 9 --json comments',
      'gh issue comment 9 --body "Proof: unit: node tests/x.js"',
      'gh pr merge 9 --squash',
      'echo "gh issue close 9"',
    ]) {
      const { r, calls } = await judged(c);
      assertEq(passText(r, c), '', `silently: ${c}`);
      assertEq(calls.length, 0, `nothing is read: ${c}`);
    }
  });

  await test('ports "--repo rides the read in every spelling, so a cross-repo flip asks its own issue"', async () => {
    for (const flag of ['--repo owner/name', '--repo=owner/name', '-R owner/name', '-Rowner/name', '--repo "owner/name"']) {
      const { r, calls } = await judged(`gh issue edit 9 ${flag} --add-label status:complete`);
      assertBlocks(r, BLOCK(9, COMPLETE), `the issue is still unproved: ${flag}`);
      assertEq(JSON.stringify(calls), JSON.stringify([['9', 'owner/name']]), `the repo is forwarded for ${flag}`);
    }
  });

  await test('ports "a redirect between --repo and its value is skipped, never read as the repo"', async () => {
    for (const c of [
      'gh issue edit 9 --add-label status:complete --repo 2>&1 owner/name',
      'gh issue edit 9 --add-label status:complete -R > /tmp/out owner/name',
    ]) {
      const { r, calls } = await judged(c);
      assertBlocks(r, BLOCK(9, COMPLETE), `the issue is still unproved: ${c}`);
      assertEq(JSON.stringify(calls), JSON.stringify([['9', 'owner/name']]), `the repo after the redirect is forwarded: ${c}`);
    }
  });

  await test('ports "a -R named in a body before the real --repo never takes its place"', async () => {
    const { r, calls } = await judged('gh issue edit 9 --body "pass -R other/repo" --repo owner/name --add-label status:complete');
    assertBlocks(r, BLOCK(9, COMPLETE), 'the issue is still unproved');
    assertEq(JSON.stringify(calls), JSON.stringify([['9', 'owner/name']]), 'the real repo is asked');
  });

  await test('ports "a body that mentions -R is not the flag: the issue is read locally and blocks"', async () => {
    const { r, calls } = await judged('gh issue edit 9 --body "pass it with -R when needed" --add-label status:complete');
    assertBlocks(r, BLOCK(9, COMPLETE), 'the unproved issue blocks');
    assertEq(JSON.stringify(calls), JSON.stringify([['9', null]]), 'one read, no repo forwarded');
  });

  await test('ports "a --repo value the guard cannot read blocks, asking for owner/name, and reads no repo"', async () => {
    for (const c of [
      'gh issue edit 7 --repo "$R" --add-label status:complete',
      'gh issue close 7 --repo "$R"',
      'gh issue close 7 --repo "$TARGET_REPO"',
      'gh issue edit 7 -R "$(gh repo view --json nameWithOwner -q .nameWithOwner)" --add-label status:complete',
    ]) {
      const { r, calls } = await judged(c);
      assertBlocks(r, UNREAD, `an unreadable repo blocks: ${c}`);
      assertEq(calls.length, 0, `no repo is read, the local one included: ${c}`);
    }
  });

  await test('ports "the issue number is read past the flags"', async () => {
    for (const [c, what] of [
      ['gh issue edit --add-label status:complete 9', COMPLETE],
      ['gh issue edit -R owner/name 9 --add-label status:complete', COMPLETE],
      ['gh issue close --comment done 9', CLOSE],
      ['gh issue close https://github.com/owner/name/issues/9', CLOSE],
    ]) {
      assertBlocks((await judged(c)).r, BLOCK(9, what), `the unproved issue is judged: ${c}`);
    }
  });

  await test('ports "every issue in a compound is judged"', async () => {
    assertBlocks((await judged('gh issue close 7 && gh issue close 9')).r, BLOCK(9, CLOSE), 'the unproved half blocks it');
  });

  await test('ports "a directory change before a gated close or complete flip bounces, reading no issue"', async () => {
    for (const c of [
      'cd /somewhere/else && gh issue close 7',
      'pushd /somewhere/else >/dev/null && gh issue close 7',
      'popd && gh issue edit 7 --add-label status:complete',
      '(cd /somewhere/else && gh issue edit 7 --add-label status:complete)',
      'cd /somewhere/else && gh issue close https://github.com/a/b/issues/7',
    ]) {
      const { r, calls } = await judged(c);
      assertBlocks(r, CD_BOUNCE, `the proved issue still bounces, the tree unplaced: ${c}`);
      assertEq(calls.length, 0, `reads no issue: ${c}`);
    }
  });

  await test('ports "a directory change beside a close the gate does not read, or after the gated one, passes"', async () => {
    for (const c of [
      'cd /somewhere/else && gh issue close 7 --reason "not planned"',
      'gh issue close 7 && cd /somewhere/else',
      'cd /somewhere/else && gh issue close $N',
    ]) {
      passText((await judged(c)).r, c);
    }
  });

  group('proof-guard: wiring and fail-open');

  await test('ports "hooks.json registers the guard under PreToolUse Bash": BASH_GUARDS runs it after tree-guard', async () => {
    const hooks = mods('guards').BASH_GUARDS.map((g) => g.hook);
    const at = hooks.indexOf('safety:proof-guard');
    assert(at > hooks.indexOf('safety:tree-guard') && hooks.indexOf('safety:tree-guard') >= 0,
      `the Bash chain holds safety:proof-guard after safety:tree-guard, got: ${hooks.join(', ')}`);
  });

  await test('ports "a gh view that fails: exit 0, and says the gate did not run": the notice, no deny', async () => {
    const { r } = await judged('gh issue edit 9 --add-label status:complete', WORLD, { fails: true });
    assertEq(passText(r, 'a failing view fails open'), SKIPPED(9), 'says the gate stood down');
  });

  await test('ports "missing command, exit 0"', async () => {
    const { r, calls } = await judged('');
    assertEq(denyOf(r), null, 'no command means fail open');
    assertEq(textOf(r), '', 'silently');
    assertEq(calls.length, 0, 'reads nothing');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
