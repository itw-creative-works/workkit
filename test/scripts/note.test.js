// Tests for workflow/note.js: the capture CLI, run for real against a temp tree with
// HOME pointed into it. The one seam is `gh`: a note outside every project is filed
// as an issue, so PATH is a scratch bin plus the system one, and the machine with
// no gh is built by `basePathWithout` in test/lib/platform.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect, WORKKIT_DIR: W, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, shellPath, gitPath, homeEnv, stubToolJs, basePathWithout,
  systemPathWith, joinPath, spawnSync,
} = require('../lib/platform');
const { recordArgvJs, readArgv, isCall, fmtCalls } = require('../lib/argv-log');
const { OPT_IN_SHAPES } = require('../lib/git-repo');
const { mkKit } = require('./workkit-cli/helpers');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'note.js');
const TEMPLATE = fs.readFileSync(path.join(WORKFLOW_DIR, 'templates', 'capture.md'), 'utf8');

// The machine's settings file: the site options, no `enabled` key. It is not a
// repo opt-in anywhere it turns up, and the walk up meets it wherever a
// directory sits under a user profile.
const MACHINE_SETTINGS = `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: false, url: null } }, null, 2)}\n`;

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A temp tree: a participating repo, a nested subdir, an outside dir, and the home
// whose tower clone is a real git repo (the home's ready check asks, not a bare `.git`).
// `tower`: false never ran setup, 'foreign' is someone else's repo at that path.
// `gh`: true files, 'labels' refuses --label, 'down' refuses all, false has no gh.
const makeTree = ({ settings = OPT_IN_SHAPES.current, tower = true, gh = true } = {}) => {
  const dir = mkTmp('wk-');
  const repo = path.join(dir, 'repo');
  const towerDir = path.join(dir, 'home', W, 'tower');
  const bin = path.join(dir, 'bin');
  const ghLog = path.join(dir, 'gh-argv.log');
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  // A real git repo, because the settings file is a repo's opt-in and only
  // counts where a repo is.
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
    // Every call is recorded with its argument boundaries intact (test/lib/argv-log.js).
    const refuse = gh === 'down'
      ? 'true'
      : (gh === 'labels' ? "process.argv.slice(2).join(' ').includes('--label')" : 'false');
    stubToolJs(bin, 'gh', [
      recordArgvJs(JSON.stringify(ghLog)),
      `if (${refuse}) {`,
      "  process.stderr.write('gh: it did not work\\n');",
      '  process.exitCode = 1;',
      "} else process.stdout.write('https://github.com/owner/workkit/issues/7\\n');",
    ].join('\n'));
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
  timeout: SPAWN_DEADLINE,
});

// `node workflow/note.js <args>`, started by the node running this suite.
const runScript = (cwd, args, t, extraEnv = {}) => {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], spawnOpts(cwd, t, extraEnv));
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const read = (file) => fs.readFileSync(file, 'utf8');

