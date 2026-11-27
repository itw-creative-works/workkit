// Tests for workflow/workkit.js's command logs: each command that does work writes
// one whole run to a file, plain text ending on `workkit <command>: exit <code>`,
// a machine command to ~/.workkit/logs/ and a repo command to the repo's log
// folder, while the terminal, the code and an answer on stdin stay the command's
// own; the quick commands write none, a secret step reaches the terminal alone,
// and a terminal step stays out of the log only at a terminal. The shared
// prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, mkTmp, seeded, until, run, start, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  NODE_DIR, SYSTEM_PATH, jsPath, joinPath, homeEnv, which, spawnSync,
} = require('../../lib/platform');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const { takeSnapshot } = require('../../lib/red-snapshot');
const { deviceFlowRoutes, hostsOf, startServer } = require('../../lib/identity');
const {
  CLI, mkWorld, runCli, mkRepo, mkSetupKit, mkKit, seedSettings, writeStub, signInEnv, SLUG, HOME,
} = require('./helpers');

/** A scratch machine whose machine folder is its home's `.workkit`, the `~/.workkit` the logs go under. */
const mkMachine = (opts) => {
  const world = mkWorld(opts);
  const workflowHome = path.join(world.home, '.workkit');
  return { ...world, workflowHome, env: { ...world.env, WORKFLOW_HOME: workflowHome } };
};

const machineLog = (world, name) => path.join(world.home, '.workkit', 'logs', name);

const EXPECT = which('expect', SYSTEM_PATH);
const NO_TERMINAL = !EXPECT && 'expect is not installed, so no command can be given a terminal here';

/**
 * `workkit <args>` through the entry at <script>, started by this node at an
 * `expect` terminal from <cwd> under <env>: the repo question answered yes, any
 * other yes/no question no. Its exit code, and on stdout all the terminal showed.
 */
