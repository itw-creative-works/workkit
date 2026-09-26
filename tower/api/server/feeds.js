// tower/api/server/feeds.js: the read side: the roster, the board's sweep in
// flight, sessions, telemetry, health, the summaries, the Discussions and the
// brief, each behind its cache. server.js requires it; no piece requires server.js.

const path = require('path');

const { discoverRepos } = require('../lib/repos');
const { startSweep } = require('../lib/board');
const { listSessions } = require('../lib/sessions');
const { repoHealth } = require('../lib/health');
const { collectTelemetry } = require('../lib/telemetry');
const { buildBrief } = require('../lib/brief');
const { briefSummaries } = require('../lib/summaries');
const { readDiscussions, historyFrom, briefFreshness } = require('../lib/history');
const { documentsFrom } = require('../lib/documents');
const { cached } = require('./http');

// The roster is a disk read and the board a network round trip; both change on
// a human timescale. Sessions and health are local reads the page polls at 10s.
const ROSTER_TTL = 60 * 1000;
const BOARD_TTL = 60 * 1000;
const LIVE_TTL = 5 * 1000;

// The checkout this process is RUNNING FROM: three levels up from tower/api/server.
// A node process holds the code it started with, so a tower left running past
// a pull serves endpoints that no longer match the repo (issue #64 was exactly
// that). Comparing this checkout's HEAD against the one captured at boot is
// what lets the page say so.
const CHECKOUT = path.join(__dirname, '..', '..', '..');

/**
 * The feeds one server reads from, each closure over its own cache slot.
 * @param {object} deps
 * @param {object} deps.opts createServer's opts, passed straight through to the libs
 * @param {Function} deps.exec the git/gh/ps seam
 * @param {object} deps.seam `{ exec }`, the shape the sweep and health take
 * @param {object} deps.log the process's logger
 * @returns {object} the reads the router and the writes call
 */