describe('note.js: which capture file a note lands in', () => {
  test('a note from inside a participating repo lands in the repo capture file', async () => {
    const t = makeTree();
    const { code, out } = runScript(t.repo, ['a repo thought'], t);
    expect(code, 'exit 0').toBe(0);
    expect(out.includes(gitPath(t.repoCapture)), `names where it filed, got: ${out}`).toBeTruthy();
    expect(read(t.repoCapture).endsWith('- a repo thought\n'), 'the bullet is there').toBeTruthy();
    expect(t.ghCalls().length, 'and nothing was filed on the home repo').toBe(0);
    cleanup(t.dir);
  });

  test('the walk up from a subdirectory finds the repo root', async () => {
    const t = makeTree();
    expect(runScript(t.deep, ['from the depths'], t).code, 'exit 0').toBe(0);
    expect(read(t.repoCapture).includes('- from the depths\n'), 'filed at the root, not beside the cwd').toBeTruthy();
    expect(!fs.existsSync(path.join(t.deep, W)), 'nothing created in the subdirectory').toBeTruthy();
    cleanup(t.dir);
  });

  test('a non-participating cwd files the note as an issue on the home repo', async () => {
    // A capture that belongs to no project goes straight to the queue triage
    // would have put it in.
    const t = makeTree();
    const { code, out } = runScript(t.outside, ['a stray thought'], t);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `it names the issue, got: ${out}`).toBeTruthy();

    const calls = t.ghCalls();
    expect(calls.length, `one gh call: ${fmtCalls(calls)}`).toBe(1);
    const argv = calls[0];
    expect(isCall(argv, 'issue', 'create'), `it creates an issue: ${fmtCalls(calls)}`).toBeTruthy();
    expect(argv[argv.indexOf('--repo') + 1], 'on the home repo').toBe('owner/workkit');
    expect(argv[argv.indexOf('--title') + 1], 'the note is the title').toBe('a stray thought');
    expect(argv[argv.indexOf('--label') + 1], 'labelled for triage').toBe('status:inbox,type:idea');
    const body = argv[argv.indexOf('--body') + 1];
    expect(/^## Description\n\na stray thought\n\n## Spec\n\nNone needed: small item\.$/.test(body),
      `the body is the spec's issue anatomy, got: ${body}`).toBeTruthy();

    expect(!fs.existsSync(path.join(t.tower, W)), 'and nothing at all is written into the clone').toBeTruthy();
    expect(!fs.existsSync(t.repoCapture), 'the repo capture file stayed out of it').toBeTruthy();
    cleanup(t.dir);
  });

  test('a cwd under $HOME still files the issue: the machine settings are not a repo opt-in', async () => {
    // The walk up passes through $HOME, where `.workkit/settings.json` is the
    // machine settings file (roster, site options, home slug), never a repo's yes.
    const t = makeTree();
    const scratch = path.join(t.home, 'Documents', 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const { code, out } = runScript(scratch, ['a thought from under home'], t);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `filed as an issue, got: ${out}`).toBeTruthy();
    expect(t.ghCalls().length, 'one gh call').toBe(1);
    expect(!fs.existsSync(path.join(t.home, W, 'capture.md')), 'and no user-level capture file appeared').toBeTruthy();
    cleanup(t.dir);
  });

  test('a note longer than a title is truncated, and the body keeps it whole', async () => {
    const t = makeTree();
    const long = `the tower poller keeps ${'x'.repeat(90)} losing its place`;
    expect(runScript(t.outside, [long], t).code, 'exit 0').toBe(0);
    const argv = t.ghCalls()[0];
    const title = argv[argv.indexOf('--title') + 1];
    expect(title.length, `the title is one line: ${title}`).toBe(72);
    expect(title.endsWith('…'), 'and says it was cut').toBeTruthy();
    expect(argv[argv.indexOf('--body') + 1].includes(long), 'while the body carries the whole thought').toBeTruthy();
    cleanup(t.dir);
  });

  test('under a byte locale the truncated title is still valid UTF-8', async () => {
    // A cut that counted bytes under LC_ALL=C could land inside a multibyte
    // character and hand gh a title no API accepts.
    const t = makeTree();
    const long = `${'a'.repeat(70)}→ the rest of the thought`;
    expect(runScript(t.outside, [long], t, { LC_ALL: 'C' }).code, 'exit 0').toBe(0);

    // Read the log as bytes: a string read would have replaced whatever
    // invalid sequence the cut left behind before the assertion could see it.
    const raw = fs.readFileSync(path.join(t.dir, 'gh-argv.log'));
    new TextDecoder('utf-8', { fatal: true }).decode(raw);

    const argv = t.ghCalls()[0];
    const title = argv[argv.indexOf('--title') + 1];
    expect(title.startsWith('a'.repeat(70)), `the note is still the title: ${title}`).toBeTruthy();
    expect(title.endsWith('…'), 'and still says it was cut').toBeTruthy();
    expect(argv[argv.indexOf('--body') + 1].includes(long), 'while the body carries the whole thought').toBeTruthy();
    cleanup(t.dir);
  });

  test('a note whose own bytes are invalid UTF-8 is filed with the title repaired', async () => {
    // Nothing is truncated here: the note arrives ending in a severed multibyte
    // sequence, which must be dropped once, never doubled and never left invalid.
    // Node reads `a short note\xe2\x80` in process.argv as the note ending in one U+FFFD, handed here as such.
    const t = makeTree();
    const { code, out } = runScript(t.outside, ['a short note�'], t);
    expect(code, `exit 0: ${out}`).toBe(0);

    const argv = t.ghCalls()[0];
    expect(argv[argv.indexOf('--title') + 1], 'the title is the note with the severed bytes dropped, once').toBe('a short note');
    cleanup(t.dir);
  });

  test('a home repo without the labels yet takes the issue unlabelled', async () => {
    const t = makeTree({ gh: 'labels' });
    const { code, out, err } = runScript(t.outside, ['a fresh home'], t);
    expect(code, `exit 0, the thought is filed either way: ${err}`).toBe(0);
    expect(out.includes('✓ noted → https://github.com/owner/workkit/issues/7'), `it still names the issue, got: ${out}`).toBeTruthy();
    expect(/labels could not be applied/.test(err), `and says so once, got: ${err}`).toBeTruthy();

    const calls = t.ghCalls();
    expect(calls.length, 'one labelled attempt, then one without').toBe(2);
    expect(calls[0].includes('--label'), 'the first try asks for them').toBeTruthy();
    expect(!calls[1].includes('--label'), 'the retry does not').toBeTruthy();
    cleanup(t.dir);
  });

  test('a gh that cannot file the issue prints the note back and exits 1', async () => {
    // Offline, unauthenticated, a repo that is gone: there is no file buffer
    // anywhere, so the only safe place for the thought is the terminal.
    const t = makeTree({ gh: 'down' });
    const { code, err } = runScript(t.outside, ['not lost, at least'], t);
    expect(code, 'the caller learns the thought was not filed').toBe(1);
    expect(/not lost, at least/.test(err), `and gets it back, got: ${err}`).toBeTruthy();
    expect(/owner\/workkit/.test(err), 'with the repo it could not reach').toBeTruthy();
    expect(t.ghCalls().length, 'after the unlabelled retry').toBe(2);
    cleanup(t.dir);
  });

  test('no gh on the machine refuses the note rather than losing it', async () => {
    const t = makeTree({ gh: false });
    const { code, err } = runScript(t.outside, ['no tooling here'], t,
      { PATH: joinPath(t.bin, basePathWithout(t.dir, 'gh')) });
    expect(code, 'exit 1').toBe(1);
    expect(/gh is not on this machine/.test(err), `it names what is missing, got: ${err}`).toBeTruthy();
    expect(/no tooling here/.test(err), 'and hands the thought back').toBeTruthy();
    cleanup(t.dir);
  });

  test('a repo whose settings say enabled:false is not a participating repo', async () => {
    // The deliberate no. The note still has somewhere to go: the home repo.
    const t = makeTree({ settings: '{ "version": 1, "enabled": false }\n' });
    expect(runScript(t.deep, ['declined repo'], t).code, 'exit 0').toBe(0);
    expect(t.ghCalls()[0].includes('declined repo'), 'filed on the home repo').toBeTruthy();
    expect(!fs.existsSync(t.repoCapture), 'and never into the repo that said no').toBeTruthy();
    cleanup(t.dir);
  });

  test('with no tower repo yet, the note is refused rather than written nowhere', async () => {
    const t = makeTree({ tower: false });
    const { code, err } = runScript(t.outside, ['nowhere to go'], t);
    expect(code, 'the caller learns the thought was not filed').toBe(1);
    expect(/workkit setup/.test(err), `and which command makes a home, got: ${err}`).toBeTruthy();
    expect(!fs.existsSync(path.join(t.home, W, 'capture.md')), 'nothing is created at the user level').toBeTruthy();
    cleanup(t.dir);
  });

  test('a foreign repo sitting at the clone’s path is refused, not written into', async () => {
    // The engine never adopts what it finds at ~/.workkit/tower. A `.git`
    // directory is not the test: being the home repo's clone is.
    const t = makeTree({ tower: 'foreign' });
    const { code, err } = runScript(t.outside, ['not yours'], t);
    expect(code, 'the caller learns the thought was not filed').toBe(1);
    expect(/not the home repo/.test(err), `it says whose folder that is not, got: ${err}`).toBeTruthy();
    expect(t.ghCalls().length, 'and nothing was filed against somebody else’s repo').toBe(0);
    cleanup(t.dir);
  });

  test('a settings file with no enabled key is not a participating repo', async () => {
    // Only "enabled": true is the repo's yes; the note goes to the home repo.
    const t = makeTree({ settings: '{ "version": 1 }\n' });
    expect(runScript(t.deep, ['unanswered repo'], t).code, 'exit 0').toBe(0);
    expect(t.ghCalls()[0].includes('unanswered repo'), 'filed on the home repo').toBeTruthy();
    expect(!fs.existsSync(t.repoCapture), 'and never into the repo that gave no answer').toBeTruthy();
    cleanup(t.dir);
  });
});