const atTerminal = (world, script, args, cwd, env = world.env) => {
  const driver = path.join(mkTmp('command-logs-exp-'), 'drive.exp');
  fs.writeFileSync(driver, [
    `set timeout ${SPAWN_DEADLINE / 1000}`,
    `spawn {${process.execPath}} {${script}} ${args.join(' ')}`,
    'expect {',
    '  -re {to the issue workflow\\? \\[y/N\\] } { send "y\\r"; exp_continue }',
    '  -re {\\[[yYnN]/[yYnN]\\] $} { send "n\\r"; exp_continue }',
    '  eof {}',
    '  timeout { exit 124 }',
    '}',
    'set result [wait]',
    'exit [lindex $result 3]',
  ].join('\n'));
  return spawnSync(EXPECT, [driver], { cwd, env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
};

// A committed repo holding <files>, built once per shape.
const seedRepo = seeded((seed, files) => {
  const repo = path.join(seed, 'repo');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  const env = homeEnv(mkTmp('command-logs-git-home-'), { PATH: process.env.PATH });
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'],
    ['add', '-A'], ['commit', '-q', '-m', 'seed']]) {
    const res = run('git', args, { cwd: repo, env });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
});

/**
 * A scratch machine and a copy of the seeded repo holding <files>, which ignores
 * `.workkit/`, so the repo's log folder is its `.workkit/`; `repoEnv` puts node on PATH.
 */
const mkRepoWorld = (files) => {
  const world = mkMachine();
  const dir = mkTmp('command-logs-repo-');
  seedRepo(dir, { '.gitignore': 'node_modules/\n.workkit/*\n', ...files });
  const repo = path.join(dir, 'repo');
  const git = (...args) => run('git', args, { cwd: repo, env: world.env }).stdout;
  return {
    ...world, dir, repo, git, repoEnv: { PATH: joinPath(NODE_DIR, world.env.PATH) },
  };
};

const repoLog = (w, name) => path.join(w.repo, '.workkit', name);
const readOr = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const linesOf = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/**
 * <log> is the call's printed lines as a terminal leaves them, a CRLF's end
 * dropped, then <closing>: the same lines as the call, sorted, and one more.
 * A tee per stream writes the log, so how the two interleave goes unasserted.
 */
const holdsTheCall = (log, { out, err }, closing, what) => {
  expect(log !== null, `${what}: the log was written`).toBeTruthy();
  const lines = linesOf(log);
  expect(lines[lines.length - 1], `${what}: the log's last line, got: ${JSON.stringify(log)}`).toBe(closing);
  const printed = [...linesOf(out), ...linesOf(err)].map((line) => line.replace(/\r$/, '')).sort();
  expect(JSON.stringify(lines.slice(0, -1).sort()), `${what}: the log holds the lines the call printed and no other, log: ${JSON.stringify(log)}, call: ${JSON.stringify(out + err)}`)
    .toBe(JSON.stringify(printed));
};

const PKG = (name, version) => `${JSON.stringify({ name, version, private: false, files: ['dist'] })}\n`;
const shipPlan = (w, args = []) => runCli(w, ['ship', 'plan', ...args], { cwd: w.repo, env: w.repoEnv });

describe('workkit-cli: the machine commands log to ~/.workkit/logs/', () => {
  test('workkit doctor: doctor.log holds the lines the call printed, no escape byte, then workkit doctor: exit 0', () => {
    const world = mkMachine({ pluginInstalled: false, ghAuthed: false });
    const call = runCli(world, ['doctor']);
    expect(call.code, `a report is exit 0, got: ${call.said}`).toBe(0);
    expect(call.said.includes('gh auth login'), `the call prints its report, got: ${call.said}`).toBeTruthy();
    const log = readOr(machineLog(world, 'doctor.log'));
    expect(log !== null && !log.includes('\x1b'), `doctor.log is written, plain, got: ${JSON.stringify(log)}`).toBeTruthy();
    holdsTheCall(log, call, 'workkit doctor: exit 0', 'doctor');
  });

  test('workkit doctor with color forced on: the call\'s output holds color codes, doctor.log holds the same lines with none', () => {
    const world = mkMachine({ pluginInstalled: false, ghAuthed: false });
    // The voice's gate forced on: WORKKIT_COLOR in place of a terminal, and a TERM that takes color.
    const call = runCli(world, ['doctor'], { env: { WORKKIT_COLOR: '1', TERM: 'xterm' } });
    expect(call.said.includes('\x1b['), `the terminal gets its color, got: ${JSON.stringify(call.said)}`).toBeTruthy();
    const log = readOr(machineLog(world, 'doctor.log'));
    expect(log !== null && !log.includes('\x1b'), `doctor.log holds no escape byte, got: ${JSON.stringify(log)}`).toBeTruthy();
    holdsTheCall(log, { out: stripVTControlCharacters(call.out), err: stripVTControlCharacters(call.err) }, 'workkit doctor: exit 0', 'doctor in color');
  });

  test('workkit setup running its publish step: setup.log holds the publish lines and no publish.log is written', () => {
    const world = mkMachine();
    const { script } = mkSetupKit();
    seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const call = runCli(world, ['setup'], { script });
    expect(call.code, `exit 0, got: ${call.said}`).toBe(0);
    const log = readOr(machineLog(world, 'setup.log'));
    expect(log !== null, 'setup.log is written').toBeTruthy();
    const published = linesOf(log).filter((l) => /^\s*\S+ publish: /.test(l));
    expect(published.length > 0, `setup.log holds the publish step's lines, got: ${JSON.stringify(log)}`).toBeTruthy();
    expect(linesOf(log).pop(), 'and ends on setup\'s closing line').toBe('workkit setup: exit 0');
    expect(fs.existsSync(machineLog(world, 'publish.log')), 'the inner publish writes no log of its own').toBe(false);
  });
});

describe('workkit-cli: the repo commands log to the repo\'s log folder', () => {
  test('workkit ship plan: ship-plan.log holds the run; a plan that exits 1 exits 1 and its log ends exit 1', () => {
    const green = mkRepoWorld({ 'package.json': PKG('widget', '1.0.0') });
    const ok = shipPlan(green);
    expect(ok.code, `a plan is exit 0, got: ${ok.said}`).toBe(0);
    expect(ok.out.includes('publish widget 1.0.0 unscoped'), `the call prints the plan, got: ${ok.said}`).toBeTruthy();
    holdsTheCall(readOr(repoLog(green, 'ship-plan.log')), ok, 'workkit ship plan: exit 0', 'a plan');

    const red = mkRepoWorld({ 'package.json': PKG('widget', '1.0') });
    const refused = shipPlan(red);
    expect(refused.code, `the step's own code, got: ${refused.said}`).toBe(1);
    holdsTheCall(readOr(repoLog(red, 'ship-plan.log')), refused, 'workkit ship plan: exit 1', 'a refused plan');
  });

  test('workkit proof red: proof-red.log holds the command\'s lines and the verdict', () => {
    const testOf = (value) => `const x = require('../src/x');\nif (x !== ${value}) throw new Error('x is ' + x);\n`;
    const w = mkRepoWorld({ 'src/x.js': 'module.exports = 1;\n', 'tests/x.test.js': testOf(1) });
    takeSnapshot(w);
    fs.writeFileSync(path.join(w.repo, 'src', 'x.js'), 'module.exports = 2;\n');
    fs.writeFileSync(path.join(w.repo, 'tests', 'x.test.js'), testOf(2));
    const call = runCli(w, ['proof', 'red', 'src/x.js', '--', 'node', 'tests/x.test.js'], { cwd: w.repo, env: w.repoEnv });
    expect(call.code, `a red verdict is exit 0, got: ${call.said}`).toBe(0);
    const log = readOr(repoLog(w, 'proof-red.log'));
    holdsTheCall(log, call, 'workkit proof red: exit 0', 'proof red');
    expect(linesOf(log).some((l) => l.includes('x is 1')), `the command's own lines, got: ${JSON.stringify(log)}`).toBeTruthy();
    expect(linesOf(log).includes('red-proof: red'), `and the verdict, got: ${JSON.stringify(log)}`).toBeTruthy();
  });

  test('two workkit ship plan runs at once in one repo: ship-plan.log is one run\'s whole output', async () => {
    const w = mkRepoWorld({ 'package.json': PKG('widget', '1.0.0'), 'sub/package.json': PKG('gadget', '2.0.0') });
    // Loaded by every node of the runs, it holds the plan program alone until the
    // go file, so both runs are live together.
    const held = path.join(w.dir, 'held');
    const hold = path.join(w.dir, 'hold-plan.js');
    fs.mkdirSync(held);
    fs.writeFileSync(hold, [
      "const fs = require('fs');",
      "const path = require('path');",
      "if (path.basename(process.argv[1] || '') === 'plan.js') {",
      `  fs.writeFileSync(path.join(${jsPath(held)}, \`plan.\${process.pid}\`), '');`,
      '  const tick = new Int32Array(new SharedArrayBuffer(4));',
      `  while (!fs.existsSync(path.join(${jsPath(held)}, 'go'))) Atomics.wait(tick, 0, 0, 50);`,
      '}',
    ].join('\n'));
    const env = { ...w.env, ...w.repoEnv, NODE_OPTIONS: `--require ${JSON.stringify(hold.replace(/\\/g, '/'))}` };
    const calls = [[], ['--dir', 'sub']].map((args) => start(process.execPath, [CLI, 'ship', 'plan', ...args], { cwd: w.repo, env, input: '' }));
    const holding = () => fs.readdirSync(held).filter((n) => n.startsWith('plan.')).length;
    try {
      expect(await until(() => holding() >= 1), `no plan started; said: ${calls.map((c) => c.output()).join(' | ')}`).toBeTruthy();
      // A logger that runs them one at a time is still within the case: the second may not start yet.
      await until(() => holding() === 2, 5000);
      fs.writeFileSync(path.join(held, 'go'), '');
      const ends = await Promise.all(calls.map((c) => c.done));
      expect(ends.map((e) => e.status).join(), `both plans exit 0, said: ${calls.map((c) => c.output()).join(' | ')}`).toBe('0,0');
    } finally {
      fs.writeFileSync(path.join(held, 'go'), '');
      await Promise.all(calls.map((c) => c.end('SIGKILL')));
    }
    expect(calls[0].stdout().includes('widget') && calls[1].stdout().includes('gadget'), 'the two runs print different plans').toBeTruthy();
    const log = readOr(repoLog(w, 'ship-plan.log'));
    expect(log !== null, 'ship-plan.log is written').toBeTruthy();
    const body = JSON.stringify(linesOf(log).slice(0, -1).sort());
    const runs = calls.map((c) => JSON.stringify([...linesOf(c.stdout()), ...linesOf(c.stderr())].sort()));
    expect(runs.includes(body), `the log is one run's lines whole, got: ${JSON.stringify(log)}`).toBeTruthy();
    expect(linesOf(log).pop(), 'ending on one closing line').toBe('workkit ship plan: exit 0');
  });

  test('a second run of one command: the log is the second run\'s alone', () => {
    const w = mkRepoWorld({ 'package.json': PKG('widget', '1.0.0') });
    expect(shipPlan(w).code, 'the first run is exit 0').toBe(0);
    fs.writeFileSync(path.join(w.repo, 'package.json'), PKG('widget', '2.0.0'));
    const second = shipPlan(w);
    expect(second.out.includes('publish widget 2.0.0 unscoped'), `the second run prints its own plan, got: ${second.said}`).toBeTruthy();
    holdsTheCall(readOr(repoLog(w, 'ship-plan.log')), second, 'workkit ship plan: exit 0', 'the second run');
  });
});

describe('workkit-cli: what writes no log, and what a log leaves alone', () => {
  test('workkit help, workkit state and workkit note write no log file', () => {
    const w = mkRepoWorld({ '.workkit/settings.json': OPT_IN_SHAPES.current });
    const logs = () => [w.home, w.repo].flatMap((root) => fs.readdirSync(root, { recursive: true })
      .map(String).filter((p) => !p.startsWith('.git') && /\.log\b/.test(p)).map((p) => path.join(root, p)));
    const before = logs();
    for (const args of [['help'], ['state'], ['note', 'a', 'thing']]) {
      const call = runCli(w, args, { cwd: w.repo, env: w.repoEnv });
      expect(call.code, `workkit ${args[0]} is exit 0, got: ${call.said}`).toBe(0);
    }
    expect(JSON.stringify(logs().filter((p) => !before.includes(p))), 'no log file was written').toBe('[]');
  });

  test('workkit setup at a terminal: the question it asks gets the answer typed on stdin', { skip: NO_TERMINAL }, () => {
    const world = mkMachine();
    const { script } = mkSetupKit();
    const repo = mkRepo();
    const res = atTerminal(world, script, ['setup'], repo);
    expect(res.status, `setup at a terminal is exit 0, said: ${res.stdout}${res.stderr}`).toBe(0);
    const settings = readOr(path.join(repo, '.workkit', 'settings.json'));
    expect(settings !== null && JSON.parse(settings).enabled === true, `the yes typed at the question enabled the repo, said: ${res.stdout}`).toBeTruthy();
  });
});

describe('workkit-cli: a secret step runs outside the log', () => {
  // The stand-in for the secret.
  const SECRET = 'FAKEsecretMARKERvalue0123456789';

  test('workkit setup --token at a terminal: the terminal shows the minted secret, setup.log does not hold it', { skip: NO_TERMINAL }, () => {
    // A home repo whose Claude token is young, so the flag re-mints it; the mint draws the secret last.
    const world = mkMachine({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }] });
    seedSettings(world, { repo: HOME, publish: false, url: null });
    writeStub(path.join(world.bin, 'claude'), [
      'if [[ "$1" == \'setup-token\' ]]; then',
      '  printf \'%s\\n\' \'Paste the authorization code here:\'',
      `  printf '%s\\n' '${SECRET}'`,
      'fi',
      'exit 0',
    ]);
    const { script } = mkKit(SLUG);
    const res = atTerminal(world, script, ['setup', '--token'], world.root);
    const log = readOr(machineLog(world, 'setup.log'));
    expect(res.stdout.includes(SECRET), `the terminal shows the mint's screen, said: ${res.stdout}${res.stderr}`).toBeTruthy();
    expect(log !== null, 'setup.log is written').toBeTruthy();
    expect(log.includes(SECRET), `setup.log holds no part of the secret, got: ${JSON.stringify(log)}`).toBe(false);
  });

  // The device sign-in's stand-in GitHub, and the device-code requests it got.
  const signInServer = (world) => startServer(deviceFlowRoutes({ userCode: 'LOGX-0540', accessToken: 'ghu_fromlog', login: 'hubot' }), world.root);
  const deviceAsks = (server) => server.requests().filter((r) => r.method === 'POST' && r.url === '/login/device/code');

  test('workkit setup --login: the device sign-in\'s one-time code shows in the call\'s output and is not in setup.log', async () => {
    const world = mkMachine();
    const { script } = mkSetupKit();
    const repo = mkRepo({ optIn: true });
    const server = await signInServer(world);
    try {
      const call = runCli(world, ['setup', '--login'], { cwd: repo, script, env: signInEnv(world, { extra: hostsOf(server) }) });
      expect(call.code, `the sign-in finishes, exit 0, got: ${call.said}`).toBe(0);
      expect(call.said.includes('LOGX-0540'), `the call shows the code, got: ${call.said}`).toBeTruthy();
      expect(deviceAsks(server).length, `the device flow ran, got: ${JSON.stringify(server.requests())}`).toBe(1);
      expect(call.said.includes('\x1b]workkit:secret:'), `no mark byte reaches the call's output, got: ${JSON.stringify(call.said)}`).toBe(false);
      const log = readOr(machineLog(world, 'setup.log'));
      expect(log !== null, 'setup.log is written').toBeTruthy();
      expect(log.includes('LOGX-0540'), `setup.log holds no part of the code, got: ${JSON.stringify(log)}`).toBe(false);
      expect(linesOf(log).some((l) => /^workkit: .*sign-in.* not in this log$/.test(l)), `setup.log holds the note line, got: ${JSON.stringify(log)}`).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  test('workkit setup --login at a terminal: the device sign-in\'s one-time code shows on the terminal and is not in setup.log', { skip: NO_TERMINAL }, async () => {
    const world = mkMachine();
    const { script } = mkSetupKit();
    const repo = mkRepo({ optIn: true });
    const server = await signInServer(world);
    try {
      const res = atTerminal(world, script, ['setup', '--login'], repo, { ...world.env, ...signInEnv(world, { extra: hostsOf(server) }) });
      expect(res.status, `the sign-in finishes, exit 0, said: ${res.stdout}${res.stderr}`).toBe(0);
      expect(res.stdout.includes('LOGX-0540'), `the terminal shows the code, said: ${res.stdout}`).toBeTruthy();
      const log = readOr(machineLog(world, 'setup.log'));
      expect(log !== null, 'setup.log is written').toBeTruthy();
      expect(log.includes('LOGX-0540'), `setup.log holds no part of the code, got: ${JSON.stringify(log)}`).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('workkit-cli: a terminal step runs outside the log only at a terminal', () => {
  // A deploy script that says whether its stdout is a terminal, in Node so every platform's npm runs it alike.
  const DEPLOYS = {
    '.workkit/settings.json': `${JSON.stringify({ enabled: true })}\n`,
    'tty.js': "console.log(process.stdout.isTTY ? 'stdout-is: tty' : 'stdout-is: pipe');\n",
    'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { deploy: 'node tty.js' } })}\n`,
  };
  const deployWorld = () => {
    const w = mkRepoWorld(DEPLOYS);
    const npmrc = path.join(w.dir, 'npmrc');
    // npm's own wait frame, drawn on a terminal under load, would land in front of the script's line.
    fs.writeFileSync(npmrc, 'progress=false\n');
    return { ...w, deployEnv: { ...w.env, ...w.repoEnv, NPM_CONFIG_USERCONFIG: npmrc } };
  };

  test('workkit ship deploy at a terminal: the script sees a terminal, its line is on the terminal and not in ship-deploy.log', { skip: NO_TERMINAL }, () => {
    const w = deployWorld();
    const res = atTerminal(w, CLI, ['ship', 'deploy'], w.repo, w.deployEnv);
    expect(res.status, `exit 0, said: ${res.stdout}${res.stderr}`).toBe(0);
    // Whole lines only, so no line npm echoes around the script can stand in for its answer.
    const shown = res.stdout.split('\n').map((l) => l.replace(/\r$/, ''));
    expect(shown.includes('stdout-is: tty'), `the deploy script ran on the terminal, said: ${res.stdout}`).toBeTruthy();
    const log = readOr(repoLog(w, 'ship-deploy.log'));
    expect(log !== null, 'ship-deploy.log is written').toBeTruthy();
    expect(linesOf(log).filter((l) => /^stdout-is: /.test(l)).join(), `ship-deploy.log holds none of the script's output, got: ${JSON.stringify(log)}`).toBe('');
    expect(linesOf(log).pop(), 'and ends on the closing line').toBe('workkit ship deploy: exit 0');
  });

  test('workkit ship deploy on a pipe: the script sees a pipe, and the output and ship-deploy.log both hold its line', () => {
    const w = deployWorld();
    const call = runCli(w, ['ship', 'deploy'], { cwd: w.repo, env: w.deployEnv });
    expect(call.code, `exit 0, got: ${call.said}`).toBe(0);
    expect(call.out.split('\n').includes('stdout-is: pipe'), `the output holds the script's line, got: ${call.said}`).toBeTruthy();
    const log = readOr(repoLog(w, 'ship-deploy.log'));
    expect(linesOf(log || '').includes('stdout-is: pipe'), `and so does ship-deploy.log, got: ${JSON.stringify(log)}`).toBeTruthy();
  });
});
