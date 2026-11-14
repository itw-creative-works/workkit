// Tests for workflow:snapshot: snapshotPlan({ lines, cwd, roster, slugOf, building }) in hooks/mods/snapshot.js decides,
// over one Bash call's gh journal lines, a take at a claim and a drop at a release leaving none building or at qa (a real gh
// call through the shim proves the line read); `bash hooks/lib/snapshot.sh take|add|stale|drop <root>` copies for real
// in a temp repo with its own home. The wiring, the loader's take, a claim's mode: test/mods/post-tool-use-bash.test.ts.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, start, until, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, SYSTEM_PATH, shellPath, which, stubTool, joinPath, systemPathWith, homeEnv,
} = require('../lib/platform');
const { makeGhStub, ghCalls } = require('../lib/gh-stub');
const { mkRepo, mkOriginRepo } = require('../lib/git-repo');
const {
  snapshotBase, snapshotKey, snapshotDir, treeOf,
} = require('../lib/red-snapshot');
const { homeOf } = require('../lib/workflow-home');
const { runLib } = require('../lib/hook-lib');
const { scratchKit, journalFileText } = require('../lib/identity');
const { mods, ghEntry } = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const SNAPSHOT = path.join(KIT, 'hooks', 'lib', 'snapshot.sh');

// The journal lines a successful gh write leaves, one per call.
const CLAIM = (n, over = {}) => ghEntry({ numbers: [n], add: ['status:building'], ...over });
const QA = (n) => ghEntry({ numbers: [n], add: ['status:qa'], remove: ['status:building'] });
const BLOCK = (n) => ghEntry({ numbers: [n], add: ['status:blocked'], remove: ['status:building'] });
const COMPLETE = (n) => ghEntry({ numbers: [n], add: ['status:complete'], remove: ['status:qa'] });
const CLOSE = (n) => ghEntry({ sub: 'close', numbers: [n] });

/** The `issue list` answer: each number open at status:building. */
const building = (...numbers) => numbers.map((number) => ({ number, labels: [{ name: 'status:building' }] }));
/** The `issue list` answer: each number open at status:qa. */
const atQa = (...numbers) => numbers.map((number) => ({ number, labels: [{ name: 'status:qa' }] }));
const json = (o) => JSON.stringify(o);

// The plan's world: the session repo and another, both on the roster.
const HERE = '/w/repo';
const OTHER = '/w/other';
const ROSTER = { version: 1, repos: { [HERE]: 'enabled', [OTHER]: 'enabled' } };
const SLUGS = { [HERE]: 'acme/repo', [OTHER]: 'owner/other' };

/**
 * snapshotPlan over the journal `lines` of one Bash call from the session repo,
 * gh's building or qa answer `list` (null when it cannot answer); hands back the
 * plan and how often that list was read.
 */
const planOf = async (lines, {
  list = [], roster = ROSTER, cwd = HERE, slugs = SLUGS,
} = {}) => {
  let asked = 0;
  const plan = await mods('snapshot').snapshotPlan({
    lines,
    cwd,
    roster,
    slugOf: async (dir) => slugs[dir] ?? '',
    building: async () => { asked++; return list === null ? null : json(list); },
  });
  return { plan, asked };
};
// The plan as its steps, one per line in order (a lone answer is one step).
const stepsOf = (plan) => (Array.isArray(plan) ? plan : (plan ? [plan] : []));
const rootsOf = (plan, key) => stepsOf(plan).filter((s) => s && s[key]).map((s) => s[key]).join(',') || null;
const takes = (plan) => rootsOf(plan, 'take');
const drops = (plan) => rootsOf(plan, 'drop');
// Every issue number the plan's takes record, sorted.
const takenIssues = (plan) => stepsOf(plan).filter((s) => s && s.take).flatMap((s) => s.issues.map(String)).sort();

// The shim's kit, copied once: a call through it writes nothing there.
let kit = null;
const shimDir = () => path.join(kit ??= scratchKit(), 'workflow', 'identity');

/**
 * A repo with origin acme/repo, its folder as the shim's cwd spells it, and a
 * home of its own; `other` a folder the roster below lists as other/rostered.
 */
const mkShimWorld = () => {
  const root = fs.realpathSync(mkTmp('snapshot-shim-'));
  const [here, other] = ['repo', 'other'].map((name) => path.join(root, name));
  for (const dir of [here, other]) fs.mkdirSync(dir);
  mkOriginRepo(here, 'https://github.com/acme/repo.git');
  const roster = { version: 1, repos: { [here]: 'enabled', [other]: 'enabled' } };
  return {
    here, other, home: mkTmp('snapshot-shim-home-'), roster, slugs: { [here]: 'acme/repo', [other]: 'other/rostered' },
  };
};

