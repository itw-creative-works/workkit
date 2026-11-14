/**
 * hooks/mods/script-write.js: safety:script-write. The write hooks fire on the
 * Edit and Write tools alone, so after a Bash call this lists the files that
 * changed on disk during it (changedSince) and runs the five write checks an Edit
 * gets on each. A failed check is a notice naming the file and the check; the
 * file stays as written and nothing is refused (docs/hooks.md § safety:script-write).
 * The five checks over one file (writeChecks) live here, and the Edit and
 * Write handler runs the same ones.
 */

import { boardGuardGather, boardGuardRepo } from './board-guard.js';
import { CAPTURE_PATH, changedSince } from './changed.js';
import { changelogGuardVerdict, isChangelog, linterPath } from './changelog-guard.js';
import { triageGoing, triageMarkerAge } from './markers.js';
import { repoPathOf } from './optin.js';
import { sessionGuardVerdict } from './session-guard.js';
import { testBarContext } from './test-bar.js';
import { isCodePath, isTestPath, testReminderContext } from './test-reminder.js';

/** The most files one call's check runs on; the notice counts the rest. */
export const CHECK_LIMIT = 50;

const HOOK = {
  boardGuard: 'docs:board-guard', changelogGuard: 'docs:changelog-guard', sessionGuard: 'docs:session-guard',
  testReminder: 'safety:test-reminder', testBar: 'safety:test-bar',
};
/** The five write checks, as settings and the hooks log name them, in the order they run. */
export const WRITE_CHECKS = Object.values(HOOK);

/**
 * A path's folder; a drive root keeps its slash (`C:/`), so git never runs drive-relative.
 * @param {string} path the path, forward slashes
 * @returns {string}
 */
export const dirOf = (path) => {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return '/';
  return /^[A-Za-z]:$/.test(path.slice(0, cut)) ? path.slice(0, cut + 1) : path.slice(0, cut);
};

// Each check fails open on its own: the error goes to the debug log and the check says nothing.
async function caught(io, hook, work) {
  try {
    return await work();
  } catch (err) {
    io.debug?.(`${hook}: ${err?.message ?? err}`);
    return null;
  }
}

async function changelogCheck(io, env, file, text) {
  if (!isChangelog(file) || text === null) return null;
  const linter = linterPath(env, io.pluginRoot);
  if (!(await io.exists(linter))) return null;
  const lint = await io.run(['node', linter, file, '--added-only'], { cwd: dirOf(file) });
  // No node to run the linter, or a run past its timeout: the check stands aside, out loud.
  if (lint.isStarted !== false) return changelogGuardVerdict(file, lint);
  io.log?.(`docs/changelog-guard: the linter did not start (${lint.stderr.trim()}); the write is not judged`);
  return null;
}

// A written file in the call's own repo as `{ root, rel }`, else null: the
// gate test-reminder and test-bar share.
async function repoRel(io, cwd, file) {
  if (!file || !(await io.exists(file))) return null;
  const dir = dirOf(file);
  const [root, fileRoot] = await Promise.all([io.top(cwd), io.top(dir)]);
  const rel = root && root === fileRoot ? await repoPathOf(dir, io.run, file.split('/').pop()) : null;
  return rel && { root, rel };
}

