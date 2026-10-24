// Tests for workflow/home.sh: the setup wizard forced (`workkit setup --home`),
// asking nothing with or without a terminal. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkRemote, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/home: the wizard, forced');

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

  await test('forced without a terminal, it creates and records, asking nothing', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = forced(world, { stubs: STAGES_STUBBED });
    assertEq(code, 0, `exit 0: ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`);
    assertEq(world.settings().site.repo, 'owner/workkit', 'the home slug is recorded');
    assert(!/\[y\/N\]|Create the private home repo/.test(out), `no question is put, got: ${out}`);
    assert(!/no home repo is configured/.test(out), `and no hand-over line, got: ${out}`);
    cleanup(world.root);
  });

  await test('forced again with the clone there, it finds it and creates nothing twice', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    forced(world);
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const before = world.ghCalls().length;
    const { code, out } = forced(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`);
    // The world's repo already exists, so the create line can never print; the
    // calls are what say nothing was created twice.
    assert(!world.ghCalls().slice(before).some((c) => c.join(' ').includes('repo create')),
      `nothing is created twice, got: ${fmtCalls(world.ghCalls().slice(before))}`);
    assertEq(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head, 'the repo is untouched');
    cleanup(world.root);
  });

  await test('forced, a gh that cannot say who you are is the login line and exit 1; unforced, the same line and exit 0', () => {
    const world = mkWorld({ login: '' });
    const hard = forced(world);
    assertEq(hard.code, 1, `forced: exit 1, got: ${hard.out}`);
    assert(/gh auth login/.test(hard.out), `forced: it prints the fix, got: ${hard.out}`);
    const soft = inHome(world, 'interactive() { return 0; }\nwk_home_setup');
    assertEq(soft.code, 0, `unforced: exit 0, got: ${soft.out}`);
    assert(/gh auth login/.test(soft.out), `unforced: the same fix, got: ${soft.out}`);
    cleanup(world.root);
  });

  await test('forced, something in the way of the clone stops it with exit 1 before it writes anything', () => {
    const world = mkWorld({ login: 'owner' });
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'mine.txt'), 'mine\n');
    const { code, out } = forced(world);
    assertEq(code, 1, `exit 1, got: ${out}`);
    assert(/move it aside/.test(out), `it names what is in the way, got: ${out}`);
    assert(!/Discussions/.test(out), 'and no later step ran');
    assert(!fs.existsSync(path.join(world.tower, 'package.json')), 'nothing was seeded over it');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
