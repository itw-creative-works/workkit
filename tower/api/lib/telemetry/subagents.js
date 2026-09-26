// tower/api/lib/telemetry/subagents.js: subagent attribution: the crew class a
// subagent_type names, whether a subagent is still working, and its rows.
// telemetry.js requires it; no piece requires telemetry.js.

const fs = require('fs');
const path = require('path');

const { readUsage } = require('./read');

/** A crew class from a subagent_type: `workkit:worker` and `worker` both read worker. */
const className = (subagentType) => {
  if (!subagentType) return 'unknown';
  const name = String(subagentType).split(':').pop().trim().toLowerCase();
  return name || 'unknown';
};

/**
 * Whether a transcript that last moved at `lastAt` is still being written to.
 *
 * A finished subagent never touches its file again, so quiet IS finished, and
 * the window is the one `sessions.js` derives a root session's state from, so a
 * subagent and its manager are called live by the same rule.
 *
 * @param {string|null} lastAt the last timestamp the transcript carries
 * @param {number} now
 * @param {number} idleMs
 * @returns {'working'|'done'}
 */
const subagentState = (lastAt, now, idleMs) => {
  const when = lastAt ? Date.parse(lastAt) : NaN;
  // A subagent whose transcript carries no timestamp at all has never spoken;
  // it is not evidence of anything running, so it reads done.
  if (Number.isNaN(when)) return 'done';
  return now - when <= idleMs ? 'working' : 'done';
};

/**
 * The subagents a session spawned, each with its own usage, its class and
 * whether it is still working.
 *
 * @param {string} transcript the PARENT transcript path
 * @param {object} taskTypes parent tool_use id -> subagent_type
 * @param {number} now
 * @param {number} idleMs the liveness window, from sessions.js
 * @returns {{rows: Array<{id: string, class: string, model: string|null, tokens: object, cost: number|null, state: string, startedAt: string|null, lastAt: string|null, lastTool: string|null, lastToolAt: string|null, transcript: string}>, readings: object[], files: string[]}}
 */
const readSubagents = (transcript, taskTypes, now, idleMs) => {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No subagents were spawned, or the folder is gone. Both are an empty list.
    return { rows: [], readings: [], files: [] };
  }

  const rows = [];
  const readings = [];
  const files = [];
  for (const name of names.sort()) {
    if (!/^agent-.+\.jsonl$/.test(name)) continue;
    const id = name.replace(/\.jsonl$/, '');
    const file = path.join(dir, name);
    files.push(file);
    const usage = readUsage(file);

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
      state: subagentState(usage.lastAt, now, idleMs),
      startedAt: usage.firstAt,
      lastAt: usage.lastAt,
      lastTool: usage.lastTool,
      lastToolAt: usage.lastToolAt,
      transcript: file,
    });
  }
  return { rows, readings, files };
};

module.exports = {
  className,
  subagentState,
  readSubagents,
};
