// Tests for workflow/lib/runs.js, the one Node command that takes a run's lock, launches,
// attaches and ends it: a free lock, the take's judge (a run that is over, a live holder, a
// launch under way, a removal under way), two takers on one lock, a launch that fails, a signal
// before the pid, an end that fails, an attach to a run that ended without its code, ask-end, a run
// under a supervisor already, a painted and a plain view whose reader goes away, and the
// supervisor's parent. Then run-lock.js's drop, end and liveness read.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, run, start,
} = require('../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, jsPath, systemPathWith, homeEnv, samePath,
} = require('../lib/platform');
const {
  checkSettings, rootHolding, pidOf, reap, writesPid, silent, ended, read, handLock, claimNaming, tagOf, actsAfter, writesAfter, deadPid, holding,
} = require('../lib/supervise');
const { startNeverCollects, childOf } = require('../lib/never-collects');
const { COLOR_ON } = require('../lib/supervise-world');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const RUNS = path.join(LIB, 'runs.js');
const RUN_LOCK = path.join(LIB, 'run-lock.js');
const DETACH = path.join(LIB, 'detach.js');

// A run lock's mark file, beside its claim: held by a take's tag, or being removed.
const MARK = /^(id|gone)\..+$/;
const marksIn = (names) => names.filter((name) => MARK.test(name)).join(' ');
const lockIn = (prefix) => path.join(mkTmp(prefix), 'lock');
/** <lock>'s claim text, trimmed, or '' while it has none. */
const claimOf = (lock) => read(path.join(lock, 'claim')).trim();

/** A scratch home and this suite's node on PATH, <extra> beside them, so no case reads the machine's own settings. */
const envOf = (extra = {}) => homeEnv(mkTmp('runs-home-'), { PATH: systemPathWith(NODE_DIR), ...extra });

