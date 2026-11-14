// Tests for safety:commit-gate's logic in hooks/mods/commit-gate.js: the CHANGELOG entry
// format (check 3, preCommitVerdict, the real linter run over a scratch copy of the repo
// through `lint`), and a Fixes #N commit staging its CHANGELOG entry (check 4,
// commitMsgVerdict). The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.
// The check's stand-downs run the real gate over a real scratch repo (test/lib/real-gate.js).

const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { SYSTEM_PATH } = require('../../lib/platform');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { gateOn } = require('../../lib/real-gate');
const {
  PREFIX, T, NOTICE, mkRepo, stage, commit, touchMarker, judge, denyOf, blocks, passes,
  CHANGELOG, ISSUE, ENTRY,
} = require('./helpers');

const LINT = `${PREFIX}${T.lint}`;
const lintBlocks = (v, what) => {
  const deny = denyOf(v);
  expect(deny !== null && deny.startsWith(LINT), `${what}: the gate's wording, got: ${deny}`).toBeTruthy();
  return deny;
};

// CHANGELOG.md committed as `text`, app.js staged, the review marker fresh.
const committedLog = (text) => {
  const r = mkRepo();
  stage(r, 'CHANGELOG.md', text);
  commit(r);
  stage(r, 'app.js', 'const x = 1;\n');
  touchMarker(r);
  return r;
};

describe('commit-gate: CHANGELOG entry format', () => {
  test('a staged 62-word entry: blocked with the shared message and the linter\'s word-cap line', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} - ${new Array(61).fill('word').join(' ')} end.`));
    const deny = lintBlocks(await judge(r, 'docs: changelog'), 'blocked');
    expect(deny.includes('[word-cap] 62 words (max 50)'), `with the linter's line, got: ${deny}`).toBeTruthy();
  });

  test('a staged entry in the format commits', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} - Plugins install from settings.json.`));
    passes(await judge(r, 'docs: changelog'), '', 'allowed');
  });

  test('a legacy entry the commit did not touch does not block', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.'));
    commit(r);
    stage(r, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.', `- ${ISSUE} - A new entry.`));
    passes(await judge(r, 'docs: changelog'), '', 'allowed');
  });

  test('a CRLF CHANGELOG is judged, not waved through', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG('- an essay entry with no issue link.').replace(/\n/g, '\r\n'));
    lintBlocks(await judge(r, 'docs: changelog'), 'blocked');
  });
});

describe('commit-gate: check 3 stands down out loud', () => {
  test('a linter that did not start (no node on PATH): no deny, one check 3 stood down line; the linter file absent: no line, no deny', async () => {
    const stoodDown = (out) => out.context.split('\n').filter((l) => l.startsWith('commit-gate: check 3 stood down: '));
    const entryStaged = () => {
      const w = mkGitRepo('cg-lint-start-', { 'CHANGELOG.md': CHANGELOG() });
      w.write('CHANGELOG.md', ENTRY);
      w.git('add', 'CHANGELOG.md');
      return w;
    };

    const noNode = entryStaged();
    const unstarted = await gateOn(noNode.repo, { ...noNode.env, PATH: SYSTEM_PATH });
    expect(unstarted.deny, 'a linter that never started is no deny').toBe(null);
    const lines = stoodDown(unstarted);
    expect(lines.length, `one stand-down line, got: ${unstarted.context}`).toBe(1);
    expect(lines[0].startsWith('commit-gate: check 3 stood down: the CHANGELOG linter did not start (') && lines[0].endsWith(')'),
      `naming the linter and why, got: ${lines[0]}`).toBeTruthy();

    const absent = entryStaged();
    const skipped = await gateOn(absent.repo, { ...absent.env, WORKFLOW_DIR: mkTmp('cg-no-engine-') });
    expect(skipped.deny, 'no linter there is no deny').toBe(null);
    expect(stoodDown(skipped).length, `and no stand-down line, got: ${skipped.context}`).toBe(0);
  });
});

describe('commit-gate: a Fixes #N commit stages its CHANGELOG entry', () => {
  test('a Fixes trailer with no CHANGELOG staged blocks', async () => {
    blocks(await judge(committedLog(ENTRY), 'feat: a thing\n\nFixes #4'), T.fixes, 'names the rule and the fix');
  });

  test('the same commit with the entry staged passes: a gh that cannot answer leaves one line', async () => {
    const r = committedLog(CHANGELOG());
    stage(r, 'CHANGELOG.md', ENTRY);
    r.ghFails = true;
    passes(await judge(r, 'feat: a thing\n\nFixes #4'), NOTICE.unread(4), 'allowed');
  });

  test('Closes and Resolves are the same trailer', async () => {
    for (const word of ['Closes', 'Resolves', 'closes']) {
      blocks(await judge(committedLog(ENTRY), `feat: a thing\n\n${word} #12`), T.fixes, `${word} #N closes an issue too`);
    }
  });

  test('no trailer: the commit is not asked for an entry', async () => {
    passes(await judge(committedLog(ENTRY), 'feat: a thing that closes nothing'), '', 'allowed');
  });

  test('a repo that keeps no CHANGELOG.md is never asked for one', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'feat: a thing\n\nFixes #4'), '', 'allowed');
  });
});
