// The shell-and-JavaScript twins that keep shell consumers, each held to one answer: every fixture goes to the bash
// function (spawned) and to the JavaScript export (required), and the two must agree. Ten rows: the test package,
// the opt-in read, the machine folder, the CHANGELOG test, the hooks log, the slug, the Proof pattern, the lint
// block's sentence, the working-diff reads, the status:building list.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath, stubTool, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mods, runResult } = require('../lib/mods-inputs');
const { recordArgv, readArgv } = require('../lib/argv-log');
const commitGate = require('./commit-gate/helpers');
const { SPAWN_DEADLINE } = require('../lib/process');

const KIT = path.join(__dirname, '..', '..');
const lib = (...parts) => shellPath(path.join(KIT, ...parts));

/**
 * Each fixture through `fn` in one bash that sources `file`: '1' where the
 * function exits 0, '0' where it does not, one per fixture, in order.
 */
const bashAnswers = (file, fn, fixtures) => {
  const script = `. "${file}"\nwhile IFS= read -r p; do if ${fn} "$p"; then echo 1; else echo 0; fi; done <<<"$FIXTURES"`;
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), FIXTURES: fixtures.join('\n') },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  const answers = (res.stdout || '').split('\n').filter(Boolean);
  assertEq(answers.length, fixtures.length, `one answer per fixture from ${fn}, stderr: ${res.stderr}`);
  return answers.map((a) => a === '1');
};

/**
 * Each fixture through `fn` in one bash that sources `file`: what the function
 * printed, one string per fixture, in order, '' where it printed nothing.
 */
const bashLines = (file, fn, fixtures, env = {}) => {
  const script = `. "${file}"\nwhile IFS= read -r p; do printf '%s\\n' "$(${fn} "$p")"; done <<<"$FIXTURES"`;
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', script], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), FIXTURES: fixtures.join('\n'), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  const lines = (res.stdout || '').replace(/\r/g, '').split('\n').slice(0, -1);
  assertEq(lines.length, fixtures.length, `one line per fixture from ${fn}, stderr: ${res.stderr}`);
  return lines;
};

/** Asserts bash and JavaScript gave every fixture the same answer, naming each that differs. */
const agree = (fixtures, shell, js, what) => {
  const differ = fixtures.flatMap((f, i) => (shell[i] === js(f) ? [] : [`${JSON.stringify(f)}: bash ${shell[i]}`]));
  assertEq(differ.join('; '), '', `${what}: the fixtures bash and JavaScript answer differently`);
};

const CHANGELOGS = [
  'CHANGELOG.md', 'docs/CHANGELOG.md', '/abs/repo/CHANGELOG.md', 'packages/a/CHANGELOG.md',
  'CHANGELOG.md.bak', 'xCHANGELOG.md', 'changelog.md', 'CHANGELOG', 'CHANGELOG.md/x', 'docs/OLD-CHANGELOG.md',
];

// A repo's settings text; null writes no file.
const SETTINGS = [
  null, '', '{}', '{ "version": 1 }\n', '{ "version": 1, "enabled": true }\n', '{ "version": 1, "enabled": false }\n',
  '{"enabled":false}', '{ "enabled" :\tfalse }', '{ "enabled": "false" }', '{ "enabled": true, "x": { "enabled": false } }',
  '{\n  "version": 1,\n  "enabled": false\n}\n', '{ "enabled":\nfalse }',
];

