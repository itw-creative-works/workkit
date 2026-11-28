// Tests for workflow/workkit.js and workflow/workkit/main.js, the entry: the help
// and its text, the refusal of an unknown word, each argument handed on as typed
// through the links a machine reaches the command by, a kit missing one of the
// command's own files, and the entry started by its own path.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, joinPath, shellPath, samePath, skipWithoutFileLink, spawn,
} = require('../../lib/platform');
const { recordArgvJs, readArgv } = require('../../lib/argv-log');
const { recordingNode } = require('../../lib/node-fakes');
const {
  CLI, SLUG, mkWorld, runCli, mkKit,
} = require('./helpers');

// The help, byte for byte.
const HELP = `workkit: the issue workflow, one command.

usage: workkit <command> [args]

  help                 this map
  setup                from zero on this machine: the plugin, gh, the 9am
                       schedule, the home repo and whether it publishes its
                       dashboard, the cloud brief's secrets, the bot identity's
                       sign-in, the tower pointer, this repo's opt-in and the
                       App's install page for it, the workkit and gh
                       symlinks, and npm's script-shell. Safe to re-run
  setup --token        that wizard's Claude-token step alone, forced: mint a
                       new CLAUDE_CODE_OAUTH_TOKEN and push it to the home
                       repo, however young the one there is
  setup --login        that wizard's sign-in step alone, forced: sign in to
                       GitHub (the device flow) so the agent's issue
                       bookkeeping posts as workkit-agent[bot], replacing any
                       sign-in already here, with or without a terminal
  setup --bot          that wizard's App install step alone, forced: offer
                       workkit-agent[bot]'s install page, pre-selected on this
                       repo's owner, and wait until the install lands; sign
                       in first with setup --login
  setup --home         that wizard's home repo step alone, forced: create the
                       private <login>/workkit and make ~/.workkit/tower its
                       clone, asking nothing, with or without a terminal
  setup --cloud        that wizard for a cloud session: the workkit and gh
                       symlinks, npm's script-shell and the gh login check;
                       every other step is a not-applicable line, asking
                       nothing
  update [--auto]      re-run the machine-side installs: the engine address,
                       the workkit and gh symlinks, npm's script-shell, and
                       the schedule (only where one is already installed).
                       --auto is the quiet variant the standards hook runs
                       once a day
  doctor               report what is set up, what has drifted, and the command
                       that fixes anything out of reach
  publish              build the dashboard and publish it from the home repo
                       (the daily job does this after the morning brief)
  brief [--local]      ask for today's brief now: the same cloud run the 9am
                       schedule dispatches. --local runs the local morning
                       instead, composed and sent from this machine, the
                       brief never posted to the home repo
  log [-n N] [--follow]
                       the hooks log: one line per hook fire, its last 40
                       lines, or N; --follow keeps printing new ones
  tower [--verbose]    run the tower here: the JSON API and the dashboard
                       together, until one interrupt ends both
  enable [repo]        write the repo's committed opt-in, then heal it
  decline [repo]       record this developer's no for the repo, personally
  heal [repo]          re-run the standards heal on the repo now, the same
                       pass a session makes once a day, without the wait
  state [repo]         print the repo's participation: enabled, disabled,
                       declined, undecided, home or nogit
  note <text...>       append one bullet to the nearest capture file, or file it
                       as an issue on the home repo outside every project
  test [paths] [--filter=<text>]
                       hand the paths and the flag to this repo's npm test, run
                       at its root, so the script shell records the run
  tools                print each command this repo's suites name through
                       needs(), one per line, sorted, for a setup to install
  convert [paths...]   rewrite this repo's old-shape suites in place onto
                       Node's test functions, one line per file, from its root
  prove                run the root suite on exactly the staged tree, in a copy
                       outside the repo, and record it on green, so a commit
                       of it passes the gate while other work stays unstaged
  supervise -- <command> [args...]
                       run the command detached under the supervisor, as the
                       root suite runs, its output tailed here and in the run
                       log; exit its code, 124 frozen and ended, 125 a look
  watch [--end] [suite|run|<pid>]
                       follow the live run again: the suite's, else the
                       supervised one, else the one live narrowed run, or the
                       one named (a narrowed run by its pid); --end ends the
                       named run, or the one live run
  public intake        take each new issue on the paired public repo into this
                       repo's inbox, linked, with the intake comment on it
  public mirror <N>... | --all
                       copy each linked issue's status label onto its public
                       issue, posting nothing
  public close <version> <N>...
                       close each linked public issue with the version and its
                       CHANGELOG entry
  ship items           list the open issues at qa then complete, each with
                       whether it carries its Proof: line
  ship release <x.y.z> [--keep N,M]
                       the release: the bump, the [Unreleased] move and the
                       entry backfill, every check before any write
  ship watch <sha>     watch every CI run for a pushed sha and answer green or
                       red by exit code
  ship cut <x.y.z>     wait for the GitHub release CI's release job makes (any
                       earlier unreleased ones first), then run the repo's
                       afterRelease hooks; a caller with no release job, or no
                       release within the wait, is one line and exit 1
  ship plan            print which packages publish to npm, in which order,
                       and which are skipped and why; publishes nothing
  ship publish         publish that plan in order, asking npm first, stopping
                       at the first failure, then the repo's afterPublish hooks
  ship deploy          run the deploy script (else the release script), then
                       the repo's afterDeploy hooks; never asks
  review covers        whether the full-panel review marker covers the
                       working diff: exit 0 covered, 1 stale
  review mark [full]   record that the review ran on this repo; full records
                       the full panel too
  triage mark          record that a triage drain is under way, so the capture
                       guard lets it read the capture file
  checkpoint safe      record that a checkpoint put every item on the board,
                       keyed by this session, for a harness to read
  proof red [--live] <path>... -- <command>...
                       run the command against the paths as the claim found
                       them, so the tests must fail: exit 0 red, 1 green
  changelog lint <file> [--added-only [--base=<ref>]] [--staged] [--unreleased-only]
                       check the CHANGELOG entries against the entry format

The engine it drives lives beside this script; the spec both implement is
docs/project-state.md in the kit.
`;

