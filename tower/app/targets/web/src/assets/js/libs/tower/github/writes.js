// libs/tower/github/writes.js: the two writes, a status move and an intake,
// each refused before anything leaves. github.js re-exports it whole; no piece
// imports github.js.

// ── The two writes ─────────────────────────────────────────────────────────
//
// The tower has exactly two write paths, and so does this: moving an issue
// along the pipeline (the Board's drag) and filing one (the intake dialog).
// The published copy performs them with the SAME token it reads with, which is
// what makes the site function exactly like the dashboard on the machine, and
// why the token asks for Issues: Read and write.
//
// They speak REST where the reads speak GraphQL, for one reason: a GraphQL
// mutation addresses a label by node ID, so each write would first have to look
// up the issue's id and an id per label name. REST speaks label NAMES - the
// vocabulary the columns, the sweep and workflow/labels.json already use - so a
// write is the plainest call that can do the job. Same host, same bearer token,
// same four-key result and the same promise never to throw.

import { NO_TOKEN, limitMark, rest } from './wire.js';
import { fetchSlugs } from './roster.js';

// The intake rules, restated from tower/api/server/validate.js for the copy-boundary
// reason the sweep is: nothing under tower/api/ is reachable from the published
// project. A published copy has no endpoint to refuse a bad intake, so the
// refusals are made here in the endpoint's own words, and the suite pins each
// value against its source.

/** The longest title the endpoint accepts. */
export const TITLE_MAX = 256;

/** The longest body it accepts. */
export const BODY_MAX = 4000;

/** What a filed issue says when the dialog was submitted with no body. */
export const DEFAULT_BODY = 'Filed from the tower.';

/** What every filed issue is labelled: captured, and an idea until triage says otherwise. */
export const INTAKE_LABELS = ['status:inbox', 'type:idea'];

/**
 * The label set one move leaves behind: the old status off, the new one on,
 * every other label untouched.
 *
 * This is the endpoint's semantics exactly - `gh issue edit --remove-label
 * status:<from> --add-label status:<to>`, one call so the issue is never
 * momentarily unlabelled and never momentarily carrying two statuses. Pure, so
 * the invariant is askable without a request.
 *
 * @param {Array<{name: string}|string>} current - the labels the issue carries now
 * @param {string} from - the status being left
 * @param {string} to - the status being moved to
 * @returns {string[]} the whole set to write
 */
export const nextLabels = (current, from, to) => {
  const kept = (current || [])
    .map((label) => (typeof label === 'string' ? label : (label && label.name) || ''))
    .filter((name) => name && name !== `status:${from}`);
  const wanted = `status:${to}`;
  return kept.includes(wanted) ? kept : [...kept, wanted];
};

/** The shape of a repository slug, the endpoint's own pattern. */
const SLUG_SHAPE = /^[\w.-]+\/[\w.-]+$/;

/**
 * The line that proves an item was built, and the one status that demands it -
 * the endpoint's `PROOF_LINE` and `PROOF_GATED`, restated across the copy
 * boundary for the reason `MOVE_STATUSES` is. The pattern is the spec's
 * (docs/project-state.md, "The proof"): any comment line may open with it,
 * leading whitespace tolerated and nothing else.
 */
const PROOF_LINE = /(^|\n)[ \t]*Proof:/;
const PROOF_GATED = 'complete';

/**
 * The statuses a move may name - the label vocabulary's `status` group,
 * restated across the copy boundary for the reason LABEL_GROUPS (board.js) is,
 * and pinned to `workflow/labels.json` by the suite.
 */
export const MOVE_STATUSES = ['inbox', 'specced', 'building', 'qa', 'complete', 'blocked', 'backlog'];

/**
 * What a move may do, or why it may not - the endpoint's `validateMove`, on
 * this side of the copy boundary.
 *
 * The endpoint judges every field before `gh` is reached and trusts none of
 * them for being well formed; so does this, for the same reason: a drag on a
 * page is where these values come from, which is exactly why none of that is
 * assumed. The repo is checked for SHAPE rather than membership - unlike an
 * intake, whose repo is chosen in a dialog, a move's repo is one this site
 * swept, and confirming it against the roster would cost the two reads that
 * fetch it, which the move does not otherwise need.
 *
 * @param {object} move - `{ repo, number, from, to }`
 * @returns {{ok: boolean, reason?: string, repo?: string, number?: number, from?: string, to?: string}}
 */
export const validateMove = (move) => {
  if (!move || typeof move !== 'object') return { ok: false, reason: 'nothing to move' };

  const { number } = move;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return { ok: false, reason: 'issue number must be a positive integer' };
  }

  const repo = typeof move.repo === 'string' ? move.repo.trim() : '';
  if (!SLUG_SHAPE.test(repo)) return { ok: false, reason: `not a repository slug: ${repo || '(none)'}` };

  const from = typeof move.from === 'string' ? move.from.trim() : '';
  const to = typeof move.to === 'string' ? move.to.trim() : '';
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (!MOVE_STATUSES.includes(value)) return { ok: false, reason: `${field} is not a status: ${value || '(none)'}` };
  }
  if (from === to) return { ok: false, reason: `the issue is already status:${to}` };

  return {
    ok: true, repo, number, from, to,
  };
};

