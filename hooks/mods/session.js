/**
 * hooks/mods/session.js: docs:session's context at session start: the
 * session state file with its closing lines, led by a line when the cloud
 * brief has gone stale (docs/hooks.md § docs:session).
 */

import { userDirOf } from './log.js';
import { MAX_CONTENT_LINES, contentLineCount } from './session-guard.js';
import { isPlain, parseJson } from './settings.js';

// How old the newest brief may be, in whole UTC calendar days, before it is
// judged stopped: one day is the ordinary morning. FRESH_DAYS in
// tower/api/lib/history.js holds the same bar; change both together.
const FRESH_DAYS = 1;
const DAY_MS = 86400000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The date at the front of a marker field (`lastBrief` is a day, `checkedAt`
// an ISO moment), or null for anything that is not one.
const markerDay = (brief, key) => {
  const value = brief[key];
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return DAY.test(day) ? day : null;
};

// Whole calendar days from a YYYY-MM-DD to `now`, both at UTC midnight; null
// for a date the arithmetic cannot place or one in the future.
const daysSince = (day, now) => {
  const today = new Date(now).toISOString().slice(0, 10);
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) && days >= 0 ? days : null;
};

/**
 * The stale-brief line, or null: every failure (no marker, a field that is
 * not a date, one in the future) is silence, since a guess is worse.
 * @param {object|null} brief the parsed brief-status.json, null when absent
 * @param {string|null|undefined} repoSlug the home repo (`site.repo`), when the settings name one
 * @param {number} now the time, in milliseconds
 * @returns {string|null}
 */
export function briefLine(brief, repoSlug, now) {
  if (!isPlain(brief)) return null;
  const last = markerDay(brief, 'lastBrief');
  const checked = markerDay(brief, 'checkedAt');
  if (!last || !checked) return null;
  const days = daysSince(last, now);
  if (days === null || days <= FRESH_DAYS) return null;
  const checkedDays = daysSince(checked, now);
  if (checkedDays === null) return null;
  // A marker is only as fresh as this machine's last morning: a laptop that
  // was off is not an expired token.
  const why = checkedDays > FRESH_DAYS
    ? `this machine last checked ${checked}, so the marker is that old too. Run the morning here before blaming the runner`
    : 'the runner likely needs a fresh token; fix: workkit setup --token';
  const line = `cloud brief: last posted ${last} (${days} days ago): ${why}`;
  return repoSlug ? `${line} · check: gh run list --repo ${repoSlug} --workflow brief.yml` : line;
}

// The state block: the file, the light-bar note past the bar, then one closing
// line per reader under a rule, the owner's last.
const stateBlock = (state, path, lines) => {
  let block = `SESSION STATE: ${path} (your task queue across compactions; keep it current):\n${state.replace(/\n+$/, '')}`;
  if (lines > MAX_CONTENT_LINES) {
    block += `\nNOTE: session.md is ${lines} content lines (bar ${MAX_CONTENT_LINES}). It is a queue, not a journal. Promote anything durable to its issue and prune the rest.`;
  }
  return `${block}\n\n---\nManager: open your first reply after a restart or compaction with this state in plain words.\nOwner: state carried over. Say "continue" and this session resumes the queue above.`;
};

/**
 * The session-start context: the stale-brief line first, then the state block.
 * `carried` is true when the file holds content lines, the case the owner is
 * told about; a header-only or absent file adds nothing.
 * @param {object} facts the session's facts
 * @param {string|null} facts.state the session.md text, null when there is none
 * @param {string} facts.path the session.md path the context names
 * @param {object|null} facts.brief the parsed brief-status.json, null when absent
 * @param {string|null} [facts.repoSlug] the home repo from the machine settings
 * @param {number} facts.now the time, in milliseconds
 * @returns {{context: string|null, carried: boolean}}
 */
export function sessionContext({ state, path, brief, repoSlug, now }) {
  const alert = briefLine(brief, repoSlug, now);
  const lines = typeof state === 'string' ? contentLineCount(state) : 0;
  const block = lines > 0 ? stateBlock(state, path, lines) : null;
  const context = [alert, block].filter(Boolean).join('\n\n') || null;
  return { context, carried: block !== null };
}

/**
 * The hook: the facts gathered from git's toplevel and the machine folder,
 * the context returned, and the owner told when state carried over.
 * @param {object} io the engine calls as plain functions: `top(cwd)` (the git
 *   toplevel, null outside a repo), `read(path)` (text, null when absent), `now()`, `log(text)`
 * @param {object} env the variables the module read, for the machine folder
 * @param {object} e the SessionStart input, for its `cwd`
 * @returns {Promise<string|null>} the context
 */
export async function sessionGather(io, env, e) {
  const root = await io.top(e.cwd);
  if (!root) return null;
  const path = `${root}/.workkit/agents/session.md`;
  const machine = userDirOf(env);
  const [state, brief, settings, now] = await Promise.all([
    io.read(path), io.read(`${machine}/brief-status.json`), io.read(`${machine}/settings.json`), io.now(),
  ]);
  const slug = parseJson(settings)?.site?.repo;
  const repoSlug = typeof slug === 'string' ? slug : null;
  const { context, carried } = sessionContext({ state, path, brief: parseJson(brief), repoSlug, now });
  if (carried) io.log('workkit: state carried over. Say "continue" to resume the session queue');
  return context;
}
