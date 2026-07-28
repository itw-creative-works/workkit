//
// Tests for workflow/wk.sh — the capture CLI.
//
// Every case runs the real script against a real temp tree: which inbox a note
// lands in is a question about directories and a settings file, so there is
// nothing here worth stubbing. HOME points at a temp directory throughout, so
// the fallback path can never reach the developer's own inbox.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'wk.sh');
const TEMPLATE = fs.readFileSync(path.join(WORKFLOW_DIR, 'templates', 'inbox.md'), 'utf8');

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A temp tree holding a participating repo, a nested subdirectory, an outside
// directory, and the home the fallback writes to.
const makeTree = ({ settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outside'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  if (settings !== null) {
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), settings);
  }
  return {
    dir,
    repo,
    deep: path.join(repo, 'sub', 'deep'),
    outside: path.join(dir, 'outside'),
    home: path.join(dir, 'home'),
    repoInbox: path.join(repo, W, 'inbox.md'),
    userInbox: path.join(dir, 'home', W, 'inbox.md'),
  };
};

const runScript = (cwd, args, { home }) => {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    cwd,
    env: { ...process.env, HOME: home, WORKFLOW_HOME: '' },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const read = (file) => fs.readFileSync(file, 'utf8');

const run = async () => {
  group('wk.sh: which inbox a note lands in');

  await test('a note from inside a participating repo lands in the repo inbox', async () => {
    const t = makeTree();
    const { code, out } = runScript(t.repo, ['note', 'a repo thought'], { home: t.home });
    assertEq(code, 0, 'exit 0');
    assert(out.includes(t.repoInbox), `names where it filed, got: ${out}`);
    assert(read(t.repoInbox).endsWith('- a repo thought\n'), 'the bullet is there');
    assert(!fs.existsSync(t.userInbox), 'and the user inbox was not touched');
    cleanup(t.dir);
  });

  await test('the walk up from a subdirectory finds the repo root', async () => {
    const t = makeTree();
    assertEq(runScript(t.deep, ['note', 'from the depths'], { home: t.home }).code, 0, 'exit 0');
    assert(read(t.repoInbox).includes('- from the depths\n'), 'filed at the root, not beside the cwd');
    assert(!fs.existsSync(path.join(t.deep, W)), 'nothing created in the subdirectory');
    cleanup(t.dir);
  });

  await test('a non-participating cwd falls back to the user inbox', async () => {
    const t = makeTree();
    assertEq(runScript(t.outside, ['note', 'a stray thought'], { home: t.home }).code, 0, 'exit 0');
    assert(read(t.userInbox).includes('- a stray thought\n'), 'filed under HOME');
    assert(!fs.existsSync(t.repoInbox), 'the repo inbox stayed out of it');
    cleanup(t.dir);
  });

  await test('a repo whose settings say enabled:false is not a participating repo', async () => {
    // The deliberate no. The note still has somewhere to go — the user inbox.
    const t = makeTree({ settings: '{ "version": 1, "enabled": false }\n' });
    assertEq(runScript(t.deep, ['note', 'declined repo'], { home: t.home }).code, 0, 'exit 0');
    assert(read(t.userInbox).includes('- declined repo\n'), 'filed under HOME');
    assert(!fs.existsSync(t.repoInbox), 'and never into the repo that said no');
    cleanup(t.dir);
  });

  await test('a settings file with no enabled key is the legacy opt-in', async () => {
    // Same reading as the hooks and the engine: the committed file existing at
    // all is the repo's yes.
    const t = makeTree({ settings: '{ "version": 1 }\n' });
    assertEq(runScript(t.repo, ['note', 'legacy yes'], { home: t.home }).code, 0, 'exit 0');
    assert(read(t.repoInbox).includes('- legacy yes\n'), 'filed in the repo');
    cleanup(t.dir);
  });

  group('wk.sh: what it writes');

  await test('a missing inbox is created from the engine template', async () => {
    const t = makeTree();
    runScript(t.repo, ['note', 'first ever'], { home: t.home });
    const body = read(t.repoInbox);
    assert(body.startsWith(TEMPLATE), 'the header is the template, byte for byte');
    assert(body.endsWith('- first ever\n'), 'with the bullet appended after it');
    cleanup(t.dir);
  });

  await test('existing content is preserved and the note appends', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoInbox, '# inbox\n\n- an older note\n');
    runScript(t.repo, ['note', 'a newer note'], { home: t.home });
    assertEq(read(t.repoInbox), '# inbox\n\n- an older note\n- a newer note\n', 'appended, nothing lost');
    cleanup(t.dir);
  });

  await test('a file with no trailing newline gets one before the bullet', async () => {
    const t = makeTree();
    fs.mkdirSync(path.join(t.repo, W), { recursive: true });
    fs.writeFileSync(t.repoInbox, '- an unterminated note');
    runScript(t.repo, ['note', 'the next one'], { home: t.home });
    assertEq(read(t.repoInbox), '- an unterminated note\n- the next one\n', 'the entries stay separate lines');
    cleanup(t.dir);
  });

  await test('two notes in a row both land', async () => {
    const t = makeTree();
    runScript(t.repo, ['note', 'one'], { home: t.home });
    runScript(t.repo, ['note', 'two'], { home: t.home });
    assert(read(t.repoInbox).endsWith('- one\n- two\n'), 'in order, one per line');
    cleanup(t.dir);
  });

  await test('multiple arguments join with spaces', async () => {
    // The unquoted call — the shell split it, and the script reassembles it.
    const t = makeTree();
    runScript(t.repo, ['note', 'fix', 'the', 'tower', 'poller'], { home: t.home });
    assert(read(t.repoInbox).endsWith('- fix the tower poller\n'), 'one bullet, one sentence');
    cleanup(t.dir);
  });

  group('wk.sh: usage');

  await test('an empty note exits 1 with usage and writes nothing', async () => {
    const t = makeTree();
    const { code, err } = runScript(t.repo, ['note'], { home: t.home });
    assertEq(code, 1, 'exit 1');
    assert(err.includes('usage: wk.sh note'), `usage on stderr, got: ${err}`);
    assert(!fs.existsSync(t.repoInbox), 'no inbox created');
    cleanup(t.dir);
  });

  await test('a whitespace-only note is an empty note', async () => {
    const t = makeTree();
    const { code } = runScript(t.repo, ['note', '   '], { home: t.home });
    assertEq(code, 1, 'exit 1');
    assert(!fs.existsSync(t.repoInbox), 'no inbox created');
    cleanup(t.dir);
  });

  await test('no arguments and an unknown subcommand both print usage and exit 1', async () => {
    const t = makeTree();
    for (const args of [[], ['dance']]) {
      const { code, out, err } = runScript(t.repo, args, { home: t.home });
      assertEq(code, 1, `exit 1 for [${args}]`);
      assert(err.includes('usage: wk.sh'), `usage on stderr for [${args}], got: ${err}`);
      assertEq(out, '', 'and nothing on stdout');
    }
    cleanup(t.dir);
  });

  group('wk.sh: the script itself');

  await test('it is executable and parses', async () => {
    // eslint-disable-next-line no-bitwise
    assert((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  return summary();
};

module.exports = run;

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
