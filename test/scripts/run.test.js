// Tests for workflow/lib/run.js: the one Node home for starting a program. The
// Windows rules are answered on every machine, since launchOf takes the platform
// and the parent env; the last cases start real programs here.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { IS_WINDOWS, NODE_DIR, SYSTEM_PATH, joinPath, asWindows } = require('../lib/platform');
const { launchOf, windowsQuoted, spawnSync, execFileSync } = require('../../workflow/lib/run');

// A Windows parent's env: what a child of it needs to start cmd.exe and keep a temp folder.
const WIN_PARENT = {
  Path: 'C:\\Windows\\system32',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  SystemRoot: 'C:\\Windows',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
  TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
};

const onWin32 = (cmd, args, options, parentEnv = WIN_PARENT) => launchOf(cmd, args, options, { platform: 'win32', parentEnv });

const RUN_JS = require.resolve('../../workflow/lib/run');

/** run.js as Windows loads it: this one on Windows, elsewhere a fresh copy loaded under a faked win32. */
const win32Run = () => {
  if (IS_WINDOWS) return require(RUN_JS);
  const kept = require.cache[RUN_JS];
  delete require.cache[RUN_JS];
  try {
    return asWindows(() => require(RUN_JS));
  } finally {
    require.cache[RUN_JS] = kept;
  }
};

// A shell script and a node script, as a `#!` line opens each.
const SH_SCRIPT = '#!/bin/sh\nexit 0\n';
const NODE_SCRIPT = '#!/usr/bin/env node\nprocess.exit(0);\n';

/** Write `name` into `dir` (made when missing) holding `text`, empty by default. */
const put = (dir, name, text = '') => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

/** A scratch Git Bash: its folder and its bash.exe. */
const gitBash = (root) => {
  const dir = path.join(root, 'Git', 'usr', 'bin');
  return { dir, bash: put(dir, 'bash.exe') };
};

/** Every value `env` holds under `key`, matched without case as Windows does. */
const valuesOf = (env, key) => Object.keys(env).filter((k) => k.toLowerCase() === key.toLowerCase()).map((k) => env[k]);

/** The error `fn` throws, or null when it returns. */
const thrownBy = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
};

const ARGS = ['api', 'labels[]=x', 'a b'];
const QUOTED = ['"api"', '"labels[]=x"', '"a b"'];

