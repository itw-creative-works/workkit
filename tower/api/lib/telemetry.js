//
// What the crew spent — tokens and cost, read out of the transcripts.
//
// Nothing meters this. Claude Code already writes every assistant message to a
// transcript with its `message.usage` block attached, and it already writes a
// subagent's messages to its own file under the parent's `subagents/` folder.
// Those two facts answer the whole question: how many tokens went where, under
// which model, on which day, and on whose behalf. This module reads them and
// adds nothing — a token ledger of its own would be a store the tower is not
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
// Usage:
//   const { collectTelemetry } = require('./telemetry');
//   collectTelemetry();                               // live
//   collectTelemetry({ home, markerDir, stateDir, exec }); // offline, fixtures
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const { listSessions, transcriptPath } = require('./sessions');

// Bytes per read. Large enough that a gigabyte transcript is a few hundred
// syscalls, small enough that the buffer is never a memory question.
const CHUNK_BYTES = 1024 * 1024;

// Days the `overTime` series covers, today included.
const OVERTIME_DAYS = 30;

// USD per MILLION tokens, per model, priced separately for each counter a usage
// block carries. These are Anthropic's published API list prices and they are a
// SNAPSHOT, hand-entered — nothing on disk states a rate, so a price change
// lands here or nowhere.
//
// Only input and output are published per model. The three cache rates are
// DERIVED from the input rate by the multipliers Anthropic states once for the
// whole family: a cache read is 0.1x input, and a cache write is 1.25x input at
// the default 5-minute TTL (`cacheCreation`) or 2x input at the 1-hour TTL
// (`cacheCreation1h`). The one exception is noted on its own row.
//
// The sonnet-5 row carries the STANDARD $3.00 / $15.00 rates. An introductory
// discount of $2.00 / $10.00 runs through 2026-08-31; pricing the promotion
// would make this snapshot wrong by design the moment it lapses, so sonnet-5
// cost reads about 33% high until that date and is correct after it.
//
// A model absent from this table prices as null, never as zero: the tower would
// rather show no number than a wrong one, and the tokens are reported either
// way. Anything released after this snapshot lands in that case until a rate is
// entered for it.
const PRICING = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25, cacheCreation1h: 10 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheCreation: 12.5, cacheCreation1h: 20 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25, cacheCreation1h: 10 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25, cacheCreation1h: 2 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75, cacheCreation1h: 6 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1, cacheCreation1h: 1.6 },
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75, cacheCreation1h: 30 },
  // The one row whose cache rates are PUBLISHED rather than derived, and they
  // do not match the multipliers: $0.03 where 0.1x would be $0.025, and $0.30
  // where 1.25x would be $0.3125. The published number is the one billed.
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheCreation: 0.3, cacheCreation1h: 0.5 },
};

const MILLION = 1000000;

// path -> the running read state for that file. Module scoped on purpose: the
// point of the incremental read is that it survives across requests.
const cache = new Map();

/** Drop every file's read state. The suite calls this between fixtures. */
const resetCache = () => cache.clear();

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

/** A usage counter, coerced — a missing or non-numeric field counts as none. */
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The pricing row for a model id, or null when this table has none.
 *
 * Ids arrive decorated: a dated build (`claude-opus-4-1-20250805`) and a context
 * variant (`claude-opus-5[1m]`) are the same model at the same rate, so both
 * decorations are stripped before the lookup and a longest-prefix match catches
 * the rest.
 *
 * @param {string|null} model
 * @returns {{input: number, output: number, cacheRead: number, cacheCreation: number}|null}
 */
