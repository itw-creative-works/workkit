/**
 * hooks/mods/suite-guard.js: safety:suite-guard. Bounces a full suite run (the
 * root `npm test`, the root's test script run directly, `workkit prove`) on a
 * tree the suite record already holds, or while an open issue is at
 * status:building; a narrowed run and a mention pass (docs/hooks.md §
 * safety:suite-guard).
 */

import { cdStep, foldRedirectAmp, namesDirChange, stepDirs, stripHeredocs, stripQuotes, unquoteWord, wordsOf } from './command.js';
import { buildingList } from './gh.js';
import { userDirOf } from './log.js';
import { suiteMarkerPath } from './markers.js';
import { fold, isAbsolute } from './optin.js';
import { issuesBuilding } from './proof.js';
import { parseJson } from './settings.js';
import { factOf, suiteProved, testPackageDir, treeHash } from './suite.js';

const SP = '[ \\t\\n\\r\\f\\v]';
const NPM_RE = new RegExp(`(^|[^A-Za-z0-9_./-])npm(${SP}+(-(-prefix|C|w|-workspace)${SP}+[^- \\t\\n\\r\\f\\v][^ \\t\\n\\r\\f\\v]*|-[^ \\t\\n\\r\\f\\v]+))*${SP}+(run${SP}+test|test|t)`);
const PROVE_RE = /(^|[ \t\r\f\v;|&(])([^ \t\r\f\v;|&()\n]*\/)?workkit(\.sh)?[ \t\r\f\v]+prove([ \t\r\f\v;|&)<>]|$)/m;
const NPM_CONFIG = /[Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_/;
const FOLDER_FLAGS = new Set(['--prefix', '-C', '-w', '--workspace']);
const QUIET_FLAGS = new Set(['-s', '--silent', '-q', '--quiet', '--if-present']);
const ALL_MEMBERS = new Set(['-ws', '--workspaces', '--workspaces=true']);
const NARROW = "Run the narrowest test that proves the change (`npm test -- <file>` from the package's folder)";


// The path where it really is when `real` is given (null when it is not
// there), else as folded text: a cwd spelled through a link compares physical.
const located = async (path, real) => (real ? real(fold(path)) : fold(path));

// The folder relative to the root, '' for the root and for a folder outside
// it or not there, as `cd <dir> && git rev-parse --show-prefix` answered.
async function prefixIn(root, dir, real) {
  const at = await located(dir, real);
  if (!at) return '';
  const here = fold(at).replace(/\/+$/, '');
  const top = fold((await located(root, real)) ?? root).replace(/\/+$/, '');
  return here.startsWith(`${top}/`) ? here.slice(top.length + 1) : '';
}

/**
 * Whether the text runs `workkit prove` (the command, or the engine's
 * workkit.sh by any path): the full suite on the staged tree.
 * @param {string} text the command text
 * @returns {boolean}
 */
function isProveRun(text) {
  return text.includes('prove') && PROVE_RE.test(text);
}

// The verdict a run's tail gives: false when the match runs on into a longer
// word, else whether it is the whole run (an npm run narrowed by `--` is not).
function wholeRun(tail, kind) {
  const s = tail.replace(/[ \t\n\r\f\v]*[0-9]*[;|&<>)][\s\S]*$/, '');
  if (s !== '' && !/^[ \t\n\r\f\v]/.test(s)) return false;
  if (kind === 'npm') return !/^[ \t\n\r\f\v]*--[ \t\n\r\f\v]+[^ \t\n\r\f\v]/.test(s);
  return !/[^ \t\n\r\f\v]/.test(s);
}

