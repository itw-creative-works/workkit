// Tests for standards.sh: participation, the four states and where each lives.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, WORKKIT_DIR: W, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_BASH, NO_RC, gitPath, shellPath, samePath,
} = require('../../lib/platform');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const {
  WORKFLOW_DIR, cleanup, rosterOf, makeRepo, binDirWithout, runScript,
} = require('./helpers');
const { settingsAt } = require('../../../workflow/lib/settings');

describe('standards.sh: participation', () => {
  // Four states, two files. A yes (or a deliberate project-level no) is the
  // repo's committed settings.json; never-asked and declined are personal and
  // live in the user file, so a teammate never reads one developer's hesitation
  // as the project's decision.
  const stateOf = (repo, opts) => runScript(repo, { ...opts, args: ['--state'] }).stdout.trim();

  // Nothing at all may land in a repo that has not said yes.
  const assertUntouched = (repo) => {
    expect(!fs.existsSync(path.join(repo, '.github')), 'no issue templates written').toBeTruthy();
    expect(!fs.existsSync(path.join(repo, '.gitignore')), 'no .gitignore written').toBeTruthy();
    expect(!fs.existsSync(path.join(repo, W)), `no ${W} directory written`).toBeTruthy();
  };

  test('enabled: true heals the repo', () => {
    const repo = makeRepo();
    const { code, output: stdout } = runScript(repo);
    expect(code, 'exit 0').toBe(0);
    expect(stateOf(repo), 'state').toBe('enabled');
    expect(stdout.includes('issue forms'), `heals, got: ${stdout}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates installed').toBeTruthy();
    cleanup(repo);
  });

  test('a file with no enabled answer offers to enable and heals nothing', () => {
    for (const [what, settings] of [['an empty file', ''], ['an empty object', '{}\n'], ['a version alone', '{ "version": 1 }\n']]) {
      const repo = makeRepo({ settings });
      const { code, output } = runScript(repo);
      expect(code, `${what}: exit 0`).toBe(0);
      expect(stateOf(repo), `${what}: state`).toBe('undecided');
      expect(output.includes('not in the issue workflow'), `${what}: offers, got: ${output}`).toBeTruthy();
      expect(output.includes('--enable'), `${what}: and says how to opt in`).toBeTruthy();
      expect(!output.includes('issue forms'), `${what}: heals nothing, got: ${output}`).toBeTruthy();
      expect(!fs.existsSync(path.join(repo, '.github')), `${what}: no issue templates written`).toBeTruthy();
      cleanup(repo);
    }
  });

  test('a file with no enabled answer, declined on this machine: silent, untouched', () => {
    const repo = makeRepo({ settings: '{ "version": 1 }\n' });
    const home = mkTmp('wf-std-');
    fs.writeFileSync(path.join(home, '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [gitPath(fs.realpathSync(repo))]: 'declined' },
    }, null, 2));
    expect(stateOf(repo, { workflowHome: home }), 'state').toBe('declined');
    const { code, output: stdout } = runScript(repo, { workflowHome: home });
    expect(code, 'exit 0').toBe(0);
    expect(stdout, `never asks, got: ${stdout}`).toBe('');
    expect(!fs.existsSync(path.join(repo, '.github')), 'no issue templates written').toBeTruthy();
    cleanup(repo); cleanup(home);
  });

  test('enabled: false heals nothing and says nothing', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const { code, output: stdout } = runScript(repo);
    expect(code, 'exit 0').toBe(0);
    expect(stdout, `the project turned it off on purpose, got: ${stdout}`).toBe('');
    expect(stateOf(repo), 'state').toBe('disabled');
    expect(!fs.existsSync(path.join(repo, '.github')), 'nothing installed').toBeTruthy();
    expect(!fs.existsSync(path.join(repo, '.gitignore')), 'nothing appended').toBeTruthy();
    cleanup(repo);
  });

  test('no file and no record: offers to enable, writes nothing', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo);
    expect(code, 'exit 0').toBe(0);
    expect(stateOf(repo), 'state').toBe('undecided');
    expect(stdout.includes('not in the issue workflow'), `offers, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes('--enable'), 'and says how to opt in').toBeTruthy();
    expect(stdout.includes('--decline'), 'and how to be left alone').toBeTruthy();
    assertUntouched(repo);
    cleanup(repo);
  });

  test('a declined repo is silent and stays untouched', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(stateOf(repo, { workflowHome: home }), 'state').toBe('declined');
    const { code, output: stdout } = runScript(repo, { workflowHome: home });
    expect(code, 'exit 0').toBe(0);
    expect(stdout, `never asks again, got: ${stdout}`).toBe('');
    assertUntouched(repo);
    cleanup(repo); cleanup(home);
  });

  // The tower clone at <WORKFLOW_HOME>/tower is engine territory:
  // it is a git repo, but it carries no committed opt-in, is never offered, and
  // the heal writes nothing into it.
  const makeHomeClone = () => {
    const home = mkTmp('wf-std-');
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: tower });
    return { home, tower };
  };

  test('the tower clone is the `home` state: no offer, nothing written', () => {
    const { home, tower } = makeHomeClone();
    expect(stateOf(tower, { workflowHome: home }), 'state').toBe('home');
    const { code, output: stdout } = runScript(tower, { workflowHome: home });
    expect(code, 'exit 0').toBe(0);
    expect(!stdout.includes('not in the issue workflow'), `never offered, got: ${stdout}`).toBeTruthy();
    assertUntouched(tower);
    // And it never joins the roster: the tower finds it by path instead.
    expect(JSON.stringify(rosterOf(home)), 'not registered').toBe('{}');
    cleanup(home);
  });

  test('--enable refuses on the tower clone', () => {
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--enable'] });
    expect(code !== 0, `the refusal is a failure, got exit ${code}`).toBeTruthy();
    expect(stdout.includes('engine territory'), `says why, got: ${stdout}`).toBeTruthy();
    assertUntouched(tower);
    cleanup(home);
  });

  test('--decline refuses on the tower clone', () => {
    // Symmetric with --enable: a decline recorded against the clone's path
    // would drop the home repo from the board's by-path discovery for good.
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--decline'] });
    expect(code !== 0, `the refusal is a failure, got exit ${code}`).toBeTruthy();
    expect(stdout.includes('engine territory'), `says why, got: ${stdout}`).toBeTruthy();
    expect(!rosterOf(home)[gitPath(fs.realpathSync(tower))], 'no decline recorded').toBeTruthy();
    expect(JSON.stringify(rosterOf(home)), 'the roster is untouched').toBe('{}');
    cleanup(home);
  });

  test('the user settings file exists from the first run, before any decision, the site options left to the defaults', () => {
    // A missing ~/.workkit reads as broken, so the file is seeded; every option
    // it does not set reads the kit default, the switch unanswered (null, never a
    // false nobody gave), which is what setup reads to know there is a question.
    const repo = makeRepo({ settings: null });
    const home = path.join(mkTmp('wf-std-'), 'never-touched');
    runScript(repo, { args: ['--state'], workflowHome: home });
    const file = path.join(home, 'settings.json');
    expect(fs.existsSync(file), 'created without any decline').toBeTruthy();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).repos, 'the roster is not in the hand-edited file').toBe(undefined);
    const { site } = settingsAt(null, file);
    expect(site.repo, 'the home repo is unset').toBe(null);
    expect(site.publish, 'the switch is unanswered: nobody has been asked yet').toBe(null);
    expect(site.url, 'and there is no custom domain').toBe(null);
    cleanup(repo);
  });

  test('an existing user settings file is never overwritten by the ensure', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const file = path.join(home, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true, url: null } }));
    runScript(repo, { args: ['--state'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.site.publish, 'what the owner typed survives').toBe(true);
    expect(parsed.site.repo, 'home slug and all').toBe('owner/workkit');
    cleanup(repo); cleanup(home);
  });

  test('a heal warns while the machine settings file is no JSON object, and is silent once it is one', () => {
    const repo = makeRepo();
    const home = mkTmp('wf-std-');
    const file = path.join(home, 'settings.json');
    const warning = /settings: (.+) is not a JSON object/;
    for (const broken of ['{ not json', '[]']) {
      fs.writeFileSync(file, broken);
      const { code, output } = runScript(repo, { workflowHome: home });
      expect(code, `${broken}: a broken machine file never fails a heal`).toBe(0);
      const named = (output.match(warning) || [])[1];
      expect(named !== undefined, `${broken}: it warns, got: ${output}`).toBeTruthy();
      expect(samePath(named, file, process.platform), `${broken}: it names ${file}, got: ${named}`).toBeTruthy();
      // samePath reads a drive mount as its drive, so the spelling is its own check:
      // a person on Windows reads `D:/...`, never Git Bash's `/d/...`.
      expect(/^[A-Za-z]:/.test(named), `${broken}: the native spelling, got: ${named}`).toBe(IS_WINDOWS);
      expect(fs.readFileSync(file, 'utf8'), `${broken}: the file is left as typed`).toBe(broken);
    }
    for (const fine of ['', '{"version": 1}']) {
      fs.writeFileSync(file, fine);
      const { output } = runScript(repo, { workflowHome: home });
      expect(!warning.test(output), `${JSON.stringify(fine)}: no warning, got: ${output}`).toBeTruthy();
    }
    cleanup(repo); cleanup(home);
  });

  test('--decline records the repo under repos in the machine\'s roster file', () => {
    // The decline is the machine's record, not the owner's typing, so it lands
    // in `.repos.json` beside the settings rather than in them.
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const { code, output: stdout } = runScript(repo, { args: ['--decline'], workflowHome: home });
    expect(code, 'exit 0').toBe(0);
    expect(stdout.includes('recorded'), `reports the record, got: ${stdout}`).toBeTruthy();
    const file = path.join(home, '.repos.json');
    expect(fs.existsSync(file), 'the roster file exists').toBeTruthy();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.version, 'seeded with a version').toBe(1);
    const root = fs.realpathSync(repo);
    expect(parsed.repos[gitPath(root)], 'keyed by the absolute repo root').toBe('declined');
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    expect(settings.repos, 'and nothing was written into the hand-edited file').toBe(undefined);
    cleanup(repo); cleanup(home);
  });

  test('--decline writes only the repos key: every other key survives', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp('wf-std-');
    const seeded = {
      version: 1,
      editor: 'code',
      nested: { keep: ['me', 1] },
      repos: { '/some/other/repo': 'declined' },
    };
    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify(seeded, null, 2)}\n`);
    runScript(repo, { args: ['--decline'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    expect(parsed.editor, 'unrelated key survives with its value').toBe('code');
    expect(JSON.stringify(parsed.nested), 'nested value survives').toBe(JSON.stringify({ keep: ['me', 1] }));
    expect(parsed.repos['/some/other/repo'], 'other repo decisions survive').toBe('declined');
    expect(parsed.repos[gitPath(fs.realpathSync(repo))], 'and the new one is added').toBe('declined');
    cleanup(repo); cleanup(home);
  });

  test('--enable writes the committed opt-in and then heals', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo, { args: ['--enable'] });
    expect(code, 'exit 0').toBe(0);
    const settings = path.join(repo, W, 'settings.json');
    expect(fs.existsSync(settings), 'the repo now carries its yes').toBeTruthy();
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(JSON.stringify(parsed), 'enabled: true, and no version key').toBe(JSON.stringify({ enabled: true }));
    expect(stdout.includes('commit it'), `says the file must be committed, got: ${stdout}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the heal ran').toBeTruthy();
    expect(stateOf(repo), 'state').toBe('enabled');
    cleanup(repo);
  });

  test('--enable on an empty settings file writes the yes', () => {
    const repo = makeRepo({ settings: '' });
    const { code, output } = runScript(repo, { args: ['--enable'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, W, 'settings.json'), 'utf8')).enabled, 'the file holds "enabled": true').toBe(true);
    cleanup(repo);
  });

  test('--enable flips an existing enabled: false back on', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false, "keep": "me" }\n' });
    runScript(repo, { args: ['--enable'] });
    const parsed = JSON.parse(fs.readFileSync(path.join(repo, W, 'settings.json'), 'utf8'));
    expect(parsed.enabled, 'flipped').toBe(true);
    expect(parsed.keep, 'other repo settings survive').toBe('me');
    cleanup(repo);
  });

  test('without jq an unreadable settings file reads unreadable, as it does with jq', { skip: (IS_WINDOWS || process.getuid() === 0) && 'a mode-000 file is still readable here (Windows ignores the mode, root ignores it)' }, () => {
    // standards/state.sh sourced after participation.sh, as standards.sh sources
    // them. The text says enabled, so only the unreadable read can answer.
    const dir = mkTmp('wf-std-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, OPT_IN_SHAPES.current);
    fs.chmodSync(file, 0o000);
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [
      ...NO_RC, '-c', '. "$1"; . "$2"; repo_enabled_flag "$3"', 'bash',
      shellPath(path.join(WORKFLOW_DIR, 'lib', 'participation.sh')),
      shellPath(path.join(WORKFLOW_DIR, 'standards', 'state.sh')),
      shellPath(file),
    ], { env: { PATH: binDir }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.stdout, `never a decline or a yes, stderr: ${res.stderr}`).toBe('unreadable');
    fs.chmodSync(file, 0o600);
    cleanup(dir); cleanup(binDir);
  });

  test('--state on a non-git directory says so instead of guessing', () => {
    const dir = mkTmp('wf-std-');
    expect(stateOf(dir), 'a directory with no repo has no participation state').toBe('nogit');
    cleanup(dir);
  });
});
