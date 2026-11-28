// Tests for workflow/ship/items.js (`workkit ship items`): the ship's Step 0c
// read, the open qa and complete issues one line each with the proof call made.
// `gh` is a stub answering from fixtures, and the program runs under this
// suite's own node. The proof rule is hooks/mods/proof.js's, cased in
// test/hooks/proof-guard/.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, run } = require('../lib/harness');
const {
  homeEnv, stubToolJs, pathWith, joinPath, which, basePathWithout,
} = require('../lib/platform');
const { recordArgvJs, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ship', 'items.js');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** One issue in the shape `gh issue list --json number,title,comments` returns. */
const issue = (number, title, ...bodies) => ({ number, title, comments: bodies.map((body) => ({ body })) });

/**
 * A scratch world: a home, a bin holding the `gh` stub, and the two fixture
 * files it answers from. A stage's fixture given as a string is written as it
 * is, which is how a gh answer that is not JSON is built. `fail: true` makes
 * every call refuse with a line on stderr, the way gh does offline or
 * unauthenticated; `fail: '<stage>'` refuses only that stage's call.
 */
const mkWorld = ({ qa = [], complete = [], fail = false } = {}) => {
  const dir = mkTmp('ship-items-');
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  const fixtures = path.join(dir, 'fixtures');
  const logFile = path.join(dir, 'gh-argv.log');
  for (const d of [bin, home, fixtures]) fs.mkdirSync(d, { recursive: true });
  const body = (fixture) => (typeof fixture === 'string' ? fixture : JSON.stringify(fixture));
  fs.writeFileSync(path.join(fixtures, 'qa.json'), body(qa));
  fs.writeFileSync(path.join(fixtures, 'complete.json'), body(complete));
  const refuse = fail === true ? 'true' : (fail ? `label === ${JSON.stringify(`status:${fail}`)}` : 'false');
  stubToolJs(bin, 'gh', [
    recordArgvJs(JSON.stringify(logFile)),
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    // The last value given to --label, as the call names its stage.
    "const label = argv.reduce((found, arg, i) => (argv[i - 1] === '--label' ? arg : found), '');",
    `const fixture = require('path').join(${JSON.stringify(fixtures)}, \`\${label.replace(/^status:/, '')}.json\`);`,
    `if (${refuse}) {`,
    "  process.stderr.write('error connecting to api.github.com\\n');",
    '  process.exitCode = 1;',
    '} else if (fs.existsSync(fixture)) process.stdout.write(fs.readFileSync(fixture));',
    'else {',
    '  process.stderr.write(`cat: ${fixture}: No such file or directory\\n`);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n'));
  return { dir, bin, home, calls: () => readArgv(logFile) };
};

// `PATH` is the stub's folder ahead of the rest, this machine's PATH unless one is given.
const runScript = (w, args = [], { PATH = pathWith(w.bin) } = {}) => {
  const res = run(process.execPath, [SCRIPT, ...args], { cwd: w.dir, env: homeEnv(w.home, { PATH }) });
  expect(res.status !== null, `the program finished (no timeout): ${res.signal || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const lines = (out) => out.split('\n').filter(Boolean);

// The harness compares with `===`, so a list is compared in its JSON form.
const assertList = (actual, expected, msg) => expect(JSON.stringify(actual), msg).toBe(JSON.stringify(expected));

describe('ship items: the lines', () => {
  test('qa lines first, then complete, each by number ascending', () => {
    const w = mkWorld({
      qa: [issue(12, 'qa twelve', 'Proof: unit'), issue(3, 'qa three', 'Proof: unit')],
      complete: [issue(40, 'complete forty', 'Proof: unit'), issue(7, 'complete seven', 'Proof: unit')],
    });
    const { code, out, err } = runScript(w);
    expect(code, `exit 0: ${err}`).toBe(0);
    assertList(lines(out), [
      'qa #3 proved qa three',
      'qa #12 proved qa twelve',
      'complete #7 proved complete seven',
      'complete #40 proved complete forty',
    ], 'the stage order and the number order');
    cleanup(w.dir);
  });

  test('a title prints verbatim after the third field', () => {
    const title = 'ship:  two  spaces, a "quote", $HOME and a `tick`';
    const w = mkWorld({ complete: [issue(5, title, 'Proof: unit')] });
    const { code, out } = runScript(w);
    expect(code, 'exit 0').toBe(0);
    expect(out, 'the title untouched').toBe(`complete #5 proved ${title}\n`);
    cleanup(w.dir);
  });

  test('no jq on PATH: the same lines, exit 0', () => {
    const w = mkWorld({
      qa: [issue(3, 'qa three', 'Proof: unit')],
      complete: [issue(7, 'complete seven', 'no proof yet')],
    });
    const base = basePathWithout(w.dir, 'jq');
    expect(!which('jq', base), 'the PATH holds no jq').toBeTruthy();
    const { code, out, err } = runScript(w, [], { PATH: joinPath(w.bin, base) });
    expect(code, `exit 0: ${err}`).toBe(0);
    assertList(lines(out), ['qa #3 proved qa three', 'complete #7 unproved complete seven'], 'both stages read without jq');
    cleanup(w.dir);
  });
});