/**
 * `gh <args>` through the shim from the world's repo in a Claude session, the
 * real gh a stub that exits 0, or 1 when `fails`; hands back the journal's
 * lines for the repo afterwards, parsed by the post-Bash hook's own reader.
 */
const viaShim = (w, args, { fails = false } = {}) => {
  let bin = makeGhStub().binDir;
  if (fails) {
    bin = mkTmp('snapshot-gh-fails-');
    stubTool(bin, 'gh', ['#!/usr/bin/env bash', 'echo "HTTP 422: Validation Failed" >&2', 'exit 1']);
  }
  const env = homeEnv(w.home, { PATH: systemPathWith(shimDir(), bin, NODE_DIR), CLAUDECODE: '1' });
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(shimDir(), 'gh')), ...args], {
    cwd: w.here, env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  expect(res.status, `the shim's exit is the real gh's (stderr: ${res.stderr})`).toBe(fails ? 1 : 0);
  return mods('markers').journalLines(journalFileText(path.join(w.home, '.workkit'), w.here));
};

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

/**
 * `bash hooks/lib/snapshot.sh <mode> <root> ...args` for world `w`, its PATH
 * `envPath` when given, any `extra` env on top.
 */
const mode = (w, name, args = [], envPath = null, extra = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SNAPSHOT), name, shellPath(fs.realpathSync(w.repo)), ...args], {
    env: { ...w.env, ...(envPath ? { PATH: envPath } : {}), ...extra }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};
const ok = (out, what) => expect(out.code, `${what} exits 0: ${out.stderr}`).toBe(0);
const take = (w, ...nums) => {
  const out = mode(w, 'take', nums.map(String));
  ok(out, `take ${nums}`);
  expect(fs.existsSync(path.join(snapshotDir(homeOf(w), w.repo), 'tree')), `take ${nums} left a snapshot: ${out.stderr}`).toBeTruthy();
  return out;
};

/**
 * World `w` with `cache/` ignored and committed so, holding a downloaded app:
 * its own ignored `package.json` and `cache/app/node_modules/x/index.js`.
 */
const withCache = (w) => {
  w.write('.gitignore', 'node_modules/\ndist/\n.env\ncache/\n');
  w.git('commit', '-q', '-am', 'ignore cache');
  w.write('cache/app/package.json', `${JSON.stringify({ name: 'app' })}\n`);
  w.write('cache/app/node_modules/x/index.js', 'module.exports = 9;\n');
  return w;
};
const CACHED = path.join('cache', 'app', 'node_modules', 'x', 'index.js');
const takenTree = (w) => treeOf(path.join(snapshotDir(homeOf(w), w.repo), 'tree'));
const modulesIn = (tree, under = '') => Object.keys(tree)
  .filter((k) => k.startsWith(under) && k.split(path.sep).includes('node_modules')).join(',');

