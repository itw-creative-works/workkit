// Tests for safety:capture-guard's logic on the user-level capture file, the triage skill's
// marker line against the module's marker path, and the fail-open cases. The Bash half, which
// is handed only whether the command names the capture file, is ./bash-path.test.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  NO_RC, shellPath, joinPath, spawnBash, nodeEnv, samePath,
} = require('../../lib/platform');
const { workkitBin } = require('../../lib/workkit-bin');
const { mods } = require('../../lib/mods-inputs');
const { ioIn } = require('../../../workflow/lib/io');
const {
  HOME_CAPTURE, FRESH, READ, judge, read, refuses, allows,
} = require('./helpers');

// The triage skill's own marker line, run with the kit's `workkit` on PATH:
// the skill, the verb and the module's marker path cannot drift apart.
const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');
const SKILL = path.join(PLUGIN_ROOT, 'skills', 'triage', 'SKILL.md');
const skillLine = () => {
  const line = fs.readFileSync(SKILL, 'utf8').split('\n').find((l) => l.startsWith('workkit triage mark'));
  expect(line, 'the skill carries the marker line').toBeTruthy();
  return line;
};

const TMP = mkTmp('capture-guard-tmp-');
const SCRATCH_HOME = mkTmp('capture-guard-home-');
const SCRATCH_WH = path.join(SCRATCH_HOME, '.workkit');
const BIN = workkitBin();
// The session's variables, the skill's shell and the guard alike reading them.
const ENV = {
  ...process.env, ...nodeEnv, HOME: shellPath(SCRATCH_HOME), WORKFLOW_HOME: shellPath(SCRATCH_WH), TMPDIR: shellPath(TMP), PATH: joinPath(BIN, process.env.PATH),
};
const runSkillLine = (cwd) => spawnBash([...NO_RC, '-c', skillLine()], {
  cwd, env: ENV, encoding: 'utf8', timeout: SPAWN_DEADLINE,
});
const markerOf = (anchor) => mods('markers').triageMarkerPath(anchor, SCRATCH_WH);

// safety:capture-guard on a Read of ~/.workkit/capture.md in $HOME, its facts built over the
// real machine as the file chain builds them; each path it stats lands in `statted`.
const guardHomeRead = (statted) => {
  const io = ioIn(ENV);
  return mods('capture-guard').captureGuardGuard({
    tool: 'Read',
    input: { file_path: '~/.workkit/capture.md' },
    cwd: SCRATCH_HOME,
    env: mods('facts').guardEnv(io, ENV),
    read: io.read,
    run: io.run,
    top: io.top,
    now: io.now,
    pluginRoot: io.pluginRoot,
    stat: (p) => { statted.push(p); return io.stat(p); },
  });
};

// The verb prints the one marker it wrote, in either spelling of the platform.
const printsMarker = (res, marker) => expect(samePath(res.stdout.replace(/\n$/, ''), marker, process.platform),
  `and prints that marker's path alone: ${marker}, got: ${res.stdout}`).toBeTruthy();

describe('capture-guard: the user-level capture file', () => {
  test('reading the user capture file with no marker: exit 2', async () => {
    await refuses(read(HOME_CAPTURE), READ, 'the user capture file is gated like any other');
  });

  test('reading it with a fresh $HOME-keyed marker: exit 0', async () => {
    await allows(read(HOME_CAPTURE, { markerAgeS: FRESH }), 'a triage run reads freely');
  });

  test('the skill\'s own line, run in $HOME, lets the guard through, and prints the file the guard reads', async () => {
    await refuses(guardHomeRead([]), READ, 'the home capture file before the line runs');
    const res = runSkillLine(SCRATCH_HOME);
    expect(res.status, `the verb runs outside a repo, got: ${res.stderr}`).toBe(0);
    const statted = [];
    await allows(guardHomeRead(statted), 'the home capture file once the line ran');
    const printed = res.stdout.replace(/\n$/, '');
    expect(statted.some((p) => samePath(p, printed, process.platform)),
      `the guard reads the marker the verb printed: ${printed}, it read: ${statted.join(', ')}`).toBeTruthy();
  });
});

describe('capture-guard: the skill and fail-open', () => {
  test('the same line, run inside the repo, opens the repo capture file and prints its marker', async () => {
    const repo = mkTmp('capture-guard-repo-');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const res = runSkillLine(repo);
    expect(res.status, `the verb runs inside a repo, got: ${res.stderr}`).toBe(0);
    const marker = await markerOf(root);
    expect(fs.existsSync(marker), `and writes the repo-keyed marker the module names: ${marker}`).toBeTruthy();
    printsMarker(res, marker);
  });

  test('another tool, a missing input, or an input that is not an object: exit 0', async () => {
    await allows(judge('Glob', { pattern: '**/capture.md' }), 'Glob');
    await allows(judge('Read', {}), 'Read with no file_path');
    await allows(judge('Write', {}), 'Write with no file_path');
    await allows(judge('Bash', {}), 'Bash with no command');
    await allows(judge('Read', null), 'Read with a null input');
    await allows(judge('Edit', 'capture.md'), 'Edit with a string for an input');
    await allows(judge('Grep', [HOME_CAPTURE]), 'Grep with an array for an input');
  });
});