// Asked once per file per session, through the session store where the io has one.
async function testReminderCheck(io, where) {
  if (!where) return null;
  const { root, rel } = where;
  const seen = (await io.storeGet?.('test-reminder')) ?? [];
  if (!isCodePath(rel) || seen.includes(`${root}/${rel}`)) return null;
  const listing = await io.run(['git', '-c', 'core.quotePath=false', 'ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root });
  const files = listing.exitCode === 0 ? listing.stdout.split('\n').filter(Boolean) : [];
  const tests = {};
  await Promise.all(files.filter(isTestPath).map(async (path) => {
    tests[path] = (await io.read(`${root}/${path}`)) ?? '';
  }));
  const context = testReminderContext({ root, rel, files, tests }, seen);
  if (context) await io.storeSet?.('test-reminder', [...seen, `${root}/${rel}`]);
  return context;
}

/**
 * The five write checks an Edit gets, in order, over one written file:
 * docs:board-guard, docs:changelog-guard, docs:session-guard, then the two
 * nudges safety:test-reminder and safety:test-bar. The first block wins and
 * the checks after it do not run.
 * @param {object} io the engine calls (`ioOf`, or a guard's facts), `storeGet`/`storeSet` the session's
 * @param {object} env the variables the module read
 * @param {{file: string|null, cwd: string}} call the file where it really is, and the call's folder
 * @returns {Promise<{fires: Array<[string, string]>, block: {hook: string, text: string}|null, contexts: {hook: string, text: string}[]}>}
 */
export async function writeChecks(io, env, { file, cwd }) {
  const fires = [];
  const text = file ? await io.read(file) : null;
  const blocking = [
    [HOOK.boardGuard, () => caught(io, HOOK.boardGuard, () => boardGuardGather(file, text, `${io.pluginRoot}/docs/project-state.md`, () => boardGuardRepo(file, dirOf(file), env, io)))],
    [HOOK.changelogGuard, () => caught(io, HOOK.changelogGuard, () => changelogCheck(io, env, file, text))],
    [HOOK.sessionGuard, () => sessionGuardVerdict(file, text)],
  ];
  for (const [hook, check] of blocking) {
    fires.push([hook, 'run']);
    const block = await check();
    if (block) return { fires, block: { hook, text: block }, contexts: [] };
  }
  // The two nudges share one repo read; neither blocks.
  const where = await caught(io, `${HOOK.testReminder}, ${HOOK.testBar} (repo read)`, () => repoRel(io, cwd, file));
  fires.push([HOOK.testReminder, 'run'], [HOOK.testBar, 'run']);
  const said = [
    [HOOK.testReminder, await caught(io, HOOK.testReminder, () => testReminderCheck(io, where))],
    [HOOK.testBar, await caught(io, HOOK.testBar, async () => (where ? testBarContext({ ...where, text }) : null))],
  ];
  return { fires, block: null, contexts: said.filter(([, context]) => context).map(([hook, context]) => ({ hook, text: context })) };
}

// The notice lines one changed file earns: the capture file's owner line, then
// each check's. The listing cannot tell writers apart, so the words never blame the call.
async function linesFor(facts, root, rel) {
  const file = `${root}/${rel}`;
  const lines = [];
  if (rel === CAPTURE_PATH && !triageGoing(await triageMarkerAge(facts, root))) {
    lines.push(`script-write: ${file} changed during this Bash call, outside a triage run; it is the owner's capture surface, cleared only by the workkit:triage drain, and the agent never adds to it. If this call wrote it, tell the owner what changed there.`);
  }
  // The root the file was listed under is its call folder, so the two nudges judge it in its own repo.
  const { block, contexts } = await writeChecks(facts, facts.env, { file, cwd: root });
  for (const { hook, text } of [block, ...contexts].filter(Boolean)) {
    lines.push(`script-write: ${file} changed during this Bash call, and ${hook} flags it (the file stays as written; if this call wrote it, fix it with the Edit or Write tool; if another writer did, leave it): ${text}`);
  }
  return lines;
}

/**
 * The guard's run over the facts of a Bash call that already ran: every file
 * the call changed since `since` in each of `roots` (at most CHECK_LIMIT),
 * each run through the five write checks in order (writeChecks).
 * @param {{since: number|null, roots: string[], cwd: string, run: function, stat: function, now: function, env: object}} facts
 *   the call's start time, the opted-in repo roots it began and ended in (runChain cuts them), and the reads
 * @returns {Promise<{context: string}|null>}
 */
export async function scriptWriteGuard(facts) {
  const { since, roots } = facts;
  if (typeof since !== 'number' || roots.length === 0) return null;
  const lines = [];
  const changed = [];
  for (const root of roots) {
    try {
      changed.push(...(await changedSince(facts, root, since)).map((rel) => ({ root, rel })));
    } catch (err) {
      lines.push(`script-write: the files changed during this Bash call could not be listed (${err.message}), so none in that repo was checked.`);
    }
  }
  for (const { root, rel } of changed.slice(0, CHECK_LIMIT)) lines.push(...(await linesFor(facts, root, rel)));
  if (changed.length > CHECK_LIMIT) {
    lines.push(`script-write: ${changed.length} files changed during this Bash call; ${changed.length - CHECK_LIMIT} were not checked, past the ${CHECK_LIMIT} a call is checked for.`);
  }
  return lines.length > 0 ? { context: lines.join('\n') } : null;
}