const lines = (text) => text.split('\n').filter(Boolean);

describe('workkit: the help', () => {
  test('help, -h, --help, no argument and an empty one print the help on stdout, exit 0', () => {
    const world = mkWorld();
    for (const args of [[], ['help'], ['-h'], ['--help'], ['']]) {
      const { code, out, err } = runCli(world, args);
      expect(code, `[${args.join(' ')}] exits 0, got: ${out}${err}`).toBe(0);
      expect(out, `[${args.join(' ')}] prints the help`).toBe(HELP);
      expect(err, `[${args.join(' ')}] prints nothing on stderr`).toBe('');
    }
  });

  test('an unknown word: the error, an empty line and the help on stderr, nothing on stdout, exit 1', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['nope']);
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(err, 'the error, the empty line, the help').toBe(`✖ unknown command nope\n\n${HELP}`);
  });
});

describe('workkit: the arguments a routed program gets', () => {
  test('through ~/.local/bin/workkit, a link to the engine link\'s workkit.js, the kit behind them runs, each argument as typed', { skip: skipWithoutFileLink() }, () => {
    const world = mkWorld();
    const { kit } = mkKit(SLUG);
    const argvLog = path.join(world.root, 'prove-argv.log');
    const whereLog = path.join(world.root, 'prove-file');
    fs.writeFileSync(path.join(kit, 'workflow', 'prove.js'), [
      recordArgvJs(JSON.stringify(argvLog)),
      `require('fs').writeFileSync(${JSON.stringify(whereLog)}, __filename);`,
      'process.exit(3);',
    ].join('\n'));
    fs.mkdirSync(world.claudeHome, { recursive: true });
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(path.join(kit, 'workflow'), world.engineLink, 'junction');
    fs.symlinkSync(path.join(world.engineLink, 'workkit.js'), world.link, 'file');
    const typed = ['a b', "it's", '', 'say "hi"', '$HOME', '*'];
    const { code, out, err } = runCli(world, ['prove', ...typed], { script: world.link });
    expect(code, `the program's own code, got: ${out}${err}`).toBe(3);
    expect(readArgv(argvLog), 'each argument as typed, one call').toEqual([typed]);
    const ran = fs.readFileSync(whereLog, 'utf8');
    const wanted = fs.realpathSync(path.join(kit, 'workflow', 'prove.js'));
    expect(samePath(ran, wanted, process.platform), `the kit behind the links ran, got: ${ran}`).toBe(true);
  });
});

describe('workkit: a kit missing one of the command\'s own files', () => {
  test('a verb routed through the missing file gives the one line and 1; help, which needs it not, still runs', () => {
    const world = mkWorld();
    const { kit, script } = mkKit(SLUG);
    const missing = path.join(kit, 'workflow', 'workkit', 'verbs.js');
    fs.rmSync(missing);
    const { code, out, err } = runCli(world, ['prove'], { script });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(lines(err).length, `one line, got: ${err}`).toBe(1);
    const said = lines(err)[0].replace(/^✖ /, '').match(/^workkit: the kit is incomplete: (.+) is missing$/);
    expect(said !== null, `the incomplete-kit line, got: ${err}`).toBe(true);
    expect(samePath(said[1], missing, process.platform), `it names ${missing}, got: ${said[1]}`).toBe(true);
    const help = runCli(world, ['help'], { script });
    expect(help.code, `help exits 0, got: ${help.said}`).toBe(0);
    expect(help.out, 'and prints the help').toBe(HELP);
  });
});

