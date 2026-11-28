// Tests for workflow/lib/tree-copy.js, the Node home of a tree copy: copyTree with `only`, a
// copy equal to its source on every platform (links kept as links, modes and times kept, no
// `cp` started); fillCopy, each package's node_modules a real folder of links to the live
// repo's entries, a workspace link pointed into the copy; heldModules; worktreeAdd and
// worktreeRemove on a real scratch repo. The whole copy a take makes (.git, every package's
// node_modules and the kit's own paths left out) is test/hooks/workflow-snapshot.test.js's,
// through the snapshot command.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, needs,
} = require('../lib/harness');
const {
  IS_WINDOWS, homeEnv, samePath, skipWithoutFileLink, stubToolJs, pathWith, spawnSync,
} = require('../lib/platform');
const { recordArgvJs, readArgv } = require('../lib/argv-log');
const { underEnv } = require('../lib/under-env');
const { mkRepo } = require('../lib/git-repo');
const { treeOf, takeSnapshot } = require('../lib/red-snapshot');

// A scratch home and machine folder for this process, set before tree-copy.js loads, so
// the kit's own paths and git's ignore rules are this suite's own, never the machine's.
const HOME = mkTmp('tree-copy-home-');
Object.assign(process.env, homeEnv(HOME, { WORKFLOW_HOME: path.join(HOME, '.workkit') }));
delete process.env.XDG_CONFIG_HOME;

const {
  copyTree, fillCopy, heldModules, worktreeAdd, worktreeRemove,
} = require('../../workflow/lib/tree-copy');

/** A fresh empty folder to copy into. */
const emptyDest = () => mkTmp('tree-copy-dest-');

/** Where `p` resolves, links followed, with forward slashes. */
const real = (p) => fs.realpathSync(p).replace(/\\/g, '/');

/** Whether `p` is a real folder, no link. */
const realFolder = (p) => {
  const st = fs.lstatSync(p);
  return st.isDirectory() && !st.isSymbolicLink();
};

/** Each file under `root` by its path: its permission bits and its modified time. */
const modesAndTimes = (root) => Object.fromEntries(Object.entries(treeOf(root))
  .filter(([, kind]) => kind.startsWith('file '))
  .map(([rel]) => {
    const st = fs.lstatSync(path.join(root, rel));
    return [rel, { mode: (st.mode & 0o777).toString(8), mtime: st.mtimeMs }];
  }));

/** What `fn` gave back, or what it threw or rejected with. */
const outcome = async (fn) => {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
};

/** The paths `git worktree list` holds for the world's repo, in its order. */
const worktrees = (w) => w.git('worktree', 'list', '--porcelain').split('\n')
  .filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));

