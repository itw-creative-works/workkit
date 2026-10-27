// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the two tokens
// its calls are made with, and no credential committed in the workflow it seeds.
// The shared prologue (world factory, no-jq PATH, job runner, case gates) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  HOME_SLUG, cleanup, mkWorld, runJob, composerTest,
} = require('./helpers');

const cases = async () => {
  group('jobs/morning (cloud): the two tokens');

  await composerTest('the post is made with the built-in token, the sweep with the secret', () => {
    // The Discussion lands on the repo the run belongs to, so it
    // needs nothing longer-lived than the workflow's own GITHUB_TOKEN. The
    // cross-repo secret is for the board, and only the board.
    const world = mkWorld({ siteRepos: { repos: ['a/one', HOME_SLUG], home: HOME_SLUG } });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.tokens('post').join(','), 'POST-TOKEN', 'the post carries the built-in token');
    assertEq(world.tokens('sweep').join(','), 'SWEEP-TOKEN', 'the board sweep carries the secret');
    assertEq(world.tokens('roster').join(','), 'SWEEP-TOKEN', 'and so does the published slug list');
    assertEq(world.tokens('branch').join(','), 'SWEEP-TOKEN', 'and the default-branch read before it');
    cleanup(world.root);
  });

  await test('a run given no built-in token posts with the one it has', () => {
    // The rehearsal shape, and the runner whose permissions block was not
    // rendered: one token is enough, and an empty export would be read as a
    // token rather than as an absent one.
    const world = mkWorld({ postToken: null });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.tokens('post').join(','), 'SWEEP-TOKEN', 'the post falls back rather than losing its token');
    cleanup(world.root);
  });

  await test('the seeded workflow commits no credential, only references to one', () => {
    // It is seeded onto every consumer's home repo, so a literal here would be
    // published to anyone who can read that repo.
    const workflow = path.join(__dirname, '..', '..', '..', 'workflow', 'templates', 'github-workflows', 'brief.yml');
    const text = fs.readFileSync(workflow, 'utf8');
    assert(!/\b(gh[pousr]_|github_pat_|sk-ant-)[A-Za-z0-9_-]{8,}/.test(text), 'no credential is written into the file');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
