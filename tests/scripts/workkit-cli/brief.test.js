//
// Tests for workflow/workkit.sh: `brief` (today's brief, asked for now),
// and `tower` and `decline` beside it.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { shellPath, gitPath } = require('../../lib/platform');
const { recordArgv, readArgv, fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, writeStub, mkWorld, runCli, mkRepo, seedSettings, mkPartialKit,
} = require('./helpers');

const run = async () => {
  group('workkit brief: today’s brief, asked for now (issue #54)');

  const BOTH_SECRETS = [
    { name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 30 },
    { name: 'WORKKIT_GITHUB_TOKEN', days: 30 },
  ];

  await test('brief dispatches the same cloud run the 9am schedule does', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    const { code, out } = runCli(world, ['brief']);
    assertEq(code, 0, `exit 0, got: ${out}`);
    const sent = world.ghCalls().filter((c) => c[0] === 'workflow' && c[1] === 'run');
    assertEq(sent.length, 1, `one workflow run: ${fmtCalls(world.ghCalls())}`);
    assertEq(sent[0][2], 'brief.yml', 'the brief workflow');
    assertEq(sent[0][4], 'owner/private-home', 'on the home repo, where the secrets live');
    assert(/dispatched brief\.yml on owner\/private-home/.test(out), `it says the day went over: ${out}`);
    assert(out.includes('https://github.com/owner/private-home/actions/workflows/brief.yml'),
      `and where to watch it: ${out}`);
    cleanup(world.root);
  });

  await test('a refusal is loud here: a human asked for this one now', () => {
    // The scheduled morning logs the same reason and exits 0; at a terminal
    // there is somebody to tell, so the command fails.
    const world = mkWorld({ secrets: [{ name: 'WORKKIT_GITHUB_TOKEN', days: 30 }] });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    const { code, said } = runCli(world, ['brief']);
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(/does not carry CLAUDE_CODE_OAUTH_TOKEN/.test(said), `naming the reason: ${said}`);
    assertEq(world.ghCalls().filter((c) => c[0] === 'workflow').length, 0, 'and no day went over');
    cleanup(world.root);
  });

  await test('brief --local runs the morning here and dispatches nothing', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    // The morning itself is the seam: this asserts the command reaches it with
    // the rehearsal flag, not what a whole morning does (jobs/morning-local/).
    const { kit, script } = mkPartialKit();
    const morningLog = path.join(kit, 'morning-argv.log');
    fs.mkdirSync(path.join(kit, 'jobs'), { recursive: true });
    writeStub(path.join(kit, 'jobs', 'morning.sh'), [recordArgv(morningLog), 'exit 0']);
    const { code } = runCli(world, ['brief', '--local'], { script });
    assertEq(code, 0, 'exit 0');
    assertEq(readArgv(morningLog).map((c) => c.join(' ')).join('; '), '--now',
      'the rehearsal: composed here, publishing nothing');
    assertEq(world.ghCalls().filter((c) => c[0] === 'workflow').length, 0, 'and nothing was handed to a runner');
    cleanup(world.root); cleanup(kit);
  });

  await test('brief in a partial checkout says what is missing instead of running nothing', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    const { kit, script } = mkPartialKit();
    const { code, err } = runCli(world, ['brief'], { script });
    assertEq(code, 1, 'exit 1');
    assert(err.includes('needs the workkit checkout'), `the error names the cause, got: ${err}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('brief takes --local or nothing at all', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    const { code, err } = runCli(world, ['brief', '--cloud']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('--local'), `and says what it does take, got: ${err}`);
    cleanup(world.root);
  });

  await test('the map names the command', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['help']);
    assert(/^ {2}brief \[--local\]/m.test(out), `help lists it, got: ${out}`);
  });

  await test('tower runs the whole tower: the start wrapper, with the checkout resolved', () => {
    // The commands are injected the same way tower/start.sh's own suite does
    // it, so the CLI path is proven end-to-end without opening a port.
    const world = mkWorld();
    const api = path.join(world.root, 'api.ran');
    const app = path.join(world.root, 'app.ran');
    // Each half records itself and then waits for the other's marker. A half
    // that exits the instant it is started ends the whole RUN: the wrapper
    // takes the other one down the moment either is gone, and a shell takes
    // longer to start than that poll takes to notice, so the second half was
    // being killed before it ran its command at all. Waiting ends the run when
    // both halves have demonstrably run, which is what this case claims.
    const half = (mine, theirs) => [
      `echo x > '${shellPath(mine)}'`,
      `while [ ! -e '${shellPath(theirs)}' ]; do sleep 0.2; done`,
    ].join('; ');
    const { code } = runCli(world, ['tower'], {
      // Ports emptied so a test run never reclaims this machine's real tower.
      env: { WORKKIT_TOWER_API: half(api, app), WORKKIT_TOWER_APP: half(app, api), WORKKIT_TOWER_PORTS: '' },
    });
    assertEq(code, 0, 'exit 0 once both halves ended');
    assert(fs.existsSync(api) && fs.existsSync(app), 'both halves were started through the wrapper');
    cleanup(world.root);
  });

  await test('tower in a partial checkout says what is missing instead of running nothing', () => {
    const world = mkWorld();
    const { script } = mkPartialKit();
    const { code, err } = runCli(world, ['tower'], { script });
    assertEq(code, 1, 'exit 1');
    assert(err.includes('needs the workkit checkout'), `the error names the cause, got: ${err}`);
    cleanup(world.root);
  });

  await test('decline records the answer in the user’s own settings, not the repo’s', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['decline', shellPath(repo)]);
    assertEq(code, 0, 'exit 0');
    const user = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    assertEq(user.repos[gitPath(fs.realpathSync(repo))] || user.repos[gitPath(repo)], 'declined',
      'the personal file carries it');
    assert(!fs.existsSync(path.join(repo, W)), 'and the repo is never written to');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
