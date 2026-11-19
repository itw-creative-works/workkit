// Tests for treeId of workflow/lib/tree-hash.js and the exports of
// workflow/lib/records.js, where tree-hash.test.js and records.test.js leave
// off: a package's own id as edits land in a workspaces repo, the edits that do
// and do not move an id, the package record's path, its refusal of an empty
// tree, and the reads of both records.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  describe, test, before, expect, mkTmp, run,
} = require('../lib/harness');
const { plantRecord } = require('../lib/suite-record');
const { mkRepo } = require('../lib/script-shell');
const { kitUnder } = require('../lib/kit-under');
const { scratchWorkflowHome } = require('../lib/workflow-home');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');
const { treeId } = require('../../workflow/lib/tree-hash');

// Two tree ids a record can hold, neither a real tree.
const ID = '1111111111111111111111111111111111111111';
const OTHER_ID = '2222222222222222222222222222222222222222';

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// A committed workspaces repo: members a, b and c under packages/, c depending on a.
const WORKSPACES = {
  'packages/a/package.json': { name: 'a', version: '1.0.0' },
  'packages/a/index.js': 'module.exports = 1;\n',
  'packages/b/package.json': { name: 'b', version: '1.0.0' },
  'packages/b/index.js': 'module.exports = 2;\n',
  'packages/c/package.json': { name: 'c', version: '1.0.0', dependencies: { a: '1.0.0' } },
  'packages/c/index.js': 'module.exports = 3;\n',
};
const mkWorkspaces = (extra = {}) => mkRepo({ private: true, workspaces: ['packages/*'] }, { ...WORKSPACES, ...extra });

// A repo's settings at the retired shape, tracked; the heal leaves OPT_IN_SHAPES.current.
const STAMPED = { '.workkit/settings.json': OPT_IN_SHAPES.retired };

// The id of <pkg> (the whole tree with none), always a tree id.
const idOf = (dir, pkg) => {
  const id = treeId(dir, pkg);
  expect(/^[0-9a-f]{40,64}$/.test(id || ''), `a tree id for ${pkg || 'the whole tree'}, got: ${id}`).toBeTruthy();
  return id;
};

