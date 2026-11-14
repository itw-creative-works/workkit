//
// Tests for tower/api/lib/sessions.js, the live crew, over fixtures in the shapes
// the claude:keep-awake hook writes; `ps` alone goes through the exec seam.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { asWindows } = require('../lib/platform');

const { listSessions, transcriptPath, chatNameFrom, NAME_READ_BYTES } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'sessions.js'));

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const MINUTE = 60 * 1000;

/** A scratch world: marker dir, fake home, statusline cache dir. */
const mkWorld = () => {
  const root = mkTmp('tower-sessions-');
  const world = {
    root,
    markerDir: path.join(root, 'claude-keep-awake'),
    home: path.join(root, 'home'),
    stateDir: path.join(root, 'claude-session-state'),
    alive: new Map(),
  };
  fs.mkdirSync(world.markerDir, { recursive: true });
  fs.mkdirSync(world.stateDir, { recursive: true });
  // `ps -o command= -p <pid>` for the caffeinate pids this world knows about.
  world.exec = (cmd, args) => {
    const pid = args[args.length - 1];
    if (!world.alive.has(pid)) throw new Error(`ps: no such process ${pid}`);
    return `${world.alive.get(pid)}\n`;
  };
  return world;
};

/** Write a marker exactly as the hook does, and register its assertion. */
const mkMarker = (world, claudePid, { caffeinate = null, cwd = '/x/repo', session = 'sess-1', live = true, holds = null, body = null } = {}) => {
  const caffPid = caffeinate === null ? String(Number(claudePid) + 1000) : caffeinate;
  const file = path.join(world.markerDir, String(claudePid));
  fs.writeFileSync(file, body === null
    ? `caffeinate=${caffPid}\ncwd=${cwd}\nsession=${session}\n`
    : body);
  if (live) world.alive.set(caffPid, `caffeinate -d -i -w ${holds === null ? claudePid : holds}`);
  return file;
};

/**
 * Write a Windows marker exactly as the hook's Windows branch does: named
 * `win.<session>`, carrying the PowerShell holder, its heartbeat, the two
 * scheduling fields and the transcript path the session was handed. `beat` is
 * seconds of age, since that is what the reader judges the hold by.
 */
const mkWinMarker = (world, session, { holder = '4242', beat = 0, fire = '', cron = '', cwd = 'C:\\Users\\x\\repo', transcript = '' } = {}) => {
  const file = path.join(world.markerDir, `win.${session}`);
  const beatAt = Math.floor((Date.now() - beat * 1000) / 1000);
  fs.writeFileSync(file, `holder=${holder}\nbeat=${beatAt}\nfire=${fire}\ncron=${cron}\ncwd=${cwd}\nsession=${session}\ntranscript=${transcript}\n`);
  return file;
};

