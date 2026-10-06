// Tests for hooks/safety/proof-guard at the flip to status:qa: the park runs no
// test; it reads the proved-tree records npm's script shell wrote, and a
// touched test file no record covers blocks the flip. The per-package record
// is ./qa-groups.test.js, its staleness ./qa-record.test.js.
// The shared prologue (the hook runner, the gh stub, the fixtures) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  shellPath, which, stubTool, joinPath, systemPathWith, NODE_DIR,
} = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeGhStub, ghCalls, dropPathWithoutGh, runHook, runHookIn, WORLD,
  QA, RED, ranNothing, COMMIT, git, write, touch, mkQaRepo, mkOtherRepo, mkRosterHome,
  plantRecord, plantPkgRecord, qaCase, recordCase, notice,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

// A block of the flip: exit 2, the reason on stderr alone, naming <wants>.
const assertBlocks = (out, ...wants) => {
  assertEq(out.code, 2, `the flip is blocked, got: ${out.code} ${out.stderr}`);
  for (const want of ['proof-guard', ...wants]) assert(out.stderr.includes(want), `stderr names ${want}, got: ${out.stderr}`);
  assertEq(out.stdout, '', `a block speaks on stderr alone, got: ${out.stdout}`);
};

// A pass of the flip: exit 0 and one proof-guard notice, handed back.
const passNotice = (out) => {
  assertEq(out.code, 0, `the flip passes, got: ${out.code} ${out.stderr}`);
  const msg = notice(out);
  assert(msg.startsWith('proof-guard:'), `the notice carries the prefix, got: ${msg}`);
  assert(!JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'the notice decides nothing');
  return msg;
};

