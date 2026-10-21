/**
 * hooks/mods/log.js: the hooks log line and its cap, the same line and the same
 * cut hooks/loader.sh writes (docs/hooks.md § The hooks log), and the machine
 * folder it lives in.
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
 * The home folder: HOME, else USERPROFILE (Windows), else nothing.
 * @param {object} env the variables the module read
 * @returns {string}
 */
export function homeOf(env) {
  return env.HOME || env.USERPROFILE || '';
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
 * One fire's line: `<iso>\t<hook>\t<event>\t<session_id>\t<cwd>\t<verdict>\n`.
 * @param {string} iso the time, UTC, to the second
 * @returns {string}
 */
export function logLine(iso, hook, event, sid, cwd, verdict) {
  return `${iso}\t${hook}\t${event}\t${sid ?? ''}\t${cwd ?? ''}\t${verdict}\n`;
}

/**
 * The log after `lines` are added: a log past 10,000 lines is first cut to its
 * last 5,000, as the loader's `tail -n 5000` cuts it.
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
