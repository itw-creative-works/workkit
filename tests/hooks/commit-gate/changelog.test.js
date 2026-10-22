// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: the CHANGELOG entry format (check 3, the real
// linter run over a scratch copy of the repo through `lint`), and a Fixes #N
// commit staging its CHANGELOG entry (check 4). Each case ports the HEAD case
// its name quotes. Dropped with the shell mechanism: "reads a file mtime
// under either stat dialect" (the module stats through $.fs, with no stat
// tool to read).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const {
  PREFIX, T, NOTICE, mkRepo, stage, write, commit, touchMarker, judge, denyOf, blocks, passes,
  CHANGELOG, ISSUE, ENTRY,
} = require('./helpers');

const LINT = `${PREFIX}${T.lint}`;
const lintBlocks = (v, what) => {
  const deny = denyOf(v);
  assert(deny !== null && deny.startsWith(LINT), `${what}: the gate's wording, got: ${deny}`);
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

const run = async () => {
  group('commit-gate: CHANGELOG entry format');

  await test('ports "a staged essay entry blocks the commit"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG(`- **An essay entry.** ${new Array(60).fill('word').join(' ')}`));
    const deny = lintBlocks(await judge(r, 'git commit -m "docs: changelog"'), 'blocked');
    assert(deny.includes('word-cap'), `names the rule, got: ${deny}`);
  });

  await test('ports "a staged 62-word entry: blocked with the shared message and the linter\'s word-cap line"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} - ${new Array(61).fill('word').join(' ')} end.`));
    const deny = lintBlocks(await judge(r, 'git commit -m "docs: changelog"'), 'blocked');
    assert(deny.includes('[word-cap] 62 words (max 50)'), `with the linter's line, got: ${deny}`);
  });

  await test('ports "a staged entry in the format commits"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} - Plugins install from settings.json.`));
    passes(await judge(r, 'git commit -m "docs: changelog"'), '', 'allowed');
  });

  await test('ports "a legacy entry the commit did not touch does not block"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.'));
    commit(r);
    stage(r, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.', `- ${ISSUE} - A new entry.`));
    passes(await judge(r, 'git commit -m "docs: changelog"'), '', 'allowed');
  });

  await test('ports "a -am commit is judged from the working tree, which is what it carries"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG());
    commit(r);
    write(r, 'CHANGELOG.md', CHANGELOG('- An unstaged essay entry with no issue link.'));
    lintBlocks(await judge(r, 'git commit -am "docs: changelog"'), 'blocked');
  });

  await test('ports "a CRLF CHANGELOG is judged, not waved through"', async () => {
    const r = mkRepo();
    stage(r, 'CHANGELOG.md', CHANGELOG('- an essay entry with no issue link.').replace(/\n/g, '\r\n'));
    lintBlocks(await judge(r, 'git commit -m "docs: changelog"'), 'blocked');
  });

  await test('ports "a pathspec commit still has its CHANGELOG judged"', async () => {
    const r = mkRepo();
    write(r, 'CHANGELOG.md', CHANGELOG('- an essay entry with no issue link.'));
    touchMarker(r);
    lintBlocks(await judge(r, 'git commit -m docs CHANGELOG.md', { lintSource: 'work' }), 'blocked for the CHANGELOG reason');
  });

  group('commit-gate: a Fixes #N commit stages its CHANGELOG entry');

  await test('ports "a Fixes trailer with no CHANGELOG staged blocks"', async () => {
    blocks(await judge(committedLog(ENTRY), 'git commit -m "feat: a thing\n\nFixes #4"'), T.fixes, 'names the rule and the fix');
  });

  await test('given Fixes #N with no CHANGELOG staged: that deny', async () => {
    const r = committedLog(CHANGELOG());
    blocks(await judge(r, 'git commit -m "fix(x): mend it\n\nFixes #31"'), T.fixes, 'an issue closes against its entry');
  });

  await test('ports "the same commit with the entry staged passes": a gh that cannot answer leaves one line', async () => {
    const r = committedLog(CHANGELOG());
    stage(r, 'CHANGELOG.md', ENTRY);
    r.ghFails = true;
    passes(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4"'), NOTICE.unread(4), 'allowed');
  });

  await test('ports "Closes and Resolves are the same trailer"', async () => {
    for (const word of ['Closes', 'Resolves', 'closes']) {
      blocks(await judge(committedLog(ENTRY), `git commit -m "feat: a thing\n\n${word} #12"`), T.fixes, `${word} #N closes an issue too`);
    }
  });

  await test('ports "no trailer: the commit is not asked for an entry"', async () => {
    passes(await judge(committedLog(ENTRY), 'git commit -m "feat: a thing that closes nothing"'), '', 'allowed');
  });

  await test('ports "a repo that keeps no CHANGELOG.md is never asked for one"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4"'), '', 'allowed');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
