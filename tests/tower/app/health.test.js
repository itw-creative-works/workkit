//
// Tests for the tower dashboard's Health page (it shows only what is broken)
// and the Brief page's archive, both pinned by their source.
// The header this suite's notes point at (why a page module is out of reach
// under Node) is the one atop ./helpers.js, which holds the shared prologue.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs } = require('./helpers');

const run = async () => {
  const { format, chrome } = await loadLibs();

  group('tower/app: the Health page shows only what is broken (#182)');

  // Issue #182: the page used to restate the board - a stat grid and a status
  // doughnut per repo, with the real alarms mixed in among neutral numbers. A
  // number that is FINE is not this page's business, and an unanswered issue is
  // the Board's. The page imports the framework and is out of reach of these
  // suites (see the header), so what is pinned is what the source draws from:
  // the vocabulary it no longer speaks, the conditions that put a repo on it,
  // and the one line a machine with nothing wrong shows.

  const healthSource = () => fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'health.js'),
    'utf8',
  );

  await test('the census is gone - no stat grid, no doughnut, no board feed', () => {
    const source = healthSource();
    // Each of these is another page's answer: the tiles and the chart are the
    // Overview's, the open and blocked counts are the Board's. A rebuild that
    // kept any of them is the page this issue is about.
    for (const gone of ['statgrid', 'statCell', 'statusBreakdown', 'chartSlot', 'barChart', 'issuesFor', 'issueItem']) {
      assert(!source.includes(gone), `${gone} draws a neutral number, and this page has none`);
    }
    assert(!/charts: true/.test(source), 'and with no chart on it the page stops pulling Chart.js in before its first paint');
    assert(/feeds: \['repos', 'health', 'brief'\]/.test(source),
      'it polls the three feeds a problem can come from, and no longer asks for the board it does not read');
  });

  await test('a repo is on the page only while a working copy is in a state, and every state names its remedy', () => {
    const source = healthSource();
    for (const condition of ['reading.uncommitted > 0', 'reading.unpushed > 0', 'reading.unreleasedEntries > 0', 'reading.error']) {
      assert(source.includes(condition), `${condition} is one of the things that puts a repo on this page`);
    }
    // The API keeps "no upstream" and "level with one" apart on purpose
    // (tower/api/lib/health.js), and a page comparing null with `> 0` would
    // report a checkout that has never left this disk as fully pushed.
    assert(source.includes('reading.unpushed === null'),
      'a branch with no upstream is its own named state, never counted as pushed work');
    // Naming a problem without naming what ends it is the old page's stat grid
    // with a red border, so the two halves are counted against each other.
    const wrongs = (source.match(/wrong:/g) || []).length;
    assert(wrongs >= 4, `every state the page draws is a sentence about what is wrong (${wrongs})`);
    assertEq((source.match(/fix:/g) || []).length, wrongs, 'and each one carries the act that resolves it');
  });

  await test('a machine with nothing wrong says so, and only then', () => {
    const source = healthSource();
    assert(/Nothing is broken/.test(source), 'the page is never empty - it says what the emptiness means');
    assert(/committed, pushed and released/.test(source), 'naming the three states it just checked');
    assert(source.includes('swap(root, body || (briefFeed ? allClear() : loading('),
      'and that line is drawn only when the problems came to nothing - a page with one problem on it shows the problem alone');
    // The all-clear's last clause is "the brief is current", so a brief feed
    // that has not answered holds the sentence back, and one that FAILED is
    // drawn as the problem it is (#182 verify, finding 1).
    assert(source.includes('briefFeed && !briefFeed.ok'),
      'a failed brief feed is a problem on this page, never a silent absence');
  });

  await test('the published Board drags like the local one - no read-only line left anywhere', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/draggable = \(issue\) => WRITABLE/.test(source), 'a card picks up wherever there is something to write with');
    assert(!/READ_ONLY_NOTICE|readOnlyLine/.test(source), 'and the sentence that said it could not is gone with the state it described');
    assert(!/never even renders this page/.test(source), 'and the file no longer claims the runtime skips it');
    assert(/await state\.refresh\('board'\)/.test(source), 'a landed move is re-read, in published mode as on a machine');
  });

  // Issue #181: the Brief page mirrored the 9am notification and never showed
  // the one thing a morning leaves behind - the brief itself. The page module
  // imports the framework and is out of reach of these suites (see the header),
  // so what is pinned is the source of each decision; the markup the archive is
  // built from is modal.js's, and is asked real questions in its own group.
  await test('the Brief page is the mornings themselves - the newest one open, the rest an archive', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const source = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(/documents\.find\(\(doc\) => doc\.kind === 'brief'\)/.test(source),
      'the newest brief is the first brief on a newest-first payload, never a second sort');
    assert(/\$\{newest \? latest\(newest\) : ''\}/.test(source), 'and it is drawn in place, or not at all when none was published');
    assert(/documentBody\(doc, renderMarkdown\)/.test(source), 'its text goes through the escape-first renderer, like every remote body on the tower');
    assert(/\$\{archive\(documents, newest\)\}/.test(source), 'with everything published before it under it');
    assert(/documents\.filter\(\(doc\) => doc !== drawn\)/.test(source), 'the one already open is not also a card that opens it');
    assert(/mountDocumentModal\(\{ render: renderMarkdown \}\)/.test(source), 'and the dialog those cards open is wired by the page that has them');
  });

  await test('a Brief that could not read the mornings says so, and never draws an empty archive', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const source = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(/Array\.isArray\(payload\.documents\) \? payload\.documents : null/.test(source),
      'an absent or null key is the unreadable state, the posture the history beside it is read with');
    assert(/if \(!documents\) \{[\s\S]{0,200}UNREAD/.test(source), 'which draws the sentence rather than an archive with nothing in it');
    assert(/nothing else has been published yet/.test(source), 'while an archive that is genuinely empty says the opposite thing');
  });

  await test('everything else on the Brief is gone from it, not moved somewhere else on it', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const source = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    // The Overview owns the charts, the Board owns the queue, Health owns the
    // warnings. Each of these was a second drawing of one of them.
    for (const dead of ['statgrid(', 'statCell(', 'payload.counts', 'payload.nextUp', 'payload.warnings', 'payload.findings', 'payload.week', 'payload.summaries', 'issueItem(', 'payload.headline']) {
      assert(!source.includes(dead), `${dead} is gone from the Brief`);
    }
    assert(!/selectedSlugs\(|inScope\(/.test(source), 'and the repo selection with them - a morning is not a repo’s morning');
    assert(/feeds: \['repos', 'brief'\]/.test(source), 'so the page arms the feed it draws and the roster the chrome needs, and no board');
  });

  await test('the runtime fills the sidebar’s selector menu and carries the scope onto the nav', () => {
    // page.js reaches for `document` at import and is out of reach of these
    // suites (see the header), so what is pinned is the wiring: where the menu
    // is written, what writes it, and that the nav links are rewritten on the
    // selection AND on every paint - the two halves of #104's promise that
    // moving Overview → Board keeps the scope.
    const source = ['page.js', path.join('page', 'selector.js')].map((name) => fs.readFileSync(path.join(libs, name), 'utf8')).join('\n');
    assert(/menuMarkup\(state\)/.test(source), 'the menu is markup from state, like the chrome');
    assert(/sidebarKey\(state\)/.test(source), 'and it is rewritten only when what it shows changed');
    assert(/classList\.contains\('show'\)/.test(source), 'never while the viewer has it open, unless the change came from inside it');
    assert(/#app-sidebar \.omega-side__selector/.test(source), 'written into the framework’s own selector, reached through its button');
    assert(!/#app-sidebar ul/.test(source), 'never as a bare sidebar ul - the nav is one too');
    assert(/data-tower-projects/.test(source), 'and claimed with the one attribute the runtime marks it by');
    assert(/data-bs-auto-close/.test(source), 'ticking a subset box does not close the menu it is in');
    assert(/data-tower-scope\]/.test(source) && /data-tower-scope-slug/.test(source), 'both controls on a row are wired - the name and its box');
    // The master row (#168): its box is the one control markup cannot fully
    // describe, since indeterminate is a property, and a click on it moves
    // every box on the roster.
    assert(/data-tower-scope-all/.test(source), 'the master box is wired too');
    assert(/indeterminate = .*hasAttribute\('data-tower-indeterminate'\)/.test(source), 'the marker sidebar.js writes becomes the DOM property');
    assert(/applyScope\(master\.checked \? '' : NONE, false\)/.test(source), 'ticking it is the whole board, unticking it the none scope (#188)');
    assert(/scopedHref\(/.test(source), 'the nav links are rewritten through the one formatter');
    assert(/scopeNav\(/.test(source), 'and the rewrite has a name the paint and the change both call');
    assert(!/tower-repo/.test(source), 'and the chrome’s dropdown is gone, handler and all');
  });

  await test('the menu’s search box narrows it without touching anything (#185)', () => {
    const source = ['page.js', path.join('page', 'selector.js')].map((name) => fs.readFileSync(path.join(libs, name), 'utf8')).join('\n');
    assert(/shown\.bs\.dropdown/.test(source), 'the box takes the keyboard the moment the menu opens');
    assert(/hidden\.bs\.dropdown/.test(source), 'and closing it clears the filter');
    assert(/search\.value = ''/.test(source) && /filterProjects\(menu, ''\)/.test(source), 'box emptied and every row unhidden, so the next open is the whole roster');
    // The claim the whole feature rests on: filtering is DISPLAY. A row is
    // hidden where it stands - nothing is re-scoped, nothing is stored and the
    // menu is not rewritten, which is what keeps sidebar.js pure.
    const filter = /const filterProjects = \(menu, text\) => \{([\s\S]*?)\n\};/.exec(source);
    assert(filter, 'the filter is one named function');
    assert(/classList\.toggle\('d-none'/.test(filter[1]), 'and it hides a row rather than removing it');
    assert(!/applyScope|state\.|innerHTML|Storage/.test(filter[1]), 'writing no selection, no state and no markup');
    // The keyboard, per rewrite with the rest of the wiring.
    assert(/wireProjectKeys\(projects\)/.test(source), 'the keys are wired on each rewrite, so no listener stacks on a survivor');
    assert(/ArrowDown/.test(source), 'Down in the box walks into the list');
    assert(!/ArrowUp/.test(source), 'and the rows’ own arrows are wired nowhere - Bootstrap’s delegated handler owns that walk, and a second copy here would lose to it');
    assert(/rows\[0\]\.click\(\)/.test(source), 'Enter in the box takes the row at the top of what is left');
    assert(/event\.key\.length === 1/.test(source), 'and a character typed on a row puts the box back under it');
    assert(/event\.key !== ' '/.test(source), 'except Space, which stays with the row it presses');
    assert(!/'Escape'/.test(source), 'and Escape is compared against nowhere - it stays Bootstrap’s, closing the menu it always closed');
  });

  await test('a star is stored and repainted where it stands, and the open menu holds still (#186)', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/readFavorites\(storage\)/.test(source), 'the list is read once, at the top of the page');
    assert(/safeStorage\(window\)/.test(source), 'through the guard github/token.js already owns, since the property itself can throw');
    assert(/state\.favorites = toggleFavorite\(storage, slug\)/.test(source), 'a click writes through the one module that owns the key, onto the state the menu is drawn from');
    // A star is not a selection, and its click redraws NOTHING but its own
    // button: a repaint from state would wipe a subset the boxes are mid-way
    // through building, so the reorder waits for the close redraw.
    const wiring = /for \(const mark of projects\.querySelectorAll\('\[data-tower-favorite\]'\)\) \{([\s\S]*?)\n    \}/.exec(source);
    assert(wiring, 'the stars are wired in one loop');
    assert(!/applyScope|writeSelectedRepo|hide\(\)/.test(wiring[1]), 'and it changes no scope and closes no menu');
    assert(!/paint\(\)|innerHTML/.test(wiring[1]), 'and paints no menu - the open shape survives a star');
    assert(/classList\.toggle\('text-warning', on\)/.test(wiring[1]), 'the button repaints in place: its colour');
    assert(/aria-pressed', String\(on\)/.test(wiring[1]), 'its pressed state');
    assert(/fa-\$\{on \? 'solid' : 'regular'\} fa-star/.test(wiring[1]), 'and its fill, matching what sidebar.js would draw');
    // The name-click rewrite still carries the filter onto the box it draws.
    assert(/const filter = projectSearch\(projects\)\?\.value \|\| ''/.test(source), 'the text in the box survives a rewrite');
    assert(/filterProjects\(projects, filter\)/.test(source), 'and the rows are narrowed again before the viewer sees the redraw');
  });

  await test('the master box is a toggle, and an open menu keeps its shape while boxes move (#185)', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // The toggle: a click moves every box on the roster to the master's new
    // state, in place - unticking it is how a subset is built up from nothing.
    assert(/one\.checked = master\.checked/.test(source), 'a master click sets every slug box to its own new state');
    assert(/master\.indeterminate = false;/.test(source), 'and leaves no half state behind');
    // The shape: box clicks narrow the BOARD but never redraw the open menu -
    // reaching exactly one tick must not collapse it to single mode under the
    // pointer - so both handlers pass the no-reshape flag and tell the master
    // in place instead.
    assert(/chosen\.join\(','\) : ''\) : NONE, false\)/.test(source), 'a slug box applies its scope - down to the none state (#188) - without reshaping the menu');
    assert(/master\.checked = chosen\.length === boxes\.length/.test(source), 'and updates the master summary where it stands');
    assert(/master\.indeterminate = chosen\.length > 0 && chosen\.length < boxes\.length/.test(source), 'including the half state markup cannot say');
    // The reshape happens at close, unconditionally: a build made and unmade
    // leaves the key unchanged, so the key is dropped rather than compared.
    const reshape = /data-tower-reshape'\)\) \{([\s\S]*?)\n    \}/.exec(source);
    assert(reshape, 'the close redraw is wired once, behind its own claim marker');
    assert(/hidden\.bs\.dropdown/.test(reshape[1]), 'on the same close event that clears the filter');
    assert(/paintedProjects = null;/.test(reshape[1]) && /paintProjects\(\);/.test(reshape[1]), 'dropping the key so the redraw is unconditional');
  });

  await test('every page reads the selection as a SET, and no consumer compares it as a slug', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    // The Board's repo column and its denominator is the one page left that
    // reads the selection directly rather than through state.js, converted to
    // the set (#104). The Brief read it too until it stopped being about the
    // board at all (#181) - a published morning is roster-wide.
    const board = fs.readFileSync(path.join(pages, 'board.js'), 'utf8');
    assert(/selectedSlugs\(state\)/.test(board), 'the Board asks for the slugs');
    assert(!/state\.selectedRepo/.test(board), 'and never for the raw value it used to compare');
    const brief = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(!/state\.selectedRepo/.test(brief), 'and the Brief compares nothing as a slug either');
    // state.js is the rest of them - every page narrows through these three.
    const reader = fs.readFileSync(path.join(libs, 'state.js'), 'utf8');
    assertEq((reader.match(/selectedSlugs\(state\)/g) || []).length, 3, 'reposFor, issuesFor and inSelectedRepo, all through the one parse');
    assert(!/state\.selectedRepo ===|repo\.slug === state\.selectedRepo/.test(reader), 'no equality against the raw value survives');
    // The intake dialog pre-selects a repo, and a subset names no single one.
    const intake = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/selectedSlugs|parseRepos/.test(intake), 'the intake dialog parses it too');
  });

  await test('the token has one home, and it is the Settings page', () => {
    // The button that forgot a token used to sit in the chrome of every page,
    // and the field that typed one sat in a dialog over it. Both are one page
    // now (#167), and the sentence the intake dialog says while locked points
    // at it rather than at "any page".
    assert(!chrome.chromeMarkup().includes('id="tower-token"'), 'no page chrome carries a token control');
    assert(format.LOCKED_NOTICE.includes('Settings page'), 'the locked write notice names where a token goes');
    assert(!/open any page/.test(format.LOCKED_NOTICE), 'and no longer says any page will do');
    const src = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js');
    const typed = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/data-token-input|writeToken\(/.test(fs.readFileSync(full, 'utf8'))) typed.push(path.relative(src, full).split(path.sep).join('/'));
    });
    walk(src);
    assertEq(typed.sort().join(','), 'libs/tower/github/token.js,libs/tower/token.js', 'a token is typed and stored in those two files and nowhere else');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
