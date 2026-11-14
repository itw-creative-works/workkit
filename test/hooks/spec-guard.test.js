// Tests for safety:spec-guard's specVerdict({ steps, cwd, repo, facts: { issueView } }) in hooks/mods/spec-guard.js,
// one step per issue ({ sub, number, add, remove }, `body: true` when the call edits the body too): a flip to
// status:specced needs a `## Spec` that is the small-item line or carries a `### Contract`, and no body edit beside it;
// an unreadable view fails open. In test/scripts/identity/: argv spelling, gate.test.js; a real gh call, gh-shim.test.js.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const CWD = '/w/repo';

const BLOCK = (n) => `spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`;
const BODY_EDIT = (n) => `spec-guard: BLOCKED this flip: #${n} edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip.`;
const SKIPPED = (n, why) => `spec-guard: could not read issue #${n} (${why}), so the spec gate did not run on this command.`;

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

const step = (number, add = ['status:specced'], remove = ['status:inbox']) => ({
  sub: 'edit', number, add, remove,
});
const FLIP = (n) => [step(n)];

// One verdict through a fresh view stub (gh's `--json body` answer by number,
// null when `fails`); hands back the verdict and each read as [number, repo].
const judged = async (steps, { fails = false, repo = null } = {}) => {
  const calls = [];
  const issueView = async (n, r) => {
    calls.push([String(n), r || null]);
    if (fails) return null;
    return BODIES[String(n)] === undefined ? null : JSON.stringify({ body: BODIES[String(n)] });
  };
  const r = await mods('spec-guard').specVerdict({
    steps, cwd: CWD, repo, facts: { issueView },
  });
  return { r, calls, deny: r && typeof r.deny === 'string' ? r.deny.replace(/\n$/, '') : null };
};

const passes = async (steps, what = JSON.stringify(steps)) => {
  const out = await judged(steps);
  expect(out.deny, `must pass: ${what}`).toBe(null);
  return out;
};

describe('spec-guard: the flip to status:specced', () => {
  test('the small-item Spec passes, silently: one body read of #12', async () => {
    const { r, calls } = await passes(FLIP(12));
    expect(textOf(r), 'nothing said on a pass').toBe('');
    expect(JSON.stringify(calls), 'exactly one read, of #12').toBe(JSON.stringify([['12', null]]));
  });

  test('a Spec carrying ### Contract passes', async () => {
    await passes(FLIP(13));
  });

  test('a written Spec with no ### Contract blocks, with the exact line', async () => {
    expect((await judged(FLIP(14))).deny, 'the block line').toBe(BLOCK(14));
  });

  test('a body with no ## Spec section blocks', async () => {
    expect((await judged(FLIP(15))).deny, 'no Spec reads as a written Spec with no Contract').toBe(BLOCK(15));
  });

  test('a ### Contract outside the Spec section does not count', async () => {
    expect((await judged(FLIP(16))).deny, 'only the Spec section is read').toBe(BLOCK(16));
  });

  test('a CRLF body reads like an LF one', async () => {
    await passes(FLIP(17));
  });

  test('a fenced ## line inside the Spec does not end it', async () => {
    await passes(FLIP(18));
  });

  test('a body edit in the flipping clause blocks, reading no issue: a step carrying body: true', async () => {
    const { deny, calls } = await judged([{ ...step(12, ['status:specced'], []), body: true }]);
    expect(deny, 'the body-edit line, though #12 holds a passing small-item Spec').toBe(BODY_EDIT(12));
    expect(calls.length, 'reads no issue').toBe(0);
  });

  test('the listed label spellings are judged the same: status:specced among other added labels', async () => {
    expect((await judged([step(14, ['priority:high', 'status:specced'], [])])).deny, 'the uncontracted flip blocks').toBe(BLOCK(14));
    await passes([step(13, ['priority:high', 'status:specced'], [])], 'the contracted flip still passes');
  });

  test('an edit that adds no status:specced passes untouched, reading nothing', async () => {
    for (const s of [step(14, ['priority:high'], []), step(14, ['status:building'], ['status:specced'])]) {
      const { r, calls } = await passes([s]);
      expect(textOf(r), `nothing said: ${JSON.stringify(s)}`).toBe('');
      expect(calls.length, `no issue is read: ${JSON.stringify(s)}`).toBe(0);
    }
  });
});

describe('spec-guard: repo and compound', () => {
  test("an issue URL's repo rides the read, never the session's", async () => {
    const { deny, calls } = await judged(FLIP(14), { repo: 'owner/name' });
    expect(deny, 'the issue still has no Contract').toBe(BLOCK(14));
    expect(JSON.stringify(calls), 'the repo is forwarded').toBe(JSON.stringify([['14', 'owner/name']]));
  });

  test('every issue in a compound is judged', async () => {
    expect((await judged([step(12), step(14)])).deny, 'names the uncontracted one').toBe(BLOCK(14));
  });
});

describe('spec-guard: wiring and fail-open', () => {
  test('a gh view that fails: exit 0, one line saying the gate did not run', async () => {
    const { r, deny } = await judged(FLIP(14), { fails: true });
    expect(deny, 'a failing view fails open').toBe(null);
    expect(textOf(r), 'the one stand-down line').toBe(SKIPPED(14, 'gh could not answer'));
  });
});
