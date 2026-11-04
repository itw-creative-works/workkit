/**
 * workflow/lib/run.js: the one Node home for starting a program, the Node twin
 * of lib/platform.sh. Off Windows every call is child_process's own. On Windows
 * the program is found the way Git Bash finds it, every argument goes quoted and
 * verbatim, and a given env keeps what Windows needs to start a child.
 * Usage: const { spawnSync } = require('../lib/run');
 */

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

// Read once at load: a test that fakes process.platform must never hand a real
// program the win32 launch. launchOf's `platform` is the seam instead.
const PLATFORM = process.platform;

// The order a bare name is tried in, in each PATH dir.
const WINDOWS_EXTS = ['', '.exe', '.com', '.cmd', '.bat'];

// What a child on Windows needs to start cmd.exe or find its temp dir.
const WINDOWS_KEPT = ['ComSpec', 'SystemRoot', 'PATHEXT', 'TEMP', 'TMP'];

// What cmd.exe reads as its own in an argument, each escaped with `^`.
const CMD_META = /[()%!^"<>&|]/g;

// An npm cmd-shim, by cross-spawn's rule: its `%*` hands the line to cmd.exe a
// second time, so each argument's escaping must survive two parses.
const NPM_CMD_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

// What cmd.exe reads as its own in the command word, each escaped with `^`: an
// escaped quote opens no quoted run, so a space or `;` `,` would end the word.
const CMD_COMMAND_META = /[()\][%!^"`<>&|;, *?]/g;

/**
 * One argument quoted the Windows way: a backslash run before a quote or the
 * end is doubled, the quote escaped.
 * @param {*} value
 * @returns {string}
 */
const windowsQuoted = (value) => `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/** One argument of a cmd.exe line: quoted, then each of `()%!^"<>&|` escaped with `^`. */
const cmdQuoted = (value) => windowsQuoted(value).replace(CMD_META, '^$&');

/** One argument of an npm cmd-shim's line: cmdQuoted, then each metacharacter escaped again. */
const cmdShimQuoted = (value) => cmdQuoted(value).replace(CMD_META, '^$&');

/** The command word of a cmd.exe line: unquoted, each of `()][%!^"<>&|;,*?`, the backtick and the space escaped with `^`. */
const cmdCommand = (value) => String(value).replace(CMD_COMMAND_META, '^$&');

/**
 * The key `env` spells `name` with, matched without case, or undefined. Of two
 * spellings it is the one Node hands a Windows child: the first in sorted order.
 */
const keyOf = (env, name) => Object.keys(env).filter((key) => key.toUpperCase() === name.toUpperCase()).sort()[0];

/** The value `env` holds under `name` in any case, or undefined. */
const valueOf = (env, name) => {
  const key = keyOf(env, name);
  return key === undefined ? undefined : env[key];
};

/** `env` with each WINDOWS_KEPT key it lacks taken from `parentEnv`. */
const withKept = (env, parentEnv) => {
  const filled = { ...env };
  for (const name of WINDOWS_KEPT) {
    const parentValue = valueOf(parentEnv, name);
    if (valueOf(filled, name) !== undefined || parentValue === undefined) continue;
    filled[keyOf(filled, name) ?? name] = parentValue;
  }
  return filled;
};

/** A PATH's folders in order, each trimmed of spaces and surrounding quotes, empty ones dropped. */
const pathDirs = (searchPath) => (searchPath || '').split(path.win32.delimiter)
  .map((dir) => dir.trim().replace(/^"+|"+$/g, ''))
  .filter(Boolean);

/** A path folded for a prefix compare: forward slashes, lower case. */
const folded = (p) => p.replace(/\\/g, '/').toLowerCase();

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** `file`'s first line when it starts `#!`, else null. */
const shebangOf = (file) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(256);
    const line = head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)).toString().split(/\r?\n/)[0];
    return line.startsWith('#!') ? line : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

/** Whether a `#!` line names node: `#!/usr/bin/env node`, or an interpreter path ending `/node`. */
const namesNode = (line) => /^#!\s*(?:\S*\/env\s+node|\S*\/node)(?:\s|$)/.test(line);

/**
 * Git Bash, found as script-shell.cs's FindBash finds it: the first bash.exe on
 * PATH outside `%SystemRoot%` and `%LOCALAPPDATA%\Microsoft\WindowsApps`, where
 * WSL's live, else `..\bin\bash.exe` beside the first git.exe. Null when neither.
 */
const gitBashOf = (searchPath, parentEnv) => {
  const local = valueOf(parentEnv, 'LOCALAPPDATA');
  const skipped = [valueOf(parentEnv, 'SystemRoot'), local && `${local}\\Microsoft\\WindowsApps`].filter(Boolean).map(folded);
  let gitDir = null;
  for (const dir of pathDirs(searchPath)) {
    if (skipped.some((prefix) => folded(dir).startsWith(prefix))) continue;
    const bash = path.join(dir, 'bash.exe');
    if (isFile(bash)) return bash;
    if (gitDir === null && isFile(path.join(dir, 'git.exe'))) gitDir = dir;
  }
  if (gitDir === null) return null;
  const beside = path.join(path.dirname(gitDir.replace(/[\\/]+$/, '')), 'bin', 'bash.exe');
  return isFile(beside) ? beside : null;
};

