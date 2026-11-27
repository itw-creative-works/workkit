// Tests for standards.js: `--command-link`, the `workkit` command's link made
// alone, with no repo, no terminal and no wizard (a cloud session's bootstrap),
// and the same mode reached through its shell starter, standards.sh.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, mkTmp, run, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, joinPath, homeEnv, nodeHomeEnv, samePath, spawnBash,
} = require('../../lib/platform');
const { WORKFLOW_DIR, SCRIPT, cleanup } = require('./helpers');

const COMMAND = path.join(WORKFLOW_DIR, 'workkit.js');
const ENGINE = path.join(WORKFLOW_DIR, 'standards.js');

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

// The machine's env, each path spelled for the program it is handed to: the
// shell's spelling for a bash, native for a node, which reads HOME as given.
const machineEnv = (machine, starter) => {
  const spell = starter === 'bash' ? shellPath : (p) => p;
  return (starter === 'bash' ? homeEnv : nodeHomeEnv)(machine.home, {
    ...process.env,
    PATH: joinPath(SYSTEM_PATH, NODE_DIR),
    WORKFLOW_HOME: spell(path.join(machine.root, 'workflow-home')),
    WORKFLOW_CLAUDE_HOME: spell(machine.claude),
  });
};

// The mode as a cloud bootstrap runs it: from a folder that is no git repo,
// with stdin closed, so any prompt or wizard step would have no one to answer.
// `starter` is `node` (standards.js with the running node) or `bash` (standards.sh).
const runCommandLink = (machine, starter = 'node') => {
  const cwd = mkTmp('wf-std-');
  const env = machineEnv(machine, starter);
  const res = starter === 'node'
    ? run(process.execPath, [ENGINE, '--command-link'], { cwd, env })
    : spawnBash([...NO_RC, shellPath(SCRIPT), '--command-link'], {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
  cleanup(cwd);
  return { code: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
};

/** Whether <link> resolves to the kit's workflow/workkit.js. */
const linksCommand = (link) => samePath(fs.realpathSync(link), fs.realpathSync(COMMAND), process.platform);

describe('standards.js: --command-link', () => {
  for (const starter of ['node', 'bash']) {
    test(`links ~/.local/bin/workkit at workflow/workkit.js, outside any repo (${starter === 'node' ? 'standards.js' : 'standards.sh'})`, () => {
      const machine = mkMachine();
      const { code, output } = runCommandLink(machine, starter);
      expect(code, `exits 0, got: ${output}`).toBe(0);
      expect(fs.lstatSync(machine.link, { throwIfNoEntry: false })?.isSymbolicLink(),
        `the command is a symlink, got: ${output}`).toBeTruthy();
      expect(linksCommand(machine.link), `and it resolves to workflow/workkit.js, got: ${fs.realpathSync(machine.link)}`).toBe(true);
      cleanup(machine.root);
    });
  }

  test('a second run exits 0 and leaves the link as it was', () => {
    const machine = mkMachine();
    runCommandLink(machine);
    const first = fs.readlinkSync(machine.link);
    const { code, output } = runCommandLink(machine);
    expect(code, `the second run exits 0, got: ${output}`).toBe(0);
    expect(fs.readlinkSync(machine.link), 'the link is unchanged').toBe(first);
    cleanup(machine.root);
  });

  // A fresh cloud HOME has no ~/.local/bin at all.
  test('a HOME with no ~/.local/bin gets the folder and the link', () => {
    const machine = mkMachine({ localBin: false });
    const { code, output } = runCommandLink(machine);
    expect(code, `exits 0, got: ${output}`).toBe(0);
    expect(fs.lstatSync(machine.link, { throwIfNoEntry: false })?.isSymbolicLink(),
      `the folder is made and the command linked in it, got: ${output}`).toBeTruthy();
    expect(linksCommand(machine.link), `resolving to workflow/workkit.js, got: ${fs.realpathSync(machine.link)}`).toBe(true);
    cleanup(machine.root);
  });

  // The engine address and the gh shim have their own steps; this mode is the
  // command link alone.
  test('heals nothing else: no engine address, no gh shim', () => {
    const machine = mkMachine();
    const { code, output } = runCommandLink(machine);
    expect(code, `exits 0, got: ${output}`).toBe(0);
    expect(!fs.existsSync(path.join(machine.claude, 'workkit')),
      `no ~/.claude/workkit engine link appears, got: ${output}`).toBeTruthy();
    expect(fs.readdirSync(path.dirname(machine.link)).join(' '), 'and ~/.local/bin holds the command only').toBe('workkit');
    cleanup(machine.root);
  });
});
