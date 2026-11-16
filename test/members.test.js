// Tests for a run of the kit's runner (packages/core/test/run.js) at a root whose
// package.json lists `workspaces`: after its own suites it runs each member's own
// `npm test` (under a filter, with the filter), one at a time in folder order, and a
// member that does not run the kit's runner fails by name.

const path = require('path');
const {
  describe, test, expect, until, pidIn, alive, endTree,
} = require('./lib/harness');
const { IS_WINDOWS } = require('./lib/platform');
const { TOTALS_LINE, linesOf } = require('./lib/run-lists');
const { TOTALS, skipWithoutNpm } = require('./lib/core-repo');
const { coreBin } = require('./lib/workkit-bin');
const {
  RUNNER, SUITE, MOD_FILES, listFile, mkWorld, claudeStub,
} = require('./lib/runner-world');

// The kit's program starter, which a member's suite starts a run of its own through.
const RUN_JS = path.join(__dirname, '..', 'workflow', 'lib', 'run.js');

// The root package.json declaring `workspaces`, none when undefined.
const ROOT = (workspaces) => ({
  'package.json': { name: 'root', private: true, ...(workspaces ? { workspaces } : {}) },
});

// The root's own suite.
const ROOT_SUITE = { 'test/root.test.js': SUITE("test('the root case', () => {});") };

// One case of a suite's text: `name`, its body `body`.
const CASE = (name, body = '') => `test(${JSON.stringify(name)}, () => { ${body} });`;

/**
 * The member `name` at `folder`: its package.json with `script` as its test script
 * (none when null) and one suite holding `cases`, else one case `the <name> case`,
 * passing unless `fails`.
 */
const member = (name, {
  folder = `packages/${name}`, script = 'workkit test', fails = false, cases,
} = {}) => ({
  [`${folder}/package.json`]: { name, private: true, ...(script === null ? {} : { scripts: { test: script } }) },
  [`${folder}/test/${name}.test.js`]: SUITE((cases || [CASE(`the ${name} case`, fails ? `throw new Error('${name} breaks');` : '')]).join('\n')),
});

// The world holding `files`, the runner started with `args`, the package's bin and `bins` on PATH.
const runWith = (files, args = [], { env = {}, cwd = '', bins = [] } = {}) => {
  const w = mkWorld();
  w.write(files);
  return { ...w.run(args, { cwd, env, bins: [coreBin(), ...bins] }), read: w.read };
};

