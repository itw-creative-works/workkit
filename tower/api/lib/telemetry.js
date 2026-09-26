//
// What the crew spent: tokens and cost, read out of the transcripts.
//
// Nothing meters this. Claude Code already writes every assistant message to a
// transcript with its `message.usage` block attached, and it already writes a
// subagent's messages to its own file under the parent's `subagents/` folder.
// Those two facts answer the whole question: how many tokens went where, under
// which model, on which day, and on whose behalf. This module reads them and
// adds nothing: a token ledger of its own would be a store the tower is not
// allowed to have.
//
// Facts this depends on, all confirmed against real files under ~/.claude:
//   main transcript   <home>/.claude/projects/<slug>/<session>.jsonl
//   subagent files    <home>/.claude/projects/<slug>/<session>/subagents/
//                     agent-<id>.jsonl, beside agent-<id>.meta.json
//   usage             assistant lines carry message.usage with input_tokens,
//                     output_tokens, cache_read_input_tokens and
//                     cache_creation_input_tokens, plus message.model
//   the class join    the agent id in the FILENAME does not appear in the
//                     parent's tool_use. The sidecar meta carries `toolUseId`,
//                     which IS the parent tool_use id, and the parent's input
//                     carries `subagent_type`. So the join runs
//                     filename -> meta.toolUseId -> parent tool_use.
//                     meta.agentType holds the same value and is the fallback
//                     for a subagent whose parent line has been compacted away.
//   duplicate lines   one API response is written as SEVERAL transcript lines
//                     (one per content block), each repeating the same usage,
//                     and a resumed session replays its history. Both are
//                     deduplicated by message.id. Measured on this machine:
//                     the largest transcript here carries 200,779 usage lines
//                     across 8,437 distinct message ids, so summing raw lines
//                     overstates it more than twentyfold.
//
// Reading is BOUNDED and incremental. A working transcript passes a gigabyte,
// and the tower polls; every file is streamed in chunks, never held whole, and
// a second call reads only the bytes appended since the first. A file that
// shrank or whose mtime moved backwards was rewritten, so it starts over.
//
// The PIECES live beside this file in telemetry/, one module per concern: the
// rates (pricing.js), the bounded read behind its one cache (read.js) and the
// subagent attribution (subagents.js). This file keeps the payload assembly
// and re-exports their public names.
//
// Usage:
//   const { collectTelemetry } = require('./telemetry');
//   collectTelemetry();                               // live
//   collectTelemetry({ home, markerDir, stateDir, exec }); // offline, fixtures
//

const { listSessions, idleWindowMs } = require('./sessions');
const { PRICING, costOf } = require('./telemetry/pricing');
const {
  readUsage, resetCache, cachedPaths, prune, dayKey,
} = require('./telemetry/read');
const { className, subagentState, readSubagents } = require('./telemetry/subagents');

// Days the `overTime` series covers, today included.
const OVERTIME_DAYS = 30;

/** The last `days` local calendar days ending today, oldest first. */
const dayLabels = (now, days) => {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now - i * 24 * 60 * 60 * 1000)));
  }
  return out;
};

/** Add every count in `from` into `into`, keyed the same way. */
const mergeCounts = (into, from) => {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] || 0) + value;
};

/**
 * One live session's telemetry: its own tokens and cost, plus a row per
 * subagent it spawned. The session's `tokens` are ITS OWN: a subagent's tokens
 * are in its own row and are never folded into the parent's, so a caller may
 * sum the page without counting anything twice.
 *
 * @param {object} session a row from listSessions
 * @param {number} now
 * @param {number} idleMs the liveness window, from sessions.js
 * @returns {{row: object, usage: object, subUsage: object[], files: string[]}} the
 *   row plus the raw readings behind it, which the totals need and the response
 *   does not, and every file it read, which the cache prune needs
 */
