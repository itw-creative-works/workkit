# Tests

What a test in the kit must be worth and what it may cost, the one list every test-writing brief, the verifier's WORTH check and `safety:test-bar` point at; then the shape every repo's test runner keeps, and the runner the kit ships to keep it.

## The bar

### Worth

A case earns its place only if its failure means real behavior broke. Never:

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

Anything a builder can check once by looking (a file is there, a doc says X, a bit is set) is checked once and recorded in the `Proof:` line, never a test.

A removed feature gets no test at all: no test beats a tombstone, and the WORTH check reads a removed-thing case as a miss.

### Cost

- A case runs in-process through a seam when one exists, and spawns the real script only when the wiring is the thing under test.
- A world is built once per process through `seeded()` and copied per case.
- A scratch folder comes from `mkTmp()`.
- No fixed path, port or sleep, so the suite never needs the serial tail.
- A timing case asserts order, never a measured duration.
- A live probe sits behind a named flag and skips with its reason.

## The shape

What a repo's root runner does, whichever runner it is. The kit ships one that keeps it (below); a repo on another runner (a framework's own devkit runner, say) keeps the shape with its own.

- Each suite file runs in its own process, as many at once as the machine has cores less one, and its output prints whole, in sorted order, so two suites never interleave.
- A suite that touches a shared path (a fixed folder, a port) is named in the repo's serial list, with the path in a comment beside its entry; those suites run one at a time after the parallel wave. An entry that matches no suite fails the run, naming it, before any suite starts.
- A world is seeded once per process (`seeded()`) and copied per case.
- Every scratch folder comes through one seam (`mkTmp()`), which removes them all when the process exits.
- A suite or a case that cannot run here skips by name with its reason, and the run lists every skip after the totals.
- The run ends with one totals line, `N passed, M failed (Ns, K suites)`, with `, S suites skipped` and `, C cases skipped` after the failed count when there are any.
- The kit's runner then prints one more line, `slowest: <suite> <s>s, ...`, naming the five slowest suites of the run by wall time, slowest first.
- Any failure exits 1. A suite that fails to load, exports no runner, or dies without a result is one failure, named `load <suite>`, `export <suite>` or `run <suite>`.

### The kit's runner

It lives in the kit's engine folder: `workflow/test/run.js`, its library beside it in `workflow/test/lib/` (`harness.js`, `process.js`, `scratch.js`, `seed.js`, `suites.js`), so its engine address is `~/.claude/workkit/test/run.js`.

- `workkit test [paths]` runs it over the current repo: every `tests/**/*.test.js`, the parallel wave then the serial tail `tests/lib/serial.js` names (none without the file), then the mod half when `tests/mods/` holds `*.test.ts` suites; suite paths narrow the run, and a path matching no suite exits 1 naming it. It runs outside npm's script shell, so it records no tree: the run that proves one is still the root `npm test`.
- A repo's `npm test` stays `node tests/run.js`, a few lines that hand off to the kit's runner: the kit itself by a relative path into `workflow/`, every other repo through `WORKKIT_ENGINE` when it is set, else `~/.claude/workkit`.
- The repo's `tests/lib/harness.js`, `process.js`, `scratch.js`, `seed.js` and `suites.js` are each a re-export of the kit's file, so every suite's `require('../lib/harness')` stands as it is, and `tests/lib/` otherwise holds only the repo's own seams and its `serial.js`.
- CI has no kit checkout, so the checks template clones the public kit shallowly and exports `WORKKIT_ENGINE` to its `workflow/` folder, with no link, so a Windows runner can take the `WORKKIT_ENGINE` route too; in the kit itself the step does nothing.
- The standards heal names a participating repo whose test script reaches neither this runner nor one that prints the totals line (`workflow/README.md`, the `standards/` row).

### The budget

`tests.budget` is the whole minutes a repo allows its root run, set in the repo's `.workkit/settings.json` (or in `~/.workkit/settings.json` under the same key for every repo that sets none). The suite record carries the recorded run's wall time, and when a commit's recorded run took longer than the budget, the commit gate prints `test-budget: the root run took Nm, the budget is Mm` beside its proved line; the commit still passes. With no budget there is no line. The gate's side: `docs/hooks.md` § `safety:commit-gate`.
