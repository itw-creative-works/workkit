//
// The platform seams every suite spawns through: one home for what differs
// between the Mac and Windows (issue #247).
//
// A suite runs the SAME assertions on both machines; what differs is how a
// program is found, what world it starts in, and how a path is spelled:
//
//   1. Node on Windows resolves a program name against the CHILD's PATH, so a
//      case that hands the child a restricted PATH (`/var/empty`, a stub dir
//      plus the system tools) cannot also name its shell by bare `bash`: the
//      spawn fails with status null and the case reports a lie. BASH and SH are
//      absolute there, exactly as `/bin/bash` is on the Mac.
//   2. A PATH is joined with `;` on Windows and `:` on the Mac, and its entries
//      are native (`C:\...`) either way: that is the form Node searches and the
//      form MSYS converts for the shell it starts. Joining with a hardcoded `:`
//      fuses two entries into one that resolves nowhere.
//   3. A bash started by sshd reads ~/.bashrc even when it is not interactive,
//      and Windows runs its suites over the bridge, so a case that means its
//      own PATH passes NO_RC, or the developer's rc file wins.
//   4. A path handed INTO a shell script is POSIX under Git Bash. A shell can
//      open `C:\Users\...\run.sh`, but `${BASH_SOURCE[0]%/*}` finds no `/` to
//      cut and a `case` pattern of `*/.env` never matches: the script silently
//      does nothing. `shellPath()` is the one normalizer for that boundary, and
//      for any assertion comparing against what a shell printed.
//
// Every export is the identity on macOS and Linux, so their behavior is
// unchanged by construction. This is the same seam the dotfiles repo carries at
// `tests/lib/platform.js`, name for name: like things use like systems.
//

const fs = require('fs');
const path = require('path');

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
// which /bin is a mount of), so that single dir IS the Mac's `/usr/bin:/bin`.
const SYSTEM_DIR = IS_WINDOWS ? findDir('bash.exe', 'sed.exe') : null;

/**
 * The system tools and nothing else: no Homebrew, no node manager, no stubs.
 * Every hook and every engine script reads its input through jq and asks git
 * where it stands, so both have to be on this list wherever the machine keeps
 * them: a run against a system PATH with no jq fails open, and every case
 * asserting what it said would read as a lie. The system directories come
 * first, and a tool none of them holds (jq from Homebrew or winget, git from
 * its own folder under Git Bash) contributes THAT one directory, so every
 * machine carries the same toolset and nothing wider.
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

/** The shell a suite spawns, by a name that needs no PATH lookup on Windows. */
const BASH = IS_WINDOWS ? path.join(SYSTEM_DIR, 'bash.exe') : 'bash';
const SH = IS_WINDOWS ? path.join(SYSTEM_DIR, 'sh.exe') : '/bin/sh';

// The same shell for a case whose child PATH resolves NOTHING (EMPTY_PATH):
// the spawn itself searches that PATH, on either platform.
const SYSTEM_BASH = IS_WINDOWS ? BASH : '/bin/bash';

/**
 * Flags that keep a spawned shell's world the test's own. A bash started by
 * sshd reads ~/.bashrc even when it is NOT interactive, and Windows runs its
 * suites over the bridge: without these, the rc file prepends the machine's own
 * tools ahead of every stub a case put on PATH, and prints its own warnings
 * into the child's stderr. A no-op on the Mac, where no rc file is read for a
 * non-interactive shell either way.
 */
const NO_RC = ['--noprofile', '--norc'];

// The two spellings below read the platform when they are ASKED, not when this
// file loaded: `asWindows` is how a case on the Mac drives the Windows branch,
// and an answer captured at load could never take it. Everything else here
// resolves a real tool or a real directory, which belongs to the machine the
// run is actually on, so it keeps the load-time answer.
const onWindows = () => process.platform === 'win32';

