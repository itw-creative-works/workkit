/**
 * A spin of workflow/lib/spin.js driven in a node of its own, around a real child program that holds until the
 * case releases it, so a case sees the frames while the call runs; and the poll of workflow/lib/flows.js the same
 * way, a key typed once its countdown drew. Consumers: test/scripts/spin.test.js, test/scripts/flows.test.js,
 * test/scripts/workflow-standards/labels.test.js and test/hooks/twins.test.js.
 */

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  start, until, mkTmp, SPAWN_DEADLINE,
} = require('./harness');
const { BASH, NO_RC, jsPath, shellPath } = require('./platform');
const { escapeRegex } = require('../../workflow/lib/regex');

const KIT = path.join(__dirname, '..', '..');
const MESSAGE = 'reading the roster';
// lib.sh's WK_SPIN_FRAMES, and the clear wk_spin writes once the call is back.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CLEAR = `\r${' '.repeat(72)}\r`;
// What the held call prints on the stdout it shares with the driver.
const ANSWER = 'owner/repo\n';

// The call: holds until argv[1] exists, then prints the answer; past the bound in argv[2] it gives up.
const HOLD = [
  "const fs = require('fs');",
  'const giveUp = setTimeout(() => process.exit(3), Number(process.argv[2]));',
  'const held = setInterval(() => {',
  '  if (!fs.existsSync(process.argv[1])) return;',
  '  clearInterval(held);',
  '  clearTimeout(giveUp);',
  `  process.stdout.write(${JSON.stringify(ANSWER)});`,
  '}, 20);',
].join('\n');

// The driver, one mode per argv[1]: each spins the message around the held call as a caller of spin would.
const DRIVER = [
  "const fs = require('fs');",
  `const { spin } = require(${jsPath(path.join(KIT, 'workflow', 'lib', 'spin.js'))});`,
  `const { spawnSync, spawn } = require(${jsPath(path.join(KIT, 'workflow', 'lib', 'run.js'))});`,
  'const [mode, hold, release, bound, answers] = process.argv.slice(1);',
  "const argv = ['-e', hold, release, bound];",
  "const stdio = ['ignore', 'inherit', 'inherit'];",
  'const call = () => spawnSync(process.execPath, argv, { stdio });',
  "const later = () => new Promise((resolve) => { spawn(process.execPath, argv, { stdio }).on('close', resolve); });",
  `const message = ${JSON.stringify(MESSAGE)};`,
  'const modes = {',
  "  resolves: () => spin(message, () => later().then(() => 'the value')).then((value) => { process.stderr.write(`value: ${value}\\n`); }),",
  "  rejects: () => spin(message, () => later().then(() => { throw new Error('the promise broke'); }))",
  '    .then(() => {}, (err) => { process.stderr.write(`caught: ${err.message}\\n`); }),',
  "  call: () => { spin(message, call); process.stderr.write('after\\n'); },",
  '  last: () => { spin(message, call); },',
  "  unlined: () => { spin(message, call, { line: false }); process.stderr.write('after\\n'); },",
  '  throws: () => {',
  '    try {',
  "      spin(message, () => { call(); throw new Error('the call broke'); });",
  '    } catch (err) {',
  '      process.stderr.write(`caught: ${err.message}\\n`);',
  '    }',
  '  },',
  '  answer: async () => {',
  "    const handed = { the: 'answer' };",
  '    const sync = spin(message, () => { call(); return handed; }) === handed;',
  "    const pending = spin(message, () => new Promise((resolve) => { spawn(process.execPath, argv, { stdio }).on('close', () => resolve(handed)); }));",
  "    const thenable = typeof pending.then === 'function';",
  '    const resolved = (await pending) === handed;',
  "    const rejected = await spin(message, async () => { throw new Error('the promise broke'); }).then(() => null, (err) => err.message);",
  '    fs.writeFileSync(answers, JSON.stringify({ sync, thenable, resolved, rejected }));',
  '  },',
  '};',
  'modes[mode]();',
].join('\n');

/**
 * The frames in <text>: each piece after a carriage return that reads, its color codes aside,
 * `<indent><frame> <message> (<n>s)`, as it was drawn.
 * @param {string} text
 * @param {string} [message]
 * @returns {string[]}
 */
const framesIn = (text, message = MESSAGE) => {
  const words = escapeRegex(message);
  const frame = new RegExp(`^ *[${FRAMES.join('')}] ${words} \\(\\d+s\\)$`);
  return text.split('\r').slice(1).filter((piece) => frame.test(stripVTControlCharacters(piece)));
};

const readOr = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

/**
 * The node arguments of the driver in <mode>, its release and answers files in <dir>, for a case that starts it
 * another way (at a terminal); the call holds until the release file is written.
 * @param {string} mode
 * @param {string} dir
 * @returns {{args: string[], release: string, answers: string}}
 */
