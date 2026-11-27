/**
 * workflow/workkit/pty.js: a command run under a pseudo-terminal, its screen
 * on the caller's streams and appended to a capture file: `expect` on
 * mint-pty.exp at a terminal (it catches Ctrl-C), else `script` in its GNU or
 * BSD form. The token mint (workkit/secrets.js) is its one caller.
 * Usage: const { runUnderPty } = require('./pty');
 */

const fs = require('fs');
const { onPath, spawn, spawnSync } = require('../lib/run');
const { startFailed } = require('../lib/detach');
const { childEnd } = require('../lib/child-end');

/** The program and arguments the pty takes <command> under: expect at a terminal, else GNU or BSD `script`. */
const ptyLaunch = (kit, command, capture) => {
  const joined = command.join(' ');
  // stdin itself, never kit.interactive: expect needs the real terminal under it.
  if (onPath('expect', { env: kit.env }) && process.stdin.isTTY && fs.existsSync(kit.files.ptyScript)) {
    return { program: 'expect', args: [kit.files.ptyScript], env: { ...kit.env, WK_PTY_CAPTURE: capture, WK_PTY_CMD: joined } };
  }
  // A `script` that answers --version is GNU's, which takes the command as one string.
  if (spawnSync('script', ['--version'], { stdio: 'ignore', env: kit.env, windowsHide: true }).status === 0) {
    return { program: 'script', args: ['-q', '-e', '-c', joined, capture], env: kit.env };
  }
  return { program: 'script', args: ['-q', '-e', capture, ...command], env: kit.env };
};

/**
 * <command> under a pty, its screen on <stdio> and appended to
 * <capture>. Its words reach expect and GNU `script` joined by one space, and
 * BSD `script` one by one.
 * @param {object} kit
 * @param {string[]} command the program and its arguments
 * @param {string} capture the file the screen is appended to
 * @param {{stdout: ('inherit'|number), stderr: ('inherit'|number)}} stdio the two streams secretStep hands over
 * @returns {Promise<number>} the program's code, 130 for a Ctrl-C under expect, 127 when the pty program is missing
 */
const runUnderPty = async (kit, command, capture, stdio) => {
  const { program, args, env } = ptyLaunch(kit, command, capture);
  const child = spawn(program, args, { stdio: ['inherit', stdio.stdout, stdio.stderr], env, windowsHide: true });
  try {
    return (await childEnd(child)).code;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return startFailed;
  }
};

module.exports = { runUnderPty };
