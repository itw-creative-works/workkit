/**
 * hooks/mods/guards.js: the guard chains the hooks module runs, each an
 * ordered list of `{ hook, run }`, `run(facts)` async answering null,
 * `{ deny }` or `{ context }`, and the one runner every chain shares: the
 * gate, each guard in order, the first deny ending the chain, the notices
 * joined (docs/hooks.md § The hooks module). It gathers through the engine
 * calls register.js hands it as plain functions.
 */

import { captureGuardGuard } from './capture-guard.js';
import { originless, repoSlug } from './command.js';
import { commitGateGuard } from './commit-gate.js';
import { commitLanguageGuard } from './commit-language.js';
import { findingsGuardGuard } from './findings-guard.js';
import { settingsOptedIn } from './gate.js';
import { issueGuardGuard } from './issue-guard.js';
import { shellEnvOf, windowsKit } from './markers.js';
import { isOptinExempt, optinRepo, rootOf, rosterOf } from './optin.js';
import { proofGuardGuard } from './proof-guard.js';
import { releaseTakenGuard } from './release-taken.js';
import { snapshotGuard } from './snapshot.js';
import { specGuardGuard } from './spec-guard.js';
import { suiteGuardGuard } from './suite-guard.js';
import { treeGuardGuard } from './tree-guard.js';
import { vendorGuardGuard } from './vendor-guard.js';

/** The Bash guards on `tool.call`, run in the order listed here. */
export const BASH_GUARDS = [
  { hook: 'safety:commit-gate', run: commitGateGuard },
  { hook: 'safety:commit-language', run: commitLanguageGuard },
  { hook: 'safety:release-taken', run: releaseTakenGuard },
  { hook: 'safety:tree-guard', run: treeGuardGuard },
  { hook: 'safety:issue-guard', run: issueGuardGuard },
  { hook: 'safety:proof-guard', run: proofGuardGuard },
  { hook: 'safety:spec-guard', run: specGuardGuard },
  { hook: 'safety:suite-guard', run: suiteGuardGuard },
  { hook: 'safety:capture-guard', run: captureGuardGuard },
  { hook: 'safety:findings-guard', run: findingsGuardGuard },
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
];

/** The refusal a chain that failed before its answer leads with; the failure's kind follows. */
export const GUARDS_FAILED = 'workkit: the guards failed before they could judge this call, so it did not run: ';

// The opt-in gate for a Bash command (optin.js), its reads made through io.
async function bashOpted(io, env, { command, cwd }) {
  const { opted } = await optinRepo({
    command,
    cwd,
    roster: await rosterOf(env, io.read),
    toplevel: io.top,
    settingsOf: (root) => io.read(`${root}/.workkit/settings.json`),
    slugOf: (dir) => repoSlug(dir, io.run),
    exists: io.exists,
  });
  return opted;
}

/**
 * The opt-in gate for a folder: the repo holding it, climbed to the nearest
 * folder that exists for a path not made yet (rootOf), judged by
 * settingsOptedIn. The file chains and every other handler gate through it.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {string|undefined} dir the folder; none is a no
 * @returns {Promise<boolean>}
 */
export async function folderOpted(io, dir) {
  if (!dir) return false;
  const root = await rootOf(dir, io.top, io.exists);
  return root !== null && settingsOptedIn(await io.read(`${root}/.workkit/settings.json`));
}

// The variables as a guard reads them: each folder the one Git Bash means, so
// every marker read and every machine-folder read lands where the shell wrote.
const guardEnv = (io, env) => shellEnvOf(env, windowsKit(io.pluginRoot) ? 'win32' : 'posix');

/**
 * The Bash guards' facts: the command and its folder, the variables, the
 * reads, a scratch write and the kit's folder; the origin is asked once, and
 * only by a guard that needs it.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {object} env the variables the module read
 * @param {{command: string, cwd: string, failed?: boolean}} call the command, its folder, and whether
 *   the call already ran and failed (a `classic.PostToolUseFailure`)
 * @returns {object}
 */
export function bashFacts(io, env, { command, cwd, failed = false }) {
  let origin = null;
  return {
    command,
    cwd,
    failed,
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
 * Runs one chain over its facts: a Bash chain (facts carrying `command`) is
 * gated by optinRepo, a file chain by the repo holding `facts.gateDir`, climbed
 * to the nearest folder that exists. A guard
 * outside an opted-in repo stands down unless it is exempt; a guard that
 * throws ends the chain with the error, for the handler to rethrow.
 * @param {object} io the engine calls register.js hands over (`ioOf`)
 * @param {object} env the variables the module read
 * @param {Array<{hook: string, run: function}>} guards the chain, in order
 * @param {object} facts `{ command, cwd, failed }` for Bash, `{ tool, input, cwd, file, typed, dir, gateDir }` for a file
 * @returns {Promise<{fires: Array<[string, string]>, deny: string|null, notice: string|null, error: *}>}
 *   each fire's hook and verdict for the hooks log, the first deny, the notices as one entry, a throw
 */
export async function runChain(io, env, guards, facts) {
  const chain = { fires: [], deny: null, notice: null, error: null };
  if (guards.length === 0) return chain;
  const isBash = typeof facts.command === 'string';
  const opted = isBash ? await bashOpted(io, env, facts) : await folderOpted(io, facts.gateDir);
  const gathered = isBash ? bashFacts(io, env, facts) : {
    ...facts, env: guardEnv(io, env), read: io.read, run: io.run, top: io.top, stat: io.stat, now: io.now,
  };
  const notices = [];
  for (const { hook, run } of guards) {
    if (!opted && !isOptinExempt(hook)) {
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
