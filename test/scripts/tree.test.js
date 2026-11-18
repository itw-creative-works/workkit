// Tests for workflow/lib/tree.js: treeOf, the processes under a pid by parent,
// a child in its own session included and an unrelated process left out, each
// with the processor time it has used so far; and endTreeOf, the one home of the
// Windows tree end, its Windows arm reached on any machine through its seams, and
// this machine's own arm ending a live process.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, start, pidIn, alive,
  endTree,
} = require('../lib/harness');
const { pathWith, windowsTables, PS_HEADER, samePath, spawn } = require('../lib/platform');
const { skipOnWindows, reap } = require('../lib/supervise');
const { caught } = require('../lib/caught');

const TREE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree.js');
const { treeOf, endTreeOf } = require(TREE);

const PLATFORM = path.join(__dirname, '..', 'lib', 'platform.js');

const SYSTEM_ROOT = 'C:\\Windows';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/** A creation time at `time` on one fixed day, as .NET's 'o' format prints one in UTC. */
const at = (time) => `2026-11-15T${time}Z`;

// Process rows recorded from a windows-latest run of a supervised `npm test`: the
// Windows rows and Git Bash's `ps -el` rows as recorded, creation times written to
// fit the links. 9064's parent, and 7196's and 3804's Windows rows, were not
// recorded: each parent named is a pid no row holds.
const RECORDED = [
  { pid: 9064, ppid: 6140, created: at('02:51:01.8123456') },
  { pid: 7612, ppid: 3512, created: at('02:51:03.1804567'), ps: '     1530       1    1530       7612  ?         197108 02:51:03 /usr/bin/bash' },
  { pid: 7196, ppid: 5208, created: at('02:51:02.3101234'), ps: '     1510    1502    1502       7196  ?         197108 02:51:02 /usr/bin/bash' },
  { pid: 6116, ppid: 6916, created: at('02:51:03.4105678'), ps: '     1563    1530    1530       6116  ?         197108 02:51:03 /usr/bin/bash' },
  { pid: 7652, ppid: 6808, created: at('02:51:03.4306789'), ps: '     1564    1530    1530       7652  ?         197108 02:51:03 /usr/bin/tee' },
  { pid: 3804, ppid: 5932, created: at('02:51:02.6502345'), ps: '     1523    1510    1502       3804  ?         197108 02:51:02 /c/hostedtoolcache/windows/node/26.13.1/x64/node' },
  { pid: 872, ppid: 9064, created: at('02:51:02.0412345'), ps: '     1502       1    1502        872  ?         197108 02:51:02 /usr/bin/bash' },
  { pid: 6660, ppid: 872, created: at('02:51:02.0598765') },
  { pid: 3512, ppid: 3804, created: at('02:51:03.1203456') },
  { pid: 1252, ppid: 3452, created: at('02:51:03.9207890') },
  { pid: 8748, ppid: 1252, created: at('02:51:04.1234567'), ps: '     1589    1563    1530       8748  ?         197108 02:51:04 /c/hostedtoolcache/windows/node/26.13.1/x64/node' },
];

/** End `pid`'s tree on the Windows arm against `world`'s tables and signals. */
const endIn = (world, pid, seams = { systemRoot: SYSTEM_ROOT }) => world.during(
  () => endTreeOf(pid, { platform: 'win32', run: world.run, ...seams }),
);

/** The pids `world` signalled, in order. */
const signalled = (world) => world.signals.map((s) => s.pid);

/** Every call `world` saw to the program `name` (any folder, `.exe` or not), at least one. */
const callsTo = (world, name) => {
  const found = world.calls.filter((c) => c.file.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '') === name);
  expect(found.length > 0, `${name} was run, got: ${JSON.stringify(world.calls)}`).toBeTruthy();
  return found;
};

// A process that writes its pid to <dir>/<name>, starts each child [name, detached,
// children] in turn through the suites' platform seam, and then waits, or keeps a
// processor busy when its name says so.
const NODE = [
  `const { spawn } = require(${JSON.stringify(PLATFORM)});`,
  "const fs = require('fs');",
  "const path = require('path');",
  'const [dir, name, kids] = process.argv.slice(2);',
  'for (const [kid, detached, grand] of JSON.parse(kids)) {',
  "  spawn(process.execPath, [__filename, dir, kid, JSON.stringify(grand)], { detached, stdio: 'ignore' });",
  '}',
  'fs.writeFileSync(path.join(dir, name), String(process.pid));',
  "if (name.startsWith('busy')) for (;;) {}",
  'setInterval(() => {}, 1 << 30);',
  '',
].join('\n');

/**
 * The tree <kids> describes under a root named `root`, started from <dir>, and
 * the pids of <names> once each has written its own.
 */
