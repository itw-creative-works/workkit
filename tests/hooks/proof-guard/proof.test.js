// Tests for hooks/safety/proof-guard, the PreToolUse hook that holds the proof
// gate (docs/project-state.md § The proof): a flip to `status:complete` and a
// `gh issue close` need a comment starting `Proof:`; a not-planned close passes,
// and an unreachable `gh` fails open.
// The shared prologue (the hook runner, the gh stub, the fixtures) is ./helpers.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  HOOK, cleanup, makeGhStub, ghCalls, dropPathWithoutGh, runHook, WORLD, comments,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

const run = async () => {
  group('proof-guard: the flip to status:complete');

  await test('no Proof: comment, exit 2, naming the issue and the fix', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 9 --remove-label status:qa --add-label status:complete', stub);
    assertEq(code, 2, 'a complete flip with no proof must block');
    assert(stderr.includes('proof-guard'), 'names itself');
    assert(stderr.includes('#9'), `names the issue, got: ${stderr}`);
    assert(stderr.includes('Proof:'), 'names what is missing');
    assert(stderr.includes('skills/feature/SKILL.md'), 'names where the proof is written');
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    assert(isCall(calls[0], 'issue', 'view', '9', '--json', 'comments'), `the comments read, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('a Proof: comment, exit 0', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 7 --remove-label status:qa --add-label status:complete', stub);
    assertEq(code, 0, `a proved item flips, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('the Proof: line inside a longer comment counts', () => {
    const stub = makeGhStub({ field: 'comments', issues: { 4: comments('what to check: the board page\n\nProof: unit: node tests/x.js') } });
    assertEq(runHook('gh issue edit 4 --add-label status:complete', stub).code, 0, 'any line may open with it');
    cleanup(stub.dir);
  });

  await test('a separator inside a quoted value never cuts the clause', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --body "a; b" --add-label status:complete',
      'gh issue edit 9 --body "why it matters | how" --add-label status:complete',
      'gh issue edit 9 --body "don\'t; ship" --add-label status:complete',
    ]) {
      assertEq(runHook(c, stub).code, 2, `the quoted span is data, not a clause break: ${c}`);
    }
    cleanup(stub.dir);
  });

  await test("a redirect's & never cuts the clause before its labels", () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 9 2>&1 --remove-label status:qa --add-label status:complete', stub);
    assertEq(code, 2, `the redirect is not a clause break, so the unproved flip blocks, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('a redirect before or after the issue number never hides it', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 2>&1 9 --add-label status:complete',
      'gh issue edit > /tmp/out 9 --add-label status:complete',
      'gh issue edit 9 --add-label status:complete > /tmp/out',
    ]) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the number after the redirect is the issue, so the unproved flip blocks: ${c}, got: ${stderr}`);
    }
    cleanup(stub.dir);
  });

  await test('a long table body stays fast, gated and ungated alike', () => {
    // Guards the clause walk staying one pass: a per-fragment walk costs about 80
    // times the ungated edit, which never reaches the walk; the bodiless edit bounds
    // the ungated exit, so a walk reached there shows. Rounds interleave all three
    // sides, best of three each, so load lands on every side alike.
    const stub = makeGhStub(WORLD);
    const body = ['| a | b | c |', '|---|---|---|',
      ...Array.from({ length: 100 }, (_, i) => `| row ${i} | value ${i} | note ${i} |`)].join('\n');
    const sides = [
      [`gh issue edit 9 --body "${body}" --add-label status:complete`, 2, 'the unproved issue still bounces, table body and all'],
      [`gh issue edit 9 --body "${body}" --add-label status:building`, 0, 'an ungated edit passes'],
      ['gh issue edit 9 --add-label status:building', 0, 'a bodiless ungated edit passes'],
    ];
    const times = sides.map(() => []);
    for (let round = 0; round < 3; round++) {
      sides.forEach(([command, code, why], i) => {
        const started = Date.now();
        assertEq(runHook(command, stub).code, code, why);
        times[i].push(Date.now() - started);
      });
    }
    const [gated, ungated, bare] = times.map((t) => Math.min(...t));
    const bound = (baseline) => Math.max(10 * baseline, 1000);
    assert(gated <= bound(ungated), `the gated walk stays within ${bound(ungated)}ms, took ${gated}ms (ungated ${ungated}ms)`);
    assert(ungated <= bound(bare), `the ungated exit stays within ${bound(bare)}ms, took ${ungated}ms (no body ${bare}ms)`);
    cleanup(stub.dir);
  });

  await test('a redirect between --add-label and its value is skipped, never read as the label', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --add-label 2>&1 status:complete',
      'gh issue edit 9 --add-label > /tmp/out status:complete',
    ]) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the flip is still to status:complete: ${c}, got: ${stderr}`);
    }
    cleanup(stub.dir);
  });

  await test('a flag named inside a quoted body is data, never the flag', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --body "see --add-label status:complete here"',
      "gh issue edit 9 --body 'x --add-label=status:complete'",
    ]) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `no label is added: ${c}, got: ${stderr}`);
    }
    assertEq(ghCalls(stub).length, 0, `no issue is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('the attached and quoted label spellings are read whole', () => {
    const stub = makeGhStub(WORLD);
    for (const c of ['gh issue edit 9 --add-label=status:complete', 'gh issue edit 9 --add-label "type:bug, status:complete"']) {
      assertEq(runHook(c, stub).code, 2, `the unproved flip blocks: ${c}`);
    }
    for (const c of ["gh issue edit 9 --add-label 'a b'", 'gh issue edit 9 --add-label "x y" status:complete']) {
      assertEq(runHook(c, stub).code, 0, `only the flag's own value is a label: ${c}`);
    }
    cleanup(stub.dir);
  });

  await test('a label list carrying status:complete blocks too', () => {
    const stub = makeGhStub(WORLD);
    assertEq(runHook('gh issue edit 9 --add-label "type:bug,status:complete"', stub).code, 2,
      'the label is read out of the list');
    cleanup(stub.dir);
  });

  await test('any other label flip is not this gate: exit 0, no gh call', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 9 --remove-label status:specced --add-label status:building',
      'gh issue edit 9 --remove-label status:complete --add-label status:inbox',
      'gh issue edit 9 --remove-label status:qa --add-label status:building',
      'gh issue edit 9 --add-assignee @me',
    ]) {
      const out = runHook(c, stub);
      assertEq(out.code, 0, `must pass: ${c}`);
      assertEq(out.stdout, '', `no notice, since nothing ran: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `no issue is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  group('proof-guard: the close');

  await test('closing an issue with no Proof: comment, exit 2', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 9 --comment "shipped in 0.54.0"', stub);
    assertEq(code, 2, 'a close with no proof must block');
    assert(stderr.includes('be closed'), `names what it blocked, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('closing a proved issue, exit 0', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 7', stub);
    assertEq(code, 0, `a proved item closes, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('--reason "not planned" passes, in every quoting', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue close 9 --reason "not planned"',
      "gh issue close 9 --reason 'not planned'",
      'gh issue close 9 --reason=not\\ planned',
      'gh issue close 9 -r "not planned"',
      'gh issue close 9 --duplicate-of 7',
    ]) {
      assertEq(runHook(c, stub).code, 0, `nothing was built, so nothing is proved: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `a never-built close reads nothing, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('--reason completed is gated like a bare close', () => {
    const stub = makeGhStub(WORLD);
    assertEq(runHook('gh issue close 9 --reason completed', stub).code, 2, 'completed means built');
    cleanup(stub.dir);
  });

  group('proof-guard: scope and cross-repo');

  await test('unrelated gh commands: exit 0, no gh call', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue list --label status:complete',
      'gh issue view 9 --json comments',
      'gh issue comment 9 --body "Proof: unit: node tests/x.js"',
      'gh pr merge 9 --squash',
      'echo "gh issue close 9"',
    ]) {
      assertEq(runHook(c, stub).code, 0, `must pass: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `nothing is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('--repo rides the read in every spelling, so a cross-repo flip asks its own issue', () => {
    for (const flag of ['--repo owner/name', '--repo=owner/name', '-R owner/name', '-Rowner/name', '--repo "owner/name"']) {
      const stub = makeGhStub(WORLD);
      const { code } = runHook(`gh issue edit 9 ${flag} --add-label status:complete`, stub);
      assertEq(code, 2, `the issue is still unproved: ${flag}`);
      const calls = ghCalls(stub);
      assert(isCall(calls[0], 'issue', 'view', '9', '--repo', 'owner/name', '--json', 'comments'),
        `the repo is forwarded for ${flag}, got: ${fmtCalls(calls)}`);
      cleanup(stub.dir);
    }
  });

  await test('a redirect between --repo and its value is skipped, never read as the repo', () => {
    for (const c of [
      'gh issue edit 9 --add-label status:complete --repo 2>&1 owner/name',
      'gh issue edit 9 --add-label status:complete -R > /tmp/out owner/name',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the issue is still unproved: ${c}, got: ${stderr}`);
      const calls = ghCalls(stub);
      assert(isCall(calls[0], 'issue', 'view', '9', '--repo', 'owner/name', '--json', 'comments'),
        `the repo after the redirect is forwarded for ${c}, got: ${fmtCalls(calls)}`);
      cleanup(stub.dir);
    }
  });

  await test('a -R named in a body before the real --repo never takes its place', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 9 --body "pass -R other/repo" --repo owner/name --add-label status:complete', stub);
    assertEq(code, 2, `the issue is still unproved, got: ${stderr}`);
    const calls = ghCalls(stub);
    assert(isCall(calls[0], 'issue', 'view', '9', '--repo', 'owner/name', '--json', 'comments'),
      `the real repo is asked, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('a body that mentions -R is not the flag: the issue is read locally and blocks', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 9 --body "pass it with -R when needed" --add-label status:complete', stub);
    assertEq(code, 2, `the unproved issue blocks, got: ${stderr}`);
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    assert(isCall(calls[0], 'issue', 'view', '9', '--json', 'comments'), `no --repo forwarded, got: ${fmtCalls(calls)}`);
    assert(!calls[0].includes('--repo'), `the local repo answers, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('a --repo value the guard cannot read stands the gate down, never reads the local repo', () => {
    for (const c of [
      'gh issue close 9 --repo "$TARGET_REPO"',
      'gh issue edit 9 -R "$(gh repo view --json nameWithOwner -q .nameWithOwner)" --add-label status:complete',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `an unreadable repo fails open: ${c}`);
      assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
      assertEq(ghCalls(stub).length, 0, `the local repo is never asked instead, got: ${fmtCalls(ghCalls(stub))}`);
      cleanup(stub.dir);
    }
  });

  await test('the issue number is read past the flags', () => {
    for (const c of [
      'gh issue edit --add-label status:complete 9',
      'gh issue edit -R owner/name 9 --add-label status:complete',
      'gh issue close --comment done 9',
      'gh issue close https://github.com/owner/name/issues/9',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the unproved issue is judged: ${c}, got: ${stderr}`);
      assert(stderr.includes('#9'), `names it: ${c}, got: ${stderr}`);
      cleanup(stub.dir);
    }
  });

  await test('every issue in a compound is judged', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue close 7 && gh issue close 9', stub);
    assertEq(code, 2, 'the unproved half of the compound blocks it');
    assert(stderr.includes('#9'), `names the unproved one, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test("the read runs from the session's directory, where the command would", () => {
    const stub = makeGhStub(WORLD);
    const here = mkTmp('proof-guard-');
    assertEq(runHook('gh issue close 9', stub, here).code, 2, 'the unproved issue still blocks');
    assertEq(fs.readFileSync(stub.cwdFile, 'utf8').trim(), shellPath(here),
      'an issue number with no --repo resolves against the session directory, so the read asks from there');
    cleanup(here);
    cleanup(stub.dir);
  });

  await test('a directory change before a gated close or complete flip bounces, reading no issue', () => {
    for (const c of [
      'cd /somewhere/else && gh issue close 7',
      'pushd /somewhere/else >/dev/null && gh issue close 7',
      'popd && gh issue edit 7 --add-label status:complete',
      '(cd /somewhere/else && gh issue edit 7 --add-label status:complete)',
      'cd /somewhere/else && gh issue close https://github.com/a/b/issues/7',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the proved issue still bounces, the tree unplaced: ${c}, got: ${stderr}`);
      assert(stderr.includes('changes directory') && stderr.includes('own Bash call'),
        `names the directory change and the fix: ${c}, got: ${stderr}`);
      assertEq(ghCalls(stub).length, 0, `reads no issue: ${c}`);
      cleanup(stub.dir);
    }
  });

  await test('a directory change beside a close the gate does not read, or after the gated one, passes', () => {
    for (const c of [
      'cd /somewhere/else && gh issue close 7 --reason "not planned"',
      'gh issue close 7 && cd /somewhere/else',
      'cd /somewhere/else && gh issue close $N',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `must pass: ${c}, got: ${stderr}`);
      cleanup(stub.dir);
    }
  });

  group('proof-guard: wiring and fail-open');

  await test('hooks.json registers the guard under PreToolUse Bash', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    assert(bash.hooks.some((h) => h.command.includes('safety:proof-guard')),
      'the Bash block routes safety:proof-guard through the loader');
  });

  await test('gh not on PATH: exit 0, and says the gate did not run', () => {
    const { code, stderr } = runHook('gh issue close 9', null);
    assertEq(code, 0, 'an unreachable gh never wedges the session');
    assert(stderr.includes('proof-guard'), 'names itself');
    assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
  });

  await test('a gh view that fails: exit 0, and says the gate did not run', () => {
    const stub = makeGhStub({ fails: true });
    const { code, stderr } = runHook('gh issue edit 9 --add-label status:complete', stub);
    assertEq(code, 0, 'a failing view fails open');
    assert(stderr.includes('did not run'), `says the gate stood down, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('missing command, exit 0', () => {
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ tool_input: {} }),
      env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'no command means fail open');
  });

  await test('malformed JSON, exit 0', () => {
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: 'not json',
      env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
