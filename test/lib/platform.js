// The platform seams every suite spawns through: one home for what differs
// between the Mac and Windows (AGENTS.md § Tests). Every export is the identity
// on macOS and Linux; a dotfiles repo carries the same seam, name for name.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// The kit's one Node home for starting a program, which this seam re-exports.
const run = require('../../workflow/lib/run');
// That file by absolute path, for a snippet a child runs to start its own children.
const RUN_JS = require.resolve('../../workflow/lib/run');
const { SPAWN_DEADLINE, mkTmp } = require('./harness');

const IS_WINDOWS = process.platform === 'win32';
// Any checkout's shim folder, whatever spelling of its path a session put on PATH.
const isGitShimDir = (dir) => path.basename(dir) === 'gitshim' && path.basename(path.dirname(dir)) === 'workflow';

/** The first PATH entry holding every named file, or a loud failure. */
const findDir = (...names) => {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && names.every((n) => fs.existsSync(path.join(dir, n)))) return dir;
  }
  // Windows without Git Bash cannot run one suite in this repo; saying so
  // beats every spawn failing with an unexplained null status.
  throw new Error(`test/lib/platform: no directory on PATH holds ${names.join(' + ')}`);
};

// Git Bash keeps bash, sh and the POSIX toolset in one directory (/usr/bin,
// which /bin is a mount of), so that single dir is the Mac's `/usr/bin:/bin`.
// cygpath marks it: Git Bash alone ships one, and tmpMountRoot starts it there.
const SYSTEM_DIR = IS_WINDOWS ? findDir('bash.exe', 'cygpath.exe') : null;

/**
 * The system tools and nothing else: no Homebrew, no node manager, no stubs.
 * git joins from wherever the machine keeps it, its one directory, since the
 * suites' fixture repos and the kit's own steps run it.
 */
const systemPath = () => {
  const dirs = IS_WINDOWS ? [SYSTEM_DIR] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const entries = (process.env.PATH || '').split(path.delimiter);
  for (const tool of IS_WINDOWS ? ['git.exe'] : ['git']) {
    if (dirs.some((d) => fs.existsSync(path.join(d, tool)))) continue;
    const dir = entries.find((d) => d && !dirs.includes(d) && fs.existsSync(path.join(d, tool)));
    if (dir) dirs.push(dir);
  }
  return dirs.join(path.delimiter);
};
const SYSTEM_PATH = systemPath();

/** The node running this suite, which no system PATH holds on either machine. */
const NODE_DIR = path.dirname(process.execPath);

/**
 * Why a case about a file's mode cannot be answered on Windows, in one place:
 * a file there carries no executable bit to set, strip or read back.
 */
const NO_EXEC_BIT = 'Windows keeps no executable bit';

/** A PATH that resolves nothing, for the "the tool is missing" cases. */
const EMPTY_PATH = IS_WINDOWS ? path.join(SYSTEM_DIR, 'no-such-dir') : '/var/empty';

/**
 * The shell a suite spawns: absolute on Windows, where Node resolves a bare
 * program name against the child's PATH, which a case may have restricted.
 */
const BASH = IS_WINDOWS ? path.join(SYSTEM_DIR, 'bash.exe') : 'bash';
const SH = IS_WINDOWS ? path.join(SYSTEM_DIR, 'sh.exe') : '/bin/sh';

// The same shell for a case whose child PATH resolves nothing (EMPTY_PATH):
// the spawn itself searches that PATH, on either platform.
const SYSTEM_BASH = IS_WINDOWS ? BASH : '/bin/bash';

// The compiler every Windows ships, which the setup step builds npm's script
// shell with there; null elsewhere.
const WINDOWS_CSC = IS_WINDOWS
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  : null;

/**
 * Flags that keep a spawned shell's world the test's own: a bash started by
 * sshd reads ~/.bashrc even when not interactive, putting the machine's tools
 * ahead of every stub a case put on PATH. A no-op on the Mac.
 */
const NO_RC = ['--noprofile', '--norc'];

// Read at call time, not load time, so `asWindows` can drive the Windows
// branch from a Mac; the real-tool lookups keep the load-time answer.
const onWindows = () => process.platform === 'win32';

let tmpMount;