const cases = async () => {
  group('run.js: launchOf off Windows');

  await test('on darwin and linux the launch is the input, args and options unchanged', () => {
    const dir = mkTmp('wk-run-');
    put(dir, 'gh', SH_SCRIPT);
    for (const platform of ['darwin', 'linux']) {
      const options = { env: { PATH: dir }, cwd: dir };
      const launch = launchOf('gh', [...ARGS], options, { platform, parentEnv: WIN_PARENT });
      assertEq(JSON.stringify(launch), JSON.stringify({ file: 'gh', args: ARGS, options: { env: { PATH: dir }, cwd: dir } }),
        `${platform}: untouched`);
    }
  });

  group('run.js: launchOf on win32');

  await test('a #! script first on PATH runs through Git Bash, ahead of a later gh.exe', () => {
    const root = mkTmp('wk-run-');
    const script = put(path.join(root, 'shim'), 'gh', SH_SCRIPT);
    put(path.join(root, 'gh-cli'), 'gh.exe');
    const { dir, bash } = gitBash(root);
    const launch = onWin32('gh', ARGS, { env: { PATH: [path.join(root, 'shim'), path.join(root, 'gh-cli'), dir].join(';') } });
    assertEq(launch.file, bash, 'Git Bash starts the shim');
    assertEq(JSON.stringify(launch.args), JSON.stringify([`"${script}"`, ...QUOTED]), 'the script path first, every argument quoted');
    assertEq(launch.options.windowsVerbatimArguments, true, 'handed over verbatim');
  });

  await test('a dir holding only gh.exe: that file, every argument quoted, verbatim', () => {
    const root = mkTmp('wk-run-');
    const exe = put(path.join(root, 'gh-cli'), 'gh.exe');
    const launch = onWin32('gh', ARGS, { env: { PATH: path.join(root, 'gh-cli') } });
    assertEq(launch.file, exe, 'the exe itself');
    assertEq(JSON.stringify(launch.args), JSON.stringify(QUOTED), 'every argument quoted');
    assertEq(launch.options.windowsVerbatimArguments, true, 'handed over verbatim');
  });

  await test('npm: a #! npm beside npm.cmd runs through Git Bash; npm.cmd alone runs through ComSpec', () => {
    const root = mkTmp('wk-run-');
    const { dir, bash } = gitBash(root);
    const both = path.join(root, 'both');
    const script = put(both, 'npm', SH_SCRIPT);
    put(both, 'npm.cmd');
    const shim = onWin32('npm', ['--version'], { env: { PATH: [both, dir].join(';') } });
    assertEq(shim.file, bash, 'the bare name wins its folder, so Git Bash starts it');
    assertEq(JSON.stringify(shim.args), JSON.stringify([`"${script}"`, '"--version"']), 'the script, then its argument');

    const cmd = put(path.join(root, 'cmd-only'), 'npm.cmd');
    const batch = onWin32('npm', ['--version'], { env: { PATH: path.join(root, 'cmd-only') } });
    assertEq(batch.file, 'C:\\Windows\\system32\\cmd.exe', "the parent's ComSpec");
    assertEq(batch.args.join(' '), `/d /s /c "${cmd} ^"--version^""`, 'one quoted line for cmd.exe');
    assertEq(batch.options.windowsVerbatimArguments, true, 'handed over verbatim');
  });

  await test("bash is Git Bash: System32's and a WindowsApps bash.exe are passed over", () => {
    const root = mkTmp('wk-run-');
    const systemRoot = path.join(root, 'Windows');
    const system32 = path.join(systemRoot, 'System32');
    put(system32, 'bash.exe');
    const apps = path.join(root, 'Users', 'x', 'AppData', 'Local', 'Microsoft', 'WindowsApps');
    put(apps, 'bash.exe');
    const { dir, bash } = gitBash(root);
    const launch = onWin32('bash', ['-c', 'true'], { env: { PATH: [system32, apps, dir].join(';') } },
      { ...WIN_PARENT, SystemRoot: systemRoot, LOCALAPPDATA: path.join(root, 'Users', 'x', 'AppData', 'Local') });
    assertEq(launch.file, bash, 'the later Git Bash, never WSL');
  });

  await test('a folder is passed over by its SystemRoot prefix, without case, never by its name', () => {
    const root = mkTmp('wk-run-');
    const systemRoot = path.join(root, 'Windows');
    const wsl = path.join(systemRoot, 'Sysnative');
    put(wsl, 'bash.exe');
    const lookalike = path.join(root, 'tools', 'System32');
    const bash = put(lookalike, 'bash.exe');
    const launch = onWin32('bash', [], { env: { PATH: [wsl, lookalike].join(';') } },
      { ...WIN_PARENT, SystemRoot: systemRoot.toUpperCase() });
    assertEq(launch.file, bash, 'a System32 outside SystemRoot is Git Bash; a folder under it of any name is not');
  });

  await test('a PATH entry in quotes is read without them', () => {
    const root = mkTmp('wk-run-');
    const { dir, bash } = gitBash(root);
    assertEq(onWin32('bash', [], { env: { PATH: `"${dir}"` } }).file, bash, 'Git Bash in a quoted entry');
    const exe = put(path.join(root, 'gh-cli'), 'gh.exe');
    assertEq(onWin32('gh', [], { env: { PATH: `"${path.dirname(exe)}"` } }).file, exe, 'a program in a quoted entry');
  });

  await test('with no bash.exe on PATH, the bash.exe in bin beside git.exe is Git Bash', () => {
    const root = mkTmp('wk-run-');
    const cmdDir = path.join(root, 'Git', 'cmd');
    put(cmdDir, 'git.exe');
    const bash = put(path.join(root, 'Git', 'bin'), 'bash.exe');
    assertEq(onWin32('bash', ['-c', 'true'], { env: { PATH: cmdDir } }).file, bash, 'Git\\cmd gives Git\\bin\\bash.exe');
  });

  await test('with Git Bash nowhere, a #! npm is passed over for the npm.cmd beside it', () => {
    const root = mkTmp('wk-run-');
    const both = path.join(root, 'both');
    put(both, 'npm', SH_SCRIPT);
    const cmd = put(both, 'npm.cmd');
    const launch = onWin32('npm', ['--version'], { env: { PATH: both } });
    assertEq(launch.file, WIN_PARENT.ComSpec, 'cmd.exe starts the npm.cmd');
    assertEq(launch.args[3], `"${cmd} ^"--version^""`, 'the npm.cmd line');
  });

  await test('with Git Bash nowhere, bash by name and a #! file by path fail loudly, naming Git Bash', () => {
    const root = mkTmp('wk-run-');
    const empty = path.join(root, 'empty');
    fs.mkdirSync(empty);
    const byName = thrownBy(() => onWin32('bash', ['-c', 'true'], { env: { PATH: empty } }));
    assert(byName && /Git Bash not found/.test(byName.message), `bash by name throws, got: ${byName}`);
    const script = put(path.join(root, 'kit', 'bin'), 'workkit', SH_SCRIPT);
    const byPath = thrownBy(() => onWin32(script, ['test'], { env: { PATH: empty } }));
    assert(byPath && /Git Bash not found/.test(byPath.message), `a #! file by path throws, got: ${byPath}`);
  });

  await test('an extensionless file with no #! line is passed over for the gh.exe beside it', () => {
    const root = mkTmp('wk-run-');
    const dir = path.join(root, 'gh-cli');
    put(dir, 'gh', 'not a script\n');
    const exe = put(dir, 'gh.exe');
    assertEq(onWin32('gh', ARGS, { env: { PATH: dir } }).file, exe, 'the exe, not the plain file');
  });

  await test('a #! script and gh.exe in one folder: the bare name wins, through Git Bash', () => {
    const root = mkTmp('wk-run-');
    const dir = path.join(root, 'shim');
    const script = put(dir, 'gh', SH_SCRIPT);
    put(dir, 'gh.exe');
    const { dir: bashDir, bash } = gitBash(root);
    const launch = onWin32('gh', ARGS, { env: { PATH: [dir, bashDir].join(';') } });
    assertEq(launch.file, bash, 'Git Bash starts the bare name');
    assertEq(launch.args[0], `"${script}"`, 'the script first');
  });

  await test('a node #! line launches through this node, script first; any other #! through Git Bash', () => {
    const root = mkTmp('wk-run-');
    const envDir = path.join(root, 'env-node');
    const viaEnv = put(envDir, 'tool', NODE_SCRIPT);
    const viaPath = put(path.join(root, 'path-node'), 'tool', '#!/usr/local/bin/node\n');
    const other = put(path.join(root, 'other'), 'tool', '#!/usr/bin/env nodejs\n');
    const { dir, bash } = gitBash(root);
    const byEnv = onWin32('tool', ARGS, { env: { PATH: [envDir, dir].join(';') } });
    assertEq(byEnv.file, process.execPath, '#!/usr/bin/env node runs under this node');
    assertEq(JSON.stringify(byEnv.args), JSON.stringify([`"${viaEnv}"`, ...QUOTED]), 'the script first, every argument quoted');
    assertEq(onWin32(viaPath, [], { env: { PATH: dir } }).file, process.execPath, 'a path ending /node runs under this node');
    assertEq(onWin32(other, [], { env: { PATH: dir } }).file, bash, 'any other #! line runs through Git Bash');
    assertEq(onWin32('tool', [], { env: { PATH: envDir } }).file, process.execPath, 'a node script needs no Git Bash');
  });

  await test('an env of only PATH takes what a Windows child needs from the parent; a given value wins', () => {
    const root = mkTmp('wk-run-');
    const ghDir = path.join(root, 'gh-cli');
    const exe = put(ghDir, 'gh.exe');
    const bare = onWin32('gh', [], { env: { PATH: ghDir } });
    for (const key of ['ComSpec', 'SystemRoot', 'PATHEXT', 'TEMP', 'TMP']) {
      assertEq(JSON.stringify(valuesOf(bare.options.env, key)), JSON.stringify([WIN_PARENT[key]]), `${key} from the parent`);
    }
    assertEq(JSON.stringify(valuesOf(bare.options.env, 'PATH')), JSON.stringify([ghDir]), 'the given PATH kept');

    const given = onWin32('gh', [], { env: { PATH: ghDir, comspec: 'D:\\mine\\cmd.exe' } });
    assertEq(JSON.stringify(valuesOf(given.options.env, 'ComSpec')), JSON.stringify(['D:\\mine\\cmd.exe']),
      'the given ComSpec, matched without case, wins');

    const fromParent = onWin32('gh', [], { env: { FOO: '1' } }, { ...WIN_PARENT, Path: ghDir });
    assertEq(fromParent.file, exe, "with no PATH given, the parent's Path is searched");
  });

  await test('a name given in two cases is read as Node hands it the child: the first in sorted order', () => {
    const root = mkTmp('wk-run-');
    const lower = path.join(root, 'lower');
    put(lower, 'gh.exe');
    const upper = path.join(root, 'upper');
    const exe = put(upper, 'gh.exe');
    assertEq(onWin32('gh', [], { env: { Path: lower, PATH: upper } }).file, exe, 'PATH sorts before Path');
    assertEq(onWin32('gh', [], { env: { FOO: '1' } }, { ...WIN_PARENT, Path: lower, PATH: upper }).file, exe,
      "the parent's PATH the same way");
    const tool = path.join(root, 'tool');
    put(tool, 'tool.cmd');
    const batch = onWin32('tool', [], { env: { PATH: tool, comspec: 'D:\\b\\cmd.exe', ComSpec: 'D:\\a\\cmd.exe' } });
    assertEq(batch.file, 'D:\\a\\cmd.exe', 'ComSpec sorts before comspec');
  });

  await test('a .cmd line escapes every cmd.exe metacharacter, so no argument ends early or chains a command', () => {
    const root = mkTmp('wk-run-');
    const cmd = put(root, 'tool.cmd');
    const line = onWin32('tool', ['a"b & calc'], { env: { PATH: root } }).args[3];
    assertEq(line, `"${cmd} ^"a\\^"b ^& calc^""`, 'quoted, then each metacharacter escaped');
    assert(!/[^^]"/.test(line.slice(1, -1)), `no unescaped quote inside the line, got: ${line}`);
  });

  await test("an npm cmd-shim's argument is escaped twice, since the shim's %* parses the line again", () => {
    const line = onWin32('C:\\p\\node_modules\\.bin\\tool.cmd', ['a"b & calc'], {}).args[3];
    assertEq(line, '"C:\\p\\node_modules\\.bin\\tool.cmd ^^^"a\\^^^"b ^^^& calc^^^""', 'each metacharacter carries a doubled caret escape');
  });

  await test('a .cmd in a folder with a space stays one command word: each space and metacharacter escaped, no quotes', () => {
    const line = onWin32('C:\\Program Files (x86)\\nodejs\\npm.cmd', ['a b'], {}).args[3];
    assertEq(line, '"C:\\Program^ Files^ ^(x86^)\\nodejs\\npm.cmd ^"a b^""', 'the command escaped, the argument quoted');
  });

  await test('argv0 is the quoted program unless the caller passes one', () => {
    const root = mkTmp('wk-run-');
    const exe = put(root, 'gh.exe');
    assertEq(onWin32('gh', [], { env: { PATH: root } }).options.argv0, `"${exe}"`, 'the program, quoted');
    assertEq(onWin32('gh', [], { env: { PATH: root }, argv0: 'gh' }).options.argv0, 'gh', "the caller's own");
  });

  await test('a name found on no PATH dir is left as given', () => {
    const root = mkTmp('wk-run-');
    put(path.join(root, 'gh-cli'), 'gh.exe');
    const launch = onWin32('no-such-tool', ['x'], { env: { PATH: path.join(root, 'gh-cli') } });
    assertEq(launch.file, 'no-such-tool', 'the start fails as it would have');
  });

  await test('a bare name PATH lacks is never read as a #! script in the current folder', () => {
    const root = mkTmp('wk-run-');
    put(root, 'no-such-tool', NODE_SCRIPT);
    const was = process.cwd();
    process.chdir(root);
    try {
      const launch = onWin32('no-such-tool', ['x'], { env: { PATH: path.join(root, 'empty') } });
      assertEq(launch.file, 'no-such-tool', 'the bare name, so the start fails as it would have');
      assertEq(JSON.stringify(launch.args), JSON.stringify(['"x"']), 'its arguments alone');
    } finally {
      process.chdir(was);
    }
  });

  await test('an absolute path to an extensionless #! file runs through Git Bash', () => {
    const root = mkTmp('wk-run-');
    const script = put(path.join(root, 'kit', 'bin'), 'workkit', SH_SCRIPT);
    const { dir, bash } = gitBash(root);
    const launch = onWin32(script, ['test'], { env: { PATH: dir } });
    assertEq(launch.file, bash, 'Git Bash starts it');
    assertEq(JSON.stringify(launch.args), JSON.stringify([`"${script}"`, '"test"']), 'the script path first');
  });

  group('run.js: windowsQuoted');

  await test('a value comes back one quoted argument, its quotes and trailing backslashes escaped', () => {
    assertEq(windowsQuoted('labels[]=x'), '"labels[]=x"', 'brackets kept whole');
    assertEq(windowsQuoted('a"b'), '"a\\"b"', 'an inner quote escaped');
    assertEq(windowsQuoted('C:\\dir\\'), '"C:\\dir\\\\"', 'a trailing backslash doubled');
  });

  group('run.js: the three calls on a Windows launch with no Git Bash');

  await test('spawnSync answers a failed start, execFileSync throws it and spawn errors, each naming Git Bash', async () => {
    // Nothing starts: with no Git Bash on the child PATH, launchOf refuses before any start.
    const run = win32Run();
    const options = { env: { PATH: mkTmp('wk-run-') } };
    const res = run.spawnSync('bash', ['-c', 'true'], options);
    assert(res.error && /Git Bash not found/.test(res.error.message), `the refusal in error, got: ${res.error}`);
    assertEq(res.error.code, 'ENOENT', 'its code');
    for (const [key, want] of [['pid', 0], ['status', null], ['signal', null], ['output', null], ['stdout', undefined], ['stderr', undefined]]) {
      assertEq(res[key], want, `${key} as child_process answers a failed start`);
    }
    const thrown = thrownBy(() => run.execFileSync('bash', ['-c', 'true'], options));
    assert(thrown && /Git Bash not found/.test(thrown.message), `execFileSync throws, got: ${thrown}`);
    assertEq(thrown.code, 'ENOENT', 'the thrown code');
    assertEq(thrown.status, null, 'the result rides the error, as child_process puts it');
    const err = await new Promise((resolve) => run.spawn('bash', ['-c', 'true'], options).on('error', resolve));
    assert(/Git Bash not found/.test(err.message), `the child errors, got: ${err.message}`);
  });

  group('run.js: real starts on this machine');

  await test('the platform is read once at load: faking process.platform later changes no start', () => {
    // npm is a #! script beside a .cmd on Windows: the other platform's launch fails it.
    const options = { env: { PATH: joinPath(NODE_DIR, SYSTEM_PATH) }, encoding: 'utf8', timeout: SPAWN_DEADLINE };
    const real = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...real, value: IS_WINDOWS ? 'darwin' : 'win32' });
    let res;
    let out;
    try {
      res = spawnSync('npm', ['--version'], options);
      out = thrownBy(() => execFileSync('npm', ['--version'], options)) || 'ran';
    } finally {
      Object.defineProperty(process, 'platform', real);
    }
    assertEq(res.status, 0, `spawnSync took the load-time launch, error: ${res.error || ''} stderr: ${res.stderr}`);
    assertEq(String(out), 'ran', 'execFileSync took the load-time launch');
  });

  await test('an argument reaches node whole, never globbed', () => {
    // A file the glob would match, so a shell in the way would show.
    const dir = mkTmp('wk-run-');
    put(dir, 'aXb');
    const res = spawnSync('node', ['-e', 'console.log(process.argv[1])', 'a*b'], { cwd: dir, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    assertEq(res.status, 0, `node ran, error: ${res.error || ''} stderr: ${res.stderr}`);
    assertEq(res.stdout.trim(), 'a*b', 'the argument as given');
  });

  await test('npm starts from an env holding only PATH', () => {
    // npm's own folder and the system tools: no machine shim that needs more env.
    const res = spawnSync('npm', ['--version'], {
      env: { PATH: joinPath(NODE_DIR, SYSTEM_PATH) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    assertEq(res.status, 0, `npm answered, error: ${res.error || ''} stderr: ${res.stderr}`);
    assert(/^\d+\.\d+\.\d+/.test(res.stdout.trim()), `a version, got: ${JSON.stringify(res.stdout)}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
