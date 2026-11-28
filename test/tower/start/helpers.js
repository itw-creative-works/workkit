// The shared prologue of the tower/start.js suites beside this one, one concern
// each. The starter runs for real with both server commands injected
// (WORKKIT_TOWER_API_CMD / WORKKIT_TOWER_APP_CMD, each a JSON list): each half is
// the suite's own node saying its lines and holding, so no port opens and the
// assertions are about lifecycles.

const fs = require('fs');
const path = require('path');
const {
  SPAWN_DEADLINE, alive, until, elapsedUntil, pidIn, mkTmp, run, start: startHandle,
} = require('../../lib/harness');
const { IS_WINDOWS, which, stubToolJs, nodeHomeEnv } = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'tower', 'start.js');

// The env keys every start of the starter here runs under, so one that ignores
// its seams reaches no real half: an `npm` and `omega` first on PATH that say so
// and exit 1, and a real API half on a port free a moment ago under a scratch
// home. Made once per process; the case's own PATH goes behind the guard's.
let guard = null;
const guarded = (env) => {
  if (!guard) {
    const dir = mkTmp('tower-start-guard-');
    for (const name of ['npm', 'omega']) {
      stubToolJs(dir, name, `process.stderr.write('the suite reached the real ${name}\\n'); process.exitCode = 1;`);
    }
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const port = run(process.execPath, ['-e', "const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); });"]).stdout;
    if (!/^\d+$/.test(port)) throw new Error(`tower start helpers: no free port picked, got: ${port}`);
    guard = { dir, env: { ...nodeHomeEnv(home), WORKFLOW_HOME: path.join(home, '.workkit'), TOWER_PORT: port } };
  }
  return { ...guard.env, ...env, PATH: [guard.dir, env.PATH ?? process.env.PATH].join(path.delimiter) };
};

// A seam's value: the JSON list of the suite's node running <source>, which
// reads <args> from process.argv[1] on.
const nodeCmd = (source, ...args) => JSON.stringify([process.execPath, '-e', source, ...args]);

// A half that says <lines> in order, a string to stdout and `{ err }` to stderr,
// then holds <hold> ms and ends 0, or with <exit> ends at once with that code.
const half = (lines, { hold = 30000, exit } = {}) => nodeCmd([
  `for (const [err, text] of ${JSON.stringify(lines.map((line) => (typeof line === 'string' ? [false, line] : [true, line.err])))}) {`,
  "  (err ? process.stderr : process.stdout).write(`${text}\\n`);",
  '}',
  exit === undefined ? `setTimeout(() => {}, ${hold});` : `process.exitCode = ${exit};`,
].join('\n'));

// A half that says nothing and stays up: the other side of a case about one half.
const HOLD = half([]);

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The pid in <file> the moment it is written, so a signal sent on sight lands
// right after the writer spawned. 0 if never.
const pidOnSight = async (file) => (
  (await elapsedUntil(() => pidIn(file) > 0)) === Infinity ? 0 : pidIn(file));

// The port takeover is aimed at nothing unless a test says otherwise, so a
// run here never touches whatever this machine really has on 8693/4300. The
// harness handle, detached, so an end reaches the stubs the starter spawned.
const start = (dir, api, app, ports = '', { args = [], env = {} } = {}) => {
  const childEnv = {
    ...process.env, WORKKIT_TOWER_API_CMD: api, WORKKIT_TOWER_APP_CMD: app, WORKKIT_TOWER_PORTS: ports, ...guarded(env),
  };
  // A FORCE_COLOR the outer shell exported would pass through the starter
  // untouched, a red herring to every case that asserts what the tower itself
  // decides. The caller-owned path has its own pty case.
  if (!('FORCE_COLOR' in env)) delete childEnv.FORCE_COLOR;
  return startHandle(process.execPath, [SCRIPT, ...args], { env: childEnv, cwd: dir, detached: true });
};

// A half that records its own pid in <pidFile> as Node sees one, a Windows id
// there, then stays up for <life> ms.
const nodeHalf = (pidFile, life = 30000) => nodeCmd(
  `require('fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, ${life});`, pidFile);

// The stand-in listener the port cases hand the wrapper. Node's
// `console.log(<number>)` paints a number once FORCE_COLOR is set, and the
// reclaim pass would then look up a port that does not exist, so the ambient
// value goes first here too. The harness handle.
const standIn = (code) => {
  const childEnv = { ...process.env };
  delete childEnv.FORCE_COLOR;
  return startHandle(process.execPath, ['-e', code], { env: childEnv });
};