/**
 * The folder Git Bash mounts at `/tmp`, slashed, as Git Bash itself answers:
 * asked once per process, never guessed from TEMP. A Mac driving the Windows
 * branch has no mount unless the seam's cygpath is on PATH.
 * @returns {string|null}
 */
const tmpMountRoot = () => {
  if (tmpMount !== undefined) return tmpMount;
  const res = spawnSync(IS_WINDOWS ? path.join(SYSTEM_DIR, 'cygpath.exe') : 'cygpath', ['-w', '/tmp'],
    { encoding: 'utf8', timeout: SPAWN_DEADLINE });
  if (res.status !== 0 && IS_WINDOWS) {
    throw new Error(`test/lib/platform: cygpath -w /tmp failed: ${res.error || res.stderr}`);
  }
  tmpMount = res.status === 0 ? res.stdout.trim().replace(/\\/g, '/').replace(/\/$/, '') : null;
  return tmpMount;
};

/**
 * A native path as the shell under test sees it: `C:\Users\x` to `/c/Users/x`
 * under Git Bash, unchanged on macOS. A path under the folder Git Bash mounts at
 * `/tmp` reads as `/tmp/...`, compared without case as Git Bash does. Use it for
 * anything a shell script receives (argv, a JSON payload it reads, an env var it
 * manipulates) and for a raw value a shell function returns. A path a line
 * prints for a person is `nativePath`'s spelling: compare it through gitPath.
 * A path already in that spelling comes back as it came, so asking twice costs nothing.
 * @param {string} p
 * @returns {string}
 */
const shellPath = (p) => {
  if (!onWindows()) return p;
  const slashed = p.replace(/\\/g, '/');
  const root = /^[A-Za-z]:\//.test(slashed) ? tmpMountRoot() : null;
  const lower = slashed.toLowerCase();
  if (root && (lower === root.toLowerCase() || lower.startsWith(`${root.toLowerCase()}/`))) {
    return `/tmp${slashed.slice(root.length)}`;
  }
  return slashed.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
};

/**
 * A path as a JavaScript string literal with forward slashes, the one form a
 * `node -e` snippet carries across Git Bash, which halves a Windows path's
 * backslashes on the way to node. Node opens either slash on Windows.
 * @param {string} p
 * @returns {string}
 */
const jsPath = (p) => JSON.stringify(p.replace(/\\/g, '/'));

/**
 * A path as git prints it, and as `nativePath` (workflow/lib/platform.js) prints
 * one for a person: under Git for Windows a drive letter with forward slashes
 * (`C:/Users/x`). Anything keyed off `git rev-parse --show-toplevel`, and any
 * path a kit line prints, wears this form, so an assertion compares against it.
 * Unchanged on macOS.
 * @param {string} p
 * @returns {string}
 */
const gitPath = (p) => (onWindows() ? p.replace(/\\/g, '/') : p);

/**
 * The first executable named `name` on a PATH, in the native form Node needs to
 * link or copy it (`command -v` under Git Bash answers in POSIX, which Node
 * cannot open). Windows carries the `.exe`, so the answer keeps the basename it
 * was found under.
 * @param {string} name
 * @param {string} [searchPath] - the PATH to search, this process's own by default
 * @returns {string|null} absolute path, or null when nothing is on that PATH
 */
