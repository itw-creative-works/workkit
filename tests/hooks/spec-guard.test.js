// Tests for safety:spec-guard's logic, specGuardVerdict({ command, cwd,
// issueView }) in hooks/mods/spec-guard.js: a flip to status:specced needs a
// `## Spec` that is the small-item line or carries a `### Contract`; an
// unreadable view fails open, a flip behind a directory change bounces. Each
// case ports the HEAD case its name quotes. Dropped with the shell spawn:
// "missing command and malformed JSON" (the JSON half). In
// tests/mods/guards-spec-guard.test.ts: the read's folder and "gh not on PATH".

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const CWD = '/w/repo';

const BLOCK = (n) => `spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`;
const BODY_EDIT = (n) => `spec-guard: BLOCKED this flip: #${n} edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip.`;
const SKIPPED = (n, why) => `spec-guard: could not read issue #${n} (${why}), so the spec gate did not run on this command.`;
const CD_BOUNCE = 'spec-guard: BLOCKED this command. It changes directory (cd, pushd or popd) before a gated gh issue flip or close, so the gate cannot tell which tree and repo that command acts on. Run the cd in its own Bash call first, then the gh command alone; where the directory resets between calls (a subagent), run the flip from a session whose directory is that repo.';

// 12 the small item, 13 a Contract, 14 a written Spec with none, 15 no Spec at
// all, 16 a Contract heading outside the Spec, 17 the small item in CRLF, 18 a
// Contract after a fenced example holding a `## ` line.
const BODIES = {
  12: '## Description\n\nA typo.\n\n## Spec\n\nNone needed: small item.\n',
  13: '## Description\n\nX.\n\n## Spec\n\nBuild the thing.\n\n### Contract\n\nFiles: `a.js`\n\nNames:\n- `a()`\n\nCases:\n- given 1, then 2\n',
  14: '## Description\n\nX.\n\n## Spec\n\nBuild the thing, carefully.\n\n## Notes\n\nnone\n',
  15: '## Description\n\nJust a description.\n',
  16: '## Description\n\n### Contract\n\nin the wrong place\n\n## Spec\n\nBuild it.\n',
  17: '## Description\r\n\r\nX.\r\n\r\n## Spec\r\n\r\nNone needed: small item.\r\n',
  18: '## Spec\n\nThe page reads:\n\n```md\n## Example heading\n```\n\n### Contract\n\nFiles: `a.js`\n\n## Notes\n\nnone\n',
};

const FLIP = (n) => `gh issue edit ${n} --remove-label status:inbox --add-label status:specced`;

// One verdict through a fresh view stub (gh's `--json body` answer by number,
// null when `fails`); hands back the verdict and each read as [number, repo].
const judged = async (command, { fails = false } = {}) => {
  const calls = [];
  const issueView = async (n, repo) => {
    calls.push([String(n), repo || null]);
    if (fails) return null;
    return BODIES[String(n)] === undefined ? null : JSON.stringify({ body: BODIES[String(n)] });
  };
  const r = await mods('spec-guard').specGuardVerdict({ command, cwd: CWD, issueView });
  return { r, calls, deny: r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null };
};

const passes = async (command, what = command) => {
  const out = await judged(command);
  assertEq(out.deny, null, `must pass: ${what}`);
  return out;
};

