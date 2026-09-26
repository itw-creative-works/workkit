//
// Tests for the tower dashboard's token.js: the card the Settings page owns.
// The shared prologue (the lib loader, the storage stub, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, mkStorage } = require('./helpers');

const run = async () => {
  const { format, scope, api, github, token } = await loadLibs();

  group('tower/app: token - the card the Settings page owns');

  // The card as the two listeners see it: a form carrying the field and, where
  // there is a token to forget, the Clear button. Exactly the nodes
  // `mountTokenCard` reaches for and nothing else - what the card LOOKS like is
  // the markup tests above, and a browser's answer besides.
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
    // The chrome's Token button, moved (#167): same rule, same reload behind
    // it, on the page that also types the replacement.
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
    // A fine-grained token belongs to ONE resource owner, so a board spanning
    // two cannot be read by one at all (#167) - the page says which token can.
    assert(markup.includes('classic token with the repo scope'), 'the other kind is named');
    assert(/two owners/.test(markup), 'with the one case that requires it');
    // ONE create button on the page and it is THIS card's (#241, the owner's
    // second call): it sits under the permissions it names. The classic URL
    // rides the words that name that token, inside the sentence, rather than
    // a second button that reads as a mistake.
    const classicLink = `<a href="${format.esc(github.TOKEN_CLASSIC_URL)}" target="_blank" rel="noopener">a classic token with the repo scope</a>`;
    assert(markup.includes(`${classicLink} works too`), 'the link that makes one with the scope already ticked sits on the words that name it');
    assert(github.TOKEN_CLASSIC_URL.includes('scopes=repo'), 'which is the repo scope and nothing wider');
    assert(markup.includes(`href="${github.TOKEN_URL}"`), 'the creation page is one click away, from this card');
    assertEq((markup.match(/class="btn /g) || []).length, 1, 'as the one button on it');
    assertEq((markup.match(/<a /g) || []).length, 2, 'the inline link and that button being the only links here');
  });

  await test('a copy with a TOWER behind it is told the token is not its credential', () => {
    const note = token.towerTokenNote();
    assert(/tower API on this machine/.test(note), 'the machine holds the gh login');
    assert(/needs no token of its own/.test(note), 'so this copy needs nothing typed');
    assert(/published copy/.test(note), 'and what is saved here is for the copy that does');
  });

  await test('a locked copy on this machine is told the tower is down, and is never asked for a token', () => {
    // The bug (#89): a locked page served from localhost asked for a GitHub
    // token, which a local dashboard has no use for - the tower API holds the
    // `gh` login. The fork is on the hostname alone; the MODE is untouched.
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
    // The mode is decided from the BUILD, never from a probe (api.js): a locked
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

    const source = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/lockedIntakeNotice\(location\.hostname\)/.test(source), 'the dialog reads the fork rather than owning a second one');
    assert(/no roster until the tower is running[\s\S]{0,60}no roster until a token is added/.test(source),
      'and the empty roster forks with it, so the two halves of the dialog cannot disagree');
  });

  await test('saving stores what was typed and reads the page again with it', () => {
    for (const hostname of ['alice.github.io', 'tower.example.com', '203.0.113.5']) {
      assert(!token.isLocalHost(hostname), `${hostname} is not this machine`);
    }

    // A stub the wiring can be read off: every paint that WROTE the card mounts
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
    // The trap: `writeToken(storage, '')` IS the clear, so asking it and
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
    assert(true, 'and markup with no form in it at all is left alone rather than thrown at');
  });

  await test('the layout disarms the auth gate under the framework’s CURRENT key', () => {
    // The gate re-armed itself once (#98): the framework renamed the settings
    // blob `web_manager` → `client`, the stale key resolved to nothing, and
    // the admin chain’s `authenticated` policy silently won. The pin is on
    // the exact key path, so the next rename fails here instead of on screen.
    // It rides under `config:`, the one place a page or layout overrides
    // omega.json5. A config section restated BARE fails the build outright.
    const layout = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src',
      '_layouts', 'tower', 'page.html'), 'utf8');
    assert(/^config:$/m.test(layout), 'the override sits under the config namespace');
    assert(/^  client:\n    auth:\n      config:\n        policy: "disabled"$/m.test(layout),
      'the client blob disables the auth policy, spelled exactly as the engine reads it');
    assert(!/^client:/m.test(layout), 'and never bare, which no longer reaches the engine at all');
    assert(!layout.includes('web_manager:'), 'and the retired key is gone - it resolves to nothing');
  });

  await test('the layout ships no unlock dialog any more, and nothing can open one', () => {
    // It was a modal nothing could dismiss - static backdrop, no Escape, no
    // close button - because behind it was a page with no data and no second
    // place to type a token. The second place is now a page (#167), so the
    // dialog is retired rather than merely made closable.
    const layout = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src',
      '_layouts', 'tower', 'page.html'), 'utf8');
    assert(!layout.includes('id="tower-unlock"'), 'the dialog is gone from the layout');
    assert(!layout.includes('data-token-body'), 'and so is the region the prompt was written into');
    assert(!/data-bs-backdrop="static"/.test(layout), 'no undismissable dialog is left anywhere on the page');
    for (const dialog of ['tower-issue', 'tower-agent', 'tower-intake']) {
      assert(layout.includes(`id="${dialog}"`), `${dialog} is untouched`);
      assert(layout.includes('data-bs-dismiss="modal"'), 'and every dialog the layout still ships can be closed');
    }
    for (const name of ['token.js', 'page.js', path.join('page', 'selector.js')]) {
      const source = fs.readFileSync(path.join(libs, name), 'utf8');
      assert(!/openTokenModal|hideTokenModal|TOKEN_MODAL|tokenPrompt/.test(source), `${name} has no opener left`);
    }
    for (const gone of ['openTokenModal', 'hideTokenModal', 'tokenPrompt', 'mountTokenPrompt', 'TOKEN_MODAL']) {
      assertEq(token[gone], undefined, `${gone} is retired, not merely unused`);
    }
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

  await test('the Settings page exists, is in the sidebar, and is bound to its module', () => {
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src');
    const page = fs.readFileSync(path.join(src, 'pages', 'settings.md'), 'utf8');
    assert(page.includes(`permalink: ${scope.SETTINGS_PATH}`), 'the page answers at the path the runtime sends viewers to');
    assert(page.includes('<div id="tower-settings"></div>'), 'with the mount its module draws into');
    assert(/meta:\n  title: "Settings"/.test(page), 'and a title of its own');

    const sidebar = fs.readFileSync(path.join(src, '_includes', 'backend', 'sections', 'sidebar.json'), 'utf8');
    assert(sidebar.includes(`href: '${scope.SETTINGS_PATH}'`), 'the nav carries an entry for it');
    assert(/label: 'Settings'/.test(sidebar), 'named the way the pointer line names it');

    const module = fs.readFileSync(path.join(src, 'assets', 'js', 'pages', 'settings.js'), 'utf8');
    assert(/mount: 'tower-settings'/.test(module), 'the module claims that mount');
    // The option itself, not the sentence about it in the header: a page that
    // only TALKS about being tokenless is a page the runtime routes away from.
    assert(/^ {2}tokenless: true,$/m.test(module), 'and declares itself the page that works without a token');
    assert(/tokenCard\(\{ held, problem: state\.tokenProblem \}\)/.test(module),
      'it draws the card from what this browser holds and from any refusal the runtime carried');
    assert(/mountTokenCard\(root\)/.test(module), 'and wires it after the write');
    assert(/LIVE \? towerTokenNote\(\) : ''/.test(module), 'a copy with a tower behind it is told the token is not its credential');
    // The two cards sit on ONE row, a column each, and stack below the lg
    // breakpoint the way every other pair on the dashboard does (#241).
    assert(/<div class="row g-4">/.test(module), 'the two cards share a row');
    assert(/<div class="col-12 col-xl-6">\$\{tokenCard\(/.test(module), 'the token card takes half of it');
    assert(/<div class="col-12 col-xl-6">\$\{tokenGuidance\(\)\}<\/div>/.test(module), 'and what the token needs takes the other half');
    assert(/feeds: \['repos'\]/.test(module), 'the one feed it arms is the roster the sidebar’s selector is filled from');
  });

  await test('no other page declares itself tokenless - Settings is the only one that works locked', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js') && file !== 'settings.js')) {
      assert(!/tokenless/.test(fs.readFileSync(path.join(pages, name), 'utf8')), `${name} needs a token like every other data page`);
    }
  });

  await test('nothing token-shaped is committed anywhere in the app', () => {
    // The whole doctrine: the token is the VIEWER's, typed into their browser.
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
