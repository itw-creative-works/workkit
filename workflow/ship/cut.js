#!/usr/bin/env node
// The ship's GitHub release: `gh release create` for a version not yet
// released, at HEAD, its notes the CHANGELOG's section for it, then the repo's
// afterRelease hooks (hooks.js). Every line of its own is `ship-cut:` on stderr.
//
// Run from inside the repo:
//   workkit ship cut <x.y.z>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../lib/run');
const { parseEntries, sectionHeadingAt } = require('../changelog/lint');
const { repoRoot, headSha } = require('../lib/git');
const { isSemver } = require('./semver');
const { runHooks } = require('./hooks');
const { sayAs, endOf } = require('../lib/say');

const USAGE = 'usage: workkit ship cut <x.y.z>';

const say = sayAs('ship-cut');

/**
 * The body of the CHANGELOG's `[version]` section: every line from its heading
 * to its last entry, category headings included.
 * @param {string} text - the whole CHANGELOG
 * @param {string} version - the section's label
 * @returns {string|null} the body, or null when no entry sits under that heading
 */
const sectionBody = (text, version) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const entries = parseEntries(text).filter((e) => e.section === version);
  if (entries.length === 0) return null;
  return lines.slice(sectionHeadingAt(lines, entries[0]) + 1, entries[entries.length - 1].endLine).join('\n').trim();
};

const main = (argv) => {
  const [version] = argv;
  if (argv.length !== 1 || !isSemver(version)) {
    say(USAGE);
    return 2;
  }
  const tag = `v${version}`;
  const root = repoRoot(process.cwd());
  if (root === null) {
    say(`${process.cwd()} is not inside a git repo, so ${tag} was not released`);
    return 1;
  }

  const view = spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' });
  if (view.status === 0) {
    say(`${tag} is already released`);
    return 1;
  }

  const logFile = path.join(root, 'CHANGELOG.md');
  const notes = fs.existsSync(logFile) ? sectionBody(fs.readFileSync(logFile, 'utf8'), version) : null;
  if (notes === null) {
    say(`CHANGELOG.md has no [${version}] section with entries, so ${tag} was not released`);
    return 1;
  }

  const head = headSha(root);
  if (head === null) {
    say(`the repo has no HEAD commit, so ${tag} was not released`);
    return 1;
  }

  const create = spawnSync('gh', ['release', 'create', tag, '--target', head, '--title', tag, '--notes', notes], { cwd: root, stdio: 'inherit' });
  if (create.status !== 0) {
    if (create.status !== null) return create.status;
    say(`gh release create ${tag} ${endOf(create)}`);
    return 1;
  }

  if (runHooks(root, 'afterRelease') === 0) return 0;
  say(`${tag} was released; an afterRelease hook failed`);
  return 1;
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
