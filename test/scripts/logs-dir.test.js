// Tests for the log folder, `logs.dir` in a repo's .workkit/settings.json: a root
// and a narrowed `npm test` and `workkit supervise` log there when git ignores it,
// under the machine's markers folder when git does not, in .workkit/ with no
// setting, and a value outside the repo stops the run. The ship watch's ci.log is
// ci-watch.test.js's case. The world is test/lib/supervise-world.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../lib/harness');
const { BASH, NO_RC } = require('../lib/platform');
const { skipWithoutWrapper, wiredNpmEnv } = require('../lib/script-shell');
const { suiteLogPath } = require('../lib/suite-record');
const { read, lastLine } = require('../lib/supervise');
const { LONG_CHECK, mkWorld, workkit } = require('../lib/supervise-world');

// The repo's settings, `logs.dir` set to <dir> unless it is undefined.
const settings = (dir) => `${JSON.stringify({
  enabled: true, tests: { check: LONG_CHECK }, ...(dir === undefined ? {} : { logs: { dir } }),
})}\n`;

const PKG = `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node probe.js' } })}\n`;

// The test script: what `logs/`, `.workkit/` and the markers folder hold while the
// run is live, written outside the repo, then one line for the log.
const PROBE = [
  "const fs = require('fs');",
  'const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String) : []);',
  'const seen = { logs: list(\'logs\'), workkit: list(\'.workkit\'), markers: list(process.env.WK_MARKERS) };',
  "fs.writeFileSync(require('path').join(process.env.WK_OUT, 'seen.json'), JSON.stringify(seen));",
  "console.log('probe-ran');",
].join('\n');

/**
 * A scratch machine and repo whose .gitignore is <ignore> and whose `logs.dir`
 * is <dir>, npm's script shell wired to the kit's wrapper.
 */
const mkLogWorld = ({ dir, ignore }) => {
  const w = mkWorld({
    files: {
      '.gitignore': ignore, '.workkit/settings.json': settings(dir), 'package.json': PKG, 'probe.js': PROBE,
    },
  });
  const env = { ...wiredNpmEnv(w), WK_OUT: w.out, WK_MARKERS: path.join(w.workflowHome, 'markers') };
  return { ...w, env };
};

