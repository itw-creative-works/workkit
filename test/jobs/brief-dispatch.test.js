// Tests for jobs/brief-dispatch.sh, sourced and called the way both callers
// use it: the dispatch that lands, and every named reason one cannot be made.
// Every world is a scratch HOME with a recording `gh` first on PATH, so a
// refusal is proved by a recorder that stayed silent.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');
const {
  BASH, NO_RC, shellPath, homeEnv, stubTool, basePathWithout, systemPathWith, joinPath,
} = require('../lib/platform');

const LIB = path.join(__dirname, '..', '..', 'jobs', 'brief-dispatch.sh');

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

  return {
    root,
    ghCalls: () => readArgv(ghLog),
    dispatched: () => readArgv(ghLog).filter((c) => c[0] === 'workflow' && c[1] === 'run'),
    env: homeEnv(path.join(root, 'home'), {
      ...process.env,
      WORKFLOW_HOME: workflowHome,
      // Only the shim and the system tools, except in the world that has no
      // `gh` at all, which gets a mirror of the system PATH with gh left out,
      // since a runner ships the real one in /usr/bin.
      PATH: gh ? systemPathWith(bin) : joinPath(bin, basePathWithout(root, 'gh')),
    }),
  };
};

/** Source the lib, call dispatch_brief, and report what it set. */
const dispatch = (world, lib = LIB) => {
  const script = `. ${JSON.stringify(shellPath(lib))}
if dispatch_brief; then printf 'ok\\n%s\\n' "$DISPATCH_LINE"; else printf 'refused\\n%s\\n' "$DISPATCH_REASON"; fi`;
  const res = spawnSync(BASH, [...NO_RC, '-c', script], { encoding: 'utf8', env: world.env, timeout: SPAWN_DEADLINE });
  const [verdict, ...rest] = (res.stdout || '').split('\n');
  return { verdict, said: rest.join('\n').trim(), stderr: res.stderr || '' };
};

describe('jobs/brief-dispatch: shape', () => {
  test('bash -n: no syntax errors, and nothing runs at load', () => {
    const res = spawnSync(BASH, [...NO_RC, '-n', shellPath(LIB)], { encoding: 'utf8' });
    expect(res.status, `bash -n: ${res.stderr}`).toBe(0);
    const sourced = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(shellPath(LIB))}`], { encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(sourced.status, 'sourcing it is free').toBe(0);
    expect(sourced.stdout, 'and silent').toBe('');
  });
});

describe('jobs/brief-dispatch: the day going over', () => {
  test('a dispatch that lands names the workflow, the repo, and what happens next', () => {
    const world = mkWorld();
    const { verdict, said } = dispatch(world);
    expect(verdict, `the dispatch was made: ${said}`).toBe('ok');
    const sent = world.dispatched();
    expect(sent.length, `one workflow run: ${fmtCalls(world.ghCalls())}`).toBe(1);
    expect(sent[0][2], 'the brief workflow').toBe('brief.yml');
    expect(sent[0][3], 'on a repo').toBe('--repo');
    expect(sent[0][4], 'the home repo, where the secrets live').toBe('owner/private-home');
    expect(/dispatched brief\.yml on owner\/private-home/.test(said), `and the line says so: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the secrets are checked on the same repo the dispatch names', () => {
    const world = mkWorld({ home: 'owner/other-home' });
    dispatch(world);
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
    test(`${why}: the reason is set and no day goes over`, () => {
      const world = mkWorld(over);
      const { verdict, said } = dispatch(world);
      expect(verdict, `the dispatch was refused: ${said}`).toBe('refused');
      expect(pattern.test(said), `and says why: ${said}`).toBeTruthy();
      if (over.dispatch !== false) {
        expect(world.dispatched().length, `nothing was triggered: ${fmtCalls(world.ghCalls())}`).toBe(0);
      }
      cleanup(world.root);
    });
  }

  test('a copy of the lib with no engine beside it refuses by name', () => {
    // The engine resolves from the file's own location, so a partial checkout
    // is a named refusal rather than a crash.
    const world = mkWorld();
    const lone = path.join(world.root, 'jobs');
    fs.mkdirSync(lone, { recursive: true });
    const copy = path.join(lone, 'brief-dispatch.sh');
    fs.copyFileSync(LIB, copy);
    const { verdict, said } = dispatch(world, copy);
    expect(verdict, `no engine, no dispatch: ${said}`).toBe('refused');
    expect(/home-repo library is missing at/.test(said), `and the path is named: ${said}`).toBeTruthy();
    expect(world.dispatched().length, 'nothing was triggered').toBe(0);
    cleanup(world.root);
  });
});
