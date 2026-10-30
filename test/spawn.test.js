// Tests for packages/core/test/lib/spawn.js through the one entry: run() keeps both
// streams and the exit, start() streams while its child runs and end() ends its
// group, climbing INT, TERM, KILL only while the child lives, its stdin carries
// the input given, else is empty, a deadline ends a
// child that never exits, and endTree() ends a group, refuses a pid that is
// not a positive integer and throws on a signal the system refuses.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun,
  run, start, endTree, alive, until, readPid, mkTmp,
} = require('./lib/harness');
const { IS_WINDOWS } = require('./lib/platform');

// Writes one line to each stream, stdout first, then exits 3.
const BOTH = 'process.stdout.write("to stdout\\n", () => { process.stderr.write("to stderr\\n", () => process.exit(3)); });';

// Never exits on its own.
const FOREVER = 'setInterval(() => {}, 1000);';

// Prints `first`, then `second` once the file `go` exists, then exits 0.
const STEPPED = (go) => `
  const fs = require("fs");
  process.stdout.write("first\\n");
  const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(go)})) { clearInterval(t); process.stdout.write("second\\n"); } }, 20);
`;

// Writes the grandchild `g`'s pid to `pidFile` whole, through a rename.
const WRITES_PID = (pidFile) => `
  fs.writeFileSync(${JSON.stringify(`${pidFile}.part`)}, String(g.pid));
  fs.renameSync(${JSON.stringify(`${pidFile}.part`)}, ${JSON.stringify(pidFile)});
`;

// Spawns a grandchild that never exits, writes its pid to `pidFile`, and waits.
const PARENT = (pidFile) => `
  const fs = require("fs");
  const { spawn } = require("child_process");
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  ${WRITES_PID(pidFile)}
  setInterval(() => {}, 1000);
`;

// Leaves a grandchild that never exits holding its stdout open, writes the
// grandchild's pid to `pidFile`, prints one line, and exits 0 at once.
const LEAVES_STDOUT = (pidFile) => `
  const fs = require("fs");
  const { spawn } = require("child_process");
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { detached: true, stdio: ["ignore", "inherit", "ignore"] });
  ${WRITES_PID(pidFile)}
  process.stdout.write("from the child\\n", () => process.exit(0));
`;

// Records each INT and TERM it gets to `record`, one name a line, and lives on
// through both; prints `ready` once its traps are set.
const TRAPS = (record) => `
  const fs = require("fs");
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => fs.appendFileSync(${JSON.stringify(record)}, \`\${sig}\\n\`));
  setInterval(() => {}, 1000);
  process.stdout.write("ready\\n");
`;

// Spins until the pid in $1 is a zombie: exited, its parent not yet told.
const UNTIL_ZOMBIE = 'until ps -o stat= -p "$1" | grep -q Z; do :; done';

// Exits 4 at once, on its own.
const EXITS = 'process.exit(4);';

// Writes all its stdin back to stdout, then exits 0 once stdin ends.
const ECHOES = 'process.stdin.pipe(process.stdout);';

// More than a pipe buffer holds, so a child that never reads leaves a write pending.
const BIG_INPUT = 'x'.repeat(1 << 20);

// A bound short enough that only a deadline can end the child first.
const SHORT = 300;

// What `promise` resolved to within the shared deadline, else undefined.
const settle = async (promise) => {
  let value;
  promise.then((v) => { value = v; });
  await until(() => value !== undefined);
  return value;
};

// The first process owned by root with a pid above 1, or null. Never pid 1: a
// user that is not root is refused kill(1), but where pid 1 is this user's own
// entrypoint the case's TERM would be real.
const rootOwnedPid = () => {
  const rows = run('ps', ['-A', '-o', 'pid=,uid=']).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const row = rows.find(([pid, uid]) => uid === 0 && pid > 1);
  return row ? row[0] : null;
};

// Kills each of `pids`, a gone one no error, so a failed case leaves no process behind.
const endAll = (...pids) => {
  for (const pid of pids) if (pid) endTree(pid, 'SIGKILL');
};

