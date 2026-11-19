// Tests for workflow/lib/hold.js, the full-suite hold as an export: suiteHold(root, readTree)
// called in a node of its own under a world's env (the session, the gh stub first on PATH,
// the machine folder the records live in), one case per branch. The run it judges and the
// two commands that ask it are suite-hold.test.js's.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, seeded,
} = require('../lib/harness');
const {
  NODE_DIR, SYSTEM_PATH, jsPath, shellPath, joinPath, homeEnv, samePath,
} = require('../lib/platform');
const { OPT_IN_SHAPES, FIXTURE_ORIGIN } = require('../lib/git-repo');
const { suiteMarkerPath, plantRecord } = require('../lib/suite-record');
const { makeGhStub, ghCalls } = require('../lib/gh-stub');

const HOLD = path.join(__dirname, '..', '..', 'workflow', 'lib', 'hold.js');

// Two tree ids a reader can answer, neither a real tree.
const TREE = '1'.repeat(40);
const OTHER_TREE = '2'.repeat(40);

const NARROW = "Run the narrowest test that proves the change (`npm test -- <file>` from the package's folder)";
const PROVED_HEAD = 'suite-hold: this tree is already proved: the full suite ran green on it and ';
const PROVED_TAIL = ` records it. ${NARROW}; the commit gate reads the same record for a commit whose staged tree matches it. Never set HOOK_DISABLE or clear CLAUDECODE to get past this hold.`;
const BUILDING_LINE = 'suite-hold: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: #7 (status:building), #9 (status:building). That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item, set HOOK_DISABLE or clear CLAUDECODE to get past this hold. Run the narrowest test that proves the change (`npm test -- <file>` from the package\'s folder).';
const UNREAD_LINE = 'suite-hold: could not read the open issues at status:building (gh could not answer), so the building hold did not run on this command.';
const UNHASHED_LINE = 'suite-hold: the tree could not be hashed, so the proved-tree check did not run; the building hold still judges';

const building = (number) => ({ number, labels: [{ name: 'status:building' }, { name: 'type:feature' }] });

