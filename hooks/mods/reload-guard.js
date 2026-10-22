/**
 * hooks/mods/reload-guard.js: workflow:reload-guard's one nag per change to a
 * surface that loads at session start (docs/hooks.md § workflow:reload-guard).
 */

const NOTICE = 'workkit changed since this session loaded. /reload-plugins picks up new agents/skills, hook wiring and the hooks module; engine edits are already live';

/**
 * The load-time surface files, relative to the plugin root: `agents/*.md`,
 * each skill's SKILL.md, hooks/register.js, and every file under hooks/mods
 * at any depth.
 * @param {function} list async, a folder's entries (`{ name, kind }`) by its
 *   path from the root, [] when it cannot be read
 * @returns {Promise<string[]>}
 */
export async function surfacePaths(list) {
  const under = async (dir) => (await Promise.all((await list(dir)).map((f) => (f.kind === 'dir'
    ? under(`${dir}/${f.name}`) : [`${dir}/${f.name}`])))).flat();
  const [agents, skills, mods] = await Promise.all([list('agents'), list('skills'), under('hooks/mods')]);
  return [
    ...agents.filter((f) => f.name.endsWith('.md')).map((f) => `agents/${f.name}`),
    ...skills.map((f) => `skills/${f.name}/SKILL.md`),
    'hooks/register.js',
    ...mods,
  ];
}

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
