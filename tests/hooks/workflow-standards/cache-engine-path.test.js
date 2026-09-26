//
// Tests for hooks/workflow:standards: the daily cache marker, and the default
// engine path the hook resolves beside itself (and what it says when the
// engine or its manifest is missing).
// The shared prologue (the repo factory, the decline, the hook runner and its gh-less PATH, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  WORKFLOW_DIR, mkTmp, cleanup, makeRepo, runHook, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: daily cache');

  await test('second session the same day: no re-run, no output', () => {
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
    // The hook stamps `date +%Y-%m-%d`: LOCAL time. Comparing against a UTC
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

  group('workflow:standards: default engine path');

  await test('no WORKFLOW_DIR: resolves the engine beside the hook and heals', () => {
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

  await test('a missing engine: says where it looked, exit 0', () => {
    const engine = mkTmp();
    const repo = makeRepo();
    const { code, stdout, cacheDir } = runHook(repo, { workflowDir: engine });
    assertEq(code, 0, 'a missing engine never wedges the session');
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert(ctx.includes(`${shellPath(engine)}/standards.sh`), `names the path it looked at, got: ${ctx}`);
    assert(ctx.includes('plugin'), 'tells the human what to reinstall');
    assert(!fs.existsSync(path.join(repo, '.github')), 'and heals nothing');
    cleanup(repo); cleanup(cacheDir); cleanup(engine);
  });

  await test('an engine without labels.json is announced for an opted-in repo', () => {
    // A missing manifest used to fail --state, which this hook read as nogit:
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

  // Without the engine, undecided and declined are indistinguishable, but a
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

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