const which = (name, searchPath = process.env.PATH) => {
  const candidates = IS_WINDOWS ? [`${name}.exe`, name] : [name];
  for (const dir of (searchPath || '').split(path.delimiter)) {
    // A session puts the kit's git shim first on PATH. It is no real tool: a stub
    // that execs it on a PATH lacking the shim's folder is found again, forever.
    if (!dir || isGitShimDir(dir)) continue;
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
};

/**
 * A PATH entry's tool name, without the extension Windows gives it: the name a
 * case means when it says "the PATH without `jq`" or "this mirror holds `sh`".
 * @param {string} file
 * @returns {string}
 */
const toolStem = (file) => (IS_WINDOWS ? file.replace(/\.(exe|cmd|bat|com)$/i, '') : file);

/**
 * Whether a child's argv starts the program `name`, however argv[0] spells it:
 * a bare name, a path, or on Windows with its extension.
 * @param {string[]} argv
 * @param {string} name - without an extension
 * @returns {boolean}
 */
const runsProgram = (argv, name) => toolStem(path.basename(argv[0])) === name;

/**
 * Write a PATH stand-in named `name` that runs `source` as JavaScript under the
 * node running this suite, named on its `#!` line, or through sh when that
 * node's path holds a space. A shell finds it by bare name; a Node file finds it
 * through workflow/lib/run.js, whose `#!` rule starts it under node or Git Bash
 * on Windows.
 * @param {string} dir - the PATH directory, which must exist
 * @param {string} name - the tool being stood in for, with no extension
 * @param {string} source - the stand-in's JavaScript, no `#!` line
 * @returns {string} the script that was written
 */
const stubToolJs = (dir, name, source) => {
  const node = shellPath(process.execPath);
  // A `#!` line ends its program's path at the first space, so a node path with
  // one goes through sh: line 2 is `:` and an exec to sh, a string and a comment to node.
  const head = /\s/.test(node) ? `#!/bin/sh\n":" //; exec "${node}" "$0" "$@"` : `#!${node}`;
  const script = path.join(dir, name);
  fs.writeFileSync(script, `${head}\n${source}\n`, { mode: 0o755 });
  fs.chmodSync(script, 0o755);
  return script;
};

// The signals a hand-over stand-in passes on to the program it started.
const PASSED_ON = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * A stand-in's JavaScript, for stubToolJs, that hands every call to `file`: it
 * starts `file` through run.js with `lead` and then the call's own arguments,
 * the same three streams, passes a signal it gets on, and ends as the program
 * did, its exit code, or its signal raised on itself.
 * @param {string} file - the real program, by absolute path
 * @param {string[]} [lead] - arguments ahead of the call's own
 * @returns {string} the stand-in's source
 */
const handOverJs = (file, lead = []) => [
  `const child = require(${JSON.stringify(RUN_JS)}).spawn(${JSON.stringify(file)}, [...${JSON.stringify(lead)}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
  `const passedOn = ${JSON.stringify(PASSED_ON)};`,
  'for (const signal of passedOn) process.on(signal, () => child.kill(signal));',
  "child.on('error', (err) => { throw err; });",
  "child.on('exit', (code, signal) => {",
  '  if (signal === null) process.exit(code);',
  '  for (const name of passedOn) process.removeAllListeners(name);',
  '  process.kill(process.pid, signal);',
  '});',
].join('\n');

/**
 * The skip value of a case a file mode must refuse something in: Windows
 * ignores the mode, and so does root.
 * @param {string} what what the mode fails to stop, as "a read-only folder does not stop the write"
 * @returns {false|string} false, or the reason
 */
const skipWithoutModes = (what) => (IS_WINDOWS || process.getuid() === 0)
  && `${what} here (Windows ignores the mode, root ignores it)`;

/**
 * The skip value of a case that signals a process and reads what its handler did.
 * @returns {false|string} false, or on Windows the reason
 */
const skipWithoutCaughtSignal = () => IS_WINDOWS && 'Windows ends a process with no signal it can catch';

/**
 * The skip value of a case about the Homebrew folders a job puts on its PATH.
 * @returns {false|string} false, or on Windows the reason
 */
const skipWithoutHomebrewPath = () => IS_WINDOWS && 'a job puts the Homebrew folders on its PATH off Windows alone';

let fileLinkSkip;

/**
 * The skip value of a case that makes a file symlink, probed once per process:
 * Windows without developer mode refuses one, and a copy is not the case under test.
 * @returns {false|string} false, or the reason naming the refusal's code
 */
const skipWithoutFileLink = () => {
  if (fileLinkSkip !== undefined) return fileLinkSkip;
  const dir = mkTmp('wk-file-link-');
  fs.writeFileSync(path.join(dir, 'target'), '');
  try {
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'file');
    fileLinkSkip = false;
  } catch (err) {
    fileLinkSkip = `this machine refuses a file symlink (${err.code})`;
  }
  return fileLinkSkip;
};

/**
 * A `cygpath` on PATH answering the mixed form Git Bash answers with, so a suite
 * drives the engine's Windows branch (`OSTYPE=msys`) from a Mac: `/c/Users/x`
 * becomes `C:/Users/x`, any other path gets `C:` prefixed. `-u` strips a leading
 * drive (`C:/x` becomes `/x`), inverting the prefix. On Windows the real tool
 * answers and nothing is written.
 * @param {string} dir - the PATH directory, which must exist
 * @returns {string|null} the stub that was written, or null on Windows
 */
const cygpathStub = (dir) => (IS_WINDOWS ? null : stubToolJs(dir, 'cygpath', [
  'const argv = process.argv.slice(2);',
  "const p = argv[argv.length - 1] ?? '';",
  "const drive = /^\\/([a-zA-Z])\\//.exec(p);",
  "if (argv[0] === '-u') process.stdout.write(`${p.replace(/^[A-Za-z]:/, '')}\\n`);",
  'else if (drive) process.stdout.write(`${drive[1].toUpperCase()}:/${p.slice(3)}\\n`);',
  'else process.stdout.write(`C:${p}\\n`);',
].join('\n')));

/**
 * Make `real` reachable from `dir`: a symlink on macOS and Linux. On Windows a
 * program loads its libraries from beside itself, so an executable gets a
 * stand-in that hands over to it where it lives (handOverJs), and anything
 * else is hard linked or copied.
 * @param {string} dir - the mirror directory, which must exist
 * @param {string} real - the tool, by absolute path
 * @returns {string|null} what was created, or null when nothing could be
 */
const linkTool = (dir, real) => {
  if (IS_WINDOWS && /\.(exe|com)$/i.test(real)) {
    return stubToolJs(dir, path.basename(real).replace(/\.[^.]+$/, ''), handOverJs(real));
  }
  const dest = path.join(dir, path.basename(real));
  try {
    if (IS_WINDOWS) fs.linkSync(real, dest);
    else fs.symlinkSync(real, dest);
    return dest;
  } catch {
    try {
      fs.copyFileSync(real, dest);
      return dest;
    } catch {
      // A name that cannot be linked or copied (a broken entry, a directory, a
      // race) is simply absent, which is the state the caller is testing for.
      return null;
    }
  }
};

/** `dirs` ahead of this machine's own PATH. */
const pathWith = (...dirs) => [...dirs, process.env.PATH].join(path.delimiter);

/** `dirs` ahead of the system tools only: nothing else this machine installed. */
const systemPathWith = (...dirs) => [...dirs, SYSTEM_PATH].join(path.delimiter);

/** One PATH out of entries already in this platform's spelling. */
const joinPath = (...entries) => entries.filter(Boolean).join(path.delimiter);

/**
 * Spawn the test bash with `args` from Node, through run.js: on Windows it
 * quotes every argument and the program name and hands them over verbatim,
 * since the msys runtime parses and globs a command line a native parent hands it.
 * @param {string[]} args
 * @param {object} [options] - spawnSync's
 * @returns {object} spawnSync's result
 */
const spawnBash = (args, options = {}) => run.spawnSync(BASH, args, options);

/**
 * spawnBash for SYSTEM_BASH: the start a case needs when its child PATH
 * resolves nothing (EMPTY_PATH), since the spawn searches that PATH too.
 * @param {string[]} args
 * @param {object} [options] - spawnSync's
 * @returns {object} spawnSync's result
 */
const spawnSystemBash = (args, options = {}) => run.spawnSync(SYSTEM_BASH, args, options);

/**
 * Whether two spellings name one path. On `win32` a Git Bash drive mount
 * (`/d/x`) reads as `D:/x`, `\` folds to `/` and case is ignored; elsewhere the
 * strings are compared as they are.
 * @param {string} a
 * @param {string} b
 * @param {string} platform - a `process.platform` value
 * @returns {boolean}
 */
const samePath = (a, b, platform) => {
  if (platform !== 'win32') return a === b;
  const folded = (p) => p.replace(/\\/g, '/').replace(/^\/([A-Za-z])(?=\/|$)/, '$1:').toLowerCase();
  return folded(a) === folded(b);
};

/**
 * A spawn env whose world is the scratch home `home`, in every spelling a tool
 * reads a home by: HOME in the shell's spelling, USERPROFILE (Node's homedir on
 * Windows) and GH_CONFIG_DIR (which gh reads first everywhere) native. Both
 * token names are blanked; a case that means to hand its stub a token sets it
 * after this call. Node's compile cache is off: npm turns it on in the temp
 * dir, which on Windows is the suite's own (libuv hands every child the
 * parent's TEMP), so a world that reaches npm would leave it behind.
 * @param {string} home - the scratch home, by absolute path
 * @param {object} [env] - the rest of the child's env; the home keys win over it
 * @returns {object} the env to spawn with
 */
const homeEnv = (home, env = {}) => ({
  ...env,
  HOME: shellPath(home),
  USERPROFILE: home,
  GH_CONFIG_DIR: path.join(home, '.config', 'gh'),
  GH_TOKEN: '',
  GITHUB_TOKEN: '',
  NODE_DISABLE_COMPILE_CACHE: '1',
});

/**
 * homeEnv's env for a node a case starts, which reads HOME as a native path:
 * the same keys, HOME native in place of the shell's spelling.
 * @param {string} home - the scratch home, by absolute path
 * @param {object} [env] - the rest of the child's env; the home keys win over it
 * @returns {object} the env to spawn with
 */
const nodeHomeEnv = (home, env = {}) => ({ ...homeEnv(home, env), HOME: home });

/**
 * The env for a node a case starts whose temp folder is `dir`: TMPDIR, which
 * Node reads on macOS and Linux, and TEMP and TMP, which it reads on Windows,
 * each native. Never for a world whose Git Bash or shellDirOf reads a `/tmp/...`
 * path: Git Bash mounts `/tmp` on TMP or TEMP, so the move would move those too.
 * A world using it has a native HOME (nodeHomeEnv) and spells bash paths by gitPath.
 * @param {string} dir - the temp folder, by absolute path
 * @param {object} [env] - the rest of the child's env; the temp keys win over it
 * @returns {object} the env to spawn with
 */
const nodeTempEnv = (dir, env = {}) => ({
  ...env, TMPDIR: dir, TEMP: dir, TMP: dir,
});

/**
 * Git's own bin folder, two up from SYSTEM_DIR: bash.exe, sh.exe and git.exe
 * alone, none of usr\bin's tools. A Windows run without it there is broken.
 * @returns {string}
 */
const gitBinDir = () => {
  const dir = path.join(SYSTEM_DIR, '..', '..', 'bin');
  if (!fs.existsSync(path.join(dir, 'bash.exe'))) throw new Error(`test/lib/platform: no bash.exe in ${dir}, Git's own bin`);
  return dir;
};

/**
 * The one mirror walk of a narrowed PATH: every entry of `dirs` linked into
 * `out` (linkTool), first name wins like a PATH lookup, each of `excluded` left
 * out under every spelling. A stand-in is no Git Bash to run.js, so on Windows
 * Git's own bin goes last: a bare `bash` starts, and the mirror still wins by name.
 * It throws unless `sh` is reachable (an empty mirror would pass an absence case
 * for the wrong reason) and every excluded tool is gone.
 * @param {string} out - the mirror folder, which must exist
 * @param {string[]} dirs - the folders to mirror, in PATH order
 * @param {string[]} excluded - the tools to leave out, without an extension
 * @returns {string} the PATH: the mirror, then on Windows Git's own bin
 */
const mirrorPathWithout = (out, dirs, excluded) => {
  const seen = new Set();
  for (const entry of dirs) {
    let names = [];
    try { names = fs.readdirSync(entry); } catch { continue; }
    for (const name of names) {
      const tool = toolStem(name);
      if (excluded.includes(tool) || seen.has(tool)) continue;
      seen.add(tool);
      linkTool(out, path.join(entry, name));
    }
  }
  const searchPath = IS_WINDOWS ? joinPath(out, gitBinDir()) : out;
  if (!which('sh', out)) throw new Error(`mirrorPathWithout built an unusable PATH at ${out}`);
  for (const command of excluded) {
    const left = which(command, searchPath);
    if (left) throw new Error(`mirrorPathWithout left ${command} reachable at ${left}`);
  }
  return searchPath;
};

/**
 * The mirror folder of a PATH mirrorPathWithout answered, its first entry: for
 * a case that reads or changes the mirror itself, or removes it.
 * @param {string} searchPath - mirrorPathWithout's or basePathWithout's answer
 * @returns {string}
 */
const mirrorDirOf = (searchPath) => searchPath.split(path.delimiter)[0];

/**
 * A mirror of the system PATH with one command left out: the machine without
 * `gh`, built rather than assumed, since many ship it in /usr/bin. It holds the
 * system directories plus wherever this machine keeps gh, git and node
 * (mirrorPathWithout's walk and checks).
 * @param {string} dir - where to build the mirror, which must exist
 * @param {string} command - the tool to leave out, without an extension
 * @returns {string} the PATH: the mirror directory, then on Windows Git's own bin
 */
const basePathWithout = (dir, command) => {
  const out = path.join(dir, `path-without-${command}`);
  fs.mkdirSync(out, { recursive: true });
  const dirs = SYSTEM_PATH.split(path.delimiter);
  // node's folder before gh's: a gh found in a shim folder (where the kit's own
  // gh goes) must not outrank the real npm beside node with its own npm shim.
  for (const tool of ['git', 'node', 'gh']) {
    const real = which(tool);
    if (real) dirs.push(path.dirname(real));
  }
  return mirrorPathWithout(out, dirs, [command]);
};

/**
 * Run `fn` as if this machine were Windows. Only code that reads
 * `process.platform` at call time takes the other branch: a module's
 * `require('path')` stays bound to posix. On Windows nothing changes.
 * @param {Function} fn
 * @returns {*} whatever `fn` returned
 */
const asWindows = (fn) => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...real, value: 'win32' });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', real);
  }
};

