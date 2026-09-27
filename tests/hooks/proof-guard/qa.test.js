// Tests for hooks/safety/proof-guard at the flip to status:qa: the hook runs
// the touched test files with `node --test`, and a red one blocks the flip.
// Each fixture test file appends to runs.log at its repo root, so a case counts runs.
// The shared prologue (the hook runner, the gh stub, the fixtures) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  SYSTEM_BASH, shellPath, basePathWithout, joinPath, homeEnv,
} = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeGhStub, ghCalls, dropPathWithoutGh, runHook, WORLD,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

const REPO = path.join(__dirname, '..', '..', '..');
const QA = 'gh issue edit 3 --remove-label status:building --add-label status:qa';

const RUN_LOG = "require('fs').appendFileSync(require('path').join(__dirname, '..', 'runs.log'), 'ran\\n');";
// The fixtures name node:test, so the flip reads them as files it can prove.
const GREEN = `require('node:test');\n${RUN_LOG}\n`;
const RED = `require('node:test');\n${RUN_LOG}\nprocess.exit(1);\n`;
// Shapes node --test cannot prove: another runner's describe/it file, and a
// module that only exports its cases. Each would log a run if it were executed.
const DESCRIBE = `${RUN_LOG}\ndescribe('x', () => { it('y', () => {}); });\n`;
const EXPORTS = `${RUN_LOG}\nmodule.exports = { tests: [] };\n`;
// A self-running suite, the shape this repo's own suites take.
const SELF_RUN = `${RUN_LOG}\nconst run = () => 0;\nif (require.main===module) process.exit(run());\n`;
const UNPROVABLE = 'node --test cannot prove a file that neither names node:test nor runs itself';

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

// The notice a hook exiting 0 is heard by, off its stdout JSON.
const notice = (out) => {
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', 'the event name the harness expects');
  assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage, 'the user and the model hear the same line');
  return parsed.systemMessage;
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

