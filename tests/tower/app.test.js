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

// ── A DOM small enough to hold in your head ────────────────────────────────
//
// clock.js is the one tower module that walks a document, and these suites are
// Node. The tower app carries no test dependency and this is not the place to
// start one, so what follows is EXACTLY the operations `applyLive` performs and
// nothing else: two kinds of selector, a dataset, a class name, one attribute,
// one class toggle, one child wipe. It is a test double for the walk, not a
// browser — what the glyph looks like while it turns stays a browser's answer
// (the #24 ruling), and what this can prove is the lifecycle: which nodes a
// tick touches, and how often it touches nothing.
//
// Every mutation is COUNTED, because the claim worth pinning about a timer
// firing sixty times a minute is that an unchanged second writes nothing.

/** `data-live-ts` → `liveTs`, the way a real dataset renames its attributes. */
const camel = (attr) => attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** One element. `writes` counts every mutation; `wipes` counts child clears. */
const el = (tag, className = '', data = {}) => {
  const node = {
    tag, text: '', html: '', dataset: { ...data }, attrs: {}, children: [], writes: 0, wipes: 0, classes: className,
  };
  Object.defineProperties(node, {
    className: { get: () => node.classes, set: (value) => { node.classes = value; node.writes += 1; } },
    textContent: { get: () => node.text, set: (value) => { node.text = value; node.writes += 1; } },
    // The agent dialog's refresh (#108) rewrites one half of itself wholesale
    // and patches the other, and the claim worth pinning is which half is
    // which — so the double reads its own markup back, the way a comparison
    // before a write has to.
    innerHTML: { get: () => node.html, set: (value) => { node.html = value; node.writes += 1; } },
  });
  node.classList = {
    // The real `toggle(name, force)` is a no-op when the class is already in
    // the state asked for, so a phase that did not move costs nothing. Counting
    // the call rather than the change would make this double lie about that.
    toggle: (name, on) => {
      const has = node.classes.split(' ').filter(Boolean);
      if (has.includes(name) === !!on) return;
      node.classes = (on ? [...has, name] : has.filter((one) => one !== name)).join(' ');
      node.writes += 1;
    },
  };
  node.getAttribute = (name) => (name in node.attrs ? node.attrs[name] : null);
  node.setAttribute = (name, value) => { node.attrs[name] = value; node.writes += 1; };
  node.removeAttribute = (name) => {
    delete node.attrs[name];
    delete node.dataset[camel(name)];
    node.writes += 1;
  };
  node.replaceChildren = () => { node.children = []; node.wipes += 1; node.writes += 1; };
  node.append = (...kids) => { node.children.push(...kids); return node; };
  node.matches = (sel) => {
    if (sel.startsWith('[')) return camel(sel.slice(1, -1)) in node.dataset;
    if (sel.startsWith('.')) return node.classes.split(' ').includes(sel.slice(1));
    return node.tag === sel;
  };
  node.querySelectorAll = (sel) => node.children.flatMap((kid) => (kid.matches(sel) ? [kid, ...kid.querySelectorAll(sel)] : kid.querySelectorAll(sel)));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] || null;
  return node;
};

/**
 * One indicator as the paint left it — the node shape `agent.crewActivity`
 * writes, built out of the double above. The test that uses it pins this shape
 * against the real markup string, so the two cannot drift apart in silence.
 */
const drawnIndicator = ({ phase, stamps, age, title }) => {
  const glyph = el('i', `fa-solid fa-gear${phase === 'working' ? ' fa-spin' : ''}`);
  const spoken = el('span', 'visually-hidden');
  spoken.text = phase;
  const icon = el('span', `omega-tower-activity omega-tower-activity--${phase}`).append(glyph, spoken);
  icon.attrs.title = title;
  const label = el('span', 'classy-micro text-body-secondary', { liveAge: '' });
  label.text = age;
  const wrapper = el('span', 'd-inline-flex align-items-center gap-1', stamps).append(icon, label);
  // The CARD the indicator sits on, which a page marks so the tick can mute it
  // when the agent goes quiet (#99) — the crew card and the Overview's row both
  // carry `data-live-card`.
  const card = el('div', 'card h-100', { liveCard: '' }).append(wrapper);
  // Nothing above is a tick — reset the counters so the first one starts at nil.
  const parts = { wrapper, icon, glyph, spoken, label, card };
  for (const part of Object.values(parts)) part.writes = 0;
  return { ...parts, host: el('div').append(card) };
};

/**
 * An agent dialog as the mount left it: the two halves of `modal.agentDialog`'s
 * body, with the indicator the paint drew inside the header, under the element
 * that carries which agent is on screen. The test below pins this shape against
 * the real markup, the same way the indicator double is pinned.
 */
const openAgentDialog = ({ key, indicator }) => {
  const drawn = indicator ? drawnIndicator(indicator) : {};
  // The indicator double comes with a host of its own; here it hangs in the
  // dialog's header instead.
  delete drawn.host;
  const head = el('div', 'd-flex flex-wrap align-items-center gap-2 mb-3', { agentHead: '' });
  if (drawn.wrapper) head.append(drawn.wrapper);
  const rows = el('div', '', { agentRows: '' });
  const host = el('div', '', key ? { agentOpen: key } : {}).append(head, rows);
  head.writes = 0;
  return { ...drawn, head, rows, host };
};

