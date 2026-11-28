/**
 * workflow/standards/state.js: participation and the machine's own files: the
 * tower clone check, the user-level seeds, the offer line, the repo's committed
 * answer, the retired version key's removal, the state resolution, a recorded
 * decline, the roster and the committed opt-in. Steps of the heal, each taking
 * the run object standards.js builds; the repo's files are read from its root,
 * the process's folder.
 * Usage: const { resolveState, registerInRoster } = require('./state');
 */

const fs = require('fs');
const path = require('path');
const { repoFlag } = require('../../hooks/mods/gate.js');
const { isPlain, repoSettingsFile } = require('../../hooks/mods/settings.js');
const { rosterFile } = require('../../hooks/mods/log.js');
const { physical } = require('../lib/link');
const { dropLock, isDir, isFile, stateLockPath, takeLock } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { readJsonOrNull, readOrNull } = require('../lib/read');
const { ok, warn } = require('../lib/voice');
const { editJson } = require('../lib/write');
const { towerDir, WORKKIT_DIR } = require('../user-dir');

// The repo's committed answer, read from the repo root (the process's folder)
// and printed as written here.
const REPO_SETTINGS = `${WORKKIT_DIR}/settings.json`;

// The yes --enable writes whole, and the two machine files' first text.
const OPT_IN = '{\n  "enabled": true\n}\n';
const USER_SETTINGS_SEED = '{\n  "version": 1\n}\n';
const USER_REPOS_SEED = '{\n  "version": 1,\n  "repos": {}\n}\n';

// The flags a committed file answers with that the decline cannot override.
const COMMITTED = new Set(['true', 'false', 'unreadable']);

// The flags that keep a registered repo in the roster: on, or not readable.
const KEPT = new Set(['true', 'unreadable']);

// The machine's files, in the user's workflow folder.
const userSettings = (run) => `${run.userDir}/settings.json`;
const userRepos = (run) => rosterFile(run.userDir);

/** A settings file's `enabled` answer (repoFlag); a file that cannot be read is `unreadable`. */
const flagOf = (file) => repoFlag(readOrNull(file));

/**
 * A JSON value an edit sets keys on: a plain object, `{}` for null. Any other
 * throws, which editJson reports as a file it could not write, leaving it as it was.
 * @param {*} value
 * @returns {object}
 */
const objectOf = (value) => {
  if (value === null || value === undefined) return {};
  if (!isPlain(value)) throw new TypeError('not a JSON object');
  return value;
};

/** The `repos` object of a roster an edit changes, `{}` where it holds none or `false`; throws as objectOf. */
const reposOf = (value) => {
  const { repos } = objectOf(value);
  return repos === false ? {} : objectOf(repos);
};

/**
 * `file` created holding `text` when nothing is there, its folder made first.
 * The create is exclusive, so a racing writer's file is never truncated; any
 * failure is passed over.
 */
const seedFile = (file, text) => {
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { flag: 'wx' });
  } catch { /* another run's file, or a folder this machine cannot write */ }
};

/**
 * Whether the repo being healed is the tower clone (`<user dir>/tower`),
 * compared by physical path, so a symlinked home directory is still one folder.
 * @param {{root: string, userDir: string}} run
 * @returns {boolean}
 */
const isHomeClone = (run) => {
  const here = physical(run.root);
  return here !== null && here === physical(towerDir(run.userDir));
};

/**
 * The user's folder exists from the first run, its settings file holding no
 * setting: every default is the kit's (defaults/settings.json), never copied in.
 * @param {{userDir: string}} run
 */
const seedUserSettings = (run) => seedFile(userSettings(run), USER_SETTINGS_SEED);

/**
 * The machine's own roster, seeded when the engine first has something to
 * record, since nobody but the engine writes it.
 * @param {{userDir: string}} run
 */
const seedUserRepos = (run) => seedFile(userRepos(run), USER_REPOS_SEED);

/**
 * Most readers skip a machine settings file that is no JSON object and the
 * token client refuses it, so the heal says so. Empty text is no layer at all.
 * @param {{userDir: string}} run
 */
