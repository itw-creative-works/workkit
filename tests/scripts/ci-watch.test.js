// Tests for workflow/ship/ci-watch.sh: the ship's CI watch, a sha in and one
// answer out as an exit code, so every case asserts the code and the line
// together. `gh` is a stub answering from fixture files the case writes, and the
// retries are env overrides set to two tries with no wait.

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, testUnless, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, NO_EXEC_BIT, shellPath, gitPath, homeEnv, stubTool, systemPathWith,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, eqArgv, fmtCalls } = require('../lib/argv-log');
const { mkTmp } = require('../lib/scratch');
const { alive, until, readPid } = require('../lib/process');
const { ciLockPath } = require('../lib/suite-record');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ship', 'ci-watch.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const LIST_ARGV = ['run', 'list', '--commit', SHA, '--json', 'databaseId,name,status,conclusion,url'];

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const run = (id, name) => ({
  databaseId: id, name, status: 'in_progress', conclusion: '', url: `https://github.com/o/r/actions/runs/${id}`,
});

/**
 * A scratch world: a git repo (with `workflows`, a map of file name to body,
 * under its `.github/workflows/`), and a `gh` stub answering from fixtures.
 * `runs` is the list `gh run list` answers once it answers anything, after
 * `empty` empty answers; `red` the run ids whose watch exits 1; `views` and
 * `logs` a run id's `--json conclusion,jobs` answer and `--log-failed` text;
 * `down` the run ids whose watch AND view fail the way an unreachable GitHub
 * does; `listFails` a `gh run list` that fails, and `listRaw` one that answers
 * that text instead of a list. `watchSleep` seconds hang every `gh run watch`
 * before it answers, and each watch writes its pid to `watch-<id>.pid` first.
 * A case that writes a path into the `rewrite` fixture has every watch rewrite
 * that file in place, one line added on top, before it answers. The repo
 * gitignores `.workkit/*`, so the watch log is `.workkit/ci.log`.
 */
const makeWorld = ({
  runs = [], empty = 0, red = [], views = {}, logs = {}, down = [], listFails = false, listRaw = null, workflows = null,
  watchSleep = null,
} = {}) => {
  const dir = mkTmp('ci-watch-');
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const fx = path.join(dir, 'fixtures');
  const log = path.join(dir, 'gh-argv.log');
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
  if (watchSleep !== null) fs.writeFileSync(path.join(fx, 'watch-sleep'), String(watchSleep));
  for (const r of runs) {
    fs.writeFileSync(path.join(fx, `watch-${r.databaseId}.exit`), red.includes(r.databaseId) || down.includes(r.databaseId) ? '1' : '0');
  }
  for (const [id, body] of Object.entries(views)) fs.writeFileSync(path.join(fx, `view-${id}.json`), JSON.stringify(body));
  for (const id of down) fs.writeFileSync(path.join(fx, `down-${id}`), '');
  for (const [id, body] of Object.entries(logs)) fs.writeFileSync(path.join(fx, `log-${id}.txt`), body);

  const F = shellPath(fx);
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(log),
    `F="${F}"`,
    'case "$1 $2" in',
    '  "run list")',
    '    if [[ -f "$F/list.fail" ]]; then printf "HTTP 401: Bad credentials\\n" >&2; exit 1; fi',
    '    n=$(( $(cat "$F/list.count" 2>/dev/null || echo 0) + 1 )); printf "%s" "$n" > "$F/list.count"',
    '    if (( n <= $(cat "$F/list.empty") )); then printf "[]\\n"; else cat "$F/list.json"; fi ;;',
    // Both drain stdin first, the way any child that reads it would: a script
    // that hands them its own stdin loses whatever it was reading there.
    '  "run watch")',
    '    cat >/dev/null; printf "%s" "$$" > "$F/watch-$3.pid"',
    '    if [[ -f "$F/watch-sleep" ]]; then sleep "$(cat "$F/watch-sleep")"; fi',
    '    if [[ -f "$F/rewrite" ]]; then r="$(cat "$F/rewrite")"; c="$(cat "$r")"; printf "# a line added while the watch ran\\n%s\\n" "$c" > "$r"; fi',
    '    printf "watching %s\\n" "$3"',
    '    if [[ -f "$F/down-$3" ]]; then printf "error connecting to api.github.com\\n" >&2; fi',
    '    exit "$(cat "$F/watch-$3.exit")" ;;',
    '  "run view")',
    '    cat >/dev/null',
    '    if [[ -f "$F/down-$3" ]]; then printf "error connecting to api.github.com\\n" >&2; exit 1; fi',
    '    if [[ " $* " == *" --log-failed "* ]]; then cat "$F/log-$3.txt"; else cat "$F/view-$3.json"; fi ;;',
    '  *) printf "gh stub: unexpected %s\\n" "$*" >&2; exit 9 ;;',
    'esac',
  ]);

  return {
    dir, repo, sub: path.join(repo, 'sub'), bin, fx, home: path.join(dir, 'home'), tmp: path.join(dir, 'tmp'),
    ciLog: path.join(repo, '.workkit', 'ci.log'),
    calls: () => readArgv(log),
  };
};

