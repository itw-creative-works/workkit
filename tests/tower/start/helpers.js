//
// The shared prologue of the tower/start.sh suites, the `*.test.js` files
// beside this one, which test the one command that runs the whole tower one
// concern each. A plain module, never a suite: the runner only loads files
// ending in `.test.js`.
//
// The script is run for REAL, but with both server commands injected
// (WORKKIT_TOWER_API / WORKKIT_TOWER_APP), so no port is opened and no
// framework toolchain is needed: each stub records its own pid and sleeps,
// and the assertions are about lifecycles - both start, one interrupt ends
// both, and one process ending takes the other with it.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { testUnless } = require('../../lib/harness');
const { IS_WINDOWS, BASH, NO_RC, shellPath, which } = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'tower', 'start.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-start-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Poll until the predicate holds or the deadline passes - the script's own
// down-taker polls at one-second ticks, so lifecycle assertions wait for it.
const until = async (predicate, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
};

const readPid = (file) => Number(fs.readFileSync(file, 'utf8').trim());

// The port takeover is aimed at nothing unless a test says otherwise, so a
// run here never touches whatever this machine really has on 8693/4300.
const start = (dir, api, app, ports = '', { args = [], env = {}, capture = false } = {}) => {
  const childEnv = {
    ...process.env, WORKKIT_TOWER_API: api, WORKKIT_TOWER_APP: app, WORKKIT_TOWER_PORTS: ports, ...env,
  };
  // A FORCE_COLOR the OUTER shell exported would pass through the script
  // untouched - spec-correct, and a red herring to every case that asserts
  // what the tower itself decides. The caller-owned path has its own pty case.
  if (!('FORCE_COLOR' in env)) delete childEnv.FORCE_COLOR;
  return spawn(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    env: childEnv,
    stdio: ['ignore', capture ? 'pipe' : 'ignore', capture ? 'pipe' : 'ignore'],
    cwd: dir,
  });
};

// The stand-in listener the port cases hand the wrapper. It is node's own, and
// `console.log(<number>)` PAINTS a number once FORCE_COLOR is set - which the
// outer shell may well have exported. The port would then arrive wrapped in
// escapes, the reclaim pass would look up a port that does not exist, and the
// stand-in would ride out the whole run untouched. So the ambient value goes
// first here too, the way start() drops it for the halves.
const standIn = (code) => {
  const childEnv = { ...process.env };
  delete childEnv.FORCE_COLOR;
  return spawn(process.execPath, ['-e', code], { env: childEnv, stdio: ['ignore', 'pipe', 'ignore'] });
};

// What the user actually sees: both streams of a captured run, in one string.
const collect = (child) => {
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { out += chunk.toString(); });
  return () => out;
};

// The ports the output tests hand the wrapper: high and unused, so the reclaim
// pass finds nothing and this machine's real tower is never touched.
const QUIET_PORTS = '18693 14300';

// A stand-in for the dev server's log wall - the chatter someone who typed
// `workkit tower` did not ask for, the two lines that matter, the one the
// framework says in its own voice (kept since #170), and the URL omega
// announces twice (its https proxy, then the dev server itself).
const NOISY_APP = [
  "echo 'omega: no cloudflare account id configured, skipping'",
  "echo 'compiled 42 files in 1.2s'",
  "echo 'HTTPS proxy listening on https://localhost:14300'",
  "echo 'Dev server: https://localhost:14300'",
  "echo 'WARN missing key: analytics'",
  "echo 'Error: the board failed to load' >&2",
  'exec sleep 30',
].join('; ');

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

const FAILING_APP = [...FAILURE_SHAPES.map((line) => `echo '${line}'`), 'exec sleep 30'].join('; ');

// A boot omega REFUSES (#170), the way it really prints one: its own prefix on
// every line, not one of them carrying a keep-net word, then an exit. The old
// filter dropped all of it and the run ended on a blank terminal.
const REFUSING_APP = [
  "echo 'omega: the monorepo src-to-dist watch is not running'",
  "echo 'omega: dist is not built - start the watch in the monorepo root first'",
  'exit 1',
].join('; ');

// The same shape on the API side, so the line that names the half is reading
// which one ended rather than saying "app" every time.
const REFUSING_API = ["echo 'omega: linked packages are read-only'", 'exit 1'].join('; ');

