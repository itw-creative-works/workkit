/**
 * hooks/mods/test-reminder.js: safety:test-reminder's question, asked once per
 * file per session, whether a written code file that no test names needs a
 * test (docs/hooks.md § safety:test-reminder). Its path shapes are the one
 * home the commit gate and the change tracker read too.
 */

/** A code extension: the one list every code-versus-docs judgment reads (the commit gate, the change tracker). */
export const CODE_EXT = /\.(js|cjs|mjs|ts|jsx|tsx|sh|zsh|py|rb)$/;
const WORD = 'A-Za-z0-9_';

/** A text with every regex metacharacter escaped, for a literal inside a built RegExp. */
export const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the basename is test-shaped (`*.test.*`, `*.spec.*`, `*_test.*`).
 * @param {string} path a repo path
 * @returns {boolean}
 */
export function isTestName(path) {
  return /(\.test\.|\.spec\.|_test\.)/.test(String(path).split('/').pop());
}

/**
 * Whether a path is a test file by name or sits under a `test`, `tests` or
 * `__tests__` folder at any depth.
 * @param {string} path a repo path
 * @returns {boolean}
 */
export function isTestPath(path) {
  return isTestName(path) || /(^|\/)(test|tests|__tests__)\//.test(path);
}

/**
 * Whether a path is source the test obligation covers: a code extension,
 * never a test path, a `*.config.*` file, or anything under _attic/.
 * @param {string} path a repo path
 * @returns {boolean}
 */
export function isCodePath(path) {
  const base = String(path).split('/').pop();
  if (isTestPath(path) || /(^|\/)_attic\//.test(path) || base.includes('.config.')) return false;
  return CODE_EXT.test(base);
}

/**
 * The question for a written file, or null: no code file, a test names it,
 * or it was asked about already this session.
 * @param {{root: string, rel: string, files: string[], tests: object}} facts
 *   the repo root, the file relative to it, every tracked and untracked repo
 *   file, and the test files' texts (a path to text map, or a list of texts)
 * @param {Iterable<string>} [seen] the `<root>/<rel>` files asked about this session
 * @returns {string|null}
 */
export function testReminderContext(facts, seen = []) {
  const { root, files = [], tests = {} } = facts;
  const rel = String(facts.rel ?? '').replace(/\\/g, '/');
  if (!isCodePath(rel) || [...seen].includes(`${root}/${rel}`)) return null;
  const base = rel.split('/').pop();
  const sameBase = files.filter((file) => file === base || file.endsWith(`/${base}`)).length;
  // A basename two files share is named by <parent>/<base>; a root file keeps it.
  const parent = rel.split('/').slice(-2, -1)[0];
  const key = sameBase !== 1 && rel !== base ? `${parent}/${base}` : base;
  const word = new RegExp(`(?<![${WORD}])${escaped(key)}(?![${WORD}])`);
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const required = new RegExp(`/${escaped(stem)}["']`);
  const texts = Object.values(tests).map(String);
  if (texts.some((text) => word.test(text)) || texts.some((text) => required.test(text))) return null;
  return `${rel} has no test naming it. Does this change need one? If not, say why in the Proof: line.`;
}
