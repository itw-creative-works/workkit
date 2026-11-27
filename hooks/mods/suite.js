/**
 * hooks/mods/suite.js: the proved-tree records' pure rules: the text each
 * record holds and the reads of it, the tree id they are compared with, the
 * tested-package read, the lazy fact the guards hand their verdicts, and the
 * long-run ceiling. workflow/lib/records.js binds the records to the disk for
 * the writers and the shell.
 */

/** The ceiling of a program run that can take long on a big repo: a tree hash, a copy, the heal. */
export const LONG_RUN_MS = 600000;

/**
 * The working tree's id through `node <kit>/workflow/lib/tree-hash.js <root>`,
 * or the real index's under `-i`, each less `.workkit/`, under the long-run ceiling.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout, stderr }`
 * @param {string} kit the plugin root
 * @param {string} root the repo root
 * @param {object} env the variables the child runs with (HOME, PATH and TMPDIR among them)
 * @param {...string} flags `-i` alone for the index's id; else a package folder for its own id
 * @returns {Promise<{id: string|null, note: string|null}>} the id, null when it could
 *   not be taken; the child's `workspaces:` stderr lines, joined, else null
 */
export async function treeHash(run, kit, root, env, ...flags) {
  const tree = await run(['node', `${kit}/workflow/lib/tree-hash.js`, root, ...flags], { cwd: root, env, timeoutMs: LONG_RUN_MS });
  if (tree.exitCode !== 0) return { id: null, note: null };
  const notes = String(tree.stderr ?? '').split('\n').map((line) => line.trim())
    .filter((line) => line.startsWith('workspaces:'));
  return { id: tree.stdout.trim() || null, note: notes.length > 0 ? notes.join('\n') : null };
}

/**
 * A fact handed as a value, or as an async function the verdict calls only
 * when it needs the answer, with the arguments that pick it (a repo root).
 * @param {*} fact the value, or the function
 * @param {...*} args what the function is asked for
 * @returns {Promise<*>}
 */
export async function factOf(fact, ...args) {
  return typeof fact === 'function' ? fact(...args) : fact;
}

/**
 * The suite record's text: the tree id hashed before the green run, then
 * `ms=<ms>`, the run's wall time.
 * @param {string} tree the tree id
 * @param {number|string} ms the milliseconds
 * @returns {string}
 */
export function suiteRecordText(tree, ms) {
  return `${tree}\nms=${ms}\n`;
}

/**
 * The package record's text with `<tree> <pkg>` written: every other
 * package's line kept in order, then this one's, last. A piece past the last
 * newline is dropped, as a line read would drop it.
 * @param {string|null} record the record's text, null when there is none
 * @param {string} tree the package's own tree id
 * @param {string} pkg the package folder relative to the root, `.` for the root
 * @returns {string}
 */
export function pkgRecordText(record, tree, pkg) {
  const lines = typeof record === 'string' ? record.split('\n') : [''];
  lines.pop();
  const kept = lines.filter((line) => (line.includes(' ') ? line.slice(line.indexOf(' ') + 1) : line) !== pkg);
  return [...kept, `${tree} ${pkg}`].map((line) => `${line}\n`).join('');
}

/**
 * Whether the suite record holds the tree: the first line equal to a
 * non-empty tree id.
 * @param {string|null} record the suite record's text
 * @param {string|null} tree the tree id
 * @returns {boolean}
 */
export function suiteProved(record, tree) {
  if (!tree || typeof record !== 'string') return false;
  const recorded = record.split('\n')[0];
  return recorded !== '' && recorded === tree;
}

/**
 * The recorded root run's wall time: the suite record's `ms=<n>` line, which
 * suiteRecordText writes and an older record may lack.
 * @param {string|null} record the suite record's text
 * @returns {number|null} the milliseconds, null when the record carries none
 */
export function suiteRecordMs(record) {
  if (typeof record !== 'string') return null;
  const match = /^ms=(\d+)$/m.exec(record);
  return match ? Number(match[1]) : null;
}

/**
 * Whether a line of the package record is `<tree> <pkg>`.
 * @param {string|null} record the package record's text
 * @param {string|null} tree the package's own tree id
 * @param {string} pkg the package folder relative to the root, `.` for the root
 * @returns {boolean}
 */
export function pkgProved(record, tree, pkg) {
  if (!tree || !pkg || typeof record !== 'string') return false;
  const lines = record.split('\n');
  // The piece past the last newline: empty, or a line `read` would drop.
  lines.pop();
  return lines.includes(`${tree} ${pkg}`);
}

/**
 * Whether a parsed package.json declares scripts.test as a non-empty string.
 * @param {*} pkg the parsed file
 * @returns {boolean}
 */
export function hasTestScript(pkg) {
  const test = pkg && typeof pkg === 'object' ? pkg.scripts?.test : undefined;
  return typeof test === 'string' && test.length > 0;
}

/**
 * The nearest folder at or above `rel`, short of the root, that `tested`
 * says declares a test script; '' for the root's, and under node_modules
 * always the root's.
 * @param {string} rel a path relative to the root
 * @param {function} tested async, whether a folder relative to the root has a test script
 * @returns {Promise<string>}
 */
export async function testPackageDir(rel, tested) {
  if (`/${rel}/`.includes('/node_modules/')) return '';
  for (let dir = rel; dir; dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '') {
    if (await tested(dir)) return dir;
  }
  return '';
}
