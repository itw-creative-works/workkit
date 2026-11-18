/**
 * What the suites of the detached supervisor's checks share: the check length a
 * case sets, the settings that set it and a root holding them, the frozen line, the reason a process
 * read is skipped and the skip value of a case that needs one, the fake commands and the reads
 * of what they leave, whether a started call has ended, the end of whatever
 * a red case left running, a run lock folder made by hand and read back, a
 * process that acts on a lock once a file appears, and a pid that has ended.
 * Consumers: test/scripts/detach.test.js, runs.test.js, lock.test.js, script-shell-detached.test.js,
 * prove.test.js, supervise.test.js, watch.test.js, tree.test.js, logs-dir.test.js and
 * test/lib/supervise-world.js.
 */

const fs = require('fs');
const path = require('path');
const {
  endTree, until, expect, pidIn, alive, start, mkTmp,
} = require('./harness');
const { IS_WINDOWS, jsPath, spawnSync } = require('./platform');

// A check of about a second, so two checks pass well inside the spawn deadline.
const CHECK_MINUTES = 0.02;

const NO_PROCESS_READ = 'the supervisor reads no processor time on Windows, so it gives no frozen or look verdict there';

/** The skip value of a case that needs a process read: the reason on Windows, else false. */
const skipOnWindows = () => IS_WINDOWS && NO_PROCESS_READ;

// The line a frozen run's log ends with, its minutes as the supervisor spells them.
const FROZEN_LINE = /^detach: no output and no processor use for \S+ minutes, so the run was ended \(exit 124\)$/;

/** A `.workkit/settings.json` body setting `tests.check` to <check>, `enabled` on when <optIn>. */
const checkSettings = (check, optIn = false) => `${JSON.stringify({ ...(optIn ? { enabled: true } : {}), tests: { check } })}\n`;

/** A scratch folder whose `.workkit/settings.json` is <body>, a run's `--root`. */
const rootHolding = (body) => {
  const root = mkTmp('supervise-root-');
  fs.mkdirSync(path.join(root, '.workkit'));
  fs.writeFileSync(path.join(root, '.workkit', 'settings.json'), body);
  return root;
};

/** A scratch folder whose `.workkit/settings.json` sets `tests.check` to <check>. */
const rootWith = (check) => rootHolding(checkSettings(check));

/** The pid <file> holds, once the command has written it. */
const pidOf = async (file) => {
  expect(await until(() => pidIn(file) > 0), `no pid was written to ${file}`).toBeTruthy();
  return pidIn(file);
};

/** Whatever a red case left running, ended hard so the next case starts clean. */
const reap = (...pids) => {
  for (const pid of pids.filter(Boolean)) endTree(pid, 'SIGKILL');
};

// The fake commands, each writing its own pid to <pidFile> once it is set up:
// one that waits in silence, one that keeps a processor busy in silence.
const writesPid = (pidFile) => `require('fs').writeFileSync(${jsPath(pidFile)}, String(process.pid));`;
const silent = (pidFile) => `${writesPid(pidFile)}\nsetInterval(() => {}, 1 << 30);`;
const busy = (pidFile) => `${writesPid(pidFile)}\nfor (;;) {}`;

/** Whether a started <child> has exited or died of a signal. */
const ended = (child) => child.exitCode !== null || child.signalCode !== null;

/** A file's text, or '' while it is not there. */
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

/** The last line of <text>, its closing newline aside. */
const lastLine = (text) => text.replace(/\n$/, '').split('\n').pop();

/** <file>'s real path, so two spellings of one file compare equal. */
const realOf = (file) => { try { return fs.realpathSync(file); } catch { return `(unresolved) ${file}`; } };

/** A run lock folder made by hand at <lock>, holding each file <files> names (its claim and mark among them) with its text. */
const handLock = (lock, files) => {
  fs.mkdirSync(lock, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(lock, name), text);
  return lock;
};

/** A lock's `claim` text naming the mark `id.<tag>`: the taker's tag. */
const claimNaming = (tag) => `${tag}\n`;

/** A take's tag whose first field is <pid>, the process that made it. */
const tagOf = (pid) => `${pid}.1.1`;

/**
 * A node process that runs the JS statements <action> <ms> after <trigger> appears;
 * it lives on when <stays>.
 */
const actsAfter = (trigger, ms, action, stays = false) => start(process.execPath, ['-e', [
  "const fs = require('fs');",
  `const seen = setInterval(() => { if (!fs.existsSync(${jsPath(trigger)})) return; clearInterval(seen);`,
  `setTimeout(() => { ${action} }, ${ms}); }, 50);`,
  stays ? 'setInterval(() => {}, 1 << 30);' : '',
].join('\n')]);

/**
 * A node process that writes the JS expression <text> to <file> <ms> after <trigger>
 * appears, whole through a rename from outside <file>'s folder; it lives on when <stays>.
 */
const writesAfter = (trigger, file, ms, text, stays = false) => {
  const next = path.join(path.dirname(path.dirname(file)), `${path.basename(file)}.next`);
  return actsAfter(trigger, ms, `fs.writeFileSync(${jsPath(next)}, ${text}); fs.renameSync(${jsPath(next)}, ${jsPath(file)});`, stays);
};

/** A pid that was real a moment ago and has ended. */
const deadPid = () => {
  const pid = spawnSync(process.execPath, ['-e', '0']).pid;
  expect(!alive(pid), `the pid ${pid} is gone`).toBeTruthy();
  return pid;
};

/** The names <lock> holds, sorted, as one comparable string; `(none)` once the folder is gone. */
const holding = (lock) => (fs.existsSync(lock) ? fs.readdirSync(lock).sort().join(' ') : '(none)');

module.exports = {
  CHECK_MINUTES, NO_PROCESS_READ, skipOnWindows, FROZEN_LINE, checkSettings, rootHolding, rootWith, pidOf, reap,
  writesPid, silent, busy, ended, read, lastLine, realOf, handLock, claimNaming, tagOf, actsAfter, writesAfter, deadPid, holding,
};
