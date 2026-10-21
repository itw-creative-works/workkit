// Tests for hook_setting_get <jq path> <cwd> (hooks/lib/settings.sh, sourced by
// hooks/_lib.sh): the layered one-key reader. The settings.json of the repo
// holding <cwd> wins when it has the key, else the global file under
// WORKFLOW_HOME, else nothing; a literal false is a value. Then the two
// findings.file helpers read through it, hook_findings_on and hook_findings_route.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, selfRun, summary, WORKKIT_DIR: W,
} = require('../lib/harness');
const { shellPath } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { runLib } = require('../lib/hook-lib');

// One scratch world per case: a home, a WORKFLOW_HOME and a working folder,
// each settings file written only when the case gives it a body. The real
// ~/.workkit is never part of an answer.
const world = ({ global, repo, git = true }) => {
  const dir = mkTmp('settings-reader-');
  const home = path.join(dir, 'home');
  const workflowHome = path.join(dir, 'workflow-home');
  const cwd = path.join(dir, 'work');
  for (const d of [home, workflowHome, cwd]) fs.mkdirSync(d, { recursive: true });
  if (global !== undefined) fs.writeFileSync(path.join(workflowHome, 'settings.json'), JSON.stringify(global));
  if (repo !== undefined) {
    fs.mkdirSync(path.join(cwd, W), { recursive: true });
    fs.writeFileSync(path.join(cwd, W, 'settings.json'), JSON.stringify(repo));
  }
  if (git) spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
  return { home, workflowHome, cwd };
};

// The reader's answer as a caller takes it, through a command substitution,
// handed the world's working folder as its cwd and asked from somewhere else.
// Empty stderr in every case: a missing reader also prints nothing to stdout.
const ask = (w, key = '.findings.file') => askSnippet(w, `printf '%s' "$(hook_setting_get '${key}' "$ASK_CWD")"`);

// Any snippet run in the world the same way, $ASK_CWD its working folder.
const askSnippet = ({ home, workflowHome, cwd }, snippet) => {
  const out = runLib(`cd "${shellPath(home)}" || exit 9\n${snippet}`, {
    HOME: shellPath(home),
    WORKFLOW_HOME: shellPath(workflowHome),
    GIT_CEILING_DIRECTORIES: shellPath(path.dirname(cwd)),
    ASK_CWD: shellPath(cwd),
  });
  assertEq(out.code, 0, `the reader runs clean, stderr: ${out.stderr}`);
  assertEq(out.stderr, '', 'the reader says nothing on stderr');
  return out.stdout;
};

const run = async () => {
  group('hook_setting_get: the repo file over the global file');

  await test('no key in either file: prints nothing', () => {
    const w = world({ global: { version: 1 }, repo: { version: 1, enabled: true } });
    assertEq(ask(w), '', 'an absent key is no answer');
  });

  await test('true in the global file and no repo key: prints true', () => {
    const w = world({ global: { findings: { file: true } }, repo: { version: 1, enabled: true } });
    assertEq(ask(w), 'true', 'the global file answers');
  });

  await test('false globally and true in the repo file: prints true', () => {
    const w = world({ global: { findings: { file: false } }, repo: { version: 1, enabled: true, findings: { file: true } } });
    assertEq(ask(w), 'true', 'the repo file wins');
  });

  await test('true globally and false in the repo file: prints false', () => {
    // A literal false is a value, never "absent": falling through to the
    // global file here would turn the repo's override off.
    const w = world({ global: { findings: { file: true } }, repo: { version: 1, enabled: true, findings: { file: false } } });
    assertEq(ask(w), 'false', 'the repo file wins with false');
  });

  await test('outside any git repo: the global file alone', () => {
    // The working folder carries a settings file of its own, so a reader that
    // took it as the repo layer would print false.
    const w = world({ global: { findings: { file: true } }, repo: { findings: { file: false } }, git: false });
    assertEq(ask(w), 'true', 'a folder that is no repo is no repo layer');
  });

  group('hook_findings_on and hook_findings_route: the findings.file helpers');

  await test('hook_findings_on: true only when the setting reads true', () => {
    const on = 'if hook_findings_on "$ASK_CWD"; then printf on; else printf off; fi';
    assertEq(askSnippet(world({ global: { findings: { file: true } } }), on), 'on', 'true reads on');
    assertEq(askSnippet(world({ global: { findings: { file: false } } }), on), 'off', 'false reads off');
    assertEq(askSnippet(world({ global: { version: 1 } }), on), 'off', 'an absent key reads off');
  });

  await test('hook_findings_route: off and absent both print the chat route', () => {
    const route = 'printf \'%s\' "$(hook_findings_route "$ASK_CWD")"';
    for (const global of [{ findings: { file: false } }, { version: 1 }]) {
      const said = askSnippet(world({ global }), route);
      assert(said.includes('chat under 🧭 Findings') && said.includes('file or drop'), `the chat route, got: ${said}`);
      assert(!said.includes('status:inbox'), `files nothing, got: ${said}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
