// Tests for hooks/safety/commit-gate: check 7, an issue the message names is at
// status:complete, read once per issue beside check 6's proof read.
// The shared prologue (the hook runner, the gh stub, the ship-ready repo) is ./helpers.js.

const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  skipWithoutDigest, mkRepo, stage, touchMarker, runHook, standDownMessage, ghStub, ghCalls, shipReadyRepo, cleanup,
} = require('./helpers');

const PROVED = ['Proof: unit: node tests/hooks/x.test.js'];

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: check 7, a named issue is at status:complete');

  /** Run one commit message against one fixture board, then clean up. */
  const commit = (message, board) => {
    const dir = shipReadyRepo();
    const stub = ghStub(board);
    try {
      return runHook(dir, `git commit -m "${message}"`, undefined, stub.env);
    } finally {
      cleanup(dir);
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  };

  await test('an open issue at status:qa named by Refs blocks, naming it and its stage', () => {
    const { code, stderr } = commit('feat: a thing\n\nRefs #12', { issues: { 12: { labels: ['status:qa'] } } });
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#12 is at status:qa'), `names the issue and its stage, got: ${stderr}`);
    assert(stderr.includes("owner's pass"), `and what moves it, got: ${stderr}`);
  });

  await test('a Fixes trailer on a proved issue still at status:qa blocks on the stage', () => {
    const { code, stderr } = commit('feat: a thing\n\nFixes #4',
      { issues: { 4: { comments: PROVED, labels: ['status:qa', 'type:bug'] } } });
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#4 is at status:qa'), `names the stage, got: ${stderr}`);
  });

  await test('one read per issue serves the stage and the proof, however often it is named', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ issues: { 4: { comments: PROVED } } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing for #4\n\nFixes #4\nRefs #4"', undefined, stub.env);
    assertEq(code, 0, `a proved, passed issue commits, got: ${stderr}`);
    const calls = ghCalls(stub).map((argv) => argv.join(' '));
    assertEq(calls.join('; '), 'issue view 4 --json state,labels,comments,url', 'one view, with every field both checks read');
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('an issue at status:complete passes', () => {
    const { code, stderr } = commit('feat: a thing\n\nRefs #12', { issues: { 12: { labels: ['status:complete'] } } });
    assertEq(code, 0, `allowed, got: ${stderr}`);
  });

  await test('a closed issue passes, whatever label it kept', () => {
    const { code, stderr } = commit('feat: a thing\n\nsee #12', { issues: { 12: { state: 'CLOSED', labels: ['status:qa'] } } });
    assertEq(code, 0, `history references are fine, got: ${stderr}`);
  });

  await test('every unpassed issue is named with its stage, an unlabelled one as having none', () => {
    const { code, stderr } = commit('feat: a thing\n\nRefs #12 #13, #14',
      { issues: { 12: { labels: ['status:qa'] }, 13: { labels: ['status:complete'] }, 14: { labels: [] } } });
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#12 is at status:qa'), `names the first, got: ${stderr}`);
    assert(stderr.includes('#14 has no status label'), `names the unlabelled one, got: ${stderr}`);
    assert(!stderr.includes('#13'), `never the passed one, got: ${stderr}`);
  });

  await test('a pull request is not a work item: a merged one and an open one both pass', () => {
    // gh answers a PR number too, with its own state and no status label.
    const pull = (state) => ({ issues: { 12: { state, labels: [], url: 'https://github.com/o/r/pull/12' } } });
    assertEq(commit('feat: a thing\n\nRefs #12', pull('MERGED')).code, 0, 'a merged PR');
    assertEq(commit('feat: a thing\n\nRefs #12', pull('OPEN')).code, 0, 'an open PR');
    assertEq(commit('feat: a thing\n\nFixes #12', pull('MERGED')).code, 0, 'a trailer naming a PR asks no proof');
  });

  await test('owner/repo#N is another repo and is never read', () => {
    const { code, stderr } = commit('feat: a thing\n\nRefs ITW-Creative-Works/other#12',
      { issues: { 12: { labels: ['status:qa'] } } });
    assertEq(code, 0, `another repo's issue is not checked, got: ${stderr}`);
  });

  await test('a #N inside a URL or after a $ is not an issue; one in a code span is', () => {
    const board = { issues: { 12: { labels: ['status:qa'] } } };
    assertEq(commit('docs: see https://example.com/page#12 and \\$#12', board).code, 0, 'a URL fragment and $#');
    assertEq(commit('docs: the \\`#12\\` reference', board).code, 2, 'a code span still names the issue');
    assertEq(commit('docs: see &#12 and a/b#12 and owner/repo2#12', board).code, 0, 'an entity, a path and a repo ending in a digit');
  });

  await test('two references glued together are both read, never a phantom from their digits', () => {
    const { code, stderr } = commit('feat: a thing\n\nRefs #123#456',
      { issues: { 123: { labels: ['status:qa'] }, 456: { labels: ['status:building'] }, 12: { labels: ['status:qa'] } } });
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#123 is at status:qa') && stderr.includes('#456 is at status:building'), `names both, got: ${stderr}`);
    assert(!stderr.includes('#12 '), `and no phantom #12, got: ${stderr}`);
  });

  await test('a message naming no issue passes without a read', () => {
    const { code, stderr } = commit('chore(release): 1.2.3', { fails: true });
    assertEq(code, 0, `allowed, got: ${stderr}`);
    assertEq(stderr, '', 'nothing named, nothing read');
  });

  await test('a gh that cannot answer fails open, out loud on the visible notice', () => {
    const out = commit('feat: a thing\n\nRefs #12', { fails: true });
    assertEq(out.code, 0, `an unreachable gh never blocks, got: ${out.stderr}`);
    const msg = standDownMessage(out);
    assert(msg.includes('could not read issue #12') && msg.includes('did not run'), `and says so, got: ${out.stdout}`);
  });

  await test('a repo that keeps no CHANGELOG.md is outside the pipeline and never asked', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const stub = ghStub({ issues: { 12: { labels: ['status:qa'] } } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nRefs #12"', undefined, stub.env);
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
