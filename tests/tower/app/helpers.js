//
// The shared prologue of the tower dashboard's browser-JavaScript suites, the
// `*.test.js` files beside this one, which test the pure half of it. A plain
// module, never a suite: the runner only loads files ending in `.test.js`.
//
// The app is ES modules written for a browser, and the suites here are Node, so
// each lib is pulled in with a dynamic `import()`. That works for exactly the
// modules that touch neither the DOM nor the network: `format.js` (markup from
// values), `state.js` (what a feed said, and what the repo selection leaves in
// play), `crew.js` (the crew tree) and `modal.js` (an issue as markup). The
// runtime itself (page.js) and the intake dialog reach for `document` and
// `window` at import time and are out of scope here by design - the logic
// worth asserting was moved OUT of them into the modules above. `api.js` sits
// in between: it reads `location` once at import to fix the API origin and
// touches `fetch` only at call time, so two stubbed globals bring its feed
// adapter - the one translation the runtime leans on - under test, along with
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

const libs = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'libs', 'tower');
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
// browser - what the glyph looks like while it turns stays a browser's answer
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
    // which - so the double reads its own markup back, the way a comparison
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
 * One indicator as the paint left it - the node shape `agent.crewActivity`
 * writes, built out of the double above. The test that uses it pins this shape
 * against the real markup string, so the two cannot drift apart in silence.
 */
const drawnIndicator = ({ phase, stamps, age, title }) => {
  const glyph = el('i', `fa-solid fa-gear${phase === 'working' ? ' fa-spin' : ''}`);
  const spoken = el('span', 'visually-hidden');
  spoken.text = phase;
  const icon = el('span', `omega-tower-activity omega-tower-activity--${phase}`).append(glyph, spoken);
  icon.attrs.title = title;
  const label = el('span', 'omega-micro text-body-secondary', { liveAge: '' });
  label.text = age;
  const wrapper = el('span', 'd-inline-flex align-items-center gap-1', stamps).append(icon, label);
  // The CARD the indicator sits on, which a page marks so the tick can mute it
  // when the agent goes quiet (#99) - the crew card and the Overview's row both
  // carry `data-live-card`.
  const card = el('div', 'card h-100', { liveCard: '' }).append(wrapper);
  // Nothing above is a tick - reset the counters so the first one starts at nil.
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

/** Every lib the suites ask questions of, loaded the way each one allows under Node. */
const loadLibs = async () => {
  const format = await load('format.js');
  const state = await load('state.js');
  const crew = await load('crew.js');
  // agent.js is markup from a node and a clock - no DOM, so the indicator's
  // three states and its cutoff are askable here.
  const agent = await load('agent.js');
  // clock.js walks a document but reaches for nothing at import time - the
  // timer is armed inside startClock - so `applyLive` comes under Node against
  // the small DOM double above.
  const secondHand = await load('clock.js');
  // modal.js reaches for `document` only inside mountIssueModal, so everything
  // that shapes an issue into markup imports and answers under Node.
  const modal = await load('modal.js');
  // chrome.js is markup from state, like format.js - the DOM it goes into is
  // page.js's, which is why the split it describes is askable here.
  const chrome = await load('chrome.js');
  // scope.js is the `?repo=` value read and written - strings and arrays, no
  // DOM - and sidebar.js is markup from state, chrome.js's shape exactly.
  const scope = await load('scope.js');
  const sidebar = await load('sidebar.js');
  // favorites.js takes its storage as an argument, github.js's pattern, so the
  // key, the junk tolerance and the toggle all answer under Node.
  const favorites = await load('favorites.js');
  // api.js fixes its origin from `location` at import - stub it (and the
  // `window` override hatch) just long enough to load the module.
  globalThis.location = { href: 'http://localhost:4300/' };
  globalThis.window = {};
  const api = await load('api.js');
  delete globalThis.location;
  delete globalThis.window;
  // github.js is the published half of the data layer and takes every seam it
  // has as an argument - the token, `fetch`, the clock - so the whole of it,
  // including the two async doors, answers under Node. token.js is markup plus
  // one listener, and the markup half is pure.
  const github = await load('github.js');
  const token = await load('token.js');
  return {
    format, state, crew, agent, secondHand, modal, chrome, scope, sidebar, favorites, api, github, token,
  };
};

/** The instant the agent indicator and the agent dialog are both read against. */
const NOW = 1700000000000;

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
// `headers` is the third thing a Response carries and the only place a rate
// limit says when it lifts, so the stub answers them the way `Headers` does.
const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (name in headers ? headers[name] : null) },
  json: async () => body,
});

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
          assignees: { nodes: [{ login: 'alice' }] },
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
          // sweep, so it is carried and never acted on - this item leads
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
      // What the day CLOSED (issue #55) - two inside the 24-hour window and
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

/** Whether a URL is the roster read - the one call the private list costs. */
const isRoster = (url) => url.startsWith('https://api.github.com/') && url.includes('contents/data/repos.json');

/**
 * A fetch that answers the home pointer from the site, the roster from the
 * home repo, and everything else from GraphQL - the three reads a published
 * page makes (issue #110).
 */
const mkSiteFetch = (list, graphqlBody) => mkFetch((url) => {
  if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
  if (isRoster(url)) return jsonResponse(200, list);
  return jsonResponse(200, graphqlBody);
});

module.exports = {
  libs, load, loadLibs, mkState, failed, ROSTER, drawnIndicator, openAgentDialog, NOW,
  mkStorage, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW, isRoster, mkSiteFetch,
};
