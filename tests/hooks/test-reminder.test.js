//
// Tests for hooks/safety:test-reminder: the PostToolUse hook that asks, once
// per file per session, whether a written code file no test names needs one.
//
// Every case runs the real hook against its own git repo under a scratch dir,
// with a fresh TMPDIR, so a session marker never crosses cases. The hook reads
// the tree and nothing else, so there is nothing to stub.
//

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const {
  BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, joinPath, homeEnv,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'test-reminder', 'run.sh');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const write = (dir, name, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
};

// One scratch world per case: a home, a TMPDIR, and a git repo holding `files`.
const mkWorld = (files, { repo = true } = {}) => {
  const root = mkTmp('test-reminder-');
  const world = { root, home: path.join(root, 'home'), tmp: path.join(root, 'tmp'), repo: path.join(root, 'repo') };
  for (const dir of [world.home, world.tmp, world.repo]) fs.mkdirSync(dir);
  if (repo) execSync('git init -q', { cwd: world.repo, stdio: 'pipe', shell: SYSTEM_BASH, env: homeEnv(world.home, { PATH: process.env.PATH }) });
  for (const [name, content] of Object.entries(files)) write(world.repo, name, content);
  return world;
};

const runHook = (world, file, { session = 'session-1' } = {}) => {
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: shellPath(path.join(world.repo, file)) },
    cwd: shellPath(world.repo),
  };
  if (session) payload.session_id = session;
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input: JSON.stringify(payload),
    env: homeEnv(world.home, { PATH: joinPath(SYSTEM_PATH, '/opt/homebrew/bin'), TMPDIR: shellPath(world.tmp) }),
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const assertSilent = (out, why) => {
  assertEq(out.code, 0, `exit 0, got: ${out.stderr}`);
  assertEq(out.stdout, '', `silent: ${why}`);
};

// The one line, off the hook's stdout JSON.
const reminder = (out, file) => {
  assertEq(out.code, 0, `a reminder never bounces, got: ${out.stderr}`);
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PostToolUse', 'the event name the harness expects');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert(ctx.startsWith(`${file} has no test naming it.`), `names the repo-relative path, got: ${ctx}`);
  assert(ctx.includes('If not, say why in the Proof: line.'), `points at the Proof: line, got: ${ctx}`);
  assert(parsed.decision === undefined, 'never a bounce');
  return ctx;
};

const worldCase = (name, files, body, opts) => test(name, () => {
  const world = mkWorld(files, opts);
  try {
    body(world);
  } finally {
    cleanup(world.root);
  }
});

const run = async () => {
  group('test-reminder: a test naming the file keeps it silent');

  await worldCase('a test naming the file by its basename: silent', {
    'lib/thing.js': 'module.exports = 1;\n',
    'tests/thing.test.js': "// covers thing.js\n",
  }, (world) => assertSilent(runHook(world, 'lib/thing.js'), 'the test names it'));

  await worldCase('a test naming the file only through a require path: silent', {
    'lib/thing.js': 'module.exports = 1;\n',
    'tests/unit.test.js': "const thing = require('../lib/thing');\n",
  }, (world) => assertSilent(runHook(world, 'lib/thing.js'), 'the require path names it'));

  group('test-reminder: a file no test names gets one line, once per session');
  await worldCase('a test naming only index.json does not silence index.js: the line', {
    'lib/index.js': 'module.exports = 1;\n',
    'tests/data.test.js': "const data = require('../lib/index.json');\n",
  }, (world) => { reminder(runHook(world, 'lib/index.js'), 'lib/index.js'); });

  await worldCase('a test naming index.js as a whole word: silent', {
    'lib/index.js': 'module.exports = 1;\n',
    'tests/index.test.js': '// covers index.js\n',
  }, (world) => assertSilent(runHook(world, 'lib/index.js'), 'the whole word names it'));

  await worldCase('a basename shared by two tracked files is named by its parent too', {
    'a/run.sh': 'echo a\n',
    'b/run.sh': 'echo b\n',
    'tests/run.test.js': '// covers a/run.sh\n',
  }, (world) => {
    execSync('git add -A', { cwd: world.repo, stdio: 'pipe', shell: SYSTEM_BASH, env: homeEnv(world.home, { PATH: process.env.PATH }) });
    reminder(runHook(world, 'b/run.sh'), 'b/run.sh');
    assertSilent(runHook(world, 'a/run.sh'), 'the two-segment tail names it');
  });


  await worldCase('no test names it: the line', {
    'lib/thing.js': 'module.exports = 1;\n',
    'tests/other.test.js': "require('../lib/other');\n",
  }, (world) => { reminder(runHook(world, 'lib/thing.js'), 'lib/thing.js'); });

  await worldCase('the same file again in the same session: silent', {
    'lib/thing.js': 'module.exports = 1;\n',
  }, (world) => {
    reminder(runHook(world, 'lib/thing.js'), 'lib/thing.js');
    assertSilent(runHook(world, 'lib/thing.js'), 'asked once per session');
  });

  await worldCase('the same file in a different session: the line again', {
    'lib/thing.js': 'module.exports = 1;\n',
  }, (world) => {
    reminder(runHook(world, 'lib/thing.js', { session: 'session-1' }), 'lib/thing.js');
    reminder(runHook(world, 'lib/thing.js', { session: 'session-2' }), 'lib/thing.js');
  });

  await worldCase('no session id: the line every time', {
    'lib/thing.js': 'module.exports = 1;\n',
  }, (world) => {
    reminder(runHook(world, 'lib/thing.js', { session: '' }), 'lib/thing.js');
    reminder(runHook(world, 'lib/thing.js', { session: '' }), 'lib/thing.js');
  });

  group('test-reminder: only code outside a test folder is asked about');

  for (const [why, file] of [
    ['a test file itself', 'tests/thing.test.js'],
    ['a helper under a test folder', 'tests/helpers.js'],
    ['a markdown file', 'README.md'],
    ['a config file', 'eslint.config.js'],
    ['a file under _attic/', '_attic/old.js'],
  ]) {
    await worldCase(`${why}: silent`, { [file]: 'x\n' }, (world) => assertSilent(runHook(world, file), why));
  }

  await worldCase('a path inside no git repository: silent', {
    'lib/thing.js': 'module.exports = 1;\n',
  }, (world) => assertSilent(runHook(world, 'lib/thing.js'), 'no repo, no question'), { repo: false });

  await worldCase('a file that does not exist: silent', {}, (world) => {
    assertSilent(runHook(world, 'lib/gone.js'), 'nothing was written');
  });

  group('test-reminder: wiring');

  await test('hooks.json registers the hook under PostToolUse Edit|Write', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entries = settings.hooks.PostToolUse.filter((e) => e.matcher === 'Edit|Write');
    assert(
      entries.some((e) => e.hooks.some((h) => h.command.includes('safety:test-reminder'))),
      'safety:test-reminder is wired',
    );
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
