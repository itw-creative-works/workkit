/**
 * hooks/mods/reload-guard.js: workflow:reload-guard's one nag per change to a
 * surface that loads at session start (docs/hooks.md § workflow:reload-guard).
 */

const NOTICE = 'workkit changed since this session loaded. /reload-plugins picks up new agents/skills, hook wiring and the hooks module; engine and shell hook script edits are already live';

/**
 * The load-time surfaces as one text: hooks.json by CONTENT, since a rewrite
 * that lands the same wiring is no change, then each file and its mtime in
 * byte order; the LIST counts too, so a brand-new file is a change.
 * @param {string} hooksJson hooks/hooks.json's text, '' when absent
 * @param {{path: string, mtimeMs: number}[]} surfaces the surface files
 * @returns {string}
 */
export function reloadFingerprint(hooksJson, surfaces) {
  const rows = surfaces.map(({ path, mtimeMs }) => `${path} ${mtimeMs}`);
  rows.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${hooksJson}${rows.map((row) => `${row}\n`).join('')}`;
}

/**
 * The nag for a prompt, or null: no stamp yet (the caller stamps silently),
 * nothing changed since the stamp, or this change was already told.
 * @param {{stamp?: string, notified?: string}|string|null|undefined} stamp the
 *   session's record: the stamp, and the fingerprint last told
 * @param {string} fingerprint the surfaces now
 * @returns {string|null}
 */
export function reloadGuardContext(stamp, fingerprint) {
  const held = typeof stamp === 'string' ? { stamp } : stamp;
  if (!held?.stamp || held.stamp === fingerprint || held.notified === fingerprint) return null;
  return NOTICE;
}
