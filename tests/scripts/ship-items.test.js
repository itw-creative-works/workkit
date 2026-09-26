//
// Tests for workflow/ship-items.sh: the ship's Step 0c read (issue #290).
//
// The script asks `gh` twice (the open `status:qa` issues, then the open
// `status:complete` ones) and prints one line per issue with the proof call
// already made. The one seam is `gh`: a stub on PATH answers each list from a
// fixture file named for the stage its `--label` asks about, and records every
// call with its argument boundaries intact (tests/lib/argv-log.js), so where
// `--repo` landed can be read back. jq is the machine's own, since the proof
// read IS a jq expression and a stubbed one would be testing itself.
//
// The proof rule is the one safety/proof-guard reads (hook_issue_has_proof in
// hooks/lib/proof.sh), cased in tests/hooks/proof-guard.test.js: a comment LINE that
// starts `Proof:`, leading blanks tolerated, case-sensitive.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath, homeEnv, stubTool, pathWith,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'workflow', 'ship-items.sh');

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-items-')));
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
  const dir = mkTmp();
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  const fixtures = path.join(dir, 'fixtures');
  const log = path.join(dir, 'gh-argv.log');
  for (const d of [bin, home, fixtures]) fs.mkdirSync(d, { recursive: true });
  const body = (fixture) => (typeof fixture === 'string' ? fixture : JSON.stringify(fixture));
  fs.writeFileSync(path.join(fixtures, 'qa.json'), body(qa));
  fs.writeFileSync(path.join(fixtures, 'complete.json'), body(complete));
  const refuse = fail === true ? 'true' : (fail ? `[ "$label" = "status:${fail}" ]` : 'false');
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(log),
    'label=""',
    'for arg in "$@"; do',
    '  if [ "${prev:-}" = --label ]; then label="$arg"; fi',
    '  prev="$arg"',
    'done',
    `if ${refuse}; then printf 'error connecting to api.github.com\\n' >&2; exit 1; fi`,
    `cat "${shellPath(fixtures)}/\${label#status:}.json"`,
  ]);
  return { dir, bin, home, calls: () => readArgv(log) };
};