/**
 * Move one issue along the pipeline - the Board's drag, written straight to
 * GitHub.
 *
 * Two calls, one mutation: REST replaces the whole label set, so the labels the
 * issue carries NOW are read first. They are read rather than taken from the
 * board's copy because that copy is up to a minute old, and a label added since
 * the sweep must survive a status move that knows nothing about it.
 *
 * @param {{repo: string, number: number, from: string, to: string}} move - api.js's `moveRequest`
 * @param {object} ctx - `{ token, fetch }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `data` is the answer the tower's endpoint sends, so the page reads one shape
 */
export const moveIssueStatus = async (move, ctx = {}) => {
  const checked = validateMove(move);
  // The endpoint answers a refused move 400 with the reason; so does this, and
  // the board puts the card back where it was.
  if (!checked.ok) return { ok: false, data: null, status: 400, reason: checked.reason };
  const { repo, number, from, to } = checked;

  // The proof gate, before anything is written: the endpoint reads the same
  // comments for the same status and refuses in the same words, and the hooks
  // hold it on the shell path. A read that fails is returned as itself - a
  // refusal, never a pass, and a token problem the runtime can still route.
  if (to === PROOF_GATED) {
    // One page is enough: an issue with more than a hundred comments is not one
    // this board moves, and the miss would refuse the move rather than pass it,
    // which is the direction a gate fails in. The file pages GraphQL lists by
    // cursor; REST has no such reader here to borrow.
    const seen = await rest(`/repos/${repo}/issues/${number}/comments?per_page=100`, ctx);
    if (!seen.ok) {
      return {
        ...seen,
        reason: `the proof on issue #${number} could not be read (${seen.reason}), so the move to status:complete was refused. Nothing was changed.`,
      };
    }
    const proved = Array.isArray(seen.data)
      && seen.data.some((comment) => PROOF_LINE.test(String((comment && comment.body) || '')));
    if (!proved) {
      return {
        ok: false,
        data: null,
        status: seen.status,
        reason: `issue #${number} carries no comment whose line starts with "Proof:", so it cannot move to status:complete. Park it with a Proof: comment first, one entry per layer, then move the card.`,
      };
    }
  }

  const read = await rest(`/repos/${repo}/issues/${number}`, ctx);
  if (!read.ok) return read;

  // A PATCH sends the WHOLE label set, so a read that answered without one is
  // not a base to write from: relabelling off nothing would take every label
  // the issue carries with it.
  const carried = (read.data || {}).labels;
  if (!Array.isArray(carried)) {
    return {
      ok: false,
      data: null,
      status: read.status,
      reason: 'GitHub answered the read without the issue’s labels, so the move had nothing safe to write from - nothing was changed.',
    };
  }

  const written = await rest(`/repos/${repo}/issues/${number}`, ctx, {
    method: 'PATCH',
    body: { labels: nextLabels(carried, from, to) },
  });
  if (!written.ok) return written;

  return {
    ok: true, data: { ok: true, repo, number, status: to }, status: written.status, reason: null,
  };
};

/**
 * What an intake may do, or why it may not - the endpoint's `validateIntake`,
 * on this side of the copy boundary.
 *
 * The repo is checked against the site's own slug list rather than pattern
 * matched, for the endpoint's reason: that list is the only set of repositories
 * this copy has agreed to file against. Its SPELLING is what gets filed, since
 * GitHub names are case-insensitive and a slug is whatever case the roster
 * carried.
 *
 * @param {object} payload - `{ repo, title, body }`
 * @param {string[]} slugs - the roster this site sweeps
 * @returns {{ok: boolean, reason?: string, repo?: string, title?: string, body?: string}}
 */
export const validateIntake = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };
  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const repo = (slugs || []).find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked || '(none)'}` };
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > TITLE_MAX) return { ok: false, reason: `title is longer than ${TITLE_MAX} characters` };
  if (body.length > BODY_MAX) return { ok: false, reason: `body is longer than ${BODY_MAX} characters` };
  return { ok: true, repo, title, body: body || DEFAULT_BODY };
};

/**
 * File one issue - the intake dialog, written straight to GitHub.
 *
 * @param {{repo: string, title: string, body: string}} payload - what the dialog holds
 * @param {object} ctx - `{ token, fetch, homePath }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `data` is `{ ok: true, url }`, the endpoint's own answer, which the dialog links
 */
export const createIssue = async (payload, ctx = {}) => {
  if (!(ctx.token || '')) return { ok: false, data: null, status: null, reason: NO_TOKEN };

  const list = await fetchSlugs(ctx);
  if (!list.ok) return { ok: false, data: null, status: list.status, reason: list.reason, ...limitMark(list) };

  const checked = validateIntake(payload, list.data.repos.map((repo) => repo.slug));
  // The endpoint answers a refused intake 400 with the reason; so does this, and
  // the dialog shows that sentence and leaves what was typed alone.
  if (!checked.ok) return { ok: false, data: null, status: 400, reason: checked.reason };

  const written = await rest(`/repos/${checked.repo}/issues`, ctx, {
    method: 'POST',
    body: { title: checked.title, body: checked.body, labels: INTAKE_LABELS },
  });
  if (!written.ok) return written;

  const url = (written.data || {}).html_url;
  if (!url) return { ok: false, data: null, status: written.status, reason: 'GitHub filed the issue but answered without its URL' };
  return { ok: true, data: { ok: true, url }, status: written.status, reason: null };
};
