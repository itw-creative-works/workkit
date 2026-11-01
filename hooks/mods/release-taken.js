/**
 * hooks/mods/release-taken.js: safety:release-taken. Bounces the release
 * commit (`chore(release): <x.y.z>`) and `npm publish` whose version npm or the
 * GitHub release tag already has, while the number is still free to change:
 * the commit judged on its real subject in git's commit-msg hook, the publish
 * read off the Bash text. The lookups run concurrently; a check that cannot be
 * made stands down out loud, never blocking (docs/hooks.md § safety:release-taken).
 */

import {
  PLACEHOLDER, clauseChangesDir, foldRedirectAmp, peelPrefixes, redirectSpan, slugFromRemote, stripHeredocs, stripQuotes, wordsOf,
} from './command.js';
import { VERSION_RE } from './commit-language.js';
import { isPlain, parseJson } from './settings.js';

const RELEASE_SUBJECT = new RegExp(`^chore\\(release\\): (${VERSION_RE})$`);
const GLOB = /[*?[]/;
const LOOKUP_TIMEOUT_MS = 15000;

const STOOD_DOWN = {
  cd: 'release-taken: the command changes directory, so the package being published could not be placed and the check stood down.',
  quoted: 'release-taken: a quoted workspace name could not be read, so the publish could not be placed and the check stood down.',
  empty: 'release-taken: a workspace flag names no workspace, so the publish could not be placed and the check stood down.',
};
const BUMP = 'Bump to a version no provider has yet, then release again. The override is HOOK_DISABLE=1 in the Claude Code environment, which stands every workkit hook aside; the owner alone reaches for it.';

const text = (value) => (typeof value === 'string' ? value : '');
const norm = (path) => path.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
const firstLine = (run, tool) => String(run.stderr ?? '').split('\n')[0] || `${tool} exited ${run.exitCode}`;
const answered = (notices) => (notices.length > 0 ? { context: notices.join('\n') } : null);

// Does a clause RUN `npm publish`? Every clause is walked: the workspaces it
// names are collected, a publishing clause naming none checks them all, and
// a cd, pushd or popd clause anywhere is seen.
function npmPublish(stripped) {
  let found = false;
  let all = false;
  let sawCd = false;
  let unreadable = '';
  const workspaces = [];
  for (const clause of foldRedirectAmp(stripped).split(/[;|&\n]/)) {
    const words = wordsOf(clause);
    if (clauseChangesDir(words)) sawCd = true;
    const { skip, word } = peelPrefixes(words);
    if (!(word === 'npm' || word.endsWith('/npm'))) continue;
    const args = words.slice(skip + 1);
    let sub = '';
    let dry = false;
    let flagged = false;
    const named = [];
    for (let i = 0; i < args.length;) {
      const a = args[i];
      if (a === '--dry-run' || a === '--dry-run=true') {
        dry = true;
        i += 1;
      } else if (a.startsWith('--workspace=') || a.startsWith('-w=')) {
        flagged = true;
        named.push(a.slice(a.indexOf('=') + 1));
        i += 1;
      } else if (a === '--workspace' || a === '-w') {
        flagged = true;
        i += 1;
        while (i < args.length && redirectSpan(args[i]) > 0) i += Math.min(redirectSpan(args[i]), args.length - i);
        named.push(args[i] ?? '');
        i += 1;
      } else if (a[0] === '-') {
        i += 1;
      } else if (a.includes('>') || a.includes('<')) {
        if (redirectSpan(a) === 0 && !sub) sub = a;
        i += Math.min(redirectSpan(a) || 1, args.length - i);
      } else {
        if (!sub) sub = a;
        i += 1;
      }
    }
    if (sub !== 'publish' || dry) continue;
    found = true;
    if (!flagged) {
      all = true;
      continue;
    }
    workspaces.push(...named);
    for (const value of named) {
      if (value === '') unreadable = 'empty';
      else if (value.includes(PLACEHOLDER)) unreadable = 'quoted';
    }
  }
  return all ? { found, sawCd, workspaces: [], unreadable: '' } : { found, sawCd, workspaces, unreadable };
}

/**
 * Whether a command is a publish, read off its text alone: the workspaces it
 * names, a stand-down notice for one behind a directory change, or null for
 * any other command.
 * @param {string} command the Bash command
 * @returns {{trigger: string, workspaces: string[], unreadable: string}|{notice: string}|null}
 */
function releaseTrigger(command) {
  if (!command || !command.includes('publish')) return null;
  const publish = npmPublish(stripQuotes(stripHeredocs(command)));
  if (!publish.found) return null;
  if (publish.sawCd) return { notice: STOOD_DOWN.cd };
  return { trigger: 'publish', workspaces: publish.workspaces, unreadable: publish.unreadable };
}

// The workspace patterns a package.json declares: the array, or the object's `packages`.
function patternsOf(pkg) {
  const declared = isPlain(pkg) ? pkg.workspaces : null;
  const list = Array.isArray(declared) ? declared : isPlain(declared) && Array.isArray(declared.packages) ? declared.packages : [];
  return list.filter((pattern) => typeof pattern === 'string' && pattern !== '');
}

// The project's packages, the root's and each member's, every member left out named.
function packageSet(root, packageJson, members, notices) {
  if (packageJson === null || packageJson === undefined) return [];
  const pkgs = [{ file: `${root}/package.json`, folder: null, pkg: packageJson }];
  const add = (folder) => pkgs.push({ file: `${root}/${folder}/package.json`, folder, pkg: members[folder] });
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

// A publish naming its workspaces: those members alone, matched by package
// name or by path from the root; a stand-down notice when one cannot be placed.
function narrowed(pkgs, workspaces) {
  const found = new Set();
  const kept = pkgs.filter(({ folder, pkg }) => {
    if (folder === null) return false;
    const name = text(isPlain(pkg) ? pkg.name : '');
    const hits = workspaces.filter((want) => want && ((name && want === name) || norm(want) === norm(folder)));
    hits.forEach((want) => found.add(want));
    return hits.length > 0;
  });
  const stray = workspaces.find((want) => want && !found.has(want));
  if (stray) return { notice: `release-taken: the workspace ${stray} is not a member of this project, so the publish could not be placed and the check stood down.` };
  return { pkgs: kept };
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

// The verdict over a plan's gathered project: npm asked for every package with
// publish intent (a publish's named workspaces alone), and a release commit's
// GitHub release tag once.
async function judged(plan, { cwd, packageJson, members = {}, lookups, origin }) {
  const repo = slugFromRemote(origin ?? '') ?? '';
  const notices = [];
  let pkgs = packageSet(cwd, packageJson, members, notices);
  if (plan.trigger === 'publish' && plan.workspaces.length > 0) {
    if (plan.unreadable) return answered([...notices, STOOD_DOWN[plan.unreadable]]);
    const kept = narrowed(pkgs, plan.workspaces);
    if (kept.notice) return answered([...notices, kept.notice]);
    pkgs = kept.pkgs;
  }
  const jobs = jobsOf(pkgs, notices);
  if (plan.trigger === 'commit') jobs.push({ provider: 'github-release', name: repo || 'repo', version: plan.version });
  const answers = await Promise.all(jobs.map((job) => ask(job, lookups)));
  const taken = [];
  answers.forEach((answer, i) => {
    if (answer.notice) notices.push(answer.notice);
    if (!answer.taken) return;
    const { provider, name, version } = jobs[i];
    taken.push(provider === 'github-release' ? `github-release already has v${version}${repo ? ` at ${repo}` : ''}` : `${provider} already has ${name}@${version}`);
  });
  if (taken.length === 0) return answered(notices);
  const what = plan.trigger === 'publish' ? 'this npm publish' : 'this release commit';
  return { deny: [...notices, ...taken.map((line) => `release-taken: BLOCKED ${what}: ${line}`), BUMP].join('\n') };
}

/**
 * release-taken's verdict on a Bash command: an `npm publish` whose version
 * npm already has bounces.
 * @param {object} facts
 * @param {string} facts.command the Bash command
 * @param {string} facts.cwd the project folder, the cwd
 * @param {object|null|false} facts.packageJson the parsed root package.json, null when absent, false when it does not parse
 * @param {object} facts.members each workspace member's parsed package.json (false when it does not parse) by folder from the root
 * @param {{npm: function, github: function}} facts.lookups `npm(name, version)` and `github(tag)`, async, `{ exitCode, stdout, stderr }`
 * @param {string} [facts.origin] the project's origin remote url, '' or absent for none; the bounce names its owner/name
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function releaseTakenVerdict({ command, ...project }) {
  const plan = releaseTrigger(command);
  if (!plan) return null;
  if (plan.notice) return { context: plan.notice };
  return judged(plan, project);
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
  return judged({ trigger: 'commit', version: version.replace(/^v/, '') }, {
    cwd: root,
    ...(await projectOf(root, facts)),
    origin: await originOf(root, facts.run),
    lookups: lookupsAt(root, facts.run),
  });
}

/**
 * The guard's run over the Bash facts: the project, its packages and the
 * lookups are gathered only for a command that is a publish.
 * @param {{command: string, cwd: string, read: function, list: function, run: function}} facts
 *   the chain's facts and reads
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function releaseTakenGuard(facts) {
  const plan = releaseTrigger(facts.command);
  if (!plan || plan.notice) return plan && { context: plan.notice };
  if (!facts.cwd) return null;
  return judged(plan, {
    cwd: facts.cwd,
    ...(await projectOf(facts.cwd, facts)),
    origin: '',
    lookups: lookupsAt(facts.cwd, facts.run),
  });
}