// The ports the output tests hand the wrapper: high and unused, so the reclaim
// pass finds nothing and this machine's real tower is never touched.
const QUIET_PORTS = '18693 14300';

// A stand-in for the dev server's log wall: the chatter someone who typed
// `workkit tower` did not ask for, the two lines that matter, the one the
// framework says in its own voice, and the URL omega announces twice (its
// https proxy, then the dev server itself).
const NOISY_APP = half([
  'omega: no cloudflare account id configured, skipping',
  'compiled 42 files in 1.2s',
  'HTTPS proxy listening on https://localhost:14300',
  'Dev server: https://localhost:14300',
  'WARN missing key: analytics',
  { err: 'Error: the board failed to load' },
]);

// The shapes a half dies in that carry none of the obvious keywords - a
// missing binary, a missing module, a permission, a signal, an npm failure.
// Each is a run that is already over; a filter that swallowed them would leave
// the terminal blank about it.
const FAILURE_SHAPES = [
  'sh: omega: command not found',
  'Cannot find module @omega.js/core',
  'ENOENT: no such file or directory, open package.json',
  'EACCES: permission denied, mkdir /usr/local/lib',
  'Missing binding /node_modules/node-sass/vendor/binding.node',
  'Segmentation fault: 11',
  'Killed: 9',
  'npm ERR! code ELIFECYCLE',
];

const FAILING_APP = half(FAILURE_SHAPES);

// A boot omega refuses, the way it really prints one: its own prefix on every
// line, not one of them carrying a keep-net word, then an exit. A filter that
// drops it all ends the run on a blank terminal.
const REFUSING_APP = half([
  'omega: the monorepo src-to-dist watch is not running',
  'omega: dist is not built - start the watch in the monorepo root first',
], { exit: 1 });

// The same shape on the API side, so the line that names the half is reading
// which one ended rather than saying "app" every time.
const REFUSING_API = half(['omega: linked packages are read-only'], { exit: 1 });

// A half that ends after the dashboard was announced: the run got what it came
// for, so its ending is an ordinary shutdown and needs no explaining.
const ANNOUNCED_APP = half(['Dev server: https://localhost:14300'], { hold: 300 });

// The same announce, on a half that then stays up - a tower doing its job,
// waiting for whatever ends it from the outside.
const ANNOUNCING_APP = half(['Dev server: https://localhost:14300']);

// The macOS duplicate-library warning as it really arrives - two bundled copies
// of glib in the framework's own node_modules, and the word "failures" that
// carries it through the keep net.
const OBJC_WARNING = 'objc[77855]: Class GNotificationCenterDelegate is implemented in both '
  + '/Users/me/dev/omega/node_modules/sharp/build/Release/libvips-cpp.8.18.3.dylib (0x10ff3c2a8) and '
  + '/Users/me/dev/omega/node_modules/canvas/build/Release/libgio-2.0.0.dylib (0x1103b8180). '
  + 'This may cause spurious casting failures and mysterious crashes. '
  + 'One of the duplicates must be removed or renamed.';

// The lines the keep net catches on wording alone (that warning and a passing
// check summary, "failed", "warned") beside the two that must survive them: a
// summary reporting real failures, and one with ten of them, which the digit
// guard must not read as the zero it exempts.
const BENIGN_APP = half([
  OBJC_WARNING,
  '  Results:   6 passed, 0 failed, 1 warned, 20 skipped',
  '  Results:   4 passed, 2 failed, 1 warned, 20 skipped',
  '  Results:   4 passed, 10 failed, 1 warned, 20 skipped',
  { err: 'Error: the board failed to load' },
]);

// The app half's two phases in one run, the way omega prints them: the manage
// cycle (its `[11ty]` build lines must not open the phase), then the dev server,
// every line tagged `[web]` at column 0. The tag is the boundary; the URL
// arrives later and still gets its announce beside its own raw line.
const WEB_APP = half([
  '[11ty] Wrote 87 files in 1.24 seconds',
  'some manage step',
  '[web] Using existing mkcert certificates',
  '[web] Dev server: https://localhost:14300',
  OBJC_WARNING,
  '[web] watching for changes',
]);

// The fallback the trigger keeps: an app that never tags a line still switches
// at the URL it names. Only what comes after the boundary belongs on the
// terminal, minus the drop list, which outlives it.
const PHASED_APP = half([
  'omega: some build step',
  'copying 12 assets',
  'Dev server: https://localhost:14300',
  'GET /index.html 200 in 12ms',
  OBJC_WARNING,
  '  Results:   6 passed, 0 failed, 1 warned, 20 skipped',
  'GET /assets/app.css 200 in 3ms',
]);

