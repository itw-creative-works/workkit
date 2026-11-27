/**
 * hooks/mods/log.js: the hooks log's path, its line and its cap (docs/hooks.md
 * § The hooks log), the machine folder it lives in, and the kit's other addresses
 * under the home: its cache folder, the Windows script shell and the roster file.
 */

const LOG_MAX_LINES = 10000;
const LOG_KEEP_LINES = 5000;

/**
 * A clock field two digits wide (`07`), the shape every stamp here writes.
 * @param {number} n the hour, minute, second, month or day
 * @returns {string}
 */
export function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * The variable holding the home folder, the order's one home: HOME, else
 * USERPROFILE (Windows), else none.
 * @param {object} env the variables the module read
 * @returns {string|undefined} 'HOME', 'USERPROFILE', or undefined when neither is set
 */
export function homeVariableOf(env) {
  return ['HOME', 'USERPROFILE'].find((name) => env[name]);
}

/**
 * The home folder: the value of homeVariableOf's variable, else nothing.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function homeOf(env) {
  return env[homeVariableOf(env)] ?? '';
}

/**
 * The machine folder, wk_user_dir's rule: WORKFLOW_HOME, else ~/.workkit.
 * @param {string|undefined} workflowHome WORKFLOW_HOME
 * @param {string|undefined} home the home folder
 * @returns {string}
 */
export function userDir(workflowHome, home) {
  return workflowHome || `${home ?? ''}/.workkit`;
}

/**
 * The machine folder for the variables the module read: userDir over
 * WORKFLOW_HOME and homeOf.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function userDirOf(env) {
  return userDir(env.WORKFLOW_HOME, homeOf(env));
}

/**
 * The kit's cache folder, its one home: <home>/.cache/workkit, short and with no
 * crowded parent, holding the proof run folders and the red-proof snapshots. HOME
 * moves it; WORKFLOW_HOME does not, since ~/.workkit can be a link into a repo.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function cacheDirOf(env) {
  return `${homeOf(env)}/.cache/workkit`;
}

/**
 * The Windows script shell setup builds into the machine folder, its one
 * home: `<user dir>/script-shell.exe`.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function scriptShellExeOf(env) {
  return `${userDirOf(env)}/script-shell.exe`;
}

/**
 * The roster file of the machine folder <dir>, its one spelling: `<dir>/.repos.json`.
 * @param {string} dir the machine folder
 * @returns {string}
 */
export function rosterFile(dir) {
  return `${dir}/.repos.json`;
}

/**
 * The hooks log for the variables the module read, its one spelling: `<user dir>/hooks.log`.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function hooksLogOf(env) {
  return `${userDirOf(env)}/hooks.log`;
}

/**
 * One fire's line: `<iso>\t<hook>\t<event>\t<session_id>\t<cwd>\t<verdict>\n`.
 * @param {string} iso the time, UTC, to the second
 * @returns {string}
 */
export function logLine(iso, hook, event, sid, cwd, verdict) {
  return `${iso}\t${hook}\t${event}\t${sid ?? ''}\t${cwd ?? ''}\t${verdict}\n`;
}

/**
 * The log after `lines` are added: a log past 10,000 lines is first cut to its
 * last 5,000.
 * @param {string} text the log as it stands, '' when there is none
 * @param {string} lines the lines to add, each ending in a newline
 * @returns {string}
 */
export function appendLog(text, lines) {
  const count = (text.match(/\n/g) ?? []).length;
  if (count <= LOG_MAX_LINES) return `${text}${lines}`;
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  return `${rows.slice(-LOG_KEEP_LINES).join('\n')}\n${lines}`;
}
