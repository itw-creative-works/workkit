// Tests for jobs/claude-nightly.js: the summaries step the 9am job runs first,
// which writes the day up and publishes it as a Discussion on the home repo.
// It runs for real against `claude` and `gh` shims in a scratch HOME and
// WORKFLOW_HOME, so it never reaches GitHub, writes a summary file, or notifies.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, start, until, alive,
} = require('../lib/harness');
const {
  recordArgvJs, readArgv, fmtCalls,
} = require('../lib/argv-log');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, homeEnv, shellPath, stubToolJs, joinPath, skipWithoutCaughtSignal, skipWithoutHomebrewPath,
} = require('../lib/platform');
const { skipOnUsrLocalBin } = require('../lib/job-path');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-nightly.js');

// The date the runner works in is the local one, which is not always today in
// UTC: a fixture stamped from toISOString would be a different day for half
// the world's clocks.
const today = () => new Date().toLocaleDateString('en-CA');

// Every cadence title the runner would publish today. The script adds the
// weekly on a Sunday and the monthly on the 1st, so a test seeding "already
// published" must cover all of them: seeding the daily alone reds the test
// on exactly those days, when the rollup legitimately composes.
const allPostedToday = () => {
  const now = new Date();
  const titles = [`daily: ${today()}`];
  if (now.getDay() === 0) titles.push(`weekly: ${today()}`);
  if (now.getDate() === 1) titles.push(`monthly: ${today()}`);
  return titles;
};

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home and ~/.workkit with the delivery's shims: `claude` answers
 * with a summary, `gh` answers the GraphQL calls, and Notifly is a trap.
 *
 * `home` is the settings file's `"home"` key (null: none; `settings: null`:
 * no file). `logsDir: false` leaves ~/Library/Logs out. `categories` is what
 * the repo's Discussions offer; `ghFails` makes every API call refuse. `quiet`
 * drops the one session transcript that makes a day to summarize. `posted` is
 * what the Daily discussions already carry; `claudeStderr` is send noise that
 * must reach the log and never the published body.
 */
