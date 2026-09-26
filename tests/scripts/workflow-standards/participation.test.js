//
// Tests for standards.sh: participation, the four states and where each lives.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const { mkTmp, cleanup, rosterOf, makeRepo, runScript, STANDARD_VERSION } = require('./helpers');

const run = async () => {
  group('standards.sh: participation');

  // Four states, two files. A yes (or a deliberate project-level no) is the
  // repo's committed settings.json; never-asked and declined are personal and
  // live in the user file, so a teammate never reads one developer's hesitation
  // as the project's decision (Ian 2026-07-24).
  const stateOf = (repo, opts) => runScript(repo, { ...opts, args: ['--state'] }).stdout.trim();

  // Nothing at all may land in a repo that has not said yes.
  const assertUntouched = (repo) => {
    assert(!fs.existsSync(path.join(repo, '.github')), 'no issue templates written');
    assert(!fs.existsSync(path.join(repo, '.gitignore')), 'no .gitignore written');
    assert(!fs.existsSync(path.join(repo, W)), `no ${W} directory written`);
  };

  await test('enabled: true heals the repo', () => {
    const repo = makeRepo();
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stateOf(repo), 'enabled', 'state');
    assert(stdout.includes('issue forms'), `heals, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates installed');
    cleanup(repo);
  });

  await test('legacy { version: 1 } with no enabled key still heals', () => {
    const repo = makeRepo({ settings: '{ "version": 1 }\n' });
    const { output: stdout } = runScript(repo);
    assertEq(stateOf(repo), 'enabled', 'an opt-in file that predates the key is a yes');
    assert(stdout.includes('issue forms'), `heals, got: ${stdout}`);
    cleanup(repo);
  });

  await test('enabled: false heals nothing and says nothing', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false }\n' });
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `the project turned it off on purpose, got: ${stdout}`);
    assertEq(stateOf(repo), 'disabled', 'state');
    assert(!fs.existsSync(path.join(repo, '.github')), 'nothing installed');
    assert(!fs.existsSync(path.join(repo, '.gitignore')), 'nothing appended');
    cleanup(repo);
  });

  await test('no file and no record: offers to enable, writes nothing', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stateOf(repo), 'undecided', 'state');
    assert(stdout.includes('not in the issue workflow'), `offers, got: ${stdout}`);
    assert(stdout.includes('--enable'), 'and says how to opt in');
    assert(stdout.includes('--decline'), 'and how to be left alone');
    assertUntouched(repo);
    cleanup(repo);
  });

  await test('a declined repo is silent and stays untouched', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    runScript(repo, { args: ['--decline'], workflowHome: home });
    assertEq(stateOf(repo, { workflowHome: home }), 'declined', 'state');
    const { code, output: stdout } = runScript(repo, { workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', `never asks again, got: ${stdout}`);
    assertUntouched(repo);
    cleanup(repo); cleanup(home);
  });

  // The tower clone at <WORKFLOW_HOME>/tower is ENGINE TERRITORY (issue #79):
  // it is a git repo, but it carries no committed opt-in, is never offered, and
  // the heal writes nothing into it.
  const makeHomeClone = () => {
    const home = mkTmp();
    const tower = path.join(home, 'tower');
    fs.mkdirSync(tower, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: tower });
    return { home, tower };
  };

  await test('the tower clone is the `home` state: no offer, nothing written', () => {
    const { home, tower } = makeHomeClone();
    assertEq(stateOf(tower, { workflowHome: home }), 'home', 'state');
    const { code, output: stdout } = runScript(tower, { workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('not in the issue workflow'), `never offered, got: ${stdout}`);
    assertUntouched(tower);
    // And it never joins the roster: the tower finds it by path instead.
    assertEq(JSON.stringify(rosterOf(home)), '{}', 'not registered');
    cleanup(home);
  });

  await test('--enable refuses on the tower clone', () => {
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--enable'] });
    assert(code !== 0, `the refusal is a failure, got exit ${code}`);
    assert(stdout.includes('engine territory'), `says why, got: ${stdout}`);
    assertUntouched(tower);
    cleanup(home);
  });

  await test('--decline refuses on the tower clone', () => {
    // Symmetric with --enable: a decline recorded against the clone's path
    // would drop the home repo from the board's by-path discovery for good.
    const { home, tower } = makeHomeClone();
    const { code, output: stdout } = runScript(tower, { workflowHome: home, args: ['--decline'] });
    assert(code !== 0, `the refusal is a failure, got exit ${code}`);
    assert(stdout.includes('engine territory'), `says why, got: ${stdout}`);
    assert(!rosterOf(home)[gitPath(fs.realpathSync(tower))], 'no decline recorded');
    assertEq(JSON.stringify(rosterOf(home)), '{}', 'the roster is untouched');
    cleanup(home);
  });

  await test('the user settings file exists from the first run, before any decision', () => {
    // It used to appear only on the first decline, so someone running the
    // workflow system found no ~/.workkit at all and read that as broken
    // (Ian 2026-07-25). The site options spelled out are the honest starting
    // state: it is the hand-edited file (issue #80), and an empty one would
    // show nobody what there is to set.
    const repo = makeRepo({ settings: null });
    const home = path.join(mkTmp(), 'never-touched');
    runScript(repo, { args: ['--state'], workflowHome: home });
    const file = path.join(home, 'settings.json');
    assert(fs.existsSync(file), 'created without any decline');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    assertEq(parsed.repos, undefined, 'the roster is not in the hand-edited file');
    assertEq(parsed.site.repo, null, 'the home repo is unset');
    // Null, not false: the switch has three states (issue #84), and a seeded
    // false is an answer nobody gave: it is what setup reads to know there is
    // still a question to put.
    assert('publish' in parsed.site, 'the switch is spelled out');
    assertEq(parsed.site.publish, null, 'and it is unanswered: nobody has been asked yet');
    assertEq(parsed.site.url, null, 'and there is no custom domain');
    cleanup(repo);
  });

  await test('an existing user settings file is never overwritten by the ensure', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const file = path.join(home, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, site: { repo: 'owner/workkit', publish: true, url: null } }));
    runScript(repo, { args: ['--state'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.site.publish, true, 'what the owner typed survives');
    assertEq(parsed.site.repo, 'owner/workkit', 'home slug and all');
    cleanup(repo); cleanup(home);
  });

  await test('--decline records the repo under repos in the machine\'s roster file', () => {
    // The decline is the machine's record, not the owner's typing, so it lands
    // in `.repos.json` beside the settings rather than in them (issue #80).
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const { code, output: stdout } = runScript(repo, { args: ['--decline'], workflowHome: home });
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('recorded'), `reports the record, got: ${stdout}`);
    const file = path.join(home, '.repos.json');
    assert(fs.existsSync(file), 'the roster file exists');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEq(parsed.version, 1, 'seeded with a version');
    const root = fs.realpathSync(repo);
    assertEq(parsed.repos[gitPath(root)], 'declined', 'keyed by the absolute repo root');
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    assertEq(settings.repos, undefined, 'and nothing was written into the hand-edited file');
    cleanup(repo); cleanup(home);
  });

  await test('--decline writes only the repos key: every other key survives', () => {
    const repo = makeRepo({ settings: null });
    const home = mkTmp();
    const seeded = {
      version: 1,
      editor: 'code',
      nested: { keep: ['me', 1] },
      repos: { '/some/other/repo': 'declined' },
    };
    fs.writeFileSync(path.join(home, '.repos.json'), `${JSON.stringify(seeded, null, 2)}\n`);
    runScript(repo, { args: ['--decline'], workflowHome: home });
    const parsed = JSON.parse(fs.readFileSync(path.join(home, '.repos.json'), 'utf8'));
    assertEq(parsed.editor, 'code', 'unrelated key survives with its value');
    assertEq(JSON.stringify(parsed.nested), JSON.stringify({ keep: ['me', 1] }), 'nested value survives');
    assertEq(parsed.repos['/some/other/repo'], 'declined', 'other repo decisions survive');
    assertEq(parsed.repos[gitPath(fs.realpathSync(repo))], 'declined', 'and the new one is added');
    cleanup(repo); cleanup(home);
  });

  await test('--enable writes the committed opt-in and then heals', () => {
    const repo = makeRepo({ settings: null });
    const { code, output: stdout } = runScript(repo, { args: ['--enable'] });
    assertEq(code, 0, 'exit 0');
    const settings = path.join(repo, W, 'settings.json');
    assert(fs.existsSync(settings), 'the repo now carries its yes');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assertEq(parsed.enabled, true, 'enabled: true');
    // A repo opting in today is born at the current standard: there is no
    // legacy layout for the drift report to find.
    assertEq(parsed.version, STANDARD_VERSION, `version: ${STANDARD_VERSION}`);
    assert(stdout.includes('commit it'), `says the file must be committed, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and the heal ran');
    assertEq(stateOf(repo), 'enabled', 'state');
    cleanup(repo);
  });

  await test('--enable flips an existing enabled: false back on', () => {
    const repo = makeRepo({ settings: '{ "version": 1, "enabled": false, "keep": "me" }\n' });
    runScript(repo, { args: ['--enable'] });
    const parsed = JSON.parse(fs.readFileSync(path.join(repo, W, 'settings.json'), 'utf8'));
    assertEq(parsed.enabled, true, 'flipped');
    assertEq(parsed.keep, 'me', 'other repo settings survive');
    cleanup(repo);
  });

  await test('--state on a non-git directory says so instead of guessing', () => {
    const dir = mkTmp();
    assertEq(stateOf(dir), 'nogit', 'a directory with no repo has no participation state');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
