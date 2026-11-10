#!/usr/bin/env node
// The ship's GitHub release, which CI makes: the repo's checks.yml `release` job
// creates `v<x.y.z>` once its release commit reaches the default branch
// (.github/scripts/ci-release.js, which reads its notes and release commits from
// here). The cut waits for it, then runs the repo's afterRelease hooks (hooks.js),
// an earlier version with a release commit but no release waited for first.
// Every line of its own is `ship-cut:` on stderr. Run from inside the repo:
//   workkit ship cut <x.y.z>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../lib/run');
const { parseEntries, sectionHeadingAt } = require('../changelog/lint');
const { repoSlug } = require('../changelog/changelog-links');
const { repoRoot, headSha } = require('../lib/git');
const { compareVersions, isSemver } = require('./semver');
const { runHooks } = require('./hooks');
const { RELEASE_SUBJECT } = require('../../hooks/mods/release-taken.js');
const { sayAs, endOf, errLine } = require('../lib/say');
const { pause } = require('../lib/pause');

const USAGE = 'usage: workkit ship cut <x.y.z>';
const CALLER = '.github/workflows/checks.yml';
const NO_RELEASE_JOB = `${CALLER} has no release job; run the standards step (workkit standards) and commit the caller`;

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
 * The release commits the revisions reach, newest first, one per version (its
 * newest): each a commit whose subject is exactly `chore(release): <x.y.z>`.
 * `noRelease` marks one whose message carries the `Release: none` trailer, the
 * mark a ship run with `no release` leaves.
 * @param {string} root - the repo root
 * @param {string[]} [revs] - git log's revision arguments, HEAD's history by default
 * @returns {{sha: string, version: string, noRelease: boolean}[]}
 * @throws {Error} when git log fails, which a repo with a HEAD never should
 */
const releaseCommits = (root, revs = ['HEAD']) => {
  const format = '--format=%H%x1f%s%x1f%(trailers:key=Release,valueonly,separator=%x2C)%x1e';
  const res = spawnSync('git', ['log', '--fixed-strings', '--grep=chore(release): ', format, ...revs], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`ship-cut: git log ${endOf(res)}: ${(res.stderr || '').trim()}`);
  const seen = new Set();
  const commits = [];
  for (const record of res.stdout.split('\x1e')) {
    const [sha, subject = '', release = ''] = record.trim().split('\x1f');
    const version = RELEASE_SUBJECT.exec(subject)?.[1].replace(/^v/, '');
    if (!version || seen.has(version)) continue;
    seen.add(version);
    commits.push({ sha, version, noRelease: release.split(',').some((v) => v.trim().toLowerCase() === 'none') });
  }
  return commits;
};

/** `gh release view` failing for a reason other than "release not found". */
class ReleaseViewError extends Error {}

/**
 * Whether `gh release view` finds the tag's release. Only gh's not-found answer
 * is a no: an auth, network or API failure says nothing about the release.
 * @returns {boolean}
 * @throws {ReleaseViewError} `gh release view <tag> failed: <gh's first stderr line>`
 */
const isReleased = (root, tag) => {
  const res = spawnSync('gh', ['release', 'view', tag], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status === 0) return true;
  if (/release not found/.test(res.stderr || '')) return false;
  throw new ReleaseViewError(`gh release view ${tag} failed: ${errLine(res)}`);
};

/**
 * Whether a checks.yml's top-level `jobs:` holds a job named `release`.
 * @param {string} text - the workflow file
 * @returns {boolean}
 */
const hasReleaseJob = (text) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((line) => /^["']?jobs["']?\s*:\s*(#.*)?$/.test(line));
  if (start < 0) return false;
  let indent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const at = line.search(/\S/);
    if (at === 0) return false;
    if (indent === null) indent = at;
    if (at === indent && /^["']?release["']?\s*:/.test(line.slice(at))) return true;
  }
  return false;
};

/**
 * The earlier versions with a release commit but no release, oldest first: the
 * walk down from the newest stops at the first version released, and passes
 * over one shipped with no release.
 * @param {string} root - the repo root
 * @param {{sha: string, version: string, noRelease: boolean}[]} commits - releaseCommits' answer
 * @param {string} version - the version asked for
 * @returns {{sha: string, version: string, noRelease: boolean}[]}
 */
const missingBefore = (root, commits, version) => {
  const missing = [];
  for (const commit of commits.filter((c) => compareVersions(c.version, version) < 0)) {
    if (commit.noRelease) continue;
    if (isReleased(root, `v${commit.version}`)) return missing.reverse();
    missing.push(commit);
  }
  return [];
};

/** A whole-number wait setting from the environment, `fallback` when unset. */
const knob = (name, fallback, min) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`ship-cut: ${name} is ${raw}, not a whole number of at least ${min}`);
  return value;
};

