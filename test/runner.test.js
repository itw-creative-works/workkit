/* eslint-disable no-console */
// Tests for packages/core/test/run.js, the kit's suite runner the workkit bin
// runs: paths narrow a run, suites run whole in a worker pool with a serial tail
// after the wave, a crashed, unloadable, empty, late-failing or old-shape suite
// fails loudly, a suite past TEST_DEADLINE is ended with its process group, a
// suite's block prints one line per case under its describe path, suites are
// found by name anywhere under the start folder, and a suite runs alone by file.

const path = require('path');
const fs = require('fs');
const { stripVTControlCharacters } = require('util');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, suiteName, POOL, mkTmp, SPAWN_DEADLINE, until, alive, pidIn, start, endTree,
} = require('./lib/harness');
const {
  which, basePathWithout, joinPath, homeEnv, NODE_DIR, IS_WINDOWS,
} = require('./lib/platform');
const { aloneEnv } = require('./lib/alone-env');
const { TOTALS_LINE, linesOf, listsOf } = require('./lib/run-lists');

const KIT = path.join(__dirname, '..');
const KIT_TEST = path.join(KIT, 'packages', 'core', 'test');
const RUNNER = path.join(KIT_TEST, 'run.js');
const HARNESS = path.join(KIT_TEST, 'lib', 'harness.js');
const CORE_BIN = path.join(KIT, 'packages', 'core', 'bin', 'workkit.js');

// The removed words the old-shape fixture ends on: its self-run call and its summary call.
const SELF_RUN = 'selfRun';
const SUMMARY_CALL = 'summary(';

// Each of `files` (path from `root` to text) written under `root`.
const writeFiles = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
};

// The suite folder `folder` under `root`, holding `suites` (file name to body)
// and, for test/, `serial` as the tail: its lib/ holds the harness as a repo
// keeps it, a re-export of the kit's.
const writeSuiteDir = (root, folder, suites, serial) => {
  const dir = path.join(root, folder);
  writeFiles(dir, { 'lib/harness.js': `module.exports = require(${JSON.stringify(HARNESS)});\n`, ...suites });
  if (folder === 'test') writeFiles(dir, { 'lib/serial.js': `module.exports = { SERIAL: ${JSON.stringify(serial)} };\n` });
  return dir;
};

// A throwaway repo, a git work tree unless `git` is false, whose `folder` (test/
// unless named, none when null) holds `suites` and `serial`, with `files` beside.
// Every git call, the runner's included, sees the scratch `home` alone.
const mkFixture = (suites, {
  serial = [], folder = 'test', files = {}, git = true,
} = {}) => {
  const root = mkTmp('runner-');
  const home = mkTmp('runner-home-');
  if (git) spawnSync('git', ['init', '-q'], { cwd: root, env: homeEnv(home, { PATH: process.env.PATH }) });
  const dir = folder === null ? null : writeSuiteDir(root, folder, suites, serial);
  writeFiles(root, files);
  return { root, home, dir };
};

// The fixture run from its root (or `cwd` under it) with `args(root)`; `read` lists
// files under the root returned as `files` (null when absent). `env` adds to the
// runner's; with no git, no folder above the root is a work tree either. `prepare`
// gets the root and the scratch home before the run. `stderr` is the runner's alone.
const runSuites = (suites, {
  args = () => [], serial = [], read = [], folder = 'test', files: extra = {}, git = true, cwd = '', env = {}, prepare = () => {},
} = {}) => {
  const { root, home } = mkFixture(suites, {
    serial, folder, files: extra, git,
  });
  prepare(root, home);
  const ceiling = git ? {} : { GIT_CEILING_DIRECTORIES: path.dirname(root) };
  const res = spawnSync('node', [RUNNER, ...args(root)], {
    cwd: path.join(root, cwd), encoding: 'utf8', env: homeEnv(home, { ...process.env, ...ceiling, ...env }), timeout: SPAWN_DEADLINE,
  });
  const files = Object.fromEntries(read.map((name) => {
    const file = path.join(root, name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
  }));
  fs.rmSync(root, { recursive: true, force: true });
  return { code: res.status, output: (res.stdout || '') + (res.stderr || ''), stderr: res.stderr || '', files };
};

// A suite on the door at `harness`, its top level `inner`.
const SUITE = (inner, harness = './lib/harness') => `const {
  describe, test, before, after, expect,
} = require(${JSON.stringify(harness)});
${inner}
`;

// A suite in the old shape: its cases in an exported runner function on the
// removed words, ending on the old self-run line when `runsAlone` is set.
const OLD_SHAPE = (runsAlone) => [
  `const { group, test, assert, summary${runsAlone ? `, ${SELF_RUN}` : ''} } = require('./lib/harness');`,
  'const cases = async () => {',
  "  group('old');",
  "  await test('an old case', () => { assert(true); });",
  '};',
  `module.exports = async () => { await cases(); return ${SUMMARY_CALL}); };`,
  ...(runsAlone ? [`if (require.main === module) ${SELF_RUN}(module.exports);`] : []),
  '',
].join('\n');

// A throwaway plugin repo for the mod half: one Node suite under test/, and a
// hooks module with one passing test/mods/*.test.ts, run whole through the real runner
// on `PATH`.
const runModHalf = (PATH) => {
  const { root, dir } = mkFixture({ 'node.test.js': SUITE("test('the node case', () => {});") });
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{ "name": "fixture", "version": "0.0.1" }\n');
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{ "modules": ["./register.js"] }\n');
  fs.writeFileSync(path.join(root, 'hooks', 'register.js'), 'export function register(on) {}\n');
  fs.mkdirSync(path.join(dir, 'mods'));
  fs.writeFileSync(path.join(dir, 'mods', 'fixture.test.ts'), "import { test, expect } from 'claude-code/testing'\ntest('the mod case', async () => { expect(1).toBe(1) })\n");
  const res = spawnSync('node', [RUNNER], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH }, timeout: SPAWN_DEADLINE });
  fs.rmSync(root, { recursive: true, force: true });
  return { code: res.status, output: (res.stdout || '') + (res.stderr || '') };
};

// The lines under the suite `name`'s heading, up to the next heading or the totals.
const blockOf = (output, name) => {
  const lines = linesOf(output);
  const at = lines.indexOf(`▶ ${name}`);
  expect(at >= 0, `prints the heading "▶ ${name}", got: ${output}`).toBeTruthy();
  const end = lines.findIndex((line, i) => i > at && (line.startsWith('▶ ') || TOTALS_LINE.test(line)));
  return lines.slice(at + 1, end < 0 ? undefined : end);
};
const failuresOf = (output) => stripVTControlCharacters(output).split('Failures:')[1];

// Fixture-side helpers for suites that meet across processes: the fixture
// root, a sleep, a marker file, and a wait for another suite's marker that
// gives up (false) at the shared deadline, so a runner that never overlaps them fails.
const MEET = `
const fs = require('fs');
const path = require('path');
const { until } = require(${JSON.stringify(path.join(KIT_TEST, 'lib', 'process.js'))});
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const mark = (name, text = '') => fs.appendFileSync(path.join(root, name), text);
const waitFor = (name) => until(() => fs.existsSync(path.join(root, name)));
`;