// Does a line run the script by its text, as a whole run?
function runsScript(text, script) {
  for (const line of text.split('\n')) {
    let pos = 0;
    let i;
    while ((i = line.indexOf(script, pos)) !== -1) {
      const pre = i === 0 ? '' : line[i - 1];
      pos = i + script.length;
      if (pre !== '' && !/[ \t\n\r\f\v;|&(]/.test(pre)) continue;
      if (wholeRun(line.slice(pos), 'script')) return true;
    }
  }
  return false;
}

// Each whole npm run in the command: its step's folder, the step, and its
// words from `npm` on.
function npmRuns(text) {
  const runs = [];
  for (const { dir, text: step } of stepDirs(text)) {
    let rest = step;
    let m;
    while ((m = rest.match(NPM_RE))) {
      const words = rest.slice(m.index).replace(/^[^n]*/, '');
      rest = rest.slice(m.index + m[0].length);
      if (wholeRun(rest, 'npm')) runs.push({ dir, step, words });
    }
  }
  return runs;
}

// The folder npm's `-w <name>` names: <dir>/<name> when that is a package
// folder, else the package called <name> (a nameless one by its folder's name).
async function memberOf({ root, real }, dir, name, members) {
  const named = fold(`${dir}/${name}`);
  if (Object.hasOwn(members, await prefixIn(root, named, real))) return named;
  for (const [folder, pkg] of Object.entries(members)) {
    const own = typeof pkg?.name === 'string' ? pkg.name : '';
    if (own === name || (own === '' && folder.split('/').pop() === name)) return `${root}/${folder}`;
  }
  return null;
}

// <dir>'s nearest tested package is the root, so `npm test` there is the root's suite.
async function atRoot({ root, real }, dir, members) {
  const tested = async (d) => typeof members[d]?.test === 'string' && members[d].test.length > 0;
  return (await testPackageDir(await prefixIn(root, dir, real), tested)) === '';
}

// An npm run from <dir> (its cd steps' folder: '' the cwd, relative, absolute
// or `?`) reaches the root's script, npm's folder flags moving it; a flag not
// known here is judged full, since npm takes any unambiguous abbreviation.
async function npmFull(at, stepDir, argv) {
  const { cwd, members } = at;
  if (stepDir === '?') return true;
  let dir = stepDir === '' ? cwd : isAbsolute(stepDir) ? stepDir : `${cwd}/${stepDir}`;
  let prefix = '';
  let all = false;
  const names = [];
  const words = argv.slice(1);
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === '--') break;
    if (FOLDER_FLAGS.has(w)) {
      if (i + 1 >= words.length) return true;
      i += 1;
      if (w === '-w' || w === '--workspace') names.push(unquoteWord(words[i]));
      else prefix = unquoteWord(words[i]);
    } else if (w.startsWith('--prefix=')) {
      prefix = unquoteWord(w.slice('--prefix='.length));
    } else if (w.startsWith('--workspace=')) {
      names.push(unquoteWord(w.slice('--workspace='.length)));
    } else if (ALL_MEMBERS.has(w)) {
      all = true;
    } else if (!QUIET_FLAGS.has(w) && w.startsWith('-')) {
      return true;
    }
  }
  if (prefix !== '') dir = isAbsolute(prefix) ? prefix : `${dir}/${prefix}`;
  if (all) return false;
  if (names.length > 0) {
    const found = await members();
    for (const name of names) {
      const member = await memberOf(at, dir, name, found);
      if (member === null || (await atRoot(at, member, found))) return true;
    }
    return false;
  }
  return atRoot(at, dir, await members());
}

/**
 * Whether the command runs the root's suite: its test script by its text,
 * `workkit prove`, or npm's spellings of the suite in the folder its cd steps
 * and npm's folder flags leave, judged by the nested-package rule. Every
 * occurrence is judged.
 * @param {string} command the command text
 * @param {{root: string, cwd: string, testScript: string, members: function, real?: function}} at
 *   the repo root, the folder the command starts in, the root's scripts.test, `members()` async,
 *   `{ [folder]: { name, test } }` (memberDirs), and `real(path)` async where a path really is
 * @returns {Promise<boolean>}
 */
async function suiteRootRun(command, at) {
  const { testScript } = at;
  if (!testScript) return false;
  if (isProveRun(command)) return true;
  const cmd = foldRedirectAmp(command);
  const script = foldRedirectAmp(testScript);
  if (runsScript(cmd, script)) return true;
  if (!NPM_RE.test(cmd)) return false;
  for (const { dir, step, words } of npmRuns(cmd)) {
    if (NPM_CONFIG.test(cmd)) return true;
    const from = namesDirChange(step) ? cdStep(dir, step) : dir;
    if (await npmFull(at, from, wordsOf(words))) return true;
  }
  return false;
}

