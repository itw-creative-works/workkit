/**
 * hooks/mods/markers.js: the files the hooks name by content, the port of
 * hooks/lib/markers.sh and the engine's wk_marker_path: the review, full-panel
 * and triage marker paths, the suite and package record paths, the
 * per-session marker path, a file's age, and the folder they all live under
 * (the one Git Bash means by `${TMPDIR:-/tmp}`, with the Windows test that
 * decides it). Writers and readers name each file through the one derivation,
 * so the two sides never drift apart.
 */

/**
 * The SHA-1 of a text, as lowercase hex: the one digest every marker and cache
 * name goes through, wk_sha1's in the shell.
 * @param {string} text the text
 * @returns {Promise<string>}
 */
export async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the kit runs on Windows: its folder starts with a drive letter, the
 * one signal the module has.
 * @param {string} kit the plugin's root folder
 * @returns {boolean}
 */
export const windowsKit = (kit) => /^[A-Za-z]:[\\/]/.test(kit);

/**
 * The folder the module reads markers under: the real folder Git Bash's
 * `${TMPDIR:-/tmp}` names. Off Windows that is TMPDIR, `/tmp` when unset. On
 * Windows Git Bash mounts `/tmp` on the Windows temp folder (the first native
 * TMP or TEMP, else `%LOCALAPPDATA%\Temp`) and reads `/c/x` as `C:/x`; a native
 * path is as given. A Windows answer is in forward slashes, trailing slash trimmed.
 * @param {{TMPDIR?: string, TMP?: string, TEMP?: string, LOCALAPPDATA?: string}} env each unset when absent
 * @param {string} platform `win32` on Windows
 * @returns {string}
 */
export function tempDirOf({ TMPDIR, TMP, TEMP, LOCALAPPDATA }, platform) {
  if (platform !== 'win32') return TMPDIR || '/tmp';
  const given = (TMPDIR || '/tmp').replace(/\\/g, '/');
  const winTemp = [TMP, TEMP].find((dir) => dir && !dir.startsWith('/')) || (LOCALAPPDATA && `${LOCALAPPDATA}/Temp`);
  const mounted = (given === '/tmp' || given.startsWith('/tmp/')) && winTemp
    ? `${winTemp.replace(/\\/g, '/').replace(/\/+$/, '')}${given.slice('/tmp'.length)}`
    : given.replace(/^\/([A-Za-z])(\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`);
  return mounted.replace(/([^:/])\/+$/, '$1');
}

/**
 * The marker file `${TMPDIR:-/tmp}/<dir>` holds for `anchor`, keyed by its
 * SHA-1: wk_marker_path's rule.
 * @param {string} dir the marker folder's name (`claude-review-marker`)
 * @param {string} anchor what the marker is for, a repo root as a rule
 * @param {string} [tmpdir] TMPDIR, `/tmp` when unset
 * @returns {Promise<string>}
 */
export async function markerPath(dir, anchor, tmpdir) {
  return `${tmpdir || '/tmp'}/${dir}/${await sha1Hex(anchor)}`;
}

// Each marker the hooks and the marker scripts share, by its folder's name.
export const reviewMarkerPath = (root, tmpdir) => markerPath('claude-review-marker', root, tmpdir);
export const reviewFullMarkerPath = (root, tmpdir) => markerPath('claude-review-full-marker', root, tmpdir);
export const triageMarkerPath = (anchor, tmpdir) => markerPath('claude-triage-marker', anchor, tmpdir);
export const suiteMarkerPath = (root, tmpdir) => markerPath('claude-suite-marker', root, tmpdir);
export const pkgMarkerPath = (root, tmpdir) => markerPath('claude-package-marker', root, tmpdir);
export const snapshotMarkerPath = (root, tmpdir) => markerPath('claude-red-snapshot', root, tmpdir);

/**
 * The per-session file under `${TMPDIR:-/tmp}/<name>`, the id with every
 * non-alphanumeric as `_`.
 * @param {string} name the folder's name
 * @param {string} sessionId the session id
 * @param {string} [tmpdir] TMPDIR, `/tmp` when unset
 * @returns {string}
 */
export function sessionMarker(name, sessionId, tmpdir) {
  return `${tmpdir || '/tmp'}/${name}/${String(sessionId).replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * A file's age in whole seconds; an unreadable file reads as made at the
 * epoch, as hook_file_mtime's 0 does, so it is never fresh.
 * @param {number|null|undefined} mtimeMs the file's mtime, null when unreadable
 * @param {number} nowMs the time now
 * @returns {number}
 */
export function fileAge(mtimeMs, nowMs) {
  return Math.floor(nowMs / 1000) - Math.floor((mtimeMs ?? 0) / 1000);
}
