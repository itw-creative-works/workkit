// The live crew: every Claude session on this machine, read from what already
// exists: the `claude:keep-awake` hook's markers (one per working session, a
// shape per platform, told apart by name) and Claude Code's transcripts. The
// marker contract is the hook's own (dotfiles hooks/claude/keep-awake).
//
// Usage:
//   listSessions();                                  // live
//   listSessions({ markerDir, home, stateDir, exec }); // offline, from fixtures

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { gitPath, tempRoot } = require('./repos');

const DEFAULT_IDLE_MINUTES = 45;

// The two marker names: the claude pid on macOS, `win.<session>` on Windows,
// where finding the claude pid costs a PowerShell spawn. The timed holds
// (`sched.<session>.<key>`) and the acquire locks (`.<pid>.lock`) fail both.
const MAC_MARKER = /^\d+$/;
const WIN_MARKER = /^win\.[A-Za-z0-9_-]+$/;

// Three missed beats. The Windows holder rewrites its marker's `beat=` every
// 30 seconds, and the hook calls 90 seconds of silence gone.
const BEAT_MAX_MS = 90 * 1000;

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
const markerRoot = (exec) => path.join(tempRoot(exec), 'claude-keep-awake');

/** Where the statusline hook caches model and effort. */
const stateRoot = (exec) => path.join(tempRoot(exec), 'claude-session-state');

/**
 * How long a transcript may stay quiet before its writer counts as finished, in
 * ms: the one liveness rule, read by `listSessions` and telemetry.js alike.
 * @param {object} opts the caller's options: `idleMinutes` overrides everything
 * @returns {number} milliseconds
 */
const idleWindowMs = (opts) => {
  const minutes = (() => {
    if (typeof opts.idleMinutes === 'number') return opts.idleMinutes;
    const env = process.env.KEEP_AWAKE_IDLE_MINUTES;
    // A non-numeric override falls back rather than passing through. The hook
    // makes the same call, so a typo cannot quietly disable the idle check.
    if (env && /^\d+$/.test(env)) return Number(env);
    return DEFAULT_IDLE_MINUTES;
  })();
  return minutes * 60 * 1000;
};

/**
 * A marker's fields, whichever shape it is in, or null when it is not a whole
 * marker of that shape. Split on the first `=`, matching the hook's reader.
 * Only the macOS pid (`caffeinate`, that platform's whole liveness answer) is
 * required; the Windows `holder=` is blank until its first beat.
 * @param {string} file
 * @param {boolean} [windows] the shape the marker's name said it is
 * @returns {{caffeinate: string, cwd: string, session: string, beat: string, transcript: string}|null}
 */
const readMarker = (file, windows = false) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const out = {
    caffeinate: '', cwd: '', session: '', beat: '', transcript: '',
  };
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx);
    if (key in out) out[key] = line.slice(idx + 1);
  }
  if (!out.cwd || !out.session) return null;
  if (!windows && !out.caffeinate) return null;
  return out;
};

/**
 * Is a Windows hold alive? Its own heartbeat, the hook's rule: MSYS `ps` cannot
 * see a native Windows process, and a pid probe would be a second liveness rule.
 * @param {string} beat the marker's `beat=`, epoch seconds
 * @param {number} now ms
 * @returns {boolean}
 */
const beatIsFresh = (beat, now) => /^\d+$/.test(beat) && now - Number(beat) * 1000 < BEAT_MAX_MS;

/**
 * Claude Code's transcript path: the cwd with every character outside
 * `[A-Za-z0-9]` flattened to `-`, case kept (`C:\Users\x` is `C--Users-x`).
 * Only for a marker naming no `transcript=` of its own, which is every macOS one.
 */
