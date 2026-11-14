// Tests for workflow/workkit.sh: the cloud brief secrets: `setup`'s
// wizard, the mint under a pty and its capture file, the forced re-mint
// (`setup --token`), and the automatic and report paths.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect, alive, readPid } = require('../../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../../lib/argv-log');
const { shellPath } = require('../../lib/platform');
const {
  cleanup, writeStub, mkWorld, skipWithoutPty, runCli, seedSettings, inCli, AT_TERMINAL, mkKit, SLUG,
  HOME, mkHomeWorld,
} = require('./helpers');

// Fictional values with no vendor's prefix: a committed credential-shaped
// literal trips push protection for everyone who clones the repo. What is
// asserted is that the value went from the command that produced it to
// `gh secret set`'s stdin, and appeared nowhere else.
const MINTED = 'FAKEmintedTOKENvalue0123456789';
const LOGIN_TOKEN = 'gho_FAKEloginTOKENfakeLOGINtoken00';

// The mint runs under a pty with its whole screen teed to the terminal, so
// the CLI's own copy of the token is on stdout by design. What must never
// happen is a second copy: workkit printing the value on a line of its own.
// The CLI's lines are the pass-through; workkit's all open with a glyph.
const countOf = (text, needle) => text.split(needle).length - 1;
const workkitLines = (text) => text.split('\n').filter((l) => /^ {0,2}[✓·›⚠✖⏳] /.test(l)).join('\n');

