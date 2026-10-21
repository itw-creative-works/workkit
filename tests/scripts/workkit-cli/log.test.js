// Tests for workflow/workkit.sh: `workkit log`, which prints the tail of the
// hook log in the workkit home (WORKFLOW_HOME/hooks.log).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, shellPath } = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { until, collect } = require('../../lib/process');
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

const run = async () => {
  group('workkit log');

  await test('a 60-line log prints its last 40 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log']);
    assertEq(code, 0, 'exit 0');
    assertEq(JSON.stringify(printed(out)), JSON.stringify(lines.slice(-40)), 'the last 40 lines, in order');
    cleanup(world.root);
  });

  await test('-n 5 prints the last 5 lines', () => {
    const { world, lines } = withLog(60);
    const { code, out } = runCli(world, ['log', '-n', '5']);
    assertEq(code, 0, 'exit 0');
    assertEq(JSON.stringify(printed(out)), JSON.stringify(lines.slice(-5)), 'the last 5 lines, in order');
    cleanup(world.root);
  });

  await test('no log prints one skip line and exits 0', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['log']);
    assertEq(code, 0, 'exit 0');
    assertEq(printed(said).length, 1, `one line, got: ${JSON.stringify(said)}`);
    assert(!/unknown command/.test(said), `the command is known, got: ${said}`);
    assert(!fs.existsSync(path.join(world.workflowHome, 'hooks.log')), 'reading creates no log');
    cleanup(world.root);
  });

  await test('--follow prints a line appended after it started, while it is still running', async () => {
    const { world, lines } = withLog(3);
    const logFile = path.join(world.workflowHome, 'hooks.log');
    // Its own process group off Windows, so the kill reaches a `tail` the
    // command did not exec into as well as the shell.
    const child = spawn(BASH, [...NO_RC, shellPath(CLI), 'log', '--follow'], {
      cwd: world.root, env: world.env, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WINDOWS,
    });
    const said = collect(child);
    let ended = false;
    child.on('exit', () => { ended = true; });
    try {
      assert(await until(() => said().includes(lines[2])), `the existing tail printed first, got: ${said()}`);
      const appended = '2026-10-18T00:01:00Z\tdocs:checkpoint\tUserPromptSubmit\ts1\t/repo\tappended';
      fs.appendFileSync(logFile, `${appended}\n`);
      assert(await until(() => said().includes(appended)), `the appended line printed, got: ${said()}`);
      assert(!ended, `and the command was still following when it did: ${said()}`);
    } finally {
      try { if (IS_WINDOWS) child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    cleanup(world.root);
  });

  await test('a checkout with no workflow/home.sh still prints the log and exits 0', () => {
    const { world, lines } = withLog(60);
    const kit = mkTmp('workkit-cli-');
    fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
    fs.rmSync(path.join(kit, 'workflow', 'home.sh'));
    const { code, out, said } = runCli(world, ['log'], { script: path.join(kit, 'workflow', 'workkit.sh') });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(JSON.stringify(printed(out)), JSON.stringify(lines.slice(-40)), `the last 40 lines, in order, got: ${said}`);
    cleanup(world.root); cleanup(kit);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
