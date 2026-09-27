// libs/tower/github/brief.js: the brief built from the sweep, the API brief's
// sections and headline restated. github.js re-exports it whole; no piece
// imports github.js.

// ── The brief ──────────────────────────────────────────────────────────────

import { priorityRank, issueKey } from '../format.js';
import { briefFreshness } from './history.js';

// The sections, the urgency order and the headline are tower/api/lib/brief.js's
// rules, restated across the copy boundary. `warnings` is always empty here: a
// browser has no working copies, and the page says so.

const briefIssue = (issue) => ({
  repo: issue.repo,
  number: issue.number,
  title: issue.title,
  url: issue.url,
  body: issue.body || '',
  bodyTruncated: Boolean(issue.bodyTruncated),
  comments: issue.comments || 0,
  createdAt: issue.createdAt || null,
  updatedAt: issue.updatedAt || null,
  status: issue.status || null,
  type: issue.type || null,
  priority: issue.priority || null,
  agentOk: Boolean(issue.agentOk),
  assignees: issue.assignees || [],
  blockedBy: issue.blockedBy || [],
});

// The three priority bands are format.js's - the same ones the Board sorts and
// colours by - so the brief and the board can never disagree about what "high"
// is. Only the tie-break differs: a brief section reads oldest first.
const byUrgency = (a, b) => {
  const spread = priorityRank(a.priority) - priorityRank(b.priority);
  if (spread !== 0) return spread;
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
};

// `nextUp` is that module's rule too: per repo, decisions, then what is ready
// to ship, then checks waiting on the owner, then accepted specs, three at most.
const NEXT_UP_PER_REPO = 3;

// The per-repo sweep counts and the roster-wide closed count, that module's
// `repoCountsFrom` restated; the suite compares the payloads key for key.
const repoCountsFrom = (board) => ((board && board.repos) || [])
  .filter((repo) => !repo.error)
  .map((repo) => ({
    slug: repo.slug,
    open: typeof repo.totalCount === 'number' ? repo.totalCount : (repo.count || 0),
    closedDay: typeof repo.closedDay === 'number' ? repo.closedDay : 0,
  }));

// An issue waiting on another orders last inside its repo and says which ones,
// counting only a blocker the sweep still holds, matched on `repo#number`.
const nextUpFrom = (issues) => {
  // Repo names are case-insensitive on GitHub and the inline fallback is
  // hand-typed, so the match folds case - and answers in the sweep's spelling.
  const open = new Map(issues.map((issue) => [issueKey(issue).toLowerCase(), issueKey(issue)]));
  const waitsOnFor = (issue) => (issue.blockedBy || [])
    .map((blocker) => open.get(issueKey(blocker).toLowerCase()))
    .filter(Boolean);
  const actionable = [
    ...issues.filter((i) => i.status === 'blocked'),
    ...issues.filter((i) => i.status === 'complete'),
    ...issues.filter((i) => i.status === 'qa'),
    ...issues.filter((i) => i.status === 'specced'),
  ];
  const byRepo = new Map();
  for (const issue of actionable) {
    const items = byRepo.get(issue.repo) || [];
    items.push({
      number: issue.number,
      title: issue.title,
      repo: issue.repo,
      status: issue.status || null,
      priority: issue.priority || null,
      url: issue.url,
      waitsOn: waitsOnFor(issue),
    });
    byRepo.set(issue.repo, items);
  }
  return [...byRepo].map(([repo, items]) => ({
    repo,
    items: [...items.filter((i) => !i.waitsOn.length), ...items.filter((i) => i.waitsOn.length)].slice(0, NEXT_UP_PER_REPO),
  }));
};

/** The headline - the order of consequence, in the API's own words. */
export const headlineFor = (counts) => {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (counts.waiting) return `${plural(counts.waiting, 'issue is', 'issues are')} waiting on a decision from you.`;
  if (counts.complete) return `${plural(counts.complete, 'issue is', 'issues are')} QA-passed and ready to ship.`;
  if (counts.qa) return `${plural(counts.qa, 'issue is', 'issues are')} built and waiting on your check.`;
  if (counts.inFlight) return `${plural(counts.inFlight, 'issue is', 'issues are')} in flight, and nothing is blocked.`;
  if (counts.ready) return `Nothing is blocked: ${plural(counts.ready, 'issue is', 'issues are')} specced and ready to start.`;
  if (counts.inbox) return `The board is clear of specced work; ${plural(counts.inbox, 'item is', 'items are')} sitting in the inbox.`;
  return 'Nothing is waiting, in flight, or ready: the board is empty.';
};

/**
 * The brief, from the board this browser just swept.
 *
 * @param {object} board - the sweep
 * @param {object} [opts] - `{ generatedAt, summaries, history, documents, historyReason }`
 * @returns {object} the same payload shape /api/brief serves
 */
export const buildBrief = (board, opts = {}) => {
  const issues = (board && Array.isArray(board.issues) ? board.issues : []).slice().sort(byUrgency);
  // The moment this payload was built is the moment its history is judged
  // against, so the freshness below and the stamp the page prints are read off
  // one clock rather than two.
  const generatedAt = opts.generatedAt || new Date().toISOString();

  const waiting = issues.filter((i) => i.status === 'blocked').map(briefIssue);
  // A qa item is finished work waiting on the owner, not work still in hand.
  const qa = issues.filter((i) => i.status === 'qa').map(briefIssue);
  // Complete: the check passed, so the item waits on the ship alone.
  const complete = issues.filter((i) => i.status === 'complete').map(briefIssue);
  // The status label is the whole answer: a claimed `specced` issue is a
  // transient the standards sweep flips to `building`.
  const ready = issues.filter((i) => i.status === 'specced').map(briefIssue);
  const inFlight = issues.filter((i) => i.status === 'building').map(briefIssue);
  const inbox = issues.filter((i) => i.status === 'inbox').map(briefIssue);

  const counts = {
    open: issues.length,
    waiting: waiting.length,
    complete: complete.length,
    qa: qa.length,
    ready: ready.length,
    inFlight: inFlight.length,
    inbox: inbox.length,
    backlog: issues.filter((i) => i.status === 'backlog').length,
  };

  const repoCounts = repoCountsFrom(board);

  return {
    ok: Boolean(board && board.ok),
    reason: board && board.ok === false ? (board.reason || 'the board sweep failed') : null,
    generatedAt,
    headline: headlineFor(counts),
    counts,
    closedDay: repoCounts.reduce((sum, repo) => sum + repo.closedDay, 0),
    repoCounts,
    nextUp: nextUpFrom(issues),
    waiting,
    complete,
    qa,
    ready,
    inFlight,
    inbox,
    warnings: [],
    summaries: opts.summaries || null,
    history: opts.history || null,
    // Attached off the history array here, as the tower does server-side, so a
    // published copy draws the same banner.
    briefFreshness: briefFreshness(opts.history || null, generatedAt),
    documents: opts.documents || null,
    // Why the three above are empty, where the read gave a reason; the tower
    // carries it on this key too (tower/api/server/feeds.js).
    historyReason: opts.historyReason || null,
  };
};
