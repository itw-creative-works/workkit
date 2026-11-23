/**
 * workflow/standards/gitignore.js: the heals that touch .gitignore and the
 * local working files: `.workkit/` untracked except the committed
 * settings.json, the basics every repo ignores, and the session files seeded
 * from their templates. Steps of the heal, run in the repo root.
 * Usage: const { ensureWorkflowIgnored, ensureLocalFile } = require('./gitignore');
 */

const fs = require('fs');
const path = require('path');
const { gitIn } = require('../lib/git');
const { isFile } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { readOrNull } = require('../lib/read');
const { ok, skip } = require('../lib/voice');
const { WORKKIT_DIR } = require('../user-dir');
const { flag } = require('./flag');
const { REPO_SETTINGS } = require('./state');

const GITIGNORE = '.gitignore';

// The two entries every .gitignore needs; only the missing ones are appended.
const GITIGNORE_BASICS = ['.DS_Store', '.env'];

/** Whether git ignores `file` in the repo at `root`. */
const ignored = (root, file) => gitIn(root, ['check-ignore', '-q', '--', file], { stdio: 'ignore' }).status === 0;

/** The .gitignore's lines, none when there is no file. */
const gitignoreLines = () => (readOrNull(GITIGNORE) ?? '').split('\n');

/**
 * Append a commented block, keeping the file's shape: a trailing newline
 * first, one blank line of separation, and neither in an empty file.
 * @param {string} comment
 * @param {string[]} lines
 */
const appendGitignoreBlock = (comment, lines) => {
  let lead = '';
  const text = readOrNull(GITIGNORE) ?? '';
  if (text !== '') lead = text.endsWith('\n') ? '\n' : '\n\n';
  fs.appendFileSync(GITIGNORE, `${lead}# ${comment}\n${lines.map((line) => `${line}\n`).join('')}`);
};

/**
 * `.workkit/` stays untracked but for the committed settings.json, judged by
 * outcome through git check-ignore (`workflow/README.md` § How it is reached).
 * A pattern that still ignores the opt-in file is named and flags the run.
 * @param {{root: string, needsAttention: boolean}} run
 */
const ensureWorkflowIgnored = (run) => {
  if (ignored(run.root, `${WORKKIT_DIR}/capture.md`) && !ignored(run.root, REPO_SETTINGS)) {
    skip(`gitignore: ${WORKKIT_DIR}/ already ignored`);
    return;
  }

  // Only the lines that are missing, so a re-run never duplicates them.
  const present = gitignoreLines();
  const lines = [`${WORKKIT_DIR}/*`, `!${REPO_SETTINGS}`].filter((line) => !present.includes(line));
  if (lines.length > 0) {
    appendGitignoreBlock('Workflow state (workflow spec): only settings.json is committed', lines);
    ok(`gitignore: added ${WORKKIT_DIR}/`);
  }

  if (ignored(run.root, REPO_SETTINGS)) {
    const res = gitIn(run.root, ['check-ignore', '-v', '--', REPO_SETTINGS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const offender = (res.stdout ?? '').split('\n')[0];
    flag(run, `gitignore: ${REPO_SETTINGS} is STILL ignored by [${offender}]; remove or repair that pattern so the opt-in file can be committed`);
  }
};

/**
 * Whether .gitignore already covers `entry`: exact, or a glob spelling that
 * plainly contains it; a miss costs a redundant line, never a wrong ignore. A
 * negation is not coverage.
 * @param {string} entry
 * @returns {boolean}
 */
const gitignoreCovers = (entry) => {
  if (!isFile(GITIGNORE)) return false;
  const spellings = new Set([
    entry, `${entry}/`, `${entry}*`, `/${entry}`, `/${entry}*`, `*${entry}`, `**/${entry}`, `**/${entry}*`,
  ]);
  return gitignoreLines().some((raw) => {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) return false;
    return spellings.has(line);
  });
};

/**
 * The basics every repo ignores, appended when nothing covers them.
 * @returns {void}
 */
const ensureGitignoreBasics = () => {
  const missing = GITIGNORE_BASICS.filter((entry) => !gitignoreCovers(entry));
  if (missing.length === 0) {
    skip(`gitignore: ${GITIGNORE_BASICS.join(' ')} already ignored`);
    return;
  }
  appendGitignoreBlock('Editor and environment files, ignored everywhere', missing);
  ok(`gitignore: added ${missing.join(' ')}`);
};

/**
 * A local working file seeded from its template, never over one with content,
 * so an empty or truncated file gets its sections back. `dest` places it under
 * `.workkit/` when that differs from the template's name; a missing template
 * flags the run, and the heal goes on.
 * @param {{kit: string, needsAttention: boolean}} run
 * @param {string} name the template's name in workflow/templates
 * @param {string} [dest] its path under `.workkit/`
 */
const ensureLocalFile = (run, name, dest = name) => {
  const label = name.replace(/\.md$/, '');
  const file = `${WORKKIT_DIR}/${dest}`;
  if (fs.statSync(file, { throwIfNoEntry: false })?.size > 0) {
    skip(`${label}: ${file} already exists`);
    return;
  }
  const template = `${run.kit}/workflow/templates/${name}`;
  if (!isFile(template)) {
    flag(run, `${label}: template missing at ${nativePath(template)}; reinstall the workflow core`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(template, file);
  ok(`${label}: created ${file}`);
};

module.exports = { ensureWorkflowIgnored, ensureGitignoreBasics, ensureLocalFile };
