//
// Tests for tower/api/lib/sessions.js - the live crew.
//
// Everything is a fixture: a scratch marker directory, a scratch ~/.claude
// projects tree, a scratch statusline cache. The real TMPDIR markers belong to
// the sessions actually running on this machine and are never touched, and `ps`
// is the one call that cannot be faked with a file - it gets the exec seam.
//
// The marker shapes here are the ones the claude:keep-awake hook writes:
// a file named for the claude pid holding caffeinate=, cwd= and session=, and
// `.<pid>.lock` directories alongside them for the acquire mutex.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { listSessions, transcriptPath, chatNameFrom, NAME_READ_BYTES } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'sessions.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-sessions-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const MINUTE = 60 * 1000;

/** A scratch world: marker dir, fake home, statusline cache dir. */
const mkWorld = () => {
  const root = mkTmp();
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

const run = async () => {
  group('tower/sessions: liveness');

  await test('a marker whose assertion holds its own pid is live and working', () => {
    const w = mkWorld();
    mkMarker(w, 4001, { cwd: '/x/repo', session: 'abc-1' });
    mkTranscript(w, '/x/repo', 'abc-1', ['{"type":"user"}']);
    const [s] = list(w);
    assertEq(s.claudePid, 4001, 'pid from the filename');
    assertEq(s.cwd, '/x/repo', 'cwd from the marker');
    assertEq(s.session, 'abc-1', 'session from the marker');
    assertEq(s.state, 'working', 'fresh transcript');
    cleanup(w.root);
  });

  await test('a caffeinate pid that is gone reads stale', () => {
    const w = mkWorld();
    mkMarker(w, 4002, { live: false });
    assertEq(list(w)[0].state, 'stale', 'no such process');
    cleanup(w.root);
  });

  await test('a recycled caffeinate pid holding someone else reads stale', () => {
    const w = mkWorld();
    // Same shape of command, a DIFFERENT claude pid - the whole-string match is
    // what makes pid recycling detectable.
    mkMarker(w, 4003, { holds: 9999 });
    assertEq(list(w)[0].state, 'stale', 'the assertion is not ours');
    cleanup(w.root);
  });

  await test('a stale session reads no transcript - chatName stays null', () => {
    const w = mkWorld();
    mkMarker(w, 4004, { session: 'abc-4', live: false });
    mkTranscript(w, '/x/repo', 'abc-4', ['{"customTitle":"Never read"}']);
    assertEq(list(w)[0].chatName, null, 'lazy: live markers only');
    cleanup(w.root);
  });

  group('tower/sessions: working vs idle');

  await test('a transcript quieter than the threshold is idle, and a fresh one is working', () => {
    const w = mkWorld();
    mkMarker(w, 4101, { cwd: '/x/a', session: 'quiet' });
    mkMarker(w, 4102, { cwd: '/x/b', session: 'busy' });
    mkTranscript(w, '/x/a', 'quiet', ['{}'], 90);
    mkTranscript(w, '/x/b', 'busy', ['{}']);
    const byPid = Object.fromEntries(list(w, { idleMinutes: 45 }).map((s) => [s.claudePid, s.state]));
    assertEq(byPid[4101], 'idle', '90 minutes quiet, threshold 45');
    assertEq(byPid[4102], 'working', 'just touched');
    cleanup(w.root);
  });

  await test('the threshold is honored - the same transcript flips with idleMinutes', () => {
    const w = mkWorld();
    mkMarker(w, 4103, { cwd: '/x/a', session: 'q' });
    mkTranscript(w, '/x/a', 'q', ['{}'], 30);
    assertEq(list(w, { idleMinutes: 45 })[0].state, 'working', 'inside 45');
    assertEq(list(w, { idleMinutes: 10 })[0].state, 'idle', 'outside 10');
    cleanup(w.root);
  });

  await test('with no transcript the marker mtime is the fallback probe', () => {
    const w = mkWorld();
    const file = mkMarker(w, 4104, { cwd: '/x/gone', session: 'nofile' });
    const when = (Date.now() - 120 * MINUTE) / 1000;
    fs.utimesSync(file, when, when);
    assertEq(list(w, { idleMinutes: 45 })[0].state, 'idle', 'the assertion was taken two hours ago');
    cleanup(w.root);
  });

  await test('KEEP_AWAKE_IDLE_MINUTES sets the default, and a non-numeric one falls back to 45', () => {
    const w = mkWorld();
    mkMarker(w, 4105, { cwd: '/x/env', session: 'e' });
    mkTranscript(w, '/x/env', 'e', ['{}'], 20);
    const before = process.env.KEEP_AWAKE_IDLE_MINUTES;
    try {
      process.env.KEEP_AWAKE_IDLE_MINUTES = '10';
      assertEq(list(w)[0].state, 'idle', 'the env threshold is honored');
      process.env.KEEP_AWAKE_IDLE_MINUTES = 'soon';
      assertEq(list(w)[0].state, 'working', 'a typo cannot quietly disable the check');
    } finally {
      if (before === undefined) delete process.env.KEEP_AWAKE_IDLE_MINUTES;
      else process.env.KEEP_AWAKE_IDLE_MINUTES = before;
    }
    cleanup(w.root);
  });

  group('tower/sessions: the times a page ages');

  await test('a row carries its transcript path, when it last moved and when it began', () => {
    const w = mkWorld();
    mkMarker(w, 4106, { cwd: '/x/times', session: 'tick' });
    const file = mkTranscript(w, '/x/times', 'tick', ['{}'], 5);
    const [s] = list(w);
    assertEq(s.transcript, file, 'the transcript the state was read from');
    const quiet = Date.now() - s.lastActivity;
    assert(quiet > 4 * MINUTE && quiet < 6 * MINUTE, `lastActivity is the transcript mtime - five minutes ago, got ${Math.round(quiet / 1000)}s`);
    // The birth time is platform-shaped: APFS pulls it back to the aged mtime,
    // ext4 keeps creation time, which can round a moment past the Date.now()
    // sampled here. The window covers both ends instead of a one-sided <= now.
    assert(
      typeof s.aliveSince === 'number'
        && s.aliveSince > Date.now() - 6 * MINUTE
        && s.aliveSince < Date.now() + 2000,
      'aliveSince is when the file was created - within the fixture\'s life',
    );
    cleanup(w.root);
  });

  await test('with no transcript the times fall back to the marker, not to null', () => {
    const w = mkWorld();
    const file = mkMarker(w, 4107, { cwd: '/x/gone', session: 'nofile' });
    const when = (Date.now() - 30 * MINUTE) / 1000;
    fs.utimesSync(file, when, when);
    const [s] = list(w);
    const quiet = Date.now() - s.lastActivity;
    assert(quiet > 29 * MINUTE && quiet < 31 * MINUTE, 'the marker mtime is the fallback probe, and it travels');
    assert(typeof s.aliveSince === 'number', 'so is its birth time');
    cleanup(w.root);
  });

  await test('the transcript path flattens both / and . in the cwd', () => {
    assertEq(
      transcriptPath('/home/ian', '/Users/ian/Repos/.dotfiles', 'sid'),
      path.join('/home/ian', '.claude', 'projects', '-Users-ian-Repos--dotfiles', 'sid.jsonl'),
      'the hook does tr /. --',
    );
  });

  group('tower/sessions: the chat name');

  await test('the LAST customTitle wins, and it beats a later aiTitle', () => {
    const w = mkWorld();
    mkMarker(w, 4201, { cwd: '/x/c', session: 'titled' });
    mkTranscript(w, '/x/c', 'titled', [
      '{"aiTitle":"Generated first"}',
      '{"customTitle":"Ian named it"}',
      '{"customTitle":"Ian renamed it"}',
      '{"aiTitle":"Generated later"}',
    ]);
    assertEq(list(w)[0].chatName, 'Ian renamed it', 'custom, last match');
    cleanup(w.root);
  });

  await test('with no custom title the last aiTitle is used, and with neither it is null', () => {
    const w = mkWorld();
    mkMarker(w, 4202, { cwd: '/x/d', session: 'ai' });
    mkMarker(w, 4203, { cwd: '/x/e', session: 'untitled' });
    mkTranscript(w, '/x/d', 'ai', ['{"aiTitle":"First"}', '{"aiTitle":"Second"}']);
    mkTranscript(w, '/x/e', 'untitled', ['{"type":"user"}']);
    const byPid = Object.fromEntries(list(w).map((s) => [s.claudePid, s.chatName]));
    assertEq(byPid[4202], 'Second', 'last aiTitle');
    assertEq(byPid[4203], null, 'no title at all');
    cleanup(w.root);
  });

  await test('the title is found at the head of a transcript far larger than the read window', () => {
    const w = mkWorld();
    mkMarker(w, 4204, { cwd: '/x/big', session: 'big' });
    // The title is in the first line; everything after it is filler well past
    // the budget, so only a HEAD read can find it.
    mkTranscript(w, '/x/big', 'big', [
      '{"aiTitle":"Written early"}',
      `{"padding":"${'x'.repeat(4000)}"}`,
      `{"padding":"${'y'.repeat(4000)}"}`,
    ]);
    assertEq(list(w, { nameReadBytes: 512 })[0].chatName, 'Written early', 'the head window carries it');
    cleanup(w.root);
  });

  await test('a title only in the middle is missed - the read is bounded, never whole', () => {
    const w = mkWorld();
    mkMarker(w, 4205, { cwd: '/x/mid', session: 'mid' });
    mkTranscript(w, '/x/mid', 'mid', [
      `{"padding":"${'a'.repeat(4000)}"}`,
      '{"customTitle":"Buried in the middle"}',
      `{"padding":"${'b'.repeat(4000)}"}`,
    ]);
    assertEq(list(w, { nameReadBytes: 512 })[0].chatName, null, 'outside both windows, so never read');
    cleanup(w.root);
  });

  await test('a tail title wins over a head title, and the budget defaults to 256KB', () => {
    const w = mkWorld();
    mkMarker(w, 4206, { cwd: '/x/both', session: 'both' });
    const file = mkTranscript(w, '/x/both', 'both', [
      '{"customTitle":"Old name"}',
      `{"padding":"${'z'.repeat(4000)}"}`,
      '{"customTitle":"New name"}',
    ]);
    assertEq(list(w, { nameReadBytes: 512 })[0].chatName, 'New name', 'the tail is read first');
    assertEq(chatNameFrom(file), 'New name', 'and the default budget agrees');
    assertEq(NAME_READ_BYTES, 262144, 'the default budget is 256KB');
    cleanup(w.root);
  });

  await test('a transcript smaller than the budget is read once, not twice', () => {
    const w = mkWorld();
    mkMarker(w, 4207, { cwd: '/x/small', session: 'small' });
    const file = mkTranscript(w, '/x/small', 'small', ['{"customTitle":"Tiny"}']);
    assertEq(chatNameFrom(file, 1024), 'Tiny', 'the tail covered the whole file');
    assertEq(chatNameFrom(path.join(w.root, 'absent.jsonl'), 1024), null, 'a missing file is null');
    cleanup(w.root);
  });

  group('tower/sessions: model and effort');

  await test('the statusline cache supplies model and effort, keyed by the safe session id', () => {
    const w = mkWorld();
    mkMarker(w, 4301, { cwd: '/x/f', session: 'd931ba4c-4e3b' });
    mkTranscript(w, '/x/f', 'd931ba4c-4e3b', ['{}']);
    fs.writeFileSync(path.join(w.stateDir, 'd931ba4c_4e3b.json'), JSON.stringify({
      model: { id: 'claude-opus-5', display_name: 'Opus 5' },
      effort: { level: 'high' },
    }));
    const [s] = list(w);
    assertEq(s.model, 'claude-opus-5', 'model.id preferred');
    assertEq(s.effort, 'high', 'effort.level');
    cleanup(w.root);
  });

  await test('a cache with only a display name falls back to it; no cache reads null', () => {
    const w = mkWorld();
    mkMarker(w, 4302, { cwd: '/x/g', session: 'named' });
    mkMarker(w, 4303, { cwd: '/x/h', session: 'uncached' });
    mkTranscript(w, '/x/g', 'named', ['{}']);
    mkTranscript(w, '/x/h', 'uncached', ['{}']);
    fs.writeFileSync(path.join(w.stateDir, 'named.json'), JSON.stringify({ model: { display_name: 'Sonnet' } }));
    const byPid = Object.fromEntries(list(w).map((s) => [s.claudePid, s]));
    assertEq(byPid[4302].model, 'Sonnet', 'display_name fallback');
    assertEq(byPid[4302].effort, null, 'no effort in the cache');
    assertEq(byPid[4303].model, null, 'a VS Code session never runs statusLine');
    assertEq(byPid[4303].effort, null, 'and has no effort either');
    cleanup(w.root);
  });

  group('tower/sessions: what is skipped');

  await test('only a name that is entirely digits is a marker - locks and stray files are not', () => {
    const w = mkWorld();
    mkMarker(w, 4401, { cwd: '/x/i', session: 'ok' });
    mkTranscript(w, '/x/i', 'ok', ['{}']);
    // The acquire lock, a dot file whose remainder IS numeric, a stray file, and
    // a pid-like name with a suffix. The numeric test is the whole filter - a
    // separate dot guard would be redundant, since a leading dot fails it too.
    fs.mkdirSync(path.join(w.markerDir, '.4401.lock'));
    fs.writeFileSync(path.join(w.markerDir, '.12345'), 'caffeinate=1\ncwd=/x\nsession=s\n');
    fs.writeFileSync(path.join(w.markerDir, 'README'), 'not a marker');
    fs.writeFileSync(path.join(w.markerDir, '4401.tmp'), 'caffeinate=1\ncwd=/x\nsession=s\n');
    const found = list(w);
    assertEq(found.length, 1, 'only the marker');
    assertEq(found[0].claudePid, 4401, 'the real one');
    cleanup(w.root);
  });

  await test('a marker missing any of its three fields is skipped', () => {
    const w = mkWorld();
    mkMarker(w, 4402, { body: 'cwd=/x/j\n' });
    mkMarker(w, 4403, { body: 'caffeinate=1\nsession=s\n' });
    mkMarker(w, 4404, { body: '' });
    assertEq(list(w).length, 0, 'nothing usable');
    cleanup(w.root);
  });

  await test('a value containing = survives the split on the first one', () => {
    const w = mkWorld();
    mkMarker(w, 4405, { cwd: '/x/a=b', session: 'eq' });
    mkTranscript(w, '/x/a=b', 'eq', ['{}']);
    assertEq(list(w)[0].cwd, '/x/a=b', 'the whole remainder is the value');
    cleanup(w.root);
  });

  await test('a missing marker directory is an empty crew, not an exception', () => {
    const w = mkWorld();
    cleanup(w.markerDir);
    assertEq(list(w).length, 0, 'nothing running');
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
