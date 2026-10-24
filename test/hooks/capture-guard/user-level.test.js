// Tests for safety:capture-guard's logic on the user-level capture file, the
// triage skill's marker line against the module's marker path, and the
// fail-open cases. Each case ports the HEAD case its name quotes. The keying
// of the ~/ and $HOME spellings, and "a cwd outside any git repo still keys
// off the .workkit parent", are the wiring's, in test/mods/guards-capture-guard.test.ts.
// Dropped with the shell spawn: "hooks.json registers the guard on every tool",
// "a machine with neither shasum nor sha1sum" (crypto.subtle) and malformed JSON.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, WORKKIT_DIR: W, selfRun,
} = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { mods } = require('../../lib/mods-inputs');
const {
  HOME_CAPTURE, FRESH, READ, judge, read, bash, refuses, allows,
} = require('./helpers');
const { SPAWN_DEADLINE } = require('../../lib/process');

// The marker script the triage skill calls, and the skill's own line calling
// it: the test runs the line, so the skill and the module's marker path cannot
// drift apart. CLAUDE_PLUGIN_ROOT is handed over the way a hook hands it over.
const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');
const SKILL = path.join(PLUGIN_ROOT, 'skills', 'triage', 'SKILL.md');
const skillLine = () => {
  const line = fs.readFileSync(SKILL, 'utf8').split('\n').find((l) => l.includes('scripts/triage-marker.sh') && l.startsWith('bash '));
  assert(line, 'the skill carries the marker line');
  return line;
};

const TMP = mkTmp('capture-guard-tmp-');
const SCRATCH_HOME = mkTmp('capture-guard-home-');
const runSkillLine = (cwd) => spawnSync(BASH, [...NO_RC, '-c', skillLine()], {
  cwd,
  env: {
    ...process.env, HOME: shellPath(SCRATCH_HOME), TMPDIR: shellPath(TMP), CLAUDE_PLUGIN_ROOT: shellPath(PLUGIN_ROOT),
  },
  encoding: 'utf8',
  timeout: SPAWN_DEADLINE,
});
const markerOf = (anchor) => mods('markers').triageMarkerPath(anchor, TMP);

const run = async () => {
  group('capture-guard: the user-level capture file');

  await test('ports "reading the user capture file with no marker: exit 2"', async () => {
    await refuses(read(HOME_CAPTURE), READ, 'the user capture file is gated like any other');
  });

  await test('ports "reading it with a fresh $HOME-keyed marker: exit 0"', async () => {
    await allows(read(HOME_CAPTURE, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  await test('ports "cat of the user capture file: blocked without the marker, open with it"', async () => {
    await refuses(bash(`cat ${HOME_CAPTURE}`), READ, 'blocked with no marker');
    await allows(bash(`cat ${HOME_CAPTURE}`, { markerAgeS: FRESH }), 'open during a triage run');
  });

  await test('ports "the ~/ spelling resolves to the same anchor": the same gate', async () => {
    await refuses(bash(`cat ~/${W}/capture.md`), READ, 'the tilde form is the same file and the same gate');
    await allows(bash(`cat ~/${W}/capture.md`, { markerAgeS: FRESH }), 'and a marker opens it');
  });

  await test('ports "the braced HOME spelling resolves like the bare one": the same gate', async () => {
    for (const c of [`cat "$HOME/${W}/capture.md"`, `cat "\${HOME}/${W}/capture.md"`]) {
      await refuses(bash(c), READ, `braced or bare, the gate is the same: ${c}`);
      await allows(bash(c, { markerAgeS: FRESH }), `and a marker opens both: ${c}`);
    }
  });

  await test('ports "the skill\'s own line, run in $HOME, writes the file this hook checks"', async () => {
    const res = runSkillLine(SCRATCH_HOME);
    assertEq(res.status, 0, `the script runs outside a repo, got: ${res.stderr}`);
    const marker = await markerOf(shellPath(SCRATCH_HOME));
    assert(fs.existsSync(marker), `and writes exactly the marker the module names: ${marker}`);
  });

  group('capture-guard: the skill and fail-open');

  await test('ports "the same line, run inside the repo, opens the repo capture file"', async () => {
    const repo = mkTmp('capture-guard-repo-');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const res = runSkillLine(repo);
    assertEq(res.status, 0, `the script runs inside a repo, got: ${res.stderr}`);
    const marker = await markerOf(root);
    assert(fs.existsSync(marker), `and writes the repo-keyed marker the module names: ${marker}`);
  });

  await test('ports "another tool, a missing input, malformed JSON: exit 0": another tool and a missing input', async () => {
    await allows(judge('Glob', { pattern: '**/capture.md' }), 'Glob');
    await allows(judge('Read', {}), 'Read with no file_path');
    await allows(judge('Write', {}), 'Write with no file_path');
    await allows(judge('Bash', {}), 'Bash with no command');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
