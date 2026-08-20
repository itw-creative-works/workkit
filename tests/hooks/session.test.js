//
// Tests for hooks/docs:session — the SessionStart hook that hands a session
// back its own `.workkit/agents/session.md`.
//
// Every case runs the real hook against a fixture repo. The hook reaches no
// network, so there is nothing to stub: the whole surface is the file, the
// committed settings.json, the light bar, and the cloud brief's marker.
//
// HOME is a scratch directory in every case — the marker the hook reads
// (`~/.workkit/brief-status.json`, issue #173) lives there, and a suite pointed
// at the real home would read whatever this machine's last morning wrote.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'session', 'run.sh');
const TEMPLATE = path.join(__dirname, '..', '..', 'workflow', 'templates', 'session.md');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'session-hook-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A git repo that has opted in, optionally holding a session.md.
 * `optedIn: false` leaves out the committed settings.json; `enabled: false`
 * writes the project-level no.
 */
const mkRepo = ({ session, optedIn = true, enabled = true } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  if (optedIn) {
    fs.writeFileSync(path.join(dir, W, 'settings.json'), JSON.stringify({ version: 1, enabled }));
  }
  if (session !== undefined) {
    fs.mkdirSync(path.join(dir, W, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'agents', 'session.md'), session);
  }
  return dir;
};

// The home every case runs against unless it wants a marker: an empty scratch
// directory, so `~/.workkit/brief-status.json` is absent and the brief half of
// the hook says nothing.
const BARE_HOME = mkTmp();

/**
 * A scratch home carrying the cloud brief's marker and the machine's settings.
 * `marker` and `settings` are written VERBATIM — a case about a file that does
 * not parse is one of the cases.
 */
const mkHome = ({ marker, settings } = {}) => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, W), { recursive: true });
  if (marker !== undefined) fs.writeFileSync(path.join(home, W, 'brief-status.json'), marker);
  if (settings !== undefined) fs.writeFileSync(path.join(home, W, 'settings.json'), settings);
  return home;
};

// A date N whole days back, in UTC — the calendar the hook counts in.
const daysAgo = (n) => new Date(Date.now() - (n * 86400000)).toISOString().slice(0, 10);

// The marker the 9am job writes: a brief N days back, read off the board M days
// back — which is today unless the case is about a machine that was off.
const marker = (n, checkedDaysAgo = 0) => JSON.stringify({
  version: 1,
  lastBrief: daysAgo(n),
  checkedAt: `${daysAgo(checkedDaysAgo)}T09:00:00Z`,
});

const runHook = (cwd, source = 'startup', home = BARE_HOME) => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd, source, hook_event_name: 'SessionStart' }),
    env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const ctxOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;
const msgOf = (stdout) => JSON.parse(stdout).systemMessage;

const filled = (lines) => [
  '# Session',
  '',
  '## Active',
  ...lines.map((l) => `- ${l}`),
  '',
  '## Queue',
  '',
  '## Notes',
  '',
].join('\n');

