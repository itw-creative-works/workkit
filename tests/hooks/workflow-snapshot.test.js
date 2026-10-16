// Tests for hooks/workflow/snapshot/run.sh: the claim to status:building takes
// the repo's red-proof snapshot, a later claim adds to it, and the flip of the
// last building issue drops it. Real git repos; only `gh` is stubbed, and each
// case keeps its snapshots in its own TMPDIR.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, testUnless, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, NO_EXEC_BIT, SYSTEM_PATH, shellPath, which, stubTool, joinPath, systemPathWith, homeEnv,
} = require('../lib/platform');
const { makeGhStub, ghCalls, hookRunner } = require('../lib/gh-stub');
const { fmtCalls } = require('../lib/argv-log');
const { mkRepo } = require('../lib/git-repo');
const { mkRosterHome } = require('../lib/roster');
const { mkTmp } = require('../lib/scratch');
const { snapshotDir, treeOf } = require('../lib/red-snapshot');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'workflow', 'snapshot', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');

const CLAIM = (n) => `gh issue edit ${n} --add-label status:building`;
const QA = (n) => `gh issue edit ${n} --remove-label status:building --add-label status:qa`;
const BLOCK = (n) => `gh issue edit ${n} --remove-label status:building --add-label status:blocked`;

/** The `issue list` answer: each number open at status:building. */
const building = (...numbers) => numbers.map((number) => ({ number, labels: [{ name: 'status:building' }] }));

/**
 * A repo with a root package.json, `src/x.js` and a test, committed; a
 * gitignored `dist/out.js`, `.env` and `node_modules/tiny` beside them.
 */
const mkWorld = (prefix = 'snapshot-') => {
  const w = mkRepo(prefix, {
    'package.json': `${JSON.stringify({ name: 'fixture', private: true })}\n`,
    '.gitignore': 'node_modules/\ndist/\n.env\n',
    'src/x.js': 'module.exports = 1;\n',
    'tests/x.test.js': "require('../src/x');\n",
  });
  w.write('dist/out.js', 'module.exports = 1;\n');
  w.write('.env', 'KEY="snap"\n');
  w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
  return w;
};

/** The hook runner for world `w`: TMPDIR is its own, the home `home` when given. */
const runnerOf = (w, home = null, env = {}) => hookRunner(HOOK, { TMPDIR: shellPath(w.tmp), ...env }, home);

