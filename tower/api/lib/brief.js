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
//   ready      specced and unclaimed — what may be started right now
//   inFlight   specced and assigned — what is already someone's
//   warnings   work sitting on the table: uncommitted, unpushed, unreleased
//
// Usage:
//   const { buildBrief } = require('./brief');
//   buildBrief(board, health, repos);
//

/** An issue as the brief carries it — the fields a one-line summary needs. */
const brief = (issue) => ({
  repo: issue.repo,
  number: issue.number,
  title: issue.title,
  url: issue.url,
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
  const claimed = (issue) => (issue.assignees || []).length > 0 || issue.agentWorking;

  const waiting = issues.filter((i) => i.status === 'blocked').map(brief);
  const ready = issues.filter((i) => i.status === 'specced' && !claimed(i)).map(brief);
  const inFlight = issues.filter((i) => i.status === 'specced' && claimed(i)).map(brief);
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

  return {
    // A sweep that failed is reported as such rather than as an empty morning:
    // "nothing is waiting on you" and "gh could not answer" are opposite facts.
    ok: Boolean(board && board.ok),
    reason: board && board.ok === false ? (board.reason || 'the board sweep failed') : null,
    generatedAt: generatedAt || new Date().toISOString(),
    headline: headlineFor(counts),
    counts,
    waiting,
    ready,
    inFlight,
    inbox,
    warnings,
  };
};

module.exports = { buildBrief, headlineFor };