describe('the records', () => {
  describe('a package\'s own id in a workspaces repo', () => {
    const ids = (dir) => ({ a: idOf(dir, 'packages/a'), b: idOf(dir, 'packages/b'), c: idOf(dir, 'packages/c'), all: idOf(dir) });

    test('treeId <root> <pkg>: an edit changes the ids of the packages that can see it, and leaves the rest', () => {
      const dir = mkWorkspaces();
      const start = ids(dir);
      fs.writeFileSync(path.join(dir, 'packages', 'b', 'index.js'), 'module.exports = 20;\n');
      const bEdited = ids(dir);
      expect(bEdited.a, "an edit in packages/b leaves a's id").toBe(start.a);
      expect(bEdited.b !== start.b, "and changes b's").toBeTruthy();
      expect(bEdited.all !== start.all, "and the whole tree's").toBeTruthy();
      fs.writeFileSync(path.join(dir, 'packages', 'a', 'index.js'), 'module.exports = 10;\n');
      const aEdited = ids(dir);
      expect(aEdited.a !== bEdited.a, "an edit in packages/a changes a's id").toBeTruthy();
      expect(aEdited.c !== bEdited.c, "and c's, which depends on a").toBeTruthy();
      expect(aEdited.b, "and leaves b's").toBe(bEdited.b);
      fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', private: true, description: 'edited', workspaces: ['packages/*'] }));
      const rootEdited = ids(dir);
      for (const pkg of ['a', 'b', 'c']) expect(rootEdited[pkg] !== aEdited[pkg], `an edit to the root package.json changes ${pkg}'s id`).toBeTruthy();
      expect(idOf(dir, '.'), '`.` is the whole tree').toBe(rootEdited.all);
    });

    test('treeId <root> <pkg> in a repo with no workspaces field: every package is the whole tree', () => {
      const dir = mkRepo({ private: true }, {
        'packages/foo/package.json': { name: 'foo', scripts: { test: 'exit 0' } },
        'packages/bar/index.js': 'module.exports = 1;\n',
      });
      expect(idOf(dir, 'packages/foo'), "packages/foo's id is the whole tree's").toBe(idOf(dir));
    });
  });

  describe('a proof id leaves .workkit/ out', () => {
    test('treeId: the settings losing its version key and a suite log written leave the whole and the package id as recorded', () => {
      const dir = mkWorkspaces(STAMPED);
      const before = { all: idOf(dir), a: idOf(dir, 'packages/a') };
      fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
      fs.writeFileSync(path.join(dir, '.workkit', 'suite.log'), 'script-shell: exit 0\n');
      expect(idOf(dir), 'the whole tree keeps the id its record holds').toBe(before.all);
      expect(idOf(dir, 'packages/a'), "and so does packages/a's own id").toBe(before.a);
    });

    test('treeId: an edit to .gitignore, CHANGELOG.md or the checks workflow changes the id, only .workkit/ is left out', () => {
      const dir = mkRepo({ private: true }, {
        ...STAMPED, '.gitignore': 'node_modules/\n', 'CHANGELOG.md': '# Changelog\n', '.github/workflows/checks.yml': 'name: checks\n',
      });
      let last = idOf(dir);
      for (const rel of ['.gitignore', 'CHANGELOG.md', '.github/workflows/checks.yml']) {
        fs.appendFileSync(path.join(dir, rel), '# edited\n');
        const now = idOf(dir);
        expect(now !== last, `an edit to ${rel} changes the id`).toBeTruthy();
        last = now;
      }
    });
  });

  describe('the records read and written', () => {
    // HOME and WORKFLOW_HOME are handed over: a record lives under the workflow
    // home's markers folder, never the machine's.
    let HOME;
    before(() => {
      HOME = scratchWorkflowHome('lib-record-home-');
    });

    // A git root and its own workflow home, so no case reads another's record;
    // `ask(name, ...asks)` runs records.js's <name> once per argument list, root first.
    const pkgWorld = () => {
      const dir = mkTmp('lib-pkg-');
      run('git', ['init', '-q'], { cwd: dir });
      const { workflowHome: wh, env: homeEnv } = scratchWorkflowHome('lib-pkg-home-');
      const env = { PATH: process.env.PATH, ...homeEnv };
      const root = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir }).stdout.trim();
      const ask = (name, ...asks) => kitUnder(env, 'records.js', name, asks.map((args) => [root, ...args]));
      return { dir, wh, ask };
    };

    test('suiteHolds: true only when the record holds the tree it is handed', () => {
      const { dir, wh, ask } = pkgWorld();
      expect(ask('suiteHolds', [ID])[0], 'no record proves nothing').toBe(false);
      plantRecord(wh, dir, ID);
      expect(JSON.stringify(ask('suiteHolds', [ID], [OTHER_ID], [''])), 'the recorded tree is proved, another tree and an empty one (a failed hash) are not')
        .toBe(JSON.stringify([true, false, false]));
    });

    test('pkgMarkerPath is the package marker dir plus the sha of the root, never the suite record', async () => {
      const markers = mods('markers');
      const pkg = await markers.pkgMarkerPath('/repos/thing', HOME.env.WORKFLOW_HOME);
      expect(pkg, 'the path').toBe(`${HOME.env.WORKFLOW_HOME}/markers/claude-package-marker/${sha1('/repos/thing')}`);
      expect(pkg !== await markers.suiteMarkerPath('/repos/thing', HOME.env.WORKFLOW_HOME), 'a different file from the suite record').toBeTruthy();
    });

    test('writePkgRecord: an empty tree is refused and leaves no record', () => {
      const { wh, ask } = pkgWorld();
      expect(ask('writePkgRecord', ['', '.'])[0], 'an empty tree (a failed hash) is refused').toBe(false);
      expect(!fs.existsSync(path.join(wh, 'markers', 'claude-package-marker')), 'and leaves no record').toBeTruthy();
    });

    test('pkgHolds: the first package line and a later one, on the recorded tree only', () => {
      const { ask } = pkgWorld();
      expect(ask('pkgHolds', [ID, '.'])[0], 'no record proves nothing').toBe(false);
      expect(JSON.stringify(ask('writePkgRecord', [ID, '.'], [ID, 'packages/foo'])), 'the root, then the nested package, written').toBe(JSON.stringify([true, true]));
      const asks = [[ID, '.'], [ID, 'packages/foo'], [ID, 'packages/bar'], [ID, 'packages/fo'], [OTHER_ID, '.'], ['', '.']];
      expect(JSON.stringify(ask('pkgHolds', ...asks)),
        'the first line and a later one are proved; a package never recorded, a prefix of a recorded folder, another tree and an empty tree are not')
        .toBe(JSON.stringify([true, true, false, false, false, false]));
    });

    test('the suite record and the package record never stand in for each other', () => {
      const suiteOnly = pkgWorld();
      plantRecord(suiteOnly.wh, suiteOnly.dir, ID);
      expect(suiteOnly.ask('suiteHolds', [ID])[0], 'the planted suite record proves its tree').toBe(true);
      expect(suiteOnly.ask('pkgHolds', [ID, '.'])[0], 'a suite record is no package record').toBe(false);
      const pkgOnly = pkgWorld();
      expect(pkgOnly.ask('writePkgRecord', [ID, '.'])[0], 'the package record is written').toBe(true);
      expect(pkgOnly.ask('suiteHolds', [ID])[0], 'a package record is no suite record').toBe(false);
    });
  });
});