/** A transcript at the path Claude Code would use, with the given lines. */
const mkTranscript = (world, cwd, session, lines, ageMinutes = 0) => {
  const file = transcriptPath(world.home, cwd, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
  if (ageMinutes) {
    const when = (Date.now() - ageMinutes * MINUTE) / 1000;
    fs.utimesSync(file, when, when);
  }
  return file;
};

const list = (world, opts = {}) => listSessions({
  markerDir: world.markerDir,
  home: world.home,
  stateDir: world.stateDir,
  exec: world.exec,
  ...opts,
});

describe('tower/sessions: liveness', () => {
  test('a marker whose assertion holds its own pid is live and working', () => {
    const w = mkWorld();
    mkMarker(w, 4001, { cwd: '/x/repo', session: 'abc-1' });
    mkTranscript(w, '/x/repo', 'abc-1', ['{"type":"user"}']);
    const [s] = list(w);
    expect(s.claudePid, 'pid from the filename').toBe(4001);
    expect(s.cwd, 'cwd from the marker').toBe('/x/repo');
    expect(s.session, 'session from the marker').toBe('abc-1');
    expect(s.state, 'fresh transcript').toBe('working');
    cleanup(w.root);
  });

  test('a caffeinate pid that is gone reads stale', () => {
    const w = mkWorld();
    mkMarker(w, 4002, { live: false });
    expect(list(w)[0].state, 'no such process').toBe('stale');
    cleanup(w.root);
  });

  test('a recycled caffeinate pid holding someone else reads stale', () => {
    const w = mkWorld();
    // Same shape of command, a different claude pid: the whole-string match is
    // what makes pid recycling detectable.
    mkMarker(w, 4003, { holds: 9999 });
    expect(list(w)[0].state, 'the assertion is not ours').toBe('stale');
    cleanup(w.root);
  });

  test('a stale session reads no transcript - chatName stays null', () => {
    const w = mkWorld();
    mkMarker(w, 4004, { session: 'abc-4', live: false });
    mkTranscript(w, '/x/repo', 'abc-4', ['{"customTitle":"Never read"}']);
    expect(list(w)[0].chatName, 'lazy: live markers only').toBe(null);
    cleanup(w.root);
  });
});

describe('tower/sessions: working vs idle', () => {
  test('a transcript quieter than the threshold is idle, and a fresh one is working', () => {
    const w = mkWorld();
    mkMarker(w, 4101, { cwd: '/x/a', session: 'quiet' });
    mkMarker(w, 4102, { cwd: '/x/b', session: 'busy' });
    mkTranscript(w, '/x/a', 'quiet', ['{}'], 90);
    mkTranscript(w, '/x/b', 'busy', ['{}']);
    const byPid = Object.fromEntries(list(w, { idleMinutes: 45 }).map((s) => [s.claudePid, s.state]));
    expect(byPid[4101], '90 minutes quiet, threshold 45').toBe('idle');
    expect(byPid[4102], 'just touched').toBe('working');
    cleanup(w.root);
  });

  test('the threshold is honored - the same transcript flips with idleMinutes', () => {
    const w = mkWorld();
    mkMarker(w, 4103, { cwd: '/x/a', session: 'q' });
    mkTranscript(w, '/x/a', 'q', ['{}'], 30);
    expect(list(w, { idleMinutes: 45 })[0].state, 'inside 45').toBe('working');
    expect(list(w, { idleMinutes: 10 })[0].state, 'outside 10').toBe('idle');
    cleanup(w.root);
  });

  test('with no transcript the marker mtime is the fallback probe', () => {
    const w = mkWorld();
    const file = mkMarker(w, 4104, { cwd: '/x/gone', session: 'nofile' });
    const when = (Date.now() - 120 * MINUTE) / 1000;
    fs.utimesSync(file, when, when);
    expect(list(w, { idleMinutes: 45 })[0].state, 'the assertion was taken two hours ago').toBe('idle');
    cleanup(w.root);
  });

  test('KEEP_AWAKE_IDLE_MINUTES sets the default, and a non-numeric one falls back to 45', () => {
    const w = mkWorld();
    mkMarker(w, 4105, { cwd: '/x/env', session: 'e' });
    mkTranscript(w, '/x/env', 'e', ['{}'], 20);
    const before = process.env.KEEP_AWAKE_IDLE_MINUTES;
    try {
      process.env.KEEP_AWAKE_IDLE_MINUTES = '10';
      expect(list(w)[0].state, 'the env threshold is honored').toBe('idle');
      process.env.KEEP_AWAKE_IDLE_MINUTES = 'soon';
      expect(list(w)[0].state, 'a typo cannot quietly disable the check').toBe('working');
    } finally {
      if (before === undefined) delete process.env.KEEP_AWAKE_IDLE_MINUTES;
      else process.env.KEEP_AWAKE_IDLE_MINUTES = before;
    }
    cleanup(w.root);
  });
});

describe('tower/sessions: the times a page ages', () => {
  test('a row carries its transcript path, when it last moved and when it began', () => {
    const w = mkWorld();
    mkMarker(w, 4106, { cwd: '/x/times', session: 'tick' });
    const file = mkTranscript(w, '/x/times', 'tick', ['{}'], 5);
    const [s] = list(w);
    expect(s.transcript, 'the transcript the state was read from').toBe(file);
    const quiet = Date.now() - s.lastActivity;
    expect(quiet > 4 * MINUTE && quiet < 6 * MINUTE, `lastActivity is the transcript mtime - five minutes ago, got ${Math.round(quiet / 1000)}s`).toBeTruthy();
    // The birth time is platform-shaped: APFS pulls it back to the aged mtime,
    // ext4 keeps creation time, which can round a moment past the Date.now()
    // sampled here. The window covers both ends instead of a one-sided <= now.
    expect(
      typeof s.aliveSince === 'number'
        && s.aliveSince > Date.now() - 6 * MINUTE
        && s.aliveSince < Date.now() + 2000,
      'aliveSince is when the file was created - within the fixture\'s life',
    ).toBeTruthy();
    cleanup(w.root);
  });

  test('with no transcript the times fall back to the marker, not to null', () => {
    const w = mkWorld();
    const file = mkMarker(w, 4107, { cwd: '/x/gone', session: 'nofile' });
    const when = (Date.now() - 30 * MINUTE) / 1000;
    fs.utimesSync(file, when, when);
    const [s] = list(w);
    const quiet = Date.now() - s.lastActivity;
    expect(quiet > 29 * MINUTE && quiet < 31 * MINUTE, 'the marker mtime is the fallback probe, and it travels').toBeTruthy();
    expect(typeof s.aliveSince === 'number', 'so is its birth time').toBeTruthy();
    cleanup(w.root);
  });

  test('the transcript path flattens every character outside [A-Za-z0-9]', () => {
    expect(transcriptPath('/home/alice', '/Users/alice/Repos/.dotfiles', 'sid'), 'the slash and the dot').toBe(path.join('/home/alice', '.claude', 'projects', '-Users-alice-Repos--dotfiles', 'sid.jsonl'));
    // The underscore and the space prove the rule is not just `/` and `.`: real
    // projects folders hold both, for an `_Claude/` path and for a directory name
    // carrying a space.
    expect(transcriptPath('/home/alice', '/Users/alice/Repos/_Claude/my app', 'sid'), 'the underscore and the space too').toBe(path.join('/home/alice', '.claude', 'projects', '-Users-alice-Repos--Claude-my-app', 'sid.jsonl'));
  });
});

describe('tower/sessions: the Windows spelling', () => {
  test('the cwd goes out in git\'s spelling and the transcript is derived from the native one', () => {
    // Windows gives one directory two names, and the two readers want different
    // ones: the roster keys a repo the way git prints it (`C:/Users/x`), and
    // Claude Code names its project folder from the cwd a session was started
    // in, so the transcript is derived from the marker's own spelling.
    const w = mkWorld();
    const native = 'C:\\Users\\x\\repo\\sub';
    mkMarker(w, 4501, { cwd: native, session: 'win-1' });
    const [s] = asWindows(() => list(w));
    expect(s.cwd, 'the app compares this against a roster key').toBe('C:/Users/x/repo/sub');
    expect(s.transcript, 'and the transcript is unfolded').toBe(transcriptPath(w.home, native, 'win-1'));
    cleanup(w.root);
  });

  test('a win.<session> marker is listed, placed by its folded cwd, with the transcript it names', () => {
    // The shape the hook's Windows branch writes: no caffeinate to record and
    // no claude pid in the name, so the file is keyed by the session and the
    // transcript is the path Claude Code itself handed the hook.
    const w = mkWorld();
    const transcript = path.join(w.home, '.claude', 'projects', 'C--Users-x-repo', 'win-hold.jsonl');
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, '{"customTitle":"Named on Windows"}');
    mkWinMarker(w, 'win-hold', { cwd: 'C:\\Users\\x\\repo', transcript });
    const [s] = asWindows(() => list(w));
    expect(s.session, 'the session from the marker').toBe('win-hold');
    expect(s.cwd, 'placed by the cwd a roster key is written in').toBe('C:/Users/x/repo');
    expect(s.transcript, 'the marker names it, so nothing is derived').toBe(transcript);
    expect(s.state, 'a beat this fresh is a live hold').toBe('working');
    expect(s.chatName, 'and its transcript is read').toBe('Named on Windows');
    expect(s.claudePid, 'the Windows marker carries no claude pid').toBe(null);
    cleanup(w.root);
  });

  test('a Windows hold is alive by its heartbeat: three missed beats read stale', () => {
    // MSYS `ps` cannot see a native Windows process, so the holder says it is
    // alive by rewriting `beat=` every 30 seconds and the reader judges that,
    // exactly as the hook's own `held` does.
    const w = mkWorld();
    mkWinMarker(w, 'fresh', { beat: 30, cwd: 'C:\\Users\\x\\a' });
    mkWinMarker(w, 'gone', { beat: 600, cwd: 'C:\\Users\\x\\b' });
    // The threshold itself, from both sides: the hook's `beat_max` is 90 and it
    // compares with a strict less-than, so 89 holds and 91 does not.
    mkWinMarker(w, 'lastbeat', { beat: 89, cwd: 'C:\\Users\\x\\c' });
    mkWinMarker(w, 'onepast', { beat: 91, cwd: 'C:\\Users\\x\\d' });
    const bySession = Object.fromEntries(asWindows(() => list(w)).map((s) => [s.session, s.state]));
    expect(bySession.fresh, 'one beat ago').toBe('working');
    expect(bySession.gone, 'ten minutes of silence').toBe('stale');
    expect(bySession.lastbeat, 'a second inside the three missed beats').toBe('working');
    expect(bySession.onepast, 'and a second outside them').toBe('stale');
    cleanup(w.root);
  });

  test('a Windows marker whose beat is blank or not a number reads stale', () => {
    // The hook seeds an empty beat for a hold it armed and did not take, and
    // reads one itself only when it is digits. Anything else is not a time.
    const w = mkWorld();
    mkWinMarker(w, 'unarmed', { cwd: 'C:\\Users\\x\\e' });
    fs.writeFileSync(path.join(w.markerDir, 'win.unarmed'), 'holder=\nbeat=\nfire=\ncron=\ncwd=C:\\Users\\x\\e\nsession=unarmed\ntranscript=\n');
    mkWinMarker(w, 'garbled', { beat: 0, cwd: 'C:\\Users\\x\\f' });
    fs.writeFileSync(path.join(w.markerDir, 'win.garbled'), 'holder=1\nbeat=soon\nfire=\ncron=\ncwd=C:\\Users\\x\\f\nsession=garbled\ntranscript=\n');
    // Digits are the whole test, not "reads as a number": `1e12` parses as a
    // time so far ahead that an arithmetic-only check would call it fresh.
    mkWinMarker(w, 'exponent', { beat: 0, cwd: 'C:\\Users\\x\\g' });
    fs.writeFileSync(path.join(w.markerDir, 'win.exponent'), 'holder=1\nbeat=1e12\nfire=\ncron=\ncwd=C:\\Users\\x\\g\nsession=exponent\ntranscript=\n');
    const bySession = Object.fromEntries(asWindows(() => list(w)).map((s) => [s.session, s.state]));
    expect(bySession.unarmed, 'a blank beat is not a live hold').toBe('stale');
    expect(bySession.garbled, 'and neither is a word').toBe('stale');
    expect(bySession.exponent, 'nor a number spelled some other way').toBe('stale');
    cleanup(w.root);
  });

  test('a Windows marker naming no transcript falls back to the derivation, in Claude Code\'s own spelling', () => {
    // The hook writes an empty transcript line when the payload carried no
    // path, which is the only Windows case the derivation answers for.
    const w = mkWorld();
    mkWinMarker(w, 'win-2', { cwd: 'C:\\Users\\x\\repo', transcript: '' });
    const [s] = asWindows(() => list(w));
    expect(s.transcript, 'the colon and the backslashes flatten like everything else').toBe(path.join(w.home, '.claude', 'projects', 'C--Users-x-repo', 'win-2.jsonl'));
    cleanup(w.root);
  });

  test('the marker directory falls back to this machine\'s own temp dir, never to a literal /tmp', () => {
    // Windows has no TMPDIR and no `getconf DARWIN_USER_TEMP_DIR`, and a Node
    // there reads `/tmp` as `C:\tmp`, a directory the hook never writes to.
    const w = mkWorld();
    mkMarker(w, 4601, { cwd: '/x/found', session: 'byfallback' });
    mkTranscript(w, '/x/found', 'byfallback', ['{}']);
    const realTmpdir = os.tmpdir;
    const before = process.env.TMPDIR;
    try {
      delete process.env.TMPDIR;
      os.tmpdir = () => w.root;
      // No markerDir: the resolution under test is the one listSessions makes.
      const found = listSessions({ home: w.home, stateDir: w.stateDir, exec: w.exec });
      expect(found.length, 'the markers were found where this machine keeps its temp files').toBe(1);
      expect(found[0].session, 'the real one').toBe('byfallback');
    } finally {
      os.tmpdir = realTmpdir;
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
    cleanup(w.root);
  });
});

describe('tower/sessions: the chat name', () => {
  test('the LAST customTitle wins, and it beats a later aiTitle', () => {
    const w = mkWorld();
    mkMarker(w, 4201, { cwd: '/x/c', session: 'titled' });
    mkTranscript(w, '/x/c', 'titled', [
      '{"aiTitle":"Generated first"}',
      '{"customTitle":"Alice named it"}',
      '{"customTitle":"Alice renamed it"}',
      '{"aiTitle":"Generated later"}',
    ]);
    expect(list(w)[0].chatName, 'custom, last match').toBe('Alice renamed it');
    cleanup(w.root);
  });

  test('with no custom title the last aiTitle is used, and with neither it is null', () => {
    const w = mkWorld();
    mkMarker(w, 4202, { cwd: '/x/d', session: 'ai' });
    mkMarker(w, 4203, { cwd: '/x/e', session: 'untitled' });
    mkTranscript(w, '/x/d', 'ai', ['{"aiTitle":"First"}', '{"aiTitle":"Second"}']);
    mkTranscript(w, '/x/e', 'untitled', ['{"type":"user"}']);
    const byPid = Object.fromEntries(list(w).map((s) => [s.claudePid, s.chatName]));
    expect(byPid[4202], 'last aiTitle').toBe('Second');
    expect(byPid[4203], 'no title at all').toBe(null);
    cleanup(w.root);
  });

  test('the title is found at the head of a transcript far larger than the read window', () => {
    const w = mkWorld();
    mkMarker(w, 4204, { cwd: '/x/big', session: 'big' });
    // The title is in the first line; everything after it is filler well past
    // the budget, so only a head read can find it.
    mkTranscript(w, '/x/big', 'big', [
      '{"aiTitle":"Written early"}',
      `{"padding":"${'x'.repeat(4000)}"}`,
      `{"padding":"${'y'.repeat(4000)}"}`,
    ]);
    expect(list(w, { nameReadBytes: 512 })[0].chatName, 'the head window carries it').toBe('Written early');
    cleanup(w.root);
  });

  test('a title only in the middle is missed - the read is bounded, never whole', () => {
    const w = mkWorld();
    mkMarker(w, 4205, { cwd: '/x/mid', session: 'mid' });
    mkTranscript(w, '/x/mid', 'mid', [
      `{"padding":"${'a'.repeat(4000)}"}`,
      '{"customTitle":"Buried in the middle"}',
      `{"padding":"${'b'.repeat(4000)}"}`,
    ]);
    expect(list(w, { nameReadBytes: 512 })[0].chatName, 'outside both windows, so never read').toBe(null);
    cleanup(w.root);
  });

  test('a tail title wins over a head title, and the budget defaults to 256KB', () => {
    const w = mkWorld();
    mkMarker(w, 4206, { cwd: '/x/both', session: 'both' });
    const file = mkTranscript(w, '/x/both', 'both', [
      '{"customTitle":"Old name"}',
      `{"padding":"${'z'.repeat(4000)}"}`,
      '{"customTitle":"New name"}',
    ]);
    expect(list(w, { nameReadBytes: 512 })[0].chatName, 'the tail is read first').toBe('New name');
    expect(chatNameFrom(file), 'and the default budget agrees').toBe('New name');
    expect(NAME_READ_BYTES, 'the default budget is 256KB').toBe(262144);
    cleanup(w.root);
  });

  test('a transcript smaller than the budget is read once, not twice', () => {
    const w = mkWorld();
    mkMarker(w, 4207, { cwd: '/x/small', session: 'small' });
    const file = mkTranscript(w, '/x/small', 'small', ['{"customTitle":"Tiny"}']);
    expect(chatNameFrom(file, 1024), 'the tail covered the whole file').toBe('Tiny');
    expect(chatNameFrom(path.join(w.root, 'absent.jsonl'), 1024), 'a missing file is null').toBe(null);
    cleanup(w.root);
  });
});

describe('tower/sessions: model and effort', () => {
  test('the statusline cache supplies model and effort, keyed by the safe session id', () => {
    const w = mkWorld();
    mkMarker(w, 4301, { cwd: '/x/f', session: 'd931ba4c-4e3b' });
    mkTranscript(w, '/x/f', 'd931ba4c-4e3b', ['{}']);
    fs.writeFileSync(path.join(w.stateDir, 'd931ba4c_4e3b.json'), JSON.stringify({
      model: { id: 'claude-opus-5', display_name: 'Opus 5' },
      effort: { level: 'high' },
    }));
    const [s] = list(w);
    expect(s.model, 'model.id preferred').toBe('claude-opus-5');
    expect(s.effort, 'effort.level').toBe('high');
    cleanup(w.root);
  });

  test('a cache with only a display name falls back to it; no cache reads null', () => {
    const w = mkWorld();
    mkMarker(w, 4302, { cwd: '/x/g', session: 'named' });
    mkMarker(w, 4303, { cwd: '/x/h', session: 'uncached' });
    mkTranscript(w, '/x/g', 'named', ['{}']);
    mkTranscript(w, '/x/h', 'uncached', ['{}']);
    fs.writeFileSync(path.join(w.stateDir, 'named.json'), JSON.stringify({ model: { display_name: 'Sonnet' } }));
    const byPid = Object.fromEntries(list(w).map((s) => [s.claudePid, s]));
    expect(byPid[4302].model, 'display_name fallback').toBe('Sonnet');
    expect(byPid[4302].effort, 'no effort in the cache').toBe(null);
    expect(byPid[4303].model, 'a VS Code session never runs statusLine').toBe(null);
    expect(byPid[4303].effort, 'and has no effort either').toBe(null);
    cleanup(w.root);
  });
});

describe('tower/sessions: what is skipped', () => {
  test('only a name that is entirely digits is a marker - locks and stray files are not', () => {
    const w = mkWorld();
    mkMarker(w, 4401, { cwd: '/x/i', session: 'ok' });
    mkTranscript(w, '/x/i', 'ok', ['{}']);
    // The acquire lock, a dot file whose remainder is numeric, a stray file, and
    // a pid-like name with a suffix. The numeric test is the whole filter: a
    // leading dot fails it too, so no separate dot guard is needed.
    fs.mkdirSync(path.join(w.markerDir, '.4401.lock'));
    fs.writeFileSync(path.join(w.markerDir, '.12345'), 'caffeinate=1\ncwd=/x\nsession=s\n');
    fs.writeFileSync(path.join(w.markerDir, 'README'), 'not a marker');
    fs.writeFileSync(path.join(w.markerDir, '4401.tmp'), 'caffeinate=1\ncwd=/x\nsession=s\n');
    const found = list(w);
    expect(found.length, 'only the marker').toBe(1);
    expect(found[0].claudePid, 'the real one').toBe(4401);
    cleanup(w.root);
  });

  test('a marker missing any of its three fields is skipped', () => {
    const w = mkWorld();
    mkMarker(w, 4402, { body: 'cwd=/x/j\n' });
    mkMarker(w, 4403, { body: 'caffeinate=1\nsession=s\n' });
    mkMarker(w, 4404, { body: '' });
    expect(list(w).length, 'nothing usable').toBe(0);
    cleanup(w.root);
  });

  test('a value containing = survives the split on the first one', () => {
    const w = mkWorld();
    mkMarker(w, 4405, { cwd: '/x/a=b', session: 'eq' });
    mkTranscript(w, '/x/a=b', 'eq', ['{}']);
    expect(list(w)[0].cwd, 'the whole remainder is the value').toBe('/x/a=b');
    cleanup(w.root);
  });

  test('a missing marker directory is an empty crew, not an exception', () => {
    const w = mkWorld();
    cleanup(w.markerDir);
    expect(list(w).length, 'nothing running').toBe(0);
    cleanup(w.root);
  });
});
