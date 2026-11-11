/**
 * hooks/mods/board-guard.js: docs:board-guard's verdicts on an AGENTS.md write
 * and on a markdown write's shape, and the budget measurement docs:state-check
 * announces from too (docs/hooks.md § docs:board-guard).
 */

import { repoPathOf } from './optin.js';
import { rowsOf } from './session-guard.js';
import { bulletsOn, rootSettings, shapePaths } from './settings.js';

export const AGENTS_MAX_LINES = 250;
export const AGENTS_MAX_BYTES = 400;

/**
 * The plural ending a count takes: '' for one, 's' for any other.
 * @param {number} n the count
 * @returns {string}
 */
export const plural = (n) => (n === 1 ? '' : 's');

const encoder = new TextEncoder();
// Either separator: a Windows path's backslashes read as slashes.
const pathParts = (path) => String(path ?? '').split(/[\\/]/);
const baseName = (path) => pathParts(path).pop();

/**
 * An AGENTS.md text against its budget, counted as awk counts records and in
 * BYTES, so one rule judges every platform alike.
 * @param {string} text the file's text
 * @returns {{lines: number, dense: number, named: string}} the line count, the
 *   lines over AGENTS_MAX_BYTES, and the first three as `line N (M bytes)`
 */
export function agentsBudget(text) {
  const rows = rowsOf(text);
  const offenders = [];
  rows.forEach((row, i) => {
    const bytes = encoder.encode(row).length;
    if (bytes > AGENTS_MAX_BYTES) offenders.push(`line ${i + 1} (${bytes} bytes)`);
  });
  const more = offenders.length > 3 ? `, and ${offenders.length - 3} more` : '';
  return { lines: rows.length, dense: offenders.length, named: `${offenders.slice(0, 3).join(', ')}${more}` };
}

/**
 * The bounce for a write that leaves AGENTS.md past its budget, or null.
 * @param {string} path the written file's path
 * @param {string|null|undefined} text the file's text, null when it is gone
 * @param {string} [spec] the spec the bounce names
 * @returns {string|null}
 */
export function boardGuardVerdict(path, text, spec = 'docs/project-state.md') {
  if (baseName(path) !== 'AGENTS.md' || typeof text !== 'string') return null;
  const { lines, dense, named } = agentsBudget(text);
  const violations = [];
  if (lines > AGENTS_MAX_LINES) {
    violations.push(`AGENTS BUDGET: ${lines} lines (max ${AGENTS_MAX_LINES}). AGENTS.md is the architectural overview; deep references move to docs/<topic>.md and AGENTS.md keeps a pointer line.`);
  }
  if (dense > 0) {
    violations.push(`AGENTS DENSITY: ${named}. No line may exceed ${AGENTS_MAX_BYTES} bytes. A markdown paragraph is one source line, so AGENTS.md passes the ${AGENTS_MAX_LINES}-line budget while carrying a book. Bulletize those lines, or move the detail to docs/<topic>.md and keep a pointer here.`);
  }
  if (violations.length === 0) return null;
  const list = violations.map((line) => `  - ${line}`).join('\n');
  return `board-guard: AGENTS.md violates the document rules of the project-state spec v4 (spec: ${spec}). Fix these NOW, before any other work:\n${list}`;
}

export const SHAPE_EXEMPT = ['CHANGELOG.md', 'LICENSE.md'];
// The issue forms' folders: a form is an issue body, its `## Spec` line read literally.
export const SHAPE_EXEMPT_DIRS = ['ISSUE_TEMPLATE', 'issue-forms'];

