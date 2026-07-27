//
// The live crew — every Claude session running on this machine right now.
//
// Nothing is registered anywhere for this. The `claude:keep-awake` hook already
// writes one marker file per working session (named for the claude pid, holding
// the caffeinate pid, the cwd, and the session id), and Claude Code already
// appends to a per-session transcript on every message. Those two facts answer
// the whole question: who is running, where, and whether they are working or
// idle. This module reads them exactly as the hook writes them — a second
// bookkeeping file would be a store the tower is not allowed to have.
//
// Facts this depends on, all from the hook (dotfiles hooks/claude/keep-awake):
//   marker dir     $TMPDIR/claude-keep-awake (launchd has no TMPDIR, hence the
//                  getconf fallback the sweep job uses)
//   marker name    the claude pid; `.<pid>.lock` directories are the acquire
//                  mutex and are skipped
//   marker body    caffeinate=<pid>, cwd=<path>, session=<id>
//   the assertion  `caffeinate -d -i -w <claude pid>` — matched WHOLE, so a
//                  recycled pid now belonging to something else reads as stale
//   transcript     ~/.claude/projects/<cwd with / and . flattened to ->/<id>.jsonl
//   idle           quiet longer than KEEP_AWAKE_IDLE_MINUTES (default 45)
//
// Model and effort come from the statusline cache the `claude:statusline` hook
// writes; a VS Code session never runs statusLine, so its absence is normal and
// reads as nulls rather than an error.
//
// Usage:
//   const { listSessions } = require('./sessions');
//   listSessions();                                  // live
//   listSessions({ markerDir, home, stateDir, exec }); // offline, from fixtures
//

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DEFAULT_IDLE_MINUTES = 45;

// Bytes read from each end of a transcript when looking for its title. A
// transcript is unbounded and a title line is short; 256KB covers many messages
// at either end and costs the same on a 4KB file as on a 4GB one.
const NAME_READ_BYTES = 256 * 1024;

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

/** Where the keep-awake hook writes its markers. */
const markerRoot = (exec) => {
  let base = process.env.TMPDIR;
  if (!base) {
    try {
      base = exec('getconf', ['DARWIN_USER_TEMP_DIR']).trim();
    } catch {
      base = '';
    }
  }
  return path.join(base || '/tmp', 'claude-keep-awake');
};

/**
 * How long a transcript may stay quiet before whatever wrote it counts as
 * finished, in milliseconds, honoring the same env var and the same typo guard.
 *
 * This is the ONE liveness rule the tower has: `listSessions` reads it for a
 * session's `state`, and telemetry.js reads it for a subagent's. A second copy
 * of the number would let the same crew read live on one page and finished on
 * another.
 *
 * @param {object} opts the caller's options — `idleMinutes` overrides everything
 * @returns {number} milliseconds
 */
const idleWindowMs = (opts) => {
  const minutes = (() => {
    if (typeof opts.idleMinutes === 'number') return opts.idleMinutes;
    const env = process.env.KEEP_AWAKE_IDLE_MINUTES;
    // A non-numeric override falls back rather than passing through — the hook
    // makes the same call, so a typo cannot quietly disable the idle check.
    if (env && /^\d+$/.test(env)) return Number(env);
    return DEFAULT_IDLE_MINUTES;
  })();
  return minutes * 60 * 1000;
};

/**
 * A marker's three fields. Split on the FIRST `=` so a value containing one
 * survives, matching the hook's `IFS='=' read -r k v`.
 * @param {string} file
 * @returns {{caffeinate: string, cwd: string, session: string}|null}
 */
const readMarker = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const out = { caffeinate: '', cwd: '', session: '' };
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx);
    if (key in out) out[key] = line.slice(idx + 1);
  }
  if (!out.caffeinate || !out.cwd || !out.session) return null;
  return out;
};

/** Claude Code's transcript path: the cwd with `/` and `.` both flattened. */
const transcriptPath = (home, cwd, session) => {
  const slug = cwd.replace(/[/.]/g, '-');
  return path.join(home, '.claude', 'projects', slug, `${session}.jsonl`);
};