const priceOf = (model) => {
  if (!model) return null;
  const base = String(model).replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  if (PRICING[base]) return PRICING[base];
  let best = null;
  for (const key of Object.keys(PRICING)) {
    if (base.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICING[best] : null;
};

/**
 * What a token bundle costs under a model, or null when the model is unpriced.
 *
 * `cacheCreation` is the TOTAL cache write, matching the counter the response
 * carries. `cacheCreation1h` is the share of it written at the 1-hour TTL,
 * which costs 2x input rather than 1.25x; whatever the split does not account
 * for is priced at the default TTL, which is the whole of it for a usage block
 * that carries no split at all. Cost is one number, so it absorbs the two rates
 * without the response ever growing a second counter.
 *
 * @param {string|null} model
 * @param {{input: number, output: number, cacheRead: number, cacheCreation: number, cacheCreation1h?: number}} tokens
 * @returns {number|null} USD
 */
const costOf = (model, tokens) => {
  const rate = priceOf(model);
  if (!rate) return null;
  const long = num(tokens.cacheCreation1h);
  const short = Math.max(0, num(tokens.cacheCreation) - long);
  return (num(tokens.input) * rate.input
    + num(tokens.output) * rate.output
    + num(tokens.cacheRead) * rate.cacheRead
    + short * rate.cacheCreation
    + long * rate.cacheCreation1h) / MILLION;
};

/** The LOCAL calendar day a timestamp falls on, as YYYY-MM-DD. */
const dayKey = (when) => {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** A fresh read state for a file — also what a rewritten file resets to. */
const newEntry = () => ({
  size: 0,
  mtimeMs: 0,
  offset: 0,
  // The tail of the last read, when it stopped mid-line.
  partial: '',
  // message.id values already counted. It grows with the CONVERSATION, not with
  // the file: the largest transcript on this machine is 1.3GB across 362k lines
  // and carries 8.4k distinct ids, because a resumed session replays the same
  // messages over and over. So the set stays small even where the file does not.
  seen: new Set(),
  tokens: zeroTokens(),
  byDay: {},
  byModel: {},
  // parent tool_use id -> subagent_type, the half of the class join that lives
  // in this file.
  taskTypes: {},
  model: null,
  firstAt: null,
  lastAt: null,
  cost: 0,
  // Any tokens at all from a model PRICING does not carry. One such line makes
  // the whole file's cost null rather than an under-count.
  unpriced: false,
  malformed: 0,
  bytesRead: 0,
});

/** Fold one transcript line into a read state. A line it cannot use is ignored. */
const ingest = (entry, line) => {
  if (!line.trim()) return;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    // A transcript being appended to can hand us a half-written line, and an
    // interrupted process can leave one behind for good. Neither is an error
    // worth taking the whole reading down for.
    entry.malformed++;
    return;
  }

  const message = record.message;
  if (!message || typeof message !== 'object') return;

  // The spawn half of the class join, collected while the file is open anyway.
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block && block.type === 'tool_use' && block.input && block.input.subagent_type) {
        entry.taskTypes[block.id] = block.input.subagent_type;
      }
    }
  }

  const usage = message.usage;
  if (!usage || typeof usage !== 'object') return;

  const id = message.id || record.uuid;
  if (id) {
    if (entry.seen.has(id)) return;
    entry.seen.add(id);
  }

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens);
  const total = input + output + cacheRead + cacheCreation;

  // The two cache TTLs cost different rates. The share written at the 1-hour
  // TTL is read purely to PRICE it — it is never a counter of its own, so the
  // token totals the page renders stay exactly the four the contract names.
  const split = usage.cache_creation;
  const cacheCreation1h = split && typeof split === 'object' ? num(split.ephemeral_1h_input_tokens) : 0;

  entry.tokens.input += input;
  entry.tokens.output += output;
  entry.tokens.cacheRead += cacheRead;
  entry.tokens.cacheCreation += cacheCreation;
  entry.tokens.total += total;

  const model = message.model || null;
  if (model) {
    entry.model = model;
    entry.byModel[model] = (entry.byModel[model] || 0) + total;
  }

  const price = costOf(model, {
    input, output, cacheRead, cacheCreation, cacheCreation1h,
  });
  // A line that spent NOTHING costs nothing at any rate, so an unpriced model
  // there is not a gap in the total. Claude Code writes `<synthetic>` lines
  // with an all-zero usage block for messages it generated locally, and one of
  // those would otherwise turn a fully priced session's cost to null.
  if (price === null) {
    if (total > 0) entry.unpriced = true;
  } else {
    entry.cost += price;
  }

  if (record.timestamp) {
    const day = dayKey(record.timestamp);
    if (day) entry.byDay[day] = (entry.byDay[day] || 0) + total;
    if (!entry.firstAt || record.timestamp < entry.firstAt) entry.firstAt = record.timestamp;
    if (!entry.lastAt || record.timestamp > entry.lastAt) entry.lastAt = record.timestamp;
  }
};