describe('workkit: a HOME no cygpath can read', () => {
  // PATH is node's folder alone: Git's usr/bin, where cygpath lives, is left off.
  test('a HOME in the shell\'s spelling with no cygpath on PATH: the one line naming HOME and the fix, exit 1, no stack', {
    skip: !IS_WINDOWS && 'off Windows a home is never handed to cygpath',
  }, () => {
    const world = mkWorld();
    const home = shellPath(world.home);
    const { code, out, err } = runCli(world, ['help'], { env: { HOME: home, PATH: NODE_DIR } });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(out, 'nothing on stdout').toBe('');
    expect(err, 'the one line').toBe(`workkit: cannot read HOME (${home}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(err), `no stack line, got: ${err}`).toBe(false);
  });
});

describe('workkit: a kit under a folder whose name holds an apostrophe', () => {
  // Probed once: a system that refuses the name cannot answer the case.
  const refused = (() => {
    try {
      fs.mkdirSync(path.join(mkTmp('wk-main-apos-'), "it's probe"));
      return false;
    } catch (err) {
      return `this system refuses a folder named with an apostrophe (${err.code})`;
    }
  })();

  test('a missing file of the command\'s own: the one incomplete-kit line naming its path, exit 1, no stack', { skip: refused }, () => {
    const world = mkWorld();
    const { kit } = mkKit(SLUG);
    const moved = path.join(mkTmp('wk-main-apos-'), "it's kit");
    fs.renameSync(kit, moved);
    const missing = path.join(moved, 'workflow', 'workkit', 'verbs.js');
    fs.rmSync(missing);
    const { code, out, err } = runCli(world, ['prove'], { script: path.join(moved, 'workflow', 'workkit.js') });
    expect(code, `exit 1, got: ${out}${err}`).toBe(1);
    expect(lines(err).length, `one line and no stack, got: ${err}`).toBe(1);
    const said = lines(err)[0].replace(/^✖ /, '').match(/^workkit: the kit is incomplete: (.+) is missing$/);
    expect(said !== null, `the incomplete-kit line, got: ${err}`).toBe(true);
    expect(samePath(said[1], missing, process.platform), `it names ${missing}, got: ${said[1]}`).toBe(true);
  });
});

describe('workkit: the caller\'s environment and its reader', () => {
  const NO_LOG = /^· log: no hooks log at (.+) yet; the first hook fire writes it\n$/;

  test('QUIET=1 in the caller\'s environment does not quiet the command: its skip line still prints', () => {
    const world = mkWorld();
    const plain = runCli(world, ['log']);
    const quieted = runCli(world, ['log'], { env: { QUIET: '1' } });
    for (const [what, res] of [['plain', plain], ['QUIET=1', quieted]]) {
      expect(res.code, `${what}: exit 0, got: ${res.said}`).toBe(0);
      const named = res.out.match(NO_LOG);
      expect(named !== null, `${what}: the skip line, got: ${JSON.stringify(res.out)}`).toBe(true);
      expect(samePath(named[1], path.join(world.workflowHome, 'hooks.log'), process.platform), `${what}: it names the hooks log, got: ${named[1]}`).toBe(true);
    }
  });

  test('a reader that closes after the first chunk: the command ends with 141, and says nothing of it on stderr', async () => {
    const world = mkWorld();
    fs.mkdirSync(world.workflowHome, { recursive: true });
    const count = 200000;
    fs.writeFileSync(path.join(world.workflowHome, 'hooks.log'), Array.from({ length: count }, (_, i) => `hook line ${i}\n`).join(''));
    const child = spawn(process.execPath, [CLI, 'log', '-n', String(count)], { cwd: world.root, env: world.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.stdout.once('data', () => child.stdout.destroy());
    const end = await new Promise((resolve) => { child.once('close', (status, signal) => resolve({ status, signal })); });
    expect(end.status, `exit 141, got: ${JSON.stringify(end)}, stderr: ${err}`).toBe(141);
    expect(err.includes('EPIPE'), `no EPIPE on stderr, got: ${err}`).toBe(false);
    expect(/^\s+at /m.test(err), `no stack on stderr, got: ${err}`).toBe(false);
  });
});

describe('workkit.js started by its own path', () => {
  const NOT_HERE = IS_WINDOWS && 'Windows starts a .js file by its extension, never by its #! line or a mode';

  test('it runs as a program, under the first node on PATH', { skip: NOT_HERE }, () => {
    const bin = mkTmp('wk-main-bin-');
    const log = path.join(bin, 'node-argv.log');
    recordingNode(bin, { log });
    const res = run(CLI, ['help'], { env: { HOME: mkTmp('wk-main-home-'), PATH: joinPath(bin, SYSTEM_PATH) } });
    expect(res.status, `exit 0, got: ${res.output}`).toBe(0);
    expect(res.stdout, 'the help').toBe(HELP);
    expect(readArgv(log), 'the node first on PATH ran the entry, once').toEqual([[CLI, 'help']]);
  });
});