/**
 * A native path as the shell under test sees it: `C:\Users\x` to `/c/Users/x`
 * under Git Bash, unchanged on macOS. Use it for anything a shell script
 * receives (argv, a JSON payload it reads, an env var it manipulates) and for
 * anything compared against what a shell printed. A path already in that
 * spelling comes back as it came, so asking twice costs nothing.
 * @param {string} p
 * @returns {string}
 */
const shellPath = (p) => (onWindows()
  ? p.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/')
  : p);

/**
 * A path as GIT prints it: under Git for Windows a drive letter with forward
 * slashes (`C:/Users/x`), which is neither the native spelling nor the POSIX
 * one. Anything keyed off `git rev-parse --show-toplevel` wears this form, so
 * an assertion about such a key compares against it. Unchanged on macOS.
 * @param {string} p
 * @returns {string}
 */
const gitPath = (p) => (onWindows() ? p.replace(/\\/g, '/') : p);

/**
 * The first executable named `name` on a PATH, in the NATIVE form Node needs to
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
 * Write a PATH stub named `name` that runs `lines` as bash: the fake `gh` (and
 * the mirrored tool below) every PATH fixture puts in front of the real one.
 *
 * A SHELL finds it on both platforms, because bash reads the shebang itself.
 * A native program does not, on Windows: Node resolves a bare program name
 * through libuv, which appends `.com` and `.exe` to it and nothing else, so an
 * extensionless stub is never looked at and a `.cmd` beside it is not looked at
 * either (and a `.cmd` named outright is refused as a batch file). Nothing a
 * shell can run is startable that way, so a case that stubs a tool the program
 * under test spawns DIRECTLY is answerable off Windows and names its skip on
 * it. `homeEnv` below is what keeps such a case harmless there: the real tool
 * it reaches is a tool with no account.
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

/**
 * The rule above, worn as the reason a case names when it skips for it: one
 * sentence, so every suite that cannot stub a tool the program under test
 * spawns directly says the same thing and the rule itself stays stated once.
 */
const NO_NODE_STUB = 'no stub is startable by name from Node on Windows';

/**
 * A `jq` on PATH that writes CRLF, the way the Windows build does: this
 * machine's own jq behind a translation, so a suite can ask what a CRLF-safe
 * read does without standing on Windows to ask it. jq's own exit status is
 * handed back, so a predicate (`jq -e`, `jq empty`) still answers what it
 * answered: a stub that swallowed the status would be testing itself.
 *
 * On Windows the real tool IS the stub, which is the whole reason the wrapper
 * under test exists: translating again would write `\r\r\n`.
 *
 * The SECOND half of the Windows picture belongs to bash, not to jq: the bash
 * there strips a trailing CRLF in a command SUBSTITUTION, which is why a
 * single-value `v=$(jq ...)` read is clean on Windows and why those reads take
 * no strip. The Mac's bash strips no carriage return at all, so code whose
 * GATING reads are single-value substitutions (a cwd, a file path, a flag)
 * would exit early here for a reason Windows never has. `singleValueClean`
 * models that half: a one-line answer comes back clean, and every line of a
 * multi-line answer keeps its carriage return. The model is EXACT for a
 * substitution and cleaner than Windows for a one-line PIPE, where the real jq
 * writes `1\r\n` and nothing strips it, so a case about a piped one-line read
 * asks it with the option off.
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
 * A `cygpath` on PATH that answers the mixed form Git Bash answers with, so a
 * suite can drive the engine's Windows branch (`OSTYPE=msys`, which bash honors
 * when it is inherited) without standing on Windows to drive it. `/c/Users/x`
 * becomes `C:/Users/x`, and a path off the drive mounts (a temp dir on this
 * machine) gets the drive letter prefixed, which is what the MSYS root maps to
 * on a real box.
 *
 * On Windows the real tool is already on PATH and nothing is written: the
 * machine answers for itself, which is the answer under test.
 * @param {string} dir - the PATH directory, which must exist
 * @returns {string|null} the stub that was written, or null on Windows
 */
