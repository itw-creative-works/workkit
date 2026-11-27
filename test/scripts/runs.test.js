// Tests for workflow/lib/runs.js's run, which takes a run's lock, launches, attaches and ends it,
// called in a node of its own as the script shell calls it: a free lock, the take's judge (a run
// that is over, a live holder, a launch under way, a removal under way), two takers on one lock, a
// launch that fails, a signal before the pid, an end that fails, a run under a supervisor already,
// a painted and a plain view whose reader goes away, and the supervisor's parent. Then attach.js's
// attach to a run that ended without its code, and run-lock.js's end request,
// drop, end, liveness read and the record it leaves beside the lock.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, run, start,
} = require('../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, jsPath, systemPathWith, homeEnv, samePath, skipWithoutModes,
} = require('../lib/platform');
const {
  checkSettings, rootHolding, pidOf, reap, writesPid, silent, ended, read, handLock, claimNaming, tagOf,
  actsAfter, writesAfter, deadPid, holding, attachArgv, underEndWait, launchBody,
} = require('../lib/supervise');
const { startNeverCollects, childOf } = require('../lib/never-collects');
const { COLOR_ON, linesToLast } = require('../lib/supervise-world');
const { runJob, runUnder, startRun } = require('../lib/kit-under');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const RUNS = path.join(LIB, 'runs.js');
const RUN_LOCK = path.join(LIB, 'run-lock.js');

// A run lock's mark file, beside its claim: held by a take's tag, or being removed.
const MARK = /^(id|gone)\..+$/;
const marksIn = (names) => names.filter((name) => MARK.test(name)).join(' ');
const lockIn = (prefix) => path.join(mkTmp(prefix), 'lock');
/** <lock>'s claim text, trimmed, or '' while it has none. */
const claimOf = (lock) => read(path.join(lock, 'claim')).trim();

/** A scratch home and this suite's node on PATH, <extra> beside them, so no case reads the machine's own settings. */
const envOf = (extra = {}) => homeEnv(mkTmp('runs-home-'), { PATH: systemPathWith(NODE_DIR), ...extra });

/** A run of node -e <script> on <lock>, its log in a scratch folder of its own. */
const jobOn = (lock, script, root = null) => runJob(mkTmp('runs-call-'), script, { lock, root });

/** run on <lock> to its end: the harness run's result and what run resolved. */
const runOn = (lock, script, { env = envOf(), root } = {}) => runUnder(jobOn(lock, script, root), { env });

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
  test('the command\'s output on stdout from the log\'s first byte, its code the exit and run\'s rc and code, no held, look or int, the lock held under one mark its claim names and gone after; the next run holds it under another tag', () => {
    const lock = lockIn('runs-free-');
    const seen = path.join(path.dirname(lock), 'seen.json');
    const { res, answers } = runOn(lock, recordsLock(lock, seen, 4));
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(4);
    expect(res.stdout.startsWith('first line\nsecond line\n'), `stdout from the log's first byte, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(Boolean(answers) && answers.rc === 4 && answers.code === 4, `rc and code 4, got: ${JSON.stringify(answers)}`).toBe(true);
    expect(Boolean(answers.held || answers.look || answers.int), `no held, look or int, got: ${JSON.stringify(answers)}`).toBe(false);
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
    const { res, answers } = runOn(lock, writesRan(ran));
    expect(res.status, `a live holder, so 3, output: ${res.output}`).toBe(3);
    expect(Boolean(answers) && answers.rc === 3 && answers.held === process.pid, `rc 3, held names the live run, got: ${JSON.stringify(answers)}`).toBe(true);
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
    const first = startRun(jobOn(lock, waitsFor(go)), { env });
    try {
      const supervisor = await pidOf(lockPid);
      const [mark, claim] = [marksIn(fs.readdirSync(lock)), claimOf(lock)];
      expect(mark !== '' && mark === `id.${claim}`, `the holder's claim names its one mark, it holds: ${holding(lock)}`).toBeTruthy();
      const { res, answers } = runOn(lock, writesRan(ran), { env });
      expect(res.status, `the take answers 3, output: ${res.output}`).toBe(3);
      expect(answers && answers.held, `held names the supervisor, got: ${JSON.stringify(answers)}`).toBe(supervisor);
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
      const { res, answers } = runOn(lock, 'process.exit(0)');
      expect(res.status, `a starting run keeps its lock, so 3, output: ${res.output}`).toBe(3);
      expect(answers && answers.held, `held names the pid written late, got: ${JSON.stringify(answers)}`).toBe(supervisor.pid);
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
      const runs = [0, 1].map(() => startRun(jobOn(lock, script), { env }));
      try {
        expect(await until(() => runs.every((r) => ended(r.child))), `round ${round}: both runs returned`).toBeTruthy();
        await Promise.all(runs.map((r) => r.done));
        runs.forEach((r, i) => {
          const code = r.child.exitCode;
          expect(code === 0 || code === 3, `round ${round}, run ${i}: 0 or 3, never two holders, got ${code}, output: ${r.output()}`).toBeTruthy();
          if (code === 3) expect(r.answers().held > 0, `round ${round}, run ${i}: held names the holder`).toBeTruthy();
        });
      } finally {
        await Promise.all(runs.map((r) => r.end('SIGKILL')));
      }
    }
  });
});

