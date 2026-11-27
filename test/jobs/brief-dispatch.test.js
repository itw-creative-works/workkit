// Tests for jobs/brief-dispatch.js, the dispatch both callers make: dispatchBrief()
// in this process and the program form once; `workkit brief` is
// test/scripts/workkit-cli/brief.test.js's. Every world is a scratch HOME with a recording `gh`
// first on PATH, so a refusal is proved by a recorder that stayed silent.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');
const {
  homeEnv, stubTool, basePathWithout, systemPathWith, joinPath,
} = require('../lib/platform');
const { underEnv } = require('../lib/under-env');

const JOBS = path.join(__dirname, '..', '..', 'jobs');
const PROGRAM = path.join(JOBS, 'brief-dispatch.js');
const { dispatchBrief } = require(PROGRAM);

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A machine the dispatch can be asked of.
 *
 * `home` is the home repo slug the settings name: null is a machine with none.
 * `secrets` is what `gh secret list` reports, `secretsUnlistable` makes that
 * read refuse, `dispatch` is whether `gh workflow run` lands, and `gh: false`
 * is a machine without the tool at all.
 */
const mkWorld = ({
  home = 'owner/private-home', secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN'],
  secretsUnlistable = false, dispatch = true, gh = true,
} = {}) => {
  const root = mkTmp('brief-dispatch-');
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
    stubTool(bin, 'gh', [
      '#!/usr/bin/env bash',
      recordArgv(ghLog),
      'case "$*" in',
      `  "workflow run"*) exit ${dispatch ? 0 : 1} ;;`,
      `  "secret list"*) ${secretsUnlistable ? 'exit 1' : `printf '%s\\n'${secrets.map((n) => ` "${n}\tUpdated 2026-07-01"`).join('')}`} ;;`,
      'esac',
      'exit 0',
    ]);
  }

  // What the world lays over this process's env: the scratch home, its settings,
  // and only the shim and the system tools, except in the world that has no `gh`
  // at all, which gets a mirror of the system PATH with gh left out, since a
  // runner ships the real one in /usr/bin.
  const over = homeEnv(path.join(root, 'home'), {
    WORKFLOW_HOME: workflowHome,
    PATH: gh ? systemPathWith(bin) : joinPath(bin, basePathWithout(root, 'gh')),
  });
  return {
    root,
    over,
    ghCalls: () => readArgv(ghLog),
    dispatched: () => readArgv(ghLog).filter((c) => c[0] === 'workflow' && c[1] === 'run'),
    env: { ...process.env, ...over },
  };
};

/** dispatchBrief() in this process, under the world's env. */
const dispatch = (world) => underEnv(world.over, () => dispatchBrief());

describe('jobs/brief-dispatch: the day going over', () => {
  test('a dispatch that lands names the workflow, the repo, and what happens next', async () => {
    const world = mkWorld();
    const answer = await dispatch(world);
    expect(answer.dispatched, `the dispatch was made: ${JSON.stringify(answer)}`).toBe(true);
    const sent = world.dispatched();
    expect(sent.length, `one workflow run: ${fmtCalls(world.ghCalls())}`).toBe(1);
    expect(sent[0][2], 'the brief workflow').toBe('brief.yml');
    expect(sent[0][3], 'on a repo').toBe('--repo');
    expect(sent[0][4], 'the home repo, where the secrets live').toBe('owner/private-home');
    expect(answer.slug, 'the repo a caller points a person at').toBe('owner/private-home');
    expect(/dispatched brief\.yml on owner\/private-home/.test(answer.line), `and the line says so: ${answer.line}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the secrets are checked on the same repo the dispatch names', async () => {
    const world = mkWorld({ home: 'owner/other-home' });
    await dispatch(world);
    const listed = world.ghCalls().filter((c) => c[0] === 'secret' && c[1] === 'list');
    expect(listed.length, 'one listing').toBe(1);
    expect(listed[0].join(' ').includes('owner/other-home'), `on the home repo: ${listed[0].join(' ')}`).toBeTruthy();
    cleanup(world.root);
  });
});

describe('jobs/brief-dispatch: every refusal is named', () => {
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
    test(`${why}: the reason is set and no day goes over`, async () => {
      const world = mkWorld(over);
      const answer = await dispatch(world);
      expect(answer.dispatched, `the dispatch was refused: ${JSON.stringify(answer)}`).toBe(false);
      expect(pattern.test(answer.reason), `and says why: ${answer.reason}`).toBeTruthy();
      if (over.dispatch !== false) {
        expect(world.dispatched().length, `nothing was triggered: ${fmtCalls(world.ghCalls())}`).toBe(0);
      }
      cleanup(world.root);
    });
  }
});

describe('jobs/brief-dispatch: the program', () => {
  test('the slug on line 1 and the line or the reason on line 2, 0 dispatched and 1 refused', () => {
    const landed = mkWorld();
    const ok = run(process.execPath, [PROGRAM], { env: landed.env });
    const [slug, line] = ok.stdout.split('\n');
    expect(ok.status, `dispatched, stderr: ${ok.stderr}`).toBe(0);
    expect(slug, 'the home repo first').toBe('owner/private-home');
    expect(/dispatched brief\.yml on owner\/private-home/.test(line), `then the line: ${ok.stdout}`).toBeTruthy();
    cleanup(landed.root);

    const none = mkWorld({ home: null });
    const refused = run(process.execPath, [PROGRAM], { env: none.env });
    const [noSlug, reason] = refused.stdout.split('\n');
    expect(refused.status, `refused, stderr: ${refused.stderr}`).toBe(1);
    expect(noSlug, 'no home repo, so an empty first line').toBe('');
    expect(/no home repo is configured/.test(reason), `then the reason: ${refused.stdout}`).toBeTruthy();
    cleanup(none.root);
  });
});