const cygpathStub = (dir) => (IS_WINDOWS ? null : stubTool(dir, 'cygpath', [
  '#!/bin/bash',
  'p="${@: -1}"',
  'case "$p" in',
  '  /[a-zA-Z]/*) printf "%s:/%s\\n" "$(printf "%s" "${p:1:1}" | tr "a-z" "A-Z")" "${p:3}" ;;',
  '  *) printf "C:%s\\n" "$p" ;;',
  'esac',
]));

/**
 * Make `real` reachable from `dir`, the way this platform can reach a tool.
 *
 * A symlink on macOS and Linux, where /usr/bin and the temp dir can sit on
 * different volumes. On Windows a PROGRAM finds its libraries beside itself
 * (every Git Bash tool loads msys-2.0.dll from its own directory), so a copy or
 * a link in a mirror directory cannot start at all: an executable gets a shim
 * that runs the real one where it lives, and everything else (the libraries a
 * whole-PATH mirror carries along) is hard linked, falling back to a copy.
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
 * A spawn env whose world is the scratch home `home`: that one directory in
 * every spelling a tool reads a home by, so no child of a test ever reads or
 * writes the developer's own.
 *
 * Three facts meet here, which is why they are stated once. Node's
 * `os.homedir()` on Windows answers out of USERPROFILE and never looks at
 * HOME, so a scratch HOME alone leaves a child sweeping the real `~/.workkit`.
 * `gh` keeps its config under `%AppData%` there and under `~/.config` here, and
 * reads GH_CONFIG_DIR ahead of both on every platform, so that one key seals it
 * everywhere with no branch: whichever `gh` a spawn resolves, the real one
 * included, it is a gh with no account. And the spelling differs by reader:
 * HOME is POSIX because a shell reads it, USERPROFILE and GH_CONFIG_DIR are
 * native because Windows programs do.
 *
 * A token in the shell the suite was started from outranks the config
 * directory, so both names it can wear are blanked here and the seal never
 * depends on what that shell happened to carry. A case that MEANS to hand a
 * token to its stub sets it AFTER this call, where saying so is visible.
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
});

/**
 * A mirror of the system PATH with one command left out of it: the machine that
 * does NOT have `gh`, built rather than assumed, since plenty of them ship it
 * in /usr/bin (every Ubuntu runner does) and a case that trusted the system
 * PATH to lack it would pass with the REAL tool answering.
 *
 * The mirror is the system directories plus wherever this machine keeps the
 * tools no system directory holds (node from a version manager, gh or jq from
 * Homebrew or winget), so the excluded one was really there to leave out and
 * everything a script reaches for on its way is still reachable. Every tool is
 * reached the way this platform can reach one, first-wins the way a PATH lookup
 * resolves. Two loud checks before a case leans on it: `sh` proves the mirror
 * is real, since an empty directory would pass an absence assertion by failing
 * on the missing SHELL, and the excluded command proves it is gone.
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
      // The tool a name IS carries no extension, so the excluded one is missing
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
 * Run `fn` as if this machine were Windows.
 *
 * `process.platform` is the only seam there is: `require('path')` in the module
 * under test bound to the posix implementation when it loaded, so a join there
 * keeps spelling slashes whatever the platform says, and only code that reads
 * the platform at CALL time takes the other branch. The tower's own `gitPath`
 * (tower/api/lib/repos.js) reads it at call time for exactly this reason, so
 * the Windows spelling is reachable from a Mac. On Windows the fake is what the
 * machine already says and nothing changes.
 *
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
  IS_WINDOWS, BASH, SH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, EMPTY_PATH,
  shellPath, gitPath, which, digestTool, toolStem, linkTool, stubTool, crlfJq,
  cygpathStub, pathWith, systemPathWith, joinPath, homeEnv, basePathWithout,
  NO_EXEC_BIT, NO_NODE_STUB, asWindows,
};
