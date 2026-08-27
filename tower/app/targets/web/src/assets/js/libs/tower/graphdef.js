//
// The dependency graph, as mermaid text - the Board's Graph view, composed
// (issue #103).
//
// The graph MODULE takes a definition in and puts an SVG out
// (`__main_assets__/js/libs/graph.js`), so the words and the shapes in the
// picture are the tower's business and they are written here: pure string work,
// no DOM and no fetch, which is what lets the suite ask what a hostile title
// renders as without a browser.
//
// What is drawn is what PARTICIPATES: an issue waiting on nothing and blocking
// nothing is not a node, because a diagram of the whole board is a wall of
// unconnected boxes saying less than the columns beside it. A board with no
// edges at all composes nothing, and the page says so in a line.
//
// Two lists come in, and the second one is not decoration. The scoped issues
// are what the board is showing; the SWEEP is every open issue the payload
// carries, and it is what makes a drawn issue's downstream visible - an issue
// in a repo the scope hides, or filtered off this board, that waits on one of
// these is still waiting on it, and the arrow out of the drawn node is the
// whole point of the picture. Whatever the edge reaches that the board is not
// showing is drawn as a STUB: the reference alone, dashed, never dropped -
// silence there would draw a blocker as if it were free.
//
// Titles and repo slugs are REMOTE text, exactly as they are on a card. A
// mermaid label is a quoted string with no escape for its own quote, so nothing
// a title carries may reach one: the quote characters become apostrophes and
// the syntax characters become spaces, which is the same decision `esc` makes
// for markup, made for a different grammar.
//

import { issueKey } from './format.js';

/** How much of a title fits in a node before it stops being readable. */
export const MAX_TITLE = 40;

/** The mermaid class a stub node wears - dashed and faint, and NOT a colour. */
const STUB_CLASS = 'stub';

/**
 * A `repo#number` as a mermaid node id: deterministic, so the same issue is the
 * same node on every draw, and derived from the reference rather than from
 * where it happened to fall in an array.
 *
 * Lowercased for the same reason every other comparison here is - repo names
 * are case-insensitive on GitHub and the inline fallback is hand-typed - and
 * prefixed, so an id can never start with a digit or collide with a mermaid
 * keyword.
 *
 * @param {{repo: string, number: number}} ref - an issue or a blocker
 * @returns {string} a mermaid-safe id
 */
export const nodeId = (ref) => `n_${issueKey(ref).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

/** The lookup key an issue and a blocker are the same thing under. */
const keyOf = (ref) => issueKey(ref).toLowerCase();

/**
 * Text that cannot break out of the label it is put in.
 *
 * `"` closes the quoted string and `[]{}<>` are node shapes, `#…;` is mermaid's
 * entity escape and `|` an edge label - none of them survive. Whitespace folds
 * to single spaces, since a title carrying a newline would end the statement.
 */
const safe = (text) => String(text === null || text === undefined ? '' : text)
  .replace(/["`]/g, '\'')
  .replace(/[[\]{}<>|#;]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** A title, cut where a node stops being readable. */
const clip = (title) => (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE).trimEnd()}…` : title);

/**
 * The one repo every drawn issue is in, or '' when the board is showing
 * several.
 *
 * It is what decides how a node is NAMED, the same way the Board's repo column
 * and a "waits on" chip decide: on a single-repo board `#12` is unambiguous and
 * is how its own author would write it; anywhere else a slug is the only
 * spelling that means one issue.
 *
 * @param {object[]} issues - the scoped issues
 * @returns {string} the lowercased slug, or ''
 */
const baseRepo = (issues) => {
  const repos = new Set((issues || []).map((issue) => String(issue.repo || '').toLowerCase()));
  return repos.size === 1 ? [...repos][0] : '';
};

/**
 * How one issue is referred to on this board: `#12`, or `owner/repo#12` -
 * `issueKey`'s spelling, with the remote halves put through the sanitizer and
 * the `#` supplied here, since a title's `#` is an entity escape and this one
 * is a number sign.
 */
const refText = (ref, base) => (base && String(ref.repo || '').toLowerCase() === base
  ? `#${safe(ref.number)}`
  : `${safe(ref.repo)}#${safe(ref.number)}`);

/**
 * One node line. A drawn issue says what it is and where it stands; a stub says
 * only which issue it is, because that is all this board knows about it.
 */
const nodeLine = (ref, base, issue) => {
  const head = refText(ref, base);
  if (!issue) return `  ${nodeId(ref)}["${head}"]`;
  const title = clip(safe(issue.title));
  const status = safe(issue.status);
  return `  ${nodeId(ref)}["${head}${title ? ` ${title}` : ''}${status ? ` - ${status}` : ''}"]`;
};

/**
 * The mermaid definition for a board's dependencies.
 *
 * The arrow runs blocker → dependent, which is the direction the picture is
 * read in: this one unblocks that one. Every pair is drawn once however many
 * ways it arrived - the sweep merges native edges with the inline fallback, and
 * an edge into the drawn set is found from both ends here.
 *
 * @param {object[]} scoped - the issues the board is showing
 * @param {object[]} all - every open issue the sweep carries
 * @returns {string} a mermaid definition, or '' when nothing waits on anything
 */
export const boardGraph = (scoped, all) => {
  const shown = scoped || [];
  const drawn = new Map(shown.map((issue) => [keyOf(issue), issue]));
  const base = baseRepo(shown);

  // Both directions, in one pass each: what the drawn issues wait on, and who
  // out there waits on them.
  const pairs = [];
  for (const issue of shown) {
    for (const blocker of issue.blockedBy || []) pairs.push([blocker, issue]);
  }
  for (const issue of all || []) {
    if (drawn.has(keyOf(issue))) continue;
    for (const blocker of issue.blockedBy || []) {
      if (drawn.has(keyOf(blocker))) pairs.push([blocker, issue]);
    }
  }

  const nodes = new Map();
  const stubs = [];
  const place = (ref) => {
    const id = nodeId(ref);
    if (nodes.has(id)) return id;
    const issue = drawn.get(keyOf(ref)) || null;
    nodes.set(id, nodeLine(ref, base, issue));
    if (!issue) stubs.push(id);
    return id;
  };

  const edges = new Map();
  for (const [blocker, dependent] of pairs) {
    const from = place(blocker);
    const to = place(dependent);
    edges.set(`${from}>${to}`, `  ${from} --> ${to}`);
  }

  if (!edges.size) return '';

  const lines = ['flowchart TD', ...nodes.values(), ...edges.values()];
  if (stubs.length) {
    // Dashes and opacity, no fill and no stroke colour: the theme paints this
    // diagram (graph.js reads the token sheet at draw time) and a literal here
    // would be the one thing on the page that ignores dark mode.
    lines.push(`  classDef ${STUB_CLASS} stroke-dasharray:4 2,opacity:0.7`);
    lines.push(`  class ${stubs.join(',')} ${STUB_CLASS}`);
  }
  return lines.join('\n');
};
