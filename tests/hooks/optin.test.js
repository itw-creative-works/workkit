// Tests for the Bash gate's logic, optinRepo({ command, cwd, roster, toplevel,
// settingsOf }) in hooks/mods/optin.js: which repo a Bash command acts on and
// whether it opted in, the port of hook_optin_repo. Each case ports the
// loader.test.js case its name quotes. Not here: the Edit and link cases (no
// command, the classic.PreToolUse gate), issue-guard running everywhere (the
// chain's exempt list), the hooks-log and HOOK_DISABLE cases, and every case
// whose --repo names a ROSTERED repo, since finding that repo's folder reads
// its origin: those run in tests/mods/guards-commit-language.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

// Each world folder holds its `repo` and is in no repo itself; `/w/nowhere`
// and `/tmp` are in none at all.
const NOWHERE = '/w/nowhere';
const OPTED = { dir: '/w/o', repo: '/w/o/repo' };
const NOT = { dir: '/w/n', repo: '/w/n/repo' };
// Each repo's .workkit/settings.json as text, the form the gate reads.
const SETTINGS = {
  enabled: '{ "version": 1, "enabled": true }\n',
  declined: '{ "version": 1, "enabled": false }\n',
  legacy: '{ "version": 1 }\n',
};
const REPOS = { [OPTED.repo]: SETTINGS.enabled, [NOT.repo]: null };

const toplevelIn = (repos) => async (dir) => Object.keys(repos)
  .filter((root) => dir === root || dir.startsWith(`${root}/`))
  .sort((a, b) => b.length - a.length)[0] ?? null;

// The roster is the parsed ~/.workkit/.repos.json, null when the machine has
// none: every repo these cases name by --repo is off it. settingsOf answers a
// root's settings text, null for no file.
const ask = (command, cwd, { repos = REPOS, roster = null } = {}) => mods('optin').optinRepo({
  command, cwd, roster, toplevel: toplevelIn(repos), settingsOf: async (root) => repos[root] ?? null,
});

const runs = async (command, cwd, opts) => {
  assertEq((await ask(command, cwd, opts)).opted, true, `${JSON.stringify(command)} from ${cwd} must run the hook`);
};

const stands = async (command, cwd, opts) => {
  assertEq((await ask(command, cwd, opts)).opted, false, `${JSON.stringify(command)} from ${cwd} must stand the hook down`);
};

