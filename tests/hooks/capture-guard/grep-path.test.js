//
// Tests for hooks/safety/capture-guard: the Grep path, gated when a search is
// pointed at the capture file and open when it only sweeps the repo.
// The shared prologue (the scratch repo and TMPDIR, the marker helpers, the hook runner) is ./helpers.js.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  REPO, CAPTURE, skipWithoutDigest, clearMarker, touchMarker, runHook,
} = require('./helpers');

// A Grep's `path` is read by the guard the way a shell reads one, so it goes
// over in the shell's own spelling, like every other path in a payload.
const grep = ({ path: target, ...rest }) => runHook({
  tool_name: 'Grep',
  tool_input: target === undefined ? rest : { path: shellPath(target), ...rest },
});

const run = async () => {
  skipWithoutDigest();

  group('capture-guard: the Grep path');

  await test('a Grep whose path IS the capture file: exit 2', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: CAPTURE, output_mode: 'content' },
      { pattern: 'salary', path: `${W}/capture.md` },
      { pattern: 'salary', path: CAPTURE, output_mode: 'files_with_matches' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 2, `must block: ${JSON.stringify(input)}`);
      assert(stderr.includes('capture-guard'), 'names itself');
    }
  });

  await test('a Grep whose path is the .workkit directory: exit 2', () => {
    clearMarker();
    for (const p of [path.join(REPO, W), W]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a glob spelling the capture file out: exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '**/capture.md' }).code, 2,
      'the glob names the file, so the search is pointed at it');
  });

  await test('a fresh marker opens the Grep path too: exit 0', () => {
    touchMarker();
    const { code, stderr } = grep({ pattern: 'salary', path: CAPTURE, output_mode: 'content' });
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
  });

  await test('a broad repo-wide Grep: exit 0', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: REPO, output_mode: 'content' },
      { pattern: 'salary' },
      { pattern: 'salary', path: REPO, glob: '**/*.md' },
      { pattern: 'salary', path: path.join(REPO, 'docs') },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 0, `a whole-repo search must never block: ${JSON.stringify(input)}, got: ${stderr}`);
    }
  });

  await test('a .workkit Grep narrowed away from the capture file by its glob: exit 0', () => {
    clearMarker();
    for (const input of [
      { pattern: 'salary', path: path.join(REPO, W), glob: 'agents/session.md' },
      { pattern: 'salary', path: path.join(REPO, W), glob: '*.json' },
    ]) {
      const { code, stderr } = grep(input);
      assertEq(code, 0, `the glob cannot name the capture file: ${JSON.stringify(input)}, got: ${stderr}`);
    }
  });

  await test('a glob merely mentioning capture is still pointed at it: exit 2', () => {
    clearMarker();
    assertEq(grep({ pattern: 'salary', path: REPO, glob: '*capture*' }).code, 2,
      'the glob names the capture file, however it spells it');
  });

  await test('a trailing slash does not slip the Grep gate: exit 2', () => {
    clearMarker();
    for (const p of [`${path.join(REPO, W)}/`, `${CAPTURE}/`]) {
      assertEq(grep({ pattern: 'salary', path: p }).code, 2, `must block: ${p}`);
    }
  });

  await test('a .workkit Grep where no capture file exists: exit 0', () => {
    clearMarker();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-bare-'));
    spawnSync('git', ['init', '-q'], { cwd: bare });
    fs.mkdirSync(path.join(bare, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(bare, W, 'agents', 'session.md'), '# Session\n');
    const { code, stderr } = grep({ pattern: 'salary', path: path.join(bare, W) });
    assertEq(code, 0, `an absent capture file has nothing to protect, got: ${stderr}`);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
