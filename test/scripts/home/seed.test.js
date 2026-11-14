// Tests for workflow/home.sh: the seed (the tower app becomes the project, its
// file: specs resolved and registry specs kept, and the first commit carries
// none of the working files).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, mkRemote, mkWorld, inHome } = require('./helpers');

describe('workflow/home: the seed', () => {
  test('the tower app becomes the project, minus everything a checkout accretes', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    expect(code, `exit 0: ${out}`).toBe(0);

    expect(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'the app travels').toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'config', 'omega.json5')), 'and the brand config').toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'README.md')), 'the project’s README is its own doc, so it travels too').toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'AGENTS.md')), 'and its AGENTS.md').toBeTruthy();

    expect(!fs.existsSync(path.join(world.tower, 'node_modules')), 'the installed dependencies do not').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'targets', 'web', 'node_modules')), 'at any depth').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'package-lock.json')), 'nor the lockfile').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, '.omega')), 'nor the omega run machinery').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, 'targets', 'web', 'dist')), 'nor a stale build').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, '.claude')), 'nor the checkout’s .claude folder').toBeTruthy();
    expect(/seeded the tower project/.test(out), `and it says what it did, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('every file: spec is rewritten to the absolute path it resolved to', () => {
    // The relative spec counts directories up from tower/app and is nonsense
    // from ~/.workkit/tower. Committing the absolute path is the local-era
    // acceptance the omega brand monorepo already makes for itself.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    expect(world.pkg().devDependencies['@omega.js/manager'], 'the root manifest points at the framework this machine resolves it from').toBe(`file:${shellPath(path.join(world.framework, 'manager'))}`);
    expect(world.pkg(path.join('targets', 'web', 'package.json')).dependencies['@omega.js/web'], 'and so does every app, resolved from ITS own directory').toBe(`file:${shellPath(path.join(world.framework, 'web'))}`);
    cleanup(world.root);
  });

  test('a registry spec passes the seed untouched, and the description gains no Local era note', () => {
    const world = mkWorld({ registryPin: '0.54.1' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    expect(code, `exit 0: ${out}`).toBe(0);

    expect(world.pkg().devDependencies['@omega.js/manager'], 'the root manifest keeps its npm version').toBe('0.54.1');
    expect(world.pkg(path.join('targets', 'web', 'package.json')).dependencies['@omega.js/web'], 'and so does the app').toBe('0.54.1');
    expect(!/Local era/.test(world.pkg().description), `no Local era sentence, got: ${world.pkg().description}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a spec nothing resolves is left alone and said out loud', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    cleanup(path.join(world.framework, 'manager'));

    const { out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    expect(/@omega\.js\/manager still points at/.test(out), `it names the spec it could not resolve, got: ${out}`).toBeTruthy();
    expect(/file:\.\.\//.test(world.pkg().devDependencies['@omega.js/manager']), 'and the spec is untouched').toBeTruthy();
    cleanup(world.root);
  });

  test('the seed is the app and nothing else: no config file, no .workkit', () => {
    // The clone is engine territory: the site options are the
    // user's and live in the machine settings file, and the home repo is known
    // by path, so there is no opt-in to seed and no inbox to keep out.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    expect(!fs.existsSync(path.join(world.tower, 'config', 'workkit.json')), 'no site options inside the project').toBeTruthy();
    expect(!fs.existsSync(path.join(world.tower, '.workkit')), 'and no .workkit/ folder at all').toBeTruthy();

    const ignore = fs.readFileSync(path.join(world.tower, '.gitignore'), 'utf8').split('\n');
    expect(ignore.includes('node_modules/'), 'the app’s own rules are kept').toBeTruthy();
    expect(ignore.includes('dist/'), 'build output included').toBeTruthy();
    expect(!ignore.some((l) => l.includes('.workkit')), `and nothing is ignored for a folder that never exists: ${ignore.join('\n')}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a stray .workkit/ in the clone is never committed by the daily push', () => {
    // The clone carries no participation state, so anything under that name is
    // scratch someone or something left there, and an unattended commit must
    // not push it to the default branch.
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
    expect(/edited/.test(fs.readFileSync(path.join(check, 'README.md'), 'utf8')), 'the real change went').toBeTruthy();
    expect(!fs.existsSync(path.join(check, '.workkit')), 'and the scratchpad stayed home').toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, '.workkit', 'scratch.md')), 'left where it was, not removed').toBeTruthy();
    cleanup(world.root);
  });
});