const run = async () => {
  group('session: the file is injected when it has content');

  await test('a non-empty session.md is handed back, with the path named', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    const ctx = ctxOf(stdout);
    assert(ctx.includes('#12 — the board sweep, mid-build'), 'the content is in the context');
    assert(ctx.includes(`${W}/agents/session.md`), 'the preamble names the file');
    assertEq(JSON.parse(stdout).hookSpecificOutput.hookEventName, 'SessionStart', 'correct event name');
    cleanup(repo);
  });

  await test('a compaction gets it too — every source, not just startup', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const { stdout } = runHook(repo, 'compact');
    assert(ctxOf(stdout).includes('#12 — mid-build'), 'injected after a compaction');
    cleanup(repo);
  });

  await test('a session opened in a subdirectory finds the repo root', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const { stdout } = runHook(sub);
    assert(ctxOf(stdout).includes('#12 — mid-build'), 'resolved from the subdirectory');
    cleanup(repo);
  });

  await test('hooks.json registers the hook under SessionStart, for every source', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entry = settings.hooks.SessionStart
      .find((e) => e.hooks.some((h) => h.command.includes('docs:session')));
    assert(entry, 'docs:session is wired');
    assert(!entry.matcher, 'no matcher — a compacted session is the case it exists for');
  });

  group('session: the closing lines');

  await test('the context ends with the owner resume line', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const ctx = ctxOf(runHook(repo).stdout);
    assertEq(
      ctx.split('\n').pop(),
      'Owner: state carried over — say "continue" and this session resumes the queue above.',
      'the last line is addressed to the owner',
    );
    cleanup(repo);
  });

  await test('the context carries the manager duty line', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(
      ctx.includes('Manager: open your first reply after a restart or compaction with this state in plain words.'),
      'the first reply after a restart opens with the state',
    );
    cleanup(repo);
  });

  await test('the owner hears it — the resume line rides the visible channel too', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const { stdout } = runHook(repo);
    assertEq(
      msgOf(stdout),
      'workkit: state carried over — say "continue" to resume the session queue',
      'the systemMessage is the owner line',
    );
    cleanup(repo);
  });

  await test('a rule separates the file body from the closing lines', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const lines = ctxOf(runHook(repo).stdout).split('\n');
    const rule = lines.indexOf('---');
    assert(rule > 0, 'the injection carries a --- rule');
    assert(lines.findIndex((l) => l.includes('#12 — mid-build')) < rule,
      'the file body is above the rule');
    assert(lines.findIndex((l) => l.startsWith('Manager:')) > rule,
      'the closing lines are below it');
    cleanup(repo);
  });

  await test('a silent path says nothing on either channel', () => {
    const repo = mkRepo({ session: filled([]) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no JSON at all — no context and no systemMessage');
    cleanup(repo);
  });

  await test('the closing lines follow the oversize warning, owner last', () => {
    const many = Array.from({ length: 45 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(/queue, not a journal/.test(ctx), 'the warning is still there');
    assert(ctx.indexOf('queue, not a journal') < ctx.indexOf('Manager: open your first reply'),
      'the warning comes before the closing lines');
    assert(ctx.trimEnd().endsWith('resumes the queue above.'), 'the owner line is still last');
    cleanup(repo);
  });

  group('session: silence');

  await test('no session.md at all — silent exit 0', () => {
    const repo = mkRepo();
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'says nothing');
    cleanup(repo);
  });

  await test('an empty session.md — silent', () => {
    const repo = mkRepo({ session: '' });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'says nothing');
    cleanup(repo);
  });

  await test('the shipped template, untouched — headings and notes only, silent', () => {
    const repo = mkRepo({ session: fs.readFileSync(TEMPLATE, 'utf8') });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'a freshly seeded file counts zero content lines');
    cleanup(repo);
  });

  await test('a header-only session.md — silent, and the closing lines do not leak', () => {
    const repo = mkRepo({ session: filled([]) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'headings alone say nothing — not even the owner line');
    cleanup(repo);
  });

  await test('a repo that never opted in — silent, even with content', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']), optedIn: false });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no committed settings.json means no injection');
    cleanup(repo);
  });

  await test('a repo that turned the workflow off — silent', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']), enabled: false });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'enabled: false is a deliberate no');
    cleanup(repo);
  });

  await test('no cwd in the payload — silent', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ source: 'startup' }),
      env: { HOME: BARE_HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'exit 0');
    assertEq(res.stdout || '', '', 'says nothing');
  });

  group('session: the light bar');

  await test('past ~40 content lines the injection says it is a queue, not a journal', () => {
    const many = Array.from({ length: 45 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const { stdout } = runHook(repo);
    const ctx = ctxOf(stdout);
    assert(ctx.includes('note 44'), 'the content is still handed back');
    assert(/queue, not a journal/.test(ctx), 'the warning is appended');
    assert(ctx.includes('45 content lines'), 'the warning counts content lines only');
    cleanup(repo);
  });

  await test('at the bar there is no warning', () => {
    const many = Array.from({ length: 40 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(!/queue, not a journal/.test(ctx), '40 lines is still light');
    cleanup(repo);
  });

  group('session: the cloud brief went quiet');

  // Issue #173: the brief runs in the cloud and its failures are silent — ten
  // mornings passed with nothing posted and no session knew. The 9am job leaves
  // a marker; this hook is the reader, and it reads a FILE. No network, ever.

  await test('a brief days old is named, with the fix and the check', () => {
    const repo = mkRepo();
    const home = mkHome({
      marker: marker(10),
      settings: JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }),
    });
    const { code, stdout } = runHook(repo, 'startup', home);
    assertEq(code, 0, 'exit 0');
    const ctx = ctxOf(stdout);
    assert(ctx.includes(`cloud brief: last posted ${daysAgo(10)} (10 days ago)`),
      `the line names the date and the gap: ${ctx}`);
    assert(ctx.includes('workkit setup --token'), `the fix is the token mint: ${ctx}`);
    assert(ctx.includes('gh run list --repo owner/private-home --workflow brief.yml'),
      `and the check names the home repo: ${ctx}`);
    cleanup(repo);
    cleanup(home);
  });

  await test('the line rides alone — no session.md is still a session that hears it', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: marker(4) });
    const { stdout } = runHook(repo, 'startup', home);
    const ctx = ctxOf(stdout);
    assert(ctx.startsWith('cloud brief: last posted'), `the alert is the whole context: ${ctx}`);
    assert(!ctx.includes('SESSION STATE'), 'there is no state to hand back');
    // The owner line rides the visible channel only where there is state to
    // resume; a stale brief is the manager's to report in its own words.
    assert(!('systemMessage' in JSON.parse(stdout)),
      `an alert-only injection speaks to the model alone: ${stdout}`);
    cleanup(repo);
    cleanup(home);
  });

  await test('a machine that has not checked in days names itself, not the runner', () => {
    // The board is read by the 9am job and by nothing else, so a laptop shut for
    // a long weekend has an old ANSWER, not a broken runner — and sending the
    // owner to mint a token that was never the problem is the one way this line
    // could cost more than it is worth.
    const repo = mkRepo();
    const home = mkHome({
      marker: marker(10, 5),
      settings: JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }),
    });
    const ctx = ctxOf(runHook(repo, 'startup', home).stdout);
    assert(ctx.includes(`last posted ${daysAgo(10)} (10 days ago)`), `the staleness is still reported: ${ctx}`);
    assert(ctx.includes(`this machine last checked ${daysAgo(5)}`), `and the marker's own age is named: ${ctx}`);
    assert(!ctx.includes('fresh token'), 'the runner is not blamed for a machine that was off');
    assert(!ctx.includes('workkit setup --token'), 'and no token is minted over it');
    assert(ctx.includes('gh run list --repo owner/private-home --workflow brief.yml'),
      `the check still rides — the runs are worth reading either way: ${ctx}`);
    cleanup(repo);
    cleanup(home);
  });

  await test('a check from yesterday is a current marker — the runner wording stands', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: marker(9, 1) });
    const ctx = ctxOf(runHook(repo, 'startup', home).stdout);
    assert(ctx.includes('the runner likely needs a fresh token; fix: workkit setup --token'),
      `one day is the ordinary morning on this side of the marker too: ${ctx}`);
    assert(!ctx.includes('this machine last checked'), 'the machine is not blamed for a board it did read');
    cleanup(repo);
    cleanup(home);
  });

  await test('a marker with no checkedAt at all — silent', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: JSON.stringify({ version: 1, lastBrief: daysAgo(8) }) });
    assertEq(runHook(repo, 'startup', home).stdout, '',
      'without knowing when it was written, the marker cannot say whose silence it is');
    cleanup(repo);
    cleanup(home);
  });

  await test('with no home repo named, the check clause is left off rather than guessed', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: marker(3) });
    const ctx = ctxOf(runHook(repo, 'startup', home).stdout);
    assert(ctx.includes('workkit setup --token'), 'the fix is still there');
    assert(!ctx.includes('gh run list'), `and nothing is invented to check: ${ctx}`);
    cleanup(repo);
    cleanup(home);
  });

  await test('the alert leads, and the session state keeps its own closing lines', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const home = mkHome({ marker: marker(5) });
    const { stdout } = runHook(repo, 'startup', home);
    const ctx = ctxOf(stdout);
    assert(ctx.startsWith('cloud brief: last posted'), `the alert is first: ${ctx.slice(0, 80)}`);
    assert(ctx.includes('#12 — mid-build'), 'the state is still handed back');
    assert(ctx.trimEnd().endsWith('resumes the queue above.'), 'and the owner line is still last');
    assertEq(
      msgOf(stdout),
      'workkit: state carried over — say "continue" to resume the session queue',
      'the visible channel still carries the owner line',
    );
    cleanup(repo);
    cleanup(home);
  });

  await test('a brief posted yesterday is not stale — one day is the ordinary morning', () => {
    // The marker is written by the 9am job, and the cloud posts minutes after
    // it: on any ordinary morning the newest brief on the board is yesterday's.
    const repo = mkRepo();
    const home = mkHome({ marker: marker(1) });
    const { code, stdout } = runHook(repo, 'startup', home);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'says nothing');
    cleanup(repo);
    cleanup(home);
  });

  await test("today's brief says nothing at all", () => {
    const repo = mkRepo();
    const home = mkHome({ marker: marker(0) });
    assertEq(runHook(repo, 'startup', home).stdout, '', 'says nothing');
    cleanup(repo);
    cleanup(home);
  });

  await test('two days is the first stale morning', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: marker(2) });
    const ctx = ctxOf(runHook(repo, 'startup', home).stdout);
    assert(ctx.includes('(2 days ago)'), `the bar is one whole day: ${ctx}`);
    cleanup(repo);
    cleanup(home);
  });

  await test('no marker at all — silent, the machine that has never run the job', () => {
    const repo = mkRepo();
    const home = mkHome();
    const { code, stdout } = runHook(repo, 'startup', home);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'nothing is claimed about a board nobody has read');
    cleanup(repo);
    cleanup(home);
  });

  await test('a marker that does not parse — silent', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: '{ "version": 1, "lastBrief": ' });
    const { code, stdout } = runHook(repo, 'startup', home);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'an unreadable marker is not a stale brief');
    cleanup(repo);
    cleanup(home);
  });

  await test('a marker whose date is not one — silent', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: JSON.stringify({ version: 1, lastBrief: 'never' }) });
    assertEq(runHook(repo, 'startup', home).stdout, '', 'nothing is counted from a non-date');
    cleanup(repo);
    cleanup(home);
  });

  await test('a marker dated in the future — silent', () => {
    const repo = mkRepo();
    const home = mkHome({ marker: JSON.stringify({ version: 1, lastBrief: daysAgo(-3) }) });
    assertEq(runHook(repo, 'startup', home).stdout, '', 'a negative gap is nobody’s stale brief');
    cleanup(repo);
    cleanup(home);
  });

  await test('a repo that never opted in hears nothing about the brief either', () => {
    const repo = mkRepo({ optedIn: false });
    const home = mkHome({ marker: marker(9) });
    const { code, stdout } = runHook(repo, 'startup', home);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'the participation gate is the whole hook’s gate');
    cleanup(repo);
    cleanup(home);
  });

  await test('the hook reaches no network — the marker is the only source', () => {
    // Command position only: `gh run list` is in the message the line CARRIES,
    // and the whole point is that this hook never runs it.
    const text = fs.readFileSync(HOOK, 'utf8');
    assert(!/(^|[;&|(]|\$\()\s*(gh|curl|git ls-remote)\b/m.test(text),
      'a session start never waits on GitHub');
  });

  cleanup(BARE_HOME);
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