/** The answer file's `key=value` lines as an object, `{}` while it is not there. */
const answerOf = (file) => Object.fromEntries(read(file).split('\n').filter(Boolean)
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

/**
 * The argv of `runs.js run <dir>/log <lock> [--root <root>] --answer <dir>/answer -- node -e <script>`,
 * and the log and answer paths, <dir> the call's own scratch folder.
 */
const runCall = (lock, script, { root, dir = mkTmp('runs-call-') } = {}) => {
  const log = path.join(dir, 'log');
  const answer = path.join(dir, 'answer');
  const rootArgs = root ? ['--root', root] : [];
  return { log, answer, args: [RUNS, 'run', log, lock, ...rootArgs, '--answer', answer, '--', process.execPath, '-e', script] };
};

/** `runs.js run` on <lock> to its end: spawn's result, the answer it left and its log. */
const runOn = (lock, script, { env = envOf(), root } = {}) => {
  const call = runCall(lock, script, { root });
  const res = run(process.execPath, call.args, { env });
  return { res, answer: answerOf(call.answer), log: call.log };
};

/** A command that writes <ran> and exits 0: whether a run launched it. */
const writesRan = (ran) => `require('fs').writeFileSync(${jsPath(ran)}, '')`;
/** A command that exits <code> once <go> appears. */
const waitsFor = (go, code = 0) => `const fs = require('fs'); setInterval(() => { if (fs.existsSync(${jsPath(go)})) process.exit(${code}); }, 50);`;

/** A command that writes <lock>'s names and claim to <seen> as JSON, prints two lines and exits <code>. */
const recordsLock = (lock, seen, code = 0) => [
  "const fs = require('fs');",
  `const names = fs.readdirSync(${jsPath(lock)}).sort();`,
  `const claim = fs.readFileSync(${jsPath(path.join(lock, 'claim'))}, 'utf8').trim();`,
  `fs.writeFileSync(${jsPath(seen)}, JSON.stringify({ names, claim }));`,
  "console.log('first line'); console.log('second line');",
  `process.exit(${code});`,
].join('\n');

/** What a recordsLock command saw: the lock's names but its pid file, and its mark. */
const seenIn = (seen) => {
  expect(read(seen) !== '', `the command never ran, no ${seen}`).toBeTruthy();
  const { names, claim } = JSON.parse(read(seen));
  const marks = marksIn(names);
  expect(claim !== '' && marks === `id.${claim}`, `one mark, the id.<tag> the claim names, it held: ${names.join(' ')}, claim: ${claim}`).toBeTruthy();
  return { mark: marks, names: names.filter((name) => name !== 'pid') };
};

/** A run on <lock> that takes it: exit 0, the lock held under one mark its claim names, gone after; what the command saw. */
const tookOver = (lock, env = envOf()) => {
  const seen = path.join(mkTmp('runs-seen-'), 'seen.json');
  const { res } = runOn(lock, recordsLock(lock, seen), { env });
  expect(res.status, `the run took the lock, output: ${res.output}`).toBe(0);
  const saw = seenIn(seen);
  expect(holding(lock), 'the run dropped its lock at its end').toBe('(none)');
  return saw;
};

describe('runs.js run: a lock with no holder', () => {
  test('the command\'s output on stdout from the log\'s first byte, its code the exit and the answer\'s, the lock held under one mark its claim names and gone after; the next run holds it under another tag', () => {
    const lock = lockIn('runs-free-');
    const seen = path.join(path.dirname(lock), 'seen.json');
    const { res, answer } = runOn(lock, recordsLock(lock, seen, 4));
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(4);
    expect(res.stdout.startsWith('first line\nsecond line\n'), `stdout from the log's first byte, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(answer.code, `the answer holds the code, got: ${JSON.stringify(answer)}`).toBe('4');
    const first = seenIn(seen);
    expect(holding(lock), 'the lock is gone after').toBe('(none)');
    const next = tookOver(lock);
    expect(next.mark !== first.mark, `the next run's own tag, got ${next.mark} after ${first.mark}`).toBeTruthy();
  });
});

describe('runs.js run: a lock that is there', () => {
  test('a run that is over, a done file and a gone pid: taken, the folder holding the new claim and mark and no file of the old run', () => {
    const lock = handLock(lockIn('runs-over-'), { claim: claimNaming('old'), 'id.old': '', pid: `${deadPid()}\n`, done: '0\n' });
    const { mark, names } = tookOver(lock);
    expect(mark !== 'id.old', 'a new tag, not the old run\'s').toBeTruthy();
    expect(names.join(' '), 'the new claim and mark alone').toBe(['claim', mark].sort().join(' '));
  });

  test('a run that is over and a gone.<tag> mark of a gone remover, with its claim and without, or gone.x naming no pid: taken', () => {
    const gone = `gone.${tagOf(deadPid())}`;
    tookOver(handLock(lockIn('runs-gone-'), { claim: claimNaming('a'), [gone]: '', pid: `${deadPid()}\n`, done: '0\n' }));
    tookOver(handLock(lockIn('runs-gone-'), { [gone]: '' }));
    tookOver(handLock(lockIn('runs-gone-'), { claim: claimNaming('a'), 'gone.x': '', pid: `${deadPid()}\n`, done: '0\n' }));
  });

  test('a folder with no mark is adopted: an empty claim alone, an empty folder, a gone pid alone, an older kit\'s lock with an id.orphan', () => {
    tookOver(handLock(lockIn('runs-claim-'), { claim: '' }));
    tookOver(handLock(lockIn('runs-empty-'), {}));
    tookOver(handLock(lockIn('runs-cut-'), { pid: `${deadPid()}\n` }));
    tookOver(handLock(lockIn('runs-orphan-'), { claim: '', 'id.orphan': '', pid: `${deadPid()}\n` }));
  });

  test('a run that is over, its claim naming id.a beside a leftover id.b: taken, the new folder holding no id.b', () => {
    const lock = handLock(lockIn('runs-leftover-'), { claim: claimNaming('a'), 'id.a': '', 'id.b': '', pid: `${deadPid()}\n`, done: '0\n' });
    const { names } = tookOver(lock);
    expect(names.includes('id.b'), `no leftover id.b, it held: ${names.join(' ')}`).toBe(false);
  });

  test('a lock a live run holds: exit 3, held naming its pid, nothing launched, the lock as it was', () => {
    const lock = handLock(lockIn('runs-live-'), { claim: claimNaming('live'), 'id.live': '', pid: `${process.pid}\n` });
    const ran = path.join(path.dirname(lock), 'ran');
    const { res, answer } = runOn(lock, writesRan(ran));
    expect(res.status, `a live holder, so 3, output: ${res.output}`).toBe(3);
    expect(answer.held, `held names the live run, got: ${JSON.stringify(answer)}`).toBe(String(process.pid));
    expect(fs.existsSync(ran), 'nothing was launched').toBe(false);
    expect(holding(lock), 'the live run\'s lock as it was').toBe('claim id.live pid');
    expect(claimOf(lock), 'its claim still names its mark').toBe('live');
  });

  test('a second run on the lock a running run holds: exit 3, held naming the supervisor its pid file holds, its command never ran, the holder\'s claim and mark unchanged', async () => {
    const dir = mkTmp('runs-held-');
    const lock = path.join(dir, 'lock');
    const lockPid = path.join(lock, 'pid');
    const go = path.join(dir, 'go');
    const ran = path.join(dir, 'ran');
    const env = envOf();
    const first = start(process.execPath, runCall(lock, waitsFor(go)).args, { env });
    try {
      const supervisor = await pidOf(lockPid);
      const [mark, claim] = [marksIn(fs.readdirSync(lock)), claimOf(lock)];
      expect(mark !== '' && mark === `id.${claim}`, `the holder's claim names its one mark, it holds: ${holding(lock)}`).toBeTruthy();
      const { res, answer } = runOn(lock, writesRan(ran), { env });
      expect(res.status, `the take answers 3, output: ${res.output}`).toBe(3);
      expect(answer.held, `held names the supervisor, got: ${JSON.stringify(answer)}`).toBe(String(supervisor));
      expect(fs.existsSync(ran), 'the second command never ran').toBe(false);
      expect(`${marksIn(fs.readdirSync(lock))} ${claimOf(lock)}`, 'the holder\'s mark and claim unchanged').toBe(`${mark} ${claim}`);
      fs.writeFileSync(go, '');
      expect(await until(() => ended(first.child)), `the first run never returned, output: ${first.output()}`).toBeTruthy();
      await first.done;
      expect(first.child.exitCode, `the first run's own code, output: ${first.output()}`).toBe(0);
    } finally {
      reap(pidIn(lockPid));
      await first.end('SIGKILL');
    }
  });

  test('a gone.<tag> mark whose remover lives: takeRunLock answers { code: 1 } once the mark\'s wait runs out, the folder as it was', async () => {
    // The remover is this process, which outlives the wait, so only the wait's end answers.
    const gone = `gone.${tagOf(process.pid)}`;
    const dead = deadPid();
    const lock = handLock(lockIn('runs-remover-'), { claim: claimNaming('a'), [gone]: '', pid: `${dead}\n`, done: '0\n' });
    const { takeRunLock } = require(RUN_LOCK);
    expect(await takeRunLock(lock), 'the lock cannot be taken').toEqual({ code: 1 });
    expect(holding(lock), 'the folder\'s files as they were').toBe(['claim', 'done', gone, 'pid'].sort().join(' '));
    expect(claimOf(lock) === 'a' && pidIn(path.join(lock, 'pid')) === dead && read(path.join(lock, 'done')) === '0\n',
      `the claim, pid and done files as they were, it holds: ${holding(lock)}`).toBeTruthy();
  });
});

describe('runs.js run: a lock whose launch is still under way', () => {
  // A lock a take claimed, its taker <pid> by the tag's first field, and no pid file yet.
  const startingLock = (prefix, pid) => {
    const tag = tagOf(pid);
    return { lock: handLock(lockIn(prefix), { claim: claimNaming(tag), [`id.${tag}`]: '' }), mark: `id.${tag}` };
  };

  test('a taker alive and no pid file, a live pid written about seven seconds after the run began: exit 3, held naming that pid', async () => {
    const { lock } = startingLock('runs-starting-', process.pid);
    const began = path.join(path.dirname(lock), 'began');
    // The supervisor's pid, its own, lands past the five seconds a lock with no taker gets.
    const supervisor = writesAfter(began, path.join(lock, 'pid'), 7000, '`${process.pid}\\n`', true);
    try {
      fs.writeFileSync(began, '');
      const { res, answer } = runOn(lock, 'process.exit(0)');
      expect(res.status, `a starting run keeps its lock, so 3, output: ${res.output}`).toBe(3);
      expect(answer.held, `held names the pid written late, got: ${JSON.stringify(answer)}`).toBe(String(supervisor.pid));
    } finally {
      await supervisor.end('SIGKILL');
    }
  });

  test('a taker gone and no pid file, a live pid written about four seconds after the run began: taken, judged before the pid landed', async () => {
    const { lock } = startingLock('runs-taker-gone-', deadPid());
    const began = path.join(path.dirname(lock), 'began');
    // A take that waited for a pid, as a lock with no taker gets, would see this one live and answer 3.
    const late = writesAfter(began, path.join(lock, 'pid'), 4000, '`${process.pid}\\n`', true);
    try {
      fs.writeFileSync(began, '');
      tookOver(lock);
    } finally {
      await late.end('SIGKILL');
    }
  });

  test('a taker alive and no pid file, under a one second launch wait: taken over with its own mark', () => {
    const { lock, mark } = startingLock('runs-still-', process.pid);
    expect(tookOver(lock, envOf({ WK_LAUNCH_WAIT: '1' })).mark !== mark, 'a new tag, not the starting run\'s').toBeTruthy();
  });
});

describe('runs.js run: two takers at one moment', () => {
  test('two runs started on one lock at once: never two holders, each its command\'s 0 or 3 naming the holder', async () => {
    // A race, so it runs a few times.
    for (let round = 1; round <= 3; round += 1) {
      const dir = mkTmp('runs-two-');
      const lock = path.join(dir, 'lock');
      const inside = path.join(dir, 'inside');
      // Each command holds `inside` create-only for half a second, so an overlap exits 9.
      const script = [
        "const fs = require('fs');",
        `try { fs.writeFileSync(${jsPath(inside)}, '', { flag: 'wx' }); } catch { process.exit(9); }`,
        `setTimeout(() => { fs.rmSync(${jsPath(inside)}); process.exit(0); }, 500);`,
      ].join('\n');
      const env = envOf();
      const calls = [0, 1].map(() => runCall(lock, script));
      const runs = calls.map((call) => start(process.execPath, call.args, { env }));
      try {
        expect(await until(() => runs.every((r) => ended(r.child))), `round ${round}: both runs returned`).toBeTruthy();
        await Promise.all(runs.map((r) => r.done));
        runs.forEach((r, i) => {
          const code = r.child.exitCode;
          expect(code === 0 || code === 3, `round ${round}, run ${i}: 0 or 3, never two holders, got ${code}, output: ${r.output()}`).toBeTruthy();
          if (code === 3) expect(Number(answerOf(calls[i].answer).held) > 0, `round ${round}, run ${i}: held names the holder`).toBeTruthy();
        });
      } finally {
        await Promise.all(runs.map((r) => r.end('SIGKILL')));
      }
    }
  });
});

describe('runs.js run: a launch that fails', () => {
  test('a bad tests.check: not 0, the could-not-start line naming the log, nothing ran, no code in the answer, the lock retired so the next run takes it at once', () => {
    const dir = mkTmp('runs-nostart-');
    const lock = path.join(dir, 'lock');
    const ran = path.join(dir, 'ran');
    const env = envOf();
    const call = runCall(lock, writesRan(ran), { root: rootHolding(checkSettings(0)), dir });
    const res = run(process.execPath, call.args, { env });
    expect(res.status !== 0 && res.status !== null, `the launch failed, so not 0, output: ${res.output}`).toBeTruthy();
    const line = res.stderr.split('\n').find((l) => l.startsWith('detach: could not start '));
    expect(Boolean(line) && line.includes(path.basename(dir)), `the could-not-start line naming the log, stderr: ${res.stderr}`).toBeTruthy();
    expect(fs.existsSync(ran), 'the command never ran').toBe(false);
    expect(answerOf(call.answer).code, 'no code: the runner failed, not the command').toBe(undefined);
    expect(holding(lock), 'the lock was retired').toBe('(none)');
    expect(runOn(lock, 'process.exit(6)', { env }).res.status, 'the next run takes the lock with its own code').toBe(6);
  });
});

describe('runs.js run: a signal before the pid is written', () => {
  /**
   * A node script that runs <job> through runs.js's run and exits with run's code; its launch
   * never settles, and holds a timer so the process lives on while it hangs.
   */
  const holdsLaunch = (job) => [
    `const { run } = require(${jsPath(RUNS)});`,
    'const launch = () => new Promise(() => { setInterval(() => {}, 1 << 30); });',
    `run(${JSON.stringify(job)}, { launch }).then((code) => process.exit(code));`,
  ].join('\n');

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    test(`a ${signal} after the lock is taken and before any pid: exit ${code}${signal === 'SIGINT' ? ', int=1 in the answer' : ''}, the pidless lock retired, the next run takes it at once`, {
      skip: IS_WINDOWS && 'Windows delivers no signal to one process',
    }, async () => {
      const dir = mkTmp('runs-window-');
      const lock = path.join(dir, 'lock');
      const answer = path.join(dir, 'answer');
      const job = { log: path.join(dir, 'log'), lock, root: null, answer, argv: [process.execPath, '-e', 'process.exit(0)'] };
      const caller = start(process.execPath, ['-e', holdsLaunch(job)], { env: envOf() });
      try {
        expect(await until(() => fs.existsSync(path.join(lock, 'claim'))), `the lock was never taken, output: ${caller.output()}`).toBeTruthy();
        expect(fs.existsSync(path.join(lock, 'pid')), 'no pid while the launch hangs').toBe(false);
        process.kill(caller.pid, signal);
        expect(await until(() => ended(caller.child)), `the call never ended after the ${signal}, output: ${caller.output()}`).toBeTruthy();
        await caller.done;
        expect(caller.child.exitCode, `the call exits ${code}, output: ${caller.output()}`).toBe(code);
        if (signal === 'SIGINT') expect(answerOf(answer).int, `the answer holds int=1, got: ${read(answer)}`).toBe('1');
        expect(holding(lock), 'the pidless lock was retired').toBe('(none)');
        expect(runOn(lock, 'process.exit(4)').res.status, 'the next run takes the lock with its own code').toBe(4);
      } finally {
        await caller.end('SIGKILL');
      }
    });
  }
});

describe('runs.js endOnInt: an end of the run that fails', () => {
  test('a supervisor that does not answer, and an endRun that returns false: false, the lock kept with the supervisor\'s pid', async () => {
    const { endOnInt } = require(RUNS);
    const holder = start(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);']);
    const lock = handLock(lockIn('runs-endfails-'), { claim: claimNaming('held'), 'id.held': '', pid: `${holder.pid}\n` });
    // The holder never answers, so a one second wait runs out and the end is tried.
    const saved = process.env.WK_END_WAIT;
    process.env.WK_END_WAIT = '1';
    let ends = 0;
    try {
      const done = await endOnInt(lock, holder.pid, { endRun: () => { ends += 1; return false; } });
      expect(done, 'an end that failed').toBe(false);
      expect(ends > 0, 'the end of the run was tried').toBeTruthy();
      expect(pidIn(path.join(lock, 'pid')), 'the lock is kept, still holding the supervisor').toBe(holder.pid);
    } finally {
      if (saved === undefined) delete process.env.WK_END_WAIT; else process.env.WK_END_WAIT = saved;
      await holder.end('SIGKILL');
    }
  });
});

describe('runs.js attach: a run that ended without its code', () => {
  /** `runs.js attach <log> <lock> <pid> --answer <file>` on a lock holding <files>, its log there. */
  const attachTo = (pid, files) => {
    const dir = mkTmp('runs-attach-');
    const lock = handLock(path.join(dir, 'lock'), { claim: claimNaming('a'), 'id.a': '', ...files });
    fs.writeFileSync(path.join(dir, 'log'), '');
    return run(process.execPath, [RUNS, 'attach', path.join(dir, 'log'), lock, String(pid), '--answer', path.join(dir, 'answer')], { env: envOf() });
  };

  test('a supervisor gone, no done file and no record: exit 1, the line naming its pid', () => {
    const dead = deadPid();
    const res = attachTo(dead, { pid: `${dead}\n` });
    expect(res.status, `exit 1, output: ${res.output}`).toBe(1);
    expect(res.stderr.includes(`detach: the run of supervisor ${dead} ended without recording an exit code`), `the line, stderr: ${res.stderr}`).toBeTruthy();
  });

  test('a done file holding no number: exit 1, the line naming what it held', () => {
    const res = attachTo(process.pid, { pid: `${process.pid}\n`, done: 'x\n' });
    expect(res.status, `exit 1, output: ${res.output}`).toBe(1);
    expect(res.stderr.includes('detach: the done file held no exit code (x)'), `the line, stderr: ${res.stderr}`).toBeTruthy();
  });
});

describe('runs.js ask-end', () => {
  test('a live pid in the lock, no done file, and the lock dropped inside the wait: 0, the end request written first, the pid still alive', async () => {
    const lock = handLock(lockIn('runs-ask-'), { claim: claimNaming('held'), 'id.held': '' });
    const asked = path.join(path.dirname(lock), 'asked');
    const holder = start(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);']);
    // Dropped as the attached call drops it once the run ended; the request copied out first, the proof it came.
    const dropper = actsAfter(path.join(lock, 'end'), 200,
      `fs.copyFileSync(${jsPath(path.join(lock, 'end'))}, ${jsPath(asked)}); fs.rmSync(${jsPath(lock)}, { recursive: true });`);
    try {
      fs.writeFileSync(path.join(lock, 'pid'), `${holder.pid}\n`);
      // A wait far past the shared deadline, so only the drop answers in time.
      const res = run(process.execPath, [RUNS, 'ask-end', lock, String(holder.pid)], { env: envOf({ WK_END_WAIT: '600' }) });
      expect(res.status, `the lock no longer holds the pid, so 0, output: ${res.output}`).toBe(0);
      expect(fs.existsSync(asked) && !fs.existsSync(lock), 'the request was written, then the lock dropped').toBeTruthy();
      expect(alive(holder.pid), 'the pid itself still lives').toBe(true);
    } finally {
      await Promise.all([holder.end('SIGKILL'), dropper.end('SIGKILL')]);
    }
  });
});

describe('runs.js run under a supervisor already', () => {
  test('WORKKIT_SUPERVISED=1 under another run\'s lock: the command in the foreground, on stdout and in the log, its lock marked foreground naming the enclosing lock, its code, the lock gone after', () => {
    const dir = mkTmp('runs-fg-');
    const lock = path.join(dir, 'lock');
    const enclosing = path.join(dir, 'enclosing-lock');
    const seen = path.join(dir, 'seen');
    const script = [
      "const fs = require('fs');",
      `fs.writeFileSync(${jsPath(seen)}, fs.readFileSync(${jsPath(path.join(lock, 'foreground'))}, 'utf8'));`,
      "console.log('in the foreground');",
      'process.exit(3);',
    ].join('\n');
    const call = runCall(lock, script, { dir });
    const res = run(process.execPath, call.args, { env: envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: enclosing }) });
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(3);
    expect(res.stdout.includes('in the foreground'), `on stdout, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(read(call.log).includes('in the foreground'), `in the log, got: ${JSON.stringify(read(call.log))}`).toBeTruthy();
    expect(samePath(read(seen).trim(), enclosing, process.platform), `the foreground mark names the enclosing lock, got: ${JSON.stringify(read(seen))}`).toBe(true);
    expect(answerOf(call.answer).code, 'the answer holds the code').toBe('3');
    expect(holding(lock), 'the lock is gone after').toBe('(none)');
  });

  test('WORKKIT_SUPERVISED=1 under the enclosing run\'s own lock: bare, on stdout alone, the log and that lock untouched', () => {
    const dir = mkTmp('runs-bare-');
    const lock = handLock(path.join(dir, 'lock'), { claim: claimNaming('enc'), 'id.enc': '', pid: `${process.pid}\n` });
    const call = runCall(lock, "console.log('bare line'); process.exit(3);", { dir });
    fs.writeFileSync(call.log, 'the enclosing run\'s line\n');
    const res = run(process.execPath, call.args, { env: envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: lock }) });
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(3);
    expect(res.stdout.includes('bare line'), `on stdout, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(read(call.log), 'the enclosing run\'s log as it was: its stdout is that log already').toBe('the enclosing run\'s line\n');
    expect(holding(lock), 'the enclosing run\'s lock as it was').toBe('claim id.enc pid');
  });

  test('WORKKIT_SUPERVISED=1 under another run\'s lock, an INT to the group while the command runs: the command takes it, and the call leaves the record, drops the lock and returns the command\'s own code', {
    skip: IS_WINDOWS && 'Windows delivers no INT to a process group',
  }, async () => {
    const dir = mkTmp('runs-fg-int-');
    const lock = path.join(dir, 'lock');
    const pidFile = path.join(dir, 'cmd.pid');
    // The command ends on its own INT, with 7.
    const call = runCall(lock, `process.on('SIGINT', () => process.exit(7));\n${silent(pidFile)}`, { dir });
    const env = envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: path.join(dir, 'enclosing-lock') });
    const caller = start(process.execPath, call.args, { env, detached: true });
    try {
      await pidOf(pidFile);
      process.kill(-caller.pid, 'SIGINT');
      expect(await until(() => ended(caller.child)), `the call never returned after the INT, output: ${caller.output()}`).toBeTruthy();
      await caller.done;
      expect(caller.child.exitCode, `the command's own code, output: ${caller.output()}`).toBe(7);
      expect(answerOf(call.answer).code, `the answer holds the code, got: ${read(call.answer)}`).toBe('7');
      expect(/^\d+ 7\n?$/.test(read(`${lock}.done`)), `the record beside the lock holds the code, got: ${JSON.stringify(read(`${lock}.done`))}`).toBe(true);
      expect(holding(lock), 'the foreground lock was dropped').toBe('(none)');
    } finally {
      reap(pidIn(pidFile));
      await caller.end('SIGKILL');
    }
  });
});

