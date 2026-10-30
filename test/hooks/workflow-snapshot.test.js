// Tests for workflow:snapshot: snapshotPlan({ command, cwd, roster, slugOf,
// building, failed }) in hooks/mods/snapshot.js decides a take at a claim and a drop at
// the release of the last building issue, and the copy runs for real through
// `bash hooks/lib/snapshot.sh take|add|stale|drop <root> ...` in a temp repo
// with its own home. Each case ports the HEAD case its name quotes. Dropped:
// "run.sh is executable", and "a claim from a folder inside no git repo" (the
// gate stands it down). In test/mods/post-tool-use-bash.test.ts: the wiring,
// the loader's take and which mode a claim runs.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, SYSTEM_PATH, shellPath, which, stubTool, joinPath,
} = require('../lib/platform');
const { makeGhStub, ghCalls } = require('../lib/gh-stub');
const { mkRepo } = require('../lib/git-repo');
const { snapshotDir, treeOf } = require('../lib/red-snapshot');
const { mods } = require('../lib/mods-inputs');

const KIT = path.join(__dirname, '..', '..');
const SNAPSHOT = path.join(KIT, 'hooks', 'lib', 'snapshot.sh');

const CLAIM = (n) => `gh issue edit ${n} --add-label status:building`;
const QA = (n) => `gh issue edit ${n} --remove-label status:building --add-label status:qa`;
const BLOCK = (n) => `gh issue edit ${n} --remove-label status:building --add-label status:blocked`;

/** The `issue list` answer: each number open at status:building. */
const building = (...numbers) => numbers.map((number) => ({ number, labels: [{ name: 'status:building' }] }));
const json = (o) => JSON.stringify(o);

// The plan's world: the session repo and another, both on the roster.
const HERE = '/w/repo';
const OTHER = '/w/other';
const ROSTER = { version: 1, repos: { [HERE]: 'enabled', [OTHER]: 'enabled' } };
const SLUGS = { [HERE]: 'acme/repo', [OTHER]: 'owner/other' };

/**
 * snapshotPlan over `command` from the session repo, gh's building answer
 * `list` (null when it cannot answer), `failed` when the Bash call failed;
 * hands back the plan and how often the building list was read.
 */
