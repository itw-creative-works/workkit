// Tests for standards.sh: the roster of enabled and declined repos.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, WORKKIT_DIR: W, mkTmp, SPAWN_DEADLINE, start,
} = require('../../lib/harness');
const {
  BASH, SYSTEM_BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, gitPath, cygpathStub, joinPath,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, cleanup, rosterOf, winRosterKey, makeRepo, makeGhStub, binDirWithout,
  runScript,
} = require('./helpers');

describe('standards.sh: the roster', () => {
  // The machine-local index the tower reads instead of walking a disk. It is
  // maintained on contact (a heal registers the repo it is standing in and
  // prunes what has gone away) and it is silent, so every assertion here is
  // against the file rather than the output.
  test('a heal registers the repo it healed', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(code, 'exit 0').toBe(0);
    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'keyed by the absolute repo root').toBe('enabled');
    expect(!/roster/.test(output), `registration is silent, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('running twice registers once: no duplicate, no rewrite', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const file = path.join(home, '.repos.json');
    const first = fs.readFileSync(file, 'utf8');
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(fs.readFileSync(file, 'utf8'), 'an up-to-date roster is not written again').toBe(first);
    expect(Object.keys(rosterOf(home)).length, 'and the repo appears once').toBe(1);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('--enable registers the repo it just opted in', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    runScript(repo, { args: ['--enable'], pathPrefix: stub.binDir, workflowHome: home });
    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'joining and being indexed are one act').toBe('enabled');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('sessions opening at once in several repos all end registered', async () => {
    // The roster edit is a whole-file read-modify-write, so without the mutex the
    // last writer wins. Three heals race on one user settings file alongside
    // `wk_home_set_slug`, its other writer, and the claude home below exists so
    // the engine's machine-wide address is in the race too.
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    const repos = [makeRepo(), makeRepo(), makeRepo()];
    const claudeHome = path.join(mkTmp('wf-std-'), 'claude-home');
    fs.mkdirSync(claudeHome, { recursive: true });
    const basePath = joinPath(stub.binDir, SYSTEM_PATH, NODE_DIR);
    // Seeded here rather than by whichever process gets there first: the race
    // under test is the edit, and two creations racing is a different one.
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
    // Sourced by their POSIX spelling, like every other path handed into a
    // shell: a `C:\...` source gives `${BASH_SOURCE[0]%/*}` no `/` to cut, so
    // lib.sh dies on the sibling it loads and the writer below is never
    // defined at all.
    const setSlug = [
      'set -euo pipefail',
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'lib.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'lib', 'discussions.sh')))}`,
      `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'home.sh')))}`,
      'wk_home_set_slug owner/workkit',
    ].join('\n');
    const [codes, slugCode] = await Promise.all([
      Promise.all(repos.map((repo) => start(BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], { env }).done
        .then((exit) => exit.status))),
      start(BASH, [...NO_RC, '-c', setSlug], { env }).done.then((exit) => exit.status),
    ]);
    expect(codes.join(','), `every session finished, none of them ended on a step another one won: ${codes.join(',')}`).toBe('0,0,0');
    // Swept before it is asserted on, never after: a regression here writes a
    // link inside the tracked engine folder, and one left lying there is a
    // loop the next run of this suite walks into.
    const stray = path.join(WORKFLOW_DIR, 'workflow');
    const strayed = fs.existsSync(stray);
    if (strayed) fs.rmSync(stray, { recursive: true, force: true });
    expect(!strayed, 'and none of them wrote the address INSIDE the engine folder').toBeTruthy();
    // The address itself is what they were racing over, so it is asserted on
    // directly: writing it by unlinking and re-creating leaves a gap where a
    // second session finds nothing there, and the roster count cannot see that.
    const address = path.join(claudeHome, 'workkit');
    const made = fs.lstatSync(address, { throwIfNoEntry: false });
    expect(!!made && made.isSymbolicLink(), 'the address they all wrote is a symlink, neither gone nor a copy').toBeTruthy();
    expect(fs.realpathSync(address), 'and it resolves to this engine').toBe(fs.realpathSync(WORKFLOW_DIR));
    const roster = rosterOf(home);
    for (const repo of repos) {
      expect(roster[gitPath(fs.realpathSync(repo))], `${path.basename(repo)} survived the concurrent write`).toBe('enabled');
    }
    // The writer's own status, read rather than dropped: a slug writer that
    // died says so here, instead of arriving as a null on the next line with
    // nothing to account for it.
    expect(slugCode, 'the slug writer finished').toBe(0);
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    expect(settings.site.repo, 'and so did the home slug written beside them').toBe('owner/workkit');
    expect(!fs.existsSync(path.join(home, '.state.lock')), 'and the lock is released, not left behind').toBeTruthy();
    for (const repo of repos) cleanup(repo);
    cleanup(home); cleanup(stub.dir);
  });

  // The dashboard's board data is baked from this machine's roster at publish
  // time and never committed as source, so the heal owes the global layer
  // nothing but the roster above.
  test('the heal writes nothing into the global layer but the roster', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    const { code } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(code, 'exit 0').toBe(0);

    const left = fs.readdirSync(home).sort();
    expect(left.join(','), `only the machine state: ${left.join(', ')}`).toBe('.repos.json,settings.json');
    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'and the roster is the thing it wrote').toBe('enabled');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('a ~/.workkit holding a tower clone is not touched by the heal', () => {
    // The tower repo is a repo like any other: it is healed by standing in it,
    // never by a heal of some other repo reaching across into it.
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
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
    expect(status.trim(), `nothing was written into the clone: ${status}`).toBe('');
    const gitLog = spawnSync('git', ['-C', tower, 'log', '--oneline'], { encoding: 'utf8' });
    expect(!gitLog.stdout.trim(), `and nothing was committed there: ${gitLog.stdout}`).toBeTruthy();
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('an entry whose path is gone, and one that turned itself off, are pruned', () => {
    const repo = makeRepo();
    const gone = mkTmp('wf-std-');
    const off = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(gone)]: 'enabled', [gitPath(fs.realpathSync(off))]: 'enabled' },
    }, null, 2));
    cleanup(gone);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const roster = rosterOf(home);
    expect(roster[gone], 'the path that no longer exists is dropped').toBe(undefined);
    expect(roster[gitPath(fs.realpathSync(off))], 'and so is the repo whose committed file now says no').toBe(undefined);
    expect(roster[gitPath(fs.realpathSync(repo))], 'while the repo being healed is registered').toBe('enabled');
    cleanup(repo); cleanup(off); cleanup(home); cleanup(stub.dir);
  });

  test('an entry whose committed settings file was deleted is pruned too', () => {
    // Removing the committed file is the tri-state's way back to undecided, so
    // the entry is exactly as stale as a path that is gone.
    const repo = makeRepo();
    const left = makeRepo();
    fs.rmSync(path.join(left, W, 'settings.json'));
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(left))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(rosterOf(home)[gitPath(fs.realpathSync(left))], 'no committed answer, no membership').toBe(undefined);
    cleanup(repo); cleanup(left); cleanup(home); cleanup(stub.dir);
  });

  test('an entry whose committed file has no enabled key is pruned: only true is a yes', () => {
    // The prune reads the file as resolve_state does, so a file with no answer
    // is no member, whatever the roster says.
    const repo = makeRepo();
    const unanswered = makeRepo({ settings: '{ "version": 1 }\n' });
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(unanswered))]: 'enabled' },
    }, null, 2));

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(rosterOf(home)[gitPath(fs.realpathSync(unanswered))], 'no enabled answer, no membership').toBe(undefined);
    cleanup(repo); cleanup(unanswered); cleanup(home); cleanup(stub.dir);
  });

  test('a decline is a decision, not an observation: it is never pruned', () => {
    const repo = makeRepo();
    const declined = mkTmp('wf-std-');
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      editor: 'code',
      repos: { [gitPath(declined)]: 'declined' },
    }, null, 2));
    cleanup(declined);

    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    expect(parsed.repos[gitPath(declined)], 'the decline survives a vanished path').toBe('declined');
    expect(parsed.editor, 'and every other key survives the write').toBe('code');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('an undecided repo is never registered: nothing observes it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(Object.keys(rosterOf(home)).length, 'the offer writes nothing, here included').toBe(0);
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('a malformed roster file warns and skips: the heal still finishes', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), '{ not json');
    const stub = makeGhStub({ authed: false });
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir, workflowHome: home });
    expect(code, 'a broken index never fails a heal').toBe(0);
    expect(output.includes('cannot be read as JSON (unreadable or not valid JSON)'), `it says what is wrong, got: ${output}`).toBeTruthy();
    expect(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'), 'and the file is left alone').toBe('{ not json');
    expect(fs.readdirSync(home).sort().join(','), 'with no temp file left behind').toBe('.repos.json,settings.json');
    cleanup(repo); cleanup(home); cleanup(stub.dir);
  });

  test('without jq the roster is simply not maintained', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    // A PATH with no jq anywhere on it: the roster edit is a jq edit, and a
    // machine without it must lose the index, never the heal.
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(home), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('wf-std-'), 'ch')) },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    expect(res.status, `the heal runs without it: ${res.stderr}`).toBe(0);
    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'no jq, no edit, and no half-written file').toBe(undefined);
    cleanup(repo); cleanup(home); cleanup(binDir);
  });

  // On Windows one repo has two spellings (git's `C:/Users/x`, Git Bash's
  // `/c/Users/x`), so the key is git's, asked of `wk_native_path` on every write
  // and lookup. An inherited OSTYPE drives the branch from here, so the rule
  // holds at every commit and not only on Windows.
  const msysWorld = () => {
    const cyg = mkTmp('wf-std-');
    cygpathStub(cyg);
    return cyg;
  };

  test('the roster key is git\'s spelling of the repo root, on the Windows branch too', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const { code } = runScript(repo, {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    });
    expect(code, 'exit 0').toBe(0);
    const keys = Object.keys(rosterOf(home));
    expect(keys.length, `one repo, one key, got: ${keys.join(' + ')}`).toBe(1);
    expect(keys[0], 'spelled the way git spells it').toBe(winRosterKey(repo));
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });

  test('a decline writes that same key, and the state read after it finds it', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const stub = makeGhStub({ authed: false });
    const cyg = msysWorld();
    const opts = {
      pathPrefix: joinPath(cyg, stub.binDir), workflowHome: home, env: { OSTYPE: 'msys' },
    };
    runScript(repo, { ...opts, args: ['--decline'] });
    const keys = Object.keys(rosterOf(home));
    expect(keys.length, `the decline wrote one key, got: ${keys.join(' + ')}`).toBe(1);
    expect(keys[0], 'git\'s spelling, the one every lookup asks for').toBe(winRosterKey(repo));
    const { stdout } = runScript(repo, { ...opts, args: ['--state'] });
    expect(stdout.trim(), 'and the lookup finds what the write left').toBe('declined');
    cleanup(repo); cleanup(home); cleanup(stub.dir); cleanup(cyg);
  });
});
