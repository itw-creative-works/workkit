// Tests for standards.sh: `--command-link`, the `workkit` command's link made
// alone, with no repo, no terminal and no wizard (a cloud session's bootstrap).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, joinPath, homeEnv,
} = require('../../lib/platform');
const { WORKFLOW_DIR, SCRIPT, cleanup } = require('./helpers');

const COMMAND = path.join(WORKFLOW_DIR, 'workkit.sh');

// A scratch machine: HOME (where ~/.local/bin is read from) with a ~/.claude,
// so a stray engine-link step would have somewhere to write.
const mkMachine = ({ localBin = true } = {}) => {
  const root = mkTmp('wf-std-');
  const home = path.join(root, 'home');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  if (localBin) fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  return { root, home, claude, link: path.join(home, '.local', 'bin', 'workkit') };
};

// The mode as a cloud bootstrap runs it: from a folder that is no git repo,
// with stdin closed, so any prompt or wizard step would have no one to answer.
const runCommandLink = (machine) => {
  const cwd = mkTmp('wf-std-');
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), '--command-link'], {
    cwd,
    env: homeEnv(machine.home, {
      ...process.env,
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(path.join(machine.root, 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(machine.claude),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  cleanup(cwd);
  return { code: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
};

const cases = async () => {
  group('standards.sh: --command-link');

  await test('links ~/.local/bin/workkit at the kit command, outside any repo', () => {
    const machine = mkMachine();
    const { code, output } = runCommandLink(machine);
    assertEq(code, 0, `exits 0, got: ${output}`);
    assert(fs.lstatSync(machine.link, { throwIfNoEntry: false })?.isSymbolicLink(),
      `the command is a symlink, got: ${output}`);
    assertEq(fs.realpathSync(machine.link), fs.realpathSync(COMMAND), 'and it resolves to workflow/workkit.sh');
    cleanup(machine.root);
  });

  await test('a second run exits 0 and leaves the link as it was', () => {
    const machine = mkMachine();
    runCommandLink(machine);
    const first = fs.readlinkSync(machine.link);
    const { code, output } = runCommandLink(machine);
    assertEq(code, 0, `the second run exits 0, got: ${output}`);
    assertEq(fs.readlinkSync(machine.link), first, 'the link is unchanged');
    cleanup(machine.root);
  });

  // A fresh cloud HOME has no ~/.local/bin at all.
  await test('a HOME with no ~/.local/bin gets the folder and the link', () => {
    const machine = mkMachine({ localBin: false });
    const { code, output } = runCommandLink(machine);
    assertEq(code, 0, `exits 0, got: ${output}`);
    assert(fs.lstatSync(machine.link, { throwIfNoEntry: false })?.isSymbolicLink(),
      `the folder is made and the command linked in it, got: ${output}`);
    assertEq(fs.realpathSync(machine.link), fs.realpathSync(COMMAND), 'resolving to workflow/workkit.sh');
    cleanup(machine.root);
  });

  // The engine address and the gh shim have their own steps; this mode is the
  // command link alone.
  await test('heals nothing else: no engine address, no gh shim', () => {
    const machine = mkMachine();
    const { code, output } = runCommandLink(machine);
    assertEq(code, 0, `exits 0, got: ${output}`);
    assert(!fs.existsSync(path.join(machine.claude, 'workkit')),
      `no ~/.claude/workkit engine link appears, got: ${output}`);
    assertEq(fs.readdirSync(path.dirname(machine.link)).join(' '), 'workkit', 'and ~/.local/bin holds the command only');
    cleanup(machine.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
