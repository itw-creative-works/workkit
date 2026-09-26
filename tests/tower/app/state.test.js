//
// Tests for the tower dashboard's state.js: what a feed said, what the repo
// selection leaves in play, and the issue behind a dragged card.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkState, failed, ROSTER } = require('./helpers');

const run = async () => {
  const { format, state, modal } = await loadLibs();

  group('tower/app: state - what a feed said');

  await test('a feed that has not answered yet reads as empty, not as an error', () => {
    const empty = { feeds: {}, selectedRepo: '' };
    assertEq(state.feed(empty, 'repos'), null, 'no result yet');
    assertEq(state.repos(empty).length, 0, 'no roster');
    assertEq(state.board(empty), null, 'no board');
    assertEq(state.sessions(empty).length, 0, 'no crew');
    assertEq(Object.keys(state.health(empty)).length, 0, 'no readings');
    assertEq(state.brief(empty), null, 'and no brief');
  });

  await test('the brief payload has one reader, and three pages take it from there', () => {
    // The Overview's charts, the Brief itself and the Health page's stale-brief
    // row (#172) all want the same feed's data; it is read here rather than
    // copied into each page module.
    const answered = mkState({ brief: { counts: { open: 3 } } });
    assertEq(state.brief(answered).counts.open, 3, 'a feed that answered hands back its payload');
    assertEq(state.brief({ feeds: { brief: failed('connection refused') }, selectedRepo: '' }), null,
      'and a read that failed is null, never a payload with nothing in it');
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['index.js', 'health.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(/brief\(state\)/.test(source), `${name} reads it through the one accessor`);
      // Asking the raw slot whether it has ANSWERED yet is a different question,
      // and the Overview still asks it - what no page keeps is a second copy of
      // the reader that turns the slot into the payload.
      assert(!/briefPayload/.test(source), `${name} keeps no reader of its own`);
    }
  });

  await test('a feed that failed reads as empty too - a page draws its own reason', () => {
    const broken = { feeds: { repos: failed('connection refused'), board: failed('connection refused') }, selectedRepo: '' };
    assertEq(state.repos(broken).length, 0, 'no roster from a failed read');
    assertEq(state.board(broken), null, 'and no board');
    assertEq(state.feed(broken, 'repos').reason, 'connection refused', 'while the reason survives for the page to show');
  });

  await test('a local-only slot is a designed state, not an unavailable feed', () => {
    // The chrome's chip counts every feed that is not `ok` (the poller's own
    // stale rule), so a published copy marking its machine-bound slots failed
    // said "2 feeds unavailable" from first paint to last. The slot is `ok` and
    // MARKED instead, and the marker is what the panels draw from.
    const slot = state.localOnlySlot();
    assertEq(slot.ok, true, 'nothing failed - this copy simply is not that machine');
    assertEq(slot.localOnly, true, 'and the marker says which of the two it is');
    assertEq(slot.reason, format.LOCAL_ONLY_NOTICE, 'carrying the one sentence, from its one home');
    const published = { feeds: { board: { ok: true, data: {} }, sessions: slot, health: slot }, selectedRepo: '' };
    assert(state.localOnly(published, 'sessions') && state.localOnly(published, 'health'), 'both machine-bound slots read as local-only');
    assertEq(state.localOnly(published, 'board'), false, 'a feed that really answered does not');
    assertEq(state.localOnly({ feeds: {}, selectedRepo: '' }, 'sessions'), false, 'and neither does one that has not answered yet');
    assertEq(state.sessions(published).length, 0, 'the accessors still hand back nothing to draw');
    assertEq(Object.keys(state.health(published)).length, 0, 'from either of them');
  });

  group('tower/app: state - the repo selection');

  await test('with nothing selected every repo, issue and session is in play', () => {
    const all = mkState({
      repos: ROSTER,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }] },
      sessions: [{ cwd: '/repos/ITW/workkit' }, { cwd: '/somewhere/else' }],
    });
    assertEq(state.reposFor(all).length, 2, 'both repos');
    assertEq(state.issuesFor(all).length, 2, 'both issues');
    assertEq(state.sessionsFor(all).length, 2, 'both sessions, wherever they are');
  });

  await test('a selected repo narrows the roster and the issues to it', () => {
    const one = mkState({
      repos: ROSTER,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }] },
    }, 'workkit');
    assertEq(state.reposFor(one).length, 1, 'one repo');
    assertEq(state.issuesFor(one)[0].repo, 'workkit', 'and only its issues');
  });

  await test('a comma list narrows to the SUBSET it names, not to nothing', () => {
    // The bug class #104 hunts: `?repo=` became a list, and any predicate still
    // comparing it as one slug matches no repo at all and empties the page.
    const roster = [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles', name: 'dotfiles' }];
    const two = mkState({
      repos: roster,
      board: { issues: [{ repo: 'workkit', number: 1 }, { repo: 'omega', number: 2 }, { repo: 'dotfiles', number: 3 }] },
      sessions: [{ cwd: '/repos/ITW/workkit' }, { cwd: '/repos/Omega/omega/packages/web' }, { cwd: '/repos/dotfiles' }],
    }, 'workkit,omega');
    assertEq(state.reposFor(two).map((repo) => repo.slug).join('|'), 'workkit|omega', 'the two repos named');
    assertEq(state.issuesFor(two).map((issue) => issue.number).join('|'), '1|2', 'their issues, and not the third repo’s');
    assertEq(state.sessionsFor(two).length, 2, 'and the sessions under either of them');
    assert(state.inSelectedRepo(two, '/repos/Omega/omega'), 'a cwd in the second repo of the list is in scope');
    assert(!state.inSelectedRepo(two, '/repos/dotfiles'), 'and one outside the list is not');
  });

  await test('a session is placed by its cwd - the defect the Crew page shipped with', () => {
    const one = mkState({ repos: ROSTER }, 'workkit');
    assert(state.inSelectedRepo(one, '/repos/ITW/workkit'), 'the repo root itself');
    assert(state.inSelectedRepo(one, '/repos/ITW/workkit/tower/api'), 'and anything under it');
    assert(!state.inSelectedRepo(one, '/repos/Omega/omega'), 'another repo is out');
    // The prefix test has to respect the separator, or a sibling directory whose
    // name merely STARTS with the repo's would read as inside it.
    assert(!state.inSelectedRepo(one, '/repos/ITW/workkit-scratch'), 'a lookalike sibling is out too');
    assert(!state.inSelectedRepo(one, ''), 'and a session with no cwd cannot be placed here');
  });

  await test('a selection naming a repo the roster does not carry places nothing', () => {
    const gone = mkState({ repos: ROSTER, sessions: [{ cwd: '/repos/ITW/workkit' }] }, 'deleted-repo');
    assertEq(state.sessionsFor(gone).length, 0, 'no session belongs to a repo that is not there');
  });

  await test('sessionsFor narrows the live crew by the same rule', () => {
    const one = mkState({
      repos: ROSTER,
      sessions: [
        { session: 'a', cwd: '/repos/ITW/workkit' },
        { session: 'b', cwd: '/repos/ITW/workkit/tower' },
        { session: 'c', cwd: '/repos/Omega/omega' },
      ],
    }, 'workkit');
    assertEq(state.sessionsFor(one).map((s) => s.session).join(''), 'ab', 'the two in the repo, in order');
  });

  group('tower/app: state - the issue behind a dragged card');

  /** A board feed as a poll writes it: a NEW object graph every time. */
  const mkBoardState = () => mkState({
    board: {
      issues: [
        { repo: 'ITW/workkit', number: 48, status: 'specced' },
        { repo: 'Omega/omega', number: 7, status: 'inbox' },
      ],
    },
  });

  await test('a key finds the issue the board is holding, and a stranger finds nothing', () => {
    const live = mkBoardState();
    assertEq(state.issueByKey(live, 'ITW/workkit#48').number, 48, 'the one the card named');
    assertEq(state.issueByKey(live, 'Omega/omega#7').status, 'inbox', 'and the other repo\'s, by the same key');
    assertEq(state.issueByKey(live, 'ITW/workkit#999'), null, 'a key nothing answers to is null, never undefined');
    assertEq(state.issueByKey(mkState({}), 'ITW/workkit#48'), null, 'and a board that has not answered has no issues to find');
  });

  await test('the key it looks up is the one a card carries - one spelling, three readers', () => {
    const live = mkBoardState();
    const [issue] = state.issuesFor(live);
    assertEq(format.issueKey(issue), 'ITW/workkit#48', 'the attribute value');
    assert(modal.issueTrigger(issue).includes(`data-issue="${format.issueKey(issue)}"`), 'is what the trigger writes');
    assertEq(state.issueByKey(live, format.issueKey(issue)), issue, 'and what the drop resolves back to the same object');
  });

  await test('the answer is the LIVE object - the regression a quiet poll used to cause', () => {
    // The defect: the Board resolved a drop against a map built when the page
    // was last PAINTED. A poll that changed no markup does not repaint, so the
    // map went on holding issue objects from a graph nothing draws from any
    // more - the optimistic move mutated a detached object and the card sat
    // still until the write came back.
    const live = mkBoardState();
    const atPaint = state.issueByKey(live, 'ITW/workkit#48');

    // A quiet poll: same values, brand new objects, exactly as JSON.parse leaves them.
    live.feeds.board = { ok: true, data: JSON.parse(JSON.stringify(state.board(live))) };

    const atDrop = state.issueByKey(live, 'ITW/workkit#48');
    assert(atDrop !== atPaint, 'the poll replaced the object, which is the whole problem');
    atDrop.status = 'blocked';
    assertEq(state.issuesFor(live).find((issue) => issue.number === 48).status, 'blocked', 'moving what the DROP resolved moves what the next paint draws');
    assertEq(atPaint.status, 'specced', 'while the paint-time object is the detached one, and mutating it would have drawn nothing');
  });

  await test('the optimistic move and its revert are one round trip on the live graph', () => {
    const live = mkBoardState();
    const issue = state.issueByKey(live, 'ITW/workkit#48');
    const from = issue.status;

    // Forward: what the Board does before the write goes out.
    issue.status = 'blocked';
    assertEq(state.issueByKey(live, 'ITW/workkit#48').status, 'blocked', 'the card is in the new column at once');

    // Back: what it does when the write answers with a reason.
    issue.status = from;
    assertEq(state.issueByKey(live, 'ITW/workkit#48').status, 'specced', 'and back where it came from, not left in a state nothing agreed to');
  });

  await test('the Board resolves its drop at DROP time and holds no snapshot', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const move = async \(key, to\) => \{\s*const issue = issueByKey\(state, key\);/.test(source), 'the issue is looked up when the drop happens');
    assert(!source.includes('new Map('), 'and nothing holds a per-paint map of them');
    assert(source.includes('draggable="true"'), 'the cards are draggable');
    assert(source.includes('data-column='), 'the columns are drop targets');
    assert(source.includes('moveError = answer.reason'), 'a refused write becomes the line the page shows');
    assert(source.includes('await state.refresh(\'board\')'), 'and a landed one forces the sweep the next poll would otherwise stale over');
  });

  await test('the no-status alert is drawn from the SCOPED issues, so a repo out of scope neither shows nor counts', () => {
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
    assert(markup.includes('1 issue carries no status label'), 'only the one in scope is counted');
    assert(markup.includes('https://gh/workkit/1'), 'and it is the one linked');
    assert(!markup.includes('https://gh/omega/2'), 'the other repo’s is not on this board at all');

    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/noStatusAlert\(all, showRepo\)/.test(source), 'the page hands the alert the scoped list, not the raw payload');
    assert(/const labelled = all\.filter\(\(issue\) => issue\.status\)/.test(source),
      'and the columns and their denominator are drawn from the labelled ones alone (#118)');
    assert(!/No status/.test(source), 'the column that used to hold them is gone, comments and all');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
