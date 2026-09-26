// libs/tower/github/brief.js: the brief built from the sweep, the API brief's
// sections and headline restated. github.js re-exports it whole; no piece
// imports github.js.

// ── The brief ──────────────────────────────────────────────────────────────

import { priorityRank, issueKey } from '../format.js';
import { briefFreshness } from './history.js';

// The four sections, the urgency order and the headline are tower/api/lib/brief.js's
// rules, restated because that module is on the other side of the copy boundary.
// `warnings` is the one thing this side cannot answer: uncommitted, unpushed and
// unreleased are read off the working copies on a machine, and a browser has
// none - so it is always empty here and the page says why rather than showing a
// clean table that would read as good news.

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

// `nextUp` is that module's rule too, and restated for the same reason: the few
// items a morning could move, per repo - decisions, then what is ready to ship,
// then the checks waiting on the owner, then accepted specs - three at most. The published copy carries it
// because the payloads are one shape - the suite compares them key for key.
const NEXT_UP_PER_REPO = 3;

// The per-repo sweep counts the payload carries, and the roster-wide closed
// count summed off them - that module's `repoCountsFrom`, restated. A published
// copy carries them for the same reason it carries `nextUp`: the payloads are
// one shape, and the suite compares them key for key.
const repoCountsFrom = (board) => ((board && board.repos) || [])
  .filter((repo) => !repo.error)
  .map((repo) => ({
    slug: repo.slug,
    open: typeof repo.totalCount === 'number' ? repo.totalCount : (repo.count || 0),
    closedDay: typeof repo.closedDay === 'number' ? repo.closedDay : 0,
  }));

// An issue waiting on another orders last inside its repo and says which ones
// (issue #103) - that module's rule as well, down to which edges count: only a
// blocker the sweep can see is still open, matched on the `repo#number` pair
// rather than the number alone.
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
  // Its own section, the API's brief's rule (issue #135): a qa item is finished
  // work waiting on the OWNER, not work somebody is still on.
  const qa = issues.filter((i) => i.status === 'qa').map(briefIssue);
  // And the stage above it (issue #196): the check passed, so the item waits on
  // the ship alone - the section the ship itself reads from.
  const complete = issues.filter((i) => i.status === 'complete').map(briefIssue);
  // The status label is the whole answer here as it is in the API's brief
  // (issue #62): a claimed `specced` issue is a transient the standards sweep
  // flips to `building`, never a second in-flight shape to be read for.
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
    // Attached where the history is, off that same array (issue #176): the
    // tower decides it server-side and carries it on the payload, and a
    // published copy that carried the block only there drew no banner at all.
    briefFreshness: briefFreshness(opts.history || null, generatedAt),
    documents: opts.documents || null,
    // Why the three above are empty, where the read had a reason to give: the
    // tower carries it on this key too (tower/api/server/feeds.js), so the Brief and
    // the Overview say the limit or the refusal on either copy (issue #215).
    historyReason: opts.historyReason || null,
  };
};
