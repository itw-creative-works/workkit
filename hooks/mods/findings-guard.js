/**
 * hooks/mods/findings-guard.js: safety:findings-guard. Holds the ship's
 * review-notes issue to findings.file: a `gh issue create` whose title starts
 * `review notes from` bounces while the setting reads anything but true, so
 * the off default holds on the ship path; the gh shim's gate runs it
 * (workflow/identity/gate.js, docs/hooks.md § safety:findings-guard).
 */

import { findingsRoute, settingsLayers } from './settings.js';

const PHRASE = 'review notes from';
// The route findingsRoute gives while findings.file is on: the one answer that files.
const FILING_ROUTE = findingsRoute({ findings: { file: true } }, null);

// ASCII folding only, as `LC_ALL=C tr`: the phrase is ASCII.
const lowered = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * findings-guard's verdict on a call's steps: the block when a create step's
 * title starts with the phrase while findings.file is off; else null.
 * @param {{steps: object[], cwd: string, repo: ?string, facts: {route: string}}} call
 *   one step per issue, a create's `{ sub: 'create', number: null, add, remove,
 *   title }` with the title as gh receives it, and `facts.route` the
 *   findingsRoute answer for the call's folder's settings
 * @returns {{deny: string}|null}
 */
export function findingsVerdict({ steps, facts }) {
  const { route } = facts;
  // A create with no --title has a null title, and no phrase to start with.
  const gated = steps.some((s) => s.sub === 'create' && lowered(s.title ?? '').startsWith(PHRASE));
  if (!gated || route === FILING_ROUTE) return null;
  return { deny: `findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.\n${route} findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on.` };
}

/**
 * The findingsRoute answer for a folder: the repo's settings at its root over
 * the machine's.
 * @param {{cwd: string, env: object, top: function, read: function}} facts the call's facts (guards.js bashFacts)
 * @returns {Promise<string>}
 */
export async function findingsRouteOf(facts) {
  return findingsRoute(...(await settingsLayers(facts.cwd, facts.env, facts)));
}