const read = (snap, name) => fs.readFileSync(path.join(snap, name), 'utf8');
const issuesOf = (snap) => read(snap, 'issues').split('\n').filter(Boolean).sort();
const snapshots = (w) => {
  const dir = snapshotBase(homeOf(w));
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
// Every path under `dir` named for the repo's snapshot, its temporary siblings included.
const keyedUnder = (dir, w) => Object.keys(treeOf(dir)).filter((k) => path.basename(k).startsWith(snapshotKey(w.repo))).join(',');
const workingPaths = (w) => w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
  + w.git('ls-files', '--others', '--exclude-standard', '-z');

// The stale mode's answer with gh's building list stubbed (`fails` for a gh that cannot answer).
const stale = (w, list, fails = false) => {
  const stub = makeGhStub({ list, fails });
  const out = mode(w, 'stale', [], joinPath(stub.binDir, w.env.PATH));
  return { code: out.code, calls: ghCalls(stub) };
};

describe('workflow:snapshot: the claim', () => {
  test('a claim with no snapshot takes one: the plan is a take of the session repo', async () => {
    expect(takes((await planOf([CLAIM(5)], { list: building(5) })).plan), 'the claim takes the session repo').toBe(HERE);
  });

  test('a claim takes the snapshot with no building read, though GitHub lists nothing', async () => {
    const { plan, asked } = await planOf([CLAIM(10)], { list: [] });
    expect(json(takenIssues(plan)), 'the take records #10').toBe(json(['10']));
    expect(asked, 'no building read').toBe(0);
  });

  test('a claim with no snapshot takes one: the whole tree, gitignored files in, no node_modules, no .git, head, paths and issues recorded', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('src/new.js', 'module.exports = 3;\n');
    w.write('pkg/package.json', `${JSON.stringify({ name: 'pkg' })}\n`);
    w.git('add', 'pkg/package.json');
    w.git('commit', '-q', '-m', 'pkg');
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(fs.existsSync(path.join(snap, 'tree')), `the snapshot's tree exists at ${snap}`).toBeTruthy();
    const tree = treeOf(path.join(snap, 'tree'));
    expect(Object.keys(tree).filter((k) => k.split(path.sep).includes('node_modules')).join(','),
      'no node_modules anywhere in the snapshot, on every platform').toBe('');
    expect(json(tree), 'everything else is the repo folder').toBe(json(treeOf(w.repo, { skipModules: true })));
    expect(tree[path.join('dist', 'out.js')], 'the gitignored dist/ is in it').toBe('file module.exports = 1;\n');
    expect(tree['.env'], 'the gitignored .env is in it').toBe('file KEY="snap"\n');
    expect(tree[path.join('src', 'x.js')], 'the working edit is in it').toBe('file module.exports = 2;\n');
    expect(!('.git' in tree) && !fs.existsSync(path.join(snap, 'tree', '.git')), 'no .git in the snapshot').toBeTruthy();
    expect(read(snap, 'head'), 'head is HEAD, one sha line').toBe(`${w.git('rev-parse', 'HEAD').trim()}\n`);
    expect(read(snap, 'paths'), 'paths is the working-change list, NUL-separated').toBe(workingPaths(w));
    expect(json(issuesOf(snap)), 'issues records the claim').toBe(json(['5']));
  });

  test('an untracked, not ignored pkg/package.json makes pkg/node_modules a package\'s: the take leaves it out', () => {
    const w = mkWorld();
    w.write('pkg/package.json', `${JSON.stringify({ name: 'pkg' })}\n`);
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    const tree = takenTree(w);
    expect(tree[path.join('pkg', 'package.json')], 'the untracked package.json is in it').toBe('file {"name":"pkg"}\n');
    expect(modulesIn(tree, 'pkg'), 'no pkg/node_modules path in the snapshot').toBe('');
  });

  test('a node_modules inside an ignored folder, no package.json git sees above it: the take holds its file as a regular file', () => {
    const w = withCache(mkWorld());
    take(w, 5);
    expect(takenTree(w)[CACHED], 'the downloaded app\'s module is copied as it is').toBe('file module.exports = 9;\n');
  });

  test('a relative symlink in an ignored folder\'s node_modules: the take holds the link with its target', () => {
    const w = withCache(mkWorld());
    fs.symlinkSync('x', path.join(w.repo, 'cache', 'app', 'node_modules', 'y'), 'dir');
    take(w, 5);
    expect(takenTree(w)[path.join('cache', 'app', 'node_modules', 'y')], 'the link is copied as a link').toBe('link x');
  });

  test('pkg/node_modules beside no package.json git sees, pkg not ignored: the take holds it', () => {
    const w = mkWorld();
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    expect(takenTree(w)[path.join('pkg', 'node_modules', 'dep', 'index.js')],
      'a node_modules no package owns is copied as it is').toBe('file module.exports = 7;\n');
  });

  test('the Windows branch (OSTYPE msys, the tar copy): the root package\'s node_modules left out, an ignored folder\'s copied', () => {
    const w = withCache(mkWorld());
    const bin = mkTmp('snapshot-tar-');
    const logFile = path.join(bin, 'tar.log');
    stubTool(bin, 'tar', ['#!/bin/bash', `echo "$*" >> "${shellPath(logFile)}"`,
      `exec "${shellPath(which('tar', SYSTEM_PATH))}" "$@"`]);
    const out = mode(w, 'take', ['5'], joinPath(bin, w.env.PATH), { OSTYPE: 'msys' });
    ok(out, 'take 5 as Windows');
    expect(fs.existsSync(logFile), `the take copied through tar: ${out.stderr}`).toBeTruthy();
    const tree = takenTree(w);
    expect(modulesIn(tree, 'node_modules'), 'no root node_modules path in the snapshot').toBe('');
    expect(tree[CACHED], 'the ignored folder\'s module is copied as it is').toBe('file module.exports = 9;\n');
  });

  // World `w` whose home's .workkit is the repo's dotfiles/.workkit, `ignore`
  // its lines in .gitignore, settings.json tracked there.
  const homeInRepo = (w, ignore) => {
    w.write('.gitignore', `node_modules/\ndist/\n.env\n${ignore.join('\n')}\n`);
    w.write(path.join('dotfiles', '.workkit', 'settings.json'), '{}\n');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'home in the repo');
    fs.symlinkSync(path.join(w.repo, 'dotfiles', '.workkit'), w.workflowHome, 'dir');
    return w;
  };
  const homeKeys = (tree, dir) => Object.keys(tree).filter((k) => k.startsWith(path.join('dotfiles', '.workkit', dir))).join(',');

  test('a home whose .workkit links into the repo: the take leaves out every path git ignores there and copies the rest', () => {
    const w = homeInRepo(mkWorld(), ['dotfiles/.workkit/*', '!dotfiles/.workkit/settings.json', '!dotfiles/.workkit/notes.md']);
    w.write(path.join('dotfiles', '.workkit', 'tower', 'README.md'), 'the home clone\n');
    w.write(path.join('dotfiles', '.workkit', 'hooks.log'), 'a hook line\n');
    w.write(path.join('dotfiles', '.workkit', 'identity', 'login.json'), '{}\n');
    w.write(path.join('dotfiles', '.workkit', 'notes.md'), 'not ignored\n');
    w.write(path.join('tower', 'README.md'), 'the repo\'s own\n');
    take(w, 5);
    const tree = takenTree(w);
    for (const dir of ['markers', 'tower', 'hooks.log', 'identity']) expect(homeKeys(tree, dir), `no ${dir} path in the snapshot`).toBe('');
    expect(tree[path.join('dotfiles', '.workkit', 'settings.json')], 'the tracked file is copied').toBe('file {}\n');
    expect(tree[path.join('dotfiles', '.workkit', 'notes.md')], 'the untracked file git does not ignore is copied').toBe('file not ignored\n');
    expect(tree[path.join('tower', 'README.md')], 'the repo\'s own tower folder is copied').toBe('file the repo\'s own\n');
  });

  test('a home whose .workkit links into a repo that ignores nothing there: the take writes nothing under the repo, its snapshot under HOME\'s .cache/workkit/snapshot, the markers folder left out', () => {
    const w = homeInRepo(mkWorld(), []);
    w.write(path.join('dotfiles', '.workkit', 'hooks.log'), 'a hook line\n');
    w.write(path.join('dotfiles', '.workkit', 'markers', 'claude-gh-journal', 'x'), 'a journal line\n');
    take(w, 5);
    expect(keyedUnder(fs.realpathSync(w.repo), w), 'no snapshot folder and no temporary sibling under the repo').toBe('');
    const tree = takenTree(w);
    expect(homeKeys(tree, 'markers'), 'no markers path in the snapshot').toBe('');
    expect(tree[path.join('dotfiles', '.workkit', 'hooks.log')], 'a file git does not ignore is copied').toBe('file a hook line\n');
  });

  test('WORKFLOW_HOME elsewhere does not move the snapshot; another HOME does', () => {
    const w = mkWorld();
    const elsewhere = mkTmp('snapshot-workflow-home-');
    ok(mode(w, 'take', ['5'], null, { WORKFLOW_HOME: shellPath(elsewhere) }), 'take 5 with WORKFLOW_HOME elsewhere');
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(fs.existsSync(path.join(snap, 'tree')), `the snapshot is under HOME's cache: ${snapshots(w)}`).toBeTruthy();
    expect(keyedUnder(elsewhere, w), 'nothing of it under WORKFLOW_HOME').toBe('');
    const other = mkTmp('snapshot-other-home-');
    ok(mode(w, 'take', ['6'], null, { HOME: shellPath(other), WORKFLOW_HOME: shellPath(elsewhere) }), 'take 6 with another HOME');
    expect(json(issuesOf(snapshotDir(other, w.repo))), 'the take under the other HOME records #6').toBe(json(['6']));
    expect(json(issuesOf(snap)), 'the first HOME\'s snapshot is as it was').toBe(json(['5']));
  });

  test('a repo that is HOME, the snapshot\'s home inside it: the tree holds no .cache/workkit/snapshot, and a second take does not grow', () => {
    const w = mkWorld();
    w.write(path.join('.cache', 'other', 'keep.txt'), 'kept\n');
    const tookAt = (n) => {
      ok(mode(w, 'take', [n], null, { HOME: shellPath(w.repo) }), `take ${n} with HOME the repo`);
      return treeOf(path.join(snapshotDir(w.repo, w.repo), 'tree'));
    };
    const first = tookAt('5');
    expect(Object.keys(first).filter((k) => k.startsWith(path.join('.cache', 'workkit', 'snapshot'))).join(','),
      'no .cache/workkit/snapshot path in the tree').toBe('');
    expect(first[path.join('.cache', 'other', 'keep.txt')], 'the rest of .cache is copied').toBe('file kept\n');
    expect(json(tookAt('6')), 'the second take holds what the first did').toBe(json(first));
  });

  test('a finished take leaves the caller\'s traps as they were: a sourced take under a caller\'s HUP and TERM traps, none on INT', () => {
    const w = mkWorld();
    const out = runLib([
      "trap 'echo caller hup' HUP",
      "trap 'echo caller term' TERM",
      `hook_snapshot_take "${shellPath(fs.realpathSync(w.repo))}" 5 || echo "take failed: $?"`,
      'trap -p HUP INT TERM',
    ].join('\n'), w.env);
    expect(out.stdout, `the caller's traps read back unchanged: ${out.stderr}`)
      .toBe("trap -- 'echo caller hup' SIGHUP\ntrap -- 'echo caller term' SIGTERM\n");
    expect(json(issuesOf(snapshotDir(homeOf(w), w.repo))), 'the take happened').toBe(json(['5']));
  });

  test('a second claim while the snapshot is live adds its number and leaves the tree alone: stale answers live, add records the number', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    const head = read(snap, 'head');
    w.write('src/x.js', 'module.exports = 9;\n');
    w.write('src/late.js', 'module.exports = 4;\n');
    expect(stale(w, building(5, 6)).code, 'a recorded issue still building: live').toBe(1);
    ok(mode(w, 'add', ['6']), 'add 6');
    expect(json(treeOf(path.join(snap, 'tree'))), 'the tree is as the first claim took it').toBe(json(before));
    expect(!fs.existsSync(path.join(snap, 'tree', 'src', 'late.js')), 'the file made in between is not in it').toBeTruthy();
    expect(read(snap, 'head'), 'head is unchanged').toBe(head);
    expect(json(issuesOf(snap)), 'issues holds both claims').toBe(json(['5', '6']));
    expect(snapshots(w).length, `one snapshot for the repo: ${snapshots(w)}`).toBe(1);
  });

  test('a claim after every recorded issue left building replaces the snapshot: stale answers stale, the take replaces it', () => {
    const w = mkWorld();
    take(w, 5);
    w.write('src/x.js', 'module.exports = 9;\n');
    expect(stale(w, building(6)).code, 'no recorded issue still building: stale').toBe(0);
    take(w, 6);
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(read(path.join(snap, 'tree'), path.join('src', 'x.js')), 'the new tree carries the later change').toBe('module.exports = 9;\n');
    expect(json(treeOf(path.join(snap, 'tree'))), 'the tree is the repo now').toBe(json(treeOf(w.repo, { skipModules: true })));
    expect(json(issuesOf(snap)), 'issues is the new claim alone').toBe(json(['6']));
    expect(snapshots(w).length, `one snapshot for the repo: ${snapshots(w)}`).toBe(1);
  });

  test('a take on top of a live snapshot replaces it whole: nothing of the old tree left, no temporary sibling', () => {
    const w = mkWorld();
    w.write('src/gone.js', 'module.exports = 8;\n');
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'the first take holds src/gone.js').toBeTruthy();
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    w.write('src/x.js', 'module.exports = 9;\n');
    take(w, 6);
    expect(!fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'a file only the old tree held is gone').toBeTruthy();
    expect(json(treeOf(path.join(snap, 'tree'))), 'the tree is the repo now').toBe(json(treeOf(w.repo, { skipModules: true })));
    expect(json(snapshots(w)), 'one folder under the final name, no sibling').toBe(json([path.basename(snap)]));
  });

  test('a re-claim of a recorded issue after a block keeps the first tree, the number once: add records it once', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    w.write('src/x.js', 'module.exports = 9;\n');
    ok(mode(w, 'add', ['5']), 'add 5 again');
    expect(json(treeOf(path.join(snap, 'tree'))), 'the tree is as the first claim found it').toBe(json(before));
    expect(json(issuesOf(snap)), 'the number is recorded once').toBe(json(['5']));
  });

  test('a claim after every recorded issue left building replaces the snapshot though one sits at qa: stale answers stale', () => {
    const w = mkWorld();
    take(w, 5);
    expect(stale(w, atQa(5)).code, 'the recorded #5 at qa, none building: stale').toBe(0);
  });

  test('a failed GitHub read at a claim keeps the live snapshot and adds the number: stale answers 2', () => {
    const w = mkWorld();
    take(w, 5);
    expect(stale(w, [], true).code, 'GitHub cannot answer').toBe(2);
  });

  test('a claim whose number cannot be read records none, and a later claim keeps that snapshot: a take with no number', async () => {
    const w = mkWorld();
    take(w);
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(json(issuesOf(snap)), 'no number recorded').toBe(json([]));
    const { code, calls } = stale(w, building(6));
    expect(code, 'an empty recorded list is live').toBe(1);
    expect(calls.length, 'and asks GitHub nothing').toBe(0);
  });
});

