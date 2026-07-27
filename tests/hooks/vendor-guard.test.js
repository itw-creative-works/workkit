/* eslint-disable no-console */
//
// Tests for hooks/safety/vendor-guard — the PreToolUse hook that blocks edits
// to generated/vendor/installed files (node_modules, dist, build, vendor,
// .bundle, lockfiles) before they happen. _attic/ is exempt by design.
//

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'vendor-guard', 'run.sh');

const runHook = (filePath) => {
  const input = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: { ...process.env, HOME: os.homedir() },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const run = async () => {
  group('vendor-guard: blocked paths');

  await test('node_modules/ — exit 2', () => {
    const { code, stderr } = runHook('/repo/node_modules/lodash/index.js');
    assertEq(code, 2, 'node_modules edits must block');
    assert(stderr.includes('vendor-guard'), 'names itself');
    assert(stderr.includes('SOURCE'), 'points at the source-not-output rule');
  });

  await test('dist/, build/, vendor/, .bundle/ segments — exit 2', () => {
    for (const p of ['/repo/dist/app.js', '/repo/build/out.css', '/repo/vendor/lib.rb', '/repo/.bundle/config']) {
      const { code } = runHook(p);
      assertEq(code, 2, `${p} must block`);
    }
  });

  await test('lockfiles — exit 2', () => {
    for (const p of ['/repo/package-lock.json', '/repo/yarn.lock', '/repo/pnpm-lock.yaml', '/repo/Gemfile.lock']) {
      const { code, stderr } = runHook(p);
      assertEq(code, 2, `${p} must block`);
      assert(stderr.includes('package managers'), 'explains lockfile ownership');
    }
  });

  await test('RELATIVE vendor paths blocked; relative _attic/ exempt (review regression)', () => {
    assertEq(runHook('node_modules/foo/index.js').code, 2, 'relative node_modules must block');
    assertEq(runHook('dist/app.js').code, 2, 'relative dist must block');
    assertEq(runHook('_attic/old.js').code, 0, 'relative _attic is exempt');
  });

  group('vendor-guard: allowed paths');

  await test('ordinary source file — exit 0', () => {
    const { code, stderr } = runHook('/repo/src/index.js');
    assertEq(code, 0, 'source edits pass');
    assertEq(stderr, '', 'silent');
  });

  await test('_attic/ is exempt even with vendor segments — exit 0', () => {
    const { code } = runHook('/repo/_attic/dist/old-thing.js');
    assertEq(code, 0, '_attic writes are by design');
  });

  await test('.workkit/ is exempt — session state and inbox (workflow spec, 2026-07-24)', () => {
    assertEq(runHook(`/repo/${W}/fable-cutover.md`).code, 0, `absolute ${W} is exempt`);
    assertEq(runHook(`${W}/inbox.md`).code, 0, `relative ${W} is exempt`);
    assertEq(runHook(`/repo/${W}/settings.json`).code, 0, 'the committed opt-in is editable');
  });

  await test('.workkit/ nested in a vendor directory still blocks (review regression)', () => {
    for (const p of [
      `/repo/node_modules/pkg/${W}/notes.md`,
      `/repo/dist/${W}/inbox.md`,
      `node_modules/pkg/${W}/settings.json`,
    ]) {
      assertEq(runHook(p).code, 2, `${p} is installed output, exception or not`);
    }
    // _attic/ keeps its precedence: a parked attic may legitimately hold a dist/.
    assertEq(runHook(`/repo/_attic/dist/${W}/notes.md`).code, 0, '_attic still outranks');
  });

  await test('file merely NAMED dist.js — exit 0 (segment match only)', () => {
    const { code } = runHook('/repo/src/dist.js');
    assertEq(code, 0, 'only directory segments match, not basenames');
  });

  group('vendor-guard: gitignored files');

  const fs = require('fs');
  const { execSync } = require('child_process');
  const mkRepo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-test-'));
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'generated.json\n.env\n');
    return dir;
  };
  const rmDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

  await test('gitignored file in a repo — exit 2', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook(path.join(dir, 'generated.json'));
    assertEq(code, 2, 'gitignored files must block');
    assert(stderr.includes('gitignored'), 'names the reason');
    rmDir(dir);
  });

  await test('.env is allowed even though gitignored', () => {
    const dir = mkRepo();
    const { code } = runHook(path.join(dir, '.env'));
    assertEq(code, 0, '.env is a designed exception');
    rmDir(dir);
  });

  await test('tracked file in a repo — exit 0', () => {
    const dir = mkRepo();
    const { code } = runHook(path.join(dir, 'src.js'));
    assertEq(code, 0, 'non-ignored files pass');
    rmDir(dir);
  });

  await test('file outside any git repo — exit 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-norepo-'));
    const { code } = runHook(path.join(dir, 'scratch.txt'));
    assertEq(code, 0, 'non-repo files pass (scratchpad, tmp)');
    rmDir(dir);
  });

  group('vendor-guard: fail-open');

  await test('missing file_path — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'no file_path → fail open');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
