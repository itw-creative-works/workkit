// Tests for workflow/home.sh: the setup wizard on a first machine (the repo
// created, cloned, seeded and recorded; a second run finds it and pulls nothing).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, setup } = require('./helpers');

const cases = async () => {
  group('workflow/home: the wizard, a first machine');

  await test('setup creates the repo, clones it, seeds it, and records the slug', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);

    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`);
    assertEq(world.settings().site.repo, 'owner/workkit', 'the home slug is recorded');
    assert(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'the project is seeded');
    assert(!fs.existsSync(path.join(world.tower, '.workkit')), 'and the clone carries no workflow folder of its own');

    assert(world.npmCalls().some((c) => c.join(' ').includes('install')), `the dependencies are installed once, here: ${fmtCalls(world.npmCalls())}`);
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit is still a plain folder');
    assert(!fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'with nothing versioned seeded beside it');
    assert(!fs.existsSync(path.join(world.workflowHome, '.gitignore')), 'and no ignore file of its own');

    // The first commit, read from the bottom of the log: the clone's own heal
    // installs the issue forms on top of it.
    const subjects = spawnSync('git', ['-C', world.tower, 'log', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim().split('\n');
    assertEq(subjects[subjects.length - 1], 'chore(home): seed the tower project', 'the first commit says what it is');
    // The wiring itself, pinned: setup runs the clone's heal, so deleting the
    // wk_home_heal calls in wk_home_setup goes red here.
    assert(subjects.includes('chore(home): install the issue templates'),
      `and setup healed the clone's issue forms, its log: ${subjects.join(' | ')}`);
    cleanup(world.root);
  });

  await test('a second setup finds the clone and re-seeds nothing', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    setup(world);
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), '<html>edited here</html>\n');
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(!/created the private repo/.test(out), `nothing is created twice, got: ${out}`);
    assert(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), 'utf8'),
      '<html>edited here</html>\n', 'and what the project already carried survives');
    assertEq(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head, 'the repo is untouched');
    cleanup(world.root);
  });

  await test('a fresh clone attempts no pull', () => {
    // Every git the run spawns is traced to this file, so a pull shows up
    // whatever the output says.
    const world = mkWorld({ login: 'owner' });
    const trace = path.join(world.root, 'git-trace.log');
    world.env.GIT_TRACE = trace;
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const traced = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
    assert(/built-in: git /.test(traced), 'the trace recorded the run');
    assert(!/built-in: git pull/.test(traced), `no pull ran: ${traced.split('\n').filter((l) => /pull/.test(l)).join(' | ')}`);
    assert(!/catching the tower clone up/.test(out), `no catch-up step is announced, got: ${out}`);
    assert(!/could not catch up with its upstream/.test(out), `and no catch-up warning, got: ${out}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
