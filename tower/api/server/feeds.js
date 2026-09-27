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

// The checkout this process runs from. A tower left running past a pull serves
// the code it started with; this HEAD against the boot HEAD lets the page say so.
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

  // The board is served as a sweep in flight: tower/README.md § Endpoints.
  let boardDone;
  let boardAt = 0;
  let sweeping = null;

  const advance = () => {
    if (!sweeping) return;
    // The whole round is guarded, `board()` included: this runs off the request
    // stack, where an uncaught throw takes the process down. A throw here is a
    // board this process cannot finish: logged, dropped, and the next read sweeps.
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
   * The whole board, never a page of it: what everything derived from the board
   * reads. A finished board inside the TTL answers even with a sweep in flight;
   * otherwise a sweep is driven to its end here, so this read blocks.
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

  // What this process is, as against the checkout now: the boot commit and the
  // start time are captured once, the only moment that can answer them. No git,
  // or no repository, answers null on both sides: absence of proof is not staleness.
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

  // The per-repo map with one `meta` block beside it, flat because every consumer
  // reads by repo path (absolute, so never `meta`). The brief reads `health()` alone.
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

  // The published Discussions, cached on the board's minute: one read, since the
  // history, its freshness and the documents are three readings of it. A failed
  // read is null with no stderr line (it runs every minute); its reason rides along.
  const discussions = cached(BOARD_TTL, () => readDiscussions({
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec,
  }));

  // Built from the slots above, never reads of its own, so the 9am notification
  // and the Brief page cannot disagree; the summaries attach the way
  // jobs/morning/brief/brief-payload.js attaches them. The freshness derives from
  // the charts' own array, so the two agree on which morning was the last.
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
        // One read, one reason: what stopped it is said once.
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
