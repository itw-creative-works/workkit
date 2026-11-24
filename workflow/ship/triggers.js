// workflow/ship/triggers.js: two rules over one workflow file, read in Node: whether
// its top-level `on:` names an event, and whether its dispatch declares an input.
// Shared by the CI watch (ship/watch.js) and the release job (.github/scripts/ci-release.js).
// Usage: const { listensTo, takesInput } = require('./triggers');

const fs = require('fs');
const { escapeRegex } = require('../lib/regex');

/** The indent of a line: its leading spaces and tabs. */
const indentOf = (line) => line.match(/^[ \t\v\f]*/)[0].length;

/**
 * The file's lines that hold YAML, comment and blank lines left out. Carriage
 * returns go and single quotes read as double, so a quoted `"on":` key and a
 * CRLF file read as the plain one. Null when the file cannot be read.
 * @param {string} file the workflow file
 * @returns {string[] | null}
 */
const yamlLines = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return text.split('\n')
    .map((line) => line.replace(/\r/g, '').replace(/'/g, '"'))
    .filter((line) => !/^[ \t\v\f]*(#|$)/.test(line));
};

/**
 * Whether the workflow file's top-level `on:` names the event, in any of its YAML
 * shapes: a scalar, a flow list, a block of keys or items. One nested deeper is not.
 * @param {string} file the workflow file
 * @param {string} event `push`, `pull_request`, `release`...
 * @returns {boolean}
 */
const listensTo = (file, event) => {
  const lines = yamlLines(file);
  if (!lines) return false;
  const entry = new RegExp(`^"?${escapeRegex(event)}"?[ \\t\\v\\f]*(:|#|$)`);
  const word = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegex(event)}([^A-Za-z0-9_-]|$)`);
  let inBlock = false;
  let want = -1;
  for (const line of lines) {
    if (inBlock && /^[^ \t\v\f]/.test(line)) inBlock = false;
    if (inBlock) {
      const n = indentOf(line);
      // A block's entries sit at the indent of its first line.
      if (want < 0) want = n;
      if (n === want && entry.test(line.slice(n).replace(/^-[ \t\v\f]*/, ''))) return true;
      continue;
    }
    if (!/^"?on"?[ \t\v\f]*:/.test(line)) continue;
    const rest = line.replace(/^[^:]*:/, '').replace(/#.*/s, '');
    if (/[^ \t\v\f]/.test(rest)) {
      if (word.test(rest)) return true;
    } else {
      inBlock = true;
      want = -1;
    }
  }
  return false;
};

/**
 * Whether the workflow file declares the dispatch input, as a key of `inputs:`
 * under `workflow_dispatch:` under the top-level `on:`, each in block style. The
 * same key anywhere else (a step's `with:`, an input's property) never counts.
 * @param {string} file the workflow file
 * @param {string} input the input's name, `tag`...
 * @returns {boolean}
 */
const takesInput = (file, input) => {
  const lines = yamlLines(file);
  if (!lines) return false;
  const keys = ['on', 'workflow_dispatch', 'inputs', input].map((key) => new RegExp(`^"?${escapeRegex(key)}"?[ \\t\\v\\f]*:`));
  // at[d] is the indent of the key matched at depth d, kid[d] that of the keys under it.
  const at = [];
  const kid = [];
  let depth = 0;
  for (const line of lines) {
    const n = indentOf(line);
    while (depth > 0 && n <= at[depth]) {
      kid[depth] = undefined;
      depth -= 1;
    }
    // A level's keys sit at the indent of its first line.
    if (kid[depth] === undefined) kid[depth] = n;
    if (n === kid[depth] && keys[depth].test(line.slice(n))) {
      depth += 1;
      at[depth] = n;
      if (depth === keys.length) return true;
    }
  }
  return false;
};

module.exports = { listensTo, takesInput };