const npmTest = (w, args = []) => run(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test', ...args], { cwd: w.repo, env: w.env });
const supervise = (w) => workkit(['supervise', '--', 'node', '-e', "console.log('supervised-ran')"], { cwd: w.repo, env: w.env });

const inRepo = (w, ...parts) => path.join(w.repo, ...parts);
const exists = (file) => fs.existsSync(file);
// What the probe saw while its run was live.
const seen = (w) => JSON.parse(read(path.join(w.out, 'seen.json')) || '{"logs":[],"workkit":[],"markers":[]}');
const testLogs = (names) => names.filter((n) => /(^|[/\\])(claude-)?test\.log/.test(n));

// A per-repo log under the machine's markers folder, as the suite log's own path is shaped.
const markerLog = (w, name) => {
  const suite = suiteLogPath(w.workflowHome, w.repo);
  return path.join(path.dirname(path.dirname(suite)), `claude-${name}`, path.basename(suite));
};

describe('logs.dir: where the test and supervised runs log', { skip: skipWithoutWrapper() }, () => {
  test('logs.dir logs, git ignoring logs/: the root, narrowed and supervised logs are in logs/, none in .workkit/', async () => {
    const w = mkLogWorld({ dir: 'logs', ignore: '.workkit/*\nlogs/\n' });

    const root = npmTest(w);
    expect(root.status, `the root run is green, got: ${root.output}`).toBe(0);
    expect(read(inRepo(w, 'logs', 'suite.log')).includes('probe-ran\n'), `logs/suite.log holds the run, got: ${root.output}`).toBeTruthy();
    expect(lastLine(read(inRepo(w, 'logs', 'suite.log'))), 'and ends on its closing line').toBe('script-shell: exit 0');
    expect(exists(inRepo(w, '.workkit', 'suite.log')), 'no .workkit/suite.log').toBe(false);

    const narrowed = npmTest(w, ['--', 'only/one.test.js']);
    expect(narrowed.status, `the narrowed run is green, got: ${narrowed.output}`).toBe(0);
    const live = seen(w);
    expect(testLogs(live.logs).some((n) => /^test\.log\.\d+$/.test(n)), `logs/ held test.log.<pid> while it ran, got: ${JSON.stringify(live)}`).toBeTruthy();
    expect(testLogs(live.workkit).join(), `.workkit/ held no test log, got: ${JSON.stringify(live)}`).toBe('');

    const supervised = await supervise(w);
    expect(supervised.code, `the supervised run's code, got: ${supervised.output}`).toBe(0);
    expect(read(inRepo(w, 'logs', 'run.log')).includes('supervised-ran\n'), `logs/run.log holds the run, got: ${supervised.output}`).toBeTruthy();
    expect(exists(inRepo(w, '.workkit', 'run.log')), 'no .workkit/run.log').toBe(false);
  });

  test('logs.dir logs, git not ignoring logs/: each log goes under the machine\'s markers folder, none in the repo', async () => {
    const w = mkLogWorld({ dir: 'logs', ignore: '.workkit/*\n' });

    const root = npmTest(w);
    expect(root.status, `the root run is green, got: ${root.output}`).toBe(0);
    expect(read(suiteLogPath(w.workflowHome, w.repo)).includes('probe-ran\n'), `the suite log is under the markers folder, got: ${root.output}`).toBeTruthy();

    const narrowed = npmTest(w, ['--', 'only/one.test.js']);
    expect(narrowed.status, `the narrowed run is green, got: ${narrowed.output}`).toBe(0);
    const live = seen(w);
    expect(testLogs(live.markers).length > 0, `the markers folder held the test log while it ran, got: ${JSON.stringify(live)}`).toBeTruthy();
    expect(testLogs([...live.logs, ...live.workkit]).join(), `the repo held no test log, got: ${JSON.stringify(live)}`).toBe('');

    const supervised = await supervise(w);
    expect(supervised.code, `the supervised run's code, got: ${supervised.output}`).toBe(0);
    expect(read(markerLog(w, 'run.log')).includes('supervised-ran\n'), `the run log is under the markers folder, got: ${supervised.output}`).toBeTruthy();

    for (const name of ['suite.log', 'run.log']) {
      expect(exists(inRepo(w, 'logs', name)), `no logs/${name}`).toBe(false);
      expect(exists(inRepo(w, '.workkit', name)), `no .workkit/${name}`).toBe(false);
    }
  });

  test('no logs.dir: every log is in .workkit/, none in an ignored logs/', async () => {
    const w = mkLogWorld({ dir: undefined, ignore: '.workkit/*\nlogs/\n' });

    expect(npmTest(w).status, 'the root run is green').toBe(0);
    expect(read(inRepo(w, '.workkit', 'suite.log')).includes('probe-ran\n'), 'the suite log is .workkit/suite.log').toBeTruthy();

    expect(npmTest(w, ['--', 'only/one.test.js']).status, 'the narrowed run is green').toBe(0);
    const live = seen(w);
    expect(testLogs(live.workkit).some((n) => /^test\.log\.\d+$/.test(n)), `.workkit/ held test.log.<pid> while it ran, got: ${JSON.stringify(live)}`).toBeTruthy();

    expect((await supervise(w)).code, 'the supervised run is green').toBe(0);
    expect(read(inRepo(w, '.workkit', 'run.log')).includes('supervised-ran\n'), 'the run log is .workkit/run.log').toBeTruthy();

    expect(exists(inRepo(w, 'logs')), 'nothing is written to logs/').toBe(false);
  });

  test('logs.dir ../x or an absolute path: a root npm test stops non-zero with one line naming logs.dir, no suite runs', () => {
    const outside = path.join(mkTmp('logs-dir-outside-'), 'x');
    for (const [dir, target] of [['../x', (w) => path.join(w.dir, 'x')], [outside.replace(/\\/g, '/'), () => outside]]) {
      const w = mkLogWorld({ dir, ignore: '.workkit/*\n' });
      const res = npmTest(w);
      const said = `${res.stdout}${res.stderr}`;
      expect(res.status !== 0 && res.status !== null, `${dir}: the run stops with a code of its own, got: ${res.status} ${said}`).toBeTruthy();
      expect(said.split('\n').filter((l) => l.includes('logs.dir')).length, `${dir}: one line names logs.dir, got: ${said}`).toBe(1);
      expect(said.includes('probe-ran') || exists(path.join(w.out, 'seen.json')), `${dir}: no suite ran, got: ${said}`).toBe(false);
      expect(exists(target(w)), `${dir}: nothing is written outside the repo`).toBe(false);
    }
  });
});
