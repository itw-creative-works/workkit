// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the two tokens
// its calls are made with, and no credential committed in the workflow it seeds.
// The shared prologue (world factory, no-jq PATH, job runner) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  HOME_SLUG, cleanup, mkWorld, runJob,
} = require('./helpers');

describe('jobs/morning (cloud): the two tokens', () => {
  test('the post is made with the built-in token, the sweep with the secret', { skip: skipWithoutNodeStub() }, () => {
    // The Discussion lands on the repo the run belongs to, so it
    // needs nothing longer-lived than the workflow's own GITHUB_TOKEN. The
    // cross-repo secret is for the board, and only the board.
    const world = mkWorld({ siteRepos: { repos: ['a/one', HOME_SLUG], home: HOME_SLUG } });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.tokens('post').join(','), 'the post carries the built-in token').toBe('POST-TOKEN');
    expect(world.tokens('sweep').join(','), 'the board sweep carries the secret').toBe('SWEEP-TOKEN');
    expect(world.tokens('roster').join(','), 'and so does the published slug list').toBe('SWEEP-TOKEN');
    expect(world.tokens('branch').join(','), 'and the default-branch read before it').toBe('SWEEP-TOKEN');
    cleanup(world.root);
  });

  test('a run given no built-in token posts with the one it has', () => {
    // The rehearsal shape, and the runner whose permissions block was not
    // rendered: one token is enough, and an empty export would be read as a
    // token rather than as an absent one.
    const world = mkWorld({ postToken: null });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.tokens('post').join(','), 'the post falls back rather than losing its token').toBe('SWEEP-TOKEN');
    cleanup(world.root);
  });

  test('the seeded workflow commits no credential, only references to one', () => {
    // It is seeded onto every consumer's home repo, so a literal here would be
    // published to anyone who can read that repo.
    const workflow = path.join(__dirname, '..', '..', '..', 'workflow', 'templates', 'github-workflows', 'brief.yml');
    const text = fs.readFileSync(workflow, 'utf8');
    expect(!/\b(gh[pousr]_|github_pat_|sk-ant-)[A-Za-z0-9_-]{8,}/.test(text), 'no credential is written into the file').toBeTruthy();
  });
});
