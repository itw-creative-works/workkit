// The shared prologue of the hooks/safety/proof-guard suites beside this one:
// the hook runner, the fixture repos and the two proved-tree records the park
// reads. The `gh` stub and the world with no `gh` are tests/lib/gh-stub.js,
// which spec-guard's suite shares.

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
const { treeHash, plantRecord, plantPkgRecord } = require('../../lib/suite-record');

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

// A test file that would fail if run, leaving ran.flag beside itself, so a
// case proves the park ran nothing.
const RED = "require('fs').writeFileSync(require('path').join(__dirname, 'ran.flag'), '');\nprocess.exit(1);\n";

/** True when no fixture file under <dir> ever ran, read off the flags they leave. */
const ranNothing = (dir) => !fs.readdirSync(dir, { recursive: true }).some((p) => path.basename(String(p)) === 'ran.flag');

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

/** Touch <name> in <dir> as a test file that would fail if run. */
const touch = (dir, name) => write(dir, name, `${RED}// touched\n`);

/** A package at <pkg> declaring <script> as its test script, committed. */
const addPkg = (dir, pkg, script = 'node --test') => {
  write(dir, `${pkg}/package.json`, `${JSON.stringify({ name: path.basename(pkg), scripts: { test: script } })}\n`);
  git(dir, 'add -A');
  git(dir, `${COMMIT} -m ${path.basename(pkg)}`);
};

// A repo on `main` with a test script and one committed test file.
const mkQaRepo = () => {
  const dir = mkTmp('proof-guard-');
  git(dir, 'init -q');
  git(dir, 'symbolic-ref HEAD refs/heads/main');
  write(dir, 'package.json', `${JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } })}\n`);
  write(dir, 'tests/a.test.js', RED);
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

// A qaCase with its own TMPDIR, so the records it plants are its own;
// flip(command, cwd, path) runs the hook from the fixture repo by default.
const recordCase = (name, body) => test(name, () => {
  const dir = mkQaRepo();
  const tmp = mkTmp('proof-guard-tmp-');
  const stub = makeGhStub(WORLD);
  const runIn = runHookIn(tmp);
  try {
    body({ dir, tmp, stub, flip: (command = QA, cwd = dir, envPath = null) => runIn(command, stub, cwd, envPath) });
    assertEq(ghCalls(stub).length, 0, `a qa flip reads no issue, got: ${fmtCalls(ghCalls(stub))}`);
  } finally {
    for (const d of [dir, tmp, stub.dir]) cleanup(d);
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
  QA, RED, ranNothing, COMMIT, git, write, touch, addPkg, mkQaRepo, mkOtherRepo, mkRosterHome,
  treeHash, plantRecord, plantPkgRecord, qaCase, recordCase, notice,
};