const run = async () => {
  group('proof-guard: the park reads the records and runs nothing');

  await qaCase('no touched test file: exit 0, the notice says so', (dir, stub) => {
    write(dir, 'lib/x.js', 'module.exports = 1;\n');
    const msg = passNotice(runHook(QA, stub, dir));
    assert(msg.includes('test file'), `the notice is about the touched test files, got: ${msg}`);
    assert(!msg.includes('lib/x.js'), `a code file is never a test file, got: ${msg}`);
  });

  await recordCase('a whole root suite record on the tree: exit 0, the notice says the suite covers the files, nothing ran', ({ dir, tmp, flip }) => {
    touch(dir, 'tests/a.test.js');
    plantRecord(tmp, dir);
    const msg = passNotice(flip());
    assert(/suite/i.test(msg), `the notice names the whole root suite, got: ${msg}`);
    assert(msg.includes('1 touched test file'), `and the files it covers, got: ${msg}`);
    assert(ranNothing(dir), 'a test file that would fail if run never ran');
    assert(!fs.existsSync(path.join(tmp, 'claude-package-marker')), 'the hook writes no package record');
    assert(!fs.existsSync(path.join(tmp, 'claude-qa-marker')), 'and no second record');
  });

  await recordCase('a touched test file with no record: exit 2, naming the root and the file', ({ dir, flip }) => {
    touch(dir, 'tests/a.test.js');
    assertBlocks(flip(), 'the repo root: tests/a.test.js', '`npm test -- <files>`');
    assert(ranNothing(dir), 'nothing ran');
  });

  await recordCase('a new untracked test file counts: no record blocks naming it', ({ dir, flip }) => {
    touch(dir, 'tests/new.test.js');
    assertBlocks(flip(), 'tests/new.test.js');
  });

  await recordCase('a touched .test.zsh file is a test file: no record blocks, the root record passes', ({ dir, tmp, flip }) => {
    write(dir, 'tests/x.test.zsh', 'exit 1\n');
    assertBlocks(flip(), 'the repo root: tests/x.test.zsh');
    plantPkgRecord(tmp, dir, ['.']);
    passNotice(flip());
    assert(ranNothing(dir), 'nothing ran');
  });

  for (const name of ['tests/helpers.js', 'tests/x.sh']) {
    await recordCase(`${name}, under a test folder but not test-shaped: named, never required`, ({ dir, flip }) => {
      write(dir, name, RED);
      const msg = passNotice(flip());
      assert(msg.includes(name), `the helper is named, got: ${msg}`);
      assert(ranNothing(dir), 'the helper never ran');
    });
  }

  await recordCase('a helper beside a recorded test file: the helper is named, the record alone passes', ({ dir, tmp, flip }) => {
    write(dir, 'tests/helpers.js', RED);
    touch(dir, 'tests/a.test.js');
    plantPkgRecord(tmp, dir, ['.']);
    const msg = passNotice(flip());
    assert(msg.includes('tests/helpers.js'), `the helper is named, got: ${msg}`);
  });

  for (const [label, pkg] of [['a root with no test script', { name: 'fixture' }], ['a root with no package.json', null]]) {
    await recordCase(`${label}: exit 0, the touched file named as not provable by npm test`, ({ dir, flip }) => {
      if (pkg) write(dir, 'package.json', `${JSON.stringify(pkg)}\n`);
      else fs.rmSync(path.join(dir, 'package.json'));
      git(dir, 'add -A');
      git(dir, `${COMMIT} -m no-script`);
      touch(dir, 'tests/a.test.js');
      const msg = passNotice(flip());
      assert(msg.includes('tests/a.test.js'), `the file is named, got: ${msg}`);
      assert(/npm test|test script/.test(msg), `as one npm test cannot prove, got: ${msg}`);
      assert(ranNothing(dir), 'nothing ran');
    });
  }

  await recordCase('a tree that cannot be hashed: exit 2, naming the hash as the cause', ({ dir, tmp, stub, flip }) => {
    touch(dir, 'tests/a.test.js');
    plantPkgRecord(tmp, dir, ['.']);
    // A git ahead on PATH refuses to build a tree, so the working tree has no id
    // the records could be read against.
    const bin = mkTmp('proof-guard-git-');
    try {
      stubTool(bin, 'git', ['#!/bin/bash',
        'for a in "$@"; do case "$a" in add|write-tree) echo "git: $a refused" >&2; exit 1 ;; esac; done',
        `exec "${shellPath(which('git'))}" "$@"`]);
      const out = flip(QA, dir, joinPath(bin, systemPathWith(stub.binDir, NODE_DIR)));
      assertBlocks(out);
      assert(/hash/i.test(out.stderr), `the cause is the tree hash, got: ${out.stderr}`);
    } finally {
      cleanup(bin);
    }
  });

  await qaCase('a test file with a non-ASCII name and no record: exit 2, named as written', (dir, stub) => {
    touch(dir, 'tests/café.test.js');
    assertBlocks(runHook(QA, stub, dir), 'tests/café.test.js');
  });

  await qaCase('a deleted test file is excluded: no touched test file', (dir, stub) => {
    git(dir, 'rm -q tests/a.test.js');
    passNotice(runHook(QA, stub, dir));
  });

  group('proof-guard: the committed leg of the touched list');

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
      git(dir, `${COMMIT} -m b`);
      assertEq(git(dir, 'status --porcelain'), '', 'the tree is clean, so only the branch carries the file');
      assertBlocks(runHook(QA, stub, dir), 'tests/b.test.js');
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
    git(dir, `${COMMIT} -m b`);
    assertEq(git(dir, 'status --porcelain'), '', 'the tree is clean, so only the commit carries the file');
    return bare;
  };

  await qaCase('no origin/HEAD and no upstream: exit 0, the notice names the unread commits', (dir, stub) => {
    const bare = withOrigin(dir);
    try {
      const msg = passNotice(runHook(QA, stub, dir));
      assert(msg.includes('Commits since the default branch were not read'), `says so, got: ${msg}`);
    } finally {
      cleanup(bare);
    }
  });

  await qaCase('no origin/HEAD, but an upstream: the committed file with no record blocks', (dir, stub) => {
    const bare = withOrigin(dir);
    try {
      git(dir, 'branch -q --set-upstream-to origin/main');
      assertBlocks(runHook(QA, stub, dir), 'tests/b.test.js');
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
      const msg = passNotice(runHook(QA, stub, dir));
      assert(msg.includes('Commits since the default branch were not read'), `says so, got: ${msg}`);
    } finally {
      cleanup(bare);
    }
  });

  group('proof-guard: the repo a qa flip names');

  await qaCase('--repo naming a repo with no roster at all: exit 0, says it has not opted in', (dir, stub) => {
    touch(dir, 'tests/a.test.js');
    const msg = passNotice(runHook('gh issue edit 3 --repo owner/name --add-label status:qa', stub, dir));
    assert(msg.includes('not opted in') && msg.includes('owner/name'), `names it as not opted in, got: ${msg}`);
  });

  // The origin names the repo in another letter case than every flag below.
  const THIS_REPO = 'git@github.com:Owner/Name.git';
  for (const flag of ['--repo owner/NAME', '--repo=owner/NAME', '-R owner/NAME', '-Rowner/NAME', '-R "owner/NAME"', "--repo='owner/NAME'"]) {
    await qaCase(`${flag} naming this repo's origin: the touched file with no record blocks`, (dir, stub) => {
      git(dir, `remote add origin ${THIS_REPO}`);
      touch(dir, 'tests/a.test.js');
      assertBlocks(runHook(`gh issue edit 3 ${flag} --add-label status:qa`, stub, dir), 'tests/a.test.js');
    });
  }

  await qaCase('-R naming another repo than the origin, with no roster: exit 0, says it has not opted in', (dir, stub) => {
    git(dir, `remote add origin ${THIS_REPO}`);
    touch(dir, 'tests/a.test.js');
    const msg = passNotice(runHook('gh issue edit 3 -R owner/other --add-label status:qa', stub, dir));
    assert(msg.includes('not opted in') && msg.includes('owner/other'), `names it as not opted in, got: ${msg}`);
  });

  for (const value of ['"$R"', '$D', '"$(cat repo.txt)"', '`cat repo.txt`']) {
    await qaCase(`--repo ${value} on the qa flip: exit 2, asking for the repo as owner/name`, (dir, stub) => {
      touch(dir, 'tests/a.test.js');
      assertBlocks(runHook(`gh issue edit 3 --repo ${value} --add-label status:qa`, stub, dir), 'owner/name');
    });
  }

  // The session sits in one repo while the command changes into another: the
  // hook is handed the first, so it cannot place the flip and bounces it.
  const DIR_CHANGES = [
    (to) => `cd ${to} && gh issue edit 3 --repo owner/name --add-label status:qa`,
    (to) => `cd ${to} && gh issue edit 3 --add-label status:qa`,
    (to) => `(cd ${to} && gh issue edit 3 --add-label status:qa)`,
    (to) => `pushd ${to} >/dev/null && gh issue edit 3 --add-label status:qa`,
    () => 'popd && gh issue edit 3 --add-label status:qa',
  ];
  for (const shape of DIR_CHANGES) {
    await qaCase(`a directory change before the flip bounces: ${shape('<dir>')}`, (dir, stub) => {
      const session = mkQaRepo();
      try {
        git(dir, `remote add origin ${THIS_REPO}`);
        touch(dir, 'tests/a.test.js');
        const out = runHook(shape(shellPath(dir)), stub, session);
        assertBlocks(out, 'changes directory', 'own Bash call');
      } finally {
        cleanup(session);
      }
    });
  }

  await qaCase('a directory change after the flip is not its tree: the file with no record still blocks', (dir, stub) => {
    touch(dir, 'tests/a.test.js');
    const out = runHook(`${QA} && cd /`, stub, dir);
    assertBlocks(out, 'tests/a.test.js');
    assert(!out.stderr.includes('changes directory'), `never read as a directory change, got: ${out.stderr}`);
  });

  await qaCase('a body that mentions -R is not the flag: the file with no record still blocks', (dir, stub) => {
    touch(dir, 'tests/a.test.js');
    assertBlocks(runHook('gh issue edit 3 --body "pass it with -R when needed" --add-label status:qa', stub, dir), 'tests/a.test.js');
  });

  await qaCase('a body naming --add-label status:qa is no flip: no notice, no block', (dir, stub) => {
    touch(dir, 'tests/a.test.js');
    const out = runHook('gh issue edit 3 --body "run --add-label status:qa later"', stub, dir);
    assertEq(out.code, 0, `no qa flip, got: ${out.stderr}`);
    assertEq(out.stdout, '', `no notice, got: ${out.stdout}`);
  });

  await recordCase('a compound flipping two issues is judged once: one notice', ({ dir, tmp, flip }) => {
    touch(dir, 'tests/a.test.js');
    plantPkgRecord(tmp, dir, ['.']);
    const msg = passNotice(flip('gh issue edit 3 --add-label status:qa && gh issue edit 4 --add-label status:qa'));
    assertEq(msg.split('proof-guard:').length - 1, 1, `one notice for the whole command, got: ${msg}`);
  });

  await qaCase('any other label flip reads nothing, over a touched file with no record', (dir, stub) => {
    touch(dir, 'tests/a.test.js');
    for (const c of [
      'gh issue edit 3 --remove-label status:specced --add-label status:building',
      'gh issue edit 3 --remove-label status:qa --add-label status:building',
    ]) {
      const out = runHook(c, stub, dir);
      assertEq(out.code, 0, `must pass: ${c}`);
      assertEq(out.stdout, '', `no notice: ${c}`);
    }
  });

  group('proof-guard: a qa flip naming another repo on the roster');

  // The session repo holds a touched file with no record, so a check there
  // would block; the other repo is the one the flip names, found through the roster.
  const OTHER = 'git@github.com:Owner/Other.git';
  const crossCase = (name, body) => test(name, () => {
    const session = mkQaRepo();
    const other = mkOtherRepo(OTHER);
    const tmp = mkTmp('proof-guard-tmp-');
    const stub = makeGhStub(WORLD);
    const homes = [];
    const runnerFor = (entries) => {
      homes.push(mkRosterHome(entries));
      return runHookIn(tmp, homes[homes.length - 1]);
    };
    try {
      touch(session, 'tests/a.test.js');
      body({ session, other, tmp, stub, runnerFor });
      assert(ranNothing(session) && ranNothing(other), 'nothing ran in either repo');
      assertEq(ghCalls(stub).length, 0, `a qa flip reads no issue, got: ${fmtCalls(ghCalls(stub))}`);
    } finally {
      for (const dir of [session, other, tmp, stub.dir, ...homes]) cleanup(dir);
    }
  });

  for (const flip of [
    'gh issue edit 3 --repo OWNER/other --add-label status:qa',
    'gh issue edit 3 -R owner/OTHER --add-label status:qa',
    'gh issue edit https://github.com/owner/other/issues/3 --add-label status:qa',
  ]) {
    await crossCase(`a touched test with no record in the named roster repo blocks: ${flip}`, ({ session, other, stub, runnerFor }) => {
      touch(other, 'tests/b.test.js');
      const out = runnerFor([[other, 'enabled']])(flip, stub, session);
      assertBlocks(out, 'tests/b.test.js');
      assert(!out.stderr.includes('tests/a.test.js'), `the session repo's file is not the one judged, got: ${out.stderr}`);
    });
  }

  await crossCase("a record in the named roster repo passes, and the record is that folder's", ({ session, other, tmp, stub, runnerFor }) => {
    touch(other, 'tests/b.test.js');
    plantPkgRecord(tmp, other, ['.']);
    const runIn = runnerFor([[session, 'enabled'], [other, 'enabled']]);
    passNotice(runIn('gh issue edit 3 --repo owner/other --add-label status:qa', stub, session));
    // The session's own flip reads its own key, which holds nothing.
    assertBlocks(runIn(QA, stub, session), 'tests/a.test.js');
  });

  await crossCase('a repo off a roster that lists others: exit 0, says it has not opted in', ({ session, other, stub, runnerFor }) => {
    touch(other, 'tests/b.test.js');
    const msg = passNotice(runnerFor([[session, 'enabled']])('gh issue edit 3 --repo owner/other --add-label status:qa', stub, session));
    assert(msg.includes('not opted in') && msg.includes('owner/other'), `names it as not opted in, got: ${msg}`);
  });

  await crossCase('a declined roster entry is never matched: exit 0, says it has not opted in', ({ session, other, stub, runnerFor }) => {
    touch(other, 'tests/b.test.js');
    const msg = passNotice(runnerFor([[session, 'enabled'], [other, 'declined']])('gh issue edit 3 --repo owner/other --add-label status:qa', stub, session));
    assert(msg.includes('not opted in') && msg.includes('owner/other'), `names it as not opted in, got: ${msg}`);
  });

  // A command that flips status:qa in two repos is two checks the hook cannot
  // judge as one, so it blocks before either and names both repos.
  await crossCase('the cwd repo and a roster repo in one command: exit 2, naming both', ({ session, other, stub, runnerFor }) => {
    git(session, `remote add origin ${THIS_REPO}`);
    touch(other, 'tests/b.test.js');
    const out = runnerFor([[session, 'enabled'], [other, 'enabled']])(
      'gh issue edit 3 --add-label status:qa && gh issue edit 4 --repo owner/other --add-label status:qa', stub, session);
    assertBlocks(out);
    const said = out.stderr.toLowerCase();
    assert(said.includes('owner/other'), `names the roster repo, got: ${out.stderr}`);
    assert(said.includes('owner/name') || out.stderr.includes(shellPath(session)), `names the cwd repo, got: ${out.stderr}`);
  });

  await crossCase('two other repos in one command, one off the roster: exit 2, naming both', ({ session, other, stub, runnerFor }) => {
    touch(other, 'tests/b.test.js');
    const out = runnerFor([[session, 'enabled'], [other, 'enabled']])(
      'gh issue edit 3 --repo owner/absent --add-label status:qa && gh issue edit 4 --repo owner/other --add-label status:qa', stub, session);
    assertBlocks(out);
    const said = out.stderr.toLowerCase();
    assert(said.includes('owner/absent') && said.includes('owner/other'), `names both repos, got: ${out.stderr}`);
  });

  group('proof-guard: the park stands down out loud');

  await test('a session outside any git repository: exit 0, one notice', () => {
    const here = mkTmp('proof-guard-');
    const stub = makeGhStub(WORLD);
    try {
      assert(passNotice(runHook(QA, stub, here)).includes('inside no git repository'), 'says so');
    } finally {
      cleanup(here);
      cleanup(stub.dir);
    }
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