const runScript = (w, args = []) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd: w.dir,
    env: homeEnv(w.home, { PATH: pathWith(w.bin) }),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert(res.status !== null, `the script finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const lines = (out) => out.split('\n').filter(Boolean);

// The harness compares with `===`, so a list is compared in its JSON form.
const assertList = (actual, expected, msg) => assertEq(JSON.stringify(actual), JSON.stringify(expected), msg);

const run = async () => {
  group('ship-items.sh: the lines');

  await test('qa lines first, then complete, each by number ascending', () => {
    const w = mkWorld({
      qa: [issue(12, 'qa twelve', 'Proof: unit'), issue(3, 'qa three', 'Proof: unit')],
      complete: [issue(40, 'complete forty', 'Proof: unit'), issue(7, 'complete seven', 'Proof: unit')],
    });
    const { code, out, err } = runScript(w);
    assertEq(code, 0, `exit 0: ${err}`);
    assertList(lines(out), [
      'qa #3 proved qa three',
      'qa #12 proved qa twelve',
      'complete #7 proved complete seven',
      'complete #40 proved complete forty',
    ], 'the stage order and the number order');
    cleanup(w.dir);
  });

  await test('a title prints verbatim after the third field', () => {
    const title = 'ship:  two  spaces, a "quote", $HOME and a `tick`';
    const w = mkWorld({ complete: [issue(5, title, 'Proof: unit')] });
    const { code, out } = runScript(w);
    assertEq(code, 0, 'exit 0');
    assertEq(out, `complete #5 proved ${title}\n`, 'the title untouched');
    cleanup(w.dir);
  });

  group('ship-items.sh: the proof call');

  await test('a comment opening with Proof: is proved', () => {
    const w = mkWorld({ complete: [issue(1, 'one', 'looks good', 'Proof: unit: node tests/x.test.js')] });
    assertEq(runScript(w).out, 'complete #1 proved one\n', 'proved');
    cleanup(w.dir);
  });

  await test('a Proof: line mid-comment counts, leading blanks tolerated', () => {
    const w = mkWorld({
      complete: [
        issue(1, 'mid', 'what to check: the board page\n\nProof: unit: node tests/x.js'),
        issue(2, 'indented', 'notes first\n  \tProof: integration: node tests/y.js'),
      ],
    });
    assertList(lines(runScript(w).out), ['complete #1 proved mid', 'complete #2 proved indented'], 'both proved');
    cleanup(w.dir);
  });

  await test('lowercase proof:, "Proof of", Proof: mid-line and no comments are unproved', () => {
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

  group('ship-items.sh: nothing, a failure, and the repo');

  await test('nothing at either stage prints the one line and exits 0', () => {
    const w = mkWorld();
    const { code, out, err } = runScript(w);
    assertEq(code, 0, 'exit 0');
    assertEq(out, 'ship-items: nothing at qa or complete\n', 'the empty line');
    assertEq(err, '', 'nothing on stderr');
    cleanup(w.dir);
  });

  await test('a failing gh gives one ship-items: stderr line and exit 1', () => {
    const w = mkWorld({ fail: true });
    const { code, out, err } = runScript(w);
    assertEq(code, 1, 'exit 1');
    assertEq(out, '', 'nothing on stdout');
    assertEq(lines(err).length, 1, `one stderr line, got: ${err}`);
    assert(err.startsWith('ship-items: '), `the line is the script's: ${err}`);
    assert(err.includes('error connecting to api.github.com'), `gh's reason rides along: ${err}`);
    cleanup(w.dir);
  });

  await test('a failure on the second call leaves stdout empty and exits 1', () => {
    const w = mkWorld({ qa: [issue(3, 'qa three', 'Proof: unit')], fail: 'complete' });
    const { code, out, err } = runScript(w);
    assertEq(code, 1, 'exit 1');
    assertEq(out, '', 'no half list: the qa line is not printed');
    assertEq(lines(err).length, 1, `one stderr line, got: ${err}`);
    assert(err.startsWith('ship-items: ') && err.includes('status:complete'), `the line names the stage: ${err}`);
    assertEq(w.calls().length, 2, `both calls were made: ${fmtCalls(w.calls())}`);
    cleanup(w.dir);
  });

  await test('a gh answer that is not JSON gives one ship-items: stderr line and exit 1', () => {
    const w = mkWorld({ qa: '<html>rate limited</html>' });
    const { code, out, err } = runScript(w);
    assertEq(code, 1, 'exit 1');
    assertEq(out, '', 'nothing on stdout');
    assertEq(lines(err).length, 1, `one stderr line, got: ${err}`);
    assert(err.startsWith('ship-items: ') && err.includes('status:qa'), `the line names the stage: ${err}`);
    cleanup(w.dir);
  });

  await test('the two list calls, with --repo passed through when given', () => {
    const w = mkWorld();
    runScript(w);
    const listArgs = (stage) => ['issue', 'list', '--state', 'open', '--label', `status:${stage}`,
      '--json', 'number,title,comments', '--limit', '1000'];
    assertList(w.calls(), [listArgs('qa'), listArgs('complete')], `no --repo without one: ${fmtCalls(w.calls())}`);
    fs.rmSync(path.join(w.dir, 'gh-argv.log'));

    runScript(w, ['--repo', 'owner/name']);
    const calls = w.calls();
    assertEq(calls.length, 2, `two calls: ${fmtCalls(calls)}`);
    for (const call of calls) {
      assert(isCall(call, 'issue', 'list'), `an issue list: ${fmtCalls([call])}`);
      const at = call.indexOf('--repo');
      assert(at !== -1 && call[at + 1] === 'owner/name', `--repo owner/name reached gh: ${fmtCalls([call])}`);
    }
    cleanup(w.dir);
  });

  await test('an unknown argument is refused with a ship-items: line and exit 2, the usage code', () => {
    const w = mkWorld();
    const { code, err } = runScript(w, ['--nope']);
    assertEq(code, 2, 'exit 2');
    assert(err.startsWith('ship-items: '), `the line is the script's: ${err}`);
    assertList(w.calls(), [], 'gh was never asked');
    cleanup(w.dir);
  });

  await test('--repo with no value is refused with a ship-items: line and exit 2', () => {
    const w = mkWorld();
    for (const args of [['--repo'], ['--repo', '']]) {
      const { code, out, err } = runScript(w, args);
      assertEq(code, 2, `exit 2 for ${JSON.stringify(args)}`);
      assertEq(out, '', 'nothing on stdout');
      assert(err.startsWith('ship-items: '), `the line is the script's: ${err}`);
    }
    assertList(w.calls(), [], 'gh was never asked');
    cleanup(w.dir);
  });

  group('ship-items.sh: the script itself');

  await test('its Proof: pattern is the one hooks/lib/proof.sh reads', () => {
    // The pattern has four homes (hooks/lib/proof.sh, this script, and PROOF_LINE in
    // tower/api/server/validate.js and the dashboard's libs/tower/github/writes.js). The tower's
    // two are pinned to hooks/lib/proof.sh in tests/tower/app/github-writes.test.js; this pins the ship's,
    // so a change to one cannot leave the ship and the gate disagreeing.
    const pattern = '(^|\\n)[ \\t]*Proof:';
    const libSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'lib', 'proof.sh'), 'utf8');
    assert(libSrc.includes(pattern), `hooks/lib/proof.sh carries ${pattern}`);
    assert(fs.readFileSync(SCRIPT, 'utf8').includes(pattern), `ship-items.sh carries ${pattern}`);
  });

  await test('it is executable and parses', () => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('ship-items.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