/** One scratch repo root per settings text, the shell side's input. */
const settingsRoots = (texts) => texts.map((text) => {
  const root = mkTmp('twins-optin-');
  if (text !== null) {
    fs.mkdirSync(path.join(root, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(root, '.workkit', 'settings.json'), text);
  }
  return root;
});

/** The settings text register.js hands settingsOptedIn: the file's text, null when absent or unreadable. */
const readOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

const run = async () => {
  group('twins: the test package, hook_test_package_dir in hooks/lib/paths.sh against testPackageDir in hooks/mods/suite.js');

  await test('hook_test_package_dir and testPackageDir name the same package for every path', async () => {
    const root = mkTmp('twins-pkgdir-');
    for (const d of ['pkg/src/deep', 'pkg/bare/src', 'pkg/empty', 'other', 'node_modules/x']) fs.mkdirSync(path.join(root, d), { recursive: true });
    const tested = JSON.stringify({ scripts: { test: 'node --test' } });
    for (const d of ['', 'pkg', 'node_modules/x']) fs.writeFileSync(path.join(root, d, 'package.json'), tested);
    fs.writeFileSync(path.join(root, 'pkg', 'bare', 'package.json'), '{"name":"bare"}');
    fs.writeFileSync(path.join(root, 'pkg', 'empty', 'package.json'), JSON.stringify({ scripts: { test: '' } }));
    const fixtures = ['pkg/src/deep/a.js', 'pkg/bare/src/a.js', 'pkg/empty/a.js', 'pkg/a.js', 'pkg', 'other/x.js',
      'app.js', 'node_modules/x/index.js', 'pkg/node_modules/y/z.js'];
    const shell = bashLines(lib('hooks', '_lib.sh'), 'hook_test_package_dir "$ROOT"', fixtures, { ROOT: shellPath(root) });
    const { testPackageDir, hasTestScript } = mods('suite');
    const read = (d) => JSON.parse(readOrNull(path.join(root, d, 'package.json')) ?? 'null');
    const js = await Promise.all(fixtures.map((p) => testPackageDir(p, async (d) => hasTestScript(read(d)))));
    const differ = fixtures.flatMap((f, i) => (shell[i] === js[i] ? [] : [`${f}: bash ${JSON.stringify(shell[i])}, js ${JSON.stringify(js[i])}`]));
    assertEq(differ.join('; '), '', 'the paths bash and JavaScript place in different packages');
    assertEq(shell[0], 'pkg', 'and a file under a tested package names it');
    fs.rmSync(root, { recursive: true, force: true });
  });

  group('twins: the opt-in read, wk_settings_declined in workflow/lib/participation.sh against settingsOptedIn in hooks/mods/gate.js');

  const participation = lib('workflow', 'lib', 'participation.sh');
  const fileOf = (root) => path.join(root, '.workkit', 'settings.json');
  // A settings file opts in on the shell side when wk_settings_declined says no.
  const shellOptedIn = (files) => bashAnswers(participation, 'wk_settings_declined', files.map(shellPath)).map((d) => !d);

  await test('wk_settings_declined and settingsOptedIn agree on every settings text', () => {
    const texts = SETTINGS.filter((t) => t !== null);
    const files = settingsRoots(texts).map(fileOf);
    const js = (i) => mods('gate').settingsOptedIn(readOrNull(files[i]));
    agree(texts.map((_, i) => i), shellOptedIn(files), js, 'the settings texts (by index into the non-null SETTINGS)');
    assertEq(mods('gate').settingsOptedIn(null), false, 'and no file at all is out');
    const js0 = (text) => mods('gate').settingsOptedIn(text);
    assertEq(js0('{ "version": 1, "enabled": false }\n'), false, 'and a declined file is out');
    assertEq(js0('{ "version": 1 }\n'), true, 'and a legacy file is in');
  });

  // A file mode is POSIX's: Windows reads a 000 file anyway, and so does root.
  const unreadable = (() => {
    if (IS_WINDOWS) return null;
    const [root] = settingsRoots(['{ "version": 1, "enabled": true }\n']);
    const file = path.join(root, '.workkit', 'settings.json');
    fs.chmodSync(file, 0o000);
    try { fs.readFileSync(file); return null; } catch { return root; }
  })();
  await testUnless(!unreadable, 'this machine reads a mode-000 file (Windows, or root)')(
    'an unreadable settings file reads opted out on both sides', () => {
      const [shell] = shellOptedIn([fileOf(unreadable)]);
      assertEq(shell, false, 'the shell reads an unreadable file as opted out');
      assertEq(mods('gate').settingsOptedIn(readOrNull(fileOf(unreadable))), false,
        'and so does the module');
    });

  group('twins: the machine folder, wk_user_dir against userDir in hooks/mods/log.js and workflow/user-dir.js');

  const { userDir: nodeUserDir } = require(path.join(KIT, 'workflow', 'user-dir.js'));
  // [WORKFLOW_HOME, HOME]; an unset WORKFLOW_HOME is undefined.
  const HOMES = [[undefined, '/w/home'], ['/w/moved', '/w/home'], ['', '/w/home'], ['/w/moved', '/w/other'], [undefined, '/w/a b']];

  await test('wk_user_dir, log.js userDir and user-dir.js userDir agree on every WORKFLOW_HOME and HOME', () => {
    for (const [workflowHome, home] of HOMES) {
      const env = { PATH: SYSTEM_PATH, HOME: home, ...(workflowHome === undefined ? {} : { WORKFLOW_HOME: workflowHome }) };
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_user_dir`], {
        env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const shell = (res.stdout || '').replace(/\r?\n$/, '');
      const label = `WORKFLOW_HOME ${JSON.stringify(workflowHome)}, HOME ${JSON.stringify(home)}`;
      assertEq(mods('log').userDir(workflowHome, home), shell, `${label}: log.js`);
      const saved = process.env.WORKFLOW_HOME;
      if (workflowHome === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = workflowHome;
      try {
        assertEq(nodeUserDir(home).replace(/\\/g, '/'), shell, `${label}: user-dir.js`);
      } finally {
        if (saved === undefined) delete process.env.WORKFLOW_HOME; else process.env.WORKFLOW_HOME = saved;
      }
    }
  });

  await test('log.js userDirOf reads the machine folder from the env: WORKFLOW_HOME, else HOME, else USERPROFILE', () => {
    const { userDirOf } = mods('log');
    assertEq(userDirOf({ WORKFLOW_HOME: '/w/moved', HOME: '/w/home' }), '/w/moved', 'WORKFLOW_HOME set');
    assertEq(userDirOf({ HOME: '/w/home' }), '/w/home/.workkit', 'WORKFLOW_HOME unset');
    assertEq(userDirOf({ WORKFLOW_HOME: '', HOME: '/w/home' }), '/w/home/.workkit', 'an empty WORKFLOW_HOME is none');
    assertEq(userDirOf({ USERPROFILE: 'C:/Users/w' }), 'C:/Users/w/.workkit', 'no HOME: the Windows home');
  });

  group('twins: the CHANGELOG test, wk_is_changelog against isChangelog in hooks/mods/changelog-guard.js');

  await test('wk_is_changelog and isChangelog agree on every fixture', () => {
    const shell = bashAnswers(lib('workflow', 'lib', 'changelog.sh'), 'wk_is_changelog', CHANGELOGS);
    agree(CHANGELOGS, shell, (p) => mods('changelog-guard').isChangelog(p), 'the CHANGELOG test');
  });

  group('twins: the hooks log, wk_hooks_log in workflow/lib/platform.sh against the log hooks/mods/log.js writes');

  // [hook, event, session id, cwd, verdict], the fields of one fire's line.
  const FIRES = [
    ['safety:commit-gate', 'PreToolUse', 's1', '/w/repo', 'run'],
    ['docs:change-tracker', 'Stop', 's"1\\x', 'C:\\Users\\me\\repo', 'stood-down'],
    ['workflow:snapshot', 'PostToolUse', undefined, undefined, 'crashed'],
  ];

  await test('the module writes its log where wk_hooks_log looks, and each line reads back as its six fields', () => {
    const { userDirOf, logLine, appendLog } = mods('log');
    const scratch = mkTmp('twins-log-');
    for (const env of [{ HOME: path.join(scratch, 'home') }, { HOME: path.join(scratch, 'home'), WORKFLOW_HOME: path.join(scratch, 'moved') }]) {
      const iso = '2026-10-21T12:00:00Z';
      const text = appendLog('', FIRES.map(([hook, event, sid, cwd, verdict]) => logLine(iso, hook, event, sid, cwd, verdict)).join(''));
      const file = `${userDirOf(env)}/hooks.log`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const shellEnv = { PATH: SYSTEM_PATH, HOME: shellPath(env.HOME), ...(env.WORKFLOW_HOME ? { WORKFLOW_HOME: shellPath(env.WORKFLOW_HOME) } : {}) };
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'platform.sh')}"; wk_hooks_log; printf '%s\\n' "$WK_HOOKS_LOG"; cat "$WK_HOOKS_LOG"`], {
        env: shellEnv, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const [where, ...rest] = (res.stdout || '').split('\n');
      const label = env.WORKFLOW_HOME ? 'WORKFLOW_HOME set' : 'WORKFLOW_HOME unset';
      assertEq(where, shellPath(file), `${label}: the file wk_hooks_log names, stderr: ${res.stderr}`);
      assertEq(rest.join('\n'), text, `${label}: the shell reads the module's lines back unchanged`);
      const rows = text.split('\n').filter(Boolean).map((l) => l.split('\t'));
      assertEq(JSON.stringify(rows.map((r) => r.length)), JSON.stringify(FIRES.map(() => 6)), `${label}: six fields a line`);
      assertEq(JSON.stringify(rows.map((r) => [r[1], r[5]])), JSON.stringify(FIRES.map((f) => [f[0], f[4]])),
        `${label}: the hook second and the verdict last`);
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  group('twins: the slug, wk_slug_from_remote in workflow/lib/slug.sh against slugFromRemote in workflow/slug.js and hooks/mods/command.js');

  // Remote urls as git stores them; the last four name no repo.
  const REMOTES = [
    'git@github.com:acme/widgets.git', 'https://github.com/acme/widgets.git', 'https://github.com/acme/widgets',
    'ssh://git@github.com/acme/widgets.git', 'https://github.com/acme/widgets/', '  git@github.com:acme/widgets.git  ',
    'C:\\Users\\x\\theirs.git', '/srv/git/acme/widgets.git', 'widgets', 'widgets.git', '', '   ',
  ];

  await test('the three slug readers give every remote the same slug, and no match the same nothing', () => {
    const shell = bashLines(lib('workflow', 'lib', 'slug.sh'), 'wk_slug_from_remote', REMOTES);
    const { slugFromRemote: engine } = require(path.join(KIT, 'workflow', 'slug.js'));
    const { slugFromRemote: module } = mods('command');
    const differ = REMOTES.flatMap((r, i) => {
      const said = [engine(r), module(r)].map((s) => s ?? '');
      return said.every((s) => s === shell[i]) ? [] : [`${JSON.stringify(r)}: bash ${JSON.stringify(shell[i])}, slug.js ${JSON.stringify(said[0])}, command.js ${JSON.stringify(said[1])}`];
    });
    assertEq(differ.join('; '), '', 'the remotes the three readers answer differently');
    assertEq(shell[0], 'acme/widgets', 'an ssh remote names its repo');
    assertEq(shell[1], 'acme/widgets', 'an https remote with .git names its repo');
    assertEq(shell[REMOTES.indexOf('widgets')], '', 'a remote with no match names nothing in bash');
    assertEq(engine('widgets'), module('widgets'), 'and the two JavaScript readers answer no match alike');
  });

  group('twins: the Proof pattern, workflow/ship/ship-items.sh against PROOF_RE in hooks/mods/proof.js');

  // Comment bodies a Proof: read meets; the last five carry no Proof: at a line start.
  const BODIES = [
    'Proof: unit', 'looks good\nProof: unit: node tests/x.test.js', 'notes first\n  \tProof: integration',
    'a\n\nProof:', 'x\r\nProof: after a CRLF', '\tProof:x',
    'proof: unit', 'Proof of concept only', 'the Proof: line is still to come', '', 'Proofs: none',
  ];

  await test("the ship's jq test and PROOF_RE match the same comment bodies", () => {
    const src = fs.readFileSync(path.join(KIT, 'workflow', 'ship', 'ship-items.sh'), 'utf8');
    const found = src.match(/test\("([^"]*Proof:[^"]*)"\)/);
    assert(found, 'ship-items.sh tests each comment against a Proof: pattern');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', 'jq -c "map(test(\\"$PATTERN\\"))"'], {
      env: { PATH: SYSTEM_PATH, PATTERN: found[1] }, input: JSON.stringify(BODIES), encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    assertEq(res.status, 0, `jq ran the ship's pattern, stderr: ${res.stderr}`);
    const shell = JSON.parse(res.stdout);
    agree(BODIES, shell, (b) => mods('proof').PROOF_RE.test(b), 'the Proof pattern');
    assertEq(JSON.stringify(shell.slice(0, 6)), JSON.stringify([true, true, true, true, true, true]), 'a Proof: line at a line start matches');
    assertEq(JSON.stringify(shell.slice(6)), JSON.stringify([false, false, false, false, false]), 'and nothing else does');
  });

  // A PATH world whose `tool` records each argv to a log and prints `out`; the
  // real tools stay reachable behind it.
  const recordingTool = (tool, out = '') => {
    const bin = mkTmp(`twins-${tool}-`);
    const log = path.join(bin, 'argv.log');
    stubTool(bin, tool, ['#!/bin/bash', recordArgv(log), `printf '%s' '${out}'`]);
    return { path: systemPathWith(bin), calls: () => readArgv(log) };
  };

  group('twins: the lint block, wk_changelog_lint in workflow/lib/changelog.sh against lintText in hooks/mods/commit-gate.js');

  // The linter's findings, the same on both sides: a node stub prints them in bash.
  const SAID = 'CHANGELOG.md:7 [word-cap] 62 words (max 50)\nCHANGELOG.md:7 [link] no issue link';

  await test('a failed lint reads the same sentence and findings from the shell and from the gate', async () => {
    const node = mkTmp('twins-node-');
    stubTool(node, 'node', ['#!/bin/bash', `printf '%b\\n' '${SAID.replace(/\n/g, '\\n')}' >&2`, 'exit 1']);
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('workflow', 'lib', 'changelog.sh')}"; wk_changelog_lint /w/repo --staged CHANGELOG.md`], {
      env: { PATH: systemPathWith(node), HOME: shellPath(os.homedir()), WORKFLOW_DIR: lib('workflow') }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    assertEq(res.status, 1, `the shell lint fails, stderr: ${res.stderr}`);
    const r = commitGate.mkRepo();
    commitGate.stage(r, 'CHANGELOG.md', commitGate.CHANGELOG('- An essay entry.'));
    const facts = { ...commitGate.factsOf(r, 'git commit -m "docs: changelog"'), lint: async () => runResult({ exitCode: 1, stderr: `${SAID}\n` }) };
    const deny = commitGate.denyOf(await mods('commit-gate').commitGateVerdict(facts));
    assert(deny !== null && deny.startsWith(commitGate.PREFIX), `the gate blocks on the lint, got: ${deny}`);
    assertEq(deny.slice(commitGate.PREFIX.length), res.stderr.replace(/\n$/, ''), 'the sentence and the findings, byte for byte');
  });

  group('twins: the working diff, hook_working_paths in hooks/lib/tree.sh against the touched list proof-guard reads');

  await test('hook_working_paths and the qa check make the same two git reads', async () => {
    const git = recordingTool('git');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('hooks', 'lib', 'tree.sh')}"; hook_working_paths /w/repo`], {
      env: { PATH: git.path, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    assertEq(res.status, 0, `the shell reads ran, stderr: ${res.stderr}`);
    const shell = git.calls().map((argv) => (argv[0] === '-C' ? argv.slice(2) : argv));
    assertEq(shell.length, 2, `the shell makes two reads, got: ${JSON.stringify(shell)}`);
    const runs = [];
    const view = JSON.stringify({ state: 'OPEN', url: 'https://github.com/o/r/issues/12', labels: [{ name: 'status:building' }], comments: [], body: '' });
    const run = async (argv, init = {}) => {
      runs.push({ argv: [...argv], init });
      return runResult({ stdout: argv[0] === 'gh' ? view : '' });
    };
    await mods('proof-guard').proofGuardGuard({
      command: 'gh issue edit 12 --add-label status:qa --remove-label status:building', cwd: '/w/repo', env: { HOME: '/w/home' },
      originless: async () => false, exists: async () => false, top: async () => '/w/repo', read: async () => null, list: async () => [],
      run, pluginRoot: KIT, stat: async () => null, real: async (p) => p, write: async () => {}, now: () => 0,
    });
    const reads = runs.filter((c) => c.argv[0] === 'git').map((c) => c.argv.slice(1));
    const missing = shell.filter((argv) => !reads.some((a) => JSON.stringify(a) === JSON.stringify(argv)));
    assertEq(missing.map((a) => a.join(' ')).join('; '), '', `the shell reads the module never made, it made: ${JSON.stringify(reads)}`);
  });

  group('twins: the status:building list, hook_issues_building in hooks/lib/snapshot.sh against buildingList in hooks/mods/gh.js');

  await test('hook_issues_building and buildingList ask gh with the same argv, with and without a repo', async () => {
    for (const repo of ['', 'acme/widgets']) {
      const gh = recordingTool('gh', '[]');
      const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${lib('hooks', '_lib.sh')}"; hook_issues_building ${repo}`], {
        env: { PATH: gh.path, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
      });
      const shell = gh.calls();
      assertEq(shell.length, 1, `${repo || 'no repo'}: the shell asks gh once, stderr: ${res.stderr}`);
      const runs = [];
      await mods('gh').buildingList(async (argv) => { runs.push(argv); return runResult({ stdout: '[]' }); }, { repo });
      assertEq(JSON.stringify(runs[0].slice(1)), JSON.stringify(shell[0]), `${repo || 'no repo'}: the same argv`);
    }
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