/**
 * One wait every version of a cut shares: `gh release view` asked every POLL
 * seconds until TIMEOUT seconds in all have passed, about ten minutes by default.
 * @returns {{seconds: number, until: (root: string, tag: string) => boolean}}
 */
const releaseWait = () => {
  const seconds = knob('WORKKIT_CUT_RELEASE_TIMEOUT', 600, 0);
  const poll = knob('WORKKIT_CUT_RELEASE_POLL', 10, 0);
  const deadline = Date.now() + seconds * 1000;
  const until = (root, tag) => {
    while (!isReleased(root, tag)) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      pause(Math.min(poll, left / 1000));
    }
    return true;
  };
  return { seconds, until };
};

/** The checks run for HEAD when gh finds one, else the repo's Actions page. */
const runUrl = (root) => {
  const head = headSha(root);
  if (head !== null) {
    const res = spawnSync('gh', ['run', 'list', '--commit', head, '--workflow', 'checks.yml', '--json', 'url', '--limit', '1', '--jq', '.[0].url // empty'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const url = res.status === 0 ? res.stdout.trim() : '';
    if (url !== '') return url;
  }
  const slug = repoSlug(root);
  return slug ? `https://github.com/${slug}/actions` : "the repo's Actions page";
};

/**
 * Wait for one version's release, then run the afterRelease hooks.
 * @returns {number} 0 released and every hook passed; else the code to exit with
 */
const releaseOne = (root, wait, version) => {
  const tag = `v${version}`;
  if (!wait.until(root, tag)) {
    say(`no release ${tag} after ${wait.seconds}s; check the release job: ${runUrl(root)}`);
    return 1;
  }
  if (runHooks(root, 'afterRelease') === 0) return 0;
  say(`${tag} was released; an afterRelease hook failed`);
  return 1;
};

/**
 * Wait for every earlier version with a release commit but no release, then the
 * version itself, each followed by its afterRelease hooks.
 * @returns {number} the code to exit with
 */
const releaseAll = (root, version, notesOf) => {
  const tag = `v${version}`;
  const commits = releaseCommits(root);
  const own = commits.find((c) => c.version === version);
  if (own?.noRelease) {
    say(`the chore(release): ${version} commit carries Release: none, so there is no ${tag} to wait for and no hook ran`);
    return 0;
  }
  // A version released before it had a release commit still runs its hooks.
  if (!own && !isReleased(root, tag)) {
    say(`${tag} has no release commit; nothing for CI to release`);
    return 1;
  }

  const wait = releaseWait();
  for (const { sha, version: earlier } of missingBefore(root, commits, version)) {
    if (notesOf(earlier) === null) {
      say(noSection(earlier));
      return 1;
    }
    say(`v${earlier} has a release commit but no release; waiting for CI to release it at ${sha.slice(0, 7)}`);
    const code = releaseOne(root, wait, earlier);
    if (code !== 0) return code;
  }
  return releaseOne(root, wait, version);
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

  const callerFile = path.join(root, CALLER);
  if (!fs.existsSync(callerFile) || !hasReleaseJob(fs.readFileSync(callerFile, 'utf8'))) {
    say(NO_RELEASE_JOB);
    return 1;
  }

  const logFile = path.join(root, 'CHANGELOG.md');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : null;
  const notesOf = (v) => (log === null ? null : sectionBody(log, v));
  if (notesOf(version) === null) {
    say(noSection(version));
    return 1;
  }

  if (headSha(root) === null) {
    say(`the repo has no HEAD commit, so ${tag} was not released`);
    return 1;
  }

  try {
    return releaseAll(root, version, notesOf);
  } catch (err) {
    if (!(err instanceof ReleaseViewError)) throw err;
    say(err.message);
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  sectionBody, noSection, releaseCommits, isReleased, missingBefore, ReleaseViewError,
};