describe('runs.js run: a view whose reader goes away', () => {
  /** A command that writes its pid, then a line every tenth of a second until <stop> appears, then exits <code>. */
  const linesUntil = (pidFile, stop, code) => [
    writesPid(pidFile),
    `setInterval(() => { if (require('fs').existsSync(${jsPath(stop)})) process.exit(${code}); console.log('a line'); }, 100);`,
  ].join('\n');
  /** A run of linesUntil in <dir> under <env>, its stdout's reader gone once a line showed: the call, the command's pid, the supervisor's. */
  const viewGone = async (dir, env) => {
    const lock = path.join(dir, 'lock');
    const viewer = start(process.execPath, runCall(lock, linesUntil(path.join(dir, 'cmd.pid'), path.join(dir, 'stop'), 5), { dir }).args, { env });
    const supervisor = await pidOf(path.join(lock, 'pid'));
    const cmd = await pidOf(path.join(dir, 'cmd.pid'));
    expect(await until(() => viewer.stdout().includes('a line')), `the view never showed a line, output: ${viewer.output()}`).toBeTruthy();
    viewer.child.stdout.destroy();
    return { lock, viewer, cmd, supervisor };
  };

  test('a painted view whose reader goes away: the call ends with its line, exit 1, the run goes on, its lock kept', async () => {
    const dir = mkTmp('runs-painted-');
    let gone;
    try {
      gone = await viewGone(dir, envOf(COLOR_ON));
      const { lock, viewer, cmd, supervisor } = gone;
      expect(await until(() => ended(viewer.child)), `the call never ended once its view was gone, stderr: ${viewer.stderr()}`).toBeTruthy();
      await viewer.done;
      expect(viewer.child.exitCode, `exit 1, stderr: ${viewer.stderr()}`).toBe(1);
      expect(viewer.stderr().includes('detach: the painted view of the run ended'), `the view's line, stderr: ${viewer.stderr()}`).toBeTruthy();
      expect(alive(cmd), `the run ${cmd} goes on`).toBe(true);
      expect(pidIn(path.join(lock, 'pid')), 'the lock is kept for a watch').toBe(supervisor);
    } finally {
      fs.writeFileSync(path.join(dir, 'stop'), '');
      if (gone) {
        reap(gone.cmd, gone.supervisor);
        await gone.viewer.end('SIGKILL');
      }
    }
  });

  test('a plain view whose reader goes away: the call goes on waiting, then returns the run\'s own code and drops the lock', async () => {
    const dir = mkTmp('runs-plain-');
    let gone;
    try {
      gone = await viewGone(dir, envOf());
      const { lock, viewer } = gone;
      expect(await until(() => ended(viewer.child), 1000), `the call ended with its reader, stderr: ${viewer.stderr()}`).toBe(false);
      fs.writeFileSync(path.join(dir, 'stop'), '');
      expect(await until(() => ended(viewer.child)), `the call never returned, stderr: ${viewer.stderr()}`).toBeTruthy();
      await viewer.done;
      expect(viewer.child.exitCode, `the run's own code, stderr: ${viewer.stderr()}`).toBe(5);
      expect(holding(lock), 'the lock was dropped').toBe('(none)');
    } finally {
      fs.writeFileSync(path.join(dir, 'stop'), '');
      if (gone) {
        reap(gone.cmd, gone.supervisor);
        await gone.viewer.end('SIGKILL');
      }
    }
  });
});

