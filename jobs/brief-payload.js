#!/usr/bin/env node
//
// The morning payload — what the 9am job hands to Claude.
//
// It is the tower's `/api/brief`, composed WITHOUT the tower: the same roster
// walk, the same board sweep, the same per-repo health, through the same
// `buildBrief`. Mirroring the server's composition rather than calling it over
// HTTP is what lets the job run at nine in the morning whether or not anyone
// started `npm run tower` — and because both halves derive from one module, the
// notification and the Brief page cannot tell different stories.
//
// The caching the server wraps around those reads is deliberately absent. A job
// that runs once a day has nothing to cache.
//
// A sweep that FAILED is printed as a failure. "Nothing is waiting on you" and
// "gh could not answer" are opposite facts, and a morning that quietly reported
// the first when the second happened is worse than no brief at all.
//
// Pure gather: no writes, no Claude, no notification. `claude-daily.sh` owns the
// sending. The one exception is `cc-news.js`, which owns a mark file of its own
// and only moves it once the payload has printed.
//
// Usage:
//   node jobs/brief-payload.js          // the payload on stdout
//   composeBrief({ root, exec })        // offline, against fixtures
//

const { discoverRepos } = require('../tower/api/lib/repos');
const { fetchBoard } = require('../tower/api/lib/board');
const { repoHealth } = require('../tower/api/lib/health');
const { buildBrief } = require('../tower/api/lib/brief');
const { collectCcNews, renderCcNews } = require('./cc-news');

// The digest instruction. It names the payload's sections rather than the shape
// of a board file, and it fixes the FIRST line of the response: claude-daily.sh
// puts that line in the desktop notification, which is the only part of the
// morning most days get read at all.
const INSTRUCTION = `You are producing the owner's MORNING KICKOFF from the brief payload below.

The payload is the tower's daily brief as JSON. \`waiting\` is blocked on a
decision from the owner, \`ready\` is specced and unclaimed, \`inFlight\` is specced and
claimed, \`inbox\` is captured but not yet specced, and \`warnings\` is work sitting
on the table per repo (uncommitted, unpushed, unreleased). \`ok: false\` means the
sweep itself failed — report that and its \`reason\`, never a quiet morning.

A \`--- CC NEWS ---\` block may follow the payload: every upstream Claude Code
CHANGELOG entry that shipped since the last brief, grouped by topic. You judge
which matter — a new feature the kit could use, a change that could break
something the kit built, an improvement worth adopting.

Respond in EXACTLY this shape, plain language, no markdown headers:
Line 1 — the literal prefix "HEADLINE: " then one sentence, the single most
important thing today (<=120 chars total).
Then these labeled sections, one line per item, tightest useful phrasing:
WAITING ON YOU: every issue in \`waiting\` — these move only if the owner acts.
IN FLIGHT: every issue in \`inFlight\`, saying which repo.
TODAY'S TOP 3: your pick of the highest-leverage next actions, judged across
\`ready\`, inbox pressure, and \`warnings\`. Number them.
ON THE TABLE: only repos in \`warnings\`, as "repo: N uncommitted, N unpushed, N unreleased".
INBOX: one line — \`counts.inbox\` captured items not yet specced; omit if zero.
CC NEWS: only when a CC NEWS block is present — NOT a restating of the block:
name only the entries that matter to this kit (could break something we built,
a feature or improvement we should adopt), each as "<version> — what it means
for us"; end the line with how many entries were routine. Omit the section
entirely when there is no block.
Nothing else — no preamble, no advice, no restating the payload.

--- BRIEF ---`;

/**
 * The brief payload, assembled from the three reads the tower's endpoints make.
 *
 * Every option passes through to the libs untouched, which is what lets the
 * suite run this whole composition against a fixture root and a fake exec.
 *
 * @param {object} [opts]
 * @param {string} [opts.root] the Repositories root to walk
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the libs that resolve it
 * @param {string} [opts.generatedAt] ISO stamp, injectable so the suite is not a clock test
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git/gh seam
 * @returns {object} the brief payload
 */
const composeBrief = (opts = {}) => {
  const { exec } = opts;
  const seam = exec ? { exec } : {};

  let repos;
  try {
    repos = discoverRepos({
      root: opts.root,
      workflowHome: opts.workflowHome,
      home: opts.home,
      exec,
    });
  } catch (err) {
    // A walk that threw leaves no roster to sweep, and an empty roster sweeps
    // clean — which would read as an empty board rather than as a broken read.
    return buildBrief(
      { ok: false, reason: `the roster walk failed: ${err.message}`, issues: [] },
      {},
      [],
      opts.generatedAt,
    );
  }

  const board = fetchBoard(repos, seam);
  const health = {};
  for (const repo of repos) health[repo.path] = repoHealth(repo.path, seam);

  return buildBrief(board, health, repos, opts.generatedAt);
};

/**
 * The instruction, then the payload as JSON a human could read over a shoulder,
 * then the upstream news when there is any.
 * @param {object} payload what composeBrief returned
 * @param {object|null} [news] what collectCcNews returned
 */
const render = (payload, news) => `${INSTRUCTION}\n\n${JSON.stringify(payload, null, 2)}\n${renderCcNews(news)}`;

module.exports = { composeBrief, render, INSTRUCTION };

if (require.main === module) {
  const news = collectCcNews();
  process.stdout.write(render(composeBrief(), news));
  // Only now — a run that died before printing repeats the news tomorrow.
  // A MANUAL run (claude-daily.sh --now) leaves the mark alone: testing the
  // brief by hand must not consume news the 9am job has not reported yet.
  if (news && !process.env.WORKKIT_BRIEF_MANUAL) news.commit();
}