const mkWorld = ({
  home = null, settings = {}, logsDir = true, categories = ['Daily', 'Weekly', 'Monthly'],
  ghFails = false, summary = '## Went well\nThe suite is green.\n', quiet = false,
  posted = [], claudeStderr = '',
} = {}) => {
  const root = mkTmp('claude-nightly-');
  const homeDir = path.join(root, 'home');
  // ~/.local/bin, and not just any directory: the runner exports a PATH of its
  // own that begins there and includes /opt/homebrew/bin, so a shim anywhere
  // else would lose to the real `gh` on this machine, and the suite would
  // reach GitHub.
  const bin = path.join(homeDir, '.local', 'bin');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  // ~/Library/Logs is a directory every macOS home already has, so the ordinary
  // fixture carries it too.
  if (logsDir) fs.mkdirSync(path.join(homeDir, 'Library', 'Logs'), { recursive: true });

  if (settings !== null) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(
      path.join(workflowHome, 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: home || null, publish: false, url: null }, ...settings }, null, 2),
    );
  }

  // The day's record. Claude Code lays transcripts out one directory per
  // project with `.jsonl` files inside, and the payload only counts the ones
  // that moved inside the 24-hour window: a file written now is one.
  const projects = path.join(root, 'projects');
  if (!quiet) {
    fs.mkdirSync(path.join(projects, 'a-repo'), { recursive: true });
    fs.writeFileSync(path.join(projects, 'a-repo', 'session.jsonl'), '{"type":"user"}\n');
  }

  const claudeLog = path.join(root, 'claude-argv.log');
  const claudeCwdLog = path.join(root, 'claude-cwd.log');
  const claudePathLog = path.join(root, 'claude-path.log');
  const ghLog = path.join(root, 'gh-argv.log');
  const notifLog = path.join(root, 'notifly-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  // Node, so the folder and the PATH it records are spelled as the job's node spells them.
  stubToolJs(bin, 'claude', [
    "const fs = require('fs');",
    recordArgvJs(JSON.stringify(claudeLog)),
    `fs.appendFileSync(${JSON.stringify(claudeCwdLog)}, \`\${process.cwd()}\\n\`);`,
    `fs.appendFileSync(${JSON.stringify(claudePathLog)}, \`\${process.env.PATH}\\n\`);`,
    ...(claudeStderr ? [`process.stderr.write(${JSON.stringify(claudeStderr)});`] : []),
    `process.stdout.write(${JSON.stringify(summary)});`,
  ].join('\n'));
  const notifly = stubToolJs(bin, 'notifly', recordArgvJs(JSON.stringify(notifLog)));

  // The three shapes the delivery asks for, told apart by the query text;
  // anything else answers empty so an unexpected call fails. The shim is always
  // written: the runner puts /opt/homebrew/bin on its own PATH, so a world
  // without one would reach the real gh.
  {
    const nodes = categories.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
    // What the repo already carries, in the shape the API answers with: the
    // duplicate guard reads exactly this.
    const priorNodes = posted.map((title) => JSON.stringify({
      title, createdAt: `${today()}T09:00:00Z`, body: 'already published',
    })).join(',');
    stubToolJs(bin, 'gh', [
      "const fs = require('fs');",
      recordArgvJs(JSON.stringify(ghLog)),
      ...(ghFails ? ['process.exit(1);'] : []),
      'const argv = process.argv.slice(2);',
      "const all = argv.join(' ');",
      "if (all.includes('createDiscussion')) {",
      // The body travels as `@file`, and the file goes away with the run, so
      // what was actually published is kept here for the assertions.
      `  for (const a of argv) if (a.startsWith('body=@')) fs.appendFileSync(${JSON.stringify(bodyLog)}, fs.readFileSync(a.slice('body=@'.length)));`,
      `  process.stdout.write(${JSON.stringify('{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/private-home/discussions/7"}}}}')});`,
      "} else if (all.includes('discussionCategories')) {",
      `  process.stdout.write(${JSON.stringify(`{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":true,"discussionCategories":{"nodes":[${nodes}]}}}}`)});`,
      "} else if (all.includes('discussions(first')) {",
      `  process.stdout.write(${JSON.stringify(`{"data":{"repository":{"discussions":{"nodes":[${priorNodes}]}}}}`)});`,
      "} else process.stdout.write('{}');",
    ].join('\n'));
  }

  return {
    root,
    home: homeDir,
    workflowHome,
    calls: () => readArgv(claudeLog),
    cwds: () => (fs.existsSync(claudeCwdLog)
      ? fs.readFileSync(claudeCwdLog, 'utf8').split('\n').filter(Boolean)
      : []),
    // The PATH each send ran under, one entry per call.
    sendPaths: () => (fs.existsSync(claudePathLog)
      ? fs.readFileSync(claudePathLog, 'utf8').split('\n').filter(Boolean)
      : []),
    ghCalls: () => readArgv(ghLog),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    notifs: () => readArgv(notifLog),
    log: () => {
      const file = path.join(homeDir, 'Library', 'Logs', 'claude-nightly.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    settings: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'settings.json'), 'utf8')),
    cache: () => JSON.parse(fs.readFileSync(path.join(workflowHome, '.cache.json'), 'utf8')),
    env: {
      ...homeEnv(homeDir, {
        ...process.env,
        NOTIFLY: notifly,
        // The system tools plus the shims, and nothing else: `gh` is present only
        // when this world put it there.
        PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
        WORKFLOW_HOME: workflowHome,
        // The transcripts root the payload indexes and the send is granted: the
        // same root, which is the whole point of the grant.
        WORKKIT_CLAUDE_PROJECTS: projects,
      }),
      // The job is a node the case starts itself, which reads its home native.
      HOME: homeDir,
    },
  };
};

const runJob = (world, args = []) => run(process.execPath, [SCRIPT, ...args], { env: world.env });

describe('jobs/claude-nightly', () => {
  describe('jobs/claude-nightly: no home repo is a named skip', () => {
    test('no home repo configured: it skips and says so', async () => {
      const world = mkWorld();
      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(/summaries: no home repo configured; skipped/.test(world.log()), `the log names the reason: ${world.log()}`).toBeTruthy();
      expect(world.calls().length, `nothing was sent: ${fmtCalls(world.calls())}`).toBe(0);
      // The notification would be fired detached, so its absence needs a moment of
      // waiting to mean anything: an assertion made immediately would pass even on a
      // job that did notify.
      expect(!(await until(() => world.notifs().length > 0, 500)), 'and nothing interrupted anyone').toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/claude-nightly: the summary is published', () => {
    test('a home repo IS configured: the summary is written and posted', () => {
      const world = mkWorld({ home: 'owner/private-home' });
      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const logText = world.log();
      expect(/posted the daily summary/.test(logText), `the log says it published: ${logText}`).toBeTruthy();
      expect(/discussions\/7/.test(logText), 'and names the discussion it created').toBeTruthy();
      expect(world.calls().length, `Claude wrote it once: ${fmtCalls(world.calls())}`).toBe(1);
      const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
      expect(created.length, `one createDiscussion mutation: ${fmtCalls(world.ghCalls())}`).toBe(1);
      cleanup(world.root);
    });

    test('the repo id and the category ids are cached in the machine\'s disposable file', () => {
      // Ids are GitHub's and rebuildable, so they live in `.cache.json` and never
      // in the hand-edited settings.json beside it.
      const world = mkWorld({ home: 'owner/private-home' });
      runJob(world);
      expect(!('homeCache' in world.settings()), 'the hand-edited file carries no cache').toBeTruthy();
      const cache = world.cache().homeCache['owner/private-home'];
      expect(cache.repositoryId, 'the repo node id is cached').toBe('R_kdt');
      expect(cache.categories.Daily, 'and every category by name').toBe('DIC_0');

      // A second run reads the cache instead of asking again.
      const before = world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;
      runJob(world);
      const after = world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;
      expect(after, `the cached ids are not re-fetched: ${fmtCalls(world.ghCalls())}`).toBe(before);
      cleanup(world.root);
    });

    test('a repo with no Daily category publishes in the default one, and says so', () => {
      // Categories cannot be created over the API (no such mutation exists) so
      // a fallback is the only honest behavior, and it is never silent.
      const world = mkWorld({ home: 'owner/private-home', categories: ['General'] });
      const res = runJob(world);
      expect(res.status, 'exit 0').toBe(0);
      const logText = world.log();
      expect(/posted the daily summary in General/.test(logText), `it names the category it used: ${logText}`).toBeTruthy();
      expect(/no API that creates one/.test(logText), 'and why it was not the Daily one').toBeTruthy();
      cleanup(world.root);
    });

    test('an API that refuses is logged, and the step still exits 0', () => {
      const world = mkWorld({ home: 'owner/private-home', ghFails: true });
      const res = runJob(world);
      expect(res.status, 'a summary that cannot be posted never fails the morning').toBe(0);
      const logText = world.log();
      expect(/skipped/.test(logText), `the log says what happened: ${logText}`).toBeTruthy();
      expect(/nothing was written to disk/.test(logText), 'and that no file was left behind instead').toBeTruthy();
      expect(!/posted the daily summary/.test(logText), 'and never claims to have published').toBeTruthy();
      cleanup(world.root);
    });

    test('a Claude that answers with nothing posts nothing', () => {
      const world = mkWorld({ home: 'owner/private-home', summary: '' });
      const res = runJob(world);
      expect(res.status, 'exit 0').toBe(0);
      expect(/was not written/.test(world.log()), `the log says the summary never existed: ${world.log()}`).toBeTruthy();
      const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
      expect(created.length, `and an empty summary is never posted: ${fmtCalls(world.ghCalls())}`).toBe(0);
      cleanup(world.root);
    });

    test('no settings file at all reads as no home repo, not as a failure', () => {
      const world = mkWorld({ settings: null });
      const res = runJob(world);
      expect(res.status, 'a machine that has never healed anything is not broken').toBe(0);
      expect(/no home repo configured/.test(world.log()), `the log says which reason: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });

    test('the log block is timestamped, and --now stamps it manual', () => {
      const world = mkWorld();
      runJob(world);
      expect(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ---/.test(world.log()), `one timestamped block: ${world.log()}`).toBeTruthy();
      cleanup(world.root);

      const manual = mkWorld();
      runJob(manual, ['--now']);
      expect(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ---/.test(manual.log()),
        `stamped manual: ${manual.log().slice(0, 120)}`).toBeTruthy();
      expect(manual.calls().length, 'and the manual trigger sends nothing either').toBe(0);
      cleanup(manual.root);
    });
  });

  describe('jobs/claude-nightly: the send', () => {

    test('the send carries the read tools and the transcripts root it indexed', () => {
      // The reflection reads the transcripts itself. Without the grant it is
      // reasoning about an index of file names it cannot open.
      const world = mkWorld({ home: 'owner/private-home' });
      runJob(world);
      const argv = world.calls()[0];
      expect(argv, `the send happened: ${fmtCalls(world.calls())}`).toBeTruthy();
      const tools = argv.indexOf('--tools');
      expect(tools !== -1 && argv[tools + 1] === 'Read,Grep,Glob', `the three read tools: ${JSON.stringify(argv)}`).toBeTruthy();
      const dir = argv.indexOf('--add-dir');
      expect(argv[dir + 1],
        'and the SAME root the payload indexed: the grant and the index cannot disagree').toBe(path.join(world.root, 'projects'));
      cleanup(world.root);
    });

    test('with no override, the payload indexes ~/.claude/projects and the send is granted that same root', () => {
      // The world's own root stays empty, so the day is sent only if the index read the home's.
      const world = mkWorld({ home: 'owner/private-home', quiet: true });
      delete world.env.WORKKIT_CLAUDE_PROJECTS;
      const projects = path.join(world.home, '.claude', 'projects');
      fs.mkdirSync(path.join(projects, 'a-repo'), { recursive: true });
      fs.writeFileSync(path.join(projects, 'a-repo', 'session.jsonl'), '{"type":"user"}\n');
      runJob(world);
      const argv = world.calls()[0];
      expect(argv, `the index found the day under ${projects}, so it was sent: ${world.log()}`).toBeTruthy();
      expect(argv[argv.indexOf('--add-dir') + 1], 'and the grant names that root').toBe(projects);
      cleanup(world.root);
    });

    test('the send runs from an empty scratch directory, never from /', () => {
      // Under launchd the cwd is / and the job is its own TCC identity: a startup
      // scan from there trips the macOS privacy prompts.
      const world = mkWorld({ home: 'owner/private-home' });
      runJob(world);
      const cwd = world.cwds()[0];
      expect(cwd && cwd !== '/' && cwd !== world.home, `it worked from a scratch dir, got: ${cwd}`).toBeTruthy();
      expect(fs.existsSync(cwd), 'which went away with the run').toBe(false);
      cleanup(world.root);
    });

    test('a run ended by TERM mid-send leaves no scratch folder in its temp folder', { skip: skipWithoutCaughtSignal() }, async (t) => {
      const world = mkWorld({ home: 'owner/private-home' });
      const temp = mkTmp('claude-nightly-temp-');
      world.env.TMPDIR = temp;
      // A send that never answers, saying where it runs and as whom first.
      const sendFile = path.join(world.root, 'send.json');
      stubToolJs(path.join(world.home, '.local', 'bin'), 'claude', [
        `require('fs').writeFileSync(${JSON.stringify(sendFile)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));`,
        'setInterval(() => {}, 2 ** 30);',
      ].join('\n'));
      const send = () => (fs.existsSync(sendFile) ? JSON.parse(fs.readFileSync(sendFile, 'utf8')) : null);
      t.after(() => { const s = send(); if (s && alive(s.pid)) process.kill(s.pid, 'SIGKILL'); });

      const job = start(process.execPath, [SCRIPT], { env: world.env });
      t.after(() => job.end('SIGKILL'));
      expect(await until(() => send() !== null), `the send started: ${job.output()}`).toBeTruthy();
      const scratches = () => fs.readdirSync(temp).filter((name) => name.startsWith('claude-nightly.'));
      expect(scratches().length, `the run's scratch folder is there while it sends: ${fs.readdirSync(temp).join(', ')}`).toBe(1);
      await job.end('SIGTERM');
      expect(scratches(), `and gone once TERM ended the run: ${job.output()}`).toEqual([]);
      cleanup(world.root);
    });

    test('what the send wrote to stderr reaches the log, never the published body', () => {
      const world = mkWorld({ home: 'owner/private-home', claudeStderr: 'warning: a deprecated flag\n' });
      runJob(world);
      const body = world.postedBody();
      expect(/The suite is green/.test(body), `the summary is what was published: ${body}`).toBeTruthy();
      expect(!/deprecated flag/.test(body), `and the noise is not part of it: ${body}`).toBeTruthy();
      expect(/deprecated flag/.test(world.log()), `it is in the log instead: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/claude-nightly: node and the PATH', () => {
    test('the send runs on a PATH that carries /usr/local/bin', { skip: skipOnUsrLocalBin() || skipWithoutHomebrewPath() }, () => {
      // Intel Homebrew and the nodejs.org installer both put node there.
      const world = mkWorld({ home: 'owner/private-home' });
      runJob(world);
      const seen = world.sendPaths();
      expect(seen.length, `the send happened once: ${fmtCalls(world.calls())}`).toBe(1);
      expect(seen[0].split(':').includes('/usr/local/bin'), `the job's own PATH adds it: ${seen[0]}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/claude-nightly: the guards', () => {
    test('a day already published is not published twice', () => {
      const world = mkWorld({ home: 'owner/private-home', posted: allPostedToday() });
      const res = runJob(world);
      expect(res.status, 'exit 0').toBe(0);
      expect(/already carries the daily summary/.test(world.log()), `it says so: ${world.log()}`).toBeTruthy();
      expect(world.calls().length, 'nothing was composed').toBe(0);
      const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
      expect(created.length, `and nothing was posted: ${fmtCalls(world.ghCalls())}`).toBe(0);
      cleanup(world.root);
    });

    test('--now posts anyway: a manual run is an explicit ask', () => {
      const world = mkWorld({ home: 'owner/private-home', posted: [`daily: ${today()}`] });
      runJob(world, ['--now']);
      expect(/posted the daily summary/.test(world.log()), `it published: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a quiet day is logged and nothing is sent or posted', () => {
      // No transcripts and no commits in the window: a summary composed from that
      // would be invention, and publishing it would put invention in the archive
      // the rollups read.
      const world = mkWorld({ home: 'owner/private-home', quiet: true });
      const res = runJob(world);
      expect(res.status, 'exit 0').toBe(0);
      expect(/a quiet day/.test(world.log()), `it names the reason: ${world.log()}`).toBeTruthy();
      expect(world.calls().length, `nothing was sent: ${fmtCalls(world.calls())}`).toBe(0);
      const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
      expect(created.length, `and nothing was posted: ${fmtCalls(world.ghCalls())}`).toBe(0);
      cleanup(world.root);
    });

    test('--now sends on a quiet day too', () => {
      const world = mkWorld({ home: 'owner/private-home', quiet: true });
      runJob(world, ['--now']);
      expect(world.calls().length, `the manual trigger overrides: ${fmtCalls(world.calls())}`).toBe(1);
      expect(/posted the daily summary/.test(world.log()), `and it published: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/claude-nightly: nothing is written', () => {
    test('the run writes no file anywhere but its own log', () => {
      const world = mkWorld({ home: 'owner/private-home' });
      runJob(world);
      // The whole fixture home, minus the one log the step is allowed to append.
      const found = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else found.push(full);
        }
      };
      walk(world.home);
      const logFile = path.join(world.home, 'Library', 'Logs', 'claude-nightly.log');
      // The shims the fixture itself put in ~/.local/bin are not the run's doing.
      const written = found.filter((f) => !f.startsWith(path.join(world.home, '.local', 'bin')));
      expect(written.join(','), `the log and nothing else, got: ${written.join(', ')}`).toBe(logFile);
      cleanup(world.root);
    });

    test('a home with no Library/Logs gets one: the log line still lands', () => {
      const world = mkWorld({ logsDir: false });
      const res = runJob(world);
      expect(res.status, `the append cannot fail the step: ${res.stderr}`).toBe(0);
      expect(/no home repo configured/.test(world.log()), `the log says which reason: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/claude-nightly: a HOME no cygpath can read', () => {
    // The step reads HOME for its PATH before its log, its scratch folder or a send.
    // PATH is node's folder alone: Git's usr/bin, where cygpath lives, is left off.
    test('a HOME in the shell\'s spelling with no cygpath on PATH: the one line naming HOME and the fix, exit 1, no stack', {
      skip: !IS_WINDOWS && 'off Windows a home is never handed to cygpath',
    }, () => {
      const world = mkWorld();
      const home = shellPath(world.home);
      const res = run(process.execPath, [SCRIPT], { env: { ...world.env, HOME: home, PATH: NODE_DIR } });
      expect(res.status, `exit 1, got: ${res.stdout}${res.stderr}`).toBe(1);
      expect(res.stdout, 'nothing on stdout').toBe('');
      expect(res.stderr, 'the one line').toBe(`workkit: cannot read HOME (${home}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n`);
      expect(/^ {4}at /m.test(res.stderr), `no stack line, got: ${res.stderr}`).toBe(false);
      expect(world.log(), 'and no log line').toBe('');
      cleanup(world.root);
    });
  });
});

// The PATH the job's enterMachine builds, asked in this process on an env of the case's own.
describe('jobs/lib/machine: enterMachine', () => {
  test('with no HOME, USERPROFILE is the home its PATH starts from', () => {
    const home = mkTmp('machine-home-');
    const env = { USERPROFILE: home, PATH: '/usr/bin' };
    require('../../jobs/lib/machine').enterMachine(env);
    expect(env.PATH.split(path.delimiter)[0], `the first PATH entry, got: ${env.PATH}`).toBe(path.join(home, '.local', 'bin'));
  });

  test('on Windows the two home folders and the running node\'s lead the PATH key the env already holds', () => {
    const env = { USERPROFILE: 'C:\\Users\\Ada', Path: 'C:\\Windows' };
    require('../../jobs/lib/machine').enterMachine(env, { platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe' });
    expect(env.Path, 'no Homebrew folder, the old value last')
      .toBe('C:\\Users\\Ada\\.local\\bin;C:\\Users\\Ada\\.nvm\\default-bin;C:\\Program Files\\nodejs;C:\\Windows');
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH'), 'and no second spelling of the key').toEqual(['Path']);
  });

  test('on a Mac the PATH leads with the two home folders and the two Homebrew ones', () => {
    const env = { HOME: '/Users/ada', PATH: '/usr/bin' };
    require('../../jobs/lib/machine').enterMachine(env, { platform: 'darwin' });
    expect(env.PATH).toBe('/Users/ada/.local/bin:/Users/ada/.nvm/default-bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin');
  });

  test('with neither HOME nor USERPROFILE, the PATH still starts from an absolute home', () => {
    const env = { PATH: '/usr/bin' };
    require('../../jobs/lib/machine').enterMachine(env, { platform: 'darwin' });
    // Cut at the folder's own name, not at `:`, which a Windows home's drive letter holds.
    const first = env.PATH.slice(0, env.PATH.indexOf('.local/bin') + '.local/bin'.length);
    expect(path.isAbsolute(first) && first.endsWith('/.local/bin'), `the first PATH entry, got: ${env.PATH}`).toBe(true);
  });
});