const reportUserSettings = (run) => {
  const file = userSettings(run);
  if (!isFile(file)) return;
  const text = readOrNull(file);
  if (text !== null && (text.trim() === '' || isPlain(readJsonOrNull(file)))) return;
  warn(`settings: ${nativePath(file)} is not a JSON object (unreadable or not valid JSON); fix or remove it; until then most settings readers skip it and the token client refuses it`);
};

// What bash's `%q` backslash-quotes anywhere in a word; a `#` only first.
const SHELL_SPECIAL = /[ \t\n'"\\|&;()<>!{}*[\]?^$`,]/g;

/** `text` as bash's `printf %q` writes a printable word. */
const shellQuoted = (text) => {
  if (text === '') return "''";
  return text.replace(SHELL_SPECIAL, '\\$&').replace(/^#/, '\\#');
};

/**
 * The line that offers the workflow to an undecided repo. The paths are quoted
 * as bash's `%q` quotes them, so a pasted command survives a space.
 * @param {{root: string, kit: string}} run
 * @returns {string}
 */
const offerLine = (run) => `this repo is not in the issue workflow; say the word to enable it (node ${shellQuoted(nativePath(`${run.kit}/workflow`))}/standards.js --enable ${shellQuoted(run.root)}), or decline and it will not ask again (--decline).`;

/**
 * Nothing in a repo records which heals it has had: a `version` key an older
 * kit left in its settings file is removed; a failed edit flags the run.
 * @param {{needsAttention: boolean}} run
 */
const removeVersionStamp = (run) => {
  if (!isFile(REPO_SETTINGS)) return;
  const value = readJsonOrNull(REPO_SETTINGS);
  if (!isPlain(value) || !Object.hasOwn(value, 'version')) return;
  const removed = editJson(REPO_SETTINGS, (settings) => {
    delete settings.version;
    return settings;
  });
  if (removed) {
    ok(`settings: removed the retired "version" key from ${REPO_SETTINGS}; commit it`);
  } else {
    run.needsAttention = true;
  }
};

/**
 * The repo's participation: `home` for the tower clone before anything else,
 * so a stray settings file there never reads as a yes; then the committed
 * file's answer; then the machine's recorded decline; else `undecided`.
 * @param {{root: string, rosterKey: string, userDir: string}} run
 * @returns {string}
 */
const resolveState = (run) => {
  if (isHomeClone(run)) return 'home';
  if (isFile(REPO_SETTINGS)) {
    const flag = flagOf(REPO_SETTINGS);
    if (flag === 'true') return 'enabled';
    if (flag === 'false') return 'disabled';
    if (flag === 'unreadable') return 'unreadable';
  }
  const roster = readJsonOrNull(userRepos(run));
  if (isPlain(roster) && isPlain(roster.repos) && roster.repos[run.rosterKey] === 'declined') return 'declined';
  return 'undecided';
};

/**
 * The decline, written to the roster under the state mutex.
 * @param {{rosterKey: string, userDir: string}} run
 * @returns {Promise<boolean>} whether it was recorded
 */
const recordDecline = async (run) => {
  const file = userRepos(run);
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    warn(`decline: cannot create ${nativePath(dir)}`);
    return false;
  }
  seedUserRepos(run);
  if (!isFile(file)) {
    warn(`decline: cannot write ${nativePath(file)}`);
    return false;
  }

  const locked = await takeLock(stateLockPath(run.userDir));
  if (!locked) warn('decline: proceeding without the lock (held for 5s by another run)');
  try {
    const recorded = editJson(file, (value) => ({ ...objectOf(value), repos: { ...reposOf(value), [run.rosterKey]: 'declined' } }));
    if (!recorded) return false;
    // A committed answer wins at resolve time, so "it will not be offered
    // again" would be a lie while that file gives one.
    if (isFile(REPO_SETTINGS) && COMMITTED.has(flagOf(REPO_SETTINGS))) {
      ok(`decline: recorded ${run.rosterKey} in ${nativePath(file)}`);
      warn(`decline: ${REPO_SETTINGS} still carries the repo's committed answer, which wins; this takes effect only if that file goes away`);
    } else {
      ok(`decline: recorded ${run.rosterKey} in ${nativePath(file)}; it will not be offered again`);
    }
    return true;
  } finally {
    if (locked) dropLock(stateLockPath(run.userDir));
  }
};

/**
 * The roster's `repos` as the roster read reads it: `{}` for empty text or a
 * file holding none, null for a file that cannot be read as JSON.
 * @param {string} file
 * @returns {object|null}
 */
const rosterRepos = (file) => {
  const text = readOrNull(file);
  if (text === null) return null;
  if (text.trim() === '') return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null) return {};
  if (!isPlain(value)) return null;
  if (value.repos === undefined || value.repos === null || value.repos === false) return {};
  return isPlain(value.repos) ? value.repos : null;
};

