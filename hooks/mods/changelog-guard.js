/**
 * hooks/mods/changelog-guard.js: docs:changelog-guard's verdict on a CHANGELOG
 * write, from the linter (workflow/changelog/lint.js, run with
 * `--added-only`), and the two reads safety:commit-gate check 3 shares: the
 * CHANGELOG path test and the linter's path.
 */

/**
 * Whether a path names a CHANGELOG.md, at the root or below.
 * @param {string} path the path
 * @returns {boolean}
 */
export function isChangelog(path) {
  return /(^|[\\/])CHANGELOG\.md$/.test(String(path ?? ''));
}

/**
 * The CHANGELOG linter: `<engine>/changelog/lint.js`, the engine folder
 * `WORKFLOW_DIR` names, else the plugin's own `workflow/`.
 * @param {object} env the variables the module read
 * @param {string} pluginRoot the plugin's root
 * @returns {string}
 */
export function linterPath(env, pluginRoot) {
  return `${env.WORKFLOW_DIR || `${pluginRoot}/workflow`}/changelog/lint.js`;
}

/**
 * The bounce for a write that added an entry out of format, or null: another
 * file, no linter run (no node), or a clean lint.
 * @param {string} path the written file's path
 * @param {{exitCode: number, stderr?: string}|null|undefined} lintResult the
 *   linter's run, its findings on stderr
 * @returns {string|null}
 */
export function changelogGuardVerdict(path, lintResult) {
  if (!isChangelog(path) || !lintResult || lintResult.exitCode === 0) return null;
  return `changelog-guard: fix the entry before any other work.\n${String(lintResult.stderr ?? '').replace(/\n+$/, '')}`;
}
