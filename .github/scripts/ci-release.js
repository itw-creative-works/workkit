#!/usr/bin/env node
// .github/scripts/ci-release.js [repo]: release.yml's one step, from a clone of the
// kit. Each `chore(release): <x.y.z>` commit the push brought (before..after in
// the event; a new branch or a force push reads the pushed commit alone), and every
// one the cut would wait for (the branch's newest and its missingBefore walk), with
// no `Release: none` trailer and no release yet gets `gh release create v<x.y.z>` at
// that commit, notes the cut's own. This token's release starts no workflow, so after
// a create, or a re-run whose pushed release commit is released, each on `release` is
// dispatched, with `-f tag=v<newest>` where its dispatch declares a `tag` input.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('../../workflow/lib/run');
const { sayAs, endOf, errLine } = require('../../workflow/lib/say');
const {
  sectionBody, noSection, releaseCommits, isReleased, missingBefore, ReleaseViewError,
} = require('../../workflow/ship/cut');
const { compareVersions } = require('../../workflow/ship/semver');

const TRIGGERS = path.join(__dirname, '../../workflow/ship/triggers.awk');
const INPUTS = path.join(__dirname, '../../workflow/ship/dispatch-input.awk');
const WORKFLOWS = '.github/workflows';

const say = sayAs('ci-release');

/** Whether the workflow file's top-level `on:` names the event (triggers.awk). */
const listensTo = (file, event) => spawnSync('awk', ['-v', `ev=${event}`, '-f', TRIGGERS, file], { stdio: 'ignore' }).status === 0;

/** Whether the workflow file's `workflow_dispatch` declares the input (dispatch-input.awk). */
const takesInput = (file, input) => spawnSync('awk', ['-v', `input=${input}`, '-f', INPUTS, file], { stdio: 'ignore' }).status === 0;

/** Whether `rev` names a commit this clone holds. */
const known = (root, rev) => spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: root, stdio: 'ignore' }).status === 0;

/**
 * git log's revisions for the push: before..after, or the pushed commit alone
 * when <before> is no commit to start from (a new branch, a force push).
 * @param {string} root - the repo root
 * @param {object} event - the push event's payload
 * @param {string} after - the pushed commit
 * @returns {string[]}
 */
const pushedRevs = (root, event, after) => {
  const before = event.before || '';
  if (event.forced || /^0*$/.test(before) || !known(root, before)) return ['--no-walk', after];
  return [`${before}..${after}`];
};

/**
 * The CHANGELOG notes the cut gives a version, read at its release commit.
 * @returns {string|null} null when that commit's CHANGELOG has no section for it
 */
const notesAt = (root, sha, version) => {
  const res = spawnSync('git', ['show', `${sha}:CHANGELOG.md`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? sectionBody(res.stdout, version) : null;
};

/**
 * Create one release at its commit, the notes through a file.
 * @returns {number} 0 created, else the code to exit with
 */
const create = (root, { sha, version }, notes) => {
  const tag = `v${version}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-release-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, `${notes}\n`);
  say(`releasing ${tag} at ${sha.slice(0, 7)}`);
  const res = spawnSync('gh', ['release', 'create', tag, '--target', sha, '--title', tag, '--notes-file', file], { cwd: root, stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (res.status === 0) return 0;
  // Another run may have made it in between; then it is done, not a failure.
  if (isReleased(root, tag)) {
    say(`gh release create ${tag} ${endOf(res)}, but ${tag} is there now, so it is released`);
    return 0;
  }
  say(`gh release create ${tag} ${endOf(res)}`);
  return res.status || 1;
};

/**
 * Start every workflow that runs on `release` and takes a dispatch, on the
 * default branch the event names, `tag` passed to each whose dispatch declares
 * it, each tried whatever the one before answered; name each on `release` alone.
 * @returns {number} 0 every dispatch went out, 1 one failed or no branch was named
 */
const dispatch = (root, branch, tag) => {
  const dir = path.join(root, WORKFLOWS);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort() : [];
  let failed = false;
  for (const name of names) {
    const file = path.join(dir, name);
    if (!listensTo(file, 'release')) continue;
    if (!listensTo(file, 'workflow_dispatch')) {
      say(`warning: ${WORKFLOWS}/${name} runs on release but not on workflow_dispatch, so nothing started it; add workflow_dispatch to its on:`);
      continue;
    }
    if (!branch) {
      say(`the event names no repository.default_branch, so ${WORKFLOWS}/${name} was not started`);
      failed = true;
      continue;
    }
    const input = takesInput(file, 'tag') ? ['-f', `tag=${tag}`] : [];
    const res = spawnSync('gh', ['workflow', 'run', name, '--ref', branch, ...input], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] });
    if (res.status !== 0) {
      say(`dispatch of ${WORKFLOWS}/${name} failed: ${errLine(res)}`);
      failed = true;
      continue;
    }
    say(`started ${WORKFLOWS}/${name} on ${branch}${input.length > 0 ? ` with tag=${tag}` : ''}`);
  }
  return failed ? 1 : 0;
};

/**
 * Release what the push brought and what earlier runs left, then dispatch.
 * @returns {number} the code to exit with
 */
const releasePush = (root, event) => {
  // actions/checkout puts the pushed commit at HEAD, so an event with no `after` reads it there.
  const after = event.after || 'HEAD';

  const pushed = releaseCommits(root, pushedRevs(root, event, after));
  // What the cut would wait for that an earlier run never released: the branch's
  // newest release commit and, by the cut's own walk, every unreleased one below it.
  const history = releaseCommits(root, [after]);
  const late = [];
  if (history.length > 0) {
    const [newest] = history;
    const unpushed = !newest.noRelease && !pushed.some((c) => c.version === newest.version);
    late.push(...missingBefore(root, history, newest.version));
    if (unpushed && !isReleased(root, `v${newest.version}`)) late.push(newest);
  }
  const commits = [...pushed];
  for (const commit of late) {
    if (commits.some((c) => c.version === commit.version)) continue;
    say(`v${commit.version} has a release commit but no release, so it is released too`);
    commits.push(commit);
  }
  commits.sort((a, b) => compareVersions(a.version, b.version));
  if (commits.length === 0) {
    say('no release commit in this push, so no release');
    return 0;
  }
  // A pushed release commit already released dispatches too, so a re-run of a job
  // whose dispatch failed tries it again; the newest such tag is the one passed on.
  let dispatchTag = null;
  for (const commit of commits) {
    const tag = `v${commit.version}`;
    if (commit.noRelease) {
      say(`${tag} carries Release: none, so no release`);
      continue;
    }
    if (isReleased(root, tag)) {
      say(`${tag} is already released`);
      if (pushed.includes(commit)) dispatchTag = tag;
      continue;
    }
    const notes = notesAt(root, commit.sha, commit.version);
    if (notes === null) {
      say(noSection(commit.version));
      return 1;
    }
    const code = create(root, commit, notes);
    if (code !== 0) return code;
    dispatchTag = tag;
  }
  return dispatchTag ? dispatch(root, event.repository?.default_branch, dispatchTag) : 0;
};

const main = (argv) => {
  const root = path.resolve(argv[0] || '.');
  const eventFile = process.env.GITHUB_EVENT_PATH;
  if (!eventFile || !fs.existsSync(eventFile)) {
    say('GITHUB_EVENT_PATH names no event file, so the push cannot be read');
    return 1;
  }
  const event = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
  try {
    return releasePush(root, event);
  } catch (err) {
    if (!(err instanceof ReleaseViewError)) throw err;
    say(err.message);
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
