// tower/api/lib/telemetry/read.js: the bounded incremental read: the chunk size,
// the ONE read cache and its prune, the line fold and one transcript's usage.
// telemetry.js requires it; no piece requires telemetry.js.

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

const { zeroTokens, num, costOf } = require('./pricing');

// Bytes per read. Large enough that a gigabyte transcript is a few hundred
// syscalls, small enough that the buffer is never a memory question.
const CHUNK_BYTES = 1024 * 1024;

// path -> the running read state for that file. Module scoped on purpose: the
// point of the incremental read is that it survives across requests.
const cache = new Map();

/** Drop every file's read state. The suite calls this between fixtures. */
const resetCache = () => cache.clear();

/** The files the cache is currently holding read state for. Test-only. */
const cachedPaths = () => [...cache.keys()];

/**
 * Forget every file this pass did not read.
 *
 * The cache is keyed by path and would otherwise only grow: a session that
 * finished drops out of `listSessions` and its read state (a Set of message
 * ids, plus the per-day and per-model maps) would be held for as long as the
 * tower process lives. A finished session is not read again, so nothing is lost
 * by dropping it, and a session that comes back is read from zero, which is
 * what a rewritten file already does.
 *
 * @param {Set<string>} keep the paths this pass named
 */
const prune = (keep) => {
  for (const file of cache.keys()) {
    if (!keep.has(file)) cache.delete(file);
  }
};

/** The LOCAL calendar day a timestamp falls on, as YYYY-MM-DD. */
const dayKey = (when) => {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** A fresh read state for a file: also what a rewritten file resets to. */
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
  // The most recent tool_use in the file, and when it was written.
  lastTool: null,
  lastToolAt: null,
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

  // The spawn half of the class join, collected while the file is open anyway,
  // and beside it the last tool this transcript reached for, which is the one
  // line that says what an agent is DOING rather than how much it has spent.
  // A transcript is folded in file order, so the last one seen is the latest.
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.input && block.input.subagent_type) entry.taskTypes[block.id] = block.input.subagent_type;
      if (block.name) {
        entry.lastTool = block.name;
        entry.lastToolAt = record.timestamp || null;
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
  // TTL is read purely to PRICE it: it is never a counter of its own, so the
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

/** A caller-owned copy of a read state: the cache is never handed out. */
const snapshot = (entry) => ({
  tokens: { ...entry.tokens },
  byDay: { ...entry.byDay },
  byModel: { ...entry.byModel },
  taskTypes: { ...entry.taskTypes },
  model: entry.model,
  firstAt: entry.firstAt,
  lastAt: entry.lastAt,
  lastTool: entry.lastTool,
  lastToolAt: entry.lastToolAt,
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
 * A missing or unreadable file answers zeros: the tower polls, and a session
 * whose transcript has not been written yet is an ordinary condition.
 *
 * @param {string} file
 * @returns {{tokens: object, byDay: object, byModel: object, taskTypes: object, model: string|null, firstAt: string|null, lastAt: string|null, lastTool: string|null, lastToolAt: string|null, cost: number|null, malformed: number, bytesRead: number, offset: number}}
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

module.exports = {
  readUsage,
  resetCache,
  cachedPaths,
  prune,
  dayKey,
};