/**
 * spawnSync's result for a program that cannot start (`how` null: ENOENT) or
 * hangs (`how` 'hang': ended at the call's `timeout`, ETIMEDOUT), as
 * child_process gives it. A hang with no timeout throws: it would never return.
 * @param {string} file
 * @param {null|'hang'} how
 * @param {object} options - the call's spawnSync options
 * @returns {object}
 */
const failedRun = (file, how, options) => {
  if (how === 'hang') {
    if (!(options.timeout > 0)) throw new Error(`test/lib/platform: ${file} hangs, and with no timeout it never returns`);
    const error = Object.assign(new Error(`spawnSync ${file} ETIMEDOUT`), { code: 'ETIMEDOUT', errno: -60, syscall: `spawnSync ${file}`, path: file });
    return { pid: 1, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error };
  }
  const error = Object.assign(new Error(`spawnSync ${file} ENOENT`), { code: 'ENOENT', errno: -2, syscall: `spawnSync ${file}`, path: file });
  return { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error };
};

/** spawnSync's result for a program that ran and exited `status`. */
const ranRun = (status, stdout = '', stderr = '') => ({ pid: 1, output: [null, stdout, stderr], stdout, stderr, status, signal: null });

/**
 * A `run` seam in spawnSync's call form and result that starts nothing: it
 * records each program, its arguments and its options, and the program exits
 * with `status`, or cannot start or hangs as `failedRun` says for null or 'hang'.
 * @param {number|null|'hang'} [status]
 * @returns {{ run: Function, calls: { file: string, args: string[], options: object }[] }}
 */