// The API half owns no port, so it never announces and never leaves the quiet
// phase - not on a line of its own carrying a URL, and not on one wearing the
// app's `[web]` tag either. Its ordinary chatter is the wall nobody asked for,
// first line to last.
const CHATTY_API = half([
  '[web] hello',
  'api: listening on http://127.0.0.1:18693',
  'api: board sweep done in 240ms',
  'Error: the sweep token is missing',
]);

// The app coming up somewhere other than where it was asked to: omega takes
// the next free port when its own is busy, and says so.
const BUMPED_APP = half([
  'Port 14300 was taken - bumped to 14301',
  'Dev server: https://localhost:14301',
]);

// The tower's own first line, in the kit's one shape: the glyph, then what it
// is doing.
const STARTING = /^✓ starting the dashboard$/;

// A half painting its log the way omega does once the tower forced its colors
// back on: the escapes land on the anchors the filter judges by. One set of
// escape constants serves the stub and the assertions both.
const RED = '\u001b[31m';
const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const OFF = '\u001b[0m';

const COLORED_APP = half([
  `${RED}omega: the monorepo src-to-dist watch is not running${OFF}`,
  `${CYAN}${OBJC_WARNING}${OFF}`,
  `${RED}Error: the board failed to load${OFF}`,
  'quiet chatter nobody typed the command for',
  `${CYAN}[web]${OFF} Using existing mkcert certificates`,
  `${CYAN}[web]${OFF} Dev server: ${GREEN}https://localhost:14300${OFF}`,
  'GET /index.html 200 in 12ms',
]);

// A half that reports the one thing the FORCE_COLOR cases are about: what it
// was handed. It writes that rather than printing it, since anything printed
// goes through the filter, and it names a URL so a pty run has something to
// wait for before it interrupts.
const probeStub = (dir) => {
  const seen = path.join(dir, 'force-color');
  const app = nodeCmd([
    "require('fs').writeFileSync(process.argv[1], process.env.FORCE_COLOR ?? 'unset');",
    "process.stdout.write('Dev server: https://localhost:14300\\n');",
    'setTimeout(() => {}, 30000);',
  ].join('\n'), seen);
  return { app, seen };
};

// A run under a real terminal. The tower's whole color decision is its stdout's TTY,
// which a piped run can never exercise - and piped is exactly the case that
// must stay plain, so the positive half of it only shows up here. The expect
// script starts the tower, waits for the announce, then ends the run the way a user does.
const ptyRun = (dir, app, env = {}) => {
  const script = path.join(dir, 'pty.exp');
  fs.writeFileSync(script, [
    `set timeout ${SPAWN_DEADLINE / 1000}`,
    `spawn {${process.execPath}} {${SCRIPT}}`,
    'expect -re "dashboard at"',
    'send \\003',
    'expect eof',
    '',
  ].join('\n'));
  const childEnv = {
    ...process.env, WORKKIT_TOWER_PORTS: QUIET_PORTS, WORKKIT_TOWER_API_CMD: HOLD, WORKKIT_TOWER_APP_CMD: app, ...guarded(env),
  };
  // These cases assert the tower's own decision, so an ambient FORCE_COLOR goes
  // first unless the case hands one in as the caller's.
  if (!('FORCE_COLOR' in env)) delete childEnv.FORCE_COLOR;
  return startHandle('expect', [script], { env: childEnv });
};

// The pty case needs a real terminal to send a real Ctrl-C down; expect is the
// only portable way to get one, and a machine without it says so rather than
// pretending the case ran. A skip value: false, or the reason.
const skipWithoutExpect = () => !which('expect') && 'expect is not installed';

// The skip value of a case that signals the starter. Windows has no TERM a
// process can answer: Node's kill there ends the starter at once, before it can
// end its halves or choose its own exit.
const skipOnWindowsTerm = () => IS_WINDOWS && 'Windows ends a process on TERM before it can answer the signal';

module.exports = {
  SCRIPT, cleanup, alive, until, pidIn, pidOnSight, start, standIn, nodeCmd, half, HOLD, nodeHalf, QUIET_PORTS,
  NOISY_APP, FAILURE_SHAPES, FAILING_APP, REFUSING_APP, REFUSING_API, ANNOUNCED_APP, ANNOUNCING_APP,
  BENIGN_APP, WEB_APP, PHASED_APP, CHATTY_API, BUMPED_APP, STARTING, RED, CYAN, OFF, COLORED_APP,
  probeStub, ptyRun, skipWithoutExpect, skipOnWindowsTerm,
};