const createFeeds = ({ opts, exec, seam, log }) => {
  // A failed read answers null, which the cache refuses to store, distinct
  // from a read that ran and found nothing, which is a real empty roster and
  // caches like any other answer. Callers see [] either way.
  const rosterOrNull = cached(ROSTER_TTL, () => {
    try {
      return discoverRepos({
        workflowHome: opts.workflowHome,
        home: opts.home,
        exec,
      });
    } catch {
      return null;
    }
  }, (value) => value !== null);
  const roster = (o) => rosterOrNull(o) || [];

  // The board is not one answer but a SWEEP, and a repo past a hundred open
  // issues takes a request per hundred (issue #194). The dashboard on this
  // machine draws each page as it lands, the way a published copy does, so this
  // slot serves the sweep IN FLIGHT rather than holding the request until the
  // last page: the first pages are asked for inside the request that found the
  // slot cold (which is what gives that answer something to draw) and the
  // continuations run on afterwards, a round to a turn of the event loop,
  // growing the snapshot the next poll reads. A repo still being paged carries
  // `loading: true`, which is the progress line; the finished board carries no
  // such mark, which is what clears it.
  //
  // ONLY /api/board is served that way. Everything DERIVED from the board (the
  // brief) reads `finishedBoard()` instead, because a morning composition made
  // from half a repo's issues is a wrong answer rather than an early one: it
  // takes the last finished board, and where none has finished it drives the
  // sweep to its end inside the request and waits, which is what the endpoint
  // did before any of this.
  //
  // The CACHE's semantics survive around it: a finished board is served for the
  // TTL, `fresh` forces a new sweep, and only a finished board takes the slot,
  // so a failure is never pinned in front of the next read (cached() says why).
  // A new sweep cannot blank the last finished board either: the request that
  // starts one is already holding its first pages by the time it answers.
  let boardDone;
  let boardAt = 0;
  let sweeping = null;

  const advance = () => {
    if (!sweeping) return;
    // The WHOLE round is guarded, not just the ask. This runs off the request
    // stack, where the request handler's own catch cannot reach it and an
    // uncaught throw takes the process down with it, and the throw that did
    // (issue #202) came out of `board()`, the shaping of what had arrived,
    // rather than out of `step()`. The sweep answers its own failures rather
    // than throwing (lib/board.js), so anything landing here is a board this
    // process cannot finish: it is said out loud, dropped, and the slot stays
    // cold, so the next read sweeps again, the course a failed sweep takes.
    try {
      sweeping.step();
      if (sweeping.paging()) {
        schedule();
        return;
      }
      boardDone = sweeping.board();
      boardAt = Date.now();
      sweeping = null;
    } catch (err) {
      log.error(`the board sweep was dropped: ${String((err && err.message) || err)}`);
      sweeping = null;
    }
  };

  // Unref'd: a sweep in flight must never be the reason this process (or a
  // test's server) stays up a moment longer than it was asked to.
  const schedule = () => {
    const timer = setTimeout(advance, 0);
    if (timer.unref) timer.unref();
  };

  // A sweep run to its end here and now, taking the slot with it. The rounds are
  // the same rounds the timer turns; what differs is only who is waiting.
  const settle = (sweep) => {
    while (sweep.paging()) sweep.step();
    const value = sweep.board();
    if (value.ok !== false) {
      boardDone = value;
      boardAt = Date.now();
    }
    return value;
  };

  const board = ({ fresh = false } = {}) => {
    if (sweeping) return sweeping.board();
    if (!fresh && boardDone !== undefined && Date.now() - boardAt < BOARD_TTL) return boardDone;
    const sweep = startSweep(roster(), seam);
    // A sweep with nothing to page - one page a repo, or one that failed
    // outright - is already its own whole answer, and settles here.
    if (!sweep.paging()) return settle(sweep);
    sweeping = sweep;
    schedule();
    return sweep.board();
  };

  /**
   * The whole board, never a page of it: what everything derived from the
   * board reads.
   *
   * A finished board inside the TTL is that answer, sweep in flight or not: it
   * is the last one that finished, which is exactly what a `fresh` board read
   * starting a new sweep must not take away from the brief. Otherwise the sweep
   * already in flight is driven to its end here, and where there is none a new
   * one is, so this reading blocks where /api/board no longer does.
   */
  const finishedBoard = () => {
    if (boardDone !== undefined && Date.now() - boardAt < BOARD_TTL) return boardDone;
    const sweep = sweeping || startSweep(roster(), seam);
    sweeping = null;
    return settle(sweep);
  };
  const sessions = cached(LIVE_TTL, () => listSessions({
    markerDir: opts.markerDir,
    home: opts.home,
    stateDir: opts.stateDir,
    idleMinutes: opts.idleMinutes,
    exec,
  }));
  // The drill-down reads this same slot rather than sweeping again: one session
  // is a row of the whole answer, and the whole answer was just computed.
  const telemetry = cached(LIVE_TTL, () => collectTelemetry({
    markerDir: opts.markerDir,
    home: opts.home,
    stateDir: opts.stateDir,
    idleMinutes: opts.idleMinutes,
    exec,
  }));
  const health = cached(LIVE_TTL, () => {
    const out = {};
    for (const repo of roster()) out[repo.path] = repoHealth(repo.path, seam);
    return out;
  });

  // What this PROCESS is, as against what the checkout is now. The boot commit
  // and the start time are captured once, here, because that is the only moment
  // that can honestly answer them; the live head is read like every other live
  // reading. Git being absent, or the checkout not being a repository, answers
  // null on both sides: absence of proof is not staleness.
  const startedAt = new Date().toISOString();
  const headNow = () => {
    try {
      return exec('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD']).trim() || null;
    } catch {
      return null;
    }
  };
  const bootCommit = headNow();
  const currentHead = cached(LIVE_TTL, headNow, (value) => value !== null);

  // The per-repo map with one `meta` block beside it. FLAT rather than nested
  // because every consumer of this endpoint reads a reading by repo path (an
  // absolute path, so it can never be the string `meta`) and nesting would
  // move every one of them. The brief is built from `health()` itself, which
  // stays the map alone.
  const healthPayload = () => ({
    ...health(),
    meta: { bootCommit, startedAt, currentHead: currentHead() },
  });

  // The published summaries the brief names: a GraphQL round trip like the
  // board's, and cached on the board's minute rather than on the live slots'
  // five seconds: a page polling every ten would otherwise ask GitHub for
  // yesterday's summary six times a minute to hear the same answer all day.
  const summaries = cached(BOARD_TTL, () => briefSummaries({
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec,
  }));

  // The brief is assembled from the two slots above rather than from reads of
  // its own, so the morning notification and the Brief page cannot disagree:
  // they are the same board and the same health, one derivation. The summaries
  // attach onto it exactly as the 9am job attaches them (jobs/brief-payload.js),
  // which is what keeps the two payloads one shape.
  // The published Discussions themselves (issues #55, #181): a second GraphQL
  // round trip on the same board the summaries come from, and cached on the same
  // minute for the same reason. ONE read, because the three things drawn off it
  // are three readings of one board: the mornings BEFORE this one, which no
  // sweep of the live board can answer; how old the newest of them is; and the
  // texts themselves, which are what the Brief page shows.
  //
  // A read that failed is null and says nothing on stderr, unlike the 9am job's
  // named skip: this one runs every minute the tower is up, and a line per poll
  // would bury the log it was meant to be visible in. The page draws the null as
  // the sentence it means, and where the read had a reason to give it draws that
  // beside it (#215) - a spent rate limit and a refused token are the two the
  // null used to swallow.
  const discussions = cached(BOARD_TTL, () => readDiscussions({
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec,
  }));

  // Beside the series, the one question about it that is not a chart (#172):
  // how old the newest published brief is. The cloud brief failed for ten
  // mornings and every page went on looking normal, because the date that would
  // have said so was already in the read above and nothing asked it. Derived
  // from THAT array, never from a read of its own, so the charts and the alarm
  // can never disagree about which morning was the last one.
  const brief = () => {
    const { nodes, reason } = discussions();
    const entries = nodes && historyFrom(nodes);
    return Object.assign(
      buildBrief(finishedBoard(), health(), roster()),
      summaries(),
      {
        history: entries,
        briefFreshness: briefFreshness(entries),
        documents: nodes && documentsFrom(nodes),
        // One read, one reason: the series, the mornings and the freshness are
        // three readings of it, so what stopped it is said once (#215).
        historyReason: reason,
      },
    );
  };

  /** The roster's slugs: what both write paths judge a repo against. */
  const slugsNow = () => roster().map((r) => r.slug).filter(Boolean);

  return {
    roster, board, sessions, telemetry, healthPayload, brief, slugsNow,
  };
};

module.exports = { createFeeds };