const recordingRun = (status = 0) => {
  const calls = [];
  const recorded = (file, args, options = {}) => {
    calls.push({ file, args: (args || []).map(String), options });
    return typeof status === 'number' ? ranRun(status) : failedRun(file, status, options);
  };
  return { run: recorded, calls };
};

/** process.kill's error for a pid no process holds. */
const noSuchProcess = () => Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', errno: -3, syscall: 'kill' });

/**
 * Run `fn` with `process.kill` replaced by `kill`, the real one restored after.
 * @param {Function} kill
 * @param {Function} fn
 * @returns {Promise<*>} whatever `fn` resolved to
 */
const withKill = async (kill, fn) => {
  const real = process.kill;
  process.kill = kill;
  try {
    return await fn();
  } finally {
    process.kill = real;
  }
};

// The header Git Bash's `ps -el` prints above its rows.
const PS_HEADER = '      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND';

/**
 * A Windows machine's process tables for a tree end's Windows arm, on any machine.
 * A process is `{ pid, ppid, created, ps }`, `ps` its raw `ps -el` row. `run`
 * answers `powershell.exe` with the JSON array, `bash` with `ps -el`'s text;
 * `answers.powershell` or `.ps` replaces one (null, 'hang', `{ status, stdout,
 * stderr }`). `during(fn)` makes `process.kill` the world's: a signal is recorded,
 * takes the process out (after `lingers` signal-0 asks it answers alive), calls
 * `onSignal(pid, world)`; `refuse: <code>` throws it, the process gone. Signal 0
 * answers from the world. `onRead(n, world)` runs before the n-th PowerShell read.
 * @param {{ onSignal?: Function, onRead?: Function, answers?: object }} [options]
 * @returns {{ run: Function, calls: object[], signals: object[], add: Function, during: Function }}
 */