const transcriptPath = (home, cwd, session) => {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
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
 * The chat's name: the last title the transcript carries, a custom title over a
 * generated one. Read in bounded windows, never whole: a busy transcript passes
 * the 512MB string cap. Tail first (a rename lands late), head only when the
 * tail has none; a title straddling a window's edge is missed.
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

/** Model and effort from the statusline cache, or nulls (a VS Code session writes none). */
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
 * When a file was created, in ms, or null when it cannot be probed.
 *
 * A filesystem with no birth time answers 0 (Node's documented fallback), which
 * is not a time anything happened: it reads as unknown rather than as 1970.
 *
 * @param {string} file
 * @returns {number|null}
 */
const birthMs = (file) => {
  try {
    const { birthtimeMs } = fs.statSync(file);
    return birthtimeMs > 0 ? birthtimeMs : null;
  } catch {
    return null;
  }
};

/**
 * Every session with a keep-awake marker, `state` working, idle, or stale (assertion gone).
 * @param {object} [opts]
 * @param {string} [opts.markerDir] override the marker directory
 * @param {string} [opts.home] override ~ for transcript resolution
 * @param {string} [opts.stateDir] override the statusline cache directory
 * @param {number} [opts.idleMinutes] override the idle threshold
 * @param {Function} [opts.exec] (cmd, args) => stdout: the `ps` seam
 * @param {number} [opts.now] override "now" in ms
 * @param {number} [opts.nameReadBytes] bytes read from each end of a transcript
 * @returns {Array<{claudePid: number|null, cwd: string, session: string, chatName: string|null, state: string, model: string|null, effort: string|null, transcript: string, lastActivity: number|null, aliveSince: number|null}>}
 */
const listSessions = (opts = {}) => {
  const exec = opts.exec || defaultExec;
  const markerDir = opts.markerDir || markerRoot(exec);
  const home = opts.home || os.homedir();
  const stateDir = opts.stateDir || stateRoot(exec);
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
    // Which shape this marker is, which is the one place the platforms differ:
    // everything past here reads one record.
    const windows = WIN_MARKER.test(name);
    if (!windows && !MAC_MARKER.test(name)) continue;
    const file = path.join(markerDir, name);
    const marker = readMarker(file, windows);
    if (!marker) continue;

    // The claude pid is the macOS marker's name. A Windows marker is keyed by
    // the session instead and carries no claude pid at all, so the row says so
    // rather than passing off the PowerShell holder's pid as one.
    const claudePid = windows ? null : Number(name);
    let live;
    if (windows) {
      live = beatIsFresh(marker.beat, now);
    } else {
      let command = '';
      try {
        command = exec('ps', ['-o', 'command=', '-p', marker.caffeinate]).trim();
      } catch {
        command = '';
      }
      // Matched whole, so a recycled pid now naming another process reads stale.
      live = command === `caffeinate -d -i -w ${claudePid}`;
    }

    // The marker's own `transcript=` (the Windows shape) when it carries one;
    // the derivation answers for the rest.
    const transcript = marker.transcript || transcriptPath(home, marker.cwd, marker.session);
    // The marker's own times are when the assertion was taken: the right
    // fallback when the transcript cannot be read.
    const probed = mtimeMs(transcript);
    const lastActivity = probed === null ? mtimeMs(file) : probed;
    const born = birthMs(transcript);
    const aliveSince = born === null ? birthMs(file) : born;

    let state = 'stale';
    let chatName = null;
    if (live) {
      state = lastActivity !== null && now - lastActivity > idleMs ? 'idle' : 'working';
      chatName = chatNameFrom(transcript, nameReadBytes);
    }

    const { model, effort } = sessionState(stateDir, marker.session);
    // The cwd is published in git's spelling, the roster key's, so a reader
    // compares like with like; the transcript stays derived from the native cwd.
    out.push({
      claudePid, cwd: gitPath(marker.cwd), session: marker.session, chatName, state, model, effort, transcript, lastActivity, aliveSince,
    });
  }
  return out;
};

module.exports = {
  listSessions, readMarker, transcriptPath, chatNameFrom, idleWindowMs, DEFAULT_IDLE_MINUTES, NAME_READ_BYTES,
};
