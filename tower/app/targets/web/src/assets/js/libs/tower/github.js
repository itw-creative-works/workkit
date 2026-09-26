//
// The published site's data layer - GitHub, spoken from the browser.
//
// The local dashboard reads the tower API on this machine (api.js). A PUBLISHED
// copy has no tower on the other end, and nothing is baked into it but the slug
// of the home repo - which the site's own URL already names: every number on the
// page, and the roster of repos to sweep with it, comes from a live GitHub call
// made by the page itself (issues #81, #110). The key that unlocks those calls is a
// fine-grained personal access token the viewer supplies, held in that browser's
// localStorage and nowhere else - never in the repo, the built site, an engine
// file or a URL that reaches a server. It is TYPED into the Settings page, or
// handed over by `workkit setup`, which opens that page with the token in the
// URL fragment (issue #230): a fragment is the one part of a URL the browser
// keeps to itself, so the handover reaches this storage and nothing else.
// Without it the site has no data to show, which is what makes the token the
// auth layer as well as the credential.
//
// It answers in the SAME shapes the tower API serves, so the page modules do not
// know which half is talking to them: `/api/repos` is a roster, `/api/board` is
// the sweep, `/api/brief` is the morning payload. `readFeed` is the one door,
// mirroring api.js's `fetchFeed` four-key result and its promise never to throw.
// It WRITES with that token too: the published site works exactly like the
// dashboard on the machine, so the two writes the tower has - moving a card and
// filing an issue - are here as well, in the same shapes and behind the same
// door discipline.
//
// The SWEEP itself is not written here: its pure half - the document, the
// numbers that bound it, the parse that turns an answered node into a board
// issue, and the reading of the errors beside them - lives beside this file in
// sweep.js, and tower/api/lib/board.js reaches
// across and requires the same module (issue #195). Only the browser's transport
// around it is here. sweep.js can be shared because it is on THIS side of the
// copy boundary: the app is copied out of this repo and becomes a project of its
// own in `~/.workkit/tower` (issue #77), so a published copy carries it while
// nothing under `tower/api/` is reachable from one.
//
// Two things are still RESTATED here for that same boundary: the label groups
// (the vocabulary a published copy cannot read off workflow/labels.json) and the
// brief's sections, which are tower/api/lib/brief.js's rules. The suite pins
// both.
//
// Every function takes its seams as arguments - the token, `fetch`, the clock -
// so the whole module imports and answers under Node.
//
// The SECTIONS live beside this file in github/, one module each:
// the token, the wire, the roster, the board, the summaries, the brief, the
// history and the two writes. This file keeps the one door and re-exports
// every piece's public names, so a caller imports the whole layer from here.
// The REST call the roster and the writes share sits on the wire beside
// `graphql`. The wire and the summaries are re-exported by name, because they
// also export the private helpers their siblings import.
//

import {
  buildBoardQuery, parseLabels, blockersFor, lastCommentOf, issueFrom, closedSince,
  errorsByAlias, firstErrorFor, droppedReason,
  MAX_OPEN_ISSUES, REPOS_PER_REQUEST,
} from './sweep.js';
import { limitMark } from './github/wire.js';
import { fetchSlugs } from './github/roster.js';
import { fetchBoard } from './github/board.js';
import { fetchSummaries } from './github/summaries.js';
import { buildBrief } from './github/brief.js';
import { fetchDiscussions } from './github/history.js';

// The sweep's pure half is the SAME module the tower's own sweep runs on, and it
// is re-exported here so a caller that has this data layer has all of it.
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
 * Answer one feed path against GitHub - the published half of api.js's
 * `fetchFeed`, in the same four-key shape and with the same promise never to
 * throw.
 *
 * The slug list is read on every call rather than held: it is one cached static
 * file and one small API read, so re-reading it costs almost nothing, and a site
 * republished under an open tab starts sweeping the new roster.
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

  // The progress callback is the BOARD feed's alone (#194): the brief is built
  // from this same sweep, and a brief poll handing half a board to the page
  // would walk a finished board backwards.
  const board = await fetchBoard(slugs, path === '/api/board' ? ctx : { ...ctx, onPage: null });
  if (path === '/api/board') {
    return board.ok
      ? { ok: true, data: board, status: 200, reason: null }
      : { ok: false, data: null, status: board.status || null, reason: board.reason, ...limitMark(board) };
  }

  if (path === '/api/brief') {
    const summaries = await fetchSummaries(home, ctx);
    // The history and the documents ride the brief here exactly as they do on
    // the tower's own endpoint, so the Overview's charts and the Brief's archive
    // work off-machine too - and they come off ONE read, as they do there.
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