const startTree = async (dir, kids, names) => {
  const program = path.join(dir, 'node.js');
  fs.writeFileSync(program, NODE);
  const handle = start(process.execPath, [program, dir, 'root', JSON.stringify(kids)]);
  const pidOf = (name) => pidIn(path.join(dir, name));
  expect(await until(() => names.every(pidOf)), `every process wrote its pid: ${names.filter((n) => !pidOf(n)).join(', ')} did not`).toBeTruthy();
  return { handle, pids: Object.fromEntries(names.map((name) => [name, pidOf(name)])) };
};

describe('tree: treeOf', () => {
  test('a grandchild and a child in its own session are listed, each by its parent; an unrelated process is not', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('tree-list-');
    const other = mkTmp('tree-other-');
    const kids = [['child', false, [['grandchild', false, []]]], ['session', true, []]];
    const { handle, pids } = await startTree(dir, kids, ['root', 'child', 'grandchild', 'session']);
    const unrelated = await startTree(other, [], ['root']);
    try {
      const entries = treeOf(pids.root);
      const byPid = (pid) => entries.find((e) => e.pid === pid);
      const listed = entries.map((e) => e.pid).join(', ');
      expect(byPid(pids.grandchild), `the grandchild ${pids.grandchild} is listed, got: ${listed}`).toBeTruthy();
      expect(byPid(pids.grandchild).ppid, 'the grandchild\'s parent is the child').toBe(pids.child);
      expect(byPid(pids.session), `the child in its own session ${pids.session} is listed, got: ${listed}`).toBeTruthy();
      expect(byPid(pids.session).ppid, 'its parent is the root').toBe(pids.root);
      expect(!byPid(unrelated.pids.root), `the unrelated ${unrelated.pids.root} is not listed, got: ${listed}`).toBeTruthy();
      const named = entries.filter((e) => typeof e.command === 'string' && e.command.includes('node'));
      expect(named.length, `every entry names its command, got: ${JSON.stringify(entries)}`).toBe(entries.length);
    } finally {
      reap(...Object.values(pids), unrelated.pids.root);
      await Promise.all([handle.end('SIGKILL'), unrelated.handle.end('SIGKILL')]);
    }
  });

  test('a process that keeps a processor busy shows a growing cpu', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('tree-busy-');
    const { handle, pids } = await startTree(dir, [['busy', false, []]], ['root', 'busy']);
    try {
      const cpuOf = () => (treeOf(pids.root).find((e) => e.pid === pids.busy) || {}).cpu;
      const first = cpuOf();
      expect(typeof first, `the busy process is listed with a cpu, got: ${JSON.stringify(treeOf(pids.root))}`).toBe('number');
      expect(await until(() => cpuOf() > first), `its cpu never grew past ${first}`).toBeTruthy();
    } finally {
      reap(...Object.values(pids));
      await handle.end('SIGKILL');
    }
  });
});

