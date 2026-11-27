// Tests for workflow/workkit.cmd, the Windows command file: renderCmd of
// workflow/workkit/links.js filling the tracked template, the copy the machine
// steps setup and update write beside the `~/.local/bin/workkit` link, and the
// doctor's lines for it and for the PATH. Each Windows half is reached through
// the system argument. The shared prologue is ./workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../lib/harness');
const { gitPath } = require('../lib/platform');
const {
  WORKFLOW_DIR, cleanup, mkWorld, inNode, npmrcEnv, machineLinks, windowsForm, lines,
} = require('./workkit-cli/helpers');

/** The doctor, called in a node of its own, as a Windows machine runs it; `env` over the world's. */
const doctorOnWindows = (world, env = {}) => inNode(world, {
  file: 'workkit/doctor.js', fn: 'doctor', kit: { platform: 'win32' }, env: { ...npmrcEnv(world), ...env },
});

describe('workkit.cmd: the Windows command file', () => {
  test('renderCmd fills the tracked template with the engine address, as one line', () => {
    const { renderCmd } = require(path.join(WORKFLOW_DIR, 'workkit', 'links.js'));
    const template = fs.readFileSync(path.join(WORKFLOW_DIR, 'workkit.cmd'), 'utf8');
    const text = renderCmd(template, { engine: 'C:\\Users\\a b\\.claude\\workkit' });
    expect(text.replace(/\r?\n$/, ''), 'the line cmd runs, the address quoted whole').toBe('@node "C:\\Users\\a b\\.claude\\workkit\\workkit.js" %*');
  });

  test('on Windows the machine steps write it beside the link, CRLF, and rewrite it only for another engine address', () => {
    const world = mkWorld({ binOnPath: true });
    const cmd = path.join(world.localBin, 'workkit.cmd');
    const lineFor = (claudeHome) => `@node "${windowsForm(path.join(claudeHome, 'workkit'))}\\workkit.js" %*\r\n`;

    const first = machineLinks(world, { kit: { platform: 'win32' } });
    expect(first.code, `exit 0, got: ${first.said}`).toBe(0);
    expect(fs.existsSync(cmd) && fs.readFileSync(cmd, 'utf8'), `the file names the engine address, CRLF, got: ${first.said}`).toBe(lineFor(world.claudeHome));

    // Dated an hour back, so a rewrite of the same text shows in the time.
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(cmd, past, past);
    const before = fs.statSync(cmd).mtimeMs;
    const second = machineLinks(world, { kit: { platform: 'win32' } });
    expect(second.code, `exit 0, got: ${second.said}`).toBe(0);
    expect(fs.statSync(cmd).mtimeMs, `a second run leaves the file untouched, got: ${second.said}`).toBe(before);
    expect(fs.readFileSync(cmd, 'utf8'), 'its text as it was').toBe(lineFor(world.claudeHome));

    const other = path.join(world.root, 'other-claude');
    const moved = machineLinks(world, { kit: { platform: 'win32' }, env: { WORKFLOW_CLAUDE_HOME: other } });
    expect(moved.code, `exit 0, got: ${moved.said}`).toBe(0);
    expect(fs.readFileSync(cmd, 'utf8'), `another engine address rewrites it, got: ${moved.said}`).toBe(lineFor(other));
    cleanup(world.root);
  });

  test('on a Mac and on Linux the machine steps write no workkit.cmd', () => {
    for (const platform of ['darwin', 'linux']) {
      const world = mkWorld({ binOnPath: true });
      const res = machineLinks(world, { kit: { platform } });
      expect(res.code, `${platform}: exit 0, got: ${res.said}`).toBe(0);
      expect(fs.existsSync(world.link), `${platform}: the steps ran past the command link, got: ${res.said}`).toBe(true);
      expect(fs.existsSync(path.join(world.localBin, 'workkit.cmd')), `${platform}: and wrote no workkit.cmd, got: ${res.said}`).toBe(false);
      cleanup(world.root);
    }
  });
});

describe('workkit doctor on Windows: workkit.cmd and the PATH', () => {
  test('a missing or a different workkit.cmd gives its line, and a current one none', () => {
    const world = mkWorld({ binOnPath: true });
    const cmd = path.join(world.localBin, 'workkit.cmd');
    const line = `⚠ command: ${gitPath(cmd)} is missing or differs; run \`workkit update\``;
    const made = machineLinks(world, { kit: { platform: 'win32' } });
    expect(fs.existsSync(cmd), `the steps wrote the file to begin with, got: ${made.said}`).toBe(true);

    const current = doctorOnWindows(world);
    expect(lines(current.said).includes(line), `a current file is not named, got: ${current.said}`).toBe(false);

    fs.writeFileSync(cmd, '@node "C:\\elsewhere\\workkit.js" %*\r\n');
    const differs = doctorOnWindows(world);
    expect(lines(differs.said).includes(line), `a different file is named, got: ${differs.said}`).toBe(true);

    fs.rmSync(cmd);
    const missing = doctorOnWindows(world);
    expect(lines(missing.said).includes(line), `a missing file is named, got: ${missing.said}`).toBe(true);
    cleanup(world.root);
  });

  test('a PATH without ~/.local/bin gives the PATH line, naming the folder in its Windows form', () => {
    const pathLine = (said, world) => lines(said).find((l) => l.startsWith('⚠ command:') && l.includes(windowsForm(world.localBin)) && l.includes('PATH'));
    // The PATH as Windows spells it: `;` between the folders, each in its Windows form.
    const windowsPATH = (world) => world.env.PATH.split(path.delimiter).map(windowsForm).join(';');
    for (const binOnPath of [false, true]) {
      const world = mkWorld({ binOnPath });
      machineLinks(world, { kit: { platform: 'win32' } });
      const { said } = doctorOnWindows(world, { PATH: windowsPATH(world) });
      expect(Boolean(pathLine(said, world)), `~/.local/bin ${binOnPath ? 'on' : 'off'} the PATH: the PATH line ${binOnPath ? 'is not' : 'is'} given, got: ${said}`).toBe(!binOnPath);
      cleanup(world.root);
    }
  });
});