const run = async () => {
  group('spec-guard: the flip to status:specced');

  await test('ports "the small-item Spec passes, silently": one body read of #12', async () => {
    const { r, calls } = await passes(FLIP(12));
    assertEq(textOf(r), '', 'nothing said on a pass');
    assertEq(JSON.stringify(calls), JSON.stringify([['12', null]]), 'exactly one read, of #12');
  });

  await test('ports "a Spec carrying ### Contract passes"', async () => {
    await passes(FLIP(13));
  });

  await test('ports "a written Spec with no ### Contract blocks, with the exact line"', async () => {
    assertEq((await judged(FLIP(14))).deny, BLOCK(14), 'the block line');
  });

  await test('ports "a body with no ## Spec section blocks"', async () => {
    assertEq((await judged(FLIP(15))).deny, BLOCK(15), 'no Spec reads as a written Spec with no Contract');
  });

  await test('ports "a ### Contract outside the Spec section does not count"', async () => {
    assertEq((await judged(FLIP(16))).deny, BLOCK(16), 'only the Spec section is read');
  });

  await test('ports "a CRLF body reads like an LF one"', async () => {
    await passes(FLIP(17));
  });

  await test('ports "a fenced ## line inside the Spec does not end it"', async () => {
    await passes(FLIP(18));
  });

  await test('ports "a body edit in the flipping clause blocks, reading no issue"', async () => {
    for (const flag of ['--body "Spec: None needed: small item."', '--body=x', '-b x', '--body-file spec.md', '-F spec.md']) {
      const c = `gh issue edit 12 ${flag} --add-label status:specced`;
      const { deny, calls } = await judged(c);
      assertEq(deny, BODY_EDIT(12), `the body-edit line: ${c}`);
      assertEq(calls.length, 0, `reads no issue: ${c}`);
    }
  });

  await test('ports "the issue number is read past the flags, and off an issue URL"', async () => {
    for (const c of [
      'gh issue edit -R owner/name 14 --add-label status:specced',
      'gh issue edit --add-label status:specced 14',
      'gh issue edit https://github.com/owner/name/issues/14 --add-label status:specced',
      'gh issue edit --milestone 12 --add-label status:specced 14',
    ]) {
      const { deny, calls } = await judged(c);
      assertEq(deny, BLOCK(14), `the block line: ${c}`);
      assertEq(calls.length, 1, `one read (a flag's value is no issue): ${c}`);
      assertEq(calls[0][0], '14', `the read names #14: ${c}`);
    }
  });

  await test('ports "the attached and listed label spellings are judged the same"', async () => {
    for (const c of [
      'gh issue edit 14 --add-label=status:specced',
      'gh issue edit 14 --add-label "priority:high,status:specced"',
      "gh issue edit 14 --add-label 'status:inbox, status:specced'",
    ]) {
      assertEq((await judged(c)).deny, BLOCK(14), `the uncontracted flip blocks: ${c}`);
    }
    for (const c of ['gh issue edit 12 --add-label=status:specced', 'gh issue edit 13 --add-label "priority:high,status:specced"']) {
      await passes(c, `the passing bodies still pass: ${c}`);
    }
  });

  await test('ports "an edit that adds no status:specced passes untouched, reading nothing"', async () => {
    for (const c of [
      'gh issue edit 14 --add-label priority:high',
      'gh issue edit 14 --remove-label status:specced --add-label status:building',
      'gh issue edit 14 --body "flip it with --add-label status:specced later"',
    ]) {
      const { r, calls } = await passes(c);
      assertEq(textOf(r), '', `nothing said: ${c}`);
      assertEq(calls.length, 0, `no issue is read: ${c}`);
    }
  });

  await test('ports "other commands pass untouched"', async () => {
    for (const c of ['gh issue comment 14 --body "x"', 'ls', 'echo "gh issue edit 14 --add-label status:specced"', '']) {
      const { r, calls } = await passes(c);
      assertEq(textOf(r), '', `nothing said: ${c}`);
      assertEq(calls.length, 0, `nothing is read: ${c}`);
    }
  });

  group('spec-guard: repo and compound');

  await test("ports \"an issue URL's repo rides the read, never the session's\"", async () => {
    const { deny, calls } = await judged('gh issue edit https://github.com/owner/name/issues/14 --add-label status:specced');
    assertEq(deny, BLOCK(14), 'the issue still has no Contract');
    assertEq(JSON.stringify(calls), JSON.stringify([['14', 'owner/name']]), "the URL's repo is forwarded");
  });

  await test('ports "--repo rides the read in every spelling"', async () => {
    for (const flag of ['--repo owner/name', '--repo=owner/name', '-R owner/name', '-Rowner/name', '--repo "owner/name"']) {
      const { deny, calls } = await judged(`gh issue edit 14 ${flag} --add-label status:specced`);
      assertEq(deny, BLOCK(14), `the issue still has no Contract: ${flag}`);
      assertEq(JSON.stringify(calls), JSON.stringify([['14', 'owner/name']]), `the repo is forwarded for ${flag}`);
    }
  });

  await test('ports "a --repo value the guard cannot read fails open, never reads the local repo"', async () => {
    const { r, calls } = await passes('gh issue edit 14 --repo "$TARGET" --add-label status:specced');
    assertEq(textOf(r), SKIPPED(14, 'the --repo value could not be read'), 'one stand-down line');
    assertEq(calls.length, 0, 'the local repo is never asked instead');
  });

  await test('ports "a directory change before the flip bounces, reading no issue"', async () => {
    for (const c of [
      'cd /some/repo && gh issue edit 12 --add-label status:specced',
      'pushd /some/repo >/dev/null && gh issue edit 12 --add-label status:specced',
      '(cd /some/repo && gh issue edit 12 --add-label status:specced)',
    ]) {
      const { deny, calls } = await judged(c);
      assertEq(deny, CD_BOUNCE, `the shared bounce line: ${c}`);
      assertEq(calls.length, 0, `reads no issue: ${c}`);
    }
  });

  await test('ports "a directory change after the flip is not one"', async () => {
    await passes('gh issue edit 12 --add-label status:specced && cd /some/repo');
  });

  await test('ports "every issue in a compound is judged"', async () => {
    assertEq((await judged(`${FLIP(12)} && ${FLIP(14)}`)).deny, BLOCK(14), 'names the uncontracted one');
  });

  group('spec-guard: wiring and fail-open');

  await test('ports "hooks.json registers the guard under PreToolUse Bash, right after proof-guard": BASH_GUARDS holds the order', async () => {
    const hooks = mods('guards').BASH_GUARDS.map((g) => g.hook);
    const at = hooks.indexOf('safety:spec-guard');
    assert(at > 0 && hooks[at - 1] === 'safety:proof-guard', `spec-guard sits right after proof-guard, got: ${hooks.join(', ')}`);
  });

  await test('ports "a gh view that fails: exit 0, one line saying the gate did not run"', async () => {
    const { r, deny } = await judged(FLIP(14), { fails: true });
    assertEq(deny, null, 'a failing view fails open');
    assertEq(textOf(r), SKIPPED(14, 'gh could not answer'), 'the one stand-down line');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
