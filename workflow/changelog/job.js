#!/usr/bin/env node
// workflow/changelog/job.js: a repo's checks.yml as the heal writes it, the
// kit's caller, and the retired linter copies. Required by the standards
// heal; run by safety:commit-gate, so the gate never accepts a change the heal would not make.
// Usage: node job.js rewrite [template] | copies | names <file|-> [copy]

const fs = require('fs');
const path = require('path');
const { defaultBranch } = require('../lib/git');
const { sayAs } = require('../lib/say');
const { chomp } = require('../../hooks/mods/text.js');

// The linter copies an earlier heal vendored: the current name and the older .js one.
const LINTER_COPIES = ['.github/changelog-lint.cjs', '.github/changelog-lint.js'];

// The checks.yml template in the engine folder, the one home of the caller's text.
const TEMPLATE = path.join(__dirname, '..', 'templates', 'github-workflows', 'checks.yml');

const say = sayAs('changelog-job');

/**
 * Whether `text` names the copy (or any copy) outside a comment line, since
 * naming it is running it.
 * @param {string} text - the workflow text
 * @param {string} [copy] - one copy's path; every copy when omitted
 * @returns {boolean}
 */
const namesLinterCopy = (text, copy) => {
  const copies = copy === undefined ? LINTER_COPIES : [copy];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.some((line) => !/^[ \t\n\v\f\r]*#/.test(line) && copies.some((c) => line.includes(c)));
};

// Every plain file under `dir`, as `find -type f` lists them: a link is no
// file, and a linked folder is never walked. Unlike `filesUnder` of
// lib/read.js, a folder that cannot be read throws, so the caller answers 2.
const filesOrThrow = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const at = path.join(dir, entry.name);
  if (entry.isDirectory()) return filesOrThrow(at);
  return entry.isFile() ? [at] : [];
});

/**
 * Whether any file under `<root>/.github/workflows` names the copy (or any copy).
 * @param {string} root - the repo root
 * @param {string} [copy] - one copy's path; every copy when omitted
 * @returns {number} 0 named, 1 not named or no such folder, 2 the folder could not be read
 */
const workflowsRunCopy = (root, copy) => {
  const dir = path.join(root, '.github', 'workflows');
  let text;
  try {
    if (!fs.statSync(dir).isDirectory()) return 1;
  } catch {
    return 1;
  }
  try {
    text = filesOrThrow(dir).map((file) => fs.readFileSync(file, 'utf8')).join('');
  } catch {
    return 2;
  }
  return namesLinterCopy(text, copy) ? 0 : 1;
};

/**
 * checks.yml as the heal writes it, whatever the file held: the template with
 * the repo's default branch (defaultBranch) for its __DEFAULT_BRANCH__ placeholder.
 * @param {string} template - the template's path
 * @param {string} root - the repo whose default branch it names
 * @returns {{status: number, text?: string}} 0 with the text, 1 an unread template, 2 no branch
 */
const checksRewrite = (template, root) => {
  let text;
  try {
    text = fs.readFileSync(template, 'utf8');
  } catch {
    return { status: 1 };
  }
  const branch = defaultBranch(root);
  if (!branch) return { status: 2 };
  return { status: 0, text: `${chomp(text).split('__DEFAULT_BRANCH__').join(branch)}\n` };
};

// The program's three modes; each returns its exit code.
const usage = () => {
  say('usage: rewrite [template] | copies | names <file|-> [copy]');
  return 64;
};

const rewriteMode = (template) => {
  const res = checksRewrite(template || TEMPLATE, process.cwd());
  if (res.status === 1) say(`cannot read ${template || TEMPLATE}`);
  if (res.status === 2) say('no default branch: GitHub did not answer and origin/HEAD is unset; run git remote set-head origin -a');
  if (res.status === 0) process.stdout.write(res.text);
  return res.status;
};

const namesMode = (file, copy) => {
  if (!file) return usage();
  let text;
  try {
    // A socket stdin (Linux, Git Bash) cannot be reopened by path, so `-` reads fd 0 as it is.
    text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch {
    say(`cannot read ${file}`);
    return 2;
  }
  return namesLinterCopy(text, copy) ? 0 : 1;
};

/**
 * The program: `rewrite [template]`, `copies` or `names <file|-> [copy]`.
 * @param {string[]} argv - the arguments after the script
 * @returns {number} the exit code
 */
const main = ([mode, ...args]) => {
  if (mode === 'rewrite') return rewriteMode(args[0]);
  if (mode === 'copies') {
    process.stdout.write(`${LINTER_COPIES.join('\n')}\n`);
    return 0;
  }
  if (mode === 'names') return namesMode(args[0], args[1]);
  return usage();
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  LINTER_COPIES, TEMPLATE, namesLinterCopy, workflowsRunCopy, checksRewrite,
};
