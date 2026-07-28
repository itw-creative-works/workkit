//
// Tests for the tower dashboard's browser JavaScript — the pure half of it.
//
// The app is ES modules written for a browser, and the suites here are Node, so
// each lib is pulled in with a dynamic `import()`. That works for exactly the
// modules that touch neither the DOM nor the network: `format.js` (markup from
// values), `state.js` (what a feed said, and what the repo selection leaves in
// play), `crew.js` (the crew tree) and `modal.js` (an issue as markup). The
// runtime itself (page.js) and the intake dialog reach for `document` and
// `window` at import time and are out of scope here by design — the logic
// worth asserting was moved OUT of them into the modules above. `api.js` sits
// in between: it reads `location` once at import to fix the API origin and
// touches `fetch` only at call time, so two stubbed globals bring its feed
// adapter — the one translation the runtime leans on — under test, along with
// the live-versus-published decision it makes beside it (#26), which is
// written as pure functions for exactly that reason.
//
// A module that imports the FRAMEWORK is out of reach too: `@omega.js/client`
// and `__main_assets__/…` are bundler specifiers, resolved by esbuild and by
// nothing else, so the tower's own modules keep those imports out of the pure
// half. Refreshing in place (`loading`/`swap`), the feed poller, the markdown
// renderer and the chart helpers now live upstream and are tested there
// (@omega.js/client's live-page and utilities suites, @omega.js/web's dataviz).
//
// The questions asked are the ones the #20 review found the hard way: does the
// repo selection actually narrow a session list, and does a hostile issue title
// come back as text.
//

const path = require('path');
const { pathToFileURL } = require('url');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const libs = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'libs', 'tower');
const load = (name) => import(pathToFileURL(path.join(libs, name)).href);

/** A runtime state in the shape startPage builds, with the feeds already read. */
const mkState = (feeds = {}, selectedRepo = '') => ({
  feeds: Object.fromEntries(Object.entries(feeds).map(([name, data]) => [name, { ok: true, data }])),
  selectedRepo,
});

/** A feed that did not answer, in fetchFeed's failure shape. */
const failed = (reason) => ({ ok: false, status: 0, reason });

const ROSTER = [
  { slug: 'workkit', path: '/repos/ITW/workkit', name: 'workkit' },
  { slug: 'omega', path: '/repos/Omega/omega', name: 'omega' },
];

