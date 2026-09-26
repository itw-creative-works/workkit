//
// Tests for workflow/home.sh: the setup wizard (the repo, the clone, the seed and
// the install, Discussions and its categories poll, Pages).
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkRemote, mkWorld, inHome, setup } = require('./helpers');

const run = async () => {
  group('workflow/home: the wizard');

  await test('setup creates the repo, clones it, seeds it, and records the slug', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);

    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`);
    assertEq(world.settings().site.repo, 'owner/workkit', 'the home slug is recorded');
    assert(fs.existsSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html')), 'the project is seeded');
    assert(!fs.existsSync(path.join(world.tower, '.workkit')), 'and the clone carries no workflow folder of its own');

    assert(world.npmCalls().some((c) => c.join(' ').includes('install')), `the dependencies are installed once, here: ${fmtCalls(world.npmCalls())}`);
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit is still a plain folder');
    assert(!fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'with nothing versioned seeded beside it');
    assert(!fs.existsSync(path.join(world.workflowHome, '.gitignore')), 'and no ignore file of its own');

    // The FIRST commit, read from the bottom of the log: the clone's own heal
    // installs the issue forms on top of it (issue #123).
    const subjects = spawnSync('git', ['-C', world.tower, 'log', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim().split('\n');
    assertEq(subjects[subjects.length - 1], 'chore(home): seed the tower project', 'the first commit says what it is');
    // The wiring itself, pinned: setup runs the clone's heal (issue #123):
    // deleting the wk_home_heal calls in wk_home_setup goes red here.
    assert(subjects.includes('chore(home): install the issue templates'),
      `and setup healed the clone's issue forms, its log: ${subjects.join(' | ')}`);
    cleanup(world.root);
  });

  await test('a second setup finds the clone and re-seeds nothing', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    setup(world);
    fs.writeFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), '<html>edited here</html>\n');
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(!/created the private repo/.test(out), `nothing is created twice, got: ${out}`);
    assert(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'targets', 'web', 'src', 'index.html'), 'utf8'),
      '<html>edited here</html>\n', 'and what the project already carried survives');
    assertEq(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head, 'the repo is untouched');
    cleanup(world.root);
  });

  await test('a clone another machine already seeded is left exactly as it is', () => {
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    // The clone's line endings are the machine git's business (Windows checks
    // out CRLF), and this case is about WHOSE file is here, not how it ends.
    assertEq(fs.readFileSync(path.join(world.tower, 'README.md'), 'utf8').replace(/\r\n/g, '\n'),
      '# from elsewhere\n', 'the other machine’s project is the one here');
    assert(!fs.existsSync(path.join(world.tower, 'targets')), 'and nothing was seeded over it');
    assert(/already in/.test(out), `it says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a second machine installs the dependencies the project arrived without', () => {
    // The project travels in the repo; node_modules does not. Without the
    // install on this path a second machine can never build or publish.
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(/installing the tower project's dependencies/.test(out), `it says what it is doing, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the build tooling is there afterwards');

    // Idempotent: an installed tree is a skip, not a second install.
    const again = setup(world);
    assert(/already installed/.test(again.out), `a second run costs nothing, got: ${again.out}`);
    assertEq(world.npmCalls().filter((c) => /install/.test(c)).length, 1, 'and npm ran exactly once');
    cleanup(world.root);
  });

  await test('the install is keyed from the clone’s real path, symlinked ~/.workkit or not', () => {
    // Issue #171, the same defect publish.sh carried (#166) and the FIRST
    // install a fresh machine ever runs: `npm --prefix <link>/tower install`
    // resolves the project through the link while keying the tree from the
    // CALLER'S cwd, and the lockfile takes package paths outside the project
    // root: a corrupt tree the next install dies inside arborist on.
    const world = mkWorld({ login: 'owner' });
    const link = path.join(world.root, 'linked-workkit');
    fs.symlinkSync(world.workflowHome, link);
    world.env.WORKFLOW_HOME = link;

    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    const cwds = world.npmCwds();
    assertEq(cwds.length, 1, `one install, and its cwd recorded: ${cwds.join(' | ')}`);
    assertEq(cwds[0], shellPath(world.tower), 'the cwd is the clone with its links resolved');
    assert(!world.npmCalls().some((c) => c.includes('--prefix')),
      `and no --prefix keys the tree from elsewhere: ${fmtCalls(world.npmCalls())}`);
    cleanup(world.root);
  });

  await test('a fresh tree that links its bins only on the second pass still installs', () => {
    // npm's own workspace linking left node_modules/.bin holding nothing but
    // omega-manager on the first real setup (2026-07-29); the second install
    // linked everything. One retry is what makes that machine publishable.
    const world = mkWorld({ login: 'owner', npmLinksOn: 2 });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(/the tower project can build here/.test(out), `the retry is what proved it, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the bin is linked');
    assertEq(world.npmCalls().filter((c) => /install/.test(c)).length, 2, 'two passes, never more');
    cleanup(world.root);
  });

  await test('a tree that never links its bins warns once, after the retry', () => {
    const world = mkWorld({ login: 'owner', npmLinksOn: 0 });
    const { code, out } = setup(world);
    assertEq(code, 0, `the setup still finishes: ${out}`);
    assertEq(world.npmCalls().filter((c) => /install/.test(c)).length, 2, 'it retried once and stopped');
    assert(/build tooling did not install/.test(out), `and says so plainly, got: ${out}`);
    cleanup(world.root);
  });

  await test('without a terminal it says what a terminal run would do, and asks nothing', () => {
    const world = mkWorld({ login: 'owner' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);

    const { code, out } = inHome(world, 'interactive() { return 1; }\nwk_home_setup');
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(/workkit setup/.test(out), `and hands over the command, got: ${out}`);
    assertEq(world.settings().site.repo, null, 'a machine that never answered gets no home');
    assert(!fs.existsSync(world.tower), 'and nothing is cloned');
    cleanup(world.root);
  });

  await test('an answer that is not yes leaves everything alone', () => {
    const world = mkWorld({ login: 'owner' });
    const { out } = setup(world, { input: 'n\n' });
    assert(/left as it is/.test(out), `it says so, got: ${out}`);
    assertEq(world.settings().site.repo, null, 'and no home is recorded');
    assert(!fs.existsSync(world.tower), 'nothing is cloned');
    cleanup(world.root);
  });

  await test('a gh that cannot say who you are points at the login command', () => {
    const world = mkWorld({ login: '' });
    const { code, out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup');
    assertEq(code, 0, 'exit 0');
    assert(/gh auth login/.test(out), `it prints the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('something in the way stops setup before it writes anything', () => {
    const world = mkWorld({ login: 'owner' });
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'mine.txt'), 'mine\n');
    const { code, out } = setup(world);
    assertEq(code, 0, 'setup never dies mid-way');
    assert(/move it aside/.test(out), `it names what is in the way, got: ${out}`);
    assert(!/Discussions/.test(out), 'and no later step ran');
    assert(!fs.existsSync(path.join(world.tower, 'package.json')), 'nothing was seeded over it');
    cleanup(world.root);
  });

  await test('Discussions are enabled, and missing categories get a one-time pointer', () => {
    // GitHub has NO mutation that creates a discussion category, probed
    // against the live schema, so the only honest step is to name the page.
    const world = mkWorld({ login: 'owner', categories: ['General'] });
    const { code, out } = inHome(world, 'wk_home_discussions owner/workkit');
    assertEq(code, 0, 'exit 0');
    assert(/Discussions enabled/.test(out), `it turns them on, got: ${out}`);
    assert(/Daily, Weekly, Monthly, Brief/.test(out), 'names every category that is missing, the brief\'s included (#244)');
    assert(/discussions\/categories/.test(out), 'and the page that makes them');
    assert(/no API that creates one/.test(out), 'saying why it cannot do it itself');
    assertEq(world.openerCalls().length, 0, 'and nothing opened: this run has no terminal');
    cleanup(world.root);
  });

  // The interactive runs feed the step's stdin through a process substitution,
  // so keys can arrive AFTER the poll started; a spawnSync `input` is all
  // read at once, and the pipe closing under the poll reads as a skip. The
  // feeder lets go of the transcript's streams first, or a feeder still
  // sleeping would hold the run open past the step it is feeding.
  const atTerminal = (world, stdin) => inHome(world,
    `interactive() { return 0; }\nwk_home_discussions owner/workkit < <(exec 2>/dev/null; ${stdin})`);
  const categoriesCalls = (world) => world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;

  await test('at a terminal, setup opens the page that makes the categories and polls until they are there (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'] });
    const { code, out } = atTerminal(world, "printf '\\n'");
    assertEq(code, 0, 'exit 0');
    assert(/Make the Daily, Weekly, Monthly, Brief categories on this page/.test(out), `it says what to do there, got: ${out}`);
    assert(/URL: https:\/\/github.com\/owner\/workkit\/discussions\/categories/.test(out), 'and prints the URL before asking');
    assert(/\? Press Enter to open the categories page in your browser\.\.\./.test(out), 'the one Enter gate, in omega\'s words');
    const opened = world.openerCalls();
    assertEq(opened.length, 1, `the page opened once: ${fmtCalls(opened)}`);
    assertEq(opened[0][0], 'https://github.com/owner/workkit/discussions/categories', 'the page that makes them');
    assert(/\(enter\)=check now, \(s\)=skip/.test(out), 'then the poll names its keys');
    assert(/✓.*Daily, Weekly, Monthly and Brief categories are there/.test(out), `the first check found what the owner made, got: ${out}`);
    assert(!/no API that creates one/.test(out), 'so no pointer is printed');
    cleanup(world.root);
  });

  await test('Enter checks now, ahead of the interval (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    const started = Date.now();
    const { code, out } = atTerminal(world, "printf '\\n'; sleep 2; printf '\\n'");
    const took = (Date.now() - started) / 1000;
    assertEq(code, 0, 'exit 0');
    assert(/✓.*categories are there/.test(out), `the second check passed, got: ${out}`);
    assertEq(categoriesCalls(world), 4, `enable, the step's own read, the poll's first check, then the one Enter asked for: ${categoriesCalls(world)} reads`);
    assert(took < 5, `and it never waited the whole interval out (${took}s)`);
    cleanup(world.root);
  });

  await test('with no key pressed, the poll checks again on its own after five seconds (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    world.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly', 'Brief'], afterReads: 1 });
    const started = Date.now();
    const { code, out } = atTerminal(world, "printf '\\n'; sleep 9");
    const took = (Date.now() - started) / 1000;
    assertEq(code, 0, 'exit 0');
    assert(/✓.*categories are there/.test(out), `the interval's own check passed, got: ${out}`);
    assert(took >= 5 && took < 9, `one interval, not the pipe closing (${took}s)`);
    assertEq(categoriesCalls(world), 4, `enable, the step's own read, the poll's first check, the interval's: ${categoriesCalls(world)} reads`);
    cleanup(world.root);
  });

  await test('s skips the poll and keeps the pointer; the pipe closing counts as a skip too (#244)', () => {
    const skipped = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    skipped.installOpener();
    const s = atTerminal(skipped, "printf '\\ns'");
    assertEq(s.code, 0, 'exit 0');
    assertEq(skipped.openerCalls().length, 1, 'the open is never declined; skipping happens at the poll');
    assert(/no API that creates one/.test(s.out), `the pointer stands, got: ${s.out}`);
    cleanup(skipped.root);

    // A read that fails during the poll must not blank the pointer's names.
    const broken = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    broken.installOpener({ breaks: true });
    const b = atTerminal(broken, "printf '\ns'");
    assertEq(b.code, 0, 'exit 0');
    assert(/the Daily, Weekly, Monthly, Brief categories do not exist yet/.test(b.out), `the pointer keeps the names the step read itself, got: ${b.out}`);
    cleanup(broken.root);

    const partial = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    partial.installOpener({ makes: ['General', 'Daily', 'Weekly', 'Monthly'] });
    const p = atTerminal(partial, "printf '\\n'");
    assertEq(p.code, 0, 'exit 0');
    assert(/the Brief categories do not exist yet/.test(p.out), `the pointer names only what is still missing, got: ${p.out}`);
    cleanup(partial.root);
  });

  await test('a terminal with no browser opener still asks and polls, and says the URL is by hand (#244)', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    // The base PATH keeps a real `open` on a Mac and a real `xdg-open` on a
    // Linux runner, so the gate's own `command -v` is answered no by hand.
    const noOpener = 'command() { [[ "$1" == "-v" && ("$2" == "open" || "$2" == "xdg-open") ]] && return 1; builtin command "$@"; }';
    const { code, out } = inHome(world, `${noOpener}\ninteractive() { return 0; }\nwk_home_discussions owner/workkit < <(printf '\\n')`);
    assertEq(code, 0, 'exit 0');
    assert(/Press Enter to open/.test(out), `the gate still asks, got: ${out}`);
    assert(/no browser could be launched: open the URL above by hand/.test(out), 'and says the open did not happen');
    assert(/no API that creates one/.test(out), 'the pointer stands once the pipe closes');
    cleanup(world.root);
  });

  await test('Discussions already on are left alone', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { out } = inHome(world, 'wk_home_discussions owner/workkit');
    assert(/Discussions are on/.test(out), `it reports the state, got: ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(!calls.some((c) => c.includes('updateRepository')), `and never writes: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('Pages is asked for the gh-pages branch at its root, and a refusal warns with the fix', () => {
    const world = mkWorld({ login: 'owner' });
    const ok = inHome(world, 'wk_home_pages owner/workkit');
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('POST'));
    assert(posted && posted.includes('source[branch]=gh-pages'), `the branch that carries only the build: ${fmtCalls(world.ghCalls())}`);
    assert(posted.includes('source[path]=/'), 'served from its root, so no folder is named for a Pages rule');
    assert(!posted.includes('/docs'), 'and nothing on main is published at all');
    assert(/serves .* from gh-pages \//.test(ok.out), `and it says so, got: ${ok.out}`);

    const refused = mkWorld({ login: 'owner', pagesFails: true });
    const { code, out } = inHome(refused, 'wk_home_pages owner/workkit');
    assertEq(code, 0, 'a refusal never stops the wizard');
    assert(/paid plan/.test(out) && /settings\/pages/.test(out), `it warns with the fix, got: ${out}`);
    cleanup(world.root); cleanup(refused.root);
  });

  await test('setup creates no branch: the publish makes gh-pages when it first pushes', () => {
    // Issue #71's boundary: the wizard creates the repo, Discussions and Pages;
    // a branch is generated output and belongs to whatever generates it.
    const world = mkWorld({ login: 'owner' });
    setup(world);
    const branches = spawnSync('git', ['-C', world.tower, 'branch', '-a'], { encoding: 'utf8' }).stdout;
    assert(!/gh-pages/.test(branches), `no gh-pages anywhere yet: ${branches}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
