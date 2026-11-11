/**
 * hooks/mods/guards.js: the guard chains the hooks module runs, each an
 * ordered list of `{ hook, run }`, `run(facts)` async answering null,
 * `{ deny }` or `{ context }`, and the one runner every chain shares: the
 * gate, each guard in order, the first deny ending the chain, the notices
 * joined (docs/hooks.md § The hooks module), and the gh journal lines a Bash
 * call left. It gathers through the engine calls register.js hands it as
 * plain functions.
 */

import { bareCallGuard } from './bare-call.js';
import { captureGuardGuard } from './capture-guard.js';
import { rootOptedIn } from './gate.js';
import { journalSizes, journalTail, journalsGrown, shellEnvOf, windowsKit } from './markers.js';
import { optinRepo, originless, rootOf } from './optin.js';
import { publicMirrorGuard } from './public-mirror.js';
import { releaseTakenGuard } from './release-taken.js';
import { repoSettingsFile } from './settings.js';
import { snapshotGuard } from './snapshot.js';
import { treeGuardGuard } from './tree-guard.js';
import { vendorGuardGuard } from './vendor-guard.js';

/** The Bash guards on `tool.call`, run in the order listed here. */
export const BASH_GUARDS = [
  { hook: 'safety:release-taken', run: releaseTakenGuard },
  { hook: 'safety:tree-guard', run: treeGuardGuard },
  { hook: 'workflow:bare-call', run: bareCallGuard },
  { hook: 'safety:capture-guard', run: captureGuardGuard },
];

/** The guards on `tool.call` for Edit and Write. */
export const FILE_GUARDS = [
  { hook: 'safety:vendor-guard', run: vendorGuardGuard },
  { hook: 'safety:capture-guard', run: captureGuardGuard },
];

/** The guards on `tool.call` for Read and Grep. */
export const READ_GUARDS = [
  { hook: 'safety:capture-guard', run: captureGuardGuard },
];

/** The hooks on `classic.PostToolUse` and `classic.PostToolUseFailure` for Bash; they never block. */
export const POST_BASH_GUARDS = [
  { hook: 'workflow:snapshot', run: snapshotGuard },
  { hook: 'workflow:public-mirror', run: publicMirrorGuard },
];

/** The refusal a chain that failed before its answer leads with; the failure's kind follows. */
export const GUARDS_FAILED = 'workkit: the guards failed before they could judge this call, so it did not run: ';

// The opt-in gate for a Bash command (optin.js), its reads made through io.
async function bashOpted(io, { command, cwd }) {
  const { opted } = await optinRepo({
    command,
    cwd,
    toplevel: io.top,
    settingsText: (root) => io.read(repoSettingsFile(root)),
    exists: io.exists,
  });
  return opted;
}

/**
 * The opt-in gate for a folder: the repo holding it, climbed to the nearest
 * folder that exists for a path not made yet (rootOf), judged by
 * rootOptedIn. The file chains and every other handler gate through it.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {string|undefined} dir the folder; none is a no
 * @returns {Promise<boolean>}
 */
export async function folderOpted(io, dir) {
  if (!dir) return false;
  const root = await rootOf(dir, io.top, io.exists);
  return root !== null && (await rootOptedIn(root, io.read));
}

/**
 * The gh journal lines a Bash call left, from the journal folder alone: each
 * journal the call changed (journalsGrown) read from the offset it answers,
 * the lines oldest first by `ms`, ties in read order. A line is kept when the
 * repo holding its `cwd` opted in (folderOpted, each folder asked once), or
 * when it has no `cwd`.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @param {{journal: string, bytes: number}[]} marks the call's mark (journalMarks)
 * @param {function} size async, a journal's length in bytes
 * @returns {Promise<object[]>} journalLines entries
 */
