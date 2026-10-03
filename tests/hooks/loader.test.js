// Tests for hooks/loader.sh: the router that resolves a hook name to its
// script. Loader-level failures fail open (a broken loader must never wedge
// the session); the hook's own exit code propagates untouched so blocking
// hooks actually block. The loader also stands every hook down in a repo that
// has not opted in, bar the two machine-level ones, and runs it for any command
// whose target it cannot place for sure.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, shellPath, homeEnv, basePathWithout, joinPath,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mkRepo } = require('../lib/git-repo');
const { mkRosterHome } = require('../lib/roster');
const { plantRecord } = require('../lib/suite-record');

const KIT = path.join(__dirname, '..', '..');
const LOADER = path.join(KIT, 'hooks', 'loader.sh');

const runLoader = (args, input = '{}', env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), ...args], {
    input,
    env: { ...process.env, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// The opted-in repo the routing cases stand in, since a hook only runs in one.
const OPTED = mkRepo('loader-', {});

// A command the safety/commit-language hook must block (exit 2): it observes
// routing and exit-code propagation without any repo state.
const BLOCKED_COMMIT = JSON.stringify({
  cwd: shellPath(OPTED.repo), tool_input: { command: 'git commit -m "kill the watcher"' },
});

// One hook through the loader in a world of the case's own: `env` is whole,
// never the developer's, and the child stands in `cwd` as a session would.
const runIn = (name, input, cwd, env) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), name], {
    input: Buffer.isBuffer(input) ? input : JSON.stringify(input),
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const said = (out) => `exit ${out.code}, stdout ${JSON.stringify(out.stdout)}, stderr ${JSON.stringify(out.stderr)}`;
const silent = (out) => out.code === 0 && out.stdout === '' && out.stderr === '';
const assertSilent = (out, what) => assert(silent(out), `${what} must say nothing and exit 0, got ${said(out)}`);
const assertSpoke = (out, what) => assert(!silent(out), `${what} must run, got ${said(out)}`);

const SETTINGS = `${W}/settings.json`;
// The repo's answer as the settings file states it; `none` writes no file.
const ANSWERS = {
  enabled: {},
  none: {},
  declined: { [SETTINGS]: '{ "version": 1, "enabled": false }\n' },
  legacy: { [SETTINGS]: '{ "version": 1 }\n' },
};

// A fixture repo carrying a test script, answering as `answer` names.
const mkWorld = (answer = 'enabled') => mkRepo('loader-optin-', {
  'package.json': `${JSON.stringify({ name: 'fixture', scripts: { test: 'node tests/run.js' } })}\n`,
  ...ANSWERS[answer],
}, undefined, { optIn: answer !== 'none' });

// The world's own env plus the seams that keep a hook off this machine's state.
const envOf = (w, extra = {}) => ({
  ...w.env,
  MANAGER_USER_SETTINGS: shellPath(path.join(w.tmp, 'no-user-settings.json')),
  MANAGER_DEBUG: '',
  ...extra,
});

const bash = (cwd, command) => ({ tool_name: 'Bash', cwd: shellPath(cwd), tool_input: { command } });

// The case 1 hooks, each with what makes it speak in an opted-in repo: `prep`
// readies the world, `input` is the payload at `cwd`.
const HOOKS = [
  {
    name: 'safety:commit-gate',
    prep: (w) => { w.write('src/x.js', 'x\n'); w.git('add', '-A'); },
    input: (cwd) => bash(cwd, 'git commit -m "feat: add x"'),
  },
  {
    name: 'safety:suite-guard',
    prep: (w) => plantRecord(w.tmp, w.repo),
    input: (cwd) => bash(cwd, 'npm test'),
  },
  {
    name: 'docs:checkpoint',
    prep: () => {},
    input: (cwd) => ({ hook_event_name: 'UserPromptSubmit', cwd: shellPath(cwd), session_id: 's1', prompt: 'compact' }),
  },
  {
    name: 'manager:resolver',
    prep: () => {},
    input: (cwd) => ({
      tool_name: 'Task',
      cwd: shellPath(cwd),
      session_id: 's1',
      transcript_path: shellPath(path.join(cwd, 'no-transcript.jsonl')),
      tool_input: { subagent_type: 'worker', prompt: 'do the thing' },
    }),
  },
];

// Each case 1 hook in a fresh world answering `answer`.
const runEach = (answer) => HOOKS.map((hook) => {
  const w = mkWorld(answer);
  hook.prep(w);
  return [hook.name, runIn(hook.name, hook.input(w.repo), w.repo, envOf(w))];
});

// An Edit to an installed file under `dir`, which safety:vendor-guard blocks
// wherever it runs.
const editVendored = (cwd, dir) => {
  const file = path.join(dir, 'node_modules', 'pkg', 'index.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  return {
    tool_name: 'Edit',
    cwd: shellPath(cwd),
    tool_input: { file_path: shellPath(file), old_string: 'x', new_string: 'y' },
  };
};

// A gh write carrying a token-shaped string, which safety:issue-guard blocks.
const TOKEN = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}`;
const ghEdit = (cwd, flag, slug) => bash(cwd, `gh issue edit 3 ${flag} ${slug} --body "token ${TOKEN}"`);

// An opted-in cwd and a roster listing one other opted-in repo, acme/tools.
const rosterWorld = () => {
  const cwd = mkWorld();
  const named = mkWorld();
  named.git('remote', 'set-url', 'origin', 'https://example.invalid/acme/tools.git');
  const home = mkRosterHome([[named.repo, 'enabled']]);
  return { cwd: cwd.repo, home, env: homeEnv(home, { PATH: process.env.PATH, TMPDIR: shellPath(cwd.tmp) }) };
};

// The three load-time surfaces workflow:reload-guard watches, in a checkout of
// its own (RELOAD_GUARD_ROOT), so the kit's own files stay untouched.
const mkReloadRoot = () => {
  const dir = mkTmp('loader-reload-');
  for (const [rel, body] of [
    ['hooks/hooks.json', '{ "hooks": {} }\n'],
    ['agents/worker.md', '# worker\n'],
    ['skills/ship/SKILL.md', '# ship\n'],
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
};

// A copy of the kit whose hooks folder holds one more hook, `fixture:capture`,
// which writes its stdin to $CAPTURE_FILE. Everything else links to the kit.
const mkCaptureKit = () => {
  const kit = mkTmp('loader-kit-');
  const mirror = (from, to, skip) => {
    for (const name of fs.readdirSync(from)) {
      if (skip.includes(name)) continue;
      const src = path.join(from, name);
      if (fs.statSync(src).isDirectory()) fs.symlinkSync(src, path.join(to, name), 'junction');
      else fs.copyFileSync(src, path.join(to, name));
    }
  };
  mirror(KIT, kit, ['.git', 'hooks']);
  fs.mkdirSync(path.join(kit, 'hooks'));
  mirror(path.join(KIT, 'hooks'), path.join(kit, 'hooks'), []);
  const hook = path.join(kit, 'hooks', 'fixture', 'capture', 'run.sh');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/usr/bin/env bash\ncat > "$CAPTURE_FILE"\n', { mode: 0o755 });
  return path.join(kit, 'hooks', 'loader.sh');
};

// The capture probe through `loader` for a Bash `command` at `cwd`, in `home`
// (a roster's) or a scratch home outside every repo: `ran` is whether the
// loader started the hook.
const probeInput = (loader, cwd, input, home) => {
  const scratch = mkTmp('loader-cd-');
  const capture = path.join(scratch, 'captured');
  const res = spawnSync(BASH, [...NO_RC, shellPath(loader), 'fixture:capture'], {
    input: JSON.stringify(input),
    cwd,
    env: homeEnv(home || scratch, { PATH: process.env.PATH, TMPDIR: shellPath(scratch), CAPTURE_FILE: shellPath(capture) }),
    encoding: 'utf8',
    timeout: 30000,
  });
  return { ran: fs.existsSync(capture), out: { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' } };
};
const probe = (loader, cwd, command, home) => probeInput(loader, cwd, bash(cwd, command), home);

const assertRuns =(loader, cwd, command, home) => {
  const { ran, out } = probe(loader, cwd, command, home);
  assert(ran, `${JSON.stringify(command)} must run the hook, got ${said(out)}`);
};

const assertStands = (loader, cwd, command, home) => {
  const { ran, out } = probe(loader, cwd, command, home);
  assert(!ran, `${JSON.stringify(command)} must stand the hook down, got ${said(out)}`);
};

const run = async () => {
  group('loader: fail-open');

  await test('no hook name: exit 0', () => {
    const { code } = runLoader([]);
    assertEq(code, 0, 'missing name must fail open');
  });

  await test('unknown hook name: exit 0', () => {
    const { code } = runLoader(['no-such-prefix:no-such-hook']);
    assertEq(code, 0, 'missing script must fail open');
  });

  group('loader: routing + propagation');

  await test('colon spelling routes to the nested script and propagates exit 2', () => {
    const { code } = runLoader(['safety:commit-language'], BLOCKED_COMMIT);
    assertEq(code, 2, 'safety:commit-language must resolve to safety/commit-language/run.sh and block');
  });

  await test('slash spelling routes identically', () => {
    const { code } = runLoader(['safety/commit-language'], BLOCKED_COMMIT);
    assertEq(code, 2, 'slash spelling must route the same');
  });

  await test('passing hook exits 0 through the loader', () => {
    const input = JSON.stringify({ cwd: shellPath(OPTED.repo), tool_input: { command: 'git status' } });
    const { code } = runLoader(['safety:commit-language'], input);
    assertEq(code, 0, 'non-blocking result propagates as 0');
  });

  group('loader: HOOK_DISABLE');

  await test('HOOK_DISABLE=1 no-ops a hook that would block', () => {
    const { code } = runLoader(['safety:commit-language'], BLOCKED_COMMIT, { HOOK_DISABLE: '1' });
    assertEq(code, 0, 'the per-command hatch must bypass the hook');
  });

  group('loader: a repo that has not opted in');

  await test('no settings file: commit-gate, suite-guard, checkpoint and resolver step aside', () => {
    for (const [name, out] of runEach('enabled')) assertSpoke(out, `${name} in an opted-in repo`);
    for (const [name, out] of runEach('none')) assertSilent(out, `${name} in a repo with no settings file`);
  });

  await test('"enabled": false steps aside; a file with no enabled key runs', () => {
    for (const [name, out] of runEach('declined')) assertSilent(out, `${name} in a repo that set enabled false`);
    for (const [name, out] of runEach('legacy')) assertSpoke(out, `${name} in a legacy opt-in`);
  });

  await test('an Edit is judged by the repo holding the file, not the cwd', () => {
    const opted = mkWorld();
    const not = mkWorld('none');
    const away = runIn('safety:vendor-guard', editVendored(opted.repo, not.repo), opted.repo, envOf(opted));
    assertSilent(away, 'an Edit into a repo not opted in, from an opted-in cwd');
    const home = runIn('safety:vendor-guard', editVendored(not.repo, opted.repo), not.repo, envOf(not));
    assertEq(home.code, 2, `an Edit into an opted-in repo, from a cwd that is not, must block: ${said(home)}`);
  });

  await test('an Edit through a link is judged by the repo the link reaches, as ~/.claude/skills reaches the dotfiles checkout', () => {
    const opted = mkWorld();
    const not = mkWorld('none');
    const outside = mkTmp('loader-linked-');
    // The spelled path climbs to no repo; only the folder behind the link is in one.
    const linkTo = (w, name) => {
      fs.mkdirSync(path.join(w.repo, 'vendored'), { recursive: true });
      fs.symlinkSync(path.join(w.repo, 'vendored'), path.join(outside, name), 'junction');
      return path.join(outside, name);
    };
    const inOpted = runIn('safety:vendor-guard', editVendored(outside, linkTo(opted, 'skills')), outside, envOf(opted));
    assertEq(inOpted.code, 2, `an Edit through a link into an opted-in repo must block: ${said(inOpted)}`);
    const inNot = runIn('safety:vendor-guard', editVendored(outside, linkTo(not, 'other')), outside, envOf(not));
    assertSilent(inNot, 'an Edit through a link into a repo not opted in');
  });

  await test('an Edit to a linked file is judged by the repo holding the real file, as ~/.claude/settings.json reaches the dotfiles checkout', () => {
    const opted = mkWorld();
    const not = mkWorld('none');
    const outside = mkTmp('loader-linked-file-');
    // The link itself sits in no repo; only the file it points at does.
    const linkFile = (w, name) => {
      const real = path.join(w.repo, 'node_modules', 'pkg', `${name}.js`);
      fs.mkdirSync(path.dirname(real), { recursive: true });
      fs.writeFileSync(real, 'x\n');
      fs.symlinkSync(real, path.join(outside, name), 'file');
      return {
        tool_name: 'Edit',
        cwd: shellPath(outside),
        tool_input: { file_path: shellPath(path.join(outside, name)), old_string: 'x', new_string: 'y' },
      };
    };
    // The capture probe, since vendor-guard reads the path as spelled, not where it leads.
    const loader = mkCaptureKit();
    const inOpted = probeInput(loader, outside, linkFile(opted, 'settings'));
    assert(inOpted.ran, `an Edit to a file linked into an opted-in repo must run the hook: ${said(inOpted.out)}`);
    const inNot = probeInput(loader, outside, linkFile(not, 'other'));
    assert(!inNot.ran, `an Edit to a file linked into a repo not opted in must stand down: ${said(inNot.out)}`);
  });

  await test('gh --repo is judged by the named repo, found through the roster', () => {
    const { cwd, home } = rosterWorld();
    const loader = mkCaptureKit();
    assertRuns(loader, cwd, 'gh issue edit 3 --repo acme/tools --body x', home);
    assertRuns(loader, cwd, 'gh issue edit 3 -R acme/tools --body x', home);
    assertStands(loader, cwd, 'gh issue edit 3 --repo acme/other --body x', home);
  });

  await test('a --repo or -R inside quoted text names no repo; an issue URL does', () => {
    const { cwd, env, home } = rosterWorld();
    const message = runIn('safety:commit-language',
      bash(cwd, 'git commit -m "kill the watcher before gh --repo acme/x runs"'), cwd, env);
    assertEq(message.code, 2, `a commit message naming gh --repo still blocks: ${said(message)}`);
    const loader = mkCaptureKit();
    // The cwd is opted in, so a body that only mentions -R is judged by the cwd and runs.
    assertRuns(loader, cwd, 'gh issue edit 3 --body "run grep -R foo/bar, then token x"', home);
    const url = (slug) => `gh issue edit https://github.com/${slug}/issues/3 --add-label x`;
    assertRuns(loader, cwd, url('acme/tools'), home);
    assertStands(loader, cwd, url('acme/other'), home);
  });

  await test('issue-guard runs everywhere, like the setup reminder: a secret bound for an unrostered repo still bounces', () => {
    const { cwd, env } = rosterWorld();
    const foreign = runIn('safety:issue-guard', ghEdit(cwd, '--repo', 'acme/other'), cwd, env);
    assertEq(foreign.code, 2, `a token in a write to a repo off the roster must block: ${said(foreign)}`);
  });

  await test('outside any git repo: reload-guard and the setup reminder fire, nothing else', () => {
    const cwd = mkTmp('loader-norepo-');
    const tmp = mkTmp('loader-norepo-tmp-');
    const root = mkReloadRoot();
    const env = homeEnv(mkTmp('loader-norepo-home-'), {
      PATH: joinPath(basePathWithout(mkTmp('loader-nogh-'), 'gh'), NODE_DIR),
      TMPDIR: shellPath(tmp),
      WORKFLOW_DIR: shellPath(path.join(KIT, 'workflow')),
      WORKFLOW_HOME: shellPath(path.join(mkTmp('loader-wfhome-'), 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('loader-claude-'), 'claude-home')),
      WORKFLOW_STANDARDS_CACHE: shellPath(mkTmp('loader-cache-')),
      RELOAD_GUARD_ROOT: shellPath(root),
      MANAGER_USER_SETTINGS: shellPath(path.join(tmp, 'no-user-settings.json')),
      MANAGER_DEBUG: '',
    });
    const start = { hook_event_name: 'SessionStart', cwd: shellPath(cwd), session_id: 's1', source: 'startup' };
    const setup = runIn('workflow:standards', start, cwd, env);
    assert(setup.stdout.includes('workkit.sh setup'), `the setup reminder still fires: ${said(setup)}`);
    runIn('workflow:reload-guard', start, cwd, env);
    fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{ "hooks": { "Stop": [] } }\n');
    const prompt = { hook_event_name: 'UserPromptSubmit', cwd: shellPath(cwd), session_id: 's1', prompt: 'hi' };
    const reload = runIn('workflow:reload-guard', prompt, cwd, env);
    assert(reload.stdout.includes('/reload-plugins'), `the restart notice still fires: ${said(reload)}`);
    const others = [
      ...HOOKS.map((hook) => [hook.name, hook.input(cwd)]),
      ['safety:vendor-guard', editVendored(cwd, cwd)],
    ];
    for (const [name, input] of others) assertSilent(runIn(name, input, cwd, env), `${name} outside any repo`);
    const secret = runIn('safety:issue-guard', ghEdit(cwd, '--repo', 'acme/tools'), cwd, env);
    assertEq(secret.code, 2, `issue-guard still bounces a token from outside any repo: ${said(secret)}`);
  });

  await test('the hook reads its input byte for byte: CRLF, a multi-line prompt, a trailing newline', () => {
    const loader = mkCaptureKit();
    const w = mkWorld();
    const capture = path.join(w.tmp, 'captured');
    const input = Buffer.from(`${[
      '{',
      '  "hook_event_name": "UserPromptSubmit",',
      `  "cwd": ${JSON.stringify(shellPath(w.repo))},`,
      '  "session_id": "s1",',
      '  "prompt": "first line\\nsecond line\\r\\n\\n  indented third\\t"',
      '}',
    ].join('\r\n')}\n`);
    const res = spawnSync(BASH, [...NO_RC, shellPath(loader), 'fixture:capture'], {
      input, cwd: w.repo, env: envOf(w, { CAPTURE_FILE: shellPath(capture) }), timeout: 30000,
    });
    assertEq(res.status, 0, `the capture hook exits 0: ${res.stderr}`);
    assert(fs.existsSync(capture), `the hook ran and wrote its stdin: ${res.stderr}`);
    const got = fs.readFileSync(capture);
    const shown = (buf) => JSON.stringify(buf.toString());
    assert(got.equals(input), `the bytes match: sent ${shown(input)}, got ${shown(got)}`);
  });

  group('loader: a Bash command that changes folder');

  // Each world's `dir` holds its `repo` and is in no repo itself.
  const loader = mkCaptureKit();
  const opted = mkWorld();
  opted.write('sub/keep.txt', 'x\n');
  const not = mkWorld('none');
  const nowhere = mkTmp('loader-cd-norepo-');

  await test('cd into an opted-in repo from no repo runs the hook', () => {
    assertRuns(loader, nowhere, `cd ${shellPath(opted.repo)} && git status`);
  });

  await test('cd into a repo not opted in from no repo stands down', () => {
    assertStands(loader, nowhere, `cd ${shellPath(not.repo)} && ls`);
  });

  await test('cd into an opted-in repo from a repo not opted in runs the hook', () => {
    assertRuns(loader, not.repo, `cd ${shellPath(opted.repo)}; ls`);
  });

  await test('a relative cd resolves from the cwd', () => {
    assertRuns(loader, opted.dir, 'cd repo/sub && ls');
  });

  await test('a second cd resolves from where the first landed', () => {
    assertRuns(loader, opted.dir, 'cd repo && cd sub && ls');
    // From `not.dir` a plain `cd repo` would land in the repo not opted in.
    assertRuns(loader, not.dir, `cd ${shellPath(opted.dir)} && cd repo && ls`);
  });

  await test('a cd inside a subshell does not move the steps after it', () => {
    // Were the subshell's cd kept, `cd repo` would land in the repo not opted in.
    assertRuns(loader, opted.dir, `(cd ${shellPath(not.dir)}) ; cd repo && ls`);
    assertStands(loader, nowhere, `(cd ${shellPath(not.repo)}) && ls`);
  });

  await test('a cd the loader cannot follow runs the hook', () => {
    for (const command of ['cd "$X" && ls', 'cd ~/x && ls', 'pushd /tmp && ls', 'cd -P /tmp && ls', 'env cd /tmp']) {
      assertRuns(loader, nowhere, command);
    }
  });

  await test('a cd in a heredoc body or a quoted string is not a step', () => {
    assertStands(loader, nowhere, `cat > f <<EOF\ncd ${shellPath(opted.repo)}\nEOF`);
    assertStands(loader, nowhere, `echo "cd ${shellPath(opted.repo)}"`);
  });

  await test('an opted-in cwd still runs the hook after a cd out of it', () => {
    assertRuns(loader, opted.repo, 'cd /tmp && ls');
  });

  await test('commit-gate bounces a cd into an opted-in repo then a commit, from no repo', () => {
    const w = mkWorld();
    HOOKS.find((hook) => hook.name === 'safety:commit-gate').prep(w);
    const out = runIn('safety:commit-gate', bash(nowhere, `cd ${shellPath(w.repo)} && git commit -m x`), nowhere, envOf(w));
    assertEq(out.code, 2, `the gate must bounce, not stand down: ${said(out)}`);
    assert(out.stderr.includes('commit-gate'), `the bounce is the gate's own: ${said(out)}`);
  });

  await test('a command with no cd is judged by the cwd alone', () => {
    assertStands(loader, nowhere, 'ls');
    assertRuns(loader, opted.repo, 'ls');
  });

  group('loader: a Bash command that moves its target without a plain cd');

  await test('git -C, GIT_DIR, --git-dir, bash -c and eval aimed at an opted-in repo run the hook, from no repo', () => {
    const repo = shellPath(opted.repo);
    for (const command of [
      `git -C ${repo} commit -m x`,
      `GIT_DIR=${repo}/.git git commit -m x`,
      `git --git-dir=${repo}/.git --work-tree=${repo} commit -m x`,
      `bash -c 'cd ${repo} && git commit -m x'`,
      `eval 'cd ${repo} && git commit -m x'`,
    ]) assertRuns(loader, nowhere, command);
  });

  await test('a backtick substitution, CDPATH and a quoted cd word run the hook, from no repo', () => {
    const repo = shellPath(opted.repo);
    for (const command of [
      `x=\`cd ${repo} && git status\``,
      `CDPATH=${shellPath(opted.dir)} cd repo && ls`,
      `"cd" ${repo} && ls`,
    ]) assertRuns(loader, nowhere, command);
  });

  await test('a --repo off the roster decides only a command made of gh steps alone', () => {
    // The probe's home has no roster, so acme/nothere is off it.
    assertStands(loader, opted.repo, 'gh pr create --repo acme/nothere --fill');
    assertRuns(loader, opted.repo, 'git commit -m x && gh pr create --repo acme/nothere --fill');
  });

  await test('commit-gate bounces a git -C into an opted-in repo, from no repo', () => {
    const w = mkWorld();
    HOOKS.find((hook) => hook.name === 'safety:commit-gate').prep(w);
    const out = runIn('safety:commit-gate', bash(nowhere, `git -C ${shellPath(w.repo)} commit -m x`), nowhere, envOf(w));
    assertEq(out.code, 2, `the gate must bounce, not stand down: ${said(out)}`);
    assert(out.stderr.includes('commit-gate'), `the bounce is the gate's own: ${said(out)}`);
  });

  await test('a "cd" inside a word is no cd: a hash and a path still stand down', () => {
    assertStands(loader, nowhere, 'git log 3acd12f && ls /x/abcd');
  });

  group('loader: a gh command naming more than one repo');

  // A roster listing one opted-in repo, acme/tools; acme/other is off it.
  const tools = mkWorld();
  tools.git('remote', 'set-url', 'origin', 'https://example.invalid/acme/tools.git');
  const roster = mkRosterHome([[tools.repo, 'enabled']]);
  const OFF = 'gh issue view 1 --repo acme/other';
  const ON = 'gh issue edit 5 --repo acme/tools --add-label status:qa';

  await test('an off-roster repo then a rostered opted-in one runs the hook, from no repo and from an opted-in repo', () => {
    assertRuns(loader, nowhere, ON, roster);
    for (const cwd of [nowhere, tools.repo]) assertRuns(loader, cwd, `${OFF}; ${ON}`, roster);
  });

  await test('a rostered opted-in repo then an off-roster one runs the hook, from no repo and from an opted-in repo', () => {
    for (const cwd of [nowhere, tools.repo]) assertRuns(loader, cwd, `${ON}; ${OFF}`, roster);
  });

  await test('a --repo whose value cannot be read runs the hook, from no repo', () => {
    assertRuns(loader, nowhere, 'gh issue edit 5 --repo "$R" --add-label status:qa', roster);
  });

  await test('a gh clause naming no repo brings the cwd in: runs from an opted-in repo, stands down from no repo', () => {
    const here = `${OFF}; gh issue edit 5 --add-label status:qa`;
    assertRuns(loader, tools.repo, here, roster);
    assertStands(loader, nowhere, here, roster);
  });

  await test('a gh repo value that cannot be read in a mixed command runs the hook, from no repo', () => {
    assertRuns(loader, nowhere, 'ls && gh issue edit 5 --repo "$R"', roster);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
