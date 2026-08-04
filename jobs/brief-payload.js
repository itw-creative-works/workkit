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
// Pure gather: no writes, no Claude, no notification. `morning.sh` owns the
// sending — and, since issue #86, the publishing: what this script leaves
// behind are the two lines the runner appends to the brief it publishes, the
// upstream-news cursor and the day's stats (issue #55), both written into the
// scratch file named by `WORKKIT_BRIEF_MARK_FILE` and gone with the run. Both
// live on the published board rather than on this machine.
//
// Usage:
//   node jobs/brief-payload.js          // the payload on stdout
//   composeBrief({ workflowHome, exec }) // offline, against fixtures
//

const fs = require('fs');

const { discoverRepos } = require('../tower/api/lib/repos');
const { fetchBoard } = require('../tower/api/lib/board');
const { repoHealth } = require('../tower/api/lib/health');
const { buildBrief } = require('../tower/api/lib/brief');
const { briefSummaries, homeSlugFor } = require('../tower/api/lib/summaries');
const { collectCcNews, renderCcNews, renderVersionMark } = require('./cc-news');
const { renderStatsMark } = require('./stats');

// The digest instruction. It names the payload's sections rather than the shape
// of a board file, and it fixes the FIRST line of the response: morning.sh puts
// that line in the desktop notification a local rehearsal fires and in the one
// line of proof of life a runner writes to the Actions log.
const INSTRUCTION = `You are producing the owner's MORNING KICKOFF from the brief payload below.

The payload is the tower's daily brief as JSON. \`waiting\` is blocked on a
decision from the owner, \`ready\` is specced, \`inFlight\` is building,
\`inbox\` is captured but not yet specced, and \`warnings\` is work sitting
on the table per repo (uncommitted, unpushed, unreleased). \`ok: false\` means the
sweep itself failed — report that and its \`reason\`, never a quiet morning.

\`nextUp\` is the same board asked one question further: per repo, the few open
items this morning could actually move — decisions first, then accepted specs.
\`findings\` is the newest daily summary published on the home repo (what
yesterday produced), and \`week\` is the weekly rollup, which rides on Mondays
only. Either may be null or absent, which means there was none to read.

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
WORK ON THIS NEXT: \`nextUp\`, one line per repo — "repo: #N title, #N title" in
the order given; an item carrying \`waitsOn\` appends "(waits on #M)" so the
morning knows why it sits last. Omit the section entirely when \`nextUp\` is empty.
TODAY'S TOP 3: your pick of the highest-leverage next actions, judged across
\`ready\`, inbox pressure, and \`warnings\`. Number them.
ON THE TABLE: only repos in \`warnings\`, as "repo: N uncommitted, N unpushed, N unreleased".
INBOX: one line — \`counts.inbox\` captured items not yet specced; omit if zero.
YESTERDAY: one line — \`findings.title\` and its \`findings.url\`. Omit the
section entirely when \`findings\` is null.
THE WEEK: one line — \`week.title\` and its \`week.url\`. Omit the section
entirely when \`week\` is absent or null.
CC NEWS: only when a CC NEWS block is present — NOT a restating of the block:
name only the entries that matter to this kit (could break something we built,
a feature or improvement we should adopt), each as "<version> — what it means
for us"; end the line with how many entries were routine. Omit the section
entirely when there is no block.
Nothing else — no preamble, no advice, no restating the payload.

--- BRIEF ---`;

/**
 * The repos the sweep could not read, said once on stderr.
 *
 * A PARTIAL sweep still answers `ok: true` — the board keeps every repo that
 * came back and records the others as per-repo errors, which the payload does
 * not carry. That is the shape a token whose scope is short takes: the brief
 * reads clean and simply covers less than the roster. The one line here is what
 * makes it visible, in the local log and the Actions log alike; stdout, which is
 * the payload, is untouched.
 *
 * @param {{repos?: Array<{slug: string, error: string|null}>}} board the sweep
 */
const warnUnreadable = (board) => {
  const unreadable = ((board && board.repos) || []).filter((r) => r && r.error);
  if (!unreadable.length) return;
  process.stderr.write(`brief: ${unreadable.length} repos unreadable: ${unreadable.map((r) => r.slug).join(', ')}\n`);
};

