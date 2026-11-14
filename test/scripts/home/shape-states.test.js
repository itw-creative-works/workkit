// Tests for workflow/home.sh: its shape (the three libraries load quietly,
// the copy's exclude list, the addresses, the site host)
// and the four states a home can be in. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { WORKFLOW_DIR, KIT_DIR, cleanup, mkRemote, mkWorld, inHome } = require('./helpers');
const { settingsAt } = require('../../../workflow/lib/settings');

describe('workflow/home: shape', () => {
  test('the three libraries parse and run nothing at load', () => {
    for (const lib of ['lib.sh', 'lib/discussions.sh', 'home.sh']) {
      const file = path.join(WORKFLOW_DIR, lib);
      expect(spawnSync(BASH, [...NO_RC, '-n', shellPath(file)], { encoding: 'utf8' }).status, `bash -n is clean for ${lib}`).toBe(0);
    }
    const world = mkWorld();
    // Sourcing all three prints nothing: a library that acted at load would
    // act every time the CLI, the heal or the job started.
    expect(inHome(world, 'true').out, 'sourcing says nothing').toBe('');
    cleanup(world.root);
  });

  test('the copy’s exclude list covers everything the app’s .gitignore names', () => {
    // The list is the gitignore's set, so both are read and held to it: an
    // ignore rule the list misses is a tree the seed and the sync copy into the
    // published clone.
    const world = mkWorld();
    const { out } = inHome(world, 'printf "%s\\n" "${WK_TOWER_APP_EXCLUDE[@]}"; echo --; printf "%s\\n" "${WK_TOWER_APP_KEEP[@]}"');
    const [excluded, kept] = out.trim().split('\n--\n').map((half) => half.split('\n'));
    cleanup(world.root);

    const rules = fs.readFileSync(path.join(KIT_DIR, 'tower', 'app', '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      // Matched by name at every depth, so only the top-level names are the
      // list's to carry: a rule spelling out a path is a different question.
      .map((line) => line.replace(/\/$/, ''))
      .filter((line) => !line.includes('/'));
    const ignored = rules.filter((line) => !line.startsWith('!'));
    // A `!` line is what git gives back after a rule took it, and the copy
    // gives it back the same way: the keep list is those lines, exactly.
    const negated = rules.filter((line) => line.startsWith('!')).map((line) => line.slice(1));

    expect(ignored.length > 0, 'the app’s ignore rules were read').toBeTruthy();
    for (const name of ignored) {
      expect(excluded.includes(name), `the exclude list carries ${name}`).toBeTruthy();
    }
    expect(kept.join(','), 'and the keep list is the gitignore’s negations, no more and no fewer').toBe(negated.join(','));
  });

  test('the addresses are the new layout: a plain folder with one repo in it', () => {
    const world = mkWorld();
    const { out } = inHome(world, 'printf "%s\\n%s\\n%s\\n" "$WK_USER_DIR" "$WK_HOME_DIR" "$WK_HOME_SETTINGS"');
    const [userDir, homeDir, settings] = out.trim().split('\n');
    expect(userDir, 'the user folder is ~/.workkit').toBe(shellPath(world.workflowHome));
    expect(homeDir, 'and the clone is the tower under it').toBe(shellPath(path.join(world.workflowHome, 'tower')));
    expect(settings, 'the site options live beside the roster, outside the clone the user never edits').toBe(shellPath(path.join(world.workflowHome, 'settings.json')));

    // Nothing addresses anything inside the clone but the app it builds.
    const lib = fs.readFileSync(path.join(WORKFLOW_DIR, 'lib.sh'), 'utf8');
    expect(!/WK_HOME_CONFIG|WK_HOME_INBOX/.test(lib), 'no address is kept for either retired file').toBeTruthy();
    cleanup(world.root);
  });

  test('the site host reads one way, whatever shape the domain was typed in', () => {
    // One reader, because the CNAME, the path prefix and the site URL all want
    // the same answer. A CNAME carries a host and never a path, so the scheme and
    // any trailing slash come off here rather than at a caller. Bracketed so the
    // empty answer is an answer and not a missing line.
    for (const [typed, host] of [
      ['board.example.com', 'board.example.com'],
      ['board.example.com/', 'board.example.com'],
      ['https://board.example.com/', 'board.example.com'],
      [null, ''],
    ]) {
      const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: typed } } });
      const { code, out } = inHome(world, 'printf "[%s]" "$(wk_site_host)"');
      expect(code, `exit 0 for ${JSON.stringify(typed)}`).toBe(0);
      expect(out, `${JSON.stringify(typed)} reads as the host alone`).toBe(`[${host}]`);
      cleanup(world.root);
    }
  });
});

describe('workflow/home: the four states', () => {
  test('no home slug is `unset`', () => {
    const world = mkWorld();
    expect(inHome(world, 'wk_home_state').out, 'nothing has been decided').toBe('unset');
    cleanup(world.root);
  });

  test('the slug write seeds the settings file when nothing has yet, with the switch unanswered', () => {
    // The one order where setup runs before any heal: this function creates the
    // hand-edited file itself. The switch is left to the kit defaults, so it reads
    // unanswered and setup still has a question to put.
    const world = mkWorld({ settings: null });
    const { code } = inHome(world, 'wk_home_set_slug owner/workkit');
    expect(code, 'exit 0').toBe(0);
    const { site } = settingsAt(null, path.join(world.workflowHome, 'settings.json'));
    expect(site.repo, 'the slug it was asked to record').toBe('owner/workkit');
    expect(site.publish, 'and nobody has answered the switch').toBe(null);
    expect(site.url, 'no custom domain').toBe(null);
    cleanup(world.root);
  });

  test('a slug with nothing cloned is `absent`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    expect(inHome(world, 'wk_home_state').out, 'setup has the clone left to do').toBe('absent');
    cleanup(world.root);
  });

  test('the clone of the home repo is `clone`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{}\n' } });
    inHome(world, 'wk_home_clone owner/workkit');
    expect(inHome(world, 'wk_home_state').out, 'the one state everything else needs').toBe('clone');
    cleanup(world.root);
  });

  test('anything else at that path is `other`, and is never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(path.join(world.tower, 'something'), { recursive: true });
    expect(inHome(world, 'wk_home_state').out, 'a folder somebody else made').toBe('other');
    cleanup(world.root);
  });
});
