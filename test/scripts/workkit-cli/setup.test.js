// Tests for workflow/workkit.sh: `setup`, its site question, and its site publish.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, WINDOWS_CSC, shellPath, gitPath, which, joinPath, cygpathStub,
} = require('../../lib/platform');
const {
  isCall, fmtCalls, recordArgv, readArgv,
} = require('../../lib/argv-log');
const {
  WORKFLOW_DIR, cleanup, mkWorld, withNpm, runCli, ACTED, mkRepo, seedSettings, inCli, AT_TERMINAL,
  writeStub, mkSetupKit, mkPartialKit,
} = require('./helpers');

describe('workkit setup', () => {
  test('a machine without the plugin has it installed from this checkout', () => {
    const world = mkWorld({ pluginInstalled: false });
    const { kit, script } = mkSetupKit();
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, `exit 0: stderr: ${out}`).toBe(0);
    const calls = world.claudeCalls();
    expect(calls.some((c) => isCall(c, 'plugin', 'marketplace', 'add', shellPath(kit))), `the marketplace is the checkout setup ran from: ${fmtCalls(calls)}`).toBeTruthy();
    expect(calls.some((c) => isCall(c, 'plugin', 'install', 'workkit@workkit')), `and the plugin is installed: ${fmtCalls(calls)}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a machine that already has it is left alone', () => {
    const world = mkWorld({ pluginInstalled: true });
    const { kit, script } = mkSetupKit();
    const { out } = runCli(world, ['setup'], { script });
    const calls = world.claudeCalls();
    expect(!calls.some((c) => isCall(c, 'plugin', 'install')), `nothing is reinstalled: ${fmtCalls(calls)}`).toBeTruthy();
    expect(out.includes('is installed'), `and it says so, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a machine with no claude CLI is a named skip, not a failure', () => {
    const world = mkWorld({ claude: false });
    const { kit, script } = mkSetupKit();
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(out.includes('claude CLI is not on this machine'), `it names the skip, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(world.link), 'and everything else still happens').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('an unauthenticated gh is reported with the command that fixes it', () => {
    const world = mkWorld({ ghAuthed: false });
    const { kit, script } = mkSetupKit();
    const { out } = runCli(world, ['setup'], { script });
    expect(out.includes('gh auth login'), `it prints the fix, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('without a terminal it prints the enable command instead of asking', () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const repo = mkRepo();
    const { code, out } = runCli(world, ['setup'], { cwd: repo, script });
    expect(code, 'it finishes rather than waiting for an answer').toBe(0);
    expect(out.includes('workkit enable'), `and hands over the command, got: ${out}`).toBeTruthy();
    expect(!fs.existsSync(path.join(repo, W)), 'a repo that never answered is not written to').toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('a repo already in the workflow is not offered again', () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const repo = mkRepo({ optIn: true });
    const { out } = runCli(world, ['setup'], { cwd: repo, script });
    expect(out.includes('is in the workflow'), `it reports the state, got: ${out}`).toBeTruthy();
    expect(!out.includes('workkit enable'), 'and asks nothing').toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  // `setup` at the terminal seam from an undecided repo, the answers on stdin.
  // The world has no node, no home repo and no login, so every other question
  // is a named skip and the one answer goes to the repo's.
  const repoQuestion = (input) => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const repo = mkRepo();
    const res = inCli(world, `${AT_TERMINAL}\ncd ${JSON.stringify(shellPath(repo))}\ncmd_setup`, { entry: script, input });
    return { ...res, repo, done: () => { cleanup(world.root); cleanup(kit); cleanup(repo); } };
  };

  test('the repo question answered YES enables the repo', () => {
    const { code, said, repo, done } = repoQuestion('YES\n');
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const file = path.join(repo, W, 'settings.json');
    expect(fs.existsSync(file), `the repo now carries its yes, got: ${said}`).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).enabled, 'enabled: true').toBe(true);
    done();
  });

  test('the repo question answered with Enter alone leaves the repo as it is', () => {
    const { code, said, repo, done } = repoQuestion('\n');
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(!fs.existsSync(path.join(repo, W)), 'nothing is written to the repo').toBeTruthy();
    expect(/repo: left as it is/.test(said), `and the skip line says so, got: ${said}`).toBeTruthy();
    done();
  });

  test('the repo question on a kit without lib.sh prints the skip line and asks nothing', () => {
    // The prompt is lib.sh's, so a kit without it (HOME_LIBS at 0) can only take
    // the no branch after a command-not-found; the guard names the library instead.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    fs.rmSync(path.join(kit, 'workflow', 'lib.sh'));
    const repo = mkRepo();
    const { said } = inCli(world, `${AT_TERMINAL}\ncd ${JSON.stringify(shellPath(repo))}\noffer_repo`, { entry: script, input: 'y\n' });
    const line = `repo: the home-repo library is missing beside ${gitPath(path.join(kit, 'workflow'))}; the kit is incomplete`;
    expect(said.split('\n').includes(line), `the skip line is the home wizard's, got: ${said}`).toBeTruthy();
    expect(!said.includes('to the issue workflow?'), `nothing is asked, got: ${said}`).toBeTruthy();
    expect(!/command not found/.test(said), `and nothing is called that is not there, got: ${said}`).toBeTruthy();
    expect(!fs.existsSync(path.join(repo, W)), 'the repo is not written to').toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('a second setup reports nothing to do', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkSetupKit();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo, script });
    const { code, said } = runCli(world, ['setup'], { cwd: repo, script });
    expect(code, 'exit 0').toBe(0);
    // `setup` has no quiet variant, so the verbs are the signal here: QUIET is
    // 0 and an action and a skip are the same shape of line.
    expect(!ACTED.test(said), `an already-set-up machine acts on nothing, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('setup offers the home repo, and a non-interactive run names workkit setup --home', () => {
    // The gh shim says who you are, so the home step reaches its question and,
    // with no terminal to put it to, hands over the command that answers it.
    // What this proves is the offer: the wizard reaches the home steps and
    // creates nothing without a terminal (workflow/home.sh's suite has the rest).
    const world = mkWorld({ login: 'owner' });
    const { kit, script } = mkSetupKit();
    const { code, said: out } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(/home:[^\n]*`workkit setup --home`/.test(out), `the home line names workkit setup --home, got: ${out}`).toBeTruthy();
    expect(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and nothing was converted without an answer').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('setup --home runs the home step alone, and a gh with no login is exit 1', () => {
    // The gh shim answers `auth status` only, so the forced step has no login.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { code, said: out } = runCli(world, ['setup', '--home'], { script });
    expect(code, `exit 1, got: ${out}`).toBe(1);
    expect(out.includes('🏠 workkit setup --home: the home repo'), `the title line, got: ${out}`).toBeTruthy();
    expect(/^\s*\S+ home:/m.test(out), `the home line, got: ${out}`).toBeTruthy();
    for (const step of ['plugin', 'gh', 'tower', 'site', 'repo']) {
      expect(!new RegExp(`^\\s*\\S+ ${step}:`, 'm').test(out), `no ${step}: line, nothing else of setup ran, got: ${out}`).toBeTruthy();
    }
    cleanup(world.root); cleanup(kit);
  });

  test('setup --home on a kit without its home library warns and is exit 1', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const { code, said: out } = runCli(world, ['setup', '--home'], { script });
    expect(code, `exit 1, got: ${out}`).toBe(1);
    expect(/home-repo library is missing/.test(out), `it names the missing library, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });
});

describe('workkit setup: the site question', () => {
  test('an unanswered switch is left unanswered where nobody can answer it', () => {
    // Non-interactive is the piped run: the question waits for a terminal
    // rather than being decided by silence, so a later `workkit setup` asks.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(/site: nobody has been asked/.test(out), `it says the question is still open, got: ${out}`).toBeTruthy();
    expect(/site: nobody has been asked[^\n]*`site\.publish`[^\n]*until then nothing is published/.test(out),
      `and it names site.publish as the answer without a terminal, nothing published until then, got: ${out}`).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8'), 'nothing was written on the machine’s behalf').toBe(before);
    cleanup(world.root); cleanup(kit);
  });

  test('an answered switch is never asked again, either way', () => {
    for (const [answer, said] of [[true, 'publishing is on'], [false, 'publishing is off']]) {
      const world = mkWorld();
      const { kit, script } = mkSetupKit();
      const file = seedSettings(world, { repo: 'owner/workkit', publish: answer, url: null });
      const before = fs.readFileSync(file, 'utf8');
      const { out } = runCli(world, ['setup'], { script });
      expect(out.includes(`site: ${said}`), `${answer} reads back as the answer it is, got: ${out}`).toBeTruthy();
      expect(!/nobody has been asked/.test(out), 'and the question is not put again').toBeTruthy();
      expect(fs.readFileSync(file, 'utf8'), 'the file is left exactly as the owner has it').toBe(before);
      cleanup(world.root); cleanup(kit);
    }
  });

  test('no home repo, no question: there would be nowhere to publish from', () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    seedSettings(world, { repo: null, publish: null, url: null });
    const { out } = runCli(world, ['setup'], { script });
    expect(/site: no home repo yet/.test(out), `it names why it did not ask, got: ${out}`).toBeTruthy();
    expect(!/nobody has been asked/.test(out), 'and does not hold the question open against nothing').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a settings file that does not parse is reported, never written over', () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    fs.writeFileSync(file, '{ "version": 1, "site": {\n');
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, 'a broken file is not a crash').toBe(0);
    expect(/site: .*does not parse as JSON/.test(said), `it says what is wrong, got: ${said}`).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8'), 'and the owner’s file is untouched').toBe('{ "version": 1, "site": {\n');
    cleanup(world.root); cleanup(kit);
  });

  test('the answer is recorded in the site options, and nothing else is', () => {
    // The write path the prompt calls, exercised directly: a terminal is the
    // one thing a test harness has no way to hand it.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: 'tower.example.com' });

    const yes = inCli(world, 'set_site_publish true');
    expect(yes.code, `exit 0, got: ${yes.err}`).toBe(0);
    let site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    expect(site.publish, 'the yes is on disk').toBe(true);
    expect(site.repo, 'the home repo is still there').toBe('owner/workkit');
    expect(site.url, 'and the custom domain').toBe('tower.example.com');
    expect(/site: publishing is on/.test(yes.out), `and it says what it did, got: ${yes.out}`).toBeTruthy();

    const no = inCli(world, 'set_site_publish false');
    site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    expect(site.publish, 'a no is an answer too: false, not a missing key').toBe(false);
    expect(/site: publishing stays off/.test(no.out), `and it says so, got: ${no.out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the write takes the state mutex, and gives it back', () => {
    // The same whole-file read-modify-write every other writer of this file
    // does, so it takes the one lock they all take (wk_take_state_lock, workflow/lib/state.sh).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.workflowHome, '.state.lock');
    fs.mkdirSync(lock, { recursive: true });
    const held = inCli(world, 'set_site_publish true');
    // Held by someone else: the write still happens (the engine never stops a
    // run on a lock), and the holder's lock is not removed by this one.
    expect(held.code, 'exit 0').toBe(0);
    expect(fs.existsSync(lock), 'the lock is left to whoever took it').toBeTruthy();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).site.publish, 'and the answer landed').toBe(true);

    fs.rmdirSync(lock);
    inCli(world, 'set_site_publish false');
    expect(!fs.existsSync(lock), 'a run that took the lock drops it again').toBeTruthy();
    cleanup(world.root);
  });

  test('a fresh yes is asked for the custom domain, and what is typed is written', () => {
    // The terminal check is the one thing a piped test cannot satisfy, so the
    // question step is called with `interactive` answering yes and the answers
    // arriving on stdin: everything else is the real function.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.workflowHome, '.state.lock');

    const { code, out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\ntower.example.com\n' });
    expect(code, `exit 0, got: ${out}`).toBe(0);
    expect(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up is put, got: ${out}`).toBeTruthy();
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    expect(site.publish, 'the yes landed').toBe(true);
    expect(site.url, 'and the domain beside it').toBe('tower.example.com');
    expect(site.repo, 'the rest of the site options are untouched').toBe('owner/workkit');
    expect(!fs.existsSync(lock), 'the domain write gave the state mutex back').toBeTruthy();
    cleanup(world.root);
  });

  test('a file with a severed tail is named and left alone, never asked over', () => {
    // A tail that does not parse makes the whole file unreadable, so the run
    // says so, asks nothing and writes nothing over the owner's file.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    fs.appendFileSync(file, '{\n');
    const before = fs.readFileSync(file, 'utf8');
    const { said } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\ntower.example.com\n' });
    expect(!/Publish the dashboard|Custom domain/.test(said), `no question is put, got: ${said}`).toBeTruthy();
    expect(said.split('\n').some((l) => l.includes('settings.json') && l.includes('does not parse')), `a warning names the file, got: ${said}`).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8'), 'the file is untouched').toBe(before);
    cleanup(world.root);
  });

  test('an empty domain answer leaves the plain github.io address', () => {
    // Nothing written means `site.url` stays null, and publish.sh writes no
    // CNAME: enter is an answer.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\n\n' });
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    expect(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up was put, got: ${out}`).toBeTruthy();
    expect(site.publish, 'the yes is still recorded').toBe(true);
    expect(site.url, 'and no domain is invented').toBe(null);
    expect(/publishing is on/.test(out), `the publish answer still speaks, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a no is never asked about a domain', () => {
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'n\ntyped.example.com\n' });
    expect(!/Custom domain/.test(out), `no follow-up on the no leg, got: ${out}`).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).site.url, 'and nothing was read into the file').toBe(null);
    cleanup(world.root);
  });

  test('an empty answer or a closed stdin records the publish switch as false', () => {
    for (const [label, input] of [['an empty answer', '\n'], ['a closed stdin', '']]) {
      const world = mkWorld();
      const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
      const { code, said } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input });
      expect(code, `${label}: exit 0, got: ${said}`).toBe(0);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).site.publish, `${label} is a no on disk: false, not null`).toBe(false);
      cleanup(world.root);
    }
  });

  test('an already-answered machine is asked about the domain no more than about the switch', () => {
    // The domain question rides the fresh yes only: a machine that said yes
    // last week changes its domain by hand edit, as it does today.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'sneaky.example.com\n' });
    expect(!/Custom domain/.test(out), `no question, got: ${out}`).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8'), 'and the owner’s file is exactly as it was').toBe(before);
    cleanup(world.root);
  });
});

