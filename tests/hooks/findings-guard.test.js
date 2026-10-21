// Tests for hooks/safety/findings-guard: the PreToolUse (Bash) hook that holds
// findings.file off on the ship path. A `gh issue create` whose title starts
// with "review notes from" bounces unless the setting reads true, the repo's
// .workkit/settings.json over the global one (docs/hooks.md § safety:findings-guard).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../lib/harness');
const { BASH, NO_RC, shellPath, basePathWithout } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'findings-guard', 'run.sh');

const CREATE = 'gh issue create --title "review notes from the 0.19.0 ship" --body "..."';

// One scratch world per case: a home, a WORKFLOW_HOME and a git working folder,
// each settings file written only when the case gives it a body. The ceiling
// above the working folder keeps the real repo from ever answering.
const world = ({ global, repo }) => {
  const dir = mkTmp('findings-guard-');
  const home = path.join(dir, 'home');
  const workflowHome = path.join(dir, 'workflow-home');
  const cwd = path.join(dir, 'work');
  for (const d of [home, workflowHome, cwd]) fs.mkdirSync(d, { recursive: true });
  if (global !== undefined) fs.writeFileSync(path.join(workflowHome, 'settings.json'), JSON.stringify(global));
  if (repo !== undefined) {
    fs.mkdirSync(path.join(cwd, W), { recursive: true });
    fs.writeFileSync(path.join(cwd, W, 'settings.json'), JSON.stringify(repo));
  }
  spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
  return { dir, home, workflowHome, cwd };
};

const runHook = (w, command, env = {}) => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd: shellPath(w.cwd), tool_input: { command } });
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input,
    env: {
      ...process.env,
      HOME: shellPath(w.home),
      WORKFLOW_HOME: shellPath(w.workflowHome),
      GIT_CEILING_DIRECTORIES: shellPath(w.dir),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const assertBounce = ({ code, stderr }, what) => {
  assertEq(code, 2, `${what} must bounce, stderr: ${stderr}`);
  assert(stderr.startsWith('findings-guard: BLOCKED'), `stderr opens with the prefix, got: ${stderr}`);
};

const assertPass = ({ code, stderr }, what) => {
  assertEq(code, 0, `${what} must pass, stderr: ${stderr}`);
  assertEq(stderr, '', `${what} passes with nothing on stderr`);
};

const NO_KEY = { global: { version: 1 }, repo: { version: 1, enabled: true } };

const run = async () => {
  group('findings-guard: a review-notes create while findings.file is off');

  await test('no findings.file key in either file: the create bounces, naming the chat route and the toggle', () => {
    const out = runHook(world(NO_KEY), CREATE);
    assertBounce(out, 'the review-notes create');
    assert(out.stderr.includes('🧭 Findings'), 'names the Findings section as the route');
    assert(out.stderr.includes('chat'), 'names chat as the route');
    assert(out.stderr.includes('file or drop'), 'names the owner\'s answer, file or drop');
    assert(out.stderr.includes('findings.file: true'), 'names the toggle that turns filing on');
  });

  await test('findings.file false in the global file: the same create bounces', () => {
    assertBounce(runHook(world({ global: { findings: { file: false } } }), CREATE), 'a create under a global false');
  });

  await test('findings.file true in the global file and no repo key: it passes', () => {
    const w = world({ global: { findings: { file: true } }, repo: { version: 1, enabled: true } });
    assertPass(runHook(w, CREATE), 'a create under a global true');
  });

  await test('true globally and false in the repo file bounces; false globally and true in the repo file passes', () => {
    // A literal false in the repo file is a value, never absent: the global
    // true behind it must not turn filing back on.
    const repoOff = world({
      global: { findings: { file: true } },
      repo: { version: 1, enabled: true, findings: { file: false } },
    });
    assertBounce(runHook(repoOff, CREATE), 'a create under a repo false');
    const repoOn = world({
      global: { findings: { file: false } },
      repo: { version: 1, enabled: true, findings: { file: true } },
    });
    assertPass(runHook(repoOn, CREATE), 'a create under a repo true');
  });

  await test('the title through -t in single quotes or --title= bounces, letter case ignored', () => {
    const w = world(NO_KEY);
    assertBounce(runHook(w, "gh issue create -t 'Review notes from the 0.19.0 ship' --body \"...\""), 'the -t form');
    assertBounce(runHook(w, 'gh issue create --title="review notes from the 0.19.0 ship" --body "..."'), 'the --title= form');
  });

  await test('a redirect written before the title bounces too: the & of 2>&1 never splits the clause', () => {
    const w = world(NO_KEY);
    assertBounce(runHook(w, 'gh issue create --repo a/b 2>&1 --title "review notes from the 0.19.0 ship"'), 'a 2>&1 before --title');
    assertBounce(runHook(w, 'gh issue create &>/dev/null --title "review notes from the 0.19.0 ship"'), 'an &> before --title');
  });

  group('findings-guard: everything else passes');

  await test('another title, a comment carrying the phrase, or the phrase past the title\'s start: each passes', () => {
    const w = world(NO_KEY);
    assertPass(runHook(w, 'gh issue create --title "feat: a title" --body "..."'), 'a create with another title');
    assertPass(runHook(w, 'gh issue comment 5 --body "review notes from x"'), 'a comment carrying the phrase');
    assertPass(runHook(w, 'gh issue create --title "fix: review notes from the 0.19.0 ship" --body "..."'),
      'a create whose title holds the phrase past its start');
  });

  await test('no jq on PATH: the review-notes create passes with exit 0', () => {
    const w = world(NO_KEY);
    const noJq = basePathWithout(w.dir, 'jq');
    assertEq(runHook(w, CREATE, { PATH: noJq }).code, 0, 'a missing jq fails open, as the siblings do');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
