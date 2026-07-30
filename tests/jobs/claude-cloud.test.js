//
// Tests for jobs/claude-cloud.sh — the brief as a GitHub Actions runner runs it
// (issue #82).
//
// The runner is executed for real against a scratch HOME and a PATH farm: a
// fake `claude` recording the argument vector it was given, and a `gh` that
// answers the two APIs this script speaks — the contents API it reads the
// published slug list from, and the Discussions GraphQL it publishes through.
// `git`, `jq` and `node` are the real ones, because the roster this script
// writes is only worth asserting if the tower's own composer reads it back.
//
// HOME is the whole sandbox: the script resolves ~/.workkit from it exactly as
// the Node composers do, so nothing here touches the real workflow folder, and
// the recording `gh` means nothing reaches GitHub.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-cloud.sh');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', 'jobs', 'brief-payload.js'));
const { discoverRepos } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'repos'));

const HOME_SLUG = 'owner/private-home';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cloud-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The date the runner titles its Discussion with is the LOCAL one (`date
// '+%Y-%m-%d'`), which is not always today in UTC.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A scratch HOME, a fake `claude` printing `response` and exiting `status`, and
 * a `gh` that answers the contents API and the Discussions GraphQL.
 *
 * `slugEnv` is WORKKIT_HOME_SLUG; null leaves it unset.
 * `settings` is a settings file to plant before the run — the configured runner
 * whose file must win over the env var.
 * `siteRepos` is what gh-pages serves as data/repos.json; null is the file
 * being absent, which is publishing that is off or has never run.
 * `posted` is what the home repo's discussions already carry, as
 * `{ title, body }` — the check-before-post guard's input, and the cursor's.
 * `ghFails` makes every API call refuse.
 * `boardBroken` makes the board sweep answer a per-repo error for the first
 * repo — a token whose reach does not cover it.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0,
  slugEnv = HOME_SLUG, settings = null, siteRepos = null, posted = [],
  ghFails = false, ccChangelog = null, boardBroken = false,
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  if (settings) {
    fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(home, '.workkit', 'settings.json'), JSON.stringify(settings, null, 2));
  }

  const claudeLog = path.join(root, 'claude-argv.log');
  const claude = path.join(bin, 'claude');
  fs.writeFileSync(claude, [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    // %b, not %s: the escapes JSON.stringify wrote have to become real newlines.
    // A send that failed says so on stderr, the way the CLI does — the runner
    // logs that and never the digest.
    `printf '%b' ${JSON.stringify(response)}${status === 0 ? '' : ' >&2'}`,
    `exit ${status}`,
    '',
  ].join('\n'));
  fs.chmodSync(claude, 0o755);

  const ghLog = path.join(root, 'gh-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  const nodes = posted.map(({ title, body = '' }) => JSON.stringify({
    title, createdAt: `${today()}T09:00:00Z`, body,
  })).join(',');
  // The contents API answers with a base64 body, which is what the script
  // decodes; `gh api -q .content` is the field it asks for.
  const encoded = siteRepos ? Buffer.from(JSON.stringify(siteRepos)).toString('base64') : null;
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    ...(ghFails ? ['exit 1'] : []),
    'all="$*"',
    'case "$all" in',
    '  *contents/data/repos.json*)',
    ...(encoded
      // Wrapped at 60 characters, the way GitHub serves it — a decoder that
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
    // is present — the shape the composer's warning is about.
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
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  // The upstream CHANGELOG the news read is pointed at. `/dev/null` is the
  // module's silent-skip path — an empty body, no version, no line.
  let ccSource = 'file:///dev/null';
  if (ccChangelog) {
    const file = path.join(root, 'cc-changelog.md');
    fs.writeFileSync(file, ccChangelog);
    ccSource = `file://${file}`;
  }

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    WORKKIT_CC_CHANGELOG: ccSource,
    // The script refuses to run anywhere but a runner, because it rewrites the
    // roster in ~/.workkit. Every world here IS a runner; the one that is not
    // deletes this again.
    GITHUB_ACTIONS: 'true',
  };
  delete env.WORKFLOW_HOME;
  if (slugEnv === null) delete env.WORKKIT_HOME_SLUG;
  else env.WORKKIT_HOME_SLUG = slugEnv;

  return {
    root,
    home,
    workflowHome: path.join(home, '.workkit'),
    settings: () => {
      const file = path.join(home, '.workkit', 'settings.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    },
    // The roster read back the way the composers read it — the only assertion
    // that proves the synthetic checkouts are ones they accept.
    roster: () => discoverRepos({ workflowHome: path.join(home, '.workkit'), home }),
    calls: () => readArgv(claudeLog),
    ghCalls: () => readArgv(ghLog),
    created: () => readArgv(ghLog).filter((c) => c.join(' ').includes('createDiscussion')),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    env,
  };
};

// A machine without jq, built rather than filtered: on a host where jq sits in
// /usr/bin, dropping its directory would take every other tool with it. A farm
// of symlinks to exactly what the run needs BEFORE it asks for jq is the honest
// shape of the missing tool.
const NO_JQ_TOOLS = ['bash', 'dirname', 'mktemp', 'mkdir', 'rm', 'cat'];
const withoutJq = (root, bin) => {
  const farm = path.join(root, 'no-jq');
  fs.mkdirSync(farm, { recursive: true });
  for (const tool of NO_JQ_TOOLS) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (found) fs.symlinkSync(found, path.join(farm, tool));
  }
  return `${bin}:${farm}`;
};