/** Stream the bytes between the stored offset and `size` into the read state. */
const advance = (entry, file, size) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  try {
    // A multi-byte character can straddle a chunk boundary; the decoder holds
    // the fragment rather than emitting a replacement character.
    const decoder = new StringDecoder('utf8');
    const buf = Buffer.allocUnsafe(CHUNK_BYTES);
    let carry = entry.partial;
    let pos = entry.offset;
    while (pos < size) {
      const want = Math.min(CHUNK_BYTES, size - pos);
      const read = fs.readSync(fd, buf, 0, want, pos);
      if (read <= 0) break;
      pos += read;
      entry.bytesRead += read;
      carry += decoder.write(buf.subarray(0, read));
      let nl = carry.indexOf('\n');
      while (nl >= 0) {
        ingest(entry, carry.slice(0, nl));
        carry = carry.slice(nl + 1);
        nl = carry.indexOf('\n');
      }
    }
    carry += decoder.end();
    // A trailing line with no newline is either a file written without one or a
    // line still being appended. Parsing tells them apart: truncated JSON does
    // not parse, so anything that DOES parse is a whole record and is counted
    // now rather than waiting for a newline that may never come.
    if (carry.trim()) {
      let whole = false;
      try {
        JSON.parse(carry);
        whole = true;
      } catch {
        whole = false;
      }
      if (whole) {
        ingest(entry, carry);
        carry = '';
      }
    }
    entry.partial = carry;
    entry.offset = pos;
  } catch {
    // A read that failed part way keeps whatever it already folded in; the next
    // call resumes from the offset it reached.
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // The read already answered; a failed close changes nothing for the caller.
    }
  }
};

/** A caller-owned copy of a read state — the cache is never handed out. */
const snapshot = (entry) => ({
  tokens: { ...entry.tokens },
  byDay: { ...entry.byDay },
  byModel: { ...entry.byModel },
  taskTypes: { ...entry.taskTypes },
  model: entry.model,
  firstAt: entry.firstAt,
  lastAt: entry.lastAt,
  cost: entry.unpriced ? null : entry.cost,
  malformed: entry.malformed,
  bytesRead: entry.bytesRead,
  offset: entry.offset,
});

/**
 * One transcript's usage, read incrementally.
 *
 * The first call streams the whole file; every call after it reads only the
 * bytes appended since, adding to the totals already stored. A file that shrank
 * or whose mtime moved backwards was rewritten rather than appended to, so its
 * state is discarded and it is read again from zero.
 *
 * A missing or unreadable file answers zeros — the tower polls, and a session
 * whose transcript has not been written yet is an ordinary condition.
 *
 * @param {string} file
 * @returns {{tokens: object, byDay: object, byModel: object, taskTypes: object, model: string|null, firstAt: string|null, lastAt: string|null, cost: number|null, malformed: number, bytesRead: number, offset: number}}
 */
const readUsage = (file) => {
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const empty = newEntry();
    return snapshot(empty);
  }

  let entry = cache.get(file);
  if (!entry || stat.size < entry.size || stat.mtimeMs < entry.mtimeMs) {
    entry = newEntry();
    cache.set(file, entry);
  }
  if (stat.size > entry.offset) advance(entry, file, stat.size);
  entry.size = stat.size;
  entry.mtimeMs = stat.mtimeMs;
  return snapshot(entry);
};