describe('note.js: what it writes', () => {
  test('a missing capture file is created from the engine template', async () => {
    const t = makeTree();
    runScript(t.repo, ['first ever'], t);
    const body = read(t.repoCapture);
    expect(body.startsWith(TEMPLATE), 'the header is the template, byte for byte').toBeTruthy();
    expect(body.endsWith('- first ever\n'), 'with the bullet appended after it').toBeTruthy();
    cleanup(t.dir);
  });

  test('existing content is preserved and the note appends', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoCapture, '# capture\n\n- an older note\n');
    runScript(t.repo, ['a newer note'], t);
    expect(read(t.repoCapture), 'appended, nothing lost').toBe('# capture\n\n- an older note\n- a newer note\n');
    cleanup(t.dir);
  });

  test('a file with no trailing newline gets one before the bullet', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoCapture, '- an unterminated note');
    runScript(t.repo, ['the next one'], t);
    expect(read(t.repoCapture), 'the entries stay separate lines').toBe('- an unterminated note\n- the next one\n');
    cleanup(t.dir);
  });

  test('a kit with no capture template refuses the note with the template line, exit 1, and writes nothing', async () => {
    const t = makeTree();
    const { kit } = mkKit('checkout/workkit');
    fs.rmSync(path.join(kit, 'workflow', 'templates', 'capture.md'));
    const res = spawnSync(process.execPath, [path.join(kit, 'workflow', 'note.js'), 'no template'], spawnOpts(t.repo, t));
    expect(res.status, `exit 1, got: ${res.stderr}`).toBe(1);
    const line = `✖ template missing at ${gitPath(path.join(kit, 'workflow', 'templates'))}/capture.md; reinstall the workflow core`;
    expect((res.stderr || '').split(/\r?\n/).includes(line), `the template line, got: ${res.stderr}`).toBeTruthy();
    expect(!fs.existsSync(t.repoCapture), 'no capture file created').toBeTruthy();
    cleanup(t.dir); cleanup(kit);
  });

  test('multiple arguments join with spaces', async () => {
    // The unquoted call: the shell split it, and the program reassembles it.
    const t = makeTree();
    runScript(t.repo, ['fix', 'the', 'tower', 'poller'], t);
    expect(read(t.repoCapture).endsWith('- fix the tower poller\n'), 'one bullet, one sentence').toBeTruthy();
    cleanup(t.dir);
  });
});