const spinArgs = (mode, dir) => {
  const release = path.join(dir, 'release');
  const answers = path.join(dir, 'answers.json');
  return { args: ['-e', DRIVER, mode, HOLD, release, String(SPAWN_DEADLINE), answers], release, answers };
};

/**
 * spin around the held call in a node of its own under <env>, in <mode>: `call` (then `after` on stderr),
 * `last` (nothing after), `unlined` (`call` with `{ line: false }`), `resolves` and `rejects` (a run whose
 * promise settles once the held call ends; `value: <value>` or `caught: <message>` on stderr), `throws` (the run throws; `caught: <message>` on stderr) or `answer` (what spin
 * handed back, written to a file). With <frames>, the call holds until that many frames reached the stream
 * they are watched on, then is released; with none it is released before the start. <commandLog> runs it
 * under a command log as lib/command-log.sh holds one: WK_COMMAND_LOGGED set, 7, 8 and 9 open on files.
 * @param {string} mode
 * @param {{env: object, frames?: number, commandLog?: boolean}} opts
 * @returns {Promise<{status: ?number, timedOut: boolean, stdout: string, stderr: string, held: string, answers: ?object}>}
 *   `held` is what reached 8 under a command log
 */
const driveSpin = async (mode, { env, frames = 0, commandLog = false }) => {
  const dir = mkTmp('spin-call-');
  const { args, release, answers } = spinArgs(mode, dir);
  const fd = (n) => path.join(dir, `fd${n}`);
  if (!frames) fs.writeFileSync(release, '');
  const call = commandLog
    ? start(BASH, [...NO_RC, '-c', 'exec "$@" 7>>"$FD7" 8>>"$FD8" 9>>"$FD9"', 'spin', shellPath(process.execPath), ...args], {
      env: {
        ...env, WK_COMMAND_LOGGED: '1', FD7: shellPath(fd(7)), FD8: shellPath(fd(8)), FD9: shellPath(fd(9)),
      },
    })
    : start(process.execPath, args, { env });
  const watched = () => (commandLog ? readOr(fd(8)) : call.stderr());
  if (frames) {
    await until(() => framesIn(watched()).length >= frames);
    fs.writeFileSync(release, '');
  }
  const { status, timedOut } = await call.done;
  return {
    status,
    timedOut,
    stdout: call.stdout(),
    stderr: call.stderr(),
    held: readOr(fd(8)),
    answers: fs.existsSync(answers) ? JSON.parse(fs.readFileSync(answers, 'utf8')) : null,
  };
};

// The poll's message, and the seconds between its checks: longer than any case waits, so only a key moves it.
const POLL_MESSAGE = 'Waiting for the categories';
const POLL_SECONDS = 30;

// A caller of the poll on the process's own streams: its check fails once, then passes; its answer goes on stderr.
const POLLER = [
  `const { poll } = require(${jsPath(path.join(KIT, 'workflow', 'lib', 'flows.js'))});`,
  'let asked = 0;',
  `poll(${JSON.stringify(POLL_MESSAGE)}, Number(process.argv[1]), () => asked++ > 0)`,
  '  .then((answer) => { process.stderr.write(`answer: ${answer}\\n`); });',
].join('\n');

/** The seconds a countdown frame shows. */
const secondsOf = (frame) => Number(stripVTControlCharacters(frame).match(/\((\d+)s\)$/)[1]);

/**
 * The poll in a node of its own under <env>, its stdin a pipe kept open: once its countdown drew <frames> frames
 * showing at least <counts> different seconds, <key> is typed; once it answered, the stdin is closed.
 * @param {string} key
 * @param {{env: object, frames?: number, counts?: number}} opts
 * @returns {Promise<{status: ?number, timedOut: boolean, stderr: string, frames: string[]}>} `frames` the countdown's
 */
const drivePoll = async (key, { env, frames = 1, counts = 1 }) => {
  const call = start(process.execPath, ['-e', POLLER, String(POLL_SECONDS)], { env, stdin: 'open' });
  const drawn = () => framesIn(call.stderr(), `${POLL_MESSAGE}...`);
  await until(() => drawn().length >= frames && new Set(drawn().map(secondsOf)).size >= counts);
  call.child.stdin.write(key);
  await until(() => call.stderr().includes('answer: '));
  call.child.stdin.end();
  const { status, timedOut } = await call.done;
  return {
    status, timedOut, stderr: call.stderr(), frames: drawn(),
  };
};

module.exports = {
  driveSpin, spinArgs, framesIn, drivePoll, secondsOf, MESSAGE, FRAMES, CLEAR, ANSWER, POLL_MESSAGE, POLL_SECONDS,
};