const trimmed = (output) => linesOf(output).map((line) => line.trim());
const at = (output, text) => trimmed(output).indexOf(text);
const has = (output, text) => at(output, text) >= 0;
// How many lines read exactly `text`.
const count = (output, text) => trimmed(output).filter((line) => line === text).length;

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

    test('a bare run: the member starts with no filter appended, and its row and the totals read as ever', () => {
      const { code, output, read } = runWith({
        ...ROOT(['packages/*']),
        ...ROOT_SUITE,
        ...member('a', { script: 'workkit test && node argv.js' }),
        'packages/a/argv.js': "require('fs').writeFileSync(require('path').join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)));\n",
      });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(read('packages/a/argv.json'), `npm appended nothing to the member's script, got: ${output}`).toBe('[]');
      expect(has(output, '✓ a'), `a's row, got: ${output}`).toBe(true);
      expect(TOTALS(2, 1, { members: 1 }).test(totalsOf(output)), `the totals line, got: ${output}`).toBe(true);
    });
  });

  describe('a filtered root run hands its filter to each member', () => {
    const ALPHA_BETA = {
      ...ROOT(['packages/*']), ...member('a', { cases: [CASE('alpha one')] }), ...member('b', { cases: [CASE('beta two')] }),
    };

    test('--filter=alpha over members a (alpha one) and b (beta two): ✓ a, ⊘ b: no case matches, 1 passed 0 failed, exit 0, and no No case matches line from the root', () => {
      const { code, output } = runWith(ALPHA_BETA, ['--filter=alpha']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ alpha one'), `a's case ran, got: ${output}`).toBe(true);
      expect(has(output, '✓ a') && has(output, '⊘ b: no case matches'), `the rows, got: ${output}`).toBe(true);
      expect(totalsOf(output).startsWith('1 passed, 0 failed'), `the totals line, got: ${output}`).toBe(true);
      expect(count(output, 'No case matches alpha'), `b's own line alone, none from the root, got: ${output}`).toBe(1);
    });

    test('--filter=nothing-here over the same members: both rows ⊘, the root prints No case matches nothing-here, exit 1', () => {
      const { code, output } = runWith(ALPHA_BETA, ['--filter=nothing-here']);
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '⊘ a: no case matches') && has(output, '⊘ b: no case matches'), `both rows, got: ${output}`).toBe(true);
      expect(count(output, 'No case matches nothing-here'), `each member's own line and the root's, got: ${output}`).toBe(3);
    });

    test('a root suite with a matching case and members with none: the root case runs, each member row reads ⊘, exit 0', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), 'test/root.test.js': SUITE(CASE('gamma three')), ...member('a'), ...member('b'),
      }, ['--filter=gamma']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ gamma three'), `the root case ran, got: ${output}`).toBe(true);
      expect(has(output, '⊘ a: no case matches') && has(output, '⊘ b: no case matches'), `both rows, got: ${output}`).toBe(true);
    });

    test('a member whose matching case fails: its row reads ✗ a (exit 1), the totals count the failure, exit 1', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...member('a', { cases: [CASE('alpha one', "throw new Error('alpha breaks');"), CASE('beta two')] }),
      }, ['--filter=alpha']);
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '✗ a (exit 1)'), `a's row, got: ${output}`).toBe(true);
      expect(totalsOf(output).startsWith('0 passed, 1 failed'), `the totals count it, got: ${output}`).toBe(true);
    });

    test('a member whose only matching case is skipped: its row reads ✓ a and no No case matches line prints', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...member('a', { cases: ["test('alpha one', { skip: 'not here' }, () => {});", CASE('beta two')] }),
      }, ['--filter=alpha']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ a'), `a's row, got: ${output}`).toBe(true);
      expect(count(output, 'No case matches alpha'), `a skipped match is a match, got: ${output}`).toBe(0);
    });

    test('a member with a test script and no test file: its row reads ✗ b (exit 1), exit 1', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        ...member('a', { cases: [CASE('alpha one')] }),
        'packages/b/package.json': { name: 'b', private: true, scripts: { test: 'workkit test' } },
      }, ['--filter=alpha']);
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '✗ b (exit 1)'), `b's row, got: ${output}`).toBe(true);
    });

    test('a member whose test script is another runner that exits 0: its row names it with no code, exit 1', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        ...member('a', { cases: [CASE('alpha one')] }),
        'packages/c/package.json': { name: 'c', private: true, scripts: { test: 'node other.js' } },
        'packages/c/other.js': "console.log('the other runner ran');\n",
      }, ['--filter=alpha']);
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, "✗ c: its test script did not run workkit's runner"), `c's row, got: ${output}`).toBe(true);
    });

    test('a member whose script is node pre.js && workkit test: the first step ran and only the matching case ran', () => {
      const { code, output, read } = runWith({
        ...ROOT(['packages/*']),
        ...member('a', { script: 'node pre.js && workkit test', cases: [CASE('alpha one'), CASE('beta two')] }),
        'packages/a/pre.js': "require('fs').writeFileSync(require('path').join(__dirname, 'pre.done'), 'ran');\n",
      }, ['--filter=alpha']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(read('packages/a/pre.done'), 'the first step ran').toBe('ran');
      expect(has(output, '✓ alpha one'), `the matching case ran, got: ${output}`).toBe(true);
      expect(output.includes('beta two'), `the other case never ran, got: ${output}`).toBe(false);
    });

    test('a filter holding a space, a double quote, an ampersand and a percent sign: exactly the member case holding it runs', () => {
      const text = 'say "hi" & 50% off';
      const misses = ['say "hi" & 50% on', 'say hi & 50% off'];
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...member('a', { cases: [CASE(`we ${text}`), ...misses.map((name) => CASE(name))] }),
      }, [`--filter=${text}`]);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, `✓ we ${text}`), `the case holding the text ran, got: ${output}`).toBe(true);
      expect(misses.filter((name) => output.includes(name)), `no near miss ran, got: ${output}`).toEqual([]);
    });

    test('a root with a mod half and a member: the member\'s case runs, the mod half is not started, and its skip line names the filter', () => {
      const claude = claudeStub();
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...MOD_FILES, ...member('a', { cases: [CASE('alpha one')] }),
      }, ['--filter=alpha'], { bins: [claude.bin] });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ alpha one'), `the member's case ran, got: ${output}`).toBe(true);
      expect(claude.started(), `claude was never started, got: ${output}`).toBe(false);
      expect(trimmed(output).some((line) => line.includes('mod half') && line.includes('--filter')), `the skip line names the flag, got: ${output}`).toBe(true);
    });

    // The inner run starts in a folder with its own package.json, which the member's run never reads.
    test('a member suite that starts a run of its own matching nothing: that run writes no no-match line, so the member\'s row reads ✓ a', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        ...member('a', {
          cases: [`const { spawnSync } = require(${JSON.stringify(RUN_JS)});
