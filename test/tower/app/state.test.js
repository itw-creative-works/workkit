//
// Tests for the tower dashboard's state.js: what a feed said, what the repo
// selection leaves in play, the issue behind a dragged card. Prologue: ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkState, failed, ROSTER } = require('./helpers');

let format, state, modal;
before(async () => { ({ format, state, modal } = await loadLibs()); });

describe('tower/app: state - what a feed said', () => {
  test('a feed that has not answered yet reads as empty, not as an error', () => {
    const empty = { feeds: {}, selectedRepo: '' };
    expect(state.feed(empty, 'repos'), 'no result yet').toBe(null);
    expect(state.repos(empty).length, 'no roster').toBe(0);
    expect(state.board(empty), 'no board').toBe(null);
    expect(state.sessions(empty).length, 'no crew').toBe(0);
    expect(Object.keys(state.health(empty)).length, 'no readings').toBe(0);
    expect(state.brief(empty), 'and no brief').toBe(null);
  });

  test('the brief payload has one reader, and three pages take it from there', () => {
    // The Overview's charts, the Brief itself and the Health page's stale-brief
    // row all want the same feed's data; it is read here rather than copied into
    // each page module.
    const answered = mkState({ brief: { counts: { open: 3 } } });
    expect(state.brief(answered).counts.open, 'a feed that answered hands back its payload').toBe(3);
    expect(state.brief({ feeds: { brief: failed('connection refused') }, selectedRepo: '' }), 'and a read that failed is null, never a payload with nothing in it').toBe(null);
  });

  test('a feed that failed reads as empty too - a page draws its own reason', () => {
    const broken = { feeds: { repos: failed('connection refused'), board: failed('connection refused') }, selectedRepo: '' };
    expect(state.repos(broken).length, 'no roster from a failed read').toBe(0);
    expect(state.board(broken), 'and no board').toBe(null);
    expect(state.feed(broken, 'repos').reason, 'while the reason survives for the page to show').toBe('connection refused');
  });

  test('a local-only slot is a designed state, not an unavailable feed', () => {
    // The chrome's chip counts every feed that is not `ok` (the poller's stale
    // rule), so a published copy's machine-bound slot is `ok` and marked, never
    // failed, and the panels draw from the marker.
    const slot = state.localOnlySlot();
    expect(slot.ok, 'nothing failed - this copy simply is not that machine').toBe(true);
    expect(slot.localOnly, 'and the marker says which of the two it is').toBe(true);
    expect(slot.reason, 'carrying the one sentence, from its one home').toBe(format.LOCAL_ONLY_NOTICE);
    const published = { feeds: { board: { ok: true, data: {} }, sessions: slot, health: slot }, selectedRepo: '' };
    expect(state.localOnly(published, 'sessions') && state.localOnly(published, 'health'), 'both machine-bound slots read as local-only').toBeTruthy();
    expect(state.localOnly(published, 'board'), 'a feed that really answered does not').toBe(false);
    expect(state.localOnly({ feeds: {}, selectedRepo: '' }, 'sessions'), 'and neither does one that has not answered yet').toBe(false);
    expect(state.sessions(published).length, 'the accessors still hand back nothing to draw').toBe(0);
    expect(Object.keys(state.health(published)).length, 'from either of them').toBe(0);
  });
});

describe('tower/app: state - the repo selection', () => {
  test('with nothing selected every repo, issue and session is in play', () => {
    const all = mkState({
      repos: ROSTER,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }] },
      sessions: [{ cwd: '/repos/ITW/workkit' }, { cwd: '/somewhere/else' }],
    });
    expect(state.reposFor(all).length, 'both repos').toBe(2);
    expect(state.issuesFor(all).length, 'both issues').toBe(2);
    expect(state.sessionsFor(all).length, 'both sessions, wherever they are').toBe(2);
  });

  test('a selected repo narrows the roster and the issues to it', () => {
    const one = mkState({
      repos: ROSTER,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }] },
    }, 'workkit');
    expect(state.reposFor(one).length, 'one repo').toBe(1);
    expect(state.issuesFor(one)[0].repo, 'and only its issues').toBe('workkit');
  });

  test('a comma list narrows to the SUBSET it names, not to nothing', () => {
    // `?repo=` is a list, and any predicate still comparing it as one slug
    // matches no repo at all and empties the page.
    const roster = [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles', name: 'dotfiles' }];
    const two = mkState({
      repos: roster,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }, { repo: 'dotfiles', number: 3 }] },
      sessions: [{ cwd: '/repos/ITW/workkit' }, { cwd: '/repos/Omega/omega/packages/web' }, { cwd: '/repos/dotfiles' }],
    }, 'workkit,omega');
    expect(state.reposFor(two).map((repo) => repo.slug).join('|'), 'the two repos named').toBe('workkit|omega');
    expect(state.issuesFor(two).map((issue) => issue.number).join('|'), 'their issues, and not the third repo’s').toBe('1|2');
    expect(state.sessionsFor(two).length, 'and the sessions under either of them').toBe(2);
    expect(state.inSelectedRepo(two, '/repos/Omega/omega'), 'a cwd in the second repo of the list is in scope').toBeTruthy();
    expect(!state.inSelectedRepo(two, '/repos/dotfiles'), 'and one outside the list is not').toBeTruthy();
  });

  test('a session is placed by its cwd - the defect the Crew page shipped with', () => {
    const one = mkState({ repos: ROSTER }, 'workkit');
    expect(state.inSelectedRepo(one, '/repos/ITW/workkit'), 'the repo root itself').toBeTruthy();
    expect(state.inSelectedRepo(one, '/repos/ITW/workkit/tower/api'), 'and anything under it').toBeTruthy();
    expect(!state.inSelectedRepo(one, '/repos/Omega/omega'), 'another repo is out').toBeTruthy();
    // The prefix test has to respect the separator, or a sibling directory whose
    // name merely starts with the repo's would read as inside it.
    expect(!state.inSelectedRepo(one, '/repos/ITW/workkit-scratch'), 'a lookalike sibling is out too').toBeTruthy();
    expect(!state.inSelectedRepo(one, ''), 'and a session with no cwd cannot be placed here').toBeTruthy();
  });

  test('a selection naming a repo the roster does not carry places nothing', () => {
    const gone = mkState({ repos: ROSTER, sessions: [{ cwd: '/repos/ITW/workkit' }] }, 'deleted-repo');
    expect(state.sessionsFor(gone).length, 'no session belongs to a repo that is not there').toBe(0);
  });

  test('sessionsFor narrows the live crew by the same rule', () => {
    const one = mkState({
      repos: ROSTER,
      sessions: [
        { session: 'a', cwd: '/repos/ITW/workkit' },
        { session: 'b', cwd: '/repos/ITW/workkit/tower' },
        { session: 'c', cwd: '/repos/Omega/omega' },
      ],
    }, 'workkit');
    expect(state.sessionsFor(one).map((s) => s.session).join(''), 'the two in the repo, in order').toBe('ab');
  });
});

