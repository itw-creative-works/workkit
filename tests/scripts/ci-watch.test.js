//
// Tests for workflow/ci-watch.sh: the ship's CI watch, a sha in and one answer
// out. Green, red, no CI configured for push, a run not queued yet, a usage
// error and a `gh` that failed are the six answers, and each is an exit code the
// ship reads, so every case asserts the code and the line together.
//
// The one seam is `gh`: a stub in a scratch bin whose every answer is a FIXTURE
// FILE the case writes before it runs (the run list, how many times that list
// comes back empty first, each run's watch exit, its conclusion and jobs, its
// failed log, and whether GitHub is reachable at all for it),
// so a case states the world it runs in rather than a stub branching per case.
// Every call is recorded with its argument boundaries intact
// (tests/lib/argv-log.js). The retries are the script's own env overrides, set
// to two tries with no wait, so a run that never shows up costs nothing.
//
// The cwd is a real scratch git repo, since where the workflows are read from
// is its toplevel.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath, homeEnv, stubTool, systemPathWith,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, eqArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ci-watch.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const LIST_ARGV = ['run', 'list', '--commit', SHA, '--json', 'databaseId,name,status,conclusion,url'];

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-watch-')));
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
 * does; `listFails`
 * a `gh run list` that fails, and `listRaw` one that answers that text instead
 * of a list.
 */
const makeWorld = ({
  runs = [], empty = 0, red = [], views = {}, logs = {}, down = [], listFails = false, listRaw = null, workflows = null,
} = {}) => {
  const dir = mkTmp();
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const fx = path.join(dir, 'fixtures');
  const log = path.join(dir, 'gh-argv.log');
  for (const d of [path.join(repo, 'sub'), bin, fx, path.join(dir, 'home')]) fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  if (workflows) {
    const wf = path.join(repo, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    for (const [file, body] of Object.entries(workflows)) fs.writeFileSync(path.join(wf, file), body);
  }

  fs.writeFileSync(path.join(fx, 'list.json'), listRaw === null ? JSON.stringify(runs) : listRaw);
  fs.writeFileSync(path.join(fx, 'list.empty'), String(empty));
  if (listFails) fs.writeFileSync(path.join(fx, 'list.fail'), '');
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
    '    cat >/dev/null; printf "watching %s\\n" "$3"',
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
    dir, repo, sub: path.join(repo, 'sub'), bin, home: path.join(dir, 'home'),
    calls: () => readArgv(log),
  };
};

const runWatch = (w, args, { cwd = w.repo, env = {} } = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd,
    env: homeEnv(w.home, {
      PATH: systemPathWith(w.bin),
      WORKKIT_CI_WATCH_TRIES: '2',
      WORKKIT_CI_WATCH_WAIT: '0',
      ...env,
    }),
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const listCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'list'));
const watchCalls = (w) => w.calls().filter((c) => isCall(c, 'run', 'watch'));

