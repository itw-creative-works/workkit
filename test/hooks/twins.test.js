// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. The rows: the
// suite log's path, the test script, the marker path, the color gate, the plain mutex, the marker sweep, the opt-in read (the gate's and the heal's), the session rule, one setting, the machine folder,
// the hooks log, the slug, the public slug, git's value-taking global options. Plus one
// shell pair, the two shims' norm_dir, in_list, real_path and PATH walk.
// And one export with no shell side, the CHANGELOG test.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NO_RC, shellPath, stubTool, spawnSystemBash, nodeEnv,
} = require('../lib/platform');
const { mkRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { mods } = require('../lib/mods-inputs');
const commitGate = require('./commit-gate/helpers');
const { runLib } = require('../lib/hook-lib');
const { agedFile, daysAgo } = require('../lib/workflow-home');
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
  const res = spawnSystemBash([...NO_RC, '-c', script], {
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
  const res = spawnSystemBash([...NO_RC, '-c', script], {
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

// [logs.dir, the repo's .gitignore]: undefined sets no logs.dir. The last four are
// spellings two hand-written path walkers could read apart.
const LOG_DIRS = [
  [undefined, '.workkit/*\n'], ['logs', 'logs/\n'], ['out/logs', 'out/\n'], ['logs', '.workkit/*\n'], ['logs', ''],
  ['./logs/', 'logs/\n'], ['x/../logs', 'logs/\n'], ['logs\\sub', 'logs*\n'], ['', '.workkit/*\nlogs/\n'],
];
const settingsOf = (dir) => `${JSON.stringify({ enabled: true, ...(dir === undefined ? {} : { logs: { dir } }) }, null, 2)}\n`;

describe('twins: the suite log\'s path, wk_log_path in workflow/lib/suite.sh against the path the commit gate\'s record block names', () => {
  // One spelling for both sides: the root as <root>, a markers path from markers/ on, its repo key as <sha>.
  const norm = (p, root) => {
    const at = p.indexOf('/markers/');
    if (at >= 0) return p.slice(at + 1).replace(/[0-9a-f]{40}$/, '<sha>');
    return p.startsWith(`${root}/`) ? `<root>${p.slice(root.length)}` : p;
  };

  test('wk_log_path and the gate name one suite log for every logs.dir and .gitignore', async () => {
    const shell = [];
    const js = [];
    for (const [dir, ignore] of LOG_DIRS) {
      const w = mkRepo('twins-logdir-', { '.gitignore': ignore, '.workkit/settings.json': settingsOf(dir) }, undefined, { optIn: false });
      const root = w.git('rev-parse', '--show-toplevel').trim();
      const res = runLib(`wk_log_path "${root}" suite.log`, {
        HOME: shellPath(path.dirname(w.workflowHome)), WORKFLOW_HOME: shellPath(w.workflowHome), ...nodeEnv,
      }, ['suite.sh']);
      // A refused value is one answer on both sides: the shell's non-zero exit, the gate's line naming logs.dir.
      shell.push(res.code === 0 ? norm(res.stdout.trim(), root) : 'refused');

      const r = commitGate.mkReleaseRepo();
      commitGate.stage(r, '.workkit/settings.json', settingsOf(dir));
      commitGate.commit(r);
      commitGate.stage(r, 'app.js', 'const x = 2;\n');
      commitGate.touchMarker(r);
      // Every ignore question the gate asks, answered by git in the shell side's repo.
      r.failOn = (argv) => (path.basename(argv[0]) === 'git' && argv.includes('check-ignore')
        ? { exitCode: spawnSync('git', ['check-ignore', '-q', argv[argv.length - 1].replace(`${commitGate.ROOT}/`, '')], { cwd: w.repo, env: w.env }).status }
        : null);
      const deny = commitGate.denyOf(await commitGate.judge(r, 'feat: thing'));
      const head = 'writes its output to ';
      expect(deny !== null, `the gate blocks for ${JSON.stringify([dir, ignore])}`).toBeTruthy();
      js.push(deny.includes(head)
        ? norm(deny.slice(deny.indexOf(head) + head.length, deny.length - commitGate.T.recordTail.length), commitGate.ROOT)
        : (deny.includes('logs.dir') ? 'refused' : deny));
    }
    agree(LOG_DIRS.map((_, i) => i), shell, (i) => js[i], `the (logs.dir, .gitignore) fixtures by index, the gate's answers ${JSON.stringify(js)}`);
    // A dot, a dot-dot that stays inside and a trailing slash all name logs/; a backslash is a separator; empty is the default.
    expect(JSON.stringify(shell), 'each folder git ignores holds the log, the markers folder takes it otherwise').toBe(JSON.stringify([
      '<root>/.workkit/suite.log', '<root>/logs/suite.log', '<root>/out/logs/suite.log',
      'markers/claude-suite.log/<sha>', 'markers/claude-suite.log/<sha>',
      '<root>/logs/suite.log', '<root>/logs/suite.log', '<root>/logs/sub/suite.log', '<root>/.workkit/suite.log',
    ]));
  });
});

describe('twins: the test script, wk_has_test_script in workflow/lib/suite.sh against hasTestScript in hooks/mods/suite.js', () => {
  // package.json texts; null writes none.
  const PACKAGES = [
    '{"scripts":{"test":"node --test"}}', '{"scripts":{"test":""}}', '{"name":"bare","scripts":{"lint":"x"}}', '{"scripts":{"test":1}}',
    '{"scripts":null}', '{}', 'not json', null,
  ];

  test('wk_has_test_script and hasTestScript answer every package.json alike, and only a non-empty string scripts.test is one', () => {
    const dirs = PACKAGES.map((text) => {
      const dir = mkTmp('twins-testscript-');
      if (text !== null) fs.writeFileSync(path.join(dir, 'package.json'), text);
      return dir;
    });
    const shell = bashAnswers([lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'suite.sh')], 'wk_has_test_script', dirs.map(shellPath));
    const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
    agree(PACKAGES.map((_, i) => i), shell, (i) => mods('suite').hasTestScript(parsed(PACKAGES[i])), 'the package.json texts by index');
    expect(JSON.stringify(shell.slice(0, 3)), 'a test script is one, an empty one and none are not').toBe(JSON.stringify([true, false, false]));
  });
});

describe('twins: the marker path, wk_marker_path in workflow/lib/platform.sh against markerPath in hooks/mods/markers.js', () => {
  // The anchor spellings the shell must hash byte for byte as the module does: a space, a drive, backslashes, a trailing
  // slash, a call id, none at all. The plain root through each marker kind is test/hooks/markers.test.js's.
  const ANCHORS = ['/w/a b/repo', 'C:/Users/x/repo', 'C:\\Users\\x\\repo', '/repos/thing/', 'toolu_01AbC', ''];
  const HOMES = { HOME: '/w/home', WORKFLOW_HOME: '/w/moved' };

  test('wk_marker_path and markerPath give one path for one root and one marker folder', async () => {
    const dir = 'claude-gh-journal';
    const shell = bashLines(lib('workflow', 'lib', 'platform.sh'), `wk_marker_path ${dir}`, ANCHORS, HOMES);
    const js = await Promise.all(ANCHORS.map((anchor) => mods('markers').markerPath(dir, anchor, HOMES.WORKFLOW_HOME)));
    agree(ANCHORS.map((_, i) => i), shell, (i) => js[i], `the anchors by index, the module's paths ${JSON.stringify(js)}`);
    expect(shell[0].startsWith(`${HOMES.WORKFLOW_HOME}/markers/${dir}/`), `under the machine folder's markers, got: ${shell[0]}`).toBeTruthy();
  });
});

describe('twins: the color gate, wk_color_on in workflow/lib/voice.sh against colorOn in tower/api/lib/log.js', () => {
  // Environments with no terminal on stdout, each the gate's variables alone; a TERM is named
  // wherever one matters, since bash sets a dumb one when none is given.
  const ENVS = [
    {}, { WORKKIT_COLOR: '1', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0' },
    { WORKKIT_COLOR: '1', TERM: 'xterm-256color', NO_COLOR: '1' }, { NO_COLOR: '1', TERM: 'xterm-256color' },
    { WORKKIT_COLOR: '1', TERM: 'dumb' }, { TERM: 'xterm-256color' },
  ];
  const GATE_VARS = ['WORKKIT_COLOR', 'NO_COLOR', 'TERM', 'FORCE_COLOR'];

  test('wk_color_on and colorOn give every environment the same answer on a stdout that is no terminal', () => {
    const { colorOn } = require(path.join(KIT, 'tower', 'api', 'lib', 'log.js'));
    const shell = ENVS.map((vars) => {
      const res = spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'voice.sh')}"\nif wk_color_on; then echo 1; else echo 0; fi`], {
        env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...vars }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      expect(res.status, `the shell answered for ${JSON.stringify(vars)}, stderr: ${res.stderr}`).toBe(0);
      return res.stdout.trim() === '1';
    });
    const saved = Object.fromEntries(GATE_VARS.map((name) => [name, process.env[name]]));
    const node = ENVS.map((vars) => {
      for (const name of GATE_VARS) delete process.env[name];
      Object.assign(process.env, vars);
      try {
        return colorOn({ isTTY: false });
      } finally {
        for (const name of GATE_VARS) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
      }
    });
    agree(ENVS.map((_, i) => i), shell, (i) => node[i], `the environments by index, colorOn's answers ${JSON.stringify(node)}`);
    expect(JSON.stringify(shell.slice(0, 3)), 'nothing set is off, the gate forced on is on, forced off is off').toBe(JSON.stringify([false, true, false]));
    expect(shell[4], 'NO_COLOR wins over the forced gate').toBe(false);
  });
});

describe('twins: the plain mutex and the marker sweep, wk_take_lock and wk_sweep_markers in workflow/lib/platform.sh against takeLock and sweepMarkers in workflow/lib/lock.js', () => {
  // Required in each case, so a missing module fails these cases alone.
  const lockJs = () => require(path.join(KIT, 'workflow', 'lib', 'lock.js'));
  /** <line> in a bash that sourced platform.sh, <env> added; spawnSync's result. */
  const inPlatform = (line, env = {}) => spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"\n${line}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });

  test('wk_take_lock and takeLock exclude each other on one folder: while one side holds it the other cannot take it, and can after the drop', async () => {
    const { takeLock, dropLock } = lockJs();
    const dir = path.join(mkTmp('twins-mutex-'), 'state', 'lock');
    const L = { L: shellPath(dir) };
    const shellTake = () => inPlatform('wk_take_lock "$L"', L);
    const first = shellTake();
    expect(first.status, `the shell takes the free folder, stderr: ${first.stderr}`).toBe(0);
    expect(await takeLock(dir), 'takeLock cannot take the folder the shell holds').toBe(false);
    const dropped = inPlatform('wk_drop_lock "$L"', L);
    expect(dropped.status, `the shell drops it, stderr: ${dropped.stderr}`).toBe(0);
    expect(await takeLock(dir), 'takeLock takes it after the shell\'s drop').toBe(true);
    const refused = shellTake();
    expect(refused.status, `wk_take_lock cannot take the folder takeLock holds, stderr: ${refused.stderr}`).toBe(1);
    await dropLock(dir);
    const after = shellTake();
    expect(after.status, `wk_take_lock takes it after takeLock's drop, stderr: ${after.stderr}`).toBe(0);
  });

  test('wk_sweep_markers and sweepMarkers leave the same files of one marker tree', async () => {
    const { sweepMarkers } = lockJs();
    const base = mkTmp('twins-sweep-');
    const seed = path.join(base, 'seed');
    // [path under markers/, days since its last write]: records past and inside the 7 days, a lock folder's file, a loose file.
    const FILES = [
      ['claude-suite-marker/old', 8], ['claude-suite-marker/young', 1], ['claude-gh-journal/month', 30], ['claude-gh-journal/edge', 6],
      ['claude-suite-lock/held/pid', 8], ['loose', 8],
    ];
    for (const [rel, days] of FILES) agedFile(path.join(seed, 'markers', rel), days);
    fs.utimesSync(path.join(seed, 'markers', 'claude-suite-lock', 'held'), daysAgo(8), daysAgo(8));
    const [shellHome, jsHome] = ['shell', 'js'].map((side) => {
      const home = path.join(base, side);
      fs.cpSync(seed, home, { recursive: true, preserveTimestamps: true });
      return home;
    });
    const res = inPlatform('wk_sweep_markers', { WORKFLOW_HOME: shellPath(shellHome) });
    expect(res.status, `the shell swept, stderr: ${res.stderr}`).toBe(0);
    await sweepMarkers(jsHome);
    const left = (home) => fs.readdirSync(path.join(home, 'markers'), { recursive: true })
      .map((rel) => rel.replace(/\\/g, '/'))
      .filter((rel) => fs.statSync(path.join(home, 'markers', rel)).isFile()).sort();
    expect(JSON.stringify(left(jsHome)), 'the files sweepMarkers left, against wk_sweep_markers').toBe(JSON.stringify(left(shellHome)));
    const kept = left(shellHome);
    expect(!kept.includes('claude-suite-marker/old') && !kept.includes('claude-gh-journal/month')
      && kept.includes('claude-suite-marker/young') && kept.includes('claude-gh-journal/edge') && kept.includes('claude-suite-lock/held/pid'),
    `a record past 7 days goes, a younger one and a lock folder's file stay, left: ${kept.join(', ')}`).toBeTruthy();
  });
});

describe('twins: the opt-in read, wk_opted_in in workflow/lib/participation.sh against settingsOptedIn in hooks/mods/gate.js', () => {
  // platform.sh first, as every caller sources it, so wk_opted_in reads through the node wk_node finds.
  const participation = [lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'participation.sh')];
  const fileOf = (root) => path.join(root, '.workkit', 'settings.json');
  const shellOptedIn = (roots) => bashAnswers(participation, 'wk_opted_in', roots.map(shellPath),
    { ...nodeEnv });

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

describe('twins: the session rule, wk_session_judges in workflow/lib/participation.sh against sessionJudges in hooks/mods/gate.js', () => {
  // The variables the rule reads, each environment beside nothing else; an absent key is unset.
  const ENVS = [
    {}, { CLAUDECODE: '1' }, { CLAUDECODE: '1', HOOK_DISABLE: '1' }, { CLAUDECODE: '1', HOOK_DISABLE: '0' },
    { CLAUDECODE: '1', HOOK_DISABLE: '' }, { CLAUDECODE: '0' }, { CLAUDECODE: 'true' }, { CLAUDECODE: '' }, { HOOK_DISABLE: '1' },
  ];
  // The settings texts: none, the opt-in, a decline, a string true.
  const TEXTS = [null, OPT_IN_SHAPES.current, '{ "version": 1, "enabled": false }\n', '{ "enabled": "true" }'];

  test('wk_session_judges and sessionJudges answer every environment and settings text alike, and only CLAUDECODE=1, no HOOK_DISABLE=1 and an opted-in repo judge', () => {
    const roots = settingsRoots(TEXTS);
    const sources = [lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'participation.sh')];
    const shell = ENVS.map((vars) => bashAnswers(sources, 'wk_session_judges', roots.map(shellPath), { ...nodeEnv, ...vars }));
    const { sessionJudges } = mods('gate');
    ENVS.forEach((vars, e) => agree(TEXTS.map((_, t) => t), shell[e], (t) => sessionJudges(vars, TEXTS[t]),
      `the settings texts (by index into TEXTS) under ${JSON.stringify(vars)}`));
    expect(JSON.stringify(shell[1]), 'CLAUDECODE=1 alone: the opted-in repo judges, no other').toBe(JSON.stringify([false, true, false, false]));
    expect(JSON.stringify([shell[0][1], shell[2][1], shell[5][1], shell[6][1]]), 'unset, HOOK_DISABLE=1, CLAUDECODE 0 or true: the opted-in repo is not judged')
      .toBe(JSON.stringify([false, false, false, false]));
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
      const res = spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"\n. "${lib('workflow', 'lib', 'participation.sh')}"\nwk_setting "$1" "$2"`, 'bash', shellPath(root), key], {
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
      const res = spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_user_dir`], {
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

describe('the CHANGELOG test, isChangelog in hooks/mods/changelog-guard.js', () => {
  test('a CHANGELOG.md at the root, below it or absolute is one; a longer name, another case, no extension or a folder of that name is not', () => {
    const { isChangelog } = mods('changelog-guard');
    expect(JSON.stringify(CHANGELOGS.map((p) => isChangelog(p))), CHANGELOGS.join(', '))
      .toBe(JSON.stringify([true, true, true, true, false, false, false, false, false, false]));
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
      const res = spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_hooks_log; printf '%s\\n' "$WK_HOOKS_LOG"; cat "$WK_HOOKS_LOG"`], {
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

describe('twins: the public slug, PUBLIC_SLUG_RE in workflow/standards/labels.sh against SLUG_RE and the Public: link in workflow/public/lib.js', () => {
  // `public` key values; the first four are slugs.
  const PUBLIC_KEYS = [
    'acme/public', 'Acme-Co/free-proxy-list', 'a1/b.c_d-e', 'acme/.github', 'acme', '', 'acme/', '/public',
    'acme/public/x', 'ac me/public', 'acme_co/public', 'acme/pub$lic', 'https://github.com/acme/public',
  ];

  test('the heal and the verbs take the same values as a slug, and the Public: link reads those alone', () => {
    const script = `. "${lib('workflow', 'standards', 'labels.sh')}"
while IFS= read -r p; do if [[ "$p" =~ $PUBLIC_SLUG_RE ]]; then echo 1; else echo 0; fi; done <<<"$FIXTURES"`;
    const res = spawnSystemBash([...NO_RC, '-c', script], {
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
    const res = spawnSystemBash([...NO_RC, '-c', `. "${pieces}"; printf '%s\\n' "\${VALUE_FLAGS[@]}"`],
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
      const res = spawnSystemBash([...NO_RC, '-c', 'PATH="$1"; . "$2"', 'walk', names.map((n) => entries[n]).join(':'), file], {
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
