//
// Tests for workflow/workkit.sh: the token handover, `setup`'s hand of
// the gh token to the published site.
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, skip, summary, selfRun } = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, writeStub, mkWorld, runCli, seedSettings, inCli, AT_TERMINAL, mkKit,
} = require('./helpers');

const run = async () => {
  group('workkit setup: the token handover');

  // The fake this group moves around: shaped like the `gh` OAuth token the step
  // reads, and URL-safe the way a real one is, so it can ride a fragment as it
  // stands. Nothing here is a credential, and nothing here is ever printed.
  const HANDOVER = 'gho_FAKEhandoverTOKENfakeHANDOVER0';
  const PUSHED = 'fa11ee0000000000000000000000000000000000';

  /**
   * A machine whose publish has landed: `gh-pages` is at PUSHED, and Pages
   * answers `building` first and `built` on the second poll, so a handover that
   * happens proves the step waited rather than read once.
   */
  const mkPagesWorld = (site, pagesBuilds = [['building', ''], ['built', PUSHED]]) => {
    const world = mkWorld({ authToken: HANDOVER, pagesRef: PUSHED, pagesBuilds });
    seedSettings(world, site);
    return world;
  };
  const PUBLISHED = { repo: 'owner/home', publish: true, url: null };
  const SETTINGS_URL = 'https://owner.github.io/home/settings';
  // The polls of the Pages build, off the recorded gh calls: the one endpoint
  // the wait reads, told apart from every other `gh api` a run makes.
  const pagesPolls = (world) => world.ghCalls().filter((c) => isCall(c, 'api') && /pages\/builds\/latest$/.test(c[1] || ''));

  await test('the token reaches the browser in a file, never in an argument', () => {
    const world = mkPagesWorld(PUBLISHED);
    const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
    assertEq(code, 0, `exit 0, got: ${out}`);
    const polls = pagesPolls(world);
    assertEq(polls.length, 2, `it polled until Pages had served the push: ${fmtCalls(polls)}`);
    const calls = world.openerCalls();
    assertEq(calls.length, 1, `the opener ran once: ${fmtCalls(calls)}`);
    assertEq(calls[0].length, 1, 'with one argument, the page and nothing beside it');
    assert(calls[0][0].endsWith('.html'), `under a name a browser will take: ${calls[0][0]}`);
    const page = world.openedPage();
    // Windows carries no POSIX mode, so the file it reports says nothing about
    // who can read the page: the question is asked where it can be answered.
    if (IS_WINDOWS) skip('the page is readable by this user and nobody else', 'Windows keeps no POSIX file mode');
    else assertEq(page.mode, 0o600, 'the page is readable by this user and nobody else');
    assert(page.text.includes(`${SETTINGS_URL}#token=${HANDOVER}`), `and redirects to Settings with the token in the fragment, got: ${page.text}`);
    assert(!out.includes(HANDOVER), `no line of output carries the token, got: ${out}`);
    assert(!fmtCalls(calls).includes(HANDOVER), `and no argument carries it either: ${fmtCalls(calls)}`);
    assert(/the browser now holds it/.test(out), `the run says what happened, got: ${out}`);
    assertEq(world.tmpFiles().join(','), '', 'and the page is gone by the time the run ends');
    cleanup(world.root);
  });

  await test('the URL is the site’s own address, github.io or the custom domain', () => {
    // The publish's own rule (workflow/publish.sh): a custom domain serves at
    // its root, and the default project site serves a path deeper. Only the
    // OWNER is lowercased, because that half is a hostname.
    for (const [site, expected] of [
      [{ repo: 'Owner/Home', publish: true, url: null }, 'https://owner.github.io/Home/settings'],
      [{ repo: 'owner/home', publish: true, url: 'https://tower.example.com/' }, 'https://tower.example.com/settings'],
    ]) {
      const world = mkPagesWorld(site, [['built', PUSHED]]);
      const { out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
      const page = world.openedPage();
      assert(page && page.text.includes(`${expected}#token=${HANDOVER}`), `${expected} is what was opened, got: ${page ? page.text : out}`);
      assert(!out.includes(HANDOVER), 'and no line of output carries the token');
      cleanup(world.root);
    }
  });

  await test('a publish Pages has not served yet prints the URL and opens nothing', () => {
    const world = mkPagesWorld(PUBLISHED, [['building', '']]);
    const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '0' } });
    assertEq(code, 0, 'a wait that ran out is not a failure');
    assert(/GitHub Pages has not served the publish/.test(out), `it names what it was waiting for, got: ${out}`);
    assert(out.includes(SETTINGS_URL), 'and the page to hand the token over on by hand');
    assert(!out.includes('#token='), `with no fragment on that URL, got: ${out}`);
    assertEq(world.openerCalls().length, 0, 'nothing was opened');
    assertEq(world.openedPage(), undefined, 'and no page was written');
    cleanup(world.root);
  });

  await test('a machine with no browser opener is the same named skip', () => {
    // `/usr/bin/open` is on every mac, so the machine WITHOUT an opener is the
    // other branch: a `uname` that says Linux sends the step looking for
    // `xdg-open`, which this world no longer has. The gate asks `command -v`,
    // and a Linux runner keeps a real `xdg-open` on the base PATH, so the
    // question itself answers no for that one name here.
    const world = mkPagesWorld(PUBLISHED);
    fs.rmSync(path.join(world.bin, 'xdg-open'));
    writeStub(path.join(world.bin, 'uname'), ["printf '%s\\n' Linux"]);
    const noOpener = `command() { [[ "$1" == '-v' && "$2" == 'xdg-open' ]] && return 1; builtin command "$@"; }`;
    const { code, out } = inCli(world, `${AT_TERMINAL}\n${noOpener}\nhandover_token`);
    assertEq(code, 0, 'exit 0');
    assert(/the token handover needs a browser opener/.test(out), `the skip names what is missing, got: ${out}`);
    assert(out.includes(SETTINGS_URL), 'and where to do it instead');
    assert(!world.ghCalls().some((c) => isCall(c, 'api')), `no read was made at all: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('setup hands the token over right after the publish it belongs to', () => {
    // The call site, pinned: publishing is on, so the publish runs and the
    // handover follows it. `runCli` is a PIPE, which is the shape the ship's own
    // run has (issue #235): the handover no longer asks for a terminal, so what
    // lands here is the whole step, and its success line is what makes the order
    // readable.
    const world = mkPagesWorld(PUBLISHED, [['built', PUSHED]]);
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    const published = out.indexOf('publish: ');
    const handed = out.indexOf('the browser now holds it');
    assert(published !== -1, `the publish ran, got: ${out}`);
    assert(handed > published, `and the handover came after it, got: ${out}`);
    assert(!out.includes(HANDOVER), `no line of output carries the token, got: ${out}`);
    cleanup(world.root);
  });

  await test('an interrupt while setup carries on takes the page with it', () => {
    // The window the EXIT trap alone left open: the page outlives the step by
    // design (the browser reads it asynchronously), so setup's remaining
    // questions are asked with it on disk, and a Ctrl-C at one of those prompts
    // has to remove it too. The signal goes to the shell that called the step,
    // which is exactly where a Ctrl-C would land.
    const world = mkPagesWorld(PUBLISHED, [['built', PUSHED]]);
    const during = path.join(world.root, 'during-the-window');
    const script = `${AT_TERMINAL}\nhandover_token\nls "$TMPDIR" > ${JSON.stringify(during)}\nkill -INT $$`;
    const { code } = inCli(world, script, { env: { WORKKIT_PAGES_WAIT: '60' } });
    assertEq(code, 130, 'the interrupt is not swallowed: 128 plus SIGINT');
    assert(/\.html$/m.test(fs.readFileSync(during, 'utf8')), 'the page was still on disk when the interrupt arrived');
    assertEq(world.tmpFiles().join(','), '', 'and it is gone after it');
    cleanup(world.root);
  });

  await test('a publish that did not finish holds the handover back', () => {
    // A token handed to a publish that failed is a token handed to whatever
    // Pages was already serving. `cmd_publish` never fails a run, so the step
    // reads what it DID off PUBLISH_FAILED.
    const world = mkPagesWorld(PUBLISHED);
    const { kit, script } = mkKit('owner/kit');
    writeStub(path.join(kit, 'workflow', 'publish.sh'), ["printf '%s\\n' 'publish: this one broke' >&2", 'exit 1']);
    const { code, said } = runCli(world, ['setup'], { script });
    assertEq(code, 0, 'setup still finishes');
    assert(/site: the publish did not finish/.test(said), `the publish named its own failure, got: ${said}`);
    assert(/the token handover waits for a publish that finished/.test(said), `and the handover says what it waits for, got: ${said}`);
    assertEq(pagesPolls(world).length, 0, `Pages was never polled: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('three empty reads end the wait, with both causes named', () => {
    // Two things read as nothing: a repo whose Pages step was refused (its
    // `pages/builds/latest` 404s for ever) and a read that could not be made at
    // all, since a fired `bounded_read` bound looks exactly like a listing that
    // would not come. The line states the condition and names both rather than
    // diagnosing one of them as fact.
    const world = mkPagesWorld(PUBLISHED, []);
    const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
    assertEq(code, 0, 'exit 0');
    assert(out.includes("three reads of owner/home's latest Pages build came back with nothing"), `it says what happened, got: ${out}`);
    assert(out.includes('Pages may be off (https://github.com/owner/home/settings/pages) or unreachable'), 'and names both causes, neither as the answer');
    assert(out.includes(SETTINGS_URL), 'with the by-hand URL beside them');
    assertEq(pagesPolls(world).length, 3, `the read got three tries: ${fmtCalls(pagesPolls(world))}`);
    assertEq(world.openerCalls().length, 0, 'and nothing was opened');
    cleanup(world.root);
  });

  await test('a site.url that cannot go in a URL is refused, never escaped', () => {
    // `ask_site_url` takes whatever was typed at its word, so the address is
    // checked before it reaches a message or the redirect page's JS string. A
    // `#` is refused for a second reason: a fragment of its own would swallow
    // the token's, and the success line would print over a Settings page that
    // was handed nothing.
    for (const url of ['tower.example.com/"onerror="x', 'tower.example.com/#board']) {
      const world = mkPagesWorld({ repo: 'owner/home', publish: true, url });
      const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
      assertEq(code, 0, 'exit 0');
      assert(out.includes('cannot be put in a URL as it stands'), `${url} is refused, got: ${out}`);
      assertEq(world.openerCalls().length, 0, 'nothing was opened');
      assertEq(pagesPolls(world).length, 0, 'and Pages was never polled');
      cleanup(world.root);
    }
  });

  await test('a login with no token to give is a named skip, and nothing is opened', () => {
    // The last ending of the step: the wait finished, and `gh auth token` came
    // back with nothing. `mkWorld` answers that read with silence by default,
    // which is the shape of a login that expired or was never made.
    const world = mkWorld({ pagesRef: PUSHED, pagesBuilds: [['built', PUSHED]] });
    seedSettings(world, PUBLISHED);
    const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
    assertEq(code, 0, 'exit 0');
    assert(out.includes('`gh auth token` returned nothing, so there was no token to hand over'), `the skip names what was missing, got: ${out}`);
    assert(out.includes('run `gh auth login`'), 'with the command that makes one');
    assert(out.includes(SETTINGS_URL), 'and the Settings URL for the paste by hand');
    assertEq(world.openerCalls().length, 0, 'nothing was opened');
    assertEq(world.openedPage(), undefined, 'and no page was written');
    cleanup(world.root);
  });

  await test('a token that would need escaping is refused, never escaped', () => {
    // The same rule as the address: the fragment carries a gh token as it
    // stands, and a value outside that shape is a mangled or refused login,
    // never something to encode on a guess.
    const world = mkWorld({ authToken: 'gho_a/b', pagesRef: PUSHED, pagesBuilds: [['built', PUSHED]] });
    seedSettings(world, PUBLISHED);
    const { code, out } = inCli(world, `${AT_TERMINAL}\nhandover_token`, { env: { WORKKIT_PAGES_WAIT: '60' } });
    assertEq(code, 0, 'exit 0');
    assert(out.includes('characters a URL fragment would have to escape'), `the shape is refused, got: ${out}`);
    assert(out.includes(SETTINGS_URL), 'and the Settings URL is printed for the paste by hand');
    assertEq(world.openerCalls().length, 0, 'nothing was opened');
    assert(!out.includes('gho_a/b'), 'the value itself is never printed');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
