//
// Tests for workflow/wk.sh: the capture CLI.
//
// Every case runs the real script against a real temp tree: which capture file a note
// lands in is a question about directories and a settings file, so there is
// nothing here worth stubbing. HOME points at a temp directory throughout, so
// nothing can reach the developer's own repos.
//
// The one seam is `gh`: filing a note outside every project creates an ISSUE
// (issue #79), and no test may reach GitHub. PATH is pinned to a scratch bin
// plus the system one, and the shim in that bin answers every call. The machine
// that HAS no gh is built, not assumed: `basePathWithout` in tests/lib/platform.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, skip, summary, WORKKIT_DIR: W } = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, shellPath, homeEnv, stubTool, basePathWithout,
  systemPathWith, joinPath,
} = require('../lib/platform');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'wk.sh');
const TEMPLATE = fs.readFileSync(path.join(WORKFLOW_DIR, 'templates', 'capture.md'), 'utf8');

// The MACHINE's settings file: the site options, no `enabled` key. It is not a
// repo opt-in anywhere it turns up, and the walk up meets it wherever a
// directory sits under a user profile.
const MACHINE_SETTINGS = `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: false, url: null } }, null, 2)}\n`;

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A temp tree holding a participating repo (a real one: a git repo carrying the
// committed opt-in), a nested subdirectory, an outside directory, and the home
// the tower clone sits under. `tower: false` is the
// machine that has never run `workkit setup`: the one case with nowhere at all
// to put a note; `tower: 'foreign'` is somebody else's repo sitting at that
// path, which is never adopted.
//
// The clone is a REAL git repo with the home repo's origin, because which
// folder counts as the home is the engine's own `wk_home_ready` question: a
// bare `.git` directory is not the answer. It carries no `.workkit/` of its
// own: the clone is engine territory (issue #79).
//
// `gh` is the shim: `true` files the issue, `'labels'` refuses any call
// carrying --label (a fresh home repo without the vocabulary), `'down'` refuses
// every call (offline), `false` leaves the machine without gh at all.
const makeTree = ({ settings = '{ "version": 1, "enabled": true }\n', tower = true, gh = true } = {}) => {
  const dir = mkTmp();
  const repo = path.join(dir, 'repo');
  const towerDir = path.join(dir, 'home', W, 'tower');
  const bin = path.join(dir, 'bin');
  const ghLog = path.join(dir, 'gh-argv.log');
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  // A real git repo, because the settings file is a REPO's opt-in and only
  // counts where a repo is (issue #254).
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'outside'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  if (settings !== null) {
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), settings);
  }
  fs.mkdirSync(path.join(dir, 'home', W), { recursive: true });
  fs.writeFileSync(path.join(dir, 'home', W, 'settings.json'), MACHINE_SETTINGS);
  if (tower) {
    const origin = tower === 'foreign'
      ? 'https://github.com/someone/else.git'
      : 'https://github.com/owner/workkit.git';
    fs.mkdirSync(towerDir, { recursive: true });
    spawnSync('git', ['init', '-q', '-b', 'main', towerDir], { encoding: 'utf8' });
    spawnSync('git', ['-C', towerDir, 'remote', 'add', 'origin', origin], { encoding: 'utf8' });
  }
  if (gh) {
    // Every call is recorded with its argument boundaries intact
    // (tests/lib/argv-log.js), so a body that spans lines is still one
    // argument. The log is named in the SHELL's spelling: a native Windows path
    // in the stub's redirect loses its backslashes to bash and the whole
    // recording lands somewhere nobody reads.
    const refuse = gh === 'down'
      ? 'true'
      : (gh === 'labels' ? '[[ "$*" == *--label* ]]' : 'false');
    stubTool(bin, 'gh', [
      '#!/usr/bin/env bash',
      recordArgv(ghLog),
      `if ${refuse}; then printf 'gh: it did not work\\n' >&2; exit 1; fi`,
      "printf 'https://github.com/owner/workkit/issues/7\\n'",
    ]);
  }
  return {
    dir,
    repo,
    deep: path.join(repo, 'sub', 'deep'),
    outside: path.join(dir, 'outside'),
    home: path.join(dir, 'home'),
    tower: towerDir,
    bin,
    repoCapture: path.join(repo, W, 'capture.md'),
    ghCalls: () => readArgv(ghLog),
  };
};

