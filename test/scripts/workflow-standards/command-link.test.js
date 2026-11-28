// Tests for standards.js: `--command-link`, the `workkit` command's link made
// alone, with no repo, no terminal and no wizard (a cloud session's bootstrap).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, mkTmp,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, shellPath, joinPath, nodeHomeEnv, samePath,
} = require('../../lib/platform');
const { WORKFLOW_DIR, cleanup, heal } = require('./helpers');

const COMMAND = path.join(WORKFLOW_DIR, 'workkit.js');

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

// The machine's env, each path native, as the node it is handed to reads it.
const machineEnv = (machine) => nodeHomeEnv(machine.home, {
  ...process.env,
  PATH: joinPath(SYSTEM_PATH, NODE_DIR),
  WORKFLOW_HOME: path.join(machine.root, 'workflow-home'),
  WORKFLOW_CLAUDE_HOME: machine.claude,
});

// The mode as a cloud bootstrap runs it: from a folder that is no git repo,
// with stdin closed, so any prompt or wizard step would have no one to answer.
// `over` is laid over the machine's env last.
const runCommandLink = (machine, over = {}) => {
  const cwd = mkTmp('wf-std-');
  const env = { ...machineEnv(machine), ...over };
  const res = heal(['--command-link'], env, { cwd });
  cleanup(cwd);
  const out = res.stdout || '';
  const err = res.stderr || '';
  return { code: res.status, out, err, output: `${out}${err}` };
};

/** Whether <link> resolves to the kit's workflow/workkit.js. */
const linksCommand = (link) => samePath(fs.realpathSync(link), fs.realpathSync(COMMAND), process.platform);

describe('standards.js: --command-link', () => {
  test('links ~/.local/bin/workkit at workflow/workkit.js, outside any repo', () => {
    const machine = mkMachine();
    const { code, output } = runCommandLink(machine);
    expect(code, `exits 0, got: ${output}`).toBe(0);
    expect(fs.lstatSync(machine.link, { throwIfNoEntry: false })?.isSymbolicLink(),
      `the command is a symlink, got: ${output}`).toBeTruthy();
    expect(linksCommand(machine.link), `and it resolves to workflow/workkit.js, got: ${fs.realpathSync(machine.link)}`).toBe(true);
    cleanup(machine.root);
  });

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

describe('standards.js --command-link: a HOME no cygpath can read', () => {
  // The mode reads HOME through kitOf before any repo or git. PATH is node's
  // folder alone: Git's usr/bin, where cygpath lives, is left off.
  test('a HOME in the shell\'s spelling with no cygpath on PATH: the one line naming HOME and the fix, exit 1, no stack', {
    skip: !IS_WINDOWS && 'off Windows a home is never handed to cygpath',
  }, () => {
    const machine = mkMachine();
    const home = shellPath(machine.home);
    const { code, out, err } = runCommandLink(machine, { HOME: home, PATH: NODE_DIR });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(err, 'the one line').toBe(`workkit: cannot read HOME (${home}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(err), `no stack line, got: ${err}`).toBe(false);
    cleanup(machine.root);
  });
});

describe('standards.js: a WORKFLOW_HOME no cygpath can read', () => {
  // --engine-link builds the heal's run, whose machine folder is user-dir.js's
  // read, before any repo. PATH is node's folder alone, so no cygpath starts.
  test('a WORKFLOW_HOME in the shell\'s spelling with no cygpath on PATH: the one line naming WORKFLOW_HOME and the fix, exit 1, no stack', {
    skip: !IS_WINDOWS && 'off Windows a machine folder is never handed to cygpath',
  }, () => {
    const machine = mkMachine();
    const folder = shellPath(path.join(machine.root, 'workflow-home'));
    const cwd = mkTmp('wf-std-');
    const res = heal(['--engine-link'], { ...machineEnv(machine), WORKFLOW_HOME: folder, PATH: NODE_DIR }, { cwd });
    cleanup(cwd);
    const out = res.stdout || '';
    const err = res.stderr || '';
    expect(res.status, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(err, 'the one line').toBe(`workkit: cannot read WORKFLOW_HOME (${folder}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set WORKFLOW_HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(err), `no stack line, got: ${err}`).toBe(false);
    cleanup(machine.root);
  });
});