describe('runs.js run: the supervisor\'s parent', () => {
  test('a running run\'s supervisor is no child of the calling runs.js, so an end of the call\'s tree never reaches the run', {
    skip: IS_WINDOWS && 'the parent is read with ps -o ppid=, which Git Bash\'s ps does not answer for a Windows pid',
  }, async () => {
    const dir = mkTmp('runs-parent-');
    const lock = path.join(dir, 'lock');
    const lockPid = path.join(lock, 'pid');
    const go = path.join(dir, 'go');
    const caller = start(process.execPath, runCall(lock, waitsFor(go)).args, { env: envOf() });
    try {
      const supervisor = await pidOf(lockPid);
      const ps = run('ps', ['-o', 'ppid=', '-p', String(supervisor)]);
      const parent = Number(ps.stdout.trim());
      expect(parent > 0, `ps read the supervisor's parent, got: ${ps.output}`).toBe(true);
      expect(parent, `the supervisor ${supervisor}'s parent is not the call ${caller.pid}`).not.toBe(caller.pid);
      fs.writeFileSync(go, '');
      expect(await until(() => ended(caller.child)), `the call never returned, output: ${caller.output()}`).toBeTruthy();
      await caller.done;
      expect(caller.child.exitCode, `the run's own code, output: ${caller.output()}`).toBe(0);
    } finally {
      reap(pidIn(lockPid));
      await caller.end('SIGKILL');
    }
  });
});