/** The loud failure of a launch that needs Git Bash on a machine without it. */
const noGitBash = (program) => {
  const message = `run.js: Git Bash not found (no bash.exe on PATH outside the Windows folder and none beside git.exe), so ${program} cannot start`;
  throw Object.assign(new Error(message), { code: 'ENOENT' });
};

/** The program an extensionless `file` runs under: node for a node `#!` line, Git Bash for any other, else null. */
const runnerOf = (file, gitBash) => {
  const line = shebangOf(file);
  if (line === null) return null;
  return namesNode(line) ? process.execPath : gitBash();
};

/**
 * The first file `name` names on `searchPath`, dir by dir in PATH order, each
 * dir trying WINDOWS_EXTS in order. An extensionless file counts only when
 * runnerOf has a program for it. Null when none.
 */
const foundOn = (name, searchPath, gitBash) => {
  for (const dir of pathDirs(searchPath)) {
    for (const ext of WINDOWS_EXTS) {
      const file = path.join(dir, `${name}${ext}`);
      if (isFile(file) && (path.extname(file) !== '' || runnerOf(file, gitBash) !== null)) return file;
    }
  }
  return null;
};

/**
 * The real launch of `cmd` with `args` and `options`: on any platform but
 * win32 the input unchanged; on win32 the found program, a `#!` script through
 * node or Git Bash, a `.cmd` or `.bat` through ComSpec, every argument quoted
 * and verbatim. Pure apart from reading files; throws when Git Bash is needed
 * and found nowhere.
 * @param {string} cmd - a bare name or a path
 * @param {string[]|object} [args] - the arguments, or the options when omitted
 * @param {object} [options] - child_process's options
 * @param {{ platform?: string, parentEnv?: object }} [context] - the platform and env the launch is for
 * @returns {{ file: string, args: (string[]|object|undefined), options: (object|undefined) }}
 */
const launchOf = (cmd, args, options, { platform = PLATFORM, parentEnv = process.env } = {}) => {
  if (platform !== 'win32') return { file: cmd, args, options };
  const argv = Array.isArray(args) ? args : [];
  const opts = { ...(Array.isArray(args) || args == null ? options : args) };
  if (opts.env) opts.env = withKept(opts.env, parentEnv);
  const searchPath = valueOf(opts.env || {}, 'PATH') ?? valueOf(parentEnv, 'PATH');
  let bash;
  const gitBash = () => {
    if (bash === undefined) bash = gitBashOf(searchPath, parentEnv);
    return bash;
  };
  let program = cmd;
  if (/^bash(\.exe)?$/i.test(cmd)) program = gitBash() ?? noGitBash(cmd);
  else if (!/[\\/]/.test(cmd)) program = foundOn(cmd, searchPath, gitBash) ?? cmd;
  // A bare name PATH lacks stays bare: never read as a script in the current folder.
  const located = program !== cmd || /[\\/]/.test(cmd);
  const ext = path.extname(program).toLowerCase();
  let launch = { file: program, args: argv.map(windowsQuoted) };
  if (ext === '' && located && shebangOf(program) !== null) {
    launch = { file: runnerOf(program, gitBash) ?? noGitBash(program), args: [program, ...argv].map(windowsQuoted) };
  } else if (ext === '.cmd' || ext === '.bat') {
    const quoted = NPM_CMD_SHIM.test(program) ? cmdShimQuoted : cmdQuoted;
    const line = [cmdCommand(program), ...argv.map(quoted)].join(' ');
    launch = { file: valueOf(opts.env || parentEnv, 'ComSpec') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`] };
  }
  // The program name is argument 0 of a verbatim line, so it goes quoted too.
  return {
    ...launch,
    options: { ...opts, argv0: opts.argv0 ?? windowsQuoted(launch.file), windowsVerbatimArguments: true },
  };
};

/** launchOf's answer as `{ launch }`, or its Git Bash refusal as `{ refusal }`; any other throw stays loud. */
const attempt = (cmd, args, options) => {
  try {
    return { launch: launchOf(cmd, args, options) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { refusal: err };
  }
};

// child_process.spawnSync's own answer for a start that failed: no pid, no output.
const unstarted = (error) => ({
  error, status: null, signal: null, output: null, pid: 0, stdout: undefined, stderr: undefined,
});

/** child_process.spawnSync through launchOf; a refused launch answers as a failed start does. */
const spawnSync = (cmd, args, options) => {
  const { launch, refusal } = attempt(cmd, args, options);
  if (refusal) return unstarted(refusal);
  return childProcess.spawnSync(launch.file, launch.args, launch.options);
};

/** child_process.execFileSync through launchOf; a refused launch throws its error, the failed start's answer on it, as Node does. */
const execFileSync = (cmd, args, options) => {
  const { launch, refusal } = attempt(cmd, args, options);
  if (refusal) throw Object.assign(refusal, unstarted(refusal));
  return childProcess.execFileSync(launch.file, launch.args, launch.options);
};

/**
 * child_process.spawn through launchOf. A launch launchOf refuses comes back a
 * child that emits the refusal as its 'error', as a failed start does.
 */
const spawn = (cmd, args, options) => {
  const { launch, refusal } = attempt(cmd, args, options);
  if (!refusal) return childProcess.spawn(launch.file, launch.args, launch.options);
  const child = new childProcess.ChildProcess();
  process.nextTick(() => child.emit('error', refusal));
  return child;
};

module.exports = { spawnSync, spawn, execFileSync, launchOf, windowsQuoted };
