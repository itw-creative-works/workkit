/**
 * hooks/mods/facts.js: the facts a Bash guard reads, built over the engine
 * calls. Apart from the guard lists, so the `gh` shim's gate and the git
 * hooks' judge build theirs without loading every guard (the write checks
 * among them).
 */

import { shellEnvOf, windowsKit } from './markers.js';
import { originless } from './optin.js';

/**
 * The variables as a guard reads them: each folder the one Git Bash means, so
 * every marker read and every machine-folder read lands where the shell wrote.
 * @param {{pluginRoot: string}} io the engine calls
 * @param {object} env the variables the module read
 * @returns {object}
 */
export const guardEnv = (io, env) => shellEnvOf(env, windowsKit(io.pluginRoot) ? 'win32' : 'posix');

/**
 * The Bash guards' facts, no command text among them: the call's folder,
 * `run_in_background`, whether the command names the capture file, and for a
 * call that already ran its gh journal lines, start time and repo roots; then
 * the variables, the reads, a scratch write, the session store and the kit's
 * folder. The gh shim's gate and the git hooks' judge build theirs here too.
 * @param {object} io the engine calls register.js hands over (`ioOf`), or the real machine's (workflow/lib/io.js)
 * @param {object} env the variables the module read
 * @param {{cwd: string, background?: boolean, lines?: object[], namesCapture?: boolean, since?: number|null, roots?: string[]}} call
 *   `lines` journalLines entries, `since` epoch ms, `roots` the opted-in roots (runChain keeps them)
 * @returns {object}
 */
export function bashFacts(io, env, { cwd, background = false, lines = [], namesCapture = false, since = null, roots = [] }) {
  let origin = null;
  return {
    cwd,
    background,
    lines,
    namesCapture,
    since,
    roots,
    env: guardEnv(io, env),
    originless: () => (origin ??= originless(cwd, io.run)),
    exists: io.exists,
    top: io.top,
    read: io.read,
    list: io.list,
    run: io.run,
    pluginRoot: io.pluginRoot,
    stat: io.stat,
    real: io.real,
    write: io.write,
    now: io.now,
    log: io.log,
    debug: io.debug,
    storeGet: io.storeGet,
    storeSet: io.storeSet,
  };
}
