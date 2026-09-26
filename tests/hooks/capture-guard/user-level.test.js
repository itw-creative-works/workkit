//
// Tests for hooks/safety/capture-guard: the user-level capture file keyed to
// $HOME, the hook's wiring and the triage skill's marker line, and the
// fail-open cases.
// The shared prologue (the scratch repo and TMPDIR, the marker helpers, the hook runner) is ./helpers.js.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const { BASH, NO_RC, shellPath, which, linkTool } = require('../../lib/platform');
const {
  HOOK, TMP, REPO, MARKER, CAPTURE, skipWithoutDigest, markerFor, clearMarker, touchMarker,
  runHook, read, bash,
} = require('./helpers');

// The user-level capture file: a stray ~/.workkit/capture.md made by hand.
// wk.sh never writes there (outside a repo it files on the home repo), but the
// guard gates it anyway. $HOME is not a git repo, so the anchor is $HOME itself.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-home-'));
fs.mkdirSync(path.join(HOME, W), { recursive: true });
fs.writeFileSync(path.join(HOME, W, 'capture.md'), '# capture\n\n- a private thought\n');
const HOME_CAPTURE = path.join(HOME, W, 'capture.md');
const HOME_MARKER = markerFor(shellPath(HOME));
// Removed when the process ends, like the shared fixtures in ./helpers.js, so
// a skipped run leaves nothing behind either.
process.on('exit', () => fs.rmSync(HOME, { recursive: true, force: true }));

// The marker script the triage skill calls, and the skill's own line calling
// it: the test runs the LINE, so the skill and the script cannot drift apart.
// CLAUDE_PLUGIN_ROOT is handed over the way a hook command hands it over.
const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'triage-marker.sh');
const skillLine = () => {
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'triage', 'SKILL.md'), 'utf8');
  const line = skill.split('\n').find((l) => l.includes('scripts/triage-marker.sh') && l.startsWith('bash '));
  assert(line, 'the skill carries the marker line');
  return line;
};
const runSkillLine = (cwd) => spawnSync(BASH, [...NO_RC, '-c', skillLine()], {
  cwd,
  env: {
    ...process.env, HOME: shellPath(HOME), TMPDIR: shellPath(TMP), CLAUDE_PLUGIN_ROOT: shellPath(PLUGIN_ROOT),
  },
  encoding: 'utf8',
  timeout: 10000,
});

