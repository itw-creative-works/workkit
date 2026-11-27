// Tests for workflow/workkit.js: `workkit log`, which prints the tail of the
// hook log in the workkit home (WORKFLOW_HOME/hooks.log).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, until, start } = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const {
  CLI, cleanup, mkWorld, runCli,
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

// `workkit log --follow` started by this node, the head of its own group off Windows.
const startFollow = (world) => start(process.execPath, [CLI, 'log', '--follow'], {
  cwd: world.root, env: world.env, detached: !IS_WINDOWS,
});

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
    const follow = startFollow(world);
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

  test('--follow ends 130 on INT, as a Ctrl-C at its terminal ends it', { skip: IS_WINDOWS && 'Windows has no INT a test can send to a running process' }, async () => {
    const { world, lines } = withLog(3);
    const follow = startFollow(world);
    try {
      expect(await until(() => follow.output().includes(lines[2])), `it is following, got: ${follow.output()}`).toBeTruthy();
      // The whole group, as a terminal's Ctrl-C reaches it; never the end ladder, whose TERM would end it too.
      process.kill(-follow.pid, 'SIGINT');
      const res = await follow.done;
      expect(!res.timedOut, `it ended on the INT, not at the deadline, got: ${follow.output()}`).toBeTruthy();
      expect(res.status, `the follow catches the INT and ends 130, got status ${res.status}, signal ${res.signal}`).toBe(130);
    } finally {
      await follow.end('SIGKILL');
    }
    cleanup(world.root);
  });
});
