// Tests for workflow/lib/command-log.js, the command log: the plain text a log
// keeps and the names it is kept under, in this process; the logger around a
// small Node program that plays the command, in a node of its own; the entry's
// hand-off for the edges a real command shows; a secret step's two stdio, and a
// terminal step on a pipe and at a terminal.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, until, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, nodeHomeEnv, jsPath, samePath, which, skipWithoutCaughtSignal, spawnSync,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, CLI, mkWorld, mkRepo, runCli, inNode, startInNode,
} = require('./helpers');

const COMMAND_LOG = path.join(WORKFLOW_DIR, 'lib', 'command-log.js');
const { logName, plainLog, terminalDevice } = require(COMMAND_LOG);

const linesOf = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
const readOr = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const machineLog = (world, name) => path.join(world.workflowHome, 'logs', name);

/** Every file under <roots> whose name holds `.log`, for the cases where none may be written. */
const logsUnder = (...roots) => roots.filter((root) => fs.existsSync(root)).flatMap((root) => fs.readdirSync(root, { recursive: true })
  .map(String).filter((p) => !p.startsWith('.git') && /\.log\b/.test(p)).map((p) => path.join(root, p)));

/** A git repo that ignores `.workkit/`, so its log folder is `.workkit/`, holding <files> too. */
const logRepo = (files = {}) => {
  const repo = mkRepo();
  for (const [rel, body] of Object.entries({ '.gitignore': '.workkit/*\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  return repo;
};

/**
 * The program a log is kept around: it records its arguments and the variables
 * the logger hands it, prints a line on each stream, holds until its go file is
 * there (made at once unless `held`), then prints a rewritten colored line and
 * a second error line and ends with <code>.
 */
const playProgram = (code, { held = false } = {}) => {
  const dir = mkTmp('wk-log-play-');
  const file = path.join(dir, 'play.js');
  const go = path.join(dir, 'go');
  const ran = path.join(dir, 'ran');
  const seen = path.join(dir, 'seen.json');
  if (!held) fs.writeFileSync(go, '');
  fs.writeFileSync(file, [
    "const fs = require('fs');",
    `fs.appendFileSync(${jsPath(ran)}, \`\${JSON.stringify(process.argv.slice(2))}\\n\`);`,
    'const logged = process.env.WK_COMMAND_LOGGED;',
    `fs.writeFileSync(${jsPath(seen)}, JSON.stringify({`,
    '  logged: logged ?? null, there: Boolean(logged) && fs.existsSync(logged),',
    '  terminal: process.env.WK_COMMAND_TERMINAL ?? null, color: process.env.WORKKIT_COLOR ?? null,',
    '}));',
    "process.stdout.write('out 1\\n');",
    "process.stderr.write('err 1\\n');",
    'const finish = () => {',
    "  process.stdout.write('step\\rout 2 \\u001b[0;32mok\\u001b[0m\\n');",
    "  process.stderr.write('err 2\\n');",
    `  process.exitCode = ${code};`,
    '};',
    `const wait = () => (fs.existsSync(${jsPath(go)}) ? finish() : setTimeout(wait, 20));`,
    'wait();',
  ].join('\n'));
  return {
    file,
    go,
    runs: () => linesOf(readOr(ran) || '').map((line) => JSON.parse(line)),
    seen: () => JSON.parse(fs.readFileSync(seen, 'utf8')),
  };
};

// What playProgram prints, as each stream carries it and as its log keeps it.
const PLAY_OUT = 'out 1\nstep\rout 2 \u001b[0;32mok\u001b[0m\n';
const PLAY_ERR = 'err 1\nerr 2\n';
const PLAY_LOGGED = ['err 1', 'err 2', 'out 1', 'out 2 ok'];

/**
 * runLogged(kit, name, argv) of a kit whose entry is <program>, in a node of its
 * own; no dispatch is handed, since each such call is logged and never runs unlogged.
 */
const logged = (program, name, argv) => ({
  file: 'lib/command-log.js', fn: 'runLogged', args: [name, argv], kit: { files: { entry: program.file } },
});

/** <log>'s body, its lines sorted (two pipes interleave freely), and its closing line. */
const logParts = (log) => {
  const lines = linesOf(log);
  return { body: lines.slice(0, -1).sort(), closing: lines[lines.length - 1] };
};

describe('command-log.js: plainLog, what a terminal leaves', () => {
  test('a rewritten line keeps its last text, color and title codes go, a line of spaces is empty, every line ends in a newline', () => {
    const PAIRS = [
      ['frame 1\rframe 2\rlast text\n', 'last text\n'],
      ['50%\rdone\r\n', 'done\n'],
      ['working\r                    \r\n', '\n'],
      ['\u001b[1m\u001b[0;32m✓\u001b[0m ok: linked\n', '✓ ok: linked\n'],
      ['\u001b[?25lcursor hidden\u001b[?25h\n', 'cursor hidden\n'],
      ['\u001b]0;workkit setup\u0007setup\n', 'setup\n'],
      ['\u001b]2;a title\u001b\\after it\n', 'after it\n'],
      ['\u001b[0m   \n', '\n'],
      ['   \n \t \n', '\n\n'],
      ['one\ntwo', 'one\ntwo\n'],
      ['', ''],
    ];
    for (const [raw, plain] of PAIRS) expect(plainLog(raw), JSON.stringify(raw)).toBe(plain);
  });
});

describe('command-log.js: which commands are logged, under which name', () => {
  test('the machine commands, proof red and each ship verb but watch have a name; the rest none', () => {
    const NAMED = [
      [['setup'], 'setup'], [['update', '--auto'], 'update'], [['doctor'], 'doctor'], [['publish'], 'publish'],
      [['proof', 'red', 'src/x.js', '--', 'true'], 'proof red'], [['ship', 'cut', '1.2.3'], 'ship cut'], [['ship', 'items'], 'ship items'],
    ];
    for (const [argv, name] of NAMED) expect(logName(argv), `[${argv.join(' ')}]`).toBe(name);
    for (const argv of [['ship', 'watch', 'abc123'], ['brief'], ['help'], ['proof'], ['note', 'a']]) {
      expect(logName(argv), `[${argv.join(' ')}] is not logged`).toBeFalsy();
    }
  });

  test('the terminal device is CONOUT$ on Windows and /dev/tty elsewhere', () => {
    expect(terminalDevice('win32')).toBe('CONOUT$');
    expect(terminalDevice('darwin')).toBe('/dev/tty');
    expect(terminalDevice('linux')).toBe('/dev/tty');
  });
});

describe('command-log.js: runLogged around a program', () => {
  test('both streams arrive as they come, each in order; the log holds their plain text and the closing line; the exit is the child\'s', async () => {
    const world = mkWorld();
    const program = playProgram(3, { held: true });
    const call = startInNode(world, logged(program, 'doctor', ['doctor', '--x']));
    try {
      const first = await until(() => call.stdout() === 'out 1\n' && call.stderr() === 'err 1\n');
      expect(first, `the first lines arrived while the program held, got: ${JSON.stringify(call.output())}`).toBe(true);
      fs.writeFileSync(program.go, '');
      const end = await call.done;
      expect(end.status, `the program's code, got: ${call.output()}`).toBe(3);
    } finally {
      fs.writeFileSync(program.go, '');
      await call.end('SIGKILL');
    }
    expect(call.stdout(), 'stdout as the program wrote it').toBe(PLAY_OUT);
    expect(call.stderr(), 'stderr as the program wrote it').toBe(PLAY_ERR);
    expect(program.runs(), 'the program ran once, with the command\'s arguments').toEqual([['doctor', '--x']]);
    expect(logParts(readOr(machineLog(world, 'doctor.log')) || '')).toEqual({ body: PLAY_LOGGED, closing: 'workkit doctor: exit 3' });
  });

  test('the program sees WK_COMMAND_LOGGED naming the raw log, there while it runs and gone after; a pipe hands it no terminal and no color', () => {
    const world = mkWorld();
    const program = playProgram(0);
    const res = inNode(world, logged(program, 'doctor', ['doctor']));
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    const seen = program.seen();
    expect(typeof seen.logged === 'string' && seen.there, `a raw log path that is there, got: ${JSON.stringify(seen)}`).toBe(true);
    expect(fs.existsSync(seen.logged), 'the raw log is removed once the log is written').toBe(false);
    expect(seen.terminal, 'no WK_COMMAND_TERMINAL off a terminal').toBeNull();
    expect(seen.color, 'no WORKKIT_COLOR off a terminal').toBeNull();
  });

  test('a stale WK_COMMAND_TERMINAL in the caller\'s env does not reach the program: the logger\'s stderr is no terminal', () => {
    const world = mkWorld();
    const stale = path.join(mkTmp('wk-log-stale-'), 'tty');
    fs.writeFileSync(stale, '');
    const program = playProgram(0);
    const res = inNode(world, { ...logged(program, 'doctor', ['doctor']), env: { WK_COMMAND_TERMINAL: stale } });
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(program.seen().terminal, 'the program sees no terminal device').toBeNull();
    expect(fs.readFileSync(stale, 'utf8'), 'and nothing was drawn on the stale one').toBe('');
  });

  test('a machine command logs under the user folder, a repo command in the repo\'s log folder by its dashed name', () => {
    const world = mkWorld();
    const repo = logRepo();
    const program = playProgram(0);
    const machine = inNode(world, { ...logged(program, 'update', ['update']), cwd: repo });
    expect(machine.code, `update exits 0, got: ${machine.said}`).toBe(0);
    expect(logParts(readOr(machineLog(world, 'update.log')) || '').closing, 'update.log in the user folder').toBe('workkit update: exit 0');
    const inRepo = inNode(world, { ...logged(program, 'ship plan', ['ship', 'plan']), cwd: repo });
    expect(inRepo.code, `ship plan exits 0, got: ${inRepo.said}`).toBe(0);
    expect(logParts(readOr(path.join(repo, '.workkit', 'ship-plan.log')) || '')).toEqual({ body: PLAY_LOGGED, closing: 'workkit ship plan: exit 0' });
    expect(logsUnder(path.join(repo, '.workkit')).map((p) => path.basename(p)), 'the repo holds the repo command\'s log alone').toEqual(['ship-plan.log']);
    expect(fs.existsSync(machineLog(world, 'ship-plan.log')), 'and the user folder none of it').toBe(false);
  });
});

describe('command-log.js: a signal to the logger', { skip: skipWithoutCaughtSignal() }, () => {
  // A program that says which signal reached it and ends 7 on it; INT it leaves to its default.
  const signalProgram = () => {
    const dir = mkTmp('wk-log-sig-');
    const file = path.join(dir, 'held.js');
    const got = path.join(dir, 'got');
    fs.writeFileSync(file, [
      "const fs = require('fs');",
      "for (const sig of ['SIGTERM', 'SIGHUP']) {",
      `  process.on(sig, () => { fs.writeFileSync(${jsPath(got)}, sig); fs.writeSync(1, \`got \${sig}\\n\`); process.exit(7); });`,
      '}',
      "process.stdout.write('ready\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    return { file, got: () => readOr(got) };
  };

  for (const [signal, code] of [['SIGTERM', 143], ['SIGHUP', 129]]) {
    test(`${signal}: the program gets it, the log is written, and the logger exits ${code}`, async () => {
      const world = mkWorld();
      const program = signalProgram();
      const call = startInNode(world, logged(program, 'doctor', ['doctor']));
      let end;
      try {
        expect(await until(() => call.stdout().includes('ready\n')), `the program started, got: ${call.output()}`).toBe(true);
        process.kill(call.pid, signal);
        end = await call.done;
      } finally {
        await call.end('SIGKILL');
      }
      expect(end.status, `exit ${code}, got: ${call.output()}`).toBe(code);
      expect(program.got(), 'the program got the same signal').toBe(signal);
      const { body, closing } = logParts(readOr(machineLog(world, 'doctor.log')) || '');
      expect(body, 'the log holds the program\'s lines').toEqual([`got ${signal}`, 'ready']);
      expect(closing, 'and its closing line, the program\'s own 7').toBe('workkit doctor: exit 7');
    });
  }

  test('SIGINT to the whole group: the program ends, the logger stays to write the log, and exits 130', async () => {
    const world = mkWorld();
    const program = signalProgram();
    const call = startInNode(world, { ...logged(program, 'doctor', ['doctor']), detached: true });
    let end;
    try {
      expect(await until(() => call.stdout().includes('ready\n')), `the program started, got: ${call.output()}`).toBe(true);
      process.kill(-call.pid, 'SIGINT');
      end = await call.done;
    } finally {
      await call.end('SIGKILL');
    }
    expect(end.status, `exit 130, got: ${call.output()}`).toBe(130);
    expect(logParts(readOr(machineLog(world, 'doctor.log')) || '')).toEqual({ body: ['ready'], closing: 'workkit doctor: exit 130' });
  });
});

describe('workkit: the entry\'s hand-off to the log', () => {
  const ITEMS_REFUSAL = 'ship-items: unknown argument: --nope (usage: workkit ship items [--repo owner/name])';

  test('a logged command under a logged command is not logged again', () => {
    const world = mkWorld();
    const repo = logRepo();
    const log = path.join(repo, '.workkit', 'ship-items.log');
    const first = runCli(world, ['ship', 'items', '--nope'], { cwd: repo });
    expect(first.code, `the script's code, got: ${first.said}`).toBe(2);
    expect(readOr(log), 'a plain run is logged').toBe(`${ITEMS_REFUSAL}\nworkkit ship items: exit 2\n`);
    fs.rmSync(log);
    const inner = runCli(world, ['ship', 'items', '--nope'], { cwd: repo, env: { WK_COMMAND_LOGGED: path.join(world.root, 'outer-raw.log') } });
    expect(inner.code, `the script's code, got: ${inner.said}`).toBe(2);
    expect(inner.err, 'the script\'s line alone').toBe(`${ITEMS_REFUSAL}\n`);
    expect(fs.existsSync(log), 'and no second log').toBe(false);
  });

  test('a repo command outside a repo runs once, unlogged, with its own code', () => {
    const world = mkWorld();
    const away = mkTmp('wk-log-nogit-');
    const res = runCli(world, ['ship', 'items', '--nope'], { cwd: away });
    expect(res.code, `the script's code, got: ${res.said}`).toBe(2);
    expect(res.err, 'its line, once').toBe(`${ITEMS_REFUSAL}\n`);
    expect(logsUnder(away, world.workflowHome), 'no log anywhere').toEqual([]);
  });

  test('a log folder that cannot be made: one line, and the command still runs once with its own code', () => {
    const world = mkWorld();
    // logs.dir is out/logs, and out is a file: the folder cannot be made.
    const repo = logRepo({
      '.gitignore': 'out\n',
      '.workkit/settings.json': `${JSON.stringify({ enabled: true, logs: { dir: 'out/logs' } })}\n`,
      out: '',
    });
    const res = runCli(world, ['ship', 'items', '--nope'], { cwd: repo });
    expect(res.code, `the script's code, got: ${res.said}`).toBe(2);
    const [line, ...rest] = linesOf(res.err);
    const named = (line || '').match(/^workkit: could not write (.+), so ship items runs without its log$/);
    expect(named !== null, `the one line, got: ${res.err}`).toBe(true);
    expect(samePath(named[1], path.join(repo, 'out', 'logs', 'ship-items.log'), process.platform), `it names the log, got: ${named[1]}`).toBe(true);
    expect(rest, 'then the script\'s line, once').toEqual([ITEMS_REFUSAL]);
  });
});

describe('command-log.js: secretStep', () => {
  const SKIPPED = '· token mint: skipped; this command\'s output is not on a terminal\n';
  const NOTE = 'workkit: token mint ran on the terminal and is not in this log\n';

  /**
   * secretStep(kitOf({}), 'token mint', start) in a node of its own under <vars>:
   * start records the stdio it is handed, runs a program printing a secret line
   * on each, and answers 4; the node prints what secretStep answered.
   */
  const secretRun = (vars) => {
    const dir = mkTmp('wk-log-secret-');
    const mark = path.join(dir, 'start-calls');
    const secret = path.join(dir, 'secret.js');
    const driver = path.join(dir, 'driver.js');
    fs.writeFileSync(secret, "process.stdout.write('SECRET-out\\n');\nprocess.stderr.write('SECRET-err\\n');\n");
    fs.writeFileSync(driver, [
      "const fs = require('fs');",
      `const { secretStep } = require(${jsPath(COMMAND_LOG)});`,
      `const { kitOf } = require(${jsPath(path.join(WORKFLOW_DIR, 'workkit', 'kit.js'))});`,
      `const { spawnSync } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'run.js'))});`,
      'const start = (stdio) => {',
      `  fs.appendFileSync(${jsPath(mark)}, \`\${JSON.stringify(stdio)}\\n\`);`,
      `  const res = spawnSync(process.execPath, [${jsPath(secret)}], { stdio: ['ignore', stdio.stdout, stdio.stderr] });`,
      '  return res.status === 0 ? 4 : 99;',
      '};',
      "Promise.resolve(secretStep(kitOf({}), 'token mint', start))",
      '  .then((answer) => process.stdout.write(`answer: ${JSON.stringify(answer)}\\n`));',
    ].join('\n'));
    const res = run(process.execPath, [driver], { env: nodeHomeEnv(mkTmp('wk-log-secret-home-'), { PATH: SYSTEM_PATH, WORKKIT_COLOR: '0', ...vars }) });
    return { res, calls: () => linesOf(readOr(mark) || '').map((line) => JSON.parse(line)) };
  };

  const rawLog = () => {
    const raw = path.join(mkTmp('wk-log-raw-'), 'raw.log');
    fs.writeFileSync(raw, 'before\n');
    return raw;
  };

  test('under a logged command with a device: the program writes on the device, the log gains the note line and none of its output', () => {
    const raw = rawLog();
    const device = path.join(mkTmp('wk-log-tty-'), 'tty');
    fs.writeFileSync(device, '');
    const { res, calls } = secretRun({ WK_COMMAND_LOGGED: raw, WK_COMMAND_TERMINAL: device });
    expect(res.status, `the driver ends clean, got: ${res.output}`).toBe(0);
    expect(res.stdout, 'secretStep answers the program\'s code, and nothing of it reached stdout').toBe('answer: 4\n');
    expect(res.stderr, 'nor stderr').toBe('');
    expect(fs.readFileSync(raw, 'utf8'), 'the raw log: its own line, then the note').toBe(`before\n${NOTE}`);
    const shown = linesOf(fs.readFileSync(device, 'utf8'));
    expect([...shown].sort(), 'the device holds the program\'s stdout line and its stderr line').toEqual(['SECRET-err', 'SECRET-out']);
    const [stdio] = calls();
    expect(typeof stdio.stdout === 'number' && typeof stdio.stderr === 'number', `start got two descriptors, got: ${JSON.stringify(calls())}`).toBe(true);
  });

  // secretRun's env is nodeHomeEnv's alone, so WK_COMMAND_MARKS is unset here: nothing reads the marks.
  test('under a logged command with no WK_COMMAND_MARKS and no device, or one that does not open: the skip line, start never called, the log untouched', () => {
    const raw = rawLog();
    const closed = path.join(mkTmp('wk-log-tty-'), 'no-such-folder', 'tty');
    for (const vars of [{ WK_COMMAND_LOGGED: raw }, { WK_COMMAND_LOGGED: raw, WK_COMMAND_TERMINAL: closed }]) {
      const { res, calls } = secretRun(vars);
      const what = vars.WK_COMMAND_TERMINAL ? 'a device that does not open' : 'no device';
      expect(res.status, `${what}: the driver ends clean, got: ${res.output}`).toBe(0);
      expect(res.stdout, `${what}: the skip line, and secretStep answers null`).toBe(`${SKIPPED}answer: null\n`);
      expect(calls(), `${what}: start never called`).toEqual([]);
      expect(fs.readFileSync(raw, 'utf8'), `${what}: the raw log untouched`).toBe('before\n');
    }
  });

  test('in an unlogged command: start gets inherit twice and the program runs as any step', () => {
    const { res, calls } = secretRun({});
    expect(res.status, `the driver ends clean, got: ${res.output}`).toBe(0);
    expect(calls(), 'start got the inherited stdio').toEqual([{ stdout: 'inherit', stderr: 'inherit' }]);
    expect(res.stdout, 'the program\'s line, then the answer').toBe('SECRET-out\nanswer: 4\n');
    expect(res.stderr, 'the program\'s error line').toBe('SECRET-err\n');
  });
});

describe('command-log.js: a secret step\'s marks, with no device', () => {
  const BEGIN = '\u001b]workkit:secret:begin\u0007';
  const END = '\u001b]workkit:secret:end\u0007';

  /** A program at a scratch path running <lines> after `const fs = require('fs')`, every write fs.writeSync's, so the order is the program's. */
  const writeProgram = (lines) => {
    const file = path.join(mkTmp('wk-log-marks-'), 'program.js');
    fs.writeFileSync(file, ["const fs = require('fs');", ...lines].join('\n'));
    return { file };
  };

  // Pauses between writes, so a logger reading as the bytes come sees each part apart.
  const pacedWrites = (writes) => [
    `const writes = ${JSON.stringify(writes)};`,
    'const next = (i) => { if (i === writes.length) return; fs.writeSync(writes[i][0], writes[i][1]); setTimeout(() => next(i + 1), 50); };',
    'next(0);',
  ];

  test('secretStep under runLogged: its output reaches the caller as it comes, no mark byte does, and the log holds the note line and the lines around it alone', async () => {
    const world = mkWorld();
    const dir = mkTmp('wk-log-marks-');
    const go = path.join(dir, 'go');
    const seen = path.join(dir, 'marks-seen');
    const secret = path.join(dir, 'secret.js');
    fs.writeFileSync(secret, [
      "const fs = require('fs');",
      "fs.writeSync(1, 'SECRET-out\\n');",
      "fs.writeSync(2, 'SECRET-err\\n');",
      `const wait = () => (fs.existsSync(${jsPath(go)}) ? fs.writeSync(1, 'SECRET-late\\n') : setTimeout(wait, 20));`,
      'wait();',
    ].join('\n'));
    const program = writeProgram([
      `const { secretStep } = require(${jsPath(COMMAND_LOG)});`,
      `const { kitOf } = require(${jsPath(path.join(WORKFLOW_DIR, 'workkit', 'kit.js'))});`,
      `const { spawn } = require(${jsPath(path.join(WORKFLOW_DIR, 'lib', 'run.js'))});`,
      `fs.writeFileSync(${jsPath(seen)}, String(process.env.WK_COMMAND_MARKS));`,
      "fs.writeSync(1, 'before out\\n');",
      "fs.writeSync(2, 'before err\\n');",
      'const start = (stdio) => new Promise((resolve) => {',
      `  spawn(process.execPath, [${jsPath(secret)}], { stdio: ['ignore', stdio.stdout, stdio.stderr] }).on('close', (code) => resolve(code === 0 ? 4 : 99));`,
      '});',
      "Promise.resolve(secretStep(kitOf({}), 'token mint', start)).then((answer) => {",
      '  fs.writeSync(1, `after out ${answer}\\n`);',
      "  fs.writeSync(2, 'after err\\n');",
      '});',
    ]);
    const call = startInNode(world, logged(program, 'doctor', ['doctor']));
    try {
      const live = await until(() => call.stdout().includes('SECRET-out\n') && call.stderr().includes('SECRET-err\n'));
      expect(live, `the step's lines arrived while it held, got: ${JSON.stringify(call.output())}`).toBe(true);
      fs.writeFileSync(go, '');
      const end = await call.done;
      expect(end.status, `the program's code, got: ${call.output()}`).toBe(0);
    } finally {
      fs.writeFileSync(go, '');
      await call.end('SIGKILL');
    }
    expect(readOr(seen), 'the logger handed the program WK_COMMAND_MARKS=1').toBe('1');
    expect(call.stdout(), 'stdout: the lines around the step and the step\'s own, no mark').toBe('before out\nSECRET-out\nSECRET-late\nafter out 4\n');
    expect(call.stderr(), 'stderr: the same, no mark').toBe('before err\nSECRET-err\nafter err\n');
    const { body, closing } = logParts(readOr(machineLog(world, 'doctor.log')) || '');
    expect(closing, 'the closing line').toBe('workkit doctor: exit 0');
    expect(body.filter((line) => !line.startsWith('workkit: token mint')), 'the lines around the step').toEqual(['after err', 'after out 4', 'before err', 'before out']);
    expect(body.filter((line) => line.startsWith('workkit: token mint')).length, `one note line naming the step, got: ${JSON.stringify(body)}`).toBe(1);
    expect(body.some((line) => line.includes('SECRET')), 'and none of the step\'s output').toBe(false);
  });

  test('a mark written in two parts, with a pause between, is still read: nothing between the marks is logged, and no mark byte reaches the caller', () => {
    const world = mkWorld();
    const program = writeProgram(pacedWrites([
      [1, 'shown before\n'], [1, BEGIN.slice(0, 12)], [1, BEGIN.slice(12)], [1, 'hidden\n'],
      [1, END.slice(0, 15)], [1, END.slice(15)], [1, 'shown after\n'],
    ]));
    const res = inNode(world, logged(program, 'doctor', ['doctor']));
    expect(res.code, `exit 0, got: ${JSON.stringify(res.said)}`).toBe(0);
    expect(res.out, 'the bytes between the marks pass on, the marks do not').toBe('shown before\nhidden\nshown after\n');
    const { body, closing } = logParts(readOr(machineLog(world, 'doctor.log')) || '');
    expect(closing, 'the closing line').toBe('workkit doctor: exit 0');
    expect(body.includes('shown before') && body.includes('shown after'), `the lines around the pair are logged, got: ${JSON.stringify(body)}`).toBe(true);
    expect(body.some((line) => line.includes('hidden') || line.includes('workkit:secret')), `nothing of the pair is, got: ${JSON.stringify(body)}`).toBe(false);
  });

  test('a stream ending outside a pair on what began like a BEGIN mark: the held bytes reach the caller and the log as plain bytes', () => {
    const world = mkWorld();
    const tail = BEGIN.slice(0, 13);
    const program = writeProgram(pacedWrites([[1, 'plain\n'], [1, tail]]));
    const res = inNode(world, logged(program, 'doctor', ['doctor']));
    expect(res.code, `exit 0, got: ${JSON.stringify(res.said)}`).toBe(0);
    expect(res.out, 'the held bytes passed on at the end').toBe(`plain\n${tail}`);
    const log = readOr(machineLog(world, 'doctor.log')) || '';
    expect(log.startsWith(`plain\n${tail}`), `and logged after the plain line, got: ${JSON.stringify(log)}`).toBe(true);
  });

  test('a stream ending inside a pair on what began like an END mark: the held bytes reach the caller alone, never the log', () => {
    const world = mkWorld();
    const tail = END.slice(0, 19);
    const program = writeProgram(pacedWrites([[1, 'plain\n'], [1, BEGIN], [1, 'hidden\n'], [1, tail]]));
    const res = inNode(world, logged(program, 'doctor', ['doctor']));
    expect(res.code, `exit 0, got: ${JSON.stringify(res.said)}`).toBe(0);
    expect(res.out, 'the pair\'s bytes and the held tail passed on, the BEGIN mark not').toBe(`plain\nhidden\n${tail}`);
    const { body, closing } = logParts(readOr(machineLog(world, 'doctor.log')) || '');
    expect(closing, 'the closing line').toBe('workkit doctor: exit 0');
    expect(body.includes('plain'), `the plain line is logged, got: ${JSON.stringify(body)}`).toBe(true);
    expect(body.some((line) => line.includes('hidden') || line.includes('workkit:secret')), `nothing of the pair or its tail is, got: ${JSON.stringify(body)}`).toBe(false);
  });
});

describe('workkit ship cut, a terminal step', () => {
  const EXPECT = which('expect', SYSTEM_PATH);
  const NO_TERMINAL = !EXPECT && 'expect is not installed, so no command can be given a terminal here';
  const cutRepo = () => logRepo({ 'CHANGELOG.md': '# Changelog\n\n## [1.2.3] - 2026-11-01\n\n### Added\n\n- A thing.\n' });

  test('away from a terminal it is logged whole: the log holds the lines the call printed, then the closing line', () => {
    const world = mkWorld();
    const repo = cutRepo();
    const call = runCli(world, ['ship', 'cut', '1.2'], { cwd: repo });
    expect(call.code, `the script's usage code, got: ${call.said}`).toBe(2);
    const printed = [...linesOf(call.out), ...linesOf(call.err)].sort();
    expect(printed.length > 0, 'the script printed its usage').toBe(true);
    expect(logParts(readOr(path.join(repo, '.workkit', 'ship-cut.log')) || '')).toEqual({ body: printed, closing: 'workkit ship cut: exit 2' });
  });

  test('at a terminal it runs on the terminal, and its log holds the note line and the closing line', { skip: NO_TERMINAL }, () => {
    const world = mkWorld();
    const repo = cutRepo();
    const driver = path.join(mkTmp('wk-log-exp-'), 'drive.exp');
    fs.writeFileSync(driver, [
      `set timeout ${SPAWN_DEADLINE / 1000}`,
      `spawn {${process.execPath}} {${CLI}} ship cut 1.2`,
      'expect {',
      '  eof {}',
      '  timeout { exit 124 }',
      '}',
      'set result [wait]',
      'exit [lindex $result 3]',
    ].join('\n'));
    const res = spawnSync(EXPECT, [driver], { cwd: repo, env: world.env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the script's usage code, said: ${res.stdout}${res.stderr}`).toBe(2);
    expect(/usage/i.test(res.stdout), `the terminal showed the script's usage, said: ${res.stdout}`).toBe(true);
    expect(readOr(path.join(repo, '.workkit', 'ship-cut.log')), 'the note line and the closing line')
      .toBe('workkit: ship cut ran on the terminal and is not in this log\nworkkit ship cut: exit 2\n');
  });

  test('at a terminal the step\'s program gets the terminal and no WK_COMMAND_MARKS: nothing reads marks there', { skip: NO_TERMINAL }, () => {
    const world = mkWorld();
    const repo = cutRepo();
    const dir = mkTmp('wk-log-exp-');
    const seen = path.join(dir, 'seen.json');
    const program = path.join(dir, 'program.js');
    fs.writeFileSync(program, [
      "const fs = require('fs');",
      `fs.writeFileSync(${jsPath(seen)}, JSON.stringify({ marks: process.env.WK_COMMAND_MARKS ?? null, tty: Boolean(process.stdout.isTTY) }));`,
    ].join('\n'));
    const caller = path.join(dir, 'caller.js');
    fs.writeFileSync(caller, [
      `const { runLogged } = require(${jsPath(COMMAND_LOG)});`,
      `const { kitOf } = require(${jsPath(path.join(WORKFLOW_DIR, 'workkit', 'kit.js'))});`,
      `const { dispatch } = require(${jsPath(path.join(WORKFLOW_DIR, 'workkit', 'main.js'))});`,
      `Promise.resolve(runLogged(kitOf({ files: { entry: ${jsPath(program)} } }), 'ship cut', ['ship', 'cut'], dispatch)).then((code) => process.exit(code));`,
    ].join('\n'));
    const driver = path.join(dir, 'drive.exp');
    fs.writeFileSync(driver, [
      `set timeout ${SPAWN_DEADLINE / 1000}`,
      `spawn {${process.execPath}} {${caller}}`,
      'expect {',
      '  eof {}',
      '  timeout { exit 124 }',
      '}',
      'set result [wait]',
      'exit [lindex $result 3]',
    ].join('\n'));
    const res = spawnSync(EXPECT, [driver], { cwd: repo, env: world.env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `exit 0, said: ${res.stdout}${res.stderr}`).toBe(0);
    expect(JSON.parse(readOr(seen) || 'null'), 'the program ran on the terminal, with no marks variable').toEqual({ marks: null, tty: true });
    expect(readOr(path.join(repo, '.workkit', 'ship-cut.log')), 'the terminal road: the note line and the closing line')
      .toBe('workkit: ship cut ran on the terminal and is not in this log\nworkkit ship cut: exit 0\n');
  });
});
