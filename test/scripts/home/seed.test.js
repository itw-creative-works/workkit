// Tests for workflow/home/seed.js: the seed (the tower app becomes the project, its
// file: specs resolved and registry specs kept, and the first commit carries
// none of the working files) and the sync that keeps it current.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, mkRemote, mkWorld, inHome, inNode } = require('./helpers');

const CLONE_AND_SEED = [['repo', 'clone', ['owner/workkit']], ['seed', 'seed']];

describe('workflow/home: the seed', () => {
  test('the tower app becomes the project, minus everything a checkout accretes', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inNode(world, CLONE_AND_SEED);
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
    inNode(world, CLONE_AND_SEED);

    expect(world.pkg().devDependencies['@omega.js/manager'], 'the root manifest points at the framework this machine resolves it from').toBe(`file:${shellPath(path.join(world.framework, 'manager'))}`);
    expect(world.pkg(path.join('targets', 'web', 'package.json')).dependencies['@omega.js/web'], 'and so does every app, resolved from ITS own directory').toBe(`file:${shellPath(path.join(world.framework, 'web'))}`);
    cleanup(world.root);
  });

  test('a dot-named folder under targets/ is no target: its file: spec is left as it is', () => {
    // The shell's `targets/*/package.json` never matched a dot-named folder,
    // and the publish's install check skips one too; the seed agrees.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const draft = path.join(world.towerApp, 'targets', '.draft');
    fs.mkdirSync(draft, { recursive: true });
    fs.writeFileSync(path.join(draft, 'package.json'), `${JSON.stringify({ name: 'draft', dependencies: { '@omega.js/web': 'file:../../../../../omega/packages/web' } })}\n`);
    const { code, out } = inNode(world, CLONE_AND_SEED);
    expect(code, `exit 0: ${out}`).toBe(0);

    expect(world.pkg(path.join('targets', '.draft', 'package.json')).dependencies['@omega.js/web'], 'the spec is the one the app holds').toBe('file:../../../../../omega/packages/web');
    cleanup(world.root);
  });

  test('a registry spec passes the seed untouched, and the description gains no Local era note', () => {
    const world = mkWorld({ registryPin: '0.54.1' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inNode(world, CLONE_AND_SEED);
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

    const { out } = inNode(world, CLONE_AND_SEED);
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
    inNode(world, CLONE_AND_SEED);

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
    inNode(world, CLONE_AND_SEED);
    inHome(world, 'wk_home_set_slug owner/workkit\nwk_home_commit_push "chore(home): seed the tower project"');

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

describe('workflow/home: the sync', () => {
  // Publish reads both answers in its own process: the code says whether to
  // commit and build, the manifest flag whether the build installs first.
  const sync = (world) => inNode(world, [['seed', 'sync']]).answers[0];
  const homed = () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inNode(world, CLONE_AND_SEED);
    expect(code, `the clone was seeded: ${out}`).toBe(0);
    return world;
  };

  test('current is 2, a changed file 0, a changed manifest 0 with the flag, and a failed write 3', () => {
    const world = homed();
    expect(sync(world), 'a sync right after the seed finds the project current').toEqual({ code: 2, manifests: false });

    fs.writeFileSync(path.join(world.towerApp, 'README.md'), '# the tower, moved on\n');
    expect(sync(world), 'an app file that changed is written, and no manifest was').toEqual({ code: 0, manifests: false });
    expect(fs.readFileSync(path.join(world.tower, 'README.md'), 'utf8'), 'the clone holds the app’s new bytes').toBe('# the tower, moved on\n');

    const manifest = JSON.parse(fs.readFileSync(path.join(world.towerApp, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(world.towerApp, 'package.json'), `${JSON.stringify({ ...manifest, description: 'The tower, moved on.' }, null, 2)}\n`);
    expect(sync(world), 'a manifest that changed is written, and the caller is told').toEqual({ code: 0, manifests: true });

    // The folder a changed file lands in is a plain file in the clone, so the
    // write fails part way through the walk.
    fs.writeFileSync(path.join(world.towerApp, 'targets', 'web', 'src', 'index.html'), '<html>moved on</html>\n');
    fs.rmSync(path.join(world.tower, 'targets', 'web', 'src'), { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src'), 'in the way\n');
    const failed = inNode(world, [['seed', 'sync']]);
    expect(failed.answers[0].code, `a write that failed is part written, never current: ${failed.out}`).toBe(3);
    cleanup(world.root);
  });

  test('nothing cloned is 1, nothing to sync from', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { answers, out } = inNode(world, [['seed', 'sync']]);
    expect(answers[0].code, `the sync had no clone to write into: ${out}`).toBe(1);
    expect(!fs.existsSync(world.tower), 'and made none').toBeTruthy();
    cleanup(world.root);
  });
});
