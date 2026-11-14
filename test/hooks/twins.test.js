// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. The rows: the test package, the
// package record's read, the tree hash, the opt-in read (the gate's and the heal's), one setting, the machine folder, the
// CHANGELOG test, the hooks log, the slug, the Proof pattern, the lint block's sentence, the working-diff reads, the
// version-only change, the status:building list, the public slug, git's value-taking global options. Plus one
// JavaScript pair, the plain-object test, and one shell pair, the two shims' norm_dir, in_list, real_path and PATH walk.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, stubTool, systemPathWith,
} = require('../lib/platform');
const { mkRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { mods, runResult } = require('../lib/mods-inputs');
const { recordArgv, readArgv } = require('../lib/argv-log');
const commitGate = require('./commit-gate/helpers');
const { runLib } = require('../lib/hook-lib');
const { pkgMarkerPath, treeHash } = require('../lib/suite-record');
const { scratchWorkflowHome } = require('../lib/workflow-home');
const { readOrNull } = require('../../workflow/lib/read');
const { makeRepo: healRepo, runScript: healRun, cleanup: healCleanup } = require('../scripts/workflow-standards/helpers');

const KIT = path.join(__dirname, '..', '..');
const lib = (...parts) => shellPath(path.join(KIT, ...parts));

/**
 * Each fixture through `fn` in one bash that sources `files` (one or a list, in
 * order): '1' where the function exits 0, '0' where it does not, one per fixture, in order.
 */
const bashAnswers = (files, fn, fixtures, env = {}) => {
  const sources = [].concat(files).map((f) => `. "${f}"\n`).join('');
  const script = `${sources}while IFS= read -r p; do if ${fn} "$p"; then echo 1; else echo 0; fi; done <<<"$FIXTURES"`;
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), FIXTURES: fixtures.join('\n'), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  const answers = (res.stdout || '').split('\n').filter(Boolean);
  expect(answers.length, `one answer per fixture from ${fn}, stderr: ${res.stderr}`).toBe(fixtures.length);
  return answers.map((a) => a === '1');
};

/**
 * Each fixture through `fn` in one bash that sources `file`: what the function
 * printed, one string per fixture, in order, '' where it printed nothing.
 */
const bashLines = (file, fn, fixtures, env = {}) => {
  const script = `. "${file}"\nwhile IFS= read -r p; do printf '%s\\n' "$(${fn} "$p")"; done <<<"$FIXTURES"`;
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), FIXTURES: fixtures.join('\n'), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  const lines = (res.stdout || '').replace(/\r/g, '').split('\n').slice(0, -1);
  expect(lines.length, `one line per fixture from ${fn}, stderr: ${res.stderr}`).toBe(fixtures.length);
  return lines;
};

/**
 * A scratch file holding the named pieces of a shell script that cannot be sourced (it runs on load): each
 * `name() {` function through its closing `}` line, or the one `NAME=(...)` line, then `extra` lines. Bash
 * runs them as written; returns the file's shell path, for bashLines. `dir` is the folder the file goes in.
 */
const scriptPieces = (script, names, extra = [], dir = mkTmp('twins-pieces-')) => {
  const lines = fs.readFileSync(script, 'utf8').split('\n');
  const pieces = names.map((name) => {
    const at = lines.findIndex((l) => l === `${name}() {` || l.startsWith(`${name}=(`));
    expect(at >= 0, `${path.basename(script)} defines ${name}`).toBeTruthy();
    if (!lines[at].endsWith('{')) return lines[at];
    const end = lines.indexOf('}', at);
    expect(end > at, `${name} in ${path.basename(script)} closes`).toBeTruthy();
    return lines.slice(at, end + 1).join('\n');
  });
  const file = path.join(dir, 'pieces.sh');
  fs.writeFileSync(file, [...pieces, ...extra, ''].join('\n'));
  return shellPath(file);
};

/** Asserts bash and JavaScript gave every fixture the same answer, naming each that differs. */
const agree = (fixtures, shell, js, what) => {
  const differ = fixtures.flatMap((f, i) => (shell[i] === js(f) ? [] : [`${JSON.stringify(f)}: bash ${shell[i]}`]));
  expect(differ.join('; '), `${what}: the fixtures bash and JavaScript answer differently`).toBe('');
};

const CHANGELOGS = [
  'CHANGELOG.md', 'docs/CHANGELOG.md', '/abs/repo/CHANGELOG.md', 'packages/a/CHANGELOG.md',
  'CHANGELOG.md.bak', 'xCHANGELOG.md', 'changelog.md', 'CHANGELOG', 'CHANGELOG.md/x', 'docs/OLD-CHANGELOG.md',
];

const MANIFESTS = [
  'package.json', 'package-lock.json', 'packages/a/package.json', 'packages/a/package-lock.json',
  '.claude-plugin/plugin.json', 'x/.claude-plugin/plugin.json', 'plugin.json', 'xpackage.json',
  'package.json.bak', 'fixtures/app.json', 'npm-shrinkwrap.json', 'package-lock.jsonx',
];

