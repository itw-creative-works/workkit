//
// The daily brief — one payload, two readers.
//
// The 9am notification and the tower's Brief page must tell the SAME story, so
// the brief is assembled here, once, from the board sweep and the per-repo
// health that every other tower page already reads. Nothing is stored: a brief
// is a question asked of the live data, not a document that accumulates.
//
// The 9am job does not reach the API for it. `jobs/brief-payload.js` calls this
// module directly, through the same roster, board and health reads the server
// makes, so the morning works whether or not a tower is running.
//
// The four sections answer the four questions a morning asks, in the order a
// morning asks them:
//   waiting    what is blocked on a human decision — the only thing that stops work
//   ready      specced — what may be started right now
//   inFlight   building — the label is what says work has started
//   warnings   work sitting on the table: uncommitted, unpushed, unreleased
//
// `nextUp` is the same board asked one question further: of everything open,
// the few things this morning could actually move, per repo.
//
// Usage:
//   const { buildBrief } = require('./brief');
//   buildBrief(board, health, repos);
//

// An issue as the brief carries it — the fields a one-line summary needs, plus
// the ones the dashboard's issue dialog reads. The Brief page never fetches the
// board, so an issue arriving without its body would be the one place on the
// dashboard where opening an issue showed less than everywhere else.
const brief = (issue) => ({
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
});

// High priority first, then the issue that has waited longest. `updatedAt` is
// what the sweep carries; an issue nobody has touched in weeks should lead its
// section, not trail it.
const byUrgency = (a, b) => {
  const rank = (issue) => (issue.priority === 'high' ? 0 : issue.priority === 'low' ? 2 : 1);
  const spread = rank(a) - rank(b);
  if (spread !== 0) return spread;
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
};

// How many items one repo offers a morning. A ranked list is only useful while
// it is short: past three the section stops being "what to work on next" and
// becomes the board again, which the brief already carries in full.
const NEXT_UP_PER_REPO = 3;

/**
 * What to work on next, per repo — the ranked few, in the order the whats-next
 * skill reads a board in.
 *
 * `blocked` leads because it is waiting on the OWNER: a decision nobody makes
 * stops everything downstream of it, and it is the only kind of item a morning
 * can clear without opening an editor. `specced` follows in the same urgency
 * order every other section uses, since an accepted spec is what may be started
 * right now. Nothing else is actionable at nine in the morning — `building` is
 * already somebody's and `inbox` is not a decision yet.
 *
 * Grouping is by repo because a morning is spent in one repo at a time, and the
 * repos arrive in the order their leading item does. A repo with nothing
 * actionable is left out rather than listed empty.
 *
 * @param {object[]} issues the sweep, already sorted byUrgency
 * @returns {Array<{repo: string, items: object[]}>}
 */
const nextUpFrom = (issues) => {
  const actionable = [
    ...issues.filter((i) => i.status === 'blocked'),
    ...issues.filter((i) => i.status === 'specced'),
  ];
  const byRepo = new Map();
  for (const issue of actionable) {
    const items = byRepo.get(issue.repo) || [];
    if (items.length >= NEXT_UP_PER_REPO) continue;
    items.push({
      number: issue.number,
      title: issue.title,
      repo: issue.repo,
      status: issue.status || null,
      priority: issue.priority || null,
      url: issue.url,
    });
    byRepo.set(issue.repo, items);
  }
  return [...byRepo].map(([repo, items]) => ({ repo, items }));
};

/**
 * The sweep's per-repo counts, carried onto the brief: how big each repo's open
 * board is, and how much of it closed in the last day.
 *
 * They ride the payload because the morning's stats line is composed from it
 * (jobs/stats.js) and a chart drawn a month later can then say WHICH board grew
 * rather than only that the total did. `open` is the repo's totalCount rather
 * than the nodes it returned: a repo over the page cap is still that many
 * issues open, and a series that dipped at the cap would be a lie about the day.
 * A repo the sweep could not read is absent for the same reason — its zeros are
 * not counts, and a false "0 open" published once dips its series forever.
 *
 * @param {{repos?: object[]}} board the sweep
 * @returns {Array<{slug: string, open: number, closedDay: number}>}
 */
const repoCountsFrom = (board) => ((board && board.repos) || [])
  .filter((repo) => !repo.error)
  .map((repo) => ({
    slug: repo.slug,
    open: typeof repo.totalCount === 'number' ? repo.totalCount : (repo.count || 0),
    closedDay: typeof repo.closedDay === 'number' ? repo.closedDay : 0,
  }));

