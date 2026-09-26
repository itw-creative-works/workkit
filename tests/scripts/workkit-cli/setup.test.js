//
// Tests for workflow/workkit.sh: `setup`, its site question, and its site publish.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, ACTED, mkRepo, seedSettings, inCli, AT_TERMINAL,
} = require('./helpers');

const run = async () => {
  group('workkit setup');

  await test('a machine without the plugin has it installed from this checkout', () => {
    const world = mkWorld({ pluginInstalled: false });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, `exit 0: stderr: ${out}`);
    const calls = world.claudeCalls();
    assert(calls.some((c) => isCall(c, 'plugin', 'marketplace', 'add', shellPath(path.dirname(WORKFLOW_DIR)))), `the marketplace is this checkout: ${fmtCalls(calls)}`);
    assert(calls.some((c) => isCall(c, 'plugin', 'install', 'workkit@workkit')), `and the plugin is installed: ${fmtCalls(calls)}`);
    cleanup(world.root);
  });

  await test('a machine that already has it is left alone', () => {
    const world = mkWorld({ pluginInstalled: true });
    const { out } = runCli(world, ['setup']);
    const calls = world.claudeCalls();
    assert(!calls.some((c) => isCall(c, 'plugin', 'install')), `nothing is reinstalled: ${fmtCalls(calls)}`);
    assert(out.includes('is installed'), `and it says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a machine with no claude CLI is a named skip, not a failure', () => {
    const world = mkWorld({ claude: false });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(out.includes('claude CLI is not on this machine'), `it names the skip, got: ${out}`);
    assert(fs.existsSync(world.link), 'and everything else still happens');
    cleanup(world.root);
  });

  await test('an unauthenticated gh is reported with the command that fixes it', () => {
    const world = mkWorld({ ghAuthed: false });
    const { out } = runCli(world, ['setup']);
    assert(out.includes('gh auth login'), `it prints the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('without a terminal it prints the enable command instead of asking', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code, out } = runCli(world, ['setup'], { cwd: repo });
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(out.includes('workkit enable'), `and hands over the command, got: ${out}`);
    assert(!fs.existsSync(path.join(repo, W)), 'a repo that never answered is not written to');
    cleanup(world.root); cleanup(repo);
  });

  await test('a repo already in the workflow is not offered again', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { out } = runCli(world, ['setup'], { cwd: repo });
    assert(out.includes('is in the workflow'), `it reports the state, got: ${out}`);
    assert(!out.includes('workkit enable'), 'and asks nothing');
    cleanup(world.root); cleanup(repo);
  });

  await test('a second setup reports nothing to do', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });
    const { code, said } = runCli(world, ['setup'], { cwd: repo });
    assertEq(code, 0, 'exit 0');
    // `setup` has no quiet variant, so the verbs are the signal here: QUIET is
    // 0 and an action and a skip are the same shape of line (issue #237).
    assert(!ACTED.test(said), `an already-set-up machine acts on nothing, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('setup offers the home repo, and a non-interactive run only says what it would do', () => {
    // The gh shim answers `auth status` and nothing else, so `gh api user`
    // prints nothing: the home step has no login to work from and hands over
    // the command instead of guessing one. What this proves is the OFFER: the
    // wizard reaches the home steps at all, and creates nothing without a
    // terminal (workflow/home.sh's own suite covers the steps themselves).
    const world = mkWorld();
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/home:/.test(out), `the home repo is part of setup, got: ${out}`);
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and nothing was converted without an answer');
    cleanup(world.root);
  });

  group('workkit setup: the site question');

  await test('an unanswered switch is left unanswered where nobody can answer it', () => {
    // Non-interactive is the piped run: the question waits for a terminal
    // rather than being decided by silence, so a later `workkit setup` asks
    // (issue #84).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/site: nobody has been asked/.test(out), `it says the question is still open, got: ${out}`);
    assert(/workkit setup/.test(out), 'and which run puts it');
    assertEq(fs.readFileSync(file, 'utf8'), before, 'nothing was written on the machine’s behalf');
    cleanup(world.root);
  });

  await test('an answered switch is never asked again, either way', () => {
    for (const [answer, said] of [[true, 'publishing is on'], [false, 'publishing is off']]) {
      const world = mkWorld();
      const file = seedSettings(world, { repo: 'owner/workkit', publish: answer, url: null });
      const before = fs.readFileSync(file, 'utf8');
      const { out } = runCli(world, ['setup']);
      assert(out.includes(`site: ${said}`), `${answer} reads back as the answer it is, got: ${out}`);
      assert(!/nobody has been asked/.test(out), 'and the question is not put again');
      assertEq(fs.readFileSync(file, 'utf8'), before, 'the file is left exactly as the owner has it');
      cleanup(world.root);
    }
  });

  await test('no home repo, no question: there would be nowhere to publish from', () => {
    const world = mkWorld();
    seedSettings(world, { repo: null, publish: null, url: null });
    const { out } = runCli(world, ['setup']);
    assert(/site: no home repo yet/.test(out), `it names why it did not ask, got: ${out}`);
    assert(!/nobody has been asked/.test(out), 'and does not hold the question open against nothing');
    cleanup(world.root);
  });

  await test('a settings file that does not parse is reported, never written over', () => {
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    fs.writeFileSync(file, '{ "version": 1, "site": {\n');
    const { code, said } = runCli(world, ['setup']);
    assertEq(code, 0, 'a broken file is not a crash');
    assert(/site: .*does not parse as JSON/.test(said), `it says what is wrong, got: ${said}`);
    assertEq(fs.readFileSync(file, 'utf8'), '{ "version": 1, "site": {\n', 'and the owner’s file is untouched');
    cleanup(world.root);
  });

  await test('the answer is recorded in the site options, and nothing else is', () => {
    // The write path the prompt calls, exercised directly: a terminal is the
    // one thing a test harness has no way to hand it.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: 'tower.example.com' });

    const yes = inCli(world, 'set_site_publish true');
    assertEq(yes.code, 0, `exit 0, got: ${yes.err}`);
    let site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, true, 'the yes is on disk');
    assertEq(site.repo, 'owner/workkit', 'the home repo is still there');
    assertEq(site.url, 'tower.example.com', 'and the custom domain');
    assert(/site: publishing is on/.test(yes.out), `and it says what it did, got: ${yes.out}`);

    const no = inCli(world, 'set_site_publish false');
    site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, false, 'a no is an answer too: false, not a missing key');
    assert(/site: publishing stays off/.test(no.out), `and it says so, got: ${no.out}`);
    cleanup(world.root);
  });

  await test('the write takes the state mutex, and gives it back', () => {
    // The same whole-file read-modify-write every other writer of this file
    // does, so it takes the one lock they all take (wk_take_state_lock, workflow/lib/state.sh).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.workflowHome, '.state.lock');
    fs.mkdirSync(lock, { recursive: true });
    const held = inCli(world, 'set_site_publish true');
    // Held by someone else: the write still happens (the engine never stops a
    // run on a lock), and the holder's lock is not removed by this one.
    assertEq(held.code, 0, 'exit 0');
    assert(fs.existsSync(lock), 'the lock is left to whoever took it');
    assertEq(JSON.parse(fs.readFileSync(file, 'utf8')).site.publish, true, 'and the answer landed');

    fs.rmdirSync(lock);
    inCli(world, 'set_site_publish false');
    assert(!fs.existsSync(lock), 'a run that took the lock drops it again');
    cleanup(world.root);
  });

  await test('a fresh yes is asked for the custom domain, and what is typed is written', () => {
    // The terminal check is the ONE thing a piped test cannot satisfy, so the
    // question step is called with `interactive` answering yes and the answers
    // arriving on stdin: everything else is the real function (issue #85).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.workflowHome, '.state.lock');

    const { code, out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\ntower.example.com\n' });
    assertEq(code, 0, `exit 0, got: ${out}`);
    assert(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up is put, got: ${out}`);
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, true, 'the yes landed');
    assertEq(site.url, 'tower.example.com', 'and the domain beside it');
    assertEq(site.repo, 'owner/workkit', 'the rest of the site options are untouched');
    assert(!fs.existsSync(lock), 'the domain write gave the state mutex back');
    cleanup(world.root);
  });

  await test('a fresh yes on a file with a severed tail is still asked about the domain', () => {
    // jq prints the value it parsed and THEN fails on the tail, so a default
    // appended to that answer reads as neither `null` nor a domain, and the
    // one run that puts the domain question skips it without a word.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    fs.appendFileSync(file, '{\n');
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\ntower.example.com\n' });
    assert(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up is still put, got: ${out}`);
    cleanup(world.root);
  });

  await test('an empty domain answer leaves the plain github.io address', () => {
    // Nothing written means `site.url` stays null, and publish.sh writes no
    // CNAME: enter IS an answer.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\n\n' });
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assert(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up was put, got: ${out}`);
    assertEq(site.publish, true, 'the yes is still recorded');
    assertEq(site.url, null, 'and no domain is invented');
    assert(/publishing is on/.test(out), `the publish answer still speaks, got: ${out}`);
    cleanup(world.root);
  });

  await test('a no is never asked about a domain', () => {
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'n\ntyped.example.com\n' });
    assert(!/Custom domain/.test(out), `no follow-up on the no leg, got: ${out}`);
    assertEq(JSON.parse(fs.readFileSync(file, 'utf8')).site.url, null, 'and nothing was read into the file');
    cleanup(world.root);
  });

  await test('an already-answered machine is asked about the domain no more than about the switch', () => {
    // The domain question rides the FRESH yes only: a machine that said yes
    // last week changes its domain by hand edit, as it does today.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'sneaky.example.com\n' });
    assert(!/Custom domain/.test(out), `no question, got: ${out}`);
    assertEq(fs.readFileSync(file, 'utf8'), before, 'and the owner’s file is exactly as it was');
    cleanup(world.root);
  });

  group('workkit setup: the site publish');

  await test('the switch ending on publishes before setup exits', () => {
    // Already true is an answer, and a piped run is not a reason to hold the
    // site back: the publish is not a question (issue #85). The engine's own
    // script names why it stopped, which is how the call is seen from here.
    const world = mkWorld();
    seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/publish: nothing is cloned at/.test(out), `publish.sh ran and named its own skip, got: ${out}`);
    cleanup(world.root);
  });

  await test('an off or unanswered switch adds no publish at all', () => {
    for (const publish of [false, null]) {
      const world = mkWorld();
      seedSettings(world, { repo: 'owner/workkit', publish, url: null });
      const { out } = runCli(world, ['setup']);
      assert(!/^.*publish: /m.test(out), `${publish} publishes nothing, got: ${out}`);
      cleanup(world.root);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