// What a line outside front matter and fences may open with, after its indent:
// a heading, a list marker, a table row, a quote, a tag, a placeholder, or it is
// a rule line or an import line (`@` and a path with no space, alone).
const SHAPED = /^(#|[-*+] |\d+\. |\||>|<|\{\{|\{%|---\s*$|@\S+\s*$)/;
const RULE = /^---\s*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const FENCE_LINE = /^(`+|~+)$/;

// Whether a line closes a fence opened by `opener`: only a run of its character, at least as long.
const closesFence = (line, opener) => {
  const run = FENCE_LINE.exec(line.trim())?.[1];
  return run !== undefined && run[0] === opener[0] && run.length >= opener.length;
};

// The run a line opens a fence with, or null: a backtick fence's info string holds no backtick.
const fenceOpener = (line) => {
  const run = FENCE_OPEN.exec(line)?.[1];
  return run === undefined || (run[0] === '`' && line.includes('`', run.length)) ? null : run;
};

/**
 * A markdown text against the doc shape: its paragraph lines, and its lines
 * over AGENTS_MAX_BYTES, split and counted as agentsBudget counts them. Front
 * matter is never judged; a fenced block is never prose, its bytes still count.
 * @param {string} text the file's text
 * @returns {{prose: number[], dense: number[], rows: string[]}} the 1-based line
 *   numbers of each, and the lines they number
 */
export function docShape(text) {
  const rows = rowsOf(text);
  const close = RULE.test(rows[0] ?? '') ? rows.findIndex((row, i) => i > 0 && RULE.test(row)) : -1;
  const prose = [];
  const dense = [];
  let fence = null;
  rows.forEach((row, i) => {
    if (i <= close) return;
    if (encoder.encode(row).length > AGENTS_MAX_BYTES) dense.push(i + 1);
    const line = row.trimStart();
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      return;
    }
    fence = fenceOpener(line);
    if (fence === null && line.trim() !== '' && !SHAPED.test(line)) prose.push(i + 1);
  });
  return { prose, dense, rows };
}

// Whether the shape is judged at all: a `.md` text whose name and folder are not exempt.
const shapeJudged = (path, text) => {
  const [name, folder] = pathParts(path).reverse();
  return typeof text === 'string' && name.endsWith('.md')
    && !SHAPE_EXEMPT.includes(name) && !SHAPE_EXEMPT_DIRS.includes(folder);
};

/**
 * Whether a path is in the doc set the docs.paths setting names: an entry
 * ending in `/` is a folder, every `.md` under it at any depth, `./` the repo
 * root; any other entry is one file.
 * @param {string} rel the file's path from the repo root, forward slashes
 * @param {string[]} paths the setting (shapePaths)
 * @returns {boolean}
 */
export function inDocSet(rel, paths) {
  return paths.some((entry) => {
    const from = entry.replace(/^\.\//, '');
    return entry.endsWith('/') ? rel.endsWith('.md') && rel.startsWith(from) : rel === from;
  });
}

// Up to three of one half's offenders as `<label>: line N`, `and K more` on the third.
const firstThree = (label, named) => named.slice(0, 3).map((item, i) => (
  i === 2 && named.length > 3 ? `${label}: ${item}, and ${named.length - 3} more` : `${label}: ${item}`));

// One half's offenders the write added, in order: each index-copy offender's
// text excuses one written offender with the same text.
const added = (now, was, half) => {
  const left = new Map();
  for (const n of was[half]) left.set(was.rows[n - 1], (left.get(was.rows[n - 1]) ?? 0) + 1);
  return now[half].filter((n) => {
    const count = left.get(now.rows[n - 1]) ?? 0;
    if (count > 0) left.set(now.rows[n - 1], count - 1);
    return count === 0;
  });
};

// One half's lines when its count rose past the index copy's: the new count
// as `counted(n)` names it, the old one, then the first three the write added.
const roseLines = (label, counted, half, now, was, named) => (now[half].length > was[half].length
  ? [`${label}: ${counted(now[half].length)}, ${was[half].length} before`, ...firstThree(label, added(now, was, half).map(named))]
  : []);

/**
 * The bounce for a `.md` write while `on` is true that leaves more paragraph
 * lines, or more lines over AGENTS_MAX_BYTES, than the index copy holds, each
 * count on its own; else null. CHANGELOG.md, LICENSE.md and the issue forms pass.
 * @param {string} path the written file's path
 * @param {string|null|undefined} text the file's text, null when it is gone
 * @param {string|null} before the index copy's text, null for a new file
 * @param {boolean} on the docs.bullets setting (bulletsOn)
 * @param {string} [spec] the spec the bounce names
 * @returns {string|null}
 */
export function docShapeVerdict(path, text, before, on, spec = 'docs/project-state.md') {
  if (on !== true || !shapeJudged(path, text)) return null;
  const now = docShape(text);
  const was = typeof before === 'string' ? docShape(before) : { prose: [], dense: [], rows: [] };
  const list = [
    ...roseLines('DOC PROSE', (n) => `${n} paragraph line${plural(n)}`, 'prose', now, was, (n) => `line ${n}`),
    ...roseLines('DOC DENSITY', (n) => `${n} line${plural(n)} over ${AGENTS_MAX_BYTES} bytes`, 'dense', now, was, (n) => `line ${n} (${encoder.encode(now.rows[n - 1]).length} bytes)`),
  ].map((line) => `  - ${line}`).join('\n');
  if (list === '') return null;
  return `board-guard: ${baseName(path)} breaks the markdown shape (spec: ${spec} § Enforcement). Fix these NOW, before any other work:\n${list}\nEvery line outside front matter and fences opens with a heading, a list marker, a table row, a quote, a tag, a placeholder, an import line or a rule line, and no line passes ${AGENTS_MAX_BYTES} bytes. A write may leave neither count above the file's copy in the git index, which a new file does not have. Make each prose line a bullet, and split each dense line into bullets.`;
}

/**
 * docs:board-guard's whole verdict on a write: the AGENTS.md budget first,
 * then the doc shape, while docs.bullets is on and the file is in the doc set.
 * `repo` is asked only for a `.md` write not exempt by name or folder, `before`
 * only for a file the shape judges.
 * @param {string|null} path the written file's path
 * @param {string|null|undefined} text the file's text, null when it is gone
 * @param {string} spec the spec the bounce names
 * @param {function} repo async, `{ settings, rel, before }` (boardGuardRepo)
 * @returns {Promise<string|null>}
 */
export async function boardGuardGather(path, text, spec, repo) {
  const budget = boardGuardVerdict(path, text, spec);
  if (budget || !shapeJudged(path, text)) return budget;
  const { settings, rel, before } = await repo();
  if (!bulletsOn(settings)) return null;
  const paths = shapePaths(settings);
  if (paths === null) {
    return `board-guard: docs.paths in the settings is not an array of path strings (spec: ${spec} § Enforcement). Set it in the repo's .workkit/settings.json or the machine's ~/.workkit/settings.json to an array of paths from the repo root, each a .md file or a folder ending in / (./ for the root), with no leading / and no backslash.`;
  }
  if (typeof rel !== 'string' || !inDocSet(rel, paths)) return null;
  return docShapeVerdict(path, text, await before(), true, spec);
}

/**
 * A written file's repo facts through a mod's io: its repo's merged settings,
 * its path from the root (repoPathOf), and an async reader of its index copy:
 * null with no index entry, a rejection naming the file for a conflict (no
 * stage 0) or a failed git call.
 * @param {string} file the written file's path, forward slashes
 * @param {string} dir its folder
 * @param {object} env the variables the module read
 * @param {{top: function, read: function, run: function, pluginRoot: string}} io the hooks' io
 * @returns {Promise<{settings: object, rel: string|null, before: function}>}
 */
export async function boardGuardRepo(file, dir, env, io) {
  const root = await io.top(dir);
  // No root (a folder inside `.git` among them): no rel, so the file passes as outside any repo.
  const [settings, rel] = await Promise.all([rootSettings(root, env, io), root ? repoPathOf(dir, io.run, baseName(file)) : null]);
  // From the root: ls-files reads its pathspec from the cwd, and rel is the root's.
  const before = async () => {
    const shown = await io.run(['git', 'show', `:${rel}`], { cwd: root });
    if (shown.exitCode === 0) return shown.stdout;
    const staged = await io.run(['git', 'ls-files', '--stage', '--', rel], { cwd: root });
    if (staged.exitCode !== 0) throw new Error(`${rel}: git could not read its index entry (${staged.stderr.trim()}), so it is not judged`);
    if (staged.stdout.trim() === '') return null;
    if (/^\S+ \S+ 0\t/m.test(staged.stdout)) throw new Error(`${rel}: git could not read its staged copy (${shown.stderr.trim()}), so it is not judged`);
    throw new Error(`${rel}: the index holds no stage 0 copy (a merge conflict), so it is not judged until it is staged`);
  };
  return { settings, rel, before };
}