const spawnOpts = (cwd, { home, bin }, extraEnv = {}) => ({
  cwd,
  env: homeEnv(home, {
    WORKFLOW_HOME: '',
    PATH: systemPathWith(bin),
    ...extraEnv,
  }),
  encoding: 'utf8',
  timeout: 20000,
});

const runScript = (cwd, args, t, extraEnv = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], spawnOpts(cwd, t, extraEnv));
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// One note whose BYTES are the point: bash builds the argument from a `$'...'`
// literal, so an invalid UTF-8 sequence reaches the script as those bytes. A JS
// string cannot carry them, since every encoding of one repairs them first.
// `$0` is the script, so the literal is the only thing interpolated.
const runScriptBytes = (cwd, noteLiteral, t, extraEnv = {}) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', `"$0" note ${noteLiteral}`, shellPath(SCRIPT)],
    spawnOpts(cwd, t, extraEnv));
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const read = (file) => fs.readFileSync(file, 'utf8');

const run = async () => {
  group('wk.sh: which capture file a note lands in');

  await test('a note from inside a participating repo lands in the repo capture file', async () => {
    const t = makeTree();
    const { code, out } = runScript(t.repo, ['note', 'a repo thought'], t);
    assertEq(code, 0, 'exit 0');
    assert(out.includes(shellPath(t.repoCapture)), `names where it filed, got: ${out}`);
    assert(read(t.repoCapture).endsWith('- a repo thought\n'), 'the bullet is there');
    assertEq(t.ghCalls().length, 0, 'and nothing was filed on the home repo');
    cleanup(t.dir);
  });

  await test('the walk up from a subdirectory finds the repo root', async () => {
    const t = makeTree();
    assertEq(runScript(t.deep, ['note', 'from the depths'], t).code, 0, 'exit 0');
    assert(read(t.repoCapture).includes('- from the depths\n'), 'filed at the root, not beside the cwd');
    assert(!fs.existsSync(path.join(t.deep, W)), 'nothing created in the subdirectory');
    cleanup(t.dir);
  });

  await test('a non-participating cwd files the note as an issue on the home repo', async () => {
    // There is no capture file outside a project any more (issue #79): a capture
    // that belongs to no project goes straight to the queue triage would have
    // put it in.
    const t = makeTree();
    const { code, out } = runScript(t.outside, ['note', 'a stray thought'], t);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `it names the issue, got: ${out}`);

    const calls = t.ghCalls();
    assertEq(calls.length, 1, `one gh call: ${fmtCalls(calls)}`);
    const argv = calls[0];
    assert(isCall(argv, 'issue', 'create'), `it creates an issue: ${fmtCalls(calls)}`);
    assertEq(argv[argv.indexOf('--repo') + 1], 'owner/workkit', 'on the home repo');
    assertEq(argv[argv.indexOf('--title') + 1], 'a stray thought', 'the note is the title');
    assertEq(argv[argv.indexOf('--label') + 1], 'status:inbox,type:idea', 'labelled for triage');
    const body = argv[argv.indexOf('--body') + 1];
    assert(/^## Description\n\na stray thought\n\n## Spec\n\nNone needed: small item\.$/.test(body),
      `the body is the spec's issue anatomy, got: ${body}`);

    assert(!fs.existsSync(path.join(t.tower, W)), 'and nothing at all is written into the clone');
    assert(!fs.existsSync(t.repoCapture), 'the repo capture file stayed out of it');
    cleanup(t.dir);
  });

  await test('a cwd under $HOME still files the issue: the machine settings are not a repo opt-in', async () => {
    // The walk up passes through $HOME, where `.workkit/settings.json` is the
    // MACHINE settings file (roster, site options, home slug). With no
    // `enabled` key it read as a legacy yes, and the note buffered into
    // ~/.workkit/capture.md: a file the spec says must not exist (issue #79).
    const t = makeTree();
    const scratch = path.join(t.home, 'Documents', 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const { code, out } = runScript(scratch, ['note', 'a thought from under home'], t);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `filed as an issue, got: ${out}`);
    assertEq(t.ghCalls().length, 1, 'one gh call');
    assert(!fs.existsSync(path.join(t.home, W, 'capture.md')), 'and no user-level capture file appeared');
    cleanup(t.dir);
  });

  await test('a lookalike home between the cwd and the root is not a participating repo', async () => {
    // Windows makes its temp directories INSIDE the user profile, so a walk up
    // from one passes through a home that is NOT the configured one: the suite
    // points HOME at its own temp home, and the profile the world sits in still
    // carries the machine settings file. A settings file is a repo's opt-in
    // where a repo is, and nowhere else (issue #254).
    const t = makeTree();
    const profile = path.join(t.dir, 'profile');
    fs.mkdirSync(path.join(profile, W), { recursive: true });
    fs.writeFileSync(path.join(profile, W, 'settings.json'), MACHINE_SETTINGS);
    const cwd = path.join(profile, 'AppData', 'Local', 'Temp', 'wk-x');
    fs.mkdirSync(cwd, { recursive: true });

    const { code, out } = runScript(cwd, ['note', 'a thought from a lookalike home'], t);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `filed as an issue, got: ${out}`);
    assertEq(t.ghCalls().length, 1, 'one gh call');
    assert(!fs.existsSync(path.join(profile, W, 'capture.md')), 'and nothing was written into the profile');
    cleanup(t.dir);
  });

  await test('a note longer than a title is truncated, and the body keeps it whole', async () => {
    const t = makeTree();
    const long = `the tower poller keeps ${'x'.repeat(90)} losing its place`;
    assertEq(runScript(t.outside, ['note', long], t).code, 0, 'exit 0');
    const argv = t.ghCalls()[0];
    const title = argv[argv.indexOf('--title') + 1];
    assertEq(title.length, 72, `the title is one line: ${title}`);
    assert(title.endsWith('…'), 'and says it was cut');
    assert(argv[argv.indexOf('--body') + 1].includes(long), 'while the body carries the whole thought');
    cleanup(t.dir);
  });

  await test('under a byte locale the truncated title is still valid UTF-8', async () => {
    // LC_ALL=C makes bash count and cut BYTES, so the 72-char cut lands inside
    // a multibyte character and would otherwise hand gh a title no API accepts.
    const t = makeTree();
    const long = `${'a'.repeat(70)}→ the rest of the thought`;
    assertEq(runScript(t.outside, ['note', long], t, { LC_ALL: 'C' }).code, 0, 'exit 0');

    // Read the log as BYTES: a string read would have replaced whatever
    // invalid sequence the cut left behind before the assertion could see it.
    const raw = fs.readFileSync(path.join(t.dir, 'gh-argv.log'));
    new TextDecoder('utf-8', { fatal: true }).decode(raw);

    const argv = t.ghCalls()[0];
    const title = argv[argv.indexOf('--title') + 1];
    assert(title.startsWith('a'.repeat(70)), `the note is still the title: ${title}`);
    assert(title.endsWith('…'), 'and still says it was cut');
    assert(argv[argv.indexOf('--body') + 1].includes(long), 'while the body carries the whole thought');
    cleanup(t.dir);
  });

  await test('a note whose own bytes are invalid UTF-8 is filed with the title repaired', async () => {
    // Nothing is truncated here: the note ARRIVES ending in a severed multibyte
    // sequence (a paste, a broken pipe, a $'...' literal). iconv drops the tail
    // and reports a failure for it on every implementation, since the input
    // ends inside the sequence, so a fallback reading that status would append
    // the unrepaired note to the repaired one and file a doubled title that is
    // still invalid.
    const t = makeTree();
    const { code, out } = runScriptBytes(t.outside, "$'a short note\\xe2\\x80'", t);
    assertEq(code, 0, `exit 0: ${out}`);

    const argv = t.ghCalls()[0];
    assertEq(argv[argv.indexOf('--title') + 1], 'a short note', 'the title is the note with the severed bytes dropped, once');
    cleanup(t.dir);
  });

  await test('a home repo without the labels yet takes the issue unlabelled', async () => {
    const t = makeTree({ gh: 'labels' });
    const { code, out, err } = runScript(t.outside, ['note', 'a fresh home'], t);
    assertEq(code, 0, `exit 0, the thought is filed either way: ${err}`);
    assert(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `it still names the issue, got: ${out}`);
    assert(/labels could not be applied/.test(err), `and says so once, got: ${err}`);

    const calls = t.ghCalls();
    assertEq(calls.length, 2, 'one labelled attempt, then one without');
    assert(calls[0].includes('--label'), 'the first try asks for them');
    assert(!calls[1].includes('--label'), 'the retry does not');
    cleanup(t.dir);
  });

  await test('a gh that cannot file the issue prints the note back and exits 1', async () => {
    // Offline, unauthenticated, a repo that is gone: there is no file buffer
    // anywhere, so the only safe place for the thought is the terminal.
    const t = makeTree({ gh: 'down' });
    const { code, err } = runScript(t.outside, ['note', 'not lost, at least'], t);
    assertEq(code, 1, 'the caller learns the thought was not filed');
    assert(/not lost, at least/.test(err), `and gets it back, got: ${err}`);
    assert(/owner\/workkit/.test(err), 'with the repo it could not reach');
    assertEq(t.ghCalls().length, 2, 'after the unlabelled retry');
    cleanup(t.dir);
  });

  await test('no gh on the machine refuses the note rather than losing it', async () => {
    const t = makeTree({ gh: false });
    const { code, err } = runScript(t.outside, ['note', 'no tooling here'], t,
      { PATH: joinPath(t.bin, basePathWithout(t.dir, 'gh')) });
    assertEq(code, 1, 'exit 1');
    assert(/gh is not on this machine/.test(err), `it names what is missing, got: ${err}`);
    assert(/no tooling here/.test(err), 'and hands the thought back');
    cleanup(t.dir);
  });

  await test('a repo whose settings say enabled:false is not a participating repo', async () => {
    // The deliberate no. The note still has somewhere to go: the home repo.
    const t = makeTree({ settings: '{ "version": 1, "enabled": false }\n' });
    assertEq(runScript(t.deep, ['note', 'declined repo'], t).code, 0, 'exit 0');
    assert(t.ghCalls()[0].includes('declined repo'), 'filed on the home repo');
    assert(!fs.existsSync(t.repoCapture), 'and never into the repo that said no');
    cleanup(t.dir);
  });

  await test('with no tower repo yet, the note is refused rather than written nowhere', async () => {
    const t = makeTree({ tower: false });
    const { code, err } = runScript(t.outside, ['note', 'nowhere to go'], t);
    assertEq(code, 1, 'the caller learns the thought was not filed');
    assert(/workkit setup/.test(err), `and which command makes a home, got: ${err}`);
    assert(!fs.existsSync(path.join(t.home, W, 'capture.md')), 'nothing is created at the user level');
    cleanup(t.dir);
  });

  await test('a foreign repo sitting at the clone’s path is refused, not written into', async () => {
    // The engine never adopts what it finds at ~/.workkit/tower. A `.git`
    // directory is not the test: being the home repo's clone is.
    const t = makeTree({ tower: 'foreign' });
    const { code, err } = runScript(t.outside, ['note', 'not yours'], t);
    assertEq(code, 1, 'the caller learns the thought was not filed');
    assert(/not the home repo/.test(err), `it says whose folder that is not, got: ${err}`);
    assertEq(t.ghCalls().length, 0, 'and nothing was filed against somebody else’s repo');
    cleanup(t.dir);
  });

  await test('a repo checked out as a git worktree is a participating repo', async () => {
    // A worktree's `.git` is a FILE, and that is the shape the repo-root
    // predicate asks with `-e` rather than `-d`: a `-d` reading answers no for
    // a checkout that works perfectly, and the note is filed as an issue on the
    // home repo instead of landing where the session is standing.
    const t = makeTree();
    const git = (...args) => spawnSync('git', ['-C', t.repo, ...args], { encoding: 'utf8' });
    git('-c', 'user.name=wk', '-c', 'user.email=wk@localhost', 'commit', '-q', '--allow-empty', '-m', 'chore: seed');
    const tree = path.join(t.dir, 'worktree');
    git('worktree', 'add', '-q', tree, '-b', 'side');
    assert(fs.statSync(path.join(tree, '.git')).isFile(), 'the checkout carries a `.git` FILE');
    fs.mkdirSync(path.join(tree, W), { recursive: true });
    fs.writeFileSync(path.join(tree, W, 'settings.json'), '{ "version": 1, "enabled": true }\n');

    const { code, out } = runScript(tree, ['note', 'from a worktree'], t);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(read(path.join(tree, W, 'capture.md')).includes('- from a worktree\n'), 'filed in the worktree');
    assertEq(t.ghCalls().length, 0, 'and never filed as an issue somewhere else');
    cleanup(t.dir);
  });

  await test('a settings file with no enabled key is the legacy opt-in', async () => {
    // Same reading as the hooks and the engine: the committed file existing at
    // all is the repo's yes.
    const t = makeTree({ settings: '{ "version": 1 }\n' });
    assertEq(runScript(t.repo, ['note', 'legacy yes'], t).code, 0, 'exit 0');
    assert(read(t.repoCapture).includes('- legacy yes\n'), 'filed in the repo');
    cleanup(t.dir);
  });

  group('wk.sh: what it writes');

  await test('a missing capture file is created from the engine template', async () => {
    const t = makeTree();
    runScript(t.repo, ['note', 'first ever'], t);
    const body = read(t.repoCapture);
    assert(body.startsWith(TEMPLATE), 'the header is the template, byte for byte');
    assert(body.endsWith('- first ever\n'), 'with the bullet appended after it');
    cleanup(t.dir);
  });

  await test('existing content is preserved and the note appends', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoCapture, '# capture\n\n- an older note\n');
    runScript(t.repo, ['note', 'a newer note'], t);
    assertEq(read(t.repoCapture), '# capture\n\n- an older note\n- a newer note\n', 'appended, nothing lost');
    cleanup(t.dir);
  });

  await test('a file with no trailing newline gets one before the bullet', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoCapture, '- an unterminated note');
    runScript(t.repo, ['note', 'the next one'], t);
    assertEq(read(t.repoCapture), '- an unterminated note\n- the next one\n', 'the entries stay separate lines');
    cleanup(t.dir);
  });

  await test('two notes in a row both land', async () => {
    const t = makeTree();
    runScript(t.repo, ['note', 'one'], t);
    runScript(t.repo, ['note', 'two'], t);
    assert(read(t.repoCapture).endsWith('- one\n- two\n'), 'in order, one per line');
    cleanup(t.dir);
  });

  await test('multiple arguments join with spaces', async () => {
    // The unquoted call: the shell split it, and the script reassembles it.
    const t = makeTree();
    runScript(t.repo, ['note', 'fix', 'the', 'tower', 'poller'], t);
    assert(read(t.repoCapture).endsWith('- fix the tower poller\n'), 'one bullet, one sentence');
    cleanup(t.dir);
  });

  group('wk.sh: usage');

  await test('an empty note exits 1 with usage and writes nothing', async () => {
    const t = makeTree();
    const { code, err } = runScript(t.repo, ['note'], t);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('usage: wk.sh note'), `usage on stderr, got: ${err}`);
    assert(!fs.existsSync(t.repoCapture), 'no capture file created');
    cleanup(t.dir);
  });

  await test('a whitespace-only note is an empty note', async () => {
    const t = makeTree();
    const { code } = runScript(t.repo, ['note', '   '], t);
    assertEq(code, 1, 'exit 1');
    assert(!fs.existsSync(t.repoCapture), 'no capture file created');
    cleanup(t.dir);
  });

  await test('no arguments and an unknown subcommand both print usage and exit 1', async () => {
    const t = makeTree();
    for (const args of [[], ['dance']]) {
      const { code, out, err } = runScript(t.repo, args, t);
      assertEq(code, 1, `exit 1 for [${args}]`);
      assert(err.includes('usage: wk.sh'), `usage on stderr for [${args}], got: ${err}`);
      assertEq(out, '', 'and nothing on stdout');
    }
    cleanup(t.dir);
  });

  group('wk.sh: the script itself');

  await test('it is executable and parses', async () => {
    // eslint-disable-next-line no-bitwise
    if (IS_WINDOWS) skip('wk.sh carries the executable bit', NO_EXEC_BIT);
    else assert((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  return summary();
};

module.exports = run;

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
