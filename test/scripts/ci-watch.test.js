// Tests for workflow/ship/watch.js (`workkit ship watch`), started under the suite's
// own node: the ship's CI watch, a sha in and one answer out as an exit code, so every
// case asserts the code and the line together. `gh` is a stub answering from fixture
// files the case writes, and the retries are env overrides set to two tries with no wait.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, alive, until, pidIn, start, endTree, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, shellPath, gitPath, homeEnv, stubToolJs, systemPathWith, spawnSync: startSync,
} = require('../lib/platform');
const { recordArgvJs, readArgv, isCall, eqArgv, fmtCalls } = require('../lib/argv-log');
const { ciLockPath, suiteLogPath } = require('../lib/suite-record');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ship', 'watch.js');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const LIST_ARGV = ['run', 'list', '--commit', SHA, '--json', 'databaseId,name,status,conclusion,url'];

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const runRow = (id, name) => ({
  databaseId: id, name, status: 'in_progress', conclusion: '', url: `https://github.com/o/r/actions/runs/${id}`,
});

/**
 * A scratch world: a git repo (`workflows` a map of file name to body under its
 * `.github/workflows/`) and a `gh` stub answering from fixtures. `runs` is the list `gh run list` answers once it answers anything, after
 * `empty` empty answers; `red` the run ids whose watch exits 1; `views` and
 * `logs` a run id's `--json conclusion,jobs` answer and `--log-failed` text;
 * `down` the run ids whose watch AND view fail the way an unreachable GitHub
 * does; `listFails` a `gh run list` that fails, and `listRaw` one that answers
 * that text instead of a list. `prs` is what `gh pr list` answers, `prFails` one that fails,
 * `prRaw` one that answers that text instead. `watchSleep` seconds hang every `gh run watch`
 * before it answers, and each watch writes its pid to `watch-<id>.pid` first. The repo
 * gitignores `.workkit/*`, so the watch log is `.workkit/ci.log`.
 */
const makeWorld = ({
  runs = [], empty = 0, red = [], views = {}, logs = {}, down = [], listFails = false, listRaw = null, workflows = null,
  watchSleep = null, prs = [], prFails = false, prRaw = null,
} = {}) => {
  const dir = mkTmp('ci-watch-');
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const fx = path.join(dir, 'fixtures');
  const logFile = path.join(dir, 'gh-argv.log');
  for (const d of [path.join(repo, 'sub'), bin, fx, path.join(dir, 'home'), path.join(dir, 'tmp')]) fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, '.gitignore'), '.workkit/*\n');
  if (workflows) {
    const wf = path.join(repo, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    for (const [file, body] of Object.entries(workflows)) fs.writeFileSync(path.join(wf, file), body);
  }

  fs.writeFileSync(path.join(fx, 'list.json'), listRaw === null ? JSON.stringify(runs) : listRaw);
  fs.writeFileSync(path.join(fx, 'list.empty'), String(empty));
  if (listFails) fs.writeFileSync(path.join(fx, 'list.fail'), '');
  fs.writeFileSync(path.join(fx, 'pr.json'), prRaw === null ? JSON.stringify(prs) : prRaw);
  if (prFails) fs.writeFileSync(path.join(fx, 'pr.fail'), '');
  if (watchSleep !== null) fs.writeFileSync(path.join(fx, 'watch-sleep'), String(watchSleep));
  for (const r of runs) {
    fs.writeFileSync(path.join(fx, `watch-${r.databaseId}.exit`), red.includes(r.databaseId) || down.includes(r.databaseId) ? '1' : '0');
  }
  for (const [id, body] of Object.entries(views)) fs.writeFileSync(path.join(fx, `view-${id}.json`), JSON.stringify(body));
  for (const id of down) fs.writeFileSync(path.join(fx, `down-${id}`), '');
  for (const [id, body] of Object.entries(logs)) fs.writeFileSync(path.join(fx, `log-${id}.txt`), body);

  stubToolJs(bin, 'gh', [
    recordArgvJs(JSON.stringify(logFile)),
    "const fs = require('fs');",
    "const path = require('path');",
    `const F = ${JSON.stringify(fx)};`,
    'const argv = process.argv.slice(2);',
    'const at = (name) => path.join(F, name);',
    // A fixture printed as `cat` prints it: a missing one is cat's line and exit 1.
    'const cat = (name) => {',
    '  if (fs.existsSync(at(name))) return process.stdout.write(fs.readFileSync(at(name)));',
    '  process.stderr.write(`cat: ${at(name)}: No such file or directory\\n`);',
    '  process.exitCode = 1;',
    '};',
    // Both drain stdin first, the way any child that reads it would: a script
    // that hands them its own stdin loses whatever it was reading there.
    'const drain = () => fs.readFileSync(0);',
    "const command = `${argv[0] ?? ''} ${argv[1] ?? ''}`;",
    // A failure's line is written and the code set, never process.exit: a pipe's write may still be queued.
    'const fail = (line) => { process.stderr.write(line); process.exitCode = 1; };',
    'const counted = () => {',
    "  const n = (fs.existsSync(at('list.count')) ? Number(fs.readFileSync(at('list.count'), 'utf8')) : 0) + 1;",
    "  fs.writeFileSync(at('list.count'), String(n));",
    '  return n;',
    '};',
    "if (command === 'run list') {",
    "  if (fs.existsSync(at('list.fail'))) fail('HTTP 401: Bad credentials\\n');",
    "  else if (counted() <= Number(fs.readFileSync(at('list.empty'), 'utf8'))) process.stdout.write('[]\\n');",
    "  else cat('list.json');",
    "} else if (command === 'run watch') {",
    '  drain();',
    '  fs.writeFileSync(at(`watch-${argv[2]}.pid`), String(process.pid));',
    "  if (fs.existsSync(at('watch-sleep'))) {",
    "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(fs.readFileSync(at('watch-sleep'), 'utf8')) * 1000);",
    '  }',
    '  process.stdout.write(`watching ${argv[2]}\\n`);',
    "  if (fs.existsSync(at(`down-${argv[2]}`))) process.stderr.write('error connecting to api.github.com\\n');",
    "  process.exitCode = Number(fs.readFileSync(at(`watch-${argv[2]}.exit`), 'utf8'));",
    "} else if (command === 'pr list') {",
    "  if (fs.existsSync(at('pr.fail'))) fail('HTTP 403: Resource not accessible by integration\\nsecond line\\n');",
    "  else cat('pr.json');",
    "} else if (command === 'run view') {",
    '  drain();',
    "  if (fs.existsSync(at(`down-${argv[2]}`))) fail('error connecting to api.github.com\\n');",
    "  else cat(argv.includes('--log-failed') ? `log-${argv[2]}.txt` : `view-${argv[2]}.json`);",
    '} else {',
    "  process.stderr.write(`gh stub: unexpected ${argv.join(' ')}\\n`);",
    '  process.exitCode = 9;',
    '}',
  ].join('\n'));

  return {
    dir, repo, sub: path.join(repo, 'sub'), bin, fx, home: path.join(dir, 'home'), tmp: path.join(dir, 'tmp'),
    ciLog: path.join(repo, '.workkit', 'ci.log'),
    calls: () => readArgv(logFile),
  };
};

