/* eslint-disable no-console */
// Tests for workflow/test/run.js, the kit's suite runner tests/run.js hands off
// to: a named skip stays green and a real throw fails, paths narrow a run, suites
// run whole in a worker pool with a serial tail after the wave, a crashed,
// unloadable or orphaned worker fails or dies loudly, and every suite runs by file.

const path = require('path');
const fs = require('fs');
const { stripVTControlCharacters } = require('util');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, selfRun, summary,
} = require('./lib/harness');
const { findSuites, POOL } = require('./lib/suites');
const { mkTmp } = require('./lib/scratch');
const { which, basePathWithout, joinPath, NODE_DIR } = require('./lib/platform');
const { SPAWN_DEADLINE, until, alive } = require('./lib/process');

const KIT_TEST = path.join(__dirname, '..', 'workflow', 'test');
const RUNNER = path.join(KIT_TEST, 'run.js');

// The fixture's serial tail: every fixture names its own (none by default).
const writeSerial = (dir, serial) => {
  fs.writeFileSync(path.join(dir, 'lib', 'serial.js'), `module.exports = { SERIAL: ${JSON.stringify(serial)} };\n`);
};

// A throwaway repo whose tests/ folder holds `suites` (file name to body) and
// `serial` as its tail, run by the kit's runner from the repo root: its lib/
// holds the serial list and the harness as a repo keeps it, a re-export of the kit's.
const mkFixture = (suites, serial = []) => {
  const root = mkTmp('runner-');
  const dir = path.join(root, 'tests');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(dir, 'lib', 'harness.js'), `module.exports = require(${JSON.stringify(path.join(KIT_TEST, 'lib', 'harness.js'))});\n`);
  writeSerial(dir, serial);
  for (const [name, body] of Object.entries(suites)) fs.writeFileSync(path.join(dir, name), body);
  return { root, dir };
};

