// Tests for a bare run of the kit's runner (packages/core/test/run.js) at a root
// whose package.json lists `workspaces`: after its own suites it runs each member's
// own `npm test`, one at a time in folder order, and a member that does not run the
// kit's runner fails by name. A member's `workkit test` finds the package's bin.

const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, until, pidIn, alive, endTree,
} = require('./lib/harness');
const { IS_WINDOWS } = require('./lib/platform');
const { TOTALS_LINE, linesOf, listsOf } = require('./lib/run-lists');
const { TOTALS, skipWithoutNpm } = require('./lib/core-repo');
const { coreBin } = require('./lib/workkit-bin');
const { SUITE, listFile, mkWorld } = require('./lib/runner-world');

// The root package.json declaring `workspaces`, none when undefined.
const ROOT = (workspaces) => ({
  'package.json': { name: 'root', private: true, ...(workspaces ? { workspaces } : {}) },
});

// The root's own suite.
const ROOT_SUITE = { 'test/root.test.js': SUITE("test('the root case', () => {});") };

/**
 * The member `name` at `folder`: its package.json with `script` as its test script
 * (none when null) and one suite, its case `the <name> case`, passing unless `fails`.
 */
const member = (name, { folder = `packages/${name}`, script = 'workkit test', fails = false } = {}) => ({
  [`${folder}/package.json`]: { name, private: true, ...(script === null ? {} : { scripts: { test: script } }) },
  [`${folder}/test/${name}.test.js`]: SUITE(`test('the ${name} case', () => { ${fails ? `throw new Error('${name} breaks');` : ''} });`),
});

// The world holding `files`, the runner started with `args` and the package's bin on PATH.
const runWith = (files, args = [], { env = {}, cwd = '' } = {}) => {
  const w = mkWorld();
  w.write(files);
  return { ...w.run(args, { cwd, env, bins: [coreBin()] }), read: w.read };
};

const trimmed = (output) => linesOf(output).map((line) => line.trim());
const at = (output, text) => trimmed(output).indexOf(text);
const has = (output, text) => at(output, text) >= 0;

// The root run's totals line: the last one, since each member's own run prints one above it.
const totalsOf = (output) => trimmed(output).filter((line) => TOTALS_LINE.test(line)).pop() || '';

