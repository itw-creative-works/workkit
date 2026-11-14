// The platform seams every suite spawns through: one home for what differs
// between the Mac and Windows (AGENTS.md § Tests). Every export is the identity
// on macOS and Linux; a dotfiles repo carries the same seam, name for name.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
// The kit's one Node home for starting a program, which this seam re-exports.
const run = require('../../workflow/lib/run');
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
const SYSTEM_DIR = IS_WINDOWS ? findDir('bash.exe', 'sed.exe') : null;

/**
 * The system tools and nothing else: no Homebrew, no node manager, no stubs.
 * jq and git join from wherever the machine keeps them, one directory each,
 * since every hook reads through jq and a run without it fails open.
 */
const systemPath = () => {
  const dirs = IS_WINDOWS ? [SYSTEM_DIR] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const entries = (process.env.PATH || '').split(path.delimiter);
  for (const tool of IS_WINDOWS ? ['git.exe', 'jq.exe'] : ['git', 'jq']) {
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
 * manipulates) and for a raw value a shell function returns. A path a shell line
 * prints for a person is `wk_native_path`'s spelling: compare it through gitPath.
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
 * A path as git prints it, and as `wk_native_path` prints one for a person:
 * under Git for Windows a drive letter with forward slashes (`C:/Users/x`).
 * Anything keyed off `git rev-parse --show-toplevel`, and any path a kit shell
 * line prints, wears this form, so an assertion about it compares against it.
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
 * The digest tool this machine spells sha1 with: macOS ships `shasum`, a Linux
 * machine and Git Bash ship `sha1sum`, and `hook_sha1` takes either. Every
 * suite that names a marker path keys it through this one answer, or it would
 * only ever pass on half the platforms the kit runs on.
 * @param {string} [searchPath] - the PATH to search, this process's own by default
 * @returns {string|null} absolute path, or null on a machine carrying neither
 */
const digestTool = (searchPath = process.env.PATH) => ['shasum', 'sha1sum']
  .map((name) => which(name, searchPath))
  .find(Boolean) || null;

/**
 * A PATH entry's tool name, without the extension Windows gives it: the name a
 * case means when it says "the PATH without `jq`" or "this mirror holds `sh`".
 * @param {string} file
 * @returns {string}
 */
const toolStem = (file) => (IS_WINDOWS ? file.replace(/\.(exe|cmd|bat|com)$/i, '') : file);

/**
 * Compile the stub launcher's filled `source` into `exe`: a build beside it,
 * hard linked into place, so a parallel suite never runs a half-written file. A
 * build that fails throws with csc's output, never reading as no compiler.
 * @param {string} source - stub-launcher.cs with its bash filled in
 * @param {string} exe - the cache path, keyed by the source's digest
 */
const buildLauncher = (source, exe) => {
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const stem = exe.replace(/\.exe$/, `.${process.pid}`);
  const src = `${stem}.cs`;
  const tmp = `${stem}.tmp.exe`;
  try {
    fs.writeFileSync(src, source);
    const res = spawnSync(WINDOWS_CSC, ['-nologo', '-optimize', '-target:exe', `-out:${tmp}`, src],
      { encoding: 'utf8', timeout: SPAWN_DEADLINE });
    if (res.status !== 0) {
      throw new Error(`test/lib/platform: csc could not build the stub launcher: ${res.error || ''}${res.stderr}${res.stdout}`);
    }
    try {
      fs.linkSync(tmp, exe);
    } catch (e) {
      // EEXIST: another suite's build of the same digest took the cache first,
      // and it is the same launcher.
      if (e.code !== 'EEXIST') throw e;
    }
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(tmp, { force: true });
  }
};

let launcher;

/**
 * The `.exe` that starts the bash script of its own name beside it, built once
 * per machine from stub-launcher.cs under the OS temp folder. Read at call time.
 * @returns {string|null} its path on Windows with the compiler, else null
 */
const stubLauncher = () => {
  if (launcher) return launcher;
  if (!onWindows() || !WINDOWS_CSC || !fs.existsSync(WINDOWS_CSC)) return null;
  const source = fs.readFileSync(path.join(__dirname, 'stub-launcher.cs'), 'utf8').replace('{{BASH}}', () => BASH);
  const digest = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  const exe = path.join(os.tmpdir(), 'workkit-stub-launcher', `${digest}.exe`);
  if (!fs.existsSync(exe)) buildLauncher(source, exe);
  launcher = exe;
  return exe;
};

/**
 * Write a PATH stub named `name` that runs `lines` as bash. A shell finds it on
 * both platforms. Node on Windows does not find the script alone (libuv appends
 * only `.com` and `.exe` to a bare name), so there it also gets the launcher as
 * `<name>.exe` where the compiler exists. The cases written before the launcher
 * still skip on every Windows (`NO_NODE_STUB`) until each is run there once, and
 * `homeEnv` keeps the real tool harmless.
 * @param {string} dir - the PATH directory, which must exist
 * @param {string} name - the tool being stubbed, with no extension
 * @param {string[]} lines - the stub's bash source, shebang included
 * @returns {string} the script that was written
 */
const stubTool = (dir, name, lines) => {
  const script = path.join(dir, name);
  fs.writeFileSync(script, `${lines.join('\n')}\n`, { mode: 0o755 });
  const exe = stubLauncher();
  if (exe) fs.copyFileSync(exe, `${script}.exe`);
  return script;
};

/** The skip reason for the stubTool rule above, stated once. */
const NO_NODE_STUB = 'this case still skips on Windows: its stub predates the launcher';

/**
 * The skip value of a case or suite resting on a stub Node finds by name.
 * @returns {false|string} false, or on Windows NO_NODE_STUB
 */
const skipWithoutNodeStub = () => IS_WINDOWS && NO_NODE_STUB;

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
 * A `node` stub at `<dir>/node` answering `--version` (and `-v`) with
 * `v<version>` and failing every other call, as a node too old to load the
 * kit's ES modules would: the node a version pick has to pass over.
 * @param {string} dir - the folder, made when missing
 * @param {string} version - e.g. '20.15.1'
 * @returns {string} the stub that was written
 */
const stubNode = (dir, version) => {
  fs.mkdirSync(dir, { recursive: true });
  return stubTool(dir, 'node', [
    '#!/bin/bash',
    `case "$1" in --version|-v) echo v${version}; exit 0 ;; esac`,
    `echo "node v${version}: not this one" >&2`,
    'exit 1',
  ]);
};

/**
 * A `jq` on PATH that writes CRLF the way the Windows build does, handing back
 * jq's own exit status; like that build, `-b` (`--binary`, or a short cluster
 * holding `b`) makes it write LF. On Windows the real tool is the stub
 * (translating again would write `\r\r\n`). Every line keeps its `\r`, a
 * one-line answer included, so a call missing `-b` reads one.
 * @param {string} dir - the PATH directory, which must exist
 * @returns {string|null} the stub that was written, or null with no jq to wrap
 */
const crlfJq = (dir) => {
  const real = which('jq');
  if (!real) return null;
  const jq = `"${shellPath(real)}" "$@"`;
  const body = IS_WINDOWS
    ? [`exec ${jq}`]
    : [
      `for a in "$@"; do case $a in --binary) exec ${jq};; --*) ;; -*b*) exec ${jq};; esac; done`,
      `${jq} | perl -pe 's/\\n/\\r\\n/'`,
      'exit "${PIPESTATUS[0]}"',
    ];
  return stubTool(dir, 'jq', ['#!/bin/bash', ...body]);
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
const cygpathStub = (dir) => (IS_WINDOWS ? null : stubTool(dir, 'cygpath', [
  '#!/bin/bash',
  'p="${@: -1}"',
  'if [[ "$1" == -u ]]; then printf "%s\\n" "${p#[A-Za-z]:}"; exit 0; fi',
  'case "$p" in',
  '  /[a-zA-Z]/*) printf "%s:/%s\\n" "$(printf "%s" "${p:1:1}" | tr "a-z" "A-Z")" "${p:3}" ;;',
  '  *) printf "C:%s\\n" "$p" ;;',
  'esac',
]));

/**
 * Make `real` reachable from `dir`: a symlink on macOS and Linux. On Windows a
 * program loads its libraries from beside itself, so an executable gets a shim
 * that runs it where it lives (its launcher with it, as `stubTool` writes one)
 * and anything else is hard linked or copied.
 * @param {string} dir - the mirror directory, which must exist
 * @param {string} real - the tool, by absolute path
 * @returns {string|null} what was created, or null when nothing could be
 */
const linkTool = (dir, real) => {
  if (IS_WINDOWS && /\.(exe|com)$/i.test(real)) {
    return stubTool(dir, path.basename(real).replace(/\.[^.]+$/, ''),
      ['#!/bin/bash', `exec "${shellPath(real)}" "$@"`]);
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
 * A mirror of the system PATH with one command left out: the machine without
 * `gh`, built rather than assumed, since many ship it in /usr/bin. It holds the
 * system directories plus wherever this machine keeps jq, gh, git and node,
 * first-wins like a PATH lookup. It throws unless `sh` is reachable (an empty
 * mirror would pass an absence case for the wrong reason) and `command` is gone.
 * @param {string} dir - where to build the mirror, which must exist
 * @param {string} command - the tool to leave out, without an extension
 * @returns {string} the mirror directory, a PATH entry of one
 */
const basePathWithout = (dir, command) => {
  const out = path.join(dir, `path-without-${command}`);
  fs.mkdirSync(out, { recursive: true });
  const dirs = SYSTEM_PATH.split(path.delimiter);
  // node's folder before gh's: a gh found in a shim folder (where the kit's own
  // gh goes) must not outrank the real npm beside node with its own npm shim.
  for (const tool of ['jq', 'git', 'node', 'gh']) {
    const real = which(tool);
    if (real) dirs.push(path.dirname(real));
  }
  const seen = new Set();
  for (const entry of dirs) {
    let names = [];
    try { names = fs.readdirSync(entry); } catch { continue; }
    for (const name of names) {
      // The tool a name is carries no extension, so the excluded one is missing
      // under every spelling of itself.
      const tool = toolStem(name);
      if (tool === command || seen.has(tool)) continue;
      seen.add(tool);
      linkTool(out, path.join(entry, name));
    }
  }
  if (!which('sh', out)) throw new Error(`basePathWithout built an unusable PATH at ${out}`);
  const left = which(command, out);
  if (left) throw new Error(`basePathWithout left ${command} reachable at ${left}`);
  return out;
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
 * A `run` seam in spawnSync's call form and result that starts nothing: it
 * records each program, its arguments and its options, and the program exits
 * with `status`, cannot start (ENOENT, child_process's own result) when `status`
 * is null, or hangs when it is 'hang': ended at the call's `timeout` (ETIMEDOUT,
 * spawnSync's result), and with no timeout a throw, since it would never return.
 * @param {number|null|'hang'} [status]
 * @returns {{ run: Function, calls: { file: string, args: string[], options: object }[] }}
 */
const recordingRun = (status = 0) => {
  const calls = [];
  const recorded = (file, args, options = {}) => {
    calls.push({ file, args: (args || []).map(String), options });
    if (status === 'hang') {
      if (!(options.timeout > 0)) throw new Error(`recordingRun: ${file} hangs, and with no timeout it never returns`);
      const error = Object.assign(new Error(`spawnSync ${file} ETIMEDOUT`), { code: 'ETIMEDOUT', errno: -60, syscall: `spawnSync ${file}`, path: file });
      return { pid: 1, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: 'SIGTERM', error };
    }
    if (status !== null) return { pid: 1, output: [null, '', ''], stdout: '', stderr: '', status, signal: null };
    const error = Object.assign(new Error(`spawnSync ${file} ENOENT`), { code: 'ENOENT', errno: -2, syscall: `spawnSync ${file}`, path: file });
    return { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error };
  };
  return { run: recorded, calls };
};

/**
 * Run `fn` with `process.kill` answering every pid as gone (ESRCH), restored
 * after, so a Windows arm answered off Windows signals no process here.
 * @param {Function} fn
 * @returns {Promise<*>} whatever `fn` resolved to
 */
const signalsRefused = async (fn) => {
  const real = process.kill;
  process.kill = () => { throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', errno: -3, syscall: 'kill' }); };
  try {
    return await fn();
  } finally {
    process.kill = real;
  }
};

module.exports = {
  IS_WINDOWS, BASH, SH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, EMPTY_PATH, WINDOWS_CSC,
  shellPath, jsPath, gitPath, which, spawnBash, digestTool, toolStem, linkTool, stubTool, stubNode, crlfJq,
  cygpathStub, pathWith, systemPathWith, joinPath, homeEnv, basePathWithout,
  NO_EXEC_BIT, NO_NODE_STUB, skipWithoutNodeStub, skipWithoutFileLink, asWindows, samePath, recordingRun, signalsRefused,
  // run.js's own three, so a suite starts its children where the kit does.
  spawnSync: run.spawnSync,
  spawn: run.spawn,
  execFileSync: run.execFileSync,
};