test('alpha starts a run of its own', () => {
  expect(process.env.WORKKIT_TEST_NO_MATCH, 'the member run names no no-match file to a run its suite starts').toBe(undefined);
  const res = spawnSync(process.execPath, [${JSON.stringify(RUNNER)}, '--filter=nothing-here'], { cwd: require('path').join(__dirname, '..', 'inner'), encoding: 'utf8' });
  expect((res.stdout || '') + (res.stderr || ''), 'the inner run matched nothing').toContain('No case matches nothing-here');
});`],
        }),
        'packages/a/inner/package.json': { name: 'inner', private: true },
        'packages/a/inner/x.test.js': SUITE(CASE('zeta')),
      }, ['--filter=alpha']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ alpha starts a run of its own'), `the member's case ran, got: ${output}`).toBe(true);
      expect(has(output, '✓ a'), `a's row, got: ${output}`).toBe(true);
    });

    // `||`, since cmd.exe, npm's script shell on Windows, takes no `;`; the first run always exits 1.
    test('a member whose script starts the runner twice, one run matching no case and one failing a case: its row reads ✗ a (exit 1) with its counts, exit 1', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']),
        'test/root.test.js': SUITE(CASE('alpha root')),
        ...member('a', { script: 'workkit test --filter=nothing-here || workkit test', cases: [CASE('alpha one', "throw new Error('alpha breaks');")] }),
      }, ['--filter=alpha']);
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(has(output, '✗ a (exit 1)'), `a's row, got: ${output}`).toBe(true);
      expect(totalsOf(output).startsWith('1 passed, 1 failed'), `the totals count a's failure, got: ${output}`).toBe(true);
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

    test('--filter with a suite path at the root: no member starts', () => {
      const { code, output } = runWith({
        ...ROOT(['packages/*']), ...ROOT_SUITE, ...member('a'),
      }, ['test/root.test.js', '--filter=case']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '▶ a: npm test') || has(output, '✓ the a case'), `a never started, got: ${output}`).toBe(false);
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

    test('SKIP naming a member\'s folder, under a filter: that member is not started and is counted as left out, the other runs', () => {
      const { code, output } = runWith(withList({ SKIP: ['packages/b'] }), ['--filter=a case']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(has(output, '✓ the a case'), `a ran, got: ${output}`).toBe(true);
      expect(has(output, '▶ b: npm test') || has(output, '✓ the b case'), `b never started, got: ${output}`).toBe(false);
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