const cases = async () => {
  group('spawn: run()');

  await test('run keeps both streams, stdout then stderr, and the status; a child past its deadline comes back timedOut with a signal', () => {
    const done = run(process.execPath, ['-e', BOTH]);
    assertEq(done.stdout, 'to stdout\n', 'stdout alone');
    assertEq(done.stderr, 'to stderr\n', 'stderr alone');
    assertEq(done.output, 'to stdout\nto stderr\n', 'output is stdout, then stderr');
    assertEq(done.status, 3, 'the exit status');
    assertEq(done.timedOut, false, 'an exit is no timeout');
    const late = run(process.execPath, ['-e', FOREVER], { deadline: SHORT });
    assertEq(late.timedOut, true, `the deadline ended it, got: ${JSON.stringify(late)}`);
    assert(late.signal, `a signal is set, got: ${JSON.stringify(late)}`);
  });

  group('spawn: start()');

  await test('start: output grows while the child runs, done resolves on exit, and end() ends a grandchild too', async () => {
    const dir = mkTmp('spawn-');
    const go = path.join(dir, 'go');
    const stepped = start(process.execPath, ['-e', STEPPED(go)]);
    assert(await until(() => stepped.output().includes('first')), `the first line arrives while the child runs, got: ${stepped.output()}`);
    assert(!stepped.output().includes('second') && alive(stepped.pid), 'the child is still running, the second line not yet written');
    fs.writeFileSync(go, '');
    const exit = await settle(stepped.done);
    assert(exit, 'done resolved once the child exited');
    assertEq(exit.status, 0, 'the exit status');
    assertEq(stepped.output(), 'first\nsecond\n', 'output() grew by the second line');

    const pidFile = path.join(dir, 'grandchild.pid');
    const tree = start(process.execPath, ['-e', PARENT(pidFile)], { detached: true });
    let grand;
    try {
      assert(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid');
      grand = readPid(pidFile);
      assert(alive(tree.pid) && alive(grand), 'child and grandchild both alive before end()');
      await tree.end();
      assert(!alive(tree.pid), 'the child is gone once end() resolves');
      assert(await until(() => !alive(grand)), 'the grandchild is gone too');
    } finally {
      endAll(tree.pid, grand);
    }
  });

  await testUnless(IS_WINDOWS, 'Windows ends a child through one taskkill, no signal ladder')(
    'end() climbs INT, TERM, KILL while the child lives: a child trapping INT and TERM gets both in order and is ended by KILL; a child that exits on INT is ended by INT',
    async () => {
      const record = path.join(mkTmp('spawn-'), 'signals');
      const trapped = start(process.execPath, ['-e', TRAPS(record)]);
      const plain = start(process.execPath, ['-e', FOREVER]);
      try {
        assert(await until(() => trapped.output().includes('ready')), `the trapping child set its traps, got: ${trapped.output()}`);
        await trapped.end();
        assert(!alive(trapped.pid), 'the trapping child is gone once end() resolves');
        const trappedExit = await settle(trapped.done);
        assertEq(trappedExit?.signal, 'SIGKILL', `KILL ended the trapping child, got: ${JSON.stringify(trappedExit)}`);
        assertEq(fs.readFileSync(record, 'utf8'), 'SIGINT\nSIGTERM\n', 'the child got INT, then TERM, before the KILL');

        await plain.end();
        const plainExit = await settle(plain.done);
        assertEq(plainExit?.signal, 'SIGINT', `INT ended the plain child, the first rung, got: ${JSON.stringify(plainExit)}`);
      } finally {
        endAll(trapped.pid, plain.pid);
      }
    },
  );

  await test('end() on a child already gone, plain or detached, sends nothing: done reports the child\'s own exit and end() resolves', async () => {
    for (const detached of [false, true]) {
      const child = start(process.execPath, ['-e', EXITS], { detached });
      try {
        const exit = await settle(child.done);
        assertEq(exit?.status, 4, `the child's own exit status (detached: ${detached}), got: ${JSON.stringify(exit)}`);
        assertEq(exit.signal, null, `no signal ended it (detached: ${detached})`);
        // Forwards every call to the real process.kill and only records: the one seam that shows nothing was sent.
        const sent = [];
        const realKill = process.kill;
        process.kill = (pid, signal) => { sent.push({ pid, signal }); return realKill.call(process, pid, signal); };
        try {
          await child.end();
        } finally {
          process.kill = realKill;
        }
        const rungs = sent.filter(({ pid, signal }) => (pid === child.pid || pid === -child.pid) && signal !== 0);
        assertEq(JSON.stringify(rungs), '[]', `end() sent no signal but the alive probe to the child or its group (detached: ${detached})`);
      } finally {
        endAll(child.pid);
      }
    }
  });

  await testUnless(IS_WINDOWS, 'Windows ends a child through one taskkill, no signal probe')(
    'end() on a detached child that exited and is not yet reaped resolves, and done reports its exit 0',
    async () => {
      const child = start('/bin/sh', ['-c', 'exit 0'], { detached: true });
      // Blocks the loop until the child is a zombie, so the signal probe meets it unreaped.
      const stretch = run('/bin/sh', ['-c', UNTIL_ZOMBIE, 'sh', String(child.pid)]);
      assertEq(stretch.status, 0, `the child exited and waits unreaped, got: ${JSON.stringify(stretch)}`);
      let rejected;
      await child.end().catch((err) => { rejected = err; });
      assertEq(rejected?.message, undefined, 'end() resolves on a child that already exited');
      const exit = await settle(child.done);
      assertEq(exit?.status, 0, `done reports the child's own exit, got: ${JSON.stringify(exit)}`);
    },
  );

  await testUnless(IS_WINDOWS, 'Windows ends a tree through taskkill, not a signal')(
    'endTree on a detached child that exited and is not yet reaped ends quietly, and done reports its exit 0',
    async () => {
      const child = start('/bin/sh', ['-c', 'exit 0'], { detached: true });
      // Blocks the loop until the child is a zombie, so endTree meets it unreaped.
      const stretch = run('/bin/sh', ['-c', UNTIL_ZOMBIE, 'sh', String(child.pid)]);
      assertEq(stretch.status, 0, `the child exited and waits unreaped, got: ${JSON.stringify(stretch)}`);
      let threw;
      try { endTree(child.pid, 'SIGKILL'); } catch (err) { threw = err; }
      assertEq(threw?.message, undefined, 'endTree does not throw on a leader that already exited');
      const exit = await settle(child.done);
      assertEq(exit?.status, 0, `done reports the child's own exit, got: ${JSON.stringify(exit)}`);
    },
  );

  await test('the watchdog: a child that never exits is ended at its deadline and done reports timedOut', async () => {
    const forever = start(process.execPath, ['-e', FOREVER], { deadline: SHORT });
    const exit = await settle(forever.done);
    assert(exit, 'done resolved');
    assertEq(exit.timedOut, true, `done reports timedOut, got: ${JSON.stringify(exit)}`);
    assert(!alive(forever.pid), 'the child is gone');
  });

  await test('done reports an exit, never timedOut, for a child that exited while its grandchild holds stdout open', async () => {
    const pidFile = path.join(mkTmp('spawn-'), 'grandchild.pid');
    const child = start(process.execPath, ['-e', LEAVES_STDOUT(pidFile)]);
    let grand;
    try {
      assert(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid');
      grand = readPid(pidFile);
      const exit = await settle(child.done);
      assert(exit, 'done resolved');
      assertEq(exit.status, 0, 'the child\'s own exit status');
      assertEq(exit.timedOut, false, `an exit before the deadline is no timeout, got: ${JSON.stringify(exit)}`);
      assert(alive(grand), 'the grandchild still holds the stdout pipe');
      assert(await until(() => child.output() === 'from the child\n'), `output() holds what the child printed, got: ${JSON.stringify(child.output())}`);
    } finally {
      endAll(grand);
    }
  });

  await test('start with input: the child reads the string on its stdin, then stdin ends', async () => {
    const child = start(process.execPath, ['-e', ECHOES], { input: 'line one\nline two\n' });
    const exit = await settle(child.done);
    assertEq(exit?.status, 0, `the child exited once its stdin ended, got: ${JSON.stringify(exit)}`);
    assertEq(child.stdout(), 'line one\nline two\n', 'the child echoed its input');
  });

  await test('start without input: the child sees an empty stdin at once, no hang', async () => {
    const child = start(process.execPath, ['-e', ECHOES]);
    const exit = await settle(child.done);
    assertEq(exit?.status, 0, `the child exited on its own, got: ${JSON.stringify(exit)}`);
    assertEq(exit.timedOut, false, 'no deadline ended it');
    assertEq(child.stdout(), '', 'its stdin was empty');
  });

  await test('start with input a child exits without reading: done reports its exit, the unread write no crash', async () => {
    const child = start(process.execPath, ['-e', EXITS], { input: BIG_INPUT });
    const exit = await settle(child.done);
    assertEq(exit?.status, 4, `the child's own exit status, got: ${JSON.stringify(exit)}`);
  });

  await test('a child that never spawned: end() resolves, done rejects with the spawn error, and the suite goes on', async () => {
    const missing = start(path.join(mkTmp('spawn-'), 'no-such-binary'), []);
    await missing.end();
    // A turn with no handler on done: an unhandled rejection here would end the worker.
    await new Promise((resolve) => setImmediate(resolve));
    let rejected;
    await missing.done.catch((err) => { rejected = err; });
    assertEq(rejected?.code, 'ENOENT', `done rejects with the spawn error, got: ${rejected?.message}`);
  });

  await test('end() rejects a signal off the ladder before it sends anything', async () => {
    const child = start(process.execPath, ['-e', FOREVER]);
    try {
      let rejected;
      await child.end('SIGHUP').catch((err) => { rejected = err; });
      assert(/end: signal must be one of/.test(rejected?.message), `the ladder's own error, got: ${rejected?.message}`);
      assert(alive(child.pid), 'the child is untouched');
    } finally {
      await child.end('SIGKILL');
    }
  });

  group('spawn: endTree()');

  await testUnless(IS_WINDOWS, 'Windows ends a tree through taskkill, not a process group')(
    'endTree on a raw pid ends the process group: the detached child and its grandchild',
    async () => {
      const pidFile = path.join(mkTmp('spawn-'), 'grandchild.pid');
      const child = spawn(process.execPath, ['-e', PARENT(pidFile)], { detached: true, stdio: 'ignore' });
      let grand;
      try {
        assert(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid');
        grand = readPid(pidFile);
        assert(alive(child.pid) && alive(grand), 'child and grandchild both alive before endTree()');
        endTree(child.pid);
        assert(await until(() => !alive(child.pid) && !alive(grand)), 'endTree() ended the child and its grandchild');
      } finally {
        endAll(child.pid, grand);
      }
    },
  );

  await test('endTree throws for a pid that is not a positive integer: 0, -1 and 1.5', async () => {
    for (const pid of [0, -1, 1.5]) {
      let threw;
      // Signal 0 sends nothing, so a red run signals no process at all.
      try { endTree(pid, 0); } catch (err) { threw = err; }
      assert(/endTree: pid must be a positive integer/.test(threw?.message), `endTree(${pid}) throws the guard's error`);
    }
  });

  const rootPid = IS_WINDOWS || process.getuid() === 0 ? null : rootOwnedPid();
  await testUnless(rootPid === null, IS_WINDOWS ? 'Windows ends a tree through taskkill, not a signal'
    : process.getuid() === 0 ? 'root may signal any process, so nothing refuses the signal'
      : 'no process owned by root, pid above 1, is listed here')(
    'endTree throws when the system refuses the signal: a root process signalled by a user that is not root names EPERM and the pid',
    () => {
      let threw;
      try { endTree(rootPid, 'SIGTERM'); } catch (err) { threw = err; }
      assert(/EPERM/.test(threw?.message) && new RegExp(`\\bpid ${rootPid}\\b`).test(threw?.message),
        `endTree throws naming EPERM and pid ${rootPid}, got: ${threw?.message}`);
    },
  );
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
