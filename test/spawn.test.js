// Tests for packages/core/test/lib/spawn.js through the one entry: run() keeps both
// streams and the exit, start() streams while its child runs and end() ends its
// group, climbing INT, TERM, KILL only while the child lives, its stdin carries
// the input given, else is empty, a deadline ends a
// child that never exits, and endTree() ends a group, refuses a pid that is
// not a positive integer and throws on a signal the system refuses; on its
// Windows arm, reached through its seams, it runs taskkill from System32 and
// throws when that cannot start or SystemRoot is unset. alive() is false for any pid but a positive integer.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  describe, test, expect,
  run, start, endTree, alive, until, readPid, mkTmp,
} = require('./lib/harness');
const { IS_WINDOWS, recordingRun, signalsRefused, samePath } = require('./lib/platform');
const { caught } = require('./lib/caught');

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
const rootOwnedPid = (skip = []) => {
  const rows = run('ps', ['-A', '-o', 'pid=,uid=']).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const row = rows.find(([pid, uid]) => uid === 0 && pid > 1 && !skip.includes(pid));
  return row ? row[0] : null;
};

// Kills each of `pids`, a gone one no error, so a failed case leaves no process behind.
const endAll = (...pids) => {
  for (const pid of pids) if (pid) endTree(pid, 'SIGKILL');
};

describe('spawn: run()', () => {
  test('run keeps both streams, stdout then stderr, and the status; a child past its deadline comes back timedOut with a signal', () => {
    const done = run(process.execPath, ['-e', BOTH]);
    expect(done.stdout, 'stdout alone').toBe('to stdout\n');
    expect(done.stderr, 'stderr alone').toBe('to stderr\n');
    expect(done.output, 'output is stdout, then stderr').toBe('to stdout\nto stderr\n');
    expect(done.status, 'the exit status').toBe(3);
    expect(done.timedOut, 'an exit is no timeout').toBe(false);
    const late = run(process.execPath, ['-e', FOREVER], { deadline: SHORT });
    expect(late.timedOut, `the deadline ended it, got: ${JSON.stringify(late)}`).toBe(true);
    expect(late.signal, `a signal is set, got: ${JSON.stringify(late)}`).toBeTruthy();
  });
});

