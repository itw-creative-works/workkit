// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. Five rows: the four path tests,
// the opt-in read, the machine folder, the CHANGELOG test, the hooks log line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, loaderEnv,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mods } = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const lib = (...parts) => shellPath(path.join(KIT, ...parts));

/**
 * Each fixture through `fn` in one bash that sources `file`: '1' where the
 * function exits 0, '0' where it does not, one per fixture, in order.
 */
const bashAnswers = (file, fn, fixtures) => {
  const script = `. "${file}"\nwhile IFS= read -r p; do if ${fn} "$p"; then echo 1; else echo 0; fi; done <<<"$FIXTURES"`;
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), FIXTURES: fixtures.join('\n') },
    encoding: 'utf8',
    timeout: 20000,
  });
  const answers = (res.stdout || '').split('\n').filter(Boolean);
  assertEq(answers.length, fixtures.length, `one answer per fixture from ${fn}, stderr: ${res.stderr}`);
  return answers.map((a) => a === '1');
};

/** Asserts bash and JavaScript gave every fixture the same answer, naming each that differs. */
const agree = (fixtures, shell, js, what) => {
  const differ = fixtures.flatMap((f, i) => (shell[i] === js(f) ? [] : [`${JSON.stringify(f)}: bash ${shell[i]}`]));
  assertEq(differ.join('; '), '', `${what}: the fixtures bash and JavaScript answer differently`);
};

// Repo paths across every shape the two read: code, docs, test names, test folders, config files, the attic.
const PATHS = [
  'src/app.js', 'lib/thing.ts', 'run.sh', 'a.zsh', 'x.py', 'y.rb', 'z.jsx', 'w.tsx', 'm.mjs', 'c.cjs',
  'README.md', 'docs/x.md', 'package.json', 'Makefile', 'scripts/x.bash', 'x.json',
  'tests/a.js', 'test/a.js', '__tests__/a.js', 'src/tests/a.js', 'src/test/x.sh', 'pkg/__tests__/x.ts',
  'a.test.js', 'src/a.spec.ts', 'x_test.py', 'deep/dir/b.test.sh', 'a.test', 'test.js', 'tests.js',
  'contest/a.js', 'testing/a.js', 'latest.js', 'mytest/a.js', 'src/testdata/a.js',
  'vite.config.js', 'src/jest.config.ts', '_attic/old.js', 'src/_attic/old.js', 'attic/x.js', 'my_attic/x.js',
];

// Basenames neither test-named nor config files, so isCodePath under src/ is the code-extension test alone.
const BASENAMES = [
  'a.js', 'a.cjs', 'a.mjs', 'a.ts', 'a.jsx', 'a.tsx', 'a.sh', 'a.zsh', 'a.py', 'a.rb',
  'a.md', 'a.json', 'a.bash', 'a.go', 'a.js.map', 'a.d.ts', 'Makefile', 'a.JS', 'js', '.js',
];

const CHANGELOGS = [
  'CHANGELOG.md', 'docs/CHANGELOG.md', '/abs/repo/CHANGELOG.md', 'packages/a/CHANGELOG.md',
  'CHANGELOG.md.bak', 'xCHANGELOG.md', 'changelog.md', 'CHANGELOG', 'CHANGELOG.md/x', 'docs/OLD-CHANGELOG.md',
];

// A repo's settings text; null writes no file.
const SETTINGS = [
  null, '', '{}', '{ "version": 1 }\n', '{ "version": 1, "enabled": true }\n', '{ "version": 1, "enabled": false }\n',
  '{"enabled":false}', '{ "enabled" :\tfalse }', '{ "enabled": "false" }', '{ "enabled": true, "x": { "enabled": false } }',
  '{\n  "version": 1,\n  "enabled": false\n}\n', '{ "enabled":\nfalse }',
];

