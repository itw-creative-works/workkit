// Tests for workflow/workkit.sh: `workkit log`, which prints the tail of the
// hook log in the workkit home (WORKFLOW_HOME/hooks.log).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, until, start } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  WORKFLOW_DIR, CLI, cleanup, mkWorld, runCli,
} = require('./helpers');

// A world whose hook log holds `count` numbered lines; returns them too.
const withLog = (count) => {
  const world = mkWorld();
  const lines = Array.from({ length: count }, (_, i) => `2026-10-18T00:00:${String(i).padStart(2, '0')}Z\tdocs:checkpoint\tUserPromptSubmit\ts1\t/repo\trun ${i + 1}`);
  fs.mkdirSync(world.workflowHome, { recursive: true });
  fs.writeFileSync(path.join(world.workflowHome, 'hooks.log'), `${lines.join('\n')}\n`);
  return { world, lines };
};

const printed = (out) => out.split('\n').filter(Boolean);

describe('workkit log', () => {
  test('a 60-line log prints its last 40 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log']);
    expect(code, 'exit 0').toBe(0);
    expect(JSON.stringify(printed(out)), 'the last 40 lines, in order').toBe(JSON.stringify(lines.slice(-40)));
    cleanup(world.root);
  });

  test('-n 5 prints the last 5 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log', '-n', '5']);
    expect(code, 'exit 0').toBe(0);
    expect(JSON.stringify(printed(out)), 'the last 5 lines, in order').toBe(JSON.stringify(lines.slice(-5)));
    cleanup(world.root);
  });

  test('no log prints one skip line and exits 0', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['log']);
    expect(code, 'exit 0').toBe(0);
    expect(printed(said).length, `one line, got: ${JSON.stringify(said)}`).toBe(1);
    expect(!/unknown command/.test(said), `the command is known, got: ${said}`).toBeTruthy();
    expect(!fs.existsSync(path.join(world.workflowHome, 'hooks.log')), 'reading creates no log').toBeTruthy();
    cleanup(world.root);
  });

  test('--follow prints a line appended after it started, while it is still running', async () => {
    const { world, lines } = withLog(3);
    const logFile = path.join(world.workflowHome, 'hooks.log');
    // Its own process group off Windows, so the kill reaches a `tail` the
    // command did not exec into as well as the shell.
    const follow = start(BASH, [...NO_RC, shellPath(CLI), 'log', '--follow'], {
      cwd: world.root, env: world.env, detached: !IS_WINDOWS,
    });
    const said = follow.output;
    let ended = false;
    follow.child.on('exit', () => { ended = true; });
    try {
      expect(await until(() => said().includes(lines[2])), `the existing tail printed first, got: ${said()}`).toBeTruthy();
      const appended = '2026-10-18T00:01:00Z\tdocs:checkpoint\tUserPromptSubmit\ts1\t/repo\tappended';
      fs.appendFileSync(logFile, `${appended}\n`);
      expect(await until(() => said().includes(appended)), `the appended line printed, got: ${said()}`).toBeTruthy();
      expect(!ended, `and the command was still following when it did: ${said()}`).toBeTruthy();
    } finally {
      await follow.end('SIGKILL');
    }
    cleanup(world.root);
  });

  test('a checkout with no workflow/home.sh still prints the log and exits 0', () => {
    const { world, lines } = withLog(60);
    const kit = mkTmp('workkit-cli-');
    fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
    fs.rmSync(path.join(kit, 'workflow', 'home.sh'));
    const { code, out, said } = runCli(world, ['log'], { script: path.join(kit, 'workflow', 'workkit.sh') });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(JSON.stringify(printed(out)), `the last 40 lines, in order, got: ${said}`).toBe(JSON.stringify(lines.slice(-40)));
    cleanup(world.root); cleanup(kit);
  });
});
