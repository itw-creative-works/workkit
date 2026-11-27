/**
 * workflow/lib/command-log.js: the command log. A `workkit` command that does
 * work runs again as a child whose two streams reach this process's own as
 * they come and its log file plain, one whole run each, closed by `workkit
 * <name>: exit <code>`. A step that shows a secret stays out of the log.
 * Usage: const { logName, plainLog, runLogged, secretStep, terminalDevice } = require('../lib/command-log');
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('./run');
const { writeErr, writeOut, drained } = require('./say');
const { skip } = require('./voice');
const { openDevice } = require('./spin');
const { nativePath } = require('./platform');
const { repoRoot } = require('./git');
const { withScratch } = require('./scratch');
const { writeWhole } = require('./write');
const { signalCode } = require('./detach');
const { childEnd } = require('./child-end');
const { commandVerbs } = require('../workkit/command-list');
const { userDirOf } = require('../../hooks/mods/log.js');

// The commands that may run outside any repo, so they log to the machine folder.
const MACHINE_COMMANDS = ['setup', 'update', 'doctor', 'publish'];

// The programs handed the terminal (npm publish's one-time password, a deploy
// script, a ship hook), which run off the log where the call has a terminal.
const TERMINAL_STEPS = ['ship cut', 'ship publish', 'ship deploy'];

// A control sequence (color, cursor) and an operating system command (a title, a link), as bytes.
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const OSC = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

// Where a secret step run on the call's own streams begins and ends in each
// of them: the logger passes the bytes between on, keeps them out of the log,
// and drops the marks.
const SECRET_BEGIN = '\x1b]workkit:secret:begin\x07';
const SECRET_END = '\x1b]workkit:secret:end\x07';
const BEGIN_BYTES = Buffer.from(SECRET_BEGIN, 'latin1');
const END_BYTES = Buffer.from(SECRET_END, 'latin1');

/** The line a run off the log leaves in it, in its place. */
const offLogLine = (what) => `workkit: ${what} ran on the terminal and is not in this log\n`;

/**
 * The name a `workkit` call logs under (`setup`, `ship plan`, `proof red`), or
 * null for a command that writes no log. The CI watch keeps its own log.
 * @param {string[]} argv the command's arguments
 * @returns {string|null}
 */
const logName = ([verb, sub]) => {
  if (MACHINE_COMMANDS.includes(verb)) return verb;
  if (verb === 'proof' && sub === 'red') return 'proof red';
  if (verb === 'ship' && sub !== 'watch' && commandVerbs('ship').includes(sub)) return `ship ${sub}`;
  return null;
};

/**
 * A command's log file: a machine command's `<user folder>/logs/<name>.log`, a
 * repo command's `<name with a dash>.log` for the repo holding <cwd>.
 * @param {object} kit
 * @param {string} name logName's answer
 * @param {string} [cwd] the folder the command runs in
 * @returns {Promise<string|null>} null for a repo command outside a repo
 * @throws {LogsDirError} a repo whose `logs.dir` is outside it
 */
const logPath = async (kit, name, cwd = process.cwd()) => {
  if (MACHINE_COMMANDS.includes(name)) return `${userDirOf(kit.env)}/logs/${name}.log`;
  const root = repoRoot(cwd);
  // Loaded only here: a repo's log path reads the hooks' marker and settings modules.
  return root === null ? null : require('./run-paths').logPathOf(root, `${name.replace(/ /g, '-')}.log`);
};

/**
 * What a terminal leaves of <raw>, byte by byte as `LC_ALL=C awk` reads it: per
 * line the text after its last carriage return (a spinner's frames, a CRLF's
 * end), color and title codes removed, a line of only blanks made empty, and
 * every line closed by a newline.
 * @param {Buffer|string} raw
 * @returns {Buffer|string} the same type as <raw>
 */
const plainLog = (raw) => {
  const bytes = Buffer.isBuffer(raw) ? raw.toString('latin1') : Buffer.from(raw, 'utf8').toString('latin1');
  const lines = bytes.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const kept = lines.map((line) => {
    const parts = line.split('\r');
    let n = parts.length;
    while (n > 1 && parts[n - 1] === '') n -= 1;
    const text = parts[n - 1].replace(CSI, '').replace(OSC, '');
    return /^[ \t]*$/.test(text) ? '\n' : `${text}\n`;
  }).join('');
  const out = Buffer.from(kept, 'latin1');
  return Buffer.isBuffer(raw) ? out : out.toString('utf8');
};

