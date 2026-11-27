#!/usr/bin/env node
/**
 * workflow/note.js: the capture command, `workkit note`'s program. It appends
 * a bullet to the capture file of the participating repo this folder stands
 * in, or files an issue on the home repo outside one (workflow/README.md §
 * The capture CLI). The home repo's answers are home.js's.
 * Usage: node note.js <text...>
 */

const fs = require('fs');
const path = require('path');
const { kitOf, homeRun } = require('./workkit/kit');
const { ok, warn, error } = require('./lib/voice');
const { writeErr } = require('./lib/say');
const { spin } = require('./lib/spin');
const { nativePath, physicalDir } = require('./lib/platform');
const { isFile } = require('./lib/lock');
const { readOrNull } = require('./lib/read');
const { onPath, spawnSync } = require('./lib/run');
const { towerDir, WORKKIT_DIR } = require('./user-dir');
const { userDirOf } = require('../hooks/mods/log.js');
const { settingsOptedIn } = require('../hooks/mods/gate.js');
const { repoSettingsFile } = require('../hooks/mods/settings.js');
const { CAPTURE_PATH } = require('../hooks/mods/changed.js');
const { chomp } = require('../hooks/mods/text.js');

// The longest title an issue gets; a longer note is cut to one less and marked.
const TITLE_MAX = 72;

// U+FFFD, what Node reads in process.argv for bytes that are not UTF-8.
const REPLACEMENT = 0xfffd;

// The blanks a note is trimmed of, bash's [:space:].
const BLANKS = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/** The usage lines on stderr. */
const usage = () => {
  writeErr('usage: workkit note <text...>\n');
  writeErr(`  appends "- <text>" to this repo's ${CAPTURE_PATH}, or files an issue on the home repo outside one\n`);
};

/**
 * The hooks' participation test, counted only at a repo root, so the machine's
 * own folder on the way up never reads as an opt-in; the configured machine
 * folder is refused even at a repo root (a home tracked in git).
 * @param {object} kit
 * @param {string} dir
 * @returns {boolean}
 */
const participating = (kit, dir) => {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  const stateDir = physicalDir(path.join(dir, WORKKIT_DIR));
  if (stateDir !== null && stateDir === physicalDir(userDirOf(kit.env))) return false;
  return settingsOptedIn(readOrNull(repoSettingsFile(dir)));
};

/**
 * The participating repo root at or above this folder, walked folder by
 * folder rather than asked of git, since a nested checkout or a worktree makes
 * git's answer and the settings file's differ.
 * @param {object} kit
 * @returns {string|null}
 */
const findRepoRoot = (kit) => {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (participating(kit, dir)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
};

/**
 * The bullet appended, never clobbering: a missing file starts from the
 * template, and an unterminated last line gets its newline first.
 * @param {object} kit
 * @param {string} file
 * @param {string} note
 * @returns {number} 0; 1 with no template
 */
const appendNote = (kit, file, note) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const templates = path.join(kit.engine, 'templates');
    const name = path.basename(CAPTURE_PATH);
    if (!isFile(path.join(templates, name))) {
      error(`template missing at ${nativePath(templates)}/${name}; reinstall the workflow core`);
      return 1;
    }
    fs.copyFileSync(path.join(templates, name), file);
  }
  const text = fs.readFileSync(file);
  if (text.length > 0 && text[text.length - 1] !== 0x0a) fs.appendFileSync(file, '\n');
  fs.appendFileSync(file, `- ${note}\n`);
  return 0;
};

/**
 * The note's title: cut by whole characters past TITLE_MAX, and with the
 * stand-in Node reads for bytes that are not UTF-8 dropped, unless that
 * leaves nothing.
 * @param {string} note
 * @returns {string}
 */
const titleOf = (note) => {
  const chars = Array.from(note);
  const title = chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join('')}…` : note;
  return title.replaceAll(String.fromCharCode(REPLACEMENT), '') || title;
};

/** `gh issue create` with <args>, spun with no one line, its stderr dropped: its last answer line, or '' when it failed or said nothing. */
const ghCreate = (kit, message, args) => {
  const res = spin(message, () => spawnSync('gh', ['issue', 'create', ...args], {
    encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'], env: kit.env, windowsHide: true,
  }), { line: false });
  return res.status === 0 ? chomp(res.stdout) : '';
};

/**
 * The note filed on the home repo in the spec's issue anatomy. A fresh home
 * repo may lack the labels, so a failed try is made once more without them;
 * both failing print the note back.
 * @param {object} kit
 * @param {string} note
 * @returns {number} 0 filed; 1 with no gh or no issue; home.js's code when it named no slug
 */
const homeIssue = (kit, note) => {
  if (onPath('gh', { env: kit.env }) === null) {
    error(`gh is not on this machine, so the note could not be filed on the home repo: ${note}`);
    return 1;
  }
  const named = homeRun(kit, ['slug']);
  if (named.code !== 0) return named.code;
  const slug = chomp(named.stdout);
  const fields = ['--repo', slug, '--title', titleOf(note)];
  const body = ['--body', `## Description\n\n${note}\n\n## Spec\n\nNone needed: small item.`];
  let url = ghCreate(kit, `filing the note on ${slug}`, [...fields, '--label', 'status:inbox,type:idea', ...body]);
  if (url === '') {
    url = ghCreate(kit, 'filing the note without labels', [...fields, ...body]);
    if (url === '') {
      error(`\`gh issue create\` on ${slug} did not finish, so the note was not filed: ${note}`);
      return 1;
    }
    warn(`the status:inbox and type:idea labels could not be applied on ${slug}; the issue is filed without them`);
  }
  ok(`noted → ${url.slice(url.lastIndexOf('\n') + 1)}`);
  return 0;
};

/**
 * `workkit note <text...>`: the words joined with spaces and trimmed, then
 * the repo's capture file, else the home repo's issue, else a refusal; this
 * command creates nothing global.
 * @param {object} kit
 * @param {...string} words
 * @returns {number} 0 noted; 1 for an empty note or one with nowhere to go
 */
const note = (kit, ...words) => {
  const text = words.join(' ').replace(BLANKS, '');
  if (text === '') {
    usage();
    return 1;
  }
  const root = findRepoRoot(kit);
  if (root !== null) {
    const file = path.join(root, CAPTURE_PATH);
    if (appendNote(kit, file, text) !== 0) return 1;
    ok(`noted → ${nativePath(file)}`);
    return 0;
  }
  // home.js's ready, not a `.git`, so a foreign repo at that path is refused.
  if (homeRun(kit, ['ready'], { stdio: 'inherit' }).code === 0) return homeIssue(kit, text);
  if (chomp(homeRun(kit, ['state']).stdout) === 'other') {
    error(`${nativePath(towerDir(userDirOf(kit.env)))} is not the home repo's clone; move it aside, then \`workkit setup\`; captures outside a project become issues on the home repo`);
    return 1;
  }
  error('there is no home yet; `workkit setup` creates the home repo, and captures outside a project become issues on it');
  return 1;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = note(kitOf(), ...process.argv.slice(2));
}

module.exports = {
  note, participating, findRepoRoot, appendNote, homeIssue, titleOf,
};
