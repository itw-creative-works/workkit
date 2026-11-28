// Tests for workflow/home.js and workflow/home/: its shape (the copy's exclude
// list, the addresses, the site host, the paths a line prints on Windows, the
// home repo's name, the usage line) and the four states a home can be in.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { describe, test, expect } = require('../../lib/harness');
const { IS_WINDOWS, NODE_DIR, shellPath } = require('../../lib/platform');
const { underEnv } = require('../../lib/under-env');
const {
  KIT_DIR, cleanup, mkRemote, mkWorld, inHome, runHomeSteps, seeded,
} = require('./helpers');
const { settingsAt } = require('../../../workflow/lib/settings');
const { userDir: userDirOf, towerDir } = require('../../../workflow/user-dir');
const { settingsFile } = require('../../../workflow/home/options');

describe('workflow/home: shape', () => {
  test('the copy’s exclude list covers everything the app’s .gitignore names', () => {
    // The list is the gitignore's set, so the seed is held to it: an ignore rule
    // the list misses is a tree the seed and the sync copy into the published
    // clone. Each rule's name is planted in the app at its root and one folder
    // down (a `*` read as one letter), and the seed must carry none of them.
    const rules = fs.readFileSync(path.join(KIT_DIR, 'tower', 'app', '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      // Matched by name at every depth, so only the top-level names are the
      // list's to carry: a rule spelling out a path is a different question.
      .map((line) => line.replace(/\/$/, ''))
      .filter((line) => !line.includes('/'));
    const ignored = rules.filter((line) => !line.startsWith('!'));
    const negated = rules.filter((line) => line.startsWith('!')).map((line) => line.slice(1));

    expect(ignored.length > 0, 'the app’s ignore rules were read').toBeTruthy();

    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const planted = ignored.map((rule) => rule.replace(/\*/g, 'x'));
    for (const name of planted) {
      for (const dir of [world.towerApp, path.join(world.towerApp, 'targets', 'web')]) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        fs.writeFileSync(path.join(dir, name), 'never copied\n');
      }
    }
    for (const name of negated) fs.writeFileSync(path.join(world.towerApp, name), 'given back\n');
    const { code, out } = runHomeSteps(world, [['repo', 'clone', ['owner/workkit']], ['seed', 'seed']]);
    expect(code, `the seed ran: ${out}`).toBe(0);

    // Also the keep list's "no more": a name it gave back past the negations is
    // a planted name arriving here. One the gitignore never names is copied anyway.
    for (const name of planted) {
      expect(!fs.existsSync(path.join(world.tower, name)), `the seed carries no ${name}`).toBeTruthy();
      expect(!fs.existsSync(path.join(world.tower, 'targets', 'web', name)), `at any depth: ${name}`).toBeTruthy();
    }
    // A `!` line is what git gives back after a rule took it, and the copy
    // gives it back the same way.
    for (const name of negated) {
      expect(fs.existsSync(path.join(world.tower, name)), `the seed gives back ${name}, as the gitignore does`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('the addresses are the new layout: a plain folder with one repo in it', async () => {
    const world = mkWorld();
    const [userDir, homeDir, settings] = await underEnv({ WORKFLOW_HOME: world.workflowHome }, () => [userDirOf(), towerDir(), settingsFile()]);
    expect(userDir, 'the user folder is ~/.workkit, in / separators').toBe(world.workflowHome.replace(/\\/g, '/'));
    expect(homeDir, 'and the clone is the tower under it').toBe(path.join(world.workflowHome, 'tower'));
    expect(settings, 'the site options live beside the roster, outside the clone the user never edits').toBe(path.join(world.workflowHome, 'settings.json'));
    cleanup(world.root);
  });

  test('the site host reads one way, whatever shape the domain was typed in', () => {
    // One reader, because the CNAME, the path prefix and the site URL all want
    // the same answer. A CNAME carries a host and never a path, so the scheme and
    // any trailing slash come off here rather than at a caller. One line each,
    // so the empty answer is an answer and not a missing line.
    for (const [typed, host] of [
      ['board.example.com', 'board.example.com'],
      ['board.example.com/', 'board.example.com'],
      ['https://board.example.com/', 'board.example.com'],
      [null, ''],
    ]) {
      const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: typed } } });
      const { code, out } = inHome(world, ['host']);
      expect(code, `exit 0 for ${JSON.stringify(typed)}`).toBe(0);
      expect(out, `${JSON.stringify(typed)} reads as the host alone`).toBe(`${host}\n`);
      cleanup(world.root);
    }
  });

  test('the dashboard names the home repo as the engine does', async () => {
    // Browser code loads no engine file, so the dashboard keeps its own copy of
    // the name: the central copy finds a board only where the wizard made one.
    const roster = path.join(KIT_DIR, 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'libs', 'tower', 'github', 'roster.js');
    const { HOME_NAME } = await import(pathToFileURL(roster).href);
    const { HOME_REPO_NAME } = require('../../../workflow/home/repo');
    expect(HOME_NAME, 'and the dashboard reads the same name').toBe(HOME_REPO_NAME);
  });

  test('home.js answers a verb it cannot run with the one usage line on stderr and exit 64', () => {
    const usage = 'usage: home.js <setup [force]|doctor|runner-doctor|slug|host|set-slug <slug>|state|ready|catch-up <prefix>|seed-runner|commit-push <subject>>\n';
    const world = mkWorld();
    // An unknown verb, a verb missing its argument, and setup with a word it does not take.
    for (const args of [['publish'], ['set-slug'], ['setup', 'x']]) {
      const call = args.join(' ');
      const { code, out, err } = inHome(world, args);
      expect(code, `${call} exits 64, got: ${out}`).toBe(64);
      expect(err, `${call} prints the usage line on stderr`).toBe(usage);
      expect(out, `${call} prints nothing on stdout`).toBe(err);
    }
    cleanup(world.root);
  });
});

describe('workflow/home: the paths a line prints on Windows', {
  skip: !IS_WINDOWS && 'the native spelling differs from the shell’s only under Git Bash on Windows',
}, () => {
  // `D:/a/x`, git's own spelling, never Git Bash's `/d/a/x`: a person pastes it
  // into any program. Compared without case, as Windows reads a path.
  const native = (p) => p.replace(/\\/g, '/').toLowerCase();

  test('the doctor and the runner seed name their folders in the native spelling', () => {
    const world = mkWorld();
    const unset = inHome(world, ['doctor']).out;
    expect(unset.toLowerCase().includes(`clones it into ${native(world.tower)}`), `the doctor's clone path, got: ${unset}`).toBeTruthy();

    const { out } = seeded(world);
    const line = out.split('\n').find((l) => l.includes('seeded the cloud brief')) || '';
    expect(line.toLowerCase().includes(`runner in ${native(world.tower)} (`), `the clone the runner landed in, got: ${out}`).toBeTruthy();
    expect(line.toLowerCase().includes(`from ${native(world.env.WORKKIT_KIT_DIR)},`), `and the kit it came from, got: ${line}`).toBeTruthy();
    cleanup(world.root);
  });

  // `slug` reads the machine folder's settings before any git or gh. PATH is
  // node's folder alone: Git's usr/bin, where cygpath lives, is left off.
  test('a WORKFLOW_HOME in the shell\'s spelling with no cygpath on PATH: the one line naming WORKFLOW_HOME and the fix, exit 1, no stack', () => {
    const world = mkWorld();
    const folder = shellPath(world.workflowHome);
    const { code, out, err } = inHome({ ...world, env: { ...world.env, WORKFLOW_HOME: folder, PATH: NODE_DIR } }, ['slug']);
    expect(code, `exit 1, got: ${out}`).toBe(1);
    expect(out, 'nothing on stdout').toBe(err);
    expect(err, 'the one line').toBe(`workkit: cannot read WORKFLOW_HOME (${folder}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set WORKFLOW_HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(err), `no stack line, got: ${err}`).toBe(false);
    cleanup(world.root);
  });
});

describe('workflow/home: the four states', () => {
  // The state is one word; a line end after it is no part of it.
  const state = (world) => inHome(world, ['state']).out.trim();

  test('no home slug is `unset`', () => {
    const world = mkWorld();
    expect(state(world), 'nothing has been decided').toBe('unset');
    cleanup(world.root);
  });

  test('the slug write seeds the settings file when nothing has yet, with the switch unanswered', () => {
    // The one order where setup runs before any heal: this function creates the
    // hand-edited file itself. The switch is left to the kit defaults, so it reads
    // unanswered and setup still has a question to put.
    const world = mkWorld({ settings: null });
    const { code } = inHome(world, ['set-slug', 'owner/workkit']);
    expect(code, 'exit 0').toBe(0);
    const { site } = settingsAt(null, path.join(world.workflowHome, 'settings.json'));
    expect(site.repo, 'the slug it was asked to record').toBe('owner/workkit');
    expect(site.publish, 'and nobody has answered the switch').toBe(null);
    expect(site.url, 'no custom domain').toBe(null);
    cleanup(world.root);
  });

  test('a slug with nothing cloned is `absent`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    expect(state(world), 'setup has the clone left to do').toBe('absent');
    cleanup(world.root);
  });

  test('the clone of the home repo is `clone`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{}\n' } });
    runHomeSteps(world, [['repo', 'clone', ['owner/workkit']]]);
    expect(state(world), 'the one state everything else needs').toBe('clone');
    cleanup(world.root);
  });

  test('anything else at that path is `other`, and is never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(path.join(world.tower, 'something'), { recursive: true });
    expect(state(world), 'a folder somebody else made').toBe('other');
    cleanup(world.root);
  });
});