const run = async () => {
  group('optin: a repo that has not opted in');

  await test('ports "no settings file: commit-gate, suite-guard and docs:change-tracker step aside"', async () => {
    for (const [answer, settings, opted] of [['enabled', SETTINGS.enabled, true], ['none', null, false]]) {
      const r = await ask('git status', '/w/r', { repos: { '/w/r': settings } });
      assertEq(r.opted, opted, `a repo answering ${answer}`);
      assertEq(r.root, '/w/r', `the root it judged, answering ${answer}`);
    }
  });

  await test('ports ""enabled": false steps aside; a file with no enabled key runs"', async () => {
    for (const [answer, settings, opted] of [['declined', SETTINGS.declined, false], ['legacy', SETTINGS.legacy, true]]) {
      const r = await ask('git status', '/w/r', { repos: { '/w/r': settings } });
      assertEq(r.opted, opted, `a repo answering ${answer}`);
      assertEq(r.root, '/w/r', `the root it judged, answering ${answer}`);
    }
  });

  await test('ports "a --repo or -R inside quoted text names no repo; an issue URL does": the off-roster half', async () => {
    await runs('git commit -m "kill the watcher before gh --repo acme/x runs"', OPTED.repo);
    await runs('gh issue edit 3 --body "run grep -R foo/bar, then token x"', OPTED.repo);
    await stands('gh issue edit https://github.com/acme/other/issues/3 --add-label x', OPTED.repo, { roster: { version: 1, repos: {} } });
  });

  await test('ports "outside any git repo: issue-guard fires, nothing else": the gate says no', async () => {
    for (const command of ['git commit -m "feat: add x"', 'npm test']) await stands(command, NOWHERE);
  });

  group('optin: a Bash command that changes folder');

  await test('ports "cd into an opted-in repo from no repo runs the hook"', async () => {
    await runs(`cd ${OPTED.repo} && git status`, NOWHERE);
  });

  await test('ports "cd into a repo not opted in from no repo stands down"', async () => {
    await stands(`cd ${NOT.repo} && ls`, NOWHERE);
  });

  await test('ports "cd into an opted-in repo from a repo not opted in runs the hook"', async () => {
    await runs(`cd ${OPTED.repo}; ls`, NOT.repo);
  });

  await test('ports "a second cd resolves from where the first landed"', async () => {
    await runs('cd repo && cd sub && ls', OPTED.dir);
    await runs(`cd ${OPTED.dir} && cd repo && ls`, NOT.dir);
  });

  await test('ports "a cd inside a subshell does not move the steps after it"', async () => {
    await runs(`(cd ${NOT.dir}) ; cd repo && ls`, OPTED.dir);
    await stands(`(cd ${NOT.repo}) && ls`, NOWHERE);
  });

  await test('ports "a cd the loader cannot follow runs the hook"', async () => {
    for (const command of ['cd "$X" && ls', 'cd ~/x && ls', 'pushd /tmp && ls', 'cd -P /tmp && ls', 'env cd /tmp']) {
      await runs(command, NOWHERE);
    }
  });

  await test('ports "a cd in a heredoc body or a quoted string is not a step"', async () => {
    await stands(`cat > f <<EOF\ncd ${OPTED.repo}\nEOF`, NOWHERE);
    await stands(`echo "cd ${OPTED.repo}"`, NOWHERE);
  });

  await test('ports "an opted-in cwd still runs the hook after a cd out of it"', async () => {
    await runs('cd /tmp && ls', OPTED.repo);
  });

  await test('ports "a command with no cd is judged by the cwd alone"', async () => {
    await stands('ls', NOWHERE);
    const r = await ask('ls', OPTED.repo);
    assertEq(r.opted, true, 'ls in the opted-in repo runs the hook');
    assertEq(r.root, OPTED.repo, 'judged by the repo holding the cwd');
  });

  group('optin: a Bash command that moves its target without a plain cd');

  await test('ports "git -C, GIT_DIR, --git-dir, bash -c and eval aimed at an opted-in repo run the hook, from no repo"', async () => {
    const repo = OPTED.repo;
    for (const command of [
      `git -C ${repo} commit -m x`,
      `GIT_DIR=${repo}/.git git commit -m x`,
      `git --git-dir=${repo}/.git --work-tree=${repo} commit -m x`,
      `bash -c 'cd ${repo} && git commit -m x'`,
      `eval 'cd ${repo} && git commit -m x'`,
    ]) await runs(command, NOWHERE);
  });

  await test('ports "a backtick substitution, CDPATH and a quoted cd word run the hook, from no repo"', async () => {
    for (const command of [
      `x=\`cd ${OPTED.repo} && git status\``,
      `CDPATH=${OPTED.dir} cd repo && ls`,
      `"cd" ${OPTED.repo} && ls`,
    ]) await runs(command, NOWHERE);
  });

  await test('ports "a --repo off the roster decides only a command made of gh steps alone"', async () => {
    await stands('gh pr create --repo acme/nothere --fill', OPTED.repo);
    await runs('git commit -m x && gh pr create --repo acme/nothere --fill', OPTED.repo);
  });

  await test('ports "a "cd" inside a word is no cd: a hash and a path still stand down"', async () => {
    await stands('git log 3acd12f && ls /x/abcd', NOWHERE);
  });

  group('optin: a gh command naming more than one repo');

  const OFF = 'gh issue view 1 --repo acme/other';

  await test('ports "a --repo whose value cannot be read runs the hook, from no repo"', async () => {
    await runs('gh issue edit 5 --repo "$R" --add-label status:qa', NOWHERE);
  });

  await test('ports "a gh clause naming no repo brings the cwd in: runs from an opted-in repo, stands down from no repo"', async () => {
    const here = `${OFF}; gh issue edit 5 --add-label status:qa`;
    await runs(here, OPTED.repo);
    await stands(here, NOWHERE);
  });

  await test('ports "a gh repo value that cannot be read in a mixed command runs the hook, from no repo"', async () => {
    await runs('ls && gh issue edit 5 --repo "$R"', NOWHERE);
  });

  group('optin.js: rosterOf, the one roster read');

  await test('rosterOf parses the machine folder\'s .repos.json, WORKFLOW_HOME moving it, null when absent or broken', async () => {
    const { rosterOf } = mods('optin');
    const roster = { repos: { '/w/o/repo': 'enabled' } };
    const files = { '/w/home/.workkit/.repos.json': JSON.stringify(roster), '/w/moved/.repos.json': '{ "repos": ' };
    const read = async (p) => files[p] ?? null;
    assertEq(JSON.stringify(await rosterOf({ HOME: '/w/home' }, read)), JSON.stringify(roster), 'the roster under HOME');
    assertEq(await rosterOf({ HOME: '/w/home', WORKFLOW_HOME: '/w/moved' }, read), null, 'WORKFLOW_HOME moves it, and a broken file is null');
    assertEq(await rosterOf({ HOME: '/w/empty' }, read), null, 'no roster is null');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
