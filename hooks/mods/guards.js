/**
 * hooks/mods/guards.js: the guard chains the hooks module runs, each an
 * ordered list of `{ hook, run }`, `run(facts)` async answering null,
 * `{ deny }` or `{ context }`, and the one runner every chain shares: the
 * gate, each guard in order, the first deny ending the chain, the notices
 * joined (docs/hooks.md § The hooks module), and the gh journal lines a Bash
 * call left. It gathers through the engine calls register.js hands it as
 * plain functions.
 */

import { captureGuardGuard } from './capture-guard.js';
import { bashFacts, guardEnv } from './facts.js';
import { rootOptedIn } from './gate.js';
import { userDirOf } from './log.js';
import {
  callStartOf, callStartPath, callStartText, journalMarkPath, journalMarkText, journalMarks, journalSizes, journalTail, journalsGrown,
} from './markers.js';
import { rootOf } from './optin.js';
import { publicMirrorGuard } from './public-mirror.js';
import { dirOf, scriptWriteGuard } from './script-write.js';
import { snapshotGuard } from './snapshot.js';
import { vendorGuardGuard } from './vendor-guard.js';

/** The Bash guards on `tool.call`. */
export const BASH_GUARDS = [
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
  { hook: 'safety:script-write', run: scriptWriteGuard },
];

/** The refusal a chain that failed before its answer leads with; the failure's kind follows. */
export const GUARDS_FAILED = 'workkit: the guards failed before they could judge this call, so it did not run: ';

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

/**
 * A gh journal's length in bytes, measured and never read: the stat's size,
 * else `wc -c`; an absent journal is 0.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {string} journal the journal's path
 * @returns {Promise<number>}
 */
export async function journalSize(io, journal) {
  const stat = await io.stat(journal);
  if (!stat) return 0;
  if (typeof stat.size === 'number') return stat.size;
  const counted = await io.run(['wc', '-c', journal]);
  return counted.exitCode === 0 ? Number.parseInt(counted.stdout.trim(), 10) || 0 : 0;
}

// A marker file written, its folder made first where it is missing; a folder
// still missing shows as the write's own throw.
async function writeMarker(io, path, text) {
  const dir = dirOf(path);
  if ((await io.stat(dir))?.kind !== 'dir') await io.run(['mkdir', '-p', dir]);
  await io.write(path, text);
}

/**
 * Before a Bash call runs: its journal mark holds every gh journal on the
 * machine and its length (journalSizes), written before any git call; then
 * its start (callStartText) holds the time taken first and its folder's repo root.
 * @param {object} io the engine calls register.js hands over (`ioOf`), its `write` one that throws on a failure
 * @param {object} env the variables the module read
 * @param {string|undefined} id the call's tool_use_id; none leaves no mark
 * @param {string} cwd the call's folder
 * @returns {Promise<void>} rejected when a mark could not be written
 */
export async function markCall(io, env, id, cwd) {
  if (!id) return;
  const home = userDirOf(env);
  const ms = await io.now();
  const [sized, mark, start] = await Promise.all([
    journalSizes(io.list, (journal) => journalSize(io, journal), home), journalMarkPath(id, home), callStartPath(id, home),
  ]);
  await writeMarker(io, mark, journalMarkText(sized));
  await writeMarker(io, start, callStartText({ ms, root: cwd ? await io.top(cwd) : null }));
}

/**
 * After it ran: the call's mark and start read and removed, and the opted-in
 * lines of each journal the call changed, oldest first (grownLines); no mark,
 * no lines, and no start, no start time.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {object} env the variables the module read
 * @param {string|undefined} id the call's tool_use_id
 * @returns {Promise<{lines: object[], since: number|null, began: string|null}>}
 */
export async function callSince(io, env, id) {
  if (!id) return { lines: [], since: null, began: null };
  const home = userDirOf(env);
  const [mark, startPath] = await Promise.all([journalMarkPath(id, home), callStartPath(id, home)]);
  const [held, started] = await Promise.all([io.read(mark), io.read(startPath)]);
  if (started !== null) await io.run(['rm', '-f', startPath]);
  const { ms, root } = started === null ? { ms: null, root: null } : callStartOf(started);
  if (held === null) return { lines: [], since: ms, began: root };
  await io.run(['rm', '-f', mark]);
  const lines = await grownLines(io, home, journalMarks(held), (journal) => journalSize(io, journal));
  return { lines, since: ms, began: root };
}

/**
 * The repo roots of a Bash call that already ran: the root it began in and
 * the root of the folder it ended in, each once; runChain keeps those that
 * opted in.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {string|null} began the root the call's mark recorded, null outside a repo
 * @param {string} ended the folder the call ended in, the event's `cwd`
 * @returns {Promise<string[]>}
 */
export async function callRoots(io, began, ended) {
  return [...new Set([began, ended ? await io.top(ended) : null].filter(Boolean))];
}

// The roots that opted in, each asked once: the after-call gate's one opt-in filter.
async function optedRoots(io, roots) {
  const opted = await Promise.all(roots.map((root) => rootOptedIn(root, io.read)));
  return roots.filter((_, i) => opted[i]);
}

/**
 * Runs one chain. Facts carrying `lines` are the Bash chain after a call: its
 * `roots` (callRoots) are cut to those that opted in, and it runs when any did
 * or when the call left a journal line (grownLines kept only opted-in ones).
 * Before a call a Bash chain is gated by its real folder's repo, a file
 * chain by `gateDir`'s (folderOpted); a guard outside it stands down. A throw ends the chain, for the handler to rethrow.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {object} env the variables the module read
 * @param {Array<{hook: string, run: function}>} guards the chain, in order
 * @param {object} facts `{ cwd, background, namesCapture }` before a Bash call, `{ cwd, lines, since, roots }` after, or a file's
 * @returns {Promise<{fires: Array<[string, string]>, deny: string|null, notice: string|null, error: *}>}
 */
export async function runChain(io, env, guards, facts) {
  const chain = { fires: [], deny: null, notice: null, error: null };
  if (guards.length === 0) return chain;
  const after = Array.isArray(facts.lines);
  const isBash = after || typeof facts.tool !== 'string';
  const roots = after ? await optedRoots(io, facts.roots ?? []) : [];
  const opted = after ? roots.length > 0 || facts.lines.length > 0 : await folderOpted(io, isBash ? facts.cwd : facts.gateDir);
  const gathered = isBash ? bashFacts(io, env, after ? { ...facts, roots } : facts) : {
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