describe('ship items: the proof call', () => {
  test('a comment opening with Proof: is proved', () => {
    const w = mkWorld({ complete: [issue(1, 'one', 'looks good', 'Proof: unit: node tests/x.test.js')] });
    expect(runScript(w).out, 'proved').toBe('complete #1 proved one\n');
    cleanup(w.dir);
  });

  test('a Proof: line mid-comment counts, leading blanks tolerated', () => {
    const w = mkWorld({
      complete: [
        issue(1, 'mid', 'what to check: the board page\n\nProof: unit: node tests/x.js'),
        issue(2, 'indented', 'notes first\n  \tProof: integration: node tests/y.js'),
      ],
    });
    assertList(lines(runScript(w).out), ['complete #1 proved mid', 'complete #2 proved indented'], 'both proved');
    cleanup(w.dir);
  });

  test('lowercase proof:, "Proof of", Proof: mid-line and no comments are unproved', () => {
    const w = mkWorld({
      qa: [issue(4, 'no comments')],
      complete: [
        issue(1, 'lowercase', 'proof: unit: node tests/x.js'),
        issue(2, 'proof of', 'Proof of concept only'),
        issue(3, 'mid-line', 'the Proof: line is still to come'),
      ],
    });
    assertList(lines(runScript(w).out), [
      'qa #4 unproved no comments',
      'complete #1 unproved lowercase',
      'complete #2 unproved proof of',
      'complete #3 unproved mid-line',
    ], 'every one unproved');
    cleanup(w.dir);
  });
});

describe('ship items: nothing, a failure, and the repo', () => {
  test('nothing at either stage prints the one line and exits 0', () => {
    const w = mkWorld();
    const { code, out, err } = runScript(w);
    expect(code, 'exit 0').toBe(0);
    expect(out, 'the empty line').toBe('ship-items: nothing at qa or complete\n');
    expect(err, 'nothing on stderr').toBe('');
    cleanup(w.dir);
  });

  test('a failing gh gives one ship-items: stderr line and exit 1', () => {
    const w = mkWorld({ fail: true });
    const { code, out, err } = runScript(w);
    expect(code, 'exit 1').toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(lines(err).length, `one stderr line, got: ${err}`).toBe(1);
    expect(err.startsWith('ship-items: '), `the line is the script's: ${err}`).toBeTruthy();
    expect(err.includes('error connecting to api.github.com'), `gh's reason rides along: ${err}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('a failure on the second call leaves stdout empty and exits 1', () => {
    const w = mkWorld({ qa: [issue(3, 'qa three', 'Proof: unit')], fail: 'complete' });
    const { code, out, err } = runScript(w);
    expect(code, 'exit 1').toBe(1);
    expect(out, 'no half list: the qa line is not printed').toBe('');
    expect(lines(err).length, `one stderr line, got: ${err}`).toBe(1);
    expect(err.startsWith('ship-items: ') && err.includes('status:complete'), `the line names the stage: ${err}`).toBeTruthy();
    expect(w.calls().length, `both calls were made: ${fmtCalls(w.calls())}`).toBe(2);
    cleanup(w.dir);
  });

  test('a gh answer that is not JSON gives one ship-items: stderr line and exit 1', () => {
    const w = mkWorld({ qa: '<html>rate limited</html>' });
    const { code, out, err } = runScript(w);
    expect(code, 'exit 1').toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(lines(err).length, `one stderr line, got: ${err}`).toBe(1);
    expect(err.startsWith('ship-items: ') && err.includes('status:qa'), `the line names the stage: ${err}`).toBeTruthy();
    cleanup(w.dir);
  });

  test('the two list calls, with --repo passed through when given', () => {
    const w = mkWorld();
    runScript(w);
    const listArgs = (stage) => ['issue', 'list', '--state', 'open', '--label', `status:${stage}`,
      '--json', 'number,title,comments', '--limit', '1000'];
    assertList(w.calls(), [listArgs('qa'), listArgs('complete')], `no --repo without one: ${fmtCalls(w.calls())}`);
    fs.rmSync(path.join(w.dir, 'gh-argv.log'));

    runScript(w, ['--repo', 'owner/name']);
    const calls = w.calls();
    expect(calls.length, `two calls: ${fmtCalls(calls)}`).toBe(2);
    for (const call of calls) {
      expect(isCall(call, 'issue', 'list'), `an issue list: ${fmtCalls([call])}`).toBeTruthy();
      const at = call.indexOf('--repo');
      expect(at !== -1 && call[at + 1] === 'owner/name', `--repo owner/name reached gh: ${fmtCalls([call])}`).toBeTruthy();
    }
    cleanup(w.dir);
  });

  test('an unknown argument is refused with a ship-items: line and exit 2, the usage code', () => {
    const w = mkWorld();
    const { code, err } = runScript(w, ['--nope']);
    expect(code, 'exit 2').toBe(2);
    expect(err.startsWith('ship-items: '), `the line is the script's: ${err}`).toBeTruthy();
    assertList(w.calls(), [], 'gh was never asked');
    cleanup(w.dir);
  });

  test('--repo with no value is refused with a ship-items: line and exit 2', () => {
    const w = mkWorld();
    for (const args of [['--repo'], ['--repo', '']]) {
      const { code, out, err } = runScript(w, args);
      expect(code, `exit 2 for ${JSON.stringify(args)}`).toBe(2);
      expect(out, 'nothing on stdout').toBe('');
      expect(err.startsWith('ship-items: '), `the line is the script's: ${err}`).toBeTruthy();
    }
    assertList(w.calls(), [], 'gh was never asked');
    cleanup(w.dir);
  });
});
