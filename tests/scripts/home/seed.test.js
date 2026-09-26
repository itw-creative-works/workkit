//
// Tests for workflow/home.sh: the seed (the tower app becomes the project, its
// file: specs resolved, and the first commit carries none of the working files).
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, mkRemote, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/home: the seed');

  await test('the tower app becomes the project, minus everything a checkout accretes', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    assertEq(code, 0, `exit 0: ${out}`);

    assert(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'the app travels');
    assert(fs.existsSync(path.join(world.tower, 'config', 'omega.json5')), 'and the brand config');
    assert(fs.existsSync(path.join(world.tower, 'README.md')), 'the project’s README is its own doc, so it travels too');
    assert(fs.existsSync(path.join(world.tower, 'AGENTS.md')), 'and its AGENTS.md');

    assert(!fs.existsSync(path.join(world.tower, 'node_modules')), 'the installed dependencies do not');
    assert(!fs.existsSync(path.join(world.tower, 'targets', 'web', 'node_modules')), 'at any depth');
    assert(!fs.existsSync(path.join(world.tower, 'package-lock.json')), 'nor the lockfile');
    assert(!fs.existsSync(path.join(world.tower, '.omega')), 'nor the omega run machinery');
    assert(!fs.existsSync(path.join(world.tower, 'targets', 'web', 'dist')), 'nor a stale build');
    assert(/seeded the tower project/.test(out), `and it says what it did, got: ${out}`);
    cleanup(world.root);
  });

  await test('every file: spec is rewritten to the absolute path it resolved to', () => {
    // The relative spec counts directories up from tower/app and is nonsense
    // from ~/.workkit/tower. Committing the absolute path is the local-era
    // acceptance the omega brand monorepo already makes for itself.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    assertEq(
      world.pkg().devDependencies['@omega.js/manager'],
      `file:${shellPath(path.join(world.framework, 'manager'))}`,
      'the root manifest points at the framework this machine resolves it from',
    );
    assertEq(
      world.pkg(path.join('targets', 'web', 'package.json')).dependencies['@omega.js/web'],
      `file:${shellPath(path.join(world.framework, 'web'))}`,
      'and so does every app, resolved from ITS own directory',
    );
    assert(/Local era/.test(world.pkg().description), 'the description says why the manifest names a path');
    cleanup(world.root);
  });

  await test('a spec nothing resolves is left alone and said out loud', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    cleanup(path.join(world.framework, 'manager'));

    const { out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    assert(/@omega\.js\/manager still points at/.test(out), `it names the spec it could not resolve, got: ${out}`);
    assert(/file:\.\.\//.test(world.pkg().devDependencies['@omega.js/manager']), 'and the spec is untouched');
    cleanup(world.root);
  });

  await test('the seed is the app and nothing else: no config file, no .workkit', () => {
    // The clone is engine territory (issue #79): the site options are the
    // user's and live in the machine settings file, and the home repo is known
    // by path, so there is no opt-in to seed and no inbox to keep out.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    assert(!fs.existsSync(path.join(world.tower, 'config', 'workkit.json')), 'no site options inside the project');
    assert(!fs.existsSync(path.join(world.tower, '.workkit')), 'and no .workkit/ folder at all');

    const ignore = fs.readFileSync(path.join(world.tower, '.gitignore'), 'utf8').split('\n');
    assert(ignore.includes('node_modules/'), 'the app’s own rules are kept');
    assert(ignore.includes('dist/'), 'build output included');
    assert(!ignore.some((l) => l.includes('.workkit')), `and nothing is ignored for a folder that never exists: ${ignore.join('\n')}`);
    cleanup(world.root);
  });

  await test('the first commit carries the project and none of the working files', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, [
      'wk_home_clone owner/workkit',
      'wk_home_seed',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): seed the tower project"',
    ].join('\n'));

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, 'targets', 'web', 'src', 'index.html')), 'the push landed the project');
    assert(fs.existsSync(path.join(check, 'config', 'omega.json5')), 'with the app’s own config');
    assert(!fs.existsSync(path.join(check, 'config', 'workkit.json')), 'and no site options of its own');
    assert(!fs.existsSync(path.join(check, '.workkit')), 'nor a .workkit/ folder in what a second machine clones');
    cleanup(world.root);
  });

  await test('a stray .workkit/ in the clone is never committed by the daily push', () => {
    // The clone carries no participation state, so anything under that name is
    // scratch someone or something left there, and an unattended commit must
    // not push it to the default branch (issue #79).
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, [
      'wk_home_clone owner/workkit',
      'wk_home_seed',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): seed the tower project"',
    ].join('\n'));

    fs.mkdirSync(path.join(world.tower, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(world.tower, '.workkit', 'scratch.md'), '- a stray note\n');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    inHome(world, 'wk_home_commit_push "chore(home): publish the site"');

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(/edited/.test(fs.readFileSync(path.join(check, 'README.md'), 'utf8')), 'the real change went');
    assert(!fs.existsSync(path.join(check, '.workkit')), 'and the scratchpad stayed home');
    assert(fs.existsSync(path.join(world.tower, '.workkit', 'scratch.md')), 'left where it was, not removed');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
