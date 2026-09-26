//
// Tests for workflow/home.sh: its shape (the three libraries load quietly and
// carry no personal path, the copy's exclude list, the addresses, the site host)
// and the four states a home can be in.
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { WORKFLOW_DIR, KIT_DIR, cleanup, mkRemote, mkWorld, inHome } = require('./helpers');

const run = async () => {
  group('workflow/home: shape');

  await test('the three libraries parse and run nothing at load', () => {
    for (const lib of ['lib.sh', 'discussions.sh', 'home.sh']) {
      const file = path.join(WORKFLOW_DIR, lib);
      assertEq(spawnSync(BASH, [...NO_RC, '-n', shellPath(file)], { encoding: 'utf8' }).status, 0, `bash -n is clean for ${lib}`);
    }
    const world = mkWorld();
    // Sourcing all three prints nothing: a library that acted at load would
    // act every time the CLI, the heal or the job started.
    assertEq(inHome(world, 'true').out, '', 'sourcing says nothing');
    cleanup(world.root);
  });

  await test('no absolute personal path is written into the engine', () => {
    // The four libraries and every piece the split ones source (home/, publish/, lib/).
    const libs = ['lib.sh', 'discussions.sh', 'home.sh', 'publish.sh'];
    for (const dir of ['home', 'publish', 'lib']) {
      for (const file of fs.readdirSync(path.join(WORKFLOW_DIR, dir)).filter((f) => f.endsWith('.sh'))) libs.push(`${dir}/${file}`);
    }
    for (const lib of libs) {
      const text = fs.readFileSync(path.join(WORKFLOW_DIR, lib), 'utf8');
      assert(!/\/Users\/[a-z]/i.test(text), `${lib} carries no machine-specific path`);
    }
  });

  await test('the copy’s exclude list covers everything the app’s .gitignore names', () => {
    // The list says it IS the gitignore's set (issue #201). Read both and hold
    // them to it: an ignore rule added to the app without the list learning it
    // is a tree the seed and the sync copy into the published clone.
    const world = mkWorld();
    const { out } = inHome(world, 'printf "%s\\n" "${WK_TOWER_APP_EXCLUDE[@]}"; echo --; printf "%s\\n" "${WK_TOWER_APP_KEEP[@]}"');
    const [excluded, kept] = out.trim().split('\n--\n').map((half) => half.split('\n'));
    cleanup(world.root);

    const rules = fs.readFileSync(path.join(KIT_DIR, 'tower', 'app', '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      // Matched by NAME at every depth, so only the top-level names are the
      // list's to carry: a rule spelling out a path is a different question.
      .map((line) => line.replace(/\/$/, ''))
      .filter((line) => !line.includes('/'));
    const ignored = rules.filter((line) => !line.startsWith('!'));
    // A `!` line is what git gives back after a rule took it, and the copy
    // gives it back the same way: the keep list is those lines, exactly.
    const negated = rules.filter((line) => line.startsWith('!')).map((line) => line.slice(1));

    assert(ignored.length > 0, 'the app’s ignore rules were read');
    for (const name of ignored) {
      assert(excluded.includes(name), `the exclude list carries ${name}`);
    }
    assertEq(kept.join(','), negated.join(','), 'and the keep list is the gitignore’s negations, no more and no fewer');
  });

  await test('the addresses are the new layout: a plain folder with one repo in it', () => {
    const world = mkWorld();
    const { out } = inHome(world, 'printf "%s\\n%s\\n%s\\n" "$WK_USER_DIR" "$WK_HOME_DIR" "$WK_HOME_SETTINGS"');
    const [userDir, homeDir, settings] = out.trim().split('\n');
    assertEq(userDir, shellPath(world.workflowHome), 'the user folder is ~/.workkit');
    assertEq(homeDir, shellPath(path.join(world.workflowHome, 'tower')), 'and the clone is the tower under it');
    assertEq(settings, shellPath(path.join(world.workflowHome, 'settings.json')),
      'the site options live beside the roster, outside the clone the user never edits');

    // Nothing addresses anything INSIDE the clone but the app it builds: the
    // site options moved out and the inbox is gone entirely (issue #79).
    const lib = fs.readFileSync(path.join(WORKFLOW_DIR, 'lib.sh'), 'utf8');
    assert(!/WK_HOME_CONFIG|WK_HOME_INBOX/.test(lib), 'no address is kept for either retired file');
    cleanup(world.root);
  });

  await test('the site host reads one way, whatever shape the domain was typed in', () => {
    // One reader for that option (issue #230), because three callers want the
    // same answer: publish.sh writes it as the CNAME and decides the build's
    // path prefix on whether it is set at all, and setup composes the published
    // site's URL out of it. A CNAME carries a host and never a path, so the
    // scheme and any trailing slash come off HERE rather than at a caller, and
    // `ask_site_url` takes whatever was typed at its word. Bracketed on the way
    // out so the empty answer is an answer and not a missing line.
    for (const [typed, host] of [
      ['board.example.com', 'board.example.com'],
      ['board.example.com/', 'board.example.com'],
      ['https://board.example.com/', 'board.example.com'],
      [null, ''],
    ]) {
      const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: typed } } });
      const { code, out } = inHome(world, 'printf "[%s]" "$(wk_site_host)"');
      assertEq(code, 0, `exit 0 for ${JSON.stringify(typed)}`);
      assertEq(out, `[${host}]`, `${JSON.stringify(typed)} reads as the host alone`);
      cleanup(world.root);
    }
  });

  group('workflow/home: the four states');

  await test('no home slug is `unset`', () => {
    const world = mkWorld();
    assertEq(inHome(world, 'wk_home_state').out, 'unset', 'nothing has been decided');
    cleanup(world.root);
  });

  await test('the slug write seeds the settings file when nothing has yet, with the switch unanswered', () => {
    // The one order where setup runs before any heal: this function creates the
    // hand-edited file itself. `publish` seeds NULL (issue #84): the same
    // unanswered state the heal's seed writes, so whichever wrote it first,
    // setup still has a question to put.
    const world = mkWorld({ settings: null });
    const { code } = inHome(world, 'wk_home_set_slug owner/workkit');
    assertEq(code, 0, 'exit 0');
    const parsed = JSON.parse(fs.readFileSync(path.join(world.workflowHome, 'settings.json'), 'utf8'));
    assertEq(parsed.site.repo, 'owner/workkit', 'the slug it was asked to record');
    assert('publish' in parsed.site, 'the switch is spelled out');
    assertEq(parsed.site.publish, null, 'and nobody has answered it');
    assertEq(parsed.site.url, null, 'no custom domain');
    cleanup(world.root);
  });

  await test('a slug with nothing cloned is `absent`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    assertEq(inHome(world, 'wk_home_state').out, 'absent', 'setup has the clone left to do');
    cleanup(world.root);
  });

  await test('the clone of the home repo is `clone`', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{}\n' } });
    inHome(world, 'wk_home_clone owner/workkit');
    assertEq(inHome(world, 'wk_home_state').out, 'clone', 'the one state everything else needs');
    cleanup(world.root);
  });

  await test('anything else at that path is `other`, and is never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(path.join(world.tower, 'something'), { recursive: true });
    assertEq(inHome(world, 'wk_home_state').out, 'other', 'a folder somebody else made');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
