// Tests for hooks/safety/suite-marker, the PostToolUse hook that records the
// working tree a green full root suite run proved, the record safety/suite-guard
// and the commit gate read. Anything else writes nothing, and it fails open.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { RECORDER, RESPONSE, suiteMarkerPath, treeHash, record } = require('../lib/suite-record');

const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');
const TMP = mkTmp('suite-marker-tmp-');
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const mkRepo = () => {
  const dir = mkTmp('suite-marker-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node tests/run.js' } }));
  return dir;
};

const marker = (dir) => suiteMarkerPath(TMP, dir);
const recorded = (dir) => (fs.existsSync(marker(dir)) ? fs.readFileSync(marker(dir), 'utf8') : null);

// Records under <opts>, then asserts the hook exited 0 and wrote nothing.
const writesNothing = (opts, why) => {
  const dir = mkRepo();
  const res = record(TMP, dir, opts);
  assertEq(res.status, 0, `always exit 0: ${why}`);
  assertEq(recorded(dir), null, `no marker: ${why}`);
  cleanup(dir);
};

const run = async () => {
  group('suite-marker: a green full root run records the tree');

  for (const command of ['npm test', 'npm run test', 'npm t', 'node tests/run.js', '  npm test  ']) {
    await test(`${command}: the marker holds the working tree's hash`, () => {
      const dir = mkRepo();
      const res = record(TMP, dir, { command });
      assertEq(res.status, 0, `exit 0, got: ${res.stderr}`);
      assertEq(res.stdout + res.stderr, '', 'and silent');
      assertEq(recorded(dir), `${treeHash(dir)}\n`, 'the tree the run proved');
      cleanup(dir);
    });
  }

  await test('the real payload carries no exit code: the event is the success signal', () => {
    const dir = mkRepo();
    record(TMP, dir, { response: { ...RESPONSE, stdout: '12 passed\n' } });
    assertEq(recorded(dir), `${treeHash(dir)}\n`, 'recorded');
    cleanup(dir);
  });

  await test('an untracked file changes the hash the next run records', () => {
    const dir = mkRepo();
    record(TMP, dir);
    const first = recorded(dir);
    fs.writeFileSync(path.join(dir, 'new.js'), 'x\n');
    record(TMP, dir);
    assert(recorded(dir) !== first, 'a new file is a new tree');
    assertEq(recorded(dir), `${treeHash(dir)}\n`, 'and the marker names it');
    cleanup(dir);
  });

  group('suite-marker: anything else writes nothing');

  await test('a narrowed run writes nothing', () => {
    writesNothing({ command: 'npm test -- tests/a.test.js' }, 'an npm scope');
    writesNothing({ command: 'node --test tests/a.test.js' }, 'one file');
    writesNothing({ command: 'node tests/run.js hooks' }, 'the script with an argument');
    writesNothing({ command: 'npm run test:unit' }, 'another script');
  });

  await test('anything but the exact suite command writes nothing', () => {
    writesNothing({ command: 'cd sub && npm test' }, 'a directory change first');
    writesNothing({ command: 'npm test -w sub' }, 'a workspace flag');
    writesNothing({ command: 'npm test tests/a.test.js' }, 'an argument');
    writesNothing({ command: 'npm test 2>&1 | tail -20' }, "a pipe, whose exit status is tail's");
  });

  await test('a run that has not finished writes nothing', () => {
    writesNothing({ toolInput: { run_in_background: true } }, 'run_in_background');
    writesNothing({ response: { ...RESPONSE, backgroundTaskId: 'b1' } }, 'a backgroundTaskId response');
    writesNothing({ response: { ...RESPONSE, interrupted: true } }, 'an interrupted run');
  });

  await test('a mention writes nothing', () => {
    writesNothing({ command: 'cat <<EOF > notes.md\nnpm test\nEOF' }, 'a heredoc body');
    writesNothing({ command: 'echo "npm test belongs to the gate"' }, 'a quoted string');
  });

  await test("a nested package's own run from inside it writes nothing", () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'package.json'), JSON.stringify({ name: 'sub', scripts: { test: 'node --test' } }));
    assertEq(record(TMP, dir, { cwd: path.join(dir, 'sub') }).status, 0, 'exit 0');
    assertEq(recorded(dir), null, "the package's suite never proves the root");
    cleanup(dir);
  });

  await test("a nested package whose script matches the root's writes nothing from inside it", () => {
    const dir = mkTmp('suite-marker-mono-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mono', scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(dir, 'pkg'));
    fs.writeFileSync(path.join(dir, 'pkg', 'package.json'), JSON.stringify({ name: 'pkg', scripts: { test: 'jest' } }));
    assertEq(record(TMP, dir, { command: 'jest', cwd: path.join(dir, 'pkg') }).status, 0, 'exit 0');
    assertEq(recorded(dir), null, "pkg/'s jest run never proves the root");
    cleanup(dir);
  });

  group('suite-marker: fail-open');

  await test('no jq: exit 0, nothing written', () => {
    const empty = mkTmp('suite-marker-empty-');
    writesNothing({ env: { PATH: empty }, bash: SYSTEM_BASH }, 'no jq');
  });

  await test('a directory inside no git repository: exit 0', () => {
    const dir = mkTmp('suite-marker-bare-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node tests/run.js' } }));
    const markers = () => (fs.existsSync(path.join(TMP, 'claude-suite-marker'))
      ? fs.readdirSync(path.join(TMP, 'claude-suite-marker')).length : 0);
    const before = markers();
    assertEq(record(TMP, dir).status, 0, 'no repo, nothing to record');
    assertEq(markers(), before, 'no marker written');
    cleanup(dir);
  });

  await test('malformed JSON: exit 0', () => {
    const res = spawnSync(BASH, [...NO_RC, shellPath(RECORDER)], {
      input: 'not json',
      env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH, TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
  });

  group('suite-marker: wiring');

  await test('hooks.json registers the recorder under PostToolUse with matcher Bash', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PostToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PostToolUse Bash block exists');
    assert(bash.hooks.some((h) => h.command.includes('safety:suite-marker')), 'it routes safety:suite-marker');
  });

  await test('the loader routes safety:suite-marker', () => {
    const dir = mkRepo();
    spawnSync(BASH, [LOADER, 'safety:suite-marker'], {
      input: JSON.stringify({ cwd: shellPath(dir), tool_input: { command: 'npm test' }, tool_response: RESPONSE }),
      env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH, TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(recorded(dir), `${treeHash(dir)}\n`, 'the loader resolves it and the marker is written');
    cleanup(dir);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