// Node joins PATH because the watch runs detached through a Node supervisor;
// TMPDIR is the world's, so the watch lock never lands in the machine's temp.
const watchEnv = (w, env = {}) => homeEnv(w.home, {
  PATH: systemPathWith(w.bin, NODE_DIR),
  TMPDIR: shellPath(w.tmp),
  WORKKIT_CI_WATCH_TRIES: '2',
  WORKKIT_CI_WATCH_WAIT: '0',
  ...env,
});

const runWatch = (w, args, { cwd = w.repo, env = {} } = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd, env: watchEnv(w, env), encoding: 'utf8', timeout: 20000,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The same run, started without waiting: a case that signals it or races it.
// `result()` resolves once it exits (null past `ms`), with what it printed;
// `detached` makes it a process group leader, so a case can end the group.
const startWatch = (w, args = [SHA], { bashArgs = [...NO_RC, shellPath(SCRIPT), ...args], detached = false } = {}) => {
  const child = spawn(BASH, bashArgs, { cwd: w.repo, env: watchEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { err += chunk.toString(); });
  const done = new Promise((resolve) => { child.on('close', (code, signal) => resolve({ code, signal })); });
  const result = (ms) => Promise.race([
    done.then((r) => ({ ...r, out, err })),
    new Promise((resolve) => { setTimeout(() => resolve(null), ms); }),
  ]);
  return { child, result };
};

// The body's answer as the terminal shows it: stdout must open with the
// watching line and end with the exit line naming the run's own code, and what
// comes between, from either stream, is the answer.
const answered = ({ code, out, err }) => {
  const firstLine = `ci-watch: watching ${SHA}\n`;
  const exitLine = `ci-watch: exit ${code}\n`;
  assert(out.startsWith(firstLine), `stdout opens with ${JSON.stringify(firstLine)}, got: ${JSON.stringify(out)} (stderr: ${err})`);
  assert(out.endsWith(exitLine), `stdout ends with ${JSON.stringify(exitLine)}, got: ${JSON.stringify(out)} (stderr: ${err})`);
  return out.slice(firstLine.length, -exitLine.length) + err;
};

const readLog = (w) => (fs.existsSync(w.ciLog) ? fs.readFileSync(w.ciLog, 'utf8') : null);
const signalTest = testUnless(IS_WINDOWS, 'Node cannot deliver TERM or INT to a Git Bash process on Windows');

const listCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'list'));
const watchCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'watch'));