describe('tower/app: state - the issue behind a dragged card', () => {
  /** A board feed as a poll writes it: a new object graph every time. */
  const mkBoardState = () => mkState({
    board: {
      issues: [
        { repo: 'ITW/workkit', number: 48, status: 'specced' },
        { repo: 'Omega/omega', number: 7, status: 'inbox' },
      ],
    },
  });

  test('a key finds the issue the board is holding, and a stranger finds nothing', () => {
    const live = mkBoardState();
    expect(state.issueByKey(live, 'ITW/workkit#48').number, 'the one the card named').toBe(48);
    expect(state.issueByKey(live, 'Omega/omega#7').status, 'and the other repo\'s, by the same key').toBe('inbox');
    expect(state.issueByKey(live, 'ITW/workkit#999'), 'a key nothing answers to is null, never undefined').toBe(null);
    expect(state.issueByKey(mkState({}), 'ITW/workkit#48'), 'and a board that has not answered has no issues to find').toBe(null);
  });

  test('the key it looks up is the one a card carries - one spelling, three readers', () => {
    const live = mkBoardState();
    const [issue] = state.issuesFor(live);
    expect(format.issueKey(issue), 'the attribute value').toBe('ITW/workkit#48');
    expect(modal.issueTrigger(issue).includes(`data-issue="${format.issueKey(issue)}"`), 'is what the trigger writes').toBeTruthy();
    expect(state.issueByKey(live, format.issueKey(issue)), 'and what the drop resolves back to the same object').toBe(issue);
  });

  test('the answer is the LIVE object - the regression a quiet poll used to cause', () => {
    // A drop resolves against the live graph, not a map built at the last paint:
    // a quiet poll repaints nothing, so a paint-time map holds objects nothing
    // draws from, and the optimistic move would mutate a detached one.
    const live = mkBoardState();
    const atPaint = state.issueByKey(live, 'ITW/workkit#48');

    // A quiet poll: same values, brand new objects, exactly as JSON.parse leaves them.
    live.feeds.board = { ok: true, data: JSON.parse(JSON.stringify(state.board(live))) };

    const atDrop = state.issueByKey(live, 'ITW/workkit#48');
    expect(atDrop !== atPaint, 'the poll replaced the object, which is the whole problem').toBeTruthy();
    atDrop.status = 'blocked';
    expect(state.issuesFor(live).find((issue) => issue.number === 48).status, 'moving what the DROP resolved moves what the next paint draws').toBe('blocked');
    expect(atPaint.status, 'while the paint-time object is the detached one, and mutating it would have drawn nothing').toBe('specced');
  });

  test('the optimistic move and its revert are one round trip on the live graph', () => {
    const live = mkBoardState();
    const issue = state.issueByKey(live, 'ITW/workkit#48');
    const from = issue.status;

    // Forward: what the Board does before the write goes out.
    issue.status = 'blocked';
    expect(state.issueByKey(live, 'ITW/workkit#48').status, 'the card is in the new column at once').toBe('blocked');

    // Back: what it does when the write answers with a reason.
    issue.status = from;
    expect(state.issueByKey(live, 'ITW/workkit#48').status, 'and back where it came from, not left in a state nothing agreed to').toBe('specced');
  });

  test('the no-status alert is drawn from the SCOPED issues, so a repo out of scope neither shows nor counts', () => {
    // The alert is markup from values (format.js) and the narrowing is
    // state.js's, so what the page contributes is handing one to the other -
    // which is exactly what an out-of-scope unlabelled issue leaking onto the
    // board would break.
    const scoped = mkState({
      repos: ROSTER,
      board: {
        issues: [
          { repo: 'workkit', number: 1, title: 'In scope, no label', url: 'https://gh/workkit/1' },
          { repo: 'omega', number: 2, title: 'Out of scope, no label', url: 'https://gh/omega/2' },
        ],
      },
    }, 'workkit');
    const markup = format.noStatusAlert(state.issuesFor(scoped), false);
    expect(markup.includes('1 issue carries no status label'), 'only the one in scope is counted').toBeTruthy();
    expect(markup.includes('https://gh/workkit/1'), 'and it is the one linked').toBeTruthy();
    expect(!markup.includes('https://gh/omega/2'), 'the other repo’s is not on this board at all').toBeTruthy();
  });
});
