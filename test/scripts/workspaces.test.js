// Tests for workflow/lib/workspaces.js, the read of npm's workspaces declaration
// that keys a package's test record to the code it can see: excludedFor names
// the members a package neither is nor depends on, the folders a package's tree
// id drops from its throwaway index.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { shellPath } = require('../lib/platform');
const { mkRepo } = require('../lib/script-shell');
const { runLib } = require('../lib/hook-lib');

const MODULE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'workspaces.js');
const workspaces = () => require(MODULE);

/** A folder holding a root package.json (<root> merged over a name) and each member's by folder. */
const mkPackages = (root, members) => {
  const dir = mkTmp('workspaces-');
  const write = (rel, value) => {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify(value));
  };
  write('.', { name: 'fixture', private: true, ...root });
  for (const [rel, value] of Object.entries(members)) write(rel, { version: '1.0.0', ...value });
  return dir;
};

// Members a, b and c under packages/, c depending on a.
const MEMBERS = {
  'packages/a': { name: 'a' },
  'packages/b': { name: 'b' },
  'packages/c': { name: 'c', dependencies: { a: '1.0.0' } },
};

// excludedFor's answer for <pkg> in <root>, and the lines it wrote to stderr (console.error) meanwhile.
const excludedWithLines = (t, root, pkg) => {
  const said = t.mock.method(console, 'error', () => {});
  const folders = workspaces().excludedFor(root, pkg);
  const lines = said.mock.calls.map((c) => c.arguments.join(' '));
  said.mock.restore();
  return { folders, lines };
};

const sorted = (list) => JSON.stringify([...list].sort());

const FAMILY = mkPackages({ workspaces: ['packages/*'] }, MEMBERS);

describe('workspaces.js: the members a package neither is nor depends on', () => {
  test('excludedFor: a member drops the members it does not depend on, `.` drops none', () => {
    const { excludedFor } = workspaces();
    expect(sorted(excludedFor(FAMILY, 'packages/a')), 'a depends on no member').toBe(sorted(['packages/b', 'packages/c']));
    expect(sorted(excludedFor(FAMILY, 'packages/c')), 'c keeps a, the member it depends on').toBe(sorted(['packages/b']));
    expect(sorted(excludedFor(FAMILY, '.')), 'the root sees every member').toBe('[]');
  });

  test('excludedFor: a dependency through another member is still one the package sees', () => {
    const { excludedFor } = workspaces();
    const chain = mkPackages({ workspaces: ['packages/*'] }, {
      ...MEMBERS, 'packages/d': { name: 'd', dependencies: { c: '1.0.0' } },
    });
    expect(sorted(excludedFor(chain, 'packages/d')), 'd sees c and, through c, a').toBe(sorted(['packages/b']));
  });

  test('excludedFor: an optional dependency on a member keeps that member in the id', () => {
    const { excludedFor } = workspaces();
    const optional = mkPackages({ workspaces: ['packages/*'] }, {
      ...MEMBERS, 'packages/a': { name: 'a', optionalDependencies: { b: '*' } },
    });
    expect(sorted(excludedFor(optional, 'packages/a')), 'a keeps b, its optional dependency').toBe(sorted(['packages/c']));
  });

  // A committed repo with members packages/a and packages/a/sub, and b depending on <bDeps>.
  const mkNested = (bDeps) => mkRepo({ private: true, workspaces: ['packages/*', 'packages/a/sub'] }, {
    'packages/a/package.json': { name: 'a', version: '1.0.0' },
    'packages/a/sub/package.json': { name: 'sub', version: '1.0.0' },
    'packages/a/sub/index.js': 'module.exports = 1;\n',
    'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: bDeps },
  });
  const bId = (dir) => {
    const out = runLib(`wk_tree_hash "${shellPath(dir)}" packages/b`,
      { TMPDIR: shellPath(mkTmp('workspaces-tmp-')), WORKKIT_NODE: shellPath(process.execPath) });
    const id = out.stdout.trim();
    expect(/^[0-9a-f]{40,64}$/.test(id), `a tree id for packages/b, got: ${out.stdout}|${out.stderr}`).toBeTruthy();
    return id;
  };
  const editSub = (dir) => fs.writeFileSync(path.join(dir, 'packages', 'a', 'sub', 'index.js'), 'module.exports = 2;\n');

  test('excludedFor: a nested member a package depends on keeps its parent member in the id; one it does not, both drop', () => {
    const { excludedFor } = workspaces();
    const kept = mkNested({ sub: '1.0.0' });
    expect(sorted(excludedFor(kept, 'packages/b')), 'b depends on sub, so neither sub nor a, its parent, drops').toBe('[]');
    const keptId = bId(kept);
    editSub(kept);
    expect(bId(kept) !== keptId, "an edit under packages/a/sub changes b's id").toBeTruthy();

    const dropped = mkNested({});
    expect(sorted(excludedFor(dropped, 'packages/b')), 'b depends on neither').toBe(sorted(['packages/a', 'packages/a/sub']));
    const droppedId = bId(dropped);
    editSub(dropped);
    expect(bId(dropped), "and the edit under packages/a/sub leaves b's id").toBe(droppedId);
  });

  test('excludedFor: a folder that is no member drops every member it does not depend on', () => {
    const { excludedFor } = workspaces();
    const withFunctions = mkPackages({ workspaces: ['packages/*'] }, MEMBERS);
    fs.mkdirSync(path.join(withFunctions, 'functions'));
    fs.writeFileSync(path.join(withFunctions, 'functions', 'package.json'), JSON.stringify({ name: 'functions' }));
    expect(sorted(excludedFor(withFunctions, 'functions')), 'every member').toBe(sorted(['packages/a', 'packages/b', 'packages/c']));
  });

  test('excludedFor: a repo with no workspaces field drops nothing', () => {
    const { excludedFor } = workspaces();
    const plain = mkPackages({}, MEMBERS);
    expect(sorted(excludedFor(plain, 'packages/a')), 'no members, nothing to drop').toBe('[]');
  });
});

describe('workspaces.js: a read that fails keys the package to the whole tree', () => {
  test('an unexpandable pattern drops no folder and says one workspaces: line naming it and the package', (t) => {
    const deep = mkPackages({ workspaces: ['packages/**'] }, MEMBERS);
    const { folders, lines } = excludedWithLines(t, deep, 'packages/a');
    expect(sorted(folders), 'no folder: the package keeps the whole tree').toBe('[]');
    expect(lines.length, `one line, got: ${JSON.stringify(lines)}`).toBe(1);
    expect(lines[0].startsWith('workspaces: ') && lines[0].endsWith('; packages/a keyed to the whole tree'),
      `the line speaks as workspaces: and keys the package to the whole tree, got: ${lines[0]}`).toBeTruthy();
    expect(lines[0].slice('workspaces: '.length).includes('packages/**'), `and names the pattern, got: ${lines[0]}`).toBeTruthy();
  });

  test('a member with a malformed package.json drops no folder and says a line naming that file', (t) => {
    const broken = mkPackages({ workspaces: ['packages/*'] }, MEMBERS);
    fs.writeFileSync(path.join(broken, 'packages', 'b', 'package.json'), '{bad');
    const { folders, lines } = excludedWithLines(t, broken, 'packages/a');
    expect(sorted(folders), 'no folder: the package keeps the whole tree').toBe('[]');
    expect(lines.some((l) => /packages[\\/]b[\\/]package\.json/.test(l)), `a line names the malformed file, got: ${JSON.stringify(lines)}`).toBeTruthy();
  });
});