describe('workflow:snapshot: removal', () => {
  test('the qa flip of the last building issue leaves the snapshot and asks GitHub nothing', async () => {
    const { plan, asked } = await planOf([QA(5)], { list: [] });
    expect(json(stepsOf(plan)), 'no step').toBe('[]');
    expect(asked, 'no building read').toBe(0);
  });

  for (const [flip, line] of [['the complete flip', COMPLETE(5)], ['the close', CLOSE(5)]]) {
    test(`a release leaving no issue building or at qa removes the snapshot: ${flip}: the plan is a drop`, async () => {
      const { plan, asked } = await planOf([line], { list: [] });
      expect(drops(plan), 'none left building or at qa drops the session repo\'s snapshot').toBe(HERE);
      expect(asked, 'one building read').toBe(1);
    });

    test(`a release with another issue at qa leaves the snapshot: ${flip}`, async () => {
      const { plan, asked } = await planOf([line], { list: atQa(6) });
      expect(drops(plan) || takes(plan), 'neither a take nor a drop').toBe(null);
      expect(asked, 'one building read').toBe(1);
    });
  }

  test('the last building issue leaving removes the snapshot: drop removes it whole', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    expect(fs.existsSync(snap), `the take left a snapshot to drop: ${snapshots(w)}`).toBeTruthy();
    ok(mode(w, 'drop'), 'drop');
    expect(!fs.existsSync(snap), `the snapshot is gone: ${snapshots(w)}`).toBeTruthy();
  });

  test('the complete flip with another issue still building leaves the snapshot', async () => {
    const { plan } = await planOf([COMPLETE(5)], { list: building(6) });
    expect(drops(plan) || takes(plan), 'neither a take nor a drop').toBe(null);
  });

  for (const [flip, line] of [['the block', BLOCK(5)]]) {
    test(`a flip off building that adds neither qa nor complete leaves the snapshot and calls no gh: ${flip}`, async () => {
      const { plan, asked } = await planOf([line], { list: [] });
      expect(json(stepsOf(plan)), 'no step').toBe('[]');
      expect(asked, 'no building read').toBe(0);
    });
  }

  test('a failed GitHub read at removal leaves the snapshot, exit 0', async () => {
    const { plan } = await planOf([COMPLETE(5)], { list: null });
    expect(drops(plan) || takes(plan), 'neither a take nor a drop').toBe(null);
  });
});

