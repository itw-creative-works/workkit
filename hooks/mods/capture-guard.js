/**
 * hooks/mods/capture-guard.js: safety:capture-guard holds `.workkit/capture.md`
 * to the owner: a Read or an Edit or Write of it, and a Bash command naming its
 * path, need the triage marker (under 30 minutes old). A Bash write is reported
 * after the call by safety:script-write. A tripwire, not a sandbox
 * (docs/hooks.md § safety:capture-guard).
 */

import { CAPTURE_PATH } from './changed.js';
import { homeOf } from './log.js';
import { triageGoing, triageMarkerAge } from './markers.js';
import { findingsRoute, settingsOf } from './settings.js';

const namesCapture = (path) => path === CAPTURE_PATH || path.endsWith(`/${CAPTURE_PATH}`);

// A path's folder, as dirname prints it.
const dirname = (path) => {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut < 0 ? '.' : trimmed.slice(0, cut).replace(/\/+$/, '') || '/';
};

/**
 * The capture file a call reaches and what it does there, or null when it
 * reaches none: `path` as the call spells it (relative to `cwd`, or `~/` and
 * `$HOME/` forms), `mode` (`read`, `write` or `bash`), and `probe` when a
 * Grep pointed at the `.workkit` folder reaches the file only if it is there.
 * A Bash call reaches the cwd's file when its input's `namesCapture` is true.
 * @param {{tool: string, input: object, cwd: string}} call the tool, its input and folder
 * @returns {{path: string, mode: string, probe: boolean}|null}
 */
function captureTarget({ tool, input, cwd }) {
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
    const path = input?.file_path ?? '';
    return path && namesCapture(path) ? { path, mode: tool === 'Read' ? 'read' : 'write', probe: false } : null;
  }
  if (tool === 'Bash') return input?.namesCapture === true ? { path: `${cwd}/${CAPTURE_PATH}`, mode: 'bash', probe: false } : null;
  if (tool !== 'Grep') return null;
  // Only a search pointed AT the file is gated: its path or folder, or a glob naming it.
  const path = String(input?.path ?? '').replace(/\/+$/, '');
  const glob = String(input?.glob ?? '');
  if (namesCapture(path)) return { path, mode: 'read', probe: false };
  if (path === '.workkit' || path.endsWith('/.workkit')) {
    return glob === '' || glob.includes('capture') ? { path: `${path}/capture.md`, mode: 'read', probe: true } : null;
  }
  return glob.includes('capture') ? { path: `${path || cwd}/${CAPTURE_PATH}`, mode: 'read', probe: false } : null;
}

/**
 * capture-guard's verdict on a Read, Grep, Edit, Write or Bash call.
 * @param {{tool: string, input: object, cwd: string, root: string|null, markerAgeS: number|null, route: string}} facts
 *   the call; `root` the marker's anchor the age was read for (the capture
 *   file's repo root, else the `.workkit` folder's parent; the judgment
 *   reads only the age); the triage marker's age in seconds, null when there
 *   is none; the findings route sentence (`findingsRoute`) the write blocks end on
 * @returns {{deny: string}|null}
 */
export function captureGuardVerdict({ tool, input, cwd, markerAgeS, route }) {
  const target = captureTarget({ tool, input, cwd });
  if (!target) return null;
  if (triageGoing(markerAgeS)) return null;
  if (target.mode === 'bash') {
    return { deny: `capture-guard: BLOCKED this command: it names ${CAPTURE_PATH}, the owner's capture surface, and no triage run is going. A read, a count and a write of it are the triage drain's alone; the session-start line already says whether it has entries.\nRun the workkit:triage skill, which records the marker this guard checks. Adding entries is never the agent's at all: ${route.charAt(0).toLowerCase()}${route.slice(1)}` };
  }
  if (target.mode === 'write') {
    return { deny: `capture-guard: BLOCKED rewriting ${CAPTURE_PATH}: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: ${route.charAt(0).toLowerCase()}${route.slice(1)}` };
  }
  return { deny: `capture-guard: BLOCKED reading ${CAPTURE_PATH}: it is the owner's capture surface, and its contents are read only during a triage run.\nRun the workkit:triage skill, which records the marker this guard checks, and read it there; the session-start line already says whether it has entries.` };
}

// The path made absolute: the tilde and HOME forms through HOME, a relative
// one against the session's folder, as the tool resolves it.
function absolute(path, cwd, home) {
  const homed = path.match(/^(~|\$HOME|\$\{HOME\})\//);
  if (homed) return `${home}/${path.slice(homed[0].length)}`;
  return path.startsWith('/') ? path : `${cwd}/${path}`;
}

/**
 * The guard's run over a chain's facts, Bash (`namesCapture`, the handler's
 * one match on the command) or file (`tool`, `input`): the marker is the one
 * `workkit triage mark` writes for the capture file's anchor.
 * @param {object} facts the chain's facts, with `top`, `read`, `stat`, `now`, `env` and `pluginRoot`
 * @returns {Promise<{deny: string}|null>}
 */
export async function captureGuardGuard(facts) {
  const { cwd, env, top, stat } = facts;
  const isBash = typeof facts.namesCapture === 'boolean';
  const call = { tool: isBash ? 'Bash' : facts.tool, input: isBash ? { namesCapture: facts.namesCapture } : facts.input, cwd };
  const target = captureTarget(call);
  if (!target) return null;
  const route = target.mode === 'read' ? '' : findingsRoute(await settingsOf(cwd, env, facts));
  const path = absolute(target.path, cwd, homeOf(env));
  // An absent capture file has no contents a folder-pointed Grep could reach.
  if (target.probe && (await stat(path))?.kind !== 'file') return null;
  const parent = dirname(dirname(path));
  const probe = (await stat(dirname(path)))?.kind === 'dir' ? dirname(path) : parent;
  const root = (await top(probe)) || parent;
  return captureGuardVerdict({ ...call, root, markerAgeS: await triageMarkerAge(facts, root), route });
}