/**
 * Whether a registered repo leaves the roster: its folder is gone, it holds no
 * committed file (the way back to undecided), or that file answers anything
 * but on, save a file that cannot be read, which leaves the entry alone.
 * @param {string} key a roster key, the repo's root
 * @returns {boolean}
 */
const isStale = (key) => {
  if (!isDir(key)) return true;
  const settings = repoSettingsFile(key);
  return !isFile(settings) || !KEPT.has(flagOf(settings));
};

/**
 * The machine roster in `.repos.json`, kept on contact and silently
 * (`workflow/README.md` § The two settings files): this repo in, stale entries
 * out, a decline never pruned. Nothing to change writes nothing.
 * @param {{rosterKey: string, userDir: string}} run
 */
const registerInRoster = async (run) => {
  const file = userRepos(run);
  seedUserRepos(run);
  if (!isFile(file)) return;

  const repos = rosterRepos(file);
  if (repos === null) {
    warn(`roster: ${nativePath(file)} cannot be read as JSON (unreadable or not valid JSON); fix or remove it; until then this machine's roster is not maintained`);
    return;
  }
  const stale = Object.entries(repos)
    .filter(([key, answer]) => answer !== 'declined' && key !== '' && key !== run.rosterKey && isStale(key))
    .map(([key]) => key);
  if (stale.length === 0 && repos[run.rosterKey] === 'enabled') return;

  // The shared mutex, since sessions opening together would otherwise keep
  // only the last registration; released here, not at the end of the heal.
  const locked = await takeLock(stateLockPath(run.userDir));
  editJson(file, (value) => {
    const kept = Object.fromEntries(Object.entries(reposOf(value)).filter(([key]) => !stale.includes(key)));
    return { ...objectOf(value), repos: { ...kept, [run.rosterKey]: 'enabled' } };
  });
  if (locked) dropLock(stateLockPath(run.userDir));
};

/**
 * The repo's committed yes: a missing or blank settings file is written whole,
 * any other gets `enabled: true` set in it.
 * @returns {boolean} whether the yes was written
 */
const writeRepoOptin = () => {
  if (!isFile(REPO_SETTINGS)) {
    fs.mkdirSync(WORKKIT_DIR, { recursive: true });
    fs.writeFileSync(REPO_SETTINGS, OPT_IN);
    ok(`opt-in: created ${REPO_SETTINGS}; commit it, it is the repo's yes`);
    return true;
  }
  // A file holding no JSON value has nothing to edit, so it is written whole.
  if ((readOrNull(REPO_SETTINGS) ?? '').trim() === '') {
    fs.writeFileSync(REPO_SETTINGS, OPT_IN);
    ok(`opt-in: wrote the yes into the empty ${REPO_SETTINGS}; commit it`);
    return true;
  }
  if (!editJson(REPO_SETTINGS, (settings) => ({ ...objectOf(settings), enabled: true }))) return false;
  ok(`opt-in: ${REPO_SETTINGS} is now enabled`);
  return true;
};

module.exports = {
  seedUserSettings, resolveState, offerLine, recordDecline, writeRepoOptin, registerInRoster,
  reportUserSettings, removeVersionStamp, REPO_SETTINGS,
};
