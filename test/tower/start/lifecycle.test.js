//
// Tests for tower/start.js: the two halves' lifecycle (one interrupt or either
// ending ends both, a half's last line read before it is ended) and a held port,
// replaced not collided with. Prologue: ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, endTree,
} = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  cleanup, alive, until, pidIn, pidOnSight, start, standIn, nodeHalf, STARTING, skipOnWindowsTerm,
} = require('./helpers');

// A half stub that puts a child between itself and the sleeper, the way npm
// and omega put children between the wrapper and the real server.
const grandchild = (pidFile) => `bash -c "echo \\$\\$ > '${pidFile}'; exec sleep 30" & wait`;

// The pids recorded so far by the grandchild stubs writing <files>.
const recorded = (files) => files.map(pidIn).filter(Boolean);

describe('tower/start: one command, both processes', () => {
  test('both halves start, and one interrupt ends both', { skip: skipOnWindowsTerm() }, async () => {
    const dir = mkTmp('tower-start-');
    const apiPid = path.join(dir, 'api.pid');
    const appPid = path.join(dir, 'app.pid');
    const tower = start(dir,
      `echo $$ > '${apiPid}'; exec sleep 30`,
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      expect(await until(() => pidIn(apiPid) > 0 && pidIn(appPid) > 0), 'both commands were started').toBeTruthy();
      const pids = [pidIn(apiPid), pidIn(appPid)];
      expect(pids.every(alive), 'and both are running').toBeTruthy();

      tower.child.kill('SIGTERM');
      expect(await until(() => pids.every((pid) => !alive(pid))), 'one interrupt took both down').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('either half ending takes the other with it - nothing lingers half-up', async () => {
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const tower = start(dir, 'sleep 0.3', nodeHalf(dir, appPid));
    try {
      expect(await until(() => pidIn(appPid) > 0), 'the surviving half started').toBeTruthy();
      const pid = pidIn(appPid);
      expect(await until(() => !alive(pid)), 'and ended when its sibling did').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'the wrapper itself ended too').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a half that exits leaving a background child behind still ends the other', async () => {
    // The half's end is its own exit, not the close of its output, which lives
    // until every writer of it has closed; this stub's leftover child holds it,
    // and the other half stays up, both past the wait.
    const dir = mkTmp('tower-start-');
    const appPid = path.join(dir, 'app.pid');
    const leftPid = path.join(dir, 'left.pid');
    const tower = start(dir, `sleep 120 & echo $! > '${leftPid}'; exit 0`, nodeHalf(dir, appPid, 120000));
    try {
      expect(await until(() => pidIn(appPid) > 0), 'the surviving half started').toBeTruthy();
      const pid = pidIn(appPid);
      expect(await until(() => !alive(pid)), 'and ended when its sibling exited').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'the wrapper itself ended too').toBeTruthy();
      expect((await tower.done).timedOut, 'on its own, never by the run\'s deadline').toBe(false);
    } finally {
      await tower.end('SIGKILL');
      recorded([leftPid]).forEach((left) => endTree(left, 'SIGKILL'));
      cleanup(dir);
    }
  });

  test('a half that prints its last line and exits at once has that line shown', async () => {
    // The line has no newline, as a half that dies mid-line leaves it.
    const dir = mkTmp('tower-start-');
    const half = path.join(dir, 'last.js');
    const last = 'omega: the last line before the end';
    fs.writeFileSync(half, `process.stdout.write(${JSON.stringify(last)});\n`);
    const tower = start(dir, 'exec sleep 30', `"${shellPath(process.execPath)}" "${shellPath(half)}"`);
    try {
      const { timedOut } = await tower.done;
      expect(timedOut, 'the run ended when its half did').toBe(false);
      expect(tower.output().includes(last), `the half's last line was shown: ${tower.output()}`).toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('ending a half ends its whole tree - a grandchild server dies with it', { skip: skipOnWindowsTerm() }, async () => {
    const dir = mkTmp('tower-start-');
    const kidPid = path.join(dir, 'kid.pid');
    const tower = start(dir, 'exec sleep 30', grandchild(kidPid));
    try {
      expect(await until(() => pidIn(kidPid) > 0), 'the grandchild started').toBeTruthy();
      const pid = pidIn(kidPid);
      tower.child.kill('SIGTERM');
      expect(await until(() => !alive(pid)), 'and died with the tree, not orphaned').toBeTruthy();
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a signal the instant a grandchild appears ends every tree promptly, ten times over', { skip: skipOnWindowsTerm() }, async () => {
    // The signal goes the moment the app's grandchild records itself, while the
    // starter may still be starting a half: by the time the wrapper has
    // exited, every tree must already be gone. Both halves carry a grandchild,
    // so the case holds whichever half spawns first.
    for (let round = 1; round <= 10; round += 1) {
      const dir = mkTmp('tower-start-');
      const kids = [path.join(dir, 'api-kid.pid'), path.join(dir, 'app-kid.pid')];
      const tower = start(dir, grandchild(kids[0]), grandchild(kids[1]));
      try {
        const pid = await pidOnSight(kids[1]);
        tower.child.kill('SIGTERM');
        expect(pid > 0, `round ${round}: the app's grandchild started`).toBeTruthy();
        expect(await until(() => tower.child.exitCode !== null || tower.child.signalCode !== null), `round ${round}: the wrapper never exited`).toBeTruthy();
        expect(recorded(kids).every((kid) => !alive(kid)),
          `round ${round}: every grandchild was gone when the wrapper exited, none orphaned`).toBeTruthy();
      } finally {
        await tower.end('SIGKILL');
        recorded(kids).forEach((kid) => endTree(kid, 'SIGKILL'));
        cleanup(dir);
      }
    }
  });

  test('a previous instance on a tower port is replaced, not collided with', async (t) => {
    // A stand-in for a leftover server: a child of this test listening on an
    // ephemeral port, handed to the wrapper as the tower's port.
    const listener = standIn(
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    t.after(() => listener.end('SIGKILL'));
    expect(await until(() => listener.stdout().trim().length > 0), 'the stand-in took a port').toBeTruthy();
    const port = listener.stdout();

    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      expect(await until(() => listener.child.exitCode !== null || listener.child.signalCode !== null),
        'the wrapper ended it before starting its own').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'and the run itself completed').toBeTruthy();
      expect(tower.child.exitCode, 'cleanly').toBe(0);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a listener that ignores the polite signal is escalated, not collided with', async (t) => {
    // A TERM-resistant listener must not ride out the 5s deadline and leave the
    // fresh server dying EADDRINUSE with nothing explaining why.
    const listener = standIn(
      "process.on('SIGTERM',()=>{});const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));");
    t.after(() => listener.end('SIGKILL'));
    expect(await until(() => listener.stdout().trim().length > 0), 'the stubborn stand-in took a port').toBeTruthy();
    const port = listener.stdout();

    const dir = mkTmp('tower-start-');
    const tower = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      expect(await until(() => listener.child.exitCode !== null || listener.child.signalCode !== null),
        'the wrapper ended it anyway - the escalation exists').toBeTruthy();
      expect(await until(() => tower.child.exitCode !== null), 'and the run completed').toBeTruthy();
      expect(tower.child.exitCode, 'cleanly, on the freed port').toBe(0);
    } finally {
      await tower.end('SIGKILL');
      cleanup(dir);
    }
  });

  test('a signal during startup is a clean exit with no error line',
    { skip: skipOnWindowsTerm() }, async () => {
      // The signal goes on the tower's first line, while it may still be starting
      // its halves, with no port to reclaim: the run ends cleanly and leaves no
      // half running.
      const dir = mkTmp('tower-start-');
      const halves = [path.join(dir, 'api.pid'), path.join(dir, 'app.pid')];
      const tower = start(dir,
        `echo $$ > '${halves[0]}'; exec sleep 30`,
        `echo $$ > '${halves[1]}'; exec sleep 30`,
        '');
      const out = tower.output;
      let signalled = false;
      tower.child.stdout.on('data', () => {
        if (!signalled && out().split('\n').some((line) => STARTING.test(line))) { signalled = true; tower.child.kill('SIGTERM'); }
      });
      let closed = false;
      tower.child.on('close', () => { closed = true; });
      try {
        expect(await until(() => signalled), 'the tower said it was starting').toBeTruthy();
        expect(await until(() => tower.child.exitCode !== null || tower.child.signalCode !== null), 'the wrapper ended on the signal').toBeTruthy();
        await until(() => closed);
        expect(`${tower.child.exitCode}/${tower.child.signalCode}`, 'with status 0, its own exit rather than the signal\'s').toBe('0/null');
        const errors = out().split('\n').filter((line) => line.trim() && !STARTING.test(line));
        expect(errors.join('\n'), 'and it printed no error line, only that it was starting').toBe('');
        expect(recorded(halves).every((pid) => !alive(pid)), 'and left no half running').toBeTruthy();
      } finally {
        await tower.end('SIGKILL');
        cleanup(dir);
      }
    });
});
