/**
 * hooks/mods/engine-floor.js: the oldest Claude Code build the hooks are proved
 * on, and the line an older one gets at session start; the twin of floorLine
 * in workflow/lib/floor.js.
 */

// The build whose ranged read ($.fs.read with offset and length) the journal tail needs.
export const ENGINE_FLOOR = '2.1.328';

/** The line a build with no `$.session.version` gets: older than the call itself. */
export const ENGINE_UNNAMED_LINE = `workkit: this Claude Code is older than ${ENGINE_FLOOR}; the kit's hooks need ${ENGINE_FLOOR} or newer`;

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/;

/**
 * The line a Claude Code release below ENGINE_FLOOR gets, or '' at or above it,
 * and for a base that is absent or does not read as a release. A suffix after
 * the three numbers (`-dev`) is dropped; the compare is by number.
 * @param {string} [base] the release `$.session.version()` names, `2.1.280` or `2.1.280-dev`
 * @returns {string}
 */
export const engineFloorLine = (base) => {
  const match = RELEASE.exec(String(base ?? ''));
  if (!match) return '';
  const floor = RELEASE.exec(ENGINE_FLOOR).slice(1).map(Number);
  const parts = match.slice(1).map(Number);
  const at = parts.findIndex((part, i) => part !== floor[i]);
  const below = at !== -1 && parts[at] < floor[at];
  return below ? `workkit: this Claude Code is ${base}; the kit's hooks need ${ENGINE_FLOOR} or newer` : '';
};