// The suite's node on PATH, as a shell that runs workkit has one; HOME and TMPDIR
// are the world's, so the watch lock never lands on the machine.
const watchEnv = (w, env = {}) => homeEnv(w.home, {
  PATH: systemPathWith(w.bin, NODE_DIR),
  TMPDIR: shellPath(w.tmp),
  WORKKIT_CI_WATCH_TRIES: '2',
  WORKKIT_CI_WATCH_WAIT: '0',
  ...env,
});

const runWatch = (w, args, { cwd = w.repo, env = {} } = {}) => {
  const res = startSync(process.execPath, [SCRIPT, ...args], {
    cwd, env: watchEnv(w, env), encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The same run, started without waiting as the harness `start()` handle: a case
// that signals it or races it. `result()` resolves once it exits (null when the
// spawn deadline ended it), with what it printed; `cmd` and `argv` start it another
// way; `detached` makes it a process group leader, so a case can end the group.
const startWatch = (w, args = [SHA], { cmd = process.execPath, argv = [SCRIPT, ...args], detached = false } = {}) => {
  const handle = start(cmd, argv, { cwd: w.repo, env: watchEnv(w), detached });
  const result = () => handle.done.then(({ status, signal, timedOut }) => (timedOut
    ? null
    : { code: status, signal, out: handle.stdout(), err: handle.stderr() }));
  return { ...handle, result };
};

// The body's answer as the terminal shows it: stdout must open with the
// watching line and end with the exit line naming the run's own code, and what
// comes between, from either stream, is the answer. `sha` is the one watched.
const answered = ({ code, out, err }, sha = SHA) => {
  const firstLine = `ci-watch: watching ${sha}\n`;
  const exitLine = `ci-watch: exit ${code}\n`;
  expect(out.startsWith(firstLine), `stdout opens with ${JSON.stringify(firstLine)}, got: ${JSON.stringify(out)} (stderr: ${err})`).toBeTruthy();
  expect(out.endsWith(exitLine), `stdout ends with ${JSON.stringify(exitLine)}, got: ${JSON.stringify(out)} (stderr: ${err})`).toBeTruthy();
  return out.slice(firstLine.length, -exitLine.length) + err;
};

const readLog = (w) => (fs.existsSync(w.ciLog) ? fs.readFileSync(w.ciLog, 'utf8') : null);

// Git in the world's repo, under the world's HOME so no machine git config reaches it.
const gitIn = (w, ...args) => spawnSync('git', ['-C', w.repo, ...args], { encoding: 'utf8', env: homeEnv(w.home, { PATH: process.env.PATH }) });

// One commit of an empty file in the world's repo; answers the commit's full id.
const commitOne = (w) => {
  const git = (...args) => gitIn(w, ...args);
  git('config', 'user.name', 'wk');
  git('config', 'user.email', 'wk@localhost');
  fs.writeFileSync(path.join(w.repo, 'empty'), '');
  git('add', 'empty');
  git('commit', '-q', '-m', 'chore: seed');
  const full = git('rev-parse', 'HEAD').stdout.trim();
  expect(/^[0-9a-f]{40}$/.test(full), `the world's repo holds a commit, got: ${JSON.stringify(full)}`).toBeTruthy();
  return full;
};

const listCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'list'));
const watchCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'watch'));
const prCalls = (w) => w.calls().filter((c) => isCall(c, 'pr', 'list'));

