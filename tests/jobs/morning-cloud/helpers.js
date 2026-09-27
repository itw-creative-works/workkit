// The shared prologue of the jobs/morning.sh cloud suites beside this one: the
// script run for real as an Actions runner runs it, against a scratch HOME and a
// PATH farm (a recording `claude`, a recording notifier, and a `gh` answering the
// contents API and the Discussions GraphQL). `git`, `jq` and `node` are real, so
// the roster it writes is read back by the tower's own composer. The machine leg
// is the morning-local/ folder.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { testUnless } = require('../../lib/harness');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const {
  IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, NO_NODE_STUB, shellPath, which, homeEnv, linkTool,
  stubTool, pathWith, joinPath,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'jobs', 'morning.sh');
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
  const claude = stubTool(bin, 'claude', [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    // %b, not %s: the escapes JSON.stringify wrote have to become real newlines.
    // A send that failed says so on stderr, the way the CLI does: the runner
    // logs that and never the digest.
    `printf '%b' ${JSON.stringify(response)}${status === 0 ? '' : ' >&2'}`,
    `exit ${status}`,
  ]);

  // A notifier that must never be reached: there is no desktop on a runner, and
  // a recorder that stayed silent is the only way to assert it.
  const notifLog = path.join(root, 'notifly-argv.log');
  const notifly = stubTool(bin, 'notifly', ['#!/usr/bin/env bash', recordArgv(notifLog), 'exit 0']);

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
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    ...(ghFails ? ['exit 1'] : []),
    'all="$*"',
    'case "$all" in',
    `  *createDiscussion*) printf 'post %s\\n' "\${GH_TOKEN:-none}" >> ${JSON.stringify(tokenLog)} ;;`,
    `  *"issues(states: OPEN"*) printf 'sweep %s\\n' "\${GH_TOKEN:-none}" >> ${JSON.stringify(tokenLog)} ;;`,
    `  *contents/data/repos.json*) printf 'roster %s\\n' "\${GH_TOKEN:-none}" >> ${JSON.stringify(tokenLog)} ;;`,
    `  *.default_branch*) printf 'branch %s\\n' "\${GH_TOKEN:-none}" >> ${JSON.stringify(tokenLog)} ;;`,
    'esac',
    'case "$all" in',
    // The default branch, asked for before the roster is read:
    // `gh api ... -q .default_branch` answers the bare string.
    `  *.default_branch*) printf '%s\\n' ${JSON.stringify(defaultBranch)} ;;`,
    `  *contents/data/repos.json\\?ref=${defaultBranch}*)`,
    ...(encoded
      // Wrapped at 60 characters, the way GitHub serves it: a decoder that
      // cannot take the newlines would pass against one long line.
      // %b, not %s: the escapes JSON.stringify wrote have to become real
      // newlines, or the wrap proves nothing.
      ? [`    printf '%b' ${JSON.stringify(encoded.replace(/(.{60})/g, '$1\n'))} ;;`]
      : ['    exit 1 ;;']),
    '  *createDiscussion*)',
    `    for a in "$@"; do case "$a" in body=@*) cat "\${a#body=@}" >> ${JSON.stringify(bodyLog)} ;; esac; done`,
    `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/private-home/discussions/9"}}}}' ;;`,
    '  *discussionCategories*)',
    `    printf '%s' '{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":true,"discussionCategories":{"nodes":[{"id":"DIC_0","name":"General"}]}}}}' ;;`,
    // The board sweep. A repo the token cannot read comes back as a per-repo
    // error beside the data, and real `gh` exits non-zero when an errors array
    // is present: the shape the composer's warning is about.
    '  *"issues(states: OPEN"*)',
    ...(boardBroken
      ? [
        `    printf '%s' '{"data":{"r0":null},"errors":[{"type":"NOT_FOUND","path":["r0"],"message":"Could not resolve to a Repository"}]}'`,
        '    exit 1 ;;',
      ]
      : [`    printf '%s' '{"data":{"r0":{"issues":{"totalCount":0,"nodes":[]}}}}' ;;`]),
    '  *"discussions(first"*)',
    `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[${nodes}]}}}}' ;;`,
    '  *) printf \'%s\' \'{}\' ;;',
    'esac',
    'exit 0',
  ]);

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

// A machine without jq, built as a farm of symlinks to exactly what the run
// needs before it asks for jq: dropping jq's directory would take every other
// tool in /usr/bin with it. `date` stamps every line the job prints.
const NO_JQ_TOOLS = ['bash', 'dirname', 'mktemp', 'mkdir', 'rm', 'cat', 'date'];
const withoutJq = (root, bin) => {
  const farm = path.join(root, 'no-jq');
  fs.mkdirSync(farm, { recursive: true });
  for (const tool of NO_JQ_TOOLS) {
    const found = which(tool);
    if (found) linkTool(farm, found);
  }
  return joinPath(bin, farm);
};

const runJob = (world, args = []) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
  encoding: 'utf8',
  timeout: 60000,
  env: world.env,
});

// A case that reads what the `gh` shim recorded. The node composers the script
// runs spawn gh directly, and no stub is startable that way on Windows
// (`stubTool`), so there the sealed machine gh answers those reads.
const composerTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

// The whole case is the file's mode, which Windows has none of.
const execBitTest = testUnless(IS_WINDOWS, NO_EXEC_BIT);

module.exports = {
  SCRIPT, INSTRUCTION, HOME_SLUG, cleanup, today, mkWorld, withoutJq, runJob, composerTest, execBitTest,
};
