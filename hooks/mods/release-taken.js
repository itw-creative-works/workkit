/**
 * hooks/mods/release-taken.js: safety:release-taken. Bounces the release
 * commit (`chore(release): <x.y.z>`) whose version npm or the GitHub release
 * tag already has, while the number is still free to change, judged on its
 * real subject in git's commit-msg hook. The lookups run concurrently; a check
 * that cannot be made stands down out loud, never blocking
 * (docs/hooks.md § safety:release-taken).
 */

import { VERSION_RE } from './commit-language.js';
import { isPlain, parseJson } from './settings.js';
import { slugFromRemote } from './slug.js';

/**
 * A release commit's subject, `chore(release): <x.y.z>`, its version the first
 * group (a leading `v` included): the one rule this hook and the ship's cut read.
 */
export const RELEASE_SUBJECT = new RegExp(`^chore\\(release\\): (${VERSION_RE})$`);
const GLOB = /[*?[]/;
const LOOKUP_TIMEOUT_MS = 15000;

const BUMP = 'Bump to a version no provider has yet, then release again. The override is HOOK_DISABLE=1 in the Claude Code environment, which stands every workkit hook aside; the owner alone reaches for it.';

const text = (value) => (typeof value === 'string' ? value : '');
const firstLine = (run, tool) => String(run.stderr ?? '').split('\n')[0] || `${tool} exited ${run.exitCode}`;
const answered = (notices) => (notices.length > 0 ? { context: notices.join('\n') } : null);

// The workspace patterns a package.json declares: the array, or the object's `packages`.
function patternsOf(pkg) {
  const declared = isPlain(pkg) ? pkg.workspaces : null;
  const list = Array.isArray(declared) ? declared : isPlain(declared) && Array.isArray(declared.packages) ? declared.packages : [];
  return list.filter((pattern) => typeof pattern === 'string' && pattern !== '');
}

// The project's packages, the root's and each member's, every member left out named.
function packageSet(root, packageJson, members, notices) {
  if (packageJson === null || packageJson === undefined) return [];
  const pkgs = [{ file: `${root}/package.json`, pkg: packageJson }];
  const add = (folder) => pkgs.push({ file: `${root}/${folder}/package.json`, pkg: members[folder] });
  for (const pattern of patternsOf(packageJson)) {
    if (pattern.endsWith('/*')) {
      const dir = pattern.slice(0, pattern.lastIndexOf('/'));
      const hits = Object.keys(members).filter((key) => key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes('/'));
      if (hits.length > 0) hits.forEach(add);
      else notices.push(`release-taken: the workspace pattern ${pattern} matched no package, so nothing under it was checked.`);
    } else if (GLOB.test(pattern)) {
      notices.push(`release-taken: the workspace pattern ${pattern} was not expanded, so its packages were not checked.`);
    } else if (Object.hasOwn(members, pattern)) {
      add(pattern);
    } else {
      notices.push(`release-taken: the workspace member ${pattern} holds no package.json, so it was not checked.`);
    }
  }
  return pkgs;
}

// One job per package with publish intent (workflow/ship/plan.js's rule).
function jobsOf(pkgs, notices) {
  const jobs = [];
  for (const { file, pkg } of pkgs) {
    if (!isPlain(pkg)) {
      notices.push(`release-taken: ${file} could not be read as JSON, so that package was not checked.`);
      continue;
    }
    const intent = pkg.private === false && ((pkg.files ?? null) !== null || (pkg.publishConfig ?? null) !== null);
    if (intent && text(pkg.name) && text(pkg.version)) jobs.push({ provider: 'npm', name: pkg.name, version: pkg.version });
  }
  return jobs;
}

// One lookup's answer: taken, free, or a stand-down notice.
async function ask(job, lookups) {
  if (job.provider === 'github-release') {
    const run = await lookups.github(`v${job.version}`);
    if (run.exitCode !== 0) {
      if (/release not found/i.test(String(run.stderr ?? ''))) return {};
      return { notice: `release-taken: the github-release check stood down for v${job.version}: ${firstLine(run, 'gh')}` };
    }
    return { taken: String(run.stdout ?? '').replace(/\s/g, '') === `v${job.version}` };
  }
  const run = await lookups.npm(job.name, job.version);
  if (run.exitCode !== 0) {
    if (String(run.stderr ?? '').includes('E404')) return {};
    return { notice: `release-taken: the npm check stood down for ${job.name}@${job.version}: ${firstLine(run, 'npm')}` };
  }
  return { taken: String(run.stdout ?? '').replace(/\s/g, '') === job.version };
}

// The verdict over a release commit's gathered project: npm asked for every
// package with publish intent, and the GitHub release tag once.
async function judged(version, { cwd, packageJson, members = {}, lookups, origin }) {
  const repo = slugFromRemote(origin ?? '') ?? '';
  const notices = [];
  const jobs = jobsOf(packageSet(cwd, packageJson, members, notices), notices);
  jobs.push({ provider: 'github-release', name: repo || 'repo', version });
  const answers = await Promise.all(jobs.map((job) => ask(job, lookups)));
  const taken = [];
  answers.forEach((answer, i) => {
    if (answer.notice) notices.push(answer.notice);
    if (!answer.taken) return;
    const { provider, name, version: had } = jobs[i];
    taken.push(provider === 'github-release' ? `github-release already has v${had}${repo ? ` at ${repo}` : ''}` : `${provider} already has ${name}@${had}`);
  });
  if (taken.length === 0) return answered(notices);
  return { deny: [...notices, ...taken.map((line) => `release-taken: BLOCKED this release commit: ${line}`), BUMP].join('\n') };
}

// The project's origin remote url, '' when it has none.
async function originOf(root, run) {
  const remote = await run(['git', 'remote', 'get-url', 'origin'], { cwd: root });
  return remote.exitCode === 0 ? remote.stdout : '';
}

// A package.json as the verdict reads it: null when absent, false when it does not parse.
async function readPackage(read, path) {
  const raw = await read(path);
  return raw === null ? null : parseJson(raw) ?? false;
}

// The project at `root`, read off disk: its package.json and each workspace member's.
async function projectOf(root, { read, list }) {
  const packageJson = await readPackage(read, `${root}/package.json`);
  const members = {};
  for (const pattern of patternsOf(packageJson)) {
    const dir = pattern.slice(0, pattern.lastIndexOf('/'));
    const folders = pattern.endsWith('/*') ? (await list(`${root}/${dir}`)).map((name) => `${dir}/${name}`) : [pattern];
    for (const folder of GLOB.test(pattern) && !pattern.endsWith('/*') ? [] : folders) {
      const pkg = await readPackage(read, `${root}/${folder}/package.json`);
      if (pkg !== null) members[folder] = pkg;
    }
  }
  return { packageJson, members };
}

// The two lookups, run from the project root.
function lookupsAt(root, run) {
  const at = { cwd: root, timeoutMs: LOOKUP_TIMEOUT_MS };
  return {
    npm: (name, version) => run(['npm', 'view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', `${name}@${version}`, 'version'], at),
    github: (tag) => run(['gh', 'release', 'view', tag, '--json', 'tagName', '-q', '.tagName'], at),
  };
}

/**
 * release-taken's verdict on a release commit's subject (`chore(release):
 * <x.y.z>`), judged in git's commit-msg hook: npm asked for every package with
 * publish intent and GitHub for the release `v<x.y.z>`. Any other subject is null.
 * @param {{subject: string, root: string, facts: {read: function, list: function, run: function}}} args
 *   the message's first line, the repo root, and the machine's reads
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function releaseCommitVerdict({ subject, root, facts }) {
  const version = subject.trim().match(RELEASE_SUBJECT)?.[1];
  if (!version) return null;
  return judged(version.replace(/^v/, ''), {
    cwd: root,
    ...(await projectOf(root, facts)),
    origin: await originOf(root, facts.run),
    lookups: lookupsAt(root, facts.run),
  });
}