// A repo's settings text; null writes no file.
const SETTINGS = [
  null, '', '{}', '{ "version": 1 }\n', '{ "enabled": true }\n', '{ "version": 1, "enabled": false }\n',
  '{"enabled":false}', '{ "enabled" :\tfalse }', '{ "enabled": "false" }', '{ "enabled": true, "x": { "enabled": false } }',
  '{\n  "version": 1,\n  "enabled": false\n}\n', '{ "enabled":\nfalse }', '{ "enabled": "true" }',
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

// A PATH world whose `tool` records each argv to a log, runs `lines` and prints `out`;
// the real tools stay reachable behind it.
const recordingTool = (tool, out = '', lines = []) => {
  const bin = mkTmp(`twins-${tool}-`);
  const logFile = path.join(bin, 'argv.log');
  stubTool(bin, tool, ['#!/bin/bash', recordArgv(logFile), ...lines, `printf '%s' '${out}'`]);
  return { path: systemPathWith(bin), calls: () => readArgv(logFile) };
};

describe('twins: the test package, hook_test_package_dir in hooks/lib/paths.sh against testPackageDir in hooks/mods/suite.js', () => {
  test('hook_test_package_dir and testPackageDir name the same package for every path', async () => {
    const root = mkTmp('twins-pkgdir-');
    for (const d of ['pkg/src/deep', 'pkg/bare/src', 'pkg/empty', 'other', 'node_modules/x']) fs.mkdirSync(path.join(root, d), { recursive: true });
    const tested = JSON.stringify({ scripts: { test: 'node --test' } });
    for (const d of ['', 'pkg', 'node_modules/x']) fs.writeFileSync(path.join(root, d, 'package.json'), tested);
    fs.writeFileSync(path.join(root, 'pkg', 'bare', 'package.json'), '{"name":"bare"}');
    fs.writeFileSync(path.join(root, 'pkg', 'empty', 'package.json'), JSON.stringify({ scripts: { test: '' } }));
    const fixtures = ['pkg/src/deep/a.js', 'pkg/bare/src/a.js', 'pkg/empty/a.js', 'pkg/a.js', 'pkg', 'other/x.js',
      'app.js', 'node_modules/x/index.js', 'pkg/node_modules/y/z.js'];
    const shell = bashLines(lib('hooks', '_lib.sh'), 'hook_test_package_dir "$ROOT"', fixtures, { ROOT: shellPath(root) });
    const { testPackageDir, hasTestScript } = mods('suite');
    const read = (d) => JSON.parse(readOrNull(path.join(root, d, 'package.json')) ?? 'null');
    const js = await Promise.all(fixtures.map((p) => testPackageDir(p, async (d) => hasTestScript(read(d)))));
    const differ = fixtures.flatMap((f, i) => (shell[i] === js[i] ? [] : [`${f}: bash ${JSON.stringify(shell[i])}, js ${JSON.stringify(js[i])}`]));
    expect(differ.join('; '), 'the paths bash and JavaScript place in different packages').toBe('');
    expect(shell[0], 'and a file under a tested package names it').toBe('pkg');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('twins: the package record\'s read, wk_pkg_proved in workflow/lib/suite.sh against pkgProved in hooks/mods/suite.js', () => {
  test('wk_pkg_proved and pkgProved answer every tree and package alike on one planted record', () => {
    const dir = mkTmp('twins-pkg-record-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    const { workflowHome, env } = scratchWorkflowHome('twins-pkg-home-');
    const [T1, T2, T3] = ['1', '2', '3'].map((ch) => ch.repeat(40));
    const record = `${T1} .\n${T2} packages/a\n${T3} packages/b\n`;
    const marker = pkgMarkerPath(workflowHome, dir);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, record);
    const fixtures = [
      [T1, '.'], [T2, 'packages/a'], [T3, 'packages/b'], [T2, '.'], [T1, 'packages/a'], [T3, 'packages/a'],
      [T2, 'packages/c'], [T2, 'packages'], [T2, 'packages/a/x'], ['4'.repeat(40), '.'],
    ];
    const script = 'while read -r t p; do if wk_pkg_proved "$ROOT" "$t" "$p"; then echo 1; else echo 0; fi; done <<<"$FIXTURES"';
    const res = runLib(script, { ...env, ROOT: root, FIXTURES: fixtures.map((f) => f.join(' ')).join('\n') });
    const shell = res.stdout.split('\n').filter(Boolean).map((a) => a === '1');
    expect(shell.length, `one answer per fixture from wk_pkg_proved, stderr: ${res.stderr}`).toBe(fixtures.length);
    const { pkgProved } = mods('suite');
    agree(fixtures.map((_, i) => i), shell, (i) => pkgProved(record, ...fixtures[i]), 'the (tree, package) fixtures by index');
    expect(shell.slice(0, 3).join(), 'and each line proves its own package on its own tree').toBe('true,true,true');
  });
});

describe('twins: the tree hash, wk_tree_hash in workflow/lib/suite.sh against treeHash in test/lib/suite-record.js', () => {
  test('wk_tree_hash and treeHash print one id for a repo whose .workkit/ holds a tracked settings file and an untracked log', () => {
    const w = mkRepo('twins-tree-', { 'app.js': 'module.exports = 1;\n' });
    w.write('app.js', 'module.exports = 2;\n');
    w.write('.workkit/settings.json', OPT_IN_SHAPES.current);
    w.write('.workkit/suite.log', 'script-shell: exit 0\n');
    const res = runLib(`wk_tree_hash "${shellPath(w.repo)}"`, { TMPDIR: shellPath(w.tmp) });
    const shell = res.stdout.trim();
    expect(/^[0-9a-f]{40,64}$/.test(shell), `a tree id from wk_tree_hash, got: ${res.stdout}|${res.stderr}`).toBeTruthy();
    expect(treeHash(w.repo), 'the twin prints the kit\'s id').toBe(shell);
    fs.rmSync(w.dir, { recursive: true, force: true });
  });
});

describe('twins: the opt-in read, wk_opted_in in workflow/lib/participation.sh against settingsOptedIn in hooks/mods/gate.js', () => {
  // platform.sh first, as every caller sources it, so wk_opted_in reads through the node wk_node finds.
  const participation = [lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'participation.sh')];
  const fileOf = (root) => path.join(root, '.workkit', 'settings.json');
  const shellOptedIn = (roots) => bashAnswers(participation, 'wk_opted_in', roots.map(shellPath),
    { WORKKIT_NODE: shellPath(process.execPath) });

  test('wk_opted_in and settingsOptedIn agree on every settings text, and only a top-level "enabled": true is in', () => {
    const roots = settingsRoots(SETTINGS);
    const shell = shellOptedIn(roots);
    const js = (i) => mods('gate').settingsOptedIn(readOrNull(fileOf(roots[i])));
    agree(SETTINGS.map((_, i) => i), shell, js, 'the settings texts (by index into SETTINGS)');
    expect(JSON.stringify(shell), 'no file, an empty file, {}, a version alone and every false or non-true value are out')
      .toBe(JSON.stringify([false, false, false, false, true, false, false, false, false, true, false, false, false]));
  });

  test('settingsOptedIn reads only the top-level enabled key, and text that does not parse is out', () => {
    const { settingsOptedIn } = mods('gate');
    expect(settingsOptedIn('{"enabled": true, "manager": {"enabled": false}}'), 'a nested enabled: false leaves an opted-in repo in').toBe(true);
    expect(settingsOptedIn('{"enabled": false}'), 'the top-level decline is out').toBe(false);
    expect(settingsOptedIn('{"manager": {"enabled": true}}'), 'a nested enabled: true alone is out').toBe(false);
    expect(settingsOptedIn('not json'), 'text that does not parse is out').toBe(false);
    expect(settingsOptedIn('  \n'), 'a whitespace-only file has no enabled key: out').toBe(false);
    expect(settingsOptedIn(null), 'and no file at all is out').toBe(false);
  });

  // A file mode is POSIX's: Windows reads a 000 file anyway, and so does root.
  // Made when the file is collected, since the case's skip value needs it.
  const unreadable = (() => {
    if (IS_WINDOWS) return null;
    const [root] = settingsRoots([OPT_IN_SHAPES.current]);
    const file = path.join(root, '.workkit', 'settings.json');
    fs.chmodSync(file, 0o000);
    try { fs.readFileSync(file); return null; } catch { return root; }
  })();
  test('an unreadable settings file reads opted out on both sides',
    { skip: !unreadable && 'this machine reads a mode-000 file (Windows, or root)' }, () => {
      const [shell] = shellOptedIn([unreadable]);
      expect(shell, 'the shell reads an unreadable file as opted out').toBe(false);
      expect(mods('gate').settingsOptedIn(readOrNull(fileOf(unreadable))),
        'and so does the module').toBe(false);
    });
});

describe('twins: the opt-in read, the heal\'s --state (resolve_state in workflow/standards/state.sh) against settingsOptedIn', () => {
  test('the heal reads a repo enabled exactly where settingsOptedIn reads it in, and a string enabled is no answer it offers on', () => {
    const states = SETTINGS.map((text) => {
      const repo = healRepo({ settings: text });
      const state = healRun(repo, { args: ['--state'] }).stdout.trim();
      healCleanup(repo);
      return state;
    });
    const js = (i) => mods('gate').settingsOptedIn(SETTINGS[i]);
    agree(SETTINGS.map((_, i) => i), states.map((s) => s === 'enabled'), js, 'the settings texts (by index into SETTINGS)');
    for (const text of ['{ "enabled": "false" }', '{ "enabled": "true" }']) {
      expect(states[SETTINGS.indexOf(text)], `${text}: no answer, so the heal offers`).toBe('undecided');
    }
  });
});

describe('twins: one setting, wk_setting in workflow/lib/participation.sh against loadSettings in hooks/mods/settings.js', () => {
  // [dotted key, machine file body, repo file body]; undefined writes no file.
  const LAYERS = [
    ['findings.file', undefined, undefined],
    ['findings.file', { findings: { file: true } }, { enabled: true }],
    ['findings.file', { findings: { file: true } }, { enabled: true, findings: { file: false } }],
    ['tests.budget', { tests: { budget: 5 } }, { enabled: true, tests: { budget: null } }],
    ['tests.check', undefined, { enabled: true }],
    ['tests.check', { tests: { check: 2 } }, { enabled: true }],
    ['tests.check', { tests: { check: 2 } }, { enabled: true, tests: { check: 0.5 } }],
    ['proof.rootOnly', { proof: { rootOnly: ['a', 'b'] } }, { enabled: true, proof: { rootOnly: ['c'] } }],
    ['hooks.afterRelease', { hooks: { afterRelease: null } }, { enabled: true }],
    ['public', { public: 'acme/public' }, { enabled: true }],
    ['site.repo', { site: { repo: 'acme/home' } }, { enabled: true, site: null }],
    ['manager.tiers', { manager: { tiers: { workhorse: 'haiku' } } }, undefined],
    ['enabled', { enabled: true }, {}],
    ['enabled', { enabled: false }, { enabled: true }],
    ['manager', { manager: 'off' }, undefined],
    ['identity.tokenUrl', undefined, { enabled: true, identity: 'x' }],
  ];

  test('wk_setting and loadSettings give every key over every pair of layers the same value', () => {
    const differ = [];
    for (const [key, user, repo] of LAYERS) {
      const dir = mkTmp('twins-setting-');
      const files = { user: path.join(dir, 'home', '.workkit', 'settings.json'), repo: path.join(dir, 'repo', '.workkit', 'settings.json') };
      for (const [layer, body] of [['user', user], ['repo', repo]]) {
        fs.mkdirSync(path.dirname(files[layer]), { recursive: true });
        if (body !== undefined) fs.writeFileSync(files[layer], `${JSON.stringify(body)}\n`);
      }
      const root = path.join(dir, 'repo');
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"\n. "${lib('workflow', 'lib', 'participation.sh')}"\nwk_setting "$1" "$2"`, 'bash', shellPath(root), key], {
        env: { PATH: SYSTEM_PATH, HOME: shellPath(path.join(dir, 'home')), WORKFLOW_HOME: shellPath(path.dirname(files.user)) },
        encoding: 'utf8',
        timeout: SPAWN_DEADLINE,
      });
      // A string prints raw, null as nothing, anything else as JSON.
      const printed = (res.stdout || '').replace(/\r/g, '').replace(/\n$/, '');
      let shell = null;
      if (printed !== '') { try { shell = JSON.parse(printed); } catch { shell = printed; } }
      const merged = mods('settings').loadSettings(readOrNull, { kit: KIT, root, user: files.user });
      const node = key.split('.').reduce((v, k) => (v === null || v === undefined ? v : v[k]), merged) ?? null;
      if (JSON.stringify(shell) !== JSON.stringify(node)) differ.push(`${key} over ${JSON.stringify([user, repo])}: bash ${printed}, node ${JSON.stringify(node)}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(differ.join('; '), 'the layers bash and JavaScript read differently').toBe('');
  });
});

describe('twins: the machine folder, wk_user_dir against userDir in hooks/mods/log.js and workflow/user-dir.js', () => {
  const { userDir: nodeUserDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
  // [WORKFLOW_HOME, HOME]; an unset WORKFLOW_HOME is undefined.
  const HOMES = [[undefined, '/w/home'], ['/w/moved', '/w/home'], ['', '/w/home'], ['/w/moved', '/w/other'], [undefined, '/w/a b']];

  test('wk_user_dir, log.js userDir and user-dir.js userDir agree on every WORKFLOW_HOME and HOME', () => {
    for (const [workflowHome, home] of HOMES) {
      const env = { PATH: SYSTEM_PATH, HOME: home, ...(workflowHome === undefined ? {} : { WORKFLOW_HOME: workflowHome }) };
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_user_dir`], {
        env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const shell = (res.stdout || '').replace(/\r?\n$/, '');
      const label = `WORKFLOW_HOME ${JSON.stringify(workflowHome)}, HOME ${JSON.stringify(home)}`;
      expect(mods('log').userDir(workflowHome, home), `${label}: log.js`).toBe(shell);
      const saved = process.env.WORKFLOW_HOME;
      if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
      try {
        expect(nodeUserDir(home).replace(/\\/g, '/'), `${label}: user-dir.js`).toBe(shell);
      } finally {
        if (saved === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = saved;
      }
    }
  });

  test('log.js userDirOf reads the machine folder from the env: WORKFLOW_HOME, else HOME, else USERPROFILE', () => {
    const { userDirOf } = mods('log');
    expect(userDirOf({ WORKFLOW_HOME: '/w/moved', HOME: '/w/home' }), 'WORKFLOW_HOME set').toBe('/w/moved');
    expect(userDirOf({ HOME: '/w/home' }), 'WORKFLOW_HOME unset').toBe('/w/home/.workkit');
    expect(userDirOf({ WORKFLOW_HOME: '', HOME: '/w/home' }), 'an empty WORKFLOW_HOME is none').toBe('/w/home/.workkit');
    expect(userDirOf({ USERPROFILE: 'C:/Users/w' }), 'no HOME: the Windows home').toBe('C:/Users/w/.workkit');
  });
});

describe('twins: the CHANGELOG test, wk_is_changelog against isChangelog in hooks/mods/changelog-guard.js', () => {
  test('wk_is_changelog and isChangelog agree on every fixture', () => {
    const shell = bashAnswers(lib('workflow', 'lib', 'changelog.sh'), 'wk_is_changelog', CHANGELOGS);
    agree(CHANGELOGS, shell, (p) => mods('changelog-guard').isChangelog(p), 'the CHANGELOG test');
  });
});

describe('twins: the hooks log, wk_hooks_log in workflow/lib/platform.sh against the log hooks/mods/log.js writes', () => {
  // [hook, event, session id, cwd, verdict], the fields of one fire's line.
  const FIRES = [
    ['safety:commit-gate', 'PreToolUse', 's1', '/w/repo', 'run'],
    ['docs:change-tracker', 'Stop', 's"1\\x', 'C:\\Users\\me\\repo', 'stood-down'],
    ['workflow:snapshot', 'PostToolUse', undefined, undefined, 'crashed'],
  ];

  test('the module writes its log where wk_hooks_log looks, and each line reads back as its six fields', () => {
    const { userDirOf, logLine, appendLog } = mods('log');
    const scratch = mkTmp('twins-log-');
    for (const env of [{ HOME: path.join(scratch, 'home') }, { HOME: path.join(scratch, 'home'), WORKFLOW_HOME: path.join(scratch, 'moved') }]) {
      const iso = '2026-10-21T12:00:00Z';
      const text = appendLog('', FIRES.map(([hook, event, sid, cwd, verdict]) => logLine(iso, hook, event, sid, cwd, verdict)).join(''));
      const file = `${userDirOf(env)}/hooks.log`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const shellEnv = { PATH: SYSTEM_PATH, HOME: shellPath(env.HOME), ...(env.WORKFLOW_HOME ? { WORKFLOW_HOME: shellPath(env.WORKFLOW_HOME) } : {}) };
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_hooks_log; printf '%s\\n' "$WK_HOOKS_LOG"; cat "$WK_HOOKS_LOG"`], {
        env: shellEnv, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const [where, ...rest] = (res.stdout || '').split('\n');
      const label = env.WORKFLOW_HOME ? 'WORKFLOW_HOME set' : 'WORKFLOW_HOME unset';
      expect(where, `${label}: the file wk_hooks_log names, stderr: ${res.stderr}`).toBe(shellPath(file));
      expect(rest.join('\n'), `${label}: the shell reads the module's lines back unchanged`).toBe(text);
      const rows = text.split('\n').filter(Boolean).map((l) => l.split('\t'));
      expect(JSON.stringify(rows.map((r) => r.length)), `${label}: six fields a line`).toBe(JSON.stringify(FIRES.map(() => 6)));
      expect(JSON.stringify(rows.map((r) => [r[1], r[5]])),
        `${label}: the hook second and the verdict last`).toBe(JSON.stringify(FIRES.map((f) => [f[0], f[4]])));
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
});

describe('twins: the slug, wk_slug_from_remote in workflow/lib/slug.sh against slugFromRemote in workflow/slug.js and hooks/mods/slug.js', () => {
  // Remote urls as git stores them; the last four name no repo.
  const REMOTES = [
    'git@github.com:acme/widgets.git', 'https://github.com/acme/widgets.git', 'https://github.com/acme/widgets',
    'ssh://git@github.com/acme/widgets.git', 'https://github.com/acme/widgets/', '  git@github.com:acme/widgets.git  ',
    'C:\\Users\\x\\theirs.git', '/srv/git/acme/widgets.git', 'widgets', 'widgets.git', '', '   ',
  ];

  test('the three slug readers give every remote the same slug, and no match the same nothing', () => {
    const shell = bashLines(lib('workflow', 'lib', 'slug.sh'), 'wk_slug_from_remote', REMOTES);
    const { slugFromRemote: engine } = require(path.join(KIT, 'workflow', 'slug.js'));
    const { slugFromRemote: module } = mods('slug');
    const differ = REMOTES.flatMap((r, i) => {
      const said = [engine(r), module(r)].map((s) => s ?? '');
      return said.every((s) => s === shell[i]) ? [] : [`${JSON.stringify(r)}: bash ${JSON.stringify(shell[i])}, workflow/slug.js ${JSON.stringify(said[0])}, hooks/mods/slug.js ${JSON.stringify(said[1])}`];
    });
    expect(differ.join('; '), 'the remotes the three readers answer differently').toBe('');
    expect(shell[0], 'an ssh remote names its repo').toBe('acme/widgets');
    expect(shell[1], 'an https remote with .git names its repo').toBe('acme/widgets');
    expect(shell[REMOTES.indexOf('widgets')], 'a remote with no match names nothing in bash').toBe('');
    expect(engine('widgets'), 'and the two JavaScript readers answer no match alike').toBe(module('widgets'));
  });
});

describe('twins: the Proof pattern, workflow/ship/items.sh against PROOF_RE in hooks/mods/proof.js', () => {
  // Comment bodies a Proof: read meets; the last five carry no Proof: at a line start.
  const BODIES = [
    'Proof: unit', 'looks good\nProof: unit: node tests/x.test.js', 'notes first\n  \tProof: integration',
    'a\n\nProof:', 'x\r\nProof: after a CRLF', '\tProof:x',
    'proof: unit', 'Proof of concept only', 'the Proof: line is still to come', '', 'Proofs: none',
  ];

  test("the ship's jq test and PROOF_RE match the same comment bodies", () => {
    const src = fs.readFileSync(path.join(KIT, 'workflow', 'ship', 'items.sh'), 'utf8');
    const found = src.match(/test\("([^"]*Proof:[^"]*)"\)/);
    expect(found, 'items.sh tests each comment against a Proof: pattern').toBeTruthy();
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', 'jq -c "map(test(\\"$PATTERN\\"))"'], {
      env: { PATH: SYSTEM_PATH, PATTERN: found[1] }, input: JSON.stringify(BODIES), encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `jq ran the ship's pattern, stderr: ${res.stderr}`).toBe(0);
    const shell = JSON.parse(res.stdout);
    agree(BODIES, shell, (b) => mods('proof').PROOF_RE.test(b), 'the Proof pattern');
    expect(JSON.stringify(shell.slice(0, 6)), 'a Proof: line at a line start matches').toBe(JSON.stringify([true, true, true, true, true, true]));
    expect(JSON.stringify(shell.slice(6)), 'and nothing else does').toBe(JSON.stringify([false, false, false, false, false]));
  });
});

describe('twins: the lint block, wk_changelog_lint in workflow/lib/changelog.sh against lintText in hooks/mods/commit-gate.js', () => {
  // The linter's findings, the same on both sides: a node stub prints them in bash.
  const SAID = 'CHANGELOG.md:7 [word-cap] 62 words (max 50)\nCHANGELOG.md:7 [link] no issue link';

  test('a failed lint reads the same sentence and findings from the shell and from the gate', async () => {
    const node = mkTmp('twins-node-');
    stubTool(node, 'node', ['#!/bin/bash', `printf '%b\\n' '${SAID.replace(/\n/g, '\\n')}' >&2`, 'exit 1']);
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'changelog.sh')}"; wk_changelog_lint /w/repo --staged CHANGELOG.md`], {
      env: { PATH: systemPathWith(node), HOME: shellPath(os.homedir()), WORKFLOW_DIR: lib('workflow') }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the shell lint fails, stderr: ${res.stderr}`).toBe(1);
    const r = commitGate.mkRepo();
    commitGate.stage(r, 'CHANGELOG.md', commitGate.CHANGELOG('- An essay entry.'));
    const facts = { ...commitGate.factsOf(r), lint: async () => runResult({ exitCode: 1, stderr: `${SAID}\n` }) };
    const deny = commitGate.denyOf(await mods('commit-gate').preCommitVerdict(facts));
    expect(deny !== null && deny.startsWith(commitGate.PREFIX), `the gate blocks on the lint, got: ${deny}`).toBeTruthy();
    expect(deny.slice(commitGate.PREFIX.length), 'the sentence and the findings, byte for byte').toBe(res.stderr.replace(/\n$/, ''));
  });
});

describe('twins: the working diff, hook_working_paths in hooks/lib/tree.sh against the touched list proof-guard reads', () => {
  // The reads the touched list hangs on: the HEAD check, the working diff, the untracked list (never the ref reads).
  const touchedReads = (calls) => calls.filter((a) => ['diff', 'ls-files'].includes(a[0]) || (a[0] === 'rev-parse' && a.includes('--verify')));
  for (const headed of [true, false]) {
    const kinds = headed ? 'rev-parse, diff, ls-files' : 'rev-parse, ls-files, ls-files';
    test(`hook_working_paths and the qa check make the same reads in the same order, ${headed ? 'a repo with a commit' : 'a repo with no commit'}: ${kinds}`, async () => {
      const git = recordingTool('git', '', headed ? [] : ['[[ " $* " == *" --verify "* ]] && exit 1']);
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('hooks', 'lib', 'tree.sh')}"; hook_working_paths /w/repo`], {
        env: { PATH: git.path, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      expect(res.status, `the shell reads ran, stderr: ${res.stderr}`).toBe(0);
      const shell = git.calls().map((argv) => (argv[0] === '-C' ? argv.slice(2) : argv));
      expect(shell.map((a) => a[0]).join(', '), `the shell's reads, got: ${JSON.stringify(shell)}`).toBe(kinds);
      const runs = [];
      const view = JSON.stringify({ state: 'OPEN', url: 'https://github.com/o/r/issues/12', labels: [{ name: 'status:building' }], comments: [], body: '' });
      const recordRun = async (argv, init = {}) => {
        runs.push({ argv: [...argv], init });
        const unborn = !headed && argv[0] === 'git' && argv[1] === 'rev-parse' && argv.includes('--verify');
        return runResult({ exitCode: unborn ? 1 : 0, stdout: argv[0] === 'gh' ? view : '' });
      };
      const { proofVerdict, proofFacts } = mods('proof-guard');
      const facts = await proofFacts({
        cwd: '/w/repo', env: { HOME: '/w/home' }, top: async () => '/w/repo', read: async () => null, list: async () => [], run: recordRun, pluginRoot: KIT,
      });
      await proofVerdict({ steps: [{ sub: 'edit', number: 12, add: ['status:qa'], remove: ['status:building'] }], cwd: '/w/repo', repo: null, facts });
      const reads = touchedReads(runs.filter((c) => c.argv[0] === 'git').map((c) => c.argv.slice(1)));
      expect(JSON.stringify(reads), 'the module makes the shell\'s reads, in its order').toBe(JSON.stringify(shell));
    });
  }
});

describe('twins: the version file test, hook_is_manifest in hooks/lib/tree.sh against isManifest in hooks/mods/commit-gate/checks.js', () => {
  test('hook_is_manifest and isManifest agree on every fixture', () => {
    const shell = bashAnswers(lib('hooks', 'lib', 'tree.sh'), 'hook_is_manifest', MANIFESTS);
    agree(MANIFESTS, shell, (p) => mods('commit-gate/checks').isManifest(p), 'the version file test');
  });
});

describe('twins: the version-only change, hook_version_only_change in hooks/lib/tree.sh against versionOnly in hooks/mods/commit-gate/checks.js', () => {
  // One JSON file's HEAD text, then its working copy: the version alone, another key too, a copy that does not parse.
  const HEAD_JSON = '{\n  "version": 1,\n  "enabled": true\n}\n';
  const CHANGES = {
    'stamp.json': '{\n  "version": 2,\n  "enabled": true\n}\n',
    'other.json': '{\n  "version": 2,\n  "enabled": false\n}\n',
    'broken.json': '{\n  "version": 2,\n',
  };

  test('hook_version_only_change and versionOnly give every change the same answer', () => {
    const files = Object.keys(CHANGES);
    const w = mkRepo('twins-version-', Object.fromEntries(files.map((f) => [f, HEAD_JSON])), undefined, { optIn: false });
    for (const f of files) w.write(f, CHANGES[f]);
    const shell = bashAnswers(lib('hooks', '_lib.sh'), `hook_version_only_change "${shellPath(w.repo)}"`, files);
    agree(files, shell, (f) => mods('commit-gate/checks').versionOnly(HEAD_JSON, CHANGES[f]), 'the version-only change');
    expect(JSON.stringify(shell), 'only the lone version stamp is version-only').toBe(JSON.stringify([true, false, false]));
    fs.rmSync(w.dir, { recursive: true, force: true });
  });

  // A lockfile's HEAD text, then its working copy: every version spot moved
  // (the top, the root entry, a member's), and a dependency's entry moved too.
  const lock = (version, dep) => `${JSON.stringify({
    name: 'w',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'w', version }, 'node_modules/dep': { version: dep }, 'packages/a': { name: 'a', version } },
  }, null, 2)}\n`;
  const LOCK_HEAD = lock('1.0.0', '2.0.0');
  const LOCK_CHANGES = { 'stamp-lock.json': lock('1.1.0', '2.0.0'), 'dep-lock.json': lock('1.1.0', '2.1.0') };

  test('hook_version_only_change and versionOnly read a lockfile\'s version spots alike, and a dependency\'s entry as no stamp', () => {
    const files = Object.keys(LOCK_CHANGES);
    const w = mkRepo('twins-lock-', Object.fromEntries(files.map((f) => [f, LOCK_HEAD])), undefined, { optIn: false });
    for (const f of files) w.write(f, LOCK_CHANGES[f]);
    const shell = bashAnswers(lib('hooks', '_lib.sh'), `hook_version_only_change "${shellPath(w.repo)}"`, files);
    agree(files, shell, (f) => mods('commit-gate/checks').versionOnly(LOCK_HEAD, LOCK_CHANGES[f]), 'the lockfile stamp');
    expect(JSON.stringify(shell), 'only the version spots moving is version-only').toBe(JSON.stringify([true, false]));
    fs.rmSync(w.dir, { recursive: true, force: true });
  });
});

describe('twins: the status:building list, wk_issues_building in workflow/lib/hold.sh against buildingList in hooks/mods/gh.js', () => {
  test('wk_issues_building and buildingList ask gh with the same argv, with and without a repo', async () => {
    for (const repo of ['', 'acme/widgets']) {
      const gh = recordingTool('gh', '[]');
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; . "${lib('workflow', 'lib', 'hold.sh')}"; wk_issues_building ${repo}`], {
        env: { PATH: gh.path, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const shell = gh.calls();
      expect(shell.length, `${repo || 'no repo'}: the shell asks gh once, stderr: ${res.stderr}`).toBe(1);
      expect(res.status, `${repo || 'no repo'}: the shell reads gh's answer, stderr: ${res.stderr}`).toBe(0);
      const runs = [];
      await mods('gh').buildingList(async (argv) => { runs.push(argv); return runResult({ stdout: '[]' }); }, { repo });
      expect(JSON.stringify(runs[0].slice(1)), `${repo || 'no repo'}: the same argv`).toBe(JSON.stringify(shell[0]));
    }
  });
});

describe('twins: the public slug, PUBLIC_SLUG_RE in workflow/standards/labels.sh against SLUG_RE and the Public: link in workflow/public/lib.js', () => {
  // `public` key values; the first four are slugs.
  const PUBLIC_KEYS = [
    'acme/public', 'Acme-Co/free-proxy-list', 'a1/b.c_d-e', 'acme/.github', 'acme', '', 'acme/', '/public',
    'acme/public/x', 'ac me/public', 'acme_co/public', 'acme/pub$lic', 'https://github.com/acme/public',
  ];

  test('the heal and the verbs take the same values as a slug, and the Public: link reads those alone', () => {
    const script = `. "${lib('workflow', 'standards', 'labels.sh')}"
while IFS= read -r p; do if [[ "$p" =~ $PUBLIC_SLUG_RE ]]; then echo 1; else echo 0; fi; done <<<"$FIXTURES"`;
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
      env: { PATH: SYSTEM_PATH, FIXTURES: PUBLIC_KEYS.join('\n') }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    const shell = (res.stdout || '').split('\n').filter(Boolean).map((a) => a === '1');
    expect(shell.length, `one answer per value, stderr: ${res.stderr}`).toBe(PUBLIC_KEYS.length);
    expect(JSON.stringify(shell.slice(0, 5)), 'the four slugs pass, a bare owner does not').toBe(JSON.stringify([true, true, true, true, false]));
    const { SLUG_RE, publicLink } = require(path.join(KIT, 'workflow', 'public', 'lib.js'));
    agree(PUBLIC_KEYS, shell, (k) => SLUG_RE.test(k), 'PUBLIC_SLUG_RE against SLUG_RE');
    agree(PUBLIC_KEYS, shell, (k) => publicLink(`Public: https://github.com/${k}/issues/1`) !== null, 'PUBLIC_SLUG_RE against the Public: link');
  });
});

describe('twins: git\'s value-taking global options, VALUE_FLAGS in workflow/gitshim/git against GIT_VALUE_FLAGS in hooks/mods/tree-guard.js', () => {
  test('the shim\'s list and the exported set name the same options', () => {
    const pieces = scriptPieces(path.join(KIT, 'workflow', 'gitshim', 'git'), ['VALUE_FLAGS']);
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${pieces}"; printf '%s\\n' "\${VALUE_FLAGS[@]}"`],
      { env: { PATH: SYSTEM_PATH }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the shell printed its list, stderr: ${res.stderr}`).toBe(0);
    const listed = res.stdout.replace(/\r/g, '').split('\n').filter(Boolean);
    const { GIT_VALUE_FLAGS } = mods('tree-guard');
    expect(GIT_VALUE_FLAGS instanceof Set, 'tree-guard.js exports GIT_VALUE_FLAGS as a set').toBeTruthy();
    expect(JSON.stringify([...listed].sort()), 'the shim\'s VALUE_FLAGS and the exported set').toBe(JSON.stringify([...GIT_VALUE_FLAGS].sort()));
  });
});

describe('twins: the shims\' shared readers, norm_dir, in_list, real_path and the PATH walk in workflow/gitshim/git against workflow/identity/gh', () => {
  const SHIMS = [path.join(KIT, 'workflow', 'gitshim', 'git'), path.join(KIT, 'workflow', 'identity', 'gh')];
  // norm_dir sets NORM rather than printing it; this prints it, so bashLines reads each answer.
  const NORM_LINE = ['norm_line() { norm_dir "$1"; printf \'%s\' "$NORM"; }'];

  test('both shims\' norm_dir read every PATH entry alike: an empty entry is the cwd, a trailing slash dropped, a bare / kept', () => {
    const entries = ['', '/', '/a/b', '/a/b/', 'rel/', '.', 'C:/x/', '/c/Program Files/Git/bin/'];
    const [git, gh] = SHIMS.map((s) => bashLines(scriptPieces(s, ['norm_dir'], NORM_LINE), 'norm_line', entries));
    agree(entries.map((_, i) => i), git, (i) => gh[i], 'git shim norm_dir against gh shim norm_dir (by index into the entries)');
    expect(JSON.stringify(git.slice(0, 4)), 'the empty entry, /, and a trailing slash').toBe(JSON.stringify(['.', '/', '/a/b', '/a/b']));
  });

  test('both shims\' in_list answer every word alike: a whole-item match only, the empty item matched by the empty word', () => {
    // in_list takes the word and the list; this asks it of one fixed list and prints 1 or 0.
    const IN_LINE = ['in_line() { if in_list "$1" checkout "a b" "" "-c"; then printf 1; else printf 0; fi; }'];
    const words = ['checkout', 'a b', '', '-c', 'check', 'checkoutx', 'a', '*', 'b'];
    const [git, gh] = SHIMS.map((s) => bashLines(scriptPieces(s, ['in_list'], IN_LINE), 'in_line', words));
    agree(words.map((_, i) => i), git, (i) => gh[i], 'git shim in_list against gh shim in_list (by index into the words)');
    expect(git.join(''), 'the four items, and no part or pattern of one').toBe('111100000');
  });

  test('both shims\' real_path walk every link chain alike, to the file\'s real path',
    { skip: IS_WINDOWS && 'Windows makes no symlink without a privilege this run may lack' }, () => {
      const dir = fs.realpathSync(mkTmp('twins-real-path-'));
      fs.mkdirSync(path.join(dir, 'real'));
      const file = path.join(dir, 'real', 'tool');
      fs.writeFileSync(file, '#!/bin/sh\n');
      fs.symlinkSync('real/tool', path.join(dir, 'relative'));
      fs.symlinkSync(file, path.join(dir, 'absolute'));
      fs.symlinkSync('relative', path.join(dir, 'chain'));
      fs.symlinkSync('real', path.join(dir, 'linked-dir'));
      const paths = [file, 'relative', 'absolute', 'chain', 'linked-dir/tool'].map((p) => (path.isAbsolute(p) ? p : path.join(dir, p)));
      const [git, gh] = SHIMS.map((s) => bashLines(scriptPieces(s, ['real_path']), 'real_path', paths));
      agree(paths.map((_, i) => i), git, (i) => gh[i], 'git shim real_path against gh shim real_path (by index into the paths)');
      expect(JSON.stringify(git), 'every path is the one real file').toBe(JSON.stringify(paths.map(() => file)));
    });

  test('both shims\' PATH walks pick the same entry: past their own folder and every folder met at or before it, linked, missing and relative entries as PATH spells them, executables alone', () => {
    const root = mkTmp('twins-walk-');
    // A PATH folder holding both tools, so each walk has its tool to find there.
    const toolDir = (name) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      for (const tool of ['git', 'gh']) stubTool(dir, tool, ['#!/bin/sh', 'exit 0']);
      return dir;
    };
    const [copy, stub] = ['copy', 'stub'].map((name) => shellPath(toolDir(name)));
    toolDir('rel-bin');
    // Both tools there, neither executable: no mode bit, and no `#!` for Git Bash to read as one.
    const noexec = path.join(root, 'noexec');
    fs.mkdirSync(noexec);
    for (const tool of ['git', 'gh']) fs.writeFileSync(path.join(noexec, tool), 'not a tool\n', { mode: 0o644 });
    const missing = shellPath(path.join(root, 'missing'));
    // Each walk runs from a pieces file in a folder of its own that holds its tool too, as the shim's folder holds the shim.
    const walks = [['git', 'real_git', 'if real_git; then printf \'%s\' "$GIT"; else printf none; fi'], ['gh', 'real_gh', 'real_gh || printf none']]
      .map(([tool, fn, print], i) => {
        const lines = fs.readFileSync(SHIMS[i], 'utf8').split('\n');
        const [from, to] = [lines.indexOf('OWN_DIR=.'), lines.indexOf('OWN_DIR="$NORM"')];
        expect(from >= 0 && to > from, `${path.basename(SHIMS[i])} sets OWN_DIR from its own path`).toBeTruthy();
        const own = toolDir(`own-${tool}`);
        // A junction on Windows, which needs no privilege; elsewhere the type is ignored.
        const ownLink = path.join(root, `own-${tool}-link`);
        fs.symlinkSync(own, ownLink, 'junction');
        const entries = {
          own: shellPath(own), ownSlash: `${shellPath(own)}/`, ownLink: shellPath(ownLink), copy, stub, missing, rel: 'rel-bin', noexec: shellPath(noexec),
        };
        return { tool, entries, file: scriptPieces(SHIMS[i], ['norm_dir', fn], [...lines.slice(from, to + 1), print], own) };
      });
    // Each PATH and the entry the walk must pick: past the own folder spelled again, a copy met before it, a missing
    // entry; a relative entry as spelled; the next shim copy after it; nothing after it; the whole PATH when it is absent;
    // the own folder through a link, a different spelling; the own folder met first, not last; a tool not executable.
    const ROWS = [
      [['own', 'ownSlash', 'missing', 'stub'], 'stub'],
      [['copy', 'own', 'copy', 'stub'], 'stub'],
      [['own', 'missing', 'rel', 'stub'], 'rel'],
      [['own', 'copy', 'stub'], 'copy'],
      [['stub', 'own'], 'none'],
      [['missing', 'rel', 'stub'], 'rel'],
      [['own', 'ownLink', 'stub'], 'ownLink'],
      [['own', 'stub', 'own', 'copy'], 'stub'],
      [['own', 'noexec', 'stub'], 'stub'],
    ];
    const [git, gh] = walks.map(({ tool, entries, file }) => ROWS.map(([names]) => {
      // PATH is set inside bash, so it reads the spellings as written on every platform.
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', 'PATH="$1"; . "$2"', 'walk', names.map((n) => entries[n]).join(':'), file], {
        cwd: root, env: { PATH: SYSTEM_PATH }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const pick = (res.stdout || '').replace(/\r/g, '').trim();
      if (pick === 'none') return pick;
      expect(pick.endsWith(`/${tool}`), `the ${tool} walk printed a ${tool} or none, got: ${pick} ${res.stderr}`).toBeTruthy();
      const dir = pick.slice(0, -(tool.length + 1));
      return Object.keys(entries).find((n) => entries[n] === dir) || dir;
    }));
    const expected = ROWS.map(([, pick]) => pick);
    agree(expected.map((_, i) => i), git, (i) => gh[i], 'git shim real_git against gh shim real_gh (by index into the PATHs)');
    expect(JSON.stringify(git), 'the entry each PATH leads to').toBe(JSON.stringify(expected));
  });
});

describe('twins: the plain-object test, isPlain in workflow/ship/entries.js against hooks/mods/settings.js', () => {
  test('both isPlain copies answer every value alike: only a non-null, non-array object is plain', () => {
    const { isPlain: entriesPlain } = require(path.join(KIT, 'workflow', 'ship', 'entries.js'));
    const values = [{}, { command: 'x' }, Object.create(null), [], [{}], null, undefined, 0, 1, '', 'x', true, false, () => {}, new Date(0)];
    const settingsPlain = mods('settings').isPlain;
    const differ = values.flatMap((v, i) => (entriesPlain(v) === settingsPlain(v) ? [] : [`value ${i}: entries ${entriesPlain(v)}`]));
    expect(differ.join('; '), 'the values the two copies answer differently').toBe('');
    expect(values.slice(0, 6).map(entriesPlain).join(','), 'objects are plain, arrays and null are not').toBe('true,true,true,false,false,false');
  });
});
