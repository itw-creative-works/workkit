//
// The shared prologue of the jobs/morning.sh cloud suites, the `*.test.js`
// files beside this one, which test the script as a GITHUB ACTIONS RUNNER runs
// it (issues #82, #107): the same script the 9am launchd job runs, in the
// environment where the brief is the step that can happen and the summaries
// and the publish are named skips. The machine leg is the morning-local/
// folder. A plain module, never a suite: the runner only loads files ending in
// `.test.js`.
//
// The runner is executed for real against a scratch HOME and a PATH farm: a
// fake `claude` recording the argument vector it was given, a recording
// notifier, and a `gh` that answers the two APIs this path speaks: the
// contents API it reads the published slug list from, and the Discussions
// GraphQL it publishes through. `git`, `jq` and `node` are the real ones,
// because the roster this script writes is only worth asserting if the tower's
// own composer reads it back.
//
// HOME is the whole sandbox: the script resolves ~/.workkit from it exactly as
// the Node composers do, so nothing here touches the real workflow folder, and
// the recording `gh` means nothing reaches GitHub.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { testUnless } = require('../../lib/harness');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const {
  IS_WINDOWS, BASH, NO_RC, NO_EXEC_BIT, NO_NODE_STUB, shellPath, which, homeEnv, linkTool,
  stubTool, pathWith, joinPath,
} = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'jobs', 'morning.sh');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', '..', 'jobs', 'brief-payload.js'));
const { discoverRepos } = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'repos'));

const HOME_SLUG = 'owner/private-home';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'morning-cloud-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The date the runner titles its Discussion with is the LOCAL one (`date
// '+%Y-%m-%d'`), which is not always today in UTC.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A scratch HOME, a fake `claude` printing `response` and exiting `status`, and
 * a `gh` that answers the contents API and the Discussions GraphQL.
 *
 * `githubRepo` is GITHUB_REPOSITORY: the repo the run belongs to, which since
 * issue #91 IS the home repo, because the workflow lives on it. Null leaves it
 * unset.
 * `settings` is a settings file to plant before the run: the configured runner
 * whose file must win over the env var.
 * `siteRepos` is what the home repo's default branch carries as data/repos.json,
 * private, where gh-pages would be public (issue #110); null is the file being
 * absent, which is publishing that is off or has never run.
 * `defaultBranch` is what GitHub answers for the home repo's default branch:
 * the ref the roster is read from, asked for rather than assumed (issue #112).
 * `posted` is what the home repo's discussions already carry, as
 * `{ title, body }`: the check-before-post guard's input, and the cursor's.
 * `ghFails` makes every API call refuse.
 * `boardBroken` makes the board sweep answer a per-repo error for the first
 * repo: a token whose reach does not cover it.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0,
  githubRepo = HOME_SLUG, settings = null, siteRepos = null, posted = [],
  ghFails = false, ccChangelog = null, boardBroken = false, defaultBranch = 'main',
  sweepToken = 'SWEEP-TOKEN', postToken = 'POST-TOKEN',
} = {}) => {
  const root = mkTmp();
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
  // Which token each kind of call was made with. The two-token split (issue
  // #91) is only real if the value `gh` would authenticate with differs between
  // the cross-repo sweep and the post on this repo, and this is where that is
  // visible: one line per call, `<kind> <token>`.
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
    // The default branch, asked for before the roster is read (issue #112):
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
    // The workflow's two, set AFTER the scratch home, which carries no token of
    // its own: the cross-repo secret `gh` authenticates with by default, and
    // the built-in token the post is made with. This world MEANS to hand them
    // over, and what each call was made with is what these cases measure.
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

// A machine without jq, built rather than filtered: on a host where jq sits in
// /usr/bin, dropping its directory would take every other tool with it. A farm
// of symlinks to exactly what the run needs BEFORE it asks for jq is the honest
// shape of the missing tool.
// `date` is on the list because every line the job prints is stamped with it
// (issue #237): a PATH without it is a shell that cannot log, not a machine
// missing jq.
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

// A case that reads what the `gh` shim RECORDED, or what an answer of the
// shim's put in the log. The script's own gh calls reach it on either
// platform (a shell starts a shebang script itself), but the node composers
// it runs spawn gh directly, and no stub is startable that way on Windows
// (tests/lib/platform.js, `stubTool`): the machine's own gh answers those
// reads there, sealed by this world's env to a config that has no account.
const composerTest = testUnless(IS_WINDOWS, NO_NODE_STUB);

// The whole case is the file's mode, which Windows has none of.
const execBitTest = testUnless(IS_WINDOWS, NO_EXEC_BIT);

module.exports = {
  SCRIPT, INSTRUCTION, HOME_SLUG, cleanup, today, mkWorld, withoutJq, runJob, composerTest, execBitTest,
};
