//
// Tests for hooks/workflow:standards — the SessionStart hook that runs
// the workflow core's standards.sh against the session's repo, at most once per
// repo per day, and reports only what it created or corrected.
//
// The standards script's label step needs gh; every test here runs with a PATH
// that has no gh on it (or a recording stub), so nothing touches the network.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, hasLaunchd, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'workflow', 'standards', 'run.sh');

// The hook resolves the engine from its own location; WORKFLOW_DIR overrides
// that. Most tests point it at the repo's own workflow/ explicitly, and the
// default-path group drops it to prove the relative resolution.
const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');

// node is on the PATH of any machine running this standard — the engine lints
// CHANGELOGs with it, and its hook-layer self-check counts it among the tools
// the hooks call. A PATH without it makes every heal here report a machine that
// does not exist.
const BASE_PATH = `/usr/bin:/bin:/usr/sbin:/sbin:${path.dirname(process.execPath)}`;

// The ignore line the engine writes, built from the harness constant so the
// directory's name lives in exactly one place here too.
const IGNORE_GLOB = new RegExp(`^${W.replace(/\./g, '\\.')}/\\*$`, 'm');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hook-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// Participation gate: a committed .workkit/settings.json holding
// `enabled: true` at the repo root IS the opt-in, so every repo fixture gets one
// unless a test is exercising another state.
const makeRepo = ({ optIn = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/ian/repo.git'], { cwd: dir });
  if (optIn) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// Record a decline the way the engine does — through its own entry point, so
// the test proves the two halves agree on the file's shape.
const decline = (repo, workflowHome) => spawnSync('bash', [
  path.join(WORKFLOW_DIR, 'standards.sh'), '--decline', repo,
], {
  env: {
    ...process.env,
    WORKFLOW_HOME: workflowHome,
    WORKFLOW_CLAUDE_HOME: path.join(mkTmp(), 'claude-home'),
  },
  encoding: 'utf8',
});

// Each run gets its own cache dir unless one is passed in — the daily marker
// must never leak between tests (or into the real ~/.claude/logs).
// `home` overrides HOME; passing workflowDir: null DROPS WORKFLOW_DIR from the
// environment so the hook resolves the engine beside itself.
// WORKFLOW_HOME and WORKFLOW_CLAUDE_HOME always point somewhere disposable: the
// user-level settings file and the engine's address symlink, both written by
// the engine on every run, must never be the real ~/.workkit or ~/.claude.
// A machine that has run `workkit setup`, as far as the setup pester (#72) can
// see it: the CLI symlink the wizard installs, pointed at this checkout's
// engine — exactly what `workkit update` calls current. Every run seeds it
// unless the test is exercising a machine that never ran setup (setup: false),
// because a scratch HOME is otherwise indistinguishable from a fresh machine
// and every case here would carry the pester.
const seedSetup = (home) => {
  const dir = path.join(home, '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(dir, 'workkit');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(WORKFLOW_DIR, 'workkit.sh'), link);
  return link;
};

const runHook = (cwd, { cache, pathPrefix, home, workflowDir, workflowHome, setup = true } = {}) => {
  const cacheDir = cache || mkTmp();
  const env = {
    // A scratch HOME by default: the hook's daily run now also drives the
    // machine-side upkeep (`workkit update --auto`), which reads
    // ~/Library/LaunchAgents and ~/.local/bin. Neither may ever be the
    // developer's own.
    HOME: home || mkTmp(),
    PATH: pathPrefix ? `${pathPrefix}:${BASE_PATH}` : BASE_PATH,
    WORKFLOW_STANDARDS_CACHE: cacheDir,
    // OUTSIDE the marker cache: the engine now seeds the user settings file on
    // every run, and a workflow-home nested in the cache would be counted by
    // the tests that assert one marker file per repo.
    WORKFLOW_HOME: workflowHome || path.join(mkTmp(), 'workflow-home'),
    WORKFLOW_CLAUDE_HOME: path.join(mkTmp(), 'claude-home'),
  };
  if (setup) seedSetup(env.HOME);
  const dir = workflowDir === undefined ? WORKFLOW_DIR : workflowDir;
  if (dir !== null) env.WORKFLOW_DIR = dir;
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd, source: 'startup' }),
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', cacheDir };
};

const run = async () => {
  group('workflow:standards — guards');

  await test('non-git cwd — silent exit 0, creates nothing', () => {
    const dir = mkTmp();
    const { code, stdout, cacheDir } = runHook(dir);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no output');
    assert(!fs.existsSync(path.join(dir, '.github')), 'nothing written outside a repo');
    cleanup(dir); cleanup(cacheDir);
  });

  await test('empty cwd in input — exit 0', () => {
    const { code, stdout, cacheDir } = runHook('');
    assertEq(code, 0, 'fail open');
    assertEq(stdout, '', 'no output');
    cleanup(cacheDir);
  });

  group('workflow:standards — participation gate');

  // The offer an undecided repo hears, as SessionStart context.
  const offerOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

  await test('no .workkit/settings.json — offers to enable, writes nothing', () => {
    const repo = makeRepo({ optIn: false });
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'fail closed for writes, open for the session');
    const ctx = offerOf(stdout);
    assert(ctx.includes('not in the issue workflow'), `offers to enable, got: ${ctx}`);
    assert(ctx.includes('--enable') && ctx.includes('--decline'), 'and gives both answers');
    assert(!fs.existsSync(path.join(repo, '.github')), 'no templates on a non-participating repo');
    assert(!fs.existsSync(path.join(repo, '.gitignore')), 'and no gitignore appended');
    assert(!fs.existsSync(path.join(repo, W)), 'and no .workkit directory');
    cleanup(repo); cleanup(cacheDir);
  });

  await test('enabled: false — silent, and no offer either', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `the project turned it off on purpose, got: ${stdout}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'nothing written');
    cleanup(repo); cleanup(cacheDir);
  });

  await test('a declined repo is never mentioned again', () => {
    const repo = makeRepo({ optIn: false });
    const workflowHome = mkTmp();
    decline(repo, workflowHome);
    const { code, stdout, cacheDir } = runHook(repo, { workflowHome });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `no offer after a decline, got: ${stdout}`);
    assert(!fs.existsSync(path.join(repo, '.github')), 'and nothing written');
    cleanup(repo); cleanup(cacheDir); cleanup(workflowHome);
  });

  await test('the offer repeats every session — it is not daily-cached', () => {
    const repo = makeRepo({ optIn: false });
    const cache = mkTmp();
    const first = runHook(repo, { cache });
    const second = runHook(repo, { cache });
    assert(first.stdout.length > 0 && second.stdout.length > 0, 'both sessions hear it');
    assertEq(fs.readdirSync(cache).filter((f) => f !== 'workflow-home').length, 0, 'an offer costs nothing, so it leaves no marker');
    cleanup(repo); cleanup(cache);
  });

  await test('a .workkit/ directory without settings.json is not an opt-in', () => {
    const repo = makeRepo({ optIn: false });
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'inbox.md'), '- a note\n');
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(offerOf(stdout).includes('not in the issue workflow'), 'the committed settings.json is what opts a repo in');
    assert(!fs.existsSync(path.join(repo, '.github')), 'nothing written');
    cleanup(repo); cleanup(cacheDir);
  });

  await test('settings.json in a subdirectory does not opt the repo in', () => {
    const repo = makeRepo({ optIn: false });
    const nested = path.join(repo, 'packages', 'app', W);
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'settings.json'), '{ "version": 1 }\n');
    const { stdout, cacheDir } = runHook(repo);
    assert(offerOf(stdout).includes('not in the issue workflow'), 'the gate reads the repo ROOT only');
    assert(!fs.existsSync(path.join(repo, '.github')), 'nothing written');
    cleanup(repo); cleanup(cacheDir);
  });

  group('workflow:standards — healing a repo');

  await test('unstandardized repo — heals it and reports what changed', () => {
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'issue templates installed');
    assert(IGNORE_GLOB.test(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')), `${W}/ ignored`);
    const parsed = JSON.parse(stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'SessionStart', 'SessionStart context');
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('issue forms'), `reports the forms, got: ${ctx}`);
    assert(ctx.includes('gitignore'), `reports the gitignore heal, got: ${ctx}`);
    assert(!ctx.includes('['), 'ANSI colors stripped');
    cleanup(repo); cleanup(cacheDir);
  });

  await test('already-standardized repo — silent (skips are not news)', () => {
    const repo = makeRepo();
    const first = runHook(repo);
    assert(first.stdout.length > 0, 'first run reported the heals');
    // Fresh cache dir: this is the "different day" run, not the cached one.
    const second = runHook(repo);
    assertEq(second.code, 0, 'exit 0');
    assertEq(second.stdout, '', `an all-skip run stays silent, got: ${second.stdout}`);
    cleanup(repo); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  await test('a subdirectory session resolves to the repo root', () => {
    const repo = makeRepo();
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    // settings.json sits at the ROOT — the gate reads the resolved root, not the cwd.
    const { cacheDir } = runHook(nested);
    assert(fs.existsSync(path.join(repo, '.gitignore')), 'root healed');
    assert(!fs.existsSync(path.join(nested, '.gitignore')), 'nothing written in the subdirectory');
    cleanup(repo); cleanup(cacheDir);
  });

  group('workflow:standards — daily cache');

  await test('second session the same day — no re-run, no output', () => {
    const repo = makeRepo();
    const cache = mkTmp();
    const first = runHook(repo, { cache });
    assert(first.stdout.length > 0, 'first run reported');
    fs.rmSync(path.join(repo, '.github'), { recursive: true, force: true });
    const second = runHook(repo, { cache });
    assertEq(second.stdout, '', 'cached run says nothing');
    assert(!fs.existsSync(path.join(repo, '.github')), 'and does not re-run the script');
    cleanup(repo); cleanup(cache);
  });

  await test('the marker is dated, one file per repo', () => {
    const repoA = makeRepo();
    const repoB = makeRepo();
    const cache = mkTmp();
    runHook(repoA, { cache });
    const afterA = fs.readdirSync(cache);
    assertEq(afterA.length, 1, 'one marker after the first repo');
    // The hook stamps `date +%Y-%m-%d` — LOCAL time. Comparing against a UTC
    // ISO slice fails for the hours the two dates disagree.
    const today = spawnSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' }).stdout.trim();
    assertEq(fs.readFileSync(path.join(cache, afterA[0]), 'utf8'), today, 'marker holds today');
    const second = runHook(repoB, { cache });
    assertEq(fs.readdirSync(cache).length, 2, 'a second repo gets its own marker');
    assert(second.stdout.length > 0, 'and is healed on its own schedule');
    cleanup(repoA); cleanup(repoB); cleanup(cache);
  });

  await test('a stale marker re-arms the run', () => {
    const repo = makeRepo();
    const cache = mkTmp();
    runHook(repo, { cache });
    const marker = path.join(cache, fs.readdirSync(cache)[0]);
    fs.writeFileSync(marker, '2000-01-01');
    fs.rmSync(path.join(repo, '.github'), { recursive: true, force: true });
    const again = runHook(repo, { cache });
    assert(again.stdout.includes('issue forms'), `yesterday's marker does not suppress today, got: ${again.stdout}`);
    cleanup(repo); cleanup(cache);
  });

  group('workflow:standards — default engine path');

  await test('no WORKFLOW_DIR — resolves the engine beside the hook and heals', () => {
    // No symlink, no HOME: the hook climbs out of its own directory to the
    // kit's workflow/, so a fresh plugin install works with nothing installed.
    const home = mkTmp();
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo, { home, workflowDir: null });
    assertEq(code, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the relative path found the engine');
    assert(stdout.includes('issue forms'), `and reported the heal, got: ${stdout}`);
    cleanup(repo); cleanup(cacheDir); cleanup(home);
  });

  await test('a missing engine — says where it looked, exit 0', () => {
    const engine = mkTmp();
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'a missing engine never wedges the session');
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert(ctx.includes(path.join(engine, 'standards.sh')), `names the path it looked at, got: ${ctx}`);
    assert(ctx.includes('plugin'), 'tells the human what to reinstall');
    assert(!fs.existsSync(path.join(repo, '.github')), 'and heals nothing');
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  await test('an engine without labels.json is announced for an opted-in repo', () => {
    // A missing manifest used to fail --state, which this hook read as nogit —
    // a broken install went silent forever instead of speaking once.
    const engine = mkTmp();
    fs.symlinkSync(path.join(WORKFLOW_DIR, 'standards.sh'), path.join(engine, 'standards.sh'));
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'a broken install never wedges the session');
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert(ctx.includes('labels.json'), `names the manifest, got: ${ctx}`);
    assert(ctx.includes('plugin'), 'tells the human what to reinstall');
    assert(!fs.existsSync(path.join(repo, '.github')), 'and heals nothing');
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  await test('a missing manifest stays silent on a repo that never opted in', () => {
    const engine = mkTmp();
    fs.symlinkSync(path.join(WORKFLOW_DIR, 'standards.sh'), path.join(engine, 'standards.sh'));
    const repo = makeRepo({ optIn: false });
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `non-participating repos hear nothing, got: ${stdout}`);
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  await test('a missing engine stays silent on a repo that never opted in', () => {
    const engine = mkTmp();
    const repo = makeRepo({ optIn: false });
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'non-participating repos hear nothing');
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  // Without the engine, undecided and declined are indistinguishable — but a
  // committed `false` is resolvable from the repo alone, so the deliberate no
  // must be honored here too (review finding, 2026-07-24).
  await test('a missing engine stays silent on a deliberately disabled repo', () => {
    const engine = mkTmp();
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `a project that turned it off hears nothing, got: ${stdout}`);
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  group('workflow:standards — the setup pester (#72)');

  const contextOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

  await test('a machine that never ran setup is told to, every session', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const cache = mkTmp();
    const first = runHook(repo, { home, cache, setup: false });
    assertEq(first.code, 0, 'exit 0');
    const ctx = contextOf(first.stdout);
    assert(ctx.includes('SETUP:'), `the session hears it, got: ${ctx}`);
    assert(ctx.includes('workkit.sh setup'), `and is given the exact command, got: ${ctx}`);
    assert(ctx.includes('issue forms'), 'the heal report rides along with it');
    // Second session, same day: the daily gate silences the heal, never the pester.
    const second = runHook(repo, { home, cache, setup: false });
    assert(contextOf(second.stdout).includes('workkit.sh setup'), `no nag cache, got: ${second.stdout}`);
    assert(!second.stdout.includes('issue forms'), 'and the daily gate still holds for the heal');
    cleanup(repo); cleanup(home); cleanup(cache);
  });

  await test('a set-up machine hears nothing about setup', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const first = runHook(repo, { home });
    assert(!first.stdout.includes('SETUP:'), `the pester ends when setup has run, got: ${first.stdout}`);
    const second = runHook(repo, { home });
    assertEq(second.stdout, '', `and a quiet session stays quiet, got: ${second.stdout}`);
    cleanup(repo); cleanup(home); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  await test('setup is a machine question — the pester reaches a non-git cwd too', () => {
    const dir = mkTmp();
    const home = mkTmp();
    const { code, stdout, cacheDir } = runHook(dir, { home, setup: false });
    assertEq(code, 0, 'exit 0');
    assert(contextOf(stdout).includes('workkit.sh setup'), `nothing about the machine needs a repo, got: ${stdout}`);
    assert(!fs.existsSync(path.join(dir, '.github')), 'and still nothing written outside a repo');
    cleanup(dir); cleanup(home); cleanup(cacheDir);
  });

  await test('a declined repo still hears the setup pester and nothing else', () => {
    const repo = makeRepo({ optIn: false });
    const home = mkTmp();
    const workflowHome = mkTmp();
    decline(repo, workflowHome);
    const { stdout, cacheDir } = runHook(repo, { home, workflowHome, setup: false });
    const ctx = contextOf(stdout);
    assert(ctx.includes('workkit.sh setup'), `the machine question is not the repo's to decline, got: ${ctx}`);
    assert(!ctx.includes('not in the issue workflow'), 'the decline still holds for the repo offer');
    cleanup(repo); cleanup(home); cleanup(cacheDir); cleanup(workflowHome);
  });

  group('workflow:standards — machine-side upkeep');

  // The plist a machine carries, rendered for some OTHER checkout — the drift
  // `workkit update --auto` exists to correct. Written straight to disk rather
  // than through the installer: what matters here is that the hook noticed.
  const seedStalePlist = (home) => {
    const dir = path.join(home, 'Library', 'LaunchAgents');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'com.workkit.claude-daily.plist');
    fs.writeFileSync(file, '<!-- rendered by an older checkout -->\n');
    return file;
  };

  // A launchctl that records nothing and answers "not loaded" — the real one is
  // never reached from a test.
  const launchctlShim = () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'launchctl'), '#!/usr/bin/env bash\nif [[ "$1" == \'print\' ]]; then exit 1; fi\nexit 0\n');
    fs.chmodSync(path.join(dir, 'launchctl'), 0o755);
    return dir;
  };

  await test('a machine with no schedule installed never gets one', () => {
    // The whole cron boundary: the hook UPDATES what a human installed and
    // installs nothing fresh.
    const repo = makeRepo();
    const home = mkTmp();
    const shim = launchctlShim();
    const { code, cacheDir } = runHook(repo, { home, pathPrefix: shim });
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents')), 'nothing was installed behind anyone’s back');
    cleanup(repo); cleanup(cacheDir); cleanup(home); cleanup(shim);
  });

  await test('an all-current machine stays silent', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const first = runHook(repo, { home });
    assert(first.stdout.length > 0, 'the first run reported the heals');
    const second = runHook(repo, { home });
    assertEq(second.stdout, '', `upkeep with nothing to do adds no noise, got: ${second.stdout}`);
    cleanup(repo); cleanup(home); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  // The plist itself is launchd's, and the engine re-renders one only where
  // launchd is (`schedule: launchd is macOS — nothing to keep current here`).
  // Off that machine there is no schedule to correct, so the case is named as a
  // skip rather than asserted against a capability that is not there (#114).
  if (hasLaunchd()) {
    group('workflow:standards — the schedule it keeps current');

    await test('a repo’s daily run corrects a schedule left by another checkout', () => {
      const repo = makeRepo();
      const home = mkTmp();
      const shim = launchctlShim();
      const plist = seedStalePlist(home);
      const { code, stdout, cacheDir } = runHook(repo, { home, pathPrefix: shim });
      assertEq(code, 0, 'exit 0');
      const body = fs.readFileSync(plist, 'utf8');
      assert(!body.includes('older checkout'), 'the plist is re-rendered for this checkout');
      assert(body.includes('com.workkit.claude-daily'), 'and it is the real one');
      const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert(ctx.includes('schedule:'), `the session hears what was corrected, got: ${ctx}`);
      cleanup(repo); cleanup(cacheDir); cleanup(home); cleanup(shim);
    });
  } else {
    group('workflow:standards — the schedule it keeps current — skipped, launchd is macOS (#114)');
  }

  group('workflow:standards — offline');

  await test('no gh on PATH — local heals still reported, no failure', () => {
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('gh not installed'), 'a skip line never reaches the session');
    assert(stdout.includes('issue forms'), 'the local heals do');
    cleanup(repo); cleanup(cacheDir);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
