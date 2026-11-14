/**
 * What the suites of the detached supervisor's checks share: the check length a
 * case sets, the settings that set it, the frozen line, the reason a process
 * read is skipped and the skip value of a case that needs one, the fake commands and the reads
 * of what they leave, whether a started call has ended, and the end of whatever
 * a red case left running.
 * Consumers: test/scripts/detach.test.js, script-shell-detached.test.js,
 * prove.test.js, supervise.test.js, watch.test.js, tree.test.js and
 * test/lib/supervise-world.js.
 */

const fs = require('fs');
const {
  endTree, until, expect, pidIn,
} = require('./harness');
const { IS_WINDOWS, jsPath } = require('./platform');

// A check of about a second, so two checks pass well inside the spawn deadline.
const CHECK_MINUTES = 0.02;

const NO_PROCESS_READ = 'the supervisor reads no processes on Windows, so it gives no frozen or look verdict there';

/** The skip value of a case that needs a process read: the reason on Windows, else false. */
const skipOnWindows = () => IS_WINDOWS && NO_PROCESS_READ;

// The line a frozen run's log ends with, its minutes as the supervisor spells them.
const FROZEN_LINE = /^detach: no output and no processor use for \S+ minutes, so the run was ended \(exit 124\)$/;

/** A `.workkit/settings.json` body setting `tests.check` to <check>, `enabled` on when <optIn>. */
const checkSettings = (check, optIn = false) => `${JSON.stringify({ ...(optIn ? { enabled: true } : {}), tests: { check } })}\n`;

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

module.exports = {
  CHECK_MINUTES, NO_PROCESS_READ, skipOnWindows, FROZEN_LINE, checkSettings, pidOf, reap,
  writesPid, silent, busy, ended, read, lastLine, realOf,
};
