// The daily brief: one payload, two readers (the 9am job through
// jobs/morning/brief/brief-payload.js, and the tower's Brief page), assembled
// once from the board sweep and the per-repo health, so the two cannot disagree.
// Nothing is stored: a brief is a question asked of the live data. What it says
// beyond the counts: jobs/README.md § The payload.
//
// Usage:
//   buildBrief(board, health, repos);

// An issue as the brief carries it: a one-line summary's fields plus the ones
// the issue dialog reads, since the Brief page never fetches the board.
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
  blockedBy: issue.blockedBy || [],
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
 * The one name for one issue, `repo#number`, the browser's own idiom
 * (libs/tower/format.js). A dependency matches on the pair, never the number
 * alone: `owner/a#7` and `owner/b#7` are two different issues.
 */
const issueKey = (issue) => `${issue.repo}#${issue.number}`;

/**
 * What to work on next, per repo, in the order jobs/README.md § The payload
 * gives. A blocker counts only while the sweep holds it open (closed and
 * unreadable look alike from here), and the cap lands after the ordering so the
 * item held back is the one that is waiting.
 * @param {object[]} issues the sweep, already sorted byUrgency
 * @returns {Array<{repo: string, items: object[]}>}
 */
const nextUpFrom = (issues) => {
  // Repo names are case-insensitive on GitHub and the inline fallback is
  // hand-typed, so the match folds case, and answers in the sweep's spelling.
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

/**
 * The sweep's per-repo counts, for the stats line (jobs/morning/brief/stats.js).
 * `open` is totalCount, never the nodes returned, and an unread repo is absent:
 * a series that dips at the cap or on a failed read is a lie about the day.
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

/** The repo's display name: its slug when it has one, else its folder name. */
const nameOf = (repos, repoPath) => {
  const match = (repos || []).find((r) => r.path === repoPath);
  return match ? (match.slug || match.name) : repoPath;
};

/**
 * The headline: one plain sentence naming the single most useful fact, in the
 * order of consequence, so a decision waiting on a human leads.
 * @param {object} counts the section sizes
 * @returns {string}
 */
const headlineFor = (counts) => {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (counts.waiting) return `${plural(counts.waiting, 'issue is', 'issues are')} waiting on a decision from you.`;
  // Finished work the ship has not carried yet outranks a check still to give.
  if (counts.complete) return `${plural(counts.complete, 'issue is', 'issues are')} QA-passed and ready to ship.`;
  if (counts.qa) return `${plural(counts.qa, 'issue is', 'issues are')} built and waiting on your check.`;
  if (counts.inFlight) return `${plural(counts.inFlight, 'issue is', 'issues are')} in flight, and nothing is blocked.`;
  if (counts.ready) return `Nothing is blocked: ${plural(counts.ready, 'issue is', 'issues are')} specced and ready to start.`;
  if (counts.inbox) return `The board is clear of specced work; ${plural(counts.inbox, 'item is', 'items are')} sitting in the inbox.`;
  return 'Nothing is waiting, in flight, or ready: the board is empty.';
};

/**
 * Assemble the brief from what the tower's own endpoints already serve, so the
 * job and the page build the same payload from the same three reads.
 * @param {{ok: boolean, issues: object[], repos?: object[]}} board the sweep
 * @param {Object<string, object>} health repo path → repoHealth result
 * @param {Array<{name: string, path: string, slug: string|null}>} repos the roster
 * @param {string} [generatedAt] ISO stamp, injectable so the suite is not a clock test
 * @returns {object} the brief payload
 */
const buildBrief = (board, health, repos, generatedAt) => {
  const issues = (board && Array.isArray(board.issues) ? board.issues : []).slice().sort(byUrgency);

  const waiting = issues.filter((i) => i.status === 'blocked').map(brief);
  // Its own section, never a corner of `inFlight`: a qa item waits on the owner.
  const qa = issues.filter((i) => i.status === 'qa').map(brief);
  // The check passed: it waits on the ship alone, which reads this section.
  const complete = issues.filter((i) => i.status === 'complete').map(brief);
  // The label is the whole answer on both, never the assignee: a claimed
  // `specced` issue is a transient the standards sweep flips.
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
    complete: complete.length,
    qa: qa.length,
    ready: ready.length,
    inFlight: inFlight.length,
    inbox: inbox.length,
    backlog: issues.filter((i) => i.status === 'backlog').length,
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
    // What the day shipped, roster wide: the one number a count of the open
    // board cannot carry, and the one a morning's chart is drawn from.
    closedDay: repoCounts.reduce((sum, repo) => sum + repo.closedDay, 0),
    repoCounts,
    nextUp: nextUpFrom(issues),
    waiting,
    complete,
    qa,
    ready,
    inFlight,
    inbox,
    warnings,
  };
};

module.exports = { buildBrief, headlineFor, repoCountsFrom };
