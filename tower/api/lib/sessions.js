//
// The live crew: every Claude session running on this machine right now.
//
// Nothing is registered anywhere for this. The `claude:keep-awake` hook already
// writes one marker file per working session (named for the claude pid, holding
// the caffeinate pid, the cwd, and the session id), and Claude Code already
// appends to a per-session transcript on every message. Those two facts answer
// the whole question: who is running, where, and whether they are working or
// idle. This module reads them exactly as the hook writes them. A second
// bookkeeping file would be a store the tower is not allowed to have.
//
// Facts this depends on, all from the hook (dotfiles hooks/claude/keep-awake),
// which writes a marker of a different SHAPE per platform because the two
// platforms hold a machine awake with different tools. One reader takes both,
// told apart by the marker's NAME, which is the hook's own rule:
//   marker dir     <temp root>/claude-keep-awake, and the statusline cache is
//                  <temp root>/claude-session-state beside it. Which directory
//                  that is per platform is `tempRoot` in repos.js, the one
//                  place the question is asked
//   marker name    macOS: the claude pid; Windows: `win.<session>`.
//                  `.<pid>.lock` directories are the acquire mutex and
//                  `sched.<session>.<key>` are the timed holds; neither is a
//                  session and neither name is admitted
//   marker body    macOS: caffeinate=<pid>, cwd=<path>, session=<id>
//                  Windows: holder=<pid>, beat=<epoch>, fire=, cron=,
//                  cwd=<native path>, session=<id>, transcript=<path>
//   the assertion  macOS: `caffeinate -d -i -w <claude pid>`, matched WHOLE, so
//                  a recycled pid now belonging to something else reads as
//                  stale. Windows: the holder's own heartbeat, below
//   transcript     Windows markers NAME it; a macOS marker does not, and it is
//                  ~/.claude/projects/<cwd, flattened>/<id>.jsonl
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
const { gitPath, tempRoot } = require('./repos');

const DEFAULT_IDLE_MINUTES = 45;

// The two marker names, which are the two shapes: the claude pid on macOS, and
// `win.<session>` on Windows, where finding the claude pid would cost a
// PowerShell spawn on a path that runs before every tool call. A session id is
// `[A-Za-z0-9_-]`, checked by the hook before it lands in a path, so the timed
// holds (`sched.<session>.<key>`) and the acquire locks (`.<pid>.lock`) fail
// both tests.
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
 * How long a transcript may stay quiet before whatever wrote it counts as
 * finished, in milliseconds, honoring the same env var and the same typo guard.
 *
 * This is the ONE liveness rule the tower has: `listSessions` reads it for a
 * session's `state`, and telemetry.js reads it for a subagent's. A second copy
 * of the number would let the same crew read live on one page and finished on
 * another.
 *
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
 * marker of that shape. Split on the FIRST `=` so a value containing one
 * survives, matching the hook's `IFS='=' read -r k v`.
 *
 * `cwd` and `session` are what every shape carries and every row needs. The
 * pid is the one that differs, and only the macOS one is READ: `caffeinate` is
 * that platform's whole liveness answer, so a marker without it is nothing,
 * while the Windows `holder=` is a pid to end a hold with rather than to judge
 * one by (`beatIsFresh` below) and is BLANK until the PowerShell holder's first
 * beat writes it, so nothing here asks for it.
 *
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
 * Is a Windows hold alive? Its own HEARTBEAT, which is the writer's rule and
 * the only one there is: MSYS `ps` cannot see a native Windows process, so the
 * holder says it is alive by rewriting `beat=` every 30 seconds and the hook
 * reads exactly this. A pid probe of `holder=` would be a SECOND liveness rule
 * disagreeing with the hook's own, reading live for a holder that hung without
 * beating and reading nothing at all for a marker just seeded, whose holder is
 * still blank; and unlike the macOS `ps` read it could not tell a recycled pid
 * from the holder, since only the live holder writes a beat.
 *
 * @param {string} beat the marker's `beat=`, epoch SECONDS
 * @param {number} now ms
 * @returns {boolean}
 */
const beatIsFresh = (beat, now) => /^\d+$/.test(beat) && now - Number(beat) * 1000 < BEAT_MAX_MS;

/**
 * Claude Code's transcript path: the cwd with every character outside
 * `[A-Za-z0-9]` flattened to `-`, the case it was written in kept.
 *
 * The rule is read off both machines' own `~/.claude/projects`, each folder
 * compared against the `cwd` the transcripts inside it record: `_Claude` and a
 * directory name carrying a space fold on the Mac, and `C:\Users\x\repo`
 * becomes `C--Users-x-repo` on Windows (a lowercase `c:` stays lowercase). So
 * the colon, the backslash, the underscore and the space fold exactly as the
 * slash and the dot do.
 *
 * This is the derivation for a marker that names no transcript of its own,
 * which is every macOS marker; a Windows marker carries `transcript=`, the path
 * Claude Code itself handed the hook, and is read rather than derived.
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
 * The chat's name: the LAST title the transcript carries. A custom title is the
 * human's own naming and outranks the generated one, however late the generated
 * one was written.
 *
 * The file is read in BOUNDED windows and never whole. A working session's
 * transcript grows without limit, and a busy one passes the 512MB cap on a
 * JavaScript string. `readFileSync(file, 'utf8')` throws ERR_STRING_TOO_LONG
 * there, so reading it all would leave the busiest session on the machine, the
 * one most worth seeing, rendering unnamed. The tail is read first because a
 * rename lands at the end; the head is read only when the tail carried no
 * title, because the generated title is written early. A title straddling a
 * window's edge is missed. A rename that lands there simply shows the earlier
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
 * Every session with a keep-awake marker.
 *
 * `state` is one of:
 *   working  the assertion is live and the transcript moved recently
 *   idle     the assertion is live but the session has gone quiet
 *   stale    the assertion is gone: the caffeinate pid is gone or is now some
 *            other process, or the Windows holder stopped beating
 *
 * `lastActivity` and `aliveSince` are the same two probes the state is decided
 * from, handed over as ms epochs rather than kept private: a page draws how
 * FRESH a session is and how long it has been up, and both of those age between
 * reads, so the times travel and the arithmetic is the reader's.
 *
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

    // The claude pid is the macOS marker's NAME. A Windows marker is keyed by
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
      live = command === `caffeinate -d -i -w ${claudePid}`;
    }

    // The marker's own `transcript=` when it carries one, which is the Windows
    // shape: Claude Code handed the hook that path, so nothing has to be
    // derived. The derivation answers for the markers that name none.
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
    // The cwd is PUBLISHED in git's spelling, the one every roster key is
    // written in, so a reader placing a session in a repo compares like against
    // like. The transcript above stays derived from the marker's own native
    // cwd, because that is the spelling Claude Code names the project folder
    // from.
    out.push({
      claudePid, cwd: gitPath(marker.cwd), session: marker.session, chatName, state, model, effort, transcript, lastActivity, aliveSince,
    });
  }
  return out;
};

module.exports = {
  listSessions, readMarker, transcriptPath, chatNameFrom, idleWindowMs, DEFAULT_IDLE_MINUTES, NAME_READ_BYTES,
};