const run = async () => {
  const format = await load('format.js');
  const state = await load('state.js');
  const crew = await load('crew.js');
  // agent.js is markup from a node and a clock — no DOM, so the indicator's
  // three states and its cutoff are askable here.
  const agent = await load('agent.js');
  // clock.js walks a document but reaches for nothing at import time — the
  // timer is armed inside startClock — so `applyLive` comes under Node against
  // the small DOM double above.
  const secondHand = await load('clock.js');
  // modal.js reaches for `document` only inside mountIssueModal, so everything
  // that shapes an issue into markup imports and answers under Node.
  const modal = await load('modal.js');
  // chrome.js is markup from state, like format.js — the DOM it goes into is
  // page.js's, which is why the split it describes is askable here.
  const chrome = await load('chrome.js');
  // scope.js is the `?repo=` value read and written — strings and arrays, no
  // DOM — and sidebar.js is markup from state, chrome.js's shape exactly.
  const scope = await load('scope.js');
  const sidebar = await load('sidebar.js');
  // api.js fixes its origin from `location` at import — stub it (and the
  // `window` override hatch) just long enough to load the module.
  globalThis.location = { href: 'http://localhost:4300/' };
  globalThis.window = {};
  const api = await load('api.js');
  delete globalThis.location;
  delete globalThis.window;
  // github.js is the published half of the data layer and takes every seam it
  // has as an argument — the token, `fetch`, the clock — so the whole of it,
  // including the two async doors, answers under Node. token.js is markup plus
  // one listener, and the markup half is pure.
  const github = await load('github.js');
  const token = await load('token.js');

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

  await test('the board’s columns are the pipeline in order, Building between Specced and Blocked', () => {
    assertEq(format.STATUSES.map((s) => s.key).join(','), 'inbox,specced,building,blocked,parked',
      'left to right, and the pipeline is all of it');
    assertEq(format.STATUSES.map((s) => s.label).join(','), 'Inbox,Specced,Building,Blocked,Parked',
      'and each column is titled the way a human reads it');
    assertEq(format.STATUSES.length, 5, 'five lanes — a missing label is not a place an issue lives (#118)');
    assert(!format.STATUSES.some((s) => !s.key), 'so no column stands for the absence of one');
  });

  await test('every status has a colour, and one the pipeline does not name still has one', () => {
    for (const status of format.STATUSES) {
      assert(format.statusColor(status.key).startsWith('var(--omega-'), `${status.key || 'no status'} resolves to a theme token`);
    }
    assertEq(format.statusToken('nonsense'), '--omega-ink-muted', 'an unknown status is drawn, not dropped');
    assert(format.statusToken('building') !== format.statusToken(''),
      'in-flight work and a status the vocabulary does not name never share a colour');
  });

  await test('a priority is drawn from the theme, and the unlabelled middle is neutral', () => {
    assertEq(format.priorityToken('high'), '--omega-accent', 'high takes the theme’s signal colour');
    assertEq(format.priorityToken('low'), '--omega-ink-faint', 'and low the faint end');
    assertEq(format.priorityToken(''), '--omega-ink-muted', 'normal priority is never written on an issue and is drawn neutral');
    assertEq(format.priorityToken('nonsense'), '--omega-ink-muted', 'and so is a priority the vocabulary does not name');
    // The two chips sit side by side in the dialog, so the LOUD end may not be
    // borrowed: a priority chip in a pipeline colour would read as a status.
    // The quiet end is shared with `parked` on purpose — a faint chip saying
    // "low" and a faint one saying "parked" mean the same thing about urgency.
    const statuses = format.STATUSES.map((status) => format.statusToken(status.key));
    assert(!statuses.includes(format.priorityToken('high')), 'high never borrows a status colour');
    assertEq(format.priorityToken('low'), format.statusToken('parked'), 'and the quiet end is the one the pipeline parks in');
  });

  await test('a status chip is the colour its Board column header carries', () => {
    for (const status of format.STATUSES) {
      const chip = format.statusChip(status.key);
      assert(chip.includes(`--omega-tone: ${format.statusColor(status.key)}`), `${status.key} is drawn in the column’s own token`);
      assert(chip.includes('omega-badge-tone'), 'through the framework’s tone chip, never a colour of its own');
      assert(chip.includes(`>${status.key}<`), 'labelled with the status itself');
    }
    assertEq(format.statusChip(''), '', 'an issue carrying no status draws no chip');
    assert(!format.statusChip('<img src=x>').includes('<img'), 'a hostile status is escaped');
  });

  // ── The alert that replaced the No-status column (#118) ──────────────────
  //
  // A missing `status:` label is a pipeline fault the daily heal repairs, not a
  // place an issue lives, so it is drawn as an alarm above the board instead of
  // a sixth lane. These are the questions that lane used to answer.

  await test('issues carrying no status label become one danger alert, not a column', () => {
    const markup = format.noStatusAlert([
      { repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'https://github.com/ITW/workkit/issues/4' },
      { repo: 'ITW/workkit', number: 9, title: 'Other thing', status: '', url: 'https://github.com/ITW/workkit/issues/9' },
      { repo: 'ITW/workkit', number: 12, title: 'Fine', status: 'building', url: 'https://github.com/ITW/workkit/issues/12' },
    ]);
    assert(markup.includes('alert-danger'), 'in the theme’s danger tone, which no ordinary board state uses');
    assert(markup.includes('2 issues carry no status label'), 'counting only the ones missing a label');
    assert(markup.includes('href="https://github.com/ITW/workkit/issues/4"'), 'each one a link to its GitHub page');
    assert(markup.includes('href="https://github.com/ITW/workkit/issues/9"'), 'including the one whose label is the empty string');
    assert(!markup.includes('/issues/12'), 'and an issue that carries a status is not in it');
    assert(markup.includes('target="_blank"') && markup.includes('rel="noopener"'), 'opening away from the board, like every other external link');
  });

  await test('the alert says the singular when there is one, and nothing at all when there are none', () => {
    const one = format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, title: 'Alone', url: 'u' }]);
    assert(one.includes('1 issue carries no status label'), 'one issue is not "1 issues"');
    assertEq(format.noStatusAlert([{ repo: 'ITW/workkit', number: 4, status: 'inbox', title: 'Fine', url: 'u' }]), '',
      'a board whose every issue is labelled draws nothing — the normal day');
    assertEq(format.noStatusAlert([]), '', 'and neither does an empty board');
  });

  await test('the alert names the repo only when the board is showing several', () => {
    const issues = [{ repo: 'ITW/workkit', number: 4, title: 'Wire the thing', url: 'u' }];
    const many = format.noStatusAlert(issues, true);
    assert(many.includes('ITW/workkit') && many.includes('#4'), 'a multi-repo board qualifies the issue by repo, as its cards do');
    const one = format.noStatusAlert(issues, false);
    assert(!one.includes('ITW/workkit') && one.includes('#4'), 'and a single-repo board does not repeat what the whole page already says');
  });

  await test('a hostile title in the alert renders as text', () => {
    const markup = format.noStatusAlert([{
      repo: '<img src=x>', number: 4, title: '<script>alert(1)</script>', url: '" onmouseover="x',
    }], true);
    assert(!markup.includes('<script>'), 'the title is escaped');
    assert(!markup.includes('<img'), 'and so is the repo slug');
    assert(!markup.includes('" onmouseover="x"'), 'and a url cannot break out of its attribute');
  });

  await test('the chart series keeps unlabeled issues visible, and only while they exist', () => {
    // #118: the Board surfaces a missing status as its danger alert; a chart
    // that silently dropped those issues would sum short of the open count
    // beside it. Hard-coded expectations either side of the boundary.
    const clean = format.statusBreakdown([
      { status: 'inbox' }, { status: 'building' }, { status: 'building' },
    ]);
    assertEq(clean.labels.join(','), 'Inbox,Specced,Building,Blocked,Parked', 'no drift means five slices, nothing more');
    assertEq(clean.values.join(','), '1,0,2,0,0', 'each status counts its own');
    assertEq(clean.labels.length, clean.colors.length, 'labels and colors stay in step');

    const drifted = format.statusBreakdown([{ status: 'inbox' }, { status: '' }, {}]);
    assertEq(drifted.labels[drifted.labels.length - 1], 'No status', 'an unlabeled issue is a visible slice');
    assertEq(drifted.values.join(','), '1,0,0,0,0,2', 'counted, so the ring sums to the open count');
    assertEq(drifted.values.reduce((sum, value) => sum + value, 0), 3, 'nothing dropped');
    assert(drifted.colors[drifted.colors.length - 1] !== format.statusColor('blocked'), 'and its color is no pipeline status’s');
  });

  await test('a priority chip is drawn through the same system, at both ends', () => {
    const high = format.priorityChip('high');
    const low = format.priorityChip('low');
    assert(high.includes('--omega-tone: var(--omega-accent)') && high.includes('>high<'), 'high in the signal colour');
    assert(low.includes('--omega-tone: var(--omega-ink-faint)') && low.includes('>low<'), 'low in the faint one');
    assert(high.includes('omega-badge-tone') && low.includes('omega-badge-tone'), 'both through the tone chip');
    assertEq(format.priorityChip(''), '', 'the unlabelled middle draws nothing');
    assertEq(format.priorityChip('nonsense'), '', 'and neither does a priority that is not one');
  });

  await test('a column reads in three priority bands, newest first inside each', () => {
    const issue = (priority, updatedAt) => ({ priority, updatedAt });
    const shuffled = [
      issue('low', '2026-07-30'),
      issue(null, '2026-07-28'),
      issue('high', '2026-07-20'),
      issue(null, '2026-07-29'),
      issue('high', '2026-07-21'),
      issue('low', '2026-07-31'),
    ];
    const sorted = [...shuffled].sort(format.byPriority);
    assertEq(sorted.map((one) => one.priority || 'normal').join(','), 'high,high,normal,normal,low,low',
      'high above the unlabelled middle, and low below it');
    assertEq(sorted.map((one) => one.updatedAt).join(','), '2026-07-21,2026-07-20,2026-07-29,2026-07-28,2026-07-31,2026-07-30',
      'and the band is broken by the most recently touched');
    assert(format.byPriority(issue('high', '2026-07-01'), issue('low', '2026-07-31')) < 0,
      'a stale high still outranks a fresh low');
    assertEq(format.byPriority(issue(null, ''), issue(null, '')), 0, 'two issues with nothing to sort by tie');
  });

  await test('the Board sorts its columns with the shared comparator, not one of its own', () => {
    // The band arithmetic is pinned above; this pins the PAGE to it. Without
    // this, a silent revert to a date-only sort in board.js leaves every other
    // test green and the issue's headline behavior gone.
    const fs = require('fs');
    const boardPage = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*byPriority[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(boardPage),
      'the comparator comes from format.js');
    assert(boardPage.includes('.sort(byPriority)'), 'and the columns actually sort by it');
  });

  await test('an empty state is an icon above a line, and says which nothing it is', () => {
    const state = format.empty('nothing here');
    assert(state.includes('fa-regular fa-folder-open'), 'the neutral default icon');
    assert(state.includes('aria-hidden="true"'), 'which is decorative — the line carries the meaning');
    assert(state.includes('>nothing here<'), 'and the line itself');
    assert(state.includes('text-body-secondary'), 'drawn in the theme’s quiet ink, never as an alarm');
    const chosen = format.empty('no live sessions', 'fa-regular fa-moon');
    assert(chosen.includes('fa-regular fa-moon') && !chosen.includes('fa-folder-open'), 'the caller’s icon replaces the default');
    assert(!format.empty('<script>x</script>', '"><img src=x>').includes('<script>'), 'a hostile message is escaped');
    assert(!format.empty('nothing', '"><img src=x>').includes('<img'), 'and so is an icon name');
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

  await test('a tile with no reading says a dash and carries why as its tooltip', () => {
    const cell = format.statCell('Live sessions', format.num(null), '/crew', format.LOCAL_ONLY_NOTICE);
    assert(cell.includes('>—</h3>'), 'the value is a dash, never a fabricated 0');
    assert(cell.includes(`title="${format.LOCAL_ONLY_NOTICE}"`), 'and the sentence behind it is one hover away');
    assert(!format.statCell('Open', 3, '/board').includes('title='), 'a tile with a real number needs none');
  });

  await test('a tile wears a sub-line only when there is a comparison to draw', () => {
    // Issue #55: how this number compares with a week ago, under it. A tile
    // with no history behind it keeps exactly the shape it always had.
    const cell = format.statCell('Open issues', 12, '/board', undefined, 'down 3 from last week');
    assert(cell.includes('>down 3 from last week</p>'), 'the comparison is drawn as its own line');
    assert(cell.indexOf('</h3>') < cell.indexOf('down 3'), 'under the number, not beside the label');
    assert(!format.statCell('Open issues', 12, '/board').includes('<p'), 'and a tile with nothing to compare carries no line');
    assert(format.statCell('Open', 1, '', undefined, '<img src=x>').includes('&lt;img'), 'a sub-line is escaped like every other value');
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

  await test('both ends of the priority scale are drawn through the one colour system', () => {
    const ends = { high: '--omega-accent', low: '--omega-ink-faint' };
    for (const [priority, token] of Object.entries(ends)) {
      const chips = format.issueChips({ type: 'bug', priority });
      assert(chips.includes(`--omega-tone: var(${token})`), `${priority} is drawn in its own token`);
      assertEq(chips.includes(format.priorityChip(priority)), true, `${priority} is the chip format.js draws`);
      assert(!chips.includes('classy-chip--accent'), 'and never a colour decided at the call site');
    }
    assert(!format.issueChips({ type: '', priority: '' }).includes('omega-badge-tone'),
      'the unlabelled middle still draws no priority chip');
  });

  await test('a type is drawn through the one colour system, in ramp slots no other vocabulary holds', () => {
    const slots = { bug: '--omega-chart-4', enhancement: '--omega-chart-3', idea: '--omega-chart-5' };
    for (const [type, token] of Object.entries(slots)) {
      const chips = format.issueChips({ type, priority: '' });
      assert(chips.includes(`--omega-tone: var(${token})`), `${type} is drawn in its own slot`);
      assertEq(chips.includes(format.typeChip(type)), true, `${type} is the chip format.js draws`);
      assert(token !== format.statusToken(type) && token !== format.priorityToken('high'),
        `${type}'s slot belongs to no status and not to high`);
    }
    const foreign = format.typeChip('question');
    assert(foreign.includes('classy-chip') && !foreign.includes('omega-badge-tone'),
      'a type outside the vocabulary stays a plain chip');
    assertEq(format.typeChip(''), '', 'no type, no chip');
  });

  await test('every type and priority has one glyph, and one table is the whole of it (#136)', () => {
    // Hard-coded on purpose: the glyphs are what makes a column of cards
    // readable at a glance, and a silent re-pick is a different board. The
    // table is the ONE home — the card and the dialog both read it, so a chip
    // cannot say different things on the two surfaces.
    assertEq(format.CHIP_GLYPHS.bug, 'fa-bug', 'a bug is a bug');
    assertEq(format.CHIP_GLYPHS.enhancement, 'fa-wand-magic-sparkles', 'an enhancement is the wand');
    assertEq(format.CHIP_GLYPHS.idea, 'fa-lightbulb', 'an idea is the lamp');
    assertEq(format.CHIP_GLYPHS.high, 'fa-angles-up', 'high points up');
    assertEq(format.CHIP_GLYPHS.low, 'fa-angles-down', 'and low points down');
    const glyphs = Object.values(format.CHIP_GLYPHS);
    assertEq(new Set(glyphs).size, glyphs.length, 'no two names share a glyph');
    assertEq(Object.keys(format.CHIP_GLYPHS).sort().join(','), 'bug,enhancement,high,idea,low',
      'and the table names the two vocabularies and nothing else');
    for (const status of format.STATUSES) {
      assert(!format.statusChip(status.key).includes('<i '), `a ${status.key} chip wears none — the column header already says it`);
    }
    assert(!format.typeChip('question').includes('<i '), 'and a type outside the vocabulary has neither colour nor glyph');
  });

  await test('a chip draws its glyph before the word, decorative and in the chip’s own colour (#136)', () => {
    // This row IS the Board card's chip row — the page hands it the card's
    // spacing and nothing more (pinned in the board suite below) — so what one
    // card renders is what this renders.
    const chips = format.issueChips({ type: 'bug', priority: 'high' }, 'mt-auto omega-tower-issue__chips');
    assert(chips.includes('<i class="fa-solid fa-bug me-1" aria-hidden="true"></i>bug'), 'the type chip is glyph then word');
    assert(chips.includes('<i class="fa-solid fa-angles-up me-1" aria-hidden="true"></i>high'), 'and so is the priority chip');
    assert(!/<i [^>]*style=/.test(chips), 'the glyph takes no colour of its own — it inherits the chip’s tone');
    assert(!/<i [^>]*tabindex|<i [^>]*role=/.test(chips), 'and it is no new focus target');
    assert(!chips.includes('<svg'), 'drawn by the framework’s one icon mechanism, not a hand-cut one');
    assert(!format.issueChips({ type: '', priority: '' }).includes('<i '), 'an issue with neither draws no glyph at all');
  });

  await test('the glyph is spaced off the word and sits on its optical centre (#136)', () => {
    // The defect this proves against: the chip is an inline-BLOCK — the theme's
    // `.omega-badge-tone` sets it and comes after `.classy-chip`'s inline-flex
    // at equal specificity — so the flex gap the markup was written against
    // never applied and the glyph rendered flush against the word. Both halves
    // of the fix are pinned by hand: neither is visible from Node, and both are
    // exactly the kind of thing a later edit drops without noticing.
    const fs = require('fs');
    for (const chip of [format.typeChip('bug'), format.priorityChip('low')]) {
      assert(/<i class="fa-solid fa-[a-z-]+ me-1"/.test(chip), 'the glyph carries the framework\'s own margin utility, since there is no gap to inherit');
    }
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const nudge = /\.classy-chip i\.fa-solid svg \{ vertical-align: (\S+?); \}/.exec(sheet);
    assert(nudge, 'and the sheet nudges the svg the renderer fills that `i` with — `.fa svg`, the framework\'s own rule, never reaches an `i` written `fa-solid` alone');
    assertEq(nudge[1], '-.125em', 'by the framework\'s own number, so a chip glyph sits where every other icon does');
  });

  await test('the Board card draws that row, and no surface names a glyph of its own (#136)', () => {
    const fs = require('fs');
    const js = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js');
    const source = fs.readFileSync(path.join(js, 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*issueChips[^}]*\} from '\.\.\/libs\/tower\/format\.js'/.test(source), 'the chips come from format.js');
    assert(source.includes('${issueChips(issue, \'mt-auto omega-tower-issue__chips\', open)}'),
      'and the card hands it spacing, never a chip of its own');
    // Every name in the table against every surface that draws chips: a
    // hand-written `<i class="fa-solid fa-lightbulb">` beside the row is a
    // second table, and the drift starts the day the two disagree.
    for (const surface of ['pages/board.js', 'pages/brief.js', 'libs/tower/modal.js']) {
      const drawn = fs.readFileSync(path.join(js, ...surface.split('/')), 'utf8');
      for (const glyph of Object.values(format.CHIP_GLYPHS)) {
        assert(!drawn.includes(glyph), `${surface} names no chip glyph (${glyph}) — the table owns which picture means what`);
      }
    }
  });

  await test('an issue waiting on one the board still holds wears a chip saying so', () => {
    // Issue #103: advisory and nothing more — the chip is the plain muted one
    // every undyed value wears, never a status or priority hue, and it is drawn
    // only while the blocker is on the board the card sits on.
    const issue = {
      repo: 'owner/repo',
      type: 'bug',
      blockedBy: [{ repo: 'owner/repo', number: 12 }, { repo: 'other/repo', number: 3 }],
    };
    const open = new Set(['owner/repo#12', 'other/repo#3']);
    const chips = format.issueChips(issue, '', open);
    assert(chips.includes('<span class="classy-chip">waits on #12</span>'), 'a blocker in the same repo is said the short way');
    assert(chips.includes('<span class="classy-chip">waits on other/repo#3</span>'), 'and one in another repo carries its slug');
    assert(!format.waitsOnChips(issue, open).includes('omega-badge-tone'),
      'in the plain muted chip, borrowing no status or priority colour');
    assertEq(chips.includes(format.waitsOnChips(issue, open)), true, 'the row draws format.js’s own helper, not a second copy of it');
  });

  await test('a blocker spelled in another case is the same issue, said the short way', () => {
    // Repo names are case-insensitive on GitHub, and the inline fallback is
    // hand-typed — the chip must not vanish over a capital letter.
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'OWNER/Repo', number: 12 }] };
    const chips = format.issueChips(issue, '', new Set(['owner/repo#12']));
    assert(chips.includes('<span class="classy-chip">waits on #12</span>'),
      'matched against the sweep and recognized as this repo despite the spelling');
  });

  await test('a blocker the board is not holding is drawn nowhere', () => {
    const issue = { repo: 'owner/repo', blockedBy: [{ repo: 'owner/repo', number: 12 }] };
    assertEq(format.issueChips(issue, '', new Set(['owner/repo#9'])).includes('waits on'), false,
      'a closed dependency, or one outside the sweep, is not a chip');
    assertEq(format.issueChips(issue).includes('waits on'), false, 'and a caller with no board to judge against draws none');
    assertEq(format.waitsOnChips({}, new Set()), '', 'an issue with no edges at all draws nothing');
  });

  await test('a hostile blocker repo comes back as text', () => {
    const chips = format.issueChips(
      { repo: 'owner/repo', blockedBy: [{ repo: '<img src=x>/repo', number: 4 }] },
      '',
      new Set(['<img src=x>/repo#4']),
    );
    assert(!chips.includes('<img'), 'the blocker’s repo is remote data like every other value');
    assert(chips.includes('&lt;img src=x&gt;/repo#4'), 'and shows as what it says');
  });

  await test('an issue with nothing to say draws no chips', () => {
    const chips = format.issueChips({ type: '', priority: '', agentOk: false, assignees: [] });
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

  await test('a local-only slot is a designed state, not an unavailable feed', () => {
    // The chrome's chip counts every feed that is not `ok` (the poller's own
    // stale rule), so a published copy marking its machine-bound slots failed
    // said "2 feeds unavailable" from first paint to last. The slot is `ok` and
    // MARKED instead, and the marker is what the panels draw from.
    const slot = state.localOnlySlot();
    assertEq(slot.ok, true, 'nothing failed — this copy simply is not that machine');
    assertEq(slot.localOnly, true, 'and the marker says which of the two it is');
    assertEq(slot.reason, format.LOCAL_ONLY_NOTICE, 'carrying the one sentence, from its one home');
    const published = { feeds: { board: { ok: true, data: {} }, sessions: slot, health: slot }, selectedRepo: '' };
    assert(state.localOnly(published, 'sessions') && state.localOnly(published, 'health'), 'both machine-bound slots read as local-only');
    assertEq(state.localOnly(published, 'board'), false, 'a feed that really answered does not');
    assertEq(state.localOnly({ feeds: {}, selectedRepo: '' }, 'sessions'), false, 'and neither does one that has not answered yet');
    assertEq(state.sessions(published).length, 0, 'the accessors still hand back nothing to draw');
    assertEq(Object.keys(state.health(published)).length, 0, 'from either of them');
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

  await test('the no-status alert is drawn from the SCOPED issues, so a repo out of scope neither shows nor counts', () => {
    // The alert is markup from values (format.js) and the narrowing is
    // state.js's, so what the page contributes is handing one to the other —
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
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/noStatusAlert\(all, showRepo\)/.test(source), 'the page hands the alert the scoped list, not the raw payload');
    assert(/const labelled = all\.filter\(\(issue\) => issue\.status\)/.test(source),
      'and the columns and their denominator are drawn from the labelled ones alone (#118)');
    assert(!/No status/.test(source), 'the column that used to hold them is gone, comments and all');
  });

  group('tower/app: board — the List | Graph toggle');

  // The page imports the framework and the graph module, so it is out of reach
  // of these suites (see the header) — what can be pinned is the source of the
  // decisions, the way every other page-level claim here is. The picture ITSELF
  // is pure and has a suite of its own: tests/tower/graphdef.test.js.

  await test('which view is on screen lives in the URL, and `list` is written as nothing at all', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const VIEWS = \['list', 'graph'\]/.test(source), 'two views, named');
    assert(/searchParams\.get\('view'\)[\s\S]{0,120}VIEWS\.includes\(value\) \? value : 'list'/.test(source),
      'the URL is read back and anything outside the two reads as the default, never as an empty page');
    assert(/url\.searchParams\.set\('view', view\)[\s\S]{0,80}url\.searchParams\.delete\('view'\)/.test(source),
      'the round trip writes the graph and takes the default off rather than leaving ?view=list behind');
    assert(/history\.replaceState\(null, '', url\)/.test(source), 'through replaceState, like the filters beside it');
    assert(/const view = readView\(\);/.test(source), 'and every paint re-reads it, so the 60-second repaint cannot revert the view');
  });

  await test('a filter never clears the view, and the view never clears a filter', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/const PARAMS = \['type', 'priority', 'agent', 'assignee', 'q'\]/.test(source),
      'the view is not one of the filter parameters writeFilters deletes what it is not given');
    assert(/writeView\(button\.dataset\.view\)/.test(source), 'the toggle writes only its own parameter');
  });

  await test('the toggle is two buttons and says which one is in force', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/aria-pressed="\$\{view === name\}"/.test(source), 'the active one is marked for a screen reader');
    assert(/btn-\$\{view === name \? '' : 'outline-'\}adaptive/.test(source), 'and drawn filled against outlined, in the theme’s own button');
    const toggle = source.slice(source.indexOf('const viewToggle'), source.indexOf('const toolbar'));
    assert(/data-view="\$\{name\}"/.test(toggle), 'each button names the view it selects');
    assert(!/style=|color:/.test(toggle), 'and nothing about it is coloured by hand — the framework’s classes are the whole of it');
  });

  await test('the graph is composed in the lib, drawn after the write, and says it is not the surface', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{ boardGraph \} from '\.\.\/libs\/tower\/graphdef\.js'/.test(source), 'the definition comes from the lib');
    assert(/import \{ loadGraph, graphReady, graphSlot, drawGraph \} from '__main_assets__\/js\/libs\/graph\.js'/.test(source),
      'and the drawing from the framework’s graph module, which is the only place mermaid is named');
    assert(/definition = boardGraph\(shown, sweep\)/.test(source),
      'composed from the issues on screen and the whole sweep behind them');
    assert(/graphSlot\('board-graph', GRAPH_HEIGHT, definition\)/.test(source),
      'the slot carries the definition, which is the stamp swap compares on');
    assert(/if \(!swap\(root[\s\S]*paintGraph\(root, state, definition\)/.test(source),
      'so a repaint that wrote nothing never redraws the diagram');
    assert(/cards open in the List view/.test(source), 'and the muted line says where the board is worked');
    assert(/drawing = drawing\.then/.test(source),
      'draws are serialized so a slower old render cannot land after a newer one and stand stale');
    assert(/drawGraph\('board-graph', next\)\.catch/.test(source),
      'a definition strict mermaid refuses says so in the host instead of leaving the box blank');
    assert(/: empty\('nothing on this board waits on anything'/.test(source),
      'an edge-less board shows the empty state, never an empty diagram');
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
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'a session quiet ten minutes shows nothing, whatever the API still calls it');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 10 * 60000 }, NOW), 'none', 'and neither does one that finished ten minutes ago');
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
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60000 }, NOW), 'idle', 'exactly a minute is still gray-but-live');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 60001 }, NOW), 'quiet', 'a millisecond past it is muted, not gone');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 61000 }, NOW), 'quiet', 'the word working does not exempt anything from it');
  });

  await test('a briefly quiet agent stays on the page for five minutes, muted (#99)', () => {
    // The defect this proves against: one boundary for both questions. An agent
    // that stops for ninety seconds — between turns, waiting on a tool — used
    // to vanish from the Crew page outright, so the page said nobody was
    // running while four agents were. Muted and still IS the honest middle.
    assertEq(agent.QUIET_WINDOW_MS, 5 * 60000, 'five minutes before it leaves');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 5000 }, NOW), 'working', 'inside the working window it still spins');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 60000 }, NOW), 'idle', 'at the minute it is gray and still on the clock');
    assertEq(agent.activityPhase({ state: 'working', lastActivity: NOW - 60001 }, NOW), 'quiet', 'a millisecond past the minute it goes muted');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 3 * 60000 }, NOW), 'quiet', 'three minutes in it is still there');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - 5 * 60000 }, NOW), 'quiet', 'exactly five minutes is the last second it is drawn');
    assertEq(agent.activityPhase({ state: 'done', lastActivity: NOW - (5 * 60000 + 1) }, NOW), 'none', 'and a millisecond past THAT it is gone');
  });

  await test('the muted band is a class the page already ships, on the card and on the row', () => {
    assertEq(agent.mutedClass('working'), '', 'a working agent is not muted');
    assertEq(agent.mutedClass('idle'), '', 'nor one that only just stopped');
    assertEq(agent.mutedClass('quiet'), agent.MUTED_CLASS, 'a quiet one wears the muted class');
    assertEq(agent.mutedClass('none'), agent.MUTED_CLASS, 'and so does one whose indicator has gone entirely');
    assertEq(agent.MUTED_CLASS, 'text-body-secondary', 'the framework\'s own muted text class — no new colour pairing');
    assertEq(agent.cardMuted({ state: 'working', lastActivity: NOW - 5000 }, NOW), '', 'a card draws it from the node it already has');
    assertEq(agent.cardMuted({ state: 'working', lastActivity: NOW - 90000 }, NOW), agent.MUTED_CLASS, 'through the one arithmetic, never a second threshold');
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

  await test('a claim on work already started carries the glyph too', () => {
    const building = agent.claimGlyph({ status: 'building', assignees: ['ianwieds'] });
    assert(building.includes('omega-tower-activity--idle'), 'the glyph marks a claim, and claimed work lives in building');
    assert(building.includes('title="held by @ianwieds"'), 'saying who has it there as well');
    assertEq(agent.claimGlyph({ status: 'building', assignees: [] }), '', 'a building issue nobody holds still draws nothing');
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
    assert(working.includes('fa-gear') && working.includes('fa-spin'), 'the working glyph spins');
    assert(working.includes('omega-tower-activity--working'), 'and carries the class its colour is on');
    assert(working.includes('title="running for 3m"'), 'the hover text is how long it has been up');
    const idle = agent.activityIcon('idle');
    assert(idle.includes('fa-gear') && !idle.includes('fa-spin'), 'the same glyph, still');
    assert(!idle.includes('title='), 'with no hover text when none was given');
    const quiet = agent.activityIcon('quiet');
    assert(quiet.includes('omega-tower-activity--quiet') && !quiet.includes('fa-spin'), 'the muted band is the same glyph, still');
    assertEq(agent.activityIcon('none'), '', 'and an agent past the five minutes draws nothing at all');
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
    const muted = agent.crewActivity({ state: 'working', lastActivity: NOW - 90000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(muted.includes('omega-tower-activity--quiet'), 'ninety seconds in, the glyph is still drawn — muted');
    assert(!muted.includes('fa-spin'), 'and it has stopped turning');
    assert(muted.includes('>1m<'), 'with the same age beside it as ever');
    assert(agent.crewActivity({ state: 'working' }, NOW).includes('up for an unknown span'), 'a node with no times still says the honest thing');
  });

  await test('a drawn indicator carries the stamps the clock reads back off it', () => {
    // The defect this proves against: markup that carries only the WORDS made
    // from the stamps. A feed lands every ten seconds; the second hand has to
    // re-decide the phase and the age in between, and it has nothing to decide
    // from unless the element itself holds the raw epochs.
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes(`data-live-ts="${NOW - 12000}"`), 'the epoch it last moved, raw');
    assert(markup.includes(`data-live-alive="${NOW - 3 * 60000}"`), 'and the one it started at');
    assert(markup.includes('data-live-state="working"'), 'plus the state word, which the phase needs and no arithmetic can recover');
    assert(markup.includes('data-live-age'), 'the age label is findable — it is the one text the tick rewrites');
    const timeless = agent.crewActivity({ state: 'working' }, NOW);
    assert(!timeless.includes('data-live-ts'), 'a node with no timestamp carries no stamp — an absent one must not become the epoch');
  });

  await test('the second hand decides exactly what the paint decided', () => {
    // Same thresholds, one home: the tick reads the dataset the markup above
    // wrote, and any drift between the two is a card whose colour and whose
    // label disagree for up to ten seconds.
    const stamps = (last, state = 'working') => ({ liveState: state, liveTs: String(NOW - last), liveAlive: String(NOW - 3 * 60000) });
    assertEq(agent.activityTick(stamps(5000), NOW).phase, 'working', 'running and fresh');
    assertEq(agent.activityTick(stamps(20000), NOW).phase, 'working', 'exactly two poll cycles still spins');
    assertEq(agent.activityTick(stamps(20001), NOW).phase, 'idle', 'a millisecond past it goes gray');
    assertEq(agent.activityTick(stamps(60000), NOW).phase, 'idle', 'exactly a minute is still on the clock');
    assertEq(agent.activityTick(stamps(60001), NOW).phase, 'quiet', 'and a millisecond past THAT is muted');
    assertEq(agent.activityTick(stamps(5 * 60000), NOW).phase, 'quiet', 'five minutes is the last second it is drawn');
    assertEq(agent.activityTick(stamps(5 * 60000 + 1), NOW).phase, 'none', 'past five minutes it is gone');
    assertEq(agent.activityTick(stamps(2000, 'done'), NOW).phase, 'idle', 'the state word still decides the motion');
    assertEq(agent.activityTick({ liveState: 'working' }, NOW).phase, 'working', 'a stampless element falls back to the word, as the paint does');
    assertEq(agent.activityTick({}, NOW).phase, 'none', 'and an element carrying nothing draws nothing');
  });

  await test('a tick a second later moves the number, and one in the same second moves nothing', () => {
    const stamps = { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) };
    const first = agent.activityTick(stamps, NOW);
    assertEq(first.age, '12s', 'the seconds since it last moved');
    assertEq(first.title, 'running for 3m', 'and how long it has been up, for the hover');
    assertEq(agent.activityTick(stamps, NOW + 1000).age, '13s', 'a second later the label has moved');
    // Idempotence is what makes a 1s timer cheap: the same second in gives the
    // same answer out, so the DOM comparison behind every write finds nothing
    // to do rather than recalculating a style sixty times a minute.
    const again = agent.activityTick(stamps, NOW);
    assertEq(again.age, first.age, 'the same second in, the same label out');
    assertEq(again.phase, first.phase, 'and the same phase');
    assertEq(again.title, first.title, 'and the same hover text');
  });

  await test('the classes the phase wears are written once, for both the paint and the tick', () => {
    assert(agent.activityIcon('working').includes(`class="${agent.activityClass('working')}"`), 'the paint draws them from the one helper');
    assertEq(agent.activityClass('idle'), 'omega-tower-activity omega-tower-activity--idle', 'and a phase crossing has one name to write');
  });

  await test('the second hand has one home, and it is not a page', () => {
    const fs = require('fs');
    const clock = fs.readFileSync(path.join(libs, 'clock.js'), 'utf8');
    assert(clock.includes('setInterval'), 'the timer lives in clock.js');
    assert(/import \{[^}]*activityTick[^}]*\} from '\.\/agent\.js'/.test(clock), 'and it re-decides through the shared arithmetic rather than a copy of the thresholds');
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of fs.readdirSync(pages).filter((file) => file.endsWith('.js'))) {
      assert(!fs.readFileSync(path.join(pages, name), 'utf8').includes('setInterval'), `${name} runs no clock of its own`);
    }
    assert(fs.readFileSync(path.join(libs, 'page.js'), 'utf8').includes('startClock(document.body)'), 'the runtime arms it once, over the whole document — the dialogs carry indicators and sit outside the page mount');
  });

  await test('the paint and the double draw the same node — the selectors the tick walks by', () => {
    // What keeps the fake DOM below honest: every hook applyLive reaches for is
    // one the real builder actually writes. If crewActivity renames one of
    // these, this fails here rather than leaving the lifecycle test passing
    // against a shape that no longer exists.
    const markup = agent.crewActivity({ state: 'working', lastActivity: NOW - 12000, aliveSince: NOW - 3 * 60000 }, NOW);
    assert(markup.includes('data-live-ts='), 'the wrapper the walk finds');
    assert(markup.includes('class="omega-tower-activity omega-tower-activity--working"'), 'the icon the tick re-classes');
    assert(markup.includes('<i class="fa-solid fa-gear fa-spin"'), 'the glyph it toggles the motion on');
    assert(markup.includes('class="visually-hidden">working<'), 'the word it keeps in step with the colour');
    assert(markup.includes('data-live-age'), 'and the label it rewrites');
  });

  await test('a tick a second later moves the label and touches nothing else', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1000);
    assertEq(drawn.label.textContent, '13s', 'the number moved');
    assertEq(drawn.label.writes, 1, 'in one write');
    assertEq(drawn.icon.writes, 0, 'the icon was left alone — same phase, same hover text');
    assertEq(drawn.glyph.writes, 0, 'and the glyph never stopped turning');
    assertEq(drawn.wrapper.wipes, 0, 'nothing was replaced');
    assertEq(drawn.host.querySelector('[data-live-ts]'), drawn.wrapper, 'the element the walk finds is the same object it found before');
    assertEq(drawn.icon.querySelector('i'), drawn.glyph, 'and so is the glyph under it — a replaced node is a restarted animation');
  });

  await test('a tick in the same second writes nothing at all', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '12s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 12000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW);
    secondHand.applyLive(drawn.host, NOW);
    const writes = [drawn.wrapper, drawn.icon, drawn.glyph, drawn.spoken, drawn.label].map((part) => part.writes);
    assertEq(writes.join(','), '0,0,0,0,0', 'every mutation is behind a comparison, so a second that says the same thing costs nothing');
  });

  await test('the idle crossing flips the classes on the element that is already there', () => {
    const drawn = drawnIndicator({
      phase: 'working', age: '20s', title: 'running for 3m',
      stamps: { liveState: 'working', liveTs: String(NOW - 20000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assertEq(drawn.icon.className, 'omega-tower-activity omega-tower-activity--idle', 'the colour went gray');
    assertEq(drawn.glyph.className, 'fa-solid fa-gear', 'the motion stopped');
    assertEq(drawn.spoken.textContent, 'idle', 'and what a screen reader hears went with it');
    assertEq(drawn.wrapper.wipes, 0, 'in place — the crossing replaced no node');
    assertEq(drawn.icon.querySelector('i'), drawn.glyph, 'it is the same glyph, restyled');
  });

  await test('the sixtieth second mutes the card instead of taking it off the page (#99)', () => {
    const drawn = drawnIndicator({
      phase: 'idle', age: '60s', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assertEq(drawn.wrapper.wipes, 0, 'the indicator is still there');
    assertEq(drawn.icon.className, 'omega-tower-activity omega-tower-activity--quiet', 'wearing the muted band');
    assertEq(drawn.spoken.textContent, 'quiet', 'and saying so to a screen reader');
    assert(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card it sits on is muted with it, live — not at the next poll');
    assertEq(drawn.host.querySelectorAll('[data-live-ts]').length, 1, 'and it stays in the walk, so it can come back');
    // Coming back is a fresher stamp, which a feed brings; the mute comes off
    // the same second the phase does.
    drawn.wrapper.dataset.liveTs = String(NOW - 1000);
    secondHand.applyLive(drawn.host, NOW + 2);
    assert(!drawn.card.className.split(' ').includes('text-body-secondary'), 'an agent that moves again is not muted a second longer');
  });

  await test('the five-minute mark empties the wrapper and takes it out of the walk', () => {
    const drawn = drawnIndicator({
      phase: 'quiet', age: '5m', title: 'running for 3m',
      stamps: { liveState: 'done', liveTs: String(NOW - 5 * 60000), liveAlive: String(NOW - 3 * 60000) },
    });
    secondHand.applyLive(drawn.host, NOW + 1);
    assert(drawn.card.className.split(' ').includes('text-body-secondary'), 'the card is muted on its way out');
    assertEq(drawn.wrapper.wipes, 1, 'past the cutoff the indicator is not gray, it is gone');
    assertEq(drawn.wrapper.children.length, 0, 'the glyph and its label with it');
    assertEq(drawn.wrapper.dataset.liveTs, undefined, 'and the stamp is gone too');
    assertEq(drawn.host.querySelectorAll('[data-live-ts]').length, 0, 'so the walk no longer finds it — only a paint can bring it back');
    secondHand.applyLive(drawn.host, NOW + 120000);
    assertEq(drawn.wrapper.wipes, 1, 'and every later tick passes it by');
  });

  await test('the agent dialog carries the stamps too, so an open one ages like the card behind it', () => {
    // The defect this proves against: the dialog drew the bare glyph, with no
    // stamps on it, so it was the one surface the second hand could not reach —
    // a dialog left open showed a green spinning circle for an agent that had
    // been quiet for ten minutes.
    const body = modal.agentDialog({
      id: 'a1', role: 'worker', state: 'working', lastActivity: NOW - 6000, aliveSince: NOW - 4 * 60000,
    }, NOW).body;
    assert(body.includes(`data-live-ts="${NOW - 6000}"`), 'the stamp the tick reads back');
    assert(body.includes('data-live-state="working"'), 'and the state word it decides the motion from');
    assert(body.includes('data-live-age'), 'plus the label the tick rewrites');
  });

  await test('the Overview draws its state cell with the one shared builder, stamps and all', () => {
    // The defect this proves against: a SECOND hand-rolled copy of the crew
    // card's wrapper. The Overview built its own span around the bare glyph, so
    // its indicator carried no stamps, the second hand walked straight past it,
    // and the landing page's numbers sat still while the Crew page's moved.
    const fs = require('fs');
    const overview = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    assert(!overview.includes('activityIcon('), 'it wraps nothing of its own around the bare glyph');
    // And what that builder hands it, for a session in the shape /api/crew
    // sends one — the stamps are the whole point of the delegation.
    const cell = agent.crewActivity({ state: 'working', lastActivity: NOW - 4000, aliveSince: NOW - 90000 }, NOW);
    assert(cell.includes(`data-live-ts="${NOW - 4000}"`), 'so the Overview markup carries the stamp the tick reads back');
    assert(cell.includes('data-live-age'), 'and the label the tick rewrites');
  });

  await test('the class the glyph spins on names a rule that exists', () => {
    // The defect this proves against: `fa-spin` is Font Awesome's class and the
    // theme ships its icons WITHOUT its stylesheet, so the markup asked for an
    // animation nothing in the bundle defined and the glyph was still from the
    // day it shipped. Whether it visibly turns is a browser's answer; that the
    // rule is in the sheet at all is this one's.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const rule = /\.omega-tower-activity \.fa-spin \{ animation: (\S+) /.exec(sheet);
    assert(rule, 'the indicator gives its own glyph the animation');
    assertEq(rule[1], 'spin', 'reusing the keyframes the framework already ships');
    // Anchored on the block that disables THIS animation, not on the sheet's
    // first `prefers-reduced-motion` — an unrelated reduced-motion block added
    // higher up would otherwise fail a rule that is perfectly well ordered.
    const disable = /@media \(prefers-reduced-motion: reduce\) \{\s*\.omega-tower-activity \.fa-spin \{ animation: none; \}/.exec(sheet);
    assert(disable, 'and reduced motion turns this animation off by name');
    assert(disable.index > sheet.indexOf('.omega-tower-activity .fa-spin {'), 'after the rule it overrides, so it still wins the tie');
  });

  await test('the glyph turns about its own centre, still or spinning (#137)', () => {
    // The defect this proves against: the animation was on an `<i>` with no box
    // of its own, so its size was the LINE it sat on — taller than the 1em SVG
    // the framework's renderer fills it with, since a replaced element rests on
    // the baseline with the strut's leading under it. A rotation turns about
    // the box's centre, which sat ~2px below the glyph's at .75rem, so the
    // glyph orbited instead of turning. The box has to BE the glyph.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const box = /\.omega-tower-activity i \{([^}]*)\}/.exec(sheet);
    assert(box, 'the indicator sizes the glyph it draws');
    for (const declaration of ['height: 1em', 'width: 1em']) {
      assert(box[1].includes(declaration), `one square em (${declaration}), so the box's centre is the glyph's`);
    }
    for (const declaration of ['display: flex', 'align-items: center', 'justify-content: center']) {
      assert(box[1].includes(declaration), `and the glyph is centred in it (${declaration}), never laid out on a baseline`);
    }
    assert(/^\.omega-tower-activity i \{/m.test(sheet), 'at the top level — a box behind a media query is a box half the readers do not get');
    // The box is NOT the spinning phase's: the still glyph wears the same one,
    // so a card keeps its size across the second the motion starts or stops.
    const motion = /\.omega-tower-activity \.fa-spin \{ (.*?) \}/.exec(sheet);
    assertEq(motion[1], 'animation: spin 1s linear infinite;', 'the phase rule says the motion and nothing about the box');
    // And what the sheet is scoped to is what the markup actually draws — the
    // rule missing its element is the whole of #65 and half of this one.
    const working = agent.activityIcon('working', 'running for 3m');
    assert(/class="omega-tower-activity[^"]*"/.test(working), 'the wrapper the box and the motion are both scoped under');
    assert(/<i class="fa-solid fa-gear fa-spin"/.test(working), 'the `i` the box sizes, wearing the class the motion is on');
  });

  await test('the indicator is a gear, so a still one does not read as a broken spinner (#137)', () => {
    // The defect this proves against: the notched ring — the universal loading
    // spinner — drawn STILL on every claimed Board card, which is what a board
    // whose spinners "do not work" looks like. The Board's glyph is still on
    // purpose (a claim carries no timestamps to spin on), so the fix is a shape
    // that reads at rest.
    const held = agent.claimGlyph({ status: 'building', assignees: ['ian'] });
    assert(held.includes('fa-gear'), 'the Board says a claim with a gear at rest');
    assert(!held.includes('fa-spin'), 'still, as it always was — nothing here knows whether that agent is moving');
    assert(agent.activityIcon('working').includes('fa-gear'), 'and the Crew turns the same one');
    for (const markup of [held, agent.activityIcon('working'), agent.activityIcon('quiet')]) {
      assert(!markup.includes('circle-notch'), 'the loader\'s ring is gone from every phase — one glyph, one story');
    }
  });

  await test('the Board\'s loading spinner is the framework\'s, unshadowed (#137)', () => {
    // Where the OTHER spinner on the page comes from: the framework's
    // `loading()`, which draws Bootstrap's `.spinner-border` — animated by the
    // bundle's own `@keyframes spinner-border`, nothing this app defines. It
    // stays that way only while this sheet writes no rule of that name; a local
    // override is exactly how a working spinner stops.
    const fs = require('fs');
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/import \{[^}]*loading[^}]*\} from '@omega\.js\/client\/modules\/live-page'/.test(page), 'the Board waits with the framework\'s spinner, not one of its own');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    assert(!sheet.includes('.spinner-border'), 'and this sheet leaves it alone');
  });

  await test('the muted band borrows the gray the still glyph already wears', () => {
    // No new colour pairing for #99: the quiet phase names the SAME faint token
    // the idle one does, so there is one gray on the tower rather than two.
    const fs = require('fs');
    const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'css', 'main.scss'), 'utf8');
    const rule = /\.omega-tower-activity--idle,\s*\.omega-tower-activity--quiet \{ color: (.+?); \}/.exec(sheet);
    assert(rule, 'the two bands share one rule');
    assert(rule[1].includes('--omega-ink-faint'), 'and it is the theme\'s faint ink, not a hex of its own');
  });

  await test('both crew surfaces mark the card the tick mutes (#99)', () => {
    // The defect this proves against: the mute drawn only at paint time. The
    // feeds land every ten seconds and the crossing is measured in seconds, so
    // the card has to carry the hook the second hand walks — the same bet the
    // `data-live-*` stamps beside it make.
    const fs = require('fs');
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['crew.js', 'index.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(source.includes('data-live-card'), `${name} marks the element that goes muted`);
      assert(/import \{[^}]*cardMuted[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(source), `${name} draws that mute from the one arithmetic, never a threshold of its own`);
    }
    const clock = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'libs', 'tower', 'clock.js'), 'utf8');
    assert(clock.includes('data-live-card'), 'and the second hand walks them');
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
    assert(/import \{[^}]*crewActivity[^}]*\} from '\.\.\/libs\/tower\/agent\.js'/.test(overview), 'and the Overview\'s crew table draws the same indicator — the same builder, not a pill or a wrapper of its own');
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

  await test('the dialog’s status chip is the colour of the column the card came from', () => {
    const parts = modal.issueDialog(ISSUE, render);
    assert(parts.body.includes(format.statusChip('specced')), 'the dialog draws format.js’s status chip');
    assert(parts.body.includes(`--omega-tone: ${format.statusColor('specced')}`),
      'so the dialog and the Board column header say specced in one colour');
    const bare = modal.issueDialog({ ...ISSUE, status: '', priority: '', type: '' }, render);
    assert(!bare.body.includes('omega-badge-tone'), 'and an issue with no status carries no status chip');
  });

  await test('the dialog’s type and priority chips wear the card’s glyphs (#136)', () => {
    const parts = modal.issueDialog({ ...ISSUE, type: 'idea', priority: 'low' }, render);
    assert(parts.body.includes('<i class="fa-solid fa-lightbulb me-1" aria-hidden="true"></i>idea'), 'the type, glyph then word');
    assert(parts.body.includes('<i class="fa-solid fa-angles-down me-1" aria-hidden="true"></i>low'), 'and the priority the same way');
    assert(parts.body.includes(format.typeChip('idea')) && parts.body.includes(format.priorityChip('low')),
      'both are format.js’s own chips, so the dialog and the card cannot draw one thing two ways');
    const glyphs = Object.values(format.CHIP_GLYPHS).filter((glyph) => parts.body.includes(glyph));
    assertEq(glyphs.length, 2, 'and exactly those two — the status chip sitting with them wears no glyph');
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

  group('tower/app: modal — what an issue depends on');

  // One board with one dependency in it, drawn twice over: #10 is what #11 and
  // the cross-repo #12 are both waiting on. The second reference is written in
  // another case on purpose — repo names are case-insensitive on GitHub and the
  // inline `Depends on:` fallback is hand-typed, so the two spellings are one
  // edge or the feature is a coin toss.
  const BLOCKER = { ...ISSUE, number: 10, title: 'the one holding things up' };
  const WAITER = {
    ...ISSUE, number: 11, title: 'waiting on it', blockedBy: [{ repo: 'ITW/workkit', number: 10 }],
  };
  const ELSEWHERE = {
    ...ISSUE, repo: 'ITW/other', number: 12, title: 'waiting from another repo', blockedBy: [{ repo: 'itw/WORKKIT', number: 10 }],
  };
  const BOARD = [BLOCKER, WAITER, ELSEWHERE];

  await test('the board’s edges read both ways — what an issue waits on, and what waits on it', () => {
    const waiting = modal.dependencies(WAITER, BOARD);
    assertEq(waiting.waitsOn.length, 1, 'the waiter waits on one issue');
    assertEq(waiting.waitsOn[0].number, 10, 'the blocker, as the board’s own object');
    assertEq(waiting.blocks.length, 0, 'and nothing waits on it');

    const blocker = modal.dependencies(BLOCKER, BOARD);
    assertEq(blocker.waitsOn.length, 0, 'the blocker waits on nothing');
    assertEq(blocker.blocks.map((one) => one.number).join(','), '11,12',
      'and the inverse is read off the same payload — both of them, the cross-repo one included');
  });

  await test('a blocker the board is no longer carrying is satisfied, exactly as on a card', () => {
    // The card's chip drops a blocker the sweep does not hold (format.waitsOnChips)
    // because a closed one is nothing to wait for. The dialog may not answer that
    // question a second way.
    const gone = modal.dependencies({ ...ISSUE, number: 13, blockedBy: [{ repo: 'ITW/workkit', number: 999 }] }, BOARD);
    assertEq(gone.waitsOn.length, 0, 'nothing to wait for');
    assertEq(modal.dependencies(WAITER, []).waitsOn.length, 0, 'and a board that answered with nothing says nothing either');
  });

  await test('the dialog names both directions, each one opening the issue it names', () => {
    const waiting = modal.issueDialog(WAITER, render, BOARD);
    assert(waiting.body.includes('waits on'), 'the waiter says what it waits on');
    assert(!waiting.body.includes('blocks'), 'and says nothing about blocking, since it blocks nothing');
    assert(/data-issue="ITW\/workkit#10" role="button" tabindex="0">#10</.test(waiting.body),
      'the blocker is named the short way in its own repo, and is the trigger that opens ITS dialog');

    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    assert(blocker.body.includes('blocks'), 'the blocker says what it is holding up');
    assert(/data-issue="ITW\/workkit#11"[^>]*>#11</.test(blocker.body), 'the issue in the same repo, the short way');
    assert(/data-issue="ITW\/other#12"[^>]*>ITW\/other#12</.test(blocker.body), 'and the one in another repo with its slug — `#12` there is a different issue');
  });

  await test('a dependency opens in the tower, never in a new tab', () => {
    // The delegated listener ignores a click inside an `a[href]` — that is the
    // card's escape hatch — so a reference drawn as an anchor would open the
    // GitHub page instead of the dialog it is there to open.
    const blocker = modal.issueDialog(BLOCKER, render, BOARD);
    const start = blocker.body.indexOf('blocks');
    assert(start > 0, 'the line is drawn');
    const line = blocker.body.slice(start, blocker.body.indexOf('omega-tower-issue__body'));
    assert(line.includes('#11'), 'and it is the one carrying the references');
    assert(!line.includes('<a '), 'no anchor in it — an anchor would leave for GitHub instead');
  });

  await test('an issue that neither waits nor blocks draws no line at all', () => {
    const alone = modal.issueDialog(ISSUE, render, BOARD);
    assert(!alone.body.includes('waits on'), 'no label with nothing under it');
    assert(!alone.body.includes('blocks'), 'in either direction');
    assert(!alone.body.includes('gap-1 mb-3'),
      'and no empty row where the line would have been — omission is the container, not just the words');
    assert(!modal.issueDialog(WAITER, render).body.includes('waits on'),
      'and a dialog handed no board at all says nothing rather than guessing');
  });

  await test('a hostile repo name reaches the dependency line as text', () => {
    const nasty = modal.issueDialog(BLOCKER, render, [
      BLOCKER, { ...WAITER, repo: '<img src=x onerror=alert(1)>' },
    ]);
    assert(!nasty.body.includes('<img'), 'the slug is escaped like every other remote value');
  });

  await test('the runtime hands the dialog the board the paint is drawing', () => {
    // The dialog lives in the layout, outside the mount a paint writes into, and
    // page.js is out of reach of these suites (see the header) — so what is
    // pinned is the handover: every page's paint passes here, so no page keeps a
    // second copy of the payload for the dialog to read.
    const fs = require('fs');
    const runtime = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/import \{[^}]*holdBoard[^}]*\} from '\.\/modal\.js'/.test(runtime), 'the runtime takes the handover from the dialog module');
    assert(/^\s*holdBoard\(board\(state\)\);$/m.test(runtime), 'and hands it the board payload state.js reads back');
    assert(runtime.search(/^\s*holdBoard\(board\(state\)\);$/m) < runtime.indexOf('options.render(body, state);'),
      'before the render, so the page and its dialog are drawn from one payload');
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
    assert(parts.body.includes(`data-live-ts="${NOW - 4000}"`) && parts.body.includes('>4s<'), 'how fresh it is — the header\'s live age, the one thing on the dialog that moves');
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

  await test('the dialog says how fresh the agent is ONCE, in the half that ages', () => {
    // The defect this proves against: the header's ticking age and a "Last
    // activity" row frozen at open, two numbers for one fact — twenty seconds
    // in, the row still said 4s while the header said 24s.
    const parts = modal.agentDialog(AGENT, NOW);
    assert(!parts.body.includes('Last activity'), 'the frozen row is gone');
    assertEq(parts.body.match(/data-live-age/g).length, 1, 'and the live one is the only span saying it');
    // The shape the refresh below reaches into, pinned against the real markup
    // so the double and the builder cannot drift apart in silence.
    assert(/<div class="[^"]*" data-agent-head>/.test(parts.body), 'the header, patched in place so its glyph keeps turning');
    assert(parts.body.includes('<div data-agent-rows>'), 'and the rows, which hold no motion and are rewritten whole');
    assert(parts.body.indexOf('data-agent-head') < parts.body.indexOf('data-agent-rows'), 'in that order');
  });

  await test('a feed paint brings the open dialog up to the stamps it just read', () => {
    const entry = {
      ...AGENT, id: 'agent-live', lastActivity: NOW - 4000, lastToolAt: NOW - 4000,
    };
    modal.agentTrigger(entry);
    const dialog = openAgentDialog({
      key: 'agent-live',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });

    // Half a minute of work later, the paint has re-registered the same agent
    // with everything it did since. Without the refresh the dialog is still
    // holding the stamps it opened with — gray at twenty seconds, gone at
    // sixty — while the card behind it spins.
    modal.agentTrigger({
      ...entry, lastActivity: NOW + 28000, lastTool: 'Bash', lastToolAt: NOW + 28000, tokens: 20000,
    });
    assertEq(modal.refreshAgentDialog(NOW + 30000, dialog.host), true, 'the open dialog was refreshed');

    assertEq(dialog.wrapper.dataset.liveTs, String(NOW + 28000), 'the dialog carries the stamp the feed brought');
    assertEq(dialog.icon.className, 'omega-tower-activity omega-tower-activity--working', 'so it is working, two seconds after its last move — not idle, thirty-four seconds after the one it opened on');
    assertEq(dialog.label.textContent, '2s', 'and the age says the same');
    assertEq(dialog.glyph.writes, 0, 'the glyph was neither replaced nor restyled — one unbroken spin across the paint');
    assertEq(dialog.wrapper.wipes, 0, 'nothing under the header was replaced');
    assertEq(dialog.head.writes, 0, 'and the header itself was patched, never rewritten');
    assert(dialog.rows.innerHTML.includes('Bash'), 'the rows are the fresh read too');
    assert(dialog.rows.innerHTML.includes('20.0K'), 'spend and all');
  });

  await test('a paint that changed nothing rewrites nothing', () => {
    const entry = { ...AGENT, id: 'agent-still' };
    modal.agentTrigger(entry);
    const dialog = openAgentDialog({
      key: 'agent-still',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });
    modal.refreshAgentDialog(NOW, dialog.host);
    const first = dialog.rows.writes;
    modal.refreshAgentDialog(NOW, dialog.host);
    assertEq(dialog.rows.writes, first, 'a poll paints twice, and the second one costs nothing');
  });

  await test('a dialog nobody opened, and one open on an agent that ended', () => {
    const closed = openAgentDialog({ key: '', indicator: null });
    assertEq(modal.refreshAgentDialog(NOW, closed.host), false, 'a closed dialog carries no key and is refreshed by nothing');
    assertEq(closed.rows.writes, 0, 'and is written to by nothing');
    assertEq(modal.refreshAgentDialog(NOW, null), false, 'nor is a page whose layout ships no dialog at all');

    // An agent that ended between polls stops being drawn, so the next paint
    // stops registering it. The honest thing is the last stamps it had: the
    // dialog keeps them and the second hand decays them exactly as it would on
    // the card that is no longer there — gray, then gone.
    const ended = openAgentDialog({
      key: 'agent-ended',
      indicator: {
        phase: 'working',
        age: '4s',
        title: 'running for 8m',
        stamps: { liveState: 'working', liveTs: String(NOW - 4000), liveAlive: String(NOW - 8 * 60000) },
      },
    });
    assertEq(modal.refreshAgentDialog(NOW + 10000, ended.host), false, 'nothing is registered under that key any more');
    assertEq(ended.rows.writes, 0, 'so the dialog is left saying what it last knew');
    secondHand.applyLive(ended.host, NOW + 25000);
    assertEq(ended.icon.className, 'omega-tower-activity omega-tower-activity--idle', 'and the second hand takes it gray');
    secondHand.applyLive(ended.host, NOW + 6 * 60000);
    assertEq(ended.wrapper.children.length, 0, 'and then away');
  });

  await test('an indicator that aged out comes back when the agent does', () => {
    const entry = { ...AGENT, id: 'agent-back', lastActivity: NOW - 6 * 60000 };
    modal.agentTrigger(entry);
    // A dialog opened on an agent quiet past the cutoff has no indicator at all
    // — there is no element to patch, so the refresh redraws the header.
    const dialog = openAgentDialog({ key: 'agent-back', indicator: null });
    modal.agentTrigger({ ...entry, lastActivity: NOW });
    assertEq(modal.refreshAgentDialog(NOW, dialog.host), true, 'the refresh answers');
    assert(dialog.head.innerHTML.includes(`data-live-ts="${NOW}"`), 'and the header is drawn again, stamps and all');
    assert(dialog.head.innerHTML.includes('fa-spin'), 'spinning — the agent is moving again');
  });

  await test('the paint is what refreshes it, on every page and not just the crew', () => {
    // The dialogs are the LAYOUT's and outlive every page, so the refresh is
    // wired where all six paints pass through rather than in the one page whose
    // cards opened it.
    const fs = require('fs');
    const runtime = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/import \{[^}]*refreshAgentDialog[^}]*\} from '\.\/modal\.js'/.test(runtime), 'the runtime takes the refresh from the dialog module');
    assert(/^\s*refreshAgentDialog\(\);$/m.test(runtime), 'and calls it');
    assert(runtime.indexOf('options.render(body, state);') < runtime.search(/^\s*refreshAgentDialog\(\);$/m), 'after the render that re-registered the agents it reads');
  });

  await test('the open writes the key the refresh reads, and the close removes it', () => {
    // The whole feature hinges on this pair: without the key no paint ever
    // refreshes the dialog, and without the cleanup a closed dialog keeps
    // refreshing forever. The mount runs only in a browser, so the wiring is
    // pinned where it lives.
    const fs = require('fs');
    const source = fs.readFileSync(path.join(libs, 'modal.js'), 'utf8');
    assert(/body\.dataset\.agentOpen = key;/.test(source), 'the open records which agent is on screen');
    assert(/addEventListener\('hidden\.bs\.modal', \(\) => \{ delete body\.dataset\.agentOpen; \}\)/.test(source), 'and the close deletes it');
    const open = source.indexOf('body.dataset.agentOpen = key;');
    const shown = source.indexOf('.show()', open);
    assert(open >= 0 && shown > open, 'the key is written before the dialog is shown — never a shown dialog without one');
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

  // The Overview's "In flight" and the brief's inFlight section are the same
  // claim about the same board, and a page cannot import the API's module, so
  // the two copies are held together here instead. The rule is the label and
  // nothing else (#62): a claim says who holds an issue, never which queue it
  // is in, so a page that counted claims too would put one issue in two places.
  await test('the Overview counts in flight by the brief’s rule — the label alone', () => {
    const fs = require('fs');
    const overview = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    const briefSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'brief.js'), 'utf8');
    assert(/inFlight = issues\.filter\(\(i\) => i\.status === 'building'\)/.test(briefSrc),
      'the brief counts in flight by the building label');
    assert(/'In flight', issues\.filter\(\(issue\) => issue\.status === 'building'\)/.test(overview),
      'and the Overview cell asks exactly that');
    assert(!/claimed\(/.test(overview), `no claim predicate is called on the page, got: ${(overview.match(/.*claimed\(.*/g) || []).join(' | ')}`);
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

  await test('the frame draws Refresh and the region the status goes in, and no repo control at all', () => {
    const frame = chrome.chromeMarkup(CHROME);
    assert(frame.includes('id="tower-refresh"'), 'Refresh is in the frame');
    assert(frame.includes('data-tower-status'), 'with an empty region the status is written into');
    assert(!frame.includes('spinner-border') && !frame.includes('read 10:00:00'), 'and nothing that changes on a read');
    // The selection moved to the sidebar (#104), where the nav that carries it
    // from page to page is — the dropdown above the body is gone with it.
    assert(!frame.includes('tower-repo') && !frame.includes('<select'), 'the repo dropdown is gone');
    assert(!frame.includes('workkit'), 'and the frame names no repo at all');
  });

  await test('a read leaves the frame byte for byte the same', () => {
    // The defect: the frame was rewritten on both halves of every poll, so a
    // control open when a read started was closed by the read landing.
    const reading = { ...CHROME, pending: true, stamp: 'read 10:00:00' };
    const landed = { ...CHROME, pending: false, stamp: 'read 10:00:30' };
    assertEq(chrome.chromeMarkup(reading), chrome.chromeMarkup(landed), 'the same markup either way');
    assertEq(chrome.chromeKey(reading), chrome.chromeKey(landed), 'and the key the runtime compares says so');
  });

  await test('the key changes for the one thing the frame still shows', () => {
    assertEq(chrome.chromeKey(CHROME), chrome.chromeKey({ ...CHROME, selectedRepo: 'omega' }), 'a selection no longer touches this strip');
    const grown = { ...mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles', name: 'dotfiles' }] }), pending: false };
    assertEq(chrome.chromeKey(CHROME), chrome.chromeKey(grown), 'and neither does a repo joining the roster');
    assert(chrome.chromeKey(CHROME) !== chrome.chromeKey({ ...CHROME, tokenMode: true }), 'the Token button is what redraws it');
    assertEq(chrome.chromeKey(mkState({})), '', 'and an unread state is no key at all, never undefined');
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

  group('tower/app: scope — the selection in the URL');

  await test('a `?repo=` value parses to the set of slugs it names', () => {
    assertEq(scope.parseRepos('').length, 0, 'nothing selected is every repo');
    assertEq(scope.parseRepos(null).length, 0, 'and so is an absent parameter');
    assertEq(scope.parseRepos('workkit').join(','), 'workkit', 'one slug is one slug');
    assertEq(scope.parseRepos('workkit,omega').join('|'), 'workkit|omega', 'a comma list is the subset, in the order it names it');
    assertEq(scope.parseRepos(' workkit , omega ').join('|'), 'workkit|omega', 'whitespace around a slug is not part of it');
    assertEq(scope.parseRepos('workkit,,omega,workkit').join('|'), 'workkit|omega', 'blanks drop and a repeat counts once');
    assertEq(scope.parseRepos('ITW/workkit,Omega/omega').join('|'), 'ITW/workkit|Omega/omega', 'an owner/name slug survives whole');
  });

  await test('a set of slugs formats back to the value it was parsed from', () => {
    assertEq(scope.formatRepos([]), '', 'every repo is written as no parameter at all');
    assertEq(scope.formatRepos(['workkit']), 'workkit', 'one slug');
    assertEq(scope.formatRepos(['workkit', 'omega']), 'workkit,omega', 'and a subset is comma-separated');
    assertEq(scope.formatRepos(scope.parseRepos('workkit,omega')), 'workkit,omega', 'the round trip is the identity');
    assertEq(scope.formatRepos([' workkit ', 'workkit']), 'workkit', 'and the same cleaning applies on the way out');
  });

  await test('the predicate takes a SET — one slug, several, or none at all', () => {
    assert(scope.inScope([], 'workkit') && scope.inScope([], 'anything'), 'no selection leaves every repo in play');
    assert(scope.inScope(['workkit'], 'workkit'), 'one slug is that repo');
    assert(!scope.inScope(['workkit'], 'omega'), 'and only that repo');
    const two = scope.parseRepos('workkit,omega');
    assert(scope.inScope(two, 'workkit') && scope.inScope(two, 'omega'), 'a subset keeps every member');
    assert(!scope.inScope(two, 'dotfiles'), 'and nothing else');
  });

  await test('the runtime reads its selection through the same parse', () => {
    assertEq(scope.selectedSlugs({ selectedRepo: 'workkit,omega' }).length, 2, 'the raw query value is what state carries');
    assertEq(scope.selectedSlugs({ selectedRepo: '' }).length, 0, 'empty is every repo');
    assertEq(scope.selectedSlugs({}).length, 0, 'and so is a state with no selection on it yet');
    assertEq(scope.selectedSlugs(null).length, 0, 'null never throws');
  });

  await test('a nav link carries the selection, and only the tower’s own pages are rewritten', () => {
    assertEq(scope.scopedHref('/board', 'workkit'), '/board?repo=workkit', 'the value is set');
    assertEq(scope.scopedHref('/board?repo=omega', 'workkit'), '/board?repo=workkit', 'a link already carrying one is rewritten, not appended to');
    assertEq(scope.scopedHref('/board?repo=omega', ''), '/board', 'and an empty selection takes the parameter off');
    assertEq(scope.scopedHref('/', 'workkit,omega'), '/?repo=workkit,omega', 'a subset stays readable — the comma is not escaped');
    assertEq(scope.scopedHref('/board?api=http://127.0.0.1:8693', 'workkit'), '/board?api=http%3A%2F%2F127.0.0.1%3A8693&repo=workkit', 'another parameter is kept');
    assertEq(scope.scopedHref(scope.scopedHref('/board', 'workkit'), 'workkit'), '/board?repo=workkit', 'rewriting twice writes the same link');
    for (const href of ['/', '/board', '/crew', '/usage', '/health', '/brief', '/board/', '/board.html', '/board?repo=omega']) {
      assert(scope.isScopedPath(href), `${href} is a tower page`);
    }
    for (const href of ['/dashboard/account', '/pricing', 'https://github.com/ITW-Creative-Works/workkit', '#']) {
      assert(!scope.isScopedPath(href), `${href} is left alone`);
    }
    // The selector menu's placeholder: a hash-only href goes nowhere by design,
    // and rewriting it would turn "stay here" into a navigation to Overview.
    assert(!scope.isScopedPath('#anything'), 'a fragment is never a page');
  });

  group('tower/app: sidebar — the project selector');

  await test('an unread roster fills nothing into the menu', () => {
    assertEq(sidebar.menuMarkup(mkState({})), '', 'nothing to switch between yet — the theme’s placeholder stays');
    assertEq(sidebar.sidebarKey(mkState({})), '', 'and the key says so, never undefined');
  });

  await test('the menu is one dropdown item per repo, under All projects', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assert(markup.includes('data-tower-scope="workkit"') && markup.includes('data-tower-scope="omega"'), 'every slug is an entry');
    assert(markup.includes('data-tower-scope=""'), 'and All projects is the empty selection');
    assert(markup.includes('>All projects</button>'), 'named in words');
    assert(/data-tower-scope=""[^>]*aria-current="true"/.test(markup), 'nothing selected marks All as the one in force');
    assert(markup.includes('<button type="button" class="dropdown-item active" data-tower-scope=""'), 'in Bootstrap’s own dropdown-item shape');
  });

  await test('a selected repo is the marked item, and the subset filter is gone', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: ROSTER }, 'workkit'));
    assert(/class="dropdown-item active" data-tower-scope="workkit"/.test(markup), 'the repo in force is marked');
    assert(!/class="dropdown-item active" data-tower-scope=""/.test(markup), 'and All is not');
    assert(!markup.includes('data-tower-scope-slug'), 'one repo is not a subset, so there is nothing to filter');
  });

  await test('all-projects mode carries the checkbox subset below a divider, checked to what is in force', () => {
    const all = sidebar.menuMarkup(mkState({ repos: ROSTER }));
    assert(all.includes('<hr class="dropdown-divider"/>'), 'the filter is separated from the entries above it');
    assert(all.includes('data-tower-scope-slug="workkit"') && all.includes('data-tower-scope-slug="omega"'), 'a box per repo');
    assertEq((all.match(/ checked/g) || []).length, 2, 'no selection means every repo is in play, and every box says so');
    assert(all.includes('<label class="form-check-label classy-micro" for="tower-scope-0">workkit</label>'), 'each box carries its name, tied to it');

    const subset = sidebar.menuMarkup(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] }, 'workkit,omega'));
    assert(/class="dropdown-item active" data-tower-scope=""/.test(subset), 'All stays the active entry — a subset is the whole board, narrowed');
    assertEq((subset.match(/ checked/g) || []).length, 2, 'exactly the two the URL names');
    assert(/data-tower-scope-slug="dotfiles"(?![^>]* checked)/.test(subset), 'the repo left out is unchecked');
  });

  await test('the selector button says which of the three modes is in force', () => {
    const none = sidebar.selectorLabel(mkState({ repos: ROSTER }));
    assertEq(none.name, 'All projects', 'no selection is the whole board');
    assertEq(none.initial, 'A', 'and the tile is the name’s first character, upcased');
    assert(none.env.includes('2'), 'the second line counts the roster behind it');

    const one = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'workkit'));
    assertEq(one.name, 'workkit', 'one repo is named');
    assertEq(one.initial, 'W', 'and it is its own initial');
    assertEq(one.env, '1 of 2 repos', 'against the roster it was picked out of');

    const many = sidebar.selectorLabel(mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/x' }] }, 'workkit,omega'));
    assertEq(many.name, '2 projects', 'a subset is counted, not listed');
    assertEq(many.env, '2 of 3 repos', 'against the same roster');

    const unread = sidebar.selectorLabel(mkState({}));
    assertEq(unread.name, 'All projects', 'before the roster answers the button is not blank');
    assert(!/\d/.test(unread.env), 'and it counts nothing it has not read');

    // A shared link can name a repo the roster no longer carries. Every page
    // narrows to nothing then, and the button NAMING that slug is what explains
    // the empty board — reading "All projects" there would be a lie.
    const offRoster = sidebar.selectorLabel(mkState({ repos: ROSTER }, 'gone/away'));
    assertEq(offRoster.name, 'gone/away', 'an off-roster selection is still the selection');
    assertEq(offRoster.env, '1 of 2 repos', 'counted against the roster it is not on');
  });

  await test('the menu is rewritten for the selection and the roster, and for nothing a poll does', () => {
    const CHROME_STATE = mkState({ repos: ROSTER });
    assertEq(sidebar.sidebarKey({ ...CHROME_STATE, pending: true, stamp: 'a' }), sidebar.sidebarKey({ ...CHROME_STATE, pending: false, stamp: 'b' }),
      'a read landing is not a reason to redraw the boxes under the pointer');
    assert(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey({ ...CHROME_STATE, selectedRepo: 'omega' }), 'a new selection redraws it');
    const grown = mkState({ repos: [...ROSTER, { slug: 'dotfiles', path: '/repos/dotfiles' }] });
    assert(sidebar.sidebarKey(CHROME_STATE) !== sidebar.sidebarKey(grown), 'and so does a repo joining the roster');
  });

  await test('a hostile slug is text, in the attribute and in the label', () => {
    const markup = sidebar.menuMarkup(mkState({ repos: [{ slug: '"><img src=x>', path: '/x' }] }));
    assert(!markup.includes('<img'), 'no markup comes through the roster');
    assert(markup.includes('&quot;&gt;&lt;img src=x&gt;'), 'it is drawn as the text it is');
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

  await test('the five columns that are a status are the only ones a card moves between', () => {
    assertEq(api.MOVABLE_STATUSES.join(','), 'inbox,specced,building,blocked,parked', 'the pipeline, from the column list itself');
    assertEq(api.moveRequest(CARD, '', true), null, 'the absence of a label is not a destination — nothing on the board names it');
    assertEq(api.moveRequest({ ...CARD, status: null }, 'inbox', true), null, 'and an issue triage has not reached has no label to remove');
    assertEq(api.moveRequest(CARD, 'shipped', true), null, 'a status the pipeline does not name is not one');
  });

  await test('a drop on the column the card is already in is not a move', () => {
    assertEq(api.moveRequest(CARD, 'specced', true), null, 'nothing to write');
  });

  await test('starting work is a drop like any other — specced to building is a payload', () => {
    assertEq(JSON.stringify(api.moveRequest(CARD, 'building', true)),
      '{"repo":"ITW/workkit","number":48,"from":"specced","to":"building"}',
      'the flip that puts an issue in flight');
    assertEq(JSON.stringify(api.moveRequest({ ...CARD, status: 'building' }, 'blocked', true)),
      '{"repo":"ITW/workkit","number":48,"from":"building","to":"blocked"}',
      'and a card leaves the Building column the same way');
  });

  await test('a LOCKED copy produces no move at all — a write needs the token it has not been given', () => {
    assertEq(api.moveRequest(CARD, 'blocked', false), null, 'the gate is the payload’s, so no page can forget it');
    assertEq(api.moveRequest(CARD, 'blocked'), null, 'and the default is the module’s own mode, which is locked under these stubs');
    assertEq(api.WRITABLE, false, 'which is exactly what WRITABLE says');
    assert(!api.LIVE, 'and it is not the tower question — a published copy with a token writes too');
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

  const fs = require('fs');

  await test('the intake dialog is inert only where it has nothing to write with', () => {
    // A locked copy off this machine needs a TOKEN, not a tower — telling it
    // "live data needs a local tower" sends the one viewer who can fix it after
    // the wrong thing. An unlocked one files for real, with the same token it
    // reads with. (On localhost the tower IS the answer — the test below.)
    assert(format.LOCKED_NOTICE.includes('token'), 'the locked sentence asks for the token');
    assert(!format.LOCKED_NOTICE.includes('npm run tower'), 'and does not send a viewer to install a tower');
    assert(!/read-only/.test(format.LOCKED_NOTICE), 'and no longer calls the token read-only');
    assertEq(format.READ_ONLY_NOTICE, undefined, 'the read-only sentence is gone — nothing it described is true any more');
    const src = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/if \(!WRITABLE\)[\s\S]{0,80}disableIntake\(dialog\)/.test(src), 'only a copy that cannot write is disabled');
    assert(/lockedIntakeNotice\(location\.hostname\)/.test(src) && !/readOnlyNotice/.test(src),
      'and the sentence left is the locked one — which host it is said on is token.js’s fork (#89)');
    assert(/submitIntake\(payload\)/.test(src), 'the submit goes through the mode-aware write, never a tower URL');
    assert(/readAnyFeed\('\/api\/repos'\)/.test(src), 'and the roster is read from whichever half is talking');
  });

  await test('the write paths follow the MODE — a tower is POSTed to, a published copy writes GitHub itself', () => {
    const src = fs.readFileSync(path.join(libs, 'api.js'), 'utf8');
    assert(/WRITABLE = MODE !== 'locked'/.test(src), 'everything but a locked copy can write');
    assert(/moveIssueStatus\(move, githubContext\(\)\)[\s\S]{0,120}postJson\('\/api\/issues\/status', move\)/.test(src),
      'the drag reaches GitHub in published mode and the tower on a machine');
    assert(/createIssue\(payload, githubContext\(\)\)[\s\S]{0,80}postJson\('\/api\/intake', payload\)/.test(src),
      'and so does the intake');
  });

  group('tower/app: github — the token this browser holds');

  // A stand-in for localStorage: the two methods the module uses, and a way to
  // make a browser that refuses storage entirely.
  const mkStorage = (initial = {}, refuse = false) => {
    const held = { ...initial };
    const boom = () => { throw new Error('storage is disabled'); };
    return {
      held,
      getItem: refuse ? boom : (key) => (key in held ? held[key] : null),
      setItem: refuse ? boom : (key, value) => { held[key] = value; },
      removeItem: refuse ? boom : (key) => { delete held[key]; },
    };
  };

  await test('the token is read, written and forgotten in one place — localStorage, and nowhere else', () => {
    const storage = mkStorage();
    assertEq(github.readToken(storage), '', 'a fresh browser holds none');
    github.writeToken(storage, '  fake-token-for-tests  ');
    assertEq(storage.held[github.TOKEN_KEY], 'fake-token-for-tests', 'stored trimmed, under the one key');
    assertEq(github.readToken(storage), 'fake-token-for-tests', 'and read back');
    github.clearToken(storage);
    assertEq(github.readToken(storage), '', 'forgetting it leaves nothing behind');
    assertEq(Object.keys(storage.held).length, 0, 'not even the key');
  });

  await test('a browser that refuses storage is a viewer with no token, never a broken page', () => {
    const storage = mkStorage({}, true);
    assertEq(github.readToken(storage), '', 'the read is answered, not thrown');
    assertEq(github.writeToken(storage, 'fake-token-for-tests'), 'fake-token-for-tests', 'and the write says what it tried to store');
    assertEq(github.readToken(undefined), '', 'no storage object at all is the same answer');
  });

  await test('a browser that throws on the storage property itself still loads the page', () => {
    // The documented failure is the ACCESS, not the read: a browser told to
    // block all site data throws on `window.localStorage`. api.js touches it at
    // module load and page.js at every Token click, so an unguarded access
    // takes the whole bundle down rather than costing a token.
    const hostile = {};
    Object.defineProperty(hostile, 'localStorage', {
      get() { throw new Error('storage is disabled'); },
    });
    assertEq(github.safeStorage(hostile), null, 'the access is answered, not thrown');
    assertEq(github.readToken(github.safeStorage(hostile)), '', 'and the viewer simply holds no token');
    assertEq(github.safeStorage({}), null, 'a global with no storage at all is the same answer');
    assertEq(github.safeStorage(undefined), null, 'and so is no global');
    for (const name of ['api.js', 'page.js', 'token.js']) {
      const src = fs.readFileSync(path.join(libs, name), 'utf8');
      assert(!/window\.localStorage/.test(src), `${name} reaches for storage only through the guard`);
    }
  });

  await test('an empty value is a clear, not a stored blank', () => {
    const storage = mkStorage({ [github.TOKEN_KEY]: 'fake-token-for-tests' });
    assertEq(github.writeToken(storage, '   '), '', 'whitespace is nothing');
    assertEq(github.readToken(storage), '', 'and the old one is gone rather than left in place');
  });

  group('tower/app: github — the wire');

  /** A fetch stub: what it was called with, and what it answers. */
  const mkFetch = (answer) => {
    const calls = [];
    const fn = async (url, options) => {
      calls.push({ url, options });
      return typeof answer === 'function' ? answer(url, options) : answer;
    };
    fn.calls = calls;
    return fn;
  };
  const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  await test('with no token nothing is sent at all — the refusal comes before the request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const answer = await github.graphql('query {}', { token: '', fetch: fetchImpl });
    assertEq(answer.ok, false, 'refused');
    assertEq(fetchImpl.calls.length, 0, 'and GitHub was never reached');
    assert(/no GitHub token/.test(answer.reason), `it says which of the failures it is, got: ${answer.reason}`);
  });

  await test('the token rides as a bearer on a POST to the GraphQL endpoint', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, { data: { r0: null } }));
    await github.graphql('query { x }', { token: 'fake-token-for-tests', fetch: fetchImpl });
    const call = fetchImpl.calls[0];
    assertEq(call.url, 'https://api.github.com/graphql', 'the one URL this module writes');
    assertEq(call.options.method, 'POST', 'GraphQL is a POST');
    assertEq(call.options.headers.authorization, 'Bearer fake-token-for-tests', 'the token is the whole of the auth');
    assertEq(JSON.parse(call.options.body).query, 'query { x }', 'and the document is the body');
  });

  await test('the four ways a request fails are told apart', async () => {
    const refused = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(401, { message: 'Bad credentials' })) });
    assertEq(refused.status, 401, 'the status survives');
    assert(/refused the token/.test(refused.reason) && /Hand over one/.test(refused.reason), `it names the token and the fix, got: ${refused.reason}`);

    const forbidden = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(403, {})) });
    assert(/refused the token/.test(forbidden.reason), 'a 403 is the same story — the token does not cover these repos');

    const down = await github.graphql('q', { token: 't', fetch: mkFetch(() => { throw new Error('network down'); }) });
    assertEq(down.status, null, 'a transport failure has no status');
    assert(/did not answer/.test(down.reason), `and says so, got: ${down.reason}`);

    const empty = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(200, { errors: [{ message: 'Bad query' }] })) });
    assertEq(empty.ok, false, 'a 200 carrying only errors is not an answer');
    assertEq(empty.reason, 'Bad query', 'and GitHub’s own sentence is the reason');
  });

  await test('data AND errors together is a success — one bad repo does not blank the board', async () => {
    const answer = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { r0: {}, r1: null }, errors: [{ path: ['r1'], message: 'Could not resolve' }] })),
    });
    assertEq(answer.ok, true, 'the partial answer is kept');
    assertEq(answer.errors.length, 1, 'with the error for the caller to hang on its repo');
  });

  group('tower/app: github — the sweep is the tower’s own');

  const apiBoard = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'board.js'));
  const apiBrief = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'brief.js'));

  const SWEEP = {
    data: {
      r0: {
        issues: {
          // totalCount stays ahead of the node count so the truncation flag has
          // something to say; the blocked + specced pair keeps the brief-parity
          // comparison's nextUp non-empty rather than vacuously equal.
          totalCount: 5,
          nodes: [{
            number: 81,
            title: 'The live site works off-machine',
            url: 'https://github.com/ITW-Creative-Works/workkit/issues/81',
            body: 'the body',
            createdAt: '2026-07-29T09:00:00Z',
            updatedAt: '2026-07-29T10:00:00Z',
            comments: { totalCount: 2 },
            labels: { nodes: [{ name: 'status:building' }, { name: 'type:enhancement' }, { name: 'agent:ok' }, { name: 'area:tower' }] },
            assignees: { nodes: [{ login: 'ianwieds' }] },
          }, {
            number: 82,
            title: 'A decision is waiting',
            url: 'https://github.com/ITW-Creative-Works/workkit/issues/82',
            // Every composition branch on the item that would otherwise LEAD
            // nextUp (issue #103): an edge into a repo this sweep could not
            // read (carried, never acted on), a closed edge (satisfied,
            // nobody's payload), a native OPEN edge on an issue the sweep IS
            // carrying (what demotes it), and the same edge written inline
            // (one edge, not two). Demotion must reorder, or the parity
            // comparison is two lists agreeing vacuously.
            body: 'the question\n\nDepends on: #81\n',
            createdAt: '2026-07-28T09:00:00Z',
            updatedAt: '2026-07-28T10:00:00Z',
            comments: { totalCount: 1 },
            labels: { nodes: [{ name: 'status:blocked' }, { name: 'type:bug' }, { name: 'priority:high' }] },
            assignees: { nodes: [] },
            blockedBy: {
              nodes: [
                { number: 7, state: 'OPEN', repository: { nameWithOwner: 'owner/gone' } },
                { number: 40, state: 'CLOSED', repository: { nameWithOwner: 'ITW-Creative-Works/workkit' } },
                { number: 81, state: 'OPEN', repository: { nameWithOwner: 'ITW-Creative-Works/workkit' } },
              ],
            },
          }, {
            number: 83,
            title: 'An accepted spec sits ready',
            url: 'https://github.com/ITW-Creative-Works/workkit/issues/83',
            // The cross-org fallback as it is really written: a markdown
            // bullet around the label (#103). The edge points outside the
            // sweep, so it is carried and never acted on — this item leads
            // nextUp once #82 is demoted behind its open blocker.
            body: 'the spec\n\n- Depends on: Omega-JS-Stack/omega#144\n',
            createdAt: '2026-07-27T09:00:00Z',
            updatedAt: '2026-07-27T10:00:00Z',
            comments: { totalCount: 0 },
            labels: { nodes: [{ name: 'status:specced' }, { name: 'type:enhancement' }] },
            assignees: { nodes: [] },
            blockedBy: { nodes: [] },
          }],
        },
        // What the day CLOSED (issue #55) — two inside the 24-hour window and
        // two outside it, so every comparison over this fixture is made against
        // a real number rather than against two zeros that would agree whatever
        // either side counted.
        closed: {
          nodes: [
            { closedAt: '2026-07-29T08:00:00Z' },
            { closedAt: '2026-07-28T12:00:00Z' },
            { closedAt: '2026-07-28T10:59:00Z' },
            { closedAt: null },
          ],
        },
      },
      r1: null,
    },
    errors: [{ path: ['r1'], message: 'Could not resolve to a Repository' }],
  };
  const SLUGS = ['ITW-Creative-Works/workkit', 'owner/gone'];

  // The instant both sides measure that window back from. Stated rather than
  // read off the clock: a day judged at whatever moment the suite runs is a
  // window no fixture can sit either side of.
  const CLOSED_NOW = Date.parse('2026-07-29T11:00:00Z');

  await test('the browser writes the same GraphQL document the tower does, byte for byte', () => {
    assertEq(
      github.buildBoardQuery(SLUGS),
      apiBoard.buildQuery(SLUGS.map((slug) => slug.split('/'))),
      'the two halves of the same sweep cannot ask different questions',
    );
    assert(github.buildBoardQuery(SLUGS).includes('blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }'),
      'and both of them ask what an issue is blocked by (#103), the blocker’s state included');
  });

  await test('the browser normalizes an answer into exactly what /api/board serves', () => {
    const exec = (cmd, args) => {
      if (args[0] === '--version') return 'gh version 2';
      return JSON.stringify(SWEEP);
    };
    const fromTower = apiBoard.fetchBoard(SLUGS.map((slug) => ({ slug })), { exec, now: CLOSED_NOW });
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(JSON.stringify(fromBrowser), JSON.stringify(fromTower), 'one payload shape, whichever side read it');
    assertEq(fromBrowser.issues[0].status, 'building', 'the label vocabulary is parsed the same way');
    assertEq(fromBrowser.issues[0].agentOk, true, 'agent:ok included');
    assert(fromBrowser.repos[0].truncated, 'a repo over the page cap says so');
    assertEq(fromBrowser.repos[1].error, 'Could not resolve to a Repository', 'and the unresolved repo carries its reason');
  });

  await test('what an issue waits on is composed the same way on both sides', () => {
    // The fixture exercises every branch of that composition, so the JSON
    // comparison above is a real proof rather than two empty lists agreeing.
    const keys = (issue) => issue.blockedBy.map((blocker) => `${blocker.repo}#${blocker.number}`).join(',');
    const fromTower = apiBoard.fetchBoard(SLUGS.map((slug) => ({ slug })), {
      exec: (cmd, args) => (args[0] === '--version' ? 'gh version 2' : JSON.stringify(SWEEP)),
      now: CLOSED_NOW,
    });
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(fromBrowser.issues[0].blockedBy.length, 0, 'an issue depending on nothing carries the empty list');
    assertEq(keys(fromBrowser.issues[1]), 'owner/gone#7,ITW-Creative-Works/workkit#81',
      'the unreadable-repo edge is carried whole, the closed one is satisfied, and the edge written both ways is one edge');
    assertEq(keys(fromBrowser.issues[2]), 'Omega-JS-Stack/omega#144',
      'a bulleted Depends on: line is the same line — issue bodies are markdown');
    assertEq(keys(fromBrowser.issues[1]), keys(fromTower.issues[1]), 'and the tower reads it identically');
    assertEq(keys(fromBrowser.issues[2]), keys(fromTower.issues[2]), 'on every issue');
  });

  await test('the day’s closed count is the same number on both sides, and no closed issue enters the board', () => {
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(fromBrowser.repos[0].closedDay, 2, 'two of the four closed inside the last 24 hours');
    assertEq(github.closedSince(SWEEP.data.r0, CLOSED_NOW), apiBoard.closedSince(SWEEP.data.r0, CLOSED_NOW),
      'and the browser counts them exactly as the tower does');
    assertEq(fromBrowser.repos[1].closedDay, 0, 'a repo that did not resolve closed nothing');
    assertEq(fromBrowser.issues.length, 3, 'the issue list is the OPEN board and nothing else');
    assert(fromBrowser.issues.every((issue) => issue.status !== undefined), 'no closed issue rode in on the count');
  });

  await test('a closed issue one minute past the window is not this day’s', () => {
    // The edge is stated on both sides of it rather than computed: 23h59 in,
    // 24h01 out, at an instant this suite names.
    const one = (closedAt) => github.normalizeBoard(['o/r'], { r0: { issues: { totalCount: 0, nodes: [] }, closed: { nodes: [{ closedAt }] } } }, [], CLOSED_NOW).repos[0].closedDay;
    assertEq(one('2026-07-28T11:01:00Z'), 1, '23 hours 59 minutes ago counts');
    assertEq(one('2026-07-28T10:59:00Z'), 0, '24 hours 1 minute ago does not');
    assertEq(one('2026-07-30T11:00:00Z'), 0, 'and neither does a stamp from the future');
    assertEq(one('not a date'), 0, 'nor one that is not a stamp');
  });

  await test('the label groups the browser knows are the vocabulary’s own', () => {
    const groups = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workflow', 'labels.json'), 'utf8')).groups);
    assertEq([...github.LABEL_GROUPS].sort().join(','), groups.sort().join(','),
      'a group defined in the SSOT and missing here would be a group the published board cannot show');
  });

  await test('a body over the limit is cut and flagged, the same as the tower’s', () => {
    const long = { data: { r0: { issues: { totalCount: 1, nodes: [{ number: 1, body: 'x'.repeat(5000), labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 0 } }] } } } };
    const issue = github.normalizeBoard(['o/r'], long.data, []).issues[0];
    assertEq(issue.body.length, 4000, 'cut at the same 4,000 characters');
    assertEq(issue.bodyTruncated, true, 'and never cut silently');
  });

  await test('an empty roster is an empty board, not a request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const board = await github.fetchBoard([], { token: 't', fetch: fetchImpl });
    assertEq(board.ok, true, 'a site that sweeps nothing is not a failure');
    assertEq(fetchImpl.calls.length, 0, 'and nothing went out');
  });

  group('tower/app: github — the roster, the brief and the summaries');

  await test('the baked list is names only, and junk in it is dropped', () => {
    const parsed = github.parseSlugs({ repos: ['owner/workkit', 'nope', 42, null], home: 'owner/workkit' });
    assertEq(parsed.repos.map((repo) => repo.slug).join(','), 'owner/workkit', 'only what is shaped like a slug');
    assertEq(parsed.repos[0].name, 'workkit', 'named the way the roster names a repo');
    assertEq(parsed.repos[0].path, '', 'with no path — a published copy has no machine under it');
    assertEq(parsed.home, 'owner/workkit', 'and the home repo is named');
    assertEq(github.parseSlugs(null).home, '', 'nothing at all parses to nothing, never undefined');
  });

  await test('a home repo carrying no roster says so rather than showing an empty board', async () => {
    // The list is on the home repo now (issue #110), so this is the read that
    // can come back empty: a home that has never been published from.
    const answer = await github.fetchSlugs({
      token: 't',
      fetch: mkFetch((url) => (url === 'data/home.json'
        ? jsonResponse(200, { home: 'owner/workkit' })
        : { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })),
    });
    assertEq(answer.ok, false, 'a missing list is a failure to report');
    assert(/404/.test(answer.reason) && /Not Found/.test(answer.reason), `and GitHub’s own sentence survives, got: ${answer.reason}`);
  });

  await test('the roster is never read without a token — the list is private', async () => {
    const fetchImpl = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.fetchSlugs({ token: '', fetch: fetchImpl });
    assertEq(answer.ok, false, 'there is nothing to read it with');
    assert(/no GitHub token/.test(answer.reason), `the refusal is the one the prompt answers, got: ${answer.reason}`);
    assertEq(fetchImpl.calls.length, 1, 'and the unauthenticated read stopped at the public pointer');
  });

  await test('the brief the browser builds is the brief the tower builds', () => {
    const board = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    const stamp = '2026-07-29T11:00:00Z';
    const mine = github.buildBrief(board, { generatedAt: stamp });
    const theirs = apiBrief.buildBrief(board, {}, [], stamp);
    // `summaries` and `history` are ATTACHED after the build on the tower's
    // side (server.js) and inside it here, so they are the two keys the
    // comparison lifts out — everything buildBrief itself decides is compared.
    assertEq(JSON.stringify({ ...mine, summaries: undefined, history: undefined }), JSON.stringify(theirs),
      'the same sections, the same order, the same headline');
    assertEq(mine.nextUp[0].items.map((i) => i.number).join(','), '83,82',
      'the blocked item would lead on status, so this order EXISTS only because demotion ran — on both sides');
    assertEq(mine.nextUp[0].items[1].waitsOn.join(','), 'ITW-Creative-Works/workkit#81',
      'the item waiting on an issue the sweep is carrying says so (#103)');
    assertEq(mine.nextUp[0].items[0].waitsOn.length, 0,
      'and an edge into a repo the sweep could not read claims nothing');
    assertEq(mine.closedDay, 2, 'the day’s closed count rides the payload, roster wide');
    assertEq(mine.repoCounts[0].open, 5, 'and each repo’s open count is its totalCount, cap or no cap');
    assertEq(mine.warnings.length, 0, 'the one section a browser cannot answer is empty rather than invented');
  });

  await test('the history the browser parses is the history the tower parses', async () => {
    // The same published briefs, read by both halves: the tower through `gh`,
    // the browser through GraphQL. A drift in either parse would leave one
    // surface drawing a chart the other cannot.
    const fs = require('fs');
    const os = require('os');
    const apiHistory = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));
    const mark = (date, open, closedDay) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":${open},"waiting":1,"ready":2,"inFlight":0,"inbox":3,"parked":0},"closedDay":${closedDay},"repos":{"owner/repo":{"open":${open}}}} -->`;
    const nodes = [
      { title: 'brief: 2026-08-03', body: `HEADLINE: today.\n\n<!-- cc-news: 2.1.220 -->\n${mark('2026-08-03', 12, 4)}\n` },
      { title: 'daily: 2026-08-03', body: `a summary, not a brief\n${mark('2026-08-03', 99, 9)}\n` },
      { title: 'brief: 2026-08-02', body: 'HEADLINE: a morning before the block existed.\n' },
      { title: 'brief: 2026-08-01', body: `HEADLINE: two days ago.\n${mark('2026-08-01', 15, 0)}\n` },
    ];

    const mine = github.normalizeHistory({ repository: { discussions: { nodes } } });
    assertEq(mine.map((entry) => entry.date).join(','), '2026-08-01,2026-08-03', 'ascending, and the block-less morning is skipped');
    assertEq(mine[1].totals.open, 12, 'the totals are read off the line');
    assertEq(mine[1].closedDay, 4, 'and what the day closed');

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-history-'));
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiHistory.briefHistory({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    });
    fs.rmSync(home, { recursive: true, force: true });
    assertEq(JSON.stringify(mine), JSON.stringify(theirs), 'one series, whichever side read it');

    // And the read the browser makes asks for the body the line lives in — the
    // summaries query does not, which is why this is a second document.
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchHistory('owner/private-home', { token: 't', fetch: fetchImpl });
    assert(JSON.parse(fetchImpl.calls[0].options.body).query.includes('nodes { title body }'), 'the history read asks for the body');
    assertEq(answer.length, 2, 'and it comes back parsed');
  });

  await test('a history that could not be read is null, never an empty series', async () => {
    // The two say opposite things: nothing published yet is a board with no
    // history, and a refused read is a history nobody can see.
    assertEq(await github.fetchHistory('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) }), null,
      'a site published without a home repo has nowhere to read from');
    assertEq(await github.fetchHistory('owner/workkit', { token: '', fetch: mkFetch(() => { throw new Error('a request was made'); }) }), null,
      'and a browser with no token cannot ask');
    const empty = await github.fetchHistory('owner/workkit', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes: [] } } } })),
    });
    assertEq(empty.length, 0, 'a home repo with no published briefs yet is an empty series, not a failure');
  });

  await test('the browser sorts the queues by the brief’s rule, to the letter', () => {
    const sectionsOf = (source) => (source.match(/const (?:ready|inFlight) = issues\.filter\(\(i\) => i\.status === '\w+'\)/g) || []).join(' | ');
    const briefSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'brief.js'), 'utf8');
    const mine = fs.readFileSync(path.join(libs, 'github.js'), 'utf8');
    assertEq(sectionsOf(briefSrc).split(' | ').length, 2, 'the brief sorts both queues by the status label');
    assertEq(sectionsOf(mine), sectionsOf(briefSrc), 'and the published brief reads the same two expressions');
    assert(!/claimed\(/.test(mine), `no claim predicate is called in the browser's copy either, got: ${(mine.match(/.*claimed\(.*/g) || []).join(' | ')}`);
  });

  await test('a site with no home repo has nowhere to read summaries from, and says so', async () => {
    const answer = await github.fetchSummaries('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    assertEq(answer.ok, false, 'not a failure of the read — a fact about the publish');
    assert(/without a home repo/.test(answer.reason), `named as such, got: ${answer.reason}`);
    assertEq(answer.items.length, 0, 'and no items');
  });

  await test('the summaries are the home repo’s latest Discussions', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, {
      data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'https://github.com/owner/workkit/discussions/4', createdAt: '2026-07-28T09:00:00Z', category: { name: 'Summaries' } }, null] } } },
    }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    assert(JSON.parse(fetchImpl.calls[0].options.body).query.includes('repository(owner: "owner", name: "workkit")'), 'it asks the home repo');
    assertEq(answer.items.length, 1, 'a null node is not a summary');
    assertEq(answer.items[0].category, 'Summaries', 'the category rides along');
  });

  await test('the morning briefs sharing the board are not summaries', async () => {
    // The 9am job publishes its digest as a `brief: <date>` Discussion on the
    // same repo, about one a day. Left in, they fill the card the summaries own.
    const node = (title, i) => ({ title, url: `https://github.com/owner/workkit/discussions/${i}`, createdAt: '2026-07-28T09:00:00Z', category: { name: 'General' } });
    const nodes = [];
    for (let i = 0; i < 7; i++) nodes.push(node(`brief: 2026-07-${20 + i}`, i * 2), node(`daily: 2026-07-${20 + i}`, i * 2 + 1));
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    assertEq(answer.items.length, 5, 'the card still fills, five summaries deep');
    assert(answer.items.every((item) => /^daily: /.test(item.title)), `and every one of them is a summary: ${answer.items.map((i) => i.title).join(', ')}`);
    const asked = Number((JSON.parse(fetchImpl.calls[0].options.body).query.match(/discussions\(first: (\d+)/) || [])[1]);
    assert(asked > 5, `the read window is wide enough to filter from, got ${asked}`);
  });

  group('tower/app: github — the one door');

  /** Where the roster is read from: the home repo's default branch, through the API. */
  const ROSTER_URL = 'https://api.github.com/repos/owner/workkit/contents/data/repos.json?ref=main';

  /** Whether a URL is the roster read — the one call the private list costs. */
  const isRoster = (url) => url.startsWith('https://api.github.com/') && url.includes('contents/data/repos.json');

  /**
   * A fetch that answers the home pointer from the site, the roster from the
   * home repo, and everything else from GraphQL — the three reads a published
   * page makes (issue #110).
   */
  const mkSiteFetch = (list, graphqlBody) => mkFetch((url) => {
    if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
    if (isRoster(url)) return jsonResponse(200, list);
    return jsonResponse(200, graphqlBody);
  });

  await test('the roster feed is the private list, read from the home repo with the viewer’s token', async () => {
    // Issue #110: the site publishes only which repo is the home. The list of
    // repositories is on that repo's default branch, and reading it is an
    // authenticated call — nothing about the board's coverage is public.
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' }, {});
    const answer = await github.readFeed('/api/repos', { token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data[0].slug, 'owner/workkit', 'the roster, in the shape every page reads');
    assertEq(fetchImpl.calls.length, 2, 'the pointer and the list, and no GraphQL at all');
    assertEq(fetchImpl.calls[0].url, 'data/home.json', 'the only file published beside the pages');
    assert(!fetchImpl.calls[0].options.headers.authorization, 'read unauthenticated — it says what the site’s own URL says');
    assertEq(fetchImpl.calls[1].url, ROSTER_URL,
      'and the list from the home repo’s default branch — `main` here, which is what a pointer naming no branch falls back to (issue #112)');
    assertEq(fetchImpl.calls[1].options.headers.authorization, 'Bearer fake-token-for-tests', 'with the viewer’s token, because the list is private');
    assertEq(fetchImpl.calls[1].options.headers.accept, 'application/vnd.github.raw+json', 'asked for raw, so the answer is the file itself');
    assert(!fetchImpl.calls.some((call) => call.url === 'data/repos.json'), 'and never from the published site');
  });

  await test('the roster is read from the branch the pointer names, never an assumed main', async () => {
    // Issue #112: the publish pushes whatever branch the home clone is on and
    // says so in data/home.json. A home repo whose default branch is not `main`
    // answered 404 to every roster read while this was hardcoded, and the board
    // degraded to nothing without a word about why.
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit', branch: 'trunk' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, {});
    });
    const answer = await github.fetchSlugs({ token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'the list is read');
    assertEq(fetchImpl.calls[1].url, 'https://api.github.com/repos/owner/workkit/contents/data/repos.json?ref=trunk',
      'from the branch the publish wrote it to');
  });

  await test('the board feed is a live sweep with the viewer’s token', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['ITW-Creative-Works/workkit'], home: '' }, { data: SWEEP.data });
    const answer = await github.readFeed('/api/board', { token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.issues[0].number, 81, 'with the issues GitHub just returned');
    assertEq(fetchImpl.calls[2].options.headers.authorization, 'Bearer fake-token-for-tests', 'unlocked by the token and nothing else');
  });

  await test('a site published without its home pointer says so, and reaches GitHub not at all', async () => {
    const missing = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(404, {})
      : jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.readFeed('/api/board', { token: 't', fetch: missing });
    assertEq(answer.ok, false, 'there is nowhere to read the roster from');
    assert(/without its home repo/.test(answer.reason), `and it says which half is missing, got: ${answer.reason}`);
    assertEq(missing.calls.length, 1, 'nothing was asked of GitHub');
  });

  await test('the brief feed is that sweep plus the summaries', async () => {
    const fetchImpl = mkFetch((url, options) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['ITW-Creative-Works/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, JSON.parse(options.body).query.includes('discussions')
        ? { data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'u', createdAt: '2026-07-28T09:00:00Z', category: null }] } } } }
        : { data: SWEEP.data });
    });
    const answer = await github.readFeed('/api/brief', { token: 't', fetch: fetchImpl, generatedAt: '2026-07-29T11:00:00Z' });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.counts.inFlight, 1, 'the sections are built from the sweep');
    assertEq(answer.data.summaries.items[0].title, 'Tuesday', 'and the summaries ride with it');
  });

  await test('a failed sweep is a failed feed, never an empty board', async () => {
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: '' });
      return jsonResponse(401, { message: 'Bad credentials' });
    });
    const answer = await github.readFeed('/api/board', { token: 'stale', fetch: fetchImpl });
    assertEq(answer.ok, false, 'the page shows the reason, not six confident zeros');
    assert(/refused the token/.test(answer.reason), `and the reason is the token, got: ${answer.reason}`);
  });

  await test('a refused token survives the read as a refusal, not as a generic failure', async () => {
    // The status is what the runtime acts on: a token GitHub refused is the one
    // failure a new token fixes, so the page answers it with the prompt. It has
    // to reach the feed result to be acted on at all.
    const refuse = (status) => mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(status, { message: 'Bad credentials' });
    });
    for (const feedPath of ['/api/board', '/api/brief']) {
      const answer = await github.readFeed(feedPath, { token: 'expired', fetch: refuse(401) });
      assertEq(answer.status, 401, `${feedPath} carries the status GitHub refused it with`);
      assert(github.isTokenRefusal(answer), `and ${feedPath} reads as a token refusal`);
    }
    assert(github.isTokenRefusal(await github.readFeed('/api/board', { token: 'narrow', fetch: refuse(403) })), 'a 403 is the same answer — the token does not cover these repos');
    const down = await github.readFeed('/api/board', { token: 't', fetch: refuse(500) });
    assert(!github.isTokenRefusal(down), 'a server failure is not the token’s fault and must not ask for a new one');
    assert(!github.isTokenRefusal({ ok: true, status: 200 }), 'and neither is a read that worked');

    // The roster read is the FIRST thing the token is asked for (issue #110), so
    // a token that cannot see the home repo has to reach the prompt too — not
    // read as a site published without a list.
    const blindRoster = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unread = await github.readFeed('/api/board', { token: 'no-contents', fetch: blindRoster });
    assert(github.isTokenRefusal(unread), `a token that cannot read the roster is a token refusal, got: ${unread.reason}`);
  });

  await test('the refusal names the fix that exists — there is no form under it', async () => {
    const answer = await github.graphql('query {}', {
      token: 'expired',
      fetch: async () => jsonResponse(401, { message: 'Bad credentials' }),
    });
    assert(!/below/.test(answer.reason), `the sentence points at no control beneath it, got: ${answer.reason}`);
    assert(/Hand over one that does/.test(answer.reason), 'it asks for a token that covers the repositories');
  });

  await test('a machine-bound feed asked of the published side is answered as one', async () => {
    const fetchImpl = mkSiteFetch({ repos: [], home: '' }, {});
    const answer = await github.readFeed('/api/telemetry', { token: 't', fetch: fetchImpl });
    assertEq(answer.ok, false, 'a published copy cannot read this machine');
    assert(/published copy can read/.test(answer.reason), `and says so, got: ${answer.reason}`);
  });

  group('tower/app: github — the two writes');

  // The tower's own source is the reference for both writes: the published site
  // must relabel and file exactly what the endpoint on the machine does, and
  // the two live on opposite sides of the copy boundary (issue #77).
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'api', 'server.js'), 'utf8');

  await test('the browser writes the endpoint’s own move — the old status off, the new one on, nothing else touched', () => {
    assertEq(
      github.nextLabels([{ name: 'status:specced' }, { name: 'type:enhancement' }, { name: 'priority:high' }], 'specced', 'building').join(','),
      'type:enhancement,priority:high,status:building',
      'every label that is not the status survives the move',
    );
    assertEq(github.nextLabels(['status:building'], 'building', 'blocked').join(','), 'status:blocked', 'the one status is replaced, never doubled');
    assertEq(github.nextLabels(['type:bug', 'status:blocked'], 'building', 'blocked').join(','), 'type:bug,status:blocked', 'a destination already carried is not added twice');
    assertEq(github.nextLabels(null, 'specced', 'building').join(','), 'status:building', 'an issue answering with no labels still lands on its column');
    // The semantics are the endpoint's, and this is where the two are held together.
    assert(/--remove-label', `status:\$\{checked\.from\}`/.test(serverSrc), 'the tower removes the from label');
    assert(/--add-label', `status:\$\{checked\.to\}`/.test(serverSrc), 'and adds the to label, in one call');
  });

  await test('a move is one PATCH of the issue, with the viewer’s token as the whole of the auth', async () => {
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : jsonResponse(200, { number: 48, labels: [{ name: 'status:specced' }, { name: 'type:enhancement' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'ITW/workkit', number: 48, from: 'specced', to: 'building',
    }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    assertEq(fetchImpl.calls.length, 2, 'the labels the issue carries now, then the one write');
    assertEq(fetchImpl.calls[0].url, 'https://api.github.com/repos/ITW/workkit/issues/48', 'read from the issue itself — the board’s copy is up to a minute old');
    assertEq(fetchImpl.calls[0].options.method, 'GET', 'a read');
    assertEq(fetchImpl.calls[1].url, 'https://api.github.com/repos/ITW/workkit/issues/48', 'and the write is the same resource');
    assertEq(fetchImpl.calls[1].options.method, 'PATCH', 'one call, so the issue is never unlabelled nor twice-labelled');
    assertEq(fetchImpl.calls[1].options.headers.authorization, 'Bearer fake-token-for-tests', 'the token is the whole of the auth');
    assertEq(JSON.parse(fetchImpl.calls[1].options.body).labels.join(','), 'type:enhancement,status:building', 'carrying the set the move leaves behind');
    assertEq(answer.ok, true, 'and the answer is the tower’s own result shape');
    assertEq(answer.data.status, 'building', 'naming where the card landed');
  });

  await test('a write with no token reaches GitHub not at all', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const move = await github.moveIssueStatus({ repo: 'o/r', number: 1, from: 'inbox', to: 'specced' }, { token: '', fetch: fetchImpl });
    const filed = await github.createIssue({ repo: 'o/r', title: 'x' }, { token: '', fetch: fetchImpl });
    assertEq(fetchImpl.calls.length, 0, 'neither write left the browser');
    assert(/no GitHub token/.test(move.reason), `the move says which failure it is, got: ${move.reason}`);
    assert(/no GitHub token/.test(filed.reason), `and so does the filing, got: ${filed.reason}`);
  });

  await test('a token that can only read is told so in words, and reads as a refusal', async () => {
    // A read-only token gets through the move's READ and is refused on its write.
    const forbidden = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'read-only', fetch: forbidden });
    assertEq(answer.ok, false, 'the move did not land');
    assert(/write/i.test(answer.reason) && /Issues: Read and write/.test(answer.reason),
      `the viewer is told their token lacks write access and what to make instead, got: ${answer.reason}`);
    assert(github.isTokenRefusal(answer), 'and a refused write is a token refusal like a refused read');

    const expired = await github.createIssue({ repo: 'owner/workkit', title: 'x' }, {
      token: 'expired',
      fetch: mkFetch((url) => {
        if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
        if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
        return jsonResponse(401, { message: 'Bad credentials' });
      }),
    });
    assert(/expired/.test(expired.reason), `a 401 is the other story — the token itself, got: ${expired.reason}`);
    assert(github.isTokenRefusal(expired), 'which the runtime answers with the prompt');
  });

  await test('a move GitHub would not accept leaves the board’s card where it was, with the reason', async () => {
    const gone = await github.moveIssueStatus({ repo: 'o/r', number: 9, from: 'inbox', to: 'specced' }, {
      token: 't', fetch: mkFetch(jsonResponse(404, { message: 'Not Found' })),
    });
    assertEq(gone.ok, false, 'the read of the issue failed, so nothing was written');
    assert(/404/.test(gone.reason) && /Not Found/.test(gone.reason), `GitHub’s own sentence survives, got: ${gone.reason}`);
  });

  await test('a refused read is told in read words, and a refused write in write words', async () => {
    const blindRead = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 1 })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unseen = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'wrong-repos', fetch: blindRead });
    assertEq(blindRead.calls.length, 1, 'a move that cannot read the issue never reaches the write');
    assert(/read/i.test(unseen.reason) && !/Issues: Read and write/.test(unseen.reason),
      `a token that cannot SEE the repository is not sent after write access, got: ${unseen.reason}`);

    const blindWrite = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(403, { message: 'Resource not accessible by personal access token' })
      : jsonResponse(200, { number: 1, labels: [{ name: 'status:inbox' }] })));
    const refused = await github.moveIssueStatus({
      repo: 'o/r', number: 1, from: 'inbox', to: 'specced',
    }, { token: 'read-only', fetch: blindWrite });
    assert(/Issues: Read and write/.test(refused.reason), `and the write leg names the permission it wants, got: ${refused.reason}`);
  });

  await test('a read that answers without labels is not a base to write from', async () => {
    // 200 with a body that will not parse: `rest` answers ok with null data, and
    // relabelling off nothing would PATCH away every label the issue carries.
    const fetchImpl = mkFetch((url, options) => ((options && options.method) === 'PATCH'
      ? jsonResponse(200, { number: 48 })
      : { ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); } }));
    const answer = await github.moveIssueStatus({
      repo: 'o/r', number: 48, from: 'specced', to: 'building',
    }, { token: 't', fetch: fetchImpl });
    assertEq(fetchImpl.calls.length, 1, 'the read happened and the write did not');
    assertEq(answer.ok, false, 'and the move says it did not land');
    assert(/labels/.test(answer.reason) && /nothing was changed/.test(answer.reason),
      `the viewer is told what was missing and that the issue is untouched, got: ${answer.reason}`);
  });

  await test('a move refuses what the endpoint refuses, before anything is read', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const refuse = async (move) => github.moveIssueStatus(move, { token: 't', fetch: fetchImpl });
    const ok = { repo: 'o/r', number: 1, from: 'inbox', to: 'specced' };

    assert(/nothing to move/.test((await refuse(null)).reason), 'no move at all');
    assert(/positive integer/.test((await refuse({ ...ok, number: '1' })).reason), 'a number that is not one');
    assert(/positive integer/.test((await refuse({ ...ok, number: 0 })).reason), 'and one that is not positive');
    assert(/not a repository slug: r/.test((await refuse({ ...ok, repo: 'r' })).reason), 'a repo that is not a slug');
    assert(/from is not a status: nowhere/.test((await refuse({ ...ok, from: 'nowhere' })).reason), 'a status the vocabulary does not define');
    assert(/to is not a status: \(none\)/.test((await refuse({ ...ok, to: '' })).reason), 'and a destination that is blank');
    assert(/already status:inbox/.test((await refuse({ ...ok, to: 'inbox' })).reason), 'a move to where the issue already is');
    assertEq(fetchImpl.calls.length, 0, 'and every refusal came before GitHub was read at all');

    // The rules restated across the copy boundary, pinned to the endpoint that owns them.
    const statuses = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workflow', 'labels.json'), 'utf8')).groups.status.values);
    assertEq(github.MOVE_STATUSES.slice().sort().join(','), statuses.sort().join(','), 'the statuses a move may name are the vocabulary’s own');
    assert(serverSrc.includes('issue number must be a positive integer'), 'the number rule is the endpoint’s');
    assert(serverSrc.includes('not a repository slug:'), 'the slug rule is the endpoint’s');
    assert(serverSrc.includes('the issue is already status:'), 'and so is the refusal of a move that is not one');
  });

  await test('intake files the issue the endpoint files — same labels, same default body', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const answer = await github.createIssue({ repo: 'OWNER/Workkit', title: '  a thought  ', body: '' }, { token: 'fake-token-for-tests', fetch: fetchImpl });

    const call = fetchImpl.calls[2];
    assertEq(call.url, 'https://api.github.com/repos/owner/workkit/issues', 'filed under the ROSTER’s spelling, as the endpoint does');
    assertEq(call.options.method, 'POST', 'a create');
    assertEq(call.options.headers.authorization, 'Bearer fake-token-for-tests', 'with the viewer’s token');
    const sent = JSON.parse(call.options.body);
    assertEq(sent.title, 'a thought', 'the title, trimmed');
    assertEq(sent.body, github.DEFAULT_BODY, 'and the endpoint’s own default where a body was not typed');
    assertEq(sent.labels.join(','), 'status:inbox,type:idea', 'captured, and typed as an idea until triage says otherwise');
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.url, 'https://github.com/owner/workkit/issues/12', 'and the dialog gets the URL to link');

    // The rules restated across the copy boundary, pinned to the endpoint that owns them.
    assert(serverSrc.includes(`const DEFAULT_BODY = '${github.DEFAULT_BODY}'`), 'the default body is the endpoint’s');
    assert(serverSrc.includes(`const TITLE_MAX = ${github.TITLE_MAX}`), 'the title cap is the endpoint’s');
    assert(serverSrc.includes(`const BODY_MAX = ${github.BODY_MAX}`), 'the body cap is the endpoint’s');
    for (const label of github.INTAKE_LABELS) assert(serverSrc.includes(`'--label', '${label}'`), `${label} is what the endpoint files with`);
  });

  await test('intake refuses what the endpoint refuses, before anything is filed', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' },
      { html_url: 'https://github.com/owner/workkit/issues/12' });
    const refuse = async (payload) => github.createIssue(payload, { token: 't', fetch: fetchImpl });

    assert(/unknown repo: owner\/other/.test((await refuse({ repo: 'owner/other', title: 'x' })).reason), 'a repo this site does not sweep');
    assert(/title is required/.test((await refuse({ repo: 'owner/workkit', title: '   ' })).reason), 'a blank title');
    assert(/longer than 256/.test((await refuse({ repo: 'owner/workkit', title: 'x'.repeat(257) })).reason), 'a title past the cap');
    assert(/longer than 4000/.test((await refuse({ repo: 'owner/workkit', title: 'x', body: 'b'.repeat(4001) })).reason), 'a body past it');
    assert(fetchImpl.calls.every((call) => call.url === 'data/home.json' || isRoster(call.url)),
      'and every refusal came before GitHub was written to');
  });

  group('tower/app: api — the three modes');

  await test('a tower outranks everything, and the token decides the rest', () => {
    assertEq(api.decideMode('development', '', false), 'tower', 'a dev build reads the machine’s API');
    assertEq(api.decideMode('production', 'http://box:8693', false), 'tower', 'and so does any build pointed at one');
    assertEq(api.decideMode('production', '', true), 'github', 'a published copy with a token reads GitHub itself');
    assertEq(api.decideMode('production', '', false), 'locked', 'and without one it has nothing to show but the prompt');
    assertEq(api.MODE, 'locked', 'which is what the module itself decided under the stubs above');
    assertEq(api.LIVE, false, 'LIVE stays the question of a TOWER — WRITABLE is the flag every write gates on');
  });

  await test('a published page arms only the feeds GitHub can answer', () => {
    const feeds = api.githubPageFeeds(['repos', 'board', 'sessions', 'health', 'telemetry']);
    assertEq(Object.keys(feeds).join(','), 'repos,board', 'the machine-bound three are simply absent');
    assertEq(feeds.board.every, 60000, 'and the sweep keeps the board’s cadence — a GraphQL sweep is expensive');
    assertEq(Object.keys(api.githubPageFeeds(['brief'])).join(','), 'brief', 'the brief is one of the three it can');
  });

  group('tower/app: token — the prompt that unlocks a published copy');

  await test('the prompt says what to make, links where to make it, and hides what is typed', () => {
    const markup = token.tokenPrompt();
    assert(markup.includes(`href="${github.TOKEN_URL}"`), 'the creation page is one click away');
    assert(markup.includes('Issues: Read and write'), 'it names the permissions, and the board moves cards, so writing issues is one');
    assert(markup.includes('Contents: Read'), 'and the one read that is not an issue: the private roster on the home repo (issue #110)');
    assert(!/admin|workflow/i.test(markup), 'and asks for nothing beyond that');
    assert(markup.includes('type="password"'), 'the field does not display the token');
    assert(markup.includes('localStorage'), 'and it says where the token is kept');
    assert(!token.tokenPrompt().includes('data-token-problem'), 'a first visit is not an error state');
    assert(token.tokenPrompt('the token was refused').includes('the token was refused'), 'and a refusal is shown when there is one');
  });

  await test('a locked copy on this machine is told the tower is down, and is never asked for a token', () => {
    // The bug (#89): a locked page served from localhost asked for a GitHub
    // token, which a local dashboard has no use for — the tower API holds the
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
      'which is api.js’s own default — the two copies of the origin cannot drift apart');
    assertEq(url.searchParams.get('repo'), 'ITW/workkit', 'and every other parameter survives');
    assertEq(url.pathname, '/board', 'on the page the viewer was already looking at');
    assertEq(new URL(token.connectHref('http://localhost:4300/?api=http://box:8693')).searchParams.getAll('api').length, 1,
      'an api already in the URL is replaced, never doubled');
    assert(token.towerDownNotice('http://localhost:4300/board?repo=ITW/workkit').includes(`href="${format.esc(href)}"`),
      'and the notice links to exactly that URL');
    assertEq(api.decideMode('production', 'http://127.0.0.1:8693', false), 'tower',
      'which is the override that unlocks the page — the advice resolves the state it appears in');
  });

  await test('the intake dialog tells the same story the body does, forked on the same predicate', () => {
    assertEq(token.lockedIntakeNotice('localhost'), format.localLockedNotice(), 'on this machine it asks for the tower');
    assert(format.LOCAL_LOCKED_NOTICE.includes('npm run tower'), 'in the same words, and no token among them');
    assert(!/token/i.test(format.LOCAL_LOCKED_NOTICE), 'a local dialog never asks for one');
    assertEq(token.lockedIntakeNotice('ianwieds.github.io'), format.lockedNotice(), 'and anywhere else it is the token wording, unchanged');

    const source = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/lockedIntakeNotice\(location\.hostname\)/.test(source), 'the dialog reads the fork rather than owning a second one');
    assert(/no roster until the tower is running[\s\S]{0,60}no roster until a token is added/.test(source),
      'and the empty roster forks with it, so the two halves of the dialog cannot disagree');
  });

  await test('a locked copy anywhere else opens the prompt in a dialog, byte for byte', () => {
    // Where it is drawn moved (#96) — the prompt did not. It used to be the
    // page body and is now the layout's static modal, so the proof that it is
    // the same prompt moved with it: what the dialog is filled with is
    // `tokenPrompt()` itself, and the reason a refusal carries is the only
    // thing that ever differs.
    for (const hostname of ['ianwieds.github.io', 'tower.example.com', '192.168.1.20']) {
      assert(!token.isLocalHost(hostname), `${hostname} is not this machine`);
    }

    // The form is a stub the wiring can be read off: in the DOM every open
    // writes fresh markup, so the listener count here is one per open.
    const stored = [];
    const reloads = [];
    const input = { value: '  github_pat_TEST  ', focus: () => {} };
    const form = {
      listeners: [],
      addEventListener: (type, fn) => form.listeners.push({ type, fn }),
      querySelector: (sel) => (sel === '[data-token-input]' ? input : null),
    };
    const host = { innerHTML: '', querySelector: (sel) => (sel === '[data-token-form]' ? form : null) };
    const dialog = { querySelector: (sel) => (sel === '[data-token-body]' ? host : null) };
    const shown = [];
    const hidden = [];
    const instance = { show: () => shown.push(1), hide: () => hidden.push(1) };
    const scope = { querySelector: (sel) => (sel === `#${token.TOKEN_MODAL}` ? dialog : null) };
    // token.js reaches for `window` only inside these calls — the same
    // stub the api.js load above uses, held just long enough to make them.
    globalThis.window = { bootstrap: { Modal: { getOrCreateInstance: () => instance, getInstance: () => instance } }, localStorage: { setItem: (key, value) => stored.push(value), removeItem: () => {} } };
    const hadLocation = 'location' in globalThis ? globalThis.location : undefined;
    globalThis.location = { reload: () => reloads.push(1) };
    try {
      token.openTokenModal('', scope);
      assertEq(host.innerHTML, token.tokenPrompt(), 'the dialog is filled with the prompt, unchanged');
      assertEq(shown.length, 1, 'and opened — nothing was clicked, so the runtime opens it');
      assertEq(form.listeners.length, 1, 'and WIRED — the open mounts the submit, not just the markup');
      form.listeners[0].fn({ preventDefault: () => {} });
      assertEq(stored.join(), 'github_pat_TEST', 'submitting stores what was typed, trimmed');
      assertEq(reloads.length, 1, 'and reads the page again with it');
      token.openTokenModal('the token was refused', scope);
      assertEq(form.listeners.length, 2, 'a re-present wires its fresh markup too');
      assertEq(host.innerHTML, token.tokenPrompt('the token was refused'), 'a refusal re-presents it carrying the reason');
      assertEq(shown.length, 2, 'through the same one door');
      token.hideTokenModal(scope);
      assertEq(hidden.length, 1, 'and a read that landed after all takes it away again');

      const empty = { querySelector: () => null };
      const warn = console.warn;
      console.warn = () => {};
      token.openTokenModal('', empty);
      token.hideTokenModal(empty);
      console.warn = warn;
      assertEq(shown.length, 2, 'a page without the layout’s dialog is left alone rather than thrown at');
    } finally {
      delete globalThis.window;
      if (hadLocation === undefined) delete globalThis.location;
      else globalThis.location = hadLocation;
    }
  });

  await test('the layout disarms the auth gate under the framework’s CURRENT key', () => {
    // The gate re-armed itself once (#98): the framework renamed the settings
    // blob `web_manager` → `client`, the stale key resolved to nothing, and
    // the admin chain’s `authenticated` policy silently won. The pin is on
    // the exact key path, so the next rename fails here instead of on screen.
    const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src',
      '_layouts', 'tower', 'page.html'), 'utf8');
    assert(/client:\n  auth:\n    config:\n      policy: "disabled"/.test(layout),
      'the client blob disables the auth policy, spelled exactly as the engine reads it');
    assert(!layout.includes('web_manager:'), 'and the retired key is gone — it resolves to nothing');
  });

  await test('the layout ships that dialog, and it cannot be dismissed onto an empty page', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src',
      '_layouts', 'tower', 'page.html'), 'utf8');
    const start = layout.indexOf(`<div class="modal fade" id="${token.TOKEN_MODAL}"`);
    assert(start !== -1, 'the id token.js opens is a plain Bootstrap modal in the layout — the intake dialog’s own mechanism');
    const shell = layout.slice(start, layout.indexOf('<!-- Intake dialog.', start));
    assert(shell.includes('data-token-body'), 'with the region the prompt is written into');
    assert(shell.includes('data-bs-backdrop="static"') && shell.includes('data-bs-keyboard="false"'),
      'and no way to dismiss it — behind it is a page with no data and no second place to type a token');
    assert(!shell.includes('btn-close'), 'no close button either');
    assert(shell.includes('aria-label="Unlock the board"'), 'the dialog names itself, since it carries no header of its own');
  });

  await test('nothing token-shaped is committed anywhere in the app', () => {
    // The whole doctrine: the token is the VIEWER's, typed into their browser.
    // A literal in the source would be published to anyone with the URL.
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
    const src = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src');
    for (const file of walk(src)) {
      const text = fs.readFileSync(file, 'utf8');
      assert(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), `${path.basename(file)} carries no classic token`);
      assert(!/github_pat_[A-Za-z0-9_]{20,}/.test(text), `${path.basename(file)} carries no fine-grained token`);
    }
  });

  group('tower/app: history — the board over time');

  // The pages that DRAW these charts import the framework's chart module and
  // are out of reach here (the note at the top of this file), so the logic they
  // draw from lives in a lib and is asked its questions directly: what is the
  // series, what changed since last week, and which of the three absences is
  // this. The pages are pinned by reading their source, the way every other
  // page claim in this suite is.

  const history = await load('history.js');

  /** A brief payload carrying the history the read-back returns. */
  const withHistory = (entries) => ({ counts: { open: 0 }, history: entries });
  const day = (date, totals, closedDay = 0) => ({ date, totals, closedDay, repos: {} });

  await test('a series is one point per morning, labelled by day', () => {
    const payload = withHistory([
      day('2026-08-01', { open: 15, inbox: 5 }, 2),
      day('2026-08-02', { open: 14, inbox: 4 }, 1),
      day('2026-08-03', { open: 12, inbox: 3 }, 4),
    ]);
    const open = history.seriesOf(history.entriesOf(payload), 'open');
    assertEq(open.values.join(','), '15,14,12', 'the values, in the order they happened');
    assertEq(open.labels.join(','), '08-01,08-02,08-03', 'and the year is not on the axis three times');
    assertEq(history.seriesOf(history.entriesOf(payload), 'closedDay').values.join(','), '2,1,4', 'closedDay is read off the entry, not the totals');
    assertEq(history.seriesOf(history.entriesOf(payload), 'ready').values.join(','), '0,0,0', 'a total no morning recorded reads as zero, never NaN');
  });

  await test('the three absences are three different states, and none of them is a zero', () => {
    assertEq(history.entriesOf(withHistory(null)).length, 0, 'a null history maps to nothing');
    assert(history.unread(withHistory(null)), 'and it is UNREAD — the read failed or there is no home repo');
    assert(!history.unread(withHistory([])), 'an empty list is a board with no published briefs yet, which is not the same');
    assert(!history.hasSeries(withHistory([day('2026-08-03', { open: 1 })])), 'one point is a dot claiming to be a trend');
    assert(history.hasSeries(withHistory([day('2026-08-02', { open: 2 }), day('2026-08-03', { open: 1 })])), 'two is a line');
    assert(history.ACCRUES.includes('published briefs') && history.UNREAD.includes('could not be read'),
      'and each absence has its own sentence');
  });

  await test('last week is found by date, not by counting entries', () => {
    // A morning whose brief never published leaves no point, so the seventh
    // entry back can be a fortnight ago.
    const entries = [
      day('2026-07-20', { open: 20 }),
      day('2026-07-27', { open: 15 }),
      day('2026-08-01', { open: 14 }),
      day('2026-08-03', { open: 12 }),
    ];
    const delta = history.weekDelta(entries, 'open');
    assertEq(delta.from, 15, 'the nearest morning on or before seven days back');
    assertEq(delta.to, 12, 'against today');
    assertEq(delta.change, -3, 'three fewer open');
    assertEq(delta.days, 7, 'seven days apart');
    assertEq(history.deltaLine(delta), 'down 3 from last week', 'said in plain language');
  });

  await test('a comparison that does not exist is no line at all', () => {
    assertEq(history.weekDelta([day('2026-08-03', { open: 1 })], 'open'), null, 'one point compares with nothing');
    // Every point inside the week: a delta against the oldest would silently
    // become "since the beginning" on a young board.
    assertEq(history.weekDelta([day('2026-08-01', { open: 9 }), day('2026-08-03', { open: 4 })], 'open'), null,
      'and a history younger than a week has no last week to compare with');
    assertEq(history.deltaLine(null), '', 'so the tile carries no sub-line');
  });

  await test('a delta of nothing says so, and an older comparison says how old it is', () => {
    const flat = history.weekDelta([day('2026-07-25', { open: 7 }), day('2026-08-03', { open: 7 })], 'open');
    assertEq(history.deltaLine(flat), 'unchanged since 9 days ago', 'the gap is named when it is not a week');
    const up = history.weekDelta([day('2026-07-27', { open: 4 }), day('2026-08-03', { open: 9 })], 'open');
    assertEq(history.deltaLine(up), 'up 5 from last week', 'and a board that grew says up');
  });

  await test('both pages draw the history through the framework’s chart module, and neither invents a colour', () => {
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['index.js', 'brief.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(/from '__main_assets__\/js\/libs\/charts\.js'/.test(source), `${name} draws through the framework module`);
      assert(/chartSlot\(/.test(source), `${name} draws into the slot that says the figures are in the table when the chunk did not load`);
      assert(/hasSeries\(/.test(source) && /ACCRUES/.test(source), `${name} says why a chart is absent rather than drawing an empty axis`);
      // A raw colour would be one the theme cannot restate; the module's own
      // ramp is what every other chart on the tower draws in.
      assert(!/['"]#[0-9a-fA-F]{3,8}['"]/.test(source), `${name} names no colour of its own`);
    }
    assert(/feeds: \['repos', 'board', 'sessions', 'health', 'brief'\]/.test(fs.readFileSync(path.join(pages, 'index.js'), 'utf8')),
      'and the Overview asks for the brief feed the history rides on');
  });

  group('tower/app: the runtime’s published shape');

  await test('the pages that read this machine say so instead of drawing empty', () => {
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['crew.js', 'usage.js', 'health.js']) {
      assert(/local: true/.test(fs.readFileSync(path.join(pages, name), 'utf8')), `${name} declares itself local-only`);
    }
    for (const name of ['index.js', 'board.js', 'brief.js']) {
      assert(!/local: true/.test(fs.readFileSync(path.join(pages, name), 'utf8')), `${name} works off-machine and does not`);
    }
  });

  await test('the runtime opens the dialog when locked and draws the local line when it cannot help', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // The two arms of the locked state, on token.js's one predicate: on this
    // machine the notice IS the body (#89), and anywhere else the shell is left
    // alone and the prompt opens over it (#96) — nothing is written to the body
    // there, because a locked copy has no data to stand in for.
    assert(/MODE === 'locked'[\s\S]{0,80}isLocalHost\(location\.hostname\)\) body\.innerHTML = towerDownNotice\(location\.href\)/.test(source),
      'a locked copy on this machine is the tower-down notice, whole page');
    assert(/isLocalHost\(location\.hostname\)[\s\S]{0,120}else openTokenModal\(\);/.test(source),
      'and anywhere else the prompt is opened as the dialog, not written into the page');
    assert(!/body\.innerHTML = tokenPrompt/.test(source), 'the prompt is never the body again');
    assert(/MODE === 'github' && options\.local[\s\S]{0,120}localOnlyNotice\(\)/.test(source), 'and a local-only page says where its data lives');
    assert(source.includes('githubPageFeeds(options.feeds)') && source.includes('githubFetcher'),
      'an unlocked copy polls GitHub through the same loop');
    assert(/githubPageFeeds\(\[name\]\)\[name\]\) state\.feeds\[name\] = localOnlySlot\(\)/.test(source),
      'and a feed only the machine can answer is filled with the marked slot rather than left spinning');
  });

  await test('a token GitHub refused puts the prompt back, carrying the refusal', () => {
    // The reason used to be dumped on the page as a bare problem — on a page
    // with no field in it. The prompt is the only place a token is typed, and
    // `tokenPrompt(problem)` existed for exactly this and had no caller. It is
    // the same dialog the locked copy opens (#96), over the page it was hiding.
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/isTokenRefusal/.test(source), 'the refusal is recognised by the one predicate that names it');
    assert(/openTokenModal\(refused\.reason\)/.test(source), 'and the prompt is opened with the reason in it');
    assert(/if \(!prompted\)/.test(source), 'once — re-filling it under a viewer mid-type would take what they typed away');
    assert(/if \(prompted\) hideTokenModal\(\)/.test(source),
      'and a read that lands after all takes the dialog away, since nothing a viewer does can');
  });

  await test('an unlocked page opens no dialog at all', () => {
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    // Every mention of the dialog in the runtime, in order: the import, the
    // locked non-local arm, the refusal, and the read that clears it. A tower
    // page and a working published one reach none of them.
    assertEq((source.match(/openTokenModal\(/g) || []).length, 2, 'opened from the locked arm and from the refusal, nowhere else');
    for (const call of source.split('\n').filter((line) => /openTokenModal\(/.test(line) && !line.startsWith('import'))) {
      assert(/^\s*(else openTokenModal\(\);|openTokenModal\(refused\.reason\);)$/.test(call), `no third caller: ${call.trim()}`);
    }
  });

  await test('the Overview says local-only where its machine-bound numbers would be', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'index.js'), 'utf8');
    for (const cell of ['Live sessions', 'Unpushed', 'Unreleased']) {
      assert(new RegExp(`machineStat\\(state, '(sessions|health)', '${cell}'`).test(source), `${cell} is a machine reading, and the tile knows it`);
    }
    assert(/machineStat = \(state, name, label, value, href\) => \(localOnly\(state, name\)[\s\S]{0,120}LOCAL_ONLY_NOTICE\)/.test(source),
      'a local-only feed draws a dash with the sentence, never a 0 summed from an empty feed');
    assert(/localOnly\(state, 'sessions'\)\) body = localOnlyNotice\(\)/.test(source), 'the crew panel says it too');
    assert(/localOnly\(state, 'health'\)\) body = localOnlyNotice\(\)/.test(source),
      'and so does the health panel, which is about readings and not about the roster it lists');
  });

  await test('the Health page names a tower older than its checkout, and nothing otherwise', () => {
    // The page imports the framework, so it is out of reach of these suites
    // (see the header) — what can be pinned is the source of the decision: the
    // notice is drawn from BOTH commits being present and differing, which is
    // what keeps an unreadable git and a published copy silent.
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'health.js'), 'utf8');
    assert(/meta\.bootCommit && meta\.currentHead && meta\.bootCommit !== meta\.currentHead/.test(source),
      'both shas present and differing is the whole condition');
    assert(/stale\(meta\)[\s\S]{0,200}npm run tower/.test(source), 'and the notice it draws names the restart command');
    assert(/restartNotice\(meta\)/.test(source), 'which the render actually places');
    assert(/problem\(/.test(source), 'in the framework’s existing warning shape, no new colour pairing');
    assert(/API started/.test(source), 'and the start time is on the page beside it');
  });

  await test('the published Board drags like the local one — no read-only line left anywhere', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'board.js'), 'utf8');
    assert(/draggable = \(issue\) => WRITABLE/.test(source), 'a card picks up wherever there is something to write with');
    assert(!/READ_ONLY_NOTICE|readOnlyLine/.test(source), 'and the sentence that said it could not is gone with the state it described');
    assert(!/never even renders this page/.test(source), 'and the file no longer claims the runtime skips it');
    assert(/await state\.refresh\('board'\)/.test(source), 'a landed move is re-read, in published mode as on a machine');
  });

  await test('the Brief asks the mode which copy it is, never the payload’s shape', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages', 'brief.js'), 'utf8');
    assert(/warnings\(forRepo\(payload\.warnings \|\| \[\], selected\), MODE === 'github'\)/.test(source),
      'the local-only line is drawn from MODE, the one signal every page reads');
    assert(!/Boolean\(payload\.summaries\)/.test(source), 'an absent API key is not load-bearing any more');
  });

  await test('the Brief draws what to work on next, and yesterday, only when the payload carries them', () => {
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    const source = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(/nextUp\(forRepo\(payload\.nextUp \|\| \[\], selected\)\)/.test(source),
      'the ranked list is narrowed by the same selection every other section is');
    assert(/summaryCard\('What yesterday produced', payload\.findings\)/.test(source), 'the findings card is drawn from the key');
    assert(/summaryCard\('The week', payload\.week\)/.test(source), 'and the week from its own');
    assert(/const summaryCard = \(heading, item\) => \(item \?/.test(source),
      'an absent or null key draws nothing at all — a brief that could not read one says less, never something untrue');
    assert(/externalLink\(item\.url\)/.test(source), 'every row links to the thing it names');
  });

  await test('the runtime fills the sidebar’s selector menu and carries the scope onto the nav', () => {
    // page.js reaches for `document` at import and is out of reach of these
    // suites (see the header), so what is pinned is the wiring: where the menu
    // is written, what writes it, and that the nav links are rewritten on the
    // selection AND on every paint — the two halves of #104's promise that
    // moving Overview → Board keeps the scope.
    const source = fs.readFileSync(path.join(libs, 'page.js'), 'utf8');
    assert(/menuMarkup\(state\)/.test(source), 'the menu is markup from state, like the chrome');
    assert(/sidebarKey\(state\)/.test(source), 'and it is rewritten only when what it shows changed');
    assert(/classList\.contains\('show'\)/.test(source), 'never while the viewer has it open, unless the change came from inside it');
    assert(/#app-sidebar \.classy-side__selector/.test(source), 'written into the framework’s own selector, reached through its button');
    assert(!/#app-sidebar ul/.test(source), 'never as a bare sidebar ul — the nav is one too');
    assert(/data-tower-projects/.test(source), 'and claimed with the one attribute the runtime marks it by');
    assert(/data-bs-auto-close/.test(source), 'ticking a subset box does not close the menu it is in');
    assert(/data-tower-scope\]/.test(source) && /data-tower-scope-slug/.test(source), 'both controls are wired — the entries and the subset boxes');
    assert(/scopedHref\(/.test(source), 'the nav links are rewritten through the one formatter');
    assert(/scopeNav\(/.test(source), 'and the rewrite has a name the paint and the change both call');
    assert(!/tower-repo/.test(source), 'and the chrome’s dropdown is gone, handler and all');
  });

  await test('every page reads the selection as a SET, and no consumer compares it as a slug', () => {
    const pages = path.join(__dirname, '..', '..', 'tower', 'app', 'apps', 'web', 'src', 'assets', 'js', 'pages');
    // The Board's repo column and its denominator, and the Brief's narrowing,
    // are the two pages that read the selection directly rather than through
    // state.js — both converted to the set (#104).
    const board = fs.readFileSync(path.join(pages, 'board.js'), 'utf8');
    assert(/selectedSlugs\(state\)/.test(board), 'the Board asks for the slugs');
    assert(!/state\.selectedRepo/.test(board), 'and never for the raw value it used to compare');
    const brief = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(/selectedSlugs\(state\)/.test(brief), 'so does the Brief');
    assert(!/state\.selectedRepo/.test(brief), 'and it compares nothing as a slug either');
    // state.js is the rest of them — every page narrows through these three.
    const reader = fs.readFileSync(path.join(libs, 'state.js'), 'utf8');
    assertEq((reader.match(/selectedSlugs\(state\)/g) || []).length, 3, 'reposFor, issuesFor and inSelectedRepo, all through the one parse');
    assert(!/state\.selectedRepo ===|repo\.slug === state\.selectedRepo/.test(reader), 'no equality against the raw value survives');
    // The intake dialog pre-selects a repo, and a subset names no single one.
    const intake = fs.readFileSync(path.join(libs, 'intake.js'), 'utf8');
    assert(/selectedSlugs|parseRepos/.test(intake), 'the intake dialog parses it too');
  });

  await test('the chrome carries the Token button only where there is a token to forget', () => {
    const published = chrome.chromeMarkup({ ...CHROME, tokenMode: true });
    assert(published.includes('id="tower-token"'), 'a published copy can replace or clear its token');
    assert(!chrome.chromeMarkup(CHROME).includes('id="tower-token"'), 'and a copy reading a tower has none');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