const planOf = async (command, { list = [], roster = ROSTER, cwd = HERE, failed = false } = {}) => {
  let asked = 0;
  const plan = await mods('snapshot').snapshotPlan({
    command,
    cwd,
    roster,
    slugOf: async (dir) => SLUGS[dir] ?? '',
    building: async () => { asked++; return list === null ? null : json(list); },
    failed,
  });
  return { plan, asked };
};
// The plan as its steps, one per clause in order (a lone answer is one step).
const stepsOf = (plan) => (Array.isArray(plan) ? plan : (plan ? [plan] : []));
const rootsOf = (plan, key) => stepsOf(plan).filter((s) => s && s[key]).map((s) => s[key]).join(',') || null;
const takes = (plan) => rootsOf(plan, 'take');
const drops = (plan) => rootsOf(plan, 'drop');
// Every issue number the plan's takes record, sorted; every notice's text, joined.
const takenIssues = (plan) => stepsOf(plan).filter((s) => s && s.take).flatMap((s) => s.issues.map(String)).sort();
const notesOf = (plan) => stepsOf(plan).filter((s) => s && s.note).map((s) => s.note).join('\n');
const names = (text, n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text);

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
const ok = (out, what) => assertEq(out.code, 0, `${what} exits 0: ${out.stderr}`);
const take = (w, ...nums) => {
  const out = mode(w, 'take', nums.map(String));
  ok(out, `take ${nums}`);
  assert(fs.existsSync(path.join(snapshotDir(w.workflowHome, w.repo), 'tree')), `take ${nums} left a snapshot: ${out.stderr}`);
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
const takenTree = (w) => treeOf(path.join(snapshotDir(w.workflowHome, w.repo), 'tree'));
const modulesIn = (tree, under = '') => Object.keys(tree)
  .filter((k) => k.startsWith(under) && k.split(path.sep).includes('node_modules')).join(',');

const read = (snap, name) => fs.readFileSync(path.join(snap, name), 'utf8');
const issuesOf = (snap) => read(snap, 'issues').split('\n').filter(Boolean).sort();
const snapshots = (w) => {
  const dir = path.join(w.workflowHome, 'markers', 'claude-red-snapshot');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const workingPaths = (w) => w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
  + w.git('ls-files', '--others', '--exclude-standard', '-z');

// The stale mode's answer with gh's building list stubbed (`fails` for a gh that cannot answer).
const stale = (w, list, fails = false) => {
  const stub = makeGhStub({ list, fails });
  const out = mode(w, 'stale', [], joinPath(stub.binDir, w.env.PATH));
  return { code: out.code, calls: ghCalls(stub) };
};

const cases = async () => {
  group('workflow:snapshot: the claim');

  await test('ports "a claim with no snapshot takes one": the plan is a take of the session repo', async () => {
    assertEq(takes((await planOf(CLAIM(5), { list: building(5) })).plan), HERE, 'the claim takes the session repo');
  });

  await test('ports "a claim with no snapshot takes one: the whole tree, gitignored files in, no node_modules, no .git, head, paths and issues recorded"', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('src/new.js', 'module.exports = 3;\n');
    w.write('pkg/package.json', `${JSON.stringify({ name: 'pkg' })}\n`);
    w.git('add', 'pkg/package.json');
    w.git('commit', '-q', '-m', 'pkg');
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
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
    assertEq(read(snap, 'paths'), workingPaths(w), 'paths is the working-change list, NUL-separated');
    assertEq(json(issuesOf(snap)), json(['5']), 'issues records the claim');
  });

  await test('an untracked, not ignored pkg/package.json makes pkg/node_modules a package\'s: the take leaves it out', () => {
    const w = mkWorld();
    w.write('pkg/package.json', `${JSON.stringify({ name: 'pkg' })}\n`);
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    const tree = takenTree(w);
    assertEq(tree[path.join('pkg', 'package.json')], 'file {"name":"pkg"}\n', 'the untracked package.json is in it');
    assertEq(modulesIn(tree, 'pkg'), '', 'no pkg/node_modules path in the snapshot');
  });

  await test('a node_modules inside an ignored folder, no package.json git sees above it: the take holds its file as a regular file', () => {
    const w = withCache(mkWorld());
    take(w, 5);
    assertEq(takenTree(w)[CACHED], 'file module.exports = 9;\n', 'the downloaded app\'s module is copied as it is');
  });

  await test('a relative symlink in an ignored folder\'s node_modules: the take holds the link with its target', () => {
    const w = withCache(mkWorld());
    fs.symlinkSync('x', path.join(w.repo, 'cache', 'app', 'node_modules', 'y'), 'dir');
    take(w, 5);
    assertEq(takenTree(w)[path.join('cache', 'app', 'node_modules', 'y')], 'link x', 'the link is copied as a link');
  });

  await test('pkg/node_modules beside no package.json git sees, pkg not ignored: the take holds it', () => {
    const w = mkWorld();
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    take(w, 5);
    assertEq(takenTree(w)[path.join('pkg', 'node_modules', 'dep', 'index.js')], 'file module.exports = 7;\n',
      'a node_modules no package owns is copied as it is');
  });

  await test('the Windows branch (OSTYPE msys, the tar copy): the root package\'s node_modules left out, an ignored folder\'s copied', () => {
    const w = withCache(mkWorld());
    const bin = mkTmp('snapshot-tar-');
    const logFile = path.join(bin, 'tar.log');
    stubTool(bin, 'tar', ['#!/bin/bash', `echo "$*" >> "${shellPath(logFile)}"`,
      `exec "${shellPath(which('tar', SYSTEM_PATH))}" "$@"`]);
    const out = mode(w, 'take', ['5'], joinPath(bin, w.env.PATH), { OSTYPE: 'msys' });
    ok(out, 'take 5 as Windows');
    assert(fs.existsSync(logFile), `the take copied through tar: ${out.stderr}`);
    const tree = takenTree(w);
    assertEq(modulesIn(tree, 'node_modules'), '', 'no root node_modules path in the snapshot');
    assertEq(tree[CACHED], 'file module.exports = 9;\n', 'the ignored folder\'s module is copied as it is');
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

  await test('a home whose .workkit links into the repo: the take leaves out every path git ignores there and copies the rest', () => {
    const w = homeInRepo(mkWorld(), ['dotfiles/.workkit/*', '!dotfiles/.workkit/settings.json', '!dotfiles/.workkit/notes.md']);
    w.write(path.join('dotfiles', '.workkit', 'tower', 'README.md'), 'the home clone\n');
    w.write(path.join('dotfiles', '.workkit', 'hooks.log'), 'a hook line\n');
    w.write(path.join('dotfiles', '.workkit', 'identity', 'login.json'), '{}\n');
    w.write(path.join('dotfiles', '.workkit', 'notes.md'), 'not ignored\n');
    w.write(path.join('tower', 'README.md'), 'the repo\'s own\n');
    take(w, 5);
    const tree = takenTree(w);
    for (const dir of ['markers', 'tower', 'hooks.log', 'identity']) assertEq(homeKeys(tree, dir), '', `no ${dir} path in the snapshot`);
    assertEq(tree[path.join('dotfiles', '.workkit', 'settings.json')], 'file {}\n', 'the tracked file is copied');
    assertEq(tree[path.join('dotfiles', '.workkit', 'notes.md')], 'file not ignored\n', 'the untracked file git does not ignore is copied');
    assertEq(tree[path.join('tower', 'README.md')], 'file the repo\'s own\n', 'the repo\'s own tower folder is copied');
  });

  await test('a home whose .workkit links into a repo that ignores nothing there: the take still leaves the markers folder out', () => {
    const w = homeInRepo(mkWorld(), []);
    w.write(path.join('dotfiles', '.workkit', 'hooks.log'), 'a hook line\n');
    take(w, 5);
    const tree = takenTree(w);
    assertEq(homeKeys(tree, 'markers'), '', 'no markers path in the snapshot');
    assertEq(tree[path.join('dotfiles', '.workkit', 'hooks.log')], 'file a hook line\n', 'a file git does not ignore is copied');
  });

  await test('ports "a second claim while the snapshot is live adds its number and leaves the tree alone": stale answers live, add records the number', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    const head = read(snap, 'head');
    w.write('src/x.js', 'module.exports = 9;\n');
    w.write('src/late.js', 'module.exports = 4;\n');
    assertEq(stale(w, building(5, 6)).code, 1, 'a recorded issue still building: live');
    ok(mode(w, 'add', ['6']), 'add 6');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'the tree is as the first claim took it');
    assert(!fs.existsSync(path.join(snap, 'tree', 'src', 'late.js')), 'the file made in between is not in it');
    assertEq(read(snap, 'head'), head, 'head is unchanged');
    assertEq(json(issuesOf(snap)), json(['5', '6']), 'issues holds both claims');
    assertEq(snapshots(w).length, 1, `one snapshot for the repo: ${snapshots(w)}`);
  });

  await test('ports "a claim after every recorded issue left building replaces the snapshot": stale answers stale, the take replaces it', () => {
    const w = mkWorld();
    take(w, 5);
    w.write('src/x.js', 'module.exports = 9;\n');
    assertEq(stale(w, building(6)).code, 0, 'no recorded issue still building: stale');
    take(w, 6);
    const snap = snapshotDir(w.workflowHome, w.repo);
    assertEq(read(path.join(snap, 'tree'), path.join('src', 'x.js')), 'module.exports = 9;\n', 'the new tree carries the later change');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the repo now');
    assertEq(json(issuesOf(snap)), json(['6']), 'issues is the new claim alone');
    assertEq(snapshots(w).length, 1, `one snapshot for the repo: ${snapshots(w)}`);
  });

  await test('ports "a take on top of a live snapshot replaces it whole: nothing of the old tree left, no temporary sibling"', () => {
    const w = mkWorld();
    w.write('src/gone.js', 'module.exports = 8;\n');
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    assert(fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'the first take holds src/gone.js');
    fs.rmSync(path.join(w.repo, 'src', 'gone.js'));
    w.write('src/x.js', 'module.exports = 9;\n');
    take(w, 6);
    assert(!fs.existsSync(path.join(snap, 'tree', 'src', 'gone.js')), 'a file only the old tree held is gone');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the repo now');
    assertEq(json(snapshots(w)), json([path.basename(snap)]), 'one folder under the final name, no sibling');
  });

  await test('ports "a re-claim of a recorded issue after a block keeps the first tree, the number once": add records it once', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    const before = treeOf(path.join(snap, 'tree'));
    w.write('src/x.js', 'module.exports = 9;\n');
    ok(mode(w, 'add', ['5']), 'add 5 again');
    assertEq(json(treeOf(path.join(snap, 'tree'))), json(before), 'the tree is as the first claim found it');
    assertEq(json(issuesOf(snap)), json(['5']), 'the number is recorded once');
  });

  await test('ports "a failed GitHub read at a claim keeps the live snapshot and adds the number": stale answers 2', () => {
    const w = mkWorld();
    take(w, 5);
    assertEq(stale(w, [], true).code, 2, 'GitHub cannot answer');
  });

  await test('ports "a claim whose number cannot be read records none, and a later claim keeps that snapshot"', async () => {
    assertEq(takes((await planOf('gh issue edit "$N" --add-label status:building')).plan), HERE, 'the claim still takes');
    const w = mkWorld();
    take(w);
    const snap = snapshotDir(w.workflowHome, w.repo);
    assertEq(json(issuesOf(snap)), json([]), 'no number recorded');
    const { code, calls } = stale(w, building(6));
    assertEq(code, 1, 'an empty recorded list is live');
    assertEq(calls.length, 0, 'and asks GitHub nothing');
  });

  group('workflow:snapshot: a failed call');

  await test('a failed call claiming #10, GitHub listing #10 as building: the snapshot is taken for #10', async () => {
    const { plan } = await planOf(CLAIM(10), { list: building(10), failed: true });
    assertEq(takes(plan), HERE, 'the claim takes the session repo');
    assertEq(json(takenIssues(plan)), json(['10']), 'the take records #10');
  });

  await test('a failed call claiming #10, GitHub not listing #10: nothing taken, a notice naming #10', async () => {
    const { plan } = await planOf(CLAIM(10), { list: building(4), failed: true });
    assertEq(takes(plan) || drops(plan), null, 'no snapshot taken or dropped');
    assert(names(notesOf(plan), 10), `a notice names #10, got: ${json(plan)}`);
  });

  await test('a failed call claiming #1 and #2, only #1 listed: the snapshot is taken for #1, the notice names #2', async () => {
    const { plan } = await planOf('gh issue edit 1 2 --add-label status:building', { list: building(1), failed: true });
    assertEq(json(takenIssues(plan)), json(['1']), 'the take records #1 alone');
    assert(names(notesOf(plan), 2), `a notice names #2, got: ${json(plan)}`);
  });

  await test('a successful call\'s claim takes the snapshot with no building read, though GitHub lists nothing', async () => {
    const { plan, asked } = await planOf(CLAIM(10), { list: [], failed: false });
    assertEq(json(takenIssues(plan)), json(['10']), 'the take records #10');
    assertEq(asked, 0, 'no building read');
  });

  group('workflow:snapshot: removal');

  for (const flip of [QA(5), 'gh issue edit 5 --remove-label status:qa --add-label status:complete', 'gh issue close 5']) {
    await test(`ports "the last building issue leaving removes the snapshot: ${flip}": the plan is a drop`, async () => {
      const { plan, asked } = await planOf(flip, { list: [] });
      assertEq(drops(plan), HERE, 'none left building drops the session repo\'s snapshot');
      assertEq(asked, 1, 'one building read');
    });
  }

  await test('ports "the last building issue leaving removes the snapshot": drop removes it whole', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    assert(fs.existsSync(snap), `the take left a snapshot to drop: ${snapshots(w)}`);
    ok(mode(w, 'drop'), 'drop');
    assert(!fs.existsSync(snap), `the snapshot is gone: ${snapshots(w)}`);
  });

  await test('ports "the qa flip with another issue still building leaves the snapshot"', async () => {
    const { plan } = await planOf(QA(5), { list: building(6) });
    assertEq(drops(plan) || takes(plan), null, 'neither a take nor a drop');
  });

  for (const flip of [
    BLOCK(5),
  ]) {
    await test(`ports "a flip off building that adds neither qa nor complete leaves the snapshot and calls no gh: ${flip}"`, async () => {
      const { plan, asked } = await planOf(flip, { list: [] });
      assertEq(json(stepsOf(plan)), '[]', 'no step');
      assertEq(asked, 0, 'no building read');
    });
  }

  await test('ports "a failed GitHub read at removal leaves the snapshot, exit 0"', async () => {
    const { plan } = await planOf(QA(5), { list: null });
    assertEq(drops(plan) || takes(plan), null, 'neither a take nor a drop');
  });

  group('workflow:snapshot: which repo');

  await test('ports "a claim naming another repo snapshots its roster folder, not the session repo"', async () => {
    assertEq(takes((await planOf('gh issue edit 5 --repo owner/other --add-label status:building', { list: building(5) })).plan),
      OTHER, 'the take is the roster folder of owner/other');
  });

  await test('ports "a claim naming a repo off the roster: the notice names it, no snapshot"', async () => {
    const { plan } = await planOf('gh issue edit 5 --repo owner/other --add-label status:building',
      { list: building(5), roster: { version: 1, repos: { [HERE]: 'enabled' } } });
    assertEq(takes(plan) || drops(plan), null, 'no snapshot taken or dropped');
  });

  await test('ports "a claim after a cd clause with no --repo: a notice, no snapshot"', async () => {
    const { plan } = await planOf(`cd "${OTHER}" && ${CLAIM(5)}`, { list: building(5) });
    assertEq(takes(plan) || drops(plan), null, 'no snapshot taken or dropped');
  });

  group('workflow:snapshot: every clause is a step, in order');

  await test('two claims in one command are two steps on the session repo: issues [5, 6] both recorded', async () => {
    assertEq(takes((await planOf(`${CLAIM(5)} && ${CLAIM(6)}`, { list: building(5, 6) })).plan), `${HERE},${HERE}`,
      'one take step per claim, in order');
  });

  await test('two claims in two repos, --repo owner/other on the second, take a snapshot of each repo', async () => {
    assertEq(takes((await planOf(`${CLAIM(5)} && gh issue edit 6 --repo owner/other --add-label status:building`, { list: building(5, 6) })).plan),
      `${HERE},${OTHER}`, 'the session repo, then the roster folder of owner/other');
  });

  await test('an unreadable --repo clause followed by a claim gives the note AND takes the snapshot', async () => {
    const { plan } = await planOf(`gh issue edit 4 --repo "$R" --add-label status:building && ${CLAIM(5)}`, { list: building(5) });
    assert(json(stepsOf(plan)).includes('could not be read'), `a step carries the unread-repo note, got: ${json(plan)}`);
    assertEq(takes(plan), HERE, 'the readable claim still takes');
  });

  group('workflow:snapshot: anything else');

  for (const command of [
    'git status --short',
    'gh issue edit 5 --add-label priority:high',
    'gh issue comment 5 --body "moving to status:building next"',
  ]) {
    await test(`ports "no claim and no park does nothing and calls no gh: ${command}"`, async () => {
      const { plan, asked } = await planOf(command, { list: building(5) });
      assertEq(json(stepsOf(plan)), '[]', 'no step');
      assertEq(asked, 0, 'no building read');
    });
  }

  group('workflow:snapshot: a failed take');

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

  await test('ports "a take whose copy fails leaves no snapshot folder and no temporary sibling"', () => {
    const w = mkWorld();
    const copy = failingCopy(w);
    const out = mode(w, 'take', ['5'], copy.envPath);
    assert(out.code !== 0, `the failed take says so in its exit: ${out.code}`);
    assert(fs.existsSync(copy.logFile), `the take reached the failing ${copy.tool}`);
    assertEq(json(snapshots(w)), json([]), 'no snapshot folder and no temporary sibling');
  });

  await test('ports "a take whose copy fails on top of a live snapshot keeps that one whole and leaves no temporary sibling"', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    const before = { tree: treeOf(path.join(snap, 'tree')), head: read(snap, 'head'), issues: read(snap, 'issues') };
    w.write('src/x.js', 'module.exports = 9;\n');
    w.git('commit', '-q', '-am', 'later');
    const copy = failingCopy(w);
    const out = mode(w, 'take', ['6'], copy.envPath);
    assert(out.code !== 0, `the failed take says so in its exit: ${out.code}`);
    assert(fs.existsSync(copy.logFile), `the take reached the failing ${copy.tool}`);
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
  const siblingsOf = (w, snap) => snapshots(w).filter((name) => name.startsWith(`${path.basename(snap)}.`));

  await lockTest('ports "a take over an old snapshot it cannot remove moves the remains to one sibling and takes the new one"', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    fs.chmodSync(path.join(snap, 'tree', 'src'), 0o555);
    try {
      w.write('src/x.js', 'module.exports = 9;\n');
      w.git('commit', '-q', '-am', 'later');
      w.write('src/late.js', 'module.exports = 4;\n');
      const out = take(w, 6);
      assert(`${out.stdout}${out.stderr}`.includes('moved aside to'), `the take names where the remains went: ${out.stdout}${out.stderr}`);
      assertEq(json(issuesOf(snap)), json(['6']), 'the take recorded the new number');
      assertEq(json(treeOf(path.join(snap, 'tree'))), json(treeOf(w.repo, { skipModules: true })), 'the tree is the new take');
      assertEq(read(snap, 'head'), `${w.git('rev-parse', 'HEAD').trim()}\n`, 'head is the new take\'s');
      assertEq(read(snap, 'paths'), workingPaths(w), 'paths is the new take\'s');
      const siblings = siblingsOf(w, snap);
      assertEq(siblings.length, 1, `exactly one sibling: ${snapshots(w)}`);
      assert(/^\.[^.]{6}$/.test(siblings[0].slice(path.basename(snap).length)), `named <dir>.<six chars>: ${siblings[0]}`);
    } finally {
      unlock(path.join(w.workflowHome, 'markers', 'claude-red-snapshot'));
    }
  });

  await test('ports "a take clears a sibling older than 10 minutes and keeps a fresh one"', () => {
    const w = mkWorld();
    take(w, 5);
    const snap = snapshotDir(w.workflowHome, w.repo);
    const old = `${snap}.abcdef`;
    const fresh = `${snap}.ghijkl`;
    const then = new Date(Date.now() - 20 * 60 * 1000);
    for (const dir of [old, fresh]) fs.mkdirSync(path.join(dir, 'tree'), { recursive: true });
    fs.writeFileSync(path.join(old, 'tree', 'left.js'), 'module.exports = 0;\n');
    fs.writeFileSync(path.join(fresh, 'tree', 'left.js'), 'module.exports = 0;\n');
    for (const p of [path.join(old, 'tree', 'left.js'), path.join(old, 'tree'), old]) fs.utimesSync(p, then, then);
    w.write('src/x.js', 'module.exports = 9;\n');
    take(w, 6);
    assert(!fs.existsSync(old), `the stale sibling is gone: ${snapshots(w)}`);
    assert(fs.existsSync(path.join(fresh, 'tree', 'left.js')), `the fresh sibling stays: ${snapshots(w)}`);
    assertEq(json(issuesOf(snap)), json(['6']), 'the take happened');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
