//
// Tests for hooks/workflow:standards: the guards (a non-git or empty cwd), and
// the participation gate that decides whether a repo is healed, offered, or
// left alone.
// The shared prologue (the repo factory, the decline, the hook runner and its gh-less PATH, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  mkTmp, cleanup, makeRepo, decline, runHook, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: guards');

  await test('non-git cwd: silent exit 0, creates nothing', () => {
    const dir = mkTmp();
    const { code, stdout, cacheDir } = runHook(dir);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no output');
    assert(!fs.existsSync(path.join(dir, '.github')), 'nothing written outside a repo');
    cleanup(dir); cleanup(cacheDir);
  });

  await test('empty cwd in input: exit 0', () => {
    const { code, stdout, cacheDir } = runHook('');
    assertEq(code, 0, 'fail open');
    assertEq(stdout, '', 'no output');
    cleanup(cacheDir);
  });

  group('workflow:standards: participation gate');

  // The offer an undecided repo hears, as SessionStart context.
  const offerOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

  await test('no .workkit/settings.json: offers to enable, writes nothing', () => {
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

  await test('enabled: false: silent, and no offer either', () => {
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

  await test('the offer repeats every session: it is not daily-cached', () => {
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
    fs.writeFileSync(path.join(repo, W, 'capture.md'), '- a note\n');
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

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
