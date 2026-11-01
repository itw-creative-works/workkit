/**
 * hooks/mods/suite.js: the proved-tree records as the guards read them (the
 * suite record and the package record), the tree id they are compared with,
 * the tested-package read, the lazy fact the guards hand their verdicts, and
 * the long-run ceiling. The module's side of workflow/lib/suite.sh, whose
 * writers keep the records' format.
 */

/** The ceiling of a program run that can take long on a big repo: a tree hash, a copy, the heal. */
export const LONG_RUN_MS = 600000;

/**
 * The working tree's id through `bash <kit>/workflow/lib/tree-hash.sh <root>`,
 * wk_tree_hash's one home, or the real index's under `-i`
 * (wk_suite_index_tree), each less `.workkit/`, under the long-run ceiling.
 * The child runs with the variables handed in, so wk_node finds node the way
 * the record writer did; a package keyed to the whole tree leaves its note.
 * @param {function} run runs `(argv, init)`, resolving `{ exitCode, stdout, stderr }`
 * @param {string} kit the plugin root
 * @param {string} root the repo root
 * @param {object} env the variables the child runs with (HOME, PATH, TMPDIR and WORKKIT_NODE among them)
 * @param {...string} flags `-i` alone for the index's id; else a package
 *   folder for that package's own id
 * @returns {Promise<{id: string|null, note: string|null}>} the id, null when it
 *   could not be taken; the child's `tree-hash:` and `workspaces:` stderr
 *   lines in order, joined by newlines, else null
 */
export async function treeHash(run, kit, root, env, ...flags) {
  const tree = await run(['bash', `${kit}/workflow/lib/tree-hash.sh`, root, ...flags], { cwd: root, env, timeoutMs: LONG_RUN_MS });
  if (tree.exitCode !== 0) return { id: null, note: null };
  const notes = String(tree.stderr ?? '').split('\n').map((line) => line.trim())
    .filter((line) => line.startsWith('tree-hash:') || line.startsWith('workspaces:'));
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
 * Whether the suite record holds the tree: wk_suite_proved's read, the first
 * line equal to a non-empty tree id.
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
 * wk_suite_marker_write adds and an older record may lack.
 * @param {string|null} record the suite record's text
 * @returns {number|null} the milliseconds, null when the record carries none
 */
export function suiteRecordMs(record) {
  if (typeof record !== 'string') return null;
  const match = /^ms=(\d+)$/m.exec(record);
  return match ? Number(match[1]) : null;
}

/**
 * Whether a line of the package record is `<tree> <pkg>`: wk_pkg_proved's read.
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
 * Whether a parsed package.json declares scripts.test as a non-empty string
 * (wk_has_test_script).
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
 * always the root's (hook_test_package_dir).
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
