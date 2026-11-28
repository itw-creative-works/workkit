// The shared prologue of the jobs/morning.js cloud suites beside this one: the
// program run for real as an Actions runner runs it, against a scratch HOME and a
// PATH farm (a recording `claude`, a recording notifier, and a `gh` answering the
// contents API and the Discussions GraphQL). `git` and `node` are real, so the
// roster it writes is read back by the tower's own composer. The machine leg is
// the morning-local/ folder.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const { recordArgvJs, readArgv } = require('../../lib/argv-log');
const {
  homeEnv, stubToolJs, pathWith, spawnSync,
} = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'jobs', 'morning.js');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', '..', 'jobs', 'morning', 'brief', 'brief-payload.js'));
const { discoverRepos } = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'repos'));

const HOME_SLUG = 'owner/private-home';

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The date the runner titles its Discussion with is the local one (`date
// '+%Y-%m-%d'`), which is not always today in UTC.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A scratch HOME, a fake `claude` printing `response` and exiting `status`, and
 * a `gh` answering the contents API and the Discussions GraphQL.
 * `githubRepo`: GITHUB_REPOSITORY, the home repo the workflow lives on (null unsets it).
 * `settings`: a settings file planted first, whose runner must win over the env var.
 * `siteRepos`: the home repo's private data/repos.json (null: publishing off or never run).
 * `defaultBranch`: the home repo's default branch, the ref the roster is read from.
 * `posted`: the discussions already there, `{ title, body }`, for the check-before-post guard.
 * `ghFails` makes every API call refuse; `boardBroken` fails the sweep for the first repo.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0,
  githubRepo = HOME_SLUG, settings = null, siteRepos = null, posted = [],
  ghFails = false, ccChangelog = null, boardBroken = false, defaultBranch = 'main',
  sweepToken = 'SWEEP-TOKEN', postToken = 'POST-TOKEN',
} = {}) => {
  const root = mkTmp('morning-cloud-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  // A transcripts root, so the summaries skip below is proved by the question
  // this script asks about GITHUB_ACTIONS rather than by an empty fixture home.
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });

  if (settings) {
    fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(home, '.workkit', 'settings.json'), JSON.stringify(settings, null, 2));
  }

  const claudeLog = path.join(root, 'claude-argv.log');
  const claude = stubToolJs(bin, 'claude', [
    recordArgvJs(JSON.stringify(claudeLog)),
    // A send that failed says so on stderr, the way the CLI does: the runner
    // logs that and never the digest.
    `process.${status === 0 ? 'stdout' : 'stderr'}.write(${JSON.stringify(response)});`,
    `process.exitCode = ${status};`,
  ].join('\n'));

  // A notifier that must never be reached: there is no desktop on a runner, and
  // a recorder that stayed silent is the only way to assert it.
  const notifLog = path.join(root, 'notifly-argv.log');
  const notifly = stubToolJs(bin, 'notifly', recordArgvJs(JSON.stringify(notifLog)));

  const ghLog = path.join(root, 'gh-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  // Which token each kind of call was made with, one line per call as
  // `<kind> <token>`: the two-token split is only real if the cross-repo sweep
  // and the post on this repo authenticate differently.
  const tokenLog = path.join(root, 'gh-tokens.log');
  const nodes = posted.map(({ title, body = '' }) => JSON.stringify({
    title, createdAt: `${today()}T09:00:00Z`, body,
  })).join(',');
  // The contents API answers with a base64 body, which is what the script
  // decodes; `gh api -q .content` is the field it asks for.
  const encoded = siteRepos ? Buffer.from(JSON.stringify(siteRepos)).toString('base64') : null;
  stubToolJs(bin, 'gh', [
    "const fs = require('fs');",
    recordArgvJs(JSON.stringify(ghLog)),
    ...(ghFails ? ['process.exit(1);'] : []),
    'const argv = process.argv.slice(2);',
    "const all = argv.join(' ');",
    "const say = (text) => process.stdout.write(text);",
    // The first kind the call matches, with the token it carried.
    `const kinds = ${JSON.stringify([['createDiscussion', 'post'], ['issues(states: OPEN', 'sweep'], ['contents/data/repos.json', 'roster'], ['.default_branch', 'branch']])};`,
    'const kind = kinds.find(([needle]) => all.includes(needle));',
    `if (kind) fs.appendFileSync(${JSON.stringify(tokenLog)}, \`\${kind[1]} \${process.env.GH_TOKEN || 'none'}\\n\`);`,
    // The default branch, asked for before the roster is read:
    // `gh api ... -q .default_branch` answers the bare string.
    `if (all.includes('.default_branch')) say(${JSON.stringify(`${defaultBranch}\n`)});`,
    `else if (all.includes(${JSON.stringify(`contents/data/repos.json?ref=${defaultBranch}`)})) {`,
    ...(encoded
      // Wrapped at 60 characters, the way GitHub serves it: a decoder that
      // cannot take the newlines would pass against one long line.
      ? [`  say(${JSON.stringify(encoded.replace(/(.{60})/g, '$1\n'))});`]
      : ['  process.exitCode = 1;']),
    "} else if (all.includes('createDiscussion')) {",
    `  for (const a of argv) if (a.startsWith('body=@')) fs.appendFileSync(${JSON.stringify(bodyLog)}, fs.readFileSync(a.slice('body=@'.length)));`,
    `  say(${JSON.stringify('{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/private-home/discussions/9"}}}}')});`,
    "} else if (all.includes('discussionCategories')) {",
    `  say(${JSON.stringify('{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":true,"discussionCategories":{"nodes":[{"id":"DIC_0","name":"General"}]}}}}')});`,
    // The board sweep. A repo the token cannot read comes back as a per-repo
    // error beside the data, and real `gh` exits non-zero when an errors array
    // is present: the shape the composer's warning is about.
    "} else if (all.includes('issues(states: OPEN')) {",
    ...(boardBroken
      ? [
        `  say(${JSON.stringify('{"data":{"r0":null},"errors":[{"type":"NOT_FOUND","path":["r0"],"message":"Could not resolve to a Repository"}]}')});`,
        '  process.exitCode = 1;',
      ]
      : [`  say(${JSON.stringify('{"data":{"r0":{"issues":{"totalCount":0,"nodes":[]}}}}')});`]),
    "} else if (all.includes('discussions(first')) {",
    `  say(${JSON.stringify(`{"data":{"repository":{"discussions":{"nodes":[${nodes}]}}}}`)});`,
    "} else say('{}');",
  ].join('\n'));

  // The upstream CHANGELOG the news read is pointed at. `/dev/null` is the
  // module's silent-skip path: an empty body, no version, no line.
  let ccSource = 'file:///dev/null';
  if (ccChangelog) {
    const file = path.join(root, 'cc-changelog.md');
    fs.writeFileSync(file, ccChangelog);
    ccSource = pathToFileURL(file).href;
  }

  const env = {
    ...homeEnv(home, {
      ...process.env,
      PATH: pathWith(bin),
      NOTIFLY: notifly,
      WORKKIT_CC_CHANGELOG: ccSource,
      // The variable Actions always sets, and the one the script asks which
      // environment it woke up in. The world that is not a runner deletes it.
      GITHUB_ACTIONS: 'true',
    }),
    // The workflow's two, set after the scratch home, which carries no token of
    // its own: the cross-repo secret `gh` authenticates with by default, and the
    // built-in token the post is made with. What each call carried is what
    // these cases measure.
    GH_TOKEN: sweepToken,
    WORKKIT_POST_TOKEN: postToken,
  };
  delete env.WORKFLOW_HOME;
  if (githubRepo === null) delete env.GITHUB_REPOSITORY;
  else env.GITHUB_REPOSITORY = githubRepo;
  if (postToken === null) delete env.WORKKIT_POST_TOKEN;

  return {
    root,
    home,
    workflowHome: path.join(home, '.workkit'),
    nightlyLog: path.join(home, 'Library', 'Logs', 'claude-nightly.log'),
    settings: () => {
      const file = path.join(home, '.workkit', 'settings.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    },
    // The roster read back the way the composers read it: the only assertion
    // that proves the synthetic checkouts are ones they accept.
    roster: () => discoverRepos({ workflowHome: path.join(home, '.workkit'), home }),
    calls: () => readArgv(claudeLog),
    notifs: () => readArgv(notifLog),
    ghCalls: () => readArgv(ghLog),
    created: () => readArgv(ghLog).filter((c) => c.join(' ').includes('createDiscussion')),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    // The token each kind of call carried, as `{ post, sweep, roster }` of the
    // values seen: a Set per kind, so a leak between them is visible.
    tokens: (kind) => {
      const lines = fs.existsSync(tokenLog) ? fs.readFileSync(tokenLog, 'utf8').split('\n') : [];
      return [...new Set(lines.filter((l) => l.startsWith(`${kind} `)).map((l) => l.slice(kind.length + 1)))];
    },
    env,
  };
};

// The run as the workflow starts it, the kit's own morning under this suite's node.
const runJob = (world, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8',
  timeout: SPAWN_DEADLINE,
  env: world.env,
});

module.exports = {
  SCRIPT, INSTRUCTION, HOME_SLUG, cleanup, today, mkWorld, runJob,
};
