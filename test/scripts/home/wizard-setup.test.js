// Tests for workflow/home.sh: the setup wizard on a first machine (the repo
// created, cloned, seeded and recorded; a second run finds it and pulls nothing).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, setup } = require('./helpers');

describe('workflow/home: the wizard, a first machine', () => {
  test('setup creates the repo, clones it, seeds it, and records the slug', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);

    const calls = world.ghCalls().map((c) => c.join(' '));
    expect(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(world.settings().site.repo, 'the home slug is recorded').toBe('owner/workkit');
    expect(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'the project is seeded').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, '.workkit')), 'and the clone carries no workflow folder of its own').toBeTruthy();

    expect(world.npmCalls().some((c) => c.join(' ').includes('install')), `the dependencies are installed once, here: ${fmtCalls(world.npmCalls())}`).toBeTruthy();
    expect(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit is still a plain folder').toBeTruthy();
    expect(!fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'with nothing versioned seeded beside it').toBeTruthy();
    expect(!fs.existsSync(path.join(world.workflowHome, '.gitignore')), 'and no ignore file of its own').toBeTruthy();

    // The first commit, read from the bottom of the log: the clone's own heal
    // installs the issue forms on top of it.
    const subjects = spawnSync('git', ['-C', world.tower, 'log', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(subjects[subjects.length - 1], 'the first commit says what it is').toBe('chore(home): seed the tower project');
    // The wiring itself, pinned: setup runs the clone's heal, so deleting the
    // wk_home_heal calls in wk_home_setup goes red here.
    expect(subjects.includes('chore(home): install the issue templates'),
      `and setup healed the clone's issue forms, its log: ${subjects.join(' | ')}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a second setup finds the clone and re-seeds nothing', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    setup(world);
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), '<html>edited here</html>\n');
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(!/created the private repo/.test(out), `nothing is created twice, got: ${out}`).toBeTruthy();
    expect(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`).toBeTruthy();
    expect(fs.readFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), 'utf8'), 'and what the project already carried survives').toBe('<html>edited here</html>\n');
    expect(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, 'the repo is untouched').toBe(head);
    cleanup(world.root);
  });

  test('a fresh clone attempts no pull', () => {
    // Every git the run spawns is traced to this file, so a pull shows up
    // whatever the output says.
    const world = mkWorld({ login: 'owner' });
    const trace = path.join(world.root, 'git-trace.log');
    world.env.GIT_TRACE = trace;
    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const traced = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
    expect(/built-in: git /.test(traced), 'the trace recorded the run').toBeTruthy();
    expect(!/built-in: git pull/.test(traced), `no pull ran: ${traced.split('\n').filter((l) => /pull/.test(l)).join(' | ')}`).toBeTruthy();
    expect(!/catching the tower clone up/.test(out), `no catch-up step is announced, got: ${out}`).toBeTruthy();
    expect(!/could not catch up with its upstream/.test(out), `and no catch-up warning, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});