describe('workflow:snapshot: which repo', () => {
  test('a claim naming another repo snapshots its roster folder, not the session repo', async () => {
    expect(takes((await planOf([CLAIM(5, { repo: 'owner/other' })], { list: building(5) })).plan),
      'the take is the roster folder of owner/other').toBe(OTHER);
  });

  test('a claim naming a repo off the roster: the notice names it, no snapshot', async () => {
    const { plan } = await planOf([CLAIM(5, { repo: 'owner/other' })],
      { list: building(5), roster: { version: 1, repos: { [HERE]: 'enabled' } } });
    expect(takes(plan) || drops(plan), 'no snapshot taken or dropped').toBe(null);
  });
});

describe('workflow:snapshot: every journal line is a step, in order', () => {
  test('two claim lines from one Bash call are two steps on the session repo: issues [5, 6] both recorded', async () => {
    expect(takes((await planOf([CLAIM(5), CLAIM(6)], { list: building(5, 6) })).plan),
      'one take step per claim, in order').toBe(`${HERE},${HERE}`);
  });

  test('two claims in two repos, owner/other on the second line, take a snapshot of each repo', async () => {
    expect(takes((await planOf([CLAIM(5), CLAIM(6, { repo: 'owner/other' })], { list: building(5, 6) })).plan),
      'the session repo, then the roster folder of owner/other').toBe(`${HERE},${OTHER}`);
  });
});

