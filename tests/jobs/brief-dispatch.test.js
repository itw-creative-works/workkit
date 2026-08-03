//
// Tests for jobs/brief-dispatch.sh — handing the day to the cloud.
//
// The function is SOURCED and called directly here, which is how both its
// callers use it: the scheduled morning (morning-local.test.js covers what that
// caller does with the answer) and `workkit brief` (workkit-cli.test.js). This
// suite is about the answer itself — the dispatch that lands, and every named
// reason one cannot be made.
//
// Every world is a scratch HOME with a recording `gh` first on PATH, so nothing
// here reaches GitHub and a refusal is proved by a recorder that stayed silent.
// The home repo is named in a scratch WORKFLOW_HOME, never this machine's.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const LIB = path.join(__dirname, '..', '..', 'jobs', 'brief-dispatch.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brief-dispatch-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A machine the dispatch can be asked of.
 *
 * `home` is the home repo slug the settings name — null is a machine with none.
 * `secrets` is what `gh secret list` reports, `secretsUnlistable` makes that
 * read refuse, `dispatch` is whether `gh workflow run` lands, and `gh: false`
 * is a machine without the tool at all.
 */
const mkWorld = ({
  home = 'owner/private-home', secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN'],
  secretsUnlistable = false, dispatch = true, gh = true,
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(
    path.join(workflowHome, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo: home, publish: false, url: null } }, null, 2),
  );

  const ghLog = path.join(root, 'gh-argv.log');
  if (gh) {
    fs.writeFileSync(path.join(bin, 'gh'), [
      '#!/usr/bin/env bash',
      recordArgv(ghLog),
      'case "$*" in',
      `  "workflow run"*) exit ${dispatch ? 0 : 1} ;;`,
      `  "secret list"*) ${secretsUnlistable ? 'exit 1' : `printf '%s\\n'${secrets.map((n) => ` "${n}\tUpdated 2026-07-01"`).join('')}`} ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  }

  return {
    root,
    ghCalls: () => readArgv(ghLog),
    dispatched: () => readArgv(ghLog).filter((c) => c[0] === 'workflow' && c[1] === 'run'),
    env: {
      ...process.env,
      HOME: path.join(root, 'home'),
      WORKFLOW_HOME: workflowHome,
      // Only the shim and the system tools. `jq` lives where the package
      // managers put it, so those directories are on the path — except in the
      // world that has no `gh` at all, where the real one lives there too and
      // the whole point is that the tool cannot be found.
      PATH: gh ? `${bin}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin` : `${bin}:/usr/bin:/bin`,
    },
  };
};

/** Source the lib, call dispatch_brief, and report what it set. */
const dispatch = (world, lib = LIB) => {
  const script = `. ${JSON.stringify(lib)}
if dispatch_brief; then printf 'ok\\n%s\\n' "$DISPATCH_LINE"; else printf 'refused\\n%s\\n' "$DISPATCH_REASON"; fi`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: world.env, timeout: 30000 });
  const [verdict, ...rest] = (res.stdout || '').split('\n');
  return { verdict, said: rest.join('\n').trim(), stderr: res.stderr || '' };
};

const run = async () => {
  group('jobs/brief-dispatch: shape');

  await test('bash -n — no syntax errors, and nothing runs at load', () => {
    const res = spawnSync('bash', ['-n', LIB], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
    const sourced = spawnSync('bash', ['-c', `. ${JSON.stringify(LIB)}`], { encoding: 'utf8', timeout: 30000 });
    assertEq(sourced.status, 0, 'sourcing it is free');
    assertEq(sourced.stdout, '', 'and silent');
  });

  group('jobs/brief-dispatch: the day going over');

  await test('a dispatch that lands names the workflow, the repo, and what happens next', () => {
    const world = mkWorld();
    const { verdict, said } = dispatch(world);
    assertEq(verdict, 'ok', `the dispatch was made: ${said}`);
    const sent = world.dispatched();
    assertEq(sent.length, 1, `one workflow run: ${fmtCalls(world.ghCalls())}`);
    assertEq(sent[0][2], 'brief.yml', 'the brief workflow');
    assertEq(sent[0][3], '--repo', 'on a repo');
    assertEq(sent[0][4], 'owner/private-home', 'the home repo, where the secrets live');
    assert(/dispatched brief\.yml on owner\/private-home/.test(said), `and the line says so: ${said}`);
    cleanup(world.root);
  });

  await test('the secrets are checked on the same repo the dispatch names', () => {
    const world = mkWorld({ home: 'owner/other-home' });
    dispatch(world);
    const listed = world.ghCalls().filter((c) => c[0] === 'secret' && c[1] === 'list');
    assertEq(listed.length, 1, 'one listing');
    assert(listed[0].join(' ').includes('owner/other-home'), `on the home repo: ${listed[0].join(' ')}`);
    cleanup(world.root);
  });

  group('jobs/brief-dispatch: every refusal is named');

  const refusals = [
    ['gh is not on this machine', { gh: false }, /gh is not on this machine/],
    ['no home repo is configured', { home: null }, /no home repo is configured/],
    ['the secrets could not be listed', { secretsUnlistable: true }, /the secrets on owner\/private-home could not be listed/],
    ['the repo carries no secrets at all', { secrets: [] }, /carries no secrets/],
    ['the OAuth token is missing', { secrets: ['WORKKIT_GITHUB_TOKEN'] }, /does not carry CLAUDE_CODE_OAUTH_TOKEN/],
    ['the board token is missing', { secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }, /does not carry WORKKIT_GITHUB_TOKEN/],
    ['the trigger did not land', { dispatch: false }, /did not land/],
  ];

  for (const [why, over, pattern] of refusals) {
    await test(`${why} — the reason is set and no day goes over`, () => {
      const world = mkWorld(over);
      const { verdict, said } = dispatch(world);
      assertEq(verdict, 'refused', `the dispatch was refused: ${said}`);
      assert(pattern.test(said), `and says why: ${said}`);
      if (over.dispatch !== false) {
        assertEq(world.dispatched().length, 0, `nothing was triggered: ${fmtCalls(world.ghCalls())}`);
      }
      cleanup(world.root);
    });
  }

  await test('a copy of the lib with no engine beside it refuses by name', () => {
    // The engine is resolved from the FILE's own location, which is what lets a
    // caller that knows nothing about the 9am job source it — and what makes a
    // partial checkout a named refusal rather than a crash.
    const world = mkWorld();
    const lone = path.join(world.root, 'jobs');
    fs.mkdirSync(lone, { recursive: true });
    const copy = path.join(lone, 'brief-dispatch.sh');
    fs.copyFileSync(LIB, copy);
    const { verdict, said } = dispatch(world, copy);
    assertEq(verdict, 'refused', `no engine, no dispatch: ${said}`);
    assert(/home-repo library is missing at/.test(said), `and the path is named: ${said}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
