// Tests for the suite hold (workflow/lib/hold.sh) where the full suite runs: a
// bare root `npm test` through npm's script shell, `workkit prove`, and a bare
// `workkit test`. In a Claude session, in a repo that opted in, a run on a tree
// already recorded green or while an issue is at status:building is refused
// before the suite starts. The world is test/lib/script-shell.js's; the suite
// ran when its root test script left the world's `ran` file.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  NODE_DIR, SYSTEM_PATH, shellPath, joinPath,
} = require('../lib/platform');
const { mkRepo: mkGitRepo } = require('../lib/git-repo');
const { suiteMarkerPath, plantRecord } = require('../lib/suite-record');
const { makeGhStub, ghCalls } = require('../lib/gh-stub');
const {
  cleanup, git, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded, wiredNpmEnv,
} = require('../lib/script-shell');
const { runCli } = require('./workkit-cli/helpers');

const issue = (number) => ({ number, labels: [{ name: 'status:building' }, { name: 'type:feature' }] });
const OPT_IN = '{ "version": 1, "enabled": true }\n';
const DECLINED = '{ "version": 1, "enabled": false }\n';
const RAN = 'echo ran > "$WK_RAN"';
const HELD = (n) => `still building: #${n}`;
const PROVED = 'this tree is already proved';

// A committed repo whose root test script leaves the ran file; `settings` is
// its .workkit/settings.json text, none when null.
const repoWith = (settings = OPT_IN, extra = {}) => mkRepo({ scripts: { test: RAN } },
  { ...(settings === null ? {} : { '.workkit/settings.json': settings }), ...extra });

// One run's env: the gh stub first on PATH, CLAUDECODE '1' or absent, the ran file.
const sessionEnv = (ranFile, gh, claude, extra = {}) => ({
  PATH: joinPath(gh.binDir, NODE_DIR, SYSTEM_PATH), WK_RAN: shellPath(ranFile), CLAUDECODE: claude ? '1' : undefined, ...extra,
});

// The ran file cleared, then <run>; the result with `said` (both streams) and `ran`.
const judged = (ranFile, run) => {
  fs.rmSync(ranFile, { force: true });
  const res = run();
  return { ...res, said: `${res.out}${res.err}`, ran: fs.existsSync(ranFile) };
};

// npm <args> from <cwd> through the world's script shell.
const npmRun = (world, cwd, args, gh, { claude = true, env = {} } = {}) => {
  const ranFile = path.join(world.root, 'ran');
  return judged(ranFile, () => npm(world, cwd, args, world.wrapper, sessionEnv(ranFile, gh, claude, env)));
};

const assertRuns = (res, label) => {
  assertEq(res.code, 0, `${label}: the run goes on, got: ${res.code} ${res.said}`);
  assert(res.ran, `${label}: the suite ran, got: ${res.said}`);
};

const assertRefused = (res, text, label) => {
  assertEq(res.code, 1, `${label}: refused with exit 1, got: ${res.code} ${res.said}`);
  assert(res.said.includes(text), `${label}: the refusal says ${JSON.stringify(text)}, got: ${res.said}`);
  assert(!res.ran, `${label}: the suite never ran`);
};

// The working tree made to differ from the index, so a record of one is no record of the other.
const editUnstaged = (repo) => fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');