const runSuite = async () => {
  group('ci-watch.sh: green');

  await test('one green run prints one line naming the workflow and the URL, exit 0', async () => {
    const w = makeWorld({ runs: [run(11, 'Checks')] });
    const { code, out, err } = runWatch(w, [SHA]);
    assertEq(code, 0, `exit 0 (stderr: ${err})`);
    assertEq(out, 'ci-watch: green: Checks https://github.com/o/r/actions/runs/11\n', 'the one line, and nothing of the watch');
    assertEq(err, '', 'nothing on stderr');
    const watched = watchCalls(w);
    assertEq(watched.length, 1, 'one watch');
    assert(eqArgv(watched[0], ['run', 'watch', '11', '--exit-status']), `the watch argv: ${fmtCalls(watched)}`);
    cleanup(w.dir);
  });

  await test('two green runs are both watched, in order, one line each', async () => {
    const w = makeWorld({ runs: [run(21, 'Checks'), run(22, 'CHANGELOG')] });
    const { code, out } = runWatch(w, [SHA]);
    assertEq(code, 0, 'exit 0');
    assertEq(out, [
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
    const { code, out, err } = runWatch(w, [SHA]);
    assertEq(code, 1, 'exit 1');
    assertEq(out, 'ci-watch: green: Checks https://github.com/o/r/actions/runs/31\n', 'the green run still reports');
    const lines = err.split('\n');
    assertEq(lines[0], 'ci-watch: RED: CHANGELOG, job changelog: https://github.com/o/r/actions/runs/32', `the RED line, got: ${err}`);
    assertEq(lines[1], 'log line 11', 'the tail starts 40 lines from the end');
    assert(err.includes('log line 50'), 'and runs to the last line');
    assert(!/log line 10\n/.test(err), 'nothing before the last 40 lines');
    cleanup(w.dir);
  });

  await test('a red run with no failed job names the job unknown, exit 1', async () => {
    const w = makeWorld({
      runs: [run(33, 'Checks')],
      red: [33],
      views: { 33: { conclusion: 'cancelled', jobs: [{ name: 'test', conclusion: 'success' }] } },
      logs: { 33: '' },
    });
    const { code, err } = runWatch(w, [SHA]);
    assertEq(code, 1, 'exit 1');
    assertEq(err.split('\n')[0], 'ci-watch: RED: Checks, job unknown: https://github.com/o/r/actions/runs/33', `the RED line, got: ${err}`);
    const views = w.calls().filter((c) => isCall(c, 'run', 'view') && !c.includes('--log-failed'));
    assertEq(views.length, 1, `one view answers the conclusion and the job: ${fmtCalls(views)}`);
    assert(eqArgv(views[0], ['run', 'view', '33', '--json', 'conclusion,jobs']), `the view argv: ${fmtCalls(views)}`);
    cleanup(w.dir);
  });

  await test('a watch that failed for want of GitHub is a gh failure, exit 4, never red', async () => {
    const w = makeWorld({ runs: [run(34, 'Checks')], down: [34] });
    const { code, out, err } = runWatch(w, [SHA]);
    assertEq(code, 4, `exit 4 (stderr: ${err})`);
    assertEq(out, '', 'nothing on stdout');
    assertEq(err, 'ci-watch: gh run watch 34 failed: error connecting to api.github.com\n', 'the one gh line');
    cleanup(w.dir);
  });

  await test('a watch that ended before its run did is a gh failure, exit 4', async () => {
    const w = makeWorld({ runs: [run(35, 'Checks')], red: [35], views: { 35: { conclusion: '', jobs: [] } } });
    const { code, err } = runWatch(w, [SHA]);
    assertEq(code, 4, `exit 4 (stderr: ${err})`);
    assert(err.startsWith('ci-watch: gh run watch 35 failed'), `the gh line, got: ${err}`);
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
      const { code, out, err } = runWatch(w, [SHA]);
      assertEq(code, 0, `exit 0 (stderr: ${err})`);
      assertEq(out, 'ci-watch: no CI configured for push\n', 'the one quiet line');
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
      const { code, out, err } = runWatch(w, [SHA], { cwd: w.sub });
      assertEq(code, 3, `exit 3 (stdout: ${out})`);
      assertEq(err, `ci-watch: run not queued yet for ${SHA}\n`, 'the line names the sha');
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
    const { code, out, err } = runWatch(w, [SHA]);
    assertEq(code, 4, 'exit 4');
    assertEq(out, '', 'nothing on stdout');
    assert(err.startsWith('ci-watch: gh '), `the line, got: ${err}`);
    assert(err.includes('HTTP 401: Bad credentials'), 'carrying what gh said');
    assertEq(err.trim().split('\n').length, 1, 'one line');
    assertEq(listCalls(w).length, 1, 'not retried: a failure is not an empty list');
    cleanup(w.dir);
  });

  await test('a `gh run list` answer that is not a run list is a gh failure too, exit 4', async () => {
    const w = makeWorld({ listRaw: 'Welcome to GitHub CLI!\n' });
    const { code, out, err } = runWatch(w, [SHA]);
    assertEq(code, 4, `exit 4 (stderr: ${err})`);
    assertEq(out, '', 'nothing on stdout');
    assert(err.startsWith('ci-watch: gh ') && err.includes('Welcome to GitHub CLI!'), `the line, got: ${err}`);
    assertEq(err.trim().split('\n').length, 1, 'one line');
    cleanup(w.dir);
  });

  group('ci-watch.sh: the script itself');

  await test('it is executable and parses', async () => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('ci-watch.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  return summary();
};

module.exports = runSuite;

if (require.main === module) selfRun(module.exports);