/**
 * The published summaries, onto the payload — the ONE shape both readers of
 * `buildBrief` attach, so the morning message and the Brief page carry the same
 * two keys or neither (tower/api/lib/summaries.js owns the Monday rule).
 *
 * A summary that could not be read is a NAMED line on stderr and a null key,
 * beside `warnUnreadable`'s: the brief still composes, and the log says which
 * part of it is missing rather than leaving a morning quietly thinner. A machine
 * with NO home repo says nothing at all — it has no board to have read, which is
 * a fact about the machine rather than a gap in this morning.
 *
 * @param {object} payload what buildBrief returned
 * @param {object} opts composeBrief's own options
 * @returns {object} the same payload
 */
const attachSummaries = (payload, opts) => {
  const summaries = briefSummaries({
    generatedAt: payload.generatedAt,
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec: opts.exec,
  });
  const home = homeSlugFor(opts);
  if (home && !summaries.findings) process.stderr.write(`brief: no daily summary could be read from ${home}\n`);
  if (home && 'week' in summaries && !summaries.week) process.stderr.write(`brief: it is Monday and no weekly rollup could be read from ${home}\n`);
  return Object.assign(payload, summaries);
};

/**
 * The brief payload, assembled from the three reads the tower's endpoints make.
 *
 * Every option passes through to the libs untouched, which is what lets the
 * suite run this whole composition against a fixture roster and a fake exec.
 *
 * @param {object} [opts]
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
      workflowHome: opts.workflowHome,
      home: opts.home,
      exec,
    });
  } catch (err) {
    // A read that threw leaves no roster to sweep, and an empty roster sweeps
    // clean — which would read as an empty board rather than as a broken read.
    // No summaries are attached here. The read that just failed was of this
    // machine's own state, and the home repo is named in the same folder — a
    // brief that could not learn what repos exist has no business asking that
    // folder a second question, and an ok:false payload is a report of a broken
    // morning rather than a morning to be enriched.
    return buildBrief(
      { ok: false, reason: `the roster read failed: ${err.message}`, issues: [] },
      {},
      [],
      opts.generatedAt,
    );
  }

  const board = fetchBoard(repos, seam);
  warnUnreadable(board);
  const health = {};
  for (const repo of repos) health[repo.path] = repoHealth(repo.path, seam);

  return attachSummaries(buildBrief(board, health, repos, opts.generatedAt), opts);
};

/**
 * The instruction, then the payload as JSON a human could read over a shoulder,
 * then the upstream news when there is any.
 * @param {object} payload what composeBrief returned
 * @param {object|null} [news] what collectCcNews returned
 */
const render = (payload, news) => `${INSTRUCTION}\n\n${JSON.stringify(payload, null, 2)}\n${renderCcNews(news)}`;

/**
 * Hand the runner the lines to append to the brief it publishes, through the
 * scratch file it named.
 *
 * Two lines now, and each one rides only when it has something to say: the
 * upstream-news cursor when the news could be read at all, and the day's stats
 * (issue #55) whenever a payload was composed. Nothing durable is written here
 * — the published Discussion is the store for both, which is why they leave
 * together, in one file the runner appends verbatim.
 *
 * @param {object|null} news what collectCcNews returned
 * @param {object|null} payload what composeBrief returned
 */
const writeBriefMarks = (news, payload) => {
  const file = process.env.WORKKIT_BRIEF_MARK_FILE;
  if (!file) return;
  const lines = [];
  if (news && news.version) lines.push(renderVersionMark(news.version));
  const stats = renderStatsMark(payload);
  if (stats) lines.push(stats);
  if (!lines.length) return;
  try {
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    // Silent, like every other step of this path: the brief already printed.
  }
};

module.exports = { composeBrief, render, writeBriefMarks, INSTRUCTION };

if (require.main === module) {
  const news = collectCcNews();
  const payload = composeBrief();
  process.stdout.write(render(payload, news));
  writeBriefMarks(news, payload);
}