// A committed repo on main, opted in, its origin the fixture's (the slug owner/repo).
const seedRepo = seeded((dir) => {
  const env = homeEnv(mkTmp('hold-seed-home-'), { PATH: process.env.PATH });
  const git = (...args) => {
    const res = run('git', args, { cwd: dir, env });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  };
  fs.mkdirSync(path.join(dir, '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', FIXTURE_ORIGIN);
});

/** A world of its own: the repo copied in, a scratch home whose `.workkit` holds the records; `root` is git's spelling. */
const world = () => {
  const base = mkTmp('hold-');
  const repo = path.join(base, 'repo');
  seedRepo(repo);
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const root = run('git', ['rev-parse', '--show-toplevel'], { cwd: repo }).stdout.trim();
  return { repo, root, home, workflowHome: path.join(home, '.workkit') };
};

// The caller: suiteHold(root, readTree) awaited, readTree answering the tree given ('-' answers
// none, the way a failed hash does; '!' throws, as treeId does with no temp folder); stdout says
// what it answered and whether the tree was read.
const CALLER = [
  `const { suiteHold } = require(${jsPath(HOLD)});`,
  'const [root, tree] = process.argv.slice(1);',
  'let read = false;',
  "const readTree = () => { read = true; if (tree === '!') throw new Error('the temp folder is gone'); return tree === '-' ? null : tree; };",
  'Promise.resolve(suiteHold(root, readTree)).then((runs) => process.stdout.write(JSON.stringify({ runs, read })));',
].join('\n');

/**
 * suiteHold asked for <w>'s root with the reader answering <tree>, <gh> first on PATH, in a
 * Claude session unless <env> says otherwise: what it answered, whether the tree was read,
 * and its stderr.
 */
const ask = (w, tree, gh, env = {}) => {
  const res = run(process.execPath, ['-e', CALLER, w.root, tree], {
    cwd: w.repo,
    env: homeEnv(w.home, {
      PATH: joinPath(gh.binDir, NODE_DIR, SYSTEM_PATH), WORKFLOW_HOME: shellPath(w.workflowHome), CLAUDECODE: '1', ...env,
    }),
  });
  expect(res.status, `the caller ran to its end, output: ${res.output}`).toBe(0);
  return { ...JSON.parse(res.stdout), err: res.stderr };
};

describe('suiteHold', () => {
  test('unjudged: outside a Claude session, under HOOK_DISABLE=1 or in a repo not opted in, it allows and says nothing, the tree never read and gh never asked', () => {
    const shapes = [
      ['no CLAUDECODE', { CLAUDECODE: undefined }, null],
      ['HOOK_DISABLE=1', { HOOK_DISABLE: '1' }, null],
      ['a declined repo', {}, '{ "version": 1, "enabled": false }\n'],
    ];
    for (const [label, env, settings] of shapes) {
      const w = world();
      if (settings) fs.writeFileSync(path.join(w.repo, '.workkit', 'settings.json'), settings);
      plantRecord(w.workflowHome, w.repo, TREE);
      const gh = makeGhStub({ lists: { repo: [building(7)] } });
      const said = ask(w, TREE, gh, env);
      expect(said.runs, `${label}: the run may go on, stderr: ${said.err}`).toBe(true);
      expect(said.err, `${label}: nothing said`).toBe('');
      expect(said.read, `${label}: the tree was never read`).toBe(false);
      expect(ghCalls(gh).length, `${label}: gh never asked`).toBe(0);
    }
  });

  test('a reader that fails: its one line, the proved-tree check skipped, and the building hold still judges', () => {
    const w = world();
    plantRecord(w.workflowHome, w.repo, '');
    const clear = ask(w, '-', makeGhStub({ lists: { repo: [] } }));
    expect(clear.runs, `nothing building: the run may go on, stderr: ${clear.err}`).toBe(true);
    expect(clear.err, 'nothing building: the one line').toBe(`${UNHASHED_LINE}\n`);
    const held = ask(w, '-', makeGhStub({ lists: { repo: [building(7), building(9)] } }));
    expect(held.runs, 'two issues building: refused').toBe(false);
    expect(held.err, 'the line, then the building hold\'s').toBe(`${UNHASHED_LINE}\n${BUILDING_LINE}\n`);
  });

  test('a reader that throws: an unreadable tree, its one line, and the building hold still judges', () => {
    const w = world();
    plantRecord(w.workflowHome, w.repo, '');
    const clear = ask(w, '!', makeGhStub({ lists: { repo: [] } }));
    expect(clear.runs, `nothing building: the run may go on, stderr: ${clear.err}`).toBe(true);
    expect(clear.err, 'nothing building: the one line').toBe(`${UNHASHED_LINE}\n`);
    const held = ask(w, '!', makeGhStub({ lists: { repo: [building(7), building(9)] } }));
    expect(held.runs, 'two issues building: refused').toBe(false);
    expect(held.err, 'the line, then the building hold\'s').toBe(`${UNHASHED_LINE}\n${BUILDING_LINE}\n`);
  });

  test('a proved tree: refused with its line naming the record, gh never asked', () => {
    const w = world();
    plantRecord(w.workflowHome, w.repo, TREE);
    const gh = makeGhStub({ lists: { repo: [] } });
    const said = ask(w, TREE, gh);
    expect(said.runs, 'refused').toBe(false);
    const line = said.err.replace(/\n$/, '');
    expect(said.err.endsWith('\n') && !line.includes('\n') && line.startsWith(PROVED_HEAD) && line.endsWith(PROVED_TAIL),
      `one line, the proved-tree text, got: ${JSON.stringify(said.err)}`).toBe(true);
    const named = line.slice(PROVED_HEAD.length, line.length - PROVED_TAIL.length);
    expect(samePath(named, suiteMarkerPath(w.workflowHome, w.repo), process.platform), `it names the suite record, got: ${named}`).toBe(true);
    expect(ghCalls(gh).length, 'gh never asked').toBe(0);
  });

  test('no slug: a repo with no origin allows and says nothing, gh never asked', () => {
    const w = world();
    run('git', ['remote', 'remove', 'origin'], { cwd: w.repo });
    const gh = makeGhStub({ lists: { repo: [building(7)] } });
    const said = ask(w, TREE, gh);
    expect(said.runs, `the run may go on, stderr: ${said.err}`).toBe(true);
    expect(said.err, 'nothing said').toBe('');
    expect(ghCalls(gh).length, 'gh never asked').toBe(0);
  });

  test('a building list gh cannot answer: its one line, and the run may go on', () => {
    const w = world();
    const gh = makeGhStub({ lists: {}, fails: true });
    const said = ask(w, TREE, gh);
    expect(ghCalls(gh).length > 0, 'the list was asked for').toBe(true);
    expect(said.runs, 'the run may go on').toBe(true);
    expect(said.err, 'the one line').toBe(`${UNREAD_LINE}\n`);
  });

  test('issues at status:building: refused, the one line naming each', () => {
    const w = world();
    plantRecord(w.workflowHome, w.repo, OTHER_TREE);
    const said = ask(w, TREE, makeGhStub({ lists: { repo: [building(7), building(9)] } }));
    expect(said.runs, 'refused').toBe(false);
    expect(said.err, 'the one line').toBe(`${BUILDING_LINE}\n`);
  });

  test('a clear run: another tree recorded and nothing building, it allows and says nothing, the tree read', () => {
    const w = world();
    plantRecord(w.workflowHome, w.repo, OTHER_TREE);
    const gh = makeGhStub({ lists: { repo: [] } });
    const said = ask(w, TREE, gh);
    expect(said.runs, `the run may go on, stderr: ${said.err}`).toBe(true);
    expect(said.err, 'nothing said').toBe('');
    expect(said.read, 'the tree was read').toBe(true);
    expect(ghCalls(gh).length > 0, 'the building list was asked for').toBe(true);
  });
});
