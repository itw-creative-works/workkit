// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: check 7, an issue the message names is at
// status:complete, read once per issue through `issueView`, beside check 6's
// proof read. Each case ports the HEAD case its name quotes; every HEAD
// case's mechanism survives.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  T, NOTICE, mkRepo, stage, touchMarker, judge, blocks, passes, shipReadyRepo,
} = require('./helpers');

const PROVED = ['Proof: unit: node tests/hooks/x.test.js'];

/** One commit message against one fixture board, on a ship-ready repo. */
const commit = async (message, { issues = {}, fails = false } = {}) => {
  const r = shipReadyRepo();
  r.issues = issues;
  r.ghFails = fails;
  return { r, v: await judge(r, `git commit -m "${message}"`) };
};

const run = async () => {
  group('commit-gate: check 7, a named issue is at status:complete');

  await test('ports "an open issue at status:qa named by Refs blocks, naming it and its stage"', async () => {
    const { v } = await commit('feat: a thing\n\nRefs #12', { issues: { 12: { labels: ['status:qa'] } } });
    blocks(v, T.unpassed('#12 is at status:qa'), 'names the issue, its stage and what moves it');
  });

  await test('ports "a Fixes trailer on a proved issue still at status:qa blocks on the stage"', async () => {
    const { v } = await commit('feat: a thing\n\nFixes #4', { issues: { 4: { comments: PROVED, labels: ['status:qa', 'type:bug'] } } });
    blocks(v, T.unpassed('#4 is at status:qa'), 'names the stage');
  });

  await test('ports "one read per issue serves the stage and the proof, however often it is named"', async () => {
    const { r, v } = await commit('feat: a thing for #4\n\nFixes #4\nRefs #4', { issues: { 4: { comments: PROVED } } });
    passes(v, '', 'a proved, passed issue commits');
    assertEq(r.calls.issueView.join('; '), '4', 'one view of #4');
  });

  await test('ports "an issue at status:complete passes"', async () => {
    const { v } = await commit('feat: a thing\n\nRefs #12', { issues: { 12: { labels: ['status:complete'] } } });
    passes(v, '', 'allowed');
  });

  await test('ports "a closed issue passes, whatever label it kept"', async () => {
    const { v } = await commit('feat: a thing\n\nsee #12', { issues: { 12: { state: 'CLOSED', labels: ['status:qa'] } } });
    passes(v, '', 'history references are fine');
  });

  await test('ports "every unpassed issue is named with its stage, an unlabelled one as having none"', async () => {
    const { v } = await commit('feat: a thing\n\nRefs #12 #13, #14',
      { issues: { 12: { labels: ['status:qa'] }, 13: { labels: ['status:complete'] }, 14: { labels: [] } } });
    blocks(v, T.unpassed('#12 is at status:qa, #14 has no status label'), 'names both, never the passed one');
  });

  await test('ports "a pull request is not a work item: a merged one and an open one both pass"', async () => {
    const pull = (state) => ({ issues: { 12: { state, labels: [], url: 'https://github.com/o/r/pull/12' } } });
    passes((await commit('feat: a thing\n\nRefs #12', pull('MERGED'))).v, '', 'a merged PR');
    passes((await commit('feat: a thing\n\nRefs #12', pull('OPEN'))).v, '', 'an open PR');
    passes((await commit('feat: a thing\n\nFixes #12', pull('MERGED'))).v, '', 'a trailer naming a PR asks no proof');
  });

  await test('ports "owner/repo#N is another repo and is never read"', async () => {
    const { r, v } = await commit('feat: a thing\n\nRefs ITW-Creative-Works/other#12', { issues: { 12: { labels: ['status:qa'] } } });
    passes(v, '', "another repo's issue is not checked");
    assertEq(r.calls.issueView.length, 0, 'and never read');
  });

  await test('ports "a #N inside a URL or after a $ is not an issue; one in a code span is"', async () => {
    const board = { issues: { 12: { labels: ['status:qa'] } } };
    passes((await commit('docs: see https://example.com/page#12 and \\$#12', board)).v, '', 'a URL fragment and $#');
    blocks((await commit('docs: the \\`#12\\` reference', board)).v, T.unpassed('#12 is at status:qa'), 'a code span still names the issue');
    passes((await commit('docs: see &#12 and a/b#12 and owner/repo2#12', board)).v, '', 'an entity, a path and a repo ending in a digit');
  });

  await test('ports "two references glued together are both read, never a phantom from their digits"', async () => {
    const { v } = await commit('feat: a thing\n\nRefs #123#456',
      { issues: { 123: { labels: ['status:qa'] }, 456: { labels: ['status:building'] }, 12: { labels: ['status:qa'] } } });
    blocks(v, T.unpassed('#123 is at status:qa, #456 is at status:building'), 'names both, and no phantom #12');
  });

  await test('ports "a message naming no issue passes without a read"', async () => {
    const { r, v } = await commit('chore(release): 1.2.3', { fails: true });
    passes(v, '', 'nothing named, nothing said');
    assertEq(r.calls.issueView.length, 0, 'and nothing read');
  });

  await test('ports "a gh that cannot answer fails open, out loud on the visible notice"', async () => {
    const { v } = await commit('feat: a thing\n\nRefs #12', { fails: true });
    passes(v, NOTICE.unread(12), 'an unreachable gh never blocks, and says so');
  });

  await test('ports "a repo that keeps no CHANGELOG.md is outside the pipeline and never asked"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    r.issues = { 12: { labels: ['status:qa'] } };
    passes(await judge(r, 'git commit -m "feat: a thing\n\nRefs #12"'), '', 'allowed');
    assertEq(r.calls.issueView.length, 0, 'and gh is never asked');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
