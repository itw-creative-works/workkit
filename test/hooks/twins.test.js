// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. The rows: the kit's hooks folder in
// git's hook.sh and git's value-taking global options in the git shim. Then the two shims' one promise, the real tool each
// runs, and the Node pairs: the machine folder's and the slug's two readers held to one hard-coded answer, the Windows folder's two spellers to each other.
// And the rows with no shell side, each its Node function alone: the suite log's path, the test script, the color gate, the voice lines,
// the plain mutex, the marker sweep, the opt-in read, the session rule, the tower folder, the hooks log, the native path, the repo slug
// and kit checkout, the clone rank, the physical path, the atomic link, the safe JSON edit, the yes or no question, the opener choice,
// the spinner's frames and its one line, the poll's countdown frames, the repo flag, the public slug and the CHANGELOG test.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, run, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, NO_RC, EMPTY_PATH, shellPath, gitPath, jsPath, stubTool, stubToolJs, spawnSystemBash, samePath, homeEnv, joinPath, basePathWithout, pathWith, skipWithoutFileLink,
} = require('../lib/platform');
const { recordArgv, recordArgvJs, readArgv } = require('../lib/argv-log');
const { underEnv } = require('../lib/under-env');
const { ioOf } = require('../lib/io-streams');
const { speak } = require('../lib/speak');
const {
  driveSpin, drivePoll, framesIn, MESSAGE, POLL_MESSAGE,
} = require('../lib/spin-call');
const { mkRepo, mkOriginRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { mods } = require('../lib/mods-inputs');
const commitGate = require('./commit-gate/helpers');
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
 * runs them as written; returns the file's shell path, for a bash to source. `dir` is the folder the file goes in.
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

/** One scratch repo root per settings text; null writes no file. */
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

describe('the suite log\'s path, the path the commit gate\'s record block names', () => {
  // One spelling for every answer: the root as <root>, a markers path from markers/ on, its repo key as <sha>.
  const norm = (p, root) => {
    const at = p.indexOf('/markers/');
    if (at >= 0) return p.slice(at + 1).replace(/[0-9a-f]{40}$/, '<sha>');
    return p.startsWith(`${root}/`) ? `<root>${p.slice(root.length)}` : p;
  };

  test('the gate names one suite log for every logs.dir and .gitignore', async () => {
    const js = [];
    for (const [dir, ignore] of LOG_DIRS) {
      // The repo whose .gitignore answers each ignore question the gate asks.
      const w = mkRepo('twins-logdir-', { '.gitignore': ignore, '.workkit/settings.json': settingsOf(dir) }, undefined, { optIn: false });
      const r = commitGate.mkReleaseRepo();
      commitGate.stage(r, '.workkit/settings.json', settingsOf(dir));
      commitGate.commit(r);
      commitGate.stage(r, 'app.js', 'const x = 2;\n');
      commitGate.touchMarker(r);
      // Every ignore question the gate asks, answered by git in that repo.
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
    // A dot, a dot-dot that stays inside and a trailing slash all name logs/; a backslash is a separator; empty is the default.
    expect(JSON.stringify(js), 'each folder git ignores holds the log, the markers folder takes it otherwise').toBe(JSON.stringify([
      '<root>/.workkit/suite.log', '<root>/logs/suite.log', '<root>/out/logs/suite.log',
      'markers/claude-suite.log/<sha>', 'markers/claude-suite.log/<sha>',
      '<root>/logs/suite.log', '<root>/logs/suite.log', '<root>/logs/sub/suite.log', '<root>/.workkit/suite.log',
    ]));
  });
});

describe('the test script, hasTestScript in hooks/mods/suite.js', () => {
  // The package.json shapes test/hooks/suite.test.js leaves out.
  const PACKAGES = [{ scripts: { test: 1 } }, { scripts: null }, {}];

  test('a scripts.test that is no string, a null scripts and no scripts at all are no test script', () => {
    expect(JSON.stringify(PACKAGES.map((pkg) => mods('suite').hasTestScript(pkg))), 'none of them is a test script')
      .toBe(JSON.stringify([false, false, false]));
  });
});

describe('the color gate, colorOn in workflow/lib/voice.js', () => {
  // Environments with no terminal on stdout, each the gate's variables alone.
  const ENVS = [
    {}, { WORKKIT_COLOR: '1', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0', TERM: 'xterm-256color' }, { WORKKIT_COLOR: '0' },
    { WORKKIT_COLOR: '1', TERM: 'xterm-256color', NO_COLOR: '1' }, { NO_COLOR: '1', TERM: 'xterm-256color' },
    { WORKKIT_COLOR: '1', TERM: 'dumb' }, { TERM: 'xterm-256color' },
  ];
  const GATE_VARS = ['WORKKIT_COLOR', 'NO_COLOR', 'TERM', 'FORCE_COLOR'];

  test('on a stdout that is no terminal only the forced gate paints, and NO_COLOR or a dumb TERM beats it', () => {
    const { colorOn } = require(path.join(KIT, 'workflow', 'lib', 'voice.js'));
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
    expect(JSON.stringify(node), `the environments by index: ${JSON.stringify(ENVS)}`)
      .toBe(JSON.stringify([false, true, false, false, false, false, false, false]));
  });
});

describe('the voice lines, ok, skip, info, warn and warnLines in workflow/lib/voice.js', () => {
  // A task split, two clauses no task, a percent and a backslash, a colon past the task.
  const MESSAGES = ['labels: 3 created', 'Two words: no task', '50% of a\\b', 'a: b: c'];
  // warnLines' text: a prefixed line, a blank, a bare one, one already prefixed with no space.
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
  const VOICE_LINES = [
    `const [topic, text, ...messages] = ${JSON.stringify([TOPIC, TEXT, ...MESSAGES])};`,
    'for (const m of messages) { v.ok(m); v.skip(m); v.info(m); v.warn(m); }',
    'v.warnLines(topic, text);',
  ];
  const say = (vars) => {
    const res = speak(VOICE_LINES, vars);
    return { out: res.stdout.replace(/\r/g, ''), err: res.stderr.replace(/\r/g, '') };
  };

  test('every line plain, colored, quiet, indented and on stderr, each to its stream', () => {
    const said = Object.fromEntries(Object.entries(ENVS).map(([name, vars]) => [name, say(vars)]));
    const each = (glyphs, indent = '') => MESSAGES.flatMap((m) => glyphs.map((g) => `${indent}${g} ${m}\n`)).join('');
    const warned = (indent = '') => `${indent}⚠ hooks: set\n${indent}⚠ hooks: moved by a script\n${indent}⚠ hooks:x\n`;
    expect(said.plain.out, 'plain: the three reporting lines per message on stdout').toBe(each(['✓', '·', '›']));
    expect(said.plain.err, 'plain: the warnings on stderr, each line of the text under its topic').toBe(each(['⚠']) + warned());
    expect(said.quiet.out, 'quiet: only the acted line').toBe(each(['✓']));
    expect(said.colored.out.split('\n')[0], 'colored: the glyph and the task painted')
      .toBe('\x1b[1m\x1b[0;32m✓\x1b[0m \x1b[1mlabels:\x1b[0m 3 created');
    expect(JSON.stringify(said.indented), 'indented: each line opens with WK_LOG_INDENT')
      .toBe(JSON.stringify({ out: each(['✓', '·', '›'], '  '), err: each(['⚠'], '  ') + warned('  ') }));
    expect(said.stderr.out, 'WK_LOG_STDERR: nothing on stdout').toBe('');
    expect(said.stderr.err.split('\n')[0], 'WK_LOG_STDERR: the indent leads the line').toBe('    ✓ labels: 3 created');
    expect(said.all.out, 'all of them: nothing on stdout').toBe('');
    expect(said.all.err.split('\n')[0], 'all of them: the acted line on stderr, at the indent, painted')
      .toBe('  \x1b[1m\x1b[0;32m✓\x1b[0m \x1b[1mlabels:\x1b[0m 3 created');
  });
});

describe('the plain mutex, takeLock in workflow/lib/lock.js', () => {
  test('two takers exclude each other on one folder: while one holds it the other cannot take it, and can after the drop', async () => {
    const { takeLock, dropLock } = require(path.join(KIT, 'workflow', 'lib', 'lock.js'));
    const dir = path.join(mkTmp('twins-mutex-'), 'state', 'lock');
    expect(await takeLock(dir), 'the first taker takes the free folder').toBe(true);
    expect(await takeLock(dir), 'a second taker cannot take the folder the first holds').toBe(false);
    dropLock(dir);
    expect(await takeLock(dir), 'and takes it after the drop').toBe(true);
    dropLock(dir);
  });
});

describe('the marker sweep, sweepMarkers in workflow/lib/lock.js', () => {
  test('a record past 7 days goes; a younger one, a lock folder\'s file and a loose file stay', () => {
    const { sweepMarkers } = require(path.join(KIT, 'workflow', 'lib', 'lock.js'));
    const home = mkTmp('twins-sweep-');
    // [path under markers/, days since its last write]: records past and inside the 7 days, a lock folder's file, a loose file.
    const FILES = [
      ['claude-suite-marker/old', 8], ['claude-suite-marker/young', 1], ['claude-gh-journal/month', 30], ['claude-gh-journal/edge', 6],
      ['claude-suite-lock/held/pid', 8], ['loose', 8],
    ];
    for (const [rel, days] of FILES) agedFile(path.join(home, 'markers', rel), days);
    fs.utimesSync(path.join(home, 'markers', 'claude-suite-lock', 'held'), daysAgo(8), daysAgo(8));
    sweepMarkers(home);
    const left = fs.readdirSync(path.join(home, 'markers'), { recursive: true })
      .map((rel) => rel.replace(/\\/g, '/'))
      .filter((rel) => fs.statSync(path.join(home, 'markers', rel)).isFile()).sort();
    expect(left, 'the files the sweep left').toEqual(['claude-gh-journal/edge', 'claude-suite-lock/held/pid', 'claude-suite-marker/young', 'loose']);
  });
});

describe('the opt-in read, settingsOptedIn in hooks/mods/gate.js', () => {
  const fileOf = (root) => path.join(root, '.workkit', 'settings.json');

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
  test('an unreadable settings file reads opted out',
    { skip: !unreadable && 'this machine reads a mode-000 file (Windows, or root)' }, () => {
      expect(mods('gate').settingsOptedIn(readOrNull(fileOf(unreadable))), 'the module reads an unreadable file as opted out').toBe(false);
    });
});

describe('the session rule, sessionJudges in hooks/mods/gate.js', () => {
  // [the variables the rule reads, each environment beside nothing else, an absent key unset; its answer per text in TEXTS].
  const ENVS = [
    [{}, [false, false, false, false]], [{ CLAUDECODE: '1' }, [false, true, false, false]],
    [{ CLAUDECODE: '1', HOOK_DISABLE: '1' }, [false, false, false, false]], [{ CLAUDECODE: '1', HOOK_DISABLE: '0' }, [false, true, false, false]],
    [{ CLAUDECODE: '1', HOOK_DISABLE: '' }, [false, true, false, false]], [{ CLAUDECODE: '0' }, [false, false, false, false]],
    [{ CLAUDECODE: 'true' }, [false, false, false, false]], [{ CLAUDECODE: '' }, [false, false, false, false]],
    [{ HOOK_DISABLE: '1' }, [false, false, false, false]],
  ];
  // The settings texts: none, the opt-in, a decline, a string true.
  const TEXTS = [null, OPT_IN_SHAPES.current, '{ "version": 1, "enabled": false }\n', '{ "enabled": "true" }'];

  test('only CLAUDECODE=1, no HOOK_DISABLE=1 and an opted-in repo judge', () => {
    const { sessionJudges } = mods('gate');
    const wrong = ENVS.flatMap(([vars, want]) => TEXTS.flatMap((text, t) => (sessionJudges(vars, text) === want[t]
      ? [] : [`${JSON.stringify(vars)} over ${JSON.stringify(text)}: ${!want[t]}`])));
    expect(wrong.join('; '), 'the environments and texts sessionJudges answers wrongly').toBe('');
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

describe('the machine folder, userDir in hooks/mods/log.js and workflow/user-dir.js', () => {
  const { userDir: nodeUserDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
  // [WORKFLOW_HOME, HOME]; an unset WORKFLOW_HOME is undefined. The moved folder is
  // drive-spelled, which nativePath keeps on every system; user-dir.test.js has the Git Bash spelling.
  const HOMES = [[undefined, '/w/home'], ['C:/w/moved', '/w/home'], ['', '/w/home'], ['C:/w/moved', '/w/other'], [undefined, '/w/a b']];
  const FOLDERS = ['/w/home/.workkit', 'C:/w/moved', '/w/home/.workkit', 'C:/w/moved', '/w/a b/.workkit'];

  test('log.js userDir and user-dir.js userDir name one folder for every WORKFLOW_HOME and HOME: WORKFLOW_HOME, else .workkit under HOME', () => {
    const saved = process.env.WORKFLOW_HOME;
    try {
      const said = HOMES.map(([workflowHome, home]) => {
        if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
        return [mods('log').userDir(workflowHome, home), nodeUserDir(home).replace(/\\/g, '/')];
      });
      expect(said, `log.js and user-dir.js by index into ${JSON.stringify(HOMES)}`).toEqual(FOLDERS.map((folder) => [folder, folder]));
    } finally {
      if (saved === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = saved;
    }
  });

  test('towerDir names the tower folder under the machine folder for every WORKFLOW_HOME and HOME', () => {
    const { towerDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
    const saved = process.env.WORKFLOW_HOME;
    try {
      const node = HOMES.map(([workflowHome, home]) => {
        if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
        return towerDir(nodeUserDir(home)).replace(/\\/g, '/');
      });
      expect(JSON.stringify(node), `the tower folder by index into ${JSON.stringify(HOMES)}`).toBe(JSON.stringify([
        '/w/home/.workkit/tower', 'C:/w/moved/tower', '/w/home/.workkit/tower', 'C:/w/moved/tower', '/w/a b/.workkit/tower',
      ]));
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

  test('log.js homeVariableOf names the home\'s variable: HOME over USERPROFILE, USERPROFILE alone, else none', () => {
    const { homeVariableOf } = mods('log');
    expect(homeVariableOf({ HOME: '/w/home', USERPROFILE: 'C:/Users/w' }), 'both set').toBe('HOME');
    expect(homeVariableOf({ USERPROFILE: 'C:/Users/w' }), 'USERPROFILE alone').toBe('USERPROFILE');
    expect(homeVariableOf({}), 'neither set').toBe(undefined);
  });
});

describe('the CHANGELOG test, isChangelog in hooks/mods/changelog-guard.js', () => {
  test('a CHANGELOG.md at the root, below it or absolute is one; a longer name, another case, no extension or a folder of that name is not', () => {
    const { isChangelog } = mods('changelog-guard');
    expect(JSON.stringify(CHANGELOGS.map((p) => isChangelog(p))), CHANGELOGS.join(', '))
      .toBe(JSON.stringify([true, true, true, true, false, false, false, false, false, false]));
  });
});

describe('the hooks log, hooksLogOf and the line hooks/mods/log.js writes', () => {
  // [hook, event, session id, cwd, verdict], the fields of one fire's line.
  const FIRES = [
    ['safety:commit-gate', 'PreToolUse', 's1', '/w/repo', 'run'],
    ['docs:change-tracker', 'Stop', 's"1\\x', 'C:\\Users\\me\\repo', 'stood-down'],
    ['workflow:snapshot', 'PostToolUse', undefined, undefined, 'crashed'],
  ];

  test('the log is hooks.log in the machine folder, and each line reads back as its six fields', () => {
    const { hooksLogOf, logLine, appendLog } = mods('log');
    expect(hooksLogOf({ HOME: '/w/home' }), 'WORKFLOW_HOME unset: under the home\'s .workkit').toBe('/w/home/.workkit/hooks.log');
    expect(hooksLogOf({ HOME: '/w/home', WORKFLOW_HOME: '/w/moved' }), 'WORKFLOW_HOME set: in it').toBe('/w/moved/hooks.log');
    const text = appendLog('', FIRES.map(([hook, event, sid, cwd, verdict]) => logLine('2026-10-21T12:00:00Z', hook, event, sid, cwd, verdict)).join(''));
    const rows = text.split('\n').filter(Boolean).map((l) => l.split('\t'));
    expect(JSON.stringify(rows.map((r) => r.length)), 'six fields a line').toBe(JSON.stringify(FIRES.map(() => 6)));
    expect(JSON.stringify(rows.map((r) => [r[1], r[5]])), 'the hook second and the verdict last').toBe(JSON.stringify(FIRES.map((f) => [f[0], f[4]])));
  });
});

describe('the slug, slugFromRemote in workflow/slug.js and hooks/mods/slug.js', () => {
  // [remote url as git stores it, its slug]; the last four name no repo.
  const REMOTES = [
    ['git@github.com:acme/widgets.git', 'acme/widgets'], ['https://github.com/acme/widgets.git', 'acme/widgets'],
    ['https://github.com/acme/widgets', 'acme/widgets'], ['ssh://git@github.com/acme/widgets.git', 'acme/widgets'],
    ['https://github.com/acme/widgets/', 'acme/widgets'], ['  git@github.com:acme/widgets.git  ', 'acme/widgets'],
    ['C:\\Users\\x\\theirs.git', 'x/theirs'], ['/srv/git/acme/widgets.git', 'acme/widgets'],
    ['widgets', null], ['widgets.git', null], ['', null], ['   ', null],
  ];

  test('the two slug readers give every remote its slug, and no match the same null', () => {
    const { slugFromRemote: engine } = require(path.join(KIT, 'workflow', 'slug.js'));
    const { slugFromRemote: module } = mods('slug');
    const wrong = REMOTES.flatMap(([remote, slug]) => (engine(remote) === slug && module(remote) === slug
      ? [] : [`${JSON.stringify(remote)}: workflow/slug.js ${JSON.stringify(engine(remote))}, hooks/mods/slug.js ${JSON.stringify(module(remote))}`]));
    expect(wrong.join('; '), 'the remotes a reader answers wrongly').toBe('');
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

describe('the native path off Windows, nativePath in workflow/lib/platform.js', () => {
  test('macOS and Linux get every path back as it was given, a drive-mount spelling included, on a PATH where no cygpath starts', async () => {
    const PATHS = ['/c/Users/x/repo', 'C:/Users/x', '/w/a b/repo', 'rel/dir', '/d/a/x/', 'C:\\Users\\a b\\x', 'C:/a/../b', '//host/share/x'];
    const { nativePath } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const said = await underEnv({ PATH: EMPTY_PATH }, () => ['darwin', 'linux'].map((platform) => PATHS.map((p) => nativePath(p, { platform }))));
    expect(said).toEqual([PATHS, PATHS]);
  });
});

describe('workflow/lib/platform: nativePath on Windows, asked from any system', () => {
  const { nativePath } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));

  test('a drive path and a share path answer with forward slashes, on a PATH where no cygpath starts', async () => {
    const said = await underEnv({ PATH: EMPTY_PATH }, () => ['C:\\Users\\a b\\x', '\\\\host\\share\\x'].map((p) => nativePath(p, { platform: 'win32' })));
    expect(said).toEqual(['C:/Users/a b/x', '//host/share/x']);
  });

  test('a drive or share folder answers with its trailing slash off, a drive root kept whole, on a PATH where no cygpath starts', async () => {
    const PATHS = ['C:\\w\\kit\\', 'C:/w/kit/', 'C:\\w\\kit', 'C:/', '//server/share/x/'];
    const said = await underEnv({ PATH: EMPTY_PATH }, () => PATHS.map((p) => nativePath(p, { platform: 'win32' })));
    expect(said, `by index into ${JSON.stringify(PATHS)}`).toEqual(['C:/w/kit', 'C:/w/kit', 'C:/w/kit', 'C:/', '//server/share/x']);
  });

  test('a POSIX path still goes through cygpath -m, and its answer is cygpath\'s', async () => {
    const bin = mkTmp('twins-cygpath-');
    const argvLog = path.join(bin, 'cygpath-argv.log');
    stubToolJs(bin, 'cygpath', `${recordArgvJs(JSON.stringify(argvLog), 'process.argv.slice(2)')}\nprocess.stdout.write('D:/from/cygpath\\n');`);
    const said = await underEnv({ PATH: pathWith(bin) }, () => nativePath('/c/Users/x', { platform: 'win32' }));
    expect(readArgv(argvLog), 'cygpath ran once, asked for the mixed form').toEqual([['-m', '/c/Users/x']]);
    expect(said).toBe('D:/from/cygpath');
  });

  test('cygpath\'s answer has its trailing slash off, a drive root kept whole', async () => {
    const answerTo = async (answer) => {
      const bin = mkTmp('twins-cygpath-');
      stubToolJs(bin, 'cygpath', `process.stdout.write(${JSON.stringify(`${answer}\n`)});`);
      return underEnv({ PATH: pathWith(bin) }, () => nativePath('/c/Users/x', { platform: 'win32' }));
    };
    expect(await answerTo('D:/from/cygpath/'), 'a folder answered with a trailing slash').toBe('D:/from/cygpath');
    expect(await answerTo('D:/'), 'a drive root').toBe('D:/');
  });

  test('machineHome reads a Git Bash HOME through the same rule: the native home, cygpath\'s answer', async () => {
    const { machineHome } = require(path.join(KIT, 'workflow', 'lib', 'machine-home.js'));
    const bin = mkTmp('twins-cygpath-');
    const argvLog = path.join(bin, 'cygpath-argv.log');
    stubToolJs(bin, 'cygpath', `${recordArgvJs(JSON.stringify(argvLog), 'process.argv.slice(2)')}\nprocess.stdout.write('C:/Users/x\\n');`);
    const said = await underEnv({ PATH: pathWith(bin) }, () => machineHome({ HOME: '/c/Users/x' }, { platform: 'win32' }));
    expect(readArgv(argvLog), 'cygpath ran once, on the HOME given').toEqual([['-m', '/c/Users/x']]);
    expect(said).toBe('C:/Users/x');
  });

  test('claudeHome reads a Git Bash WORKFLOW_CLAUDE_HOME through the same rule: the native folder, cygpath\'s answer', async () => {
    const { claudeHome } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const bin = mkTmp('twins-cygpath-');
    const argvLog = path.join(bin, 'cygpath-argv.log');
    stubToolJs(bin, 'cygpath', `${recordArgvJs(JSON.stringify(argvLog), 'process.argv.slice(2)')}\nprocess.stdout.write('C:/Users/x/.claude\\n');`);
    const said = await underEnv({ PATH: pathWith(bin), WORKFLOW_CLAUDE_HOME: '/c/Users/x/.claude' }, () => claudeHome({ platform: 'win32' }));
    expect(readArgv(argvLog), 'cygpath ran once, on the folder given').toEqual([['-m', '/c/Users/x/.claude']]);
    expect(said).toBe('C:/Users/x/.claude');
  });

  test('the stop helper, unreadPathStop: a Git Bash HOME with no cygpath to read it is one line naming HOME and the fix, 1, no stack', () => {
    const dir = mkTmp('twins-unread-');
    const entry = path.join(dir, 'entry.js');
    fs.writeFileSync(entry, [
      `const { unreadPathStop } = require(${jsPath(path.join(KIT, 'workflow', 'lib', 'platform.js'))});`,
      `const { machineHome } = require(${jsPath(path.join(KIT, 'workflow', 'lib', 'machine-home.js'))});`,
      'try {',
      "  machineHome({ HOME: '/c/Users/x' }, { platform: 'win32' });",
      '} catch (err) {',
      '  process.exitCode = unreadPathStop(err);',
      '}',
    ].join('\n'));
    const res = run(process.execPath, [entry], { env: { ...process.env, PATH: EMPTY_PATH } });
    expect(res.status, `exit 1, got: ${res.output}`).toBe(1);
    expect(res.stderr, 'the one line').toBe('workkit: cannot read HOME (/c/Users/x): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n');
    expect(/^ {4}at /m.test(res.stderr), `no stack line, got: ${res.stderr}`).toBe(false);
  });
});

describe('twins: a Windows folder by its spelling, nativePath in workflow/lib/platform.js against shellDirOf in hooks/mods/markers.js', () => {
  const { nativePath } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
  // Two rules, one answer: nativePath trims and folds a Windows path by its own lines, shellDirOf by its own.
  // Drive and share folders, each with and without a trailing slash, in either slash.
  const FOLDERS = [
    'C:\\w\\kit\\', 'C:\\w\\kit', 'C:/w/kit/', 'C:/w/kit', 'C:\\w\\a b\\', 'D:/a/_temp/x/', 'C:/', 'C:\\',
    '//server/share/x/', '//server/share/x', '\\\\server\\share\\x\\', '\\\\server\\share\\x',
  ];

  test('the commands and the hooks name every drive or share folder as one string', async () => {
    const commands = await underEnv({ PATH: EMPTY_PATH }, () => FOLDERS.map((p) => nativePath(p, { platform: 'win32' })));
    const differ = FOLDERS.flatMap((p, i) => {
      const hooks = mods('markers').shellDirOf(p, {}, 'win32');
      return commands[i] === hooks ? [] : [`${JSON.stringify(p)}: nativePath ${JSON.stringify(commands[i])}, shellDirOf ${JSON.stringify(hooks)}`];
    });
    expect(differ.join('; '), 'the folders the two name apart').toBe('');
  });
});

describe('the claude home, claudeHome in workflow/lib/platform.js, read from the env and home given', () => {
  const { claudeHome } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
  const PROCESS = { WORKFLOW_CLAUDE_HOME: '/process/claude', HOME: '/process/home' };

  test('a WORKFLOW_CLAUDE_HOME in the env given is the claude home, this process\'s never read', async () => {
    const said = await underEnv(PROCESS, () => claudeHome({ env: { WORKFLOW_CLAUDE_HOME: '/given/claude' }, home: '/given/home', platform: 'linux' }));
    expect(said).toBe('/given/claude');
  });

  test('without it: <home>/.claude, the home given, else the env\'s HOME, this process\'s never read', async () => {
    const said = await underEnv(PROCESS, () => [
      claudeHome({ env: {}, home: '/given/home', platform: 'linux' }),
      claudeHome({ env: { HOME: '/env/home' }, platform: 'linux' }),
    ]);
    expect(said).toEqual(['/given/home/.claude', '/env/home/.claude']);
  });

  test('a home given is used as is: on Windows no cygpath starts for it', async () => {
    const said = await underEnv({ PATH: EMPTY_PATH }, () => claudeHome({ env: {}, home: '/c/Users/x', platform: 'win32' }));
    expect(said).toBe('/c/Users/x/.claude');
  });
});

/** A new folder at `dir`, a git repo with `origin` as its remote, or with none when `origin` is undefined. */
const originRepo = (dir, origin) => {
  fs.mkdirSync(dir);
  if (origin !== undefined) return mkOriginRepo(dir, origin);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

describe('the repo slug and the kit checkout, repoSlug and isKitCheckout in workflow/lib/repo.js', () => {
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

  test('repoSlug names each folder\'s origin slug, its subfolder\'s included, and nothing where none is', () => {
    const dirs = folders();
    const names = Object.keys(dirs);
    const { repoSlug } = require(path.join(KIT, 'workflow', 'lib', 'repo.js'));
    expect(names.map((n) => repoSlug(dirs[n])), `each folder's slug, by ${names.join(', ')}`).toEqual([
      'acme/workkit', 'ITW-Creative-Works/WorkKit', 'acme/workkit-extra', 'workkit/widgets', 'acme/workkit', '', 'acme/workkit', '', '',
    ]);
  });

  test('isKitCheckout reads a workkit origin, its subfolder and a local workkit path as the kit, nothing else', () => {
    const dirs = { ...folders(), empty: '' };
    const names = Object.keys(dirs);
    const { isKitCheckout } = require(path.join(KIT, 'workflow', 'lib', 'repo.js'));
    expect(names.map((n) => isKitCheckout(dirs[n])), `by ${names.join(', ')}`)
      .toEqual([true, true, false, false, true, false, true, false, false, false]);
  });
});

describe('the clone rank, cloneOutranks and inPluginCache in workflow/lib/platform.js', () => {
  /** A kit folder whose manifest names `name`, at `dir`. */
  const manifested = (dir, name) => {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name })}\n`);
    return dir;
  };

  test('the cached kit with a clone alone is outranked, the Claude home named directly or through a link', () => {
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
    const { cloneOutranks } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const saved = process.env.WORKFLOW_CLAUDE_HOME;
    try {
      for (const home of [claude, linked]) {
        process.env.WORKFLOW_CLAUDE_HOME = home;
        expect(JSON.stringify(PAIRS.map((pair) => cloneOutranks(...pair))), `the pairs by index, the home ${home}`)
          .toBe(JSON.stringify([true, false, false, false, false, false, false]));
      }
    } finally {
      if (saved === undefined) delete process.env.WORKFLOW_CLAUDE_HOME; else process.env.WORKFLOW_CLAUDE_HOME = saved;
    }
  });

  test('with no WORKFLOW_CLAUDE_HOME, inPluginCache reads the Claude home under HOME', () => {
    const home = mkTmp('twins-cache-home-');
    const cached = manifested(path.join(home, '.claude', 'plugins', 'cache', 'itw', 'workkit', '1.2.3'), 'workkit');
    const { inPluginCache } = require(path.join(KIT, 'workflow', 'lib', 'platform.js'));
    const saved = { HOME: process.env.HOME, WORKFLOW_CLAUDE_HOME: process.env.WORKFLOW_CLAUDE_HOME };
    try {
      delete process.env.WORKFLOW_CLAUDE_HOME;
      process.env.HOME = home;
      expect(inPluginCache(cached), `the kit under ${home}/.claude/plugins/cache is the cached kit`).toBe(true);
    } finally {
      for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
});

describe('the physical path, physicalPath in workflow/lib/platform.js', () => {
  const physicalPath = (p) => require(path.join(KIT, 'workflow', 'lib', 'platform.js')).physicalPath(p);

  test('a file named through a linked folder reads as the physical folder plus its name', () => {
    const dir = mkTmp('twins-physical-');
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'shell.sh'), '');
    // A junction on Windows, a symlink elsewhere (where the type is ignored).
    fs.symlinkSync(real, path.join(dir, 'linked'), 'junction');
    expect(physicalPath(`${path.join(dir, 'linked')}/shell.sh`), 'the real folder, then the name').toBe(`${fs.realpathSync(real)}/shell.sh`);
  });

  test("a link to a file keeps the link's own folder and name", { skip: skipWithoutFileLink() }, () => {
    const dir = mkTmp('twins-physical-');
    const away = path.join(dir, 'away');
    const here = path.join(dir, 'here');
    fs.mkdirSync(away);
    fs.mkdirSync(here);
    fs.writeFileSync(path.join(away, 'target.sh'), '');
    fs.symlinkSync(path.join(away, 'target.sh'), path.join(here, 'link.sh'), 'file');
    expect(physicalPath(`${here}/link.sh`), "the link's folder and name, never the target's").toBe(`${fs.realpathSync(here)}/link.sh`);
  });

  test('a folder that is not there: null', () => {
    expect(physicalPath(`${mkTmp('twins-physical-')}/missing/shell.sh`), 'no physical path').toBe(null);
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

describe('the atomic link, link and mvLink in workflow/lib/link.js',
  { skip: IS_WINDOWS && 'Windows makes no symlink without a privilege this run may lack' }, () => {
    const linkJs = () => require(path.join(KIT, 'workflow', 'lib', 'link.js'));

    test('link leaves the address the link to the target, answers true and leaves no temp file: missing, pointing elsewhere, already right', () => {
      const base = fs.realpathSync(mkTmp('twins-link-'));
      const [target, other] = ['target', 'other'].map((name) => {
        fs.mkdirSync(path.join(base, name));
        return path.join(base, name);
      });
      // Each address's state before the call; `elsewhere` points at a folder, so a rename that follows it lands inside.
      const STATES = { missing: null, elsewhere: other, right: target };
      const node = Object.entries(STATES).map(([state, points]) => {
        const dir = path.join(base, state);
        fs.mkdirSync(dir, { recursive: true });
        const address = path.join(dir, 'address');
        if (points) fs.symlinkSync(points, address);
        const answer = linkJs().link(target, address);
        return `${state}: ${answer} ${whatsAt(address)}; folder ${whatsAt(dir)}; other ${whatsAt(other)}`;
      });
      expect(JSON.stringify(node), 'every address now the link to the target, nothing else beside it')
        .toBe(JSON.stringify(Object.keys(STATES).map((state) => `${state}: true link -> ${target}; folder dir address; other dir `)));
    });

    test('mvLink moves a link onto each address, never into a folder an address points at, and answers false with no link to move', () => {
      const base = fs.realpathSync(mkTmp('twins-mv-link-'));
      const other = path.join(base, 'other');
      fs.mkdirSync(other);
      // The `to` address before the move; `from` is a link to `target`, or nothing for `gone`.
      const STATES = ['missing', 'link to a folder', 'file', 'gone'];
      const node = STATES.map((state, i) => {
        const dir = path.join(base, String(i));
        fs.mkdirSync(dir, { recursive: true });
        const [from, to] = [path.join(dir, 'from'), path.join(dir, 'to')];
        if (state !== 'gone') fs.symlinkSync('target', from);
        if (state === 'link to a folder') fs.symlinkSync(other, to);
        if (state === 'file') fs.writeFileSync(to, 'old\n');
        const answer = linkJs().mvLink(from, to);
        return `${state}: ${answer} ${whatsAt(to)}; folder ${whatsAt(dir)}; other ${whatsAt(other)}`;
      });
      expect(JSON.stringify(node), 'the link takes each address\'s place, the folder it pointed at untouched; with none, nothing moves')
        .toBe(JSON.stringify([
          ...STATES.slice(0, 3).map((state) => `${state}: true link -> target; folder dir to; other dir `),
          'gone: false none; folder dir ; other dir ',
        ]));
    });
  });

describe('the safe JSON edit, editJson in workflow/lib/write.js', () => {
  // [name, file text, the change]: a change that fails, a file that is no JSON.
  const EDITS = [
    ['a change that fails', '{"a":1}', () => { throw new Error('refused'); }],
    ['a file that is no JSON', '{"a":', (value) => ({ ...value, b: [2] })],
  ];
  // Windows keeps no mode to compare.
  const MODE = IS_WINDOWS ? 'no mode' : '640';
  const modeOf = (file) => (IS_WINDOWS ? 'no mode' : (fs.statSync(file).mode & 0o777).toString(8));

  test('each failure leaves the file as it was, its mode kept, and no temp file left', () => {
    const { editJson } = require(path.join(KIT, 'workflow', 'lib', 'write.js'));
    const base = mkTmp('twins-json-edit-');
    const node = EDITS.map(([name, text, change], i) => {
      const dir = path.join(base, String(i));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'settings.json');
      fs.writeFileSync(file, text);
      fs.chmodSync(file, 0o640);
      const answer = editJson(file, change);
      return [name, answer, fs.readFileSync(file, 'utf8'), modeOf(file), whatsAt(dir)];
    });
    expect(JSON.stringify(node), 'each edit\'s answer, bytes, mode and folder')
      .toBe(JSON.stringify([
        ['a change that fails', false, '{"a":1}', MODE, 'dir settings.json'],
        ['a file that is no JSON', false, '{"a":', MODE, 'dir settings.json'],
      ]));
  });
});

describe('twins: the kit\'s hooks folder, wk_githooks_kit, wk_githooks_kitlike and wk_githooks_spelled in workflow/githooks/hook.sh against workflow/lib/participation.js', () => {
  const sources = lib('workflow', 'githooks', 'hook.sh');
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
    const shell = bashPairs(sources, 'wk_githooks_kit', shellArgs(pairs));
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
    const shell = bashPairs(sources, 'wk_githooks_kitlike', shellArgs(pairs)).map((out) => out !== null);
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

describe('the real tool, the git and gh shims\' PATH walk', () => {
  // [tool, the shim, the shell line that starts it as a program does: git's under bash, gh's under node].
  const SHIMS = [
    ['git', path.join(KIT, 'workflow', 'gitshim', 'git'), '"$BASH" "$3" --version'],
    ['gh', path.join(KIT, 'workflow', 'identity', 'gh'), '"$4" "$3" --version'],
  ];
  // [the folders after this node's and the system tools', by name; the one whose tool runs, or none]. The front
  // comes before the shim's own folder, so the walk passes over it and a shim still finds node. `ownSlash` is
  // the own folder with a trailing slash, `rel` a relative entry read from the cwd, `ownLink` a link to the own
  // folder, whose shim run through it walks on from there, and `noexec`'s tool a file no one can run.
  const ROWS = [
    [['own', 'first', 'second'], 'first'],
    [['first', 'own', 'second'], 'second'],
    [['first', 'own', 'first', 'second'], 'second'],
    [['own', 'missing', 'first'], 'first'],
    [['first', 'own'], 'none'],
    [['own', 'ownSlash', 'first'], 'first'],
    [['own', 'rel', 'second'], 'rel'],
    [['own', 'ownLink', 'first'], 'first'],
    [['own', 'noexec', 'first'], 'first'],
  ];

  test('each shim runs the first tool on PATH after its own folder, every folder met at or before it passed over; with none, the line naming the shim and 127', () => {
    const root = mkTmp('twins-walk-');
    const front = [NODE_DIR, ...SYSTEM_PATH.split(path.delimiter)].map(shellPath).join(':');
    const said = SHIMS.map(([tool, shim, line]) => {
      // Each stand-in prints the name of its folder, which holds no other tool.
      const folders = Object.fromEntries(['first', 'second', 'rel'].map((name) => {
        const dir = path.join(root, `${tool}-${name}`);
        fs.mkdirSync(dir);
        stubToolJs(dir, tool, `process.stdout.write(${JSON.stringify(`${name}\n`)});`);
        return [name, shellPath(dir)];
      }));
      // No mode bit and no `#!`, so no platform reads it as a program.
      const noexec = path.join(root, `${tool}-noexec`);
      fs.mkdirSync(noexec);
      fs.writeFileSync(path.join(noexec, tool), 'not a tool\n', { mode: 0o644 });
      // A junction on Windows, which needs no privilege; elsewhere the type is ignored.
      const ownLink = path.join(root, `${tool}-own-link`);
      fs.symlinkSync(path.dirname(shim), ownLink, 'junction');
      const own = shellPath(path.dirname(shim));
      const entries = {
        ...folders, own, ownSlash: `${own}/`, ownLink: shellPath(ownLink), rel: `${tool}-rel`, noexec: shellPath(noexec), missing: shellPath(path.join(root, 'missing')),
      };
      return ROWS.map(([names]) => {
        // PATH is set inside bash, so it reads the spellings as written on every platform.
        const res = spawnSystemBash([...NO_RC, '-c', `PATH="$1:$2"; ${line}`, 'walk', front, names.map((n) => entries[n]).join(':'), shellPath(shim), shellPath(process.execPath)], {
          cwd: root, env: homeEnv(mkTmp('twins-walk-home-'), { PATH: SYSTEM_PATH }), encoding: 'utf8', timeout: SPAWN_DEADLINE,
        });
        const out = (res.stdout || '').replace(/\r/g, '').trim();
        if (out) return out;
        const none = res.status === 127 && (res.stderr || '').startsWith(`${tool}: no ${tool} on PATH after the workkit shim at `);
        return none ? 'none' : `exit ${res.status}: ${res.stderr}`;
      });
    });
    const want = ROWS.map(([, pick]) => pick);
    expect(said, `the folder whose tool ran, git's then gh's, by index into ${JSON.stringify(ROWS.map(([names]) => names))}`).toEqual([want, want]);
  });

  test('each shim reached through a chain of links, one relative and one absolute, runs from its own kit: git\'s judge refuses a discard, gh walks on to the tool after the chain', { skip: skipWithoutFileLink() }, () => {
    const w = mkRepo('twins-chain-', { 'app.js': 'const x = 1;\n' });
    w.write('app.js', 'const x = 2;\n');
    // The chain first on PATH, then for gh a stand-in printing `after`; git's next is the real git it judges with.
    const ran = (tool, shim, line, env) => {
      // <tool>-chain/<tool> -> ../<tool>-hop/<tool> -> the real shim, by its absolute path.
      const [chain, hop, after] = ['chain', 'hop', 'after'].map((name) => path.join(w.dir, `${tool}-${name}`));
      for (const dir of [chain, hop, after]) fs.mkdirSync(dir);
      fs.symlinkSync(shim, path.join(hop, tool), 'file');
      fs.symlinkSync(path.join('..', `${tool}-hop`, tool), path.join(chain, tool), 'file');
      if (tool === 'gh') stubToolJs(after, tool, "process.stdout.write('after\\n');");
      const PATH = [chain, after, ...SYSTEM_PATH.split(path.delimiter), NODE_DIR].map(shellPath).join(':');
      return spawnSystemBash([...NO_RC, '-c', `PATH="$1"; ${line}`, 'chain', PATH], {
        cwd: w.repo, env: { ...w.env, PATH: SYSTEM_PATH, ...env }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
    };
    const git = ran('git', path.join(KIT, 'workflow', 'gitshim', 'git'), 'git reset --hard', { CLAUDECODE: '1' });
    expect(git.status, `git: exit 1, stderr: ${git.stderr}`).toBe(1);
    expect(git.stderr.includes('tree-guard: BLOCKED'), `git: the kit's judge refused, got: ${git.stderr}`).toBeTruthy();
    expect(git.stdout, 'git: the reset never ran').toBe('');
    expect(fs.readFileSync(path.join(w.repo, 'app.js'), 'utf8'), 'git: the edit is still there').toBe('const x = 2;\n');
    const gh = ran('gh', path.join(KIT, 'workflow', 'identity', 'gh'), 'gh --version', {});
    expect(`${gh.status} ${gh.stdout.replace(/\r/g, '')}`, `gh: the tool after the chain, stderr: ${gh.stderr}`).toBe('0 after\n');
  });
});

describe('the terminal questions and the spinner, workflow/lib/flows.js and spin.js', () => {
  const nodeLib = (name) => require(path.join(KIT, 'workflow', 'lib', name));
  const INDENTED = { WK_LOG_INDENT: '  ' };
  const COLORED = { WORKKIT_COLOR: '1', TERM: 'xterm-256color' };

  test('askYes asks in its words, takes every answer under either default, and reads a closed stdin as no', async () => {
    const { askYes } = nodeLib('flows.js');
    const QUESTION = 'Join the workflow?';
    const ANSWERS = ['y', 'Y', 'yes', 'YES', 'Yes', 'n', 'N', 'no', '', 'x'];
    // Each answer typed once, then the closed stdin the last question meets.
    const nodeOf = async (fallback) => {
      const answers = [];
      let said = '';
      for (const input of [...ANSWERS.map((a) => `${a}\n`), '']) {
        const streams = ioOf(input);
        answers.push((await askYes(QUESTION, fallback, streams.io)) ? '1' : '0');
        said += streams.said();
      }
      return { answers: answers.join(''), said };
    };
    expect(JSON.stringify(await nodeOf('y')), 'under yes: Enter is yes, Yes and x are no, a closed stdin no, the hint [Y/n], a newline after the closed read')
      .toBe(JSON.stringify({ answers: '11110000100', said: `${`${QUESTION} [Y/n] `.repeat(ANSWERS.length + 1)}\n` }));
    expect(JSON.stringify(await nodeOf('n')), 'under no: Enter is no, the hint [y/N]')
      .toBe(JSON.stringify({ answers: '11110000000', said: `${`${QUESTION} [y/N] `.repeat(ANSWERS.length + 1)}\n` }));
  });

  test('openUrl hands the URL to one opener, and with none prints the pointer, plain and styled', () => {
    const URL = 'https://example.invalid/owner/workkit/discussions/categories';
    const OPENERS = ['open', 'xdg-open'];
    // A PATH with no opener on it: this platform's is the one there could be.
    const bare = basePathWithout(mkTmp('twins-opener-'), process.platform === 'darwin' ? 'open' : 'xdg-open');
    const say = ({ stubs, vars = {} }) => {
      const bin = mkTmp('twins-opener-');
      const log = (tool) => path.join(bin, `${tool}.log`);
      if (stubs) for (const tool of OPENERS) stubTool(bin, tool, ['#!/usr/bin/env bash', recordArgv(log(tool)), 'exit 0']);
      const env = { PATH: stubs ? joinPath(bin, SYSTEM_PATH) : bare, ...vars };
      const err = run(process.execPath, ['-e', `Promise.resolve(require(${jsPath(path.join(KIT, 'workflow', 'lib', 'flows.js'))}).openUrl(process.argv[1]))`, URL], {
        env: homeEnv(mkTmp('twins-opener-home-'), env),
      }).stderr.replace(/\r/g, '');
      return { err, opened: Object.fromEntries(OPENERS.map((tool) => [tool, readArgv(log(tool))])) };
    };
    const opener = say({ stubs: true });
    const ran = Object.values(opener.opened).filter((calls) => calls.length);
    expect(JSON.stringify(ran), `one opener ran, once, with the URL, got: ${JSON.stringify(opener)}`).toBe(JSON.stringify([[[URL]]]));
    expect(opener.err, 'and nothing is said').toBe('');
    const POINTER = '(no browser could be launched: open the URL above by hand)';
    const none = { open: [], 'xdg-open': [] };
    expect(JSON.stringify(say({ stubs: false })), 'with no opener: the pointer line').toBe(JSON.stringify({ err: `${POINTER}\n`, opened: none }));
    expect(JSON.stringify(say({ stubs: false, vars: { ...COLORED, ...INDENTED } })), 'styled: dim, at the indent')
      .toBe(JSON.stringify({ err: `  \x1b[0;90m${POINTER}\x1b[0m\n`, opened: none }));
  });

  // The seconds count is the clock's, so every frame reads as one.
  const anySeconds = (frames) => frames.slice(0, 3).map((frame) => frame.replace(/\(\d+s\)/, '(Ns)'));
  // The first three frames around <words>, plain and styled at the indent.
  const framesOf = (words) => ({
    plain: ['⠋', '⠙', '⠹'].map((f) => `${f} ${words} (Ns)`),
    styled: ['⠋', '⠙', '⠹'].map((f) => `  \x1b[0;36m${f}\x1b[0m ${words} \x1b[0;90m(Ns)\x1b[0m`),
  });

  test('spin draws its first frames in order, plain and styled at the indent', async () => {
    const want = framesOf(MESSAGE);
    for (const [name, vars] of [['plain', {}], ['styled', { ...COLORED, ...INDENTED }]]) {
      const node = await driveSpin('call', { env: homeEnv(mkTmp('twins-spin-home-'), { PATH: SYSTEM_PATH, WORKKIT_SPIN: '1', ...vars }), frames: 3 });
      expect(JSON.stringify(anySeconds(framesIn(node.stderr))), `${name}: spin's first frames`).toBe(JSON.stringify(want[name]));
    }
  });

  test('poll draws its first countdown frames in order, plain and styled at the indent', async () => {
    const want = framesOf(`${POLL_MESSAGE}...`);
    for (const [name, vars] of [['plain', {}], ['styled', { ...COLORED, ...INDENTED }]]) {
      const node = await drivePoll('s', { env: homeEnv(mkTmp('twins-poll-home-'), { PATH: SYSTEM_PATH, WORKKIT_SPIN: '1', ...vars }), frames: 3 });
      expect(JSON.stringify(anySeconds(node.frames)), `${name}: poll's first frames`).toBe(JSON.stringify(want[name]));
    }
  });

  test('spin prints one line with the frames off, plain, at the indent and none under QUIET=1', async () => {
    const LINES = { plain: `⏳ ${MESSAGE}...\nafter\n`, indented: `  ⏳ ${MESSAGE}...\nafter\n`, quiet: 'after\n' };
    for (const [name, vars] of [['plain', {}], ['indented', INDENTED], ['quiet', { QUIET: '1' }]]) {
      const node = await driveSpin('call', { env: homeEnv(mkTmp('twins-spin-home-'), { PATH: SYSTEM_PATH, WORKKIT_SPIN: '0', ...vars }) });
      expect(node.stderr, `${name}: spin's stderr`).toBe(LINES[name]);
    }
  });
});