/** The repo's display name — its slug when it has one, else its folder name. */
const nameOf = (repos, repoPath) => {
  const match = (repos || []).find((r) => r.path === repoPath);
  return match ? (match.slug || match.name) : repoPath;
};

/**
 * The headline: one plain sentence naming the single most useful fact.
 *
 * The order is the order of consequence — a decision waiting on a human blocks
 * everything downstream of it, so it leads even when other numbers are larger.
 *
 * @param {object} counts the section sizes
 * @returns {string}
 */
const headlineFor = (counts) => {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (counts.waiting) return `${plural(counts.waiting, 'issue is', 'issues are')} waiting on a decision from you.`;
  if (counts.inFlight) return `${plural(counts.inFlight, 'issue is', 'issues are')} in flight, and nothing is blocked.`;
  if (counts.ready) return `Nothing is blocked — ${plural(counts.ready, 'issue is', 'issues are')} specced and ready to start.`;
  if (counts.inbox) return `The board is clear of specced work; ${plural(counts.inbox, 'item is', 'items are')} sitting in the inbox.`;
  return 'Nothing is waiting, in flight, or ready — the board is empty.';
};

/**
 * Assemble the brief.
 *
 * Every argument is what the tower's own endpoints already serve, so the job
 * and the page can build the same payload from the same three reads.
 *
 * @param {{ok: boolean, issues: object[], repos?: object[]}} board the sweep
 * @param {Object<string, object>} health repo path → repoHealth result
 * @param {Array<{name: string, path: string, slug: string|null}>} repos the roster
 * @param {string} [generatedAt] ISO stamp, injectable so the suite is not a clock test
 * @returns {object} the brief payload
 */
const buildBrief = (board, health, repos, generatedAt) => {
  const issues = (board && Array.isArray(board.issues) ? board.issues : []).slice().sort(byUrgency);

  const waiting = issues.filter((i) => i.status === 'blocked').map(brief);
  // The label is the whole answer on both of these (issue #62): `specced` is a
  // spec accepted and nothing started, `building` is work in flight. An
  // assignee no longer moves an issue between them — a claimed `specced` issue
  // is a transient the standards sweep flips, not a shape to be tolerated here.
  const ready = issues.filter((i) => i.status === 'specced').map(brief);
  const inFlight = issues.filter((i) => i.status === 'building').map(brief);
  const inbox = issues.filter((i) => i.status === 'inbox').map(brief);

  const warnings = [];
  for (const [repoPath, state] of Object.entries(health || {})) {
    if (!state || state.error) continue;
    const uncommitted = state.uncommitted || 0;
    const unpushed = state.unpushed || 0;
    const unreleased = state.unreleasedEntries || 0;
    if (!uncommitted && !unpushed && !unreleased) continue;
    warnings.push({
      repo: nameOf(repos, repoPath),
      path: repoPath,
      uncommitted,
      unpushed,
      unreleased,
      lastTag: state.lastTag || null,
    });
  }
  // The repo with the most work sitting on the table leads.
  warnings.sort((a, b) => (b.uncommitted + b.unpushed + b.unreleased) - (a.uncommitted + a.unpushed + a.unreleased));

  const counts = {
    open: issues.length,
    waiting: waiting.length,
    ready: ready.length,
    inFlight: inFlight.length,
    inbox: inbox.length,
    parked: issues.filter((i) => i.status === 'parked').length,
  };

  const repoCounts = repoCountsFrom(board);

  return {
    // A sweep that failed is reported as such rather than as an empty morning:
    // "nothing is waiting on you" and "gh could not answer" are opposite facts.
    ok: Boolean(board && board.ok),
    reason: board && board.ok === false ? (board.reason || 'the board sweep failed') : null,
    generatedAt: generatedAt || new Date().toISOString(),
    headline: headlineFor(counts),
    counts,
    // What the day SHIPPED, roster wide — the one number a count of the open
    // board cannot carry, and the one a morning's chart is drawn from.
    closedDay: repoCounts.reduce((sum, repo) => sum + repo.closedDay, 0),
    repoCounts,
    nextUp: nextUpFrom(issues),
    waiting,
    ready,
    inFlight,
    inbox,
    warnings,
  };
};

module.exports = { buildBrief, headlineFor, repoCountsFrom };
