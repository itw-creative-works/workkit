//
// Tests for the tower dashboard's token.js: the card the Settings page owns.
// The shared prologue (the lib loader, the storage stub, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkStorage } = require('./helpers');

const run = async () => {
  const { format, scope, api, github, token } = await loadLibs();

  group('tower/app: token - the card the Settings page owns');

  // The card as the two listeners see it: a form carrying the field and, where
  // there is a token to forget, the Clear button. Exactly the nodes
  // `mountTokenCard` reaches for; what the card looks like is the markup tests
  // above, and a browser's answer besides.
  const mkCardHost = (options = {}) => {
    const input = {
      value: options.value || '', focused: 0, focus() { input.focused += 1; },
    };
    const clear = options.clear === false ? null : {
      listeners: [],
      addEventListener: (type, fn) => clear.listeners.push({ type, fn }),
      fire: () => clear.listeners.forEach((one) => one.fn()),
    };
    const form = {
      listeners: [],
      addEventListener: (type, fn) => form.listeners.push({ type, fn }),
      querySelector: (sel) => {
        if (sel === '[data-token-input]') return input;
        if (sel === '[data-token-clear]') return clear;
        return null;
      },
    };
    const host = { querySelector: (sel) => (sel === '[data-token-form]' ? form : null) };
    return {
      host,
      form,
      input,
      clear,
      submit: () => form.listeners.forEach((one) => one.fn({ preventDefault: () => {} })),
    };
  };

  await test('the card takes a token and hides what is typed', () => {
    const markup = token.tokenCard();
    assert(!markup.includes(`href="${github.TOKEN_URL}"`), 'making one is the guidance card\'s button, not this card\'s (#241)');
    assert(markup.includes('type="password"'), 'the field does not display the token');
    assert(markup.includes('<label class="form-label" for="tower-token-input">'), 'the field carries a real label');
    assert(markup.includes('localStorage'), 'and it says where the token is kept');
    assert(markup.includes('data-token-save'), 'with the save that stores it');
    assert(!token.tokenCard().includes('data-token-problem'), 'a first visit is not an error state');
    assert(token.tokenCard({ problem: 'the token was refused' }).includes('the token was refused'),
      'and a refusal is shown when there is one');
  });

  await test('the clear button is drawn only where there is a token to forget', () => {
    // Clear forgets and reloads, on the page that also types the replacement.
    const held = token.tokenCard({ held: true });
    assert(held.includes('data-token-clear'), 'a browser holding one can forget it');
    assert(held.includes('This browser holds a token.'), 'and is told that it holds one');
    const none = token.tokenCard();
    assert(!none.includes('data-token-clear'), 'a browser holding none has nothing to forget');
    assert(none.includes('This browser holds no token yet.'), 'and is told that too');
    assert(none.includes('data-token-input'), 'the field is on both - replacing a token is typing the next one');
  });

  await test('the guidance names the fine-grained permissions AND the classic token a two-owner board needs', () => {
    const markup = token.tokenGuidance();
    assert(markup.includes('Issues: Read and write'), 'it names the permissions, and the board moves cards, so writing issues is one');
    assert(markup.includes('Contents: Read'), 'and the one read that is not an issue: the private roster on the home repo (issue #110)');
    assert(!/admin|workflow/i.test(markup), 'and asks for nothing beyond that');
    // A fine-grained token belongs to one resource owner, so a board spanning
    // two cannot be read by one at all: the page says which token can.
    assert(markup.includes('classic token with the repo scope'), 'the other kind is named');
    assert(/two owners/.test(markup), 'with the one case that requires it');
    // One create button on the page, and it is this card's, under the
    // permissions it names. The classic URL rides the words that name that
    // token, inside the sentence, rather than a second button.
    const classicLink = `<a href="${format.esc(github.TOKEN_CLASSIC_URL)}" target="_blank" rel="noopener">a classic token with the repo scope</a>`;
    assert(markup.includes(`${classicLink} works too`), 'the link that makes one with the scope already ticked sits on the words that name it');
    assert(github.TOKEN_CLASSIC_URL.includes('scopes=repo'), 'which is the repo scope and nothing wider');
    assert(markup.includes(`href="${github.TOKEN_URL}"`), 'the creation page is one click away, from this card');
    assertEq((markup.match(/class="btn /g) || []).length, 1, 'as the one button on it');
    assertEq((markup.match(/<a /g) || []).length, 2, 'the inline link and that button being the only links here');
  });

  await test('a copy with a TOWER behind it is told the token is not its credential', () => {
    const note = token.towerTokenNote();
    assert(/the Workkit API on this machine/.test(note), 'the machine holds the gh login');
    assert(/needs no token of its own/.test(note), 'so this copy needs nothing typed');
    assert(/published copy/.test(note), 'and what is saved here is for the copy that does');
  });

  await test('a locked copy on this machine is told the tower is down, and is never asked for a token', () => {
    // A local dashboard has no use for a GitHub token (the tower API holds the
    // `gh` login), so the fork is on the hostname alone; the mode is untouched.
    const markup = token.towerDownNotice('http://localhost:4300/board?repo=ITW/workkit');
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      assert(token.isLocalHost(hostname), `${hostname} is this machine`);
      assert(markup.includes('npm run tower'), `${hostname} is told how to start the tower`);
      assert(!markup.includes('data-token-input') && !markup.includes('data-token-save'),
        `${hostname} gets no field and no save button`);
      assert(!markup.includes(github.TOKEN_URL), `${hostname} is not sent to GitHub to make a token`);
    }
  });

  await test('the local notice carries the connect link, because starting the tower alone changes nothing', () => {
    // The mode is decided from the build, never from a probe (api.js): a locked
    // page on this machine is a production build, so a reload after `npm run
    // tower` is locked all over again. `?api=` is what flips decideLive, and it
    // rides the URL through that reload.
    const href = token.connectHref('http://localhost:4300/board?repo=ITW/workkit');
    const url = new URL(href);
    assertEq(url.searchParams.get('api'), 'http://127.0.0.1:8693', 'pointed at the tower’s own origin');
    assertEq(url.searchParams.get('api'), api.API_BASE,
      'which is api.js’s own default - the two copies of the origin cannot drift apart');
    assertEq(url.searchParams.get('repo'), 'ITW/workkit', 'and every other parameter survives');
    assertEq(url.pathname, '/board', 'on the page the viewer was already looking at');
    assertEq(new URL(token.connectHref('http://localhost:4300/?api=http://box:8693')).searchParams.getAll('api').length, 1,
      'an api already in the URL is replaced, never doubled');
    assert(token.towerDownNotice('http://localhost:4300/board?repo=ITW/workkit').includes(`href="${format.esc(href)}"`),
      'and the notice links to exactly that URL');
    assertEq(api.decideMode('production', 'http://127.0.0.1:8693', false), 'tower',
      'which is the override that unlocks the page - the advice resolves the state it appears in');
  });

  await test('the intake dialog tells the same story the body does, forked on the same predicate', () => {
    assertEq(token.lockedIntakeNotice('localhost'), format.localLockedNotice(), 'on this machine it asks for the tower');
    assert(format.LOCAL_LOCKED_NOTICE.includes('npm run tower'), 'in the same words, and no token among them');
    assert(!/token/i.test(format.LOCAL_LOCKED_NOTICE), 'a local dialog never asks for one');
    assertEq(token.lockedIntakeNotice('alice.github.io'), format.lockedNotice(), 'and anywhere else it is the token wording, unchanged');
  });

  await test('Settings names the tier the copy is, and a copy with no roster names none', () => {
    const textOf = (markup) => markup.replace(/<[^>]*>/g, '');
    assert(/This is the local copy, on this machine\./.test(textOf(token.tierNote('tower', null))), 'an API behind the page is the local copy');
    const published = textOf(token.tierNote('github', { ok: true, source: 'home.json', home: 'other/workkit' }));
    assert(/published from other\/workkit/i.test(published), `a baked pointer names its home, got: ${published}`);
    const central = textOf(token.tierNote('github', { ok: true, source: 'login', home: 'someone/workkit' }));
    assert(/central copy/i.test(central) && central.includes('someone/workkit'), `the login's home is the central copy, got: ${central}`);
    assertEq(token.tierNote('locked', { ok: true, source: 'login', home: 'someone/workkit' }), '', 'a locked copy states no tier');
    assertEq(token.tierNote('github', { ok: false }), '', 'nor does a copy whose login read was refused - there is no home to name');
    const looked = textOf(token.tierNote('github', { ok: false, home: 'someone/workkit', source: 'login' }));
    assert(looked.includes('someone/workkit'), `a home that was found is named even when its roster read failed, got: ${looked}`);
    const hostile = token.tierNote('github', { ok: true, source: 'home.json', home: '<img src=x onerror=1>' });
    assert(!hostile.includes('<img'), 'a hostile home is escaped');
    assert(hostile.includes('&lt;img src=x'), 'and shows as what it says');
  });

  await test('saving stores what was typed and reads the page again with it', () => {
    for (const hostname of ['alice.github.io', 'tower.example.com', '203.0.113.5']) {
      assert(!token.isLocalHost(hostname), `${hostname} is not this machine`);
    }

    // A stub the wiring can be read off: every paint that wrote the card mounts
    // it once (swap returns false otherwise), so the listener count here is one
    // per mount.
    const wired = mkCardHost({ value: '  github_pat_TEST  ' });
    const storage = mkStorage();
    const reloads = [];
    token.mountTokenCard(wired.host, { storage, reload: () => reloads.push(1) });
    assertEq(wired.form.listeners.length, 1, 'the submit is wired');
    assertEq(wired.clear.listeners.length, 1, 'and so is the clear beside it');

    wired.submit();
    assertEq(storage.held[github.TOKEN_KEY], 'github_pat_TEST', 'submitting stores what was typed, trimmed');
    assertEq(reloads.length, 1, 'and reads the page again with it - the mode is decided at module load');
    assertEq(github.readToken(storage), 'github_pat_TEST', 'through the one door every other reader uses');
  });

  await test('a blank save leaves the stored token alone - Clear is what forgets one', () => {
    // The trap: `writeToken(storage, '')` is the clear, so asking it and
    // reacting to the empty string it hands back would already have thrown the
    // token away. The guard is before the call.
    const storage = mkStorage({ [github.TOKEN_KEY]: 'fake-token-for-tests' });
    const blank = mkCardHost({ value: '   ' });
    const reloads = [];
    token.mountTokenCard(blank.host, { storage, reload: () => reloads.push(1) });

    blank.submit();
    assertEq(github.readToken(storage), 'fake-token-for-tests', 'what this browser holds survives an empty submit');
    assertEq(reloads.length, 0, 'and nothing reloads, since nothing changed');
    assertEq(blank.input.focused, 1, 'the caret goes back in the field instead');

    blank.clear.fire();
    assertEq(github.readToken(storage), '', 'the Clear button is what forgets it');
    assertEq(reloads.length, 1, 'and that reloads - a copy with no token is a different copy');
  });

  await test('a card with nothing to forget wires only the save', () => {
    const none = mkCardHost({ value: 'ghp_TEST', clear: false });
    token.mountTokenCard(none.host, { storage: mkStorage(), reload: () => {} });
    assertEq(none.form.listeners.length, 1, 'one listener, on the form');
    const bare = { querySelector: () => null };
    token.mountTokenCard(bare, { storage: mkStorage(), reload: () => {} });
  });

  await test('every other page points at Settings in one line, carrying the scope', () => {
    const line = token.settingsNotice(scope.settingsHref('workkit'));
    assert(line.includes('href="/settings?repo=workkit"'), 'the link is the Settings page, still narrowed to the same repo');
    assert(line.includes('>Settings</a>'), 'named by the page it goes to, never "here"');
    assertEq((line.match(/<p/g) || []).length, 1, 'one line, not a card - there is no data on this page to dress up');
    assert(!line.includes('data-token-input'), 'and no second field: a token is typed in one place');
    const refused = token.settingsNotice(scope.settingsHref(''), 'the token was refused');
    assert(refused.includes('the token was refused'), 'a refusal is carried in the same line');
    assert(!token.settingsNotice(scope.settingsHref('')).includes('undefined'), 'and no refusal draws no reason');
    assert(!token.settingsNotice(scope.settingsHref(''), '<img src=x>').includes('<img'), 'a hostile reason is escaped');
  });

  await test('Settings is a tower page like the other six, so the nav carries the scope onto it', () => {
    assert(scope.SCOPED_PATHS.includes('/settings'), 'it is one of the tower’s own pages');
    assertEq(scope.SETTINGS_PATH, '/settings', 'at the one address the runtime navigates to by itself');
    assert(scope.isScopedPath('/settings'), 'so a sidebar link to it is rewritten');
    assertEq(scope.settingsHref('workkit,omega'), '/settings?repo=workkit,omega', 'with the whole subset');
    assertEq(scope.settingsHref(''), '/settings', 'and no parameter at all for every repo');
    assertEq(scope.settingsHref(''), scope.scopedHref(scope.SETTINGS_PATH, ''), 'through the one formatter every nav link uses');
  });

  await test('nothing token-shaped is committed anywhere in the app', () => {
    // The whole doctrine: the token is the viewer's, typed into their browser.
    // A literal in the source would be published to anyone with the URL.
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src');
    for (const file of walk(src)) {
      const text = fs.readFileSync(file, 'utf8');
      assert(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), `${path.basename(file)} carries no classic token`);
      assert(!/github_pat_[A-Za-z0-9_]{20,}/.test(text), `${path.basename(file)} carries no fine-grained token`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
