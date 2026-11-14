// Tests for standards.sh: it fails loudly, never silently.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const {
  BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, gitPath, which, linkTool, systemPathWith,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, cleanup, rosterOf, makeRepo, makeGhStub, runScript, copyDefaults,
} = require('./helpers');

describe('standards.sh: it fails loudly, never silently', () => {
  test('a missing template warns, keeps healing, and exits non-zero', () => {
    const kit = mkTmp('wf-std-');
    const engine = path.join(kit, 'workflow');
    fs.mkdirSync(engine);
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    copyDefaults(kit);
    fs.rmSync(path.join(engine, 'templates', 'session.md'));
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('wf-std-'), 'ch')),
      },
      encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    expect(out.includes('template missing'), `names the missing template, got: ${out}`).toBeTruthy();
    expect(res.status, 'a partial heal exits non-zero so the caller can tell').toBe(1);
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the rest of the heal still ran').toBeTruthy();
    cleanup(repo); cleanup(stub.dir); cleanup(kit);
  });

  test('a missing labels.json still answers --state and --announce, and the heal says what broke', () => {
    // A manifest check ahead of mode dispatch would answer --state with exit 1,
    // which the hook reads as nogit and goes silent forever.
    const kit = mkTmp('wf-std-');
    const engine = path.join(kit, 'workflow');
    fs.mkdirSync(engine);
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    copyDefaults(kit);
    fs.rmSync(path.join(engine, 'labels.json'));
    const repo = makeRepo();
    const env = {
      ...process.env, PATH: SYSTEM_PATH,
      WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('wf-std-'), 'ch')),
    };
    const state = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--state', shellPath(repo)], { env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(state.status, '--state answers without the manifest').toBe(0);
    expect((state.stdout || '').trim(), 'and answers correctly').toBe('enabled');
    const announce = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--announce', shellPath(repo)], { env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(announce.status, '--announce answers without the manifest').toBe(0);
    expect((announce.stdout || '').includes('--enable'), 'and still offers').toBeTruthy();
    const heal = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], { env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    const out = (heal.stdout || '') + (heal.stderr || '');
    expect(out.includes('labels.json missing'), `the heal names the broken install, got: ${out}`).toBeTruthy();
    expect(heal.status, 'and exits non-zero so the caller retries').toBe(1);
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the local heals still ran').toBeTruthy();
    cleanup(repo); cleanup(kit);
  });

  test('a timed-out decline leaves the other run\'s lock in place', () => {
    // The rmdir trap belongs to a run that acquired the lock, or a run that gave
    // up after 5s would delete another run's mutex on its way out.
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    fs.mkdirSync(path.join(home, '.state.lock'), { recursive: true });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(output.includes('without the lock'), `says it proceeded unlocked, got: ${output}`).toBeTruthy();
    expect(fs.existsSync(path.join(home, '.state.lock')), 'the mutex it never held survives').toBeTruthy();
    expect(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'the decline is still recorded').toBe('declined');
    // And a decline that did acquire the lock removes its own on exit.
    const home2 = mkTmp('wf-std-');
    runScript(repo, { args: ['--decline'], workflowHome: home2 });
    expect(!fs.existsSync(path.join(home2, '.state.lock')), 'a held lock is released').toBeTruthy();
    cleanup(repo); cleanup(home); cleanup(home2);
  });

  test('a repo settings.json that is not valid JSON never resolves to enabled', () => {
    const repo = makeRepo({ settings: 'garbage{\n' });
    expect(runScript(repo, { args: ['--state'] }).stdout.trim(), 'an unparseable answer is not a yes').toBe('unreadable');
    const { output } = runScript(repo);
    expect(output.includes('not valid JSON'), `and it says so, got: ${output}`).toBeTruthy();
    expect(!fs.existsSync(path.join(repo, '.github')), 'healing nothing until it is fixed').toBeTruthy();
    cleanup(repo);
  });

  test('a committed no with a severed tail is still a no, never a heal', () => {
    // jq prints the answer it parsed and then fails on the tail, so a read
    // whose fallback is appended to that answer resolves to neither `false`
    // nor `unreadable`: it falls through to the enabled arm and heals a repo
    // that said no.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }{\n' });
    expect(runScript(repo, { args: ['--state'] }).stdout.trim(), 'the deliberate no is read as a no').toBe('disabled');
    const { output } = runScript(repo);
    expect(output, `nothing is said about a repo that opted out, got: ${output}`).toBe('');
    expect(!fs.existsSync(path.join(repo, '.github')), 'and nothing is written into it').toBeTruthy();
    cleanup(repo);
  });

  test('a severed tail on a yes with no version key: the heals run and the file is never rewritten', () => {
    // jq prints the answer it parsed and then fails on the tail, so a key
    // check that reads the failure as a key found tries a write nothing can make.
    const text = '{ "enabled": true }{\n';
    const repo = makeRepo({ settings: text });
    const { output } = runScript(repo);
    expect(output.includes('issue forms'), `the mechanical heals still run, got: ${output}`).toBeTruthy();
    expect(!/not valid JSON/.test(output), `no write is tried on the file, got: ${output}`).toBeTruthy();
    expect(fs.readFileSync(path.join(repo, '.workkit', 'settings.json'), 'utf8'), 'and it stands as it was').toBe(text);
    cleanup(repo);
  });

  test('a malformed roster file: declines cleanly, records nothing, leaves no litter', () => {
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), '{ this is not json\n');
    const repo = makeRepo({ settings: null });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(output.includes('not valid JSON'), `says what is wrong, got: ${output}`).toBeTruthy();
    expect(fs.readdirSync(home).filter((f) => f.includes('.tmp.')).length, 'and leaves no temp file behind').toBe(0);
    cleanup(repo); cleanup(home);
  });

  test('a symlinked roster file is updated in place, not replaced', () => {
    // This repo's whole model is symlinking config out of ~, so writing over the
    // link would replace it with a regular file and orphan the real one.
    const home = mkTmp('wf-std-');
    const realDir = mkTmp('wf-std-');
    const realFile = path.join(realDir, '.repos.json');
    fs.writeFileSync(realFile, '{\n  "version": 1,\n  "repos": {},\n  "digest": { "hour": 9 }\n}\n');
    fs.symlinkSync(realFile, path.join(home, '.repos.json'));
    const repo = makeRepo({ settings: null });
    runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(fs.lstatSync(path.join(home, '.repos.json')).isSymbolicLink(), 'still a symlink').toBeTruthy();
    const written = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    expect(written.repos[gitPath(fs.realpathSync(repo))] || written.repos[gitPath(repo)], 'the real target got the decline').toBe('declined');
    expect(written.digest.hour, 'and an unrelated key survived').toBe(9);
    cleanup(repo); cleanup(home); cleanup(realDir);
  });

  test('declining a repo whose committed file says yes admits it will not take effect', () => {
    const home = mkTmp('wf-std-');
    const repo = makeRepo();
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(/committed answer, which wins/.test(output), `does not claim a decline it cannot deliver, got: ${output}`).toBeTruthy();
    expect(runScript(repo, { args: ['--state'], workflowHome: home }).stdout.trim(), 'and the repo file still wins').toBe('enabled');
    cleanup(repo); cleanup(home);
  });

  test('no jq: a committed enabled:false is still a no, and a file with no enabled key no yes', () => {
    // The grep fallback exists for exactly this: a committed answer, read without jq.
    const binDir = mkTmp('wf-std-');
    // cygpath is the engine's path spelling on Windows (wk_native_path), as much a
    // need there as git; `which` answers nothing for it on macOS and Linux.
    for (const tool of ['git', 'grep', 'tail', 'head', 'cp', 'mkdir', 'tr', 'cat', 'dirname', 'basename', 'cygpath']) {
      const real = which(tool);
      if (real) linkTool(binDir, real);
    }
    for (const [settings, want] of [['{ "version": 1, "enabled": false }\n', 'disabled'], ['{ "version": 1 }\n', 'undecided']]) {
      const repo = makeRepo({ settings });
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), '--state', shellPath(repo)], {
        env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      expect((res.stdout || '').trim(), `${settings.trim()} on a jq-less machine, stderr: ${res.stderr}`).toBe(want);
      cleanup(repo);
    }
    cleanup(binDir);
  });

  test('the offer line survives a repo path containing a space', () => {
    const parent = mkTmp('wf-std-');
    const repo = path.join(parent, 'has space');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const { stdout } = runScript(repo, { args: ['--announce'] });
    expect(!/--enable [^'"]*has space/.test(stdout), `the suggested command must survive a paste, got: ${stdout}`).toBeTruthy();
    cleanup(parent);
  });
});