// A half that ends AFTER the dashboard was announced: the run got what it came
// for, so its ending is an ordinary shutdown and needs no explaining.
const ANNOUNCED_APP = ["echo 'Dev server: https://localhost:14300'", 'sleep 0.3'].join('; ');

// The same announce, on a half that then stays up - a tower doing its job,
// waiting for whatever ends it from the outside.
const ANNOUNCING_APP = ["echo 'Dev server: https://localhost:14300'", 'exec sleep 30'].join('; ');

// The macOS duplicate-library warning as it really arrives - two bundled copies
// of glib in the framework's own node_modules, and the word "failures" that
// carries it through the keep net.
const OBJC_WARNING = 'objc[77855]: Class GNotificationCenterDelegate is implemented in both '
  + '/Users/me/dev/omega/node_modules/sharp/build/Release/libvips-cpp.8.18.3.dylib (0x10ff3c2a8) and '
  + '/Users/me/dev/omega/node_modules/canvas/build/Release/libgio-2.0.0.dylib (0x1103b8180). '
  + 'This may cause spurious casting failures and mysterious crashes. '
  + 'One of the duplicates must be removed or renamed.';

// The lines the keep net catches on WORDING alone (#158) - that warning and a
// passing check summary ("failed", "warned") - beside the two that must survive
// them: a summary reporting real failures, and one with ten of them, which the
// digit guard must not read as the zero it exempts.
const BENIGN_APP = [
  `echo '${OBJC_WARNING}'`,
  "echo '  Results:   6 passed, 0 failed, 1 warned, 20 skipped'",
  "echo '  Results:   4 passed, 2 failed, 1 warned, 20 skipped'",
  "echo '  Results:   4 passed, 10 failed, 1 warned, 20 skipped'",
  "echo 'Error: the board failed to load' >&2",
  'exec sleep 30',
].join('; ');

// The app half's two phases in one run (#158), the way omega really prints
// them: the manage cycle first - including the bracketed `[11ty]` lines of its
// embedded build, which are NOT the web target and must not open the phase -
// then the dev server, every line of it tagged `[web]` at column 0 from its
// first boot line on. The tag is the boundary; the URL arrives later and still
// gets its announce, beside its own raw line rather than instead of it.
const WEB_APP = [
  "echo '[11ty] Wrote 87 files in 1.24 seconds'",
  "echo 'some manage step'",
  "echo '[web] Using existing mkcert certificates'",
  "echo '[web] Dev server: https://localhost:14300'",
  `echo '${OBJC_WARNING}'`,
  "echo '[web] watching for changes'",
  'exec sleep 30',
].join('; ');

// The fallback the trigger keeps (#158): an app that never tags a line still
// switches at the URL it names - the framework's boot wall, the URL line that
// ends it, then the dev server actually serving. Only what comes after the
// boundary belongs on the terminal - minus the drop list, which outlives it.
const PHASED_APP = [
  "echo 'omega: some build step'",
  "echo 'copying 12 assets'",
  "echo 'Dev server: https://localhost:14300'",
  "echo 'GET /index.html 200 in 12ms'",
  `echo '${OBJC_WARNING}'`,
  "echo '  Results:   6 passed, 0 failed, 1 warned, 20 skipped'",
  "echo 'GET /assets/app.css 200 in 3ms'",
  'exec sleep 30',
].join('; ');

// The API half owns no port, so it never announces and never leaves the quiet
// phase - not on a line of its own carrying a URL, and not on one wearing the
// app's `[web]` tag either. Its ordinary chatter is the wall nobody asked for,
// first line to last.
const CHATTY_API = [
  "echo '[web] hello'",
  "echo 'api: listening on http://127.0.0.1:18693'",
  "echo 'api: board sweep done in 240ms'",
  "echo 'Error: the sweep token is missing'",
  'exec sleep 30',
].join('; ');

// The app coming up somewhere other than where it was asked to: omega takes
// the next free port when its own is busy, and says so.
const BUMPED_APP = [
  "echo 'Port 14300 was taken - bumped to 14301'",
  "echo 'Dev server: https://localhost:14301'",
  'exec sleep 30',
].join('; ');