describe('copyTree', () => {
  test('with only: just the named paths, a named package folder without its node_modules', async () => {
    const w = mkRepo('tree-copy-only-', {
      '.gitignore': 'node_modules/\n',
      'src/x.js': 'module.exports = 1;\n',
      'docs/readme.md': 'docs\n',
      'pkg/package.json': '{"name":"pkg"}\n',
      'pkg/index.js': 'module.exports = 2;\n',
    }, undefined, { optIn: false });
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    w.write('node_modules/top/index.js', 'module.exports = 8;\n');
    const dest = emptyDest();
    await copyTree(w.repo, w.repo, dest, ['src', 'pkg']);
    expect(treeOf(dest)).toEqual({
      src: 'dir',
      [path.join('src', 'x.js')]: 'file module.exports = 1;\n',
      pkg: 'dir',
      [path.join('pkg', 'index.js')]: 'file module.exports = 2;\n',
      [path.join('pkg', 'package.json')]: 'file {"name":"pkg"}\n',
    });
  });

  // Each link sorts before its target, so a copy that types a link by looking at
  // a target not yet copied would guess; a folder link typed as a file reads as nothing.
  test('a folder link and a file link come over as links with their targets, each read through to its target', {
    skip: skipWithoutFileLink(),
  }, async () => {
    const src = mkTmp('tree-copy-links-');
    fs.mkdirSync(path.join(src, 'real'));
    fs.writeFileSync(path.join(src, 'real', 'a.txt'), 'a\n');
    fs.symlinkSync('real', path.join(src, 'a-dirlink'), 'dir');
    fs.symlinkSync(path.join('real', 'a.txt'), path.join(src, 'a-filelink'), 'file');
    const dest = emptyDest();
    await copyTree(src, src, dest);
    for (const [name, target] of [['a-dirlink', 'real'], ['a-filelink', 'real/a.txt']]) {
      expect(fs.lstatSync(path.join(dest, name)).isSymbolicLink(), `${name} is a link in the copy`).toBe(true);
      expect(fs.readlinkSync(path.join(dest, name)).replace(/\\/g, '/'), `${name}'s target`).toBe(target);
    }
    expect(fs.readdirSync(path.join(dest, 'a-dirlink')), 'the folder link lists its target\'s entry').toEqual(['a.txt']);
    expect(fs.readFileSync(path.join(dest, 'a-filelink'), 'utf8'), 'the file link reads its target').toBe('a\n');
  });

  // A read-only file and a group-run one differ from a fresh file's mode on every platform,
  // and an old whole-second time from the moment of the copy.
  test('a copied tree equals its source: a dangling link kept as a link, each file\'s mode and time kept, and no cp started', {
    skip: skipWithoutFileLink(),
  }, async () => {
    const src = mkTmp('tree-copy-same-');
    const old = new Date('2020-01-02T03:04:05Z');
    fs.mkdirSync(path.join(src, 'bin'));
    fs.writeFileSync(path.join(src, 'bin', 'run'), 'run\n');
    fs.chmodSync(path.join(src, 'bin', 'run'), 0o750);
    fs.writeFileSync(path.join(src, 'notes.txt'), 'kept\n');
    fs.utimesSync(path.join(src, 'bin', 'run'), old, old);
    fs.utimesSync(path.join(src, 'notes.txt'), old, old);
    fs.chmodSync(path.join(src, 'notes.txt'), 0o444);
    fs.symlinkSync(path.join('bin', 'run'), path.join(src, 'run-link'), 'file');
    fs.symlinkSync('gone', path.join(src, 'dangling'), 'file');
    const bin = mkTmp('tree-copy-bin-');
    const log = path.join(bin, 'cp.log');
    stubToolJs(bin, 'cp', recordArgvJs(JSON.stringify(log)));
    const dest = emptyDest();
    await underEnv({ PATH: pathWith(bin) }, () => copyTree(src, src, dest));
    expect(readArgv(log), 'no cp was started').toEqual([]);
    expect(fs.lstatSync(path.join(dest, 'dangling')).isSymbolicLink(), 'the dangling link is a link in the copy').toBe(true);
    expect(treeOf(dest), 'every entry, link target and file text as the source has it').toEqual(treeOf(src));
    expect(modesAndTimes(dest), 'every file\'s mode and modified time as the source has them').toEqual(modesAndTimes(src));
  });

  // A FIFO opened for its text waits for a writer that never comes, so a copy
  // that read it would never end.
  test('a FIFO in the source tree is left out, and the copy still ends with the rest', {
    skip: (IS_WINDOWS && 'Windows has no FIFO in a folder') || needs('mkfifo'),
  }, async () => {
    const src = mkTmp('tree-copy-fifo-');
    fs.writeFileSync(path.join(src, 'kept.txt'), 'kept\n');
    const made = spawnSync('mkfifo', [path.join(src, 'pipe')], { encoding: 'utf8' });
    expect(made.status, `mkfifo made the FIFO: ${made.stderr}`).toBe(0);
    const dest = emptyDest();
    await copyTree(src, src, dest);
    // Names first: reading a copied FIFO's text would wait and never fail.
    expect(fs.readdirSync(dest), 'the file copied, the FIFO not').toEqual(['kept.txt']);
    expect(treeOf(dest), 'the copied file holds its text').toEqual({ 'kept.txt': 'file kept\n' });
  });
});

