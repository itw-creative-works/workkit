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
// sending — and, since issue #86, the publishing: the upstream-news cursor now
// lives on the board, so the one thing this script leaves behind is the version
// line the runner appends to the brief it publishes, written into the scratch
// file named by `WORKKIT_BRIEF_MARK_FILE` and gone with the run.
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
const { collectCcNews, renderCcNews, renderVersionMark } = require('./cc-news');

// The digest instruction. It names the payload's sections rather than the shape
// of a board file, and it fixes the FIRST line of the response: claude-daily.sh
// puts that line in the desktop notification, which is the only part of the
// morning most days get read at all.
const INSTRUCTION = `You are producing the owner's MORNING KICKOFF from the brief payload below.

The payload is the tower's daily brief as JSON. \`waiting\` is blocked on a
decision from the owner, \`ready\` is specced and unclaimed, \`inFlight\` is
building (or the legacy shape, specced and claimed), \`inbox\` is captured but
not yet specced, and \`warnings\` is work sitting
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

  return buildBrief(board, health, repos, opts.generatedAt);
};

/**
 * The instruction, then the payload as JSON a human could read over a shoulder,
 * then the upstream news when there is any.
 * @param {object} payload what composeBrief returned
 * @param {object|null} [news] what collectCcNews returned
 */
const render = (payload, news) => `${INSTRUCTION}\n\n${JSON.stringify(payload, null, 2)}\n${renderCcNews(news)}`;

/**
 * Hand the runner the version line to append to the brief it publishes, through
 * the scratch file it named. Nothing durable is written here — the Discussion
 * is what records the cursor, and a run whose news could not be read at all
 * leaves the file empty so the runner publishes no line.
 * @param {object} news what collectCcNews returned
 */
const writeVersionMark = (news) => {
  const file = process.env.WORKKIT_BRIEF_MARK_FILE;
  if (!file || !news || !news.version) return;
  try {
    fs.writeFileSync(file, `${renderVersionMark(news.version)}\n`);
  } catch {
    // Silent, like every other step of the news path: the brief already printed.
  }
};

module.exports = { composeBrief, render, INSTRUCTION };

if (require.main === module) {
  const news = collectCcNews();
  process.stdout.write(render(composeBrief(), news));
  writeVersionMark(news);
}