describe('workflow:snapshot: a real gh call, read back from the journal', () => {
  test('case 1: gh issue edit 7 --add-label status:building through the shim yields the claim step for 7 in the cwd\'s repo', async () => {
    const w = mkShimWorld();
    const lines = viaShim(w, ['issue', 'edit', '7', '--add-label', 'status:building']);
    const { plan } = await planOf(lines, { cwd: w.here, roster: w.roster, slugs: w.slugs });
    expect(takes(plan), 'the take is the cwd\'s repo').toBe(w.here);
    expect(json(takenIssues(plan)), 'the take records #7').toBe(json(['7']));
  });

  test('case 1: the same claim with --repo other/rostered places the take in that roster folder', async () => {
    const w = mkShimWorld();
    const lines = viaShim(w, ['issue', 'edit', '7', '--repo', 'other/rostered', '--add-label', 'status:building']);
    const { plan } = await planOf(lines, { cwd: w.here, roster: w.roster, slugs: w.slugs });
    expect(takes(plan), 'the take is the roster folder of other/rostered').toBe(w.other);
  });

  // A claim of #8 that gh answered sits in the same journal, so a reader that saw no line at all fails here too.
  test('case 1: the same claim the real gh fails (exit 1) yields no step: the journal holds the answered #8 alone', async () => {
    const w = mkShimWorld();
    viaShim(w, ['issue', 'edit', '8', '--add-label', 'status:building']);
    const lines = viaShim(w, ['issue', 'edit', '7', '--add-label', 'status:building'], { fails: true });
    const { plan } = await planOf(lines, { cwd: w.here, roster: w.roster, slugs: w.slugs, list: building(8) });
    expect(takes(plan), 'the answered claim still takes the cwd\'s repo').toBe(w.here);
    expect(json(takenIssues(plan)), 'the take records #8 and never the failed #7').toBe(json(['8']));
  });
});