const runSuite = async () => {
  group('ci-watch.sh: green');

  await test('one green run prints one line naming the workflow and the URL, exit 0', async () => {
    const w = makeWorld({ runs: [run(11, 'Checks')] });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 0, `exit 0 (stderr: ${r.err})`);
    assertEq(answered(r), 'ci-watch: green: Checks https://github.com/o/r/actions/runs/11\n', 'the one line, and nothing of the watch');
    const watched = watchCalls(w);
    assertEq(watched.length, 1, 'one watch');
    assert(eqArgv(watched[0], ['run', 'watch', '11', '--exit-status']), `the watch argv: ${fmtCalls(watched)}`);
    cleanup(w.dir);
  });

  await test('two green runs are both watched, in order, one line each', async () => {
    const w = makeWorld({ runs: [run(21, 'Checks'), run(22, 'CHANGELOG')] });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 0, 'exit 0');
    assertEq(answered(r), [
      'ci-watch: green: Checks https://github.com/o/r/actions/runs/21',
      'ci-watch: green: CHANGELOG https://github.com/o/r/actions/runs/22',
      '',
    ].join('\n'), 'one line per run');
    assertEq(watchCalls(w).map((c) => c[2]).join(','), '21,22', 'both watched in list order');
    cleanup(w.dir);
  });

  group('ci-watch.sh: red');

  await test('a red run names the workflow, the failing job and the URL, prints the log tail, exit 1', async () => {
    const tail = Array.from({ length: 50 }, (_, i) => `log line ${i + 1}`).join('\n');
    const w = makeWorld({
      runs: [run(31, 'Checks'), run(32, 'CHANGELOG')],
      red: [32],
      views: { 32: { conclusion: 'failure', jobs: [{ name: 'lint', conclusion: 'success' }, { name: 'changelog', conclusion: 'failure' }, { name: 'late', conclusion: 'failure' }] } },
      logs: { 32: `${tail}\n` },
    });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 1, 'exit 1');
    const shown = answered(r);
    const lines = shown.split('\n');
    assertEq(lines[0], 'ci-watch: green: Checks https://github.com/o/r/actions/runs/31', 'the green run still reports');
    assertEq(lines[1], 'ci-watch: RED: CHANGELOG, job changelog: https://github.com/o/r/actions/runs/32', `the RED line, got: ${shown}`);
    assertEq(lines[2], 'log line 11', 'the tail starts 40 lines from the end');
    assert(shown.includes('log line 50'), 'and runs to the last line');
    assert(!/log line 10\n/.test(shown), 'nothing before the last 40 lines');
    cleanup(w.dir);
  });

  await test('a red run with no failed job names the job unknown, exit 1', async () => {
    const w = makeWorld({
      runs: [run(33, 'Checks')],
      red: [33],
      views: { 33: { conclusion: 'cancelled', jobs: [{ name: 'test', conclusion: 'success' }] } },
      logs: { 33: '' },
    });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 1, 'exit 1');
    const shown = answered(r);
    assertEq(shown.split('\n')[0], 'ci-watch: RED: Checks, job unknown: https://github.com/o/r/actions/runs/33', `the RED line, got: ${shown}`);
    const views = w.calls().filter((c) => isCall(c, 'run', 'view') && !c.includes('--log-failed'));
    assertEq(views.length, 1, `one view answers the conclusion and the job: ${fmtCalls(views)}`);
    assert(eqArgv(views[0], ['run', 'view', '33', '--json', 'conclusion,jobs']), `the view argv: ${fmtCalls(views)}`);
    cleanup(w.dir);
  });

  await test('a watch that failed for want of GitHub is a gh failure, exit 4, never red', async () => {
    const w = makeWorld({ runs: [run(34, 'Checks')], down: [34] });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 4, `exit 4 (stderr: ${r.err})`);
    assertEq(answered(r), 'ci-watch: gh run watch 34 failed: error connecting to api.github.com\n', 'the one gh line');
    cleanup(w.dir);
  });

  await test('a watch that ended before its run did is a gh failure, exit 4', async () => {
    const w = makeWorld({ runs: [run(35, 'Checks')], red: [35], views: { 35: { conclusion: '', jobs: [] } } });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 4, `exit 4 (stderr: ${r.err})`);
    const shown = answered(r);
    assert(shown.startsWith('ci-watch: gh run watch 35 failed'), `the gh line, got: ${shown}`);
    cleanup(w.dir);
  });

  group('ci-watch.sh: finding the run');

  await test('a list that is empty first is asked again, and the run it then finds is watched', async () => {
    const w = makeWorld({ runs: [run(41, 'Checks')], empty: 1 });
    const { code, out } = runWatch(w, [SHA]);
    assertEq(code, 0, 'exit 0');
    assert(out.includes('ci-watch: green: Checks'), `green, got: ${out}`);
    const lists = listCalls(w);
    assertEq(lists.length, 2, `two list calls: ${fmtCalls(lists)}`);
    assert(lists.every((c) => eqArgv(c, LIST_ARGV)), `the list argv: ${fmtCalls(lists)}`);
    cleanup(w.dir);
  });

  await test('a run that never shows up is asked for exactly the retry count', async () => {
    const w = makeWorld({ empty: 99 });
    runWatch(w, [SHA], { env: { WORKKIT_CI_WATCH_TRIES: '3' } });
    assertEq(listCalls(w).length, 3, 'three tries reach the stub');
    assertEq(watchCalls(w).length, 0, 'nothing watched');
    cleanup(w.dir);
  });

  group('ci-watch.sh: no run');

  const DISPATCH = 'name: Manual\non:\n  workflow_dispatch:\njobs:\n  x:\n    runs-on: ubuntu-latest\n';
  const PR_BRANCH_PUSH = 'name: PR\non:\n  pull_request:\n    branches:\n      - push\njobs: {}\n';
  const noCi = [
    ['no workflows folder', null],
    ['a workflow with only workflow_dispatch', { 'manual.yml': DISPATCH }],
    ['a pull_request trigger whose branch is called push', { 'pr.yaml': PR_BRANCH_PUSH }],
  ];
  for (const [label, workflows] of noCi) {
    await test(`${label}: no CI configured for push, exit 0`, async () => {
      const w = makeWorld({ empty: 99, workflows });
      const r = runWatch(w, [SHA]);
      assertEq(r.code, 0, `exit 0 (stderr: ${r.err})`);
      assertEq(answered(r), 'ci-watch: no CI configured for push\n', 'the one quiet line');
      cleanup(w.dir);
    });
  }

  const pushForms = [
    ['the block form', { 'checks.yml': 'name: Checks\non:\n  pull_request:\n  push:\n    branches: [main]\njobs: {}\n' }],
    ['`on: push` in a .yaml', { 'ci.yaml': 'name: CI\non: push\njobs: {}\n' }],
    ['`on: [pull_request, push]`', { 'ci.yml': 'name: CI\non: [pull_request, push]\njobs: {}\n' }],
    ['the list form beside a dispatch-only file', { 'a.yml': DISPATCH, 'b.yml': 'on:\n  - push\n' }],
    ["a CRLF file with a quoted 'on': key", { 'crlf.yml': "name: CI\r\n'on':\r\n  push:\r\n    branches: [main]\r\njobs: {}\r\n" }],
  ];
  for (const [label, workflows] of pushForms) {
    await test(`a push trigger in ${label}: run not queued yet, exit 3`, async () => {
      const w = makeWorld({ empty: 99, workflows });
      // From a subdirectory, since the workflows are the repo's, not the cwd's.
      const r = runWatch(w, [SHA], { cwd: w.sub });
      assertEq(r.code, 3, `exit 3 (stdout: ${r.out})`);
      assertEq(answered(r), `ci-watch: run not queued yet for ${SHA}\n`, 'the line names the sha');
      cleanup(w.dir);
    });
  }

  group('ci-watch.sh: refusals');

  await test('no sha, a non-hex sha, and one too short or too long are usage, exit 2, no gh call', async () => {
    const w = makeWorld({ runs: [run(51, 'Checks')] });
    for (const args of [[], ['main'], ['abc123'], [`${SHA}0`], [SHA, 'extra']]) {
      const { code, err } = runWatch(w, args);
      assertEq(code, 2, `exit 2 for [${args}]`);
      assert(err.includes('usage: ci-watch.sh <sha>'), `usage on stderr for [${args}], got: ${err}`);
    }
    assertEq(w.calls().length, 0, 'gh never asked');
    const { code } = runWatch(w, ['abc1234']);
    assertEq(code, 0, 'seven hex characters is a sha');
    cleanup(w.dir);
  });

  await test('a failing `gh run list` is one ci-watch: gh line, exit 4', async () => {
    const w = makeWorld({ listFails: true });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 4, 'exit 4');
    const shown = answered(r);
    assert(shown.startsWith('ci-watch: gh '), `the line, got: ${shown}`);
    assert(shown.includes('HTTP 401: Bad credentials'), 'carrying what gh said');
    assertEq(shown.trim().split('\n').length, 1, 'one line');
    assertEq(listCalls(w).length, 1, 'not retried: a failure is not an empty list');
    cleanup(w.dir);
  });

  await test('a `gh run list` answer that is not a run list is a gh failure too, exit 4', async () => {
    const w = makeWorld({ listRaw: 'Welcome to GitHub CLI!\n' });
    const r = runWatch(w, [SHA]);
    assertEq(r.code, 4, `exit 4 (stderr: ${r.err})`);
    const shown = answered(r);
    assert(shown.startsWith('ci-watch: gh ') && shown.includes('Welcome to GitHub CLI!'), `the line, got: ${shown}`);
    assertEq(shown.trim().split('\n').length, 1, 'one line');
    cleanup(w.dir);
  });

  group('ci-watch.sh: the detached watch');

  await test('the answer reaches stdout and .workkit/ci.log alike, from the watching line to the exit line', async () => {
    const w = makeWorld({ runs: [run(81, 'Checks')] });
    const { code, out, err } = runWatch(w, [SHA]);
    const lines = [
      `ci-watch: watching ${SHA}`,
      'ci-watch: green: Checks https://github.com/o/r/actions/runs/81',
      'ci-watch: exit 0',
      '',
    ].join('\n');
    assertEq(code, 0, `exit 0 (stderr: ${err})`);
    assertEq(out, lines, 'stdout is the watching line, the green line and the exit line');
    const log = readLog(w);
    assert(log !== null, `the log is at ${w.ciLog}`);
    assertEq(log, lines, 'the log holds the same lines');
    cleanup(w.dir);
  });

  await signalTest('a TERM to the invoking shell\'s group leaves the watch to write its exit line to the log', async () => {
    const w = makeWorld({ runs: [run(82, 'Checks')], watchSleep: 2 });
    // The invoking shell leads its own group and the TERM goes to the whole
    // group, ci-watch.sh included, the way a tool's cut ends a call.
    const shell = startWatch(w, [], {
      bashArgs: [...NO_RC, '-c', 'bash --noprofile --norc "$0" "$1"; exit $?', shellPath(SCRIPT), SHA],
      detached: true,
    });
    assert(await until(() => watchCalls(w).length === 1, 10000), 'the watch reached gh within 10 s');
    process.kill(-shell.child.pid, 'SIGTERM');
    assert(await until(() => shell.child.signalCode !== null || shell.child.exitCode !== null, 2000), 'the invoking shell ended within 2 s');
    assertEq(shell.child.signalCode, 'SIGTERM', 'the invoking shell died of the TERM, not of the watch ending');
    assert(await until(() => (readLog(w) || '').endsWith('ci-watch: exit 0\n'), 10000), `the log ends with the exit line within 10 s, got: ${JSON.stringify(readLog(w))}`);
    await shell.result(10000);
    cleanup(w.dir);
  });

  await test('a second watch while one is in flight refuses, exit 5, naming the watched sha and the log', async () => {
    const w = makeWorld({ runs: [run(83, 'Checks')], watchSleep: 2 });
    const first = startWatch(w);
    assert(await until(() => watchCalls(w).length === 1, 10000), 'the first watch reached gh within 10 s');
    // The same sha, then another: both refusals name the sha being watched.
    for (const sha of [SHA, OTHER_SHA]) {
      const second = runWatch(w, [sha]);
      assertEq(second.code, 5, `exit 5 for ${sha} (stdout: ${second.out}, stderr: ${second.err})`);
      const line = /^ci-watch: a watch is already running for (\S+) \(pid (\d+)\); its output is in (.+)\n$/.exec(second.err);
      assert(line, `the already-running line on stderr for ${sha}, got: ${JSON.stringify(second.err)}`);
      assertEq(line[1], SHA, `asked for ${sha}, it names the watched sha`);
      assert([w.ciLog, shellPath(w.ciLog), gitPath(w.ciLog)].includes(line[3]), `it names the log ${w.ciLog}, got: ${line[3]}`);
    }
    const r = await first.result(15000);
    assert(r !== null, 'the first watch answered within 15 s');
    assertEq(r.code, 0, `the first watch still answers green (stderr: ${r.err})`);
    assertEq(watchCalls(w).length, 1, `one run watch reached gh: ${fmtCalls(watchCalls(w))}`);
    cleanup(w.dir);
  });

  await signalTest('an INT to the foreground ends the watch within 2 s, exit 130', async () => {
    const w = makeWorld({ runs: [run(84, 'Checks')], watchSleep: 10 });
    const fg = startWatch(w);
    const pidFile = path.join(w.fx, 'watch-84.pid');
    let stub = null;
    try {
      assert(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8') !== '', 10000), 'the watch reached gh within 10 s');
      stub = readPid(pidFile);
      fg.child.kill('SIGINT');
      assert(await until(() => !alive(stub), 2000), `the stub's run watch (pid ${stub}) is gone within 2 s of the INT`);
      const r = await fg.result(5000);
      assert(r !== null, 'the foreground exited within 5 s of the INT');
      assertEq(r.code, 130, `exit 130 (signal: ${r.signal}, stderr: ${r.err})`);
      assert(await until(() => (readLog(w) || '').endsWith('ci-watch: exit 130\n'), 2000), `the log ends with the exit line, got: ${JSON.stringify(readLog(w))}`);
    } finally {
      if (stub && alive(stub)) process.kill(stub, 'SIGKILL');
      if (fg.child.exitCode === null && fg.child.signalCode === null) fg.child.kill('SIGKILL');
    }
    cleanup(w.dir);
  });

  // A node ahead of the real one that fails, so the Node supervisor never runs;
  // the second world holds the log an earlier red watch left, whose last line
  // would read as this watch's own red unless the log is emptied first.
  const noRunner = [
    ['a runner that cannot start', null],
    ['a runner that cannot start, over the log an earlier red watch left', `ci-watch: watching ${OTHER_SHA}\nci-watch: exit 1\n`],
  ];
  for (const [label, staleLog] of noRunner) {
    await test(`${label} is no answer, never red: exit 4 and the line naming the log`, async () => {
      const w = makeWorld({ runs: [run(85, 'Checks')] });
      stubTool(w.bin, 'node', ['#!/bin/bash', 'exit 1']);
      if (staleLog !== null) {
        fs.mkdirSync(path.dirname(w.ciLog), { recursive: true });
        fs.writeFileSync(w.ciLog, staleLog);
      }
      const r = runWatch(w, [SHA]);
      assert(r.code !== null, `the watch finished (no timeout), stderr: ${r.err}`);
      assert(r.code !== 1, `never the red code, stderr: ${r.err}`);
      assertEq(r.code, 4, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`);
      assert(r.err.includes('ci-watch: the watch did not finish, so there is no answer; its output is in '),
        `the line says there is no answer, got: ${JSON.stringify(r.err)}`);
      assertEq(watchCalls(w).length, 0, 'no watch ran');
      cleanup(w.dir);
    });
  }

  await test('a lock that cannot be taken, over the log an earlier red watch left, is no answer, never red: exit 4', async () => {
    const w = makeWorld({ runs: [run(87, 'Checks')] });
    // A plain file at the CI lock path: no mkdir can take it.
    const lock = ciLockPath(w.tmp, w.repo);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, 'not a lock\n');
    fs.mkdirSync(path.dirname(w.ciLog), { recursive: true });
    fs.writeFileSync(w.ciLog, `ci-watch: watching ${OTHER_SHA}\nci-watch: exit 1\n`);
    const r = runWatch(w, [SHA]);
    assert(r.code !== 1, `never the red code (stdout: ${r.out}, stderr: ${r.err})`);
    assertEq(r.code, 4, `exit 4 (stdout: ${r.out}, stderr: ${r.err})`);
    assert(r.err.includes('the watch did not finish'), `the line says the watch did not finish, got: ${JSON.stringify(r.err)}`);
    assertEq(watchCalls(w).length, 0, 'no watch ran');
    cleanup(w.dir);
  });

  group('ci-watch.sh: the script itself');

  await test('it is executable and parses', async () => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('ci-watch.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  await test('an in-place rewrite of the script during the watch changes nothing: the green answer, no fragment read', async () => {
    // The twin of script-shell.test.js's case: a copy of the kit, rewritten by
    // the watch itself while the foreground waits and the body runs.
    const w = makeWorld({ runs: [run(86, 'Checks')] });
    const kit = path.join(w.dir, 'kit', 'workflow');
    fs.cpSync(path.join(__dirname, '..', '..', 'workflow'), kit, { recursive: true });
    const copy = path.join(kit, 'ship', 'ci-watch.sh');
    fs.writeFileSync(path.join(w.fx, 'rewrite'), shellPath(copy));
    const res = spawnSync(BASH, [...NO_RC, shellPath(copy), SHA], { cwd: w.repo, env: watchEnv(w), encoding: 'utf8', timeout: 20000 });
    const r = { code: res.status, out: res.stdout || '', err: res.stderr || '' };
    assertEq(fs.readFileSync(copy, 'utf8').split('\n')[0], '# a line added while the watch ran', 'the script on disk was rewritten while it ran');
    assertEq(r.code, 0, `exit 0 (stdout: ${r.out}, stderr: ${r.err})`);
    assert(!/command not found|syntax error/.test(`${r.out}${r.err}`), `the running shells read no fragment, got: ${r.out} ${r.err}`);
    assertEq(answered(r), 'ci-watch: green: Checks https://github.com/o/r/actions/runs/86\n', 'the one green line');
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => l.trim() !== '');
    assertEq(lines[lines.length - 1], 'main "$@"', 'the file ends on the one call that runs it');
    cleanup(w.dir);
  });

  return summary();
};

module.exports = runSuite;

if (require.main === module) selfRun(module.exports);