/** One scratch repo root per settings text, the shell side's input. */
const settingsRoots = (texts) => texts.map((text) => {
  const root = mkTmp('twins-optin-');
  if (text !== null) {
    fs.mkdirSync(path.join(root, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(root, '.workkit', 'settings.json'), text);
  }
  return root;
});

/** The settings text register.js hands settingsOptedIn: the file's text, null when absent or unreadable. */
const readOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

const run = async () => {
  group('twins: the four path tests, hooks/lib/paths.sh against hooks/mods/test-reminder.js');

  const paths = lib('hooks', 'lib', 'paths.sh');
  const reminder = () => mods('test-reminder');

  await test('hook_is_test_name and isTestName agree on every fixture', () => {
    agree(PATHS, bashAnswers(paths, 'hook_is_test_name', PATHS), (p) => reminder().isTestName(p), 'the test name');
  });

  await test('hook_is_test_path and isTestPath agree on every fixture', () => {
    agree(PATHS, bashAnswers(paths, 'hook_is_test_path', PATHS), (p) => reminder().isTestPath(p), 'the test path');
  });

  await test('hook_is_code_path and isCodePath agree on every fixture', () => {
    agree(PATHS, bashAnswers(paths, 'hook_is_code_path', PATHS), (p) => reminder().isCodePath(p), 'the code path');
  });

  await test('hook_has_code_ext and the code extensions isCodePath reads agree on every fixture', () => {
    agree(BASENAMES, bashAnswers(paths, 'hook_has_code_ext', BASENAMES), (b) => reminder().isCodePath(`src/${b}`), 'the code extension');
  });

  group('twins: the opt-in read, hook_repo_opted_in against settingsOptedIn in hooks/mods/gate.js');

  const optin = lib('hooks', 'lib', 'optin.sh');

  await test('hook_repo_opted_in and settingsOptedIn agree on every settings text', () => {
    const roots = settingsRoots(SETTINGS);
    const shell = bashAnswers(optin, 'hook_repo_opted_in', roots.map(shellPath));
    const js = (i) => mods('gate').settingsOptedIn(readOrNull(path.join(roots[i], '.workkit', 'settings.json')));
    agree(SETTINGS.map((_, i) => i), shell, js, 'the settings texts (by index into SETTINGS)');
    assertEq(js(SETTINGS.indexOf('{ "version": 1, "enabled": false }\n')), false, 'and a declined file is out');
    assertEq(js(SETTINGS.indexOf('{ "version": 1 }\n')), true, 'and a legacy file is in');
  });

  // A file mode is POSIX's: Windows reads a 000 file anyway, and so does root.
  const unreadable = (() => {
    if (IS_WINDOWS) return null;
    const [root] = settingsRoots(['{ "version": 1, "enabled": true }\n']);
    const file = path.join(root, '.workkit', 'settings.json');
    fs.chmodSync(file, 0o000);
    try { fs.readFileSync(file); return null; } catch { return root; }
  })();
  await testUnless(!unreadable, 'this machine reads a mode-000 file (Windows, or root)')(
    'an unreadable settings file reads opted out on both sides', () => {
      const [shell] = bashAnswers(optin, 'hook_repo_opted_in', [shellPath(unreadable)]);
      assertEq(shell, false, 'the shell reads an unreadable file as opted out');
      assertEq(mods('gate').settingsOptedIn(readOrNull(path.join(unreadable, '.workkit', 'settings.json'))), false,
        'and so does the module');
    });

  group('twins: the machine folder, wk_user_dir against userDir in hooks/mods/log.js and workflow/user-dir.js');

  const { userDir: nodeUserDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
  // [WORKFLOW_HOME, HOME]; an unset WORKFLOW_HOME is undefined.
  const HOMES = [[undefined, '/w/home'], ['/w/moved', '/w/home'], ['', '/w/home'], ['/w/moved', '/w/other'], [undefined, '/w/a b']];

  await test('wk_user_dir, log.js userDir and user-dir.js userDir agree on every WORKFLOW_HOME and HOME', () => {
    for (const [workflowHome, home] of HOMES) {
      const env = { PATH: SYSTEM_PATH, HOME: home, ...(workflowHome === undefined ? {} : { WORKFLOW_HOME: workflowHome }) };
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_user_dir`], {
        env, encoding: 'utf8', timeout: 10000,
      });
      const shell = (res.stdout || '').replace(/\r?\n$/, '');
      const label = `WORKFLOW_HOME ${JSON.stringify(workflowHome)}, HOME ${JSON.stringify(home)}`;
      assertEq(mods('log').userDir(workflowHome, home), shell, `${label}: log.js`);
      const saved = process.env.WORKFLOW_HOME;
      if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
      try {
        assertEq(nodeUserDir(home).replace(/\\/g, '/'), shell, `${label}: user-dir.js`);
      } finally {
        if (saved === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = saved;
      }
    }
  });

  await test('log.js userDirOf reads the machine folder from the env: WORKFLOW_HOME, else HOME, else USERPROFILE', () => {
    const { userDirOf } = mods('log');
    assertEq(userDirOf({ WORKFLOW_HOME: '/w/moved', HOME: '/w/home' }), '/w/moved', 'WORKFLOW_HOME set');
    assertEq(userDirOf({ HOME: '/w/home' }), '/w/home/.workkit', 'WORKFLOW_HOME unset');
    assertEq(userDirOf({ WORKFLOW_HOME: '', HOME: '/w/home' }), '/w/home/.workkit', 'an empty WORKFLOW_HOME is none');
    assertEq(userDirOf({ USERPROFILE: 'C:/Users/w' }), 'C:/Users/w/.workkit', 'no HOME: the Windows home');
  });

  group('twins: the CHANGELOG test, wk_is_changelog against isChangelog in hooks/mods/changelog-guard.js');

  await test('wk_is_changelog and isChangelog agree on every fixture', () => {
    const shell = bashAnswers(lib('workflow', 'lib', 'changelog.sh'), 'wk_is_changelog', CHANGELOGS);
    agree(CHANGELOGS, shell, (p) => mods('changelog-guard').isChangelog(p), 'the CHANGELOG test');
  });

  group("twins: the hooks log line, hooks/loader.sh's hook_log against logLine in hooks/mods/log.js");

  const outside = mkTmp('twins-log-cwd-');
  // [hook, the payload's raw text, the verdict the loader reaches].
  const FIRES = [
    ['fixture:none', JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: '/w/repo' }), 'missing'],
    ['fixture:none', JSON.stringify({ hook_event_name: 'Stop', session_id: 's"1\\x', cwd: '/w/repo' }), 'missing'],
    ['fixture:none', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's2', cwd: 'C:\\Users\\me\\repo' }), 'missing'],
    ['fixture:none', JSON.stringify({ hook_event_name: 'PreToolUse' }), 'missing'],
    ['docs:change-tracker', JSON.stringify({ hook_event_name: 'Stop', session_id: 's4', cwd: shellPath(outside) }), 'stood-down'],
  ];

  await test('every fire leaves the line logLine builds from the same fields', () => {
    for (const [hook, input, verdict] of FIRES) {
      const home = path.join(mkTmp('twins-log-'), 'workflow-home');
      const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(KIT, 'hooks', 'loader.sh')), hook], {
        input, cwd: outside, env: loaderEnv({ WORKFLOW_HOME: shellPath(home) }), encoding: 'utf8', timeout: 30000,
      });
      assertEq(res.status, 0, `${hook} ${input}: the loader exits 0, stderr: ${res.stderr}`);
      const file = path.join(home, 'hooks.log');
      const shell = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const iso = shell.split('\t')[0];
      assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso), `${input}: the shell line opens with its UTC time, got ${JSON.stringify(shell)}`);
      const p = JSON.parse(input);
      assertEq(shell, mods('log').logLine(iso, hook, p.hook_event_name, p.session_id, p.cwd, verdict), `${hook} ${input}`);
    }
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
