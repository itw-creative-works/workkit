// tower/api/server/validate.js: the rules a write is judged by before `gh` is
// reached: the intake and move validators, their limits, the status vocabulary
// and the proof line. server.js requires it; no piece requires server.js.

const { LABELS_FILE } = require('../lib/board');

const TITLE_MAX = 256;
const BODY_MAX = 4000;
const DEFAULT_BODY = 'Filed from the tower.';

// The statuses an issue may be moved between, read from the label SSOT rather
// than restated, the same file the sweep parses its vocabulary from. A require,
// so a tower whose vocabulary file is unreadable says so at start instead of
// refusing every move at runtime for a reason nobody can see.
const MOVE_STATUSES = Object.keys(require(LABELS_FILE).groups.status.values);

// The line that proves an item was built (docs/project-state.md § The proof).
// Its shell twin is `hook_view_has_proof` in hooks/lib/proof.sh: the two change together.
const PROOF_LINE = /(^|\n)[ \t]*Proof:/;

// The one status a move has to prove itself to reach. The board is the second
// door into the gate the two hooks hold on the shell path.
const PROOF_GATED = 'complete';

// `owner/name` and nothing else: the first gate, before the roster comparison.
const SLUG_SHAPE = /^[\w.-]+\/[\w.-]+$/;

/**
 * What the intake endpoint may do, or why it may not. `repo` is checked
 * against the current roster, never a shape: it reaches `gh`, and the roster is
 * the only list of names this machine has agreed to file against.
 * @param {object} payload
 * @param {string[]} slugs the roster's slugs
 * @returns {{ok: boolean, reason?: string, repo?: string, title?: string, body?: string}}
 */
const validateIntake = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };
  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  // GitHub names are case-insensitive; the roster's spelling is what gets
  // filed, so `gh` always receives a name this machine actually holds.
  const repo = slugs.find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked || '(none)'}` };
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > TITLE_MAX) return { ok: false, reason: `title is longer than ${TITLE_MAX} characters` };
  if (body.length > BODY_MAX) return { ok: false, reason: `body is longer than ${BODY_MAX} characters` };
  return { ok: true, repo, title, body: body || DEFAULT_BODY };
};

/**
 * What the status endpoint may do, or why it may not. Every field is judged
 * before `gh`, none trusted. The move is `from` → `to` because the old label is
 * removed in the call that adds the new one, so an issue never carries two.
 * @param {object} payload
 * @param {string[]} slugs the roster's slugs
 * @returns {{ok: boolean, reason?: string, repo?: string, number?: number, from?: string, to?: string}}
 */
const validateMove = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };

  const number = payload.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return { ok: false, reason: 'issue number must be a positive integer' };
  }

  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  if (!SLUG_SHAPE.test(asked)) return { ok: false, reason: `not a repository slug: ${asked || '(none)'}` };
  // The roster's spelling is what gets edited, as in validateIntake.
  const repo = slugs.find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked}` };

  const from = typeof payload.from === 'string' ? payload.from.trim() : '';
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (!MOVE_STATUSES.includes(value)) return { ok: false, reason: `${field} is not a status: ${value || '(none)'}` };
  }
  if (from === to) return { ok: false, reason: `the issue is already status:${to}` };

  return { ok: true, repo, number, from, to };
};

module.exports = {
  validateIntake,
  validateMove,
  TITLE_MAX,
  BODY_MAX,
  DEFAULT_BODY,
  MOVE_STATUSES,
  PROOF_LINE,
  PROOF_GATED,
};
