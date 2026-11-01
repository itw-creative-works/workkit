// Tests for workflow/identity/gate.js's classifier, classify(argv, repo): the gh
// argv the shim hands the gate, read into one step per judged issue ({ sub, number,
// add, remove }), the call's kind (`write` or `read`) and the repo it acts on
// (`repo` when argv names none). A unit case; the wiring is gh-shim.test.js's.

const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  group, test, assert, summary, selfRun,
} = require('../../lib/harness');

const GATE = path.join(__dirname, '..', '..', '..', 'workflow', 'identity', 'gate.js');

// The repo the shim resolved from the cwd, which an argv naming its own repo overrides.
const CWD_REPO = 'cwd/repo';

/** The classifier's answer, its kind, repo and steps alone, each number as text. */
const read = (argv) => {
  const { kind, repo, steps } = require(GATE).classify(argv, CWD_REPO);
  return {
    kind,
    repo,
    steps: steps.map(({
      sub, number, add, remove,
    }) => ({
      sub, number: String(number), add, remove,
    })),
  };
};

const step = (sub, number, add = [], remove = []) => ({
  sub, number: String(number), add, remove,
});

const cases = async () => {
  group('identity/gate: the classifier');

  await test('case 10: every argv maps to its steps, its write or read kind, and its repo', async () => {
    const table = [
      [['issue', 'edit', '7', '8', '--add-label', 'a,b', '--remove-label', 'c'],
        { kind: 'write', repo: CWD_REPO, steps: [step('edit', 7, ['a', 'b'], ['c']), step('edit', 8, ['a', 'b'], ['c'])] }],
      // -R, --repo and a URL are the shim's to resolve (repo_of); the classifier keeps the repo it was given.
      [['issue', 'edit', '5', '-R', 'o/n', '--add-label', 'status:qa'],
        { kind: 'write', repo: CWD_REPO, steps: [step('edit', 5, ['status:qa'])] }],
      [['issue', 'close', '5', '--repo=o/n'],
        { kind: 'write', repo: CWD_REPO, steps: [step('close', 5)] }],
      [['issue', 'edit', 'https://github.com/o/n/issues/9', '--add-label', 'status:qa'],
        { kind: 'write', repo: CWD_REPO, steps: [step('edit', 9, ['status:qa'])] }],
      [['pr', 'merge', '3'], { kind: 'write', repo: CWD_REPO }],
      [['api', '-X', 'PATCH', 'repos/o/n/issues/7', '-F', 'state=closed'],
        { kind: 'write', repo: 'o/n', steps: [step('close', 7)] }],
      [['issue', 'view', '7'], { kind: 'read', repo: CWD_REPO }],
    ];
    // A call no verdict judges (a pull request, a read) is held to its kind and repo alone.
    const misses = table.map(([argv, expected]) => [argv, expected, read(argv)])
      .map(([argv, expected, got]) => [argv, expected, expected.steps ? got : { kind: got.kind, repo: got.repo }])
      .filter(([, expected, got]) => !isDeepStrictEqual(got, expected))
      .map(([argv, expected, got]) => `gh ${argv.join(' ')}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    assert(misses.length === 0, misses.join('\n'));
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
