// The shared prologue of the hooks/safety/proof-guard suites beside this one:
// the hook runner and the fixtures. The `gh` stub and the world with no `gh`
// are tests/lib/gh-stub.js, which spec-guard's suite shares.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, assertEq } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { SYSTEM_BASH, shellPath, homeEnv } = require('../../lib/platform');
const {
  cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, hookRunner,
} = require('../../lib/gh-stub');
const { mkTmp } = require('../../lib/scratch');
const { mkRosterHome } = require('../../lib/roster');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'proof-guard', 'run.sh');
// Every run keeps its records in a scratch TMPDIR, never this machine's own.
const runHook = hookRunner(HOOK, { TMPDIR: shellPath(mkTmp('proof-guard-tmp-')) });

/**
 * The runner with TMPDIR at <tmp>, for a case that reads its own records, and
 * from <home> when given, for a case whose roster the hook must read.
 */
const runHookIn = (tmp, home = null) => hookRunner(HOOK, { TMPDIR: shellPath(tmp) }, home);

/** The `comments` value gh answers with, one comment per body. */
const comments = (...bodies) => bodies.map((body) => ({ body }));

// One issue with a proof, one without, in every world.
const WORLD = {
  field: 'comments',
  issues: { 7: comments('Proof: unit: node tests/hooks/x.test.js'), 9: comments('looks good to me') },
};

const QA = 'gh issue edit 3 --remove-label status:building --add-label status:qa';

// Each fixture test file appends to runs.log at its repo root, <depth> folders
// above the file's own, so a case counts runs.
const runLog = (depth) => `require('fs').appendFileSync(require('path').join(__dirname, ${"'..', ".repeat(depth)}'runs.log'), 'ran\\n');`;
const RUN_LOG = runLog(1);
// A green fixture registers one node:test case, so the run proves it.
const GREEN = `require('node:test').test('green', () => {});\n${RUN_LOG}\n`;
const RED = `require('node:test');\n${RUN_LOG}\nprocess.exit(1);\n`;
// Another runner's describe/it file: node --test runs it, logging a run, and
// with no describe defined it throws, so the run is red and blocks the flip.
const DESCRIBE = `${RUN_LOG}\ndescribe('x', () => { it('y', () => {}); });\n`;
// A module that only exports its cases: it runs green, logging a run, but
// registers no test, so the flip names it as not proved and never counts it.
const EXPORTS = `${RUN_LOG}\nmodule.exports = { tests: [] };\n`;
const UNPROVED = 'Registered no test under node --test, so not proved (a module that only exports its cases):';
// The notice names <file> after the not-proved phrase.
const namesUnproved = (msg, file) => msg.includes(UNPROVED) && msg.indexOf(file, msg.indexOf(UNPROVED)) > -1;

// Fixture git runs in a scratch home, so the developer's gitconfig never
// shapes a fixture; every commit names its own identity.
const FIXTURE_HOME = mkTmp('proof-guard-');
const COMMIT = '-c user.name=test -c user.email=test@example.com commit -q';
const git = (dir, args) => execSync(`git ${args}`, {
  cwd: dir, encoding: 'utf8', stdio: 'pipe', shell: SYSTEM_BASH, env: homeEnv(FIXTURE_HOME, { PATH: process.env.PATH }),
});
const write = (dir, name, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
};
const runs = (dir) => {
  const file = path.join(dir, 'runs.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
};

// A repo on `main` with a test script and one committed green test file.
const mkQaRepo = () => {
  const dir = mkTmp('proof-guard-');
  git(dir, 'init -q');
  git(dir, 'symbolic-ref HEAD refs/heads/main');
  write(dir, 'package.json', `${JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } })}\n`);
  write(dir, 'tests/a.test.js', GREEN);
  git(dir, 'add -A');
  git(dir, `${COMMIT} -m seed`);
  return dir;
};

// A fixture repo whose origin is <origin>, the other repo a cross-repo flip names.
const mkOtherRepo = (origin) => {
  const dir = mkQaRepo();
  git(dir, `remote add origin ${origin}`);
  return dir;
};

// One fixture repo and one gh stub per case, both removed after it.
const qaCase = (name, body) => test(name, () => {
  const dir = mkQaRepo();
  const stub = makeGhStub(WORLD);
  try {
    body(dir, stub);
    assertEq(ghCalls(stub).length, 0, `a qa flip reads no issue, got: ${fmtCalls(ghCalls(stub))}`);
  } finally {
    cleanup(dir);
    cleanup(stub.dir);
  }
});

// The notice a hook exiting 0 is heard by, off its stdout JSON.
const notice = (out) => {
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', 'the event name the harness expects');
  assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage, 'the user and the model hear the same line');
  return parsed.systemMessage;
};

module.exports = {
  HOOK, cleanup, makeGhStub, ghCalls, pathWithoutGh, dropPathWithoutGh, runHook, runHookIn, WORLD, comments,
  QA, runLog, RUN_LOG, GREEN, RED, DESCRIBE, EXPORTS, UNPROVED, namesUnproved, COMMIT, git, write, runs, mkQaRepo,
  qaCase, notice, mkOtherRepo, mkRosterHome,
};
