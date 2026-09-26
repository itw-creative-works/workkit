//
// Tests for the tower dashboard's sidebar.js: the project selector.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkState, ROSTER } = require('./helpers');

const run = async () => {
  const { scope, sidebar } = await loadLibs();

  group('tower/app: sidebar - the project selector');

  await test('an unread roster fills nothing into the menu', () => {
    assertEq(sidebar.menuMarkup(mkState({})), '', 'nothing to switch between yet - the theme’s placeholder stays');
    assertEq(sidebar.sidebarKey(mkState({})), '', 'and the key says so, never undefined');
  });

  await test('the menu is ONE row per repo, under the All projects master row', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assert(markup.includes('data-tower-scope="workkit"') && markup.includes('data-tower-scope="omega"'), 'every slug is a row');
    assert(markup.includes('data-tower-scope=""'), 'and All projects is the empty selection');
    assert(markup.includes('>All projects</button>'), 'named in words');
    assert(/data-tower-scope=""[^>]*aria-current="true"/.test(markup), 'nothing selected marks All as the one in force');
    assert(markup.includes('<button type="button" class="dropdown-item flex-grow-1 active" data-tower-scope=""'), 'in Bootstrap’s own dropdown-item shape');
    // The whole point of #168: a repo appears once, not once as an entry and
    // again as a checkbox in a second section below.
    assertEq((markup.match(/<li /g) || []).length, ROSTER.length + 2, 'the roster, the master row and the search box above them, and nothing else');
    assertEq((markup.match(/>workkit</g) || []).length, 1, 'each repo is named exactly once');
    assert(!/Filter projects|dropdown-header|dropdown-divider/.test(markup), 'there is no second section to divide off');
  });

  await test('a single project is the marked row, and the boxes are gone with it', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'workkit'));
    assert(/class="dropdown-item flex-grow-1 active" data-tower-scope="workkit"/.test(markup), 'the repo in force is marked');
    assert(!/flex-grow-1 active" data-tower-scope=""/.test(markup), 'and All is not');
    assert(!markup.includes('data-tower-scope-slug'), 'one repo is not a subset, so there is nothing to tick');
    assert(!markup.includes('data-tower-scope-all'), 'and no master box either - the whole board is not on screen to narrow');
    assertEq((markup.match(/<li /g) || []).length, ROSTER.length + 2, 'the rows themselves stay, so All projects is one click back');
    assertEq((markup.match(/data-tower-favorite="/g) || []).length, ROSTER.length, 'and every row keeps its star - a favorite is not a scope');
  });

  await test('a search box sits above every row, once there are rows to narrow (#185)', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assert(markup.indexOf('data-tower-project-search') < markup.indexOf('data-tower-scope='), 'it is the first thing in the menu, above All projects');
    assert(markup.includes('<input type="search" class="form-control form-control-sm"'), 'a Bootstrap field, sized to the menu it sits in');
    assert(markup.includes('placeholder="Search projects"'), 'named on screen');
    assert(markup.includes('aria-label="Search projects"'), 'and to a screen reader, which has no placeholder to read');
    assert(markup.includes('data-tower-project-filter'), 'its row carries the hook the sheet sticks to the top of the scroll');
    // Filtering is the runtime's, in place: the markup is the same list either
    // way, which is what keeps this module pure.
    assert(!/d-none/.test(markup), 'no row is drawn hidden - a filter is display, not markup');
    assertEq(sidebar.menuMarkup(mkState({ repos: [] })), '', 'a roster with nothing on it draws no box - there is nothing to search');
  });

  await test('every repo row carries a star, and the starred ones are drawn first (#186)', () => {
    const none = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assertEq((none.match(/data-tower-favorite="/g) || []).length, ROSTER.length, 'one star per repo, and none on the master row');
    assert(/data-tower-favorite="workkit" aria-pressed="false"/.test(none), 'nothing is favorited until something says so');
    assert(/class="[^"]*text-body-secondary" data-tower-favorite="workkit"/.test(none), 'a star that is off is the quiet gray');
    assert(none.includes('<i class="fa-regular fa-star" aria-hidden="true">'), 'drawn hollow, and the glyph is decoration - the button carries the name');
    assert(none.includes('aria-label="Favorite workkit"'), 'which is what the button says it does');

    const kept = sidebar.menuMarkup({ ...mkState({ repos: ROSTER }), favorites: ['omega'] });
    assert(/data-tower-favorite="omega" aria-pressed="true"/.test(kept), 'a favorite says so where a screen reader reads it');
    assert(/class="[^"]*text-warning" data-tower-favorite="omega"/.test(kept), 'and wears the warm colour');
    assert(kept.includes('<i class="fa-solid fa-star" aria-hidden="true">'), 'filled in');
    assert(/data-tower-favorite="workkit" aria-pressed="false"/.test(kept), 'the rest are untouched');
  });

  await test('a favorite lifts its row to the top, and roster order holds inside each group', () => {
    const roster = [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }];
    const rowsOf = (markup) => [...markup.matchAll(/data-tower-scope="([^"]*)"/g)].map((match) => match[1]);
    assertEq(rowsOf(sidebar.menuMarkup(mkState({ repos: roster }))).join(','), ',workkit,omega,dotfiles', 'no favorites is the roster as it came, under the master row');
    const kept = sidebar.menuMarkup({ ...mkState({ repos: roster }), favorites: ['dotfiles'] });
    assertEq(rowsOf(kept).join(','), ',dotfiles,workkit,omega', 'the star goes first, and the two behind it keep their order');
    const two = sidebar.menuMarkup({ ...mkState({ repos: roster }), favorites: ['dotfiles', 'workkit'] });
    assertEq(rowsOf(two).join(','), ',workkit,dotfiles,omega', 'and two favorites are in the roster’s order too, never the order they were starred in');
    assert(two.startsWith('<li class="px-3 pb-2" data-tower-project-filter'), 'the search box is still above all of it');
  });

  await test('a box rides every row while the board is the whole one, or a subset of it', () => {
    const all = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assert(all.includes('data-tower-scope-slug="workkit"') && all.includes('data-tower-scope-slug="omega"'), 'a box per repo');
    assert(all.includes('data-tower-scope-all'), 'and the master box on the row above them');
    assertEq((all.match(/ checked/g) || []).length, 3, 'every repo is in play, and every box says so - the master with them');
    assert(!all.includes('data-tower-indeterminate'), 'nothing is half-selected when everything is selected');
    assert(all.includes('aria-label="Include workkit"'), 'each box names what ticking it does - the name beside it is a button, not its label');

    const subset = sidebar.menuMarkup(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] }, 'workkit,omega'));
    assert(/flex-grow-1 active" data-tower-scope=""/.test(subset), 'All stays the active row - a subset is the whole board, narrowed');
    assertEq((subset.match(/ checked/g) || []).length, 2, 'exactly the two the URL names');
    assert(/data-tower-scope-slug="dotfiles"(?![^>]* checked)/.test(subset), 'the repo left out is unchecked');
    assert(/data-tower-scope-all[^>]* data-tower-indeterminate/.test(subset), 'and the master row is neither on nor off, which the runtime sets as the property');
  });

  await test('the master box says what the boxes under it say, whatever the URL names', () => {
    // A shared `?repo=` can name every repo on the roster - a "subset" that is
    // the whole board. Half-ticking the master there would be a lie about rows
    // that are all ticked.
    const whole = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'workkit,omega'));
    assert(!whole.includes('data-tower-indeterminate'), 'a subset naming every repo leaves nothing out');
    assert(/data-tower-scope-all[^>]* checked/.test(whole), 'so the master is ticked, like every row under it');
    assertEq((whole.match(/ checked/g) || []).length, 3, 'and the rows are ticked too');

    // The other end: a link naming only repos this machine no longer carries.
    // No row is ticked, so the master is neither ticked nor half-ticked.
    const gone = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'gone/away,also/gone'));
    assertEq((gone.match(/ checked/g) || []).length, 0, 'nothing on the roster is in play');
    assert(!gone.includes('data-tower-indeterminate'), 'and half-ticked would claim something is');
  });

  await test('unticking everything is the none state: boxes stay, nothing ticks, nothing is active (#188)', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }, scope.NONE));
    assert(markup.includes('data-tower-scope-slug="workkit"'), 'the boxes stay on screen - the state is the start of a build, never single mode');
    assert(!/ checked/.test(markup), 'and not one of them is ticked, the master included');
    assert(!markup.includes('data-tower-indeterminate'), 'the master is plainly off, not half');
    assert(!/aria-current/.test(markup), 'no row is in force - the board behind the menu is honestly empty');
    const label = sidebar.selectorLabel(mkState({ repos: ROSTER }, scope.NONE));
    assertEq(label.name, 'No projects', 'the trigger explains the empty board in words, never as a tilde');
    assertEq(label.env, '2 hidden', 'and counts what the state hides');
    // To every page the tilde is just a selection placing nothing - the state
    // the pages already handle - and `isNone` is the one comparison door.
    assertEq(scope.inScope(scope.parseRepos(scope.NONE), 'workkit'), false, 'no repo is in scope under it');
    assert(scope.isNone(scope.parseRepos(scope.NONE)), 'the door answers for the parsed selection');
    assertEq(scope.scopedHref('/board', scope.NONE), '/board?repo=~', 'and the URL carries the tilde itself, never %7E - a query is a thing people copy');
    // The surfaces that SAY the state say it in words (the review pass caught
    // the tilde escaping into all three).
    const pagesDir = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const pageSrc = (name) => require('fs').readFileSync(path.join(pagesDir, name), 'utf8');
    // The Board has no count line to say it in (#203): its none state is the
    // picker's own words and seven empty lanes, and the tilde never reaches the page.
    assert(!/~/.test(pageSrc('board.js').replace(/\/\/.*$/gm, '')), 'the Board never prints the tilde itself');
    for (const page of ['index.js', 'health.js']) {
      assert(/isNone\(selectedSlugs\(state\)\) \? 'no projects selected/.test(pageSrc(page)), `${page} tells an unticked roster apart from an empty one`);
    }
  });

  await test('the selector button says which mode is in force', () => {
    const none = sidebar.selectorLabel(mkState({ repos: ROSTER }));
    assertEq(none.name, 'All projects', 'no selection is the whole board');
    assertEq(none.initial, 'A', 'and the tile is the name’s first character, upcased');
    assert(none.env.includes('2'), 'the second line counts the roster behind it');

    const one = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'workkit'));
    assertEq(one.name, 'workkit', 'one repo is named');
    assertEq(one.initial, 'W', 'and it is its own initial');
    assertEq(one.env, '1 of 2 repos', 'against the roster it was picked out of');

    const many = sidebar.selectorLabel(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/x' }] }, 'workkit,omega'));
    assertEq(many.name, '2 of 3 projects', 'a subset says its own arithmetic on the trigger (#168), never All projects');
    assertEq(many.env, '1 hidden', 'and the line under it says the half the count leaves out');

    const unread = sidebar.selectorLabel(mkState({}));
    assertEq(unread.name, 'All projects', 'before the roster answers the button is not blank');
    assert(!/\d/.test(unread.env), 'and it counts nothing it has not read');

    // A shared link can name a repo the roster no longer carries. Every page
    // narrows to nothing then, and the button NAMING that slug is what explains
    // the empty board - reading "All projects" there would be a lie.
    const offRoster = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'gone/away'));
    assertEq(offRoster.name, 'gone/away', 'an off-roster selection is still the selection');
    assertEq(offRoster.env, '1 of 2 repos', 'counted against the roster it is not on');
  });

  await test('a subset never counts against a roster that cannot answer for it', () => {
    // Two ways the raw selection outruns the roster, and neither of them may
    // put a negative number on the button.
    const early = sidebar.selectorLabel(mkState({}, 'workkit,omega'));
    assertEq(early.name, '2 projects', 'before the roster answers, the count of what was chosen is all there is to say');
    assert(!/\d/.test(early.env), 'and the line under it counts nothing it has not read');

    const stale = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'workkit,omega,gone/away'));
    assertEq(stale.name, '3 projects', 'a link naming more repos than the roster carries is still 3 chosen, never 3 of 2');
    assertEq(stale.env, 'all 2 repos on the roster', 'with nothing hidden behind it - the board is showing every repo it has');
    for (const label of [early, stale]) assert(!label.env.includes('-') && !label.name.includes('-'), 'and no line goes negative');
  });

  await test('the menu is rewritten for the selection and the roster, and for nothing a poll does', () => {
    const CHROME_STATE = mkState({ repos: ROSTER });
    assertEq(sidebar.sidebarKey({ ...CHROME_STATE, pending: true, stamp: 'a' }), sidebar.sidebarKey({ ...CHROME_STATE, pending: false, stamp: 'b' }),
      'a read landing is not a reason to redraw the boxes under the pointer');
    assert(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey({ ...CHROME_STATE, selectedRepo: 'omega' }), 'a new selection redraws it');
    const grown = mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] });
    assert(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey(grown), 'and so does a repo joining the roster');
    assert(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey({ ...CHROME_STATE, favorites: ['omega'] }), 'a star redraws it too, so the toggle is on screen at the next paint');
    // The case the key's own favorites segment is there for: a star that changes
    // which row is MARKED without changing the order the rows come in.
    const solo = mkState({ repos: [ROSTER[0]] });
    assert(sidebar.sidebarKey(solo) !== sidebar.sidebarKey({ ...solo, favorites: ['workkit'] }), 'even when the row it marks was already first');
    assertEq(sidebar.sidebarKey({ ...mkState({}), favorites: ['omega'] }), '', 'and an unread roster is still the empty key, stars or no stars');
  });

  await test('a hostile slug is text, in the attribute and in the label', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: [{ slug: '"><img src=x>', path: '/x' }] }));
    assert(!markup.includes('<img'), 'no markup comes through the roster');
    assert(markup.includes('&quot;&gt;&lt;img src=x&gt;'), 'it is drawn as the text it is');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
