# Tests

- What a test in the kit must be worth and what it may cost.
  - It is the one list every test-writing brief, the verifier's WORTH check and `safety:test-bar` point at.
- Then the shape every repo's test runner keeps, and the runner the kit ships to keep it.

## The bar

### Worth

- A case earns its place only if its failure means real behavior broke. Never:
  - a test of a test helper;
  - an expected value computed from the implementation;
  - a language or library guarantee;
  - a removed string's absence;
  - a file's existence or executable bit;
  - a regex over source, markup or stylesheet text;
  - a prose pin on a doc, skill, agent or prompt;
  - a wording or ANSI repeat of a case beside it;
  - a second case with the same break as a named one;
  - a case that only confirms a log line was written.
- Anything a builder can check once by looking is checked once and recorded in the `Proof:` line, never a test.
  - Examples: a file is there, a doc says X, a bit is set.
- A removed feature gets no test at all.
  - No test beats a tombstone.
  - The WORTH check reads a removed-thing case as a miss.

### Cost

- A case runs in-process through a seam when one exists, and spawns the real script only when the wiring is the thing under test.
- A world is built once per process through `seeded()` and copied per case.
- A scratch folder comes from `mkTmp()`.
- No fixed path, port or sleep, so the suite never needs the serial tail.
- A wait bound is the runner's shared deadline, or a short bound for a negative case.
  - The shared deadline is `SPAWN_DEADLINE`: the default bound of `until` and `elapsedUntil`, and the default `deadline` of `run` and `start`.
  - A short bound is passed to `until`, or as `deadline` to `run` or `start`.
  - `safety:test-bar` names a literal bound on write.
    - A literal inside quoted text (a fixture's or a child program's) is excepted.
- A timing case asserts order, never a measured duration.
- A live probe sits behind a named flag and skips with its reason.

## The shape