export async function grownLines(io, home, marks, size) {
  const now = await journalSizes(io.list, size, home);
  const reads = await Promise.all(journalsGrown(marks, now).map(({ journal, bytes }) => journalTail(io.run, journal, bytes)));
  const lines = reads.flat().sort((a, b) => a.ms - b.ms);
  const asked = new Map();
  const optedAt = (dir) => {
    if (!asked.has(dir)) asked.set(dir, folderOpted(io, dir));
    return asked.get(dir);
  };
  const keep = await Promise.all(lines.map((line) => !line.cwd || optedAt(line.cwd)));
  return lines.filter((_, i) => keep[i]);
}

// The variables as a guard reads them: each folder the one Git Bash means, so
// every marker read and every machine-folder read lands where the shell wrote.
const guardEnv = (io, env) => shellEnvOf(env, windowsKit(io.pluginRoot) ? 'win32' : 'posix');

/**
 * The Bash guards' facts: the command and its folder, the gh journal lines
 * the call left, the variables, the reads, a scratch write and the kit's
 * folder; the origin is asked once, and only by a guard that needs it. The gh
 * shim's gate and the git hooks' judge build theirs here too.
 * @param {object} io the engine calls register.js hands over (`ioOf`), or the real machine's (workflow/lib/io.js)
 * @param {object} env the variables the module read
 * @param {{command?: string, cwd: string, lines?: object[]}} call the command, none after the call ran, its
 *   folder, and the journal lines (journalLines in markers.js) a call that already ran wrote, none before it runs
 * @returns {object}
 */
export function bashFacts(io, env, { command, cwd, lines = [] }) {
  let origin = null;
  return {
    command,
    cwd,
    lines,
    env: guardEnv(io, env),
    originless: () => (origin ??= originless(cwd, io.run)),
    exists: (rel) => io.exists(`${cwd}/${rel}`),
    top: io.top,
    read: io.read,
    list: io.list,
    run: io.run,
    pluginRoot: io.pluginRoot,
    stat: io.stat,
    real: io.real,
    write: io.write,
    now: io.now,
  };
}

/**
 * Runs one chain. Facts carrying `lines` are the Bash chain after a call: they
 * get bashFacts and no gate, since grownLines kept only opted-in lines. Before
 * a call, a Bash chain is gated by optinRepo, a file chain by `facts.gateDir`'s
 * repo (rootOf); a guard outside it stands down. A throw ends the chain, for the handler to rethrow.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {object} env the variables the module read
 * @param {Array<{hook: string, run: function}>} guards the chain, in order
 * @param {object} facts `{ command, cwd }` before a Bash call, `{ cwd, lines }` after it, `{ tool, input, cwd, file, typed, dir, gateDir }` for a file
 * @returns {Promise<{fires: Array<[string, string]>, deny: string|null, notice: string|null, error: *}>}
 *   each fire's hook and verdict for the hooks log, the first deny, the notices as one entry, a throw
 */
export async function runChain(io, env, guards, facts) {
  const chain = { fires: [], deny: null, notice: null, error: null };
  if (guards.length === 0) return chain;
  const after = Array.isArray(facts.lines);
  const isBash = after || typeof facts.command === 'string';
  const opted = after || (isBash ? await bashOpted(io, facts) : await folderOpted(io, facts.gateDir));
  const gathered = isBash ? bashFacts(io, env, facts) : {
    ...facts, env: guardEnv(io, env), read: io.read, run: io.run, top: io.top, stat: io.stat, now: io.now, pluginRoot: io.pluginRoot,
  };
  const notices = [];
  for (const { hook, run } of guards) {
    if (!opted) {
      chain.fires.push([hook, 'stood-down']);
      continue;
    }
    let verdict;
    try {
      verdict = await run(gathered);
    } catch (error) {
      chain.fires.push([hook, 'crashed']);
      return { ...chain, error };
    }
    chain.fires.push([hook, 'run']);
    if (verdict?.deny) return { ...chain, deny: verdict.deny };
    if (verdict?.context) notices.push(verdict.context);
  }
  return { ...chain, notice: notices.length > 0 ? notices.join('\n') : null };
}
