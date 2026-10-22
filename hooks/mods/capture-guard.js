/**
 * hooks/mods/capture-guard.js: safety:capture-guard holds `.workkit/capture.md`
 * to the owner: a read or a rewrite needs the triage marker (under 30 minutes
 * old), an append is never the agent's, and a count stays free. A substring
 * tripwire, not a sandbox (docs/hooks.md § safety:capture-guard).
 */

import { BLANK, anyLine } from './command.js';
import { homeOf } from './log.js';
import { fileAge, triageMarkerPath } from './markers.js';
import { findingsRoute, settingsLayers } from './settings.js';

const SUFFIX = '.workkit/capture.md';
const MARKER_MAX_AGE_S = 1800;

// grep reads a command line by line, so every pattern is tried per line;
// NS is BLANK's members, for a negated class.
const NS = ' \\t\\v\\f\\r';
const WORD = '(^|[^A-Za-z0-9_./-])';
// The capture file as a TARGET, its folder optional; the rest of one simple command.
const TARGET = `${BLANK}*["']?([^${NS}"'<>|;&]*/)?capture\\.md`;
const SAME = '[^|;&]*';
const NOTE = new RegExp(`(^|[;&|\`]|\\$\\()${BLANK}*((bash|sh|zsh)${BLANK}+)?([^${NS}]*/)?(wk|workkit)(\\.sh)?${BLANK}+note(${BLANK}|$)`);
const APPENDS = [
  new RegExp(`>>${TARGET}`),
  new RegExp(`${WORD}tee${BLANK}+(-[^${NS}]+${BLANK}+)*(--append|-[A-Za-z0-9]*a)${SAME}${TARGET}`),
];
const OVERWRITE = new RegExp(`>${TARGET}`);
const REWRITES = [
  new RegExp(`${WORD}tee(${BLANK}|$)${SAME}${TARGET}`),
  new RegExp(`${WORD}(sed|perl)${BLANK}+(-[^${NS}]+${BLANK}+)*(--in-place|-[A-Za-z0-9]*i)${SAME}${TARGET}`),
];
const READER = new RegExp(`${WORD}(cat|head|tail|less|more|grep|sed|awk|bat)(${BLANK}|$)${SAME}${TARGET}`);
const SPELLED = new RegExp(`[^${NS}"']*\\.workkit/capture\\.md`);

const namesCapture = (path) => path === SUFFIX || path.endsWith(`/${SUFFIX}`);

// A path's folder, as dirname prints it.
const dirname = (path) => {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut < 0 ? '.' : trimmed.slice(0, cut).replace(/\/+$/, '') || '/';
};

// What a Bash command does to the capture file: `append`, `write` (a
// rewrite), `read`, or null for a count, a mention or another file.
function bashMode(command) {
  if (anyLine(command, NOTE)) return 'append';
  // Both halves of the path, together or apart: `cd .workkit && cat capture.md`.
  if (!command.includes('.workkit') || !command.includes('capture.md')) return null;
  if (APPENDS.some((re) => anyLine(command, re))) return 'append';
  if (anyLine(command.split('>>').join('@@'), OVERWRITE) || REWRITES.some((re) => anyLine(command, re))) return 'write';
  return anyLine(command, READER) ? 'read' : null;
}

/**
 * The capture file a call reaches and what it does there, or null when it
 * reaches none: `path` as the call spells it (relative to `cwd`, or `~/` and
 * `$HOME/` forms), `mode` (`read`, `write` or `append`), and `probe` when a
 * Grep pointed at the `.workkit` folder reaches the file only if it is there.
 * @param {{tool: string, input: object, cwd: string}} call the tool, its input and folder
 * @returns {{path: string, mode: string, probe: boolean}|null}
 */
function captureTarget({ tool, input, cwd }) {
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
    const path = input?.file_path ?? '';
    return path && namesCapture(path) ? { path, mode: tool === 'Read' ? 'read' : 'write', probe: false } : null;
  }
  if (tool === 'Bash') {
    const command = input?.command ?? '';
    const mode = command ? bashMode(command) : null;
    if (!mode) return null;
    const spelled = command.split('\n').map((line) => line.match(SPELLED)?.[0]).find(Boolean);
    return { path: spelled ?? `${cwd}/${SUFFIX}`, mode, probe: false };
  }
  if (tool !== 'Grep') return null;
  // Only a search pointed AT the file is gated: its path or folder, or a glob naming it.
  const path = String(input?.path ?? '').replace(/\/+$/, '');
  const glob = String(input?.glob ?? '');
  if (namesCapture(path)) return { path, mode: 'read', probe: false };
  if (path === '.workkit' || path.endsWith('/.workkit')) {
    return glob === '' || glob.includes('capture') ? { path: `${path}/capture.md`, mode: 'read', probe: true } : null;
  }
  return glob.includes('capture') ? { path: `${path || cwd}/${SUFFIX}`, mode: 'read', probe: false } : null;
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
  if (target.mode === 'append') {
    return { deny: `capture-guard: BLOCKED writing ${SUFFIX}: it is the owner's capture surface, and the agent never adds to it.\nIts entries are cleared only by the triage drain: run the workkit:triage skill, which records the marker this guard checks. ${route}` };
  }
  if (markerAgeS !== null && markerAgeS <= MARKER_MAX_AGE_S) return null;
  if (target.mode === 'write') {
    return { deny: `capture-guard: BLOCKED rewriting ${SUFFIX}: its entries are cleared only by the triage drain, and no drain is running.\nRun the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: ${route.charAt(0).toLowerCase()}${route.slice(1)}` };
  }
  return { deny: `capture-guard: BLOCKED reading ${SUFFIX}: it is the owner's capture surface, and its contents are read only during a triage run.\nRun the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) stays open.` };
}

// The path made absolute: the tilde and HOME forms through HOME, a relative
// one against the session's folder, as the tool resolves it.
function absolute(path, cwd, home) {
  const homed = path.match(/^(~|\$HOME|\$\{HOME\})\//);
  if (homed) return `${home}/${path.slice(homed[0].length)}`;
  return path.startsWith('/') ? path : `${cwd}/${path}`;
}

/**
 * The guard's run over a chain's facts, Bash (`command`) or file (`tool`,
 * `input`): the marker is the one `scripts/triage-marker.sh` writes for the
 * capture file's anchor.
 * @param {object} facts the chain's facts, with `top`, `read`, `stat`, `now` and `env`
 * @returns {Promise<{deny: string}|null>}
 */
export async function captureGuardGuard(facts) {
  const { cwd, env, top, stat, now } = facts;
  const isBash = typeof facts.command === 'string';
  const call = { tool: isBash ? 'Bash' : facts.tool, input: isBash ? { command: facts.command } : facts.input, cwd };
  const target = captureTarget(call);
  if (!target) return null;
  const route = target.mode === 'read' ? '' : findingsRoute(...(await settingsLayers(cwd, env, facts)));
  if (target.mode === 'append') return captureGuardVerdict({ ...call, root: null, markerAgeS: null, route });
  const path = absolute(target.path, cwd, homeOf(env));
  // An absent capture file has no contents a folder-pointed Grep could reach.
  if (target.probe && (await stat(path))?.kind !== 'file') return null;
  const parent = dirname(dirname(path));
  const probe = (await stat(dirname(path)))?.kind === 'dir' ? dirname(path) : parent;
  const root = (await top(probe)) || parent;
  const marker = await stat(await triageMarkerPath(root, env.TMPDIR));
  return captureGuardVerdict({ ...call, root, markerAgeS: marker ? fileAge(marker.mtimeMs, await now()) : null, route });
}
