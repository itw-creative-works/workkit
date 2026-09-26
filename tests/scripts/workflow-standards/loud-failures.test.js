//
// Tests for standards.sh: it fails loudly, never silently.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, gitPath, which, linkTool, systemPathWith,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, SCRIPT, mkTmp, cleanup, rosterOf, makeRepo, makeGhStub, runScript, STANDARD_VERSION,
} = require('./helpers');

const run = async () => {
  group('standards.sh: it fails loudly, never silently');

  // Every case here was a reproduced defect before 3.1.0: the suite proved the
  // happy path across all four states and nothing about what happens when the
  // ground shifts (review findings, 2026-07-24).

  // The engine runs under `set -e` on whatever bash the machine has. A bare
  // `(( x++ ))` yields the value BEFORE the increment, so a counter starting at
  // 0 makes the command exit non-zero on its first pass; bash 4.1 and later end
  // the run there. Stock macOS bash is 3.2 and does not, so the shape has to be
  // banned by inspection: no Darwin test run would ever fail on it.
  await test('no arithmetic command that can exit non-zero under errexit', () => {
    // The entry and every heal it sources: the shape is banned wherever the
    // script's functions live.
    const piecesDir = path.join(WORKFLOW_DIR, 'standards');
    const files = [SCRIPT, ...fs.readdirSync(piecesDir).filter((f) => f.endsWith('.sh')).map((f) => path.join(piecesDir, f))];
    const offenders = files.flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
      .map((line, i) => ({ file: path.basename(file), line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /^\(\(.*\)\)\s*$/.test(line)));
    assertEq(offenders.length, 0,
      `use an assignment or [ ] instead, got: ${offenders.map((o) => `${o.file} line ${o.n}: ${o.line}`).join(', ')}`);
  });

  await test('every shipped template is tracked by git', () => {
    // The suite reads templates from the working tree, so an untracked one
    // passes every other test and then breaks every machine that pulls.
    const listed = spawnSync('git', ['ls-files', 'workflow/templates'], {
      cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8',
    }).stdout.split('\n').filter(Boolean);
    const onDisk = [];
    const walk = (dir, prefix) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else onDisk.push(`workflow/templates/${prefix}${e.name}`);
      }
    };
    walk(path.join(WORKFLOW_DIR, 'templates'), '');
    for (const f of onDisk) assert(listed.includes(f), `${f} is on disk but untracked: a fresh clone would half-heal`);
  });

  await test('a missing template warns, keeps healing, and exits non-zero', () => {
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'templates', 'session.md'));
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], {
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
      },
      encoding: 'utf8', timeout: 20000,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    assert(out.includes('template missing'), `names the missing template, got: ${out}`);
    assertEq(res.status, 1, 'a partial heal exits non-zero so the caller can tell');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the rest of the heal still ran');
    cleanup(repo); cleanup(stub.dir); cleanup(engine);
  });

  await test('a missing labels.json still answers --state and --announce, and the heal says what broke', () => {
    // The manifest check used to sit before mode dispatch, so a broken install
    // answered --state with exit 1, which the hook read as nogit and went
    // silent forever.
    const engine = mkTmp();
    spawnSync('cp', ['-R', `${WORKFLOW_DIR}/.`, engine]);
    fs.rmSync(path.join(engine, 'labels.json'));
    const repo = makeRepo();
    const env = {
      ...process.env, PATH: SYSTEM_PATH,
      WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
    };
    const state = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--state', shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(state.status, 0, '--state answers without the manifest');
    assertEq((state.stdout || '').trim(), 'enabled', 'and answers correctly');
    const announce = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), '--announce', shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    assertEq(announce.status, 0, '--announce answers without the manifest');
    assert((announce.stdout || '').includes('--enable'), 'and still offers');
    const heal = spawnSync(BASH, [...NO_RC, shellPath(path.join(engine, 'standards.sh')), shellPath(repo)], { env, encoding: 'utf8', timeout: 20000 });
    const out = (heal.stdout || '') + (heal.stderr || '');
    assert(out.includes('labels.json missing'), `the heal names the broken install, got: ${out}`);
    assertEq(heal.status, 1, 'and exits non-zero so the caller retries');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the local heals still ran');
    cleanup(repo); cleanup(engine);
  });

  await test('a timed-out decline leaves the other run\'s lock in place', () => {
    // The rmdir trap used to be installed even when the lock was never
    // acquired, so a run that gave up after 5s deleted another run's mutex on
    // its way out.
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    fs.mkdirSync(path.join(home, '.state.lock'), { recursive: true });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('without the lock'), `says it proceeded unlocked, got: ${output}`);
    assert(fs.existsSync(path.join(home, '.state.lock')), 'the mutex it never held survives');
    assertEq(rosterOf(home)[gitPath(fs.realpathSync(repo))], 'declined', 'the decline is still recorded');
    // And a decline that did acquire the lock removes its own on exit.
    const home2 = mkTmp();
    runScript(repo, { args: ['--decline'], workflowHome: home2 });
    assert(!fs.existsSync(path.join(home2, '.state.lock')), 'a held lock is released');
    cleanup(repo); cleanup(home); cleanup(home2);
  });

  await test('a repo settings.json that is not valid JSON never resolves to enabled', () => {
    const repo = makeRepo({ settings: 'garbage{\n' });
    assertEq(runScript(repo, { args: ['--state'] }).stdout.trim(), 'unreadable', 'an unparseable answer is not a legacy yes');
    const { output } = runScript(repo);
    assert(output.includes('not valid JSON'), `and it says so, got: ${output}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'healing nothing until it is fixed');
    cleanup(repo);
  });

  await test('a committed no with a severed tail is still a no, never a heal', () => {
    // jq prints the answer it parsed and THEN fails on the tail, so a read
    // whose fallback is appended to that answer resolves to neither `false`
    // nor `unreadable`: it falls through to the enabled arm and heals a repo
    // that said no.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }{\n' });
    assertEq(runScript(repo, { args: ['--state'] }).stdout.trim(), 'disabled', 'the deliberate no is read as a no');
    const { output } = runScript(repo);
    assertEq(output, '', `nothing is said about a repo that opted out, got: ${output}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'and nothing is written into it');
    cleanup(repo);
  });

  await test('a severed tail does not cost a repo the version it recorded', () => {
    // The version read is the same file read, one line down: jq prints the
    // version and then fails on the tail, so a read that throws that answer
    // away calls a current repo a legacy one and tries to stamp a version it
    // already carries onto a file nothing can write.
    const repo = makeRepo({ settings: `{ "version": ${STANDARD_VERSION}, "enabled": true }{\n` });
    const { output } = runScript(repo);
    assert(output.includes('issue forms'), `the mechanical heals still run, got: ${output}`);
    assert(!/not valid JSON/.test(output),
      `a repo already at the standard is not stamped again, got: ${output}`);
    cleanup(repo);
  });

  await test('a malformed roster file: declines cleanly, records nothing, leaves no litter', () => {
    const home = mkTmp();
    fs.writeFileSync(path.join(home, '.repos.json'), '{ this is not json\n');
    const repo = makeRepo({ settings: null });
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(output.includes('not valid JSON'), `says what is wrong, got: ${output}`);
    assertEq(fs.readdirSync(home).filter((f) => f.includes('.tmp.')).length, 0, 'and leaves no temp file behind');
    cleanup(repo); cleanup(home);
  });

  await test('a symlinked roster file is updated in place, not replaced', () => {
    // This repo's whole model is symlinking config out of ~, so writing over the
    // link would replace it with a regular file and orphan the real one.
    const home = mkTmp();
    const realDir = mkTmp();
    const realFile = path.join(realDir, '.repos.json');
    fs.writeFileSync(realFile, '{\n  "version": 1,\n  "repos": {},\n  "digest": { "hour": 9 }\n}\n');
    fs.symlinkSync(realFile, path.join(home, '.repos.json'));
    const repo = makeRepo({ settings: null });
    runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(fs.lstatSync(path.join(home, '.repos.json')).isSymbolicLink(), 'still a symlink');
    const written = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    assertEq(written.repos[gitPath(fs.realpathSync(repo))] || written.repos[gitPath(repo)], 'declined', 'the real target got the decline');
    assertEq(written.digest.hour, 9, 'and an unrelated key survived');
    cleanup(repo); cleanup(home); cleanup(realDir);
  });

  await test('declining a repo whose committed file says yes admits it will not take effect', () => {
    const home = mkTmp();
    const repo = makeRepo();
    const { output } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assert(/committed answer, which wins/.test(output), `does not claim a decline it cannot deliver, got: ${output}`);
    assertEq(runScript(repo, { args: ['--state'], workflowHome: home }).stdout.trim(), 'enabled', 'and the repo file still wins');
    cleanup(repo); cleanup(home);
  });

  await test('no jq: a committed enabled:false is still honored, not healed over', () => {
    // The grep fallback exists for exactly this; the only jq-free test used an
    // enabled repo, so the branch that matters had no coverage.
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const binDir = mkTmp();
    // cygpath is the engine's path spelling on Windows (wk_git_path), as much a
    // need there as git; `which` answers nothing for it on macOS and Linux.
    for (const tool of ['git', 'grep', 'tail', 'head', 'cp', 'mkdir', 'tr', 'cat', 'dirname', 'basename', 'cygpath']) {
      const real = which(tool);
      if (real) linkTool(binDir, real);
    }
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), '--state', shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')) }, encoding: 'utf8', timeout: 20000,
    });
    assertEq((res.stdout || '').trim(), 'disabled', 'a deliberate no survives a jq-less machine');
    cleanup(repo); cleanup(binDir);
  });

  await test('the offer line survives a repo path containing a space', () => {
    const parent = mkTmp();
    const repo = path.join(parent, 'has space');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const { stdout } = runScript(repo, { args: ['--announce'] });
    assert(!/--enable [^'"]*has space/.test(stdout), `the suggested command must survive a paste, got: ${stdout}`);
    cleanup(parent);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
