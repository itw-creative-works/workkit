//
// Tests for jobs/morning.sh as a GITHUB ACTIONS RUNNER runs it: the two tokens
// its calls are made with, and the seeded workflow that runs it.
// The shared prologue (the world factory, the no-jq PATH, the job runner, the two case gates) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  HOME_SLUG, cleanup, mkWorld, runJob, composerTest,
} = require('./helpers');

const run = async () => {
  group('jobs/morning (cloud): the two tokens');

  await composerTest('the post is made with the built-in token, the sweep with the secret', () => {
    // Issue #91: the Discussion lands on the repo the run belongs to, so it
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

  group('jobs/morning (cloud): the workflow that runs it');

  // The workflow is SEEDED onto the home repo (issue #91) and lives nowhere in
  // this repo but here: the plugin is distributed, and a consumer cannot set
  // secrets on a repo they do not own.
  const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflow', 'templates', 'github-workflows', 'brief.yml');

  await test('the plugin repo carries no brief workflow of its own', () => {
    assert(
      !fs.existsSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'brief.yml')),
      'the seeded copy on the home repo is the only live one',
    );
  });

  await test('brief.yml triggers on dispatch and on a cron backup', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert(/^on:$/m.test(text), 'it has a trigger block');
    assert(/^ {2}workflow_dispatch:$/m.test(text), 'the machine dispatches it');
    assert(/^ {4}- cron: '[\d*/, ]+'$/m.test(text), 'and a cron is the backup');
  });

  await test('it runs the morning script at the path the seed puts it', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    const named = text.match(/run: bash (\S+\.sh)/);
    assert(named, `the job runs a script: ${text}`);
    // The seed's own list is what decides where that path is, so the workflow
    // is checked against it rather than against a literal written twice.
    const home = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'home.sh'), 'utf8');
    const pair = home.match(/'(\S+):(\S+morning\.sh)'/);
    assert(pair, `the seed list names the morning script: ${home.slice(0, 200)}`);
    assertEq(named[1], pair[2], 'the workflow runs the copy the seed writes');
    assert(fs.existsSync(path.join(__dirname, '..', '..', '..', pair[1])), `${pair[1]} is the source in this checkout`);
  });

  await test('a dispatch and the cron cannot run at once', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert(/^concurrency:$/m.test(text) && /^ {2}group: \S+$/m.test(text), `a concurrency group is set: ${text}`);
  });

  await test('the built-in token is granted the write the post needs', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert(/^permissions:$/m.test(text), 'the workflow states its permissions');
    assert(/^ {2}discussions: write$/m.test(text), 'and the Discussion post is what needs the grant');
  });

  await test('the credentials are named, never written', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'WORKKIT_POST_TOKEN']) {
      assert(text.includes(`${name}:`), `${name} reaches the script`);
    }
    assert(/CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\./.test(text), 'the OAuth token is a secret reference');
    assert(/GH_TOKEN: \$\{\{ secrets\.WORKKIT_GITHUB_TOKEN \}\}/.test(text), 'the sweep gets the cross-repo secret');
    assert(/WORKKIT_POST_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/.test(text), 'and the post gets the built-in one');
    assert(!/WORKKIT_HOME_SLUG|WORKKIT_HOME_TOKEN/.test(text), 'the retired names are gone');
    // Anything that looks like a credential rather than a reference to one.
    assert(!/\b(gh[pousr]_|github_pat_|sk-ant-)[A-Za-z0-9_-]{8,}/.test(text), 'no credential is written into the file');
    assert(!/set -x/.test(text), 'and nothing traces the environment into the log');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
