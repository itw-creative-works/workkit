// Tests for workflow/workkit.sh: `brief` (today's brief, asked for now),
// and `tower` and `decline` beside it.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { shellPath, gitPath } = require('../../lib/platform');
const { recordArgv, readArgv, fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, writeStub, mkWorld, runCli, mkRepo, seedSettings, mkPartialKit,
} = require('./helpers');

describe('workkit brief: today’s brief, asked for now (issue #54)', () => {
  const BOTH_SECRETS = [
    { name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 30 },
    { name: 'WORKKIT_GITHUB_TOKEN', days: 30 },
  ];

  test('brief dispatches the same cloud run the 9am schedule does', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    const { code, out } = runCli(world, ['brief']);
    expect(code, `exit 0, got: ${out}`).toBe(0);
    const sent = world.ghCalls().filter((c) => c[0] === 'workflow' && c[1] === 'run');
    expect(sent.length, `one workflow run: ${fmtCalls(world.ghCalls())}`).toBe(1);
    expect(sent[0][2], 'the brief workflow').toBe('brief.yml');
    expect(sent[0][4], 'on the home repo, where the secrets live').toBe('owner/private-home');
    expect(/dispatched brief\.yml on owner\/private-home/.test(out), `it says the day went over: ${out}`).toBeTruthy();
    expect(out.includes('https://github.com/owner/private-home/actions/workflows/brief.yml'),
      `and where to watch it: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a refusal is loud here: a human asked for this one now', () => {
    // The scheduled morning logs the same reason and exits 0; at a terminal
    // there is somebody to tell, so the command fails.
    const world = mkWorld({ secrets: [{ name: 'WORKKIT_GITHUB_TOKEN', days: 30 }] });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    const { code, said } = runCli(world, ['brief']);
    expect(code, `exit 1, got: ${said}`).toBe(1);
    expect(/does not carry CLAUDE_CODE_OAUTH_TOKEN/.test(said), `naming the reason: ${said}`).toBeTruthy();
    expect(world.ghCalls().filter((c) => c[0] === 'workflow').length, 'and no day went over').toBe(0);
    cleanup(world.root);
  });

  test('brief --local runs the morning here and dispatches nothing', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    seedSettings(world, { repo: 'owner/private-home', publish: false, url: null });
    // The morning itself is the seam: this asserts the command reaches it with
    // the rehearsal flag, not what a whole morning does (jobs/morning-local/).
    const { kit, script } = mkPartialKit();
    const morningLog = path.join(kit, 'morning-argv.log');
    fs.mkdirSync(path.join(kit, 'jobs'), { recursive: true });
    writeStub(path.join(kit, 'jobs', 'morning.sh'), [recordArgv(morningLog), 'exit 0']);
    const { code } = runCli(world, ['brief', '--local'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(readArgv(morningLog).map((c) => c.join(' ')).join('; '), 'the rehearsal: composed here, publishing nothing').toBe('--now');
    expect(world.ghCalls().filter((c) => c[0] === 'workflow').length, 'and nothing was handed to a runner').toBe(0);
    cleanup(world.root); cleanup(kit);
  });

  test('brief in a partial checkout says what is missing instead of running nothing', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    const { kit, script } = mkPartialKit();
    const { code, err } = runCli(world, ['brief'], { script });
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('needs the whole kit'), `the error names the kit as the cause, got: ${err}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('brief takes --local or nothing at all', () => {
    const world = mkWorld({ secrets: BOTH_SECRETS });
    const { code, err } = runCli(world, ['brief', '--cloud']);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('--local'), `and says what it does take, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('tower runs the whole tower: the start wrapper, with the checkout resolved', () => {
    // The commands are injected the same way tower/start.sh's own suite does
    // it, so the CLI path is proven end-to-end without opening a port.
    const world = mkWorld();
    const api = path.join(world.root, 'api.ran');
    const app = path.join(world.root, 'app.ran');
    // Each half records itself and then waits for the other's marker: the
    // wrapper takes one half down the moment the other is gone, so a half that
    // exits at once can kill its sibling before it runs. Waiting ends the run
    // once both halves have demonstrably run, which is what this case claims.
    const half = (mine, theirs) => [
      `echo x > '${shellPath(mine)}'`,
      `while [ ! -e '${shellPath(theirs)}' ]; do sleep 0.2; done`,
    ].join('; ');
    const { code } = runCli(world, ['tower'], {
      // Ports emptied so a test run never reclaims this machine's real tower.
      env: { WORKKIT_TOWER_API: half(api, app), WORKKIT_TOWER_APP: half(app, api), WORKKIT_TOWER_PORTS: '' },
    });
    expect(code, 'exit 0 once both halves ended').toBe(0);
    expect(fs.existsSync(api) && fs.existsSync(app), 'both halves were started through the wrapper').toBeTruthy();
    cleanup(world.root);
  });

  test('tower in a partial checkout says what is missing instead of running nothing', () => {
    const world = mkWorld();
    const { script } = mkPartialKit();
    const { code, err } = runCli(world, ['tower'], { script });
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('needs the whole kit'), `the error names the kit as the cause, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('decline records the answer in the user’s own settings, not the repo’s', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['decline', shellPath(repo)]);
    expect(code, 'exit 0').toBe(0);
    const user = JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.repos.json'), 'utf8'));
    expect(user.repos[gitPath(fs.realpathSync(repo))] || user.repos[gitPath(repo)], 'the personal file carries it').toBe('declined');
    expect(!fs.existsSync(path.join(repo, W)), 'and the repo is never written to').toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });
});
