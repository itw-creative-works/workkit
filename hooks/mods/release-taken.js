/**
 * hooks/mods/release-taken.js: safety:release-taken. Bounces the release
 * commit (`chore(release): <x.y.z>`) and `npm publish` whose version npm or the
 * GitHub release tag already has, while the number is still free to change.
 * The lookups run concurrently; a check that cannot be made stands down out
 * loud, never blocking (docs/hooks.md § safety:release-taken).
 */

import {
  BLANK, PLACEHOLDER, VERSION_RE, findGitCommit, foldRedirectAmp, peelPrefixes, redirectSpan, slugFromRemote, stripHeredocs, stripQuotes, wordsOf,
} from './command.js';
import { isPlain, parseJson } from './settings.js';

const SUBJECT = `chore\\(release\\): ${VERSION_RE}`;
const SUBJECT_AT = new RegExp(`(^|${BLANK})(-m|--message)[ \\t\\r\\f\\v=]*["']?${SUBJECT}|^${BLANK}*["']?${SUBJECT}`, 'm');
const FILE_FLAG = /(^|[ \t\r\f\v])(-[A-Za-z]*F|--file)([ \t\r\f\v=]|$)/m;
const GLOB = /[*?[]/;
const LOOKUP_TIMEOUT_MS = 15000;

const STOOD_DOWN = {
  file: 'release-taken: the commit message is in a file, so the release subject could not be read and the check stood down.',
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
// names are collected, and a publishing clause naming none checks them all.
function npmPublish(stripped) {
  let found = false;
  let all = false;
  let unreadable = '';
  const workspaces = [];
  for (const clause of foldRedirectAmp(stripped).split(/[;|&\n]/)) {
    const words = wordsOf(clause);
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
  return all ? { found, workspaces: [], unreadable: '' } : { found, workspaces, unreadable };
}

/**
 * Which trigger a command is, read off its text alone: the release commit and
 * its version, a publish and the workspaces it names, a stand-down notice for
 * the two it cannot place, or null for any other command.
 * @param {string} command the Bash command
 * @returns {{trigger: string, version?: string, workspaces?: string[], unreadable?: string}|{notice: string}|null}
 */
function releaseTrigger(command) {
  if (!command) return null;
  if (!command.includes('chore(release)') && !command.includes('publish')
    && !(command.includes('commit') && (command.includes('-F') || command.includes('--file')))) return null;
  const stripped = stripQuotes(stripHeredocs(command));
  const found = findGitCommit(command);
  if (found.clause || found.wrapped) {
    const match = command.match(SUBJECT_AT)?.[0];
    if (match) return { trigger: 'commit', version: match.slice(match.lastIndexOf(': ') + 2).replace(/^v/, '') };
    if (FILE_FLAG.test(stripped)) return { notice: STOOD_DOWN.file };
  }
  const publish = npmPublish(stripped);
  if (!publish.found) return null;
  if (found.sawCd) return { notice: STOOD_DOWN.cd };
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

// One job per package with publish intent (workflow/ship/publish-plan.js's rule).
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

/**
 * release-taken's verdict on a Bash command.
 * @param {object} facts
 * @param {string} facts.command the Bash command
 * @param {string} facts.cwd the project folder: the git toplevel for a commit, the cwd for a publish
 * @param {object|null|false} facts.packageJson the parsed root package.json, null when absent, false when it does not parse
 * @param {object} facts.members each workspace member's parsed package.json (false when it does not parse) by folder from the root
 * @param {{npm: function, github: function}} facts.lookups `npm(name, version)` and `github(tag)`, async, `{ exitCode, stdout, stderr }`
 * @param {string} [facts.origin] the project's origin remote url, '' or absent for none; the bounce names its owner/name
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function releaseTakenVerdict({ command, cwd, packageJson, members = {}, lookups, origin }) {
  const plan = releaseTrigger(command);
  if (!plan) return null;
  if (plan.notice) return { context: plan.notice };
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

/**
 * The guard's run over the Bash facts: the project, its packages and the
 * lookups are gathered only for a command that is a trigger.
 * @param {{command: string, cwd: string, top: function, read: function, list: function, run: function}} facts
 *   the chain's facts and reads
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function releaseTakenGuard(facts) {
  const plan = releaseTrigger(facts.command);
  if (!plan || plan.notice) return plan && { context: plan.notice };
  const root = plan.trigger === 'commit' ? await facts.top(facts.cwd) : facts.cwd;
  if (!root) return null;
  const packageJson = await readPackage(facts.read, `${root}/package.json`);
  const members = {};
  for (const pattern of patternsOf(packageJson)) {
    const dir = pattern.slice(0, pattern.lastIndexOf('/'));
    const folders = pattern.endsWith('/*') ? (await facts.list(`${root}/${dir}`)).map((name) => `${dir}/${name}`) : [pattern];
    for (const folder of GLOB.test(pattern) && !pattern.endsWith('/*') ? [] : folders) {
      const pkg = await readPackage(facts.read, `${root}/${folder}/package.json`);
      if (pkg !== null) members[folder] = pkg;
    }
  }
  const at = { cwd: root, timeoutMs: LOOKUP_TIMEOUT_MS };
  return releaseTakenVerdict({
    command: facts.command,
    cwd: root,
    packageJson,
    members,
    origin: plan.trigger === 'commit' ? await originOf(root, facts.run) : '',
    lookups: {
      npm: (name, version) => facts.run(['npm', 'view', '--no-update-notifier', '--fetch-retries=0', '--fetch-timeout=15000', `${name}@${version}`, 'version'], at),
      github: (tag) => facts.run(['gh', 'release', 'view', tag, '--json', 'tagName', '-q', '.tagName'], at),
    },
  });
}