/** A crew class from a subagent_type: `workkit:worker` and `worker` both read worker. */
const className = (subagentType) => {
  if (!subagentType) return 'unknown';
  const name = String(subagentType).split(':').pop().trim().toLowerCase();
  return name || 'unknown';
};

/**
 * The subagents a session spawned, each with its own usage and its class.
 *
 * @param {string} transcript the PARENT transcript path
 * @param {object} taskTypes parent tool_use id -> subagent_type
 * @returns {{rows: Array<{id: string, class: string, model: string|null, tokens: object, cost: number|null, startedAt: string|null, lastAt: string|null}>, readings: object[]}}
 */
const readSubagents = (transcript, taskTypes) => {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No subagents were spawned, or the folder is gone. Both are an empty list.
    return { rows: [], readings: [] };
  }

  const rows = [];
  const readings = [];
  for (const name of names.sort()) {
    if (!/^agent-.+\.jsonl$/.test(name)) continue;
    const id = name.replace(/\.jsonl$/, '');
    const usage = readUsage(path.join(dir, name));

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8'));
    } catch {
      // An older layout, or a spawn whose sidecar never landed. The class then
      // has no source and reads unknown rather than guessing from the id.
      meta = {};
    }
    const fromParent = meta.toolUseId ? taskTypes[meta.toolUseId] : null;

    readings.push(usage);
    rows.push({
      id,
      // The parent's own record of what it spawned is the authority; the sidecar
      // answers when the parent line has been compacted out of the transcript.
      class: className(fromParent || meta.agentType),
      model: usage.model,
      tokens: usage.tokens,
      cost: usage.cost,
      startedAt: usage.firstAt,
      lastAt: usage.lastAt,
    });
  }
  return { rows, readings };
};

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
 * subagent it spawned. The session's `tokens` are ITS OWN — a subagent's tokens
 * are in its own row and are never folded into the parent's, so a caller may
 * sum the page without counting anything twice.
 *
 * @param {object} session a row from listSessions
 * @param {string} home
 * @returns {{row: object, usage: object, subUsage: object[]}} the row plus the
 *   raw readings behind it, which the totals need and the response does not
 */
const sessionRow = (session, home) => {
  const transcript = transcriptPath(home, session.cwd, session.session);
  const usage = readUsage(transcript);
  const { rows, readings } = readSubagents(transcript, usage.taskTypes);
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
      tokens: usage.tokens,
      cost: usage.cost,
      subagents: rows,
    },
    usage,
    subUsage: readings,
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
 * @param {Function} [opts.exec] (cmd, args) => stdout — the `ps` seam
 * @param {number} [opts.now] override "now" in ms
 * @returns {{sessions: object[], byModel: object, byClass: object, overTime: Array<{label: string, tokens: number}>}}
 */
const collectTelemetry = (opts = {}) => {
  const home = opts.home || os.homedir();
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

  for (const session of listing) {
    let read;
    try {
      read = sessionRow(session, home);
    } catch {
      // One session whose transcript cannot be reached costs its own numbers
      // and leaves the rest of the crew reported.
      continue;
    }
    sessions.push(read.row);

    mergeCounts(byModel, read.usage.byModel);
    mergeCounts(byDay, read.usage.byDay);
    byClass.manager = (byClass.manager || 0) + read.usage.tokens.total;

    read.row.subagents.forEach((sub, i) => {
      mergeCounts(byModel, read.subUsage[i].byModel);
      mergeCounts(byDay, read.subUsage[i].byDay);
      byClass[sub.class] = (byClass[sub.class] || 0) + sub.tokens.total;
    });
  }

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
  costOf,
  className,
  dayKey,
  PRICING,
  OVERTIME_DAYS,
};