const run = async () => {
  skipWithoutDigest();

  group('capture-guard: the user-level capture file');

  // A hand-made ~/.workkit/capture.md sits in no repo, and $HOME is not a git
  // repo: keyed to a repo root alone, this file was read ungated.
  await test('reading the user capture file with no marker: exit 2', () => {
    clearMarker(HOME_MARKER);
    const { code, stderr } = read(HOME_CAPTURE);
    assertEq(code, 2, 'the user capture file is gated like any other');
    assert(stderr.includes('capture-guard'), 'names itself');
  });

  await test('reading it with a fresh $HOME-keyed marker: exit 0', () => {
    touchMarker(0, HOME_MARKER);
    const { code, stderr } = read(HOME_CAPTURE);
    assertEq(code, 0, `a triage run reads freely, got: ${stderr}`);
    clearMarker(HOME_MARKER);
  });

  await test('cat of the user capture file: blocked without the marker, open with it', () => {
    clearMarker(HOME_MARKER);
    assertEq(bash(`cat ${shellPath(HOME_CAPTURE)}`).code, 2, 'blocked with no marker');
    touchMarker(0, HOME_MARKER);
    assertEq(bash(`cat ${shellPath(HOME_CAPTURE)}`).code, 0, 'open during a triage run');
    clearMarker(HOME_MARKER);
  });

  await test('the ~/ spelling resolves to the same anchor', () => {
    const tilde = () => runHook(
      { cwd: shellPath(REPO), tool_name: 'Bash', tool_input: { command: `cat ~/${W}/capture.md` } },
      { HOME: shellPath(HOME) },
    ).code;
    clearMarker(HOME_MARKER);
    assertEq(tilde(), 2, 'the tilde form is the same file and the same gate');
    // The $HOME-keyed marker opens it, which is what proves the tilde expanded
    // (a path left unexpanded would key somewhere else and stay blocked).
    touchMarker(0, HOME_MARKER);
    assertEq(tilde(), 0, 'and the user capture file marker is the one that opens it');
    clearMarker(HOME_MARKER);
  });

  await test('the braced HOME spelling resolves like the bare one', () => {
    const forms = [`cat "$HOME/${W}/capture.md"`, `cat "\${HOME}/${W}/capture.md"`];
    const call = (c) => runHook(
      { cwd: shellPath(REPO), tool_name: 'Bash', tool_input: { command: c } },
      { HOME: shellPath(HOME) },
    );
    clearMarker(HOME_MARKER);
    for (const c of forms) {
      assertEq(call(c).code, 2, `braced or bare, the gate is the same: ${c}`);
    }
    touchMarker(0, HOME_MARKER);
    for (const c of forms) {
      const { code, stderr } = call(c);
      assertEq(code, 0, `and the user capture file marker opens both: ${c}, got: ${stderr}`);
    }
    clearMarker(HOME_MARKER);
  });

  await test("the skill's own line, run in $HOME, writes the file this hook checks", () => {
    clearMarker(HOME_MARKER);
    const res = runSkillLine(HOME);
    assertEq(res.status, 0, `the script runs outside a repo, got: ${res.stderr}`);
    assert(fs.existsSync(HOME_MARKER), 'and writes exactly the marker the hook looks for');
    assertEq(read(HOME_CAPTURE).code, 0, 'so the guard opens');
    clearMarker(HOME_MARKER);
  });

  group('capture-guard: wiring and fail-open');

  await test('hooks.json registers the guard on every tool that reaches the capture file', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    for (const matcher of ['Read', 'Grep', 'Bash', 'Edit', 'Write']) {
      const block = (wiring.hooks.PreToolUse || [])
        .find((b) => (b.matcher || '').split('|').includes(matcher));
      assert(block, `a PreToolUse ${matcher} block exists`);
      assert(block.hooks.some((h) => h.command.includes('safety:capture-guard')),
        `the ${matcher} block routes safety:capture-guard through the loader`);
    }
  });

  await test('the triage skill records the marker through the plugin script', () => {
    const skill = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'skills', 'triage', 'SKILL.md'), 'utf8');
    assert(skill.includes('scripts/triage-marker.sh'), 'the skill calls the marker script');
    assert(!skill.includes('shasum'), 'and spells no platform-bound command itself');
    assert(fs.existsSync(SCRIPT), `the script the skill names exists: ${SCRIPT}`);
  });

  await test('the same line, run inside the repo, opens the repo capture file', () => {
    clearMarker();
    assertEq(read(CAPTURE).code, 2, 'blocked with no marker');
    const res = runSkillLine(REPO);
    assertEq(res.status, 0, `the script runs inside a repo, got: ${res.stderr}`);
    assert(fs.existsSync(MARKER), 'and writes the repo-keyed marker the hook looks for');
    assertEq(read(CAPTURE).code, 0, 'so the guard opens');
    clearMarker();
  });

  await test('a machine with neither shasum nor sha1sum: exit 0, the guard fails open', () => {
    // No digest tool means no marker can be NAMED, on either side: the skill
    // cannot write one and this guard cannot look one up. That is the same
    // class as "no anchor to key on at all", and this guard fails open on its
    // own errors rather than wedging the session.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-nosha-'));
    for (const tool of ['bash', 'jq', 'git', 'dirname', 'basename', 'cat', 'grep', 'sed', 'tr', 'date', 'stat']) {
      const real = which(tool);
      if (real) linkTool(bin, real);
    }
    clearMarker();
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ cwd: shellPath(REPO), tool_name: 'Read', tool_input: { file_path: shellPath(CAPTURE) } }),
      env: { PATH: bin, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, `allowed, not wedged, got: ${res.stderr}`);
    fs.rmSync(bin, { recursive: true, force: true });
  });

  await test('a cwd outside any git repo still keys off the .workkit parent', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-bare-'));
    const bareMarker = markerFor(shellPath(bare));
    clearMarker(bareMarker);
    const call = () => spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({
        tool_name: 'Bash', cwd: shellPath(bare), tool_input: { command: `cat ${W}/capture.md` },
      }),
      env: { ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 10000,
    }).status;
    assertEq(call(), 2, 'no repo is not a way past the gate');
    touchMarker(0, bareMarker);
    assertEq(call(), 0, 'and its own marker opens it');
    clearMarker(bareMarker);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  await test('another tool, a missing input, malformed JSON: exit 0', () => {
    for (const input of [
      JSON.stringify({ tool_name: 'Glob', cwd: shellPath(REPO), tool_input: { pattern: '**/capture.md' } }),
      JSON.stringify({ tool_name: 'Read', cwd: shellPath(REPO), tool_input: {} }),
      JSON.stringify({ tool_name: 'Write', cwd: shellPath(REPO), tool_input: {} }),
      JSON.stringify({ tool_name: 'Bash', cwd: shellPath(REPO), tool_input: {} }),
      'not json',
    ]) {
      const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
        input,
        env: { ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
        encoding: 'utf8',
        timeout: 10000,
      });
      assertEq(res.status, 0, `must fail open: ${input}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
