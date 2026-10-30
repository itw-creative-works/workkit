# workkit-core

The test runner and test library of [workkit](https://github.com/itw-creative-works/workkit), as an npm package. It runs every suite in parallel worker processes, prints each suite's output whole and in order, and ends on one totals line.

## Use it

```sh
npm i -D workkit-core
```

Then set the repo's test script to the package's bin:

```json
{ "scripts": { "test": "workkit test" } }
```

`npm test` runs every `test/**/*.test.js` suite; `npm test -- test/x.test.js` runs only that file.
With the workkit plugin installed, `workkit test` and `workkit test test/x.test.js` in a terminal do the same: the global command hands its arguments to `npm test`, and inside `npm test` npm puts this package's bin first on PATH.
The bin runs only `test`; any other verb exits 2 and names the global `workkit` command it belongs to.

## The run

- Every `test/**/*.test.js` file is a suite, each run in its own process, as many at once as the machine has cores less one; a repo with no `test/` folder is read from `tests/`.
- A suite named in the repo's `test/lib/serial.js` (`module.exports = { SERIAL: ['x.test.js'] }`) runs alone, after the parallel wave.
- `test/mods/*.test.ts` suites run after that through `claude plugin test`, skipped by name with no `claude` on PATH.
- The run ends with `N passed, M failed (Ns, K suites)` and a `slowest:` line, then names every skipped suite and case, then every failure; any failure exits 1.
- A suite written on `node:test` runs too, through Node's own `run()`, counted the same way.

## The library

`workkit-core/test` is ES, and `require()` loads it as well:

```js
const { test, assertEq, summary, selfRun } = require('workkit-core/test');

const run = async () => {
  await test('adds', () => assertEq(1 + 1, 2));
  return summary();
};
module.exports = run;
if (require.main === module) selfRun(run);
```

- The cases: `group`, `test`, `assert`, `assertEq`, `skip`, `testUnless`, `skipSuite`, `summary`, `selfRun`, `log` (lines printed under a failing case, and under every case with `TEST_LOG=1`), `stripAnsi`, `hasLaunchd`.
- Scratch and worlds: `mkTmp(prefix)`, a temp folder removed at exit; `seeded(build)`, a folder built once per process and copied per case.
- Processes on one deadline (`SPAWN_DEADLINE`): `run`, `start` (with `end()` climbing SIGINT, SIGTERM, SIGKILL), `endTree`, `until`, `elapsedUntil`, `alive`, `readPid`.
- Suite discovery: `findSuites`, `findModSuites`, `POOL`.

What a test must be worth and may cost, and the shape every runner keeps: [docs/tests.md](https://github.com/itw-creative-works/workkit/blob/main/docs/tests.md).

## License

[FSL-1.1-MIT](https://github.com/itw-creative-works/workkit/blob/main/LICENSE.md), the same as workkit.