/**
 * suite-guard's verdict on a Bash command: the proved-tree bounce, the building
 * hold, a notice when GitHub could not answer, else null (lazy: see factOf).
 * @param {{command: string, cwd: string, root: string|null, testScript: string,
 *   memberDirs: object|function, suiteRecord: string|null|function, treeId: string|null|function,
 *   building: function, originless?: boolean|function, home?: string, real?: function}} facts
 *   the command, its folder, the repo root, the root's scripts.test; each member below the root
 *   as `{ [folder]: { name, test } }` (lazy); the suite record (lazy); the tree (lazy, `(prove)`:
 *   the index's for prove); gh's status:building list, async, null on failure; no origin (lazy);
 *   the machine folder, for the record's path; `real(path)` async, the physical path or null when not there
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function suiteGuardVerdict({
  command, cwd, root, testScript, memberDirs, suiteRecord, treeId, building, originless, home, real,
}) {
  if (!command || !root) return null;
  let found;
  const members = async () => (found ??= (await factOf(memberDirs)) ?? {});
  const at = { root, cwd, testScript, members, real };
  if (!(await suiteRootRun(command, at))) return null;
  const stripped = stripQuotes(stripHeredocs(command));
  if (!(await suiteRootRun(stripped, at))) return null;
  const tree = await factOf(treeId, isProveRun(stripped));
  if (suiteProved(await factOf(suiteRecord), tree)) {
    return { deny: `suite-guard: this tree is already proved: the full suite ran green on it and ${await suiteMarkerPath(root, home)} records it. ${NARROW}; the commit gate reads the same record for a commit whose staged tree matches it.` };
  }
  if (await factOf(originless)) return null;
  const list = await building();
  const numbers = list === null ? null : issuesBuilding(list);
  if (numbers === null) {
    return { context: 'suite-guard: could not read the open issues at status:building (gh could not answer), so the building hold did not run on this command.' };
  }
  if (numbers.length === 0) return null;
  const named = numbers.map((n) => `#${n} (status:building)`).join(', ');
  return { deny: `suite-guard: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: ${named}. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item to get past this guard. ${NARROW}.` };
}

/**
 * Every package under the root but the root itself, by folder, as its name
 * and scripts.test (each null when absent): the tracked and untracked
 * package.json files git lists, outside node_modules; one that does not parse is left out.
 * @param {string} root the repo root
 * @param {{run: function, read: function}} io the chain's reads
 * @returns {Promise<object>} `{ [folder]: { name, test } }`
 */
async function packageFiles(root, { run, read }) {
  const listed = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  const files = {};
  if (listed.exitCode !== 0) return files;
  for (const path of listed.stdout.split('\0')) {
    if (!path.endsWith('/package.json') || `/${path}`.includes('/node_modules/')) continue;
    const folder = path.slice(0, -'/package.json'.length);
    const pkg = parseJson(await read(`${root}/${path}`));
    if (!pkg || typeof pkg !== 'object') continue;
    const test = pkg.scripts?.test;
    files[folder] = { name: typeof pkg.name === 'string' ? pkg.name : null, test: typeof test === 'string' ? test : null };
  }
  return files;
}

/**
 * The guard's run over the Bash facts: the root's test script read first, and
 * the members, the tree id, the record and GitHub only when the verdict asks.
 * @param {object} facts the chain's facts (guards.js)
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function suiteGuardGuard(facts) {
  if (!facts.command) return null;
  const root = await facts.top(facts.cwd);
  if (!root) return null;
  const pkg = parseJson(await facts.read(`${root}/package.json`));
  const test = pkg && typeof pkg === 'object' ? pkg.scripts?.test : undefined;
  const testScript = test === undefined || test === null ? '' : String(test);
  if (!testScript) return null;
  const at = { cwd: root };
  return suiteGuardVerdict({
    command: facts.command,
    cwd: facts.cwd,
    root,
    testScript,
    memberDirs: () => packageFiles(root, facts),
    suiteRecord: async () => facts.read(await suiteMarkerPath(root, userDirOf(facts.env))),
    treeId: async (prove) => {
      if (!prove) return treeHash(facts.run, facts.pluginRoot, root);
      const tree = await facts.run(['git', 'write-tree'], at);
      return tree.exitCode === 0 ? tree.stdout.trim() || null : null;
    },
    originless: () => facts.originless(),
    building: () => buildingList(facts.run, at),
    home: userDirOf(facts.env),
    real: facts.real,
  });
}