/**
 * The terminal device's name, which a logged command's child draws and shows
 * secrets on (WK_COMMAND_TERMINAL).
 * @param {string} platform
 * @returns {string}
 */
const terminalDevice = (platform) => (platform === 'win32' ? 'CONOUT$' : '/dev/tty');

/**
 * The child's variables: the raw log, the terminal device when this stderr is
 * one, and WK_COMMAND_MARKS only where <piped> (the relay reads the marks).
 * Neither of the last two is ever taken from the caller's own variables.
 */
const childEnv = (kit, raw, piped) => {
  const env = {
    ...kit.env,
    WK_COMMAND_LOGGED: raw,
    ...(process.stdout.isTTY ? { WORKKIT_COLOR: kit.env.WORKKIT_COLOR || '1' } : {}),
  };
  delete env.WK_COMMAND_MARKS;
  delete env.WK_COMMAND_TERMINAL;
  if (piped) env.WK_COMMAND_MARKS = '1';
  if (process.stderr.isTTY) env.WK_COMMAND_TERMINAL = terminalDevice(kit.platform);
  return env;
};

/** The length of the longest tail of <bytes> that is a start of <mark> but not all of it. */
const markStartAt = (bytes, mark) => {
  for (let n = Math.min(bytes.length, mark.length - 1); n > 0; n -= 1) {
    if (bytes.subarray(bytes.length - n).equals(mark.subarray(0, n))) return n;
  }
  return 0;
};

/**
 * One stream's bytes split by the secret marks: each run outside a BEGIN..END
 * pair to <plain>, each inside to <secret>, the marks to neither. A tail that
 * could start a mark waits for the next chunk; end() passes it on as bytes.
 * @param {(bytes: Buffer) => void} plain
 * @param {(bytes: Buffer) => void} secret
 * @returns {{push: (chunk: Buffer) => void, end: () => void}}
 */
const markReader = (plain, secret) => {
  let inside = false;
  let held = Buffer.alloc(0);
  const emit = (bytes) => {
    if (bytes.length > 0) (inside ? secret : plain)(bytes);
  };
  const push = (chunk) => {
    let bytes = Buffer.concat([held, chunk]);
    for (;;) {
      const mark = inside ? END_BYTES : BEGIN_BYTES;
      const at = bytes.indexOf(mark);
      if (at === -1) {
        const keep = markStartAt(bytes, mark);
        emit(bytes.subarray(0, bytes.length - keep));
        held = Buffer.from(bytes.subarray(bytes.length - keep));
        return;
      }
      emit(bytes.subarray(0, at));
      inside = !inside;
      bytes = bytes.subarray(at + mark.length);
    }
  };
  const end = () => {
    emit(held);
    held = Buffer.alloc(0);
  };
  return { push, end };
};

/**
 * Each chunk of <from> on <write> as it comes, and appended to the raw log
 * but for a secret step's bytes between its marks; a reader that went away
 * stops the passing on only.
 */
const relay = (from, write, rawFd) => {
  let open = true;
  const pass = (bytes) => {
    if (!open) return;
    try {
      write(bytes);
    } catch (err) {
      if (err.code !== 'EPIPE') throw err;
      open = false;
    }
  };
  const reader = markReader((bytes) => {
    fs.writeSync(rawFd, bytes);
    pass(bytes);
  }, pass);
  from.on('data', reader.push);
  from.on('end', reader.end);
};