- What a repo's root runner does, whichever runner it is.
  - The kit ships one that keeps it (below).
  - A repo on another runner (a framework's own devkit runner, say) keeps the shape with its own.
- A suite is written on the kit harness, the preferred shape and the one a new repo uses.
  - The harness is `test/lib/harness.js`. Its async case runner is named `cases`.
  - The file exports it, or a wrapper calling it, returning `{passed, failed, failures, skips}`.
  - A suite on `node:test`, Node's built-in test library, is the second shape.
    - It is carried for a repo that already has it, as the kit's runner does (below).
- Each suite file runs in its own process, as many at once as the machine has cores less one.
  - Its output prints whole, in sorted order, so two suites never interleave.
- A suite that touches a shared path (a fixed folder, a port) is named in the repo's serial list.
  - The path goes in a comment beside its entry.
  - Those suites run one at a time after the parallel wave.
  - An entry that matches no suite fails the run, naming it, before any suite starts.
- A world is seeded once per process (`seeded()`) and copied per case.
- Every scratch folder comes through one seam (`mkTmp()`), which removes them all when the process exits.
- A suite or a case that cannot run here skips by name with its reason, and the run lists every skip after the totals.
- The run ends with one totals line, `N passed, M failed (Ns, K suites)`, with `, S suites skipped` and `, C cases skipped` after the failed count when there are any.
- The kit's runner then prints one more line, `slowest: <suite> <s>s, ...`, naming the five slowest suites of the run by wall time, slowest first.
- Under a failing case's message the kit's harness prints two things:
  - the first stack frame outside the harness (the suite's line, or the seam's when the assert sits in one);
  - the lines the case wrote through `log()`.
- With `TEST_LOG=1` a passing case's `log()` lines print too.
- A `log()` line written with no case running prints at once.
- A case's own prints (`console.log`, `console.error`, `process.stdout.write`, `process.stderr.write`) sit at the case indent.
- Any failure exits 1.
  - A suite that fails to load is one failure, named `load <suite>`.
  - So is one that exports no runner (and is no `node:test` file), named `export <suite>`.
  - So is one that dies without a result, named `run <suite>`.

### The kit's runner

- It is the npm package `workkit-core`, built in this repo at `packages/core/`.
  - It is a workspace member released at the kit's version.
- The package holds:
  - `test/run.js`;
  - `test/tools.js` (the `tools` verb);
  - its library beside them in `test/lib/` (`harness.js`, `lexer.js`, `log.js`, `node-test.js`, `process.js`, `scratch.js`, `seed.js`, `spawn.js`, `suites.js`);
  - the export `workkit-core/test`, the entry that carries the exports of every file but `node-test.js` and `lexer.js`;
  - plus `workkit-core/run`, the kit's `workflow/lib/run.js` its prepack copies in as `run.cjs`.
- It is ES, and a CommonJS suite `require()`s it alike.
- Its README (`packages/core/README.md`) lists the exports.
- A repo installs it with `npm i -D workkit-core` and sets `"test": "workkit test"`.
  - Inside `npm test`, npm puts `node_modules/.bin` first on PATH, so `workkit` is the package's bin.
  - The bin runs the runner over the repo with the arguments npm passes on.
  - The bin runs `test` and `tools`; any other verb exits 2, naming the global `workkit` command.
- `workkit test [paths]` in a terminal is the global command.
  - It hands its arguments to the repo's own `npm test`, run at the repo root, and does nothing else.
  - So the one recorder, npm's script shell, sees the run.
    - A narrowed run leaves the package record, a bare one the suite record.
    - A package's line in that record is keyed to its own id: the code it can see.
    - The rule: `docs/hooks.md` § `safety:proof-guard`, the package id bullet.
  - So `workkit test`, `npm test`, `workkit test test/x.test.js` and `npm test -- test/x.test.js` land in the same runner with the same arguments.
  - A repo whose package.json has no `test` script gets one error line and exit 1.
  - The global verb started inside an `npm test` means the package is missing.
    - It exits 1 with `workkit-core is not installed here: run npm install` rather than loop.
- A suite that runs a command a cloud session may lack names it at its top: `needs('hugo', 'ffmpeg')`.
  - Each is a command name looked up on PATH.
  - All found, it returns and prints nothing.
  - A missing one skips the suite in a cloud session (`CLAUDE_CODE_REMOTE=true`).
    - The run's skip line: `⊘ skipped: needs hugo, not installed in this cloud session`.
  - On a machine and in CI a missing one fails the suite, `needs hugo, not installed`.
    - So a missing tool is never a silent pass there.
  - A call with no argument or a non-string one fails the suite everywhere.
- `workkit tools` prints every command the repo's suites name through `needs()`.
  - It prints one per line, sorted and unique, for a cloud setup to install before the run.
  - It reads the suites the runner would run, never loads one.
  - A `needs()` argument that is not a string literal is one line, exit 1: `✖ tools: <file>:<line>: needs() takes string literals only`.
  - The global verb runs the kit's own copy of this bin at the repo root, so it answers before `npm install`.
- `start()`'s `end(signal)` climbs the shell's ladder (`wk_end_run`): `SIGINT` then `SIGTERM` then `SIGKILL`.
  - It starts from the rung named, and the rungs are 1.5 s apart.
  - Each rung is sent only while the child (a detached child's whole process group) still lives.
    - So `end('SIGKILL')` is one send.
  - On Windows it is one `taskkill` tree end.
  - A real signal the system refuses for the pid itself rejects `end()` (and throws from `endTree`), naming the pid and `EPERM`.
    - A refused group falls through to the pid, since a leader that exited unreaped refuses its group.
    - The zero probe reads a refused group as gone.
  - A target still alive one grace after `SIGKILL` rejects, naming it, so `end()` never waits unbounded.
  - On Windows, once a detached leader has exited, `end()` reaches no grandchild.
    - `taskkill /T` finds a tree only through a living root.
- It reads the repo's `test/` folder, Node's convention.
  - It reads `tests/` when the repo has no `test/`, so a repo not yet moved keeps running.
  - The standards heal names a `tests/` folder as drift, with `git mv tests test` as the fix.
- A run covers every `test/**/*.test.js`.
  - First the parallel wave, then the serial tail `test/lib/serial.js` names (none without the file).
  - Then the mod half, when `test/mods/` holds `*.test.ts` suites.
  - Suite paths narrow the run.
  - A path matching no suite exits 1, naming it and the folder read.
- Each suite file has a deadline, `SUITE_DEADLINE` (600 seconds).
  - `TEST_DEADLINE=<seconds>` in the environment sets it for one run.
    - A value that is no positive number, or above 2147483 (more than node's timer holds), exits 1 before any suite runs: `TEST_DEADLINE must be a positive number of seconds, got <value>`.
  - A worker not closed when it passes, and with no result sent, has its process group ended.
    - `endGroup` climbs `end()`'s ladder over the worker's process group, so a worker on `SIGINT` or `SIGTERM` runs its exit handlers and removes its scratch folders.
    - A child the suite starts detached leads its own group, so it is the suite's own to end.
    - Its file is one failure, `run <suite>`: `timed out after <n>s without a result; last output: ...`.
    - The run goes on to the next file and exits 1.
  - Off Windows a signal to the runner's group reaches no worker, so on `SIGINT`, `SIGTERM` or `SIGHUP` the runner ends every live worker's group the same way, then exits 128 plus the signal's number.
    - A second of the three while it is ending sends `SIGKILL` at once, before anything else runs, to every group the first began to end that still lives, its worker exited or not, then exits 128 plus that second signal's number.
      - So `workkit prove`'s ladder on the runner (`wk_end_run`) leaves no worker behind: its `SIGTERM` has the runner KILL every worker before its own `SIGKILL` comes.
    - A runner ended by `SIGKILL` cannot; a worker then ends its own tree only once its event loop notices the parent gone.
- It carries a second shape for a repo that already has suites on `node:test`.
  - A file that binds a runner from `node:test` runs through Node's own `run()` in the same worker.
    - A default, namespace or bare import binds one, as does a `require('node:test')` not destructured.
    - So does a named import or a destructure holding `test`, `it`, `describe` or `suite`, renamed or not.
    - A file whose every binding is another name (`mock`, `before`, `snapshot`) is a kit-harness suite.
    - A comment, a quoted string or a template literal never counts; an import over several lines reads as one.
    - The text is read, never required, since requiring it runs its tests.
  - Its pass, fail, skip and todo events fill the harness's result object.
  - So every line above prints for it unchanged.
- The repo's `test/lib/harness.js` is the one re-export: `module.exports = require('workkit-core/test')`.
  - So every suite's `require('../lib/harness')` stands as it is and reaches the whole library.
  - `test/lib/` otherwise holds only the repo's own seams and its `serial.js`.
- CI fetches the runner like any dependency.
  - The install brings the package, so no step clones the kit for it.
  - The heal's rewrite of `checks.yml` to the kit's caller drops the one an older copy carries.
- The standards heal names a participating repo whose test script does not run this runner.
  - It is one line: `npm i -D workkit-core` and `"test": "workkit test"`.
  - It is skipped when the repo's devDependencies name `workkit-core`, whatever its test script.
    - A script of the repo's own may wrap `workkit test` (`workflow/README.md`, the `standards/` row).

### The budget

- `tests.budget` is the whole minutes a repo allows its root run.
  - It is set in the repo's `.workkit/settings.json`.
  - Or in `~/.workkit/settings.json` under the same key, for every repo that sets none.
- The suite record carries the recorded run's wall time.
- When a commit's recorded run took longer than the budget, the commit gate prints a line beside its proved line.
  - The line: `test-budget: the root run took Nm, the budget is Mm`.
  - The commit still passes.
- With no budget there is no line.
- The gate's side: `docs/hooks.md` § `safety:commit-gate`.

### The checks

- The supervisor of a root `npm test`, of `workkit prove` and of a `workkit supervise` run reads its run at every check and judges it by evidence. The CI watch is not read: it waits on GitHub and ends by itself.
- `tests.check` is the minutes between checks, default 5, set where `tests.budget` is.
  - A value that is not a finite number above 0 stops the run before it starts: `detach: tests.check must be a number of minutes above 0 (got <value>)`, exit 2.
- Each check reads two things:
  - output: whether the run's log was written since the last check;
  - work: whether the run's processes used the processor since the last check.
- Within a check the processes are read every 5 seconds at most, and at least 4 times, so a child that lives a moment is still seen.
  - A process new since the read before counts as work, whatever its time.
  - Otherwise the processor time gained across the check's reads counts once it reaches 1 percent of one processor over the check's length.
  - On Linux a process's time includes the children it has waited for, so a short-lived child's time reaches its parent.
- The run's processes are the command and every process under it by parent, a child in its own session included.
  - The supervisor and its `caffeinate` are never among them.
- A read of the processes that fails puts one line in the log, `detach: could not read the run's processes (<message>), so the checks are off`, and the run goes on to its own end.
- The verdicts:
  - output or work: alive, and nothing happens;
  - neither, two checks in a row: frozen. The log gets the evidence, then the run is ended and exits 124.
  - no output for six checks in a row, with work among them: a look. The run goes on, and the call attached to it prints the evidence and exits 125.
- The evidence is one line per process seen in the check, `detach:   <pid> <seconds>s <command>`, the seconds those it used in the check.
- A frozen log ends `detach: no output and no processor use for <N> minutes, so the run was ended (exit 124)`, under the body's own `<prefix>: exit 143`.
- After a look, the next one is asked after six more checks with no output.
- An `end` file in the run's lock folder is read within a second and ends the run: its log ends `detach: the run was ended on request (exit 143)`, and the run exits 143.
  - Ctrl-C on the call that started the run writes that file, so the whole run ends and the call exits 130 (`workflow/README.md` § `lib/detach.sh`).
- Ending a run: each of its processes gets a terminate signal, and what still lives 10 seconds later a forced end.
  - A signal the system refuses is passed over, so every other process still gets its own.
  - An ended run exits with its own code once its whole tree is gone, never the code the command's exit would give.
- An end that fails, with the command still alive, records nothing: the log gets `detach: the run could not be ended (<message>), so it goes on`.
  - The `end` file is removed, and the run goes on to its own end. A later end request can try again.
  - The checks stay on, so a frozen run is tried again at its next frozen verdict.
  - With the command itself gone, the log gets the failure as `detach: <message>` (a refused signal: `detach: could not signal <pids> (<message>)`), then the closing line, and the code is recorded as always.
- A busy run is never ended, however long it takes.
- On macOS every supervised run holds the machine awake (`caffeinate -i`), so idle sleep does not pause it.
- On Windows no process is read, so there is no frozen and no look.
- The mechanics: `workflow/README.md` § `lib/detach.js`.
