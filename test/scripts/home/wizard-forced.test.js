// Tests for workflow/home.sh: the setup wizard forced (`workkit setup --home`),
// asking nothing with or without a terminal. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkRemote, mkWorld, inHome } = require('./helpers');

describe('workflow/home: the wizard, forced', () => {
  // `force` is `workkit setup --home`: the yes already given, so nothing asks
  // and no terminal is needed.
  const forced = (world, { stubs = '' } = {}) => {
    if (!world.env.WORKKIT_HOME_REMOTE) world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    return inHome(world, `${stubs}interactive() { return 1; }\nwk_home_setup force`);
  };

  // Every stage after the create but the record, each a no-op that succeeds:
  // the clone, seed and install are the setup suite's to prove, and forcing
  // changes only what is asked and printed before them.
  const STAGES_STUBBED = ['wk_home_clone', 'wk_home_empty', 'wk_home_seed', 'wk_home_seed_runner',
    'wk_home_install', 'wk_home_discussions', 'wk_home_pages', 'wk_home_commit_push', 'wk_home_heal']
    .map((stage) => `${stage}() { return 0; }\n`).join('');

  test('forced without a terminal, it creates and records, asking nothing', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = forced(world, { stubs: STAGES_STUBBED });
    expect(code, `exit 0: ${out}`).toBe(0);
    const calls = world.ghCalls().map((c) => c.join(' '));
    expect(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(world.settings().site.repo, 'the home slug is recorded').toBe('owner/workkit');
    expect(!/\[y\/N\]|Create the private home repo/.test(out), `no question is put, got: ${out}`).toBeTruthy();
    expect(!/no home repo is configured/.test(out), `and no hand-over line, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('forced again with the clone there, it finds it and creates nothing twice', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    forced(world);
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const before = world.ghCalls().length;
    const { code, out } = forced(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`).toBeTruthy();
    // The world's repo already exists, so the create line can never print; the
    // calls are what say nothing was created twice.
    expect(!world.ghCalls().slice(before).some((c) => c.join(' ').includes('repo create')),
      `nothing is created twice, got: ${fmtCalls(world.ghCalls().slice(before))}`).toBeTruthy();
    expect(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, 'the repo is untouched').toBe(head);
    cleanup(world.root);
  });

  test('forced, a gh that cannot say who you are is the login line and exit 1; unforced, the same line and exit 0', () => {
    const world = mkWorld({ login: '' });
    const hard = forced(world);
    expect(hard.code, `forced: exit 1, got: ${hard.out}`).toBe(1);
    expect(/gh auth login/.test(hard.out), `forced: it prints the fix, got: ${hard.out}`).toBeTruthy();
    const soft = inHome(world, 'interactive() { return 0; }\nwk_home_setup');
    expect(soft.code, `unforced: exit 0, got: ${soft.out}`).toBe(0);
    expect(/gh auth login/.test(soft.out), `unforced: the same fix, got: ${soft.out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('forced, something in the way of the clone stops it with exit 1 before it writes anything', () => {
    const world = mkWorld({ login: 'owner' });
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'mine.txt'), 'mine\n');
    const { code, out } = forced(world);
    expect(code, `exit 1, got: ${out}`).toBe(1);
    expect(/move it aside/.test(out), `it names what is in the way, got: ${out}`).toBeTruthy();
    expect(!/Discussions/.test(out), 'and no later step ran').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'package.json')), 'nothing was seeded over it').toBeTruthy();
    cleanup(world.root);
  });
});
