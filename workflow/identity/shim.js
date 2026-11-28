/**
 * workflow/identity/shim.js: the gh shim's body, which ./gh starts. Below the
 * kit's floor a Claude session's call, but `gh auth` and one under
 * WORKKIT_IDENTITY_OFF=1, gets the floor line and 1, and any other call goes to
 * the real gh untouched; at or above it ./call.js judges and routes the call.
 * Written in syntax an older Node still reads, so the floor's line prints there.
 * Usage: require('./shim.js').main(<gh argv>, process.env).then((code) => ...)
 */

const fs = require('fs');
const path = require('path');
const floor = require('../lib/floor');

/**
 * The folder a PATH entry names, for a compare: resolved from the cwd (an
 * empty entry is the cwd), and on Windows in one letter case.
 * @param {string} dir
 * @returns {string}
 */
function dirKey(dir) {
  const resolved = path.resolve(dir || '.');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * The real gh: the first gh (on Windows gh.exe too) on PATH after the folder
 * PATH found the shim through, every folder met at or before it skipped, so
 * each hop through another shim lands further down PATH and none loops. Called
 * off PATH, the whole PATH is after it.
 * @param {string} self the shim's path as it was started, links kept
 * @param {object} env the call's variables
 * @returns {{gh: string|null, ownDir: string}} the real gh's native path, null
 *   when PATH holds none, and the shim's folder as PATH spells it (an empty
 *   entry `.`, a trailing slash dropped), its own folder off PATH
 */
function realGh(self, env) {
  const run = require('../lib/run');
  const key = run.keyOf(env, 'PATH');
  const searchPath = key === undefined ? '' : String(env[key]);
  const dirs = process.platform === 'win32' ? run.pathDirs(searchPath) : searchPath.split(path.delimiter);
  const keys = dirs.map(dirKey);
  const own = keys.indexOf(dirKey(path.dirname(self)));
  const met = new Set(keys.slice(0, own + 1));
  const after = dirs.filter((dir, i) => i > own && !met.has(keys[i]));
  const found = run.onPath('gh', { env: { PATH: after.join(path.delimiter) } });
  const spelled = own < 0 ? path.dirname(self) : dirs[own] || '.';
  return {
    gh: found === null ? null : require('../lib/platform').nativePath(found),
    ownDir: spelled.length > 1 && /[\\/]$/.test(spelled) ? spelled.slice(0, -1) : spelled,
  };
}

/**
 * Runs the real gh as the call's last step, a child on the caller's own stdin,
 * stdout and stderr, waited on as a shell waits on its foreground command
 * (childEnd): HUP and TERM passed on, INT left to the terminal that sent it to both.
 * @param {string} gh the real gh
 * @param {string[]} args its argv
 * @param {object} env its variables
 * @param {{onHeld?: function, onExit?: function}} [hooks] onHeld runs once the
 *   child's wait holds the signals, onExit once the child has ended
 * @returns {Promise<number>} its code, a signal's as 128 + its number
 */
function handOver(gh, args, env, { onHeld, onExit } = {}) {
  const run = require('../lib/run');
  const { childEnd } = require('../lib/child-end');
  // One sync run from the spawn to onHeld: no signal is handled in between, so
  // the caller's handlers give way to the wait's with no gap and no overlap.
  const child = run.spawn(gh, args, { stdio: 'inherit', env: env });
  if (onExit) child.once('exit', onExit);
  const ended = childEnd(child);
  if (onHeld) onHeld();
  return ended.then((end) => end.code);
}

// The call as main runs it, a throw left to main.
async function shimCall(argv, env) {
  const below = floor.floorLine(process.version, floor.floorOf());
  const untouched = argv[0] === 'auth' || env.WORKKIT_IDENTITY_OFF === '1' || env.CLAUDECODE !== '1';
  if (below && !untouched) {
    fs.writeSync(2, `${below}\n`);
    return 1;
  }
  const found = realGh(process.argv[1], env);
  if (found.gh === null) {
    fs.writeSync(2, `gh: no gh on PATH after the workkit shim at ${found.ownDir}/gh\n`);
    return 127;
  }
  if (below) return handOver(found.gh, argv, env);
  return require('./call').call(argv, env, found.gh);
}

/**
 * A failure the call did not answer, as one line and 1 (errorStop): a path
 * nativePath could not read is its stop line, any other names gh and the
 * reason, as does a kit whose lib/platform will not load.
 * @param {*} err
 * @returns {number} 1
 */
function failed(err) {
  const lineOf = (e) => `gh: the workkit shim failed: ${e && e.message ? e.message : String(e)}`;
  let platform;
  try {
    platform = require('../lib/platform');
  } catch (unloaded) {
    fs.writeSync(2, `${lineOf(err)}\n`);
    return 1;
  }
  return platform.errorStop(err, lineOf);
}

/**
 * One gh call through the shim; any failure is one line and 1, never a stack.
 * @param {string[]} argv gh's argv, the verb first
 * @param {object} env the call's variables
 * @returns {Promise<number>} the exit code
 */
function main(argv, env) {
  return shimCall(argv, env).catch(failed);
}

module.exports = { main, handOver };