const run = async () => {
  group('proof-guard: the flip to status:qa');

  await qaCase('a red touched test file: exit 2, naming the file and its last lines', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 2, `a red touched test blocks the flip, got: ${out.stderr}`);
    for (const want of ['proof-guard', 'status:qa', 'tests/a.test.js', 'Last lines:']) {
      assert(out.stderr.includes(want), `stderr names ${want}, got: ${out.stderr}`);
    }
    assertEq(out.stdout, '', 'a block speaks on stderr alone');
  });

  await qaCase('a green touched test file: exit 0, the notice counts and names it', (dir, stub) => {
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `a green run passes, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green'), `the count, got: ${msg}`);
    assert(msg.includes('tests/a.test.js'), `the file, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  await qaCase('no test file in the diff: exit 0, the notice says nothing ran', (dir, stub) => {
    write(dir, 'lib/x.js', 'module.exports = 1;\n');
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `nothing to run passes, got: ${out.stderr}`);
    assert(notice(out).includes('nothing ran'), `says so, got: ${out.stdout}`);
    assertEq(runs(dir), 0, 'the committed test file is not touched, so it never ran');
  });

  await qaCase('a new untracked test file counts: red blocks', (dir, stub) => {
    write(dir, 'tests/new.test.js', RED);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 2, `the new red file blocks, got: ${out.stderr}`);
    assert(out.stderr.includes('tests/new.test.js'), `names it, got: ${out.stderr}`);
  });

  await qaCase('a test-shaped file node cannot run: exit 0, named as not run', (dir, stub) => {
    write(dir, 'tests/x.test.sh', 'exit 1\n');
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `a file node --test cannot run passes, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('nothing ran'), `nothing ran, got: ${msg}`);
    assert(msg.includes('node --test runs only') && msg.includes('tests/x.test.sh'), `names it as not run, got: ${msg}`);
  });

  for (const [shape, body] of [['a describe/it file', DESCRIBE], ['a module that only exports its cases', EXPORTS]]) {
    await qaCase(`${shape}: exit 0, never run, named as not run`, (dir, stub) => {
      write(dir, 'tests/d.test.js', body);
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `a file node --test cannot prove never blocks, got: ${out.stderr}`);
      const msg = notice(out);
      assert(msg.includes('nothing ran'), `never counted green, got: ${msg}`);
      assert(msg.includes(`${UNPROVABLE}`) && msg.includes('tests/d.test.js'), `names it as not run, got: ${msg}`);
      assert(!JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'the notice decides nothing');
      assertEq(runs(dir), 0, 'the file never ran');
    });
  }

  await qaCase('a self-running suite: runs, and the notice lists it green', (dir, stub) => {
    write(dir, 'tests/self.test.js', SELF_RUN);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `a green self-running file passes, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes('tests/self.test.js'), `listed green, got: ${msg}`);
    assert(!msg.includes(UNPROVABLE), `never named as unprovable, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  await qaCase('a describe/it file beside a green node:test file: one runs, the notice names both', (dir, stub) => {
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    write(dir, 'tests/d.test.js', DESCRIBE);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `green passes, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes('tests/a.test.js'), `the green one, got: ${msg}`);
    assert(msg.includes(`${UNPROVABLE}`) && msg.includes('tests/d.test.js'), `the unprovable one, got: ${msg}`);
    assertEq(runs(dir), 1, 'only the node:test file ran');
  });

  for (const name of ['tests/x.sh', 'tests/helpers.js']) {
    await qaCase(`${name}, under a test folder but not test-shaped: never run, named, exit 0`, (dir, stub) => {
      write(dir, name, RED);
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `a helper is never executed, got: ${out.stderr}`);
      const msg = notice(out);
      assert(msg.includes('nothing ran'), `nothing ran, got: ${msg}`);
      assert(msg.includes(`not a test file, so not run: ${name}`), `names it, got: ${msg}`);
      assertEq(runs(dir), 0, 'the helper never ran');
    });
  }

  await qaCase('a red test file with a non-ASCII name: exit 2, named as written', (dir, stub) => {
    write(dir, 'tests/caf\u00e9.test.js', RED);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 2, `git's quoting never hides it, got: ${out.stderr}`);
    assert(out.stderr.includes('tests/caf\u00e9.test.js'), `names it unquoted, got: ${out.stderr}`);
  });

  await qaCase('a deleted test file is excluded: nothing ran', (dir, stub) => {
    git(dir, 'rm -q tests/a.test.js');
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `a deletion runs nothing, got: ${out.stderr}`);
    assert(notice(out).includes('nothing ran'), `says so, got: ${out.stdout}`);
  });

  await qaCase('the commits since the default branch count, with nothing uncommitted', (dir, stub) => {
    const bare = mkTmp('proof-guard-');
    try {
      git(bare, 'init -q --bare');
      git(dir, `remote add origin "${shellPath(bare)}"`);
      git(dir, 'push -q origin main');
      git(dir, 'remote set-head origin main');
      git(dir, 'checkout -q -b feature');
      write(dir, 'tests/b.test.js', RED);
      git(dir, 'add tests/b.test.js');
      git(dir, `${COMMIT} -m red`);
      assertEq(git(dir, 'status --porcelain'), '',
        'the tree is clean, so only the branch carries the file');
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 2, `the committed red file blocks, got: ${out.stderr}`);
      assert(out.stderr.includes('tests/b.test.js'), `names it, got: ${out.stderr}`);
    } finally {
      cleanup(bare);
    }
  });

  // A repo whose origin names no default branch: pushed, never set-head.
  const withOrigin = (dir) => {
    const bare = mkTmp('proof-guard-');
    git(bare, 'init -q --bare');
    git(dir, `remote add origin "${shellPath(bare)}"`);
    git(dir, 'push -q origin main');
    write(dir, 'tests/b.test.js', RED);
    git(dir, 'add tests/b.test.js');
    git(dir, `${COMMIT} -m red`);
    assertEq(git(dir, 'status --porcelain'), '', 'the tree is clean, so only the commit carries the file');
    return bare;
  };

  await qaCase('no origin/HEAD and no upstream: exit 0, the notice names the unread commits', (dir, stub) => {
    const bare = withOrigin(dir);
    try {
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `the committed leg cannot be read, got: ${out.stderr}`);
      assert(notice(out).includes('Commits since the default branch were not read'), `says so, got: ${out.stdout}`);
    } finally {
      cleanup(bare);
    }
  });

  await qaCase('no origin/HEAD, but an upstream: the committed red file blocks', (dir, stub) => {
    const bare = withOrigin(dir);
    try {
      git(dir, 'branch -q --set-upstream-to origin/main');
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 2, `the upstream stands in for the default branch, got: ${out.stderr}`);
      assert(out.stderr.includes('tests/b.test.js'), `names it, got: ${out.stderr}`);
    } finally {
      cleanup(bare);
    }
  });

  await qaCase('a default branch with no merge base: exit 0, the notice names the unread commits', (dir, stub) => {
    // An orphan branch shares no history with origin/main, so the committed
    // leg has no base to diff from and the notice must say so.
    const bare = mkTmp('proof-guard-');
    try {
      git(bare, 'init -q --bare');
      git(dir, `remote add origin "${shellPath(bare)}"`);
      git(dir, 'push -q origin main');
      git(dir, 'remote set-head origin main');
      git(dir, 'checkout -q --orphan rewrite');
      write(dir, 'tests/b.test.js', RED);
      git(dir, 'add -A');
      git(dir, `${COMMIT} -m orphan`);
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `no base to read the leg from, got: ${out.stderr}`);
      assert(notice(out).includes('Commits since the default branch were not read'), `says so, got: ${out.stdout}`);
      assertEq(runs(dir), 0, 'nothing ran');
    } finally {
      cleanup(bare);
    }
  });

  await qaCase('--repo on the qa flip: exit 0, says the run did not run here', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    const out = runHook('gh issue edit 3 --repo owner/name --add-label status:qa', stub, dir);
    assertEq(out.code, 0, `another repo's flip passes, got: ${out.stderr}`);
    assert(notice(out).includes('did not run here'), `says so, got: ${out.stdout}`);
    assertEq(runs(dir), 0, 'no test ran');
  });

  await qaCase('a body that mentions -R is not the flag: the red file still blocks', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    const out = runHook('gh issue edit 3 --body "pass it with -R when needed" --add-label status:qa', stub, dir);
    assertEq(out.code, 2, `the flip is this repo's, got: ${out.stderr}`);
    assert(!out.stdout.includes('did not run here'), `never read as another repo, got: ${out.stdout}`);
  });

  await qaCase('a body naming --add-label status:qa starts no run', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    const out = runHook('gh issue edit 3 --body "run --add-label status:qa later"', stub, dir);
    assertEq(out.code, 0, `no qa flip, got: ${out.stderr}`);
    assertEq(out.stdout, '', `no notice, got: ${out.stdout}`);
    assertEq(runs(dir), 0, 'no test ran');
  });

  await qaCase('a compound flipping two issues runs the tests once', (dir, stub) => {
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    const out = runHook('gh issue edit 3 --add-label status:qa && gh issue edit 4 --add-label status:qa', stub, dir);
    assertEq(out.code, 0, `green passes, got: ${out.stderr}`);
    assertEq(runs(dir), 1, 'one run for the whole command');
  });

  await qaCase('any other label flip makes no run, over a red touched file', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    for (const c of [
      'gh issue edit 3 --remove-label status:specced --add-label status:building',
      'gh issue edit 3 --remove-label status:qa --add-label status:building',
    ]) {
      const out = runHook(c, stub, dir);
      assertEq(out.code, 0, `must pass: ${c}`);
      assertEq(out.stdout, '', `no notice: ${c}`);
    }
    assertEq(runs(dir), 0, 'no test ran');
  });

  group('proof-guard: the qa run stands down out loud');

  await qaCase('node missing from PATH: exit 0, says the run did not run', (dir, stub) => {
    write(dir, 'tests/a.test.js', RED);
    const mirror = mkTmp('proof-guard-');
    try {
      const out = runHook(QA, stub, dir, joinPath(stub.binDir, basePathWithout(mirror, 'node')));
      assertEq(out.code, 0, `no node fails open, got: ${out.stderr}`);
      const msg = notice(out);
      assert(msg.includes('node is not on PATH') && msg.includes('did not run'), `says so, got: ${msg}`);
      assertEq(runs(dir), 0, 'nothing ran');
    } finally {
      cleanup(mirror);
    }
  });

  await test('a session outside any git repository: exit 0, one notice', () => {
    const here = mkTmp('proof-guard-');
    const stub = makeGhStub(WORLD);
    try {
      const out = runHook(QA, stub, here);
      assertEq(out.code, 0, `no repo fails open, got: ${out.stderr}`);
      assert(notice(out).includes('inside no git repository'), `says so, got: ${out.stdout}`);
    } finally {
      cleanup(here);
      cleanup(stub.dir);
    }
  });

  await test('the wiring gives the hook more time than the run is given', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    const bash = wiring.hooks.PreToolUse.find((b) => b.matcher === 'Bash');
    const entry = bash.hooks.find((h) => h.command.includes('safety:proof-guard'));
    const check = fs.readFileSync(path.join(REPO, 'hooks', 'safety', 'proof-guard', 'checks', 'qa-tests.sh'), 'utf8');
    const deadline = Number((check.match(/hook_wait_deadline "\$qa_pid" (\d+)/) || [])[1]);
    assert(deadline > 0, 'the check carries its deadline');
    assert(entry.timeout > deadline, `the ${entry.timeout}s timeout outlasts the ${deadline}s deadline`);
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  cleanup(FIXTURE_HOME);
  return summary();
};

if (require.main === module) selfRun(module.exports);