/** The child run under its log, the log written plain once it ends; answers the code the command ends with. */
const logRun = async (kit, name, argv, file, raw) => {
  const rawFd = fs.openSync(raw, 'a');
  const atTerminal = TERMINAL_STEPS.includes(name) && Boolean(process.stdout.isTTY || process.stderr.isTTY);
  let end;
  try {
    if (atTerminal) fs.writeSync(rawFd, offLogLine(name));
    const child = spawn(process.execPath, [kit.files.entry, ...argv], {
      stdio: atTerminal ? 'inherit' : ['inherit', 'pipe', 'pipe'], env: childEnv(kit, raw, !atTerminal), windowsHide: true,
    });
    if (!atTerminal) {
      relay(child.stdout, writeOut, rawFd);
      relay(child.stderr, writeErr, rawFd);
    }
    // A child ended by INT is this logger's 130: the log is written, never cut off by a raised INT.
    end = await childEnd(child, { reraise: false });
  } finally {
    fs.closeSync(rawFd);
  }
  try {
    writeWhole(file, Buffer.concat([plainLog(fs.readFileSync(raw)), Buffer.from(`workkit ${name}: exit ${end.code}\n`)]));
  } catch {
    writeErr(`workkit: could not write ${nativePath(file)}\n`);
  }
  return end.signal ? signalCode(end.signal) : end.code;
};

/** Whether <file>'s folder is there or could be made. */
const madeFolder = (file) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Run the command <argv> logged under <name>: again as a child of the running
 * Node, its streams teed as they come, then its log written. INT is held off
 * while it runs; HUP and TERM pass on to it and end this with 129 or 143.
 * @param {object} kit
 * @param {string} name logName's answer for <argv>
 * @param {string[]} argv the command's arguments
 * @param {(kit: object, argv: string[]) => Promise<number>} dispatch main.js's unlogged route
 * @returns {Promise<number>} the child's code; a run outside a repo, or whose
 *   log cannot be made, goes to <dispatch> here and answers its own; 1 on a bad `logs.dir` (said)
 */
const runLogged = async (kit, name, argv, dispatch) => {
  let file;
  try {
    file = await logPath(kit, name);
  } catch (err) {
    if (err.name !== 'LogsDirError') throw err;
    writeErr(`${err.message}\n`);
    return 1;
  }
  if (file === null) return dispatch(kit, argv);
  const logged = madeFolder(file) && withScratch((scratch) => {
    const raw = path.join(scratch, 'raw.log');
    try {
      fs.writeFileSync(raw, '');
    } catch {
      return null;
    }
    return logRun(kit, name, argv, file, raw);
  }, 'workkit-log.');
  if (logged) return logged;
  writeErr(`workkit: could not write ${nativePath(file)}, so ${name} runs without its log\n`);
  return dispatch(kit, argv);
};

/**
 * <mark> on both streams, written straight to their descriptors once every
 * line queued before it is out, so it lands in each pipe in order.
 */
const markBoth = async (mark) => {
  await drained(process.stdout);
  await drained(process.stderr);
  writeOut(mark);
  writeErr(mark);
};

/**
 * A step that shows a secret (a token, a sign-in code), kept out of the log.
 * Unlogged it runs on this process's own streams. Logged, its program runs on
 * the terminal device; with none, on this process's streams between the
 * marks the logger reads (WK_COMMAND_MARKS), or with no logger that reads
 * them it is skipped with one line. Logged, the log holds one line in its place.
 * @param {object} kit
 * @param {string} what the step, as its lines name it
 * @param {(stdio: {stdout: ('inherit'|number), stderr: ('inherit'|number)}) => (number|Promise<number>)} start
 *   starts the step's program on the two stdio values given, answering its code
 * @returns {Promise<number|null>} the program's code, or null when skipped
 */
const secretStep = async (kit, what, start) => {
  const raw = kit.env.WK_COMMAND_LOGGED;
  if (!raw) return start({ stdout: 'inherit', stderr: 'inherit' });
  const fd = openDevice(kit.env.WK_COMMAND_TERMINAL);
  if (fd !== null) {
    try {
      fs.appendFileSync(raw, offLogLine(what));
      return await start({ stdout: fd, stderr: fd });
    } finally {
      fs.closeSync(fd);
    }
  }
  if (kit.env.WK_COMMAND_MARKS !== '1') {
    skip(`${what}: skipped; this command's output is not on a terminal`);
    return null;
  }
  fs.appendFileSync(raw, offLogLine(what));
  await markBoth(SECRET_BEGIN);
  try {
    return await start({ stdout: 'inherit', stderr: 'inherit' });
  } finally {
    await markBoth(SECRET_END);
  }
};

module.exports = {
  logName, plainLog, runLogged, secretStep, terminalDevice,
};
