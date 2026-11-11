/**
 * hooks/mods/markers.js: the files the hooks name by content, the port of
 * hooks/lib/markers.sh and the engine's wk_marker_path: the review, full-panel,
 * triage, suite and package markers, the gh shim's journals, a call's mark of them
 * and the read of what it changed, the per-session marker, a file's age, and
 * the folder Git Bash means by a path the shell spelled, which the module's
 * variables and the guard facts go through. Writers and readers name each
 * file through the one derivation, so the two sides never drift apart.
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
 * The folder Git Bash means by a path, as the module can open it. Off Windows
 * the path as given. On Windows Git Bash mounts `/tmp` on the Windows temp
 * folder (the first native TMP or TEMP, else `%LOCALAPPDATA%\Temp`) and reads
 * `/c/x` as `C:/x`; a native path is as given. A Windows answer is in forward
 * slashes, trailing slash trimmed.
 * @param {string} given the path as the shell spelled it
 * @param {{TMP?: string, TEMP?: string, LOCALAPPDATA?: string}} env each unset when absent
 * @param {string} platform `win32` on Windows
 * @returns {string}
 */
export function shellDirOf(given, { TMP, TEMP, LOCALAPPDATA }, platform) {
  if (platform !== 'win32') return given;
  const slashed = given.replace(/\\/g, '/');
  const winTemp = [TMP, TEMP].find((dir) => dir && !dir.startsWith('/')) || (LOCALAPPDATA && `${LOCALAPPDATA}/Temp`);
  const mounted = (slashed === '/tmp' || slashed.startsWith('/tmp/')) && winTemp
    ? `${winTemp.replace(/\\/g, '/').replace(/\/+$/, '')}${slashed.slice('/tmp'.length)}`
    : slashed.replace(/^\/([A-Za-z])(\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`);
  return mounted.replace(/([^:/])\/+$/, '$1');
}

/**
 * The temp folder the module keeps per-session files under: shellDirOf over
 * `${TMPDIR:-/tmp}`.
 * @param {{TMPDIR?: string, TMP?: string, TEMP?: string, LOCALAPPDATA?: string}} env each unset when absent
 * @param {string} platform `win32` on Windows
 * @returns {string}
 */
export const tempDirOf = (env, platform) => shellDirOf(env.TMPDIR || '/tmp', env, platform);

/**
 * The variables with every folder the shell spelled translated (shellDirOf):
 * TMPDIR, `/tmp` when unset, and WORKFLOW_HOME and HOME where set.
 * @param {object} env the variables as read
 * @param {string} platform `win32` on Windows
 * @returns {object}
 */
export function shellEnvOf(env, platform) {
  const out = { ...env, TMPDIR: tempDirOf(env, platform) };
  for (const name of ['WORKFLOW_HOME', 'HOME']) {
    if (env[name]) out[name] = shellDirOf(env[name], env, platform);
  }
  return out;
}

// The folder every marker lives under, wk_markers_dir's rule.
const markersDir = (home) => `${home}/markers`;

/**
 * The marker file `<home>/markers/<dir>` holds for `anchor`, keyed by its
 * SHA-1: wk_marker_path's rule.
 * @param {string} dir the marker folder's name (`claude-review-marker`)
 * @param {string} anchor what the marker is for, a repo root as a rule
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {Promise<string>}
 */
export async function markerPath(dir, anchor, home) {
  return `${markersDir(home)}/${dir}/${await sha1Hex(anchor)}`;
}

// Each marker the hooks and the marker scripts share, by its folder's name.
export const reviewMarkerPath = (root, home) => markerPath('claude-review-marker', root, home);
export const reviewFullMarkerPath = (root, home) => markerPath('claude-review-full-marker', root, home);
export const triageMarkerPath = (anchor, home) => markerPath('claude-triage-marker', anchor, home);
export const suiteMarkerPath = (root, home) => markerPath('claude-suite-marker', root, home);
export const pkgMarkerPath = (root, home) => markerPath('claude-package-marker', root, home);
export const snapshotMarkerPath = (root, home) => markerPath('claude-red-snapshot', root, home);

// The gh journals' folder name, under the markers folder.
const JOURNAL_DIR = 'claude-gh-journal';

/**
 * The folder every gh journal lives in, one file per repo root (journalPath).
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {string}
 */
export const journalDir = (home) => `${markersDir(home)}/${JOURNAL_DIR}`;

/**
 * The gh journal of a repo root, as the shim writes it (wk_marker_path).
 * @param {string} root the repo root, or the folder outside a repo
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {Promise<string>}
 */
export const journalPath = (root, home) => markerPath(JOURNAL_DIR, root, home);

/**
 * Every gh journal on the machine with its length: the journal folder's files,
 * full paths in name order, each measured through `size`.
 * @param {function} list async, a folder's entry names, none when absent
 * @param {function} size async, a journal's length in bytes
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {Promise<{journal: string, bytes: number}[]>}
 */
export async function journalSizes(list, size, home) {
  const journals = (await list(journalDir(home))).sort().map((name) => `${journalDir(home)}/${name}`);
  return Promise.all(journals.map(async (journal) => ({ journal, bytes: await size(journal) })));
}

/**
 * The gh journal a folder's calls write, as the shim keys it: the journal of
 * the folder's git root, else of the folder itself.
 * @param {function} gitTop async, a folder's git root or null
 * @param {string} cwd the folder
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {Promise<string>}
 */
export async function journalFor(gitTop, cwd, home) {
  return journalPath((await gitTop(cwd)) || cwd, home);
}

/**
 * The gh journal's lines past an offset, parsed (journalLines): `tail -c` run
 * through `run`, so the journal is never read whole; an absent journal, or a
 * tail that fails, is no lines.
 * @param {function} run the facts' run, `(argv) => Promise<{exitCode, stdout}>`
 * @param {string} journal the journal's path (journalFor, journalSizes)
 * @param {number} bytes the offset in bytes, the lines before it skipped
 * @returns {Promise<object[]>}
 */
export async function journalTail(run, journal, bytes) {
  const tail = await run(['tail', '-c', `+${(Number(bytes) || 0) + 1}`, journal]);
  return tail.exitCode === 0 ? journalLines(tail.stdout) : [];
}

/**
 * The mark a Bash call's tool.call leaves for its PostToolUse, keyed by the
 * call: per gh journal on the machine (journalSizes), its path line, then a
 * line of its length in bytes before the call ran (journalMarkText).
 * @param {string} toolUseId the call's tool_use_id
 * @param {string} home the machine folder (userDirOf in hooks/mods/log.js)
 * @returns {Promise<string>}
 */
export const journalMarkPath = (toolUseId, home) => markerPath('claude-gh-journal-mark', toolUseId, home);

/**
 * A mark's text: a path line and a length line per journal, in the order given.
 * @param {{journal: string, bytes: number}[]} sized the journals and their lengths (journalSizes)
 * @returns {string}
 */
export function journalMarkText(sized) {
  return sized.map(({ journal, bytes }) => `${journal}\n${bytes}`).join('\n');
}

/**
 * A mark's journals and lengths, in the mark's order (journalMarkText).
 * @param {string} text the mark's text
 * @returns {{journal: string, bytes: number}[]}
 */
export function journalMarks(text) {
  const parts = text.split('\n');
  const marks = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i]) marks.push({ journal: parts[i], bytes: Number(parts[i + 1]) });
  }
  return marks;
}

/**
 * The journals a call changed and the offset to read each from, in `now`'s
 * order: a journal longer than its mark from its marked length; one shorter
 * (replaced during the call) or not in the mark from 0. A journal at its
 * marked length is left out.
 * @param {{journal: string, bytes: number}[]} marks the mark's journals (journalMarks)
 * @param {{journal: string, bytes: number}[]} now the journals and their lengths after the call
 * @returns {{journal: string, bytes: number}[]}
 */
export function journalsGrown(marks, now) {
  const held = new Map(marks.map(({ journal, bytes }) => [journal, bytes]));
  return now.flatMap(({ journal, bytes }) => {
    const marked = held.get(journal) ?? 0;
    if (bytes === marked) return [];
    return [{ journal, bytes: bytes > marked ? marked : 0 }];
  });
}

// A comma-joined journal field as its list, empties dropped.
const listOf = (field) => field.split(',').filter(Boolean);

/**
 * The gh journal's lines, parsed: each line the gate prints (journalLine in
 * workflow/identity/gate.js), eight tab-separated fields, epoch ms, verb,
 * subcommand, repo, then the numbers, the labels added and the labels removed,
 * each comma-joined, then the cwd; a line of any other shape is left out.
 * @param {string|null} text the journal's text, or a tail of it
 * @returns {Array<{ms: number, verb: string, sub: string, repo: string, numbers: string[], add: string[], remove: string[], cwd: string}>}
 */
export function journalLines(text) {
  return String(text ?? '').split('\n').flatMap((line) => {
    const fields = line.split('\t');
    if (fields.length !== 8 || !/^[0-9]+$/.test(fields[0])) return [];
    const [ms, verb, sub, repo, numbers, add, remove, cwd] = fields;
    return [{ ms: Number(ms), verb, sub, repo, numbers: listOf(numbers), add: listOf(add), remove: listOf(remove), cwd }];
  });
}

/**
 * Whether a journal line is an issue's: a `gh issue` call, or a `gh api`
 * write, whose `sub` the gate writes as `edit` or `close` when its endpoint
 * is an issue's.
 * @param {{verb: string}} line one journalLines entry
 * @returns {boolean}
 */
export const onIssue = (line) => line.verb === 'issue' || line.verb === 'api';

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