describe('run-lock.js: the owner\'s drop, the end of a run and the liveness read', () => {
  const { dropRunLock, endRun, pidAlive } = require(RUN_LOCK);
  test('the owner\'s drop on a lock another run took over, another tag, mark and pid: the folder stays whole', async () => {
    const lock = handLock(lockIn('runs-drop-other-'), { claim: claimNaming('other'), 'id.other': '', pid: `${process.pid}\n` });
    await dropRunLock(lock, deadPid());
    expect(holding(lock), 'the other run\'s lock is whole').toBe('claim id.other pid');
    expect(claimOf(lock), 'its claim still names the other run\'s mark').toBe('other');
    expect(pidIn(path.join(lock, 'pid')), 'its pid file names the other run').toBe(process.pid);
  });

  test('the owner\'s drop on the lock of its own run: the folder is gone', async () => {
    const lock = handLock(lockIn('runs-drop-own-'), { claim: claimNaming('a'), 'id.a': '', pid: `${process.pid}\n` });
    await dropRunLock(lock, process.pid);
    expect(holding(lock), 'the drop removed the folder').toBe('(none)');
  });

  test('endRun off Windows: a detached run whose command rides out INT and TERM, the command and its supervisor gone', {
    skip: IS_WINDOWS && 'the process-group end is the off-Windows one; Windows ends the tree through tree.js',
  }, async () => {
    const dir = mkTmp('runs-end-');
    const pidFile = path.join(dir, 'cmd.pid');
    const script = `${writesPid(pidFile)}\nprocess.on('SIGINT', () => {}); process.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);`;
    const launched = run(process.execPath, [DETACH, path.join(dir, 'log'), path.join(dir, 'done'), '--', process.execPath, '-e', script]);
    expect(launched.status, `detach.js launched the run, stderr: ${launched.stderr}`).toBe(0);
    const supervisor = Number(launched.stdout.trim());
    let command;
    try {
      command = await pidOf(pidFile);
      await endRun(supervisor);
      expect(await until(() => !alive(command) && !alive(supervisor)),
        `the command (pid ${command}) or the supervisor (pid ${supervisor}) outlived endRun`).toBeTruthy();
    } finally {
      reap(command, supervisor);
    }
  });

  test('pidAlive: true for a live pid, false for one that is gone', () => {
    expect(pidAlive(process.pid), 'this process is alive').toBe(true);
    expect(pidAlive(deadPid()), 'a pid that has ended').toBe(false);
  });

  test('pidAlive: false for a child that ended while its parent, which never collects it, still lives', {
    skip: IS_WINDOWS && 'Windows has no ended process left for its parent to collect',
  }, async () => {
    const parent = startNeverCollects();
    try {
      const child = await childOf(parent);
      expect(await until(() => !pidAlive(child)), `pidAlive ${child} turned false once the child ended`).toBe(true);
      expect(alive(parent.pid), 'the parent that never collects it still lives').toBe(true);
    } finally {
      await parent.end('SIGKILL');
    }
  });
});