describe('workkit setup: the site publish', () => {
  test('the switch ending on publishes before setup exits', () => {
    // Already true is an answer, and a piped run is not a reason to hold the
    // site back: the publish is not a question. The engine's own
    // script names why it stopped, which is how the call is seen from here.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(/publish: nothing is cloned at/.test(out), `publish.sh ran and named its own skip, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('an off or unanswered switch adds no publish at all', () => {
    for (const publish of [false, null]) {
      const world = mkWorld();
      const { kit, script } = mkSetupKit();
      seedSettings(world, { repo: 'owner/workkit', publish, url: null });
      const { out } = runCli(world, ['setup'], { script });
      expect(!/^.*publish: /m.test(out), `${publish} publishes nothing, got: ${out}`).toBeTruthy();
      cleanup(world.root); cleanup(kit);
    }
  });
});

describe('workkit setup: npm script-shell', () => {
  const npmrcShell = (npmrc) => (fs.existsSync(npmrc)
    ? (fs.readFileSync(npmrc, 'utf8').match(/^script-shell=(.*)$/m) || [])[1] : undefined);
  const HAS_NPM = Boolean(which('npm', NODE_DIR));
  // On Windows the step builds the script shell first, so a case there needs
  // the machine's compiler.
  const NO_CSC = IS_WINDOWS && !fs.existsSync(WINDOWS_CSC)
    ? `no C# compiler at ${WINDOWS_CSC}, so the script shell cannot be built` : '';
  const skipNpm = () => NO_CSC || (!HAS_NPM && 'no npm beside this node');
  // What npm is pointed at: the wrapper through the engine address, or on
  // Windows the built executable in git's spelling.
  const wantShell = (world) => (IS_WINDOWS
    ? gitPath(path.join(world.workflowHome, 'script-shell.exe'))
    : `${shellPath(world.engineLink)}/script-shell.sh`);

  test('unset: set to the wrapper at the engine address, then current on a second run', { skip: skipNpm() }, () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { npmrc, env } = withNpm(world);
    const want = wantShell(world);
    // A claude home lets setup lay the engine address the wrapper is named through.
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const first = runCli(world, ['setup'], { env, script });
    expect(first.code, `exit 0, got: ${first.said}`).toBe(0);
    expect(npmrcShell(npmrc), 'the user npmrc names the wrapper through the engine address').toBe(want);
    expect(first.said.includes(`npm: script-shell set to ${want}`), `it says what it did, got: ${first.said}`).toBeTruthy();
    const second = runCli(world, ['setup'], { env, script });
    expect(second.said.includes('npm: script-shell is current'), `a second run is a skip, got: ${second.said}`).toBeTruthy();
    expect(!second.said.includes('script-shell set to'), 'and sets nothing').toBeTruthy();
    const doctor = runCli(world, ['doctor'], { env, script });
    expect(/^ *✓ npm: script-shell is current$/m.test(doctor.out), `doctor reports it at the ok level, got: ${doctor.said}`).toBeTruthy();
    expect(/^ *· npm: script-shell is current$/m.test(second.out), `setup keeps the skip level, got: ${second.said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('another spelling of the same file reads as current, and is left as written', { skip: skipNpm() }, () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { npmrc, env } = withNpm(world);
    const want = wantShell(world);
    // A claude home lets setup lay the engine address, so the wanted path names
    // a real file for the other spelling to reach.
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const first = runCli(world, ['setup'], { env, script });
    expect(first.code, `exit 0, got: ${first.said}`).toBe(0);
    // A directory link to the folder the wanted path names the file through: a
    // junction on Windows, a symlink elsewhere (where the type is ignored).
    const dir = IS_WINDOWS ? world.workflowHome : world.engineLink;
    const file = IS_WINDOWS ? 'script-shell.exe' : 'script-shell.sh';
    const link = path.join(world.root, 'other-spelling');
    fs.symlinkSync(dir, link, 'junction');
    expect(fs.realpathSync(path.join(link, file)), 'both spellings reach one file').toBe(fs.realpathSync(path.join(dir, file)));
    const other = IS_WINDOWS ? gitPath(path.join(link, file)) : `${shellPath(link)}/${file}`;
    expect(other !== want, `the other spelling differs from the wanted one: ${other}`).toBeTruthy();
    fs.writeFileSync(npmrc, fs.readFileSync(npmrc, 'utf8').replace(/^script-shell=.*$/m, `script-shell=${other}`));
    expect(npmrcShell(npmrc), 'the npmrc names the file through the link').toBe(other);
    const second = runCli(world, ['setup'], { env, script });
    expect(second.code, `exit 0, got: ${second.said}`).toBe(0);
    expect(/^ *· npm: script-shell is current$/m.test(second.out), `setup reads it as current at the skip level, got: ${second.said}`).toBeTruthy();
    expect(!second.out.includes('set by someone else'), `no warning on stdout, got: ${second.out}`).toBeTruthy();
    expect(!second.err.includes('set by someone else'), `no warning on stderr, got: ${second.err}`).toBeTruthy();
    expect(!second.said.includes('npm config set script-shell'), `nor the command that changes it, got: ${second.said}`).toBeTruthy();
    expect(npmrcShell(npmrc), 'the value is left as written').toBe(other);
    const doctor = runCli(world, ['doctor'], { env, script });
    expect(/^ *✓ npm: script-shell is current$/m.test(doctor.out), `doctor reports it at the ok level, got: ${doctor.said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a foreign value is warned about, named, and left', { skip: skipNpm() }, () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { npmrc, env } = withNpm(world);
    fs.mkdirSync(world.claudeHome, { recursive: true });
    // A file that exists, so the warning is for another file, not a missing one.
    const foreign = path.join(world.root, 'other-shell');
    fs.writeFileSync(foreign, '');
    const value = IS_WINDOWS ? gitPath(foreign) : shellPath(foreign);
    fs.writeFileSync(npmrc, `script-shell=${value}\n`);
    const { code, err } = runCli(world, ['setup'], { env, script });
    expect(code, 'exit 0').toBe(0);
    expect(err.includes(`npm: script-shell is ${value}`), `a warning naming what is there, got: ${err}`).toBeTruthy();
    expect(err.includes('npm config set script-shell'), `and the command that changes it, got: ${err}`).toBeTruthy();
    expect(npmrcShell(npmrc), 'the value is left as it is').toBe(value);
    cleanup(world.root); cleanup(kit);
  });

  test("a link to the kit's shell file itself, in another folder, is someone else's value", { skip: skipNpm() }, () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { npmrc, env } = withNpm(world);
    // A claude home lets setup lay the engine address, so the shell file is real.
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const first = runCli(world, ['setup'], { env, script });
    expect(first.code, `exit 0, got: ${first.said}`).toBe(0);
    // A hard link on Windows, where a file symlink may need a privilege.
    const shell = IS_WINDOWS ? path.join(world.workflowHome, 'script-shell.exe') : path.join(world.engineLink, 'script-shell.sh');
    const elsewhere = path.join(world.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const link = path.join(elsewhere, path.basename(shell));
    if (IS_WINDOWS) fs.linkSync(shell, link); else fs.symlinkSync(shell, link);
    const value = IS_WINDOWS ? gitPath(link) : shellPath(link);
    fs.writeFileSync(npmrc, fs.readFileSync(npmrc, 'utf8').replace(/^script-shell=.*$/m, `script-shell=${value}`));
    expect(npmrcShell(npmrc), 'the npmrc names the link').toBe(value);
    const second = runCli(world, ['setup'], { env, script });
    expect(second.code, `exit 0, got: ${second.said}`).toBe(0);
    expect(second.err.includes('set by someone else'), `the warning, got: ${second.said}`).toBeTruthy();
    expect(second.err.includes(`npm: script-shell is ${value}`), `naming the value, got: ${second.err}`).toBeTruthy();
    expect(!second.said.includes('npm: script-shell is current'), `never read as current, got: ${second.said}`).toBeTruthy();
    expect(npmrcShell(npmrc), 'the value is left as written').toBe(value);
    cleanup(world.root); cleanup(kit);
  });

  test('no engine link: script-shell stays unset, and the skip names the missing link', { skip: skipNpm() }, () => {
    // No claude home, so setup lays no engine address and the wrapper it would
    // name (the Windows executable hands every call to it too) does not exist.
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { npmrc, env } = withNpm(world);
    const { code, said, out } = runCli(world, ['setup'], { env, script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(!fs.existsSync(world.engineLink), `the precondition: no engine link at ${world.engineLink}`).toBeTruthy();
    expect(npmrcShell(npmrc), 'npm is never pointed at a wrapper that is not there').toBe(undefined);
    expect(!said.includes('script-shell set to'), `and setup never says it was, got: ${said}`).toBeTruthy();
    expect(/^ *· npm:[^\n]*engine link[^\n]*missing/m.test(out), `a skip line naming the missing engine link, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('no npm on PATH: a named skip', { skip: NO_CSC || false }, () => {
    const world = mkWorld();
    const { kit, script } = mkSetupKit();
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(said.includes('npm: not on this machine'), `it names the skip, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  // The Windows branch driven from any machine: OSTYPE is what the kit reads a
  // platform by, a stub cygpath answers in git's spelling (the real one on
  // Windows), and SYSTEMROOT holds a stub compiler that writes its -out: file.
  const winWorld = (world, { compiler = true } = {}) => {
    const { npmrc, env } = withNpm(world);
    // The engine address the built executable hands every call through.
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.symlinkSync(WORKFLOW_DIR, world.engineLink, 'junction');
    const cyg = path.join(world.root, 'cygpath-bin');
    fs.mkdirSync(cyg, { recursive: true });
    cygpathStub(cyg);
    const systemRoot = path.join(world.root, 'windows');
    const cscDir = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
    fs.mkdirSync(cscDir, { recursive: true });
    const cscLog = path.join(world.root, 'csc-argv.log');
    if (compiler) {
      writeStub(path.join(cscDir, 'csc.exe'), [
        recordArgv(cscLog),
        'for a in "$@"; do case "$a" in -out:*) o="${a#-out:}"; : > "${o#C:}" ;; esac; done',
      ]);
    }
    return {
      npmrc,
      cscCalls: () => readArgv(cscLog),
      env: { ...env, PATH: joinPath(cyg, env.PATH), SYSTEMROOT: shellPath(systemRoot) },
    };
  };
  const skipStubCompiler = () => (IS_WINDOWS && 'a stub cygpath and compiler cannot stand in for the real ones on Windows')
    || (!HAS_NPM && 'no npm beside this node');

  test("Windows: builds the script shell with the machine's compiler and points npm at it in git's spelling; a second run is current", { skip: skipStubCompiler() }, () => {
    const world = mkWorld();
    const { npmrc, cscCalls, env } = winWorld(world);
    const exe = path.join(world.workflowHome, 'script-shell.exe');
    const first = inCli(world, 'OSTYPE=msys\nscript_shell', { env });
    expect(first.code, `exit 0, got: ${first.said}`).toBe(0);
    expect(fs.existsSync(exe), `the executable is built in the machine's own folder, got: ${first.said}`).toBeTruthy();
    const calls = cscCalls();
    expect(calls.length, `the compiler ran once: ${fmtCalls(calls)}`).toBe(1);
    expect(calls[0].includes('-target:exe'), `as a console program: ${fmtCalls(calls)}`).toBeTruthy();
    expect(calls[0].includes(`-out:C:${exe}`), `into the executable: ${fmtCalls(calls)}`).toBeTruthy();
    expect(calls[0][calls[0].length - 1].endsWith('script-shell.cs'), `from the kit's source: ${fmtCalls(calls)}`).toBeTruthy();
    expect(npmrcShell(npmrc), "npm names the executable in git's spelling").toBe(`C:${exe}`);
    expect(first.said.includes('npm: built'), `it says what it built, got: ${first.said}`).toBeTruthy();
    const second = inCli(world, 'OSTYPE=msys\nscript_shell', { env });
    expect(second.said.includes('npm: script-shell is current'), `a second run is current, got: ${second.said}`).toBeTruthy();
    expect(cscCalls().length, 'and compiles nothing').toBe(1);
    cleanup(world.root);
  });

  test('Windows: --auto builds nothing and sets nothing', { skip: skipStubCompiler() }, () => {
    const world = mkWorld();
    const { npmrc, cscCalls, env } = winWorld(world);
    const { code, said } = inCli(world, 'OSTYPE=msys\nQUIET=1\nscript_shell', { env });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(cscCalls().length, `the compiler never ran: ${fmtCalls(cscCalls())}`).toBe(0);
    expect(!fs.existsSync(path.join(world.workflowHome, 'script-shell.exe')), 'no executable was built').toBeTruthy();
    expect(npmrcShell(npmrc), 'and no npmrc was written').toBe(undefined);
    expect(!said.includes('npm:'), `and nothing is said about npm, got: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('Windows: doctor warns when the executable is older than its source', { skip: skipStubCompiler() }, () => {
    const world = mkWorld();
    const { env } = winWorld(world);
    const exe = path.join(world.workflowHome, 'script-shell.exe');
    const built = inCli(world, 'OSTYPE=msys\nscript_shell', { env });
    expect(fs.existsSync(exe), `the human path built it, got: ${built.said}`).toBeTruthy();
    const stale = fs.statSync(path.join(WORKFLOW_DIR, 'script-shell.cs')).mtimeMs / 1000 - 3600;
    fs.utimesSync(exe, stale, stale);
    const { out, err } = inCli(world, 'OSTYPE=msys\nrc=0\nscript_shell doctor || rc=$?\necho "rc=$rc"', { env });
    expect(out.includes('rc=1'), `doctor asks for attention, got: ${out}`).toBeTruthy();
    expect(err.includes('is missing or older than script-shell.cs; run `workkit update`'), `naming the fix, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('Windows: no compiler is a named skip, and nothing is set', () => {
    const world = mkWorld();
    const { npmrc, env } = winWorld(world, { compiler: false });
    const { code, said } = inCli(world, 'OSTYPE=msys\nscript_shell', { env });
    expect(code, 'exit 0').toBe(0);
    expect(/npm: no C# compiler at .*csc\.exe, so the Windows script shell cannot be built and script-shell stays unset/.test(said),
      `the skip names the compiler, got: ${said}`).toBeTruthy();
    expect(npmrcShell(npmrc), 'and no npmrc was written').toBe(undefined);
    cleanup(world.root);
  });

  test('Windows: doctor warns when the executable is missing', () => {
    const world = mkWorld();
    const { env } = winWorld(world, { compiler: false });
    const { out, err } = inCli(world, 'OSTYPE=msys\nrc=0\nscript_shell doctor || rc=$?\necho "rc=$rc"', { env });
    expect(out.includes('rc=1'), `doctor asks for attention, got: ${out}`).toBeTruthy();
    expect(err.includes('is missing or older than script-shell.cs; run `workkit update`'), `naming the fix, got: ${err}`).toBeTruthy();
    cleanup(world.root);
  });
});