describe('workflow:snapshot: anything else', () => {
  for (const [call, lines] of [
    ['a call that wrote nothing to gh', []],
    ['a priority label', [ghEntry({ numbers: [5], add: ['priority:high'] })]],
    ['a comment', [ghEntry({ sub: 'comment', numbers: [5] })]],
  ]) {
    test(`no claim and no park does nothing and calls no gh: ${call}`, async () => {
      const { plan, asked } = await planOf(lines, { list: building(5) });
      expect(json(stepsOf(plan)), 'no step').toBe('[]');
      expect(asked, 'no building read').toBe(0);
    });
  }
});

describe('workflow:snapshot: a failed take', () => {
  // The copy tool each platform's take uses (tar on Git Bash, cp elsewhere),
  // stubbed ahead on PATH to copy for real and then fail, so a whole tree is
  // left under the temporary name for the take to clear. Each call is logged.
  const failingCopy = (w) => {
    const tool = IS_WINDOWS ? 'tar' : 'cp';
    const bin = mkTmp(`snapshot-${tool}-`);
    const logFile = path.join(bin, `${tool}.log`);
    stubTool(bin, tool, ['#!/bin/bash', `echo "$*" >> "${shellPath(logFile)}"`,
      `"${shellPath(which(tool, SYSTEM_PATH))}" "$@"`, `echo "${tool}: refused" >&2`, 'exit 1']);
    return { tool, logFile, envPath: joinPath(bin, w.env.PATH) };
  };

  test('a take whose copy fails leaves no snapshot folder and no temporary sibling', () => {
    const w = mkWorld();
    const copy = failingCopy(w);
    const out = mode(w, 'take', ['5'], copy.envPath);
    expect(out.code !== 0, `the failed take says so in its exit: ${out.code}`).toBeTruthy();
    expect(fs.existsSync(copy.logFile), `the take reached the failing ${copy.tool}`).toBeTruthy();
    expect(json(snapshots(w)), 'no snapshot folder and no temporary sibling').toBe(json([]));
  });

  test('a take whose copy fails on top of a live snapshot keeps that one whole and leaves no temporary sibling', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    const before = { tree: treeOf(path.join(snap, 'tree')), head: read(snap, 'head'), issues: read(snap, 'issues') };
    w.write('src/x.js', 'module.exports = 9;\n');
    w.git('commit', '-q', '-am', 'later');
    const copy = failingCopy(w);
    const out = mode(w, 'take', ['6'], copy.envPath);
    expect(out.code !== 0, `the failed take says so in its exit: ${out.code}`).toBeTruthy();
    expect(fs.existsSync(copy.logFile), `the take reached the failing ${copy.tool}`).toBeTruthy();
    expect(json(treeOf(path.join(snap, 'tree'))), 'the live tree is as it was').toBe(json(before.tree));
    expect(read(snap, 'head'), 'head is as it was').toBe(before.head);
    expect(read(snap, 'issues'), 'issues is as it was').toBe(before.issues);
    expect(json(snapshots(w)), 'one folder under the final name, no sibling').toBe(json([path.basename(snap)]));
  });

  // cp stubbed ahead on PATH to mark that it started and then wait to be
  // ended, so a signal lands while the take copies.
  const stalledCopy = (w) => {
    const bin = mkTmp('snapshot-stall-');
    const started = path.join(bin, 'started');
    stubTool(bin, 'cp', ['#!/bin/bash', `: > "${shellPath(started)}"`, 'while :; do sleep 1; done']);
    return { started, envPath: joinPath(bin, w.env.PATH) };
  };
  const SIGNAL_SKIP = IS_WINDOWS && 'Node cannot deliver TERM, INT or HUP to a Git Bash process on Windows';

  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
    test(`a take ended by ${signal} while it copies leaves no temporary sibling and exits ${code}`, { skip: SIGNAL_SKIP }, async (t) => {
      const w = mkWorld();
      const copy = stalledCopy(w);
      // The take leads its own group and the signal goes to the whole group, the way a cut ends a call.
      const run = start(BASH, [...NO_RC, shellPath(SNAPSHOT), 'take', shellPath(fs.realpathSync(w.repo)), '5'], {
        env: { ...w.env, PATH: copy.envPath }, detached: true,
      });
      t.after(() => run.end('SIGKILL'));
      expect(await until(() => fs.existsSync(copy.started) && snapshots(w).length === 1),
        `the take never reached the copy with its temporary sibling made: ${snapshots(w)} ${run.stderr()}`).toBeTruthy();
      process.kill(-run.pid, signal);
      const exit = await run.done;
      expect(exit.status, `the take's exit: ${JSON.stringify(exit)}`).toBe(code);
      expect(json(snapshots(w)), 'no snapshot folder and no temporary sibling').toBe(json([]));
    });
  }

  /** Every folder under `dir` made writable again, so the scratch can be removed. */
  const unlock = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const rel of ['', ...fs.readdirSync(dir, { recursive: true })]) {
      const full = path.join(dir, String(rel));
      if (fs.lstatSync(full).isDirectory()) fs.chmodSync(full, 0o755);
    }
  };

  const LOCK_SKIP = (IS_WINDOWS || process.getuid() === 0)
    && 'a read-only folder does not stop the removal here (Windows ignores the mode, root ignores it)';
  const siblingsOf = (w, snap) => snapshots(w).filter((name) => name.startsWith(`${path.basename(snap)}.`));

  test('a take over an old snapshot it cannot remove moves the remains to one sibling and takes the new one', { skip: LOCK_SKIP }, () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    fs.chmodSync(path.join(snap, 'tree', 'src'), 0o555);
    try {
      w.write('src/x.js', 'module.exports = 9;\n');
      w.git('commit', '-q', '-am', 'later');
      w.write('src/late.js', 'module.exports = 4;\n');
      const out = take(w, 6);
      expect(`${out.stdout}${out.stderr}`.includes('moved aside to'), `the take names where the remains went: ${out.stdout}${out.stderr}`).toBeTruthy();
      expect(json(issuesOf(snap)), 'the take recorded the new number').toBe(json(['6']));
      expect(json(treeOf(path.join(snap, 'tree'))), 'the tree is the new take').toBe(json(treeOf(w.repo, { skipModules: true })));
      expect(read(snap, 'head'), 'head is the new take\'s').toBe(`${w.git('rev-parse', 'HEAD').trim()}\n`);
      expect(read(snap, 'paths'), 'paths is the new take\'s').toBe(workingPaths(w));
      const siblings = siblingsOf(w, snap);
      expect(siblings.length, `exactly one sibling: ${snapshots(w)}`).toBe(1);
      expect(/^\.[^.]{6}$/.test(siblings[0].slice(path.basename(snap).length)), `named <dir>.<six chars>: ${siblings[0]}`).toBeTruthy();
    } finally {
      unlock(snapshotBase(homeOf(w)));
    }
  });

  test('a take clears a sibling older than 10 minutes and keeps a fresh one', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(homeOf(w), w.repo);
    const old = `${snap}.abcdef`;
    const fresh = `${snap}.ghijkl`;
    const then = new Date(Date.now() - 20 * 60 * 1000);
    for (const dir of [old, fresh]) fs.mkdirSync(path.join(dir, 'tree'), { recursive: true });
    fs.writeFileSync(path.join(old, 'tree', 'left.js'), 'module.exports = 0;\n');
    fs.writeFileSync(path.join(fresh, 'tree', 'left.js'), 'module.exports = 0;\n');
    for (const p of [path.join(old, 'tree', 'left.js'), path.join(old, 'tree'), old]) fs.utimesSync(p, then, then);
    w.write('src/x.js', 'module.exports = 9;\n');
    take(w, 6);
    expect(!fs.existsSync(old), `the stale sibling is gone: ${snapshots(w)}`).toBeTruthy();
    expect(fs.existsSync(path.join(fresh, 'tree', 'left.js')), `the fresh sibling stays: ${snapshots(w)}`).toBeTruthy();
    expect(json(issuesOf(snap)), 'the take happened').toBe(json(['6']));
  });
});
