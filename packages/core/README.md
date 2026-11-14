# workkit-core

- The test runner and test library of [workkit](https://github.com/itw-creative-works/workkit), as an npm package.
- It runs every suite in parallel worker processes, prints each suite's output whole and in order, and ends on one totals line.

## Use it

```sh
npm i -D workkit-core
```

- Then set the repo's test script to the package's bin:

```json
{ "scripts": { "test": "workkit test" } }
```

- `npm test` runs every suite in the repo; `npm test -- test/x.test.js` runs only that file.
- With the workkit plugin installed, `workkit test` and `workkit test test/x.test.js` in a terminal do the same.
  - The global command hands its arguments to `npm test`.
  - Inside `npm test`, npm puts this package's bin first on PATH.
- `workkit tools` prints every command the suites name through `needs()`, one per line, sorted and unique.
  - So a cloud setup can install them.
  - It reads the suites without loading one.
  - A `needs()` argument that is not a string literal is one `✖ tools: <file>:<line>: needs() takes string literals only` line, exit 1.
- `workkit convert [paths...]` rewrites each suite in the old shape (an exported runner function on the removed words) in place onto Node's test functions through `workkit-core/test`.
  - No path means every suite the run would find; a path is read as the run reads one, and one naming no suite is `No suite matches <arg>`, exit 1, before any file is touched.
  - It prints `converted <path> (<n> cases)` (`(1 case)` for one), or `left <path>:<line> <why>` with the file left byte for byte, and exits 0 once it ran.
  - It leaves a removed word with no mapped form, likeliest of all (`failureOf`, `stripAnsi`, the harness `log`), or a local named like one, as `uses <word>, which has no mapped form here`.
    - `failureOf` becomes `expect(fn).toThrow(...)` or `await expect(promise).rejects...` from `workkit-core/test`.
  - It also leaves cases made in a loop, an awaited line or a helper call between cases, a whole-file skip, and a backtick inside a template's placeholder (`a template literal nested in another template's placeholder`).
  - And a constant or same-file alias one group declares and a later one reads (`<name>, a constant of an earlier group, read in a later one`), and, as a last guard, a text that would hold an `expect` with no matcher.
  - So a repo runs it, then converts by hand each file it lists. The mapping in full: [docs/tests.md](https://github.com/itw-creative-works/workkit/blob/main/docs/tests.md).
- The bin runs only `test`, `tools` and `convert`; any other verb exits 2 and names the global `workkit` command it belongs to.
  - With the workkit plugin installed, the global `workkit tools` and `workkit convert` run the plugin's own copy of this bin at the repo root.

## The run

- A suite is a file named `*.test.js`, `*.test.mjs` or `*.test.cjs`, anywhere under the folder the run starts in, the package root under `npm test`.
  - Each runs in its own process, as many at once as the machine has cores less one.
  - Never read: `node_modules`, a file or folder whose name starts with `.` or `_`, and a file git ignores.
  - Nor a folder below the start folder that holds its own `package.json`: a nested package runs its own suites.
  - A start folder inside a git-ignored folder, at any depth, holds no suite.
  - Outside a git work tree, or with no `git` on the PATH, nothing is skipped as ignored. Any other git failure stops the run with git's message.
  - No folder name is special: `test/`, `tests/` and `lib/` are read like any other.
  - A suite's printed name is its path from the start folder, with `/` on every platform (`test/hooks/x.test.js`).
- A suite named in the repo's `test/lib/serial.js` (`module.exports = { SERIAL: ['test/x.test.js'] }`) runs alone, after the parallel wave.
  - An entry is a path from the start folder, with either separator.
- A path after `--` is read from the start folder too, a `\` in it read as `/`.
- A path or a serial entry that names no suite fails the run before any suite starts.
  - A path prints `No suite matches <arg>`, a serial entry `No suite matches <entry> (test/lib/serial.js)`.
- A folder with no suite fails the run: `No test file found (*.test.js, *.test.mjs, *.test.cjs)`.
- `test/mods/*.test.ts` suites run after that through `claude plugin test`, skipped by name with no `claude` on PATH.
- The run ends with `N passed, M failed (Ns, K suites)` and a `slowest:` line, then names every skipped suite and case, then every failure; any failure exits 1.
- Each suite file has a deadline of 600 seconds (`SUITE_DEADLINE`); `TEST_DEADLINE=<seconds>` sets it for one run.
  - A worker still running with no result when it passes has its process group ended, and its file is one failure, `run <suite>`: `timed out after <n>s without a result; last output: ...`.
    - A child the suite starts detached leads its own group, so it is the suite's own to end.
  - A `TEST_DEADLINE` that is no positive number, or above 2147483 (more than node's timer holds), fails the run before any suite starts.
  - Once the suite's own process exits, the worker waits one grace for its output to close, then reports; a child the suite left running is left alive.
  - A suite whose own process stays alive (an open server) waits for the deadline. So a case closes what it opens in `t.after` or an `after` hook.
- Every suite runs on Node's own runner, through its `run()`; no file's text is read to pick a shape.
  - Its block heads a case with its `describe` path, `[outer › inner]`, and prints one line per case: `✓ name`, `✗ name`, or `⊘ name: reason` for a skip or a todo.
  - Under a failed case: its message and the first stack frame in the suite file. A failed hook prints its thrown message.
  - A case's `t.diagnostic()` lines and its own prints sit under it at the case indent; Node's own totals lines never print.
  - A skipped `describe` prints one `⊘` line for all its cases.
  - A test holding a failing subtest counts one failure, the subtest's; a passing one counts beside its subtests.
  - The failure and skip lists name a case `<suite> › <describe path> › <case>`.
- A suite that fails whole is one failure:
  - `load <suite>`: it died of an uncaught error, or would not parse, before any case ran (Node's own report, never a line the suite printed);
  - `run <suite>`: a late failure after its cases, an exit or a signal, an exit before its cases are reported (`exited with code 0 without a result`, the cases counted kept), its output held open by a process it started, or the deadline, each with its message;
  - `empty <suite>`, `registered no test`: it registered no case, or its process exited before Node reported any (a first case calling `process.exit(0)`).
  - A suite in the old shape fails as `load` or `empty` and counts no pass.
- A run a case starts (`workkit test` in a scratch folder) is a run of its own: the runner drops `NODE_TEST_CONTEXT`, under which Node's runner runs nothing.
  - A case that starts a suite file with `node <file>` passes an env without that variable.

## The library

- `workkit-core/test` is ES, and `require()` loads it as well. A suite is Node's own shape, and runs alone with `node <file>`:

```js
const fs = require('node:fs');
const path = require('node:path');
const {
  describe, test, before, expect, mkTmp, needs,
} = require('workkit-core/test');

describe('notes', () => {
  let dir;
  before(() => { dir = mkTmp('notes-'); });

  test('a written note reads back', (t) => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    t.diagnostic(`wrote ${path.join(dir, 'a.txt')}`);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hello');
  });
});

describe('render', { skip: needs('ffmpeg') }, () => {
  test('encodes a frame', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- A `describe` body runs when the file is collected, before any case: setup that must run between cases lives in a hook or in the case.
- The cases: Node's own `describe`, `before`, `after`, `beforeEach`, `afterEach` and `mock`, and `test` and `it`, Node's behind one thin wrap.
  - A case that states no `timeout` gets `CASE_DEADLINE`, 120000 ms; one that states its own keeps it.
  - `test.skip`, `test.todo`, `test.only` and every other property of Node's word are Node's own.
  - The wrap's limits: a case marked `.only` or `.todo`, and one stating `timeout: null`, get no default; a subtest inherits its parent's limit.
  - Under `node <file>`, Node's reporter names the wrap's file as a case's location; the kit runner's failure frame names the suite's line.
- A skip is Node's `skip` option, its value `false` or the reason text, never another falsy value: `false` and `undefined` run the case, `true` or a reason skips it.
  - For `''`, `0` or `null`, Node runs a case's body anyway and labels it skipped, and on a `describe` it cancels the children, which fails the run.
  - `needs(...tools)`: `false` when every command is on PATH. With one missing, a cloud session (`CLAUDE_CODE_REMOTE` is `true`) gets the reason, `needs <tool>` (several: `needs hugo, ffmpeg`).
    - Anywhere else, CI included, it throws `needs <tool>, not installed`, never a quiet skip.
    - At the top level (an outer `describe`'s `skip`, or a bare statement) the file fails as it is collected (`load <suite>`). In a case's `skip` inside a `describe`, the throw fails that `describe` and cancels its other cases.
    - A bare `needs('hugo');` statement throws the same way outside a cloud session; in one it does nothing, so the value goes in a `skip` option.
  - `hasLaunchd()`: whether this machine runs launchd.
- Printing: `indentRest` and `indentWriter`, a quoted text or a child's output kept off column zero, at `CASE_INDENT`. A case's own note is Node's `t.diagnostic()`.
- Scratch and worlds: `mkTmp(prefix)`, a temp folder removed at exit; `seeded(build)`, a folder built once per process and copied per case.
- The runner's per-file deadline: `SUITE_DEADLINE`; the grace it waits for a suite's output after its exit: `PIPE_GRACE_MS`.
- Processes on one deadline (`SPAWN_DEADLINE`): `run`, `start` (with `end()` climbing SIGINT, SIGTERM, SIGKILL), `endTree`, `endGroup` (the same ladder over a detached leader's group), `groupLives` (whether that group still has a member), `until`, `elapsedUntil`, `alive`, `readPid`, `pidIn` (the pid a file holds, or 0 while it is absent, empty or not yet a whole number).
  - `endTree(pid, signal, seams)` on Windows runs `taskkill.exe` from `System32` under `SystemRoot`, never through PATH, and throws when it cannot start. Its seams are the platform, the program runner and `SystemRoot`.
  - `alive(pid)` is false for anything but a positive integer.
- Suite discovery: `findSuites(root)` (every suite under the start folder, absolute paths, sorted), `suiteName(root, file)` (its printed name), `modDir(root)` (`<root>/test/mods`), `findModSuites(dir)`, `POOL`.
- Assertions: `expect(actual, message?)`, with Jest's names and behaviour (its `expect` 29.7) plus Vitest's `toBeTypeOf`.
  - The matchers: `toBe`, `toEqual`, `toStrictEqual`, `toMatchObject`, `toBeTruthy`, `toBeFalsy`, `toBeDefined`, `toBeUndefined`, `toBeNull`, `toBeNaN`, `toContain`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toBeInstanceOf`, `toBeTypeOf`.
  - Then `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeCloseTo` and `toThrow`.
  - The forms: `.not`, `.resolves`, `.rejects`, and `.not` after either of the last two.
  - A failed matcher throws an `Error` named `AssertionError` that carries `actual` and `expected`.
    - Its message is `expected <actual> to <verb> <expected>`, `not to` under `.not`, led by `<message>: ` when one was given.
  - A misused matcher (a value of the wrong kind, a length that is no whole number) throws an `AssertionError` too, under `.not` as well.
  - `expect.fail(message)` throws the `AssertionError` with that message.
  - `expect.extend(matchers)` adds matchers, each `(actual, ...args) => ({ pass, message })`, `message` a function returning the failure text.
    - Inside one, `this.isNot` and `this.promise` (`''`, `'resolves'` or `'rejects'`) say how it was called. A built-in's name throws.
  - It has no asymmetric matchers (`expect.any`), snapshots or mocks.

- `workkit-core/run` is the kit's program starter (`spawnSync`, `spawn`, `execFileSync`, `launchOf`, `windowsQuoted`), CommonJS.
  - It is `child_process`'s calls, with the real Windows launch of a bare name, a `#!` script or a `.cmd`.
- What a test must be worth and may cost, and the shape every runner keeps: [docs/tests.md](https://github.com/itw-creative-works/workkit/blob/main/docs/tests.md).

## License

- [FSL-1.1-MIT](https://github.com/itw-creative-works/workkit/blob/main/LICENSE.md), the same as workkit.
