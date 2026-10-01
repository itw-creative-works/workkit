// Tests for hooks/safety/spec-guard, the PreToolUse hook that holds the Spec's
// Contract (docs/project-state.md § Specs): a flip to `status:specced` needs a
// `## Spec` that is the small-item line or carries a `### Contract` heading; an
// unreachable `gh` fails open, and a flip behind a directory change bounces.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../lib/platform');
const { isCall, fmtCalls } = require('../lib/argv-log');
const {
  cleanup, makeGhStub, ghCalls, dropPathWithoutGh, hookRunner,
} = require('../lib/gh-stub');
const { mkTmp } = require('../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'spec-guard', 'run.sh');
const runHook = hookRunner(HOOK);

const BLOCK = (n) => `spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`;
const BODY_EDIT = (n) => `spec-guard: BLOCKED this flip: #${n} edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip.`;
const SKIPPED = (n) => new RegExp(`^spec-guard: could not read issue #${n} \\(.+\\), so the spec gate did not run on this command\\.$`);
// The directory-change bounce proof-guard gives, under this hook's name.
const CD_BOUNCE = 'spec-guard: BLOCKED this command. It changes directory (cd, pushd or popd) before a gated gh issue flip or close, so the gate cannot tell which tree and repo that command acts on. Run the cd in its own Bash call first, then the gh command alone; where the directory resets between calls (a subagent), run the flip from a session whose directory is that repo.';

// 12 the small item, 13 a Contract, 14 a written Spec with none, 15 no Spec at
// all, 16 a Contract heading outside the Spec, 17 the small item in CRLF, 18 a
// Contract after a fenced example holding a `## ` line.
const WORLD = {
  field: 'body',
  issues: {
    12: '## Description\n\nA typo.\n\n## Spec\n\nNone needed: small item.\n',
    13: '## Description\n\nX.\n\n## Spec\n\nBuild the thing.\n\n### Contract\n\nFiles: `a.js`\n\nNames:\n- `a()`\n\nCases:\n- given 1, then 2\n',
    14: '## Description\n\nX.\n\n## Spec\n\nBuild the thing, carefully.\n\n## Notes\n\nnone\n',
    15: '## Description\n\nJust a description.\n',
    16: '## Description\n\n### Contract\n\nin the wrong place\n\n## Spec\n\nBuild it.\n',
    17: '## Description\r\n\r\nX.\r\n\r\n## Spec\r\n\r\nNone needed: small item.\r\n',
    18: '## Spec\n\nThe page reads:\n\n```md\n## Example heading\n```\n\n### Contract\n\nFiles: `a.js`\n\n## Notes\n\nnone\n',
  },
};

const FLIP = (n) => `gh issue edit ${n} --remove-label status:inbox --add-label status:specced`;

const run = async () => {
  group('spec-guard: the flip to status:specced');

  await test('the small-item Spec passes, silently', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(12), stub);
    assertEq(code, 0, `the small item flips, got: ${stderr}`);
    assertEq(stderr, '', 'nothing said on a pass');
    const calls = ghCalls(stub);
    assertEq(calls.length, 1, `exactly one gh call, got: ${fmtCalls(calls)}`);
    assert(isCall(calls[0], 'issue', 'view', '12', '--json', 'body'), `the body read, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('a Spec carrying ### Contract passes', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(13), stub);
    assertEq(code, 0, `a contracted Spec flips, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('a written Spec with no ### Contract blocks, with the exact line', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(14), stub);
    assertEq(code, 2, 'a written Spec with no Contract must block');
    assertEq(stderr.trim(), BLOCK(14), 'the block line');
    cleanup(stub.dir);
  });

  await test('a body with no ## Spec section blocks', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(15), stub);
    assertEq(code, 2, 'no Spec reads as a written Spec with no Contract');
    assertEq(stderr.trim(), BLOCK(15), 'the block line');
    cleanup(stub.dir);
  });

  await test('a ### Contract outside the Spec section does not count', () => {
    const stub = makeGhStub(WORLD);
    assertEq(runHook(FLIP(16), stub).code, 2, 'only the Spec section is read');
    cleanup(stub.dir);
  });

  await test('a CRLF body reads like an LF one', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(17), stub);
    assertEq(code, 0, `the small item in CRLF flips, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('a fenced ## line inside the Spec does not end it', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(FLIP(18), stub);
    assertEq(code, 0, `the Contract after the fenced example counts, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('a body edit in the flipping clause blocks, reading no issue', () => {
    for (const flag of ['--body "Spec: None needed: small item."', '--body=x', '-b x', '--body-file spec.md', '-F spec.md']) {
      const stub = makeGhStub(WORLD);
      const c = `gh issue edit 12 ${flag} --add-label status:specced`;
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the read would judge the old body: ${c}`);
      assertEq(stderr.trim(), BODY_EDIT(12), `the body-edit line: ${c}`);
      assertEq(ghCalls(stub).length, 0, `reads no issue: ${c}`);
      cleanup(stub.dir);
    }
  });

  await test('the issue number is read past the flags, and off an issue URL', () => {
    for (const c of [
      'gh issue edit -R owner/name 14 --add-label status:specced',
      'gh issue edit --add-label status:specced 14',
      'gh issue edit https://github.com/owner/name/issues/14 --add-label status:specced',
      'gh issue edit --milestone 12 --add-label status:specced 14',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the uncontracted issue is judged: ${c}, got: ${stderr}`);
      assertEq(stderr.trim(), BLOCK(14), `the block line: ${c}`);
      const calls = ghCalls(stub);
      assertEq(calls.length, 1, `one read, of #14 alone (a flag's value is no issue): ${c}, got: ${fmtCalls(calls)}`);
      assert(calls[0].includes('14'), `the read names #14: ${fmtCalls(calls)}`);
      cleanup(stub.dir);
    }
  });

  await test('the attached and listed label spellings are judged the same', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 14 --add-label=status:specced',
      'gh issue edit 14 --add-label "priority:high,status:specced"',
      "gh issue edit 14 --add-label 'status:inbox, status:specced'",
    ]) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the uncontracted flip blocks: ${c}`);
      assertEq(stderr.trim(), BLOCK(14), `the block line: ${c}`);
    }
    for (const c of ['gh issue edit 12 --add-label=status:specced', 'gh issue edit 13 --add-label "priority:high,status:specced"']) {
      assertEq(runHook(c, stub).code, 0, `the passing bodies still pass: ${c}`);
    }
    cleanup(stub.dir);
  });

  await test('an edit that adds no status:specced passes untouched, reading nothing', () => {
    const stub = makeGhStub(WORLD);
    for (const c of [
      'gh issue edit 14 --add-label priority:high',
      'gh issue edit 14 --remove-label status:specced --add-label status:building',
      'gh issue edit 14 --body "flip it with --add-label status:specced later"',
    ]) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `must pass: ${c}`);
      assertEq(stderr, '', `nothing said: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `no issue is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test('other commands pass untouched', () => {
    const stub = makeGhStub(WORLD);
    for (const c of ['gh issue comment 14 --body "x"', 'ls', 'echo "gh issue edit 14 --add-label status:specced"']) {
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 0, `must pass: ${c}`);
      assertEq(stderr, '', `nothing said: ${c}`);
    }
    assertEq(ghCalls(stub).length, 0, `nothing is read, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  group('spec-guard: repo and compound');

  await test("an issue URL's repo rides the read, never the session's", () => {
    const stub = makeGhStub(WORLD);
    const { code } = runHook('gh issue edit https://github.com/owner/name/issues/14 --add-label status:specced', stub);
    assertEq(code, 2, 'the issue still has no Contract');
    const calls = ghCalls(stub);
    assert(isCall(calls[0], 'issue', 'view', '14', '--repo', 'owner/name', '--json', 'body'),
      `the URL's repo is forwarded, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('--repo rides the read in every spelling', () => {
    for (const flag of ['--repo owner/name', '--repo=owner/name', '-R owner/name', '-Rowner/name', '--repo "owner/name"']) {
      const stub = makeGhStub(WORLD);
      const { code } = runHook(`gh issue edit 14 ${flag} --add-label status:specced`, stub);
      assertEq(code, 2, `the issue still has no Contract: ${flag}`);
      const calls = ghCalls(stub);
      assert(isCall(calls[0], 'issue', 'view', '14', '--repo', 'owner/name', '--json', 'body'),
        `the repo is forwarded for ${flag}, got: ${fmtCalls(calls)}`);
      cleanup(stub.dir);
    }
  });

  await test('a --repo value the guard cannot read fails open, never reads the local repo', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 14 --repo "$TARGET" --add-label status:specced', stub);
    assertEq(code, 0, 'an unreadable repo fails open');
    assert(SKIPPED(14).test(stderr.trim()), `one stand-down line, got: ${stderr}`);
    assertEq(ghCalls(stub).length, 0, `the local repo is never asked instead, got: ${fmtCalls(ghCalls(stub))}`);
    cleanup(stub.dir);
  });

  await test("the read runs in the session's directory, where the flip would", () => {
    const stub = makeGhStub(WORLD);
    const here = mkTmp('spec-guard-');
    assertEq(runHook(FLIP(14), stub, here).code, 2, 'the uncontracted issue still blocks');
    assertEq(fs.readFileSync(stub.cwdFile, 'utf8').trim(), shellPath(here),
      'an issue number with no --repo resolves against the session directory, so the read asks from there');
    cleanup(here);
    cleanup(stub.dir);
  });

  await test('a directory change before the flip bounces, reading no issue', () => {
    for (const c of [
      'cd /some/repo && gh issue edit 12 --add-label status:specced',
      'pushd /some/repo >/dev/null && gh issue edit 12 --add-label status:specced',
      '(cd /some/repo && gh issue edit 12 --add-label status:specced)',
    ]) {
      const stub = makeGhStub(WORLD);
      const { code, stderr } = runHook(c, stub);
      assertEq(code, 2, `the small item still bounces, the repo unplaced: ${c}, got: ${stderr}`);
      assertEq(stderr.trim(), CD_BOUNCE, `the shared bounce line: ${c}`);
      assertEq(ghCalls(stub).length, 0, `reads no issue: ${c}`);
      cleanup(stub.dir);
    }
  });

  await test('a directory change after the flip is not one', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook('gh issue edit 12 --add-label status:specced && cd /some/repo', stub);
    assertEq(code, 0, `must pass, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('every issue in a compound is judged', () => {
    const stub = makeGhStub(WORLD);
    const { code, stderr } = runHook(`${FLIP(12)} && ${FLIP(14)}`, stub);
    assertEq(code, 2, 'the uncontracted half blocks the compound');
    assertEq(stderr.trim(), BLOCK(14), `names the uncontracted one, got: ${stderr}`);
    cleanup(stub.dir);
  });

  group('spec-guard: wiring and fail-open');

  await test('hooks.json registers the guard under PreToolUse Bash, right after proof-guard', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    const at = bash.hooks.findIndex((h) => h.command.includes('safety:spec-guard'));
    assert(at > 0, 'the Bash block routes safety:spec-guard through the loader');
    assert(bash.hooks[at - 1].command.includes('safety:proof-guard'), 'it sits right after proof-guard');
  });

  await test('a gh view that fails: exit 0, one line saying the gate did not run', () => {
    const stub = makeGhStub({ fails: true });
    const { code, stderr } = runHook(FLIP(14), stub);
    assertEq(code, 0, 'a failing view fails open');
    const lines = stderr.trim().split('\n');
    assertEq(lines.length, 1, `one line, got: ${stderr}`);
    assert(SKIPPED(14).test(lines[0]), `the stand-down line, got: ${stderr}`);
    cleanup(stub.dir);
  });

  await test('gh not on PATH: exit 0, one line saying the gate did not run', () => {
    const { code, stderr } = runHook(FLIP(14), null);
    assertEq(code, 0, 'an unreachable gh never wedges the session');
    assert(SKIPPED(14).test(stderr.trim()), `the stand-down line, got: ${stderr}`);
  });

  await test('missing command and malformed JSON, exit 0', () => {
    for (const input of [JSON.stringify({ tool_input: {} }), 'not json']) {
      const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
        input,
        env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH },
        encoding: 'utf8',
        timeout: 15000,
      });
      assertEq(res.status, 0, `fails open on: ${input}`);
    }
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
