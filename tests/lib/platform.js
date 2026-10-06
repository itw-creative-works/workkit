// The platform seams every suite spawns through: one home for what differs
// between the Mac and Windows (AGENTS.md § Tests). Every export is the identity
// on macOS and Linux; a dotfiles repo carries the same seam, name for name.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';

/** The first PATH entry holding every named file, or a loud failure. */
const findDir = (...names) => {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && names.every((n) => fs.existsSync(path.join(dir, n)))) return dir;
  }
  // Windows without Git Bash cannot run one suite in this repo; saying so
  // beats every spawn failing with an unexplained null status.
  throw new Error(`tests/lib/platform: no directory on PATH holds ${names.join(' + ')}`);
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
    { encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0 && IS_WINDOWS) {
    throw new Error(`tests/lib/platform: cygpath -w /tmp failed: ${res.error || res.stderr}`);
  }
  tmpMount = res.status === 0 ? res.stdout.trim().replace(/\\/g, '/').replace(/\/$/, '') : null;
  return tmpMount;
};

/**
 * A native path as the shell under test sees it: `C:\Users\x` to `/c/Users/x`
 * under Git Bash, unchanged on macOS. A path under the folder Git Bash mounts at
 * `/tmp` reads as `/tmp/...`, compared without case as Git Bash does. Use it for
 * anything a shell script receives (argv, a JSON payload it reads, an env var it
 * manipulates) and for anything compared against what a shell printed. A path
 * already in that spelling comes back as it came, so asking twice costs nothing.
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
 * A path as git prints it: under Git for Windows a drive letter with forward
 * slashes (`C:/Users/x`), which is neither the native spelling nor the POSIX
 * one. Anything keyed off `git rev-parse --show-toplevel` wears this form, so
 * an assertion about such a key compares against it. Unchanged on macOS.
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
    if (!dir) continue;
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
 * Write a PATH stub named `name` that runs `lines` as bash. A shell finds it on
 * both platforms; Node on Windows does not (libuv appends only `.com` and `.exe`
 * to a bare name), so a case stubbing a tool the program under test spawns
 * directly names its skip there, and `homeEnv` keeps the real tool harmless.
 * @param {string} dir - the PATH directory, which must exist
 * @param {string} name - the tool being stubbed, with no extension
 * @param {string[]} lines - the stub's bash source, shebang included
 * @returns {string} the script that was written
 */
const stubTool = (dir, name, lines) => {
  const script = path.join(dir, name);
  fs.writeFileSync(script, `${lines.join('\n')}\n`, { mode: 0o755 });
  return script;
};

/** The skip reason for the stubTool rule above, stated once. */
const NO_NODE_STUB = 'no stub is startable by name from Node on Windows';

/**
 * A `jq` on PATH that writes CRLF the way the Windows build does, handing back
 * jq's own exit status. On Windows the real tool is the stub (translating again
 * would write `\r\r\n`). `singleValueClean` models Windows bash stripping a
 * trailing CRLF in a command substitution: a one-line answer comes back clean,
 * every line of a multi-line answer keeps its carriage return. A piped one-line
 * read keeps its `\r` on Windows, so a case about one asks with the option off.
 * @param {string} dir - the PATH directory, which must exist
 * @param {object} [options] - `singleValueClean`, the bash half modelled above
 * @returns {string|null} the stub that was written, or null with no jq to wrap
 */
const crlfJq = (dir, { singleValueClean = false } = {}) => {
  const real = which('jq');
  if (!real) return null;
  const translate = singleValueClean
    ? "perl -0777 -pe 's/\\r?\\n/\\r\\n/g unless tr/\\n// <= 1'"
    : "perl -pe 's/\\n/\\r\\n/'";
  const body = IS_WINDOWS
    ? [`exec "${shellPath(real)}" "$@"`]
    : [`"${shellPath(real)}" "$@" | ${translate}`, 'exit "${PIPESTATUS[0]}"'];
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
 * that runs it where it lives and anything else is hard linked or copied.
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
  for (const tool of ['jq', 'gh', 'git', 'node']) {
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

module.exports = {
  IS_WINDOWS, BASH, SH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, EMPTY_PATH, WINDOWS_CSC,
  shellPath, gitPath, which, digestTool, toolStem, linkTool, stubTool, crlfJq,
  cygpathStub, pathWith, systemPathWith, joinPath, homeEnv, basePathWithout,
  NO_EXEC_BIT, NO_NODE_STUB, asWindows,
};