describe('run.js: suite paths narrow the run', () => {
  // Three suites with distinct case names and counts, so the output and the
  // totals both say which ran.
  const three = {
    'alpha.test.js': SUITE("test('alpha case', () => {});"),
    'beta.test.js': SUITE(`
test('beta case one', () => {});
test('beta case two', () => {});
`),
    'gamma.test.js': SUITE(`
for (const n of [1, 2, 3, 4]) test(\`gamma case \${n}\`, () => {});
`),
  };

  // One path relative to the repo root, one absolute: the two forms the runner takes.
  test('two paths run only those two suites and the totals count only them', () => {
    const { code, output } = runSuites(three, { args: (root) => ['test/alpha.test.js', path.join(root, 'test', 'beta.test.js')] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    for (const ran of ['alpha case', 'beta case one', 'beta case two']) {
      expect(output.includes(ran), `ran "${ran}", got: ${output}`).toBeTruthy();
    }
    expect(!output.includes('gamma'), `the unnamed suite never ran, got: ${output}`).toBeTruthy();
    expect(output.includes('3 passed, 0 failed'), `totals count only the two, got: ${output}`).toBeTruthy();
    expect(output.includes('2 suites)'), `names two suites, got: ${output}`).toBeTruthy();
  });

  test('a path written with a backslash, test\\alpha.test.js, runs only that suite', () => {
    const { code, output } = runSuites(three, { args: () => ['test\\alpha.test.js'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('alpha case') && !output.includes('beta case') && !output.includes('gamma'), `only alpha ran, got: ${output}`).toBeTruthy();
    expect(output.includes('1 suite)'), `names one suite, got: ${output}`).toBeTruthy();
  });

  // The tail suite sorts first, so it sees the wave's mark only when held until the wave ends.
  test('a serial entry written with a backslash runs that suite after the parallel wave', () => {
    const { code, output } = runSuites({
      'a-tail.test.js': SUITE(`${MEET}
test('the tail sees the wave done', () => { expect(fs.existsSync(path.join(root, 'wave.done')), 'the wave had not finished').toBe(true); });
`),
      'wave.test.js': SUITE(`${MEET}
test('the wave writes its file', async () => { await sleep(400); mark('wave.done'); });
`),
    }, { serial: ['test\\a-tail.test.js'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const lines = linesOf(output);
    expect(lines.indexOf('▶ test/a-tail.test.js') > lines.indexOf('▶ test/wave.test.js'), `the tail prints after the wave, got: ${output}`).toBeTruthy();
  });

  // _fixtures/x.test.js is a file, but under a folder no suite is read from.
  test('a path naming an unread file or no file exits 1 with "No suite matches <arg>" and runs nothing', () => {
    const unread = { '_fixtures/x.test.js': SUITE("test('fixture case', () => {});", HARNESS) };
    for (const arg of ['_fixtures/x.test.js', 'test/missing.test.js']) {
      const { code, output } = runSuites(three, { files: unread, args: () => ['test/alpha.test.js', arg] });
      expect(code, `${arg}: exit 1, got: ${output}`).toBe(1);
      expect(linesOf(output).some((line) => line.endsWith(`No suite matches ${arg}`)), `${arg}: the line naming it, got: ${output}`).toBeTruthy();
      expect(!output.includes('alpha case') && !output.includes('fixture case'), `${arg}: no suite ran, the named good one included, got: ${output}`).toBeTruthy();
    }
  });

  test('a folder with no suite exits 1 with the No test file found line', () => {
    const { code, output } = runSuites({});
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No test file found (*.test.js, *.test.mjs, *.test.cjs)')), `the start failure, got: ${output}`).toBeTruthy();
  });

  test('no arguments runs every suite as before', () => {
    const { code, output } = runSuites(three);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    for (const ran of ['alpha case', 'beta case two', 'gamma case 4']) {
      expect(output.includes(ran), `ran "${ran}", got: ${output}`).toBeTruthy();
    }
    expect(output.includes('7 passed, 0 failed'), `totals count all three, got: ${output}`).toBeTruthy();
    expect(output.includes('3 suites)'), `names three suites, got: ${output}`).toBeTruthy();
  });

  // The sleeper sorts last, so only its time can put it first on the line.
  test('the run names its slowest suites, the slowest first', () => {
    const { code, output } = runSuites({
      'a-quick.test.js': SUITE("test('quick case', () => {});"),
      'z-sleeper.test.js': SUITE(`
test('sleeper case', async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });
`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const line = linesOf(output).find((l) => l.startsWith('slowest: '));
    expect(/^slowest: test\/z-sleeper\.test\.js \d+\.\ds, test\/a-quick\.test\.js \d+\.\ds$/.test(line || ''),
      `names both suites, the sleeper first, got: ${output}`).toBeTruthy();
  });

  test('a SERIAL entry naming no suite exits 1 with the serial No suite matches line before any suite runs', () => {
    const { code, output, stderr } = runSuites({
      'alpha.test.js': SUITE("test('alpha case', () => {});"),
    }, { serial: ['test/gone.test.js'] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(stderr).some((line) => line.endsWith('No suite matches test/gone.test.js (test/lib/serial.js)')), `names the stale entry and the list on stderr, got: ${stderr}`).toBeTruthy();
    expect(!output.includes('▶'), `no suite header printed, got: ${output}`).toBeTruthy();
    expect(!output.includes('alpha case'), `no suite ran, got: ${output}`).toBeTruthy();
  });
});

// Every suite runs in its own worker process: the fixtures below declare
// nothing, and the ones meeting across processes prove they ran at once.
describe('run.js: suites run in parallel workers', () => {
  test('two suites printing at once never interleave, each block whole under its header', { skip: POOL < 2 && `a pool of ${POOL} cannot run two suites at once` }, () => {
    const { code, output } = runSuites({
      'left.test.js': SUITE(`${MEET}
test('left meets right', async () => {
  console.log('left 1');
  mark('left-ready');
  expect(await waitFor('right-ready'), 'right never ran alongside left').toBeTruthy();
  await sleep(200);
  console.log('left 2');
  await sleep(200);
  console.log('left 3');
});
`),
      'right.test.js': SUITE(`${MEET}
test('right meets left', async () => {
  console.log('right 1');
  mark('right-ready');
  expect(await waitFor('left-ready'), 'left never ran alongside right').toBeTruthy();
  await sleep(100);
  console.log('right 2');
  await sleep(200);
  console.log('right 3');
});
`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const lines = linesOf(output);
    const blocks = {
      left: ['▶ test/left.test.js', '    left 1', '    left 2', '    left 3', '  ✓ left meets right'],
      right: ['▶ test/right.test.js', '    right 1', '    right 2', '    right 3', '  ✓ right meets left'],
    };
    for (const block of Object.values(blocks)) {
      const at = lines.indexOf(block[0]);
      expect(at >= 0, `prints the header "${block[0]}", got: ${output}`).toBeTruthy();
      expect(lines.slice(at, at + block.length).join('\n'), `the block under "${block[0]}" is whole, got: ${output}`).toBe(block.join('\n'));
    }
  });

  test('a slow suite that sorts first prints before a fast one that finished earlier', { skip: POOL < 2 && `a pool of ${POOL} cannot run two suites at once` }, () => {
    const { code, output } = runSuites({
      'a-slow.test.js': SUITE(`${MEET}
test('slow outlasts fast', async () => {
  expect(await waitFor('fast-done'), 'fast never ran alongside slow').toBeTruthy();
  await sleep(300);
  console.log('slow finished');
});
`),
      'b-fast.test.js': SUITE(`${MEET}
test('fast ends first', () => {
  console.log('fast finished');
  mark('fast-done');
});
`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const lines = linesOf(output);
    const order = ['▶ test/a-slow.test.js', '    slow finished', '▶ test/b-fast.test.js', '    fast finished'].map((line) => lines.indexOf(line));
    expect(order.every((at) => at >= 0), `prints both blocks, got: ${output}`).toBeTruthy();
    expect(order.every((at, i) => i === 0 || at > order[i - 1]), `the slow block prints whole before the fast one, got: ${output}`).toBeTruthy();
  });

  // The tail suites sort before the wave, so only a runner that holds them
  // until the wave ends sees the wave's files. Its entries are paths from the start folder.
  test('the serial tail test/lib/serial.js names runs after the whole wave, one suite at a time', () => {
    const wave = (name) => SUITE(`${MEET}
test('${name} writes its file', async () => {
  await sleep(400);
  mark('${name}.done');
});
`);
    const tail = (name) => SUITE(`${MEET}
test('${name} sees the wave done', async () => {
  expect(fs.existsSync(path.join(root, 'wave-one.done')), 'wave-one had not finished').toBe(true);
  expect(fs.existsSync(path.join(root, 'wave-two.done')), 'wave-two had not finished').toBe(true);
  mark('stamps.txt', 'start ${name}\\n');
  await sleep(300);
  mark('stamps.txt', 'end ${name}\\n');
});
`);
    const { code, output, files } = runSuites({
      'a-tail-one.test.js': tail('a-tail-one'),
      'a-tail-two.test.js': tail('a-tail-two'),
      'wave-one.test.js': wave('wave-one'),
      'wave-two.test.js': wave('wave-two'),
    }, { serial: ['test/a-tail-one.test.js', 'test/a-tail-two.test.js'], read: ['stamps.txt'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const spans = [
      'start a-tail-one\nend a-tail-one\nstart a-tail-two\nend a-tail-two\n',
      'start a-tail-two\nend a-tail-two\nstart a-tail-one\nend a-tail-one\n',
    ];
    expect(spans.includes(files['stamps.txt']), `the two tail suites ran as two closed spans, got: ${JSON.stringify(files['stamps.txt'])}`).toBeTruthy();
    const lines = linesOf(output);
    const lastWave = Math.max(lines.indexOf('▶ test/wave-one.test.js'), lines.indexOf('▶ test/wave-two.test.js'));
    for (const header of ['▶ test/a-tail-one.test.js', '▶ test/a-tail-two.test.js']) {
      expect(lines.indexOf(header) > lastWave, `"${header}" prints after the wave's blocks, got: ${output}`).toBeTruthy();
    }
  });

  test('a worker that exits without reporting fails the run as "run <suite>"', () => {
    const { code, output } = runSuites({
      'crash.test.js': SUITE(`
test('before the crash', () => {});
after(() => {
  console.error('about to die');
  process.exit(3);
});
`),
      'steady.test.js': SUITE("test('steady case', () => {});"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(output.includes('steady case'), `the other suite still ran, got: ${output}`).toBeTruthy();
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    expect(failures.includes('run test/crash.test.js'), `names the suite as "run test/crash.test.js", got: ${failures}`).toBeTruthy();
    expect(/\b3\b/.test(failures), `gives the exit code, got: ${failures}`).toBeTruthy();
    expect(failures.includes('about to die'), `quotes the last thing it wrote, got: ${failures}`).toBeTruthy();
  });

  // Each suite prints an error it never threw, then exits 3: the exit is the failure, never the print.
  test('a suite that prints an error and then exits 3, after a case, after a slow case or at load, fails as run <suite>, exited with code 3', () => {
    const logged = "test('logs', () => { console.error(new Error('handled and logged')); });";
    const exits = 'after(() => { process.exit(3); });';
    const { code, output } = runSuites({
      'logged.test.js': SUITE(`${logged}\n${exits}`),
      'slow.test.js': SUITE(`${logged}\ntest('waits', async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });\n${exits}`),
      'printed.test.js': SUITE("console.error('Error: printed not thrown');\nprocess.exit(3);\ntest('never reached', () => {});"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    for (const suite of ['test/logged.test.js', 'test/slow.test.js', 'test/printed.test.js']) {
      const line = failures.split('\n').find((l) => l.includes(`run ${suite}`));
      expect(line, `${suite}: named run with its exit, got: ${failures}`).toContain('exited with code 3');
      expect(line, `${suite}: the print is not the failure's message`).not.toMatch(new RegExp(`run ${suite}: (?:Error: )?(?:handled and logged|printed not thrown)`));
      expect(failures, `${suite}: never named load`).not.toContain(`load ${suite}`);
    }
  });

  // A clean exit with cases still owed is a death, never a pass. An exit before Node
  // reports any case leaves the same events as a file with no case, so it reads as one.
  test('a suite that calls process.exit(0) mid-run fails the run: as run <suite> once a slow case has passed, from a case or from an after hook beside a second slow case, and as one whole-suite failure right after a quick pass', () => {
    const slow = "test('waits', async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });";
    const shapes = {
      'mid.test.js': SUITE(`test('first', () => {});\n${slow}\ntest('exits', () => { process.exit(0); });\ntest('never', () => { throw new Error('must not run'); });`),
      'hook.test.js': SUITE(`${slow}
describe('both', { concurrency: true }, () => {
  ${slow.replace("'waits'", "'waits more'")}
  describe('quick', () => {
    after(() => { process.exit(0); });
    test('quick case', () => {});
  });
});`),
      'quick.test.js': SUITE("test('first', () => {});\ntest('exits', () => { process.exit(0); });"),
    };
    for (const [file, body] of Object.entries(shapes)) {
      const suite = `test/${file}`;
      const { code, output } = runSuites({ [file]: body });
      expect(code, `${suite}: exit 1, got: ${output}`).toBe(1);
      const failures = failuresOf(output);
      expect(failures, `${suite}: a Failures: list, got: ${output}`).toBeTruthy();
      if (file === 'quick.test.js') {
        const named = failures.split('\n').filter((l) => l.includes(suite));
        expect(named, `${suite}: named once, got: ${failures}`).toHaveLength(1);
        expect(named[0], `${suite}: a whole-suite failure, no case's`).not.toContain(`${suite} ›`);
        continue;
      }
      const line = failures.split('\n').find((l) => l.includes(`run ${suite}`));
      expect(line, `${suite}: named run, got: ${failures}`).toMatch(/exited|without a result/);
      expect(failures, `${suite}: never named empty`).not.toContain(`empty ${suite}`);
      if (file === 'mid.test.js') expect(blockOf(output, suite), `${suite}: the first case still passed`).toContain('  ✓ first');
    }
  });

  test('a failure whose message holds two lines lists the first on its line and the rest indented under it', () => {
    const { code, output } = runSuites({
      'two.test.js': SUITE("test('two lines', () => { throw new Error('first line\\nsecond line'); });"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const lines = failures.split('\n');
    const at = lines.findIndex((line) => line.includes('test/two.test.js › two lines: first line'));
    expect(at >= 0, `names the failure with its first line, got: ${failures}`).toBeTruthy();
    expect(lines[at + 1], `the second line is indented under it, got: ${failures}`).toBe('    second line');
  });

  // The totals line splits the run: a suite's own block prints above it, the
  // end-of-run skip and Failures lists below it.
  test('a two-line load error and a two-line skip reason print their second line indented, inline and in the end-of-run list', () => {
    const { code, output } = runSuites({
      'broken.test.js': "throw new Error('load first line\\nload second line');\n",
      'parked.test.js': SUITE("test('parked', { skip: 'skip first line\\nskip second line' }, () => {});"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const lines = linesOf(output);
    const totals = lines.findIndex((line) => TOTALS_LINE.test(line));
    expect(totals >= 0, `a totals line, got: ${output}`).toBeTruthy();
    for (const second of ['load second line', 'skip second line']) {
      const indented = (line) => new RegExp(`^\\s+${second}$`).test(line);
      expect(lines.slice(0, totals).some(indented), `"${second}" indented in the suite's block, got: ${output}`).toBeTruthy();
      expect(lines.slice(totals).some(indented), `"${second}" indented in the end-of-run list, got: ${output}`).toBeTruthy();
      expect(!lines.some((line) => line.startsWith(second)), `"${second}" never at column zero, got: ${output}`).toBeTruthy();
    }
  });

  // The grandchild holds the worker's pipes open for 20 s; the run ends while
  // it still lives, so the runner did not wait on them.
  test('a detached child holding a worker\'s pipes does not hold the run', () => {
    const { code, output, files } = runSuites({
      'spawner.test.js': SUITE(`
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'inherit', cwd: require('os').tmpdir() });
child.unref();
fs.writeFileSync(path.join(__dirname, '..', 'sleeper.pid'), String(child.pid));
test('leaves a sleeper behind', () => {});
`),
    }, { read: ['sleeper.pid'] });
    const pid = Number(files['sleeper.pid']);
    // A pid of 0 would signal this process group, so only a written pid is probed and killed.
    const sleeperAlive = pid > 0 && alive(pid);
    if (pid > 0) endTree(pid);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(sleeperAlive, `the run ended while the sleeper still held its pipes: ${output}`).toBeTruthy();
  });

  // SIGKILL leaves the runner no way to pass the end on, so each worker must
  // notice its parent is gone and end rather than finish its suite, even
  // between synchronous cases, as the real suites' are.
  test('a runner killed alone takes its workers with it', async () => {
    const { root } = mkFixture({
      'waiter.test.js': SUITE(`
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
// Without these each case's mark would die on EPIPE once the runner is gone,
// ending the worker whether or not it noticed the disconnect.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
fs.writeFileSync(path.join(__dirname, '..', 'worker.pid'), String(process.pid));
for (let n = 1; n <= 10; n++) {
  test(\`blocks a second \${n}\`, () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']); });
}
`),
    });
    const pidFile = path.join(root, 'worker.pid');
    const runner = start(process.execPath, [RUNNER], { cwd: root });
    try {
      const wrote = await until(() => pidIn(pidFile) > 0);
      expect(wrote, 'the worker wrote its pid').toBeTruthy();
      const pid = pidIn(pidFile);
      expect(pid !== runner.pid, 'the suite ran in a worker, not in the runner itself').toBeTruthy();
      runner.child.kill('SIGKILL');
      const gone = await until(() => !alive(pid));
      if (!gone) endTree(pid);
      expect(gone, `worker ${pid} outlived its runner`).toBeTruthy();
    } finally {
      await runner.end('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Off Windows a worker leads its own group, which a signal to the runner's
  // never reaches, and a worker spinning in a synchronous loop never hears its
  // disconnect: only the runner can end it and the child its suite started.
  test('a runner ended by SIGTERM ends each worker and its suite\'s child, and exits 143', { skip: IS_WINDOWS && 'a Windows worker shares the runner\'s console, not a process group' }, async () => {
    const { root } = mkFixture({
      'spinner.test.js': SUITE(`
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(__dirname, '..', 'child.pid'), String(child.pid));
fs.writeFileSync(path.join(__dirname, '..', 'worker.pid'), String(process.pid));
for (;;) {}
`),
    });
    const pidOf = (name) => pidIn(path.join(root, name));
    const runner = start(process.execPath, [RUNNER], { cwd: root });
    try {
      expect(await until(() => pidOf('worker.pid') > 0), 'the worker wrote its pid').toBeTruthy();
      // A pid of 0 would signal this process group, so only written pids are probed and ended.
      const pids = [pidOf('worker.pid'), pidOf('child.pid')];
      expect(pids[1] > 0, 'the suite wrote its child\'s pid').toBeTruthy();
      runner.child.kill('SIGTERM');
      const { status } = await runner.done;
      const gone = await until(() => pids.every((pid) => !alive(pid)));
      const survivors = pids.filter(alive);
      for (const pid of survivors) endTree(pid);
      expect(gone, `outlived their runner: ${survivors.join(', ')}`).toBeTruthy();
      expect(status, 'the runner\'s exit code').toBe(143);
    } finally {
      await runner.end('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // The worker ignores INT and TERM and never ends itself on its parent's exit,
  // so it goes only by the runner's KILL; the TERM lands while the ladder climbs.
  test('a second signal while the runner is stopping KILLs each worker at once, and the runner exits by that signal', { skip: IS_WINDOWS && 'a Windows worker shares the runner\'s console, not a process group' }, async () => {
    const { root } = mkFixture({
      'stubborn.test.js': SUITE(`
const fs = require('fs');
const path = require('path');
for (const event of ['SIGINT', 'SIGTERM', 'disconnect']) process.removeAllListeners(event);
process.on('SIGINT', () => fs.writeFileSync(path.join(__dirname, '..', 'interrupted'), ''));
process.on('SIGTERM', () => {});
fs.writeFileSync(path.join(__dirname, '..', 'worker.pid'), String(process.pid));
test('holds its worker', () => new Promise(() => { setInterval(() => {}, 1000); }));
`),
    });
    const pidFile = path.join(root, 'worker.pid');
    const runner = start(process.execPath, [RUNNER], { cwd: root });
    try {
      expect(await until(() => pidIn(pidFile) > 0), 'the worker wrote its pid').toBeTruthy();
      // A pid of 0 would signal this process group, so only a written pid is probed and ended.
      const pid = pidIn(pidFile);
      runner.child.kill('SIGINT');
      expect(await until(() => fs.existsSync(path.join(root, 'interrupted'))), 'the runner\'s ladder sent the worker SIGINT').toBeTruthy();
      runner.child.kill('SIGTERM');
      const { status } = await runner.done;
      const gone = await until(() => !alive(pid));
      if (!gone) endTree(pid, 'SIGKILL');
      expect(gone, `worker ${pid} outlived its runner`).toBeTruthy();
      expect(status, 'the runner exits by the second signal').toBe(143);
    } finally {
      await runner.end('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // The worker ends on the first SIGINT and leaves the live set, while the child
  // it started in its group ignores INT and TERM, so the group outlives the worker.
  test('a second signal KILLs the group of a worker that already exited on the first, and the runner exits by that signal', { skip: IS_WINDOWS && 'a Windows worker shares the runner\'s console, not a process group' }, async () => {
    const { root } = mkFixture({
      'leaver.test.js': SUITE(`
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const out = (name) => path.join(__dirname, '..', name);
const script = [
  \`process.on('SIGINT', () => require('fs').writeFileSync(\${JSON.stringify(out('interrupted'))}, ''));\`,
  "process.on('SIGTERM', () => {});",
  \`require('fs').writeFileSync(\${JSON.stringify(out('child.pid'))}, String(process.pid));\`,
  'setInterval(() => {}, 1000);',
].join('\\n');
spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
fs.writeFileSync(out('worker.pid'), String(process.pid));
test('holds its worker', () => new Promise(() => { setInterval(() => {}, 1000); }));
`),
    });
    const pidOf = (name) => pidIn(path.join(root, name));
    const runner = start(process.execPath, [RUNNER], { cwd: root });
    try {
      expect(await until(() => pidOf('worker.pid') > 0 && pidOf('child.pid') > 0), 'the worker and its child wrote their pids').toBeTruthy();
      // A pid of 0 would signal this process group, so only written pids are probed and ended.
      const [worker, child] = [pidOf('worker.pid'), pidOf('child.pid')];
      runner.child.kill('SIGINT');
      expect(await until(() => fs.existsSync(path.join(root, 'interrupted'))), 'the runner\'s ladder sent the child SIGINT').toBeTruthy();
      expect(await until(() => !alive(worker)), `worker ${worker} ended on SIGINT`).toBeTruthy();
      runner.child.kill('SIGTERM');
      const { status } = await runner.done;
      const gone = await until(() => !alive(child));
      if (!gone) endTree(child, 'SIGKILL');
      expect(gone, `child ${child} outlived its runner`).toBeTruthy();
      expect(status, 'the runner exits by the second signal').toBe(143);
    } finally {
      await runner.end('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Known counts across three workers, one failing case among them.
  const COUNTED = {
    'alpha.test.js': SUITE("test('alpha case', () => {});"),
    'beta.test.js': SUITE(`
test('beta case one', () => {});
test('beta case two', () => {});
test('beta case three', () => { throw new Error('beta breaks'); });
`),
    'gamma.test.js': SUITE(`
for (const n of [1, 2, 3, 4]) test(\`gamma case \${n}\`, () => {});
`),
  };
  const TOTALS = /^7 passed, 1 failed \(\d+(?:\.\d+)?s, 3 suites\)$/m;

  test('the totals line sums every worker in its usual shape and a failure exits 1', () => {
    const { code, output } = runSuites(COUNTED);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(TOTALS.test(stripVTControlCharacters(output)), `"7 passed, 1 failed (Ns, 3 suites)", got: ${output}`).toBeTruthy();
    expect(stripVTControlCharacters(output).includes('test/beta.test.js › beta case three: beta breaks'), `lists the failure, got: ${output}`).toBeTruthy();
  });

  test('a failing case c in test/hooks/x.test.js: the heading and the failure list name the suite by its path from the start folder', () => {
    const { code, output } = runSuites({
      'hooks/x.test.js': SUITE("test('c', () => { throw new Error('c breaks'); });", '../lib/harness'),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).includes('▶ test/hooks/x.test.js'), `the heading, got: ${output}`).toBeTruthy();
    expect(listsOf(output).some((line) => line.includes('test/hooks/x.test.js › c: c breaks')), `the failure list, got: ${output}`).toBeTruthy();
  });
});

// TEST_DEADLINE, in seconds, bounds each suite file for one run.
describe('run.js: a per-file deadline', () => {
  // A suite that runs `inner`, prints, then holds its worker open for good.
  const HANGS = (inner = '') => SUITE(`${inner}
console.error('still waiting');
test('never ends', () => new Promise(() => { setInterval(() => {}, 1000); }));
`);

  // The tail runs one suite at a time, so the later file runs only once the hung one has ended.
  test('a suite that never exits under TEST_DEADLINE=2 is one timed-out failure and the next file still runs', () => {
    const { code, output } = runSuites({
      'a-hang.test.js': HANGS(),
      'b-after.test.js': SUITE("test('after case', () => {});"),
    }, { serial: ['test/a-hang.test.js', 'test/b-after.test.js'], env: { TEST_DEADLINE: '2' } });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(plain.includes('after case'), `the file after it ran, got: ${output}`).toBeTruthy();
    expect(/^1 passed, 1 failed \(/m.test(plain), `the hung file is one failure, got: ${output}`).toBeTruthy();
    const failures = plain.split('Failures:')[1];
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const timedOut = failures.split('\n').find((line) => line.includes('timed out after 2s without a result'));
    expect(timedOut && timedOut.includes('test/a-hang.test.js'), `names test/a-hang.test.js as timed out after 2s, got: ${failures}`).toBeTruthy();
    expect(failures.includes('still waiting'), `quotes the last thing it wrote, got: ${failures}`).toBeTruthy();
  });

  // The child holds no pipe of the worker's, so only an end of the worker's group ends it.
  test('a timed-out suite\'s own child process is ended with it', async () => {
    const { code, output, files } = runSuites({
      'hang.test.js': HANGS(`
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(__dirname, '..', 'child.pid'), String(child.pid));
`),
    }, { env: { TEST_DEADLINE: '2' }, read: ['child.pid'] });
    const pid = Number(files['child.pid']);
    // A pid of 0 would signal this process group, so only a written pid is probed and killed.
    expect(pid > 0, `the suite wrote its child's pid, got: ${output}`).toBeTruthy();
    const gone = await until(() => !alive(pid));
    if (!gone) endTree(pid);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(gone, `child ${pid} outlived its timed-out suite`).toBeTruthy();
  });

  // Read as milliseconds, 120 would end the suite mid-pause; a deadline timer
  // left running would hold the run past the spawn deadline.
  test('a suite that ends inside its deadline reports its own result', () => {
    const { code, output } = runSuites({
      'steady.test.js': SUITE(`
test('passes after a pause', async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });
test('breaks', () => { throw new Error('steady breaks'); });
`),
    }, { env: { TEST_DEADLINE: '120' } });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(/^1 passed, 1 failed \(/m.test(plain), `"1 passed, 1 failed", got: ${output}`).toBeTruthy();
    expect(plain.includes('test/steady.test.js › breaks: steady breaks'), `lists its own failure, got: ${output}`).toBeTruthy();
  });

  // 2147484 seconds is past the longest delay a node timer holds.
  test('a TEST_DEADLINE of abc, 0 or past a node timer fails the run at the start naming it, and runs no suite', () => {
    for (const value of ['abc', '0', '2147484']) {
      const { code, output } = runSuites({
        'alpha.test.js': SUITE("test('alpha case', () => {});"),
      }, { env: { TEST_DEADLINE: value } });
      const plain = stripVTControlCharacters(output);
      expect(code !== 0 && code !== null, `${value}: a non-zero exit, got ${code}: ${output}`).toBeTruthy();
      expect(plain.includes(`TEST_DEADLINE must be a positive number of seconds, got ${value}`), `${value}: the start failure line, got: ${output}`).toBeTruthy();
      expect(!plain.includes('▶') && !plain.includes('alpha case'), `${value}: no suite ran, got: ${output}`).toBeTruthy();
    }
  });
});

// Every suite runs on Node's runner and prints one line per case, under a
// heading per describe path; a suite that cannot run whole is one failure.
describe('run.js: a suite\'s block and its failures', () => {
  // A test('a') running `body`, inside describe('inner'), inside describe('outer').
  const NESTED = (body) => SUITE(`
describe('outer', () => {
  describe('inner', () => {
    test('a', () => { ${body} });
  });
});`);
  // A blank line before a heading, or closing the block, is the runner's own
  // spacing, so it is dropped; any other blank is read.
  const readBlock = (block) => block.filter((line, i) => line !== '' || !(block[i + 1] === undefined || block[i + 1].startsWith('[')));

  test('a passing suite prints no skip note and no Failures block', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('all good', () => {
  test('one', () => {});
  test('two', () => {});
});`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^2 passed, 0 failed \(/m.test(plain), `"2 passed, 0 failed", got: ${output}`).toBeTruthy();
    expect(plain, 'no skip note when nothing skipped').not.toContain('skipped');
    expect(plain, 'no Failures: block').not.toContain('Failures:');
  });

  test('a passing test a inside describe outer and inner prints the heading [outer › inner] and ✓ a under it', () => {
    const { code, output } = runSuites({ 'a.test.js': NESTED('') });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const block = blockOf(output, 'test/a.test.js');
    expect(block.filter((line) => line.startsWith('[')).join('\n'), `the one heading, got: ${output}`).toBe('[outer › inner]');
    const after = block.slice(block.indexOf('[outer › inner]') + 1).filter(Boolean);
    expect(after[0], `the case line under the heading, got: ${output}`).toBe('  ✓ a');
  });

  test('that test failing prints ✗ a, its message, then a frame naming the suite file, and the list names it by its whole path', () => {
    const { code, output } = runSuites({ 'a.test.js': NESTED("throw new Error('the widget broke');") });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const block = blockOf(output, 'test/a.test.js');
    const at = block.indexOf('  ✗ a');
    expect(at >= 0, `the case line, got: ${output}`).toBeTruthy();
    expect((block[at + 1] || '').trim(), `the message under it, got: ${output}`).toBe('the widget broke');
    expect(block.slice(at + 2).some((line) => /a\.test\.js:\d+:\d+/.test(line)), `then the suite file's frame, got: ${output}`).toBeTruthy();
    expect(listsOf(output).some((line) => line.includes('test/a.test.js › outer › inner › a: the widget broke')), `the failure list, got: ${output}`).toBeTruthy();
  });

  test('a case skipped with a reason and a todo case each print a ⊘ line with the reason and sit in the skip list by full name', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('outer', () => {
  test('runs', () => {});
  test('gated', { skip: 'no board' }, () => { throw new Error('must not run'); });
  test.todo('later');
});`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^1 passed, 0 failed, 2 cases skipped \(/m.test(plain), `"1 passed, 0 failed, 2 cases skipped", got: ${output}`).toBeTruthy();
    const block = blockOf(output, 'test/a.test.js');
    for (const line of ['  ⊘ gated: no board', '  ⊘ later: todo']) {
      expect(block.includes(line), `the block holds "${line}", got: ${output}`).toBeTruthy();
    }
    for (const name of ['test/a.test.js › outer › gated: no board', 'test/a.test.js › outer › later: todo']) {
      expect(listsOf(output).some((line) => line.includes(name)), `the skip list names "${name}", got: ${output}`).toBeTruthy();
    }
    expect(!plain.includes('must not run'), 'the skipped case never ran').toBeTruthy();
  });

  test('a top-level test with no describe prints its line with no heading, and a list names it <suite> › name', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('a', () => {});
test('b', () => { throw new Error('b broke'); });`),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const block = blockOf(output, 'test/a.test.js');
    expect(block.includes('  ✓ a'), `the case line, got: ${output}`).toBeTruthy();
    expect(!block.some((line) => line.startsWith('[')), `no heading, got: ${output}`).toBeTruthy();
    expect(listsOf(output).some((line) => line.includes('test/a.test.js › b: b broke')), `the failure list, got: ${output}`).toBeTruthy();
  });

  test('a heading prints each time the describe path changes, and a top-level case after a headed one gets a blank line and no heading', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('outer', () => {
  test('x', () => {});
  describe('inner', () => { test('a', () => {}); });
  test('y', () => {});
});
test('z', () => {});`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const read = readBlock(blockOf(output, 'test/a.test.js'));
    expect(read.join('\n'), `the block, got: ${output}`).toBe(['[outer]', '  ✓ x', '[outer › inner]', '  ✓ a', '[outer]', '  ✓ y', '', '  ✓ z'].join('\n'));
  });

  test('a test holding a subtest heads it [parent], then ✓ kid, a blank line, ✓ parent, and counts 2 passed', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE("test('parent', async (t) => { await t.test('kid', () => {}); });"),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const read = readBlock(blockOf(output, 'test/a.test.js'));
    expect(read.join('\n'), `the block, got: ${output}`).toBe(['[parent]', '  ✓ kid', '', '  ✓ parent'].join('\n'));
    expect(/^2 passed, 0 failed \(/m.test(stripVTControlCharacters(output)), `"2 passed, 0 failed", got: ${output}`).toBeTruthy();
  });

  // Node fails the parent too, for the subtest's sake; that is no second failure.
  test('a test holding one failing subtest counts one failure, the subtest\'s, and the failure list names it once', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE("test('parent', async (t) => { await t.test('kid', () => { throw new Error('kid broke'); }); });"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output), 'the totals').toMatch(/^0 passed, 1 failed \(/m);
    const named = listsOf(output).filter((line) => line.includes('test/a.test.js ›'));
    expect(named, `one failure line, got: ${output}`).toHaveLength(1);
    expect(named[0], 'it names the subtest under its parent').toContain('test/a.test.js › parent › kid: kid broke');
  });

  test('a test holding two subtests, one failing, counts one failure and the passing subtest as passed', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('parent', async (t) => {
  await t.test('kid one', () => {});
  await t.test('kid two', () => { throw new Error('kid two broke'); });
});`),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output), 'the totals').toMatch(/^1 passed, 1 failed \(/m);
    const named = listsOf(output).filter((line) => line.includes('test/a.test.js ›'));
    expect(named, `one failure line, got: ${output}`).toHaveLength(1);
    expect(named[0], 'it names the failing subtest').toContain('kid two broke');
  });

  test('a case\'s t.diagnostic(\'note\') prints in the block under that case\'s line, and Node\'s own totals lines do not print', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('a', (t) => { t.diagnostic('note'); });
test('b', () => {});`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(blockOf(output, 'test/a.test.js').filter(Boolean), `the block, got: ${output}`).toEqual(['  ✓ a', '    note', '  ✓ b']);
    const nodeTotals = linesOf(output).filter((line) => /^\W*(?:tests|pass) \d+$/.test(line.trim()));
    expect(nodeTotals, `no tests or pass line of Node's, got: ${output}`).toEqual([]);
  });

  test('a describe whose before hook throws prints the hook\'s message in the block and in the failure list', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('hooked', () => {
  before(() => { throw new Error('before blew'); });
  test('a', () => {});
});`),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(blockOf(output, 'test/a.test.js').some((line) => line.includes('before blew')), `the block, got: ${output}`).toBeTruthy();
    expect(listsOf(output).some((line) => line.includes('test/a.test.js') && line.includes('before blew')), `the failure list, got: ${output}`).toBeTruthy();
  });

  test('a suite whose only case is skipped with a reason does not fail', () => {
    const { code, output } = runSuites({ 'a.test.js': SUITE("test('gated', { skip: 'no board' }, () => {});") });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^0 passed, 0 failed, 1 case skipped \(/m.test(stripVTControlCharacters(output)), `the one skip, got: ${output}`).toBeTruthy();
  });

  test('a suite file that registers no case exits 1 and is listed as empty <suite>, registered no test', () => {
    const { code, output } = runSuites({ 'empty.test.js': SUITE('') });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output), 'the totals').toMatch(/^0 passed, 1 failed \(/m);
    const listed = listsOf(output).find((line) => line.includes('empty test/empty.test.js'));
    expect(listed, `the failure list names "empty test/empty.test.js", got: ${output}`).toContain('registered no test');
  });

  test('a suite in the old shape, one ending on the old self-run line and one only exporting its runner, is listed as a failure and counts no pass', () => {
    const { code, output } = runSuites({
      'old-self-run.test.js': OLD_SHAPE(true),
      'old-export.test.js': OLD_SHAPE(false),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output), 'the totals').toMatch(/^0 passed, 2 failed \(/m);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    for (const name of ['test/old-self-run.test.js', 'test/old-export.test.js']) {
      expect(failures, `the failure list names ${name}`).toContain(name);
    }
    expect(stripVTControlCharacters(output), 'no old case ran').not.toContain('✓ an old case');
  });

  test('a suite that throws at load, or will not parse, is one failure named load with its message', () => {
    const { code, output } = runSuites({
      'throws.test.js': SUITE(`
throw new Error('broke before any test');
test('never reached', () => {});`),
      'unparsed.test.js': 'const value = {\n',
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const load = failures.split('\n').find((line) => line.includes('load test/throws.test.js'));
    expect(load, `names "load test/throws.test.js" with the message, got: ${failures}`).toContain('broke before any test');
    expect(failures, 'names the unparsed file as load').toContain('load test/unparsed.test.js');
  });

  test('a load error thrown as a class whose name does not end in Error is load <suite> with its message', () => {
    const { code, output } = runSuites({
      'foo.test.js': SUITE(`
class FooFailure extends Error { constructor(m) { super(m); this.name = 'FooFailure'; } }
throw new FooFailure('custom');
test('never reached', () => {});`),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const load = failures.split('\n').find((line) => line.includes('load test/foo.test.js'));
    expect(load, `names "load test/foo.test.js" with the message, got: ${failures}`).toMatch(/load test\/foo\.test\.js: .*custom/);
  });

  // Each throw comes from a timer that fires once its case has ended.
  test('a suite whose cases pass and that then fails late, by a timer\'s throw or an unhandled rejection, is named run <suite> with the message', () => {
    const { code, output } = runSuites({
      'timer.test.js': SUITE("test('passes', () => { setTimeout(() => { throw new Error('a timer blew late'); }); });"),
      'rejects.test.js': SUITE("test('passes', () => { setTimeout(() => { Promise.reject(new Error('a promise rejected late')); }); });"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output), 'the totals').toMatch(/^2 passed, 2 failed \(/m);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    for (const [suite, message] of [['test/timer.test.js', 'a timer blew late'], ['test/rejects.test.js', 'a promise rejected late']]) {
      const block = blockOf(output, suite);
      expect(block, `${suite}: its case passed`).toContain('  ✓ passes');
      expect(block.some((line) => line.includes(message)), `${suite}: the message in its block, got: ${output}`).toBeTruthy();
      const line = failures.split('\n').find((l) => l.includes(`run ${suite}`));
      expect(line, `${suite}: named run with the message, got: ${failures}`).toContain(message);
      expect(failures, `${suite}: never named load`).not.toContain(`load ${suite}`);
    }
  });

  test('a late error of two lines lists run <suite>: late one, with no Error: prefix, and late two indented under it', () => {
    const { code, output } = runSuites({
      'late.test.js': SUITE("test('passes', () => { setTimeout(() => { throw new Error('late one\\nlate two'); }); });"),
    });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const lines = failures.split('\n');
    const at = lines.findIndex((line) => line.includes('run test/late.test.js'));
    expect(lines[at], `the failure line, got: ${failures}`).toMatch(/run test\/late\.test\.js: late one$/);
    expect(lines[at + 1], `the second line is indented under it, got: ${failures}`).toBe('    late two');
  });

  test('a suite\'s stdout and stderr print under its header at the case indent', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('talks', () => {
  console.log('said on stdout');
  console.error('said on stderr');
});`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const lines = linesOf(output);
    const header = lines.indexOf('▶ test/a.test.js');
    expect(header >= 0, `prints the header, got: ${output}`).toBeTruthy();
    for (const said of ['said on stdout', 'said on stderr']) {
      expect(lines.indexOf(`    ${said}`) > header, `"${said}" prints under the header at the case indent, got: ${output}`).toBeTruthy();
    }
  });

  // Node's own summary block, printed by a test, read as the suite's own text.
  test('a suite whose test prints node\'s whole tap block prints every line of it at the case indent', () => {
    const block = ['# tests 1', '# suites 0', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 1'];
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('prints a block', () => {
  console.log(${JSON.stringify(block.join('\n'))});
});`),
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const lines = linesOf(output);
    for (const line of block) {
      expect(lines.includes(`    ${line}`), `"${line}" at the case indent, got: ${output}`).toBeTruthy();
    }
    expect(!lines.some((line) => line.startsWith('# tests')), `no line starts with "# tests", got: ${output}`).toBeTruthy();
  });

  test('a todo test that throws is a case skip named todo, never a failure', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
test('works', () => {});
test.todo('pending case', () => { throw new Error('not built yet'); });`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^1 passed, 0 failed, 1 case skipped \(/m.test(plain), `"1 passed, 0 failed, 1 case skipped", got: ${output}`).toBeTruthy();
    expect(plain.includes('test/a.test.js › pending case: todo'), `lists the todo, got: ${output}`).toBeTruthy();
  });

  test('a describe body that throws is one failure named by the describe', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('the broken group', () => {
  throw new Error('group exploded');
});`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(/^0 passed, 1 failed \(/m.test(plain), `"0 passed, 1 failed", got: ${output}`).toBeTruthy();
    const failures = failuresOf(output);
    expect(failures, `a Failures: list, got: ${output}`).toBeTruthy();
    const broke = failures.split('\n').find((line) => line.includes('test/a.test.js › the broken group'));
    expect(broke && broke.includes('group exploded'), `names the describe with the message, got: ${failures}`).toBeTruthy();
  });

  test('a todo describe is no skip itself; its passing test is one case skip named todo', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('the pending group', { todo: true }, () => {
  test('inner case', () => {});
});`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^0 passed, 0 failed, 1 case skipped \(/m.test(plain), `"0 passed, 0 failed, 1 case skipped", got: ${output}`).toBeTruthy();
    expect(plain.includes('test/a.test.js › the pending group › inner case: todo'), `lists the inner test as todo, got: ${output}`).toBeTruthy();
    expect(!listsOf(output).some((line) => line.includes('› the pending group:')), `no skip named by the describe, got: ${output}`).toBeTruthy();
  });

  test('a describe skipped with a reason prints one ⊘ line carrying it, and the totals count none of its cases as passed or failed', () => {
    const { code, output } = runSuites({
      'a.test.js': SUITE(`
describe('the parked group', { skip: 'no board' }, () => {
  test('parked one', () => { throw new Error('must not run'); });
  test('parked two', () => { throw new Error('must not run'); });
});`),
    });
    const plain = stripVTControlCharacters(output);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(/^0 passed, 0 failed, 1 case skipped \(/m.test(plain), `"0 passed, 0 failed, 1 case skipped", got: ${output}`).toBeTruthy();
    const skipped = blockOf(output, 'test/a.test.js').filter((line) => line.includes('⊘'));
    expect(skipped.length, `one ⊘ line in the block, got: ${output}`).toBe(1);
    expect(skipped[0].includes('no board'), `it carries the reason, got: ${output}`).toBeTruthy();
    expect(!plain.includes('parked one') && !plain.includes('parked two'), `its tests are named nowhere, got: ${output}`).toBeTruthy();
  });

  // Node's runner runs nothing when started inside one of its own test files,
  // unless the runner drops the mark Node leaves in the environment.
  test('a case that starts a second workkit test in another scratch folder sees that run run its files and report them', () => {
    const inner = mkFixture({ 'inner.test.js': SUITE("test('the inner case', () => {});") });
    const { code, output, files } = runSuites({
      'outer.test.js': SUITE(`
const { spawnSync } = require('child_process');
test('starts a second run', () => {
  const res = spawnSync(process.execPath, [${JSON.stringify(CORE_BIN)}, 'test'], { cwd: ${JSON.stringify(inner.root)}, encoding: 'utf8' });
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'nested.out'), String(res.stdout) + String(res.stderr));
  expect(res.status, 'the nested run exits 0').toBe(0);
});`),
    }, { read: ['nested.out'] });
    fs.rmSync(inner.root, { recursive: true, force: true });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    const nested = linesOf(files['nested.out'] || '');
    expect(nested, `the nested run's heading, got: ${files['nested.out']}`).toContain('▶ test/inner.test.js');
    expect(nested, 'the nested case ran').toContain('  ✓ the inner case');
    expect(nested.some((line) => /^1 passed, 0 failed \(/.test(line)), `the nested totals, got: ${files['nested.out']}`).toBeTruthy();
  });
});

// A suite is any *.test.js, *.test.mjs or *.test.cjs under the start folder,
// named by the path from it, but where a rule says it is never read.
describe('run.js: finding suites', () => {
  test('src/checks/a.test.js, scripts/b.test.mjs and test/c.test.cjs in a folder with no other setup all run', () => {
    const { code, output } = runSuites({}, {
      folder: null,
      git: false,
      files: {
        'src/checks/a.test.js': SUITE("test('the src case', () => {});", HARNESS),
        'scripts/b.test.mjs': "import { test } from 'node:test';\ntest('the mjs case', () => {});\n",
        'test/c.test.cjs': "const { test } = require('node:test');\ntest('the cjs case', () => {});\n",
      },
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    for (const name of ['src/checks/a.test.js', 'scripts/b.test.mjs', 'test/c.test.cjs']) {
      expect(linesOf(output).includes(`▶ ${name}`), `${name} ran, got: ${output}`).toBeTruthy();
    }
    expect(/^3 passed, 0 failed \(\d+(?:\.\d+)?s, 3 suites\)$/m.test(stripVTControlCharacters(output)), `all three counted, got: ${output}`).toBeTruthy();
  });

  test('a suite under node_modules/, _fixtures/ or .cache/, and one named _draft.test.js, never run', () => {
    const never = SUITE("test('never read', () => { throw new Error('must not run'); });", HARNESS);
    const { code, output } = runSuites({
      'ok.test.js': SUITE("test('ok case', () => {});"),
    }, {
      files: {
        'node_modules/x.test.js': never, '_fixtures/x.test.js': never, '.cache/x.test.js': never, 'test/_draft.test.js': never,
      },
    });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(!output.includes('never read'), `none of the four ran, got: ${output}`).toBeTruthy();
    expect(/^1 passed, 0 failed \(\d+(?:\.\d+)?s, 1 suite\)$/m.test(stripVTControlCharacters(output)), `the one suite counted, got: ${output}`).toBeTruthy();
  });

  test('a sub-folder holding its own package.json: its suite never runs from the parent, and runs when the runner starts in it', () => {
    const files = {
      'sub/package.json': '{ "name": "sub", "private": true }\n',
      'sub/x.test.js': SUITE("test('the nested case', () => {});", HARNESS),
    };
    const ok = { 'ok.test.js': SUITE("test('ok case', () => {});") };
    const parent = runSuites(ok, { files });
    expect(parent.code, `from the parent: exit 0, got: ${parent.output}`).toBe(0);
    expect(parent.output.includes('ok case') && !parent.output.includes('the nested case'), `from the parent: only its own suite, got: ${parent.output}`).toBeTruthy();
    const inside = runSuites(ok, { files, cwd: 'sub' });
    expect(inside.code, `from sub/: exit 0, got: ${inside.output}`).toBe(0);
    expect(linesOf(inside.output).includes('▶ x.test.js'), `from sub/: the nested suite, named from sub/, got: ${inside.output}`).toBeTruthy();
    expect(!inside.output.includes('ok case'), `from sub/: nothing above it, got: ${inside.output}`).toBeTruthy();
  });

  test('dist/x.test.js never runs in a git work tree whose .gitignore names dist/, and runs outside any work tree', () => {
    const files = {
      '.gitignore': 'dist/\n',
      'dist/x.test.js': SUITE("test('the built case', () => {});", HARNESS),
    };
    const ok = { 'ok.test.js': SUITE("test('ok case', () => {});") };
    const tracked = runSuites(ok, { files });
    expect(tracked.code, `in git: exit 0, got: ${tracked.output}`).toBe(0);
    expect(tracked.output.includes('ok case') && !tracked.output.includes('the built case'), `in git: the ignored suite never ran, got: ${tracked.output}`).toBeTruthy();
    const loose = runSuites(ok, { files, git: false });
    expect(loose.code, `outside git: exit 0, got: ${loose.output}`).toBe(0);
    expect(loose.output.includes('ok case') && loose.output.includes('the built case'), `outside git: both ran, got: ${loose.output}`).toBeTruthy();
  });

  // git's own wording for the broken index is read from git itself, in the C locale the runner reads it in.
  test('a work tree whose git index is junk stops the run naming git\'s message, and dist/x.test.js never runs', () => {
    let said = '';
    const { code, output } = runSuites({ 'ok.test.js': SUITE("test('ok case', () => {});") }, {
      files: { '.gitignore': 'dist/\n', 'dist/x.test.js': SUITE("test('the built case', () => {});", HARNESS) },
      prepare: (root, home) => {
        fs.writeFileSync(path.join(root, '.git', 'index'), 'junk junk junk junk junk junk\n');
        const git = spawnSync('git', ['check-ignore', '-q', '.'], { cwd: root, encoding: 'utf8', env: homeEnv(home, { PATH: process.env.PATH, LC_ALL: 'C' }) });
        said = (git.stderr || '').trim().split(/\r?\n/).pop().replace(/^fatal: /, '');
      },
    });
    expect(said !== '', 'git itself refused the junk index').toBeTruthy();
    expect(code !== 0 && code !== null, `a non-zero exit, got ${code}: ${output}`).toBeTruthy();
    expect(output.includes(said), `names git's message "${said}", got: ${output}`).toBeTruthy();
    expect(!output.includes('the built case') && !output.includes('ok case'), `no suite ran, got: ${output}`).toBeTruthy();
  });

  test('a start folder inside a git-ignored folder, one level or two down, holds no suite: No test file found and no stack', () => {
    const files = {
      '.gitignore': 'ignoredroot/\n',
      'ignoredroot/test/a.test.js': SUITE("test('the one-level case', () => {});", HARNESS),
      'ignoredroot/sub/test/a.test.js': SUITE("test('the two-level case', () => {});", HARNESS),
    };
    for (const cwd of ['ignoredroot', 'ignoredroot/sub']) {
      const { code, output } = runSuites({}, { folder: null, files, cwd });
      expect(code, `${cwd}: exit 1, got: ${output}`).toBe(1);
      expect(linesOf(output).some((line) => line.endsWith('No test file found (*.test.js, *.test.mjs, *.test.cjs)')), `${cwd}: the start failure, got: ${output}`).toBeTruthy();
      expect(!linesOf(output).some((line) => line.trimStart().startsWith('at ')), `${cwd}: no stack line, got: ${output}`).toBeTruthy();
      expect(!output.includes('level case'), `${cwd}: no suite ran, got: ${output}`).toBeTruthy();
    }
  });

  test('suiteName over a Windows root and file is the path from the root with forward slashes', () => {
    expect(suiteName('C:\\repo', 'C:\\repo\\test\\hooks\\x.test.js', path.win32)).toBe('test/hooks/x.test.js');
  });

  test('test/lib/x.test.js runs', () => {
    const { code, output } = runSuites({ 'lib/x.test.js': SUITE("test('the lib case', () => {});", './harness') });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(linesOf(output).includes('▶ test/lib/x.test.js') && output.includes('the lib case'), `the lib suite ran, got: ${output}`).toBeTruthy();
  });

  test('suites under tests/ run', () => {
    const { code, output } = runSuites({
      'legacy.test.js': SUITE("test('the tests/ case', () => {});"),
    }, { folder: 'tests' });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(linesOf(output).includes('▶ tests/legacy.test.js') && output.includes('the tests/ case'), `the suite under tests/ ran, got: ${output}`).toBeTruthy();
  });
});

// `npm test` runs the Node suites, then `claude plugin test` over the hooks
// module's *.test.ts files, and reports both halves.
describe('run.js: the mod half', () => {
  test('a whole run reports the mod half beside the Node suites', { skip: !which('claude') && 'no claude binary on this machine' }, () => {
    const { code, output } = runModHalf(process.env.PATH);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('the node case'), `the Node half ran, got: ${output}`).toBeTruthy();
    expect(/mod half/.test(output), `the mod half is named, got: ${output}`).toBeTruthy();
    expect(output.includes('the mod case'), `the mod suite ran, got: ${output}`).toBeTruthy();
    const lines = linesOf(output);
    for (const said of ['    (pass) the mod case', '    Ran 1 test across 1 file.']) {
      expect(lines.some((line) => line.startsWith(said)), `"${said.trim()}" at the case indent, got: ${output}`).toBeTruthy();
    }
    const half = lines.slice(lines.findIndex((line) => line.includes('▶ mod half')) + 1, lines.findIndex((line) => TOTALS_LINE.test(line)));
    expect(half.length && half.every((line) => line === '' || /^\s/.test(line)), `no mod half line at column zero, got: ${output}`).toBeTruthy();
  });

  test('with no claude binary the mod half reads skipped with its reason and the Node half still runs', () => {
    const tmp = mkTmp('runner-noclaude-');
    // node's own folder beside the built PATH, so the runner's node is the real
    // one on either platform (the gh-stub world without gh does the same).
    const PATH = joinPath(basePathWithout(tmp, 'claude'), NODE_DIR);
    expect(!which('claude', PATH), 'the fixture PATH holds no claude').toBeTruthy();
    const { code, output } = runModHalf(PATH);
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(code, `a skip keeps the run green, got: ${output}`).toBe(0);
    expect(output.includes('the node case'), `the Node half ran, got: ${output}`).toBeTruthy();
    expect(!output.includes('the mod case'), 'the mod suite did not run').toBeTruthy();
    const skipLine = output.split('\n').find((l) => /mod half/.test(l) && /skipped|\u2298/.test(l) && /claude/.test(l));
    expect(skipLine, `a skip line names the mod half and claude as the reason, got: ${output}`).toBeTruthy();
  });
});

describe('run.js: a suite runs alone by file', () => {
  const alone = (body) => {
    const { root } = mkFixture({ 'a.test.js': body }, { git: false });
    const res = spawnSync(process.execPath, [path.join('test', 'a.test.js')], {
      cwd: root, encoding: 'utf8', env: aloneEnv(), timeout: SPAWN_DEADLINE,
    });
    fs.rmSync(root, { recursive: true, force: true });
    return { code: res.status, output: stripVTControlCharacters((res.stdout || '') + (res.stderr || '')) };
  };

  test('a suite run as node <file> runs its cases, exits 0 when all pass and 1 when one fails', () => {
    const passing = alone(SUITE("test('first case', () => {});\ntest('second case', () => {});"));
    expect(passing.code, `all pass: exit 0, got: ${passing.output}`).toBe(0);
    for (const name of ['first case', 'second case']) expect(passing.output, `all pass: ${name} ran`).toContain(name);
    const failing = alone(SUITE("test('fine case', () => {});\ntest('broken case', () => { throw new Error('the case broke'); });"));
    expect(failing.code, `one fails: exit 1, got: ${failing.output}`).toBe(1);
    expect(failing.output, 'one fails: its message printed').toContain('the case broke');
  });
});