/** The last custom title in a chunk of transcript, else the last generated one. */
const titleIn = (text) => {
  const last = (re) => {
    let found = null;
    for (const m of text.matchAll(re)) found = m[1];
    return found;
  };
  return last(/"customTitle":"((?:[^"\\]|\\.)*)"/g) || last(/"aiTitle":"((?:[^"\\]|\\.)*)"/g) || null;
};

/**
 * The chat's name: the LAST title the transcript carries. A custom title is the
 * human's own naming and outranks the generated one, however late the generated
 * one was written.
 *
 * The file is read in BOUNDED windows and never whole. A working session's
 * transcript grows without limit, and a busy one passes the 512MB cap on a
 * JavaScript string — `readFileSync(file, 'utf8')` throws ERR_STRING_TOO_LONG
 * there, so reading it all would leave the busiest session on the machine, the
 * one most worth seeing, rendering unnamed. The tail is read first because a
 * rename lands at the end; the head is read only when the tail carried no
 * title, because the generated title is written early. A title straddling a
 * window's edge is missed — a rename that lands there simply shows the earlier
 * name until the next one, which is the right price for a bounded read.
 *
 * @param {string} file
 * @param {number} [budget] bytes per window
 * @returns {string|null}
 */
const chatNameFrom = (file, budget = NAME_READ_BYTES) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = fs.fstatSync(fd);
    const readAt = (start, length) => {
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, start);
      return buf.subarray(0, read).toString('utf8');
    };
    const tailLength = Math.min(budget, size);
    const tail = titleIn(readAt(size - tailLength, tailLength));
    if (tail) return tail;
    // Only what the tail did not already cover.
    const headLength = Math.min(budget, size - tailLength);
    if (headLength <= 0) return null;
    return titleIn(readAt(0, headLength));
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // The read already answered; a failed close changes nothing for the caller.
    }
  }
};

/** Model and effort from the statusline cache, or nulls when it has none. */
const sessionState = (stateDir, session) => {
  const safe = session.replace(/[^a-zA-Z0-9]/g, '_');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(stateDir, `${safe}.json`), 'utf8'));
  } catch {
    return { model: null, effort: null };
  }
  const model = parsed.model || null;
  const effort = parsed.effort;
  return {
    model: (model && (model.id || model.display_name)) || null,
    // The hook caches the whole `effort` payload, which is an object carrying
    // `level`; a bare string is accepted too so an older cache still reads.
    effort: (effort && (typeof effort === 'string' ? effort : effort.level)) || null,
  };
};

/** mtime in ms, or null when the file cannot be probed. */
const mtimeMs = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/**
 * Every session with a keep-awake marker.
 *
 * `state` is one of:
 *   working  the assertion is live and the transcript moved recently
 *   idle     the assertion is live but the session has gone quiet
 *   stale    the caffeinate pid is gone or is now some other process
 *
 * @param {object} [opts]
 * @param {string} [opts.markerDir] override the marker directory
 * @param {string} [opts.home] override ~ for transcript resolution
 * @param {string} [opts.stateDir] override the statusline cache directory
 * @param {number} [opts.idleMinutes] override the idle threshold
 * @param {Function} [opts.exec] (cmd, args) => stdout — the `ps` seam
 * @param {number} [opts.now] override "now" in ms
 * @param {number} [opts.nameReadBytes] bytes read from each end of a transcript
 * @returns {Array<{claudePid: number, cwd: string, session: string, chatName: string|null, state: string, model: string|null, effort: string|null}>}
 */
const listSessions = (opts = {}) => {
  const exec = opts.exec || defaultExec;
  const markerDir = opts.markerDir || markerRoot(exec);
  const home = opts.home || os.homedir();
  const stateDir = opts.stateDir || path.join(process.env.TMPDIR || '/tmp', 'claude-session-state');
  const idleMs = idleWindowMs(opts);
  const now = opts.now || Date.now();
  const nameReadBytes = opts.nameReadBytes || NAME_READ_BYTES;

  let names;
  try {
    names = fs.readdirSync(markerDir);
  } catch {
    return [];
  }

  const out = [];
  for (const name of names.sort()) {
    // A marker's name is always the claude pid, which is the hook's own rule and
    // the only filter needed: the acquire locks are `.<pid>.lock` directories,
    // and every one of them fails this test on its leading dot.
    if (!/^\d+$/.test(name)) continue;
    const file = path.join(markerDir, name);
    const marker = readMarker(file);
    if (!marker) continue;

    const claudePid = Number(name);
    let command = '';
    try {
      command = exec('ps', ['-o', 'command=', '-p', marker.caffeinate]).trim();
    } catch {
      command = '';
    }
    const live = command === `caffeinate -d -i -w ${claudePid}`;

    const transcript = transcriptPath(home, marker.cwd, marker.session);
    let state = 'stale';
    let chatName = null;
    if (live) {
      // The marker's own mtime is when the assertion was taken — the right
      // fallback when the transcript cannot be read.
      const probed = mtimeMs(transcript);
      const quietSince = probed === null ? mtimeMs(file) : probed;
      state = quietSince !== null && now - quietSince > idleMs ? 'idle' : 'working';
      chatName = chatNameFrom(transcript, nameReadBytes);
    }

    const { model, effort } = sessionState(stateDir, marker.session);
    out.push({ claudePid, cwd: marker.cwd, session: marker.session, chatName, state, model, effort });
  }
  return out;
};

module.exports = {
  listSessions, readMarker, transcriptPath, chatNameFrom, idleWindowMs, DEFAULT_IDLE_MINUTES, NAME_READ_BYTES,
};