// The fixture run from its root with the arguments `args(root)` returns; `read`
// lists files under the root returned as `files` (null when absent) before it
// is removed. `stderr` is the runner's alone; `output` is both streams.
const runSuites = (suites, { args = () => [], serial = [], read = [] } = {}) => {
  const { root } = mkFixture(suites, serial);
  const res = spawnSync('node', [RUNNER, ...args(root)], { cwd: root, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  const files = Object.fromEntries(read.map((name) => {
    const file = path.join(root, name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
  }));
  fs.rmSync(root, { recursive: true, force: true });
  return { code: res.status, output: (res.stdout || '') + (res.stderr || ''), stderr: res.stderr || '', files };
};

const runWithSuite = (body) => runSuites({ 'fixture.test.js': body });

// A throwaway plugin repo for the mod half: one Node suite under tests/, and a
// hooks module with one passing tests/mods/*.test.ts, run whole through the real runner
// on `PATH`.
const runModHalf = (PATH) => {
  const { root, dir } = mkFixture({ 'node.test.js': SUITE("  await test('the node case', () => { assert(true); });") });
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

const linesOf = (output) => stripVTControlCharacters(output).split(/\r?\n/);

// Fixture-side helpers for suites that meet across processes: the fixture
// root, a sleep, a marker file, and a wait for another suite's marker that
// gives up (false) after five seconds, so a runner that never overlaps them fails.
const MEET = `
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const mark = (name, text = '') => fs.appendFileSync(path.join(root, name), text);
  const waitFor = async (name) => {
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(path.join(root, name))) return true;
      await sleep(100);
    }
    return false;
  };
`;

const SELF_RUN = /^if \(require\.main === module\) selfRun\(/m;

const SUITE = (inner) => `
const { test, assert, skip, skipSuite, summary } = require('./lib/harness');
const run = async () => {
${inner}
};
module.exports = async () => { await run(); return summary(); };
`;

const run = async () => {
  group('run.js: a suite that cannot run here');

  await test('a skipped suite names its reason and keeps the run green', () => {
    const { code, output } = runWithSuite(SUITE(`
  skipSuite('needs a thing this machine lacks');
  await test('never reached', () => { assert(false, 'must not run'); });
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('needs a thing this machine lacks'), `states the reason, got: ${output}`);
    assert(output.includes('1 suite skipped'), `counts the skip, got: ${output}`);
    assert(!output.includes('must not run'), 'its cases never ran');
  });

  await test('a suite that throws for any other reason still fails the run', () => {
    const { code, output } = runWithSuite(SUITE(`
  throw new Error('a genuine explosion');
`));
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(output.includes('a genuine explosion'), `reports the error, got: ${output}`);
    assert(!output.includes('skipped'), 'never reported as a skip');
  });

  await test('a per-case skip() is named in the totals without counting as a pass', () => {
    const { code, output } = runWithSuite(SUITE(`
  await test('runs here', () => { assert(true); });
  skip('gated case', 'no widget on this machine');
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('1 passed, 0 failed, 1 case skipped'), `totals separate the skip, got: ${output}`);
    assert(output.includes('fixture.test.js › gated case: no widget on this machine'), `names the skip, got: ${output}`);
  });

  await test('a passing suite reports no skip note at all', () => {
    const { code, output } = runWithSuite(SUITE(`
  await test('passes', () => { assert(true); });
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('1 passed, 0 failed'), `totals only, got: ${output}`);
    assert(!output.includes('skipped'), 'no skip note when nothing skipped');
  });

  group('run.js: suite paths narrow the run');

  // Three suites with distinct case names and counts, so the output and the
  // totals both say which ran.
  const three = {
    'alpha.test.js': SUITE(`  await test('alpha case', () => { assert(true); });`),
    'beta.test.js': SUITE(`
  await test('beta case one', () => { assert(true); });
  await test('beta case two', () => { assert(true); });
`),
    'gamma.test.js': SUITE(`
  for (const n of [1, 2, 3, 4]) await test(\`gamma case \${n}\`, () => { assert(true); });
`),
  };

  // One path relative to the repo root, one absolute: the two forms the runner takes.
  await test('two paths run only those two suites and the totals count only them', () => {
    const { code, output } = runSuites(three, { args: (root) => ['tests/alpha.test.js', path.join(root, 'tests', 'beta.test.js')] });
    assertEq(code, 0, `exit 0, got: ${output}`);
    for (const ran of ['alpha case', 'beta case one', 'beta case two']) {
      assert(output.includes(ran), `ran "${ran}", got: ${output}`);
    }
    assert(!output.includes('gamma'), `the unnamed suite never ran, got: ${output}`);
    assert(output.includes('3 passed, 0 failed'), `totals count only the two, got: ${output}`);
    assert(output.includes('2 suites)'), `names two suites, got: ${output}`);
  });

  await test('a path matching no suite exits 1 naming it and runs nothing', () => {
    const { code, output } = runSuites(three, { args: () => ['tests/alpha.test.js', 'tests/missing.test.js'] });
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(output.includes('No suite matches tests/missing.test.js'), `names the path, got: ${output}`);
    assert(!output.includes('alpha case'), `no suite ran, the named good one included, got: ${output}`);
  });

  await test('no arguments runs every suite as before', () => {
    const { code, output } = runSuites(three);
    assertEq(code, 0, `exit 0, got: ${output}`);
    for (const ran of ['alpha case', 'beta case two', 'gamma case 4']) {
      assert(output.includes(ran), `ran "${ran}", got: ${output}`);
    }
    assert(output.includes('7 passed, 0 failed'), `totals count all three, got: ${output}`);
    assert(output.includes('3 suites)'), `names three suites, got: ${output}`);
  });

  // The sleeper sorts last, so only its time can put it first on the line.
  await test('the run names its slowest suites, the slowest first', () => {
    const { code, output } = runSuites({
      'a-quick.test.js': SUITE(`  await test('quick case', () => { assert(true); });`),
      'z-sleeper.test.js': SUITE(`
  await test('sleeper case', async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });
`),
    });
    assertEq(code, 0, `exit 0, got: ${output}`);
    const line = linesOf(output).find((l) => l.startsWith('slowest: '));
    assert(/^slowest: z-sleeper\.test\.js \d+\.\ds, a-quick\.test\.js \d+\.\ds$/.test(line || ''),
      `names both suites, the sleeper first, got: ${output}`);
  });

  // Every suite runs in its own worker process: the fixtures below declare
  // nothing, and the ones meeting across processes prove they ran at once.
  group('run.js: suites run in parallel workers');

  await testUnless(POOL < 2, `a pool of ${POOL} cannot run two suites at once`)('two suites printing at once never interleave, each block whole under its header', () => {
    const { code, output } = runSuites({
      'left.test.js': SUITE(`${MEET}
  await test('left meets right', async () => {
    console.log('left 1');
    mark('left-ready');
    assert(await waitFor('right-ready'), 'right never ran alongside left');
    await sleep(200);
    console.log('left 2');
    await sleep(200);
    console.log('left 3');
  });
`),
      'right.test.js': SUITE(`${MEET}
  await test('right meets left', async () => {
    console.log('right 1');
    mark('right-ready');
    assert(await waitFor('left-ready'), 'left never ran alongside right');
    await sleep(100);
    console.log('right 2');
    await sleep(200);
    console.log('right 3');
  });
`),
    });
    assertEq(code, 0, `exit 0, got: ${output}`);
    const lines = linesOf(output);
    const blocks = {
      left: ['▶ left.test.js', 'left 1', 'left 2', 'left 3', '  ✓ left meets right'],
      right: ['▶ right.test.js', 'right 1', 'right 2', 'right 3', '  ✓ right meets left'],
    };
    for (const block of Object.values(blocks)) {
      const at = lines.indexOf(block[0]);
      assert(at >= 0, `prints the header "${block[0]}", got: ${output}`);
      assertEq(lines.slice(at, at + block.length).join('\n'), block.join('\n'), `the block under "${block[0]}" is whole, got: ${output}`);
    }
  });

  await testUnless(POOL < 2, `a pool of ${POOL} cannot run two suites at once`)('a slow suite that sorts first prints before a fast one that finished earlier', () => {
    const { code, output } = runSuites({
      'a-slow.test.js': SUITE(`${MEET}
  await test('slow outlasts fast', async () => {
    assert(await waitFor('fast-done'), 'fast never ran alongside slow');
    await sleep(300);
    console.log('slow finished');
  });
`),
      'b-fast.test.js': SUITE(`${MEET}
  await test('fast ends first', () => {
    console.log('fast finished');
    mark('fast-done');
  });
`),
    });
    assertEq(code, 0, `exit 0, got: ${output}`);
    const lines = linesOf(output);
    const order = ['▶ a-slow.test.js', 'slow finished', '▶ b-fast.test.js', 'fast finished'].map((line) => lines.indexOf(line));
    assert(order.every((at) => at >= 0), `prints both blocks, got: ${output}`);
    assert(order.every((at, i) => i === 0 || at > order[i - 1]), `the slow block prints whole before the fast one, got: ${output}`);
  });

  // The tail suites sort before the wave, so only a runner that holds them
  // until the wave ends sees the wave's files.
  await test('the serial tail runs after the whole wave, one suite at a time', () => {
    const wave = (name) => SUITE(`${MEET}
  await test('${name} writes its file', async () => {
    await sleep(400);
    mark('${name}.done');
  });
`);
    const tail = (name) => SUITE(`${MEET}
  await test('${name} sees the wave done', async () => {
    assert(fs.existsSync(path.join(root, 'wave-one.done')), 'wave-one had not finished');
    assert(fs.existsSync(path.join(root, 'wave-two.done')), 'wave-two had not finished');
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
    }, { serial: ['a-tail-one.test.js', 'a-tail-two.test.js'], read: ['stamps.txt'] });
    assertEq(code, 0, `exit 0, got: ${output}`);
    const spans = [
      'start a-tail-one\nend a-tail-one\nstart a-tail-two\nend a-tail-two\n',
      'start a-tail-two\nend a-tail-two\nstart a-tail-one\nend a-tail-one\n',
    ];
    assert(spans.includes(files['stamps.txt']), `the two tail suites ran as two closed spans, got: ${JSON.stringify(files['stamps.txt'])}`);
    const lines = linesOf(output);
    const lastWave = Math.max(lines.indexOf('▶ wave-one.test.js'), lines.indexOf('▶ wave-two.test.js'));
    for (const header of ['▶ a-tail-one.test.js', '▶ a-tail-two.test.js']) {
      assert(lines.indexOf(header) > lastWave, `"${header}" prints after the wave's blocks, got: ${output}`);
    }
  });

  await test('a worker that exits without reporting fails the run as "run <suite>"', () => {
    const { code, output } = runSuites({
      'crash.test.js': SUITE(`
  await test('before the crash', () => { assert(true); });
  console.error('about to die');
  process.exit(3);
`),
      'steady.test.js': SUITE(`  await test('steady case', () => { assert(true); });`),
    });
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(output.includes('steady case'), `the other suite still ran, got: ${output}`);
    const failures = stripVTControlCharacters(output).split('Failures:')[1];
    assert(failures, `a Failures: list, got: ${output}`);
    assert(failures.includes('run crash.test.js'), `names the suite as "run crash.test.js", got: ${failures}`);
    assert(/\b3\b/.test(failures), `gives the exit code, got: ${failures}`);
    assert(failures.includes('about to die'), `quotes the last thing it wrote, got: ${failures}`);
  });

  await test('a suite that cannot load, exports no function, or throws is named load, export or run', () => {
    const { code, output } = runSuites({
      'broken.test.js': 'module.exports = async () => {\n',
      'object.test.js': "module.exports = { not: 'a function' };\n",
      'throws.test.js': SUITE("  throw new Error('runner blew up');"),
    });
    assertEq(code, 1, `exit 1, got: ${output}`);
    const failures = stripVTControlCharacters(output).split('Failures:')[1];
    assert(failures, `a Failures: list, got: ${output}`);
    for (const name of ['load broken.test.js', 'export object.test.js']) {
      assert(failures.includes(name), `names "${name}", got: ${failures}`);
    }
    const thrown = failures.split('\n').find((line) => line.includes('run throws.test.js'));
    assert(thrown && thrown.includes('runner blew up'), `names "run throws.test.js" with the thrown message, got: ${failures}`);
  });

  await test('a SERIAL entry naming no suite exits 1 naming it before any suite runs', () => {
    const { code, output, stderr } = runSuites({
      'alpha.test.js': SUITE(`  await test('alpha case', () => { assert(true); });`),
    }, { serial: ['gone.test.js'] });
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(stderr.includes('gone.test.js'), `names the stale entry on stderr, got: ${stderr}`);
    assert(!output.includes('▶'), `no suite header printed, got: ${output}`);
    assert(!output.includes('alpha case'), `no suite ran, got: ${output}`);
  });

  // The grandchild holds the worker's pipes open for 20 s; the run ends while
  // it still lives, so the runner did not wait on them.
  await test('a detached child holding a worker\'s pipes does not hold the run', () => {
    const { code, output, files } = runSuites({
      'spawner.test.js': SUITE(`
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'inherit', cwd: require('os').tmpdir() });
  child.unref();
  fs.writeFileSync(path.join(__dirname, '..', 'sleeper.pid'), String(child.pid));
  await test('leaves a sleeper behind', () => { assert(true); });
`),
    }, { read: ['sleeper.pid'] });
    const pid = Number(files['sleeper.pid']);
    // A pid of 0 would signal this process group, so only a written pid is probed and killed.
    const sleeperAlive = pid > 0 && alive(pid);
    if (pid > 0) { try { process.kill(pid); } catch {} }
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(sleeperAlive, `the run ended while the sleeper still held its pipes: ${output}`);
  });

  // SIGKILL leaves the runner no way to pass the end on, so each worker must
  // notice its parent is gone and end rather than finish its suite, even
  // between synchronous cases, as the real suites' are.
  await test('a runner killed alone takes its workers with it', async () => {
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
    await test(\`blocks a second \${n}\`, () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']); });
  }
`),
    });
    const pidFile = path.join(root, 'worker.pid');
    const runner = spawn(process.execPath, [RUNNER], { cwd: root, stdio: 'ignore' });
    try {
      const wrote = await until(() => fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, 'utf8')) > 0);
      assert(wrote, 'the worker wrote its pid');
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert(pid !== runner.pid, 'the suite ran in a worker, not in the runner itself');
      runner.kill('SIGKILL');
      const gone = await until(() => !alive(pid));
      if (!gone) { try { process.kill(pid); } catch {} }
      assert(gone, `worker ${pid} outlived its runner`);
    } finally {
      runner.kill('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Known counts across three workers, one failing case among them.
  const COUNTED = {
    'alpha.test.js': SUITE(`
  await test('alpha case', () => { assert(true); });
`),
    'beta.test.js': SUITE(`
  await test('beta case one', () => { assert(true); });
  await test('beta case two', () => { assert(true); });
  await test('beta case three', () => { assert(false, 'beta breaks'); });
`),
    'gamma.test.js': SUITE(`
  for (const n of [1, 2, 3, 4]) await test(\`gamma case \${n}\`, () => { assert(true); });
`),
  };
  const TOTALS = /^7 passed, 1 failed \(\d+(?:\.\d+)?s, 3 suites\)$/m;

  await test('the totals line sums every worker in its usual shape and a failure exits 1', () => {
    const { code, output } = runSuites(COUNTED);
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(TOTALS.test(stripVTControlCharacters(output)), `"7 passed, 1 failed (Ns, 3 suites)", got: ${output}`);
    assert(stripVTControlCharacters(output).includes('beta.test.js › beta case three: beta breaks'), `lists the failure, got: ${output}`);
  });

  // `npm test` runs the Node suites, then `claude plugin test` over the hooks
  // module's *.test.ts files, and reports both halves.
  group('run.js: the mod half');

  await testUnless(!which('claude'), 'no claude binary on this machine')('a whole run reports the mod half beside the Node suites', () => {
    const { code, output } = runModHalf(process.env.PATH);
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('the node case'), `the Node half ran, got: ${output}`);
    assert(/mod half/.test(output), `the mod half is named, got: ${output}`);
    assert(output.includes('the mod case'), `the mod suite ran, got: ${output}`);
  });

  await test('with no claude binary the mod half reads skipped with its reason and the Node half still runs', () => {
    const tmp = mkTmp('runner-noclaude-');
    // node's own folder beside the built PATH: a linked node is not startable
    // by name from Node on Windows (the gh-stub world without gh does the same).
    const PATH = joinPath(basePathWithout(tmp, 'claude'), NODE_DIR);
    assert(!which('claude', PATH), 'the fixture PATH holds no claude');
    const { code, output } = runModHalf(PATH);
    fs.rmSync(tmp, { recursive: true, force: true });
    assertEq(code, 0, `a skip keeps the run green, got: ${output}`);
    assert(output.includes('the node case'), `the Node half ran, got: ${output}`);
    assert(!output.includes('the mod case'), 'the mod suite did not run');
    const skipLine = output.split('\n').find((l) => /mod half/.test(l) && /skipped|\u2298/.test(l) && /claude/.test(l));
    assert(skipLine, `a skip line names the mod half and claude as the reason, got: ${output}`);
  });

  // A suite is also run on its own by file (`node tests/<path>.test.js`); one
  // without the selfRun line runs zero cases that way and exits 0.
  group('run.js: every suite runs by file');

  await test('every discovered suite ends with the selfRun block', () => {
    const missing = findSuites(__dirname)
      .filter((file) => !SELF_RUN.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(__dirname, file))
      .sort();
    assert(missing.length === 0, `suites without \`if (require.main === module) selfRun(\` pass empty by file:\n    ${missing.join('\n    ')}`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
