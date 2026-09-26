//
// Tests for hooks/safety/commit-gate: check 6, a closed issue carries its Proof:
// comment (issue #233), and the hook registered on PreToolUse Bash.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { SYSTEM_BASH, pathWith, stubTool } = require('../../lib/platform');
const { skipWithoutDigest, mkRepo, stage, touchMarker, runHook, cleanup, CHANGELOG, ENTRY } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: check 6, a closed issue carries its Proof: comment (issue #233)');

  // A proof is a hard gate (owner ruling, 2026-09-10): the trailer is its third
  // stage, after the complete flip and the close that safety/proof-guard holds.
  // The read is the guard's, so the shim answers the same call, and nothing
  // here reaches GitHub.
  const ghStub = ({ comments = {}, fails = false } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-gh-'));
    const bodies = path.join(dir, 'issues');
    fs.mkdirSync(bodies);
    for (const [number, list] of Object.entries(comments)) {
      fs.writeFileSync(path.join(bodies, `${number}.json`),
        JSON.stringify({ comments: list.map((body) => ({ body })) }));
    }
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    stubTool(bin, 'gh', [
      '#!/usr/bin/env bash',
      'if [[ "$1 $2" == "issue view" ]]; then',
      ...(fails ? ['  exit 1'] : [
        `  file="${bodies}/$3.json"`,
        '  [[ -f "$file" ]] || exit 1',
        '  cat "$file"',
        '  exit 0',
      ]),
      'fi',
      'exit 0',
    ]);
    return { env: { PATH: pathWith(bin) }, dir };
  };

  // A repo whose commit is ready for every other check: CHANGELOG seeded and
  // its entry staged (check 4), code staged, review marker fresh.
  const shipReadyRepo = () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG());
    execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    stage(dir, 'CHANGELOG.md', ENTRY);
    touchMarker(dir);
    return dir;
  };

  await test('a Fixes trailer whose issue has no Proof: comment blocks', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ comments: { 4: ['QA passed by the owner, 2026-09-10.'] } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"', undefined, stub.env);
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#4'), `names the issue, got: ${stderr}`);
    assert(stderr.includes('Proof:'), `names what is missing, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('a repo that keeps no CHANGELOG.md is never asked for a proof, even when gh can answer', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const stub = ghStub({ comments: { 4: ['looks good to me'] } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"', undefined, stub.env);
    assertEq(code, 0, `allowed outside the pipeline, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('the same commit passes once the issue carries its proof', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ comments: { 4: ['Proof: unit: node tests/hooks/x.test.js'] } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"', undefined, stub.env);
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('every unproved issue in the message is named', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ comments: { 4: ['Proof: unit: node tests/hooks/x.test.js'], 9: ['looks good'], 12: ['ok'] } });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4\nCloses #9\nResolves #12"', undefined, stub.env);
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('#9') && stderr.includes('#12'), `names both, got: ${stderr}`);
    assert(!stderr.includes('#4'), `never names the proved one, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('a gh that cannot answer stands the check down, and the commit is not blocked', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ fails: true });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"', undefined, stub.env);
    assertEq(code, 0, `an unreachable gh fails open, got: ${stderr}`);
    assert(stderr.includes('did not run'), `and says so, got: ${stderr}`);
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('no trailer, no proof read', () => {
    const dir = shipReadyRepo();
    const stub = ghStub({ comments: {} });
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing that closes nothing"', undefined, stub.env);
    assertEq(code, 0, `allowed, got: ${stderr}`);
    assertEq(stderr, '', 'a commit closing nothing is never asked for a proof');
    cleanup(dir);
    fs.rmSync(stub.dir, { recursive: true, force: true });
  });

  await test('hooks.json registers the gate under PreToolUse Bash', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bashEntries = settings.hooks.PreToolUse.filter((e) => e.matcher === 'Bash');
    const wired = bashEntries.some((e) => e.hooks.some((h) => h.command.includes('safety:commit-gate')));
    assert(wired, 'safety:commit-gate is registered on PreToolUse Bash');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