// A half painting its log the way omega really does once the tower has forced
// its colors back on (#179). The escapes land on the very anchors the filter
// judges by - the `omega: ` prefix and the `objc[` one at column 0, the `[web]`
// tag, the URL - so a filter reading the raw line sees an escape where it
// expects the anchor: the refusal and the tag stop matching, and the drop list
// stops recognising the warning it exists to drop. One set of escape constants
// serves the stub and the assertions both, so what is read back off the
// terminal is compared against exactly what was printed into it.
// The tower's own first line, in the kit's one shape (issue #237): the glyph,
// then what it is doing.
const STARTING = /^✓ starting the dashboard$/;

const RED = '\u001b[31m';
const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const OFF = '\u001b[0m';

const COLORED_APP = [
  `printf '${RED}omega: the monorepo src-to-dist watch is not running${OFF}\\n'`,
  `printf '${CYAN}${OBJC_WARNING}${OFF}\\n'`,
  `printf '${RED}Error: the board failed to load${OFF}\\n'`,
  "printf 'quiet chatter nobody typed the command for\\n'",
  `printf '${CYAN}[web]${OFF} Using existing mkcert certificates\\n'`,
  `printf '${CYAN}[web]${OFF} Dev server: ${GREEN}https://localhost:14300${OFF}\\n'`,
  "printf 'GET /index.html 200 in 12ms\\n'",
  'exec sleep 30',
].join('; ');

// A half that reports the one thing the FORCE_COLOR cases are about: what it
// was handed. It WRITES that rather than printing it, since anything printed
// goes through the filter, and it names a URL so a pty run has something to
// wait for before it interrupts.
const probeStub = (dir) => {
  const seen = path.join(dir, 'force-color');
  const stub = path.join(dir, 'probe.sh');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    `printf '%s' "\${FORCE_COLOR-unset}" > '${shellPath(seen)}'`,
    "echo 'Dev server: https://localhost:14300'",
    'exec sleep 30',
    '',
  ].join('\n'));
  return { app: `bash '${shellPath(stub)}'`, seen };
};

// A run under a REAL terminal. The tower's whole color decision is `[ -t 1 ]`,
// which a piped run can never exercise - and piped is exactly the case that
// must stay plain, so the positive half of it only shows up here. The expect
// script waits for the announce and then ends the run the way a user does.
const ptyRun = (dir, app, exports = []) => {
  const runner = path.join(dir, 'runner.sh');
  const script = path.join(dir, 'pty.exp');
  fs.writeFileSync(runner, [
    '#!/usr/bin/env bash',
    // The suite may itself run under a shell that exports FORCE_COLOR; these
    // cases assert the tower's own decision, so the ambient value goes first.
    'unset FORCE_COLOR',
    `export WORKKIT_TOWER_PORTS='${QUIET_PORTS}'`,
    "export WORKKIT_TOWER_API='exec sleep 30'",
    `export WORKKIT_TOWER_APP="${app}"`,
    ...exports,
    `exec bash '${shellPath(SCRIPT)}'`,
    '',
  ].join('\n'));
  fs.writeFileSync(script, [
    'set timeout 20',
    `spawn bash ${shellPath(runner)}`,
    'expect -re "dashboard at"',
    'send \\003',
    'expect eof',
    '',
  ].join('\n'));
  return spawn('expect', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
};

// The pty case needs a real terminal to send a real Ctrl-C down; expect is the
// only portable way to get one, and a machine without it says so rather than
// pretending the case ran.
const hasExpect = () => Boolean(which('expect'));

// A case that asks whether a HALF is still running. The stub records itself
// with the shell's `$$`, which under Git Bash is an MSYS id Node cannot ask
// about: process.kill() throws for a shell that is demonstrably alive, so the
// question answers about nothing on that machine.
const pidTest = testUnless(IS_WINDOWS, 'a Git Bash $$ is an MSYS id, not a pid Node can query');

module.exports = {
  SCRIPT, mkTmp, cleanup, alive, until, readPid, start, standIn, collect, QUIET_PORTS,
  NOISY_APP, FAILURE_SHAPES, FAILING_APP, REFUSING_APP, REFUSING_API, ANNOUNCED_APP, ANNOUNCING_APP,
  BENIGN_APP, WEB_APP, PHASED_APP, CHATTY_API, BUMPED_APP, STARTING, RED, CYAN, OFF, COLORED_APP,
  probeStub, ptyRun, hasExpect, pidTest,
};
