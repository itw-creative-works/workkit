/**
 * hooks/mods/findings-guard.js: safety:findings-guard. Holds the ship's
 * review-notes issue to findings.file: a `gh issue create` whose title starts
 * `review notes from` bounces while the setting reads anything but true, so
 * the off default holds on the ship path (docs/hooks.md § safety:findings-guard).
 */

import { foldRedirectAmp, stripHeredocs, stripQuotes, unquoteWord } from './command.js';
import { ghClauses, ghFlagValues, ghNames } from './gh-edit.js';
import { findingsRoute, settingsLayers } from './settings.js';

const PHRASE = 'review notes from';
// The route findingsRoute gives while findings.file is on: the one answer that files.
const FILING_ROUTE = findingsRoute({ findings: { file: true } }, null);

// ASCII folding only, as `LC_ALL=C tr`: the phrase is ASCII.
const lowered = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Whether the command could be the gated create: it spells `gh issue create`
 * and the phrase, the two literal tests that spare every other command the walk.
 * @param {string} command the command text
 * @returns {boolean}
 */
function findingsTriggers(command) {
  return Boolean(command) && ghNames(command, 'create') && lowered(command).includes(PHRASE);
}

/**
 * findings-guard's verdict on a Bash command: the block for a create whose
 * title, read off a create clause's raw shell words, starts with the phrase
 * while findings.file is off; else null.
 * @param {{command: string, cwd: string, route: string}} facts the command,
 *   its folder, and the findingsRoute answer for that folder's settings
 * @returns {{deny: string}|null}
 */
export function findingsGuardVerdict({ command, route }) {
  if (!findingsTriggers(command)) return null;
  for (const clause of ghClauses(foldRedirectAmp(stripHeredocs(command)))) {
    if (!clause || !ghNames(stripQuotes(clause), 'create')) continue;
    for (const title of ghFlagValues(clause, '--title', '-t')) {
      if (!title || !lowered(unquoteWord(title)).startsWith(PHRASE)) continue;
      if (route === FILING_ROUTE) return null;
      return { deny: `findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo.\n${route} findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on.` };
    }
  }
  return null;
}

/**
 * The guard's run over the Bash facts: the two settings files are read only
 * for a command that could be the create.
 * @param {{command: string, cwd: string, env: object, top: function, read: function}} facts the chain's facts
 * @returns {Promise<{deny: string}|null>}
 */
export async function findingsGuardGuard(facts) {
  if (!findingsTriggers(facts.command)) return null;
  const route = findingsRoute(...(await settingsLayers(facts.cwd, facts.env, facts)));
  return findingsGuardVerdict({ command: facts.command, cwd: facts.cwd, route });
}
