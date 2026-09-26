//
// Tests for workflow/home.sh: the clone (an absent path is cloned, an empty repo
// clones fine, and whatever is already at the path is left alone).
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, git, mkRemote, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/home: the clone');

  await test('an absent path is cloned, and ~/.workkit is never made a git repo', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{ "name": "tower" }\n' } });

    const { code, out } = inHome(world, 'wk_home_clone owner/workkit');
    assertEq(code, 0, `exit 0: ${out}`);
    assert(fs.existsSync(path.join(world.tower, '.git')), 'the tower folder is the git repo');
    assert(fs.existsSync(path.join(world.tower, 'package.json')), 'carrying the remote’s files');
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit stays a plain folder');
    assert(/cloned/.test(out), `and it says what it did, got: ${out}`);
    cleanup(world.root);
  });

  await test('an EMPTY repo clones fine, and the warning it prints is not an error', () => {
    // A repo GitHub just created has no commit. git clones it with a warning on
    // stderr and no branch checked out: the ordinary first-setup case.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out, err } = inHome(world, 'wk_home_clone owner/workkit');
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assert(!/warning/i.test(out), `the warning is swallowed, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, '.git')), 'and the clone is there to seed');
    cleanup(world.root);
  });

  await test('a folder already at that path stops the home steps, whatever it is', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'someone-elses.txt'), 'mine\n');

    const { out } = inHome(world, 'rc=0; wk_home_clone owner/workkit || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/rc=3/.test(out), `the caller is told to stop, got: ${out}`);
    assert(/move it aside/.test(out), 'and nothing was converted');
    assert(fs.existsSync(path.join(world.tower, 'someone-elses.txt')), 'the folder is exactly as it was');
    assert(!fs.existsSync(path.join(world.tower, '.git')), 'and was never git init’d');
    cleanup(world.root);
  });

  await test('a repo pointing at ANOTHER remote is named and left alone', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);

    const { out } = inHome(world, 'rc=0; wk_home_clone owner/workkit || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/rc=3/.test(out), `the caller is told to stop, got: ${out}`);
    assert(/pointing at/.test(out), `it names what it found, got: ${out}`);
    assertEq(
      spawnSync('git', ['-C', world.tower, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim(),
      theirs,
      'the other remote is exactly as it was',
    );
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