describe('note.js: usage', () => {
  test('an empty note exits 1 with usage on stderr, nothing on stdout, and writes nothing', async () => {
    const t = makeTree();
    const { code, out, err } = runScript(t.repo, [], t);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('usage: workkit note <text...>'), `usage on stderr, got: ${err}`).toBeTruthy();
    expect(out, 'and nothing on stdout').toBe('');
    expect(!fs.existsSync(t.repoCapture), 'no capture file created').toBeTruthy();
    cleanup(t.dir);
  });

  test('a whitespace-only note is an empty note', async () => {
    const t = makeTree();
    const { code, err } = runScript(t.repo, ['   '], t);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('usage: workkit note <text...>'), `usage on stderr, got: ${err}`).toBeTruthy();
    expect(!fs.existsSync(t.repoCapture), 'no capture file created').toBeTruthy();
    cleanup(t.dir);
  });
});

describe('note.js: a HOME no cygpath can read', () => {
  // homeEnv already hands HOME in the shell's spelling. PATH is node's folder
  // alone: Git's usr/bin, where cygpath lives, is left off.
  test('a HOME in the shell\'s spelling with no cygpath on PATH: the one line naming HOME and the fix, exit 1, no stack', {
    skip: !IS_WINDOWS && 'off Windows a home is never handed to cygpath',
  }, () => {
    const t = makeTree();
    const home = shellPath(t.home);
    const { code, out, err } = runScript(t.repo, ['a thought'], t, { PATH: NODE_DIR });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(err, 'the one line').toBe(`workkit: cannot read HOME (${home}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(err), `no stack line, got: ${err}`).toBe(false);
    cleanup(t.dir);
  });
});