const read = (snap, name) => fs.readFileSync(path.join(snap, name), 'utf8');
const issuesOf = (snap) => read(snap, 'issues').split('\n').filter(Boolean).sort();
const snapshots = (w) => {
  const dir = path.join(w.tmp, 'claude-red-snapshot');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const json = (o) => JSON.stringify(o);

/** The hook's stdout parsed as its one JSON notice; a run with none fails the case. */
const noticeOf = (out) => {
  assert(out.stdout.trim(), `a JSON notice on stdout: ${out.stderr}`);
  return JSON.parse(out.stdout);
};

/** A notice was heard: PostToolUse JSON with text in it. */
const assertNotice = (out) => {
  const notice = noticeOf(out);
  assertEq(notice.hookSpecificOutput.hookEventName, 'PostToolUse', `the notice is a PostToolUse one: ${out.stdout}`);
  assert(`${notice.hookSpecificOutput.additionalContext || ''}${notice.systemMessage || ''}`.trim(),
    `the notice says something: ${out.stdout}`);
};

/** Claim issue `n` in `w` with `list` as gh's building answer; the run must exit 0. */
const claim = (w, n, list) => {
  const out = runnerOf(w)(CLAIM(n), makeGhStub({ list }), w.repo);
  assertEq(out.code, 0, `the claim of #${n} exits 0: ${out.stderr}`);
  return out;
};

const run = async () => {
  group('workflow:snapshot: the claim');

  await test('a claim with no snapshot takes one: the whole tree, gitignored files in, no node_modules, no .git, head, paths and issues recorded', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('src/new.js', 'module.exports = 3;\n');
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    assert(fs.existsSync(path.join(snap, 'tree')), `the snapshot's tree exists at ${snap}`);
    const tree = treeOf(path.join(snap, 'tree'));
    assertEq(Object.keys(tree).filter((k) => k.split(path.sep).includes('node_modules')).join(','), '',
      'no node_modules anywhere in the snapshot, on every platform');
    assertEq(json(tree), json(treeOf(w.repo, { skipModules: true })), 'everything else is the repo folder');
    assertEq(tree[path.join('dist', 'out.js')], 'file module.exports = 1;\n', 'the gitignored dist/ is in it');
    assertEq(tree['.env'], 'file KEY="snap"\n', 'the gitignored .env is in it');
    assertEq(tree[path.join('src', 'x.js')], 'file module.exports = 2;\n', 'the working edit is in it');
    assert(!('.git' in tree) && !fs.existsSync(path.join(snap, 'tree', '.git')), 'no .git in the snapshot');
    assertEq(read(snap, 'head'), `${w.git('rev-parse', 'HEAD').trim()}\n`, 'head is HEAD, one sha line');
    const paths = w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
      + w.git('ls-files', '--others', '--exclude-standard', '-z');
    assertEq(read(snap, 'paths'), paths, 'paths is the working-change list, NUL-separated');
    assertEq(json(issuesOf(snap)), json(['5']), 'issues records the claim');
  });

  await test('a second claim while the snapshot is live adds its number and leaves the tree alone', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    const head = read(snap, 'head');
    w.write('src/x.js', 'module.exports = 9;\n');
    w.write('src/late.js', 'module.exports = 4;\n');
    claim(w, 6, building(5, 6));
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'the tree is as the first claim took it');
    assertEq(read(path.join(snap, 'tree'), path.join('src', 'x.js')), 'module.exports = 1;\n', 'the change made in between is not in it');
    assert(!fs.existsSync(path.join(snap, 'tree', 'src', 'late.js')), 'the file made in between is not in it');
    assertEq(read(snap, 'head'), head, 'head is unchanged');
    assertEq(json(issuesOf(snap)), json(['5', '6']), 'issues holds both claims');
    assertEq(snapshots(w).length, 1, `one snapshot for the repo: ${snapshots(w)}`);
  });

  await test('a claim after every recorded issue left building replaces the snapshot', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    w.write('src/x.js', 'module.exports = 9;\n');
    claim(w, 6, building(6));
    const snap = snapshotDir(w.tmp, w.repo);
    assertEq(read(path.join(snap, 'tree'), path.join('src', 'x.js')), 'module.exports = 9;\n', 'the new tree carries the later change');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the repo now');
    assertEq(json(issuesOf(snap)), json(['6']), 'issues is the new claim alone');
    assertEq(snapshots(w).length, 1, `one snapshot for the repo: ${snapshots(w)}`);
  });

  await test('a take on top of a live snapshot replaces it whole: nothing of the old tree left, no temporary sibling', () => {
    const w = mkWorld();
    w.write('src/gone.js', 'module.exports = 8;\n');
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    assert(fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'the first take holds src/gone.js');
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    w.write('src/x.js', 'module.exports = 9;\n');
    claim(w, 6, building(6));
    assert(!fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'a file only the old tree held is gone');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the repo now');
    assertEq(json(snapshots(w)), json([path.basename(snap)]), 'one folder under the final name, no sibling');
  });

  // Every answer GitHub may give at the re-claim: the issue back at building,
  // or a read that has not caught up, which makes the snapshot look stale.
  for (const [label, list] of [['building again', building(5)], ['none building yet', []]]) {
    await test(`a re-claim of a recorded issue after a block keeps the first tree, the number once (gh answers ${label})`, () => {
      const w = mkWorld();
      claim(w, 5, building(5));
      const snap = snapshotDir(w.tmp, w.repo);
      const before = treeOf(path.join(snap, 'tree'));
      assertEq(runnerOf(w)(BLOCK(5), makeGhStub({ list: [] }), w.repo).code, 0, 'the block exits 0');
      w.write('src/x.js', 'module.exports = 9;\n');
      w.write('src/late.js', 'module.exports = 4;\n');
      claim(w, 5, list);
      assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'the tree is as the first claim found it');
      assertEq(read(path.join(snap, 'tree'), path.join('src', 'x.js')), 'module.exports = 1;\n', 'the edit since is not in it');
      assert(!fs.existsSync(path.join(snap, 'tree', 'src', 'late.js')), 'the file made since is not in it');
      assertEq(json(issuesOf(snap)), json(['5']), 'the number is recorded once');
      assertEq(snapshots(w).length, 1, `one snapshot for the repo: ${snapshots(w)}`);
    });
  }

  await test('a failed GitHub read at a claim keeps the live snapshot and adds the number', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    w.write('src/x.js', 'module.exports = 9;\n');
    const out = runnerOf(w)(CLAIM(6), makeGhStub({ list: [], fails: true }), w.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'the tree is as the first claim took it');
    assertEq(json(issuesOf(snap)), json(['5', '6']), 'issues holds both claims');
  });

  await test('a claim whose number cannot be read records none, and a later claim keeps that snapshot', () => {
    const w = mkWorld();
    const out = runnerOf(w)('gh issue edit "$N" --add-label status:building', makeGhStub({ list: [] }), w.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    const snap = snapshotDir(w.tmp, w.repo);
    assert(fs.existsSync(path.join(snap, 'tree')), `the claim took the snapshot: ${snapshots(w)}`);
    assertEq(json(issuesOf(snap)), json([]), 'no number recorded');
    const before = treeOf(path.join(snap, 'tree'));
    w.write('src/x.js', 'module.exports = 9;\n');
    claim(w, 6, building(6));
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'an empty recorded list is live: the tree stays');
    assertEq(json(issuesOf(snap)), json(['6']), 'the later claim adds its number');
  });

  group('workflow:snapshot: removal');

  for (const flip of [QA(5), 'gh issue edit 5 --remove-label status:qa --add-label status:complete', 'gh issue close 5']) {
    await test(`the last building issue leaving removes the snapshot: ${flip}`, () => {
      const w = mkWorld();
      claim(w, 5, building(5));
      const snap = snapshotDir(w.tmp, w.repo);
      assert(fs.existsSync(snap), 'the claim took the snapshot');
      const out = runnerOf(w)(flip, makeGhStub({ list: [] }), w.repo);
      assertEq(out.code, 0, `exit 0: ${out.stderr}`);
      assert(!fs.existsSync(snap), `the snapshot is gone: ${snapshots(w)}`);
    });
  }

  await test('the qa flip with another issue still building leaves the snapshot', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    claim(w, 6, building(5, 6));
    const snap = snapshotDir(w.tmp, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    const out = runnerOf(w)(QA(5), makeGhStub({ list: building(6) }), w.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assert(fs.existsSync(snap), 'the snapshot stays');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'its tree is intact');
  });

  // Leaving building without reaching qa or complete ends no work, so GitHub
  // answers that nothing is building and the snapshot must stay anyway.
  for (const flip of [
    BLOCK(5),
    'gh issue edit 5 --remove-label status:building --add-label status:specced',
    'gh issue edit 5 --remove-label status:building',
  ]) {
    await test(`a flip off building that adds neither qa nor complete leaves the snapshot and calls no gh: ${flip}`, () => {
      const w = mkWorld();
      claim(w, 5, building(5));
      const snap = snapshotDir(w.tmp, w.repo);
      const before = treeOf(path.join(snap, 'tree'));
      const stub = makeGhStub({ list: [] });
      const out = runnerOf(w)(flip, stub, w.repo);
      assertEq(out.code, 0, `exit 0: ${out.stderr}`);
      assert(fs.existsSync(snap), `the snapshot stays: ${snapshots(w)}`);
      assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'its tree is intact');
      assertEq(json(issuesOf(snap)), json(['5']), 'its issues are intact');
      assertEq(ghCalls(stub).length, 0, `no gh call: ${fmtCalls(ghCalls(stub))}`);
    });
  }

  await test('a failed GitHub read at removal leaves the snapshot, exit 0', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    const out = runnerOf(w)(QA(5), makeGhStub({ list: [], fails: true }), w.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assert(fs.existsSync(snap), 'the snapshot stays');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'its tree is intact');
  });

  group('workflow:snapshot: which repo');

  const OTHER = 'git@github.com:owner/other.git';
  const mkOther = () => {
    const other = mkWorld('snapshot-other-');
    other.git('remote', 'set-url', 'origin', OTHER);
    other.write('dist/out.js', 'module.exports = "other";\n');
    return other;
  };

  await test('a claim naming another repo snapshots its roster folder, not the session repo', () => {
    const session = mkWorld();
    const other = mkOther();
    const home = mkRosterHome([[session.repo, 'enabled'], [other.repo, 'enabled']]);
    const out = runnerOf(session, home)('gh issue edit 5 --repo owner/other --add-label status:building',
      makeGhStub({ list: building(5) }), session.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    const snap = snapshotDir(session.tmp, other.repo);
    assert(fs.existsSync(path.join(snap, 'tree')), `the other repo's snapshot exists: ${snapshots(session)}`);
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(other.repo, { skipModules: true })),
      'the snapshot tree is the other repo');
    assertEq(json(issuesOf(snap)), json(['5']), 'issues records the claim');
    assert(!fs.existsSync(snapshotDir(session.tmp, session.repo)), 'the session repo has no snapshot');
  });

  await test('a claim naming a repo off the roster: the notice names it, no snapshot', () => {
    const session = mkWorld();
    mkOther();
    const home = mkRosterHome([[session.repo, 'enabled']]);
    const out = runnerOf(session, home)('gh issue edit 5 --repo owner/other --add-label status:building',
      makeGhStub({ list: building(5) }), session.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assert(`${out.stdout}${out.stderr}`.includes('owner/other'), `the notice names the repo: ${out.stdout}${out.stderr}`);
    assertNotice(out);
    assertEq(snapshots(session).length, 0, `no snapshot at all: ${snapshots(session)}`);
  });

  await test('a claim after a cd clause with no --repo: a notice, no snapshot', () => {
    const w = mkWorld();
    const other = mkOther();
    const out = runnerOf(w)(`cd "${shellPath(other.repo)}" && ${CLAIM(5)}`, makeGhStub({ list: building(5) }), w.repo);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assertNotice(out);
    assertEq(snapshots(w).length, 0, `no snapshot at all: ${snapshots(w)}`);
  });

  await test('a claim from a folder inside no git repo: a notice, no snapshot', () => {
    const w = mkWorld();
    const outside = mkTmp('snapshot-norepo-');
    const out = runnerOf(w)(CLAIM(5), makeGhStub({ list: building(5) }), outside);
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assertNotice(out);
    assertEq(snapshots(w).length, 0, `no snapshot at all: ${snapshots(w)}`);
  });

  group('workflow:snapshot: anything else');

  for (const command of [
    'git status --short',
    'gh issue view 5',
    'gh issue edit 5 --add-label priority:high',
    'gh issue comment 5 --body "moving to status:building next"',
  ]) {
    await test(`no claim and no park does nothing and calls no gh: ${command}`, () => {
      const w = mkWorld();
      const stub = makeGhStub({ list: building(5) });
      const out = runnerOf(w)(command, stub, w.repo);
      assertEq(out.code, 0, `exit 0: ${out.stderr}`);
      assertEq(snapshots(w).length, 0, `no snapshot: ${snapshots(w)}`);
      assertEq(ghCalls(stub).length, 0, `no gh call: ${fmtCalls(ghCalls(stub))}`);
    });
  }

  group('workflow:snapshot: a failed take');

  // The copy tool each platform's take uses (tar on Git Bash, cp elsewhere),
  // stubbed ahead on PATH to copy for real and then fail, so a whole tree is
  // left under the temporary name for the take to clear. Each call is logged.
  const failingCopy = () => {
    const tool = IS_WINDOWS ? 'tar' : 'cp';
    const bin = mkTmp(`snapshot-${tool}-`);
    const log = path.join(bin, `${tool}.log`);
    stubTool(bin, tool, ['#!/bin/bash', `echo "$*" >> "${shellPath(log)}"`,
      `"${shellPath(which(tool, SYSTEM_PATH))}" "$@"`, `echo "${tool}: refused" >&2`, 'exit 1']);
    return { tool, log, pathFor: (stub) => joinPath(bin, systemPathWith(stub.binDir, NODE_DIR)) };
  };

  await test('a take whose copy fails leaves no snapshot folder and no temporary sibling, exit 0', () => {
    const w = mkWorld();
    const copy = failingCopy();
    const stub = makeGhStub({ list: building(5) });
    const out = runnerOf(w)(CLAIM(5), stub, w.repo, copy.pathFor(stub));
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assert(fs.existsSync(copy.log), `the take reached the failing ${copy.tool}`);
    assertEq(json(snapshots(w)), json([]), 'no snapshot folder and no temporary sibling');
  });

  await test('a take whose copy fails on top of a live snapshot keeps that one whole and leaves no temporary sibling', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    const before = { tree: treeOf(path.join(snap, 'tree')), head: read(snap, 'head'), issues: read(snap, 'issues') };
    w.write('src/x.js', 'module.exports = 9;\n');
    w.git('commit', '-q', '-am', 'later');
    const copy = failingCopy();
    const stub = makeGhStub({ list: building(6) });
    const out = runnerOf(w)(CLAIM(6), stub, w.repo, copy.pathFor(stub));
    assertEq(out.code, 0, `exit 0: ${out.stderr}`);
    assert(fs.existsSync(copy.log), `the take reached the failing ${copy.tool}`);
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before.tree), 'the live tree is as it was');
    assertEq(read(snap, 'head'), before.head, 'head is as it was');
    assertEq(read(snap, 'issues'), before.issues, 'issues is as it was');
    assertEq(json(snapshots(w)), json([path.basename(snap)]), 'one folder under the final name, no sibling');
  });

  /** Every folder under `dir` made writable again, so the scratch can be removed. */
  const unlock = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const rel of ['', ...fs.readdirSync(dir, { recursive: true })]) {
      const full = path.join(dir, String(rel));
      if (fs.lstatSync(full).isDirectory()) fs.chmodSync(full, 0o755);
    }
  };

  const lockTest = testUnless(IS_WINDOWS || process.getuid() === 0,
    'a read-only folder does not stop the removal here (Windows ignores the mode, root ignores it)');
  /** The `<dir>.XXXXXX` siblings of snapshot folder `snap`, by name. */
  const siblingsOf = (w, snap) => snapshots(w).filter((name) => name.startsWith(`${path.basename(snap)}.`));

  await lockTest('a take over an old snapshot it cannot remove moves the remains to one sibling and takes the new one', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    fs.chmodSync(path.join(snap, 'tree', 'src'), 0o555);
    try {
      w.write('src/x.js', 'module.exports = 9;\n');
      w.git('commit', '-q', '-am', 'later');
      w.write('src/late.js', 'module.exports = 4;\n');
      const out = claim(w, 6, building(6));
      assert(!`${out.stdout}${out.stderr}`.includes('could not be taken'), `no notice of a failed take: ${out.stdout}${out.stderr}`);
      assert(`${out.stdout}`.includes('moved aside to'), `the notice names where the remains went: ${out.stdout}`);
      assertEq(json(issuesOf(snap)), json(['6']), 'the claim recorded the new number');
      assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the new take');
      assertEq(read(snap, 'head'), `${w.git('rev-parse', 'HEAD').trim()}\n`, 'head is the new take\'s');
      const paths = w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
        + w.git('ls-files', '--others', '--exclude-standard', '-z');
      assertEq(read(snap, 'paths'), paths, 'paths is the new take\'s');
      const siblings = siblingsOf(w, snap);
      assertEq(siblings.length, 1, `exactly one sibling: ${snapshots(w)}`);
      assert(/^\.[^.]{6}$/.test(siblings[0].slice(path.basename(snap).length)), `named <dir>.<six chars>: ${siblings[0]}`);
      const sibling = path.join(path.dirname(snap), siblings[0]);
      const isLocked = (rel) => fs.lstatSync(path.join(sibling, rel)).isDirectory()
        // eslint-disable-next-line no-bitwise
        && (fs.statSync(path.join(sibling, rel)).mode & 0o222) === 0;
      const locked = fs.readdirSync(sibling, { recursive: true }).map(String)
        .filter((rel) => path.basename(rel) === 'src' && isLocked(rel));
      assertEq(locked.length, 1, `the sibling holds the read-only remains: ${fs.readdirSync(sibling, { recursive: true })}`);
    } finally {
      unlock(path.join(w.tmp, 'claude-red-snapshot'));
    }
  });

  await test('a take clears a sibling older than 10 minutes and keeps a fresh one', () => {
    const w = mkWorld();
    claim(w, 5, building(5));
    const snap = snapshotDir(w.tmp, w.repo);
    const stale = `${snap}.abcdef`;
    const fresh = `${snap}.ghijkl`;
    const old = new Date(Date.now() - 20 * 60 * 1000);
    for (const dir of [stale, fresh]) fs.mkdirSync(path.join(dir, 'tree'), { recursive: true });
    fs.writeFileSync(path.join(stale, 'tree', 'left.js'), 'module.exports = 0;\n');
    fs.writeFileSync(path.join(fresh, 'tree', 'left.js'), 'module.exports = 0;\n');
    for (const p of [path.join(stale, 'tree', 'left.js'), path.join(stale, 'tree'), stale]) fs.utimesSync(p, old, old);
    w.write('src/x.js', 'module.exports = 9;\n');
    claim(w, 6, building(6));
    assert(!fs.existsSync(stale), `the stale sibling is gone: ${snapshots(w)}`);
    assert(fs.existsSync(path.join(fresh, 'tree', 'left.js')), `the fresh sibling stays: ${snapshots(w)}`);
    assertEq(json(issuesOf(snap)), json(['6']), 'the take happened');
  });

  group('workflow:snapshot: wiring');

  await test('hooks.json wires the hook under PostToolUse Bash through the loader, 600s timeout', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    const entries = settings.hooks.PostToolUse.filter((e) => e.matcher === 'Bash')
      .flatMap((e) => e.hooks.filter((h) => /\/hooks\/loader\.sh workflow:snapshot$/.test(h.command)));
    assertEq(entries.length, 1, `workflow:snapshot is wired once under PostToolUse Bash: ${json(entries)}`);
    assertEq(entries[0].timeout, 600, 'its timeout is 600');
  });

  await test('run.sh is executable', () => {
    if (IS_WINDOWS) skip('run.sh carries the executable bit', NO_EXEC_BIT);
    // eslint-disable-next-line no-bitwise
    else assert((fs.statSync(HOOK).mode & 0o111) !== 0, 'the executable bit is set');
  });

  await test('the loader routes workflow:snapshot: a claim through it takes the snapshot', () => {
    const w = mkWorld();
    const stub = makeGhStub({ list: building(5) });
    const home = mkTmp('snapshot-home-');
    const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), 'workflow:snapshot'], {
      input: json({ tool_name: 'Bash', cwd: shellPath(w.repo), tool_input: { command: CLAIM(5) } }),
      env: homeEnv(home, { TMPDIR: shellPath(w.tmp), PATH: systemPathWith(stub.binDir, NODE_DIR) }),
      encoding: 'utf8',
      timeout: 30000,
    });
    assertEq(res.status, 0, `exit 0: ${res.stderr}`);
    const snap = snapshotDir(w.tmp, w.repo);
    assert(fs.existsSync(path.join(snap, 'tree')), `the snapshot's tree exists at ${snap}`);
    assertEq(json(issuesOf(snap)), json(['5']), 'issues records the claim');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