describe('tree: endTreeOf on the Windows arm', () => {
  test('rows recorded from a supervised npm test on Windows: the end of the body shell signals every process of the run, the suite\'s node included, and none outside it', async () => {
    const world = windowsTables(RECORDED);
    const err = await caught(() => endIn(world, 872));
    expect(err?.message, 'the end resolves').toBe(undefined);
    const got = [...signalled(world)].sort((a, b) => a - b);
    expect(JSON.stringify(got), 'the body shell, its conhost, npm\'s bash and node, the script shell and its bash, the suite-body bash, tee and the suite node, each once')
      .toBe(JSON.stringify([872, 3512, 3804, 6116, 6660, 7196, 7612, 7652, 8748]));
    expect(world.signals.every((s) => s.signal === 'SIGKILL'), `each a forced end, got: ${JSON.stringify(world.signals)}`).toBeTruthy();
  });

  test('a ps row led by a state letter still links its process into the tree', async () => {
    // 300's Windows parent is gone, so only its Git Bash row, waiting on the terminal, links it.
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000'), ps: '       10       1      10        100  pty0      197108 03:00:00 /usr/bin/bash' },
      { pid: 300, ppid: 999, created: at('03:00:01.0000000'), ps: 'I      11      10      10        300  pty0      197108 03:00:01 /usr/bin/bash' },
    ]);
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'the root and its Git Bash child 300').toBe(JSON.stringify([100, 300]));
  });

  test('a process whose Windows parent pid names a member but that is older than it is not signalled', async () => {
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000') },
      { pid: 300, ppid: 100, created: at('02:59:59.0000000') },
    ]);
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'the root and its child, never the older 300').toBe(JSON.stringify([100, 200]));
  });

  test('a newer process holding a gone member\'s pid is not signalled, nor its child; the member\'s own child still is', async () => {
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000') },
    ], {
      // Read 2, the first to find 200 gone: 300, which 200 started before it went, and a
      // newer process holding the pid 200 with its child 400.
      onRead: (n, w) => {
        if (n !== 2) return;
        w.add(
          { pid: 300, ppid: 200, created: at('03:00:02.0000000') },
          { pid: 200, ppid: 4, created: at('03:00:05.0000000') },
          { pid: 400, ppid: 200, created: at('03:00:06.0000000') },
        );
      },
    });
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'the root, the member 200 once, and its child 300; never the newer 200 or its 400')
      .toBe(JSON.stringify([100, 200, 300]));
  });

  test('a process first seen after a read found its parent member gone is not signalled', async () => {
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000') },
    ], {
      // Read 2 finds 100 and 200 gone and only 150, a child of 100, new, so the end
      // reads a third time; 300, a child of 200, shows from read 3.
      onRead: (n, w) => {
        if (n === 2) w.add({ pid: 150, ppid: 100, created: at('03:00:01.5000000') });
        if (n === 3) w.add({ pid: 300, ppid: 200, created: at('03:00:02.0000000') });
      },
    });
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'the root, 150 and 200, never the later 300').toBe(JSON.stringify([100, 150, 200]));
    expect(callsTo(world, 'powershell').length, 'the end read the table that showed 300').toBe(3);
  });

  test('a Windows child of a member with no creation time is not signalled', async () => {
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000') },
      { pid: 300, ppid: 100, created: '' },
    ]);
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'the root and its timed child, never 300').toBe(JSON.stringify([100, 200]));
  });

  test('a tree whose every member goes at its signal: the end reads each table twice and resolves', async () => {
    const world = windowsTables(RECORDED);
    const err = await caught(() => endIn(world, 872));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify([callsTo(world, 'powershell').length, callsTo(world, 'bash').length]),
      'one read to find the tree, one to find it gone').toBe('[2,2]');
  });

  test('a root not in the Windows table is a tree already gone: the end resolves and signals nothing', async () => {
    const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }]);
    const err = await caught(() => endIn(world, 4242));
    expect(err?.message, 'the end resolves').toBe(undefined);
    expect(JSON.stringify(world.signals), 'nothing is signalled').toBe('[]');
  });

  test('a process a member starts between two reads is signalled after the next read, each member once, and the end resolves on a read with no member', async () => {
    // 200 outlives its signal for two asks, and starts 300 meanwhile.
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000'), lingers: 2 },
    ], {
      onSignal: (pid, w) => { if (pid === 200) w.add({ pid: 300, ppid: 200, created: at('03:00:02.0000000') }); },
    });
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the end resolves').toBe(undefined);
    const got = signalled(world);
    expect(JSON.stringify([...got].sort((a, b) => a - b)), 'each member signalled once').toBe(JSON.stringify([100, 200, 300]));
    expect(got.indexOf(300), `the new process is signalled after the first two, got: ${got.join(', ')}`).toBe(2);
    expect(JSON.stringify([callsTo(world, 'powershell').length, callsTo(world, 'bash').length]),
      'three reads of each table: the first, the one that finds 300, the one that finds no member').toBe('[3,3]');
  });

  test('one member\'s refused signal: every other member gets its own, and the end rejects naming the refused pid', async () => {
    const world = windowsTables([
      { pid: 100, ppid: 4, created: at('03:00:00.0000000') },
      { pid: 200, ppid: 100, created: at('03:00:01.0000000'), refuse: 'EPERM' },
      { pid: 300, ppid: 100, created: at('03:00:02.0000000') },
    ]);
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the reject line').toBe('could not signal 200 (kill EPERM)');
    expect(JSON.stringify([...signalled(world)].sort((a, b) => a - b)), 'each member was signalled').toBe(JSON.stringify([100, 200, 300]));
  });

  for (const [how, answer, code] of [['cannot start', null, 'ENOENT'], ['runs to its timeout', 'hang', 'ETIMEDOUT']]) {
    test(`a PowerShell that ${how} rejects the end, naming why, and signals nothing`, async () => {
      const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }], { answers: { powershell: answer } });
      const err = await caught(() => endIn(world, 100));
      const cause = `spawnSync ${callsTo(world, 'powershell')[0].file} ${code}`;
      expect(err?.message, 'the reject line carries the start error').toBe(`tree.js: powershell could not run (${cause})`);
      expect(JSON.stringify(world.signals), 'nothing is signalled').toBe('[]');
    });
  }

  test('a ps that exits nonzero with three stderr lines rejects the end on one line with its code and the first of them, and signals nothing', async () => {
    const stderr = 'ps: cannot read the process table\n  at /proc/1530/stat\nps: giving up\n';
    const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }],
      { answers: { ps: { status: 1, stderr } } });
    const err = await caught(() => endIn(world, 100));
    expect(err?.message, 'the one reject line').toBe('tree.js: ps exited 1: ps: cannot read the process table');
    expect(JSON.stringify(world.signals), 'nothing is signalled').toBe('[]');
  });

  const BAD_ROW = '     1530       -    1530       7612  ?         197108 02:51:03 /usr/bin/bash';
  for (const [what, program, answers, holds] of [
    ['a PowerShell error in place of the JSON', 'powershell', { powershell: { status: 0, stdout: 'Get-CimInstance : Access denied\r\n' } }, null],
    ['one process as a JSON object, not an array', 'powershell', { powershell: { status: 0, stdout: '{"pid":100,"ppid":4,"created":"2026-11-15T03:00:00.0000000Z"}\r\n' } }, null],
    ['a ps row whose PPID is no number', 'ps', { ps: { status: 0, stdout: `${[PS_HEADER, BAD_ROW].join('\n')}\n` } }, BAD_ROW.trim()],
  ]) {
    test(`${what}: the end rejects with ${program}'s unreadable-table line and signals nothing`, async () => {
      const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }], { answers });
      const err = await caught(() => endIn(world, 100));
      const prefix = `tree.js: ${program} printed a table it cannot read: `;
      expect(err?.message?.startsWith(prefix), `the reject line starts ${JSON.stringify(prefix)}, got: ${err?.message}`).toBeTruthy();
      if (holds) expect(err.message.includes(holds), `the line names the row, got: ${err.message}`).toBeTruthy();
      expect(JSON.stringify(world.signals), 'nothing is signalled').toBe('[]');
    });
  }

  test('with no SystemRoot the end rejects with the line that names it and starts no program', async () => {
    const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }]);
    const realRoot = process.env.SystemRoot;
    delete process.env.SystemRoot;
    try {
      const err = await caught(() => endIn(world, 100, {}));
      expect(err?.message, 'the reject names SystemRoot').toBe('tree.js: SystemRoot is not set, so powershell cannot be found');
    } finally {
      if (realRoot !== undefined) process.env.SystemRoot = realRoot;
    }
    expect(JSON.stringify(world.calls), 'no program was started').toBe('[]');
    expect(JSON.stringify(world.signals), 'nothing is signalled').toBe('[]');
  });

  test('PowerShell runs from System32 under SystemRoot whatever PATH holds, ps through bash, each read bounded at 60 seconds', async () => {
    const shadow = mkTmp('tree-path-');
    fs.writeFileSync(path.join(shadow, 'powershell.exe'), '');
    const world = windowsTables([{ pid: 100, ppid: 4, created: at('03:00:00.0000000') }]);
    const realPath = process.env.PATH;
    process.env.PATH = pathWith(shadow);
    try {
      await endIn(world, 100);
    } finally {
      process.env.PATH = realPath;
    }
    for (const call of callsTo(world, 'powershell')) {
      expect(samePath(call.file, POWERSHELL, 'win32'), `the program is ${POWERSHELL}, got: ${call.file}`).toBeTruthy();
      expect(JSON.stringify(call.args.slice(0, 5)), 'no profile, no prompt, no policy, then the encoded script')
        .toBe(JSON.stringify(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']));
      expect(call.args.length, `the encoded script is the last argument, got: ${JSON.stringify(call.args)}`).toBe(6);
      const script = Buffer.from(call.args[5], 'base64').toString('utf16le');
      expect(script.includes('Win32_Process'), `the script reads as UTF-16LE and asks Win32_Process, got: ${JSON.stringify(script)}`).toBeTruthy();
    }
    for (const call of callsTo(world, 'bash')) {
      expect(JSON.stringify(call.args), 'Git Bash\'s own ps, no rc files').toBe(JSON.stringify(['--noprofile', '--norc', '-c', '/usr/bin/ps -el']));
    }
    const unbounded = world.calls.filter((c) => c.options.timeout !== 60000);
    expect(JSON.stringify(unbounded), 'every read runs under a 60000 ms timeout').toBe('[]');
  });
});

describe('tree: endTreeOf on this machine', () => {
  test('endTreeOf of a live process: it is gone and the end resolves', async () => {
    // No start() watchdog: it would end the child at the deadline `until` waits on.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);'], { detached: true, stdio: 'ignore' });
    try {
      expect(alive(child.pid), 'the process is alive before the end').toBeTruthy();
      await endTreeOf(child.pid);
      expect(await until(() => !alive(child.pid)), `the process ${child.pid} is gone`).toBeTruthy();
    } finally {
      endTree(child.pid, 'SIGKILL');
    }
  });
});