const cases = async () => {
  skipWithoutWrapper();

  group('suite hold: a bare root npm test in a Claude session');

  await test('case 1: an issue building refuses with exit 1 naming it; the suite never runs and no record is written', () => {
    const world = mkWorld();
    const repo = repoWith();
    const res = npmRun(world, repo, ['test'], makeGhStub({ lists: { repo: [issue(7)] } }));
    assertRefused(res, HELD(7), 'one issue building');
    assertEq(recorded(world, repo), undefined, 'a refused run writes no record');
    cleanup(world.root); cleanup(repo);
  });

  await test('case 2: nothing building and the working tree already recorded green refuses with the proved-tree text', () => {
    const world = mkWorld();
    const repo = repoWith();
    editUnstaged(repo);
    plantRecord(world.workflowHome, repo);
    assertRefused(npmRun(world, repo, ['test'], makeGhStub({ lists: { repo: [] } })), PROVED, 'the working tree recorded');
    cleanup(world.root); cleanup(repo);
  });

  await test('case 3: CLAUDECODE unset, or HOOK_DISABLE=1, with an issue building: the run goes on', () => {
    const world = mkWorld();
    const repo = repoWith();
    const gh = makeGhStub({ lists: { repo: [issue(7)] } });
    assertRuns(npmRun(world, repo, ['test'], gh, { claude: false }), 'the owner\'s terminal');
    assertRuns(npmRun(world, repo, ['test'], gh, { env: { HOOK_DISABLE: '1' } }), 'HOOK_DISABLE=1 in a session');
    cleanup(world.root); cleanup(repo);
  });

  await test('case 4: no settings file, or a declined one, with an issue building: the run goes on with no gh call', () => {
    for (const [label, settings] of [['no settings file', null], ['declined', DECLINED]]) {
      const world = mkWorld();
      const repo = repoWith(settings);
      const gh = makeGhStub({ lists: { repo: [issue(7)] } });
      assertRuns(npmRun(world, repo, ['test'], gh), label);
      assertEq(ghCalls(gh).length, 0, `${label}: no gh call`);
      cleanup(world.root); cleanup(repo);
    }
  });

  await test('case 5: no origin: the run goes on with no gh call, and a recorded tree still refuses', () => {
    const world = mkWorld();
    const repo = repoWith();
    git(repo, 'remote', 'remove', 'origin');
    const gh = makeGhStub({ lists: { repo: [issue(7)] } });
    assertRuns(npmRun(world, repo, ['test'], gh), 'no origin');
    assertEq(ghCalls(gh).length, 0, 'no origin: no gh call');
    plantRecord(world.workflowHome, repo);
    assertRefused(npmRun(world, repo, ['test'], gh), PROVED, 'no origin, the tree recorded');
    cleanup(world.root); cleanup(repo);
  });

  await test('case 6: gh failing: the run goes on, with a note on stderr', () => {
    const world = mkWorld();
    const repo = repoWith();
    const gh = makeGhStub({ lists: {}, fails: true });
    const res = npmRun(world, repo, ['test'], gh);
    assert(ghCalls(gh).length > 0, 'the building list was asked for');
    assertRuns(res, 'gh failing');
    assert(/\bgh\b/.test(res.err), `a note naming gh on stderr, got: ${JSON.stringify(res.err)}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('case 7: a narrowed run and a nested package\'s own test script are never held', () => {
    const world = mkWorld();
    const repo = repoWith(OPT_IN, { 'packages/foo/package.json': { name: 'foo', scripts: { test: RAN } } });
    plantRecord(world.workflowHome, repo);
    const gh = makeGhStub({ lists: { repo: [issue(7)] } });
    assertRuns(npmRun(world, repo, ['test', '--', 'only/one.test.js'], gh), 'npm test -- <file>');
    assertRuns(npmRun(world, path.join(repo, 'packages', 'foo'), ['test'], gh), 'the nested package\'s test');
    cleanup(world.root); cleanup(repo);
  });

  await test('case 8: npm --prefix B test from repo A is judged by B\'s settings, record and building list', () => {
    const gh = makeGhStub({ lists: { repo: [issue(7)], b: [issue(21)] } });
    const across = (aSettings, bSettings, { aBuilding = true, bRecorded = false } = {}) => {
      const world = mkWorld();
      const a = repoWith(aSettings);
      const b = repoWith(bSettings);
      git(b, 'remote', 'set-url', 'origin', 'https://example.invalid/owner/b.git');
      if (!aBuilding) git(a, 'remote', 'set-url', 'origin', 'https://example.invalid/owner/a.git');
      if (bRecorded) plantRecord(world.workflowHome, b);
      const res = npmRun(world, a, ['--prefix', b, 'test'], gh);
      return { res, recordB: recorded(world, b), done: () => { cleanup(world.root); cleanup(a); cleanup(b); } };
    };

    const offB = across(OPT_IN, null);
    assertRuns(offB.res, 'B never opted in, A holding #7');
    assertEq(ghCalls(gh).length, 0, 'B never opted in: no gh call');
    offB.done();

    const provedB = across(OPT_IN, OPT_IN, { aBuilding: false, bRecorded: true });
    assertRefused(provedB.res, PROVED, 'B\'s tree recorded, A\'s not');
    provedB.done();

    const buildingB = across(OPT_IN, OPT_IN, { aBuilding: false });
    assertRefused(buildingB.res, HELD(21), 'B building #21, A nothing');
    assertEq(buildingB.recordB, undefined, 'the refused run writes B no record');
    buildingB.done();
  });

  group('suite hold: workkit prove and workkit test');

  await test('case 9: workkit prove refuses with the index tree already recorded, or an issue building', () => {
    const prove = (lists, setup) => {
      const w = mkGitRepo('suite-hold-prove-', {
        'package.json': `${JSON.stringify({ name: 'fixture', scripts: { test: RAN } })}\n`,
        'app.js': 'const x = 1;\n',
      });
      setup(w);
      const ranFile = path.join(w.dir, 'ran');
      const env = { ...wiredNpmEnv(w), ...sessionEnv(ranFile, makeGhStub({ lists }), true) };
      const res = judged(ranFile, () => runCli(w, ['prove'], { cwd: w.repo, env }));
      const marker = suiteMarkerPath(w.workflowHome, w.repo);
      return { res, record: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined, done: () => cleanup(w.dir) };
    };

    // Staged work, then an unstaged edit: the index tree is not the working tree.
    const stageThenEdit = (w) => {
      w.write('app.js', 'const x = 2;\n');
      w.git('add', 'app.js');
      w.write('app.js', 'const x = 3;\n');
    };
    const recordedIndex = prove({ repo: [] }, (w) => {
      stageThenEdit(w);
      plantRecord(w.workflowHome, w.repo, w.git('write-tree').trim());
    });
    assertRefused(recordedIndex.res, PROVED, 'the index tree recorded');
    recordedIndex.done();

    const building = prove({ repo: [issue(7)] }, stageThenEdit);
    assertRefused(building.res, HELD(7), 'an issue building');
    assertEq(building.record, undefined, 'the refused prove writes no record');
    building.done();
  });

  await test('case 10: a bare workkit test is held like a bare npm test', () => {
    const world = mkWorld();
    const repo = repoWith();
    const ranFile = path.join(world.root, 'ran');
    const env = { ...wiredNpmEnv(world), ...sessionEnv(ranFile, makeGhStub({ lists: { repo: [issue(7)] } }), true) };
    const res = judged(ranFile, () => runCli(world, ['test'], { cwd: repo, env }));
    assertRefused(res, HELD(7), 'a bare workkit test, #7 building');
    assertEq(recorded(world, repo), undefined, 'a refused run writes no record');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