describe('run.js: workspace members', { skip: skipWithoutNpm() }, () => {
  describe('a bare root run runs each member after its own suites', () => {
    test('members a and b on workkit test: the root suite, then a, then b, each under its heading, both rows ✓, 3 passed with 1 suite, 2 members, exit 0', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'), ...member('b'),
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      const order = ['▶ test/root.test.js', '▶ a: npm test', '▶ test/a.test.js', '▶ b: npm test', '▶ test/b.test.js'].map((line) => at(output, line));
      expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `the root, then a, then b, each under its heading, got: ${output}`).toBe(true);
      expect(has(output, '✓ a') && has(output, '✓ b'), `both rows read ✓, got: ${output}`).toBe(true);
      expect(TOTALS(3, 1, { members: 2 }).test(totalsOf(output)), `the totals line, got: ${output}`).toBe(true);
    });

    test('b holding a failing case: its row reads ✗ b (exit 1), the totals count its failure, exit 1, and a still ran', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'), ...member('b', { fails: true }),
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '✗ b (exit 1)'), `b's row, got: ${output}`).toBe(true);
      expect(has(output, '✓ a'), `a ran and passed, got: ${output}`).toBe(true);
      expect(TOTALS(2, 1, { failed: 1, members: 2 }).test(totalsOf(output)), `the totals count b's failure, got: ${output}`).toBe(true);
    });

    test('a failing a: b still runs', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a', { fails: true }), ...member('b'),
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '✗ a (exit 1)'), `a's row, got: ${output}`).toBe(true);
      expect(output.includes('the b case') && has(output, '✓ b'), `b ran after it, got: ${output}`).toBe(true);
    });

    test('a member whose test script is another runner that exits 0: its row names it and the exit is 1', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        ...ROOT_SUITE,
        'packages/c/package.json': { name: 'c', private: true, scripts: { test: 'node --test' } },
        'packages/c/c.test.js': "const { test } = require('node:test');\ntest('the c case', () => {});\n",
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, "✗ c: its test script did not run workkit's runner"), `c's row, with no code, got: ${output}`).toBe(true);
    });

    test('a member whose first step exits 3 before workkit test: its row names it with the code', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        ...ROOT_SUITE,
        ...member('c', { script: 'node fail.js && workkit test' }),
        'packages/c/fail.js': 'process.exit(3);\n',
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, "✗ c: its test script did not run workkit's runner (exit 3)"), `c's row with its code, got: ${output}`).toBe(true);
    });

    test('a member whose script is node pre.js && workkit test: the first step ran and the member passes', () => {
      const { code, output, read } = runWith({
        ...ROOT(['packages/*']),
        ...ROOT_SUITE,
        ...member('a', { script: 'node pre.js && workkit test' }),
        'packages/a/pre.js': "require('fs').writeFileSync(require('path').join(__dirname, 'pre.done'), 'ran');\n",
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(read('packages/a/pre.done'), 'the first step ran').toBe('ran');
      expect(has(output, '✓ a'), `the member passes, got: ${output}`).toBe(true);
    });

    test('a member with no test script is not started and has no row', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'), ...member('c', { script: null, fails: true }),
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(trimmed(output).some((line) => line.startsWith('▶ c') || /^[✓✗] c\b/.test(line)), `no heading or row for c, got: ${output}`).toBe(false);
      expect(TOTALS(2, 1, { members: 1 }).test(totalsOf(output)), `one member counted, got: ${output}`).toBe(true);
    });

    test('workspaces naming a literal folder: that folder is a member', () => {
      const { code, output } = runWith({
        ...ROOT(['tools/cli']), ...ROOT_SUITE, ...member('cli', { folder: 'tools/cli' }),
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '▶ cli: npm test') && has(output, '✓ cli'), `cli ran as a member, got: ${output}`).toBe(true);
    });

    test('two members: the second starts only after the first has ended', () => {
      const stamped = (name) => member(name, { script: `node ../../mark.js start-${name} && workkit test && node ../../mark.js end-${name}` });
      const { code, output, read } = runWith({
        ...ROOT(['packages/*']),
        ...ROOT_SUITE,
        ...stamped('a'),
        ...stamped('b'),
        'mark.js': "require('fs').appendFileSync(require('path').join(__dirname, 'order.txt'), `${process.argv[2]}\\n`);\n",
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(read('order.txt'), `a's whole span, then b's, got: ${output}`).toBe('start-a\nend-a\nstart-b\nend-b\n');
    });

    test('a root with no suite of its own and one member: the member runs, and the run does not end with No test file found', () => {
      const { code, output } = runWith({ ...ROOT(['packages/*']), ...member('a') });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(output.includes('the a case') && has(output, '✓ a'), `the member ran, got: ${output}`).toBe(true);
      expect(output.includes('No test file found'), `no start failure, got: ${output}`).toBe(false);
    });
  });

  describe('runs that start no member', () => {
    test('npm test -- test/root.test.js at the root: no member starts', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'),
      }, ['test/root.test.js']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '▶ a: npm test') || output.includes('the a case'), `a never started, got: ${output}`).toBe(false);
    });

    test('a run started in a member\'s folder runs only that member\'s suites', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'), ...member('b'),
      }, [], { cwd: 'packages/a' });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(output.includes('the a case'), `a's suite ran, got: ${output}`).toBe(true);
      expect(output.includes('the root case') || output.includes('the b case'), `nothing outside a ran, got: ${output}`).toBe(false);
    });

    test('workspaces ["packages/**"]: exit 1 naming the pattern, and nothing runs', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/**']), ...ROOT_SUITE, ...member('a'),
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(output.includes('packages/**'), `names the pattern, got: ${output}`).toBe(true);
      expect(output.includes('the root case') || output.includes('the a case'), `nothing ran, got: ${output}`).toBe(false);
    });

    test('a member whose package.json does not parse: exit 1 naming that file, and nothing runs', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'), 'packages/b/package.json': '{bad',
      });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      const named = trimmed(output).find((line) => line.endsWith('does not parse as JSON, so no member was started.')) || '';
      expect(named.includes(path.join('packages', 'b', 'package.json')), `names the file, got: ${output}`).toBe(true);
      expect(output.includes('the root case') || output.includes('the a case'), `nothing ran, got: ${output}`).toBe(false);
    });

    test('no workspaces: a folder with its own package.json and test script is not started, and the totals name no member', () => {
      const { code, output } = runWith({ ...ROOT(), ...ROOT_SUITE, ...member('a') });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(output.includes('the a case'), `a never started, got: ${output}`).toBe(false);
      expect(TOTALS(1, 1).test(totalsOf(output)), `a totals line with no member count, got: ${output}`).toBe(true);
    });

    test('a filtered bare run at a root with members starts none, and its end names members as not started under --filter', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'),
      }, ['--filter=root']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '▶ a: npm test') || output.includes('the a case'), `a never started, got: ${output}`).toBe(false);
      const skip = listsOf(output).map((line) => line.trim()).find((line) => line.startsWith('⊘ members'));
      expect(skip && skip.endsWith(': not started under --filter'), `the skip names members and the reason, got: ${stripVTControlCharacters(output)}`).toBe(true);
    });
  });

  describe('a member on a skip list', () => {
    const MEMBER_LINE = 'skip: 1 member left out (test/lib/skip.js)';
    const withList = (lists) => ({
      ...ROOT(['packages/*']),
      ...ROOT_SUITE,
      ...member('a'),
      ...member('b'),
      'test/lib/skip.js': listFile(lists),
    });

    test('CI_SKIP naming a member\'s folder: under CI the member is not started and the member line prints; without CI it runs and no such line prints', () => {
      const files = withList({ CI_SKIP: ['packages/b'] });
      const ci = runWith(files, [], { env: { CI: 'true' } });
      expect(ci.code, `under CI: exit 0, got: ${ci.output}`).toBe(0);
      expect(has(ci.output, '▶ b: npm test') || ci.output.includes('the b case'), `under CI: b never started, got: ${ci.output}`).toBe(false);
      expect(has(ci.output, '▶ a: npm test'), `under CI: a still ran, got: ${ci.output}`).toBe(true);
      expect(has(ci.output, MEMBER_LINE), `under CI: the member line, got: ${ci.output}`).toBe(true);
      const plain = runWith(files);
      expect(plain.code, `without CI: exit 0, got: ${plain.output}`).toBe(0);
      expect(has(plain.output, '▶ b: npm test') && plain.output.includes('the b case'), `without CI: b ran, got: ${plain.output}`).toBe(true);
      expect(trimmed(plain.output).some((line) => line.startsWith('skip: ') && line.includes('member')), `without CI: no member line, got: ${plain.output}`).toBe(false);
    });

    test('SKIP naming a member\'s folder: a bare run with CI unset leaves it out and prints the member line', () => {
      const { code, output } = runWith(withList({ SKIP: ['packages/b'] }));
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '▶ b: npm test') || output.includes('the b case'), `b never started, got: ${output}`).toBe(false);
      expect(has(output, MEMBER_LINE), `the member line, got: ${output}`).toBe(true);
    });

    test('workspaces ["packages/a/"] with a trailing / and SKIP [packages/a]: the member is left out and named, exit 0', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/a/']), ...ROOT_SUITE, ...member('a'), 'test/lib/skip.js': listFile({ SKIP: ['packages/a'] }),
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, MEMBER_LINE), `the member line, got: ${output}`).toBe(true);
      expect(has(output, '▶ a: npm test') || output.includes('the a case'), `a never started, got: ${output}`).toBe(false);
    });
  });

  // Off Windows a signal to the root reaches the member's tree only through the
  // runner; the member's case writes its pid while it runs, so the signal lands mid-member.
  test('SIGTERM to the root while a member\'s case runs: no member row, no totals line, exit 143', { skip: IS_WINDOWS && 'a Windows runner shares its console, not a process group' }, async () => {
    const w = mkWorld();
    const pidFile = path.join(w.root, 'member.pid');
    w.write({
      ...ROOT(['packages/*']),
      ...ROOT_SUITE,
      'packages/a/package.json': { name: 'a', private: true, scripts: { test: 'workkit test' } },
      'packages/a/test/a.test.js': SUITE(`
test('holds the member', () => new Promise(() => {
  require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  setInterval(() => {}, 1000);
}));
`),
    });
    const runner = w.start([], { bins: [coreBin()] });
    try {
      expect(await until(() => pidIn(pidFile) > 0), 'the member\'s case wrote its pid').toBe(true);
      runner.child.kill('SIGTERM');
      const { status } = await runner.done;
      const output = runner.output();
      const pid = pidIn(pidFile);
      expect(await until(() => !alive(pid)), `the member's case process ${pid} outlived the root`).toBe(true);
      expect(status, `the root's exit, got: ${output}`).toBe(143);
      expect(trimmed(output).some((line) => line === '✓ a' || line.startsWith('✗ a')), `no row for a, got: ${output}`).toBe(false);
      expect(trimmed(output).some((line) => TOTALS_LINE.test(line)), `no totals line, got: ${output}`).toBe(false);
    } finally {
      await runner.end('SIGKILL');
      // A pid of 0 would signal this process group, so only a written pid is ended.
      const pid = pidIn(pidFile);
      if (pid > 0 && alive(pid)) endTree(pid, 'SIGKILL');
    }
  });
});
