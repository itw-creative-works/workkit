//
// Tests for standards.sh: the roster of enabled and declined repos.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  BASH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, gitPath, cygpathStub, joinPath,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, mkTmp, cleanup, rosterOf, winRosterKey, makeRepo, makeGhStub, binDirWithout,
  runScript,
} = require('./helpers');

const run = async () => {
  group('standards.sh: the roster');

  // The machine-local index the tower reads instead of walking a disk. It is
  // maintained ON CONTACT (a heal registers the repo it is standing in and
  // prunes what has gone away) and it is silent, so every assertion here is
  // against the file rather than the output.
  await test('a heal registers the repo it healed', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'keyed by the absolute repo root');
    assert(!/roster/.test(output), `registration is silent, got: ${output}`);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('running twice registers once: no duplicate, no rewrite', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const file = path.join(home, '.repos.json');
    const first = fs.readFileSync(file, 'utf8');
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(fs.readFileSync(file, 'utf8'), first, 'an up-to-date roster is not written again');
    assertEq(Object.keys(rosterOf(home)).length, 1, 'and the repo appears once');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('--enable registers the repo it just opted in', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { args: ['--enable'], pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'joining and being indexed are one act');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('sessions opening at once in several repos all end registered', async () => {
    // The roster edit is a whole-file read-modify-write, so without the mutex
    // the last writer wins and the other repos are silently left off. Three
    // heals started together against ONE user settings file; every one of them
    // has to be on the roster when they finish.
    //
    // And the home repo's writers edit that same file: `wk_home_set_slug` runs
    // alongside them here, because a mutex only two of the three writers take
    // is not a mutex: the slug it records has to survive as well.
    //
    // The roster is not the only machine-level thing they all write: the
    // engine's address is one path for the whole machine, so the claude home
    // below EXISTS, which is what puts that step in the race too. A heal that
    // ends on it never reaches the roster at all, so the count alone would
    // report a lost write for a session that died two steps earlier.
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const repos = [makeRepo(), makeRepo(), makeRepo()];
    const claudeHome = path.join(mkTmp(), 'claude-home');
    fs.mkdirSync(claudeHome, { recursive: true });
    const basePath = joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR);
    // Seeded here rather than by whichever process gets there first: the race
    // under test is the EDIT, and two creations racing is a different one.
    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify({ version: 1, repos: {} }, null, 2)}\n`);
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: null, publish: false, url: null } }, null, 2)}\n`,
    );
    const env = {
      ...process.env,
      PATH: basePath,
      WORKFLOW_HOME: shellPath(home),
      WORKFLOW_CLAUDE_HOME: shellPath(claudeHome),
    };
    // Sourced by their POSIX spelling, like every other path handed INTO a
    // shell: a `C:\...` source gives `${BASH_SOURCE[0]%/*}` no `/` to cut, so
    // lib.sh dies on the sibling it loads and the writer below is never
    // defined at all.
    const setSlug = [
      'set -euo pipefail',
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'lib.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'discussions.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'home.sh')))}`,
      'wk_home_set_slug owner/workkit',
    ].join('\n');
    const [codes, slugCode] = await Promise.all([
      Promise.all(repos.map((repo) => new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], { env, stdio: 'ignore' });
        child.on('close', (code) => resolve(code));
      }))),
      new Promise((resolve) => {
        const child = spawn(BASH, [...NO_RC, '-c', setSlug], { env, stdio: 'ignore' });
        child.on('close', (code) => resolve(code));
      }),
    ]);
    assertEq(codes.join(','), '0,0,0', `every session finished, none of them ended on a step another one won: ${codes.join(',')}`);
    // Swept before it is asserted on, never after: a regression here writes a
    // link INSIDE the tracked engine folder, and one left lying there is a
    // loop the next run of this suite walks into.
    const stray = path.join(WORKFLOW_DIR, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    assert(!strayed, 'and none of them wrote the address INSIDE the engine folder');
    // The address itself is what they were racing over, so it is asserted on
    // directly: writing it by unlinking and re-creating leaves a gap where a
    // second session finds nothing there, and the roster count cannot see that.
    const address = path.join(claudeHome, 'workkit');
    const made = fs.lstatSync(address, { throwIfNoEntry: false });
    assert(!!made && made.isSymbolicLink(), 'the address they all wrote is a symlink, neither gone nor a copy');
    assertEq(fs.realpathSync(address), fs.realpathSync(WORKFLOW_DIR), 'and it resolves to this engine');
    const roster = rosterOf(home);
    for (const repo of repos) {
      assertEq(roster[gitPath(fs.realpathSync(repo))], 'enabled', `${path.basename(repo)} survived the concurrent write`);
    }
    // The writer's own status, read rather than dropped: a slug writer that
    // died says so here, instead of arriving as a null on the next line with
    // nothing to account for it.
    assertEq(slugCode, 0, 'the slug writer finished');
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(settings.site.repo, 'owner/workkit', 'and so did the home slug written beside them');
    assert(!fs.existsSync(path.join(home, '.state.lock')), 'and the lock is released, not left behind');
    for (const repo of repos) cleanup(repo);
    cleanup(home); cleanup(stub.dir);
  });

  // The global layer's half of the same fact used to be a committed project
  // list in the home repo. Issue #77 retired it: the dashboard's board data is
  // baked from this machine's roster at publish time and never committed as
  // source, so the heal owes the global layer nothing but the roster above.
  await test('the heal writes nothing into the global layer but the roster', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const { code } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'exit 0');

    const left = fs.readdirSync(home).sort();
    assertEq(left.join(','), '.repos.json,settings.json', `only the machine state: ${left.join(', ')}`);
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'enabled', 'and the roster is the thing it wrote');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('a ~/.workkit holding a tower clone is not touched by the heal', () => {
    // The tower repo is a repo like any other: it is healed by standing IN it,
    // never by a heal of some other repo reaching across into it.
    const repo = makeRepo();
    const home = mkTmp();
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: tower });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/workkit.git'], { cwd: tower });
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      `${JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: false, url: null } }, null, 2)}\n`,
    );

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const status = spawnSync('git', ['-C', tower, 'status', '--short'], { encoding: 'utf8' }).stdout;
    assertEq(status.trim(), '', `nothing was written into the clone: ${status}`);
    const log = spawnSync('git', ['-C', tower, 'log', '--oneline'], { encoding: 'utf8' });
    assert(!log.stdout.trim(), `and nothing was committed there: ${log.stdout}`);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('an entry whose path is gone, and one that turned itself off, are pruned', () => {
    const repo = makeRepo();
    const gone = mkTmp();
    const off = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(gone)]: 'enabled', [gitPath(fs.realpathSync(off))]: 'enabled' },
    }, null, 2));
    cleanup(gone);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const roster = rosterOf(home);
    assertEq(roster[gone], undefined, 'the path that no longer exists is dropped');
    assertEq(roster[gitPath(fs.realpathSync(off))], undefined, 'and so is the repo whose committed file now says no');
    assertEq(roster[gitPath(fs.realpathSync(repo))], 'enabled', 'while the repo being healed is registered');
    cleanup(repo); cleanup(off); cleanup(home); cleanup(stub.dir);
  });

  await test('an entry whose committed settings file was deleted is pruned too', () => {
    // Removing the committed file is the tri-state's way back to undecided, so
    // the entry is exactly as stale as a path that no longer exists.
    const repo = makeRepo();
    const left = makeRepo();
    fs.rmSync(path.join(left, W, 'settings.json'));
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(left))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(left))], undefined, 'no committed answer, no membership');
    cleanup(repo); cleanup(left); cleanup(home); cleanup(stub.dir);
  });

  await test('a legacy opt-in with no enabled key is kept: it is still a yes', () => {
    // resolve_state reads a file that predates the key as opted in, and the
    // prune has to read it the same way or it would evict a member.
    const repo = makeRepo();
    const legacy = makeRepo({ settings: '{ "version": 1 }\n' });
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(legacy))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(legacy))], 'enabled', 'the legacy shape stays on the roster');
    cleanup(repo); cleanup(legacy); cleanup(home); cleanup(stub.dir);
  });

  await test('a decline is a decision, not an observation: it is never pruned', () => {
    const repo = makeRepo();
    const declined = mkTmp();
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      editor: 'code',
      repos: { [gitPath(declined)]: 'declined' },
    }, null, 2));
    cleanup(declined);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    assertEq(parsed.repos[gitPath(declined)], 'declined', 'the decline survives a vanished path');
    assertEq(parsed.editor, 'code', 'and every other key survives the write');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('an undecided repo is never registered: nothing observes it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(Object.keys(rosterOf(home)).length, 0, 'the offer writes nothing, here included');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('a malformed roster file warns and skips: the heal still finishes', () => {
    const repo = makeRepo();
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), '{ not json');
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    assertEq(code, 0, 'a broken index never fails a heal');
    assert(/not valid JSON/.test(output), `it says what is wrong, got: ${output}`);
    assertEq(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'), '{ not json', 'and the file is left alone');
    assertEq(fs.readdirSync(home).sort().join(','), '.repos.json,settings.json', 'with no temp file left behind');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  await test('without jq the roster is simply not maintained', () => {
    const repo = makeRepo();
    const home = mkTmp();
    // A PATH with no jq anywhere on it: the roster edit is a jq edit, and a
    // machine without it must lose the index, never the heal.
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(home), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, `the heal runs without it: ${res.stderr}`);
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], undefined, 'no jq, no edit, and no half-written file');
    cleanup(repo); cleanup(home); cleanup(binDir);
  });

  // Windows is the machine where one repo has two spellings: git prints
  // `C:/Users/x` and the Git Bash around it says `/c/Users/x`. A roster holding
  // both is a repo the tower lists twice and a decline that stops nothing, so
  // the key is git's spelling and every write and every lookup asks
  // `wk_git_path` for it. The branch is driven from here rather than only on
  // Windows so the rule holds at every commit: OSTYPE is what the engine
  // branches on, and bash honors an inherited one.
  const msysWorld = () => {
    const cyg = mkTmp();
    cygpathStub(cyg);
    return cyg;
  };

  await test('the roster key is git\'s spelling of the repo root, on the Windows branch too', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const { code } = runScript(repo, {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    });
    assertEq(code, 0, 'exit 0');
    const keys = Object.keys(rosterOf(home));
    assertEq(keys.length, 1, `one repo, one key, got: ${keys.join(' + ')}`);
    assertEq(keys[0], winRosterKey(repo), 'spelled the way git spells it');
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });

  await test('a decline writes that same key, and the state read after it finds it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const opts = {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    };
    runScript(repo, { ...opts, args: ['--decline'] });
    const keys = Object.keys(rosterOf(home));
    assertEq(keys.length, 1, `the decline wrote one key, got: ${keys.join(' + ')}`);
    assertEq(keys[0], winRosterKey(repo), 'git\'s spelling, the one every lookup asks for');
    const { stdout } = runScript(repo, { ...opts, args: ['--state'] });
    assertEq(stdout.trim(), 'declined', 'and the lookup finds what the write left');
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