const runJob = (world, args = []) => spawnSync('bash', [SCRIPT, ...args], {
  encoding: 'utf8',
  timeout: 60000,
  env: world.env,
});

const run = async () => {
  group('jobs/claude-cloud: shape');

  await test('bash -n — no syntax errors', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the workflow runs it through bash, but a human runs it directly');
  });

  await test('it is the brief leg alone — no summaries, no site publish, no notification', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    assert(!text.includes('claude-nightly.sh'), 'the summaries read a machine this runner is not');
    assert(!text.includes('workflow/publish.sh'), 'and the site is built where the home clone lives');
    assert(!/NOTIFLY|Notifly/.test(text), 'there is no desktop to notify');
  });

  group('jobs/claude-cloud: a runner only');

  await test('off a runner it refuses, and the machine’s roster is untouched', () => {
    // The roster this script writes REPLACES what is there — on a laptop that is
    // every registered repo and every recorded decline, swapped for synthetic
    // cloud paths that would then live on the tower forever.
    const world = mkWorld();
    const roster = path.join(world.home, '.workkit', '.repos.json');
    fs.mkdirSync(path.join(world.home, '.workkit'), { recursive: true });
    const before = JSON.stringify({
      version: 1,
      repos: {
        '/Users/someone/Developer/Repositories/Owner/one': 'enabled',
        '/Users/someone/Developer/Repositories/Owner/two': 'declined',
      },
    }, null, 2);
    fs.writeFileSync(roster, before);

    const env = { ...world.env };
    delete env.GITHUB_ACTIONS;
    const res = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });

    assertEq(res.status, 1, 'a local run refuses');
    assert(/GITHUB_ACTIONS/.test(res.stderr), `and names the guard: ${res.stderr}`);
    assertEq(fs.readFileSync(roster, 'utf8'), before, 'the roster is byte-identical — nothing was registered or dropped');
    assertEq(world.calls().length, 0, 'and nothing was sent');
    cleanup(world.root);
  });

  group('jobs/claude-cloud: the machine it makes');

  await test('an absent settings file is written from WORKKIT_HOME_SLUG', () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.settings().site.repo, HOME_SLUG, 'the home repo the runner was told about');
    assert(res.stdout.includes('settings: wrote'), `and it says it wrote it: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('an existing settings file wins over the env var', () => {
    const world = mkWorld({
      settings: { version: 1, site: { repo: 'configured/home' } },
      slugEnv: 'env/home',
    });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.settings().site.repo, 'configured/home', 'a configured runner is not rewritten');
    assert(world.roster().some((r) => r.slug === 'configured/home'), 'and that is the repo swept');
    cleanup(world.root);
  });

  await test('a missing jq is named as a missing tool, not as a missing home repo', () => {
    // jq reads the home slug, so an absent one empties that read — the two
    // refusals have to say which of them happened.
    const world = mkWorld();
    const env = { ...world.env, PATH: withoutJq(world.root, path.join(world.root, 'bin')) };
    const res = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 1, 'the run refuses');
    assert(/jq is not installed/.test(res.stderr), `and names the tool: ${res.stderr}`);
    assert(!/names no home repo/.test(res.stderr), 'never the key, which is right there');
    cleanup(world.root);
  });

  await test('neither a settings file nor the env var refuses the run', () => {
    const world = mkWorld({ slugEnv: null });
    const res = runJob(world);
    assertEq(res.status, 1, 'there is no board to sweep and nowhere to publish');
    assert(/WORKKIT_HOME_SLUG/.test(res.stderr), `and it names what is missing: ${res.stderr}`);
    assertEq(world.calls().length, 0, 'nothing was sent');
    cleanup(world.root);
  });

  await test('the roster comes from the published slug list, and the composer reads it back', () => {
    const world = mkWorld({ siteRepos: { repos: ['a/one', 'b/two', HOME_SLUG], home: HOME_SLUG } });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const slugs = world.roster().map((r) => r.slug).sort();
    assertEq(slugs.join(','), ['a/one', 'b/two', HOME_SLUG].sort().join(','),
      `every published slug is on the roster: ${JSON.stringify(world.roster())}`);
    cleanup(world.root);
  });

  await test('no published list falls back to the home repo alone, and still composes', () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const slugs = world.roster().map((r) => r.slug);
    assertEq(slugs.join(','), HOME_SLUG, `the home repo, whose issues are the cross-project queue: ${slugs}`);
    assert(res.stdout.includes('sweeping the home repo alone'), `and it says so: ${res.stdout}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `the brief was still composed: ${fmtCalls(calls).slice(0, 200)}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'from the same payload the laptop sends');
    cleanup(world.root);
  });

  await test('the budget rails are the laptop’s, unchanged', () => {
    const world = mkWorld();
    runJob(world);
    const argv = world.calls()[0];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assertEq(argv[0], '-p', 'headless');
    assertEq(after('--model'), 'haiku', 'the cheapest model');
    assertEq(after('--effort'), 'low', 'at the lowest effort');
    assert(argv.includes('--safe-mode'), 'safe mode');
    assert(argv.includes('--no-session-persistence'), 'nothing persisted');
    assertEq(after('--tools'), '', 'no tools');
    assertEq(after('--max-budget-usd'), '0.25', 'and a hard budget');
    cleanup(world.root);
  });

  await test('a repo the token cannot read is named in the log, not in the payload', () => {
    // The scope gap the Actions log has to show: the token reaches the home repo
    // and not the rest, the brief reads clean, and only this line says so.
    const world = mkWorld({ boardBroken: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.includes(`brief: 1 repos unreadable: ${HOME_SLUG}`), `the log names them: ${res.stdout}`);
    const calls = world.calls();
    assertEq(calls.length, 1, 'the brief was still composed');
    assert(calls[0][1].startsWith(INSTRUCTION), 'and the payload is untouched — the line never entered it');
    cleanup(world.root);
  });

  group('jobs/claude-cloud: publishing');

  await test('the digest is posted as a Discussion titled with the date', () => {
    const world = mkWorld({ ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a `DirectoryAdded` hook\n' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const created = world.created();
    assertEq(created.length, 1, `one createDiscussion mutation: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assert(created[0].join(' ').includes(`title=brief: ${today()}`), 'the title carries the date');
    const body = world.postedBody();
    assert(/HEADLINE: one thing today\./.test(body), `the digest response is the body: ${body}`);
    assert(/<!-- cc-news: 2\.1\.220 -->/.test(body), `and the cursor the next morning reads: ${body}`);
    assert(res.stdout.includes(`posted brief: ${today()}`), `the log says it published: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('the digest body never reaches the Actions log', () => {
    // The log belongs to a repo that could be public; the digest summarizes
    // private-repo issues. Proof of life is all the log gets.
    const world = mkWorld({ response: 'HEADLINE: one thing today.\nIN FLIGHT: acme/secret #4 — the private thing.\n' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(!/acme\/secret/.test(res.stdout + res.stderr), `no digest body in the log: ${res.stdout}`);
    assert(/digest: HEADLINE: one thing today\./.test(res.stdout), `the headline is the proof of life: ${res.stdout}`);
    assert(/\(\d+ bytes\)/.test(res.stdout), `with how much there was of it: ${res.stdout}`);
    assert(/acme\/secret/.test(world.postedBody()), 'and the whole digest is on the Discussion, which is the delivery');
    cleanup(world.root);
  });

  await test('a send that failed logs its status and stderr, never the payload', () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assert(/the digest send exit 3/.test(res.stderr), `the status is named: ${res.stderr}`);
    assert(/budget exceeded/.test(res.stderr), `and what the CLI said: ${res.stderr}`);
    assert(!/MORNING KICKOFF/.test(res.stdout + res.stderr), 'the payload it was handed is not echoed');
    cleanup(world.root);
  });

  await test('today’s brief already on the board is not posted twice', () => {
    const world = mkWorld({ posted: [{ title: `brief: ${today()}` }] });
    const res = runJob(world);
    assertEq(res.status, 0, 'an overlap with the laptop is an ordinary morning');
    assertEq(world.created().length, 0, `nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assert(res.stdout.includes('already carries brief: '), `and it says so: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('a post that does not land is a red run', () => {
    const world = mkWorld({ ghFails: true });
    const res = runJob(world);
    assertEq(res.status, 1, 'in the cloud the log IS the delivery — a silent failure is invisible');
    assert(res.stdout.includes('nothing posted'), `and the run says what happened: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('a failed send publishes nothing and carries its status out', () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assertEq(world.created().length, 0, 'and no Discussion carries the failure');
    assert(/budget exceeded/.test(res.stderr), `the reason is on stderr: ${res.stderr}`);
    cleanup(world.root);
  });

  group('jobs/claude-cloud: the workflow that runs it');

  const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'brief.yml');

  await test('brief.yml triggers on dispatch and on a cron backup', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert(/^on:$/m.test(text), 'it has a trigger block');
    assert(/^ {2}workflow_dispatch:$/m.test(text), 'the laptop dispatches it');
    assert(/^ {4}- cron: '[\d*/, ]+'$/m.test(text), 'and a cron is the backup');
  });

  await test('it runs the cloud script, and that script is there', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    const named = text.match(/run: bash (jobs\/[\w-]+\.sh)/);
    assert(named, `the job runs a jobs script: ${text}`);
    assert(fs.existsSync(path.join(__dirname, '..', '..', named[1])), `${named[1]} resolves from the repo root`);
  });

  await test('a dispatch and the cron cannot run at once', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    assert(/^concurrency:$/m.test(text) && /^ {2}group: \S+$/m.test(text), `a concurrency group is set: ${text}`);
  });

  await test('the credentials are named, never written', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'WORKKIT_HOME_SLUG']) {
      assert(text.includes(`${name}:`), `${name} reaches the script`);
    }
    assert(/CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\./.test(text), 'the OAuth token is a secret reference');
    assert(/GH_TOKEN: \$\{\{ secrets\./.test(text), 'and so is the home-repo token');
    // Anything that looks like a credential rather than a reference to one.
    assert(!/\b(gh[pousr]_|github_pat_|sk-ant-)[A-Za-z0-9_-]{8,}/.test(text), 'no credential is written into the file');
    assert(!/set -x/.test(text), 'and nothing traces the environment into the log');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
