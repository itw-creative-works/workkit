//
// Tests for workflow/workkit.sh: the cloud brief secrets: `setup`'s
// wizard, the mint under a pty and its capture file, the forced re-mint
// (`setup --token`), and the automatic and report paths.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, writeStub, mkWorld, mintTest, runCli, seedSettings, inCli, AT_TERMINAL, mkKit, SLUG,
  HOME, mkHomeWorld,
} = require('./helpers');

const run = async () => {
  group('workkit setup: the cloud secrets');

  // The fictional values these tests move around. Nothing here is a real token,
  // and nothing here carries a vendor's prefix either: a committed literal
  // shaped like a credential trips push protection for everyone who clones the
  // repo. What is asserted is that the value went from the command that
  // produced it to `gh secret set`'s stdin, and appeared nowhere else.
  const MINTED = 'FAKEmintedTOKENvalue0123456789';
  const LOGIN_TOKEN = 'gho_FAKEloginTOKENfakeLOGINtoken00';

  // Since issue #174 the mint runs under a pty and its whole screen is teed to
  // the terminal, so the CLI's own copy of the token is on stdout by design:
  // that is the screen the human reads the paste prompt on. What must never
  // happen is a SECOND copy: workkit printing the value on a line of its own.
  // The CLI's lines are the pass-through; workkit's all open with a glyph.
  const countOf = (text, needle) => text.split(needle).length - 1;
  const workkitLines = (text) => text.split('\n').filter((l) => /^ {0,2}[✓·›⚠✖⏳] /.test(l)).join('\n');

  await test('a machine with no home repo is a named skip, and nothing is asked of GitHub', () => {
    const world = mkWorld({ secrets: [] });
    seedSettings(world, { repo: null, publish: false, url: null });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    assertEq(code, 0, 'exit 0');
    assert(/secrets: this machine names no home repo/.test(out), `it names the skip, got: ${out}`);
    assert(!world.ghCalls().some((c) => isCall(c, 'secret')), `and asks about no repo's secrets: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('the secrets go to the home repo, never to the checkout’s own', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    runCli(world, ['setup'], { script });
    const calls = world.ghCalls().filter((c) => c[0] === 'secret');
    assert(calls.length > 0, `the secrets were asked about: ${fmtCalls(world.ghCalls())}`);
    assert(calls.every((c) => c.includes(HOME)), `every call names the home repo: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.includes(SLUG)), `and none names this checkout's repo: ${fmtCalls(calls)}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a listing that cannot be read is a skip, never a missing secret', () => {
    // The default gh prints nothing for `secret list`: an unauthenticated CLI,
    // a repo without Actions, no network. Reporting that as "not set" would
    // send a human to mint a token that is already there.
    const world = mkHomeWorld();
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    assert(new RegExp(`secrets: ${HOME}'s secrets could not be read`).test(out), `it says it could not read them, got: ${out}`);
    assert(!/is not set/.test(out), `and claims nothing about what is on the repo, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('without a terminal, an absent Claude token gets the two commands, never a mint', () => {
    const world = mkHomeWorld({ secrets: [] });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(out.includes('claude setup-token'), `it hands over the mint, got: ${out}`);
    assert(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it');
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await mintTest('answered yes, the mint goes straight into the secret and workkit prints it nowhere', () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out, err } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    const calls = world.ghCalls();
    assert(calls.some((c) => isCall(c, 'secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', HOME)), `the secret is written on the named repo: ${fmtCalls(calls)}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, 'and the value arrived on stdin: a pipe, not an argument');
    assert(!calls.some((c) => c.includes(MINTED)), `the token is not an argument to anything: ${fmtCalls(calls)}`);
    assertEq(countOf(out + err, MINTED), 1, `it is on the terminal once: the CLI's own screen, and no copy of workkit's: ${out}${err}`);
    assert(!workkitLines(out + err).includes(MINTED), `no line workkit printed carries it, got: ${workkitLines(out + err)}`);
    assert(out.includes('is set on'), `the run says the secret is set, got: ${out}`);
    cleanup(world.root);
  });

  await mintTest('the default answer is no, and nothing is minted or written', () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: '\n' });
    assert(/left as it is/.test(out), `an empty answer is a no, got: ${out}`);
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'nothing was minted');
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and no secret was written');
    cleanup(world.root);
  });

  await mintTest('a mint that printed no token warns instead of writing an empty secret', () => {
    // An empty `gh secret set` would overwrite a working token with nothing.
    const world = mkWorld();
    const { said } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    assert(/printed no token/.test(said), `it says what did not happen, got: ${said}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and nothing was written');
    assertEq(world.tmpFiles().join(','), '', 'and the mint left no capture file behind');
    cleanup(world.root);
  });

  await mintTest('the token is found whatever shape the mint printed it in', () => {
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
      assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, `${shape} arrives as the value alone`);
      assert(!workkitLines(out + err).includes(MINTED), `and no line workkit printed carries it, got: ${workkitLines(out + err)}`);
      cleanup(world.root);
    }
  });

  await test('a vendor-prefixed token wins over any other line in the output', () => {
    // The prefixed shape is what the mint prints today, so it is read first,
    // asserted on the extraction itself, because a literal long enough to look
    // like the real thing has no business in a committed file.
    const world = mkWorld();
    const { out } = inCli(world, `printf '%s' "$(extract_token 'approve it in the browser
sk-ant-EXAMPLE
FAKEtrailingLINEthatIsLongEnough')"`);
    assertEq(out, 'sk-ant-EXAMPLE', 'the prefixed match, not the trailing opaque line');
    cleanup(world.root);
  });

  await test('a token past eleven months is offered as a refresh; a fresh one is silent', () => {
    const stale = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }] });
    const staleKit = mkKit(SLUG);
    const staleOut = runCli(stale, ['setup'], { script: staleKit.script }).out;
    assert(/CLAUDE_CODE_OAUTH_TOKEN was set 40\d days ago/.test(staleOut), `it names the age, got: ${staleOut}`);
    assert(/lives about a year/.test(staleOut), 'and why that is worth a refresh');
    cleanup(stale.root); cleanup(staleKit.kit);

    const fresh = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 10 }] });
    const freshKit = mkKit(SLUG);
    const freshOut = runCli(fresh, ['setup'], { script: freshKit.script }).out;
    assert(!/claude setup-token/.test(freshOut), `a fresh token is not offered again, got: ${freshOut}`);
    assert(/CLAUDE_CODE_OAUTH_TOKEN is set on/.test(freshOut), 'it is reported as set, and nothing more');
    cleanup(fresh.root); cleanup(freshKit.kit);
  });

  await test('the cross-repo token is set zero-click from the gh login, with no prompt at all', () => {
    // Owner ruling 2026-07-30: maximum automation. A piped run (no terminal to
    // ask) still writes it, which is what "no prompt" means here. The name
    // CONTAINS `GITHUB_`, which the stub refuses only as a prefix the way the
    // live API does, so a write that lands proves the name is a legal one.
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    const calls = world.ghCalls();
    assert(calls.some((c) => isCall(c, 'auth', 'token')), `the login's own token is read: ${fmtCalls(calls)}`);
    assert(calls.some((c) => isCall(c, 'secret', 'set', 'WORKKIT_GITHUB_TOKEN', '--repo', HOME)), `and pushed to the home repo: ${fmtCalls(calls)}`);
    assertEq(world.secretStdin('WORKKIT_GITHUB_TOKEN'), LOGIN_TOKEN, 'through stdin');
    assert(!out.includes(LOGIN_TOKEN), `and never printed, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('only a name that STARTS with GITHUB_ is refused: the shipped one is accepted', () => {
    // The rename in issue #91 rests on GitHub's actual rule, so it is asserted
    // against a stub that enforces that rule rather than against a comment: the
    // same push, twice, differing only in the secret's name.
    const world = mkHomeWorld({ authToken: LOGIN_TOKEN });
    const refused = inCli(world, `SECRET_HOME=GITHUB_TOKEN\npush_home_token ${HOME}`);
    assert(/GITHUB_TOKEN could not be written/.test(refused.said), `a leading GITHUB_ is refused: ${refused.said}`);
    assertEq(world.secretStdin('GITHUB_TOKEN'), undefined, 'and nothing was written under it');

    const shipped = inCli(world, `push_home_token ${HOME}`);
    assert(/WORKKIT_GITHUB_TOKEN is set on/.test(shipped.said), `a name that merely contains it lands: ${shipped.said}`);
    assertEq(world.secretStdin('WORKKIT_GITHUB_TOKEN'), LOGIN_TOKEN, 'with the value on stdin');
    cleanup(world.root);
  });

  await test('a cross-repo token already on the repo is left exactly as it is', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 900 }],
      authToken: LOGIN_TOKEN,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `no secret is rewritten: ${fmtCalls(world.ghCalls())}`);
    assert(!/went from the mint|from this machine's gh login/.test(out), `and a set-up machine acts on nothing, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a second setup writes neither of them again', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 3 }],
      authToken: LOGIN_TOKEN,
    });
    const { kit, script } = mkKit(SLUG);
    runCli(world, ['setup'], { script });
    const before = world.ghCalls().filter((c) => isCall(c, 'secret', 'set')).length;
    runCli(world, ['setup'], { script });
    const after = world.ghCalls().filter((c) => isCall(c, 'secret', 'set')).length;
    assertEq(after, before, 'running twice equals running once');
    assertEq(before, 0, 'and a repo that already has both is not written to at all');
    cleanup(world.root); cleanup(kit);
  });

  group('workkit: the mint runs under a pty, and its capture file (issue #174)');

  /** A machine whose home repo already carries a young Claude token. */
  const mkMintWorld = (opts = {}) => mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], ...opts });

  await mintTest('the CLI’s whole screen reaches the terminal, and the capture file is gone by the end', () => {
    // The QA failure this fixes: the CLI draws its ENTIRE screen on stdout, so
    // a captured stdout left the human with a blank line where the paste
    // prompt should be. Both halves of the screen are asserted (the one the
    // stub draws on stdout and the one it draws on stderr) because under the
    // pty both are the same terminal.
    const world = mkMintWorld({ claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assert(out.includes('Paste the authorization code here:'), `the prompt the CLI draws on stdout arrives, got: ${out}`);
    assert(out.includes('Opening your browser to approve this token'), `and everything else it draws, got: ${out}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, 'while the token is still caught and pushed on stdin');
    assertEq(world.tmpFiles().join(','), '', 'and TMPDIR holds nothing afterwards');
    cleanup(world.root);
  });

  await mintTest('a mint that did not finish is named with its exit status, and leaves no capture behind', () => {
    // The interrupt path in the shape a test can produce: the CLI ends without
    // printing a token, its status crosses the pty wrapper, and the run says so
    // rather than writing an empty secret.
    const world = mkMintWorld({ mintExit: 3 });
    const { said } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assert(/did not finish \(exit 3\)/.test(said), `the child's own status is reported, got: ${said}`);
    assert(said.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'with the command that does it by hand');
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and nothing was written');
    assertEq(world.tmpFiles().join(','), '', 'and TMPDIR holds nothing afterwards');
    cleanup(world.root);
  });

  await test('a machine with neither pty runner is a named skip with the two commands, and asks nothing', () => {
    // PATH is narrowed to the world's own shims AFTER the CLI is loaded: this
    // machine has a `script` (and maybe `expect`), and the run that has
    // neither cannot be staged any other way. The claude stub is in that same
    // directory, so the check that fires is the one being tested.
    const world = mkHomeWorld({ secrets: [], claudeToken: MINTED });
    const { code, out } = inCli(world, `${AT_TERMINAL}\nPATH='${world.bin}'\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    assertEq(code, 0, 'exit 0: a machine that cannot mint is not a failed run');
    assert(/needs `expect` or `script`/.test(out), `it names both runners it is missing (#187), got: ${out}`);
    assert(out.includes('claude setup-token'), 'and hands over the mint');
    assert(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it');
    assert(!/\[y\/N\]/.test(out), `the question is not even put, got: ${out}`);
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`);
    cleanup(world.root);
  });

  await test('a GNU/util-linux `script` is spoken in its own syntax, and its -e carries the status back', () => {
    // The other `script`. It takes the command in a different place, and only
    // its `-e` returns the child's status: without it a mint that never ran
    // would read as one that succeeded. This machine speaks the BSD syntax, so
    // the GNU one is pinned against a stub shaped like the real utility (it
    // answers `--version`, which BSD's refuses), the way the gh stub is shaped
    // like the live API.
    const gnuScript = (world) => {
      const log = path.join(world.root, 'script-argv.log');
      writeStub(path.join(world.bin, 'script'), [
        recordArgv(log),
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
      return () => readArgv(log);
    };

    const world = mkMintWorld({ claudeToken: MINTED });
    const calls = gnuScript(world);
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assert(calls().some((c) => c.includes('-c') && c.includes('claude setup-token')), `the command is passed the way GNU takes it: ${fmtCalls(calls())}`);
    assert(calls().some((c) => c.includes('-e')), `with the flag that returns the child's status: ${fmtCalls(calls())}`);
    assert(out.includes('Paste the authorization code here:'), `the screen still reaches the terminal, got: ${out}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, 'and the token is caught and pushed on stdin');
    assertEq(world.tmpFiles().join(','), '', 'with no capture file left behind');
    cleanup(world.root);

    const failed = mkMintWorld({ mintExit: 3 });
    gnuScript(failed);
    const failedOut = inCli(failed, `${AT_TERMINAL}\ncmd_setup --token`).said;
    assert(/did not finish \(exit 3\)/.test(failedOut), `a mint that did not finish is seen through it, got: ${failedOut}`);
    assertEq(failed.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and nothing was written');
    cleanup(failed.root);
  });

  group('workkit setup --token: the forced re-mint (issue #174)');

  await mintTest('a young secret is re-minted anyway: the flag IS the yes', () => {
    // The token that goes bad while young (a lapsed subscription) is the case
    // the age check cannot see: three days old, and nothing about it is stale.
    // The terminal is the one thing this harness cannot hand a run, so the
    // command is called with `interactive` answering yes; everything else
    // (the flag, the parsing, the step) is the real thing.
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { out, err } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    const calls = world.ghCalls();
    assert(world.claudeCalls().some((c) => isCall(c, 'setup-token')), `the mint ran without being asked: ${fmtCalls(world.claudeCalls())}`);
    assert(calls.some((c) => isCall(c, 'secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', HOME)), `and the secret is written on the home repo: ${fmtCalls(calls)}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, 'through stdin: a pipe, not an argument');
    assert(!workkitLines(out + err).includes(MINTED), `and no line workkit printed carries it, got: ${workkitLines(out + err)}`);
    assert(!/\[y\/N\]/.test(out), `no question is put, got: ${out}`);
    cleanup(world.root);
  });

  await test('it runs the token step and nothing else of setup', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assert(!world.claudeCalls().some((c) => isCall(c, 'plugin', 'install')), 'no plugin install');
    assert(!fs.existsSync(world.link), 'no symlink written');
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set', 'WORKKIT_GITHUB_TOKEN', '--repo', HOME)), 'and the other secret is left alone');
    for (const title of ['This machine', 'Home repo', 'Dashboard site', 'This repo']) {
      assert(!out.includes(title), `no "${title}" section, got: ${out}`);
    }
    cleanup(world.root);
  });

  await test('without a terminal it hands over the two commands and mints nothing', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claudeToken: MINTED });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup', '--token'], { script });
    assertEq(code, 0, 'it finishes rather than waiting for an approval nobody can give');
    assert(out.includes('claude setup-token'), `it hands over the mint, got: ${out}`);
    assert(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it');
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and no secret was written');
    cleanup(world.root); cleanup(kit);
  });

  await test('a machine with no claude CLI is a named skip, not a failure', () => {
    const world = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }], claude: false });
    const { code, out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assertEq(code, 0, 'exit 0');
    assert(/needs the claude CLI/.test(out), `it names the skip, got: ${out}`);
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `and writes nothing: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('a machine with no home repo keeps the precheck’s own skip', () => {
    const world = mkWorld({ secrets: [], claudeToken: MINTED });
    seedSettings(world, { repo: null, publish: false, url: null });
    const { code, out } = inCli(world, `${AT_TERMINAL}\ncmd_setup --token`);
    assertEq(code, 0, 'exit 0');
    assert(/secrets: this machine names no home repo/.test(out), `the precheck's skip stands, got: ${out}`);
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'and nothing is minted for a repo that does not exist');
    cleanup(world.root);
  });

  await test('setup refuses an option it does not know, and the map names this one', () => {
    const world = mkWorld();
    const { code, err } = runCli(world, ['setup', '--everything']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('unknown option'), `says so, got: ${err}`);
    assert(runCli(world, ['help']).out.includes('setup --token'), 'and help lists the flag it does know');
    cleanup(world.root);
  });

  group('workkit: the cloud secrets in the automatic and the report paths');

  await test('update --auto warns about each missing value and prompts for none', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN, claudeToken: MINTED, binOnPath: true });
    const { kit, script } = mkKit(SLUG);
    const { code, said } = runCli(world, ['update', '--auto'], { script });
    assertEq(code, 0, 'exit 0');
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN']) {
      assert(new RegExp(`secrets: ${name} is not set on ${HOME}; run \`workkit setup\``).test(said), `one line for ${name}, got: ${said}`);
    }
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'the automatic path mints nothing');
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `and writes nothing: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a listing that never answers is bounded, and the bound is a quiet skip', () => {
    // A captive portal answers the handshake and never the request. The daily
    // path runs this at session start, so an unbounded read would hold the
    // session open for as long as the portal felt like it. `exec` matters: the
    // stub must BE the process the bound signals, the way real gh is.
    const world = mkHomeWorld({ binOnPath: true });
    writeStub(path.join(world.root, 'bin', 'gh'), [
      'if [[ "$1" == \'secret\' && "$2" == \'list\' ]]; then exec sleep 60; fi',
      'exit 0',
    ]);
    world.env.WORKKIT_GH_TIMEOUT = '2';
    const { kit, script } = mkKit(SLUG);
    const started = Date.now();
    const { code, out } = runCli(world, ['update', '--auto'], { script });
    const elapsed = (Date.now() - started) / 1000;
    assertEq(code, 0, 'exit 0');
    assert(elapsed < 20, `the read is bounded rather than waited out, took ${elapsed}s`);
    assert(!/secrets:/.test(out), `and the quiet path stays quiet about it, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('update --auto says nothing about secrets that are set and fresh', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 3 }],
      binOnPath: true,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['update', '--auto'], { script });
    assert(!/secrets:/.test(out), `a session start hears nothing, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('doctor reports one line per value, and counts what needs attention', () => {
    const world = mkHomeWorld({
      pluginInstalled: true,
      binOnPath: true,
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 5 }],
    });
    const { kit, script } = mkKit(SLUG);
    const { out, err, said } = runCli(world, ['doctor'], { script });
    // The level is the STREAM now (issue #237): a warning is on stderr, and an
    // ordinary report line is on stdout.
    assert(new RegExp(`CLAUDE_CODE_OAUTH_TOKEN on ${HOME} was set 40\\d days ago`).test(err), `the old one is a warning with its age, got: ${err}`);
    assert(new RegExp(`WORKKIT_GITHUB_TOKEN is set on ${HOME} \\(5 days ago\\)`).test(out), `the fresh one is a plain report line, got: ${out}`);
    assert(/item\(s\) need attention/.test(said), 'the stale token is counted');
    cleanup(world.root); cleanup(kit);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
