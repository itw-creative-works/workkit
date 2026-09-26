// libs/tower/github/board.js: the label groups restated, one answer normalized
// to the board payload, and the paged sweep. github.js re-exports it whole; no
// piece imports github.js.

// ── The board ──────────────────────────────────────────────────────────────

import {
  buildBoardQuery, issueFrom, closedSince, errorsByAlias, droppedReason,
  MAX_OPEN_ISSUES, REPOS_PER_REQUEST,
} from '../sweep.js';
import { graphql, limitMark } from './wire.js';

// The label vocabulary's groups (workflow/labels.json, the SSOT the heal reads).
// A group missing here is a group the published board cannot show, so the suite
// holds this list against the file.
export const LABEL_GROUPS = new Set(['status', 'type', 'priority', 'agent']);

/**
 * One GraphQL answer, normalized to the board payload the pages read.
 *
 * @param {string[]} slugs - the roster, in the order the aliases were built
 * @param {object} data - the answer's `data`
 * @param {object[]} errors - its `errors`, if any
 * @param {number} [now] - epoch ms the day's closed count is measured back from
 * @returns {{ok: true, issues: object[], repos: object[]}}
 */
export const normalizeBoard = (slugs, data, errors, now = Date.now()) => {
  const aliasErrors = errorsByAlias(errors);
  const issues = [];
  const repos = [];

  slugs.forEach((slug, i) => {
    const alias = `r${i}`;
    const resolved = (data || {})[alias];
    const conn = (resolved || {}).issues || {};
    const answered = conn.nodes || [];
    // A NULL node is an issue GitHub could not deliver, and reading a field off
    // one is what ended the tower's API (issue #202). It is skipped here and
    // named by the shared droppedReason below, so the published board and the
    // tower board drop it identically.
    const nodes = answered.filter(Boolean);
    const total = typeof conn.totalCount === 'number' ? conn.totalCount : answered.length;
    repos.push({
      slug,
      count: nodes.length,
      totalCount: total,
      // There are open issues this answer did not carry. The sweep pages (#194),
      // so on the LAST page of a repo this is true only when it stopped at the
      // ceiling - which is what the tower's entry means by it too.
      truncated: Boolean((conn.pageInfo || {}).hasNextPage),
      closedDay: closedSince(resolved, now),
      error: droppedReason(answered, nodes, errors, alias)
        || aliasErrors[alias] || (resolved ? null : 'not resolved'),
    });
    for (const node of nodes) issues.push(issueFrom(node, slug, LABEL_GROUPS));
  });

  return { ok: true, issues, repos };
};

/** Where a repo's next page resumes, or null when that answer was its last. */
const nextPageOf = (resolved) => {
  const info = (((resolved || {}).issues) || {}).pageInfo || {};
  return info.hasNextPage && typeof info.endCursor === 'string' ? info.endCursor : null;
};

/**
 * Sweep the board.
 *
 * The STATUS survives a failure alongside the reason, because one status is
 * acted on rather than read: a token GitHub refused is the one failure a new
 * token fixes, and the runtime carries it to the Settings page (page.js).
 *
 * A repo with more than one page of open issues is asked again with the cursor
 * its last page ended on (#194), until GitHub says there is no next page or the
 * ceiling stops it - and every round is handed to `onPage` before the next one
 * goes out, so a published board DRAWS each page as it lands instead of holding
 * a viewer at a spinner while a long roster finishes. The handover carries the
 * board so far, with `loading: true` on every repo still being paged; the
 * finished board carries no such mark, which is how the progress line clears.
 * A continuation that fails leaves the pages that arrived on the board and the
 * reason on their repo, the way the tower's sweep keeps a partial answer.
 *
 * @param {string[]} slugs
 * @param {object} ctx - `{ token, fetch, now, onPage }`
 * @returns {Promise<{ok: boolean, reason?: string, status?: number|null, issues: object[], repos: object[]}>}
 */
export const fetchBoard = async (slugs, ctx = {}) => {
  if (!slugs.length) return { ok: true, issues: [], repos: [] };

  const batches = [];
  for (let offset = 0; offset < slugs.length; offset += REPOS_PER_REQUEST) {
    batches.push(slugs.slice(offset, offset + REPOS_PER_REQUEST));
  }
  // Together, unlike the tower's, which has a cache in front of it and nothing
  // to gain by racing: a page is drawing a board a viewer is waiting on, and the
  // browser holds its own connection limit over them anyway.
  const answers = await Promise.all(batches.map((batch) => graphql(buildBoardQuery(batch), ctx)));

  const refused = answers.find((answer) => !answer.ok);
  if (refused) {
    return {
      ok: false, reason: refused.reason, status: refused.status, ...limitMark(refused), issues: [], repos: [],
    };
  }

  // One accumulator per repo, in roster order, holding that repo's own issues
  // rather than one flat list: a repo's pages arrive rounds apart and belong
  // together, which is the order the tower serves them in.
  const collected = slugs.map((slug) => ({ slug, issues: [], repo: null, cursor: null }));

  // The aliases restart at r0 in every answer, so each batch is normalized
  // against its OWN slugs and each repo's share is taken by the count its entry
  // reports - the issues come back in alias order, so the counts slice them.
  batches.forEach((batch, i) => {
    const part = normalizeBoard(batch, answers[i].data, answers[i].errors, ctx.now);
    let at = 0;
    batch.forEach((slug, j) => {
      const entry = collected[(i * REPOS_PER_REQUEST) + j];
      entry.repo = part.repos[j];
      entry.issues = part.issues.slice(at, at + part.repos[j].count);
      at += part.repos[j].count;
      entry.cursor = nextPageOf(answers[i].data[`r${j}`]);
    });
  });

  /** The board as it stands, marking what is still being paged when asked to. */
  const payload = (mark) => ({
    ok: true,
    issues: collected.flatMap((entry) => entry.issues),
    repos: collected.map((entry) => (mark && entry.cursor ? { ...entry.repo, loading: true } : entry.repo)),
  });

  // The pages AFTER the first, one repo to a request and only the repos GitHub
  // said had more. Fired together, like the batches, and a round at a time so
  // the page is handed what has arrived before the next one goes out.
  let more = collected.filter((entry) => entry.cursor);
  while (more.length) {
    if (ctx.onPage) ctx.onPage(payload(true));
    const rounds = await Promise.all(more.map((entry) => graphql(buildBoardQuery([entry.slug], [entry.cursor]), ctx)));
    rounds.forEach((answer, i) => {
      const entry = more[i];
      if (!answer.ok) {
        entry.repo = { ...entry.repo, error: entry.repo.error || answer.reason };
        entry.cursor = null;
        return;
      }
      const part = normalizeBoard([entry.slug], answer.data, answer.errors, ctx.now);
      entry.issues.push(...part.issues);
      entry.repo = {
        ...entry.repo,
        count: entry.repo.count + part.repos[0].count,
        truncated: part.repos[0].truncated,
        error: entry.repo.error || part.repos[0].error,
      };
      // The ceiling is the other way this ends, and it ends with the repo still
      // saying it was truncated - because it was.
      entry.cursor = entry.issues.length >= MAX_OPEN_ISSUES ? null : nextPageOf(answer.data.r0);
    });
    more = more.filter((entry) => entry.cursor);
  }

  return payload(false);
};
