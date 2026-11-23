// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. The rows: the suite log's path, the test script,
// the marker path, the color gate, the voice lines, the plain mutex, the marker sweep, the opt-in read, the session rule, one setting, the machine folder and tower,
// the hooks log, the slug, the native path, the repo slug and kit checkout, the clone rank, the atomic link, the safe JSON edit, the kit's hooks folder, git's value-taking global options.
// Plus one shell pair, the two shims' norm_dir, in_list, real_path and PATH walk.
// And three with no shell side, the repo flag, the public slug and the CHANGELOG test.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, needs, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NO_RC, shellPath, gitPath, stubTool, spawnSystemBash, nodeEnv, samePath,
} = require('../lib/platform');
const { mkRepo, mkOriginRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { mods } = require('../lib/mods-inputs');
const commitGate = require('./commit-gate/helpers');
const { runLib } = require('../lib/hook-lib');
const { agedFile, daysAgo } = require('../lib/workflow-home');
const { readOrNull } = require('../../workflow/lib/read');

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
 * Each [first, second] pair through `fn` in one bash that sources `files` (one or a list, in order):
 * what it printed where it exits 0, null where it does not, one per pair, in order.
 */
const bashPairs = (files, fn, pairs, env = {}) => {
  const sources = [].concat(files).map((f) => `. "${f}"\n`).join('');
  const script = `${sources}while (( $# >= 2 )); do if out="$(${fn} "$1" "$2")"; then printf '1%s\\n' "$out"; else printf '0\\n'; fi; shift 2; done`;
  const res = spawnSystemBash([...NO_RC, '-c', script, 'pairs', ...pairs.flat()], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  const lines = (res.stdout || '').replace(/\r/g, '').split('\n').slice(0, -1);
  expect(lines.length, `one answer per pair from ${fn}, stderr: ${res.stderr}`).toBe(pairs.length);
  return lines.map((l) => (l[0] === '1' ? l.slice(1) : null));
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
  '{ "enabled": true }{', '{ "enabled": false }{', '{ "enabled": true } { "enabled": true }',
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

describe('twins: the color gate, wk_color_on in workflow/lib/voice.sh against colorOn in workflow/lib/voice.js', () => {
  // Environments with no terminal on stdout, each the gate's variables alone; a TERM is named
  // wherever one matters, since bash sets a dumb one when none is given.
  const ENVS = [
    {}, { WORKKIT_COLOR: '1', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0' },
    { WORKKIT_COLOR: '1', TERM: 'xterm-256color', NO_COLOR: '1' }, { NO_COLOR: '1', TERM: 'xterm-256color' },
    { WORKKIT_COLOR: '1', TERM: 'dumb' }, { TERM: 'xterm-256color' },
  ];
  const GATE_VARS = ['WORKKIT_COLOR', 'NO_COLOR', 'TERM', 'FORCE_COLOR'];

  test('wk_color_on and colorOn give every environment the same answer on a stdout that is no terminal', () => {
    const { colorOn } = require(path.join(KIT, 'workflow', 'lib', 'voice.js'));
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

describe('twins: the voice lines, wk_ok, wk_skip, wk_info, wk_warn and wk_warn_lines in workflow/lib/voice.sh against workflow/lib/voice.js', () => {
  // A task split, two clauses no task, a percent and a backslash, a colon past the task.
  const MESSAGES = ['labels: 3 created', 'Two words: no task', '50% of a\\b', 'a: b: c'];
  // wk_warn_lines' text: a prefixed line, a blank, a bare one, one already prefixed with no space.
  const [TOPIC, TEXT] = ['hooks', 'hooks: set\n\nmoved by a script\nhooks:x'];
  // The variables the lines read, each environment beside nothing else.
  const ENVS = {
    plain: {},
    colored: { WORKKIT_COLOR: '1', TERM: 'xterm-256color' },
    quiet: { QUIET: '1' },
    indented: { WK_LOG_INDENT: '  ' },
    stderr: { WK_LOG_STDERR: '1', WK_LOG_INDENT: '    ' },
    all: { QUIET: '1', WORKKIT_COLOR: '1', TERM: 'xterm-256color', WK_LOG_INDENT: '  ', WK_LOG_STDERR: '1' },
  };
  const BASH_VOICE = `. "${lib('workflow', 'lib', 'voice.sh')}"
wk_palette
topic="$1" text="$2"; shift 2
for m in "$@"; do wk_ok "$m"; wk_skip "$m"; wk_info "$m"; wk_warn "$m"; done
wk_warn_lines "$topic" "$text"`;
  const NODE_VOICE = `const v = require(${JSON.stringify(path.join(KIT, 'workflow', 'lib', 'voice.js'))});
const [topic, text, ...messages] = process.argv.slice(1);
for (const m of messages) { v.ok(m); v.skip(m); v.info(m); v.warn(m); }
v.warnLines(topic, text);`;
  const say = (side, vars) => {
    const env = { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...vars };
    const opts = { env, encoding: 'utf8', timeout: SPAWN_DEADLINE };
    const res = side === 'bash'
      ? spawnSystemBash([...NO_RC, '-c', BASH_VOICE, 'voice', TOPIC, TEXT, ...MESSAGES], opts)
      : spawnSync(process.execPath, ['-e', NODE_VOICE, TOPIC, TEXT, ...MESSAGES], opts);
    expect(res.status, `${side} said its lines under ${JSON.stringify(vars)}, stderr: ${res.stderr}`).toBe(0);
    return { out: res.stdout.replace(/\r/g, ''), err: res.stderr.replace(/\r/g, '') };
  };

  test('both print every line alike, plain, colored, quiet, indented and on stderr, each to the same stream', () => {
    const bash = Object.fromEntries(Object.entries(ENVS).map(([name, vars]) => [name, say('bash', vars)]));
    const each = (glyphs) => MESSAGES.flatMap((m) => glyphs.map((g) => `${g} ${m}\n`)).join('');
    const warned = '⚠ hooks: set\n⚠ hooks: moved by a script\n⚠ hooks:x\n';
    expect(bash.plain.out, 'plain: the three reporting lines per message on stdout').toBe(each(['✓', '·', '›']));
    expect(bash.plain.err, 'plain: the warnings on stderr, each line of the text under its topic').toBe(each(['⚠']) + warned);
    expect(bash.quiet.out, 'quiet: only the acted line').toBe(each(['✓']));
    expect(bash.colored.out.split('\n')[0], 'colored: the glyph and the task painted')
      .toBe('\x1b[1m\x1b[0;32m✓\x1b[0m \x1b[1mlabels:\x1b[0m 3 created');
    expect(bash.stderr.out, 'WK_LOG_STDERR: nothing on stdout').toBe('');
    expect(bash.stderr.err.split('\n')[0], 'WK_LOG_STDERR: the indent leads the line').toBe('    ✓ labels: 3 created');
    for (const [name, vars] of Object.entries(ENVS)) {
      expect(JSON.stringify(say('node', vars)), `${name}: voice.js's stdout and stderr against voice.sh's`).toBe(JSON.stringify(bash[name]));
    }
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
    expect(JSON.stringify(shell), 'no file, an empty file, {}, a version alone, every false or non-true value, a broken tail and a second value are out')
      .toBe(JSON.stringify([false, false, false, false, true, false, false, false, false, true, false, false, false, false, false, false]));
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

describe('the repo flag, repoFlag in hooks/mods/gate.js', () => {
  test('a boolean enabled is true or false, no boolean one absent, the whole text not one value unreadable; settingsOptedIn is in for true alone', () => {
    const { repoFlag } = mods('gate');
    // [settings text, its answer].
    const FLAGS = [
      ['{ "enabled": true }\n', 'true'], ['{"enabled":false}', 'false'], ['{ "enabled": true, "x": { "enabled": false } }', 'true'],
      ['{ "version": 1 }\n', 'absent'], ['{}', 'absent'], ['', 'absent'], ['  \n', 'absent'], ['null', 'absent'],
      ['{ "enabled": "true" }', 'absent'], ['{ "enabled": null }', 'absent'], ['not json', 'unreadable'], ['{ "enabled": tru', 'unreadable'],
      ['{ "enabled": true }{', 'unreadable'], ['{ "enabled": false }{', 'unreadable'],
      ['{ "enabled": true } { "enabled": true }', 'unreadable'], ['{ "enabled": false }\n{}\n', 'unreadable'],
      [null, 'unreadable'], ['[{ "enabled": true }]', 'unreadable'], ['1', 'unreadable'],
    ];
    const differ = FLAGS.flatMap(([text, want]) => (repoFlag(text) === want ? [] : [`${JSON.stringify(text)}: ${repoFlag(text)}, not ${want}`]));
    expect(differ.join('; '), 'the settings texts repoFlag answers wrongly').toBe('');
    const { settingsOptedIn } = mods('gate');
    const optedIn = FLAGS.flatMap(([text]) => (settingsOptedIn(text) ? [text] : []));
    expect(JSON.stringify(optedIn), 'settingsOptedIn is in exactly where repoFlag answers true')
      .toBe(JSON.stringify(FLAGS.flatMap(([text, want]) => (want === 'true' ? [text] : []))));
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

  test('wk_tower_dir and towerDir name one tower folder for every WORKFLOW_HOME and HOME', () => {
    const { towerDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
    const shell = HOMES.map(([workflowHome, home]) => {
      const env = { PATH: SYSTEM_PATH, HOME: home, ...(workflowHome === undefined ? {} : { WORKFLOW_HOME: workflowHome }) };
      const res = spawnSystemBash([...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_tower_dir`], {
        env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      return (res.stdout || '').replace(/\r?\n$/, '');
    });
    expect(JSON.stringify(shell.slice(0, 2)), 'tower under the machine folder, WORKFLOW_HOME unset and set')
      .toBe(JSON.stringify(['/w/home/.workkit/tower', '/w/moved/tower']));
    const saved = process.env.WORKFLOW_HOME;
    try {
      agree(HOMES.map((_, i) => i), shell, (i) => {
        const [workflowHome, home] = HOMES[i];
        if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
        return towerDir(nodeUserDir(home)).replace(/\\/g, '/');
      }, `wk_tower_dir against towerDir (by index into ${JSON.stringify(HOMES)})`);
    } finally {
      if (saved === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = saved;
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

describe('the public slug, SLUG_RE against the Public: link in workflow/public/lib.js', () => {
  // [`public` key value, whether it is a slug]: an owner of letters, digits and hyphens; a name that adds `.` and `_`.
  const PUBLIC_KEYS = [
    ['acme/public', true], ['Acme-Co/free-proxy-list', true], ['a1/b.c_d-e', true], ['acme/.github', true],
    ['acme', false], ['', false], ['acme/', false], ['/public', false], ['acme/public/x', false], ['ac me/public', false],
    ['acme_co/public', false], ['acme/pub$lic', false], ['https://github.com/acme/public', false],
  ];

  test('SLUG_RE takes the slugs alone, and the Public: link reads a link to those alone', () => {
    const { SLUG_RE, publicLink } = require(path.join(KIT, 'workflow', 'public', 'lib.js'));
    const wrong = PUBLIC_KEYS.flatMap(([key, slug]) => [
      ...(SLUG_RE.test(key) === slug ? [] : [`SLUG_RE ${JSON.stringify(key)}: ${!slug}`]),
      ...((publicLink(`Public: https://github.com/${key}/issues/1`) !== null) === slug ? [] : [`the Public: link to ${JSON.stringify(key)}: ${!slug}`]),
    ]);
    expect(wrong.join('; '), 'the values read wrongly').toBe('');
  });
});

describe('twins: the native path, wk_native_path in workflow/lib/platform.sh against nativePath in workflow/lib/platform.js', () => {
  test('both spell every path alike on this machine: unchanged off Windows, git\'s drive form on it', () => {
    const PATHS = ['/c/Users/x/repo', 'C:/Users/x', '/w/a b/repo', 'rel/dir', '/d/a/x/'];
    const shell = bashLines(lib('workflow', 'lib', 'platform.sh'), 'wk_native_path', PATHS);
    expect(shell[0], 'the drive-mount spelling').toBe(IS_WINDOWS ? 'C:/Users/x/repo' : '/c/Users/x/repo');
    const { nativePath } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    agree(PATHS, shell, (p) => nativePath(p), 'wk_native_path against nativePath');
  });
});

/** A new folder at `dir`, a git repo with `origin` as its remote, or with none when `origin` is undefined. */
const originRepo = (dir, origin) => {
  fs.mkdirSync(dir);
  if (origin !== undefined) return mkOriginRepo(dir, origin);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

describe('twins: the repo slug and the kit checkout, wk_repo_slug and wk_is_kit_checkout in workflow/lib/slug.sh against workflow/lib/repo.js', () => {
  // [name, origin]: undefined adds no origin. The kit is any owner's workkit, any letter case.
  const ORIGINS = [
    ['ssh', 'git@github.com:acme/workkit.git'], ['cased', 'https://github.com/ITW-Creative-Works/WorkKit'],
    ['longer', 'https://github.com/acme/workkit-extra.git'], ['owner', 'https://github.com/workkit/widgets'],
    ['local', '/srv/git/acme/workkit.git'], ['bare', undefined],
  ];
  const folders = () => {
    const base = mkTmp('twins-repo-');
    const dirs = Object.fromEntries(ORIGINS.map(([name, origin]) => [name, originRepo(path.join(base, name), origin)]));
    dirs.sub = path.join(dirs.ssh, 'sub', 'deeper');
    fs.mkdirSync(dirs.sub, { recursive: true });
    dirs.plain = path.join(base, 'plain');
    fs.mkdirSync(dirs.plain);
    dirs.missing = path.join(base, 'missing');
    return dirs;
  };

  test('wk_repo_slug and repoSlug name the same origin slug for every folder, and nothing where none is', () => {
    const dirs = folders();
    const names = Object.keys(dirs);
    const shell = bashLines(lib('workflow', 'lib', 'slug.sh'), 'wk_repo_slug', names.map((n) => shellPath(dirs[n])));
    expect(JSON.stringify(shell), `each folder's slug, by ${names.join(', ')}`).toBe(JSON.stringify([
      'acme/workkit', 'ITW-Creative-Works/WorkKit', 'acme/workkit-extra', 'workkit/widgets', 'acme/workkit', '', 'acme/workkit', '', '',
    ]));
    const { repoSlug } = require(path.join(KIT, 'workflow', 'lib', 'repo.js'));
    agree(names, shell, (n) => repoSlug(dirs[n]), 'wk_repo_slug against repoSlug (by folder name)');
  });

  test('wk_is_kit_checkout and isKitCheckout read the same folders as a clone of the kit', () => {
    const dirs = { ...folders(), empty: '' };
    const names = Object.keys(dirs);
    const shell = bashAnswers(lib('workflow', 'lib', 'slug.sh'), 'wk_is_kit_checkout', names.map((n) => (dirs[n] && shellPath(dirs[n]))));
    expect(JSON.stringify(shell), `a workkit origin, its subfolder and a local workkit path are the kit, nothing else is, by ${names.join(', ')}`)
      .toBe(JSON.stringify([true, true, false, false, true, false, true, false, false, false]));
    const { isKitCheckout } = require(path.join(KIT, 'workflow', 'lib', 'repo.js'));
    agree(names, shell, (n) => isKitCheckout(dirs[n]), 'wk_is_kit_checkout against isKitCheckout (by folder name)');
  });
});

describe('twins: the clone rank, wk_clone_outranks in workflow/lib/platform.sh against cloneOutranks in workflow/lib/platform.js', () => {
  /** A kit folder whose manifest names `name`, at `dir`. */
  const manifested = (dir, name) => {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name })}\n`);
    return dir;
  };

  test('both rank a clone over the cached kit alike, the Claude home named directly or through a link', () => {
    const base = mkTmp('twins-outranks-');
    const claude = path.join(base, 'claude');
    const cached = manifested(path.join(claude, 'plugins', 'cache', 'itw', 'workkit', '1.2.3'), 'workkit');
    const other = manifested(path.join(claude, 'plugins', 'cache', 'itw', 'other', '1.0.0'), 'other');
    const clone = manifested(originRepo(path.join(base, 'clone'), 'git@github.com:acme/workkit.git'), 'workkit');
    const widgets = originRepo(path.join(base, 'widgets'), 'https://github.com/acme/widgets');
    const linked = path.join(base, 'claude-link');
    fs.symlinkSync(claude, linked, 'junction');
    // [kit dir, linked dir]: the cached kit and a clone outrank; another plugin, a kit out of the cache, a non-kit or no clone do not.
    const PAIRS = [
      [cached, clone], [cached, widgets], [cached, ''], [cached, path.join(base, 'missing')],
      [other, clone], [clone, clone], [path.join(base, 'gone'), clone],
    ];
    const sources = [lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'slug.sh')];
    const homes = [claude, linked];
    const shell = homes.map((home) => bashPairs(sources, 'wk_clone_outranks', PAIRS.map((pair) => pair.map((p) => (p && shellPath(p)))),
      { WORKFLOW_CLAUDE_HOME: shellPath(home) }).map((out) => out !== null));
    for (const answers of shell) {
      expect(JSON.stringify(answers), 'the cached kit with a clone alone outranks, the home named directly or through a link')
        .toBe(JSON.stringify([true, false, false, false, false, false, false]));
    }
    const { cloneOutranks } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const saved = process.env.WORKFLOW_CLAUDE_HOME;
    try {
      homes.forEach((home, h) => {
        process.env.WORKFLOW_CLAUDE_HOME = home;
        agree(PAIRS.map((_, i) => i), shell[h], (i) => cloneOutranks(...PAIRS[i]), `wk_clone_outranks against cloneOutranks (by index into the pairs), the home ${home}`);
      });
    } finally {
      if (saved === undefined) delete process.env.WORKFLOW_CLAUDE_HOME; else process.env.WORKFLOW_CLAUDE_HOME = saved;
    }
  });

  test('with no WORKFLOW_CLAUDE_HOME, inPluginCache reads the Claude home under HOME, as the shell does', () => {
    const home = mkTmp('twins-cache-home-');
    const cached = manifested(path.join(home, '.claude', 'plugins', 'cache', 'itw', 'workkit', '1.2.3'), 'workkit');
    const { inPluginCache } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const saved = { HOME: process.env.HOME, WORKFLOW_CLAUDE_HOME: process.env.WORKFLOW_CLAUDE_HOME };
    try {
      delete process.env.WORKFLOW_CLAUDE_HOME;
      process.env.HOME = home;
      expect(inPluginCache(cached), `the kit under ${home}/.claude/plugins/cache is the cached kit`).toBe(true);
      const [shell] = bashAnswers(lib('workflow', 'lib', 'platform.sh'), 'wk_in_plugin_cache', [shellPath(cached)], { HOME: shellPath(home) });
      expect(shell, 'and so it is to wk_in_plugin_cache').toBe(true);
    } finally {
      for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
});

/** What sits at `p`, one string: `link -> <target>`, `dir <names>`, `file <text>`, or `none`. */
const whatsAt = (p) => {
  let st;
  try { st = fs.lstatSync(p); } catch { return 'none'; }
  if (st.isSymbolicLink()) return `link -> ${fs.readlinkSync(p)}`;
  if (st.isDirectory()) return `dir ${fs.readdirSync(p).sort().join(',')}`;
  return `file ${fs.readFileSync(p, 'utf8')}`;
};

describe('twins: the atomic link, wk_link in workflow/lib/flows.sh and wk_mv_link in workflow/lib/platform.sh against link and mvLink in workflow/lib/link.js',
  { skip: IS_WINDOWS && 'Windows makes no symlink without a privilege this run may lack' }, () => {
    const linkJs = () => require(path.join(KIT, 'workflow', 'lib', 'link.js'));
    /** `snippet` with platform.sh and flows.sh sourced; '1' or '0' for its exit. */
    const shellAnswer = (snippet, env) => {
      const res = runLib(`if ${snippet}; then echo 1; else echo 0; fi`, env, ['flows.sh']);
      expect(res.code, `the shell answered, stderr: ${res.stderr}`).toBe(0);
      return res.stdout.trim() === '1';
    };

    test('wk_link and link leave the same address, answer alike and leave no temp file: missing, pointing elsewhere, already right', () => {
      const base = fs.realpathSync(mkTmp('twins-link-'));
      const [target, other] = ['target', 'other'].map((name) => {
        fs.mkdirSync(path.join(base, name));
        return path.join(base, name);
      });
      // Each address's state before the call; `elsewhere` points at a folder, so a rename that follows it lands inside.
      const STATES = { missing: null, elsewhere: other, right: target };
      const sides = ['shell', 'node'].map((side) => Object.entries(STATES).map(([state, points]) => {
        const dir = path.join(base, side, state);
        fs.mkdirSync(dir, { recursive: true });
        const address = path.join(dir, 'address');
        if (points) fs.symlinkSync(points, address);
        const answer = side === 'shell' ? shellAnswer('wk_link "$T" "$A"', { T: target, A: address }) : linkJs().link(target, address);
        return `${state}: ${answer} ${whatsAt(address)}; folder ${whatsAt(dir)}; other ${whatsAt(other)}`;
      }));
      expect(JSON.stringify(sides[0]), 'the shell: every address now the link to the target, nothing else beside it')
        .toBe(JSON.stringify(Object.keys(STATES).map((state) => `${state}: true link -> ${target}; folder dir address; other dir `)));
      expect(JSON.stringify(sides[1]), 'link against wk_link').toBe(JSON.stringify(sides[0]));
    });

    test('wk_mv_link and mvLink move a link onto the same addresses alike, never into a folder an address points at', () => {
      const base = fs.realpathSync(mkTmp('twins-mv-link-'));
      const other = path.join(base, 'other');
      fs.mkdirSync(other);
      // The `to` address before the move; `from` is a link to `target`, or nothing for `gone`.
      const STATES = ['missing', 'link to a folder', 'file', 'gone'];
      const sides = ['shell', 'node'].map((side) => STATES.map((state, i) => {
        const dir = path.join(base, side, String(i));
        fs.mkdirSync(dir, { recursive: true });
        const [from, to] = [path.join(dir, 'from'), path.join(dir, 'to')];
        if (state !== 'gone') fs.symlinkSync('target', from);
        if (state === 'link to a folder') fs.symlinkSync(other, to);
        if (state === 'file') fs.writeFileSync(to, 'old\n');
        const answer = side === 'shell' ? shellAnswer('wk_mv_link "$F" "$T"', { F: from, T: to }) : linkJs().mvLink(from, to);
        return `${state}: ${answer} ${whatsAt(to)}; folder ${whatsAt(dir)}; other ${whatsAt(other)}`;
      }));
      expect(JSON.stringify(sides[0].slice(0, 3)), 'the shell: the link takes each address\'s place, the folder it pointed at untouched')
        .toBe(JSON.stringify(STATES.slice(0, 3).map((state) => `${state}: true link -> target; folder dir to; other dir `)));
      expect(JSON.stringify(sides[1]), 'mvLink against wk_mv_link').toBe(JSON.stringify(sides[0]));
    });
  });

describe('twins: the safe JSON edit, wk_json_edit in workflow/lib/state.sh against editJson in workflow/lib/write.js', { skip: needs('jq') }, () => {
  // [name, file text, jq filter, the same change in Node]: a change, a change that fails, a file that is no JSON.
  const EDITS = [
    ['a change', '{"a":1}', '.b = [2]', (value) => ({ ...value, b: [2] })],
    ['a change that fails', '{"a":1}', 'error("refused")', () => { throw new Error('refused'); }],
    ['a file that is no JSON', '{"a":', '.b = [2]', (value) => ({ ...value, b: [2] })],
  ];
  // Windows keeps no mode to compare.
  const MODE = IS_WINDOWS ? 'no mode' : '640';
  const modeOf = (file) => (IS_WINDOWS ? 'no mode' : (fs.statSync(file).mode & 0o777).toString(8));

  test('both leave the same bytes and mode, answer alike and leave no temp file', () => {
    const { editJson } = require(path.join(KIT, 'workflow', 'lib', 'write.js'));
    const base = mkTmp('twins-json-edit-');
    const sides = ['shell', 'node'].map((side) => EDITS.map(([name, text, filter, change], i) => {
      const dir = path.join(base, side, String(i));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'settings.json');
      fs.writeFileSync(file, text);
      fs.chmodSync(file, 0o640);
      const answer = side === 'shell'
        ? runLib('wk_json_edit "$F" "$J"', { F: shellPath(file), J: filter }, ['voice.sh', 'state.sh']).code === 0
        : editJson(file, change);
      return [name, answer, fs.readFileSync(file, 'utf8'), modeOf(file), whatsAt(dir)];
    }));
    expect(JSON.stringify(sides[0]), 'the shell: the change written whole as two-space JSON, the mode kept; each failure leaves the file as it was')
      .toBe(JSON.stringify([
        ['a change', true, '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n', MODE, 'dir settings.json'],
        ['a change that fails', false, '{"a":1}', MODE, 'dir settings.json'],
        ['a file that is no JSON', false, '{"a":', MODE, 'dir settings.json'],
      ]));
    expect(JSON.stringify(sides[1]), 'editJson against wk_json_edit').toBe(JSON.stringify(sides[0]));
  });
});

describe('twins: the kit\'s hooks folder, wk_githooks_kit, wk_githooks_kitlike and wk_githooks_spelled in workflow/lib/participation.sh against workflow/lib/participation.js', () => {
  const sources = [lib('workflow', 'lib', 'platform.sh'), lib('workflow', 'lib', 'participation.sh')];
  const participationJs = () => require(path.join(KIT, 'workflow', 'lib', 'participation.js'));

  /** A hooks folder at `<dir>/<folder>` holding `files` (each name, executable unless `plain` names it). */
  const hooksAt = (dir, folder, files, plain = []) => {
    const at = path.join(dir, folder);
    fs.mkdirSync(at, { recursive: true });
    for (const name of files) fs.writeFileSync(path.join(at, name), '#!/bin/sh\n', { mode: plain.includes(name) || name.endsWith('.js') ? 0o644 : 0o755 });
    return at;
  };

  /** The scratch world: a repo folder and every hooks folder a pair names, [name, root, folder] each. */
  const world = () => {
    const base = fs.realpathSync(mkTmp('twins-githooks-'));
    const root = path.join(base, 'repo');
    fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
    const ALL = ['pre-commit', 'commit-msg', 'judge.js'];
    const kitHooks = hooksAt(base, 'kit/workflow/githooks', ALL);
    fs.symlinkSync(path.join(base, 'kit'), path.join(base, 'engine'), 'junction');
    hooksAt(root, 'own/workflow/githooks', []);
    const pairs = [
      ['kit', root, kitHooks], ['relative', root, '../kit/workflow/githooks'], ['engine link', root, path.join(base, 'engine', 'workflow', 'githooks')],
      ['no judge', root, hooksAt(base, 'nojudge/workflow/githooks', ['pre-commit', 'commit-msg'])],
      ['other name', root, hooksAt(base, 'plain/hooks', ALL)], ['git hooks', root, '.git/hooks'], ['empty', root, ''],
      ['gone kit', root, path.join(base, 'gone', 'workflow', 'githooks')], ['gone engine', root, path.join(base, 'gone', 'workkit', 'githooks')],
      ['own', root, 'own/workflow/githooks'], ['gone relative', root, 'old/workkit/githooks'],
    ];
    if (!IS_WINDOWS) {
      pairs.push(['no exec', root, hooksAt(base, 'noexec/workflow/githooks', ALL, ['pre-commit'])]);
      fs.symlinkSync(path.join(base, 'removed'), path.join(base, 'dangling'));
      pairs.push(['dangling', root, path.join(base, 'dangling', 'workflow', 'githooks')]);
    }
    return { base, pairs };
  };
  const shellArgs = (pairs) => pairs.map(([, root, folder]) => [shellPath(root), path.isAbsolute(folder) ? shellPath(folder) : folder]);

  test('wk_githooks_kit and githooksKit name the same kit root for every folder, the physical one, and none for the rest', () => {
    const { base, pairs } = world();
    const shell = bashPairs(sources, 'wk_githooks_kit', shellArgs(pairs), nodeEnv);
    const kits = pairs.flatMap(([name], i) => (shell[i] === null ? [] : [name]));
    expect(kits.join(', '), 'the kit\'s folder in any spelling, nothing else').toBe('kit, relative, engine link');
    const kit = shellPath(path.join(base, 'kit'));
    expect(shell.slice(0, 3).every((s) => samePath(s, kit, process.platform)), `each the physical kit root, got: ${shell.slice(0, 3)}`).toBe(true);
    const { githooksKit } = participationJs();
    const differ = pairs.flatMap(([name, root, folder], i) => {
      const node = githooksKit(root, folder);
      const same = shell[i] === null || node === null ? shell[i] === node : samePath(shell[i], node, process.platform);
      return same ? [] : [`${name}: bash ${JSON.stringify(shell[i])}, node ${JSON.stringify(node)}`];
    });
    expect(differ.join('; '), 'the folders wk_githooks_kit and githooksKit answer differently').toBe('');
  });

  test('wk_githooks_kitlike and githooksKitlike read the same folders as a kit\'s, spelled as one and gone included', () => {
    const { pairs } = world();
    const shell = bashPairs(sources, 'wk_githooks_kitlike', shellArgs(pairs), nodeEnv).map((out) => out !== null);
    const kitlike = pairs.flatMap(([name], i) => (shell[i] ? [name] : []));
    expect(kitlike.join(', '), 'a kit\'s folder, and a kit spelling that is gone')
      .toBe(['kit', 'relative', 'engine link', 'gone kit', 'gone engine', 'gone relative', ...(IS_WINDOWS ? [] : ['dangling'])].join(', '));
    const { githooksKitlike } = participationJs();
    // The folder in git's spelling, the core.hooksPath value the heal hands it.
    agree(pairs.map((_, i) => i), shell, (i) => githooksKitlike(pairs[i][1], gitPath(pairs[i][2])), `wk_githooks_kitlike against githooksKitlike (by index into ${pairs.map(([n]) => n).join(', ')})`);
  });

  test('wk_githooks_spelled and githooksSpelled read the same folder names as a kit\'s', () => {
    const FOLDERS = [
      '/a/workflow/githooks', '/a/workkit/githooks', 'C:/x/workkit/githooks', 'old/workkit/githooks',
      'workflow/githooks', '/a/workflow/githooks/', '/a/workflow/githooks2', '/a/other/githooks', 'C:\\x\\workkit\\githooks', '.git/hooks', '',
    ];
    const shell = bashAnswers(sources, 'wk_githooks_spelled', FOLDERS);
    expect(JSON.stringify(shell), 'a path ending in a kit\'s or the engine link\'s hooks folder, after a slash')
      .toBe(JSON.stringify([true, true, true, true, false, false, false, false, false, false, false]));
    const { githooksSpelled } = participationJs();
    agree(FOLDERS, shell, (f) => githooksSpelled(f), 'wk_githooks_spelled against githooksSpelled');
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