const run = async () => {
  const format = await load('format.js');
  const state = await load('state.js');
  const crew = await load('crew.js');
  // agent.js is markup from a node and a clock — no DOM, so the indicator's
  // three states and its cutoff are askable here.
  const agent = await load('agent.js');
  // modal.js reaches for `document` only inside mountIssueModal, so everything
  // that shapes an issue into markup imports and answers under Node.
  const modal = await load('modal.js');
  // chrome.js is markup from state, like format.js — the DOM it goes into is
  // page.js's, which is why the split it describes is askable here.
  const chrome = await load('chrome.js');
  // api.js fixes its origin from `location` at import — stub it (and the
  // `window` override hatch) just long enough to load the module.
  globalThis.location = { href: 'http://localhost:4300/' };
  globalThis.window = {};
  const api = await load('api.js');
  delete globalThis.location;
  delete globalThis.window;

  group('tower/app: format — values into markup');

  await test('esc turns every markup character into text', () => {
    assertEq(format.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', 'escaped');
    assertEq(format.esc('a & b'), 'a &amp; b', 'the ampersand goes first, so nothing is double-escaped');
    assertEq(format.esc(null), '', 'null is nothing, never the word null');
    assertEq(format.esc(0), '0', 'and zero is still zero');
  });

  await test('num keeps a real zero and only shows a dash for the unknown', () => {
    assertEq(format.num(0), '0', 'zero open issues is a fact');
    assertEq(format.num(null), '—', 'unknown is not zero');
    assertEq(format.num(undefined), '—', 'and neither is absent');
  });

  await test('compact scales at each threshold and refuses a non-number', () => {
    assertEq(format.compact(999), '999', 'under a thousand is itself');
    assertEq(format.compact(1000), '1.0K', 'the thousand boundary');
    assertEq(format.compact(1234567), '1.23M', 'millions to two places');
    assertEq(format.compact(2500000000), '2.50B', 'billions too');
    assertEq(format.compact(-1500), '-1.5K', 'a negative scales the same way');
    assertEq(format.compact('nope'), '—', 'a non-number is unknown, not NaN on the page');
  });

  await test('money is precise where a cost is small and rounder where it is not', () => {
    assertEq(format.money(0.0125), '$0.013', 'three places under ten dollars');
    assertEq(format.money(42.5), '$42.50', 'two places above it');
    // An unpriced model is `null`, and every caller checks for it before asking
    // for a dollar amount — what reaches here is always a number or a mistake.
    assertEq(format.money('nope'), '—', 'a non-number is a dash, never $NaN');
  });

  await test('shortPath names a repo by its last segment', () => {
    assertEq(format.shortPath('/Users/ian/Developer/Repositories/ITW/workkit'), 'workkit', 'the leaf');
    assertEq(format.shortPath('/trailing/slash/'), 'slash', 'a trailing slash is not a segment');
    assertEq(format.shortPath(''), '', 'nothing in, nothing out');
  });

  await test('every status has a colour, and one the pipeline does not name still has one', () => {
    for (const status of format.STATUSES) {
      assert(format.statusColor(status.key).startsWith('var(--omega-'), `${status.key || 'no status'} resolves to a theme token`);
    }
    assertEq(format.statusToken('nonsense'), '--omega-warn', 'an unknown status is drawn, not dropped');
  });

  await test('a model id falls in its family whatever it is decorated with', () => {
    assertEq(format.modelKey('claude-opus-5'), 'opus', 'the plain id');
    assertEq(format.modelKey('claude-opus-5[1m]'), 'opus', 'a context variant is the same model');
    assertEq(format.modelKey('claude-opus-4-1-20250805'), 'opus', 'and so is a dated build');
    assertEq(format.modelKey('claude-3-7-sonnet'), 'sonnet', 'the family is not always last in the id');
    assertEq(format.modelKey('claude-haiku-4-5'), 'haiku', 'haiku');
    assertEq(format.modelKey('fable'), 'fable', 'and the top rung');
    assertEq(format.modelKey('<synthetic>'), 'other', 'a locally generated message belongs to no model');
    assertEq(format.modelKey(null), 'other', 'and an unknown model still has a slot');
  });

  await test('an agent class falls in its own slot, prefixed or not', () => {
    assertEq(format.classKey('worker'), 'worker', 'the bare name the API sends');
    assertEq(format.classKey('workkit:verifier'), 'verifier', 'and the namespaced one');
    assertEq(format.classKey('manager'), 'manager', 'the root tier telemetry counts');
    assertEq(format.classKey('general-purpose'), 'other', 'a built-in agent is drawn neutral, not as crew');
    assertEq(format.classKey(''), 'other', 'and so is no class at all');
  });

  await test('a badge is a chip in its tone, and its label is text', () => {
    const badge = format.modelBadge('claude-opus-5[1m]');
    assert(badge.includes('classy-chip omega-badge-tone omega-tone-2'), 'the theme chip, in the opus tone');
    assert(badge.includes('claude-opus-5[1m]'), 'labelled with the id itself');
    assertEq(format.badgeColor('opus'), 'var(--omega-chart-2)', 'and the chart reads the same tone as a token');
    assert(!format.classBadge('<img src=x>').includes('<img'), 'a hostile class name is escaped');
    assert(format.modelBadge(null).includes('model unknown'), 'an unknown model says so rather than drawing empty');
  });

  await test('every name the tower draws has a tone, and no vocabulary repeats one', () => {
    const models = ['fable', 'opus', 'sonnet', 'haiku'].map((key) => format.badgeColor(key));
    const classes = ['manager', 'advisor', 'worker', 'verifier', 'scout', 'reviewer'].map((key) => format.badgeColor(key));
    assert(models.every((color) => color.startsWith('var(--omega-chart-')), 'a model is drawn from the ramp');
    assert(classes.every((color) => color.startsWith('var(--omega-chart-')), 'and so is a crew class');
    assertEq(new Set(models).size, models.length, 'two models never share a tone');
    assertEq(new Set(classes).size, classes.length, 'and neither do two classes');
    // Ten names over a six-slot ramp: a name with no tone is drawn in the muted
    // ink `.omega-badge-tone` falls back to, never in another name's colour.
    assertEq(format.badgeColor('other'), 'var(--omega-ink-muted)', 'and everything else is neutral');
    assert(!format.classBadge('general-purpose').includes('omega-tone-'), 'which is no tone class at all');
    // Sharing across the vocabularies is forced (ten names, six slots), so the
    // table pins WHO shares: the class chip and the model chip that sit
    // together on a real crew card — the manager ladder's pairings — never
    // match (hooks/manager/ladder.json: manager and advisor run fable, scouts
    // sonnet, workers and verifiers opus; a reviewer inherits the session's
    // model, so it pairs with fable and opus both).
    const pairings = [
      ['manager', 'fable'], ['advisor', 'fable'], ['scout', 'sonnet'],
      ['worker', 'opus'], ['verifier', 'opus'], ['reviewer', 'opus'], ['reviewer', 'fable'],
    ];
    for (const [cls, model] of pairings) {
      assert(format.badgeColor(cls) !== format.badgeColor(model), `${cls} and ${model} appear side by side and must differ`);
    }
  });

  await test('cap shows the head of a list and counts what it held back', () => {
    const five = [1, 2, 3, 4, 5];
    assertEq(format.cap(five).shown.length, 5, 'exactly five fits');
    assertEq(format.cap(five).hidden, 0, 'with nothing behind it');
    assertEq(format.cap([...five, 6, 7]).shown.length, 5, 'a longer list is cut');
    assertEq(format.cap([...five, 6, 7]).hidden, 2, 'and says how many are on the other page');
    assertEq(format.cap([]).hidden, 0, 'an empty list hides nothing');
    assertEq(format.cap(undefined).shown.length, 0, 'and a list that is not there is empty, not a crash');
    assertEq(format.cap(five, 2).shown.length, 2, 'the caller can set the limit');
  });

  await test('a stat cell is a link only when it is given somewhere to go', () => {
    assert(format.statCell('Open', 3).startsWith('<div'), 'a plain tile is a div');
    const linked = format.statCell('Open', 3, '/board');
    assert(linked.startsWith('<a') && linked.includes('href="/board"'), 'and a linked one is an anchor');
  });

  group('tower/app: format — the issue chips');

  await test('an issue shows exactly the chips it earns', () => {
    const chips = format.issueChips({
      type: 'bug', priority: 'high', agentOk: true, assignees: ['ianwieds', 'someone'],
    });
    assert(chips.includes('>bug<'), 'the type');
    assert(chips.includes('high'), 'the priority');
    assert(chips.includes('agent:ok'), 'the agent grant');
    assert(chips.includes('@ianwieds, @someone'), 'every assignee, each with its handle');
  });

  await test('an issue with nothing to say draws no chips', () => {
    const chips = format.issueChips({ type: '', priority: 'low', agentOk: false, assignees: [] });
    assert(!chips.includes('classy-chip'), 'no chip markup at all');
    assert(!chips.includes('@'), 'and no empty handle');
  });

  await test('a hostile issue field comes back as text', () => {
    const chips = format.issueChips({ type: '<script>x</script>', assignees: ['<b>me</b>'] });
    assert(!chips.includes('<script>'), 'the type is escaped');
    assert(!chips.includes('<b>'), 'and so is the handle');
  });

  await test('the caller can space the chip row without a second copy of it', () => {
    assert(format.issueChips({ type: 'bug' }, 'mt-1').includes('gap-1 mt-1'), 'the extra class lands on the row');
    assert(!format.issueChips({ type: 'bug' }).includes('gap-1 '), 'and nothing dangles when none is given');
  });

  group('tower/app: state — what a feed said');

  await test('a feed that has not answered yet reads as empty, not as an error', () => {
    const empty = { feeds: {}, selectedRepo: '' };
    assertEq(state.feed(empty, 'repos'), null, 'no result yet');
    assertEq(state.repos(empty).length, 0, 'no roster');
    assertEq(state.board(empty), null, 'no board');
    assertEq(state.sessions(empty).length, 0, 'no crew');
    assertEq(Object.keys(state.health(empty)).length, 0, 'no readings');
  });

  await test('a feed that failed reads as empty too — a page draws its own reason', () => {
    const broken = { feeds: { repos: failed('connection refused'), board: failed('connection refused') }, selectedRepo: '' };
    assertEq(state.repos(broken).length, 0, 'no roster from a failed read');
    assertEq(state.board(broken), null, 'and no board');
    assertEq(state.feed(broken, 'repos').reason, 'connection refused', 'while the reason survives for the page to show');
  });

  group('tower/app: state — the repo selection');

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

  await test('a session is placed by its cwd — the defect the Crew page shipped with', () => {
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

  group('tower/app: state — the issue behind a dragged card');

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

  await test('the key it looks up is the one a card carries — one spelling, three readers', () => {
    const live = mkBoardState();
    const [issue] = state.issuesFor(live);
    assertEq(format.issueKey(issue), 'ITW/workkit#48', 'the attribute value');
    assert(modal.issueTrigger(issue).includes(`data-issue="${format.issueKey(issue)}"`), 'is what the trigger writes');
    assertEq(state.issueByKey(live, format.issueKey(issue)), issue, 'and what the drop resolves back to the same object');
  });

  await test('the answer is the LIVE object — the regression a quiet poll used to cause', () => {
    // The defect: the Board resolved a drop against a map built when the page
    // was last PAINTED. A poll that changed no markup does not repaint, so the
    // map went on holding issue objects from a graph nothing draws from any
    // more — the optimistic move mutated a detached object and the card sat
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
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const move = async \(key, to\) => \{\s*const issue = issueByKey\(state, key\);/.test(source), 'the issue is looked up when the drop happens');
    assert(!source.includes('new Map('), 'and nothing holds a per-paint map of them');
    assert(source.includes('draggable="true"'), 'the cards are draggable');
    assert(source.includes('data-column='), 'the columns are drop targets');
    assert(source.includes('moveError = answer.reason'), 'a refused write becomes the line the page shows');
    assert(source.includes('await state.refresh(\'board\')'), 'and a landed one forces the sweep the next poll would otherwise stale over');
  });

  group('tower/app: crew — the tree');

  await test('a telemetry session normalizes with its tokens and its subagents', () => {
    const node = crew.normalize({
      id: 'sess-1',
      chatName: 'the tower',
      cwd: '/repos/ITW/workkit',
      model: 'claude-opus-5',
      effort: 'high',
      state: 'working',
      tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, total: 10 },
      subagents: [{ id: 'agent-a', class: 'worker', model: 'claude-sonnet-5', state: 'working', tokens: { total: 5 } }],
    });
    assertEq(node.id, 'sess-1', 'the id');
    assertEq(node.title, 'the tower', 'the chat name is the title');
    assertEq(node.tokens, 10, 'the total, not the parts');
    assertEq(node.children.length, 1, 'one subagent');
    assertEq(node.children[0].agentClass, 'worker', 'read from `class`, the field the API sends');
    assertEq(node.children[0].tokens, 5, 'with its own spend');
  });

  await test('a plain session row normalizes too — the fallback roster has no second tier', () => {
    const node = crew.normalize({
      claudePid: 700, session: 'sess-2', cwd: '/repos/Omega/omega', chatName: null, state: 'idle', model: null, effort: null,
    });
    assertEq(node.id, 'sess-2', 'that roster names the id `session`');
    assertEq(node.title, '', 'an unnamed chat is empty, never null on the page');
    assertEq(node.state, 'idle', 'the state it does carry');
    assertEq(node.tokens, null, 'tokens are unknown, which is not zero');
    assertEq(node.children.length, 0, 'and it spawns nothing');
  });

  await test('a root card is titled repo then chat name, with a fallback for each half', () => {
    assertEq(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: 'the tower' }), 'workkit/the tower', 'the repo, a slash, the chat');
    assertEq(crew.rootLabel({ cwd: '/repos/ITW/workkit', title: '', id: 'sess-1' }), 'workkit/sess-1', 'an unnamed chat falls back to its id');
    assertEq(crew.rootLabel({ cwd: '', title: 'the tower' }), 'the tower', 'no cwd is no leading slash');
    assertEq(crew.rootLabel({ cwd: '', title: '', id: '' }), 'session', 'and a node with nothing still has a name');
  });

  await test('the crew splits into who is working and who has finished', () => {
    const children = [
      { state: 'working', id: 'a' },
      { state: 'done', id: 'b' },
      { state: 'done', id: 'c' },
      { state: '', id: 'd' },
    ];
    const split = crew.splitCrew(children);
    assertEq(split.working.map((c) => c.id).join(''), 'a', 'only the stamped working one is live crew');
    assertEq(split.done.map((c) => c.id).join(''), 'bcd', 'everything else is history, unstamped included');
  });

  await test('the summary counts the working crew and says the total in the same breath', () => {
    const tree = [
      { children: [{ state: 'working' }, { state: 'done' }, { state: 'done' }] },
      { children: [{ state: 'working' }, { state: 'working' }] },
      { children: [] },
    ];
    const count = crew.crewCount(tree);
    assertEq(count.working, 3, 'three are running');
    assertEq(count.total, 5, 'out of five the transcripts remember');
  });

  await test('a session with no subagents at all counts as none, not as unknown', () => {
    const count = crew.crewCount([crew.normalize({ id: 'x', tokens: { total: 1 } })]);
    assertEq(count.working, 0, 'nobody running');
    assertEq(count.total, 0, 'and nobody at all');
  });

  await test('both rosters land their moments on one scale — ms epochs, whichever way they were said', () => {
    const session = crew.normalize({
      session: 'sess-1', lastActivity: 1700000000000, aliveSince: 1699999000000, transcript: '/t/a.jsonl',
    });
    assertEq(session.lastActivity, 1700000000000, 'a session row already says ms');
    assertEq(session.aliveSince, 1699999000000, 'both of them');
    assertEq(session.transcript, '/t/a.jsonl', 'and where it was read from');

    const agent = crew.normalize({
      id: 'agent-a', class: 'worker', lastAt: '2026-07-27T12:00:00.000Z', startedAt: '2026-07-27T11:00:00.000Z', lastTool: 'Edit', lastToolAt: '2026-07-27T11:59:00.000Z',
    });
    assertEq(agent.lastActivity, Date.parse('2026-07-27T12:00:00.000Z'), 'a subagent says it in ISO and arrives in ms');
    assertEq(agent.aliveSince, Date.parse('2026-07-27T11:00:00.000Z'), 'the spawn stamp too');
    assertEq(agent.lastTool, 'Edit', 'what it last reached for');
    assertEq(agent.lastToolAt, Date.parse('2026-07-27T11:59:00.000Z'), 'and when');

    const bare = crew.normalize({ id: 'x' });
    assertEq(bare.lastActivity, null, 'a row carrying no time is unknown, never 1970');
    assertEq(bare.aliveSince, null, 'both ways');
    assertEq(crew.normalize({ id: 'y', lastAt: 'not a date' }).lastActivity, null, 'and an unparseable stamp is unknown too');
  });

  await test('the counters behind the total travel for the dialog, and a plain row has none', () => {
    const node = crew.normalize({ id: 'a', tokens: { input: 1, output: 2, total: 10 }, cost: 0.25 });
    assertEq(node.usage.input, 1, 'the input counter');
    assertEq(node.tokens, 10, 'beside the total the card draws');
    assertEq(node.cost, 0.25, 'and what it came to');
    assertEq(crew.normalize({ session: 'b' }).usage, null, 'a session row has no counters, which is not zeros');
    assertEq(crew.normalize({ session: 'b' }).cost, null, 'nor a cost');
  });

  await test('a connector runs the way the card actually sits from the trunk', () => {
    // Four children: two left of centre, two right, none on it.
    assertEq(crew.connectorFlow(0, 4), 'left', 'the far left card is reached by flowing left');
    assertEq(crew.connectorFlow(1, 4), 'left', 'so is the near one');
    assertEq(crew.connectorFlow(2, 4), 'right', 'and the right half flows right');
    assertEq(crew.connectorFlow(3, 4), 'right', 'to the end of the row');
    // An odd row has a card ON the trunk — its line is the drop, with no
    // sideways run to have a direction at all.
    assertEq(crew.connectorFlow(1, 3), 'down', 'the middle of three is straight below the parent');
    assertEq(crew.connectorFlow(0, 1), 'down', 'and an only child is always straight below it');
  });

  group('tower/app: agent — the activity indicator');

  const NOW = 1700000000000;

  await test('an agent that is moving is working, one that just stopped is idle, and a quiet one is gone', () => {
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'working', 'running and fresh');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 2000 }, NOW), 'idle', 'stopped, but only just');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5 * 60000 }, NOW), 'none', 'a session quiet five minutes shows nothing, whatever the API still calls it');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 5 * 60000 }, NOW), 'none', 'and neither does one that finished five minutes ago');
  });

  await test('the gray band is reachable — the state word alone can never decide it', () => {
    // The defect this proves against: gating gray on `state !== 'working'`
    // makes it unreachable, because the API only drops that word after its own
    // 45-minute window, decided from the SAME file time — by which point the
    // indicator is long gone. Freshness decides the motion; the word is only
    // necessary for it.
    assertEq(agent.WORKING_MS, 20000, 'two poll cycles of the live feeds');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 30000 }, NOW), 'idle', 'still called working by the API, but quiet half a minute — gray');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 20000 }, NOW), 'working', 'exactly two cycles still spins');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 20001 }, NOW), 'idle', 'a millisecond past it does not');
    assertEq(agent.activityPhase({ state: 'stale', lastActivity: NOW - 3000 }, NOW), 'idle', 'a lapsed assertion over a fresh transcript is gray, not gone');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 10000 }, NOW), 'idle', 'and a subagent that just finished stays on screen, still');
  });

  await test('the cutoff is a minute, and the boundary belongs to the indicator', () => {
    assertEq(agent.ACTIVITY_WINDOW_MS, 60000, 'one minute');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60000 }, NOW), 'idle', 'exactly a minute is still shown');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60001 }, NOW), 'none', 'a millisecond past it is not');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 61000 }, NOW), 'none', 'the word working does not exempt anything from it');
  });

  await test('the Board draws the glyph only for work an agent actually holds', () => {
    const claimed = agent.claimGlyph({ status: 'specced', assignees: ['ianwieds'] });
    assert(claimed.includes('omega-tower-activity--idle'), 'a specced issue with an assignee carries the still glyph');
    assert(claimed.includes('title="held by @ianwieds"'), 'saying who has it');
    assertEq(agent.claimGlyph({ status: 'specced', assignees: [] }), '', 'specced but unclaimed is not work in flight');
    assertEq(agent.claimGlyph({ status: 'specced' }), '', 'and neither is one with no assignee field at all');
    assertEq(agent.claimGlyph({ status: 'inbox', assignees: ['ianwieds'] }), '', 'a claim before the spec is accepted is not either');
    assertEq(agent.claimGlyph({ status: 'blocked', assignees: ['ianwieds'] }), '', 'nor a claim on something blocked');
    assertEq(agent.claimGlyph({}), '', 'and an issue with nothing on it draws nothing');
  });

  await test('a claim announces itself as a claim, not as an idle agent', () => {
    assert(agent.claimGlyph({ status: 'specced', assignees: ['ianwieds'] }).includes('<span class="visually-hidden">claimed</span>'), 'the word a screen reader hears is the caller\'s');
    assert(agent.activityIcon('idle').includes('<span class="visually-hidden">idle</span>'), 'and the phase name is still the default');
    assert(!agent.claimGlyph({ status: 'specced', assignees: ['<img src=x>'] }).includes('<img'), 'a hostile handle is text in both the title and the label');
  });

  await test('a roster with no timestamps falls back to the word it does carry', () => {
    assertEq(agent.activityPhase({ state: 'working' }, NOW), 'working', 'the fallback roster still says who is running');
    assertEq(agent.activityPhase({ state: 'idle' }, NOW), 'none', 'and anything else draws nothing rather than a guess');
    assertEq(agent.activityPhase({}, NOW), 'none', 'an empty node is nothing at all');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW + 5000 }, NOW), 'working', 'a clock ahead of ours is this instant, not the future');
  });

  await test('a span is named in the largest unit that is still true', () => {
    assertEq(agent.sinceLabel(0), '0s', 'this instant');
    assertEq(agent.sinceLabel(12000), '12s', 'seconds');
    assertEq(agent.sinceLabel(59999), '59s', 'up to the minute');
    assertEq(agent.sinceLabel(60000), '1m', 'and over it');
    assertEq(agent.sinceLabel(3 * 60000), '3m', 'minutes');
    assertEq(agent.sinceLabel(2 * 3600000), '2h', 'hours');
    assertEq(agent.sinceLabel(50 * 3600000), '2d', 'days');
    assertEq(agent.sinceLabel(-5000), '0s', 'a negative span is now, never a minus sign on the card');
    assertEq(agent.sinceLabel('nope'), '', 'and a non-number says nothing at all');
  });

  await test('the indicator is one wordless glyph, animated only while the agent is', () => {
    const working = agent.activityIcon('working', 'running for 3m');
    assert(working.includes('fa-circle-notch') && working.includes('fa-spin'), 'the working glyph spins');
    assert(working.includes('omega-tower-activity--working'), 'and carries the class its colour is on');
    assert(working.includes('title="running for 3m"'), 'the hover text is how long it has been up');
    const idle = agent.activityIcon('idle');
    assert(idle.includes('fa-circle-notch') && !idle.includes('fa-spin'), 'the same glyph, still');
    assert(!idle.includes('title='), 'with no hover text when none was given');
    assertEq(agent.activityIcon('none'), '', 'and a quiet agent draws nothing at all');
    assert(agent.activityIcon('working').includes('visually-hidden'), 'the word survives for a screen reader, which has no colour to read');
  });

  await test('a hostile hover text reaches the indicator as text', () => {
    assert(!agent.activityIcon('idle', '"><script>alert(1)</script>').includes('<script>'), 'escaped like every other interpolated field');
  });

  await test('a crew card says the freshness beside the glyph and the uptime on it', () => {
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes('fa-spin'), 'the working glyph');
    assert(markup.includes('>12s<'), 'twelve seconds since it last moved');
    assert(markup.includes('title="running for 3m"'), 'and three minutes since it started');
    assertEq(agent.crewActivity({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), '', 'a card whose agent went quiet loses the indicator entirely');
    assert(agent.crewActivity({ state: 'working' }, NOW).includes('up for an unknown span'), 'a node with no times still says the honest thing');
  });

  await test('every role has its own glyph, in the colour that class is drawn in everywhere else', () => {
    const roles = ['manager', 'worker', 'scout', 'verifier', 'advisor', 'reviewer'];
    const glyphs = roles.map((name) => agent.roleGlyph(name));
    assertEq(new Set(glyphs).size, roles.length, 'no two roles share a glyph');
    assertEq(agent.roleGlyph('workkit:worker'), agent.roleGlyph('worker'), 'a prefixed class is the same role');
    assertEq(agent.roleGlyph('general-purpose'), agent.roleGlyph('nobody'), 'and everything the crew does not name is the one neutral glyph');
    const icon = agent.roleIcon('workkit:scout');
    assert(icon.includes(agent.roleGlyph('scout')), 'the glyph');
    assert(icon.includes(format.badgeColor('scout')), 'in the same colour as the chip under it');
    assert(icon.includes('title="workkit:scout"'), 'named on hover');
    assert(!agent.roleIcon('<img src=x>').includes('<img'), 'and a hostile class name is text');
  });

  await test('the pages route their indicators through the one helper', () => {
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    const crewPage = fs.readFileSync(path.join(pages, 'crew.js'), 'utf8');
    assert(/import \{[^}]*crewActivity[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(crewPage), 'the Crew page takes the indicator from the shared lib');
    const boardPage = fs.readFileSync(path.join(pages, 'board.js'), 'utf8');
    assert(/import \{[^}]*claimGlyph[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(boardPage), 'the Board takes the claim glyph AND its gate from the same lib');
    const overview = fs.readFileSync(path.join(pages, 'index.js'), 'utf8');
    assert(/import \{[^}]*activityPhase[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(overview), 'and the Overview\'s crew table draws the same indicator rather than a pill of its own');
    assert(!/pill\((?:[^)]*)working/.test(overview), 'no page decides on its own what a working agent looks like');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(!source.includes('fa-spin'), `${name} writes no glyph of its own — the helper owns what the indicator looks like`);
    }
  });

  group('tower/app: modal — the issue dialog');

  const ISSUE = {
    repo: 'ITW/workkit',
    number: 31,
    title: 'Issues open in a modal',
    url: 'https://github.com/ITW-Creative-Works/workkit/issues/31',
    body: '## Description\n\nThe body.',
    bodyTruncated: false,
    comments: 2,
    createdAt: '2026-07-20T10:00:00Z',
    updatedAt: '2026-07-27T10:00:00Z',
    status: 'specced',
    type: 'enhancement',
    priority: 'high',
    agentOk: true,
    assignees: ['ianwieds'],
  };

  // The renderer is the framework's and is handed to the dialog by the mount,
  // so the questions left here are the tower's own: is the RAW body what gets
  // handed over, and does what comes back land in the body's own container.
  // Whether markdown becomes safe markup is asked upstream, of the real one.
  const rendered = [];
  const render = (text) => {
    rendered.push(text);
    return text ? `<p data-rendered>${text}</p>` : '';
  };

  await test('a trigger carries the key and the keyboard affordance a div needs', () => {
    const attrs = modal.issueTrigger(ISSUE);
    assert(attrs.includes('data-issue="ITW/workkit#31"'), 'the repo and number are the key');
    assert(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'and it is reachable without a mouse');
    // The Board reads that same attribute back off a dragged card to find which
    // issue was moved, so the key has exactly one spelling — format.js's.
    assert(attrs.includes(`data-issue="${format.issueKey(ISSUE)}"`), 'and the shared key is what the attribute carries');
  });

  await test('the external link is the only thing that leaves for GitHub', () => {
    const link = modal.externalLink(ISSUE.url, 'ms-2');
    assert(link.includes(`href="${ISSUE.url}"`), 'it points at the issue');
    assert(link.includes('target="_blank"') && link.includes('rel="noopener"'), 'in a new tab, safely');
    assert(link.includes('aria-label="Open on GitHub"'), 'and says what it does');
    assert(link.includes('class="omega-tower-external ms-2"'), 'the caller can place it');
    assert(link.includes('<i class="fa-solid fa-arrow-up-right-from-square"'), 'the glyph is the framework\'s one icon mechanism');
    assert(!link.includes('<svg'), 'and not a hand-drawn one the renderer never sees');
  });

  await test('the dialog says everything the issue knows', () => {
    const parts = modal.issueDialog(ISSUE, render);
    assert(parts.title.includes('ITW/workkit #31'), 'repo and number');
    assert(parts.title.includes('Issues open in a modal'), 'and the title');
    assert(parts.actions.includes('target="_blank"'), 'the external button is the header action');
    assert(parts.body.includes('>specced<'), 'the status');
    assert(parts.body.includes('>enhancement<') && parts.body.includes('agent:ok'), 'and the chips');
    assert(parts.body.includes('held by @ianwieds'), 'who holds it');
    assert(/filed .* · updated /.test(parts.body), 'both dates');
    assertEq(rendered[rendered.length - 1], ISSUE.body, 'the renderer is handed the raw body, markdown and all');
    assert(parts.body.includes(`<div class="omega-tower-issue__body"><p data-rendered>${ISSUE.body}</p></div>`), 'and what it answers is the body of the dialog');
    assert(parts.body.includes('2 comments on GitHub'), 'and where the conversation is');
  });

  await test('an issue with nothing on it still opens', () => {
    const bare = modal.issueDialog({ repo: 'r', number: 1, url: 'https://example.com/1', title: 'bare' }, render);
    assert(bare.body.includes('No description.'), 'an empty body says so');
    assert(bare.body.includes('unclaimed'), 'and nobody holding it says that');
    assert(bare.body.includes('0 comments'), 'a missing count is zero, not undefined');
    assert(bare.body.includes('—'), 'and a missing date is a dash');
  });

  await test('a truncated body admits it', () => {
    const cut = modal.issueDialog({ ...ISSUE, bodyTruncated: true }, render);
    assert(cut.body.includes('the rest is on GitHub'), 'the dialog says what it is not showing');
  });

  await test('a mount without a renderer fails there, not at the first click', () => {
    let thrown = null;
    try {
      // The scope stub keeps Node's missing `document` (the destructuring
      // default) out of the way — the guard is what is under test.
      modal.mountIssueModal({ scope: {} });
    } catch (error) {
      thrown = error;
    }
    assert(thrown, 'the missing renderer is refused at the mount');
    assert(thrown.message.includes('render'), 'and the error names what is missing');
  });

  await test('every field the dialog writes itself reaches it as text', () => {
    const nasty = modal.issueDialog({
      ...ISSUE,
      title: '<img src=x onerror=alert(1)>',
      assignees: ['<b>me</b>'],
      status: '<i>x</i>',
    }, render);
    assert(!nasty.title.includes('<img'), 'the title is escaped');
    assert(!nasty.body.includes('<b>me</b>'), 'the handle is escaped');
    assert(!nasty.body.includes('<i>x</i>'), 'and so is the status chip');
    // The body is the ONE field this file does not escape itself — it is the
    // renderer's, which escapes first (@omega.js/client's utilities suite).
  });

  group('tower/app: modal — the agent dialog');

  const AGENT = {
    id: 'agent-k1',
    label: 'worker',
    role: 'worker',
    cwd: '/repos/ITW/workkit',
    model: 'claude-opus-5',
    effort: 'high',
    state: 'working',
    lastActivity: NOW - 4000,
    aliveSince: NOW - 8 * 60000,
    lastTool: 'Edit',
    lastToolAt: NOW - 9000,
    tokens: 12000,
    usage: { input: 400, output: 90, total: 12000 },
    cost: 0.42,
    transcript: '/home/ian/.claude/projects/-repos-ITW-workkit/sess/subagents/agent-k1.jsonl',
  };

  await test('a crew card is reachable without a mouse, keyed by the agent it draws', () => {
    const attrs = modal.agentTrigger(AGENT);
    assert(attrs.includes('data-agent="agent-k1"'), 'the agent id is the key');
    assert(attrs.includes('role="button"') && attrs.includes('tabindex="0"'), 'the same affordance an issue card gets');
  });

  await test('the dialog says what the card had no room for', () => {
    const parts = modal.agentDialog(AGENT, NOW);
    assert(parts.title.includes('worker') && parts.title.includes('workkit'), 'the role and the repo it is working in');
    assert(parts.body.includes('Edit') && parts.body.includes('9s ago'), 'the last tool and when it was called');
    assert(parts.body.includes('4s ago'), 'how fresh it is');
    assert(parts.body.includes('8m'), 'and how long it has been running');
    assert(parts.body.includes('400') && parts.body.includes('90'), 'the two token counters');
    assert(parts.body.includes('$0.420'), 'what it came to');
    assert(parts.body.includes(AGENT.transcript), 'and where to read the whole of it');
    assert(parts.body.includes('fa-spin'), 'with the same indicator the card carries');
  });

  await test('a field the payload does not carry is left out, never drawn as a dash', () => {
    const young = modal.agentDialog({ id: 'agent-new', label: 'scout', role: 'scout' }, NOW);
    assert(!young.body.includes('Last tool'), 'a session that has called nothing says nothing about tools');
    assert(!young.body.includes('Tokens in'), 'nor about a spend it has not made');
    assert(!young.body.includes('Cost'), 'nor a cost');
    assert(!young.body.includes('Running for'), 'nor an uptime it does not know');
    assert(young.body.includes('agent-new'), 'the id it does have is still there');
  });

  await test('every field the agent dialog writes reaches it as text', () => {
    const hostile = modal.agentDialog({
      id: '"><img src=x>', label: '<script>alert(1)</script>', role: '<b>role</b>', model: '<i>m</i>', effort: '<u>e</u>', lastTool: '<em>Bash</em>', transcript: '/tmp/<svg>.jsonl',
    }, NOW);
    for (const markup of [hostile.title, hostile.body]) {
      assert(!markup.includes('<script>') && !markup.includes('<img src=x>'), 'no injected element survives');
      assert(!markup.includes('<em>') && !markup.includes('<svg>'), 'and neither do the quieter ones');
    }
  });

  group('tower/app: modal — an issue as a list item');

  await test('a list item keeps its list semantics and puts the button inside it', () => {
    const item = modal.issueItem(ISSUE, '<span>body</span>', { item: 'py-1', inner: 'd-flex gap-2' });
    assert(/^<li class="omega-tower-issue py-1">/.test(item), 'the li carries the card class and the row\'s spacing');
    // The whole point: an <li> given a role stops being a list item, so the
    // role, the tab stop and the key the dialog opens on all sit one level in.
    assert(!/<li[^>]*role=/.test(item), 'and no role at all — the list stays a list');
    assert(/<div class="omega-interactive d-flex gap-2" data-issue="ITW\/workkit#31" role="button" tabindex="0">/.test(item), 'the inner element is the click target, with the layout classes on it');
    assert(item.includes('<span>body</span>'), 'and the content is inside that');
  });

  await test('an item given no classes draws neither a dangling space nor an empty attribute', () => {
    const bare = modal.issueItem(ISSUE, 'x');
    assert(bare.includes('class="omega-tower-issue"'), 'the li is just the card class');
    assert(bare.includes('class="omega-interactive"'), 'and the trigger just the affordance');
  });

  await test('every page that lists issues routes through it — no role on an li anywhere', () => {
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(!/<li[^>]*\$\{issueTrigger\(/.test(source), `${name} puts no trigger on an <li>`);
      if (source.includes('<li')) assert(source.includes('issueItem('), `${name} builds its interactive items through the helper`);
    }
  });

  group('tower/app: chrome — the strip above the body');

  const CHROME = { ...mkState({ repos: ROSTER }), pending: false, stamp: 'read 10:00:00' };

  await test('the frame draws the roster, the selection and the region the status goes in', () => {
    const frame = chrome.chromeMarkup(CHROME);
    assert(frame.includes('<option value="workkit">workkit</option>'), 'every slug is an option');
    assert(frame.includes('>All repos (2)<'), 'and the all-repos option counts them');
    assert(frame.includes('id="tower-refresh"'), 'Refresh is in the frame');
    assert(frame.includes('data-tower-status'), 'with an empty region the status is written into');
    assert(!frame.includes('spinner-border') && !frame.includes('read 10:00:00'), 'and nothing that changes on a read');
    assert(chrome.chromeMarkup({ ...CHROME, selectedRepo: 'omega' }).includes('<option value="omega" selected>'), 'a selection is marked on its option');
  });

  await test('a read leaves the frame — including the select — byte for byte the same', () => {
    // The defect: the frame was rewritten on both halves of every poll, so a
    // dropdown open when a read started was closed by the read landing.
    const reading = { ...CHROME, pending: true, stamp: 'read 10:00:00' };
    const landed = { ...CHROME, pending: false, stamp: 'read 10:00:30' };
    assertEq(chrome.chromeMarkup(reading), chrome.chromeMarkup(landed), 'the same markup either way');
    assertEq(chrome.chromeKey(reading), chrome.chromeKey(landed), 'and the key the runtime compares says so');
  });

  await test('the key changes for exactly the two things the frame shows', () => {
    assert(chrome.chromeKey(CHROME) !== chrome.chromeKey({ ...CHROME, selectedRepo: 'omega' }), 'a new selection redraws it');
    const grown = { ...mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles', name: 'dotfiles' }] }), pending: false };
    assert(chrome.chromeKey(CHROME) !== chrome.chromeKey(grown), 'and so does a repo joining the roster');
    assertEq(chrome.chromeKey(mkState({})), '', 'an unread roster is no key at all, never undefined');
  });

  await test('the status says whether a read is in flight and when the last one landed', () => {
    assert(chrome.statusMarkup({ pending: true, stamp: 'read 10:00:00' }, []).includes('spinner-border'), 'the spinner while it reads');
    const idle = chrome.statusMarkup({ pending: false, stamp: 'read 10:00:00' }, []);
    assert(!idle.includes('spinner-border'), 'and none when it is done');
    assert(idle.includes('read 10:00:00'), 'with the stamp itself');
    assert(chrome.statusMarkup({ pending: false, stamp: '' }, []).includes('reading…'), 'before the first answer it says so rather than drawing blank');
  });

  await test('an unavailable feed is named in the chip and its reason is text', () => {
    const one = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'gh is not logged in' }]);
    assert(one.includes('>1 feed unavailable<'), 'one feed, singular');
    assert(one.includes('title="board: gh is not logged in"'), 'and the reason in the tooltip');
    const two = chrome.statusMarkup(CHROME, [{ name: 'board', reason: 'a' }, { name: 'health', reason: 'b' }]);
    assert(two.includes('>2 feeds unavailable<'), 'two, plural');
    assert(!chrome.statusMarkup(CHROME, []).includes('classy-chip'), 'and a healthy read draws no chip');
    assert(!chrome.statusMarkup(CHROME, [{ name: 'x', reason: '<img src=x>' }]).includes('<img'), 'a hostile reason is escaped');
  });

  group('tower/app: api — the feed adapter');

  // The one translation the runtime leans on: the tower's four-key result
  // shape into the framework poller's fetcher contract (resolve with the body,
  // throw carrying `.code`).
  await test('a good answer resolves with the body, untouched', () => {
    const data = { rows: [1, 2, 3] };
    assertEq(api.unwrapFeed({ ok: true, data, status: 200, reason: null }), data, 'the body passes through by reference');
  });

  await test('a failed answer throws the reason with the status as its code', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: 502, reason: '/api/board answered 502' });
    } catch (error) {
      thrown = error;
    }
    assertEq(thrown && thrown.message, '/api/board answered 502', 'the reason is the message');
    assertEq(thrown && thrown.code, 502, 'and the status rides as .code');
  });

  await test('a transport failure keeps its null status', () => {
    let thrown = null;
    try {
      api.unwrapFeed({ ok: false, data: null, status: null, reason: 'did not answer' });
    } catch (error) {
      thrown = error;
    }
    assertEq(thrown && thrown.code, null, 'no HTTP status means a null code, not 0 or undefined');
  });

  await test('the fetcher composes fetchFeed and the unwrap, both ways', async () => {
    // Node ships its own global fetch and the suites share one process —
    // restore it, never delete it.
    const realFetch = globalThis.fetch;
    let body;
    let thrown = null;
    try {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) });
      body = await api.feedFetcher('/api/board');

      // A body that reports its own failure (`ok: false`) throws with ITS reason.
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'gh is not logged in' }) });
      try {
        await api.feedFetcher('/api/board');
      } catch (error) {
        thrown = error;
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assertEq(JSON.stringify(body), '{"rows":[]}', 'a 200 with JSON resolves with the body');
    assertEq(thrown && thrown.message, 'gh is not logged in', 'the body\'s own sentence survives the translation');
    assertEq(thrown && thrown.code, 200, 'with the HTTP status it arrived under');
  });

  group('tower/app: api — live versus published');

  await test('an origin is taken from the query first, then the console hatch', () => {
    assertEq(api.apiOverride('http://tower.example/board?api=http://box:8693/', {}), 'http://box:8693', 'the query wins, trailing slash trimmed');
    assertEq(api.apiOverride('http://tower.example/board', { TOWER_API: 'http://box:8693' }), 'http://box:8693', 'the console override when there is no query');
    assertEq(api.apiOverride('http://tower.example/board?api=http://a', { TOWER_API: 'http://b' }), 'http://a', 'the query outranks it');
    assertEq(api.apiOverride('http://tower.example/board', {}), '', 'and nothing supplied is no origin, never undefined');
    assertEq(api.apiOverride('http://tower.example/board', { TOWER_API: '' }), '', 'an empty override is no override');
  });

  await test('a production build with no origin supplied is published', () => {
    assertEq(api.decideLive('production', ''), false, 'nothing to read');
  });

  await test('an origin supplied to a production build outranks the build', () => {
    assertEq(api.decideLive('production', 'http://box:8693'), true, '?api= runs it fully live');
  });

  await test('a development build is live whatever else is true', () => {
    assertEq(api.decideLive('development', ''), true, 'the local tower is the default origin');
    assertEq(api.decideLive('development', 'http://box:8693'), true, 'and an override does not change the mode');
  });

  await test('a page with no configuration baked into it is published, not live', () => {
    // The framework's own default: `_processConfiguration` fills `environment`
    // with 'production' when the page did not name one, and `isDevelopment()`
    // reads that key. Anything that is not the word development is published.
    assertEq(api.decideLive('', ''), false, 'no environment at all');
    assertEq(api.decideLive(undefined, ''), false, 'and no key at all');
    assertEq(api.LIVE, false, 'which is what the module itself decided under the stubs above');
  });

  await test('a published page arms no feeds at all — zero doomed requests', () => {
    // The runtime gates on `LIVE`, never on the size of this table: a live page
    // is allowed to declare no feeds, and must not be mistaken for a published
    // one. The table is emptied here as well so that nothing is armed even if a
    // caller reaches it in published mode.
    assertEq(Object.keys(api.pageFeeds(['repos', 'board'], false)).length, 0, 'nothing for the poller to poll');
    assertEq(Object.keys(api.pageFeeds([], true)).length, 0, 'and a live page declaring none is empty too — which is why the mode is read from the flag');
  });

  await test('a live page arms exactly the feeds it asked for, each with its path', () => {
    const feeds = api.pageFeeds(['repos', 'board'], true);
    assertEq(Object.keys(feeds).join(','), 'repos,board', 'those two');
    assertEq(feeds.board.path, '/api/board', 'with the API path written here and nowhere else');
    assertEq(feeds.board.every, 60000, 'and the board\'s slower cadence — a gh sweep is expensive');
  });

  group('tower/app: api — the board’s drop, as a payload');

  const CARD = { repo: 'ITW/workkit', number: 48, status: 'specced' };

  await test('a drop on another column becomes the endpoint’s four fields', () => {
    assertEq(JSON.stringify(api.moveRequest(CARD, 'blocked', true)),
      '{"repo":"ITW/workkit","number":48,"from":"specced","to":"blocked"}',
      'where it came from rides along — the move removes one label and adds the other');
  });

  await test('the four columns that are a status are the only ones a card moves between', () => {
    assertEq(api.MOVABLE_STATUSES.join(','), 'inbox,specced,blocked,parked', 'the pipeline, from the column list itself');
    assertEq(api.moveRequest(CARD, '', true), null, 'the No-status column is not a destination');
    assertEq(api.moveRequest({ ...CARD, status: null }, 'inbox', true), null, 'and an issue triage has not reached has no label to remove');
    assertEq(api.moveRequest(CARD, 'shipped', true), null, 'a status the pipeline does not name is not one');
  });

  await test('a drop on the column the card is already in is not a move', () => {
    assertEq(api.moveRequest(CARD, 'specced', true), null, 'nothing to write');
  });

  await test('a published copy produces no move at all — there is no tower to write to', () => {
    assertEq(api.moveRequest(CARD, 'blocked', false), null, 'the gate is the payload’s, so no page can forget it');
    assertEq(api.moveRequest(CARD, 'blocked'), null, 'and the default is the module’s own mode, which is published under these stubs');
  });

  await test('a drop carrying no issue is nothing, never a request with holes in it', () => {
    assertEq(api.moveRequest(null, 'blocked', true), null, 'a key the paint no longer knows');
  });

  await test('the move is POSTed to the status endpoint as JSON — the page names no URL', async () => {
    const realFetch = globalThis.fetch;
    let seen = null;
    let answer;
    try {
      globalThis.fetch = async (url, options) => {
        seen = { url, options };
        return { ok: true, status: 200, json: async () => ({ ok: true, status: 'blocked' }) };
      };
      answer = await api.postIssueStatus(api.moveRequest(CARD, 'blocked', true));
    } finally {
      globalThis.fetch = realFetch;
    }
    assertEq(seen.url, `${api.API_BASE}/api/issues/status`, 'the one path, written in api.js and nowhere else');
    assertEq(seen.options.method, 'POST', 'a write');
    assertEq(JSON.parse(seen.options.body).to, 'blocked', 'carrying the move');
    assertEq(answer.ok, true, 'and the answer arrives in the tower’s own result shape');
  });

  await test('the published notice is the quiet line, in both voices', () => {
    // The page runtime paints the markup in place of its body; the intake
    // dialog paints it where its result would go. One sentence, one home, so
    // the two surfaces cannot drift.
    const markup = format.publishedNotice();
    assert(format.PUBLISHED_NOTICE.includes('npm run tower') && format.PUBLISHED_NOTICE.includes('?api='), 'the plain sentence names both ways to get data');
    assert(markup.includes('<code>npm run tower</code>') && markup.includes('<code>?api=</code>'), 'and the markup puts the commands in code voice');
    assert(markup.includes('text-body-secondary'), 'drawn muted, like every other empty state');
    assert(!markup.includes('alert'), 'and never as an alert — a published copy is not broken');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
