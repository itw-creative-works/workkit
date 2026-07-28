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
// adapter — the one translation the runtime leans on — under test.
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
  // modal.js reaches for `document` only inside mountIssueModal, so everything
  // that shapes an issue into markup imports and answers under Node.
  const modal = await load('modal.js');
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
