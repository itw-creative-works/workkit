//
// Tests for the tower dashboard's sidebar.js: the project selector.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkState, ROSTER } = require('./helpers');

describe('tower/app: sidebar - the project selector', () => {
  let scope, sidebar;
  before(async () => { ({ scope, sidebar } = await loadLibs()); });

  test('an unread roster fills nothing into the menu', () => {
    expect(sidebar.menuMarkup(mkState({})), 'nothing to switch between yet - the theme’s placeholder stays').toBe('');
    expect(sidebar.sidebarKey(mkState({})), 'and the key says so, never undefined').toBe('');
  });

  test('the menu is ONE row per repo, under the All projects master row', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    expect(markup.includes('data-tower-scope="workkit"') && markup.includes('data-tower-scope="omega"'), 'every slug is a row').toBeTruthy();
    expect(markup.includes('data-tower-scope=""'), 'and All projects is the empty selection').toBeTruthy();
    expect(markup.includes('>All projects</button>'), 'named in words').toBeTruthy();
    expect(/data-tower-scope=""[^>]*aria-current="true"/.test(markup), 'nothing selected marks All as the one in force').toBeTruthy();
    expect(markup.includes('<button type="button" class="dropdown-item flex-grow-1 active" data-tower-scope=""'), 'in Bootstrap’s own dropdown-item shape').toBeTruthy();
    // A repo appears once, never again as a checkbox in a second section below.
    expect((markup.match(/<li /g) || []).length, 'the roster, the master row and the search box above them, and nothing else').toBe(ROSTER.length + 2);
    expect((markup.match(/>workkit</g) || []).length, 'each repo is named exactly once').toBe(1);
    expect(!/Filter projects|dropdown-header|dropdown-divider/.test(markup), 'there is no second section to divide off').toBeTruthy();
  });

  test('a single project is the marked row, and the boxes are gone with it', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'workkit'));
    expect(/class="dropdown-item flex-grow-1 active" data-tower-scope="workkit"/.test(markup), 'the repo in force is marked').toBeTruthy();
    expect(!/flex-grow-1 active" data-tower-scope=""/.test(markup), 'and All is not').toBeTruthy();
    expect(!markup.includes('data-tower-scope-slug'), 'one repo is not a subset, so there is nothing to tick').toBeTruthy();
    expect(!markup.includes('data-tower-scope-all'), 'and no master box either - the whole board is not on screen to narrow').toBeTruthy();
    expect((markup.match(/<li /g) || []).length, 'the rows themselves stay, so All projects is one click back').toBe(ROSTER.length + 2);
    expect((markup.match(/data-tower-favorite="/g) || []).length, 'and every row keeps its star - a favorite is not a scope').toBe(ROSTER.length);
  });

  test('a search box sits above every row, once there are rows to narrow (#185)', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    expect(markup.indexOf('data-tower-project-search') < markup.indexOf('data-tower-scope='), 'it is the first thing in the menu, above All projects').toBeTruthy();
    expect(markup.includes('<input type="search" class="form-control form-control-sm"'), 'a Bootstrap field, sized to the menu it sits in').toBeTruthy();
    expect(markup.includes('placeholder="Search projects"'), 'named on screen').toBeTruthy();
    expect(markup.includes('aria-label="Search projects"'), 'and to a screen reader, which has no placeholder to read').toBeTruthy();
    expect(markup.includes('data-tower-project-filter'), 'its row carries the hook the sheet sticks to the top of the scroll').toBeTruthy();
    // Filtering is the runtime's, in place: the markup is the same list either
    // way, which is what keeps this module pure.
    expect(!/d-none/.test(markup), 'no row is drawn hidden - a filter is display, not markup').toBeTruthy();
    expect(sidebar.menuMarkup(mkState({ repos: [] })), 'a roster with nothing on it draws no box - there is nothing to search').toBe('');
  });

  test('every repo row carries a star, and the starred ones are drawn first (#186)', () => {
    const none = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    expect((none.match(/data-tower-favorite="/g) || []).length, 'one star per repo, and none on the master row').toBe(ROSTER.length);
    expect(/data-tower-favorite="workkit" aria-pressed="false"/.test(none), 'nothing is favorited until something says so').toBeTruthy();
    expect(/class="[^"]*text-body-secondary" data-tower-favorite="workkit"/.test(none), 'a star that is off is the quiet gray').toBeTruthy();
    expect(none.includes('<i class="fa-regular fa-star" aria-hidden="true">'), 'drawn hollow, and the glyph is decoration - the button carries the name').toBeTruthy();
    expect(none.includes('aria-label="Favorite workkit"'), 'which is what the button says it does').toBeTruthy();

    const kept = sidebar.menuMarkup({ ...mkState({ repos: ROSTER }), favorites: ['omega'] });
    expect(/data-tower-favorite="omega" aria-pressed="true"/.test(kept), 'a favorite says so where a screen reader reads it').toBeTruthy();
    expect(/class="[^"]*text-warning" data-tower-favorite="omega"/.test(kept), 'and wears the warm colour').toBeTruthy();
    expect(kept.includes('<i class="fa-solid fa-star" aria-hidden="true">'), 'filled in').toBeTruthy();
    expect(/data-tower-favorite="workkit" aria-pressed="false"/.test(kept), 'the rest are untouched').toBeTruthy();
  });

  test('a favorite lifts its row to the top, and roster order holds inside each group', () => {
    const roster = [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }];
    const rowsOf = (markup) => [...markup.matchAll(/data-tower-scope="([^"]*)"/g)].map((match) => match[1]);
    expect(rowsOf(sidebar.menuMarkup(mkState({ repos: roster }))).join(','), 'no favorites is the roster as it came, under the master row').toBe(',workkit,omega,dotfiles');
    const kept = sidebar.menuMarkup({ ...mkState({ repos: roster }), favorites: ['dotfiles'] });
    expect(rowsOf(kept).join(','), 'the star goes first, and the two behind it keep their order').toBe(',dotfiles,workkit,omega');
    const two = sidebar.menuMarkup({ ...mkState({ repos: roster }), favorites: ['dotfiles', 'workkit'] });
    expect(rowsOf(two).join(','), 'and two favorites are in the roster’s order too, never the order they were starred in').toBe(',workkit,dotfiles,omega');
    expect(two.startsWith('<li class="px-3 pb-2" data-tower-project-filter'), 'the search box is still above all of it').toBeTruthy();
  });

  test('a box rides every row while the board is the whole one, or a subset of it', () => {
    const all = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    expect(all.includes('data-tower-scope-slug="workkit"') && all.includes('data-tower-scope-slug="omega"'), 'a box per repo').toBeTruthy();
    expect(all.includes('data-tower-scope-all'), 'and the master box on the row above them').toBeTruthy();
    expect((all.match(/ checked/g) || []).length, 'every repo is in play, and every box says so - the master with them').toBe(3);
    expect(!all.includes('data-tower-indeterminate'), 'nothing is half-selected when everything is selected').toBeTruthy();
    expect(all.includes('aria-label="Include workkit"'), 'each box names what ticking it does - the name beside it is a button, not its label').toBeTruthy();

    const subset = sidebar.menuMarkup(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] }, 'workkit,omega'));
    expect(/flex-grow-1 active" data-tower-scope=""/.test(subset), 'All stays the active row - a subset is the whole board, narrowed').toBeTruthy();
    expect((subset.match(/ checked/g) || []).length, 'exactly the two the URL names').toBe(2);
    expect(/data-tower-scope-slug="dotfiles"(?![^>]* checked)/.test(subset), 'the repo left out is unchecked').toBeTruthy();
    expect(/data-tower-scope-all[^>]* data-tower-indeterminate/.test(subset), 'and the master row is neither on nor off, which the runtime sets as the property').toBeTruthy();
  });

  test('the master box says what the boxes under it say, whatever the URL names', () => {
    // A shared `?repo=` can name every repo on the roster - a "subset" that is
    // the whole board. Half-ticking the master there would be a lie about rows
    // that are all ticked.
    const whole = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'workkit,omega'));
    expect(!whole.includes('data-tower-indeterminate'), 'a subset naming every repo leaves nothing out').toBeTruthy();
    expect(/data-tower-scope-all[^>]* checked/.test(whole), 'so the master is ticked, like every row under it').toBeTruthy();
    expect((whole.match(/ checked/g) || []).length, 'and the rows are ticked too').toBe(3);

    // The other end: a link naming only repos off this machine's roster. No
    // row is ticked, so the master is neither ticked nor half-ticked.
    const gone = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'gone/away,also/gone'));
    expect((gone.match(/ checked/g) || []).length, 'nothing on the roster is in play').toBe(0);
    expect(!gone.includes('data-tower-indeterminate'), 'and half-ticked would claim something is').toBeTruthy();
  });

  test('unticking everything is the none state: boxes stay, nothing ticks, nothing is active (#188)', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }, scope.NONE));
    expect(markup.includes('data-tower-scope-slug="workkit"'), 'the boxes stay on screen - the state is the start of a build, never single mode').toBeTruthy();
    expect(!/ checked/.test(markup), 'and not one of them is ticked, the master included').toBeTruthy();
    expect(!markup.includes('data-tower-indeterminate'), 'the master is plainly off, not half').toBeTruthy();
    expect(!/aria-current/.test(markup), 'no row is in force - the board behind the menu is honestly empty').toBeTruthy();
    const label = sidebar.selectorLabel(mkState({ repos: ROSTER }, scope.NONE));
    expect(label.name, 'the trigger explains the empty board in words, never as a tilde').toBe('No projects');
    expect(label.env, 'and counts what the state hides').toBe('2 hidden');
    // To every page the tilde is just a selection placing nothing - the state
    // the pages already handle - and `isNone` is the one comparison door.
    expect(scope.inScope(scope.parseRepos(scope.NONE), 'workkit'), 'no repo is in scope under it').toBe(false);
    expect(scope.isNone(scope.parseRepos(scope.NONE)), 'the door answers for the parsed selection').toBeTruthy();
    expect(scope.scopedHref('/board', scope.NONE), 'and the URL carries the tilde itself, never %7E - a query is a thing people copy').toBe('/board?repo=~');
  });

  test('the selector button says which mode is in force', () => {
    const none = sidebar.selectorLabel(mkState({ repos: ROSTER }));
    expect(none.name, 'no selection is the whole board').toBe('All projects');
    expect(none.initial, 'and the tile is the name’s first character, upcased').toBe('A');
    expect(none.env.includes('2'), 'the second line counts the roster behind it').toBeTruthy();

    const one = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'workkit'));
    expect(one.name, 'one repo is named').toBe('workkit');
    expect(one.initial, 'and it is its own initial').toBe('W');
    expect(one.env, 'against the roster it was picked out of').toBe('1 of 2 repos');

    const many = sidebar.selectorLabel(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/x' }] }, 'workkit,omega'));
    expect(many.name, 'a subset says its own arithmetic on the trigger (#168), never All projects').toBe('2 of 3 projects');
    expect(many.env, 'and the line under it says the half the count leaves out').toBe('1 hidden');

    const unread = sidebar.selectorLabel(mkState({}));
    expect(unread.name, 'before the roster answers the button is not blank').toBe('All projects');
    expect(!/\d/.test(unread.env), 'and it counts nothing it has not read').toBeTruthy();

    // A shared link can name a repo off the roster. Every page narrows to
    // nothing then, and the button naming that slug is what explains the empty
    // board; "All projects" there would be a lie.
    const offRoster = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'gone/away'));
    expect(offRoster.name, 'an off-roster selection is still the selection').toBe('gone/away');
    expect(offRoster.env, 'counted against the roster it is not on').toBe('1 of 2 repos');
  });

  test('a subset never counts against a roster that cannot answer for it', () => {
    // Two ways the raw selection outruns the roster, and neither of them may
    // put a negative number on the button.
    const early = sidebar.selectorLabel(mkState({}, 'workkit,omega'));
    expect(early.name, 'before the roster answers, the count of what was chosen is all there is to say').toBe('2 projects');
    expect(!/\d/.test(early.env), 'and the line under it counts nothing it has not read').toBeTruthy();

    const stale = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'workkit,omega,gone/away'));
    expect(stale.name, 'a link naming more repos than the roster carries is still 3 chosen, never 3 of 2').toBe('3 projects');
    expect(stale.env, 'with nothing hidden behind it - the board is showing every repo it has').toBe('all 2 repos on the roster');
    for (const label of [early, stale]) expect(!label.env.includes('-') && !label.name.includes('-'), 'and no line goes negative').toBeTruthy();
  });

  test('the menu is rewritten for the selection and the roster, and for nothing a poll does', () => {
    const CHROME_STATE = mkState({ repos: ROSTER });
    expect(sidebar.sidebarKey({ ...CHROME_STATE, pending: true, stamp: 'a' }), 'a read landing is not a reason to redraw the boxes under the pointer').toBe(sidebar.sidebarKey({ ...CHROME_STATE, pending: false, stamp: 'b' }));
    expect(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey({ ...CHROME_STATE, selectedRepo: 'omega' }), 'a new selection redraws it').toBeTruthy();
    const grown = mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] });
    expect(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey(grown), 'and so does a repo joining the roster').toBeTruthy();
    expect(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey({ ...CHROME_STATE, favorites: ['omega'] }), 'a star redraws it too, so the toggle is on screen at the next paint').toBeTruthy();
    // The case the key's own favorites segment is there for: a star that changes
    // which row is marked without changing the order the rows come in.
    const solo = mkState({ repos: [ROSTER[0]] });
    expect(sidebar.sidebarKey(solo) !== sidebar.sidebarKey({ ...solo, favorites: ['workkit'] }), 'even when the row it marks was already first').toBeTruthy();
    expect(sidebar.sidebarKey({ ...mkState({}), favorites: ['omega'] }), 'and an unread roster is still the empty key, stars or no stars').toBe('');
  });

  test('a hostile slug is text, in the attribute and in the label', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: [{ slug: '"><img src=x>', path: '/x' }] }));
    expect(!markup.includes('<img'), 'no markup comes through the roster').toBeTruthy();
    expect(markup.includes('&quot;&gt;&lt;img src=x&gt;'), 'it is drawn as the text it is').toBeTruthy();
  });
});