const PR_BRANCH = 'claude/session-1';
const OPEN_PR = { number: 7, url: 'https://github.com/o/r/pull/7' };
const PR_ONLY = { 'checks.yml': 'name: Checks\non:\n  pull_request:\njobs: {}\n' };
const PUSH_TOO = { 'checks.yml': 'name: Checks\non:\n  pull_request:\n  push:\n    branches: [main]\njobs: {}\n' };

// The world's repo with one commit, checked out on PR_BRANCH: the sha a ship
// just pushed to a session branch. Answers the commit's full id.
const onPrBranch = (w) => {
  const full = commitOne(w);
  const r = gitIn(w, 'checkout', '-q', '-b', PR_BRANCH);
  expect(r.status, `the branch is made: ${r.stderr}`).toBe(0);
  return full;
};

describe('ship watch: green', () => {
  test('one green run prints one line naming the workflow and the URL, exit 0', async () => {
    const w = makeWorld({ runs: [runRow(11, 'Checks')] });
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 0 (stderr: ${r.err})`).toBe(0);
    expect(answered(r), 'the one line, and nothing of the watch').toBe('ci-watch: green: Checks https://github.com/o/r/actions/runs/11\n');
    const watched = watchCalls(w);
    expect(watched.length, 'one watch').toBe(1);
    expect(eqArgv(watched[0], ['run', 'watch', '11', '--exit-status']), `the watch argv: ${fmtCalls(watched)}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('two green runs are both watched, in order, one line each', async () => {
    const w = makeWorld({ runs: [runRow(21, 'Checks'), runRow(22, 'CHANGELOG')] });
    const r = runWatch(w, [SHA]);
    expect(r.code, 'exit 0').toBe(0);
    expect(answered(r), 'one line per run').toBe([
      'ci-watch: green: Checks https://github.com/o/r/actions/runs/21',
      'ci-watch: green: CHANGELOG https://github.com/o/r/actions/runs/22',
      '',
    ].join('\n'));
    expect(watchCalls(w).map((c) => c[2]).join(','), 'both watched in list order').toBe('21,22');
    cleanup(w.dir);
  });
});

describe('ship watch: red', () => {
  test('a red run names the workflow, the failing job and the URL, prints the log tail, exit 1', async () => {
    const tail = Array.from({ length: 50 }, (_, i) => `log line ${i + 1}`).join('\n');
    const w = makeWorld({
      runs: [runRow(31, 'Checks'), runRow(32, 'CHANGELOG')],
      red: [32],
      views: { 32: { conclusion: 'failure', jobs: [{ name: 'lint', conclusion: 'success' }, { name: 'changelog', conclusion: 'failure' }, { name: 'late', conclusion: 'failure' }] } },
      logs: { 32: `${tail}\n` },
    });
    const r = runWatch(w, [SHA]);
    expect(r.code, 'exit 1').toBe(1);
    const shown = answered(r);
    const lines = shown.split('\n');
    expect(lines[0], 'the green run still reports').toBe('ci-watch: green: Checks https://github.com/o/r/actions/runs/31');
    expect(lines[1], `the RED line, got: ${shown}`).toBe('ci-watch: RED: CHANGELOG, job changelog: https://github.com/o/r/actions/runs/32');
    expect(lines[2], 'the tail starts 40 lines from the end').toBe('log line 11');
    expect(shown.includes('log line 50'), 'and runs to the last line').toBeTruthy();
    expect(!/log line 10\n/.test(shown), 'nothing before the last 40 lines').toBeTruthy();
    cleanup(w.dir);
  });

  test('a red run with no failed job names the job unknown, exit 1', async () => {
    const w = makeWorld({
      runs: [runRow(33, 'Checks')],
      red: [33],
      views: { 33: { conclusion: 'cancelled', jobs: [{ name: 'test', conclusion: 'success' }] } },
      logs: { 33: '' },
    });
    const r = runWatch(w, [SHA]);
    expect(r.code, 'exit 1').toBe(1);
    const shown = answered(r);
    expect(shown.split('\n')[0], `the RED line, got: ${shown}`).toBe('ci-watch: RED: Checks, job unknown: https://github.com/o/r/actions/runs/33');
    const views = w.calls().filter((c) => isCall(c, 'run', 'view') && !c.includes('--log-failed'));
    expect(views.length, `one view answers the conclusion and the job: ${fmtCalls(views)}`).toBe(1);
    expect(eqArgv(views[0], ['run', 'view', '33', '--json', 'conclusion,jobs']), `the view argv: ${fmtCalls(views)}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('a watch that failed for want of GitHub is a gh failure, exit 4, never red', async () => {
    const w = makeWorld({ runs: [runRow(34, 'Checks')], down: [34] });
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 4 (stderr: ${r.err})`).toBe(4);
    expect(answered(r), 'the one gh line').toBe('ci-watch: gh run watch 34 failed: error connecting to api.github.com\n');
    cleanup(w.dir);
  });

  test('a watch that ended before its run did is a gh failure, exit 4', async () => {
    const w = makeWorld({ runs: [runRow(35, 'Checks')], red: [35], views: { 35: { conclusion: '', jobs: [] } } });
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 4 (stderr: ${r.err})`).toBe(4);
    const shown = answered(r);
    expect(shown.startsWith('ci-watch: gh run watch 35 failed'), `the gh line, got: ${shown}`).toBeTruthy();
    cleanup(w.dir);
  });
});

describe('ship watch: finding the run', () => {
  test('a list that is empty first is asked again, and the run it then finds is watched', async () => {
    const w = makeWorld({ runs: [runRow(41, 'Checks')], empty: 1 });
    const { code, out } = runWatch(w, [SHA]);
    expect(code, 'exit 0').toBe(0);
    expect(out.includes('ci-watch: green: Checks'), `green, got: ${out}`).toBeTruthy();
    const lists = listCalls(w);
    expect(lists.length, `two list calls: ${fmtCalls(lists)}`).toBe(2);
    expect(lists.every((c) => eqArgv(c, LIST_ARGV)), `the list argv: ${fmtCalls(lists)}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('a run that never shows up is asked for exactly the retry count', async () => {
    const w = makeWorld({ empty: 99 });
    runWatch(w, [SHA], { env: { WORKKIT_CI_WATCH_TRIES: '3' } });
    expect(listCalls(w).length, 'three tries reach the stub').toBe(3);
    expect(watchCalls(w).length, 'nothing watched').toBe(0);
    cleanup(w.dir);
  });

  test('a retry count that is no whole number of 1 or more is the default six tries', () => {
    for (const tries of ['abc', '0', '2.5']) {
      const w = makeWorld({ empty: 99 });
      runWatch(w, [SHA], { env: { WORKKIT_CI_WATCH_TRIES: tries } });
      expect(listCalls(w).length, `${JSON.stringify(tries)}: six tries reach the stub`).toBe(6);
      cleanup(w.dir);
    }
  });

  test('a wait that is no number of 0 or more is the default ten seconds: no second ask comes at once', async (t) => {
    const w = makeWorld({ empty: 99 });
    const watch = start(process.execPath, [SCRIPT, SHA], { cwd: w.repo, env: watchEnv(w, { WORKKIT_CI_WATCH_WAIT: 'abc' }) });
    const pidFile = path.join(ciLockPath(path.join(w.home, '.workkit'), w.repo), 'pid');
    t.after(async () => {
      // The body runs detached, its supervisor's pid in the lock: its group ends before the world goes.
      await watch.end('SIGKILL');
      const supervisor = pidIn(pidFile);
      if (supervisor > 0) endTree(supervisor, 'SIGKILL');
      expect(await until(() => !alive(supervisor)), `the watch's body (pid ${supervisor}) outlived the case`).toBeTruthy();
      cleanup(w.dir);
    });
    expect(await until(() => listCalls(w).length >= 1 && pidIn(pidFile) > 0), `the first ask reached the stub, the body's pid in the lock: ${watch.output()}`).toBeTruthy();
    expect(await until(() => listCalls(w).length >= 2, 500), `the second ask waits out the default: ${fmtCalls(listCalls(w))}`).toBe(false);
  });
});

describe('ship watch: a short sha', () => {
  test('a seven-character sha of a commit the repo holds is watched as the full sha, in the list and the log', async () => {
    const w = makeWorld({ runs: [runRow(91, 'Checks')] });
    const full = commitOne(w);
    const r = runWatch(w, [full.slice(0, 7)]);
    expect(r.code, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`).toBe(0);
    const lists = listCalls(w);
    expect(lists.length >= 1, `gh run list was asked: ${fmtCalls(w.calls())}`).toBeTruthy();
    const fullArgv = ['run', 'list', '--commit', full, '--json', 'databaseId,name,status,conclusion,url'];
    expect(lists.every((c) => eqArgv(c, fullArgv)), `every list asks for the full sha ${full}: ${fmtCalls(lists)}`).toBeTruthy();
    expect((readLog(w) || '').split('\n')[0], 'the log opens naming the full sha').toBe(`ci-watch: watching ${full}`);
    cleanup(w.dir);
  });

  test('a short sha this clone does not know is exit 2, the fetch line on stderr, no gh call', async () => {
    const w = makeWorld({ runs: [runRow(92, 'Checks')] });
    const full = commitOne(w);
    // Seven hex characters that cannot open the one commit's id.
    const unknown = `${full[0] === 'a' ? 'b' : 'a'}${full.slice(1, 7)}`;
    const r = runWatch(w, [unknown]);
    expect(r.code, `exit 2 (stdout: ${r.out}, stderr: ${r.err})`).toBe(2);
    expect(r.err, 'the one line on stderr').toBe(`ci-watch: ${unknown} is not a commit this clone knows; fetch it or pass the full sha\n`);
    expect(w.calls().length, `gh never asked: ${fmtCalls(w.calls())}`).toBe(0);
    cleanup(w.dir);
  });
});

describe('ship watch: no run', () => {
  const DISPATCH = 'name: Manual\non:\n  workflow_dispatch:\njobs:\n  x:\n    runs-on: ubuntu-latest\n';
  const PR_BRANCH_PUSH = 'name: PR\non:\n  pull_request:\n    branches:\n      - push\njobs: {}\n';
  const noCi = [
    ['no workflows folder', null],
    ['a workflow with only workflow_dispatch', { 'manual.yml': DISPATCH }],
    ['a pull_request trigger whose branch is called push', { 'pr.yaml': PR_BRANCH_PUSH }],
    ['a push named only in a comment after the on: key', { 'ci.yml': 'name: CI\non: pull_request # push comes later\njobs: {}\n' }],
  ];
  for (const [label, workflows] of noCi) {
    test(`${label}: no CI configured for push, exit 0`, async () => {
      const w = makeWorld({ empty: 99, workflows });
      const r = runWatch(w, [SHA]);
      expect(r.code, `exit 0 (stderr: ${r.err})`).toBe(0);
      expect(answered(r), 'the one quiet line').toBe('ci-watch: no CI configured for push\n');
      cleanup(w.dir);
    });
  }

  test('a folder named like a workflow, which cannot be read: no trigger, no CI configured for push, exit 0', async () => {
    const w = makeWorld({ empty: 99, workflows: {} });
    fs.mkdirSync(path.join(w.repo, '.github', 'workflows', 'ci.yml'));
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 0 (stderr: ${r.err})`).toBe(0);
    expect(answered(r), 'the one quiet line').toBe('ci-watch: no CI configured for push\n');
    cleanup(w.dir);
  });

  const pushForms = [
    ['the block form', { 'checks.yml': 'name: Checks\non:\n  pull_request:\n  push:\n    branches: [main]\njobs: {}\n' }],
    ['`on: push` in a .yaml', { 'ci.yaml': 'name: CI\non: push\njobs: {}\n' }],
    ['`on: [pull_request, push]`', { 'ci.yml': 'name: CI\non: [pull_request, push]\njobs: {}\n' }],
    ['the list form beside a dispatch-only file', { 'a.yml': DISPATCH, 'b.yml': 'on:\n  - push\n' }],
    ["a CRLF file with a quoted 'on': key", { 'crlf.yml': "name: CI\r\n'on':\r\n  push:\r\n    branches: [main]\r\njobs: {}\r\n" }],
    ['a block whose first lines are a comment and a blank', { 'ci.yml': 'name: CI\non:\n# the triggers\n\n      # one deeper\n  push:\njobs: {}\n' }],
  ];
  for (const [label, workflows] of pushForms) {
    test(`a push trigger in ${label}: run not queued yet, exit 3`, async () => {
      const w = makeWorld({ empty: 99, workflows });
      // From a subdirectory, since the workflows are the repo's, not the cwd's.
      const r = runWatch(w, [SHA], { cwd: w.sub });
      expect(r.code, `exit 3 (stdout: ${r.out})`).toBe(3);
      expect(answered(r), 'the line names the sha').toBe(`ci-watch: run not queued yet for ${SHA}\n`);
      cleanup(w.dir);
    });
  }
});

describe('ship watch: a branch with an open PR', () => {
  test('an open PR for the branch whose tip is the sha: the waiting line, the list asked again, and the run it finds watched', async () => {
    // Two tries come back empty, so only the second round can find the run.
    const w = makeWorld({ runs: [runRow(61, 'Checks')], empty: 2, prs: [OPEN_PR], workflows: PR_ONLY });
    const full = onPrBranch(w);
    const r = runWatch(w, [full]);
    expect(r.code, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`).toBe(0);
    expect(answered(r, full), 'the waiting line, then the run watched as any other').toBe([
      `ci-watch: waiting for PR #7's run for ${full}`,
      'ci-watch: green: Checks https://github.com/o/r/actions/runs/61',
      '',
    ].join('\n'));
    const prs = prCalls(w);
    expect(prs.length, `one PR lookup: ${fmtCalls(prs)}`).toBe(1);
    expect(eqArgv(prs[0], ['pr', 'list', '--head', PR_BRANCH, '--state', 'open', '--json', 'number,url', '--limit', '1']), `the lookup argv: ${fmtCalls(prs)}`).toBeTruthy();
    expect(listCalls(w).length, `the list asked past the first round's two tries: ${fmtCalls(listCalls(w))}`).toBe(3);
    cleanup(w.dir);
  });

  test('an open PR whose run never comes: one more round of tries, then exit 3 naming the PR', async () => {
    const w = makeWorld({ empty: 99, prs: [OPEN_PR], workflows: PR_ONLY });
    const full = onPrBranch(w);
    const r = runWatch(w, [full]);
    expect(r.code, `exit 3 (stdout: ${r.out}, stderr: ${r.err})`).toBe(3);
    expect(answered(r, full), 'the waiting line, then the not-queued line naming the PR').toBe([
      `ci-watch: waiting for PR #7's run for ${full}`,
      `ci-watch: run not queued yet for ${full} (PR #7)`,
      '',
    ].join('\n'));
    expect(listCalls(w).length, `two rounds of two tries: ${fmtCalls(listCalls(w))}`).toBe(4);
    expect(watchCalls(w).length, 'nothing watched').toBe(0);
    cleanup(w.dir);
  });

  test('a short sha of the branch tip is compared in full: the PR is still waited on', async () => {
    const w = makeWorld({ empty: 99, prs: [OPEN_PR], workflows: PR_ONLY });
    const full = onPrBranch(w);
    const r = runWatch(w, [full.slice(0, 7)]);
    expect(r.code, `exit 3 (stdout: ${r.out}, stderr: ${r.err})`).toBe(3);
    expect(prCalls(w).length, `the PR looked up: ${fmtCalls(w.calls())}`).toBe(1);
    expect(`${r.out}${r.err}`.includes(`ci-watch: run not queued yet for ${full} (PR #7)`), `the PR's not-queued line, got: ${r.out} ${r.err}`).toBeTruthy();
    cleanup(w.dir);
  });

  // Each world holds an open PR the lookup would find, save the first, so a
  // lookup run where it must not shows as the waiting line.
  const offPrPath = [
    ['no open PR for the branch', { prs: [] }, (w) => onPrBranch(w), 1],
    ['a detached HEAD at the sha', { prs: [OPEN_PR] }, (w) => {
      const full = onPrBranch(w);
      expect(gitIn(w, 'checkout', '-q', '--detach').status, 'HEAD detached').toBe(0);
      return full;
    }, 0],
    ['a branch whose tip is not the sha', { prs: [OPEN_PR] }, (w) => { onPrBranch(w); return SHA; }, 0],
  ];
  for (const [label, world, setup, lookups] of offPrPath) {
    test(`${label}, a push workflow and no run: exit 3, the plain not-queued line`, async () => {
      const w = makeWorld({ empty: 99, workflows: PUSH_TOO, ...world });
      const sha = setup(w);
      const r = runWatch(w, [sha]);
      expect(r.code, `exit 3 (stdout: ${r.out}, stderr: ${r.err})`).toBe(3);
      expect(answered(r, sha), 'the one line, no PR named').toBe(`ci-watch: run not queued yet for ${sha}\n`);
      expect(prCalls(w).length, `PR lookups: ${fmtCalls(prCalls(w))}`).toBe(lookups);
      expect(listCalls(w).length, `one round of tries: ${fmtCalls(listCalls(w))}`).toBe(2);
      cleanup(w.dir);
    });
  }

  test('no open PR for the branch and no push workflow: no CI configured for push, exit 0', async () => {
    const w = makeWorld({ empty: 99, workflows: PR_ONLY });
    const full = onPrBranch(w);
    const r = runWatch(w, [full]);
    expect(r.code, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`).toBe(0);
    expect(answered(r, full), 'the one quiet line').toBe('ci-watch: no CI configured for push\n');
    expect(prCalls(w).length, `the PR looked up: ${fmtCalls(prCalls(w))}`).toBe(1);
    cleanup(w.dir);
  });

  // An open PR the lookup would find, but no workflow runs on a PR, so no
  // run can come from it and the watch answers as a branch with no PR does.
  const noPrTrigger = [
    ['no workflow at all', null, 0, 'ci-watch: no CI configured for push\n'],
    ['a push-only workflow', { 'ci.yml': 'name: CI\non: push\njobs: {}\n' }, 3, null],
  ];
  for (const [label, workflows, code, line] of noPrTrigger) {
    test(`an open PR and ${label}: no PR wait, exit ${code} as off the PR path`, async () => {
      const w = makeWorld({ empty: 99, prs: [OPEN_PR], workflows });
      const full = onPrBranch(w);
      const r = runWatch(w, [full]);
      expect(r.code, `exit ${code} (stdout: ${r.out}, stderr: ${r.err})`).toBe(code);
      expect(answered(r, full), 'the one line, no PR wait').toBe(line || `ci-watch: run not queued yet for ${full}\n`);
      expect(prCalls(w).length, `no PR lookup: ${fmtCalls(prCalls(w))}`).toBe(0);
      expect(listCalls(w).length, `one round of tries: ${fmtCalls(listCalls(w))}`).toBe(2);
      cleanup(w.dir);
    });
  }

  test('a failing `gh pr list` is one ci-watch: gh line naming the branch and its first stderr line, exit 4', async () => {
    const w = makeWorld({ empty: 99, prFails: true, workflows: PUSH_TOO });
    const full = onPrBranch(w);
    const r = runWatch(w, [full]);
    expect(r.code, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`).toBe(4);
    expect(answered(r, full), 'the one gh line').toBe(`ci-watch: gh pr list --head ${PR_BRANCH} failed: HTTP 403: Resource not accessible by integration\n`);
    expect(watchCalls(w).length, 'nothing watched').toBe(0);
    cleanup(w.dir);
  });

  for (const raw of ['not json', '{}', 'null']) {
    test(`a \`gh pr list\` answer of ${raw} is no PR list: one ci-watch: gh line, exit 4`, async () => {
      const w = makeWorld({ empty: 99, prRaw: `${raw}\n`, workflows: PUSH_TOO });
      const full = onPrBranch(w);
      const r = runWatch(w, [full]);
      expect(r.code, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`).toBe(4);
      expect(answered(r, full), 'the one gh line').toBe(`ci-watch: gh pr list --head ${PR_BRANCH} answered no PR list: ${raw}\n`);
      expect(watchCalls(w).length, 'nothing watched').toBe(0);
      cleanup(w.dir);
    });
  }
});

describe('ship watch: refusals', () => {
  test('no sha, a non-hex sha, and one too short or too long are usage, exit 2, no gh call', async () => {
    const w = makeWorld({ runs: [runRow(51, 'Checks')] });
    for (const args of [[], ['main'], ['abc123'], [`${SHA}0`], [SHA, 'extra']]) {
      const { code, err } = runWatch(w, args);
      expect(code, `exit 2 for [${args}]`).toBe(2);
      expect(/usage: .*<sha>/.test(err), `usage on stderr for [${args}], got: ${err}`).toBeTruthy();
    }
    expect(w.calls().length, 'gh never asked').toBe(0);
    cleanup(w.dir);
  });

  test('a failing `gh run list` is one ci-watch: gh line, exit 4', async () => {
    const w = makeWorld({ listFails: true });
    const r = runWatch(w, [SHA]);
    expect(r.code, 'exit 4').toBe(4);
    const shown = answered(r);
    expect(shown.startsWith('ci-watch: gh '), `the line, got: ${shown}`).toBeTruthy();
    expect(shown.includes('HTTP 401: Bad credentials'), 'carrying what gh said').toBeTruthy();
    expect(shown.trim().split('\n').length, 'one line').toBe(1);
    expect(listCalls(w).length, 'not retried: a failure is not an empty list').toBe(1);
    cleanup(w.dir);
  });

  test('a `gh run list` answer that is not a run list is a gh failure too, exit 4', async () => {
    const w = makeWorld({ listRaw: 'Welcome to GitHub CLI!\n' });
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 4 (stderr: ${r.err})`).toBe(4);
    const shown = answered(r);
    expect(shown.startsWith('ci-watch: gh ') && shown.includes('Welcome to GitHub CLI!'), `the line, got: ${shown}`).toBeTruthy();
    expect(shown.trim().split('\n').length, 'one line').toBe(1);
    cleanup(w.dir);
  });
});

describe('ship watch: the detached watch', () => {
  test('the answer reaches stdout and .workkit/ci.log alike, from the watching line to the exit line', async () => {
    const w = makeWorld({ runs: [runRow(81, 'Checks')] });
    const { code, out, err } = runWatch(w, [SHA]);
    const lines = [
      `ci-watch: watching ${SHA}`,
      'ci-watch: green: Checks https://github.com/o/r/actions/runs/81',
      'ci-watch: exit 0',
      '',
    ].join('\n');
    expect(code, `exit 0 (stderr: ${err})`).toBe(0);
    expect(out, 'stdout is the watching line, the green line and the exit line').toBe(lines);
    const logText = readLog(w);
    expect(logText !== null, `the log is at ${w.ciLog}`).toBeTruthy();
    expect(logText, 'the log holds the same lines').toBe(lines);
    cleanup(w.dir);
  });

  test('logs.dir logs, git ignoring logs/: the watch logs to logs/ci.log and writes nothing under .workkit/', async () => {
    const w = makeWorld({ runs: [runRow(88, 'Checks')] });
    fs.writeFileSync(path.join(w.repo, '.gitignore'), '.workkit/*\nlogs/\n');
    fs.mkdirSync(path.join(w.repo, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(w.repo, '.workkit', 'settings.json'), `${JSON.stringify({ logs: { dir: 'logs' } })}\n`);
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`).toBe(0);
    const logFile = path.join(w.repo, 'logs', 'ci.log');
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : null;
    expect(logText, `the log is ${logFile}, holding what stdout showed`).toBe(r.out);
    expect(readLog(w), 'nothing at .workkit/ci.log').toBe(null);
    cleanup(w.dir);
  });

  test('logs.dir logs, git not ignoring logs/: the watch logs under the machine\'s markers folder, nothing in the repo', async () => {
    const w = makeWorld({ runs: [runRow(89, 'Checks')] });
    fs.mkdirSync(path.join(w.repo, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(w.repo, '.workkit', 'settings.json'), `${JSON.stringify({ logs: { dir: 'logs' } })}\n`);
    const r = runWatch(w, [SHA]);
    expect(r.code, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`).toBe(0);
    // The CI log's marker, shaped as the suite log's: <machine folder>/markers/claude-ci.log/<sha1 of the root>.
    const suite = suiteLogPath(path.join(w.home, '.workkit'), w.repo);
    const marker = path.join(path.dirname(path.dirname(suite)), 'claude-ci.log', path.basename(suite));
    expect(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null, `the log is ${marker}, holding what stdout showed`).toBe(r.out);
    expect(fs.existsSync(path.join(w.repo, 'logs')), 'nothing in logs/').toBe(false);
    expect(readLog(w), 'nothing at .workkit/ci.log').toBe(null);
    cleanup(w.dir);
  });

  test('a TERM to the invoking shell\'s group leaves the watch to write its exit line to the log', {
    skip: IS_WINDOWS && 'Node cannot deliver TERM or INT to a Git Bash process on Windows',
  }, async (t) => {
    const w = makeWorld({ runs: [runRow(82, 'Checks')], watchSleep: 2 });
    // The invoking shell leads its own group and the TERM goes to the whole
    // group, watch.js included, the way a tool's cut ends a call.
    const shell = startWatch(w, [], {
      cmd: BASH,
      argv: [...NO_RC, '-c', '"$0" "$1" "$2"; exit $?', process.execPath, SCRIPT, SHA],
      detached: true,
    });
    t.after(() => shell.end('SIGKILL'));
    expect(await until(() => watchCalls(w).length === 1), 'the watch never reached gh').toBeTruthy();
    process.kill(-shell.child.pid, 'SIGTERM');
    expect(await until(() => shell.child.signalCode !== null || shell.child.exitCode !== null), 'the invoking shell never ended').toBeTruthy();
    expect(shell.child.signalCode, 'the invoking shell died of the TERM, not of the watch ending').toBe('SIGTERM');
    expect(await until(() => (readLog(w) || '').endsWith('ci-watch: exit 0\n')), `the log never ended with the exit line, got: ${JSON.stringify(readLog(w))}`).toBeTruthy();
    await shell.result();
    cleanup(w.dir);
  });

  test('a second watch while one is in flight refuses, exit 5, naming the watched sha and the log', async (t) => {
    const w = makeWorld({ runs: [runRow(83, 'Checks')], watchSleep: 2 });
    const first = startWatch(w);
    t.after(() => first.end('SIGKILL'));
    expect(await until(() => watchCalls(w).length === 1), 'the first watch never reached gh').toBeTruthy();
    // The same sha, then another: both refusals name the sha being watched.
    for (const sha of [SHA, OTHER_SHA]) {
      const second = runWatch(w, [sha]);
      expect(second.code, `exit 5 for ${sha} (stdout: ${second.out}, stderr: ${second.err})`).toBe(5);
      const line = /^ci-watch: a watch is already running for (\S+) \(pid (\d+)\); its output is in (.+)\n$/.exec(second.err);
      expect(line, `the already-running line on stderr for ${sha}, got: ${JSON.stringify(second.err)}`).toBeTruthy();
      expect(line[1], `asked for ${sha}, it names the watched sha`).toBe(SHA);
      expect([w.ciLog, shellPath(w.ciLog), gitPath(w.ciLog)].includes(line[3]), `it names the log ${w.ciLog}, got: ${line[3]}`).toBeTruthy();
    }
    const r = await first.result();
    expect(r !== null, 'the first watch never answered').toBeTruthy();
    expect(r.code, `the first watch still answers green (stderr: ${r.err})`).toBe(0);
    expect(watchCalls(w).length, `one run watch reached gh: ${fmtCalls(watchCalls(w))}`).toBe(1);
    cleanup(w.dir);
  });

  test('an INT to the foreground ends the watch, exit 130', {
    skip: IS_WINDOWS && 'Node cannot deliver TERM or INT to a Git Bash process on Windows',
  }, async () => {
    // The watch outsleeps the poll's bound, so only the INT can end it in time.
    const w = makeWorld({ runs: [runRow(84, 'Checks')], watchSleep: 120 });
    const fg = startWatch(w);
    const pidFile = path.join(w.fx, 'watch-84.pid');
    let stub = null;
    try {
      expect(await until(() => pidIn(pidFile) > 0), 'the watch never reached gh').toBeTruthy();
      stub = pidIn(pidFile);
      fg.child.kill('SIGINT');
      expect(await until(() => !alive(stub)), `the stub's run watch (pid ${stub}) outlived the INT`).toBeTruthy();
      const r = await fg.result();
      expect(r !== null, 'the foreground never exited after the INT').toBeTruthy();
      expect(r.code, `exit 130 (signal: ${r.signal}, stderr: ${r.err})`).toBe(130);
      const ending = 'ci-watch: exit 143\ndetach: the run was ended on request (exit 143)\n';
      expect(await until(() => (readLog(w) || '').endsWith(ending)),
        `the log never ended with the exit line and then the request line, got: ${JSON.stringify(readLog(w))}`).toBeTruthy();
    } finally {
      if (stub) endTree(stub, 'SIGKILL');
      await fg.end('SIGKILL');
    }
    cleanup(w.dir);
  });

  test('a runner that cannot start is no answer, never red: exit 4 and the line naming the log', async () => {
    const w = makeWorld({ runs: [runRow(85, 'Checks')] });
    // logs.dir names a folder git ignores, and a plain file stands where it goes, so the run's log cannot be made.
    fs.writeFileSync(path.join(w.repo, '.gitignore'), '.workkit/*\nlogs/\n');
    fs.mkdirSync(path.join(w.repo, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(w.repo, '.workkit', 'settings.json'), `${JSON.stringify({ logs: { dir: 'logs' } })}\n`);
    fs.writeFileSync(path.join(w.repo, 'logs'), 'not a folder\n');
    const r = runWatch(w, [SHA]);
    expect(r.code !== null, `the watch finished (no timeout), stderr: ${r.err}`).toBeTruthy();
    expect(r.code !== 1, `never the red code, stderr: ${r.err}`).toBeTruthy();
    expect(r.code, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`).toBe(4);
    expect(r.err.includes('ci-watch: the watch did not finish, so there is no answer; its output is in '),
      `the line says there is no answer, got: ${JSON.stringify(r.err)}`).toBeTruthy();
    expect(watchCalls(w).length, 'no watch ran').toBe(0);
    cleanup(w.dir);
  });

  test('a lock that cannot be taken, over the log an earlier red watch left, is no answer, never red: exit 4', async () => {
    const w = makeWorld({ runs: [runRow(87, 'Checks')] });
    // A plain file at the CI lock path: no mkdir can take it.
    const lock = ciLockPath(path.join(w.home, '.workkit'), w.repo);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, 'not a lock\n');
    fs.mkdirSync(path.dirname(w.ciLog), { recursive: true });
    fs.writeFileSync(w.ciLog, `ci-watch: watching ${OTHER_SHA}\nci-watch: exit 1\n`);
    const r = runWatch(w, [SHA]);
    expect(r.code !== 1, `never the red code (stdout: ${r.out}, stderr: ${r.err})`).toBeTruthy();
    expect(r.code, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`).toBe(4);
    expect(r.err.includes('the watch did not finish'), `the line says the watch did not finish, got: ${JSON.stringify(r.err)}`).toBeTruthy();
    expect(watchCalls(w).length, 'no watch ran').toBe(0);
    cleanup(w.dir);
  });
});
