// The published copy's data layer: GitHub spoken from the browser with the
// viewer's token, in the tower API's shapes (`tower/README.md` § The three
// modes). `readFeed` is the one door and github/ is re-exported here; every
// seam (the token, `fetch`, the clock) is an argument, so it runs under Node.

import {
  buildBoardQuery, parseLabels, blockersFor, lastCommentOf, issueFrom, closedSince,
  errorsByAlias, firstErrorFor, droppedReason,
  MAX_OPEN_ISSUES, REPOS_PER_REQUEST,
} from './github/sweep.js';
import { limitMark } from './github/wire.js';
import { fetchSlugs } from './github/roster.js';
import { fetchBoard } from './github/board.js';
import { fetchSummaries } from './github/summaries.js';
import { buildBrief } from './github/brief.js';
import { fetchDiscussions } from './github/history.js';

// The sweep's pure half is the module the tower's own sweep runs on, re-exported
// so a caller that has this data layer has all of it.
export {
  buildBoardQuery, parseLabels, blockersFor, lastCommentOf, issueFrom, closedSince,
  errorsByAlias, firstErrorFor, droppedReason,
  MAX_OPEN_ISSUES, REPOS_PER_REQUEST,
};

export * from './github/token.js';
export { graphql, isTokenRefusal } from './github/wire.js';
export * from './github/roster.js';
export * from './github/board.js';
export { buildDiscussionsQuery, normalizeDiscussions, fetchSummaries } from './github/summaries.js';
export * from './github/brief.js';
export * from './github/history.js';
export * from './github/writes.js';

// ── The one door ───────────────────────────────────────────────────────────

/**
 * Answer one feed path against GitHub in api.js's `fetchFeed` shape, never
 * throwing. The slug list is re-read on every call, which is cheap, so a site
 * republished under an open tab sweeps the new roster.
 *
 * @param {string} path - '/api/repos', '/api/board' or '/api/brief'
 * @param {object} ctx - `{ token, fetch, homePath, generatedAt }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const readFeed = async (path, ctx = {}) => {
  const list = await fetchSlugs(ctx);
  if (!list.ok) return list;
  const { repos, home } = list.data;
  const slugs = repos.map((repo) => repo.slug);

  if (path === '/api/repos') return { ok: true, data: repos, status: 200, reason: null };

  // The progress callback is the board feed's alone: a brief poll handing half
  // a board to the page would walk a finished board backwards.
  const board = await fetchBoard(slugs, path === '/api/board' ? ctx : { ...ctx, onPage: null });
  if (path === '/api/board') {
    return board.ok
      ? { ok: true, data: board, status: 200, reason: null }
      : { ok: false, data: null, status: board.status || null, reason: board.reason, ...limitMark(board) };
  }

  if (path === '/api/brief') {
    const summaries = await fetchSummaries(home, ctx);
    // The history and the documents ride the brief as they do on the tower's
    // endpoint, off one read.
    const { history, documents, reason } = await fetchDiscussions(home, ctx);
    return board.ok
      ? { ok: true, data: buildBrief(board, { generatedAt: ctx.generatedAt, summaries, history, documents, historyReason: reason }), status: 200, reason: null }
      : { ok: false, data: null, status: board.status || null, reason: board.reason, ...limitMark(board) };
  }

  // A page asking for a feed only the machine can answer. It is the runtime's
  // job to keep those pages from arming at all (page.js), so reaching here is a
  // wiring mistake and says so in the sentence the page will draw.
  return { ok: false, data: null, status: null, reason: `${path} is not something a published copy can read` };
};
