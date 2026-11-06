#!/usr/bin/env node
// The ship's GitHub release: `gh release create` for a version not yet
// released, at its own release commit (HEAD when history has none), its notes
// the CHANGELOG's section for it, then the repo's afterRelease hooks (hooks.js).
// On a machine it first cuts every earlier version with a release commit but no
// release; a cloud session cuts nothing. Every line of its own is `ship-cut:` on stderr.
//
// Run from inside the repo:
//   workkit ship cut <x.y.z>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../lib/run');
const { parseEntries, sectionHeadingAt } = require('../changelog/lint');
const { repoRoot, headSha } = require('../lib/git');
const { isCloud } = require('../lib/cloud');
const { compareVersions, isSemver } = require('./semver');
const { runHooks } = require('./hooks');
const { RELEASE_SUBJECT } = require('../../hooks/mods/release-taken.js');
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

/** The line for a version the CHANGELOG has no entries for. */
const noSection = (version) => `CHANGELOG.md has no [${version}] section with entries, so v${version} was not released`;

/**
 * The release commits HEAD descends from, newest first, one per version (its
 * newest): each a commit whose subject is exactly `chore(release): <x.y.z>`.
 * @param {string} root - the repo root
 * @returns {{sha: string, version: string}[]}
 * @throws {Error} when git log fails, which a repo with a HEAD never should
 */
const releaseCommits = (root) => {
  const res = spawnSync('git', ['log', '--fixed-strings', '--grep=chore(release): ', '--format=%H %s', 'HEAD'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`ship-cut: git log ${endOf(res)}: ${(res.stderr || '').trim()}`);
  const seen = new Set();
  const commits = [];
  for (const line of res.stdout.split('\n')) {
    const sha = line.slice(0, line.indexOf(' '));
    const version = RELEASE_SUBJECT.exec(line.slice(sha.length + 1))?.[1].replace(/^v/, '');
    if (!version || seen.has(version)) continue;
    seen.add(version);
    commits.push({ sha, version });
  }
  return commits;
};

/** Whether `gh release view` finds the tag's release. */
const isReleased = (root, tag) => spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }).status === 0;

/**
 * The earlier versions with a release commit but no release, oldest first: the
 * walk down from the newest stops at the first version released.
 * @param {string} root - the repo root
 * @param {{sha: string, version: string}[]} commits - releaseCommits' answer
 * @param {string} version - the version asked for
 * @returns {{sha: string, version: string}[]}
 */
const missingBefore = (root, commits, version) => {
  const missing = [];
  for (const commit of commits.filter((c) => compareVersions(c.version, version) < 0)) {
    if (isReleased(root, `v${commit.version}`)) return missing.reverse();
    missing.push(commit);
  }
  return [];
};

/**
 * Cut one version: its release at `target`, then the afterRelease hooks.
 * @returns {number} 0 released and every hook passed; else the code to exit with
 */
const cutOne = (root, version, target, notes) => {
  const tag = `v${version}`;
  const create = spawnSync('gh', ['release', 'create', tag, '--target', target, '--title', tag, '--notes', notes], { cwd: root, stdio: 'inherit' });
  if (create.status !== 0) {
    if (create.status !== null) return create.status;
    say(`gh release create ${tag} ${endOf(create)}`);
    return 1;
  }
  if (runHooks(root, 'afterRelease') === 0) return 0;
  say(`${tag} was released; an afterRelease hook failed`);
  return 1;
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

  if (isReleased(root, tag)) {
    say(`${tag} is already released`);
    return 1;
  }

  const logFile = path.join(root, 'CHANGELOG.md');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : null;
  const notesOf = (v) => (log === null ? null : sectionBody(log, v));
  const notes = notesOf(version);
  if (notes === null) {
    say(noSection(version));
    return 1;
  }

  if (isCloud()) {
    say(`${tag} waits for a release: a cloud session cannot create one; the next ship on a machine cuts it`);
    return 0;
  }

  const head = headSha(root);
  if (head === null) {
    say(`the repo has no HEAD commit, so ${tag} was not released`);
    return 1;
  }

  const commits = releaseCommits(root);
  for (const { sha, version: earlier } of missingBefore(root, commits, version)) {
    const earlierNotes = notesOf(earlier);
    if (earlierNotes === null) {
      say(noSection(earlier));
      return 1;
    }
    say(`v${earlier} has a release commit but no release; cutting it at ${sha.slice(0, 7)}`);
    const code = cutOne(root, earlier, sha, earlierNotes);
    if (code !== 0) return code;
  }

  const own = commits.find((c) => c.version === version);
  return cutOne(root, version, own ? own.sha : head, notes);
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