describe('runs.js run: a launch that fails', () => {
  test('a bad tests.check: not 0, the could-not-start line naming the log, nothing ran, no code in what run resolved, the lock retired so the next run takes it at once', () => {
    const dir = mkTmp('runs-nostart-');
    const lock = path.join(dir, 'lock');
    const ran = path.join(dir, 'ran');
    const env = envOf();
    const { res, answers } = runUnder(runJob(dir, writesRan(ran), { root: rootHolding(checkSettings(0)) }), { env });
    expect(res.status !== 0 && res.status !== null, `the launch failed, so not 0, output: ${res.output}`).toBeTruthy();
    const line = res.stderr.split('\n').find((l) => l.startsWith('detach: could not start '));
    expect(Boolean(line) && line.includes(path.basename(dir)), `the could-not-start line naming the log, stderr: ${res.stderr}`).toBeTruthy();
    expect(fs.existsSync(ran), 'the command never ran').toBe(false);
    expect(answers.code ?? null, 'no code: the runner failed, not the command').toBe(null);
    expect(holding(lock), 'the lock was retired').toBe('(none)');
    expect(runOn(lock, 'process.exit(6)', { env }).res.status, 'the next run takes the lock with its own code').toBe(6);
  });
});

describe('runs.js run: a signal before the pid is written', () => {
  // A launch that never settles, holding a timer so the process lives on while it hangs.
  const HOLDS_LAUNCH = '() => new Promise(() => { setInterval(() => {}, 1 << 30); })';

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    test(`a ${signal} after the lock is taken and before any pid: exit ${code}${signal === 'SIGINT' ? ', int in what run resolves' : ''}, the pidless lock retired, the next run takes it at once`, {
      skip: IS_WINDOWS && 'Windows delivers no signal to one process',
    }, async () => {
      const dir = mkTmp('runs-window-');
      const lock = path.join(dir, 'lock');
      const caller = startRun(runJob(dir, 'process.exit(0)'), { env: envOf(), launch: HOLDS_LAUNCH });
      try {
        expect(await until(() => fs.existsSync(path.join(lock, 'claim'))), `the lock was never taken, output: ${caller.output()}`).toBeTruthy();
        expect(fs.existsSync(path.join(lock, 'pid')), 'no pid while the launch hangs').toBe(false);
        process.kill(caller.pid, signal);
        expect(await until(() => ended(caller.child)), `the call never ended after the ${signal}, output: ${caller.output()}`).toBeTruthy();
        await caller.done;
        expect(caller.child.exitCode, `the call exits ${code}, output: ${caller.output()}`).toBe(code);
        if (signal === 'SIGINT') {
          const answers = caller.answers();
          expect(Boolean(answers && answers.int), `run resolved int to its caller, got: ${JSON.stringify(answers)}`).toBe(true);
        }
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
    let ends = 0;
    try {
      const done = await underEndWait(1, () => endOnInt(lock, holder.pid, { endRun: () => { ends += 1; return false; } }));
      expect(done, 'an end that failed').toBe(false);
      expect(ends > 0, 'the end of the run was tried').toBeTruthy();
      expect(pidIn(path.join(lock, 'pid')), 'the lock is kept, still holding the supervisor').toBe(holder.pid);
    } finally {
      await holder.end('SIGKILL');
    }
  });
});

describe('attach.js attachRun: a run that ended without its code', () => {
  /** attachRun to supervisor <pid> in a node of its own, on a lock holding <files>, its log there. */
  const attachTo = (pid, files) => {
    const dir = mkTmp('runs-attach-');
    const lock = handLock(path.join(dir, 'lock'), { claim: claimNaming('a'), 'id.a': '', ...files });
    fs.writeFileSync(path.join(dir, 'log'), '');
    return run(process.execPath, attachArgv(path.join(dir, 'log'), lock, pid), { env: envOf() });
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

  test('another call collected the run between this call\'s log read and its lock check: this call still shows the log\'s last lines, then the run\'s code', async () => {
    const { attachRun } = require(path.join(LIB, 'attach.js'));
    const request = 'detach: the run was ended on request (exit 143)';
    const dir = mkTmp('runs-collected-');
    const log = path.join(dir, 'log');
    const supervisor = deadPid();
    const lock = handLock(path.join(dir, 'lock'), { claim: claimNaming('a'), 'id.a': '', pid: `${supervisor}\n` });
    fs.writeFileSync(log, 'narrowed-marker\n');
    let shown = '';
    // The view gets the first read's bytes before the lock check, so the end lands there:
    // the body's closing line and the request line, then the record and the lock dropped as a collecting call leaves them.
    const view = {
      write: (bytes) => {
        if (shown === '') {
          fs.appendFileSync(log, `script-shell: exit 143\n${request}\n`);
          fs.writeFileSync(`${lock}.done`, `${supervisor} 143\n`);
          fs.rmSync(lock, { recursive: true });
        }
        shown += String(bytes);
      },
      flush: () => {},
      gone: () => false,
    };
    const done = await attachRun(log, lock, supervisor, 0, { view });
    expect(done.rc, `the record's code, shown: ${shown}`).toBe(143);
    expect(linesToLast(shown).slice(-2), 'the closing line and the request line, last').toEqual(['script-shell: exit 143', request]);
  });
});

describe('run-lock.js askEnd', () => {
  test('a live pid in the lock, no done file, and the lock dropped inside the wait: 0, the end request written first, the pid still alive', async () => {
    const { askEnd } = require(RUN_LOCK);
    const lock = handLock(lockIn('runs-ask-'), { claim: claimNaming('held'), 'id.held': '' });
    const asked = path.join(path.dirname(lock), 'asked');
    const holder = start(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);']);
    // Dropped as the attached call drops it once the run ended; the request copied out first, the proof it came.
    const dropper = actsAfter(path.join(lock, 'end'), 200,
      `fs.copyFileSync(${jsPath(path.join(lock, 'end'))}, ${jsPath(asked)}); fs.rmSync(${jsPath(lock)}, { recursive: true });`);
    try {
      fs.writeFileSync(path.join(lock, 'pid'), `${holder.pid}\n`);
      // A wait far past the shared deadline, so only the drop answers in time.
      const answer = await underEndWait(600, () => askEnd(lock, holder.pid));
      expect(answer, 'the lock no longer holds the pid, so 0').toBe(0);
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
    const job = runJob(dir, script);
    const { res, answers } = runUnder(job, { env: envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: enclosing }) });
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(3);
    expect(res.stdout.includes('in the foreground'), `on stdout, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(read(job.log).includes('in the foreground'), `in the log, got: ${JSON.stringify(read(job.log))}`).toBeTruthy();
    expect(samePath(read(seen).trim(), enclosing, process.platform), `the foreground mark names the enclosing lock, got: ${JSON.stringify(read(seen))}`).toBe(true);
    expect(answers && answers.code, `run resolved the code, got: ${JSON.stringify(answers)}`).toBe(3);
    expect(holding(lock), 'the lock is gone after').toBe('(none)');
  });

  test('WORKKIT_SUPERVISED=1 under the enclosing run\'s own lock: bare, on stdout alone, the log and that lock untouched', () => {
    const dir = mkTmp('runs-bare-');
    const lock = handLock(path.join(dir, 'lock'), { claim: claimNaming('enc'), 'id.enc': '', pid: `${process.pid}\n` });
    const job = runJob(dir, "console.log('bare line'); process.exit(3);", { lock });
    fs.writeFileSync(job.log, 'the enclosing run\'s line\n');
    const { res } = runUnder(job, { env: envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: lock }) });
    expect(res.status, `the command's own code, output: ${res.output}`).toBe(3);
    expect(res.stdout.includes('bare line'), `on stdout, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    expect(read(job.log), 'the enclosing run\'s log as it was: its stdout is that log already').toBe('the enclosing run\'s line\n');
    expect(holding(lock), 'the enclosing run\'s lock as it was').toBe('claim id.enc pid');
  });

  test('WORKKIT_SUPERVISED=1 under another run\'s lock, an INT to the group while the command runs: the command takes it, and the call leaves the record, drops the lock and returns the command\'s own code', {
    skip: IS_WINDOWS && 'Windows delivers no INT to a process group',
  }, async () => {
    const dir = mkTmp('runs-fg-int-');
    const lock = path.join(dir, 'lock');
    const pidFile = path.join(dir, 'cmd.pid');
    // The command ends on its own INT, with 7.
    const env = envOf({ WORKKIT_SUPERVISED: '1', WK_RUN_LOCK: path.join(dir, 'enclosing-lock') });
    const caller = startRun(runJob(dir, `process.on('SIGINT', () => process.exit(7));\n${silent(pidFile)}`), { env, detached: true });
    try {
      await pidOf(pidFile);
      process.kill(-caller.pid, 'SIGINT');
      expect(await until(() => ended(caller.child)), `the call never returned after the INT, output: ${caller.output()}`).toBeTruthy();
      await caller.done;
      expect(caller.child.exitCode, `the command's own code, output: ${caller.output()}`).toBe(7);
      expect(caller.answers() && caller.answers().code, `run resolved the code, got: ${JSON.stringify(caller.answers())}`).toBe(7);
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
    const viewer = startRun(runJob(dir, linesUntil(path.join(dir, 'cmd.pid'), path.join(dir, 'stop'), 5)), { env });
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
  test('a running run\'s supervisor is no child of the node calling run, so an end of the call\'s tree never reaches the run', {
    skip: IS_WINDOWS && 'the parent is read with ps -o ppid=, which Git Bash\'s ps does not answer for a Windows pid',
  }, async () => {
    const dir = mkTmp('runs-parent-');
    const lock = path.join(dir, 'lock');
    const lockPid = path.join(lock, 'pid');
    const go = path.join(dir, 'go');
    const caller = startRun(runJob(dir, waitsFor(go)), { env: envOf() });
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
    const supervisor = launchBody(dir, [process.execPath, '-e', script]);
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

describe('run-lock.js leaveRecord: the record beside the lock', () => {
  const { leaveRecord } = require(RUN_LOCK);
  const WRITERS = 8;
  const NO_WRITE = skipWithoutModes('a read-only folder does not stop the write');


  test('eight calls attached to one run leave its record at one moment, 200 times each: every call exits 0, the record whole, no temp file left', async () => {
    const lock = lockIn('runs-record-many-');
    const body = `const { leaveRecord } = require(${jsPath(RUN_LOCK)}); (async () => { for (let i = 0; i < 200; i += 1) await leaveRecord(${jsPath(lock)}, 41, 6); })();`;
    const writers = Array.from({ length: WRITERS }, () => start(process.execPath, ['-e', body], { env: envOf() }));
    const ends = await Promise.all(writers.map((writer) => writer.done));
    ends.forEach((end, at) => expect(end.status, `writer ${at} exits 0, it said: ${writers[at].output()}`).toBe(0));
    expect(read(`${lock}.done`), 'the record holds the one line').toBe('41 6\n');
    expect(fs.readdirSync(path.dirname(lock)).join(' '), 'the record alone, no temp file beside it').toBe('lock.done');
  });

  test('a record this call cannot write, the same line already left by another call: no error, the record as it was', { skip: NO_WRITE }, async () => {
    const lock = lockIn('runs-record-same-');
    const dir = path.dirname(lock);
    fs.writeFileSync(`${lock}.done`, '41 6\n');
    fs.chmodSync(dir, 0o555);
    try {
      expect(await leaveRecord(lock, 41, 6).then(() => null, (err) => err), 'the other call\'s record is this call\'s').toBe(null);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(read(`${lock}.done`), 'the record as the other call left it').toBe('41 6\n');
  });

  test('a record no rename can land on, a folder holding a file: the rename\'s own error after about two seconds of tries, no temp file left', async () => {
    const lock = lockIn('runs-record-never-');
    fs.mkdirSync(`${lock}.done`);
    fs.writeFileSync(path.join(`${lock}.done`, 'held'), '');
    const began = Date.now();
    const err = await leaveRecord(lock, 41, 6).then(() => null, (thrown) => thrown);
    expect(err?.syscall, `the rename's error is thrown, got: ${err}`).toBe('rename');
    expect(Date.now() - began >= 1900, `the write was tried for about two seconds, took ${Date.now() - began} ms`).toBeTruthy();
    expect(fs.readdirSync(path.dirname(lock)).join(' '), 'the folder alone, no temp file beside it').toBe('lock.done');
  });
});