/**
 * A workspaces repo: packages/a (`@scope/a`, with cli.js) behind the relative link
 * node_modules/@scope/a, the plain packages node_modules/dep and node_modules/@scope/b,
 * and packages/a's own node_modules/inner; every node_modules ignored.
 */
const mkWorkspaces = () => {
  const w = mkRepo('tree-copy-fill-', {
    'package.json': `${JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })}\n`,
    '.gitignore': 'node_modules/\n',
    'packages/a/package.json': '{"name":"@scope/a"}\n',
    'packages/a/cli.js': 'module.exports = 1;\n',
    'src/x.js': 'module.exports = 1;\n',
  });
  w.write('node_modules/dep/cli.js', 'module.exports = 7;\n');
  w.write('node_modules/@scope/b/index.js', 'module.exports = 8;\n');
  w.write('packages/a/node_modules/inner/index.js', 'module.exports = 9;\n');
  fs.symlinkSync(path.join('..', '..', 'packages', 'a'), path.join(w.repo, 'node_modules', '@scope', 'a'), 'dir');
  return w;
};

/** The world's snapshot tree filled into a fresh folder: the folder. */
const filled = async (w) => {
  const tree = path.join(takeSnapshot(w), 'tree');
  const dest = emptyDest();
  await fillCopy(tree, w.repo, dest);
  return dest;
};

describe('fillCopy', () => {
  test('each package\'s node_modules a real folder whose entries are the live repo\'s, a scope filled one level down, the workspace link pointed into the copy', async () => {
    const w = mkWorkspaces();
    const dest = await filled(w);
    const at = (...parts) => path.join(dest, ...parts);
    expect(fs.readFileSync(at('src', 'x.js'), 'utf8'), 'the tree copied').toBe('module.exports = 1;\n');
    expect(realFolder(at('node_modules')), 'node_modules is a real folder').toBe(true);
    expect(real(at('node_modules', 'dep')), 'dep is the live repo\'s').toBe(real(path.join(w.repo, 'node_modules', 'dep')));
    expect(realFolder(at('node_modules', '@scope')), 'the scope is a real folder').toBe(true);
    expect(real(at('node_modules', '@scope', 'b')), '@scope/b is the live repo\'s').toBe(real(path.join(w.repo, 'node_modules', '@scope', 'b')));
    expect(real(at('node_modules', '@scope', 'a')), 'the workspace @scope/a is the copy\'s package').toBe(real(at('packages', 'a')));
    expect(realFolder(at('packages', 'a', 'node_modules')), 'packages/a/node_modules is a real folder').toBe(true);
    expect(real(at('packages', 'a', 'node_modules', 'inner')), 'inner is the live repo\'s')
      .toBe(real(path.join(w.repo, 'packages', 'a', 'node_modules', 'inner')));
  });

  test('.bin filled one level down: a bin into the workspace runs the copy\'s file, any other the live one', { skip: skipWithoutFileLink() }, async () => {
    const w = mkWorkspaces();
    fs.mkdirSync(path.join(w.repo, 'node_modules', '.bin'));
    fs.symlinkSync(path.join('..', '@scope', 'a', 'cli.js'), path.join(w.repo, 'node_modules', '.bin', 'a-cli'), 'file');
    fs.symlinkSync(path.join('..', 'dep', 'cli.js'), path.join(w.repo, 'node_modules', '.bin', 'dep-cli'), 'file');
    const dest = await filled(w);
    expect(realFolder(path.join(dest, 'node_modules', '.bin')), '.bin is a real folder').toBe(true);
    expect(real(path.join(dest, 'node_modules', '.bin', 'a-cli')), 'a-cli runs the copy\'s cli.js').toBe(real(path.join(dest, 'packages', 'a', 'cli.js')));
    expect(real(path.join(dest, 'node_modules', '.bin', 'dep-cli')), 'dep-cli runs the live one').toBe(real(path.join(w.repo, 'node_modules', 'dep', 'cli.js')));
  });
});