const windowsTables = (processes, { onSignal = () => {}, onRead = () => {}, answers = {} } = {}) => {
  let live = processes.map((p) => ({ ...p }));
  let reads = 0;
  const calls = [];
  const signals = [];
  const answer = (file, override, options, table) => {
    if (override === undefined) return ranRun(0, table());
    if (override === null || override === 'hang') return failedRun(file, override, options);
    return ranRun(override.status, override.stdout || '', override.stderr || '');
  };
  const powershell = () => {
    reads += 1;
    onRead(reads, world);
    return `${JSON.stringify(live.map(({ pid, ppid, created }) => ({ pid, ppid, created })))}\r\n`;
  };
  // A signalled process answers alive to `asks` more signal-0 asks, then it is gone.
  const ask = (pid) => {
    const held = live.filter((p) => p.pid === pid);
    live = live.filter((p) => !held.includes(p) || p.asks !== 0);
    for (const p of held) if (p.asks > 0) p.asks -= 1;
    if (!live.some((p) => p.pid === pid)) throw noSuchProcess();
    return true;
  };
  const ps = () => [PS_HEADER, ...live.filter((p) => p.ps).map((p) => p.ps), ''].join('\n');
  const run = (file, args, options = {}) => {
    calls.push({ file, args: (args || []).map(String), options });
    const stem = String(file).split(/[\\/]/).pop().toLowerCase();
    if (stem === 'powershell.exe') return answer(file, answers.powershell, options, powershell);
    if (stem === 'bash' || stem === 'bash.exe') return answer(file, answers.ps, options, ps);
    throw new Error(`test/lib/platform: windowsTables has no answer for ${file} ${JSON.stringify(args)}`);
  };
  const kill = (pid, signal) => {
    if (signal === 0) return ask(pid);
    const target = live.find((p) => p.pid === pid && p.asks === undefined);
    signals.push({ pid, signal });
    if (!target) throw noSuchProcess();
    if (target.refuse) {
      live = live.filter((p) => p !== target);
      throw Object.assign(new Error(`kill ${target.refuse}`), { code: target.refuse, syscall: 'kill' });
    }
    if (target.lingers > 0) target.asks = target.lingers;
    else live = live.filter((p) => p !== target);
    onSignal(pid, world);
    return true;
  };
  const world = {
    run,
    calls,
    signals,
    add: (...more) => { live.push(...more.map((p) => ({ ...p }))); },
    during: (fn) => withKill(kill, fn),
  };
  return world;
};