const sessionRow = (session, now, idleMs) => {
  // Where a session's transcript is has ONE home, the sessions read that named
  // it: the row's cwd is published in git's spelling and Claude Code names the
  // project folder from the native one, so a second derivation off that cwd
  // would name a file nothing wrote.
  const { transcript } = session;
  const usage = readUsage(transcript);
  const { rows, readings, files } = readSubagents(transcript, usage.taskTypes, now, idleMs);
  return {
    row: {
      id: session.session,
      chatName: session.chatName,
      cwd: session.cwd,
      // The statusline cache is the authority for the model in play; a session
      // that never ran statusLine still names one from its own transcript.
      model: session.model || usage.model,
      effort: session.effort,
      state: session.state,
      startedAt: usage.firstAt,
      lastAt: usage.lastAt,
      lastTool: usage.lastTool,
      lastToolAt: usage.lastToolAt,
      // The two file times listSessions probed, carried through rather than
      // re-derived: a page ages both of them between reads.
      lastActivity: session.lastActivity === undefined ? null : session.lastActivity,
      aliveSince: session.aliveSince === undefined ? null : session.aliveSince,
      transcript,
      tokens: usage.tokens,
      cost: usage.cost,
      subagents: rows,
    },
    usage,
    subUsage: readings,
    files: [transcript, ...files],
  };
};

/**
 * Token accounting across every session on this machine right now.
 *
 * `byClass` credits the root session's own tokens to `manager` and each
 * subagent's to its crew class, so the two never overlap. `overTime` is the
 * last 30 local days with a zero for every quiet one, so the series always has
 * the same shape.
 *
 * Nothing here throws. One unreadable transcript costs its own numbers and
 * nothing else.
 *
 * @param {object} [opts]
 * @param {string} [opts.home] override ~ for transcript resolution
 * @param {string} [opts.markerDir] override the marker directory
 * @param {string} [opts.stateDir] override the statusline cache directory
 * @param {number} [opts.idleMinutes] override the idle threshold
 * @param {Function} [opts.exec] (cmd, args) => stdout: the `ps` seam
 * @param {number} [opts.now] override "now" in ms
 * @returns {{sessions: object[], byModel: object, byClass: object, overTime: Array<{label: string, tokens: number}>}}
 */
const collectTelemetry = (opts = {}) => {
  const now = opts.now || Date.now();

  let listing;
  try {
    listing = listSessions({
      markerDir: opts.markerDir,
      home: opts.home,
      stateDir: opts.stateDir,
      idleMinutes: opts.idleMinutes,
      exec: opts.exec,
    });
  } catch {
    listing = [];
  }

  const sessions = [];
  const byModel = {};
  const byClass = {};
  const byDay = {};
  // Every transcript this pass named, so the read cache can forget the rest.
  const seenFiles = new Set();
  const idleMs = idleWindowMs(opts);

  for (const session of listing) {
    let read;
    try {
      read = sessionRow(session, now, idleMs);
    } catch {
      // One session whose transcript cannot be reached costs its own numbers
      // and leaves the rest of the crew reported.
      continue;
    }
    sessions.push(read.row);
    for (const file of read.files) seenFiles.add(file);

    mergeCounts(byModel, read.usage.byModel);
    mergeCounts(byDay, read.usage.byDay);
    byClass.manager = (byClass.manager || 0) + read.usage.tokens.total;

    read.row.subagents.forEach((sub, i) => {
      mergeCounts(byModel, read.subUsage[i].byModel);
      mergeCounts(byDay, read.subUsage[i].byDay);
      byClass[sub.class] = (byClass[sub.class] || 0) + sub.tokens.total;
    });
  }

  prune(seenFiles);

  const overTime = dayLabels(now, OVERTIME_DAYS).map((label) => ({ label, tokens: byDay[label] || 0 }));
  return { sessions, byModel, byClass, overTime };
};

/**
 * One session's telemetry by id, or null when nothing on this machine is
 * running under that id.
 * @param {string} id the session id
 * @param {object} [opts] the same options collectTelemetry takes
 * @returns {object|null}
 */
const sessionTelemetry = (id, opts = {}) => collectTelemetry(opts).sessions.find((s) => s.id === id) || null;

module.exports = {
  collectTelemetry,
  sessionTelemetry,
  readUsage,
  resetCache,
  cachedPaths,
  subagentState,
  costOf,
  className,
  dayKey,
  PRICING,
  OVERTIME_DAYS,
};