describe('spawn: start()', () => {
  test('start: output grows while the child runs, done resolves on exit, and end() ends a grandchild too', async () => {
    const dir = mkTmp('spawn-');
    const go = path.join(dir, 'go');
    const stepped = start(process.execPath, ['-e', STEPPED(go)]);
    expect(await until(() => stepped.output().includes('first')), `the first line arrives while the child runs, got: ${stepped.output()}`).toBeTruthy();
    expect(!stepped.output().includes('second') && alive(stepped.pid), 'the child is still running, the second line not yet written').toBeTruthy();
    fs.writeFileSync(go, '');
    const exit = await settle(stepped.done);
    expect(exit, 'done resolved once the child exited').toBeTruthy();
    expect(exit.status, 'the exit status').toBe(0);
    expect(stepped.output(), 'output() grew by the second line').toBe('first\nsecond\n');

    const pidFile = path.join(dir, 'grandchild.pid');
    const tree = start(process.execPath, ['-e', PARENT(pidFile)], { detached: true });
    let grand;
    try {
      expect(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid').toBeTruthy();
      grand = readPid(pidFile);
      expect(alive(tree.pid) && alive(grand), 'child and grandchild both alive before end()').toBeTruthy();
      await tree.end();
      expect(!alive(tree.pid), 'the child is gone once end() resolves').toBeTruthy();
      expect(await until(() => !alive(grand)), 'the grandchild is gone too').toBeTruthy();
    } finally {
      endAll(tree.pid, grand);
    }
  });

  test(
    'end() climbs INT, TERM, KILL while the child lives: a child trapping INT and TERM gets both in order and is ended by KILL; a child that exits on INT is ended by INT',
    { skip: IS_WINDOWS && 'Windows ends a child through one taskkill, no signal ladder' },
    async () => {
      const record = path.join(mkTmp('spawn-'), 'signals');
      const trapped = start(process.execPath, ['-e', TRAPS(record)]);
      const plain = start(process.execPath, ['-e', FOREVER]);
      try {
        expect(await until(() => trapped.output().includes('ready')), `the trapping child set its traps, got: ${trapped.output()}`).toBeTruthy();
        await trapped.end();
        expect(!alive(trapped.pid), 'the trapping child is gone once end() resolves').toBeTruthy();
        const trappedExit = await settle(trapped.done);
        expect(trappedExit?.signal, `KILL ended the trapping child, got: ${JSON.stringify(trappedExit)}`).toBe('SIGKILL');
        expect(fs.readFileSync(record, 'utf8'), 'the child got INT, then TERM, before the KILL').toBe('SIGINT\nSIGTERM\n');

        await plain.end();
        const plainExit = await settle(plain.done);
        expect(plainExit?.signal, `INT ended the plain child, the first rung, got: ${JSON.stringify(plainExit)}`).toBe('SIGINT');
      } finally {
        endAll(trapped.pid, plain.pid);
      }
    },
  );

  test('end() on a child already gone, plain or detached, sends nothing: done reports the child\'s own exit and end() resolves', async () => {
    for (const detached of [false, true]) {
      const child = start(process.execPath, ['-e', EXITS], { detached });
      try {
        const exit = await settle(child.done);
        expect(exit?.status, `the child's own exit status (detached: ${detached}), got: ${JSON.stringify(exit)}`).toBe(4);
        expect(exit.signal, `no signal ended it (detached: ${detached})`).toBe(null);
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
        expect(JSON.stringify(rungs), `end() sent no signal but the alive probe to the child or its group (detached: ${detached})`).toBe('[]');
      } finally {
        endAll(child.pid);
      }
    }
  });

  test(
    'end() on a detached child that exited and is not yet reaped resolves, and done reports its exit 0',
    { skip: IS_WINDOWS && 'Windows ends a child through one taskkill, no signal probe' },
    async () => {
      const child = start('/bin/sh', ['-c', 'exit 0'], { detached: true });
      // Blocks the loop until the child is a zombie, so the signal probe meets it unreaped.
      const stretch = run('/bin/sh', ['-c', UNTIL_ZOMBIE, 'sh', String(child.pid)]);
      expect(stretch.status, `the child exited and waits unreaped, got: ${JSON.stringify(stretch)}`).toBe(0);
      let rejected;
      await child.end().catch((err) => { rejected = err; });
      expect(rejected?.message, 'end() resolves on a child that already exited').toBe(undefined);
      const exit = await settle(child.done);
      expect(exit?.status, `done reports the child's own exit, got: ${JSON.stringify(exit)}`).toBe(0);
    },
  );

  test(
    'endTree on a detached child that exited and is not yet reaped ends quietly, and done reports its exit 0',
    { skip: IS_WINDOWS && 'Windows ends a tree through taskkill, not a signal' },
    async () => {
      const child = start('/bin/sh', ['-c', 'exit 0'], { detached: true });
      // Blocks the loop until the child is a zombie, so endTree meets it unreaped.
      const stretch = run('/bin/sh', ['-c', UNTIL_ZOMBIE, 'sh', String(child.pid)]);
      expect(stretch.status, `the child exited and waits unreaped, got: ${JSON.stringify(stretch)}`).toBe(0);
      const threw = await caught(() => endTree(child.pid, 'SIGKILL'));
      expect(threw?.message, 'endTree does not throw on a leader that already exited').toBe(undefined);
      const exit = await settle(child.done);
      expect(exit?.status, `done reports the child's own exit, got: ${JSON.stringify(exit)}`).toBe(0);
    },
  );

  test('the watchdog: a child that never exits is ended at its deadline and done reports timedOut', async () => {
    const forever = start(process.execPath, ['-e', FOREVER], { deadline: SHORT });
    const exit = await settle(forever.done);
    expect(exit, 'done resolved').toBeTruthy();
    expect(exit.timedOut, `done reports timedOut, got: ${JSON.stringify(exit)}`).toBe(true);
    expect(!alive(forever.pid), 'the child is gone').toBeTruthy();
  });

  test('done reports an exit, never timedOut, for a child that exited while its grandchild holds stdout open', async () => {
    const pidFile = path.join(mkTmp('spawn-'), 'grandchild.pid');
    const child = start(process.execPath, ['-e', LEAVES_STDOUT(pidFile)]);
    let grand;
    try {
      expect(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid').toBeTruthy();
      grand = readPid(pidFile);
      const exit = await settle(child.done);
      expect(exit, 'done resolved').toBeTruthy();
      expect(exit.status, 'the child\'s own exit status').toBe(0);
      expect(exit.timedOut, `an exit before the deadline is no timeout, got: ${JSON.stringify(exit)}`).toBe(false);
      expect(alive(grand), 'the grandchild still holds the stdout pipe').toBeTruthy();
      expect(await until(() => child.output() === 'from the child\n'), `output() holds what the child printed, got: ${JSON.stringify(child.output())}`).toBeTruthy();
    } finally {
      endAll(grand);
    }
  });

  test('start with input: the child reads the string on its stdin, then stdin ends', async () => {
    const child = start(process.execPath, ['-e', ECHOES], { input: 'line one\nline two\n' });
    const exit = await settle(child.done);
    expect(exit?.status, `the child exited once its stdin ended, got: ${JSON.stringify(exit)}`).toBe(0);
    expect(child.stdout(), 'the child echoed its input').toBe('line one\nline two\n');
  });

  test('start without input: the child sees an empty stdin at once, no hang', async () => {
    const child = start(process.execPath, ['-e', ECHOES]);
    const exit = await settle(child.done);
    expect(exit?.status, `the child exited on its own, got: ${JSON.stringify(exit)}`).toBe(0);
    expect(exit.timedOut, 'no deadline ended it').toBe(false);
    expect(child.stdout(), 'its stdin was empty').toBe('');
  });

  test('start with input a child exits without reading: done reports its exit, the unread write no crash', async () => {
    const child = start(process.execPath, ['-e', EXITS], { input: BIG_INPUT });
    const exit = await settle(child.done);
    expect(exit?.status, `the child's own exit status, got: ${JSON.stringify(exit)}`).toBe(4);
  });

  test('a child that never spawned: end() resolves, done rejects with the spawn error, and the suite goes on', async () => {
    const missing = start(path.join(mkTmp('spawn-'), 'no-such-binary'), []);
    await missing.end();
    // A turn with no handler on done: an unhandled rejection here would end the worker.
    await new Promise((resolve) => setImmediate(resolve));
    let rejected;
    await missing.done.catch((err) => { rejected = err; });
    expect(rejected?.code, `done rejects with the spawn error, got: ${rejected?.message}`).toBe('ENOENT');
  });

  test('end() rejects a signal off the ladder before it sends anything', async () => {
    const child = start(process.execPath, ['-e', FOREVER]);
    try {
      let rejected;
      await child.end('SIGHUP').catch((err) => { rejected = err; });
      expect(/end: signal must be one of/.test(rejected?.message), `the ladder's own error, got: ${rejected?.message}`).toBeTruthy();
      expect(alive(child.pid), 'the child is untouched').toBeTruthy();
    } finally {
      await child.end('SIGKILL');
    }
  });
});

describe('spawn: endTree()', () => {
  test(
    'endTree on a raw pid ends the process group: the detached child and its grandchild',
    { skip: IS_WINDOWS && 'Windows ends a tree through taskkill, not a process group' },
    async () => {
      const pidFile = path.join(mkTmp('spawn-'), 'grandchild.pid');
      const child = spawn(process.execPath, ['-e', PARENT(pidFile)], { detached: true, stdio: 'ignore' });
      let grand;
      try {
        expect(await until(() => fs.existsSync(pidFile)), 'the child wrote its grandchild\'s pid').toBeTruthy();
        grand = readPid(pidFile);
        expect(alive(child.pid) && alive(grand), 'child and grandchild both alive before endTree()').toBeTruthy();
        endTree(child.pid);
        expect(await until(() => !alive(child.pid) && !alive(grand)), 'endTree() ended the child and its grandchild').toBeTruthy();
      } finally {
        endAll(child.pid, grand);
      }
    },
  );

  test('endTree throws for a pid that is not a positive integer: 0, -1 and 1.5', async () => {
    for (const pid of [0, -1, 1.5]) {
      // Signal 0 sends nothing, so a red run signals no process at all.
      const threw = await caught(() => endTree(pid, 0));
      expect(/endTree: pid must be a positive integer/.test(threw?.message), `endTree(${pid}) throws the guard's error`).toBeTruthy();
    }
  });

  test('endTree on its Windows arm runs taskkill from System32, and throws when it cannot start', async () => {
    const seamsOf = (recorded) => ({ platform: 'win32', run: recorded.run, systemRoot: 'C:\\Windows' });
    const starts = recordingRun(0);
    await signalsRefused(() => endTree(4242, 'SIGKILL', seamsOf(starts)));
    expect(starts.calls.length, `one program was run, got: ${JSON.stringify(starts.calls)}`).toBe(1);
    expect(samePath(starts.calls[0].file, 'C:\\Windows\\System32\\taskkill.exe', 'win32'),
      `the program is System32's taskkill, got: ${starts.calls[0].file}`).toBeTruthy();

    const missing = recordingRun(null);
    const err = await signalsRefused(() => caught(() => endTree(4242, 'SIGKILL', seamsOf(missing))));
    expect(err?.message, 'the throw carries the start error')
      .toBe(`endTree: taskkill could not run (spawnSync ${missing.calls[0]?.file} ENOENT)`);
  });

  test('endTree on its Windows arm with SystemRoot unset throws naming SystemRoot, and runs nothing', async () => {
    const unset = recordingRun(0);
    const err = await signalsRefused(() => caught(() => endTree(4242, 'SIGKILL', { platform: 'win32', run: unset.run, systemRoot: undefined })));
    expect(/SystemRoot/.test(err?.message), `the throw names SystemRoot, got: ${err?.message}`).toBeTruthy();
    expect(unset.calls.length, `no program was run, got: ${JSON.stringify(unset.calls)}`).toBe(0);
  });

  // Read when the file is collected: the case's skip value needs it.
  const rootPid = IS_WINDOWS || process.getuid() === 0 ? null : rootOwnedPid();
  test(
    'endTree throws when the system refuses the signal: a root process signalled by a user that is not root names EPERM and the pid',
    {
      skip: rootPid === null && (IS_WINDOWS ? 'Windows ends a tree through taskkill, not a signal'
        : process.getuid() === 0 ? 'root may signal any process, so nothing refuses the signal'
          : 'no process owned by root, pid above 1, is listed here'),
    },
    async () => {
      let threw;
      let pid = rootPid;
      const tried = [];
      // A pick can exit between the listing and the signal, so a silent one is drawn again, three in all.
      while (pid !== null && !threw) {
        tried.push(pid);
        threw = await caught(() => endTree(pid, 'SIGTERM'));
        if (threw || tried.length === 3) break;
        pid = rootOwnedPid(tried);
      }
      expect(/EPERM/.test(threw?.message) && new RegExp(`\\bpid ${pid}\\b`).test(threw?.message),
        `endTree throws naming EPERM and pid ${pid}, got: ${threw?.message}`).toBeTruthy();
    },
  );
});

describe('spawn: alive()', () => {
  test('alive is false for 0, -1 and NaN, and true for this process', () => {
    for (const pid of [0, -1, NaN]) expect(alive(pid), `alive(${pid})`).toBe(false);
    expect(alive(process.pid), 'alive(process.pid)').toBe(true);
  });
});