/**
 * Run `fn` with `process.kill` answering every pid as gone (ESRCH), restored
 * after, so a Windows arm answered off Windows signals no process here.
 * @param {Function} fn
 * @returns {Promise<*>} whatever `fn` resolved to
 */
const signalsRefused = (fn) => withKill(() => { throw noSuchProcess(); }, fn);

module.exports = {
  IS_WINDOWS, BASH, SH, SYSTEM_PATH, NODE_DIR, NO_RC, EMPTY_PATH, WINDOWS_CSC, RUN_JS,
  shellPath, jsPath, gitPath, which, spawnBash, spawnSystemBash, toolStem, runsProgram, linkTool, stubToolJs, handOverJs,
  cygpathStub, pathWith, systemPathWith, joinPath, homeEnv, nodeHomeEnv, nodeTempEnv, mirrorPathWithout, mirrorDirOf, basePathWithout,
  NO_EXEC_BIT, skipWithoutModes, skipWithoutFileLink, skipWithoutCaughtSignal, skipWithoutHomebrewPath, asWindows, samePath, recordingRun, signalsRefused,
  windowsTables, PS_HEADER,
  // run.js's own three, so a suite starts its children where the kit does.
  spawnSync: run.spawnSync,
  spawn: run.spawn,
  execFileSync: run.execFileSync,
};