describe('workkit setup: the cloud secrets', () => {
  test('a machine with no home repo is a named skip, and nothing is asked of GitHub', () => {
    const world = mkWorld({ secrets: [] });
    seedSettings(world, { repo: null, publish: false, url: null });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(/secrets: this machine names no home repo/.test(out), `it names the skip, got: ${out}`).toBeTruthy();
    expect(!world.ghCalls().some((c) => isCall(c, 'secret')), `and asks about no repo's secrets: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('the secrets go to the home repo, never to the checkout’s own', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    runCli(world, ['setup'], { script });
    const calls = world.ghCalls().filter((c) => c[0] === 'secret');
    expect(calls.length > 0, `the secrets were asked about: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(calls.every((c) => c.includes(HOME)), `every call names the home repo: ${fmtCalls(calls)}`).toBeTruthy();
    expect(!calls.some((c) => c.includes(SLUG)), `and none names this checkout's repo: ${fmtCalls(calls)}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a listing that cannot be read is a skip, never a missing secret', () => {
    // The default gh prints nothing for `secret list`: an unauthenticated CLI,
    // a repo without Actions, no network. Reporting that as "not set" would
    // send a human to mint a token that is already there.
    const world = mkHomeWorld();
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    expect(new RegExp(`secrets: ${HOME}'s secrets could not be read`).test(out), `it says it could not read them, got: ${out}`).toBeTruthy();
    expect(!/is not set/.test(out), `and claims nothing about what is on the repo, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('without a terminal, an absent Claude token gets the two commands, never a mint', () => {
    const world = mkHomeWorld({ secrets: [] });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    expect(code, 'it finishes rather than waiting for an answer').toBe(0);
    expect(out.includes('claude setup-token'), `it hands over the mint, got: ${out}`).toBeTruthy();
    expect(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it').toBeTruthy();
    expect(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('answered yes, the mint goes straight into the secret and workkit prints it nowhere', { skip: skipWithoutPty() }, () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out, err } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    const calls = world.ghCalls();
    expect(calls.some((c) => isCall(c, 'secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', HOME)), `the secret is written on the named repo: ${fmtCalls(calls)}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and the value arrived on stdin: a pipe, not an argument').toBe(MINTED);
    expect(!calls.some((c) => c.includes(MINTED)), `the token is not an argument to anything: ${fmtCalls(calls)}`).toBeTruthy();
    expect(countOf(out + err, MINTED), `it is on the terminal once: the CLI's own screen, and no copy of workkit's: ${out}${err}`).toBe(1);
    expect(!workkitLines(out + err).includes(MINTED), `no line workkit printed carries it, got: ${workkitLines(out + err)}`).toBeTruthy();
    expect(out.includes('is set on'), `the run says the secret is set, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the default answer is no, and nothing is minted or written', { skip: skipWithoutPty() }, () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: '\n' });
    expect(/left as it is/.test(out), `an empty answer is a no, got: ${out}`).toBeTruthy();
    expect(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'nothing was minted').toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and no secret was written').toBe(undefined);
    cleanup(world.root);
  });

  test('a mint that printed no token warns instead of writing an empty secret', { skip: skipWithoutPty() }, () => {
    // An empty `gh secret set` would overwrite a working token with nothing.
    const world = mkWorld();
    const { said } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    expect(/printed no token/.test(said), `it says what did not happen, got: ${said}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and nothing was written').toBe(undefined);
    expect(world.tmpFiles().join(','), 'and the mint left no capture file behind').toBe('');
    cleanup(world.root);
  });

  test('the token is found whatever shape the mint printed it in', { skip: skipWithoutPty() }, () => {
    // Two shapes the mint has been seen in: a bare opaque value on the last
    // line, and the same value wrapped in a terminal's color codes. Both must
    // reach the secret byte for byte: a stray escape in a pushed token is a
    // cloud brief that fails to authenticate a month later.
    const ESC = '\u001b';
    for (const [shape, printed] of [
      ['a bare opaque value', MINTED],
      ['a value wrapped in color codes', `${ESC}[1;32m${MINTED}${ESC}[0m`],
    ]) {
      const world = mkWorld({ claudeToken: printed });
      const { out, err } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
      expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), `${shape} arrives as the value alone`).toBe(MINTED);
      expect(!workkitLines(out + err).includes(MINTED), `and no line workkit printed carries it, got: ${workkitLines(out + err)}`).toBeTruthy();
      cleanup(world.root);
    }
  });

  test('a vendor-prefixed token wins over any other line in the output', () => {
    // The prefixed shape is what the mint prints today, so it is read first,
    // asserted on the extraction itself, because a literal long enough to look
    // like the real thing has no business in a committed file.
    const world = mkWorld();
    const { out } = inCli(world, `printf '%s' "$(extract_token 'approve it in the browser
sk-ant-EXAMPLE
FAKEtrailingLINEthatIsLongEnough')"`);
    expect(out, 'the prefixed match, not the trailing opaque line').toBe('sk-ant-EXAMPLE');
    cleanup(world.root);
  });

  test('a token past eleven months is offered as a refresh; a fresh one is silent', () => {
    const stale = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }] });
    const staleKit = mkKit(SLUG);
    const staleOut = runCli(stale, ['setup'], { script: staleKit.script }).out;
    expect(/CLAUDE_CODE_OAUTH_TOKEN was set 40\d days ago/.test(staleOut), `it names the age, got: ${staleOut}`).toBeTruthy();
    expect(/lives about a year/.test(staleOut), 'and why that is worth a refresh').toBeTruthy();
    cleanup(stale.root); cleanup(staleKit.kit);

    const fresh = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 10 }] });
    const freshKit = mkKit(SLUG);
    const freshOut = runCli(fresh, ['setup'], { script: freshKit.script }).out;
    expect(!/claude setup-token/.test(freshOut), `a fresh token is not offered again, got: ${freshOut}`).toBeTruthy();
    expect(/CLAUDE_CODE_OAUTH_TOKEN is set on/.test(freshOut), 'it is reported as set, and nothing more').toBeTruthy();
    cleanup(fresh.root); cleanup(freshKit.kit);
  });

  test('the cross-repo token is set zero-click from the gh login, with no prompt at all', () => {
    // A piped run (no terminal to ask) still writes it, which is what "no
    // prompt" means here. The name contains `GITHUB_`, which the stub refuses
    // only as a prefix the way the live API does, so a write that lands proves
    // the name is a legal one.
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    const calls = world.ghCalls();
    expect(calls.some((c) => isCall(c, 'auth', 'token')), `the login's own token is read: ${fmtCalls(calls)}`).toBeTruthy();
    expect(calls.some((c) => isCall(c, 'secret', 'set', 'WORKKIT_GITHUB_TOKEN', '--repo', HOME)), `and pushed to the home repo: ${fmtCalls(calls)}`).toBeTruthy();
    expect(world.secretStdin('WORKKIT_GITHUB_TOKEN'), 'through stdin').toBe(LOGIN_TOKEN);
    expect(!out.includes(LOGIN_TOKEN), `and never printed, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('only a name that STARTS with GITHUB_ is refused: the shipped one is accepted', () => {
    // The secret's name rests on GitHub's actual rule, so it is asserted
    // against a stub that enforces that rule rather than against a comment: the
    // same push, twice, differing only in the secret's name.
    const world = mkHomeWorld({ authToken: LOGIN_TOKEN });
    const refused = inCli(world, `SECRET_HOME=GITHUB_TOKEN\npush_home_token ${HOME}`);
    expect(/GITHUB_TOKEN could not be written/.test(refused.said), `a leading GITHUB_ is refused: ${refused.said}`).toBeTruthy();
    expect(world.secretStdin('GITHUB_TOKEN'), 'and nothing was written under it').toBe(undefined);

    const shipped = inCli(world, `push_home_token ${HOME}`);
    expect(/WORKKIT_GITHUB_TOKEN is set on/.test(shipped.said), `a name that merely contains it lands: ${shipped.said}`).toBeTruthy();
    expect(world.secretStdin('WORKKIT_GITHUB_TOKEN'), 'with the value on stdin').toBe(LOGIN_TOKEN);
    cleanup(world.root);
  });

  test('a cross-repo token already on the repo is left exactly as it is', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 900 }],
      authToken: LOGIN_TOKEN,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    expect(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `no secret is rewritten: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(!/went from the mint|from this machine's gh login/.test(out), `and a set-up machine acts on nothing, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });
});

describe('workkit: the mint runs under a pty, and its capture file (issue #174)', () => {
  /** A machine whose home repo already carries a young Claude token. */
  const mkMintWorld = (opts = {}) => mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], ...opts });

  test('the CLI’s whole screen reaches the terminal, and the capture file is gone by the end', { skip: skipWithoutPty() }, () => {
    // The CLI draws its entire screen on stdout, so a captured stdout would
    // leave a blank line where the paste prompt should be. Both halves of the
    // screen (the stub's stdout and its stderr) are asserted, because under the
    // pty both are the same terminal.
    const world = mkMintWorld({ claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    expect(out.includes('Paste the authorization code here:'), `the prompt the CLI draws on stdout arrives, got: ${out}`).toBeTruthy();
    expect(out.includes('Opening your browser to approve this token'), `and everything else it draws, got: ${out}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'while the token is still caught and pushed on stdin').toBe(MINTED);
    expect(world.tmpFiles().join(','), 'and TMPDIR holds nothing afterwards').toBe('');
    cleanup(world.root);
  });

  test('a mint that did not finish is named with its exit status, and leaves no capture behind', { skip: skipWithoutPty() }, () => {
    // The interrupt path in the shape a test can produce: the CLI ends without
    // printing a token, its status crosses the pty wrapper, and the run says so
    // rather than writing an empty secret.
    const world = mkMintWorld({ mintExit: 3 });
    const { said } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    expect(/did not finish \(exit 3\)/.test(said), `the child's own status is reported, got: ${said}`).toBeTruthy();
    expect(said.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'with the command that does it by hand').toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and nothing was written').toBe(undefined);
    expect(world.tmpFiles().join(','), 'and TMPDIR holds nothing afterwards').toBe('');
    cleanup(world.root);
  });

  test('a machine with neither pty runner is a named skip with the two commands, and asks nothing', () => {
    // PATH is narrowed to the world's own shims after the CLI is loaded: this
    // machine has a `script` (and maybe `expect`), and the run that has
    // neither cannot be staged any other way. The claude stub is in that same
    // directory, so the check that fires is the one being tested.
    const world = mkHomeWorld({ secrets: [], claudeToken: MINTED });
    const { code, out } = inCli(world, `${AT_TERMINAL}\nPATH='${world.bin}'\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    expect(code, 'exit 0: a machine that cannot mint is not a failed run').toBe(0);
    expect(/needs `expect` or `script`/.test(out), `it names both runners it is missing (#187), got: ${out}`).toBeTruthy();
    expect(out.includes('claude setup-token'), 'and hands over the mint').toBeTruthy();
    expect(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it').toBeTruthy();
    expect(!/\[y\/N\]/.test(out), `the question is not even put, got: ${out}`).toBeTruthy();
    expect(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a GNU/util-linux `script` is spoken in its own syntax, and its -e carries the status back', () => {
    // The other `script` takes the command elsewhere, and only its `-e` returns
    // the child's status, or a mint that never ran reads as a success. This
    // machine speaks BSD, so GNU is pinned against a stub shaped like the real
    // utility (it answers `--version`, which BSD's refuses).
    const gnuScript = (world) => {
      const logFile = path.join(world.root, 'script-argv.log');
      writeStub(path.join(world.bin, 'script'), [
        recordArgv(logFile),
        'if [[ "$1" == \'--version\' ]]; then printf \'%s\\n\' \'script from util-linux 2.38\'; exit 0; fi',
        'e=0; cmd=\'\'; file=\'\'',
        'while [[ "$#" -gt 0 ]]; do',
        '  case "$1" in',
        '    -q) shift ;;',
        '    -e) e=1; shift ;;',
        '    -c) cmd="$2"; shift 2 ;;',
        '    *) file="$1"; shift ;;',
        '  esac',
        'done',
        'set -o pipefail',
        'rc=0; bash -c "$cmd" 2>&1 | tee "$file" || rc=$?',
        'if [[ "$e" -eq 1 ]]; then exit "$rc"; fi',
        'exit 0',
      ]);
      return () => readArgv(logFile);
    };

    const world = mkMintWorld({ claudeToken: MINTED });
    const calls = gnuScript(world);
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    expect(calls().some((c) => c.includes('-c') && c.includes('claude setup-token')), `the command is passed the way GNU takes it: ${fmtCalls(calls())}`).toBeTruthy();
    expect(calls().some((c) => c.includes('-e')), `with the flag that returns the child's status: ${fmtCalls(calls())}`).toBeTruthy();
    expect(out.includes('Paste the authorization code here:'), `the screen still reaches the terminal, got: ${out}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and the token is caught and pushed on stdin').toBe(MINTED);
    expect(world.tmpFiles().join(','), 'with no capture file left behind').toBe('');
    cleanup(world.root);

    const failed = mkMintWorld({ mintExit: 3 });
    gnuScript(failed);
    const failedOut = inCli(failed, `${AT_TERMINAL}\ncmd_setup --token`).said;
    expect(/did not finish \(exit 3\)/.test(failedOut), `a mint that did not finish is seen through it, got: ${failedOut}`).toBeTruthy();
    expect(failed.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and nothing was written').toBe(undefined);
    cleanup(failed.root);
  });
});

describe('workkit setup --token: the forced re-mint (issue #174)', () => {
  test('a young secret is re-minted anyway: the flag IS the yes', { skip: skipWithoutPty() }, () => {
    // A token that goes bad while young (a lapsed subscription) is the case the
    // age check cannot see. The terminal is the one thing this harness cannot
    // hand a run, so `interactive` answers yes; the flag, the parsing and the
    // step are the real thing.
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { out, err } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    const calls = world.ghCalls();
    expect(world.claudeCalls().some((c) => isCall(c, 'setup-token')), `the mint ran without being asked: ${fmtCalls(world.claudeCalls())}`).toBeTruthy();
    expect(calls.some((c) => isCall(c, 'secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', HOME)), `and the secret is written on the home repo: ${fmtCalls(calls)}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'through stdin: a pipe, not an argument').toBe(MINTED);
    expect(!workkitLines(out + err).includes(MINTED), `and no line workkit printed carries it, got: ${workkitLines(out + err)}`).toBeTruthy();
    expect(!/\[y\/N\]/.test(out), `no question is put, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('it runs the token step and nothing else of setup', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    expect(!world.claudeCalls().some((c) => isCall(c, 'plugin', 'install')), 'no plugin install').toBeTruthy();
    expect(!fs.existsSync(world.link), 'no symlink written').toBeTruthy();
    expect(!world.ghCalls().some((c) => isCall(c, 'secret', 'set', 'WORKKIT_GITHUB_TOKEN', '--repo', HOME)), 'and the other secret is left alone').toBeTruthy();
    for (const title of ['This machine', 'Home repo', 'Dashboard site', 'This repo']) {
      expect(!out.includes(title), `no "${title}" section, got: ${out}`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('without a terminal it hands over the two commands and mints nothing', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup', '--token'], { script });
    expect(code, 'it finishes rather than waiting for an approval nobody can give').toBe(0);
    expect(out.includes('claude setup-token'), `it hands over the mint, got: ${out}`).toBeTruthy();
    expect(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it').toBeTruthy();
    expect(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`).toBeTruthy();
    expect(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), 'and no secret was written').toBe(undefined);
    cleanup(world.root); cleanup(kit);
  });

  test('a machine with no claude CLI is a named skip, not a failure', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claude: false });
    const { code, out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    expect(code, 'exit 0').toBe(0);
    expect(/needs the claude CLI/.test(out), `it names the skip, got: ${out}`).toBeTruthy();
    expect(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `and writes nothing: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    cleanup(world.root);
  });

  test('setup refuses an option it does not know, and the map names this one', () => {
    const world = mkWorld();
    const { code, err } = runCli(world, ['setup', '--everything']);
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('unknown option'), `says so, got: ${err}`).toBeTruthy();
    expect(runCli(world, ['help']).out.includes('setup --token'), 'and help lists the flag it does know').toBeTruthy();
    cleanup(world.root);
  });
});

describe('workkit: the cloud secrets in the automatic and the report paths', () => {
  test('update --auto warns about each missing value and prompts for none', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN, claudeToken: MINTED, binOnPath: true });
    const { kit, script } = mkKit(SLUG);
    const { code, said } = runCli(world, ['update', '--auto'], { script });
    expect(code, 'exit 0').toBe(0);
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN']) {
      expect(new RegExp(`secrets: ${name} is not set on ${HOME}; run \`workkit setup\``).test(said), `one line for ${name}, got: ${said}`).toBeTruthy();
    }
    expect(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'the automatic path mints nothing').toBeTruthy();
    expect(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `and writes nothing: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('a listing that never answers is bounded, and the bound is a quiet skip', () => {
    // A captive portal answers the handshake and never the request. The daily
    // path runs this at session start, so an unbounded read would hold the
    // session open for as long as the portal felt like it. `exec` makes the
    // recorded pid the sleep itself, the process the bound must signal.
    const world = mkHomeWorld({ binOnPath: true });
    const pidFile = path.join(world.root, 'gh.pid');
    writeStub(path.join(world.root, 'bin', 'gh'), [
      `if [[ "$1" == 'secret' && "$2" == 'list' ]]; then echo $$ > '${shellPath(pidFile)}'; exec sleep 60; fi`,
      'exit 0',
    ]);
    // Five seconds: under a full parallel wave the stub's shell can take past
    // two to start, and a bound that lands before the pid is written proves nothing.
    world.env.WORKKIT_GH_TIMEOUT = '5';
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['update', '--auto'], { script });
    expect(code, 'exit 0').toBe(0);
    const pid = readPid(pidFile);
    // Git Bash's `$$` is an MSYS id Node cannot query, so there the exit code
    // and runCli's own no-timeout assert are the proof.
    if (process.platform !== 'win32') expect(!alive(pid), `the read is bounded rather than waited out: the listing ${pid} was ended`).toBeTruthy();
    expect(!/secrets:/.test(out), `and the quiet path stays quiet about it, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('update --auto says nothing about secrets that are set and fresh', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 3 }],
      binOnPath: true,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['update', '--auto'], { script });
    expect(!/secrets:/.test(out), `a session start hears nothing, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('update in a cloud session lists no secrets and says the step is not applicable', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN, binOnPath: true });
    world.env.CLAUDE_CODE_REMOTE = 'true';
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['update'], { script });
    expect(code, 'exit 0').toBe(0);
    expect(!world.ghCalls().some((c) => isCall(c, 'secret', 'list')), `no secret listing is asked for: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(out.includes('secrets: not applicable in a cloud session'), `the not-applicable line prints, got: ${out}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('doctor reports one line per value, and counts what needs attention', () => {
    const world = mkHomeWorld({
      pluginInstalled: true,
      binOnPath: true,
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 5 }],
    });
    const { kit, script } = mkKit(SLUG);
    const { out, err, said } = runCli(world, ['doctor'], { script });
    // The level is the stream: a warning is on stderr, and an ordinary report
    // line is on stdout.
    expect(new RegExp(`CLAUDE_CODE_OAUTH_TOKEN on ${HOME} was set 40\\d days ago`).test(err), `the old one is a warning with its age, got: ${err}`).toBeTruthy();
    expect(new RegExp(`WORKKIT_GITHUB_TOKEN is set on ${HOME} \\(5 days ago\\)`).test(out), `the fresh one is a plain report line, got: ${out}`).toBeTruthy();
    expect(/item\(s\) need attention/.test(said), 'the stale token is counted').toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });
});