describe('heldModules', () => {
  test('each node_modules beside a package.json git sees, tracked or untracked, that exists; none beside no package, an ignored one or a package without it', async () => {
    const w = mkRepo('tree-copy-held-', {
      '.gitignore': 'node_modules/\ncache/\n',
      'package.json': '{"name":"root"}\n',
      'pkg/package.json': '{"name":"pkg"}\n',
      'bare/package.json': '{"name":"bare"}\n',
    });
    w.write('loose/package.json', '{"name":"loose"}\n');
    w.write('cache/app/package.json', '{"name":"app"}\n');
    for (const rel of ['node_modules', 'pkg/node_modules', 'loose/node_modules', 'cache/app/node_modules', 'orphan/node_modules']) {
      w.write(`${rel}/x/index.js`, 'module.exports = 1;\n');
    }
    const root = real(w.repo);
    const held = (await heldModules(w.repo))
      .map((p) => path.relative(root, real(path.isAbsolute(p) ? p : path.join(w.repo, p))).replace(/\\/g, '/'))
      .sort();
    expect(held).toEqual(['loose/node_modules', 'node_modules', 'pkg/node_modules']);
  });

  test('a folder in no git work tree holds none', async () => {
    const dir = mkTmp('tree-copy-nogit-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
    expect([...(await heldModules(dir))]).toEqual([]);
  });
});

describe('worktreeAdd and worktreeRemove', () => {
  test('add: a worktree of HEAD at the folder, listed; remove, forced past a change in it: the folder gone and the list back to one', async () => {
    const w = mkRepo('tree-copy-wt-', { 'src/x.js': 'module.exports = 1;\n' });
    const dest = path.join(mkTmp('tree-copy-wt-run-'), 'copy');
    const added = await outcome(() => worktreeAdd(w.repo, dest));
    expect(!added.error && added.value !== false, `the add went through: ${added.error}`).toBe(true);
    const list = worktrees(w);
    expect(list.length === 2 && samePath(real(list[1]), real(dest), process.platform), `the list names the copy: ${list}`).toBe(true);
    expect(w.git('-C', dest, 'rev-parse', 'HEAD'), 'the copy is at HEAD').toBe(w.git('rev-parse', 'HEAD'));
    fs.writeFileSync(path.join(dest, 'stray.txt'), 'left in the copy\n');
    await worktreeRemove(w.repo, dest);
    expect(fs.existsSync(dest), 'the copy is gone').toBe(false);
    expect(worktrees(w).length, 'the list is back to one').toBe(1);
  });

  test('add over a folder git refuses: no worktree, and the failure is said', async () => {
    const w = mkRepo('tree-copy-wt-', { 'src/x.js': 'module.exports = 1;\n' });
    const dest = mkTmp('tree-copy-wt-taken-');
    fs.writeFileSync(path.join(dest, 'there.txt'), 'already here\n');
    const added = await outcome(() => worktreeAdd(w.repo, dest));
    expect(Boolean(added.error) || added.value === false, `the add says it failed: ${JSON.stringify(added.value)}`).toBe(true);
    expect(worktrees(w).length, 'no worktree added').toBe(1);
  });

  test('remove of a worktree git no longer recognizes: the folder removed and the list pruned', async () => {
    const w = mkRepo('tree-copy-wt-', { 'src/x.js': 'module.exports = 1;\n' });
    const dest = path.join(mkTmp('tree-copy-wt-run-'), 'copy');
    await worktreeAdd(w.repo, dest);
    fs.rmSync(path.join(dest, '.git'), { force: true });
    fs.writeFileSync(path.join(dest, 'stray.txt'), 'left in the copy\n');
    await worktreeRemove(w.repo, dest);
    expect(fs.existsSync(dest), 'the copy is gone').toBe(false);
    expect(worktrees(w).length, 'the list is pruned back to one').toBe(1);
  });
});
